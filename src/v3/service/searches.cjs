'use strict';
const {randomUUID}=require('node:crypto'),{endpoint,publicIP}=require('./public-source.cjs'),{isIP}=require('node:net');
function issue(code,status=409){return Object.assign(new Error(code),{code,status});}
function sanitize(value){
 if(!value||!Array.isArray(value.sources))throw issue('SEARCH_RESULT_INVALID',422);
 const seen=new Set(),sources=[];
 for(const source of value.sources.slice(0,24)){
  if(typeof source.title!=='string'||typeof source.url!=='string')continue;
  let url;try{url=endpoint(source.url);}catch{continue;}
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host)&&!publicIP(host)||seen.has(url.href))continue;
  seen.add(url.href);
  sources.push({title:source.title.slice(0,240),url:url.href,snippet:typeof source.snippet==='string'?source.snippet.slice(0,1000):'',
   publishedAt:typeof source.publishedAt==='string'?source.publishedAt.slice(0,100):null});
  if(sources.length===8)break;
 }
 return {sources,truncated:value.truncated===true||value.sources.length>sources.length};
}
function createSearches(db,project,registry){
 db.prepare("UPDATE reference_searches SET state='unknown' WHERE state='dispatching'").run();
 function get(projectId,id){
  project(projectId);
  const row=db.prepare('SELECT * FROM reference_searches WHERE project_id=? AND id=?').get(projectId,id);
  if(!row)throw issue('SEARCH_NOT_FOUND',404);
  return {...row,provider:JSON.parse(row.payload).provider,result:row.result?JSON.parse(row.result):null};
 }
 function list(projectId){project(projectId);return db.prepare('SELECT id FROM reference_searches WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 30').all(projectId).map(row=>get(projectId,row.id));}
 function prepare(projectId,input){
  project(projectId);
  if(!input||Object.keys(input).some(key=>!['commandId','query','provider'].includes(key))||typeof input.provider?.id!=='string'||typeof input.provider?.generation!=='string'||input.provider.id.length>120||input.provider.generation.length!==32||typeof input.query!=='string'||!input.query.trim()||input.query.length>500||
   !/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId||''))throw issue('SEARCH_INVALID',422);
  const query=input.query.trim(),payload=JSON.stringify({projectId,query,provider:input.provider}),previous=db.prepare('SELECT * FROM reference_searches WHERE request_id=?').get(input.commandId);
  if(previous){if(previous.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT');return get(projectId,previous.id);}
  registry.requireEnabled('cutdirector-search');
  const id=randomUUID();
  db.prepare('INSERT INTO reference_searches VALUES (?,?,?,?,?,?,?,?,?)').run(id,projectId,input.commandId,payload,query,'awaiting_approval',null,null,new Date().toISOString());
  return get(projectId,id);
 }
 function claim(projectId,id,input){
  const job=get(projectId,id);
  if(job.state!=='awaiting_approval')return {dispatch:false,job};
  if(input?.confirmCharge!==true||input.confirmQuery!==true)throw issue('SEARCH_APPROVAL_REQUIRED',403);
  registry.requireEnabled('cutdirector-search');
  if(input.provider?.generation!==job.provider.generation)throw issue('SEARCH_PROVIDER_CHANGED');
  const result=db.prepare("UPDATE reference_searches SET state='dispatching' WHERE id=? AND state='awaiting_approval'").run(id);
  return {dispatch:!!result.changes,job:get(projectId,id)};
 }
 function finish(projectId,id,input){
  const job=get(projectId,id);
  if(job.state!=='dispatching')return job;
  if(input?.state==='ready'){
   const result=sanitize(input.result);
   db.prepare("UPDATE reference_searches SET state='ready',result=?,error=NULL WHERE id=? AND state='dispatching'").run(JSON.stringify(result),id);
  }else{
   const code=['WEB_PROVIDER_CREDENTIAL_MISSING','WEB_PROVIDER_UNAVAILABLE','WEB_PROVIDER_AMBIGUOUS','WEB_ABORTED'].includes(input?.error)?input.error:'SEARCH_RESULT_UNKNOWN';
   db.prepare("UPDATE reference_searches SET state='unknown',error=? WHERE id=? AND state='dispatching'").run(code,id);
  }
  return get(projectId,id);
 }
 return {get,list,prepare,claim,finish};
}
module.exports={createSearches,sanitize};
