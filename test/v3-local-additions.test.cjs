'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const {openStore}=require('../src/v3/service/store.cjs'),{beatPreview}=require('../src/v3/service/beatcut.cjs');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'cd-additions-')),store=openStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});return store;}
test('Idea conversations stay scoped and explicit note adoption is idempotent, undoable and rejects intervening edits',t=>{
 const s=fixture(t),a=s.mutate('idea',{commandId:'a',text:'旅行'}),b=s.mutate('idea',{commandId:'b',text:'咖啡'}),chat=s.ideaChat.open(a.id,{commandId:'chat'});
 let turn=s.ideaChat.start(a.id,chat.id,{commandId:'request',text:'帮我想开场',includeIdea:false,model:{provider:'fixture',id:'text'}});
 assert.equal(turn.context.idea,undefined);assert.equal(s.ideaChat.start(a.id,chat.id,{commandId:'request',text:'帮我想开场',includeIdea:false,model:{provider:'fixture',id:'text'}}).dispatch,false);
 assert.throws(()=>s.ideaChat.turns(b.id,chat.id),{code:'CHAT_NOT_FOUND'});
 s.ideaChat.finish(a.id,chat.id,{turnId:turn.turnId,text:'从到达旅途第一站开始。'});
 assert.equal(s.ideas.get(a.id).note,'');assert.throws(()=>s.ideaChat.apply(a.id,chat.id,turn.turnId,{}),{code:'IDEA_APPROVAL_REQUIRED'});
 const applied=s.ideaChat.apply(a.id,chat.id,turn.turnId,{confirm:true});assert.equal(applied.note,'从到达旅途第一站开始。');
 assert.deepEqual(s.ideaChat.apply(a.id,chat.id,turn.turnId,{confirm:true}),applied);
 assert.equal(s.ideaChat.undo(a.id,chat.id,turn.turnId,{confirm:true}).note,'');
 turn=s.ideaChat.start(a.id,chat.id,{commandId:'again',text:'继续聊聊',includeIdea:true,model:{provider:'fixture',id:'text'}});
 assert.equal(turn.context.idea.text,'旅行');s.ideaChat.finish(a.id,chat.id,{turnId:turn.turnId,text:'新的建议'});
 s.ideas.update(a.id,{commandId:'manual',expectedVersion:2,note:'人工补充'});
 assert.throws(()=>s.ideaChat.apply(a.id,chat.id,turn.turnId,{confirm:true}),{code:'IDEA_CONFLICT'});
 assert.equal(s.snapshot().projects.length,0);
});
test('Tempo previews stay within source ranges, remap captions and do not alter the confirmed arrangement',t=>{
 const s=fixture(t),p=s.mutate('project',{commandId:'p',title:'Beat',kind:'footage'});
 const a=s.mutate('asset',{commandId:'asset',projectId:p.id,digest:'a'.repeat(64),name:'A.mp4',size:1,durationUs:8000000,width:160,height:90,contentType:'video/mp4'},()=>{});
 const saved=s.mutate('arrangement',{commandId:'arr',projectId:p.id,expectedVersion:0,clips:[{assetId:a.id,inUs:0,outUs:4000000},{assetId:a.id,inUs:4000000,outUs:8000000}],
 subtitle:{mode:'timeline',text:'1\n00:00:00,000 --> 00:00:02,000\n第一句话',assetId:null}});
 const result=beatPreview(saved,s.projectAssets(p.id),{expectedVersion:1,bpm:120,beatsPerCut:4,seconds:6});
 assert.equal(result.clips.length,3);assert.equal(result.durationUs,6000000);assert.equal(result.beatPlan.audioAnalyzed,false);
 assert.equal(result.captions[0].text,'第一句话');assert.equal(s.arrangement(p.id).version,1);
 assert.throws(()=>beatPreview(saved,s.projectAssets(p.id),{expectedVersion:0,bpm:120,beatsPerCut:4,seconds:6}),{code:'ARRANGEMENT_CONFLICT'});
});
test('Workflow grouping survives templates and only changes presentation',t=>{
 const s=fixture(t),p=s.mutate('project',{commandId:'p',title:'Groups',kind:'idea'}),template=s.workflows.templates()[0];
 const one=s.workflows.save(p.id,{commandId:'one',expectedVersion:0,graph:{nodes:template.nodes,edges:template.edges}});
 const two=s.workflows.save(p.id,{commandId:'two',expectedVersion:1,graph:{nodes:one.graph.nodes.map(node=>({...node,group:'准备与交付',folded:true})),edges:one.graph.edges}});
 assert.deepEqual(two.affected,[]);assert.ok(two.graph.nodes.every(node=>node.group==='准备与交付'&&node.folded));
});
