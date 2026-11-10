'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../src/v3/service/store.cjs');

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'cd-domain-'));
  const store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  return store;
}

test('Focused late shots and structure proposals preserve identities and unrelated fields',t=>{
  const store=fixture(t);
  const p=store.mutate('project',{commandId:'p',title:'Many shots',kind:'idea'});
  const shots=Array.from({length:10},(_,index)=>({id:randomUUID(),action:'Private action '+(index+1),durationUs:1000000}));
  store.mutate('story',{commandId:'s',projectId:p.id,expectedVersion:0,brief:'Story',style:'Original',
    ratio:'9:16',durationUs:45000000,shots});
  const chat=store.chat.open(p.id,{commandId:randomUUID()});
  function propose(changes,focusShotId) {
    const start=store.chat.start(p.id,chat.id,{commandId:randomUUID(),text:'只改指定内容',includeStory:true,
      focusShotId,model:{provider:'fixture',id:'text'}});
    const turn=store.chat.finish(p.id,chat.id,{turnId:start.turnId,text:'请核对',proposal:{changes}}).at(-1);
    return {start,turn};
  }
  let value=propose([{shot:1,field:'action',value:'Wrong target'}],shots[9].id);
  assert.equal(value.turn.proposal,null);
  assert.equal(value.start.context.storyEvidence.shots.length,1);
  assert.equal(value.start.context.storyEvidence.shots[0].number,10);
  assert.doesNotMatch(JSON.stringify(value.start.context.storyEvidence),/Private action 1"/);
  assert.equal(propose([{field:'style',value:'Wrong global'}],shots[9].id).turn.proposal,null);
  value=propose([{shot:10,field:'seconds',value:2}],shots[9].id);
  assert.ok(value.turn.proposal);
  store.acceptProposal(p.id,chat.id,value.turn.id,{confirm:true});
  assert.equal(store.story(p.id).shots[9].durationUs,2000000);
  const before=store.story(p.id);
  value=propose([{field:'seconds',value:60}]);
  store.acceptProposal(p.id,chat.id,value.turn.id,{confirm:true});
  assert.deepEqual(store.story(p.id).shots,before.shots);
  assert.equal(store.story(p.id).style,'Original');
  assert.equal(store.story(p.id).durationUs,60000000);
  value=propose([{shot:1,field:'action',value:'Edited first identity'},
    {field:'order',value:[8,7,6,5,4,3,2,1]}]);
  store.acceptProposal(p.id,chat.id,value.turn.id,{confirm:true});
  assert.equal(store.story(p.id).shots[7].id,shots[0].id);
  assert.equal(store.story(p.id).shots[7].action,'Edited first identity');
  assert.equal(store.story(p.id).shots[9].id,shots[9].id);
  value=propose([{field:'addShot',value:[{action:'Added one',seconds:1},{action:'Added two',seconds:1}]}]);
  store.acceptProposal(p.id,chat.id,value.turn.id,{confirm:true});
  assert.equal(store.story(p.id).shots.length,12);
  assert.equal(store.story(p.id).shots[11].action,'Added two');
  assert.equal(propose([{field:'order',value:[1,2,3,4,5,6,7,8]},
    {field:'addShot',value:{action:'Ambiguous',seconds:1}}]).turn.proposal,null);
  assert.equal(propose([{field:'seconds',value:1}]).turn.proposal,null);
});

test('Idea search, annotations and explicit references retain original sources and revision boundaries',t=>{
  const store=fixture(t);
  const first=store.mutate('idea',{commandId:'first',text:'咖啡旅行 ＶＬＯＧ',url:'https://example.com/reference'});
  const second=store.mutate('idea',{commandId:'second',text:'旅行咖啡的另一个开场'});
  assert.equal(store.ideas.list({q:'vlog'}).items[0].id,first.id);
  const update={commandId:'pin',expectedVersion:0,note:'先看窗外',tags:['旅行','咖啡'],pinned:true};
  store.ideas.update(first.id,update);
  assert.equal(store.ideas.update(first.id,update).version,1);
  assert.equal(store.ideas.get(first.id).text,first.text);
  assert.equal(store.ideas.list().items[0].id,first.id);
  assert.equal(store.ideas.detail(first.id).related[0].id,second.id);
  assert.throws(()=>store.ideas.update(first.id,{...update,commandId:'stale'}),{code:'IDEA_CONFLICT'});
  const p=store.mutate('project',{commandId:'p',title:'From idea',kind:'idea',ideaId:first.id});
  const initial=store.ideas.links(p.id)[0];
  assert.equal(initial.mode,'reference');
  assert.equal(initial.snapshot.note,'先看窗外');
  store.ideas.update(first.id,{commandId:'later',expectedVersion:1,note:'新的补充'});
  assert.equal(store.ideas.links(p.id)[0].snapshot.note,'先看窗外');
  store.ideas.link(p.id,{commandId:'promote',ideaId:first.id,sourceVersion:2,expectedVersion:1,mode:'use'});
  assert.equal(store.ideas.links(p.id)[0].mode,'use');
  store.ideas.link(p.id,{commandId:'disable',ideaId:first.id,sourceVersion:2,expectedVersion:2,mode:'disabled'});
  assert.equal(store.ideas.links(p.id).length,0);
  assert.equal(store.ideas.links(p.id,true)[0].revision,3);
  store.ideas.link(p.id,{commandId:'restore-ref',ideaId:first.id,sourceVersion:2,expectedVersion:3,mode:'reference'});
  assert.equal(store.ideas.links(p.id)[0].revision,4);
});

test('Version restore and undo append history and reject subsequent manual modifications',t=>{
  const store=fixture(t);
  const p=store.mutate('project',{commandId:'p',title:'Versions',kind:'idea'});
  const input={projectId:p.id,brief:'First',ratio:'9:16',durationUs:1000000,shots:[]};
  store.mutate('story',{...input,commandId:'s1',expectedVersion:0});
  store.mutate('story',{...input,brief:'Second',commandId:'s2',expectedVersion:1});
  const undo={appliedVersion:2,commandId:'undo',confirm:true};
  assert.equal(store.versions.undo(p.id,'story',undo).version,3);
  assert.equal(store.story(p.id).brief,'First');
  assert.equal(store.versions.undo(p.id,'story',undo).version,3);
  store.mutate('story',{...input,brief:'Manual',commandId:'manual',expectedVersion:3});
  assert.throws(()=>store.versions.undo(p.id,'story',{...undo,commandId:'new-undo'}),{code:'STORY_CONFLICT'});
  assert.equal(store.story(p.id).brief,'Manual');
  assert.equal(store.versions.list(p.id,'story').items.length,4);
  const restored=store.versions.restore(p.id,'story',{version:2,expectedVersion:4,commandId:'restore',confirm:true});
  assert.equal(restored.version,5);
  assert.equal(restored.brief,'Second');
  assert.equal(store.versions.snapshot(p.id,'story',1).brief,'First');
});
