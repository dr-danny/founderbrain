import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const migrationName = 'founderbrain:0001';
const migrationLock = 'founderbrain:migrations';

/**
 * Apply FounderBrain's additive tables with the separately provisioned migration
 * role. This intentionally does not use the request/runtime pool: production
 * runtime roles must not receive DDL or BYPASSRLS authority.
 */
export async function runFounderBrainMigrations(databaseUrl: string): Promise<void> {
  if (!databaseUrl) throw new Error('FounderBrain migration database URL is required');
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined, connection: { application_name: 'founderbrain-migrate' } });
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${migrationLock}))`;
      await tx`create schema if not exists founderbrain`;
      await tx`
        create table if not exists founderbrain.migrations (
          name text primary key,
          applied_at timestamp with time zone not null default now()
        )
      `;
      const done = await tx<{ name: string }[]>`select name from founderbrain.migrations where name = ${migrationName}`;
      if (done.length === 0) {
        const ddl = await readFile(join(here, '0001_founderbrain.sql'), 'utf8');
        await tx.unsafe(ddl);
        await tx`insert into founderbrain.migrations (name) values (${migrationName})`;
      }
      const rls = await tx<{ relname: string; enabled: boolean; forced: boolean }[]>`
        select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname in ('fb_user', 'fb_member', 'fb_receipt')
      `;
      if (rls.length !== 3 || rls.some((row) => !row.enabled || !row.forced)) {
        throw new Error('FounderBrain row-level security is not enabled and forced on every FounderBrain table');
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Production runtime must not be superuser or bypass RLS. */
export async function assertSafeRole(sql: Sql, production = process.env.NODE_ENV === 'production'): Promise<void> {
  const rows = await sql<{ superuser: boolean; bypassrls: boolean }[]>`
    select r.rolsuper as superuser, r.rolbypassrls as bypassrls
      from pg_roles r where r.rolname = current_user
  `;
  const role = rows[0];
  if (!role) throw new Error('Database runtime role could not be verified');
  if (production && (role.superuser || role.bypassrls)) {
    throw new Error('FounderBrain runtime database role must not be superuser or BYPASSRLS');
  }
}
