'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {openStore}=require('../src/v3/service/store.cjs'),{build}=require('../tools/package-v3.cjs');
test('Director owns bounded model/read cycles, denies unauthorized tools, fixes evidence version and retains cancellation',async t=>{
  const root=mkdtempSync(join(tmpdir(),'cd-loop-'));let store=openStore(join(root,'data'));
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Loop'});
  const shot=randomUUID();
  store.mutate('story',{commandId:'s',projectId:p.id,expectedVersion:0,brief:'A cup',ratio:'9:16',durationUs:5000000,shots:[{id:shot,action:'Private action',durationUs:5000000}]});
  const chat=store.chat.open(p.id,{commandId:randomUUID()});
  const start=(includeStory=true)=>store.chat.start(p.id,chat.id,{commandId:randomUUID(),text:'请分析这个开场哪里能改',includeStory,model:{provider:'fixture',id:'text'}});
  let turn=start();
  const pkg=build(join(root,'plugin'),join(root,'other-data'));
  const {runDirector}=await import(pathToFileURL(join(pkg,'host/loop.js')).href);
  let calls=0,seen=[];
  const ctx={get:()=>({listProviders:async()=>[{id:'fixture'}],listModels:async()=>[{id:'text'}],async *stream(input){
    seen.push(JSON.parse(input.messages[1].content[0].text));calls++;
    yield {type:'text-delta',text:JSON.stringify(calls===1?{toolRequest:{tool:'read-shot',number:1}}:{text:'先让杯子进入画面。'})};
    yield {type:'finish',reason:'stop'};
  }})};
  const worker={async call(route,method,raw){
    const action=route.split('/').at(-1);
    try{return Response.json({data:store.runtime[action](p.id,chat.id,turn.turnId,JSON.parse(raw))});}
    catch(error){return Response.json({error:{code:error.code}},{status:error.status||500});}
  }};
  const answer=await runDirector(ctx,worker,'/fixture',turn,AbortSignal.timeout(5000));
  assert.equal(answer.text,'先让杯子进入画面。');assert.equal(calls,2);
  assert.equal(seen[1].context.toolResults[0].result.action,'Private action');
  assert.equal(store.runtime.get(p.id,chat.id,turn.turnId).tools,1);
  assert.equal(store.runtime.get(p.id,chat.id,turn.turnId).state,'complete');
  assert.equal(store.story(p.id).version,1);
  store.chat.finish(p.id,chat.id,{turnId:turn.turnId,...answer});
  turn=start(false);store.runtime.begin(p.id,chat.id,turn.turnId);
  assert.throws(()=>store.runtime.read(p.id,chat.id,turn.turnId,{tool:'read-shot',number:1}),{code:'RUN_TOOL_FORBIDDEN'});
  store.runtime.cancel(p.id,chat.id,turn.turnId);
  assert.throws(()=>store.runtime.begin(p.id,chat.id,turn.turnId),{code:'RUN_CANCELLED'});
  assert.equal(store.chat.turns(p.id,chat.id).at(-1).state,'interrupted');
  turn=start();
  store.mutate('story',{commandId:'s2',projectId:p.id,expectedVersion:1,brief:'Manual wins',ratio:'9:16',durationUs:5000000,shots:[]});
  assert.throws(()=>store.runtime.begin(p.id,chat.id,turn.turnId),{code:'RUN_STALE'});
  store.runtime.cancel(p.id,chat.id,turn.turnId);
  turn=start();
  for(let i=0;i<4;i++){store.runtime.begin(p.id,chat.id,turn.turnId);store.runtime.read(p.id,chat.id,turn.turnId,{tool:'inspect-project'});}
  assert.throws(()=>store.runtime.begin(p.id,chat.id,turn.turnId),{code:'RUN_BUDGET'});
  store.close();store=openStore(join(root,'data'));
  assert.equal(store.runtime.get(p.id,chat.id,turn.turnId).state,'interrupted');
  assert.equal(store.chat.turns(p.id,chat.id).at(-1).state,'interrupted');
});
