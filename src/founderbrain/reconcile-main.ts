import postgres from 'postgres';
/** Operator-only accounting reconciliation. This never triggers a provider call. */
const url=process.env.MIGRATION_DATABASE_URL;
const id=process.env.JOB_ID;
const raw=process.env.CONFIRMED_COST_MICROUSD;
if(!url||!id||!/^[-a-f0-9]{36}$/i.test(id)||!raw||!/^\d+$/.test(raw)||process.env.RECONCILIATION_CONFIRMED!=='yes')throw new Error('Supply admin URL, JOB_ID, provider-confirmed CONFIRMED_COST_MICROUSD and RECONCILIATION_CONFIRMED=yes. Never infer zero cost from a timeout.');
const cost=Number(raw);if(!Number.isSafeInteger(cost)||cost<0)throw new Error('Confirmed cost must be a nonnegative safe integer.');
const sql=postgres(url,{max:1,onnotice:()=>{}});
try{
 await sql.begin(async tx=>{
  const jobs=await tx`select id,founder_id,status,reserved,budget_day from fb_ai_job where id=${id} for update`;
  const deleted=await tx`select * from fb_usage_reconciliation where job_id=${id} for update`;
  const j=jobs[0],d=deleted[0];
  if(j&&j.status!=='uncertain')throw new Error('Only quarantined uncertain jobs can be reconciled.');
  if(d?.reconciled_at)throw new Error('This deleted-workspace call was already reconciled.');
  if(!j&&!d)throw new Error('No unresolved call found.');
  const scope=j?'workspace:'+j.founder_id:d!.scope;
  const day=j?.budget_day??d!.budget_day,reserved=j?.reserved??d!.reserved;
  for(const s of ['global',scope]){
   const changed=await tx`update fb_budget set reserved=reserved-${reserved},spent=spent+${cost} where scope=${s} and day=${day} and reserved>=${reserved} returning scope`;
   if(!changed.length)throw new Error('Reservation accounting is inconsistent; no changes were committed.');
  }
  if(j){await tx`update fb_ai_job set status='failed',error='Operator reconciled provider usage. A new generation may be requested.' where id=${id}`;await tx`update fb_job_dispatch set status='failed' where job_id=${id}`;}
  if(d)await tx`update fb_usage_reconciliation set reconciled_at=now() where job_id=${id}`;
 });
 console.log('Provider-confirmed accounting reconciled. No generation or outbound action performed.');
}finally{await sql.end();}
