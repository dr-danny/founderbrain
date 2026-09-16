import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { DomainError } from './domain.ts';
export type Authenticate=(request:FastifyRequest)=>Promise<string>;
export function constantEqual(a:string,b:string):boolean { const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb); }
export function createAuthenticator(config:Config):Authenticate {
  if(config.FOUNDERBRAIN_LOCAL_DEMO==='true'&&config.NODE_ENV==='production')throw new Error('Local demo cannot authenticate production requests.');
  if(config.FOUNDERBRAIN_LOCAL_DEMO==='true') return async(req)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip)) throw new DomainError(403,'local_only','Local demo is only available on loopback.');
    if(req.headers['x-dev-user']!=='demo')throw new DomainError(401,'sign_in_required','Open the local demo to continue.');
    return 'local-demo|demo';
  };
  const issuer=config.SUPABASE_URL!.replace(/\/$/,'')+'/auth/v1';
  const keys=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:5000,cooldownDuration:30000});
  return async req=>{
    const authorization=req.headers.authorization;
    if(!authorization?.startsWith('Bearer '))throw new DomainError(401,'sign_in_required','Sign in to continue.');
    try {
      const {payload}=await jwtVerify(authorization.slice(7),keys,{issuer,audience:'authenticated',algorithms:['ES256','RS256'],clockTolerance:5});
      if(!payload.sub || !payload.exp || payload.role!=='authenticated' || payload.is_anonymous===true)throw new Error('Invalid identity claims');
      return issuer+'|'+payload.sub;
    }catch{throw new DomainError(401,'invalid_session','Your session has expired or could not be verified. Sign in again.');}
  };
}
