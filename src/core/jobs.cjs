'use strict';
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const {atomic,hash,fail}=require('./util.cjs');const renderer=require('../adapters/render.cjs');
class Jobs {
 constructor(root,store,{render=renderer.render}={}) {
  this.root=path.resolve(root);this.store=store;this.render=render;this.controllers=new Map();this.pending=new Map();fs.mkdirSync(this.root,{recursive:true});this.file=path.join(this.root,'jobs.json');this.jobs=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file)):[];
  for(const j of this.jobs)if(['queued','running'].includes(j.status)){j.status='interrupted';j.attempts.at(-1).status='interrupted';}this.save();
 }
 save(){atomic(this.file,this.jobs);}
 read(id){const j=this.jobs.find(j=>j.id===id);if(!j)fail('NOT_FOUND');return structuredClone(j);}
 start({projectId,revision,requestId,type='export'}) {
  if(!require('../../contracts/project.cjs').id(requestId))fail('VALIDATION_ERROR');
  const digest=hash({projectId,revision,requestId,type}),old=this.jobs.find(j=>j.requestId===requestId);
  if(old){if(old.digest!==digest)fail('REQUEST_ID_CONFLICT');return this.read(old.id);}
  const p=this.store.read(projectId);if(p.revision!==revision)fail('REVISION_CONFLICT');const m=renderer.manifest(p,type);
  const id='J_'+randomUUID(),attempt={id:'A_'+randomUUID(),status:'queued'};
  const j={id,requestId,digest,projectId,revision,manifest:m,status:'queued',attempts:[attempt],artifacts:[]};this.jobs.push(j);this.save();
  return this.launch(j);
 }
 launch(j){
  const {id,projectId,revision,manifest:m}=j,attempt=j.attempts.at(-1);
  const controller=new AbortController();this.controllers.set(id,controller);
  const work=Promise.resolve().then(async()=>{
   const partial=path.join(this.root,id+'.'+attempt.id+'.partial'),published=path.join(this.root,id+'.'+attempt.id);
   try {if(controller.signal.aborted)fail('CANCELLED');j.status=attempt.status='running';this.save();
    // Reuse only verified, revision-bound published outputs; changed or missing inputs invalidate cache.
    const hasCandidate=this.jobs.some(x=>x.id!==id&&x.status==='succeeded'&&x.manifest.cacheKey===m.cacheKey);
    if(hasCandidate)for(const a of m.snapshot.media){const w=a.workingMedia,file=w?.path||a.path;if(!fs.existsSync(file))fail('MEDIA_MISSING');if(hash(fs.readFileSync(file))!==(w?.hash||a.hash))fail('MEDIA_CHANGED');}
    const cached=this.jobs.find(x=>x.id!==id&&x.status==='succeeded'&&x.manifest.cacheKey===m.cacheKey&&x.artifacts.every(a=>fs.existsSync(a.path)&&hash(fs.readFileSync(a.path))===a.hash));
    let files;if(cached){fs.mkdirSync(partial,{recursive:true});for(const a of cached.artifacts)fs.copyFileSync(a.path,path.join(partial,a.name));files=cached.artifacts.map(({name,hash})=>({name,hash}));j.cacheHit=cached.id;}else files=await this.render(m,partial,{signal:controller.signal});if(controller.signal.aborted)fail('CANCELLED');
    fs.renameSync(partial,published);j.artifacts=files.map(f=>({...f,projectId,revision,manifestHash:m.cacheKey,path:path.join(published,f.name),status:'published'}));j.status=attempt.status='succeeded';
   } catch(e){j.status=attempt.status=controller.signal.aborted?'cancelled':'failed';j.error={code:e.code||'RENDER_FAILED',message:e.message};j.artifacts=[];fs.rmSync(partial,{recursive:true,force:true});}
   finally{this.controllers.delete(id);this.save();this.pending.delete(id);}
  });this.pending.set(id,work);return this.read(id);
 }
 retry(id){const j=this.jobs.find(j=>j.id===id);if(!j)fail('NOT_FOUND');if(!['failed','cancelled','interrupted'].includes(j.status))fail('JOB_NOT_RETRYABLE');j.attempts.push({id:'A_'+randomUUID(),status:'queued'});j.status='queued';delete j.error;this.save();return this.launch(j);}
 cancel(id){const j=this.read(id);this.controllers.get(id)?.abort();return j;}
 async settle(id){await this.pending.get(id);return this.read(id);}
 artifact(id,name){const j=this.read(id);const a=j.artifacts.find(a=>a.name===name);if(j.status!=='succeeded'||!a)fail('NOT_FOUND');if(hash(fs.readFileSync(a.path))!==a.hash)fail('MEDIA_CHANGED');return a;}
}
module.exports={Jobs};
