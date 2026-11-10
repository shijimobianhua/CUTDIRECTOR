'use strict';
const {createConnections}=require('./tool-connections.cjs'),{createProviders}=require('./media-providers.cjs'),{createStudioMedia}=require('./studio-media.cjs'),{createToolJobs}=require('./tool-jobs.cjs'),{createSources}=require('./studio-sources.cjs');
const {issue}=require('./studio-store.cjs'),{join}=require('node:path'),fsp=require('node:fs/promises');
function createStudioRoutes(store,root,readJson,readBytes,send){
 const studio=store.studio,connections=createConnections(studio),providers=createProviders(),media=createStudioMedia(studio,store,root),jobs=createToolJobs(studio,store,connections,media,providers,root),sources=createSources(studio,root);
 const artifact=require('./artifact-workspace.cjs').createArtifactWorkspace(root,store);
 async function externalInputs(projectId,id){const job=jobs.raw(projectId,id);return artifact.prepare({id:job.id,snapshot:job.snapshot});}
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/studio/'))return false;
  const path=url.pathname.slice('/studio'.length),get=req.method==='GET',input=get?null:await (path.endsWith('/import')||path.endsWith('/audio')?readBytes(req,path.endsWith('/import')?12*1024*1024:64*1024*1024):readJson(req,40*1024*1024));
  let result;
  if(path==='/index'&&get)result=studio.index();
  else if(path==='/presets'&&get)result=connections.presets;
  else if(path==='/standard'&&get)result=require('./tool-standard.cjs').manifestSchema;
  else if(path==='/connections'&&get)result=connections.list();
  else if(path==='/connections'&&!get)result=await connections.save(input);
  else if(/^\/connections\/[^/]+(?:\/(?:probe|export|remove|models))?$/.test(path)){
   const [,_,id,action]=path.split('/');
   if(action==='export'&&get)result=connections.exported(id);
   else if(action==='remove'&&!get)result=connections.remove(id,input);
   else if(action==='probe'&&!get){
    const c=connections.raw(id);if(['codex','dsh'].includes(c.manifest.transport)){if(!input.hostResult)issue('TOOL_HOST_REQUIRED');result=connections.probe(id,input.hostResult);}
    else{try{const probe=await providers.probe(c,await connections.key(id),AbortSignal.timeout(30000));if(probe.workflow){const old=connections.raw(id),value=JSON.parse(studio.db.prepare('SELECT value FROM studio_settings WHERE id=?').get('tool:'+id).value);value.config.workflow=probe.workflow;value.config.mappings=value.config.mappings?.length?value.config.mappings:probe.mappings;studio.db.prepare('UPDATE studio_settings SET value=? WHERE id=? AND version=?').run(JSON.stringify(value),'tool:'+id,old.version);}result=connections.probe(id,probe);}catch(e){result=connections.probe(id,{available:false,message:e.message});}}
   }else if(get)result=connections.list().find(c=>c.id===id);
  }
  else if(path==='/assistant/chats'&&get)result=store.assistant.list(url.searchParams.get('q')||'',url.searchParams.get('scope')||'general',url.searchParams.get('scopeId'));
  else if(path==='/assistant/chats'&&!get)result=store.assistant.save(input);
  else if(/^\/assistant\/chats\/[a-f0-9-]{36}(?:\/turns(?:\/[a-f0-9-]{36}\/(?:finish|convert|apply|cancel))?)?$/.test(path)){
   const [,_,__,id,turns,turnId,action]=path.split('/');
   if(get)result=turns?store.assistant.turns(id,url.searchParams.get('before')):store.assistant.chat(id);
   else if(!turns)result=store.assistant.save({...input,id});
   else if(!turnId)result=store.assistant.prepare(id,input);
   else if(action==='finish')result=store.assistant.finish(id,turnId,input);
   else if(action==='cancel')result=store.assistant.finish(id,turnId,{state:'cancelled',answer:'已停止。已保存的输入仍在。'});
   else result=store.assistant[action](id,turnId,input);
  }
  else if(/^\/projects\/[a-f0-9-]{36}(?:\/.*)?$/.test(path)){
   const [,_,projectId,collection,id,action,number]=path.split('/');
   store.project(projectId);
   if(!collection&&get)result=studio.overview(projectId);
   else if(collection==='documents'&&!id){result=get?studio.list(projectId,url.searchParams.get('kind'),url.searchParams.get('archived')==='1'):studio.save(projectId,input);}
   else if(collection==='documents'&&id==='batch'&&!get)result=studio.batch(projectId,input);
   else if(collection==='documents'&&id){
    if(action==='original'&&get){const original=await sources.original(projectId,id);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(original.name),'Cache-Control':'no-store'});res.end(original.bytes);return true;}
    else if(get)result=action==='versions'?number?studio.revision(projectId,id,Number(number)):studio.history(projectId,id):studio.get(projectId,id);
    else if(action==='restore')result=studio.restore(projectId,id,input);
    else if(action==='archive')result=studio.archive(projectId,id,input);
    else if(action==='publish')result=studio.publish(projectId,id,input);
    else if(action==='original'){const original=await sources.original(projectId,id);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(original.name),'Cache-Control':'no-store'});res.end(original.bytes);return true;}
    else result=studio.save(projectId,{...input,id});
   }
   else if(collection==='import'&&!get)result=await sources.preview(url.searchParams.get('name')||'',input);
   else if(collection==='audio'&&!get)result=await media.add(projectId,url.searchParams.get('name'),input,url.searchParams.get('commandId'),'audio',{source:'user-upload'});
   else if(collection==='context'&&get)result=studio.context(projectId,url.searchParams.get('episodeId'));
   else if(collection==='jobs'){
    if(!id)result=get?jobs.list(projectId,Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER):jobs.prepare(projectId,input);
    else if(get)result=jobs.view(jobs.raw(projectId,id));
    else if(action==='approve')result=jobs.approve(projectId,id,input);
    else if(action==='check')result=await jobs.check(projectId,id);
    else if(action==='cancel')result=await jobs.cancel(projectId,id);
    else if(action==='reconcile')result=jobs.reconcile(projectId,id,input);
    else if(action==='claim'){
     const job=jobs.raw(projectId,id),transport=job.snapshot.connection.manifest.transport;
     if(!['codex','dsh'].includes(transport))issue('TOOL_PARAMETERS_INVALID');
     const c=connections.enabled(job.connection_id);if(c.version!==job.connection_version)issue('CONNECTION_CHANGED','连接已改变。',409);
     if(job.state!=='awaiting_approval')result={dispatch:false,job:jobs.view(job)};
     else{
      if(input.confirm!==true||input.snapshotDigest!==studio.digest(job.snapshot)||job.snapshot.connection.manifest.cost!=='free'&&input.allowCharge!==true||job.snapshot.references.length&&input.allowUpload!==true)issue('TOOL_APPROVAL_REQUIRED','请确认本次素材与费用。',403);
      if(Date.now()-Date.parse(job.created_at)>900000)issue('APPROVAL_EXPIRED','请重新准备。',409);
      if(job.snapshot.target&&studio.get(projectId,job.snapshot.target.id).version!==job.snapshot.target.version)issue('DOCUMENT_CONFLICT','目标已更新。',409);
      if(job.snapshot.episodeId&&studio.get(projectId,job.snapshot.episodeId).version!==job.snapshot.episodeVersion)issue('DOCUMENT_CONFLICT','剧本已更新。',409);
      const claimed=studio.db.prepare("UPDATE studio_jobs SET state='submitting' WHERE id=? AND state='awaiting_approval'").run(id).changes;
      result={dispatch:!!claimed,job:jobs.raw(projectId,id),workspace:claimed?await externalInputs(projectId,id):null};
     }
    }
    else if(action==='external-finish'){
     const job=jobs.raw(projectId,id);if(!['submitting','unknown'].includes(job.state))result=jobs.view(job);
     else if(input.error){studio.db.prepare("UPDATE studio_jobs SET state='unknown',error=? WHERE id=?").run(String(input.error).slice(0,100),id);result=jobs.view(jobs.raw(projectId,id));}
     else{
      const work=artifact.directories(id),artifacts=[];
      for(const a of input.result?.artifacts||[]){if(!require('./artifact-workspace.cjs').safeLeaf(a.file)||!['image','video','audio'].includes(a.kind))issue('TOOL_OUTPUT_INVALID');const target=join(work.outputDir,a.file),info=await fsp.lstat(target);if((await fsp.realpath(work.outputDir)).toLowerCase()!==work.outputDir.toLowerCase()||(await fsp.realpath(target)).toLowerCase()!==target.toLowerCase())issue('TOOL_OUTPUT_INVALID');if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)issue('TOOL_OUTPUT_INVALID');const bytes=await fsp.readFile(target);artifacts.push({kind:a.kind,base64:bytes.toString('base64')});}
      result=await jobs.finish(job,{state:'complete',data:{text:String(input.result?.text||'工具已完成。').slice(0,16000)},artifacts});
     }
    }
   }
  }
  if(result===undefined)issue('NOT_FOUND','没有找到这个操作。',404);
  send(res,200,{data:result});return true;
 }
 return {handle,stop:()=>jobs.stop()};
}
module.exports={createStudioRoutes};
