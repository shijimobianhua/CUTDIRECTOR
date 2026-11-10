'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
const {openStore}=require('../src/v3/service/store.cjs');
test('Candidate comparison pages keep project and shot ownership and retain past storyboard versions',t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-candidates-')),store=openStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Compare'}),other=store.mutate('project',{commandId:'o',kind:'idea',title:'Other'});
 const ids=[randomUUID(),randomUUID()];
 store.mutate('story',{commandId:'story',projectId:p.id,expectedVersion:0,brief:'Two shots',ratio:'16:9',durationUs:10000000,
  shots:ids.map(id=>({id,action:'A cup',durationUs:5000000}))});
 store.generation.saveConnection('opaque-test-only');
 const foreign=store.generation.prepare(p.id,{commandId:'foreign-shot',storyVersion:1,shotId:ids[1],seconds:5});
 const insert=(projectId,commandId,extra={})=>store.mutate('asset',{commandId,projectId,digest:'a'.repeat(64),name:commandId+'.mp4',size:100,durationUs:5000000,width:320,height:180,contentType:'video/mp4',...extra},()=>{});
 insert(p.id,'belongs-to-other-shot',{generationId:foreign.id});insert(other.id,'other-project-private');
 for(let i=0;i<55;i++)insert(p.id,'manual-'+i);
 const old=store.generation.prepare(p.id,{commandId:'old-shot',storyVersion:1,shotId:ids[0],seconds:5});
 const oldAsset=insert(p.id,'old-version',{generationId:old.id});
 store.mutate('story',{commandId:'story2',projectId:p.id,expectedVersion:1,brief:'Updated brief',ratio:'16:9',durationUs:10000000,
  shots:ids.map(id=>({id,action:'A cup',durationUs:5000000}))});
 const first=store.candidates.list(p.id,{kind:'video',shotId:ids[0],before:Number.MAX_SAFE_INTEGER});
 assert.equal(first.items.length,50);assert.ok(first.nextBefore);assert.equal(first.currentStoryVersion,2);
 assert.equal(first.items.find(item=>item.id===oldAsset.id).storyVersion,1);
 const second=store.candidates.list(p.id,{kind:'video',shotId:ids[0],before:first.nextBefore});
 assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,56);
 assert.doesNotMatch(JSON.stringify([...first.items,...second.items]),/belongs-to-other-shot|other-project-private/);
 assert.throws(()=>store.candidates.list(other.id,{kind:'video',shotId:ids[0],before:Number.MAX_SAFE_INTEGER}),{code:'SHOT_NOT_FOUND'});
});
test('Workflow undo appends a version, is idempotent and refuses newer edits',t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-workflow-undo-')),store=openStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'footage',title:'Undo'});
 const template=store.workflows.templates()[0],graph={nodes:template.nodes,edges:template.edges};
 const one=store.workflows.save(p.id,{commandId:'one',expectedVersion:0,graph});
 store.workflows.save(p.id,{commandId:'two',expectedVersion:1,graph:{nodes:one.graph.nodes.map((node,i)=>({...node,x:node.x+i*20})),edges:one.graph.edges}});
 assert.throws(()=>store.workflows.undo(p.id,{commandId:'bad',appliedVersion:2}),{code:'WORKFLOW_APPROVAL_REQUIRED'});
 const input={commandId:'undo',appliedVersion:2,confirm:true},result=store.workflows.undo(p.id,input);
 assert.equal(result.version,3);assert.deepEqual(result.graph,one.graph);
 assert.deepEqual(store.workflows.undo(p.id,input),result);
 assert.throws(()=>store.workflows.undo(p.id,{...input,commandId:'late'}),{code:'WORKFLOW_CONFLICT'});
});
