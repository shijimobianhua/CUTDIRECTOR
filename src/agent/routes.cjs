'use strict';
const {createAgent,invalidateScope}=require('./loop.cjs');
const {providers}=require('./provider.cjs');
const {createSettings}=require('./model-settings.cjs');
const {bridgeFor,dshModels}=require('./dsh-models.cjs');
const {configuredDelegate}=require('./delegate.cjs');
const {fail}=require('../core/util.cjs');

function attach(server,{store,jobs,isActive,body,send,models,delegate}){
  let agent;
  const settings=createSettings(store.root);
  let configured;
  function getAgent(){
    agent??=createAgent({store,jobs,models:()=>[...settings.adapters(),...(models??(configured??=providers()))],delegate:delegate??configuredDelegate(),isActive});
    return agent;
  }
  server.agentProjectChanged=projectId=>agent?agent.switchProject(projectId):invalidateScope(store.root);
  server.agentRoute=async(req,res,url)=>{
    if(!url.pathname.startsWith('/agent/'))return false;
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host||''))fail('FORBIDDEN');
    if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)fail('FORBIDDEN');
    if(req.method==='POST'&&(req.headers['x-cutdirector']!=='agent-v1'||
        req.headers['content-type']?.split(';')[0]!=='application/json'))fail('FORBIDDEN');
    const runtime=getAgent();
    const id=url.searchParams.get('id');
    const projectId=url.searchParams.get('projectId');
    if(req.method==='GET'){
      switch(url.pathname){
        case '/agent/launcher':send(res,200,{product:'CUTDIRECTOR',protocol:3});return true;
        case '/agent/models':{
          const external=await dshModels(bridgeFor(req));
          send(res,200,{...runtime.capabilities(external),defaultId:settings.view().defaultId});return true;
        }
        case '/agent/model-settings':send(res,200,settings.view());return true;
        case '/agent/latest':send(res,200,{run:runtime.latest(projectId)});return true;
        case '/agent/conversations':send(res,200,runtime.conversations.list(projectId));return true;
        case '/agent/conversation':send(res,200,runtime.conversations.detail(projectId,id,url.searchParams.get('before')));return true;
        case '/agent/run':send(res,200,runtime.view(id));return true;
        case '/agent/memory':send(res,200,runtime.memory.view(projectId));return true;
        case '/agent/events':{
          let run=runtime.view(id),sequence=-1;
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
          const tick=()=>{
            if(run.sequence!==sequence){
              sequence=run.sequence;
              res.write('data: '+JSON.stringify(run)+'\n\n');
            }
            if(!['planning','executing'].includes(run.status))res.end();
          };
          const timer=setInterval(()=>{
            try {run=runtime.view(id);tick();}catch {res.end();}
          },350);
          res.on('close',()=>clearInterval(timer));
          tick();
          return true;
        }
      }
    }
    if(req.method==='POST'){
      const input=await body(req);
      if(!input||typeof input!=='object'||Array.isArray(input))fail('AGENT_INPUT_INVALID');
      switch(url.pathname){
        case '/agent/model-discover':send(res,200,await settings.discover(input));return true;
        case '/agent/model-settings':send(res,200,await settings.update(input));return true;
        case '/agent/conversations':send(res,201,runtime.conversations.create(input.projectId));return true;
        case '/agent/conversation/open':send(res,200,runtime.conversations.open(input.projectId,input.id));return true;
        case '/agent/run':send(res,202,runtime.start(input,
          typeof input.modelId==='string'&&input.modelId.startsWith('dsh-')?await dshModels(bridgeFor(req)):[]));return true;
        case '/agent/approve':send(res,202,runtime.approve(input.id,input.proposalId,await dshModels(bridgeFor(req))));return true;
        case '/agent/cancel':send(res,200,runtime.cancel(input.id));return true;
        case '/agent/resume':send(res,202,runtime.resume(input.id,await dshModels(bridgeFor(req))));return true;
        case '/agent/memory':send(res,200,runtime.memory.update(input));return true;
      }
    }
    fail('NOT_FOUND');
  };
}
module.exports={attach};
