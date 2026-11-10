'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
const {openStore}=require('../src/v3/service/store.cjs');
const {builtins,validateManifest}=require('../src/v3/service/registry.cjs');
const {defineAdapter}=require('../src/v3/service/adapter-sdk.cjs');
const {validateGraph}=require('../src/v3/service/workflows.cjs');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'cd-extension-')),store=openStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});return store;}
test('Capability switches reject stale writes and adapter contracts bind approved input, permissions and validated outputs',async t=>{
 const store=fixture(t),entry=store.registry.list()[0];
 assert.throws(()=>store.registry.configure({pluginId:entry.manifest.pluginId,expectedVersion:9,enabled:false,confirm:true}),{code:'PLUGIN_CONFLICT'});
 assert.equal(store.registry.requireEnabled(entry.manifest.pluginId).enabled,true);
 store.registry.configure({pluginId:entry.manifest.pluginId,expectedVersion:0,enabled:false,confirm:true});
 assert.throws(()=>store.registry.requireEnabled(entry.manifest.pluginId),{code:'CAPABILITY_DISABLED'});
 assert.throws(()=>validateManifest({...builtins[0],permissions:['arbitrary-shell']}),{code:'PLUGIN_MANIFEST_INVALID'});
 let executions=0;
 const manifest={...builtins[1],inputSchema:{type:'object',required:['projectId'],properties:{projectId:{type:'string'}},additionalProperties:false},
  outputSchema:{type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false}};
 const adapter=defineAdapter(manifest,{probe:async()=>({available:true}),prepare:async input=>input,
  execute:async()=>{executions++;return {text:'Local fixture result'};},validate:async()=>true});
 const prepared=await adapter.prepare({projectId:randomUUID()});
 await assert.rejects(adapter.execute(prepared,{confirm:true,inputDigest:prepared.inputDigest,versionDigest:prepared.versionDigest,expiresAt:Date.now()+1000,permissions:[]}),{code:'ADAPTER_APPROVAL_REQUIRED'});
 assert.equal(executions,0);
 const result=await adapter.execute(prepared,{confirm:true,inputDigest:prepared.inputDigest,versionDigest:prepared.versionDigest,expiresAt:Date.now()+1000,permissions:manifest.permissions});
 assert.equal(result.text,'Local fixture result');assert.equal(executions,1);
 prepared.input.projectId='changed';
 await assert.rejects(adapter.execute(prepared,{confirm:true,inputDigest:prepared.inputDigest,versionDigest:prepared.versionDigest,expiresAt:Date.now()+1000,permissions:manifest.permissions}),{code:'ADAPTER_APPROVAL_REQUIRED'});
});
test('Templates and workflow versions validate typed acyclic dependencies and preserve prior artifacts on affected-node changes',t=>{
 const store=fixture(t),p=store.mutate('project',{commandId:'p',kind:'footage',title:'Workflow'});
 const template=store.workflows.templates().find(t=>t.id==='idea-to-video');
 const preview=store.workflows.preview(template);assert.equal(preview.paidNodes.length,2);assert.equal(preview.needsLocalBinding,true);
 const graph={nodes:template.nodes,edges:template.edges};
 const saved=store.workflows.save(p.id,{commandId:'first',expectedVersion:0,graph});
 assert.equal(saved.version,1);assert.equal(store.workflows.status(p.id).nodes.length,7);
 assert.throws(()=>validateGraph({nodes:[{id:'a',type:'review'},{id:'b',type:'review'}],edges:[{source:'a',target:'b'},{source:'b',target:'a'}]}),{code:'WORKFLOW_CYCLE'});
 assert.throws(()=>validateGraph({nodes:[{id:'a',type:'assets'},{id:'b',type:'images'}],edges:[{source:'a',target:'b'}]}),{code:'WORKFLOW_PORT_MISMATCH'});
 assert.throws(()=>store.workflows.preview({...template,key:'secret'}),{code:'TEMPLATE_INVALID'});
 const next={nodes:template.nodes,edges:template.edges.slice(1)};
 const modified=store.workflows.save(p.id,{commandId:'next',expectedVersion:1,graph:next});
 assert.ok(modified.affected.includes('story'));assert.ok(modified.affected.includes('handoff'));
 assert.deepEqual(store.workflows.save(p.id,{commandId:'next',expectedVersion:1,graph:next}),modified);
 assert.throws(()=>store.workflows.save(p.id,{commandId:'stale',expectedVersion:1,graph}),{code:'WORKFLOW_CONFLICT'});
 assert.equal(store.projectAssets(p.id).length,0);assert.equal(store.generation.list(p.id).length,0);
});
test('Manual QA ties verdict and timestamp to an owned artifact and exact story version without claiming model vision',t=>{
 const store=fixture(t),p=store.mutate('project',{commandId:'p',kind:'footage',title:'QA'}),other=store.mutate('project',{commandId:'o',kind:'idea',title:'Other'});
 const asset=store.mutate('asset',{commandId:'a',projectId:p.id,digest:'a'.repeat(64),name:'fixture.mp4',size:100,durationUs:10000000,width:320,height:180,contentType:'video/mp4'},()=>{});
 const input={commandId:'qa',kind:'video',targetId:asset.id,storyVersion:0,timeUs:1000000,verdict:'issue',note:'这里人物动作跳了一下',confirm:true};
 const review=store.quality.add(p.id,input);assert.equal(review.executor,'manual');assert.equal(review.digest,'a'.repeat(64));
 assert.deepEqual(store.quality.add(p.id,input),review);
 assert.throws(()=>store.quality.add(other.id,{...input,commandId:'foreign'}),{code:'ASSET_NOT_FOUND'});
 store.mutate('story',{commandId:'story',projectId:p.id,expectedVersion:0,brief:'New requirements',ratio:'16:9',durationUs:10000000,shots:[]});
 assert.throws(()=>store.quality.add(p.id,{...input,commandId:'late'}),{code:'QUALITY_STALE'});
 assert.equal(store.quality.list(p.id)[0].story_version,0);
 assert.deepEqual(store.quality.add(p.id,input),review);
});
