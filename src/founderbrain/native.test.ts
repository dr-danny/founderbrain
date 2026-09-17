import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {it} from 'node:test';
import {PgBrainStore} from './store.ts';
import {emptyBrain} from './domain.ts';
const url=process.env.FB_TEST_DATABASE_URL;
const skip=!url?'Native test database not configured':process.env.FB_TEST_EMBEDDED==='true'?'Requires native independent PostgreSQL connections; not claimed from PGlite':undefined;
it('native concurrent delete/save leaves no content after deletion',{skip},async()=>{
 process.env.GE_MASTER_KEY??=randomBytes(32).toString('base64');const store=new PgBrainStore(url!);
 try{for(let i=0;i<10;i++){const subject='native-race|'+randomUUID();const id=await store.ensureWorkspace(subject);const b=emptyBrain();b.identity.name='Private fixture';
 const outcomes=await Promise.allSettled([store.commit(id,b,0,'race-'+randomUUID()),store.deleteWorkspace(subject,id)]);
 assert.equal(outcomes[1]!.status,'fulfilled');assert.equal((await store.scoped(id,tx=>tx`select 1 from ge_blob`)).length,0);assert.equal((await store.scoped(id,tx=>tx`select 1 from ge_file`)).length,0);await assert.rejects(store.ensureWorkspace(subject),{status:410});}}
 finally{await store.close();}
});
