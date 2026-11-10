'use strict';
const {randomUUID}=require('node:crypto');
const {protect}=require('#cutdirector-credentials');
const {issue}=require('./studio-store.cjs');
const standard=require('./tool-standard.cjs');
const {safeArgs}=require('./mcp-client.cjs');
const {isAbsolute}=require('node:path');
function validateUrl(value,local=false){
 let url;try{url=new URL(value);}catch{issue('CONNECTION_INVALID','请填写完整的服务地址。');}
 const host=url.hostname.toLowerCase(),loop=['localhost','127.0.0.1','[::1]'].includes(host);
 if(url.username||url.password||url.hash||url.search||url.protocol!=='https:'&&!(url.protocol==='http:'&&(loop||local))||host==='169.254.169.254'||host==='metadata.google.internal')issue('CONNECTION_INVALID','远程服务使用 HTTPS；本机服务可使用 HTTP。');
 return url;
}
function createConnections(studio,{vault=protect}={}){
 const db=studio.db;
 function raw(id){const r=db.prepare('SELECT * FROM studio_settings WHERE id=?').get('tool:'+id);if(!r)issue('CONNECTION_NOT_FOUND','请先添加这个服务。',404);return {id,version:r.version,...JSON.parse(r.value)};}
 function publicView(v){const {sealedKey,...value}=v;return {...value,keyConfigured:!!sealedKey};}
 function list(){return db.prepare("SELECT id FROM studio_settings WHERE id LIKE 'tool:%' ORDER BY rowid DESC").all().map(r=>publicView(raw(r.id.slice(5))));}
 async function save(input){
  const id=input.id||randomUUID(),old=input.id?raw(input.id):null;if((old?.version||0)!==input.expectedVersion)issue('CONNECTION_CONFLICT','连接设置已更新，请重新读取。',409);
  const m=standard.validateManifest(input.manifest);
  if(input.confirm!==true)issue('TOOL_APPROVAL_REQUIRED','请确认工具来源与权限。',403);
  const config=input.config||{};
  if(JSON.stringify(config).length>500000)issue('CONNECTION_INVALID');
  if(['mcp-stdio','dsh'].includes(m.transport)){if(m.transport==='mcp-stdio'&&(!isAbsolute(config.command||'')||!safeArgs(config.args||[])))issue('CONNECTION_INVALID','请选择程序的完整路径，并将参数填写为列表。');}
  else if(m.transport!=='codex')validateUrl(config.baseUrl,config.allowLocal===true);
  if(m.transport==='mcp-stdio'&&(config.args||[]).some(v=>/api[-_]?key|access[-_]?token|password|secret|(?:sk|rk)-[a-z0-9_-]{12,}/i.test(v)))issue('CONNECTION_INVALID','不要把密钥放进启动参数，请使用单独密钥栏和环境变量。');
  if(['mcp-stdio','dsh','http','mcp-http'].includes(m.transport)&&config.trusted!==true)issue('TOOL_TRUST_REQUIRED','请先确认你信任这个工具。',403);
  const forbidden=(v)=>v&&typeof v==='object'&&Object.entries(v).some(([k,x])=>/^(?:api[_-]?key|authorization|password|secret|access[_-]?token)$/i.test(k)&&!!x||forbidden(x));
  if(forbidden(config))issue('CONNECTION_INVALID','密钥请填写在单独的密钥栏，不要放进参数模板。');
  const sealedKey=input.clearKey===true?null:typeof input.apiKey==='string'&&input.apiKey?await vault('seal',input.apiKey):old?.sealedKey||null;
  const value={manifest:m,config:structuredClone(config),sealedKey,enabled:input.enabled!==false,probe:null};
  return studio.command({commandId:input.commandId},{type:'connection',id,expectedVersion:input.expectedVersion,manifest:m,config,enabled:value.enabled,keyChanged:typeof input.apiKey==='string'&&!!input.apiKey,clearKey:!!input.clearKey},()=>{
   const now=db.prepare('SELECT version FROM studio_settings WHERE id=?').get('tool:'+id);if((now?.version||0)!==input.expectedVersion)issue('CONNECTION_CONFLICT','设置已更新。',409);
   db.prepare('INSERT INTO studio_settings VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,value=excluded.value').run('tool:'+id,input.expectedVersion+1,JSON.stringify(value));return publicView(raw(id));
  });
 }
 function remove(id,input){const c=raw(id);if(c.version!==input.expectedVersion||input.confirm!==true)issue('CONNECTION_CONFLICT','请重新读取并确认移除。',409);
  if(db.prepare("SELECT 1 FROM studio_jobs WHERE connection_id=? AND state IN ('submitting','queued','running','collecting','unknown')").get(id))issue('TOOL_BUSY','这个服务仍有未结束的任务，先核对任务结果。',409);
  db.prepare('DELETE FROM studio_settings WHERE id=?').run('tool:'+id);return {removed:true};}
 function probe(id,result){const c=raw(id);const {id:_id,version,...value}=c;value.probe={available:!!result.available,level:result.level||'detected',message:String(result.message||'').slice(0,600),models:(result.models||[]).slice(0,100),tools:(result.tools||[]).slice(0,100),diagnostics:(result.attempts||[]).map(a=>({backend:a.backend,stage:a.stage,code:a.code,detail:String(a.detail||'').slice(0,600)})),checkedAt:new Date().toISOString()};db.prepare('UPDATE studio_settings SET value=? WHERE id=? AND version=?').run(JSON.stringify(value),'tool:'+id,version);return publicView(raw(id));}
 function exported(id){const c=publicView(raw(id));return {schemaVersion:2,manifest:c.manifest,config:c.config,credentialsRequired:c.keyConfigured};}
 async function key(id){const c=raw(id);return c.sealedKey?await vault('open',c.sealedKey):'';}
 function enabled(id){const c=raw(id);if(!c.enabled)issue('CAPABILITY_DISABLED','这个服务已停用。',409);return c;}
 return {raw,list,save,remove,probe,exported,key,enabled,presets:standard.presets,validateUrl};
}
module.exports={createConnections,validateUrl};
