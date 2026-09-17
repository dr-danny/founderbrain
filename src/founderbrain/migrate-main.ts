import { runMigrations } from '../server/db/migrate.ts';
import { closeDb } from '../server/db/client.ts';
import { runFounderBrainMigrations } from './migrations.ts';
import { migrateJobs } from './jobs.ts';
import postgres from 'postgres';
const admin=process.env.MIGRATION_DATABASE_URL;
if(!admin)throw new Error('MIGRATION_DATABASE_URL required. Never give the production API the migration role.');
process.env.DATABASE_URL=admin;
try{
  await runMigrations();await runFounderBrainMigrations(admin);await migrateJobs(admin);
  const role=process.env.RUNTIME_DB_ROLE;
  if(role){if(!/^fb_[a-z0-9_]{1,50}$/.test(role))throw new Error('RUNTIME_DB_ROLE must be a restricted fb_ role name.');
    const sql=postgres(admin,{max:1,onnotice:()=>{}});
    try{await sql.begin(async tx=>{
      const roles=await tx`select rolsuper,rolbypassrls from pg_roles where rolname=${role}`;
      if(!roles[0]||roles[0].rolsuper||roles[0].rolbypassrls)throw new Error('Create a NOSUPERUSER NOBYPASSRLS runtime role before granting access.');
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
      await tx.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    });}finally{await sql.end();}
  }
  console.log('FounderBrain additive migrations complete. No data was seeded or copied from a live environment.');
}finally{await closeDb();}
