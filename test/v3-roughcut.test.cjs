'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {openStore}=require('../src/v3/service/store.cjs');

test('Evidence-backed rough cuts preserve protected meaning and source ranges and require revision-bound approval',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-roughcut-'));
  let store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',kind:'footage',title:'Talk'});
  const asset=store.mutate('asset',{commandId:'a',projectId:p.id,digest:'a'.repeat(64),name:'talk.mp4',
    durationUs:60000000,size:100,width:320,height:180,contentType:'video/mp4'},()=>{});
  const sentences=['今天聊咖啡','售价 30 元','如果加入牛奶','不适合过敏的人','请先确认成分','路上随便聊聊','谢谢观看'];
  const stamp=s=>'00:00:'+String(s).padStart(2,'0')+',000';
  const subtitle={mode:'timeline',assetId:null,text:sentences.map((s,i)=>(i+1)+'\n'+stamp(i*4)+' --> '+stamp((i+1)*4)+'\n'+s).join('\n\n')};
  store.mutate('arrangement',{commandId:'arrange',projectId:p.id,expectedVersion:0,
    clips:[{assetId:asset.id,inUs:10000000,outUs:50000000}],subtitle});
  const chat=store.chat.open(p.id,{commandId:randomUUID()});
  function propose(keep,includeSubtitles=true,text='保留重点剪成30秒',extra={}) {
    const start=store.chat.start(p.id,chat.id,{commandId:randomUUID(),text,includeSubtitles,model:{provider:'fixture',id:'text'}});
    const turn=store.chat.finish(p.id,chat.id,{turnId:start.turnId,text:'请检查保留内容',proposal:{
      kind:'arrangement',targetSeconds:30,keep:keep.map(cue=>({cue,reason:'保留原话'})),...extra}}).at(-1);
    return {start,turn};
  }
  assert.equal(propose([1,2,3,4,5],false).turn.proposal,null);
  assert.equal(propose([1,2,3,5]).turn.proposal,null);
  assert.equal(propose([1,2,3,4]).turn.proposal,null);
  assert.equal(propose([2,1,3,4,5]).turn.proposal,null);
  assert.equal(propose([1,2,3,4,5],true,'保留重点剪成10秒').turn.proposal,null);
  assert.equal(propose([1,2,3,4,5],true,'保留重点剪成30秒',{targetSeconds:31}).turn.proposal,null);
  const {start,turn}=propose([1,2,3,4,5]);
  assert.ok(turn.proposal);
  assert.equal(start.context.cutEvidence.version,1);
  assert.equal(turn.proposal.draft.actualSeconds,20);
  assert.equal(turn.proposal.draft.keep[0].sources[0].inUs,10000000);
  assert.equal(store.arrangement(p.id).version,1);
  assert.throws(()=>store.acceptProposal(p.id,chat.id,turn.id,{confirm:false}),{code:'PROPOSAL_APPROVAL_REQUIRED'});
  const approved=store.acceptProposal(p.id,chat.id,turn.id,{confirm:true});
  assert.equal(approved.version,2);assert.equal(approved.durationUs,20000000);
  assert.equal(approved.clips[0].inUs,10000000);assert.equal(approved.clips[0].outUs,30000000);
  assert.deepEqual(approved.captions.map(cue=>cue.text),sentences.slice(0,5));
  assert.deepEqual(store.acceptProposal(p.id,chat.id,turn.id,{confirm:true}),approved);
  store.versions.undo(p.id,'arrangement',{appliedVersion:2,commandId:'undo',confirm:true});
  const stale=propose([1,2,3,4,5]).turn;
  store.mutate('arrangement',{commandId:'manual',projectId:p.id,expectedVersion:3,
    clips:[{assetId:asset.id,inUs:10000000,outUs:50000000}],subtitle});
  assert.throws(()=>store.acceptProposal(p.id,chat.id,stale.id,{confirm:true}),{code:'ARRANGEMENT_CONFLICT'});
  store.close();store=openStore(root);
  assert.deepEqual(store.acceptProposal(p.id,chat.id,turn.id,{confirm:true}),approved);
  assert.equal(store.arrangement(p.id).version,4);
});

test('Workspace keeps incomplete arrangement and idea inputs and rejects foreign assets',t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-extra-views-')),store=openStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',kind:'footage',title:'Draft'});
  const idea=store.mutate('idea',{commandId:'i',text:'An idea'});
  store.workspace.save({scope:'capture',expectedVersion:0,value:{text:'未完成的想法',url:'https://'}});
  store.workspace.save({scope:'idea:'+idea.id,expectedVersion:0,value:{baseVersion:0,note:'输入中',tags:'旅行，',pinned:false}});
  store.workspace.save({scope:'arrangement:'+p.id,expectedVersion:0,value:{baseVersion:0,clips:[],subtitle:null}});
  assert.throws(()=>store.workspace.save({scope:'arrangement:'+p.id,expectedVersion:1,value:{
    baseVersion:0,clips:[{assetId:randomUUID(),inTime:'',outTime:'0'}],subtitle:null}}),{code:'INVALID_VIEW'});
  assert.equal(store.workspace.get('capture').value.url,'https://');
});
