'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomic,fail,hash}=require('../core/util.cjs');
const {brief,short}=require('./context.cjs');
const {version,policy}=require('./policy.cjs');
const {edits,proposal,digest,registry,object}=require('./tools.cjs');
const {createMemory}=require('./memory.cjs');
const {createConversations}=require('./conversations.cjs');
const {workflow,requestedDuration}=require('./intake.cjs');

const MAX_STEPS=8, MAX_RENDERS=2;
const definitions={
  转写:'转写就是把视频里说的话变成文字。这样我能找到重点，也能帮你做字幕。',
  草稿:'草稿是可以先看的剪辑版本。你可以继续提修改，满意后再采用。',
  撤销:'撤销可以让工程回到之前的剪辑状态。你可以在工程历史里选一个版本恢复。'
};
function quickReply(request,hasMedia){
  if(/^(?:你好(?:呀|啊)?|您好|嗨|哈[喽啰]|hi|hello)[！!。.\s]*$/i.test(request)){
    return hasMedia?'你好，我是你的剪辑导演。你可以直接说想怎么剪，比如「剪掉开头两秒」。':'你好，我是你的剪辑导演。先上传一段视频，然后告诉我想怎么剪。';
  }
  if(/^(?:请问[，,\s]*)?(?:怎么开始|怎么用|如何开始|你能做什么|你会做什么)[呀啊呢吗？?。！!\s]*$/.test(request)){
    return hasMedia?'可以先从一个小改动开始。比如说「剪掉开头两秒」，我会给你一份剪辑方案。':'先上传一段视频，然后用一句话告诉我想改哪里，比如「剪掉开头两秒」。';
  }
  const match=/^(?:请问[，,\s]*)?(?:什么是(转写|草稿|撤销)|(转写|草稿|撤销)(?:是什么(?:意思)?|什么意思))[呀啊呢吗？?。！!\s]*$/.exec(request);
  return match?definitions[match[1]||match[2]]:null;
}

const busy=new Set(['planning','executing']);
function text(value,max){
  if(typeof value!=='string'||!value.trim()||value.length>max)fail('AGENT_INPUT_INVALID');
  return value.trim();
}
function updateIntent(previous,input={}){
  if(!object(input))fail('AGENT_INPUT_INVALID');
  const intent={...previous};
  for(const [key,value] of Object.entries(input)){
    if(key==='targetSec'){
      if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>86400)fail('AGENT_INPUT_INVALID');
      intent[key]=value;
    }else if(key==='goal'){
      intent[key]=text(value,400);
    }else if(key==='mustKeep'){
      if(!Array.isArray(value)||value.length>12)fail('AGENT_INPUT_INVALID');
      intent[key]=value.map(item=>text(item,100));
    }else fail('AGENT_INPUT_INVALID');
  }
  return intent;
}

function invalidateScope(root){
  const value=randomUUID();
  atomic(path.join(root,'_agent','scope.json'),value);
  return value;
}
function createAgent({store,jobs,models,delegate,isActive=()=>true,specialized=true}){
  const root=path.join(store.root,'_agent');
  const active=new Map();
  const scopeFile=path.join(root,'scope.json');
  let scope=fs.existsSync(scopeFile)?JSON.parse(fs.readFileSync(scopeFile,'utf8')):null;
  const memory=createMemory(store,root);
  const tools=registry({jobs,delegate});
  const file=id=>{
    if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))fail('AGENT_INPUT_INVALID');
    return path.join(root,'runs',id+'.json');
  };
  const read=id=>{
    const location=file(id);
    if(!fs.existsSync(location))fail('NOT_FOUND');
    return JSON.parse(fs.readFileSync(location,'utf8'));
  };
  const view=id=>{
    const run=read(id);
    if(busy.has(run.status)&&!active.has(id))run.status='interrupted';
    return run;
  };
  const conversations=createConversations(store,root,view);
  function save(run,status){
    run.status=status;
    run.sequence++;
    atomic(file(run.id),run);
    return run;
  }
  const checkActive=run=>{
    if(!isActive(run.projectId)||(Object.hasOwn(run,'scope')&&run.scope!==scope))fail('PROJECT_CHANGED','当前视频已切换');
  };
  const sameRevision=run=>{
    checkActive(run);
    const p=store.read(run.projectId);
    if(p.revision!==run.revision)fail('REVISION_CONFLICT','工程已改变，请重新提案');
    return p;
  };
  const catalog=external=>[...external,...(typeof models==='function'?models():models)];
  const modelFor=(id,external=[],expected)=>{
    const model=catalog(external).find(m=>m.id===id&&(expected===undefined||m.version===expected));
    if(!model)fail('PROVIDER_NOT_READY','所选模型不可用或配置已更新，请重新选择模型');
    return model;
  };
  function queue(run,phase,execute){
    if(active.has(run.id))return view(run.id);
    const controller=new AbortController();
    save(run,phase);
    const entry={controller,projectId:run.projectId};
    active.set(run.id,entry);
    Promise.resolve().then(()=>execute(run,controller.signal)).catch(error=>{
      if(controller.signal.aborted)return;
      run.error={code:error.code||'AGENT_RUN_FAILED',message:short(error.message,320)};
      try {save(run,error.code==='REVISION_CONFLICT'||error.code==='PROJECT_CHANGED'?'stale':'failed');}
      catch {process.emitWarning('CUTDIRECTOR could not persist an Agent checkpoint');}
    }).finally(()=>active.delete(run.id));
    return run;
  }
  async function plan(run,signal,provider){
    provider??=modelFor(run.modelId,[],run.modelVersion);
    const enabled=Object.fromEntries(Object.entries(tools).filter(([,t])=>!t.enabled||t.enabled({run,provider})));
    let image;
    while(run.steps<MAX_STEPS){
      signal.throwIfAborted();
      const p=sameRevision(run);
      run.steps++;
      const preferences=memory.active(run.projectId);
      const context=brief(p,run,preferences,Object.fromEntries(Object.entries(enabled).map(([name,t])=>[name,t.description])));
      context.allowedEdits=edits;
      run.usedPreferences=context.preferences.map(x=>x.id);
      if(image)context.visual='image-attached';
      save(run,'planning');
      let output;
      try {
        if(run.actionCorrection)context.actionCorrection=run.actionCorrection;
        if(run.formatRetry)context.formatCorrection='上一次输出格式不符合要求。请只返回一个合法 JSON 对象，不能附加标题、说明或代码围栏。普通回复用 {"kind":"reply","text":"你的回复"}。';
        output=await provider.next({policy:policy(specialized),context,image,signal});
        if(!object(output)||!['reply','proposal','tool'].includes(output.kind))fail('MODEL_OUTPUT_INVALID');
      }catch(error){
        signal.throwIfAborted();
        if(error.code!=='MODEL_OUTPUT_INVALID'||run.formatRetry||run.steps>=MAX_STEPS)throw error;
        // Retrying keeps the same evidence and never grants additional tool permissions.
        run.formatRetry=true;
        continue;
      }
      image=undefined;
      signal.throwIfAborted();
      sameRevision(run);
      if(output.kind==='reply'){
        run.reply=text(output.text,1800);
        return save(run,'replied');
      }
      if(output.kind==='proposal'){
        try{
          // Older model adapters sometimes repeat the pinned revision inside trim params.
          if(output.op==='segment.trim'&&object(output.params)&&output.params.revision===run.revision){
            const {revision,...params}=output.params;
            output={...output,params};
          }
          run.proposal={...proposal(output,p,run),id:'P_'+randomUUID()};
        }catch(error){
          if(run.actionCorrection||run.steps>=MAX_STEPS||!['AGENT_SCOPE_INVALID','AGENT_PROPOSAL_INVALID'].includes(error.code))throw error;
          run.actionCorrection='上个方案未通过检查。检查片段标识和源范围。首尾修剪的 params 只填 inFrame 和 outFrame，不能加入 revision。不能安全提出动作时，回复用户需要明确的一个选择。';
          continue;
        }
        return save(run,run.mode==='proposal'?'proposed':'awaiting-approval');
      }
      if(output.kind!=='tool'||!Object.hasOwn(enabled,output.name)||!object(output.args))fail('AGENT_TOOL_INVALID');
      run.toolCalls=(run.toolCalls||0)+1;
      try {
        const result=await enabled[output.name].execute({args:output.args,project:p,run,signal});
        image=result.image;
        run.previous={tool:output.name,data:result.data};
      } catch(error){
        signal.throwIfAborted();
        if(output.name!=='dsh_analyze')throw error;
        delete enabled.dsh_analyze;
        run.previous={tool:output.name,error:'DSH_ANALYSIS_UNAVAILABLE'};
      }
    }
    fail('AGENT_STEP_BUDGET','任务达到步骤上限');
  }
  function completed(run,status,signal,provider){
    run.completedApprovals??=[];
    run.completedApprovals.push(run.proposal.id);
    run.pending=null;
    if(!run.proposal.more||run.steps>=MAX_STEPS)return save(run,status);
    run.revision=run.result.revision;
    const {jobId,revision,file,artifacts}=run.result;
    run.previous={completed:{op:run.proposal.op,jobId,revision,file,artifacts:artifacts?.slice(0,8).map(a=>a.name)}};
    run.proposal=null;
    save(run,'planning');
    return plan(run,signal,provider);
  }
  async function execute(run,signal,provider){
    signal.throwIfAborted();
    checkActive(run);
    const {payload,kind}=run.pending;
    if(kind==='edit'){
      const existing=store.envelope(run.projectId).ledger[payload.commandId];
      if(!existing)sameRevision(run);
      const result=store.apply(payload);
      const confirmed=store.envelope(run.projectId).ledger[payload.commandId];
      if(!confirmed||confirmed.result.revision!==result.revision)fail('AGENT_VERIFY_FAILED');
      run.result={commandId:result.commandId,revision:result.revision,affectedIds:result.affectedIds};
      return completed(run,'applied',signal,provider);
    }
    if(!jobs)fail('PROVIDER_NOT_READY','渲染服务未启动');
    const existing=jobs.jobs.find(j=>j.requestId===payload.requestId);
    if(!existing)sameRevision(run);
    const job=jobs.start(payload);
    run.pending.jobId=job.id;
    save(run,'executing');
    const finished=await jobs.settle(job.id);
    signal.throwIfAborted();
    sameRevision(run);
    if(finished.status!=='succeeded'){
      run.error={code:finished.error?.code||'RENDER_'+finished.status.toUpperCase(),message:'渲染未完成'};
      return save(run,'failed');
    }
    const result=digest(jobs,finished);
    if(finished.manifest.type!=='inspect'&&result.file!=='passed')fail('AGENT_VERIFY_FAILED','交付缺少通过的文件校验');
    run.result=result;
    return completed(run,'delivered',signal,provider);
  }
  const indexFile=projectId=>path.join(root,'conversations',projectId+'.json');
  function latest(projectId){
    store.read(projectId);
    const index=indexFile(projectId);
    return fs.existsSync(index)?view(JSON.parse(fs.readFileSync(index,'utf8')).id):null;
  }
  function start(input,external=[]){
    const {id,projectId,modelId,mode='edit',selection=[],allowFrame=false,allowDelegate=false,previousId,conversationId}=input;
    const request=text(input.request,2000);
    if(!['edit','proposal'].includes(mode)||typeof allowFrame!=='boolean'||typeof allowDelegate!=='boolean'||
        !Array.isArray(selection)||selection.length>100||new Set(selection).size!==selection.length)fail('AGENT_INPUT_INVALID');
    const signature=hash({projectId,modelId,mode,selection,allowFrame,allowDelegate,request,intent:input.intent??null,previousId:previousId??null,...(conversationId===undefined?{}:{conversationId})});
    if(fs.existsSync(file(id))){
      const old=view(id);
      if(old.signature!==signature)fail('COMMAND_ID_CONFLICT');
      return old;
    }
    const p=store.read(projectId);
    checkActive({projectId});
    if(selection.some(id=>!p.clips.some(c=>c.id===id)))fail('AGENT_SCOPE_INVALID');
    if(conversationId!==undefined&&(typeof conversationId!=='string'||!conversationId||previousId!==undefined))fail('AGENT_INPUT_INVALID');
    const history=conversationId?conversations.previous(projectId,conversationId):[];
    const prior=conversationId?history.at(-1):previousId?view(previousId):null;
    if(prior&&prior.projectId!==projectId)fail('AGENT_SCOPE_INVALID');
    if(prior&&['planning','executing','awaiting-approval','interrupted'].includes(prior.status))fail('AGENT_STATE_CONFLICT','请先结束或取消上一项任务');
    const targetSec=conversationId&&(requestedDuration(request)||(!prior?.intent?.targetSec&&
      history.slice().reverse().map(turn=>requestedDuration(turn.request)).find(Boolean)));
    const intent=updateIntent(updateIntent(prior?.intent,targetSec?{targetSec}:{}),input.intent);
    const localReply=quickReply(request,p.clips.length>0);
    const local=localReply?{reply:localReply}:conversationId?workflow(p,{request,selection,revision:p.revision,intent},history):null;
    const provider=local?null:modelFor(modelId,external);
    const run={schemaVersion:1,id,signature,projectId,scope,revision:p.revision,modelId,modelVersion:provider?.version,modelSource:provider?.source||'local',mode,selection,request,allowFrame,allowDelegate,
      conversationId,createdAt:new Date().toISOString(),intent,policyVersion:version,sequence:0,steps:0,renders:0};
    if(history.length)run.history=history.map(turn=>({request:short(turn.request,300),reply:short(turn.reply||turn.proposal?.text,300)}));
    if(prior)run.previous={request:short(prior.request,300),reply:short(prior.reply,300),
      result:prior.result?{revision:prior.result.revision,jobId:prior.result.jobId}:null};
    if(local?.proposal)run.proposal={...proposal(local.proposal,p,run),id:'P_'+randomUUID()};
    if(local?.reply)run.reply=local.reply;
    if(local?.guidance)run.guidance=local.guidance;
    if(conversationId)conversations.register(run);
    const started=local?save(run,run.proposal?(mode==='proposal'?'proposed':'awaiting-approval'):'replied'):
      queue(run,'planning',(run,signal)=>plan(run,signal,provider));
    atomic(indexFile(projectId),{id:run.id});
    return started;
  }
  function approve(id,proposalId,external=[]){
    const run=view(id);
    if(run.completedApprovals?.includes(proposalId))return run;
    if(run.proposal?.id!==proposalId||run.mode!=='edit')fail('AGENT_APPROVAL_INVALID');
    if(['executing','applied','delivered'].includes(run.status))return run;
    if(run.status!=='awaiting-approval')fail('AGENT_STATE_CONFLICT');
    const p=sameRevision(run);
    const {op,target,params}=proposal(run.proposal,p,run);
    if(op==='render'){
      if(run.renders>=MAX_RENDERS)fail('AGENT_RENDER_BUDGET');
      run.renders++;
      run.pending={kind:'render',payload:{projectId:run.projectId,revision:run.revision,requestId:'R_'+randomUUID(),type:params.type}};
    }else{
      run.pending={kind:'edit',payload:{projectId:run.projectId,baseRevision:run.revision,commandId:'C_'+randomUUID(),actor:'agent',op,target,params}};
    }
    const provider=run.proposal?.more?catalog(external).find(m=>m.id===run.modelId&&m.version===run.modelVersion):undefined;
    return queue(run,'executing',(run,signal)=>execute(run,signal,provider));
  }
  function cancel(id){
    const run=view(id);
    if(!['planning','executing','awaiting-approval','interrupted','failed'].includes(run.status))return run;
    active.get(id)?.controller.abort();
    if(run.pending?.jobId)jobs?.cancel(run.pending.jobId);
    return save(run,'cancelled');
  }
  function resume(id,external=[]){
    const run=view(id);
    if(run.status==='interrupted'||run.status==='failed'&&!run.pending&&
       ['DSH_MODEL_UNAVAILABLE','PROVIDER_NOT_READY','MODEL_TIMEOUT','MODEL_UNREACHABLE','MODEL_CREDENTIAL_INVALID'].includes(run.error?.code)){
      const provider=run.pending&&!run.proposal?.more?undefined:modelFor(run.modelId,external,run.modelVersion);
      delete run.error;
      return queue(run,run.pending?'executing':'planning',(run,signal)=>
        run.pending?execute(run,signal,provider):plan(run,signal,provider));
    }
    if(run.status!=='failed'||run.pending?.kind!=='render')fail('AGENT_STATE_CONFLICT');
    sameRevision(run);
    if(run.renders>=MAX_RENDERS)fail('AGENT_RENDER_BUDGET');
    run.renders++;
    run.pending={kind:'render',payload:{...run.pending.payload,requestId:'R_'+randomUUID()}};
    delete run.error;
    const provider=run.proposal?.more?catalog(external).find(m=>m.id===run.modelId&&m.version===run.modelVersion):undefined;
    return queue(run,'executing',(run,signal)=>execute(run,signal,provider));
  }
  function switchProject(projectId){
    scope=invalidateScope(store.root);
    for(const [id,entry] of active)if(entry.projectId!==projectId)cancel(id);
  }
  return {start,view,latest,approve,cancel,resume,switchProject,memory,conversations,
    capabilities:(external=[])=>({models:catalog(external).map(({id,model,vision,source,label})=>({id,model,label:label||model,source:source||"local",vision:!!vision})),dsh:delegate?.isolated===true})};
}
module.exports={createAgent,invalidateScope};
