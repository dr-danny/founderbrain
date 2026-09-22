/**
 * src/founderbrain/server.ts
 *
 * WHAT THIS IS. The FounderBrain Fastify API: health, config, Brain CRUD,
 * export, generation jobs, and artifact accept. Identity comes from auth.ts;
 * persistence from store.ts; the money path from jobs.ts.
 *
 * WHY IT EXISTS. One origin-secret-guarded surface for the edge Worker. Local
 * demo can serve the built web assets; production never uses the fb_worker DB
 * role here.
 */
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { z } from "zod";
import { createAuthenticator, constantEqual, type Authenticate } from "./auth.ts";
import { DomainError, exportMarkdown, readiness, validateBrain } from "./domain.ts";
import type { Config } from "./config.ts";
import { PgBrainStore } from "./store.ts";
import { BrainJobs } from "./jobs.ts";
import { createFounderBrainLogger, logJobEvent, subjectLogHash } from "./logging.ts";
import {
  API_IP_LIMIT,
  API_SUBJECT_MUTATION_LIMIT,
  MUTATION_PATHS,
  SlidingWindowLimiter,
  mutationKey,
} from "./rate-limit.ts";
import { ensureOpenRouterKey, revokeOpenRouterKey } from "./openrouter-keys.ts";
import { getRoutineSettings, listRoutineDrafts, setRoutineDraftStatus, updateRoutineSettings } from "./routines.ts";
import type { OpenRouterManagement } from "./openrouter-management.ts";
import { usageResponse, usageTotals } from "./usage.ts";
import { readOrientation, writeOrientation } from "./orientation.ts";
import {
  authorizeUrl,
  connectionStatus,
  crmOAuthConfigured,
  exchangeCode,
  readOauthState,
  saveConnection,
  signOauthState,
} from "./crm-oauth.ts";
import { importSite } from "./site-import.ts";
import { apolloStatus, connectApollo, disconnectApollo } from "./apollo.ts";
import { transcribeVoice } from "./voice.ts";
import { addVoiceSample, deleteVoiceSample, listVoiceSamples, MIN_VOICE_SAMPLES } from "./voice-samples.ts";
import { brainReadyForPush, defaultFirstPack, loadValueCatalog, pushGhlValues } from "./ghl-push.ts";

const key = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new DomainError(422, "invalid_request", "Check the request fields and try again.");
  return r.data;
}

function clientIp(req: FastifyRequest): string {
  // trustProxy is false on purpose; the Worker is the only intended client. Prefer the
  // edge-forwarded connecting IP only when present as a single token; otherwise socket.
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && /^[0-9a-fA-F:.]+$/.test(cf)) return cf;
  return req.socket.remoteAddress ?? "unknown";
}

function tooMany(reply: FastifyReply, retryAfterSec: number) {
  reply.header("Retry-After", String(retryAfterSec));
  throw new DomainError(429, "rate_limited", "Too many requests. Wait a moment and try again.");
}

export async function buildApi(
  config: Config,
  options: {
    store?: PgBrainStore;
    jobs?: BrainJobs;
    authenticate?: Authenticate;
    serveWeb?: boolean;
    logger?: boolean;
    openRouterManagement?: OpenRouterManagement;
  } = {},
) {
  const ownsStore = options.store === undefined;
  const ownsJobs = options.jobs === undefined;
  const store =
    options.store ?? new PgBrainStore(config.DATABASE_URL, config.NODE_ENV === "production");
  if (config.NODE_ENV === "production") {
    const role = await store.scoped(
      "00000000000000000000000000",
      (tx) => tx`select current_user as role`,
    );
    if (role[0]?.role === "fb_worker")
      throw new Error("The API cannot use the cross-workspace worker database role.");
  }
  const enableLogger = options.logger ?? options.store === undefined;
  const log = createFounderBrainLogger("api", enableLogger ? "info" : "silent");
  const jobs =
    options.jobs ?? new BrainJobs(store, config, undefined, (event) => logJobEvent(log, event));
  const authenticate = options.authenticate ?? createAuthenticator(config);
  const app = Fastify({
    loggerInstance: enableLogger ? log : undefined,
    bodyLimit: 128 * 1024,
    trustProxy: false,
    requestTimeout: 20000,
    genReqId: (req) => {
      const inbound = req.headers["x-request-id"];
      return typeof inbound === "string" && inbound.length > 0 && inbound.length < 120
        ? inbound
        : `api-${Date.now().toString(16)}`;
    },
  });
  // In-memory single-instance limits (#19). Not shared across replicas.
  const ipLimiter = new SlidingWindowLimiter(API_IP_LIMIT);
  const subjectLimiter = new SlidingWindowLimiter(API_SUBJECT_MUTATION_LIMIT);
  const contexts = new WeakMap<
    FastifyRequest,
    { subject: string; email: string; workspace: string }
  >();
  const started = new WeakMap<FastifyRequest, number>();

  app.addHook("onRequest", async (req, reply) => {
    started.set(req, Date.now());
    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (req.headers["x-request-id"])
      reply.header("X-Request-Id", String(req.headers["x-request-id"]));
    if (!req.url.startsWith("/api/")) return;

    const ip = clientIp(req);
    const ipResult = ipLimiter.take(`ip:${ip}`);
    if (!ipResult.allowed) tooMany(reply, ipResult.retryAfterSec);

    if (config.FOUNDERBRAIN_LOCAL_DEMO !== "true") {
      const supplied = req.headers["x-founderbrain-origin"];
      if (
        typeof supplied !== "string" ||
        !config.ORIGIN_SECRET ||
        !constantEqual(supplied, config.ORIGIN_SECRET)
      )
        throw new DomainError(
          403,
          "origin_denied",
          "Use the application URL to access this service.",
        );
    }
    if (req.headers.origin && req.headers.origin !== config.APP_ORIGIN)
      throw new DomainError(403, "origin_denied", "This origin is not permitted.");
    if (req.url.split("?")[0] === "/api/config") return;
    const identity = await authenticate(req);
    const workspace = await store.ensureWorkspace(identity.subject);
    contexts.set(req, { subject: identity.subject, email: identity.email, workspace });
    // Provision per-user OpenRouter key on first authenticated request (signup path).
    if (config.OPENROUTER_MANAGEMENT_KEY || options.openRouterManagement) {
      try {
        await ensureOpenRouterKey(
          store,
          config,
          workspace,
          identity.email,
          options.openRouterManagement,
        );
      } catch {
        // Soft-fail provisioning so Brain edit/export still work if OpenRouter is down.
        // A revoked key stays blocked for AI actions (keyIsUsable at spend time),
        // but it must not brick the whole app: the preHandler used to rethrow
        // openrouter_key_revoked and every API call for the account 403'd.
        log.warn(
          { errorClass: "openrouter_provision_deferred" },
          "OpenRouter key provisioning deferred.",
        );
      }
    }

    const path = req.url.split("?")[0] ?? req.url;
    const mut = mutationKey(req.method, path);
    if (MUTATION_PATHS.has(mut)) {
      const subjectResult = subjectLimiter.take(`sub:${identity.subject}:${mut}`);
      if (!subjectResult.allowed) tooMany(reply, subjectResult.retryAfterSec);
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    if (!req.url.startsWith("/api/") && !req.url.startsWith("/health/")) return;
    const ctx = contexts.get(req);
    const ms = Date.now() - (started.get(req) ?? Date.now());
    log.info(
      {
        reqId: req.id,
        method: req.method,
        path: req.url.split("?")[0],
        status: reply.statusCode,
        latencyMs: ms,
        subjectHash: ctx ? subjectLogHash(ctx.subject) : undefined,
      },
      "founderbrain.request",
    );
  });

  const context = (req: FastifyRequest) => {
    const c = contexts.get(req);
    if (!c) throw new DomainError(401, "sign_in_required", "Sign in to continue.");
    return c;
  };
  app.get("/health/live", async () => ({ ok: true, service: "founderbrain-api" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await store.scoped("00000000000000000000000000", async (tx) => {
        await tx`select 1 from fb_ai_job limit 0`;
      });
      return { ok: true };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  });
  // Process metrics only — no Brain content. Cross-workspace queue depth needs fb_worker (operator SQL).
  app.get("/health/metrics", async () => ({
    ok: true,
    service: "founderbrain-api",
    uptimeSec: Math.round(process.uptime()),
    memoryRss: process.memoryUsage().rss,
    rateLimit: {
      mode: "in-memory-single-instance",
      ip: API_IP_LIMIT,
      subjectMutations: API_SUBJECT_MUTATION_LIMIT,
    },
  }));
  app.get("/api/config", async () => {
    const local = config.FOUNDERBRAIN_LOCAL_DEMO === "true";
    return {
      authMode: local ? "local-demo" : "hexclave",
      hexclave: local
        ? null
        : {
            projectId: config.HEXCLAVE_PROJECT_ID,
            apiUrl: new URL(config.HEXCLAVE_API_URL).origin,
            publishableClientKey: config.HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? null,
          },
      aiEnabled: config.AI_ENABLED === "true",
      crmConnectEnabled: crmOAuthConfigured(config),
      siteImportEnabled: Boolean(config.FIRECRAWL_API_KEY),
      routinesEnabled: config.ROUTINES_ENABLED === "true",
    };
  });
  app.get("/api/oauth/status", async (req) => connectionStatus(store, context(req).workspace));
  app.get("/api/oauth/start", async (req) => {
    if (!crmOAuthConfigured(config))
      throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
    const secret = config.ORIGIN_SECRET ?? config.HIGHLEVEL_CLIENT_SECRET;
    if (!secret)
      throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
    const c = context(req);
    const state = signOauthState(secret, c.subject);
    return { url: authorizeUrl(config, state) };
  });
  app.post("/api/oauth/complete", async (req) => {
    if (!crmOAuthConfigured(config))
      throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
    const secret = config.ORIGIN_SECRET ?? config.HIGHLEVEL_CLIENT_SECRET;
    if (!secret)
      throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
    const body = parse(
      z.object({ code: z.string().min(8).max(512), state: z.string().min(8).max(2000) }).strict(),
      req.body,
    );
    const c = context(req);
    const claimed = readOauthState(secret, body.state);
    if (claimed.sub !== c.subject)
      throw new DomainError(403, "oauth_state_mismatch", "Connect belonged to a different session.");
    const tokens = await exchangeCode(config, body.code);
    await saveConnection(store, c.workspace, tokens);
    return connectionStatus(store, c.workspace);
  });
  app.post("/api/voice", { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const body = parse(
      z
        .object({
          // Base64 of the 10 MiB decoded cap lands under this limit and under the
          // 16 MiB route bodyLimit; codec parameters (audio/webm;codecs=opus) accepted.
          audioBase64: z.string().min(64).max(14_000_000),
          mime: z.string().regex(/^audio\/(webm|ogg|wav|mpeg)(;.*)?$/),
          seconds: z.coerce.number().positive().max(300),
        })
        .strict(),
      req.body,
    );
    return transcribeVoice(config, store, context(req).workspace, {
      audio: Buffer.from(body.audioBase64, "base64"),
      mime: body.mime,
      seconds: body.seconds,
    });
  });
  app.get("/api/voice-samples", async (req) => {
    await loadValueCatalog();
    return { samples: await listVoiceSamples(store, context(req).workspace), min: MIN_VOICE_SAMPLES };
  });
  app.post("/api/voice-samples", async (req) => {
    const body = parse(
      z.object({ name: z.string().min(2).max(120), text: z.string().min(40).max(20_000) }).strict(),
      req.body,
    );
    return addVoiceSample(store, context(req).workspace, config, body);
  });
  app.delete("/api/voice-samples/:id", async (req) => {
    const query = parse(z.object({ id: z.string().min(36).max(36) }).strict(), req.query);
    return deleteVoiceSample(store, context(req).workspace, query.id);
  });
  app.get("/api/routines", async (req) => {
    const workspace = context(req).workspace;
    const [settings, drafts] = await Promise.all([
      getRoutineSettings(store, workspace),
      listRoutineDrafts(store, workspace),
    ]);
    return { settings, drafts };
  });
  app.post("/api/routines/settings", async (req) => {
    const body = parse(
      z
        .object({
          timezone: z.string().max(64).optional(),
          mondayPlan: z.boolean().optional(),
          contentTopUp: z.boolean().optional(),
          readinessDigest: z.boolean().optional(),
          sequenceHealth: z.boolean().optional(),
          whatWorked: z.boolean().optional(),
        })
        .strict(),
      req.body ?? {},
    );
    return updateRoutineSettings(store, context(req).workspace, body);
  });
  app.get("/api/apollo/status", async (req) => apolloStatus(store, context(req).workspace));
  app.post("/api/apollo/connect", async (req) => {
    const body = parse(
      // Apollo API keys are alphanumeric with dashes/underscores.
      z.object({ key: z.string().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
      req.body,
    );
    return connectApollo(store, context(req).workspace, body.key);
  });
  app.delete("/api/apollo", async (req) => {
    await disconnectApollo(store, context(req).workspace);
    return { connected: false };
  });
  app.post("/api/routines/drafts/status", async (req) => {
    const body = parse(
      z.object({ id: z.string().min(36).max(36), status: z.enum(["read", "dismissed"]) }).strict(),
      req.body,
    );
    await setRoutineDraftStatus(store, context(req).workspace, body.id, body.status);
    return { ok: true };
  });
  app.post("/api/ghl/push", { bodyLimit: 1024 * 1024 }, async (req) => {
    const body = parse(
      z.object({ pack: z.string().max(40).optional() }).strict(),
      req.body ?? {},
    );
    const state = await store.read(context(req).workspace);
    if (!brainReadyForPush(state.brain))
      throw new DomainError(422, "brain_incomplete", "Approve all five missions before pushing to GoHighLevel.");
    const firstPack = body.pack ?? defaultFirstPack(state.brain);
    await loadValueCatalog();
    return pushGhlValues(config, store, context(req).workspace, state.brain, firstPack);
  });
  app.post("/api/site-import", async (req) => {
    const body = parse(
      z.object({ url: z.string().url().max(300) }).strict(),
      req.body,
    );
    if (!body.url.startsWith("https://"))
      throw new DomainError(422, "invalid_request", "Use an https website address.");
    return importSite(config, store, context(req).workspace, body.url);
  });
  app.get("/api/me", async (req) => ({ email: context(req).email }));
  app.get("/api/usage", async (req) =>
    usageResponse(config, await usageTotals(store, context(req).workspace)),
  );
  app.get("/api/orientation", async (req) => readOrientation(store, context(req).workspace));
  app.put("/api/orientation", async (req) =>
    writeOrientation(store, context(req).workspace, req.body),
  );
  app.get("/api/brain", async (req) => {
    const query = parse(
      z.object({ version: z.coerce.number().int().positive().optional() }).strict(),
      req.query,
    );
    const workspace = context(req).workspace;
    const state = await store.read(workspace, query.version);
    const artifact = query.version ? null : await jobs.artifact(workspace);
    return { ...state, readiness: readiness(state.brain, artifact, state.sha), artifact };
  });
  app.put("/api/brain", async (req) => {
    const body = parse(
      z.object({ brain: z.unknown(), expectedVersion: version, idempotencyKey: key }).strict(),
      req.body,
    );
    return store.commit(
      context(req).workspace,
      validateBrain(body.brain),
      body.expectedVersion,
      body.idempotencyKey,
    );
  });
  app.get("/api/history", async (req) => ({
    versions: await store.history(context(req).workspace),
  }));
  app.post("/api/restore", async (req) => {
    const body = parse(
      z.object({ version: version.min(1), expectedVersion: version, idempotencyKey: key }).strict(),
      req.body,
    );
    return store.restore(
      context(req).workspace,
      body.version,
      body.expectedVersion,
      body.idempotencyKey,
    );
  });
  app.get("/api/export", async (req, reply) => {
    const query = parse(
      z.object({ format: z.enum(["json", "markdown"]).default("markdown") }).strict(),
      req.query,
    );
    const state = await store.read(context(req).workspace);
    if (!state.version)
      throw new DomainError(409, "not_saved", "Save your first Brain revision before exporting.");
    if (query.format === "json")
      return reply
        .type("application/json")
        .header("Content-Disposition", 'attachment; filename="founder-brain.json"')
        .send(
          JSON.stringify({ version: state.version, sha: state.sha, brain: state.brain }, null, 2),
        );
    return reply
      .type("text/markdown; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="founder-brain.md"')
      .send(
        exportMarkdown(
          state.brain,
          state.version,
          state.updatedAt,
          await store.firstCommittedAt(context(req).workspace),
        ),
      );
  });
  app.post("/api/jobs", async (req, reply) => {
    const body = parse(
      z.object({ expectedVersion: version, idempotencyKey: key }).strict(),
      req.body,
    );
    return reply
      .code(202)
      .send(await jobs.enqueue(context(req).workspace, body.expectedVersion, body.idempotencyKey));
  });
  app.get("/api/jobs/:id", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return jobs.read(context(req).workspace, id);
  });
  app.get("/api/artifact", async (req) => {
    const workspace = context(req).workspace;
    const artifact = await jobs.artifact(workspace);
    const state = await store.read(workspace);
    return { artifact, stale: !!artifact && artifact.sourceHash !== state.sha };
  });
  app.post("/api/artifact/:id/accept", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(
      z
        .object({
          text: z.string().min(1).max(12000),
          expectedVersion: version,
          idempotencyKey: key,
        })
        .strict(),
      req.body,
    );
    return {
      artifact: await jobs.accept(
        context(req).workspace,
        id,
        body.text,
        body.expectedVersion,
        body.idempotencyKey,
      ),
      verified: true,
    };
  });
  app.delete("/api/workspace", async (req) => {
    parse(z.object({ confirmation: z.literal("DELETE") }).strict(), req.body);
    const c = context(req);
    // Fail closed: never delete local workspace while a live OpenRouter key may remain.
    await revokeOpenRouterKey(store, config, c.workspace, options.openRouterManagement);
    await store.deleteWorkspace(c.subject, c.workspace);
    return { deleted: true };
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError) {
      if (error.status >= 500)
        log.warn(
          { reqId: req.id, code: error.code, status: error.status },
          "founderbrain.domain_error",
        );
      return reply.code(error.status).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply
        .code(status)
        .send({ error: "invalid_request", message: "The request could not be accepted." });
    log.error({ reqId: req.id, errName: (error as Error)?.name }, "founderbrain.unhandled");
    return reply.code(503).send({
      error: "temporarily_unavailable",
      message:
        "The service is temporarily unavailable. Your saved work has not been " +
        "discarded. Retry using the same request.",
    });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: "not_found", message: "Not found." }),
  );
  if (options.serveWeb) {
    await app.register(staticFiles, { root: resolve("dist/founderbrain-web"), prefix: "/" });
  }
  app.addHook("onClose", async () => {
    if (ownsJobs) await jobs.close();
    if (ownsStore) await store.close();
  });
  return app;
}
