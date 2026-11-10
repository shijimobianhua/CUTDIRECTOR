'use strict';
const {randomUUID}=require('node:crypto'),fsp=require('node:fs/promises'),{join}=require('node:path');
const {issue,text}=require('./studio-store.cjs'),standard=require('./tool-standard.cjs');
function createToolJobs(studio,store,connections,media,providers,root){
 const db=studio.db,active=new Map();let closed=false;
 db.exec("UPDATE studio_jobs SET state='unknown',error='HOST_INTERRUPTED' WHERE state IN ('submitting','running');UPDATE studio_jobs SET state='collect_failed' WHERE state='collecting'");
 const staging=join(root,'studio-tool-results');
 function outputHost(url){try{return new URL(url).hostname;}catch{return '无法识别的下载地址';}}
 function raw(projectId,id){store.project(projectId);const row=db.prepare('SELECT rowid AS cursor,* FROM studio_jobs WHERE project_id=? AND id=?').get(projectId,id);if(!row)issue('TASK_NOT_FOUND','找不到这次任务。',404);return {...row,snapshot:JSON.parse(row.snapshot),result:row.result?JSON.parse(row.result):null};}
 function view(job){const {connection:cnx,...snapshot}=job.snapshot;const result=job.result?{...job.result,artifacts:job.result.artifacts?.map(({url,base64,cache,...r})=>({...r,...(url?{downloadHost:outputHost(url)}:{})}))}:null;return {...job,snapshot:{...snapshot,connectionTitle:cnx.manifest.title,transport:cnx.manifest.transport,model:cnx.config.model||null},result,snapshotDigest:standard.digest(job.snapshot)};}
 function list(projectId,before=Number.MAX_SAFE_INTEGER){store.project(projectId);if(!Number.isSafeInteger(before)||before<1)issue('INVALID_INPUT');return db.prepare('SELECT id FROM studio_jobs WHERE project_id=? AND rowid<? ORDER BY rowid DESC LIMIT 100').all(projectId,before).map(r=>view(raw(projectId,r.id)));}
 function update(id,state,fields={}){
  const before=db.prepare('SELECT * FROM studio_jobs WHERE id=?').get(id);if(!before)return;
  db.prepare('UPDATE studio_jobs SET state=?,external_id=?,result=?,error=?,updated_at=? WHERE id=?').run(state,fields.externalId??before.external_id,fields.result===undefined?before.result:JSON.stringify(fields.result),fields.error||null,new Date().toISOString(),id);
  db.prepare('INSERT INTO events(type,subject_id,scope_id) VALUES (?,?,?)').run('studio-job.changed',id,before.project_id);
 }
 function prepare(projectId,input){
  store.project(projectId);if(!/^[-a-zA-Z0-9_]{1,100}$/.test(input.commandId||''))issue('INVALID_INPUT','请重新准备这次调用。');const c=connections.enabled(input.connectionId);
  if(!c.probe?.available)issue('TOOL_PROBE_REQUIRED','先检查这个服务，再准备制作。',409);
  if(!c.manifest.capabilities.includes(input.capability))issue('CAPABILITY_MISMATCH','这个服务没有所选能力。');
  standard.validateValue(input.input,c.manifest.inputSchema);
  if(['image-generation','video-generation','audio-generation'].includes(input.capability)&&(!text(input.input?.prompt,12000)||!input.input.prompt.trim()))issue('INVALID_INPUT','请填写制作要求。');
  const refs=input.references||[];if(!Array.isArray(refs)||refs.length>140||new Set(refs.map(r=>r.id)).size!==refs.length)issue('INVALID_INPUT');
  const references=refs.map(r=>{if(!['image','audio','video'].includes(r.kind))issue('INVALID_INPUT');const a=r.kind==='image'?store.image(projectId,r.id):store.asset(projectId,r.id);if(r.kind==='audio'&&a.kind!=='audio'||r.kind==='video'&&a.kind==='audio')issue('INVALID_INPUT');return {id:r.id,kind:r.kind,digest:a.digest,name:a.name,contentType:a.contentType,role:String(r.role||'参考').slice(0,120)};});
  for(const [kind,field]of [['image','images'],['audio','audio'],['video','video']])if(references.filter(r=>r.kind===kind).length>(c.manifest.limits[field]||0))issue('REFERENCE_LIMIT','参考素材数量超过这个服务的限制。');
  if(references.length&&!c.manifest.permissions.includes('media-upload'))issue('TOOL_PERMISSION','这个工具没有声明发送素材的权限。',403);
  if(input.input.seconds!=null&&(!Number.isInteger(input.input.seconds)||input.input.seconds<1||input.input.seconds>(c.manifest.limits.maxSeconds||15)))issue('TOOL_PARAMETERS_INVALID','视频时长超过这个服务支持范围。');
  if(input.input.ratio&&c.manifest.limits.ratios?.length&&!c.manifest.limits.ratios.includes(input.input.ratio))issue('TOOL_PARAMETERS_INVALID','这个服务不支持所选画幅。');
  const method=input.methodDigest?store.skills.forExecutor(input.methodDigest,input.capability==='image-generation'?'image':'video',c.manifest.transport,c.config.model||''):null;
  const target=input.documentId?studio.get(projectId,input.documentId):null;
  const {sealedKey,...connection}=c;
  const snapshot={connection,input:method?{...input.input,prompt:input.input.prompt+'\n本次已选择的制作方法：\n'+method.body}:input.input,method:method?{hash:method.hash,name:method.name,role:method.role,executor:method.executor}:null,capability:input.capability,references,target:target?{id:target.id,version:target.version}:null,episodeId:input.episodeId||target?.episodeId||null,methodDigest:input.methodDigest||null};
  if(snapshot.episodeId){const ep=studio.get(projectId,snapshot.episodeId);snapshot.episodeVersion=ep.version;}
  const old=db.prepare('SELECT * FROM studio_jobs WHERE command_id=?').get(input.commandId);
  if(old){if(old.project_id!==projectId||standard.digest(JSON.parse(old.snapshot))!==standard.digest(snapshot))issue('IDEMPOTENCY_CONFLICT','这次制作内容已变化。',409);return view(raw(projectId,old.id));}
  const id=randomUUID(),now=new Date().toISOString();
  db.prepare('INSERT INTO studio_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,input.commandId,c.id,c.version,JSON.stringify(snapshot),'awaiting_approval',null,null,null,now,now);return view(raw(projectId,id));
 }
 function guard(job){const c=connections.enabled(job.connection_id);if(c.version!==job.connection_version)issue('CONNECTION_CHANGED','连接设置已更新，请重新准备本次调用。',409);if(job.snapshot.target&&studio.get(job.project_id,job.snapshot.target.id).version!==job.snapshot.target.version)issue('DOCUMENT_CONFLICT','目标内容已更新，请重新准备。',409);if(job.snapshot.episodeId&&studio.get(job.project_id,job.snapshot.episodeId).version!==job.snapshot.episodeVersion)issue('DOCUMENT_CONFLICT','剧本已更新，请重新准备。',409);return c;}
 async function collect(job,signal){
  update(job.id,'collecting');const artifacts=job.result?.artifacts||[],collected=[];
  try{
   for(const [i,a]of artifacts.entries()){
    if(!['image','video','audio'].includes(a.kind)||!a.url&&!a.cache&&!a.base64)issue('TOOL_OUTPUT_INVALID','返回的素材格式不正确。');
    let bytes;
    if(a.cache){if(!/^[a-f0-9-]{36}-\d+$/.test(a.cache))issue('TOOL_OUTPUT_INVALID');bytes=await fsp.readFile(join(staging,a.cache));}
    else if(a.base64){if(a.base64.length>48*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64))issue('TOOL_OUTPUT_INVALID');bytes=Buffer.from(a.base64,'base64');}
    else {const current=connections.raw(job.connection_id),connection={...job.snapshot.connection,config:{...job.snapshot.connection.config,downloadHosts:current.config.downloadHosts||job.snapshot.connection.config.downloadHosts}};bytes=await providers.download(connection,a.url,signal);}
    const asset=await media.add(job.project_id,a.name||'生成素材',bytes,'studio-'+job.id+'-'+i,a.kind,{studioJobId:job.id,documentId:job.snapshot.target?.id||null,episodeId:job.snapshot.episodeId});collected.push({id:asset.id,kind:a.kind,name:asset.name});
   }
   update(job.id,'complete',{result:{data:job.result?.data||{},artifacts:collected}});return view(raw(job.project_id,job.id));
  }catch(e){update(job.id,'collect_failed',{error:e.code||'MEDIA_COLLECT_FAILED'});return view(raw(job.project_id,job.id));}
 }
 async function finish(job,result){
  if(!result||!['queued','running','complete','failed'].includes(result.state))issue('TOOL_OUTPUT_INVALID','工具返回状态无法识别。');
  if(result.state==='queued'){if(!text(result.externalId,240)||!result.externalId)issue('TOOL_OUTPUT_INVALID');update(job.id,'queued',{externalId:result.externalId});return view(raw(job.project_id,job.id));}
  if(result.state==='running'){update(job.id,'queued');return view(raw(job.project_id,job.id));}
  if(result.state==='failed'){update(job.id,'failed',{error:'PROVIDER_FAILED'});return view(raw(job.project_id,job.id));}
  standard.validateValue(result.data||{},job.snapshot.connection.manifest.outputSchema);
  const artifacts=result.artifacts||[];if(!Array.isArray(artifacts)||artifacts.length>20||artifacts.some(a=>!a||!['image','video','audio'].includes(a.kind)||a.url!=null&&typeof a.url!=='string'||a.base64!=null&&typeof a.base64!=='string'))issue('TOOL_OUTPUT_INVALID');
  await fsp.mkdir(staging,{recursive:true});
  const durable=[];
  for(const [i,a]of artifacts.entries()){if(a.base64){const cache=job.id+'-'+i;if(a.base64.length>48*1024*1024)issue('TOOL_OUTPUT_INVALID');await fsp.writeFile(join(staging,cache),Buffer.from(a.base64,'base64'));durable.push({kind:a.kind,cache,name:a.name});}else durable.push(a);}
  const current=raw(job.project_id,job.id);if(['cancelled','unknown'].includes(current.state)&&current.state!==job.state){update(job.id,'collect_failed',{result:{...result,artifacts:durable},error:'RESULT_AFTER_CANCEL'});return view(raw(job.project_id,job.id));}
  update(job.id,durable.length?'collecting':'complete',{result:{data:result.data||{},artifacts:durable}});
  return durable.length?collect(raw(job.project_id,job.id)):view(raw(job.project_id,job.id));
 }
 async function dispatch(job,action,external){if(active.has(job.id))return view(raw(job.project_id,job.id));const controller=new AbortController();active.set(job.id,controller);const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
  try{const c=action==='submit'?guard(job):connections.raw(job.connection_id),fixed={...job.snapshot.connection,config:job.snapshot.connection.config},key=await connections.key(c.id);
   const result=external?await external({connection:fixed,snapshot:{...job.snapshot,jobId:job.id},references:await media.references(job.project_id,job.snapshot.references),signal}):action==='submit'?await providers.submit(fixed,key,{...job.snapshot,jobId:job.id},await media.references(job.project_id,job.snapshot.references),signal):await providers.poll(fixed,key,job.external_id,signal);
   return await finish(job,result);
  }catch(e){const current=raw(job.project_id,job.id);if(!['cancelled','complete'].includes(current.state))update(job.id,job.external_id?'queued':'unknown',{error:e.code||'TOOL_SUBMIT_UNKNOWN'});return view(raw(job.project_id,job.id));}
  finally{active.delete(job.id);}
 }
 function approve(projectId,id,input,external){const job=raw(projectId,id);if(job.state!=='awaiting_approval')return view(job);guard(job);
  if(input.confirm!==true||input.snapshotDigest!==standard.digest(job.snapshot)||job.snapshot.connection.manifest.cost!=='free'&&input.allowCharge!==true||job.snapshot.references.length&&input.allowUpload!==true)issue('TOOL_APPROVAL_REQUIRED','请核对本次调用的素材和费用。',403);
  if(Date.now()-Date.parse(job.created_at)>900000)issue('APPROVAL_EXPIRED','确认已过期，请重新准备。',409);
  db.prepare("UPDATE studio_jobs SET state='submitting' WHERE id=? AND state='awaiting_approval'").run(id);
  dispatch({...job,state:'submitting'},'submit',external).catch(()=>{});return view(raw(projectId,id));
 }
 async function check(projectId,id){const job=raw(projectId,id);
  if(job.state==='collect_failed')return collect(job);
  if(!job.external_id||!['queued','unknown'].includes(job.state))return view(job);
  if(connections.raw(job.connection_id).version!==job.connection_version)issue('CONNECTION_CHANGED','连接已更换，请恢复原连接设置后取回；不会重新生成。',409);
  return dispatch(job,'poll');
 }
 async function cancel(projectId,id){const job=raw(projectId,id);if(['complete','failed','cancelled'].includes(job.state))return view(job);
  active.get(id)?.abort();update(id,job.state==='awaiting_approval'?'cancelled':'unknown',{error:job.state==='awaiting_approval'?null:'CANCEL_UNCONFIRMED'});
  if(job.external_id&&job.snapshot.connection.manifest.lifecycle.cancel){try{await providers.cancel(job.snapshot.connection,await connections.key(job.connection_id),job.external_id,AbortSignal.timeout(10000));}catch{}}
  return view(raw(projectId,id));
 }
 function reconcile(projectId,id,input){const job=raw(projectId,id);if(job.state!=='unknown'||!text(input.externalId,240)||!input.externalId||input.confirm!==true)issue('INVALID_INPUT');update(id,'queued',{externalId:input.externalId});return view(raw(projectId,id));}
 return {list,raw,view,prepare,approve,check,cancel,reconcile,finish,stop(){closed=true;for(const c of active.values())c.abort();}};
}
module.exports={createToolJobs};
