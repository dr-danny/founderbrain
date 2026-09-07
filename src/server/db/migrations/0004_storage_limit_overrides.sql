-- The owner's own storage limits, set from the Setup screen.
--
-- One settings row for the whole app, never one per founder: storage/paths.ts's
-- storageLimits() is a property of the deployment, not of any one founder in it, so
-- this table carries no founder_id, unlike every other table in this database.
--
-- The id is pinned to the single literal 'owner' by the CHECK below, so an upsert
-- aimed at the wrong conflict target inserts a second row that fails to compile
-- rather than a second row a settings screen quietly never reads.
--
-- Each limit is independently nullable. Null means the owner has not set that one,
-- which falls back to GE_LIMIT_* or to detection exactly as if this row did not
-- exist. bigint, not integer: the app's own detection ceiling for total bytes is
-- 5 GiB, past what a Postgres integer column can hold, and the raw number an owner
-- typed is stored unclamped (see src/server/storage/limits-store.ts), so the column
-- must never overflow on the way in.
--
-- No row level security policy, for the same reason mentor_requests carries none: a
-- policy filters on app.founder_id and there is nothing here to filter on.
CREATE TABLE "storage_limit_overrides" (
	"id" text PRIMARY KEY NOT NULL DEFAULT 'owner',
	"file_bytes" bigint,
	"total_bytes" bigint,
	"file_count" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_limit_overrides_single_row" CHECK ("id" = 'owner')
);
