'use strict';
const {randomUUID}=require('node:crypto');
function issue(code,status=409){return Object.assign(new Error(code),{code,status});}
function createBatches(db,project,story,images,videos,registry){
 db.prepare("UPDATE generation_batches SET state='interrupted' WHERE state='dispatching'").run();
 function get(projectId,id){
  project(projectId);
  const row=db.prepare('SELECT * FROM generation_batches WHERE project_id=? AND id=?').get(projectId,id);
  if(!row)throw issue('BATCH_NOT_FOUND',404);
  const spec=JSON.parse(row.spec);
  const jobs=spec.jobs.map(jobId=>(row.kind==='image'?images:videos).get(projectId,jobId));
  return {id:row.id,projectId,kind:row.kind,state:row.state,storyVersion:row.story_version,createdAt:row.created_at,
    expiresAt:row.expires_at,maxJobs:spec.jobs.length,maxSeconds:spec.maxSeconds,jobs:jobs.map(job=>({
      id:job.id,shotId:job.shot_id,frame:job.frame||null,state:job.state,prompt:job.spec.prompt,
      seconds:job.spec.seconds||0,uploadNames:row.kind==='image'?(job.spec.reference?[job.spec.reference.name]:[]):job.spec.frames.map(frame=>frame.name)}))};
 }
 function list(projectId){project(projectId);return db.prepare('SELECT id FROM generation_batches WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(projectId).map(row=>get(projectId,row.id));}
 function prepare(projectId,input){
  project(projectId);
  if(!input||Object.keys(input).some(key=>!['commandId','storyVersion','kind','shots','frame','seconds'].includes(key))||
   !['image','video'].includes(input.kind)||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId||'')||
   !Array.isArray(input.shots)||input.shots.length<1||input.shots.length>10||new Set(input.shots).size!==input.shots.length)throw issue('BATCH_INVALID',422);
  const payload=JSON.stringify({projectId,...input}),previous=db.prepare('SELECT * FROM generation_batches WHERE request_id=?').get(input.commandId);
  if(previous){if(previous.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT');return get(projectId,previous.id);}
  registry.requireEnabled(input.kind==='image'?'cutdirector-seedream':'cutdirector-seedance');
  if(story(projectId)?.version!==input.storyVersion)throw issue('STORY_CONFLICT');
  if(input.kind==='video'&&(!Number.isInteger(input.seconds)||input.seconds<4||input.seconds>30))throw issue('BATCH_INVALID',422);
  const id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try{
   const repo=input.kind==='image'?images:videos;
   const jobs=input.shots.map((shotId,index)=>repo.prepare(projectId,{commandId:'batch_'+id+'_'+index,storyVersion:input.storyVersion,shotId,
    ...input.kind==='image'?{frame:input.frame}:{seconds:input.seconds,audio:false}}).id);
   const spec={jobs,maxSeconds:input.kind==='video'?input.seconds*jobs.length:0};
   db.prepare('INSERT INTO generation_batches VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,input.commandId,payload,input.storyVersion,input.kind,'awaiting_approval',JSON.stringify(spec),null,Date.now()+15*60000,new Date().toISOString());
   db.exec('COMMIT');return get(projectId,id);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function assertAdmission(projectId,id){
  const value=get(projectId,id);
  if(value.state!=='dispatching')throw issue('BATCH_STOPPED');
  if(value.expiresAt<Date.now())throw issue('BATCH_EXPIRED');
  if(story(projectId)?.version!==value.storyVersion)throw issue('STORY_CONFLICT');
  registry.requireEnabled(value.kind==='image'?'cutdirector-seedream':'cutdirector-seedance');
  return value;
 }
 function approve(projectId,id,input){
  const value=get(projectId,id);
  if(['dispatching','submitted','cancelled'].includes(value.state))return value;
  if(input?.confirmCharge!==true||input.acceptUnknownPrice!==true||input.maxJobs!==value.maxJobs||input.maxSeconds!==value.maxSeconds||
    value.jobs.some(job=>job.uploadNames.length)&&input.confirmUpload!==true)throw issue('BATCH_APPROVAL_REQUIRED',403);
  if(value.expiresAt<Date.now())throw issue('BATCH_EXPIRED');
  if(story(projectId)?.version!==value.storyVersion)throw issue('STORY_CONFLICT');
  registry.requireEnabled(value.kind==='image'?'cutdirector-seedream':'cutdirector-seedance');
  db.prepare("UPDATE generation_batches SET state='dispatching',approved_at=? WHERE id=? AND state IN ('awaiting_approval','interrupted','paused')").run(new Date().toISOString(),id);
  return get(projectId,id);
 }
 function finish(projectId,id,state='submitted'){
  get(projectId,id);
  if(!['submitted','paused'].includes(state))throw issue('BATCH_INVALID',422);
  db.prepare("UPDATE generation_batches SET state=? WHERE id=? AND state='dispatching'").run(state,id);
  return get(projectId,id);
 }
 function cancel(projectId,id){
  const value=get(projectId,id);
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("UPDATE generation_batches SET state='cancelled' WHERE id=?").run(id);
   const table=value.kind==='image'?'image_jobs':'generation_jobs';
   for(const job of value.jobs)db.prepare("UPDATE "+table+" SET state='cancelled' WHERE id=? AND state='awaiting_approval'").run(job.id);
   db.exec('COMMIT');return get(projectId,id);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {get,list,prepare,approve,assertAdmission,finish,cancel};
}
function createBatchRunner(batches,imageGeneration,generation){
 const active=new Map();let closed=false;
 function start(projectId,id,approval){
  const current=batches.approve(projectId,id,approval);
  if(current.state!=='dispatching'||active.has(id))return current;
  let index=0,blocked=false;
  const tasks=current.jobs.filter(job=>job.state==='awaiting_approval');
  const run=async()=>{
   while(!closed&&!blocked&&index<tasks.length){
    const job=tasks[index++];
    try{
     batches.assertAdmission(projectId,id);
     const result=await (current.kind==='image'?imageGeneration:generation).approve(projectId,job.id,
       {confirmCharge:true,confirmUpload:approval.confirmUpload},()=>{if(closed||blocked)throw issue('BATCH_STOPPED');batches.assertAdmission(projectId,id);});
     if(['unknown','failed'].includes(result.state)){blocked=true;break;}
    }catch{blocked=true;break;}
   }
  };
  const task=Promise.allSettled([run(),run()]).then(()=>batches.finish(projectId,id,blocked||closed?'paused':'submitted')).finally(()=>active.delete(id));
  active.set(id,task);task.catch(()=>{});
  return current;
 }
 return {start,stop(){closed=true;}};
}
module.exports={createBatches,createBatchRunner};
