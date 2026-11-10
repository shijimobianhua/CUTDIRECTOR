'use strict';
const {spawn}=require('node:child_process');
const {isAbsolute}=require('node:path');
const {issue}=require('./studio-store.cjs');
function safeArgs(args){return Array.isArray(args)&&args.length<=60&&args.every(x=>typeof x==='string'&&x.length<4000&&!x.includes('\0'));}
async function createMcp(connection,key,{signal,fetcher=fetch}={}){
 let seq=0,sessionId,child,buffer='',closed=false;const pending=new Map();
 const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(key?{[connection.authHeader||'Authorization']:(connection.authPrefix===undefined?'Bearer ':connection.authPrefix)+key}:{})};
 function deliver(msg){if(msg.id!=null){const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Object.assign(new Error('MCP 调用未完成'),{code:'MCP_ERROR',status:502})):p.resolve(msg.result);}}}
 if(connection.transport==='mcp-stdio'){
  if(!connection.trusted||!isAbsolute(connection.command||'')||!safeArgs(connection.args||[]))issue('TOOL_TRUST_REQUIRED','启动本地工具前，需要确认程序位置和来源。',403);
  const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE};
  if(key){if(!/^[A-Z][A-Z0-9_]{1,60}$/.test(connection.secretEnvName||'')||['PATH','HOME','USERPROFILE','TEMP','TMP','SYSTEMROOT'].includes(connection.secretEnvName))issue('CONNECTION_INVALID','请指定工具读取密钥的环境变量名称。');env[connection.secretEnvName]=key;}
  child=spawn(connection.command,connection.args||[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024){child.kill();return;}for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{deliver(JSON.parse(line));}catch{}}});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>{for(const p of pending.values())p.reject(Object.assign(new Error('无法启动本地工具'),{code:'MCP_UNAVAILABLE',status:503}));});child.once('exit',()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Object.assign(new Error('本地工具已退出'),{code:'MCP_UNAVAILABLE',status:503}));}pending.clear();});
 }
 async function request(method,params,notify=false){
  const id=++seq,message={jsonrpc:'2.0',method,params,...(!notify?{id}:{})};
  if(child){
   if(closed)issue('MCP_UNAVAILABLE','本地工具已退出。',503);
   if(notify){child.stdin.write(JSON.stringify(message)+'\n');return;}
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('工具响应超时'),{code:'TOOL_TIMEOUT',status:504}));},60000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify(message)+'\n');});
  }
  const response=await fetcher(connection.baseUrl,{method:'POST',headers:{...headers,...(sessionId?{'Mcp-Session-Id':sessionId}:{})},body:JSON.stringify(message),redirect:'error',signal});
  if(!response.ok){await response.body?.cancel();issue('MCP_UNAVAILABLE','MCP 服务拒绝了连接，请检查地址和凭据。',response.status===401?401:502);}
  sessionId=response.headers.get('mcp-session-id')||sessionId;if(notify){await response.body?.cancel();return;}
  const chunks=[];let total=0;
  for await(const bytes of response.body){total+=bytes.length;if(total>4*1024*1024)issue('TOOL_RESPONSE_INVALID');chunks.push(bytes);
   const body=Buffer.concat(chunks).toString('utf8');
   if(response.headers.get('content-type')?.includes('event-stream')){
    for(const match of body.matchAll(/^data: ?(.+)$/gm)){let event;try{event=JSON.parse(match[1]);}catch{continue;}if(event.id===id){await response.body.cancel?.().catch(()=>{});if(event.error)issue('MCP_ERROR','工具返回了错误，请查看工具端记录。',502);return event.result;}}
   }
  }
  try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(result.error)issue('MCP_ERROR','工具返回了错误。',502);return result.result;}catch(e){if(e.status)throw e;issue('TOOL_RESPONSE_INVALID','MCP 返回格式无法读取。');}
 }
 const abort=()=>child?.kill();signal?.addEventListener('abort',abort,{once:true});
 const close=async()=>{signal?.removeEventListener('abort',abort);if(child){child.stdin.end();setTimeout(()=>{if(!closed)child.kill();},500).unref();}else if(sessionId)await fetcher(connection.baseUrl,{method:'DELETE',headers:{...headers,'Mcp-Session-Id':sessionId},redirect:'error',signal:AbortSignal.timeout(3000)}).then(r=>r.body?.cancel()).catch(()=>{});};
 try{
  const init=await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'cutdirector',version:'0.3.0'}});
  headers['MCP-Protocol-Version']=init.protocolVersion||'2025-11-25';
  await request('notifications/initialized',{},true);
  return {initialize:init,list:async()=>{const tools=[];let cursor;do{const page=await request('tools/list',cursor?{cursor}:{});tools.push(...(page.tools||[]));cursor=page.nextCursor;if(tools.length>300)issue('TOOL_RESPONSE_INVALID');}while(cursor);return tools;},call:(name,args)=>request('tools/call',{name,arguments:args}),close};
 }catch(e){await close();throw e;}
}
module.exports={createMcp,safeArgs};
