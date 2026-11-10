'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
const {openStore}=require('../src/v3/service/store.cjs'),{createBatchRunner}=require('../src/v3/service/batches.cjs');
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Timed out local batch');}
test('Batch approval binds quantity and duration, submits at most two concurrently and replays without extra charge',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-batch-')),store=openStore(root);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Batch'}),shots=Array.from({length:4},()=>({id:randomUUID(),action:'Cup',durationUs:5000000}));
 store.mutate('story',{commandId:'s',projectId:p.id,expectedVersion:0,brief:'Cups',ratio:'9:16',durationUs:30000000,shots});
 store.generation.saveConnection('opaque-test-only');
 const input={commandId:'batch',kind:'video',storyVersion:1,shots:shots.slice(0,3).map(s=>s.id),seconds:5};
 const batch=store.batches.prepare(p.id,input);
 assert.equal(store.generation.list(p.id).length,3);
 assert.ok(batch.jobs.every(job=>job.state==='awaiting_approval'));
 assert.deepEqual(store.batches.prepare(p.id,input),batch);
 assert.throws(()=>store.batches.approve(p.id,batch.id,{confirmCharge:true,maxJobs:4,maxSeconds:15,acceptUnknownPrice:true}),{code:'BATCH_APPROVAL_REQUIRED'});
 let current=0,max=0,calls=0;
 const executor={async approve(projectId,id,approval,admission){
  current++;max=Math.max(max,current);
  try{
   await new Promise(resolve=>setTimeout(resolve,8));admission();
   assert.equal(approval.confirmCharge,true);assert.equal(store.generation.claim(projectId,id),true);calls++;
   return store.generation.update(projectId,id,{state:'queued',remote_id:'mock-'+id});
  }finally{current--;}
 }};
 const runner=createBatchRunner(store.batches,executor,executor);
 const approval={confirmCharge:true,acceptUnknownPrice:true,maxJobs:3,maxSeconds:15,confirmUpload:true};
 runner.start(p.id,batch.id,approval);runner.start(p.id,batch.id,approval);
 await until(()=>store.batches.get(p.id,batch.id).state==='submitted');
 assert.equal(calls,3);assert.equal(max,2);
 runner.start(p.id,batch.id,approval);assert.equal(calls,3);
 runner.stop();
 const cancelled=store.batches.prepare(p.id,{...input,commandId:'cancel',shots:shots.slice(0,2).map(s=>s.id)});
 const waiting=[];let submitted=0;
 const delayed={async approve(projectId,id,body,admission){
  await new Promise(resolve=>waiting.push(resolve));admission();submitted++;
  return {state:'queued'};
 }};
 const stopping=createBatchRunner(store.batches,delayed,delayed);
 stopping.start(p.id,cancelled.id,{...approval,maxJobs:2,maxSeconds:10});
 assert.equal(waiting.length,2);
 store.batches.cancel(p.id,cancelled.id);waiting.forEach(resolve=>resolve());
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(submitted,0);assert.equal(store.batches.get(p.id,cancelled.id).state,'cancelled');
 assert.ok(store.batches.get(p.id,cancelled.id).jobs.every(job=>job.state==='cancelled'));
 stopping.stop();
});
