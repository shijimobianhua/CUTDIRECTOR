'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{mkdtempSync,rmSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url');
const {openStore}=require('../src/v3/service/store.cjs'),{build}=require('../tools/package-v3.cjs');
test('DSH reference search pins its selected provider, requires explicit query and fee approval and never resubmits unknown searches',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-search-')),store=openStore(join(root,'data'));
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const p=store.mutate('project',{commandId:'p',kind:'idea',title:'References'});
 const pkg=build(join(root,'plugin'),join(root,'package-data'));
 const {performSearch,searchSelection}=await import(pathToFileURL(join(pkg,'host/search.js')).href);
 let selected={id:'mock-search'},calls=0,fail=false;
 const ctx={get:name=>name==='web'?{selectSearchProvider:()=>selected,async search(request,signal){
  calls++;assert.equal(request.maxResults,8);assert.equal(request.query,'咖啡 vlog 开场');assert.ok(signal);
  if(fail)throw Object.assign(new Error('Mock uncertain submission'),{code:'WEB_PROVIDER_ERROR'});
  return {sources:[{title:'Public reference',url:'https://example.com/ref',snippet:'A public excerpt'},
    {title:'Blocked local',url:'http://127.0.0.1/private',snippet:'must not appear'}]};
 }}:undefined};
 const worker={async call(route,method,raw){const [id,action]=route.split('/').slice(-2);try{return Response.json({data:store.searches[action](p.id,id,JSON.parse(raw))});}catch(error){return Response.json({error:{code:error.code}},{status:error.status||500});}}};
 const prepare=commandId=>store.searches.prepare(p.id,{commandId,query:'咖啡 vlog 开场',provider:searchSelection(ctx)});
 const job=prepare('query');
 assert.equal(calls,0);
 const denied=await performSearch(ctx,worker,'/search/'+job.id,{},AbortSignal.timeout(1000));
 assert.equal(denied.status,403);assert.equal(calls,0);
 const approval={confirmCharge:true,confirmQuery:true};
 const ready=await performSearch(ctx,worker,'/search/'+job.id,approval,AbortSignal.timeout(1000));
 assert.equal(ready.status,200);assert.equal(ready.value.data.state,'ready');assert.equal(ready.value.data.result.sources.length,1);assert.equal(calls,1);
 await performSearch(ctx,worker,'/search/'+job.id,approval,AbortSignal.timeout(1000));assert.equal(calls,1);
 const pending=prepare('changed');selected={id:'new-provider'};
 const changed=await performSearch(ctx,worker,'/search/'+pending.id,approval,AbortSignal.timeout(1000));
 assert.equal(changed.status,409);assert.equal(calls,1);
 const uncertain=prepare('unknown');fail=true;
 const unknown=await performSearch(ctx,worker,'/search/'+uncertain.id,approval,AbortSignal.timeout(1000));
 assert.equal(unknown.value.data.state,'unknown');assert.equal(calls,2);
 await performSearch(ctx,worker,'/search/'+uncertain.id,approval,AbortSignal.timeout(1000));assert.equal(calls,2);
 assert.equal(store.searches.list(p.id).length,3);
});
