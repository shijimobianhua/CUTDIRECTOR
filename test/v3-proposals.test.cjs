'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {openStore} = require('../src/v3/service/store.cjs');

test('Storyboard proposals require approved evidence, explicit confirmation and exact revision, with durable replay', async t => {
  const root=mkdtempSync(join(tmpdir(),'cd-proposals-'));
  let store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const project=store.mutate('project',{commandId:'p',title:'Proposal test',kind:'idea'});
  const other=store.mutate('project',{commandId:'other',title:'Other',kind:'idea'});
  const asset=store.mutate('asset',{commandId:'a',projectId:project.id,digest:'a'.repeat(64),
    name:'fixture.mp4',durationUs:10000000,size:100,width:320,height:180,contentType:'video/mp4'},()=>{});
  const image=store.mutate('image',{commandId:'i',projectId:project.id,digest:'b'.repeat(64),
    name:'fixture.png',size:100,width:320,height:180,contentType:'image/png'},()=>{});
  const original=store.mutate('story',{commandId:'s',projectId:project.id,expectedVersion:0,
    brief:'A cup',ratio:'16:9',durationUs:10000000,shots:[1,2].map(()=>({id:randomUUID(),
      action:'A cup on a table',durationUs:5000000,assetId:asset.id,startImageId:image.id}))});
  const chat=store.chat.open(project.id,{commandId:randomUUID()});
  function propose(proposal,includeStory=true) {
    const turn=store.chat.start(project.id,chat.id,{commandId:randomUUID(),text:'修改第一镜',
      model:{provider:'fake',id:'text'},includeStory});
    return store.chat.finish(project.id,chat.id,{turnId:turn.turnId,text:'这是一份待确认的建议',action:'story',proposal}).at(-1);
  }
  const change={changes:[{shot:1,field:'action',value:'The cup moves into frame'}]};
  const rejected=propose(change,false);
  assert.equal(rejected.proposal,null);
  assert.match(rejected.answer,/未通过核对/);
  for(const bad of [{changes:[{shot:1,field:'assetId',value:asset.id}]},
    {changes:[{shot:9,field:'action',value:'Unknown'}]},
    {changes:[{shot:1,field:'action',value:'New',extra:true}]}]) {
    assert.equal(propose(bad).proposal,null);
  }
  const proposal=propose(change);
  assert.equal(store.story(project.id).version,1);
  assert.deepEqual(proposal.proposal.clearedSelections,[1]);
  assert.equal(proposal.proposal.next,undefined);
  assert.throws(()=>store.acceptProposal(project.id,chat.id,proposal.id,{}),{code:'PROPOSAL_APPROVAL_REQUIRED'});
  assert.throws(()=>store.acceptProposal(other.id,chat.id,proposal.id,{confirm:true}),{code:'PROPOSAL_NOT_FOUND'});
  const results=await Promise.all([1,2].map(()=>Promise.resolve().then(()=>
    store.acceptProposal(project.id,chat.id,proposal.id,{confirm:true}))));
  assert.equal(results[0].version,2);
  assert.equal(results[1].id,results[0].id);
  let saved=store.story(project.id);
  assert.equal(saved.shots[0].assetId,null);
  assert.equal(saved.shots[0].startImageId,undefined);
  assert.equal(saved.shots[1].assetId,asset.id);
  assert.equal(saved.shots[1].startImageId,image.id);
  assert.equal(store.chat.turns(project.id,chat.id).at(-1).proposal.appliedVersion,2);
  const stale=propose({changes:[{shot:1,field:'action',value:'Another idea'}]});
  store.mutate('story',{...saved,commandId:'manual',projectId:project.id,expectedVersion:2,audience:'Manual choice'});
  assert.throws(()=>store.acceptProposal(project.id,chat.id,stale.id,{confirm:true}),{code:'STORY_CONFLICT'});
  assert.equal(store.story(project.id).audience,'Manual choice');
  assert.equal(store.acceptProposal(project.id,chat.id,proposal.id,{confirm:true}).version,2);
  store.close();
  store=openStore(root);
  assert.equal(store.acceptProposal(project.id,chat.id,proposal.id,{confirm:true}).version,2);
  assert.equal(store.story(project.id).version,3);
  assert.equal(store.story(project.id).shots[0].action,'The cup moves into frame');
  assert.equal(original.shots[0].action,'A cup on a table');
});

test('First storyboard proposals are validated, remain unwritten until approval and cannot replace a manual first version', t => {
  const root=mkdtempSync(join(tmpdir(),'cd-first-story-'));
  let store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',title:'First idea',kind:'idea'});
  const chat=store.chat.open(p.id,{commandId:randomUUID()});
  const input={kind:'create-story',story:{brief:'杯子短片',style:'自然光',ratio:'9:16',seconds:20,
    shots:[{action:'杯子出现在桌面',seconds:10},{action:'特写展示杯口',seconds:10}]}};
  function propose(value,model=true) {
    const turn=store.chat.start(p.id,chat.id,{commandId:randomUUID(),text:'帮我做一条二十秒的杯子产品片',
      model:model?{provider:'fixture',id:'text'}:null});
    return store.chat.finish(p.id,chat.id,{turnId:turn.turnId,text:'请检查第一版方案',proposal:value,action:'story'}).at(-1);
  }
  assert.equal(propose(input,false).proposal,null);
  for(const bad of [
    {...input,story:{...input.story,seconds:1501}},
    {...input,story:{...input.story,seconds:1}},
    {...input,story:{...input.story,shots:[]}},
    {...input,story:{...input.story,shots:Array.from({length:9},()=>({action:'镜头',seconds:1}))}},
    {...input,story:{...input.story,shots:[{action:'镜头',seconds:0.1}]}},
    {...input,story:{...input.story,shots:[{action:'镜头',seconds:1,assetId:randomUUID()}]}},
  ]) assert.equal(propose(bad).proposal,null);
  const proposal=propose(input);
  const stale=propose(input);
  assert.equal(store.story(p.id),null);
  assert.equal(proposal.proposal.kind,'create-story');
  assert.equal(proposal.proposal.baseVersion,0);
  assert.equal(proposal.proposal.draft.shotTotalSeconds,20);
  assert.equal(proposal.proposal.next,undefined);
  const first=store.acceptProposal(p.id,chat.id,proposal.id,{confirm:true});
  assert.equal(first.version,1);
  assert.equal(first.shots.length,2);
  assert.equal(first.shots[0].assetId,null);
  assert.ok(first.shots[0].id);
  assert.equal(new Set(first.shots.map(s=>s.id)).size,2);
  assert.throws(()=>store.acceptProposal(p.id,chat.id,stale.id,{confirm:true}),{code:'STORY_CONFLICT'});
  assert.equal(propose(input).proposal,null);
  store.close();
  store=openStore(root);
  assert.equal(store.acceptProposal(p.id,chat.id,proposal.id,{confirm:true}).id,first.id);
  assert.equal(store.story(p.id).version,1);
  const other=store.mutate('project',{commandId:'other',title:'Manual wins',kind:'idea'});
  const otherChat=store.chat.open(other.id,{commandId:randomUUID()});
  const pending=store.chat.start(other.id,otherChat.id,{commandId:randomUUID(),text:'帮我制作产品分镜方案',
    model:{provider:'fixture',id:'text'}});
  store.mutate('story',{commandId:'manual',projectId:other.id,expectedVersion:0,brief:'Manual story',
    ratio:'1:1',durationUs:1000000,shots:[]});
  const late=store.chat.finish(other.id,otherChat.id,{turnId:pending.turnId,text:'待确认',proposal:input}).at(-1);
  assert.throws(()=>store.acceptProposal(other.id,otherChat.id,late.id,{confirm:true}),{code:'STORY_CONFLICT'});
  assert.equal(store.story(other.id).brief,'Manual story');
});

test('Director accepts fenced first-story output and guides incomplete model output', async t => {
  const {build}=require('../tools/package-v3.cjs');
  const {pathToFileURL}=require('node:url');
  const root=mkdtempSync(join(tmpdir(),'cd-first-model-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const pkg=build(join(root,'plugin'),join(root,'data'));
  const {respond}=await import(pathToFileURL(join(pkg,'host/director.js')).href);
  const payload={text:'请检查这份分镜',action:'story',proposal:{kind:'create-story',
    story:{brief:'杯子短片',ratio:'9:16',seconds:5,shots:[{action:'展示杯子',seconds:5}]}}};
  let output=String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(payload)+'\n'+String.fromCharCode(96).repeat(3);
  let calls=0;
  const ctx={get:()=>({listProviders:async()=>[{id:'fixture'}],listModels:async()=>[{id:'text'}],
    async *stream(request){
      calls++;
      assert.equal(request.maxTokens,2000);
      yield {type:'text-delta',text:output};
      yield {type:'finish',reason:'stop'};
    }})};
  const turn={text:'帮我生成视频，制作一条杯子产品短片',choice:{provider:'fixture',id:'text'},history:[],
    context:{projectKind:'idea',storySaved:false,importedCount:0,production:{shotCount:0}}};
  assert.deepEqual((await respond(ctx,turn)).proposal,payload.proposal);
  output='{"text":"方案","proposal":';
  const incomplete=await respond(ctx,turn);
  assert.match(incomplete.text,/没有完整返回/);
  assert.equal(incomplete.proposal,undefined);
  assert.equal(incomplete.action,'story');
  output='可以先介绍杯子的用途。';
  assert.equal((await respond(ctx,turn)).text,output);
  assert.equal(calls,3);
});
