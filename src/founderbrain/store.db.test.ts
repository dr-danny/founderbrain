import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { emptyBrain } from "./domain.ts";
import { runFounderBrainMigrations } from "./migrations.ts";
import { closeDb } from "../server/db/client.ts";
import { runMigrations } from "../server/db/migrate.ts";
import { PgBrainStore } from "./store.ts";

const databaseUrl = process.env.FB_TEST_DATABASE_URL;
const migrationUrl = process.env.FB_TEST_MIGRATION_DATABASE_URL ?? databaseUrl;
const skip = databaseUrl
  ? undefined
  : "FB_TEST_DATABASE_URL is not set, so real Postgres storage is not being claimed";
let store: PgBrainStore | undefined;
let workspace = "";
let priorDatabaseUrl: string | undefined;
const subject = `https://issuer.example.test|${randomBytes(12).toString("hex")}`;

before(async () => {
  if (!databaseUrl || !migrationUrl) return;
  // crypto reads the key lazily. A test-only key is generated only when callers did
  // not supply one; never print either the key or database URL.
  process.env.GE_MASTER_KEY ??= randomBytes(32).toString("base64");
  // The migration role may be supplied separately. Falling back to the runtime URL
  // keeps a local disposable database one-command testable, never a production pattern.
  priorDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = migrationUrl;
  if (process.env.FB_TEST_EMBEDDED !== "true") {
    await runMigrations();
    await runFounderBrainMigrations(migrationUrl);
  }
  store = new PgBrainStore(databaseUrl);
  workspace = await store.ensureWorkspace(subject);
});

after(async () => {
  try {
    if (store && workspace) await store.deleteWorkspace(subject, workspace);
  } finally {
    await store?.close();
    await closeDb();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  }
});

function filledBrain() {
  const brain = emptyBrain();
  brain.identity = {
    name: "Ada",
    venture: "Northwind",
    role: "Founder",
    stage: "building",
    goal: "Validate demand",
    approved: true,
  };
  return brain;
}

describe(
  process.env.FB_TEST_EMBEDDED === "true"
    ? "PgBrainStore on embedded PostgreSQL (not native concurrency proof)"
    : "PgBrainStore against native Postgres",
  () => {
    it(
      "creates an empty isolated workspace and commits encrypted revision history",
      { skip },
      async () => {
        assert.ok(store);
        const initial = await store.read(workspace);
        assert.equal(initial.version, 0);
        assert.equal(initial.verified, false);

        const brain = filledBrain();
        const saved = await store.commit(workspace, brain, 0, "save-1");
        assert.equal(saved.version, 1);
        assert.equal(saved.verified, true);
        assert.deepEqual(saved.brain, brain);
        assert.equal(saved.sha.length, 64);

        const replay = await store.commit(workspace, brain, 0, "save-1");
        assert.equal(
          replay.version,
          1,
          "idempotent replay returns the original revision, not latest",
        );
        const versions = await store.history(workspace);
        assert.deepEqual(
          versions.map((v) => v.version),
          [1],
        );
      },
    );

    it("rejects stale writes and idempotency reuse with another body", { skip }, async () => {
      assert.ok(store);
      const brain = filledBrain();
      const changed = structuredClone(brain);
      changed.identity.goal = "Book interviews";
      await assert.rejects(store.commit(workspace, changed, 0, "stale-save"), {
        code: "version_conflict",
      });
      await assert.rejects(store.commit(workspace, changed, 1, "save-1"), {
        code: "idempotency_mismatch",
      });
    });

    it("restores by making a new revision rather than overwriting history", { skip }, async () => {
      assert.ok(store);
      const restored = await store.restore(workspace, 1, 1, "restore-1");
      assert.equal(restored.version, 2);
      const versions = await store.history(workspace);
      assert.deepEqual(
        versions.map((v) => v.version),
        [2, 1],
      );
    });

    it("keeps ge rows tenant-scoped under RLS", { skip }, async () => {
      assert.ok(store);
      const otherSubject = `https://issuer.example.test|${randomBytes(12).toString("hex")}`;
      const otherWorkspace = await store.ensureWorkspace(otherSubject);
      try {
        await store.commit(otherWorkspace, filledBrain(), 0, "other-save");
        const visible = await store.scoped(
          workspace,
          (tx) => tx<{ founder_id: string }[]>`select founder_id from ge_file`,
        );
        assert.deepEqual(
          visible.map((row) => row.founder_id),
          [workspace],
        );
      } finally {
        await store.deleteWorkspace(otherSubject, otherWorkspace);
      }
    });

    it("tombstones the subject binding after deletion", { skip }, async () => {
      assert.ok(store);
      await store.deleteWorkspace(subject, workspace);
      await assert.rejects(store.ensureWorkspace(subject), { code: "workspace_deleted" });
      workspace = "";
    });
  },
);
