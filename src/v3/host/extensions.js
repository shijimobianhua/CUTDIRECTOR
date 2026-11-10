import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import native from '../service/native-adapters.cjs';
import codex from '../service/codex-executor.cjs';
import {probeReadonlyAgent,runReadonlyAgent} from './delegation.js';
const prefix='cutdirector_adapter_';
export function extensionTools(ctx){
 const tools=ctx.get?.('tools');
 const external=(tools?.definitions?.()||[]).filter(tool=>tool.name.startsWith(prefix)&&/^[a-zA-Z0-9_]{1,120}$/.test(tool.name)&&!native.adapters.some(item=>item.name===tool.name)).map(tool=>({name:tool.name,description:String(tool.description||'').slice(0,300)}));
 return [...native.adapters.map(({name,description})=>({name,description,managed:true})),...external];
}
export async function callExtension(ctx,name,args,signal,dataRoot){
 const managed=native.adapters.find(item=>item.name===name);
 if(managed){
 if(args.action==='manifest')return structuredClone(managed.manifest);
 if(args.action==='probe'){
 const root=join(dataRoot,'adapter-probes',randomUUID()),work={root,inputDir:join(root,'inputs'),outputDir:join(root,'outputs'),references:[]};
 await mkdir(work.inputDir,{recursive:true});await mkdir(work.outputDir,{recursive:true});
 if(managed.manifest.pluginId==='cutdirector-native-codex-image')return codex.probeCodex(work,signal);
 try{return await probeReadonlyAgent(ctx,root,signal);}catch{return {available:false,message:'当前 DSH 的只读隔离接口尚未准备好。请更新 DSH 后重新检查，不会开放完整工具权限。'};}
 }
 if(args.action!=='execute'||!args.workspace)throw Error('EXTENSION_SCOPE_UNSUPPORTED');
 if(managed.manifest.pluginId==='cutdirector-native-codex-image')return codex.runCodexImage(args.input,args.workspace,signal);
 const choice=args.input.model,llm=ctx.get?.('llm');
 if(!choice||!(await llm?.listModels(choice.provider))?.some(model=>model.id===choice.id))throw Error('MODEL_UNAVAILABLE');
 const result=await runReadonlyAgent(ctx,args.input,args.workspace.root,choice,AbortSignal.any([signal,AbortSignal.timeout(90000)]));
 return {...result,state:'completed'};
 }
 const tools=ctx.get?.('tools');if(!extensionTools(ctx).some(tool=>tool.name===name))throw Error('EXTENSION_UNAVAILABLE');
 const definition=tools.definitions().find(tool=>tool.name===name),toolSet=await tools.resolve({signal});
 try{
 if(tools.definitions().find(tool=>tool.name===name)!==definition)throw Error('EXTENSION_CHANGED');
 const result=await tools.execute({calls:[{id:randomUUID(),name,arguments:JSON.stringify(args)}],signal,toolSet});
 const value=result.results?.[0]?.result;if(!value||value.isError)throw Error('EXTENSION_FAILED');
 if(JSON.stringify(value.value).length>128000)throw Error('EXTENSION_OUTPUT_TOO_LARGE');
 return value.value;
 }finally{toolSet.dispose?.();}
}
