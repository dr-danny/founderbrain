import Fastify, { type FastifyRequest } from 'fastify';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createAuthenticator,constantEqual,type Authenticate } from './auth.ts';
import { DomainError,exportMarkdown,readiness } from './domain.ts';
import type { Config } from './config.ts';
import { PgBrainStore } from './store.ts';
import { BrainJobs } from './jobs.ts';

const key=z.string().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const version=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new DomainError(422,'invalid_request','Check the request fields and try again.');return r.data;}
export async function buildApi(config:Config,options:{store?:PgBrainStore;jobs?:BrainJobs;authenticate?:Authenticate;serveWeb?:boolean}={}){
  const store=options.store??new PgBrainStore(config.DATABASE_URL);
  if(config.NODE_ENV==='production'){
    const role=await store.scoped('00000000000000000000000000',tx=>tx`select current_user as role`);
    if(role[0]?.role==='fb_worker')throw new Error('The API cannot use the cross-workspace worker database role.');
  }
  const jobs=options.jobs??new BrainJobs(store,config);
  const authenticate=options.authenticate??createAuthenticator(config);
  const app=Fastify({logger:false,bodyLimit:128*1024,trustProxy:false,requestTimeout:20000});
  const contexts=new WeakMap<FastifyRequest,{subject:string;email:string;workspace:string}>();
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
    if(!req.url.startsWith('/api/'))return;
    if(config.FOUNDERBRAIN_LOCAL_DEMO!=='true'){
      const supplied=req.headers['x-founderbrain-origin'];
      if(typeof supplied!=='string'||!config.ORIGIN_SECRET||!constantEqual(supplied,config.ORIGIN_SECRET))throw new DomainError(403,'origin_denied','Use the application URL to access this service.');
    }
    if(req.headers.origin && req.headers.origin!==config.APP_ORIGIN)throw new DomainError(403,'origin_denied','This origin is not permitted.');
    if(req.url.split('?')[0]==='/api/config')return;
    const identity=await authenticate(req);
    const workspace=await store.ensureWorkspace(identity.subject);
    contexts.set(req,{subject:identity.subject,email:identity.email,workspace});
  });
  const context=(req:FastifyRequest)=>{const c=contexts.get(req);if(!c)throw new DomainError(401,'sign_in_required','Sign in to continue.');return c;};
  app.get('/health/live',async()=>({ok:true,service:'founderbrain-api'}));
  app.get('/health/ready',async(_req,reply)=>{try{await store.scoped('00000000000000000000000000',async tx=>{await tx`select 1 from fb_ai_job limit 0`;});return {ok:true};}catch{reply.code(503);return {ok:false};}});
  // Sign-in is Cloudflare Access in front of the Worker, so the browser needs no auth
  // configuration at all. It only needs to know which mode it is in and where to sign out.
  app.get('/api/config',async()=>({authMode:config.FOUNDERBRAIN_LOCAL_DEMO==='true'?'local-demo':'cloudflare-access',signOutPath:config.FOUNDERBRAIN_LOCAL_DEMO==='true'?null:'/cdn-cgi/access/logout',aiEnabled:config.AI_ENABLED==='true'}));
  /** Who am I, for the account display. The subject is never returned; it is a storage key. */
  app.get('/api/me',async req=>({email:context(req).email}));
  app.get('/api/brain',async req=>{
    const query=parse(z.object({version:z.coerce.number().int().positive().optional()}).strict(),req.query);
    const workspace=context(req).workspace;const state=await store.read(workspace,query.version);
    const artifact=query.version?null:await jobs.artifact(workspace);
    return {...state,readiness:readiness(state.brain,artifact),artifact};
  });
  app.put('/api/brain',async req=>{const body=parse(z.object({brain:z.unknown(),expectedVersion:version,idempotencyKey:key}).strict(),req.body);return store.commit(context(req).workspace,body.brain as any,body.expectedVersion,body.idempotencyKey);});
  app.get('/api/history',async req=>({versions:await store.history(context(req).workspace)}));
  app.post('/api/restore',async req=>{const body=parse(z.object({version:version.min(1),expectedVersion:version,idempotencyKey:key}).strict(),req.body);return store.restore(context(req).workspace,body.version,body.expectedVersion,body.idempotencyKey);});
  app.get('/api/export',async(req,reply)=>{
    const query=parse(z.object({format:z.enum(['json','markdown']).default('markdown')}).strict(),req.query);const state=await store.read(context(req).workspace);
    if(!state.version)throw new DomainError(409,'not_saved','Save your first Brain revision before exporting.');
    if(query.format==='json')return reply.type('application/json').header('Content-Disposition','attachment; filename="founder-brain.json"').send(JSON.stringify({version:state.version,sha:state.sha,brain:state.brain},null,2));
    return reply.type('text/markdown; charset=utf-8').header('Content-Disposition','attachment; filename="founder-brain.md"').send(exportMarkdown(state.brain,state.version));
  });
  app.post('/api/jobs',async(req,reply)=>{const body=parse(z.object({expectedVersion:version,idempotencyKey:key}).strict(),req.body);return reply.code(202).send(await jobs.enqueue(context(req).workspace,body.expectedVersion,body.idempotencyKey));});
  app.get('/api/jobs/:id',async req=>{const {id}=parse(z.object({id:z.string().uuid()}),req.params);return jobs.read(context(req).workspace,id);});
  app.get('/api/artifact',async req=>{const workspace=context(req).workspace;const artifact=await jobs.artifact(workspace);const state=await store.read(workspace);return {artifact,stale:!!artifact&&artifact.sourceHash!==state.sha};});
  app.post('/api/artifact/:id/accept',async req=>{const {id}=parse(z.object({id:z.string().uuid()}),req.params);const body=parse(z.object({text:z.string().min(1).max(12000),expectedVersion:version,idempotencyKey:key}).strict(),req.body);return {artifact:await jobs.accept(context(req).workspace,id,body.text,body.expectedVersion,body.idempotencyKey),verified:true};});
  app.delete('/api/workspace',async req=>{parse(z.object({confirmation:z.literal('DELETE')}).strict(),req.body);const c=context(req);await store.deleteWorkspace(c.subject,c.workspace);return {deleted:true};});
  app.setErrorHandler((error,_req,reply)=>{
    if(error instanceof DomainError)return reply.code(error.status).send({error:error.code,message:error.message,...(error.details?{details:error.details}:{})});
    const status=(error as {statusCode?:number}).statusCode;
    if(status&&status>=400&&status<500)return reply.code(status).send({error:'invalid_request',message:'The request could not be accepted.'});
    return reply.code(503).send({error:'temporarily_unavailable',message:'The service is temporarily unavailable. Your saved work has not been discarded. Retry using the same request.'});
  });
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:'not_found',message:'Not found.'}));
  if(options.serveWeb){await app.register(staticFiles,{root:resolve('dist/founderbrain-web'),prefix:'/'});}
  app.addHook('onClose',async()=>{await jobs.close();await store.close();});
  return app;
}
