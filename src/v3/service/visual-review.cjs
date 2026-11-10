'use strict';
const {randomUUID,createHash}=require('node:crypto'),{readFile,writeFile}=require('node:fs/promises'),{join}=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function createVisualReviews(db,store,root,analyzer){
 const referenceAnalyzer=require('./reference-analyzer.cjs').createReferenceAnalyzer(root,{file:(p,id)=>store.references.file(p,id),record:(_p,_id,result)=>result});
 const active=new Map(),controller=new AbortController();let closed=false;
 db.prepare("UPDATE visual_reviews SET state='unknown' WHERE state='running'").run();db.prepare("UPDATE visual_reviews SET state='interrupted' WHERE state='preparing'").run();
 function job(projectId,id){store.project(projectId);const row=db.prepare('SELECT * FROM visual_reviews WHERE project_id=? AND id=?').get(projectId,id);if(!row)fail('TASK_NOT_FOUND',404);return {...row,snapshot:JSON.parse(row.snapshot),result:row.result?JSON.parse(row.result):null};}
 function list(projectId){store.project(projectId);return db.prepare('SELECT id FROM visual_reviews WHERE project_id=? ORDER BY rowid DESC LIMIT 100').all(projectId).map(row=>job(projectId,row.id));}
 async function prepare(projectId,input){
 store.project(projectId);store.registry.requireEnabled('cutdirector-visual-qa');if(closed)fail('RUN_CANCELLED');
 if(!['image','video'].includes(input.kind)||typeof input.commandId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.commandId)||
 typeof input.model?.provider!=='string'||input.model.provider.length>120||typeof input.model?.id!=='string'||input.model.id.length>180)fail('INVALID_INPUT',400);
 const target=input.reference===true?store.references.file(projectId,input.targetId):(input.kind==='image'?store.image:store.asset)(projectId,input.targetId),story=store.story(projectId);
 if(input.reference===true&&target.kind!==input.kind)fail('INVALID_INPUT',400);
 const payload=JSON.stringify({projectId,...input}),old=db.prepare('SELECT id,payload FROM visual_reviews WHERE command_id=?').get(input.commandId);
 if(old){if(old.payload!==payload)fail('IDEMPOTENCY_CONFLICT');return active.get(old.id)||job(projectId,old.id);}
 const id=randomUUID(),snapshot={kind:input.kind,reference:input.reference===true,targetId:target.id,sourceDigest:target.digest,storyVersion:story?.version||0,model:input.model,
 request:input.reference===true?'分析这次实际提供的参考画面：构图、色彩、人物和场景安排、可借鉴的镜头结构。视频只有抽帧，不能据此判断完整配乐或动作节奏。给出可用于当前主题的做法，标明对应画面编号和不确定性。不复制未批准的素材，不修改工程。':'检查人物、物体、画面文字和明显的不连续。逐条说明观察到的问题及对应画面编号；无法确认的内容明确说明。只给建议，不修改工程。',...(input.includeStory===true?{brief:story?.brief||'',style:story?.style||'',shots:(story?.shots||[]).filter(s=>s.assetId===target.id||s.startImageId===target.id||s.endImageId===target.id).slice(0,8)}:{})};
 db.prepare('INSERT INTO visual_reviews VALUES (?,?,?,?,?,?,?,?)').run(id,projectId,input.commandId,payload,JSON.stringify(snapshot),'preparing',null,new Date().toISOString());
 const task=(async()=>{
  try{
   let frames;
   if(input.kind==='video')frames=(await (input.reference===true?referenceAnalyzer:analyzer).analyze(projectId,target.id,{confirm:true})).frames;
   else{
    const bytes=await readFile(join(root,'media',target.digest));if(createHash('sha256').update(bytes).digest('hex')!==target.digest)fail('ASSET_CHANGED');
    const image=await run(process.env.FFMPEG||'ffmpeg',['-v','error','-nostdin','-protocol_whitelist','file','-i',join(root,'media',target.digest),'-frames:v','1','-vf','scale=min(640\\,iw):-2','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{signal:controller.signal,timeout:30000,windowsHide:true,maxBuffer:2*1024*1024,encoding:'buffer'});
    if(image.stdout.length<4||image.stdout[0]!==255||image.stdout[1]!==216)fail('VISUAL_IMAGE_INVALID');
    const digest=createHash('sha256').update(image.stdout).digest('hex');await writeFile(join(root,'media',digest),image.stdout,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    frames=[{number:1,timeUs:0,digest,size:image.stdout.length,contentType:'image/jpeg'}];
   }
   if(closed)fail('RUN_CANCELLED');
   db.prepare("UPDATE visual_reviews SET snapshot=?,state='awaiting_approval' WHERE id=?").run(JSON.stringify({...snapshot,frames}),id);
  }catch{if(!closed)db.prepare("UPDATE visual_reviews SET state='failed' WHERE id=?").run(id);}
  return job(projectId,id);
 })();active.set(id,task);try{return await task;}finally{active.delete(id);}
 }
 function claim(projectId,id,input){
 const current=job(projectId,id);if(current.state!=='awaiting_approval')return {...current,dispatch:false};
 store.registry.requireEnabled('cutdirector-visual-qa');
 if(input.confirm!==true||input.allowUpload!==true||input.allowUnknownCost!==true)fail('VISUAL_APPROVAL_REQUIRED',403);
 if((store.story(projectId)?.version||0)!==current.snapshot.storyVersion)fail('QUALITY_STALE');
 db.prepare("UPDATE visual_reviews SET state='running' WHERE id=?").run(id);return {...job(projectId,id),dispatch:true};
 }
 function guard(projectId,id){const current=job(projectId,id);store.registry.requireEnabled('cutdirector-visual-qa');if(current.state!=='running')fail('VISUAL_NOT_RUNNING');if((store.story(projectId)?.version||0)!==current.snapshot.storyVersion)fail('QUALITY_STALE');return {allowed:true};}
 async function inputs(projectId,id){
 const current=job(projectId,id);if(current.state!=='running')fail('VISUAL_NOT_RUNNING');
 const frames=[];let total=0;
 for(const frame of current.snapshot.frames){const bytes=await readFile(join(root,'media',frame.digest));total+=bytes.length;
 if(total>12*1024*1024||createHash('sha256').update(bytes).digest('hex')!==frame.digest)fail('ASSET_CHANGED');
 frames.push({...frame,data:bytes.toString('base64')});}
 return {...current.snapshot,frames};
 }
 function finish(projectId,id,input){
 const current=job(projectId,id);if(current.state!=='running')return current;
 const valid=input.ok===true&&typeof input.text==='string'&&input.text.length<=6000&&Array.isArray(input.receipts)&&input.receipts.length===current.snapshot.frames.length&&input.receipts.every(r=>typeof r.id==='string'&&typeof r.digest==='string');
 const result=valid?{text:input.text,framesSent:input.receipts,executor:'dsh-vision',advisoryOnly:true,sampledOnly:current.snapshot.kind==='video'}:{error:input.error==='VISION_MODEL_REQUIRED'?'VISION_MODEL_REQUIRED':'VISUAL_RESULT_UNKNOWN'};
 db.prepare('UPDATE visual_reviews SET state=?,result=? WHERE id=?').run(valid?'complete':input.error==='VISION_MODEL_REQUIRED'?'failed':'unknown',JSON.stringify(result),id);return job(projectId,id);
 }
 function cancel(projectId,id){job(projectId,id);db.prepare("UPDATE visual_reviews SET state='cancelled' WHERE id=? AND state='awaiting_approval'").run(id);return job(projectId,id);}
 return {prepare,list,job,claim,guard,inputs,finish,cancel,async stop(){closed=true;controller.abort();await Promise.all([analyzer.stop(),referenceAnalyzer.stop()]);await Promise.allSettled([...active.values()]);}};
}
module.exports={createVisualReviews};
