// Development-only fallback. This is PostgreSQL WASM, not a native multi-connection production proof.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
const db = await PGlite.create({dataDir:process.env.FB_PGLITE_DIR??'memory://',extensions:{citext,pgcrypto}});
const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:Number(process.env.FB_PGLITE_PORT??55473),maxConnections:20});
await server.start();
console.log('Embedded PostgreSQL test engine listening on loopback. Not production hosting.');
process.on('SIGTERM',async()=>{await server.stop();await db.close();process.exit(0);});
process.on('SIGINT',async()=>{await server.stop();await db.close();process.exit(0);});
