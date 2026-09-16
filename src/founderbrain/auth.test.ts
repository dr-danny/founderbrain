import assert from 'node:assert/strict';
import {before,after,it} from 'node:test';
import {createServer,type Server} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createAuthenticator} from './auth.ts';
import type {Config} from './config.ts';
import type {FastifyRequest} from 'fastify';
let server:Server;let issuer:string;let pair:Awaited<ReturnType<typeof generateKeyPair>>;
before(async()=>{pair=await generateKeyPair('ES256');const jwk=await exportJWK(pair.publicKey);jwk.kid='fixture-key';server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({keys:[jwk]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw new Error('fixture server unavailable');issuer=`http://127.0.0.1:${a.port}/auth/v1`;});
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
async function token(overrides:Record<string,unknown>={}){return new SignJWT({role:'authenticated',...overrides}).setProtectedHeader({alg:'ES256',kid:'fixture-key'}).setIssuer(issuer).setAudience('authenticated').setSubject('fixture-user').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);}
const request=(value:string)=>({headers:{authorization:'Bearer '+value},ip:'127.0.0.1'} as FastifyRequest);
it('verifies signature, issuer, audience, expiry and authenticated role using JWKS',async()=>{const auth=createAuthenticator({SUPABASE_URL:issuer.replace('/auth/v1',''),FOUNDERBRAIN_LOCAL_DEMO:'false'} as Config);assert.equal(await auth(request(await token())),issuer+'|fixture-user');await assert.rejects(auth(request(await token({role:'anon'}))),{status:401});await assert.rejects(auth(request('invalid-token')),{status:401});const wrong=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'fixture-key'}).setIssuer('https://wrong.example').setAudience('authenticated').setSubject('fixture-user').setExpirationTime('5m').sign(pair.privateKey);await assert.rejects(auth(request(wrong)),{status:401});const expired=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'fixture-key'}).setIssuer(issuer).setAudience('authenticated').setSubject('fixture-user').setExpirationTime(1).sign(pair.privateKey);await assert.rejects(auth(request(expired)),{status:401});});
