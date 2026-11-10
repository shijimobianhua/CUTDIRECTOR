'use strict';
const {spawn}=require('node:child_process');
function issue(code){return Object.assign(new Error(code),{code});}
function openRpc(executable,args,{cwd,signal,onNotification=()=>{}}={}){
 const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 let buffer='',sequence=0,closed=false,total=0;const pending=new Map();let stderrBytes=0;
 const fail=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
 child.stdin.on('error',()=>fail(issue('CODEX_PROCESS_EXITED')));
 child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;if(stderrBytes>2*1024*1024)child.kill();});
 child.stdout.setEncoding('utf8');child.stdout.on('data',bytes=>{
  total+=Buffer.byteLength(bytes);buffer+=bytes;if(total>96*1024*1024||Buffer.byteLength(buffer)>40*1024*1024){fail(issue('CODEX_OUTPUT_LIMIT'));child.kill();return;}
  for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
   let message;try{message=JSON.parse(line);}catch{fail(issue('CODEX_PROTOCOL_INVALID'));child.kill();return;}
   if(message.method&&Object.hasOwn(message,'id')){
    child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'CUTDIRECTOR does not grant additional tools, permissions or user input'}})+'\n');continue;
   }
   if(Object.hasOwn(message,'id')){const request=pending.get(message.id);if(!request)continue;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Object.assign(issue('CODEX_RPC_REJECTED'),{rpcMethod:request.method,rpcMessage:String(message.error.message||'').slice(0,600)})):request.resolve(message.result);}
   else if(message.method){try{onNotification(message);}catch{fail(issue('CODEX_PROTOCOL_INVALID'));child.kill();}}
  }
 });
 child.once('error',()=>fail(issue('CODEX_PROCESS_UNAVAILABLE')));child.once('exit',()=>{closed=true;fail(issue('CODEX_PROCESS_EXITED'));});
 const abort=()=>{fail(issue('RUN_CANCELLED'));child.kill();};signal?.addEventListener('abort',abort,{once:true});
 async function close(){signal?.removeEventListener('abort',abort);if(closed)return;child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(()=>{child.kill();r();},1200))]);}
 function request(method,params={},timeout=15000){
 if(closed||signal?.aborted)return Promise.reject(issue('RUN_CANCELLED'));
 return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(issue('CODEX_RPC_TIMEOUT'));},timeout);pending.set(id,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(issue('CODEX_PROCESS_EXITED'));}});});
 }
 return {request,notify(method,params={}){child.stdin.write(JSON.stringify({method,params})+'\n');},close,child};
}
module.exports={openRpc,issue};
