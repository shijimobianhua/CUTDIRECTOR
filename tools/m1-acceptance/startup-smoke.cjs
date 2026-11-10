'use strict';
const {spawn}=require('node:child_process');const path=require('node:path'),fs=require('node:fs');
async function main(){
 const root=path.resolve('.m1-data','startup-'+Date.now());const child=spawn(process.execPath,['src/server.cjs'],{env:{...process.env,VIDEO_DATA:root,PORT:'0'},windowsHide:true});let log='';
 const timer=setTimeout(()=>child.kill(),10000);child.stderr.on('data',c=>process.stderr.write(c));
 try {
  const port=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>reject(new Error('Early exit '+code)));child.stdout.on('data',c=>{log+=c;const m=/http:\/\/127\.0\.0\.1:(\d+)/.exec(log);if(m)resolve(m[1]);});});
  const r=await fetch('http://127.0.0.1:'+port+'/health');if(!r.ok||!(await r.json()).ok)throw new Error('Health failed');console.log(`Startup and health passed on loopback port ${port}`);
 }finally{clearTimeout(timer);child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
  // Windows termination may bypass signal handlers. This isolated test owns the lock;
  // remove it only after the spawned owner has exited.
  fs.rmSync(path.join(root,'.writer.lock'),{force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
