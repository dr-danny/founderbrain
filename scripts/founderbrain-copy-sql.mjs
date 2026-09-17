import {cp,mkdir,readdir} from 'node:fs/promises';
await mkdir('dist/founderbrain-server/src/server/db',{recursive:true});
await cp('src/server/db/migrations','dist/founderbrain-server/src/server/db/migrations',{recursive:true});
await cp('src/server/db/rls.sql','dist/founderbrain-server/src/server/db/rls.sql');
await mkdir('dist/founderbrain-server/src/founderbrain',{recursive:true});
for(const file of await readdir('src/founderbrain'))if(file.endsWith('.sql'))await cp('src/founderbrain/'+file,'dist/founderbrain-server/src/founderbrain/'+file);
