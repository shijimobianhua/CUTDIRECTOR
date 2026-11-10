'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {fixture,temp,command}=require('./helpers.cjs');
const {ProjectStore}=require('../src/core/store.cjs');
const {Jobs}=require('../src/core/jobs.cjs');
const {createServer}=require('../src/server.cjs');
const {providers}=require('../src/agent/provider.cjs');
const {hash}=require('../src/core/util.cjs');

async function setup(t,{delegate,render}={}){
  const store=new ProjectStore(temp());
  store.create(fixture());
  const models=[];
  const jobs=new Jobs(path.join(store.root,'jobs'),store,{render:render||((m,dir)=>{
    fs.mkdirSync(dir);
    const report=JSON.stringify({file:{status:'passed'}});
    fs.writeFileSync(path.join(dir,'report.json'),report);
    return [{name:'report.json',hash:hash(report)}];
  })});
  const server=createServer(store,{jobs,models,delegate});
  require('../src/render-routes.cjs').attach(server,jobs);
  const base=await listen(t,server);
  t.after(()=>store.close());
  const post=(route,value)=>fetch(base+route,{method:'POST',
    headers:{'Content-Type':'application/json','X-Cutdirector':'agent-v1'},body:JSON.stringify(value)});
  const get=(route)=>fetch(base+route).then(r=>r.json());
  const start=(value={})=>{
    const input={id:randomUUID(),projectId:'P',modelId:'local',request:'剪开头',...value};
    return post('/agent/run',input).then(r=>r.json()).then(run=>({input,run}));
  };
  const settle=async id=>{
    for(let i=0;i<100;i++){
      const run=await get('/agent/run?id='+id);
      if(!['planning','executing'].includes(run.status))return run;
      await delay(12);
    }
    assert.fail('Run did not settle');
  };
  return {store,models,jobs,base,post,get,start,settle};
}
async function listen(t,server){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('V2 conversations share history through DSH, isolate intent and answer basic questions without a model',async t=>{
  const app=await setup(t);
  const {apply}=await import('../src/host/index.js');
  const routes=[];
  apply({tools:{register:()=>()=>{}},skills:{register:()=>()=>{}},effect:f=>f(),
    webServer:{register:r=>(routes.push(r),()=>{})}},{adapterUrl:app.base});
  const host=await listen(t,http.createServer(routes[0].handler));
  const hostAgent=host+'/video-agent/agent/';
  const add=()=>app.post('/agent/conversations',{projectId:'P'}).then(r=>r.json());
  const chat=await add();
  const detail=id=>app.get('/agent/conversation?projectId=P&id='+id);
  const glossary=await app.start({conversationId:chat.id,request:'转写是什么？',modelId:''});
  assert.equal(glossary.run.status,'replied');
  assert.match(glossary.run.reply,/把视频里说的话变成文字/);
  let context;
  app.models.push({id:'local',next:async input=>{context=input.context;return {kind:'reply',text:'收到。'};}});
  const first=await app.start({conversationId:chat.id,request:'把这段剪成30秒',intent:{mustKeep:['价格']}});
  await app.settle(first.run.id);
  assert.equal(context.intent.targetSec,30);
  assert.equal(context.history[0].request,'转写是什么？');
  const second=await app.start({conversationId:chat.id,request:'改成 40 秒'});
  await app.settle(second.run.id);
  const replay=await app.post('/agent/run',second.input);
  assert.equal(replay.status,202);
  const shared=await fetch(hostAgent+'conversation?projectId=P&id='+chat.id).then(r=>r.json());
  assert.equal(shared.intent.targetSec,40);
  assert.deepEqual(shared.intent.mustKeep,['价格']);
  assert.equal(shared.runs.length,3);
  const other=await add();
  assert.deepEqual((await detail(other.id)).intent,{});
  assert.deepEqual((await detail(other.id)).runs,[]);
  await app.post('/agent/conversation/open',{projectId:'P',id:chat.id});
  assert.equal((await fetch(hostAgent+'conversations?projectId=P').then(r=>r.json())).recentId,chat.id);
  assert.equal((await fetch(hostAgent+'conversation?projectId=P&id='+randomUUID())).status,404);

  const old=await app.start({request:'旧入口记录'});
  await app.settle(old.run.id);
  assert.deepEqual((await detail('legacy')).runs.map(run=>run.id),[old.run.id]);
  assert.equal(app.store.read('P').revision,0);
});

test('empty speech evidence guides a 30s-style request and continuation to an explicit bounded trim',async t=>{
  const app=await setup(t);
  const chat=await app.post('/agent/conversations',{projectId:'P'}).then(r=>r.json());
  const ask=request=>app.start({conversationId:chat.id,selection:['S2'],modelId:'',request}).then(({run})=>run);
  const guidance=await ask('重点提取3s');
  assert.equal(guidance.status,'replied');
  assert.equal(guidance.guidance.importSubtitles,true);
  assert.equal(guidance.guidance.request,'保留开头3秒');
  const proposed=await ask('开始剪把');
  assert.equal(proposed.status,'awaiting-approval');
  assert.deepEqual(proposed.proposal.params,{inFrame:120,outFrame:192});
  assert.equal(app.store.read('P').revision,0);
  assert.equal((await app.post('/agent/approve',{id:proposed.id,proposalId:proposed.proposal.id})).status,202);
  assert.equal((await app.settle(proposed.id)).status,'applied');
  assert.equal(app.store.read('P').revision,1);
  const preview=await ask('生成预览');
  assert.equal(preview.proposal.params.type,'preview');
  assert.equal((await app.post('/agent/approve',{id:preview.id,proposalId:preview.proposal.id})).status,202);
  assert.equal((await app.settle(preview.id)).status,'delivered');
  assert.equal(app.store.read('P').revision,1);
});
test('matching redundant trim revision is accepted while out of scope plans get one correction',async t=>{
  const app=await setup(t);
  let calls=0;
  app.models.push({id:'local',next:async({context})=>{
    if(++calls===1)return {...trim,target:'other'};
    assert.match(context.actionCorrection,/未通过检查/);
    return {...trim,params:{...trim.params,revision:0}};
  }});
  const {run}=await app.start({mode:'proposal'});
  const result=await app.settle(run.id);
  assert.equal(result.status,'proposed');
  assert.deepEqual(result.proposal.params,trim.params);
  assert.equal(calls,2);
  assert.equal(app.store.read('P').revision,0);
});

const trim={kind:'proposal',op:'segment.trim',target:'S',params:{inFrame:1,outFrame:120},text:'剪掉源片段开头一帧'};

test('independent loop gates exact revision, supports proposal-only and idempotent approval',async t=>{
  const app=await setup(t);
  app.models.push({id:'local',next:async()=>trim});
  const draft=await app.start({mode:'proposal'});
  const proposed=await app.settle(draft.run.id);
  assert.equal(proposed.status,'proposed');
  assert.equal((await app.post('/agent/approve',{id:proposed.id,proposalId:proposed.proposal.id})).status,400);
  assert.equal(app.store.read('P').revision,0);
  const {input,run}=await app.start({previousId:proposed.id});
  const approval=await app.settle(run.id);
  assert.equal(approval.status,'awaiting-approval');
  const args={id:run.id,proposalId:approval.proposal.id};
  assert.equal((await app.post('/agent/approve',args)).status,202);
  assert.equal((await app.settle(run.id)).status,'applied');
  assert.equal((await app.post('/agent/approve',args)).status,202);
  assert.equal((await app.post('/agent/run',input)).status,202);
  assert.equal(app.store.read('P').revision,1);
});

test('revision conflict, cancellation and event stream through DSH Host facade',async t=>{
  const app=await setup(t);
  const routes=[];
  const {apply}=await import('../src/host/index.js');
  apply({tools:{register:()=>()=>{}},skills:{register:()=>()=>{}},effect:f=>f(),
    webServer:{register:r=>(routes.push(r),()=>{})}},{adapterUrl:app.base});
  const facade=await listen(t,http.createServer(routes[0].handler));
  app.models.push({id:'local',next:async()=>trim});
  assert.equal((await fetch(facade+'/video-agent/agent.js')).status,200);
  const id=randomUUID();
  const res=await fetch(facade+'/video-agent/agent/run',{method:'POST',
    headers:{'Content-Type':'application/json','X-Cutdirector':'agent-v1'},
    body:JSON.stringify({id,projectId:'P',modelId:'local',request:'剪辑'})});
  assert.equal(res.status,202);
  const events=await fetch(facade+'/video-agent/agent/events?id='+id);
  assert.match(await events.text(),/awaiting-approval/);
  const ready=await app.settle(id);
  app.store.apply(command());
  assert.equal((await app.post('/agent/approve',{id,proposalId:ready.proposal.id})).status,409);
  assert.equal((await app.post('/agent/cancel',{id})).status,200);
  assert.equal((await app.settle(id)).status,'cancelled');
  assert.equal(app.store.read('P').revision,1);
});

test('alternate provider endpoints share the loop, approved feedback persists and can be revoked',async t=>{
  const app=await setup(t);
  const captures=[];
  for(const id of ['local','alternate']){
    const endpoint=await listen(t,http.createServer(async(req,res)=>{
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks));
      captures.push({model:input.model,context:JSON.parse(input.messages[1].content),policy:input.messages[0].content});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:'reply',text:id})}}]}));
    }));
    app.models.push(...providers(JSON.stringify([{id,model:id,endpoint}])));
  }
  app.store.apply({projectId:'P',baseRevision:0,actor:'human',commandId:'feedback',op:'feedback.add',target:'P',
    params:{id:'F',request:'保留数字和报价条件',decision:'accepted',preferenceConfirmed:true,actualDiff:[]}});
  const pref=await app.post('/agent/memory',{projectId:'P',action:'approve',caseId:'F'}).then(r=>r.json());
  const first=await app.start({intent:{targetSec:45,mustKeep:['报价']}});
  assert.equal((await app.settle(first.run.id)).reply,'local');
  const second=await app.start({previousId:first.run.id,modelId:'alternate',intent:{targetSec:60}});
  assert.equal((await app.settle(second.run.id)).reply,'alternate');
  assert.deepEqual(captures[1].context.intent,{targetSec:60,mustKeep:['报价']});
  assert.deepEqual(captures[1].context.preferences,[{id:pref.id,rule:'保留数字和报价条件'}]);
  assert.equal((await app.post('/agent/memory',{projectId:'P',action:'revoke',id:pref.id})).status,200);
  const third=await app.start();
  await app.settle(third.run.id);
  assert.deepEqual(captures[2].context.preferences,[]);
  assert.match(captures[0].policy,/源帧/);
});

test('render publishes bound QA and read-only delegate cannot invoke edits',async t=>{
  const calls=[];
  const app=await setup(t,{delegate:{isolated:true,analyze:async input=>{
    calls.push(input.evidence);
    return {text:'仅建议',op:'segment.trim'};
  }}});
  app.models.push({id:'local',next:async({context})=>context.previous?.tool==='dsh_analyze'?
    {kind:'proposal',op:'render',target:'P',params:{type:'export'},text:'导出当前版本'}:
    {kind:'tool',name:'dsh_analyze',args:{segmentId:'S',revision:context.revision}}});
  const {run}=await app.start({allowDelegate:true});
  const ready=await app.settle(run.id);
  assert.equal(calls.length,1);
  assert.equal(app.store.read('P').revision,0);
  await app.post('/agent/approve',{id:run.id,proposalId:ready.proposal.id});
  const delivered=await app.settle(run.id);
  assert.equal(delivered.status,'delivered');
  assert.equal(delivered.result.file,'passed');
  assert.equal(delivered.result.human,'unverified');
  assert.equal(delivered.result.revision,0);
});

test('restart reconciles committed edit without replaying a second write',async t=>{
  const app=await setup(t);
  app.models.push({id:'local',next:async()=>trim});
  const first=await app.start();
  const ready=await app.settle(first.run.id);
  const payload={projectId:'P',baseRevision:0,commandId:'C_crash',actor:'agent',
    op:trim.op,target:trim.target,params:trim.params};
  const {atomic}=require('../src/core/util.cjs');
  const file=path.join(app.store.root,'_agent','runs',ready.id+'.json');
  atomic(file,{...ready,status:'executing',pending:{kind:'edit',payload}});
  app.store.apply(payload);
  const restarted=require('../src/agent/loop.cjs').createAgent({store:app.store,jobs:app.jobs,models:app.models});
  assert.equal(restarted.view(ready.id).status,'interrupted');
  restarted.resume(ready.id);
  await delay(20);
  assert.equal(restarted.view(ready.id).status,'applied');
  assert.equal(app.store.read('P').revision,1);
  assert.equal(app.store.history('P').length,2);
});

test('runtime blocks protected evidence loss and caps render attempts before dispatch',async t=>{
  let attempts=0;
  const app=await setup(t,{render:async()=>{attempts++;throw new Error('render failure');}});
  app.models.push({id:'local',next:async({context})=>context.request==='protected'?
    {...trim,params:{inFrame:50,outFrame:120}}:
    {kind:'proposal',op:'render',target:'P',params:{type:'preview'},text:'预览当前版本'}});
  const noEvidence=await app.start({request:'protected',intent:{mustKeep:['3 倍']}});
  const failed=await app.settle(noEvidence.run.id);
  assert.equal(failed.status,'failed');
  assert.equal(failed.error.code,'AGENT_PROTECTED_CONTENT');
  const {run}=await app.start();
  const ready=await app.settle(run.id);
  await app.post('/agent/approve',{id:run.id,proposalId:ready.proposal.id});
  assert.equal((await app.settle(run.id)).status,'failed');
  await app.post('/agent/resume',{id:run.id});
  assert.equal((await app.settle(run.id)).status,'failed');
  assert.equal((await app.post('/agent/resume',{id:run.id})).status,400);
  assert.equal(attempts,2);
  assert.equal(app.store.read('P').revision,0);
});

test('native DSH bridge installs a deny-all scoped tool guard before prompt and discards scope',async()=>{
  const {analyze}=await import('../src/host/delegate.js');
  let disposed=false,guard,step;
  const evidence={segmentId:'S',revision:0,items:[]};
  const events=[];
  const agents={create:async options=>{
    options.setup({tools:{guard:fn=>{guard=fn;}},on:(type,fn)=>{
      assert.equal(type,'agent/pre-step');
      step=fn;
    }});
    return {agent:{session:{get seq(){return events.length;},eventAt:i=>events[i]},followup(message){
      assert.match(message.content[0].text,/"segmentId":"S"/);
      assert.match(guard({name:'bash'}),/denied/);
      assert.match(guard({name:'video_project_apply'}),/denied/);
      assert.equal(step({},()=>true),true);
      assert.throws(()=>step({},()=>true),/step limit/);
      events.push({type:'assistant/message',data:{message:{content:[{type:'text',text:'evidence only'}]}}});
    },whenIdle:async()=>{}},dispose:async()=>{disposed=true;}};
  }};
  const result=await analyze(agents,{provider:'fixture',model:'fixture'},evidence,new AbortController().signal);
  assert.equal(result.text,'evidence only');
  assert.ok(disposed);
});

test('evaluation runs three policy variants without touching the original project',async()=>{
  const {evaluate}=require('../tools/agent-eval.cjs');
  const dir=temp();
  const projectFile=path.join(dir,'project.json');
  const suite=path.join(dir,'samples.json');
  const original=JSON.stringify(fixture());
  fs.writeFileSync(projectFile,original);
  fs.writeFileSync(suite,JSON.stringify([{id:'one',project:'project.json',request:'剪开头',
    preferences:['保留产品名']}]));
  const seen=[];
  const result=await evaluate({file:suite,modelId:'local',models:[{id:'local',next:async({context,policy})=>{
    seen.push([policy.includes('首尾修剪'),context.preferences.length]);
    return trim;
  }}]});
  assert.deepEqual(seen,[[false,0],[true,0],[true,1]]);
  assert.ok(result.results.every(r=>r.status==='applied'&&!r.unauthorizedWrites));
  assert.equal(fs.readFileSync(projectFile,'utf8'),original);
});

test('multi-step loop returns to the model after verified edit and requests separate render approval',async t=>{
  const app=await setup(t);
  app.models.push({id:'local',next:async({context})=>context.previous?.completed?
    {kind:'proposal',op:'render',target:'P',params:{type:'preview'},text:'预览已修剪版本'}:{...trim,more:true}});
  const {run}=await app.start();
  const edit=await app.settle(run.id);
  await app.post('/agent/approve',{id:run.id,proposalId:edit.proposal.id});
  const preview=await app.settle(run.id);
  assert.equal(preview.status,'awaiting-approval');
  assert.equal(preview.proposal.op,'render');
  assert.equal(preview.proposal.revision,1);
  assert.equal(app.jobs.jobs.length,0);
  assert.equal((await app.post('/agent/approve',{id:run.id,proposalId:edit.proposal.id})).status,202);
  assert.equal(app.store.read('P').revision,1);
  await app.post('/agent/approve',{id:run.id,proposalId:preview.proposal.id});
  const delivered=await app.settle(run.id);
  assert.equal(delivered.status,'delivered');
  assert.equal(delivered.result.revision,1);
});

test('GUI model API tests a key, persists it with Windows protection and hot-loads the model', {skip:process.platform!=='win32'},async t=>{
  const app=await setup(t);
  const key='fixture-key-'+randomUUID();
  const endpoint=await listen(t,http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Bearer '+key){res.writeHead(401).end('{}');return;}
    if(req.url==='/models'){res.end(JSON.stringify({data:[{id:'local-model'}]}));return;}
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    const content=body.messages.length===1?'OK':JSON.stringify(trim);
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  }));
  const candidate={kind:'compatible',baseUrl:endpoint,model:'local-model'};
  const denied=await app.post('/agent/model-settings',{...candidate,action:'save',key:'bad'});
  assert.equal((await denied.json()).code,'MODEL_CREDENTIAL_INVALID');
  assert.deepEqual((await app.get('/agent/models')).models,[]);
  const found=await app.post('/agent/model-discover',{...candidate,key}).then(r=>r.json());
  assert.equal(found.models[0].id,'local-model');
  const saved=await app.post('/agent/model-settings',{...candidate,action:'save',key}).then(r=>r.json());
  assert.equal(saved.entries[0].hasKey,true,JSON.stringify(saved));
  assert.equal(saved.defaultId,saved.entries[0].id);
  assert.ok(!JSON.stringify(saved).includes(key));
  const stored=fs.readFileSync(path.join(app.store.root,'_agent','providers.json'),'utf8');
  assert.ok(!stored.includes(key));
  assert.match(JSON.parse(stored).entries[0].secret,/^[A-Za-z0-9+/]+=*$/);
  const {run}=await app.start({modelId:saved.defaultId,mode:'proposal'});
  assert.equal((await app.settle(run.id)).status,'proposed');
  const latest=await app.get('/agent/latest?projectId=P');
  assert.equal(latest.run.id,run.id);
  assert.equal(app.store.read('P').revision,0);
  await app.post('/agent/model-settings',{action:'remove',id:saved.defaultId});
  assert.deepEqual((await app.get('/agent/models')).models,[]);
  assert.equal((await app.get('/agent/latest?projectId=P')).run.id,run.id);
});

test('DSH-host catalog and one inference share the CUTDIRECTOR run across both origins',async t=>{
  const before=process.env.VIDEO_AGENT_BRIDGE_DIR;
  process.env.VIDEO_AGENT_BRIDGE_DIR=temp();
  t.after(()=>{if(before===undefined)delete process.env.VIDEO_AGENT_BRIDGE_DIR;else process.env.VIDEO_AGENT_BRIDGE_DIR=before;});
  const app=await setup(t);
  const routes=[];
  let calls=0,offer=true;
  const llm={listProviders:()=>[{id:'fixture',name:'Fixture'}],listModels:async()=>offer?[{id:'dsh-test',name:'DSH model'}]:[],
    async *stream(config){
      assert.equal(config.provider,'fixture');
      assert.equal(config.model,'dsh-test');
      assert.ok(config.signal instanceof AbortSignal);
      calls++;
      assert.match(config.messages[1].content[0].text,/只输出一个 JSON 对象/);
      if(calls===1)yield {type:'text-delta',text:'可以剪掉片头。'};
      else{
        assert.match(config.messages[1].content[0].text,/上一次输出格式不符合要求/);
        yield {type:'text-delta',text:JSON.stringify(trim)};
      }
      yield {type:'finish',reason:'stop'};
    }};
  const {apply}=await import('../src/host/index.js');
  apply({get:name=>name==='llm'?llm:undefined,tools:{register:()=>()=>{}},skills:{register:()=>()=>{}},
    effect:f=>t.after(f()),webServer:{register:r=>(routes.push(r),()=>{})}},{adapterUrl:app.base});
  const origin=await listen(t,http.createServer(routes[0].handler));
  const bridge=origin+'/video-agent/agent';
  assert.deepEqual((await app.get('/agent/models')).models,[]);
  const embedded=await fetch(bridge+'/models').then(r=>r.json());
  assert.equal(embedded.models[0].source,'dsh');
  const greeting=await fetch(bridge+'/run',{method:'POST',headers:{'Content-Type':'application/json','X-Cutdirector':'agent-v1'},
    body:JSON.stringify({id:randomUUID(),projectId:'P',modelId:embedded.models[0].id,request:'你好！'})}).then(r=>r.json());
  assert.equal(greeting.status,'replied');
  assert.match(greeting.reply,/你好/);
  assert.equal(calls,0);
  const id=randomUUID();
  const reply=await fetch(bridge+'/run',{method:'POST',headers:{'Content-Type':'application/json','X-Cutdirector':'agent-v1'},
    body:JSON.stringify({id,projectId:'P',modelId:embedded.models[0].id,request:'剪开头',mode:'proposal'})});
  assert.equal(reply.status,202);
  assert.equal((await app.settle(id)).status,'proposed');
  assert.equal((await app.get('/agent/latest?projectId=P')).run.id,id);
  assert.equal(calls,2);
  assert.equal(app.store.read('P').revision,0);
  offer=false;
  assert.deepEqual((await fetch(bridge+'/models').then(r=>r.json())).models,[]);
  const forged=await fetch(app.base+'/agent/models',{headers:{'X-Cutdirector-Bridge':'1234:'+randomUUID(),'X-Cutdirector-Bridge-Proof':'0'.repeat(64)}});
  assert.equal(forged.status,403);
});
