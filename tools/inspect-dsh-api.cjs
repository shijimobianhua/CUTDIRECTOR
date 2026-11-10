// Read-only inventory of the installed ASAR; no dependency installation or network.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const archive=process.argv[2]||'E:/Deepseek/resources/app.asar',out=path.resolve(process.argv[3]||'.ui-data/dsh-api-evidence');
const fd=fs.openSync(archive,'r'),header=Buffer.alloc(16);fs.readSync(fd,header,0,16,0);const json=Buffer.alloc(header.readUInt32LE(12));fs.readSync(fd,json,0,json.length,16);const tree=JSON.parse(json),offset=8+header.readUInt32LE(4);
function read(name){let entry=tree;for(const key of name.split('/').filter(Boolean))entry=entry.files[key];if(entry.offset===undefined)throw new Error('Not an archived file: '+name);const b=Buffer.alloc(entry.size);fs.readSync(fd,b,0,b.length,offset+Number(entry.offset));return b;}
const packages=['dsh-client-ui-layout','dsh-client-ui-conversation','dsh-client-ui-session','dsh-client-ui-renderer','dsh-client-ui-plugin-manager','dsh-client-ui-workspace','dsh-api-session-controller'];
fs.mkdirSync(out,{recursive:true});const evidence={archive,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),files:{}};
for(const pkg of packages)for(const file of ['README.md','lib/client.js','package.json']){const name=`dsh/node_modules/@deepseek-ai/${pkg}/${file}`;const b=read(name);evidence.files[name]={sha256:crypto.createHash('sha256').update(b).digest('hex')};const dest=path.join(out,pkg,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);}
fs.closeSync(fd);fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({archive:evidence.archive,sha256:evidence.sha256,out}));
