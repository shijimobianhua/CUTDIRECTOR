'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
const {openStore}=require('../src/v3/service/store.cjs');
test('Methods route to video, semantic roughcut and explicit human QA/editor roles without expanding executor permissions',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-role-')),store=openStore(root);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Roles'}),shot=randomUUID();
 store.mutate('story',{commandId:'s',projectId:p.id,expectedVersion:0,brief:'Cup',ratio:'9:16',durationUs:5000000,
   shots:[{id:shot,action:'Cup on table',durationUs:5000000}]});
 async function install(name,role,stage,capabilities){
  const files=[{path:'SKILL.md',text:'---\nname: '+name+'\ndescription: Test method\nlicense: MIT\n---\nKeep the cup steady.'},
   {path:'cutdirector.skill.json',text:JSON.stringify({schemaVersion:1,version:'1.0.0',roles:[role],stages:[stage],capabilities})}];
  const preview=await store.skills.preview('folder',Buffer.from(JSON.stringify(files)));
  return store.skills.install(preview.id);
 }
 const video=await install('steady-video','video','generation',['video-generation']);
 assert.equal(store.skills.route(p.id,video.hash,'generation',true).executor,'seedance');
 assert.equal(store.skills.route(p.id,video.hash,'storyboard',true).state,'stage-mismatch');
 const rough=await install('safe-roughcut','roughcut','arrangement',['roughcut-proposal']);
 assert.equal(store.skills.route(p.id,rough.hash,'arrangement',true).role,'roughcut');
 const qa=await install('manual-qa','visual-qa','review',['manual-review']);
 assert.equal(store.skills.route(p.id,qa.hash,'review',true).executor,'user');
 assert.match(store.skills.checklist(qa.hash,'visual-qa').body,/Keep the cup/);
 const editor=await install('handoff-check','editor','handoff',['draft-handoff']);
 assert.equal(store.skills.route(p.id,editor.hash,'handoff',true).executor,'user');
 assert.throws(()=>store.skills.checklist(qa.hash,'editor'),{code:'SKILL_CHECKLIST_UNAVAILABLE'});
 store.generation.saveConnection('opaque-test-only');
 const job=store.generation.prepare(p.id,{commandId:'v',shotId:shot,storyVersion:1,seconds:5,method:video.hash});
 assert.equal(job.spec.method.hash,video.hash);assert.match(job.spec.prompt,/Keep the cup steady/);
 store.skills.activate(video.hash,false);
 assert.throws(()=>store.generation.claim(p.id,job.id),{code:'VIDEO_METHOD_UNAVAILABLE'});
 assert.equal(store.generation.get(p.id,job.id).state,'awaiting_approval');
});
