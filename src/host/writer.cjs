'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {fileURLToPath}=require('node:url');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(base) {
 try {
  const response=await fetch(base+'/health',{signal:AbortSignal.timeout(500)});
  return response.ok&&(await response.json()).ok===true;
 } catch { return false; }
}

function writerLifecycle(base,config={},hostUrl) {
 const hostDir=hostUrl?path.dirname(fileURLToPath(hostUrl)):__dirname;
 const metadata=path.join(hostDir,'writer-location.json');
 const repo=path.resolve(config.repoRoot||(fs.existsSync(metadata)?JSON.parse(fs.readFileSync(metadata,'utf8')).repoRoot:path.join(hostDir,'../..')));
 const server=[path.join(hostDir,'../server.cjs'),path.join(hostDir,'../src/server.cjs')].find(file=>fs.existsSync(file));
 const runtime=path.join(path.dirname(server||hostDir),'..','runtime');
 const bundledNode=path.join(runtime,'node.exe');
 const standalone=fs.existsSync(bundledNode);
 const appData=path.join(process.env.LOCALAPPDATA||require('node:os').homedir(),'CUTDIRECTOR');
 const pointer=path.join(appData,'data-dir.txt');
 const data=standalone?(fs.existsSync(pointer)?fs.readFileSync(pointer,'utf8').trim():path.join(appData,'projects')):path.join(repo,'.m1-data');
 const log=path.join(repo,'.m3-data','writer-start.log');
 let pending;
 function record(message) {
  fs.mkdirSync(path.dirname(log),{recursive:true});
  fs.appendFileSync(log,new Date().toISOString()+' '+message+'\n');
 }
 async function start() {
  if(await healthy(base)) return;
  let release;
  try {
   const url=new URL(base);
   if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/') throw new Error('Auto-start requires a local HTTP adapter URL');
   if(!server) throw new Error('Packaged src/server.cjs is missing near '+hostDir);
   const {lock}=require(path.join(path.dirname(server),'core/util.cjs'));
   const deadline=Date.now()+10000;
   // Serialize Host instances through readiness, including stale writer recovery.
   while(!release) {
    if(await healthy(base)) return;
    try { release=lock(path.join(data,'.host-start'),{recoverStale:true}); }
    catch(error) {
     if(error.code!=='WRITER_LOCKED'||Date.now()>=deadline) throw error;
     await delay(100);
    }
   }
   if(await healthy(base)) return;
   const writerLock=path.join(data,'.writer.lock');
   if(fs.existsSync(writerLock)) {
    const owner=JSON.parse(fs.readFileSync(writerLock,'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0) throw new Error('Invalid writer lock PID');
    let alive=true;
    try { process.kill(owner.pid,0); } catch(error) { if(error.code==='ESRCH') alive=false; else throw error; }
    if(alive) {
     while(Date.now()<deadline) { if(await healthy(base)) return; await delay(100); }
     throw new Error('Live writer PID '+owner.pid+' holds the lock but adapter health is unavailable');
    }
    // The writer atomically claims recovery of this dead lock generation.
   }
   const env={...process.env,PORT:url.port||'80',VIDEO_DATA:data};
   for(const [key,exe] of [['FFMPEG','ffmpeg.exe'],['FFPROBE','ffprobe.exe']]) {
    const bundled=path.resolve(repo,'../tools/ffmpeg-4.4.1',exe);
    const shipped=path.join(runtime,'ffmpeg',exe);
    env[key]=config[key.toLowerCase()]||env[key]||(standalone?shipped:fs.existsSync(bundled)?bundled:key.toLowerCase());
   }
   record('Starting '+server+' on '+base);
   const fd=fs.openSync(log,'a');
   let child;
   try { child=spawn(standalone?bundledNode:process.execPath,[server],{cwd:repo,env,stdio:['ignore',fd,fd],detached:true,windowsHide:true}); }
   finally { fs.closeSync(fd); }
   let failure;
   child.on('error',error=>{failure=error;});
   child.on('exit',(code,signal)=>{failure=new Error('Writer exited with '+(signal||code));});
   child.unref();
   while(Date.now()<deadline) {
    if(await healthy(base)) { record('Writer ready PID '+child.pid); return; }
    if(failure) throw failure;
    await delay(100);
   }
   throw new Error('Timed out waiting for writer health at '+base);
  } catch(error) {
   const message='CUTDIRECTOR writer unavailable at '+base+': '+error.message;
   try { record(message); } catch { /* Preserve the startup error if logging is unavailable. */ }
   throw Object.assign(new Error(message+'. See '+log),{code:'WRITER_UNAVAILABLE',status:503});
  } finally { release?.(); }
 }
 return {ensure() {
  if(!pending) pending=start().finally(()=>{pending=undefined;});
  return pending;
 }};
}
module.exports={writerLifecycle};
