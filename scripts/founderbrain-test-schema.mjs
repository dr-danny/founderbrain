// Only for the disposable PGlite fixture. Production MUST use fb:migrate against native PostgreSQL.
import postgres from 'postgres';
import {readFile,readdir} from 'node:fs/promises';
if(process.env.FB_TEST_EMBEDDED!=='true')throw new Error('This direct-DDL harness requires explicit FB_TEST_EMBEDDED=true.');
const url=process.env.FB_TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw new Error('Disposable loopback database required.');
const sql=postgres(url,{max:1,onnotice:()=>{}});
try{
 await sql`create extension if not exists citext`;
 const dir=new URL('../src/server/db/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await sql.unsafe(await readFile(new URL(name,dir),'utf8'));
 await sql.unsafe(await readFile(new URL('../src/server/db/rls.sql',import.meta.url),'utf8'));
 await sql.unsafe(await readFile(new URL('../src/founderbrain/0001_founderbrain.sql',import.meta.url),'utf8'));
 await sql.unsafe(await readFile(new URL('../src/founderbrain/jobs.sql',import.meta.url),'utf8'));
 await sql.unsafe(await readFile(new URL('../src/founderbrain/usage.sql',import.meta.url),'utf8'));
 for(const role of ['fb_runtime','fb_worker']){
  const exists=await sql`select 1 from pg_roles where rolname=${role}`;
  if(!exists.length)await sql.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
 }
 console.log('Disposable embedded PostgreSQL schema loaded. Native migration locking is NOT tested by this harness.');
}finally{await sql.end();}
