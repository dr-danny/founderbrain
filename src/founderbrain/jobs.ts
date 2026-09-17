/**
 * src/founderbrain/jobs.ts
 *
 * WHAT THIS IS. Generation queue, lease, fence, budget reserve/settle, and
 * artifact accept. The money path lives here; the Anthropic HTTP call does not
 * (see provider.ts).
 *
 * WHY IT EXISTS. One paid attempt per job. Ambiguous outcomes quarantine as
 * `uncertain` and never auto-retry. Editing and export stay available when AI
 * is disabled or the budget is spent.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type TransactionSql } from "postgres";
import {
  DomainError,
  canonicalize,
  contentHash,
  generationPayload,
  readiness,
  type Artifact,
} from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { anthropicProvider, type Provider, type ProviderCall } from "./provider.ts";
import { sealBlob, openBlob, unwrapDataKey } from "../server/storage/crypto.ts";

export type { Provider, ProviderResult } from "./provider.ts";

type Tx = TransactionSql;
type Call = ProviderCall;
type ArtifactRow = {
  id: string;
  accepted_sha: string | null;
  draft_sha: string;
  source_version: number | string;
  source_hash: string;
  input_hash: string;
  accepted_at: Date | string | null;
  created_at: Date | string;
};
type JobBudgetRow = { reserved: number; budget_day: string };
interface Pinned {
  api: Call;
  inputRate: number;
  outputRate: number;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_OUTPUT = 700;

export async function migrateJobs(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./jobs.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

async function putPrivate(tx: Tx, workspace: string, text: string): Promise<string> {
  const rows =
    await tx`select wrapped_key from founder where id=${workspace} and deleted_at is null`;
  if (!rows[0]) throw new DomainError(404, "workspace_missing", "Workspace not found.");
  const sealed = sealBlob(
    workspace,
    unwrapDataKey(workspace, rows[0].wrapped_key),
    Buffer.from(text),
  );
  await tx`
    insert into ge_blob(founder_id, sha, ciphertext, nonce, size_bytes)
    values (
      ${workspace}, ${sealed.sha}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.sizeBytes}
    )
    on conflict (founder_id, sha) do nothing
  `;
  return sealed.sha;
}

async function getPrivate(tx: Tx, workspace: string, sha: string): Promise<string> {
  const r = await tx`
    select b.ciphertext, b.nonce, f.wrapped_key
    from ge_blob b
    join founder f on f.id = b.founder_id
    where b.founder_id = ${workspace} and b.sha = ${sha}
  `;
  if (!r[0]) {
    throw new DomainError(
      503,
      "artifact_unavailable",
      "The saved artifact could not be retrieved.",
    );
  }
  return openBlob(
    workspace,
    unwrapDataKey(workspace, r[0].wrapped_key),
    sha,
    r[0].ciphertext,
    r[0].nonce,
  ).toString("utf8");
}

export type JobEventSink = (event: {
  jobId: string;
  workspaceId: string;
  status: string;
  providerRequestId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
  errorClass?: string;
}) => void;

export class BrainJobs {
  private dispatcher: ReturnType<typeof postgres>;
  constructor(
    private store: PgBrainStore,
    private config: Config,
    private provider: Provider = anthropicProvider,
    private onEvent: JobEventSink = () => {},
  ) {
    this.dispatcher = postgres(config.DATABASE_URL, {
      max: 1,
      onnotice: () => {},
      connect_timeout: 5,
    });
  }

  async enqueue(
    workspace: string,
    expectedVersion: number,
    key: string,
  ): Promise<{ id: string; status: string }> {
    if (this.config.AI_ENABLED !== "true") {
      throw new DomainError(
        503,
        "ai_disabled",
        "AI generation is not enabled. Your Brain can still be edited and exported.",
      );
    }
    const state = await this.store.read(workspace);
    const ready = readiness(state.brain);
    if (!ready.identity || !ready.customer || !ready.offer || !ready.voice) {
      throw new DomainError(422, "brain_incomplete", "Approve the four input missions first.");
    }
    const api: Call = {
      model: this.config.AI_MODEL!,
      max_tokens: MAX_OUTPUT,
      ...generationPayload(state.brain),
    };
    const body = canonicalize(api);
    if (Buffer.byteLength(body) > 32000) {
      throw new DomainError(
        422,
        "input_too_large",
        "Shorten your Brain before generating an invitation.",
      );
    }
    const pinned: Pinned = {
      api,
      inputRate: this.config.AI_INPUT_USD_PER_MILLION!,
      outputRate: this.config.AI_OUTPUT_USD_PER_MILLION!,
    };
    // UTF-8 byte count plus framing allowance deliberately over-reserves input tokens.
    const reserve = Math.ceil(
      (Buffer.byteLength(body) + 2048) * pinned.inputRate + MAX_OUTPUT * pinned.outputRate,
    );
    return this.store.scoped(workspace, async (tx: Tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${workspace}))`;
      const prior = await tx`
        select id, status, source_version
        from fb_ai_job
        where founder_id = ${workspace} and idempotency_key = ${key}
      `;
      if (prior[0]) {
        if (Number(prior[0].source_version) !== expectedVersion) {
          throw new DomainError(
            409,
            "idempotency_conflict",
            "This retry key belongs to a different request.",
          );
        }
        return { id: prior[0].id, status: prior[0].status };
      }
      const f = await tx`select version from founder where id=${workspace} and deleted_at is null`;
      if (Number(f[0]?.version) !== expectedVersion || state.version !== expectedVersion) {
        throw new DomainError(
          409,
          "version_conflict",
          "Your Brain changed. Reload before generating.",
        );
      }
      const active = await tx`
        select id from fb_ai_job
        where founder_id = ${workspace}
          and status in ('queued', 'running', 'uncertain')
        limit 1
      `;
      if (active.length) {
        throw new DomainError(409, "job_active", "A generation is already in progress.");
      }
      const day = new Date().toISOString().slice(0, 10);
      for (const [scope, cap] of [
        ["global", this.config.AI_GLOBAL_DAILY_MICROUSD!],
        ["workspace:" + workspace, this.config.AI_WORKSPACE_DAILY_MICROUSD!],
      ] as const) {
        await tx`insert into fb_budget(scope,day) values(${scope},${day}) on conflict do nothing`;
        const allowed = await tx`
          update fb_budget
          set reserved = reserved + ${reserve}
          where scope = ${scope}
            and day = ${day}
            and spent + reserved + ${reserve} <= ${cap}
          returning scope
        `;
        if (!allowed.length) {
          throw new DomainError(
            429,
            "budget_limit",
            "The generation budget is reached. Editing and exports remain available.",
          );
        }
      }
      const id = randomUUID();
      const blob = await putPrivate(tx, workspace, canonicalize(pinned));
      await tx`
        insert into fb_ai_job (
          id, founder_id, idempotency_key, source_version, source_hash,
          input_hash, input_blob_sha, status, reserved, budget_day
        ) values (
          ${id}, ${workspace}, ${key}, ${state.version}, ${contentHash(state.brain)},
          ${hash(body)}, ${blob}, 'queued', ${reserve}, ${day}
        )
      `;
      await tx`
        insert into fb_job_dispatch(job_id, founder_id, status)
        values (${id}, ${workspace}, 'queued')
      `;
      return { id, status: "queued" };
    });
  }

  async read(
    workspace: string,
    id: string,
  ): Promise<{ id: string; status: string; error?: string; artifact?: Artifact }> {
    return this.store.scoped(workspace, async (tx: Tx) => {
      const r =
        await tx`select id,status,error from fb_ai_job where founder_id=${workspace} and id=${id}`;
      if (!r[0]) throw new DomainError(404, "job_missing", "Generation not found.");
      const a = await tx`select * from fb_artifact where founder_id=${workspace} and job_id=${id}`;
      return {
        id: r[0].id,
        status: r[0].status,
        ...(r[0].error ? { error: r[0].error } : {}),
        ...(a[0] ? { artifact: await this.toArtifact(tx, workspace, a[0] as ArtifactRow) } : {}),
      };
    });
  }

  private async toArtifact(tx: Tx, workspace: string, a: ArtifactRow): Promise<Artifact> {
    return {
      id: a.id,
      text: await getPrivate(tx, workspace, a.accepted_sha ?? a.draft_sha),
      sourceVersion: Number(a.source_version),
      sourceHash: a.source_hash,
      inputHash: a.input_hash,
      acceptedAt: a.accepted_at ? new Date(a.accepted_at).toISOString() : null,
      createdAt: new Date(a.created_at).toISOString(),
    };
  }

  async artifact(workspace: string): Promise<Artifact | null> {
    return this.store.scoped(workspace, async (tx: Tx) => {
      const r = await tx`
        select * from fb_artifact
        where founder_id = ${workspace}
        order by accepted_at desc nulls last, created_at desc
        limit 1
      `;
      return r[0] ? this.toArtifact(tx, workspace, r[0] as ArtifactRow) : null;
    });
  }

  async accept(
    workspace: string,
    id: string,
    text: string,
    expectedVersion: number,
    key: string,
  ): Promise<Artifact> {
    const normalized = text.trim();
    if (!normalized || normalized.length > 12000) {
      throw new DomainError(
        422,
        "invalid_artifact",
        "The invitation must contain between 1 and 12,000 characters.",
      );
    }
    const requestHash = hash(canonicalize({ text: normalized, expectedVersion }));
    await this.store.scoped(workspace, async (tx: Tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${workspace}))`;
      const r =
        await tx`select * from fb_artifact where founder_id=${workspace} and id=${id} for update`;
      const a = r[0];
      if (!a) throw new DomainError(404, "artifact_missing", "Artifact not found.");
      if (a.accepted_at) {
        if (a.accept_key === key && a.accept_hash === requestHash) return;
        throw new DomainError(
          409,
          "already_accepted",
          "This artifact was already accepted. Generate a new draft to revise it.",
        );
      }
      const f = await tx`select version from founder where id=${workspace} for update`;
      if (
        Number(f[0]?.version) !== expectedVersion ||
        Number(a.source_version) !== expectedVersion
      ) {
        throw new DomainError(
          409,
          "stale_proposal",
          "Your Brain changed since generation. Regenerate before accepting.",
        );
      }
      const sha = await putPrivate(tx, workspace, normalized);
      await tx`
        update fb_artifact
        set accepted_sha = ${sha},
            accept_key = ${key},
            accept_hash = ${requestHash},
            accepted_at = now()
        where founder_id = ${workspace} and id = ${id}
      `;
      await tx`
        insert into ge_event (
          founder_id, actor, verb, subject, version_before, version_after
        ) values (
          ${workspace}, 'founder', 'fb.artifact.accept', ${id},
          ${expectedVersion}, ${expectedVersion}
        )
      `;
    });
    return this.store.scoped(workspace, async (tx: Tx) => {
      const r = await tx`select * from fb_artifact where founder_id=${workspace} and id=${id}`;
      if (!r[0])
        throw new DomainError(
          503,
          "verification_pending",
          "Acceptance was saved; verification is pending.",
        );
      const artifact = await this.toArtifact(tx, workspace, r[0] as ArtifactRow);
      if (artifact.text !== normalized) {
        throw new DomainError(
          503,
          "verification_pending",
          "Acceptance was saved; verification is pending.",
        );
      }
      return artifact;
    });
  }

  /** One provider attempt per job. Ambiguous calls are quarantined, never automatically retried. */
  async tick(authorizedWorkspace?: string): Promise<boolean> {
    // Scoped draining is useful for operator tests; the production worker uses the
    // dedicated fb_worker role for cross-workspace dispatch. Never expose this via API.
    const candidates = authorizedWorkspace
      ? await this.store.scoped(
          authorizedWorkspace,
          async (tx: Tx) =>
            tx`
            select job_id, founder_id from fb_job_dispatch
            where founder_id = ${authorizedWorkspace}
              and (
                status = 'queued'
                or (status = 'running' and lease_until < now())
              )
            order by job_id
            limit 1
          `,
        )
      : await this.dispatcher`
          select job_id, founder_id from fb_job_dispatch
          where status = 'queued'
             or (status = 'running' and lease_until < now())
          order by job_id
          limit 1
        `;
    const c = candidates[0];
    if (!c) return false;
    const workspace = c.founder_id as string;
    const claim = await this.store.scoped(workspace, async (tx: Tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${workspace}))`;
      await tx`select id from founder where id=${workspace} for update`;
      const rows = await tx`
        select * from fb_ai_job
        where founder_id = ${workspace} and id = ${c.job_id}
        for update skip locked
      `;
      const j = rows[0];
      if (!j) return null;
      if (j.status === "running" && new Date(j.lease_until).getTime() < Date.now()) {
        await tx`
          update fb_ai_job
          set status = 'uncertain',
              fence = fence + 1,
              error = 'Generation interrupted; spend needs operator reconciliation.'
          where founder_id = ${workspace} and id = ${j.id}
        `;
        await tx`update fb_job_dispatch set status='uncertain' where job_id=${j.id}`;
        this.onEvent({
          jobId: j.id,
          workspaceId: workspace,
          status: "uncertain",
          errorClass: "lease_expired",
        });
        return null;
      }
      if (j.status !== "queued") return null;
      const f = await tx`select version from founder where id=${workspace}`;
      if (Number(f[0]?.version) !== Number(j.source_version)) {
        await this.settle(tx, workspace, j as JobBudgetRow, 0);
        await tx`
          update fb_ai_job
          set status = 'failed',
              error = 'Brain changed before generation. Generate again.'
          where founder_id = ${workspace} and id = ${j.id}
        `;
        await tx`update fb_job_dispatch set status='failed' where job_id=${j.id}`;
        return null;
      }
      const claimed = await tx`
        update fb_ai_job
        set status = 'running',
            fence = fence + 1,
            lease_until = now() + interval '120 seconds'
        where founder_id = ${workspace} and id = ${j.id}
        returning *
      `;
      await tx`
        update fb_job_dispatch
        set status = 'running',
            lease_until = now() + interval '120 seconds'
        where job_id = ${j.id}
      `;
      const pinned = JSON.parse(await getPrivate(tx, workspace, j.input_blob_sha)) as Pinned;
      if (hash(canonicalize(pinned.api)) !== j.input_hash) {
        throw new DomainError(503, "input_corrupt", "The generation input failed verification.");
      }
      const claimedJob = claimed[0];
      if (!claimedJob) return null;
      return { job: claimedJob, pinned };
    });
    if (!claim) return true;
    const { job, pinned } = claim;
    try {
      const result = await this.provider(pinned.api, this.config.ANTHROPIC_API_KEY!);
      const cost = Math.ceil(
        result.inputTokens * pinned.inputRate + result.outputTokens * pinned.outputRate,
      );
      if (
        !Number.isSafeInteger(cost) ||
        cost < 0 ||
        !result.text.trim() ||
        result.text.length > 12000
      ) {
        throw new Error("Invalid provider result");
      }
      await this.store.scoped(workspace, async (tx: Tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${workspace}))`;
        await tx`select id from founder where id=${workspace} for update`;
        const alive = await tx`
          select id from fb_ai_job
          where founder_id = ${workspace}
            and id = ${job.id}
            and fence = ${job.fence}
            and status = 'running'
            and lease_until > now()
          for update
        `;
        if (!alive.length) return;
        const sha = await putPrivate(tx, workspace, result.text);
        await tx`
          insert into fb_artifact (
            id, founder_id, job_id, source_version, source_hash, input_hash, draft_sha
          ) values (
            ${randomUUID()}, ${workspace}, ${job.id}, ${job.source_version},
            ${job.source_hash}, ${job.input_hash}, ${sha}
          )
          on conflict (founder_id, job_id) do nothing
        `;
        await this.settle(tx, workspace, job as JobBudgetRow, cost);
        await tx`
          update fb_ai_job
          set status = 'completed',
              provider_request_id = ${result.requestId},
              lease_until = null
          where founder_id = ${workspace}
            and id = ${job.id}
            and fence = ${job.fence}
        `;
        await tx`
          update fb_job_dispatch
          set status = 'completed', lease_until = null
          where job_id = ${job.id}
        `;
      });
      this.onEvent({
        jobId: job.id,
        workspaceId: workspace,
        status: "completed",
        providerRequestId: result.requestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicroUsd: cost,
      });
    } catch (e) {
      const knownNoCharge = (e as { knownNoCharge?: boolean })?.knownNoCharge === true;
      await this.store.scoped(workspace, async (tx: Tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${workspace}))`;
        await tx`select id from founder where id=${workspace} for update`;
        const alive = await tx`
          select id from fb_ai_job
          where founder_id = ${workspace}
            and id = ${job.id}
            and fence = ${job.fence}
            and status = 'running'
          for update
        `;
        if (!alive.length) return;
        if (knownNoCharge) await this.settle(tx, workspace, job as JobBudgetRow, 0);
        const status = knownNoCharge ? "failed" : "uncertain";
        const error = knownNoCharge
          ? "Provider refused the request. Contact the operator."
          : "Generation could not be verified. No automatic retry; spend is reserved for reconciliation.";
        await tx`
          update fb_ai_job
          set status = ${status}, error = ${error}, lease_until = null
          where founder_id = ${workspace}
            and id = ${job.id}
            and fence = ${job.fence}
        `;
        await tx`
          update fb_job_dispatch
          set status = ${status}, lease_until = null
          where job_id = ${job.id}
        `;
      });
      this.onEvent({
        jobId: job.id,
        workspaceId: workspace,
        status: knownNoCharge ? "failed" : "uncertain",
        errorClass: knownNoCharge ? "provider_refused" : ((e as Error)?.name ?? "Error"),
      });
    }
    return true;
  }

  private async settle(tx: Tx, workspace: string, job: JobBudgetRow, cost: number): Promise<void> {
    for (const scope of ["global", "workspace:" + workspace]) {
      await tx`
        update fb_budget
        set reserved = greatest(0, reserved - ${job.reserved}),
            spent = spent + ${cost}
        where scope = ${scope} and day = ${job.budget_day}
      `;
    }
  }

  async close(): Promise<void> {
    await this.dispatcher.end();
  }
}
