import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import codex from '../service/codex-executor.cjs';
import {extensionTools,callExtension} from './extensions.js';
import assistantModel from '../service/assistant-model.cjs';
export function createStudioHost(ctx,worker,dataRoot){
 const running=new Map(),logins=new Map();
 const call=async(path,method,input)=>{const response=await worker.call(path,method,input===undefined?undefined:JSON.stringify(input),{signal:AbortSignal.timeout(5*60*1000)});const value=await response.json();return {status:response.status,value};};

 async function runChat(base,turn){
  const c=new AbortController();running.set(turn.id,c);
  const signal=AbortSignal.any([c.signal,AbortSignal.timeout(180000)]);
  try{const answer=await assistantModel.answer(ctx.get?.('llm'),turn,signal);await call(base+'/'+turn.id+'/finish','POST',{state:'complete',answer});}
  catch(error){const failure=assistantModel.safeFailure(signal.aborted&&!c.signal.aborted?{code:'TIMEOUT'}:error);await call(base+'/'+turn.id+'/finish','POST',{state:c.signal.aborted?'cancelled':'failed',answer:c.signal.aborted?'已停止，输入仍在。':assistantModel.failureMessage(failure),failure:c.signal.aborted?{code:'ABORTED'}:failure}).catch(()=>{});}
  finally{running.delete(turn.id);}
 }
 async function nativeWork(){const root=join(dataRoot,'codex-diagnostics',randomUUID()),work={root,inputDir:join(root,'inputs'),outputDir:join(root,'outputs'),references:[]};await mkdir(work.inputDir,{recursive:true});await mkdir(work.outputDir,{recursive:true});return work;}
 async function external(route,input){
  const claimed=await call(route+'/claim','POST',input);if(claimed.status!==200||!claimed.value.data?.dispatch)return claimed;
  const {job,workspace}=claimed.value.data,connection=job.snapshot.connection,controller=new AbortController();running.set(job.id,controller);
  const execute=async()=>{try{
   let result;
   if(connection.manifest.transport==='codex'){
    workspace.executor=connection.config;
    result=await codex.runCodexImage({request:job.snapshot.input.prompt,ratio:job.snapshot.input.ratio||'9:16',frame:'start'},workspace,AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]));
   }else{
    const config=connection.config,tools=ctx.get?.('tools'),definition=(tools?.definitions?.()||[]).find(t=>t.name===config.toolName);
    if(!definition)throw Error('TOOL_NOT_FOUND');
    if(config.definitionDigest&&config.definitionDigest!==createHash('sha256').update(JSON.stringify(definition)).digest('hex'))throw Error('TOOL_DEFINITION_CHANGED');
    if(config.toolName.startsWith('cutdirector_adapter_'))result=await callExtension(ctx,config.toolName,{action:'execute',input:job.snapshot.input,workspace},controller.signal,dataRoot);
    else{
     const toolSet=await tools.resolve({signal:controller.signal});
     try{const response=await tools.execute({calls:[{id:randomUUID(),name:config.toolName,arguments:JSON.stringify(job.snapshot.input)}],signal:controller.signal,toolSet});
      const value=response.results?.[0]?.result;if(!value||value.isError)throw Error('TOOL_REMOTE_ERROR');
      result=typeof value.value==='object'?value.value:{text:String(value.value||'工具已完成。')};}
     finally{toolSet.dispose?.();}
    }
   }
   await call(route+'/external-finish','POST',{result});
  }catch(error){await call(route+'/external-finish','POST',{error:error.code||String(error.message||'TOOL_FAILED').slice(0,100)}).catch(()=>{});}finally{running.delete(job.id);}};
  execute().catch(()=>{});
  return {status:200,value:{data:{id:job.id,state:'submitting'}}};
 }
 async function handle(path,method,input){
  if(!path.startsWith('/studio/'))return null;
  if(path==='/studio/codex-login'&&method==='POST'){const work=await nativeWork();work.executor=input?.executor||{};const login=await codex.startCodexLogin(work,AbortSignal.timeout(310000)),id=randomUUID();logins.set(id,login);return {status:200,value:{data:{id,url:login.url,state:'pending'}}};}
  const loginStatus=/^\/studio\/codex-login\/([a-f0-9-]{36})$/.exec(path);if(loginStatus&&method==='GET')return {status:200,value:{data:logins.get(loginStatus[1])?.status()||{state:'expired'}}};
  if(path==='/studio/dsh-tools'&&method==='GET')return {status:200,value:{data:(ctx.get?.('tools')?.definitions?.()||[]).slice(0,300).map(d=>({name:d.name,description:String(d.description||'').slice(0,400),inputSchema:d.parameters||d.inputSchema||{type:'object'},definitionDigest:createHash('sha256').update(JSON.stringify(d)).digest('hex')}))}};
  if(path==='/studio/codex-diagnostics'&&method==='POST'){const work=await nativeWork();work.executor=input?.executor||{};return {status:200,value:{data:await codex.probeCodex(work,AbortSignal.timeout(60000))}};}
  const probe=/^\/studio\/connections\/([^/]+)\/probe$/.exec(path);
  if(probe&&method==='POST'){
   const found=await call('/studio/connections','GET'),connection=found.value.data?.find(c=>c.id===probe[1]);
   if(connection?.manifest.transport==='codex'){const work=await nativeWork();work.executor=connection.config;const hostResult=await codex.probeCodex(work,AbortSignal.timeout(60000));return call(path,method,{hostResult});}
   if(connection?.manifest.transport==='dsh'){const exists=(ctx.get?.('tools')?.definitions?.()||[]).some(t=>t.name===connection.config.toolName);return call(path,method,{hostResult:{available:exists,message:exists?'工具已在当前 DSH 中找到，没有执行。':'当前 DSH 中找不到这个工具。'}});}
  }
  const send=/^\/studio\/assistant\/chats\/[a-f0-9-]{36}\/turns$/.test(path);
  if(send&&method==='POST'){const result=await call(path,method,input);if(result.status===200&&result.value.data?.dispatch)runChat(path,result.value.data).catch(()=>{});return {status:result.status,value:result.status===200?{data:{id:result.value.data.id,state:result.value.data.state||'pending'}}:result.value};}
  const cancelled=/^\/studio\/assistant\/chats\/[a-f0-9-]{36}\/turns\/([a-f0-9-]{36})\/cancel$/.exec(path);
  if(cancelled)running.get(cancelled[1])?.abort();
  const approve=/^(\/studio\/projects\/[a-f0-9-]{36}\/jobs\/[a-f0-9-]{36})\/approve$/.exec(path);
  if(approve&&method==='POST'){const record=await call(approve[1],'GET');if(['codex','dsh'].includes(record.value.data?.snapshot?.transport))return external(approve[1],input);}
  const cancel=/^\/studio\/projects\/[a-f0-9-]{36}\/jobs\/([a-f0-9-]{36})\/cancel$/.exec(path);if(cancel)running.get(cancel[1])?.abort();
  return null;
 }
 return {handle,close(){for(const login of logins.values())login.close().catch(()=>{});logins.clear();for(const controller of running.values())controller.abort();running.clear();}};
}
