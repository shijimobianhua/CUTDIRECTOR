'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../src/v3/service/store.cjs');

test('Workspace drafts are scoped, durable and reject stale windows and credential fields',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-views-'));
  let store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',kind:'idea',title:'My draft'});
  const chat=store.chat.open(p.id,{commandId:randomUUID()});
  const scope='chat:'+p.id;
  const value={message:'还没发送的想法',chatId:chat.id,focus:null,model:{provider:'sample',id:'text'}};
  assert.deepEqual(store.workspace.get(scope),{version:0,value:null});
  assert.equal(store.workspace.save({scope,expectedVersion:0,value}).version,1);
  assert.throws(()=>store.workspace.save({scope,expectedVersion:0,value:{...value,message:'Other tab'}}),{code:'VIEW_CONFLICT'});
  assert.throws(()=>store.workspace.save({scope,expectedVersion:1,value:{...value,model:{provider:'sample',id:'text',key:'private'}}}),{code:'INVALID_VIEW'});
  assert.throws(()=>store.workspace.save({scope:'global',expectedVersion:0,value:{route:'https://untrusted.example'}}),{code:'INVALID_VIEW'});
  store.workspace.save({scope:'global',expectedVersion:0,value:{route:'#/projects/'+p.id}});
  store.close();
  store=openStore(root);
  assert.deepEqual(store.workspace.get(scope).value,value);
  assert.equal(store.workspace.get('global').value.route,'#/projects/'+p.id);
  assert.throws(()=>store.workspace.get('chat:'+randomUUID()),{code:'PROJECT_NOT_FOUND'});
});

test('Task pages and durable events paginate and stay within their project',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-activity-'));
  const store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Project'});
  const other=store.mutate('project',{commandId:'other',kind:'idea',title:'Other'});
  const shotId=randomUUID();
  for(const project of [p,other])store.mutate('story',{commandId:'story-'+project.id,projectId:project.id,
    expectedVersion:0,brief:'Private evidence',ratio:'1:1',durationUs:1000000,
    shots:[{id:shotId,action:'Private evidence',durationUs:1000000}]});
  store.generation.saveConnection('opaque');
  const jobs=Array.from({length:60},(_,i)=>store.imageJobs.prepare(p.id,{commandId:'image'+i,shotId,storyVersion:1,frame:'start'}));
  const foreign=store.imageJobs.prepare(other.id,{commandId:'foreign',shotId,storyVersion:1,frame:'start'});
  const first=store.activity.tasks({projectId:p.id,group:'waiting'});
  assert.equal(first.items.length,50);
  assert.ok(first.nextCursor);
  const second=store.activity.tasks({projectId:p.id,group:'waiting',cursor:first.nextCursor});
  assert.equal(second.items.length,10);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,60);
  const before=store.activity.events(p.id).cursor;
  store.imageJobs.claim(p.id,jobs[0].id);
  store.imageJobs.update(p.id,jobs[0].id,'unknown','IMAGE_SUBMIT_UNKNOWN');
  assert.equal(store.activity.tasks({projectId:p.id,group:'attention'}).items[0].id,jobs[0].id);
  const events=store.activity.events(p.id,before);
  assert.equal(events.items.length,2);
  assert.ok(events.items.every(event=>event.subjectId===jobs[0].id));
  assert.doesNotMatch(JSON.stringify(store.activity.tasks({projectId:p.id})),/Private evidence|opaque/);
  assert.ok(!store.activity.events(p.id).items.some(event=>event.subjectId===foreign.id));
  assert.equal(store.activity.events(p.id,999999).reset,true);
});

test('Image and video form drafts stay within an owned saved shot, retain incomplete values and reject credential fields',t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-generator-drafts-')),store=openStore(root);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Drafts'}),other=store.mutate('project',{commandId:'o',kind:'idea',title:'Other'}),shot=randomUUID();
 store.mutate('story',{commandId:'story',projectId:p.id,expectedVersion:0,brief:'A cup',ratio:'9:16',durationUs:5000000,shots:[{id:shot,action:'Cup',durationUs:5000000}]});
 const scope='image-form:'+p.id+':'+shot;
 const value={baseVersion:1,draft:{frame:'start',referenceId:'',method:'',prompt:'还没完成的画面要求'}};
 store.workspace.save({scope,expectedVersion:0,value});assert.deepEqual(store.workspace.get(scope).value,value);
 assert.throws(()=>store.workspace.get('image-form:'+other.id+':'+shot),{code:'INVALID_VIEW'});
 assert.throws(()=>store.workspace.save({scope,expectedVersion:1,value:{...value,draft:{...value.draft,key:'secret'}}}),{code:'INVALID_VIEW'});
 const video={baseVersion:1,draft:{seconds:'',audio:false,method:'',prompt:'未填完整的试拍要求'}};
 store.workspace.save({scope:'video-form:'+p.id+':'+shot,expectedVersion:0,value:video});
 assert.equal(store.workspace.get('video-form:'+p.id+':'+shot).value.draft.seconds,'');
});
