'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto'),{openRpc,issue}=require('./codex-rpc.cjs');
const run=promisify(execFile),profile='cutdirector-task';
function findCodex(executor={}){
 if(executor.executable){if(path.isAbsolute(executor.executable)&&fs.existsSync(executor.executable)&&fs.statSync(executor.executable).isFile())return executor.executable;return null;}
 const roots=[path.join(process.env.LOCALAPPDATA||'','OpenAI','Codex','bin')],found=[];
 for(const root of roots)if(fs.existsSync(root))for(const name of fs.readdirSync(root)){const file=path.join(root,name,'codex.exe');if(fs.existsSync(file))found.push(file);}
 return found.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0]||null;
}
const linuxPath=value=>value.replace(/^([A-Za-z]):[\\/]/,(_,d)=>'/mnt/'+d.toLowerCase()+'/').replaceAll('\\','/');
function argumentsFor(work,backend=work.executor?.backend||'mxc'){
 const convert=backend==='wsl2'?linuxPath:v=>v.replaceAll('\\','/');
 const rules={':root':'deny',':minimal':'read',[convert(work.root)]:'read',[convert(work.outputDir)]:'write'};
 const table='{'+Object.entries(rules).map(([key,value])=>JSON.stringify(key)+'='+JSON.stringify(value)).join(',')+'}';
 return ['-c','default_permissions="'+profile+'"','-c','permissions.'+profile+'.filesystem='+table,'-c','permissions.'+profile+'.network.enabled=false',
 ...backend==='wsl2'?[]:['-c','windows.sandbox="'+backend+'"'],'-c','features.apps=false','-c','features.shell_tool=false','-c','features.view_image=false','-c','web_search="disabled"','app-server','--listen','stdio://'];
}
async function runtime(work,backend){
 const executor=work.executor||{};
 if(backend==='wsl2'){
  if(!/^[A-Za-z0-9_. -]{1,80}$/.test(executor.distro||''))throw Object.assign(issue('CODEX_WSL_REQUIRED'),{stage:'runtime'});
  const executable=path.join(process.env.SystemRoot||'C:/Windows','System32','wsl.exe'),prefix=['--distribution',executor.distro,'--exec',executor.executable||'codex'];
  return {executable,args:[...prefix,...argumentsFor(work,backend)],versionArgs:[...prefix,'--version'],backend,convert:linuxPath};
 }
 const executable=findCodex(executor);if(!executable)throw Object.assign(issue('CODEX_PROCESS_UNAVAILABLE'),{stage:'installation'});
 return {executable,args:argumentsFor(work,backend),versionArgs:['--version'],backend,convert:v=>v};
}
async function initialize(rpc){await rpc.request('initialize',{clientInfo:{name:'cutdirector',version:'0.3.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');}
async function verifyIsolation(rpc,work,backend='mxc'){
 const sentinelDir=path.join(path.dirname(work.root),'isolation-sentinels',path.basename(work.root));await fsp.mkdir(sentinelDir,{recursive:true});
 const outside=path.join(sentinelDir,'read-marker.txt');await fsp.writeFile(outside,'Public owned sandbox marker; not user data');
 const input=path.join(work.root,'isolation-input.txt');await fsp.writeFile(input,'Approved owned probe input');
 const output=path.join(work.outputDir,'isolation-ok.txt'),outsideWrite=path.join(sentinelDir,'denied-write.txt');
 let command;
 if(backend==='wsl2'){
  const script="import pathlib,json,sys\nr={}\nfor k,op,p in [('inputRead','r',sys.argv[1]),('outputWrite','w',sys.argv[2]),('outsideRead','r',sys.argv[3]),('outsideWrite','w',sys.argv[4])]:\n try:\n  pathlib.Path(p).read_text() if op=='r' else pathlib.Path(p).write_text('CUTDIRECTOR owned probe')\n  r[k]=True\n except Exception:r[k]=False\nprint(json.dumps(r))";
  command=['python3','-c',script,...[input,output,outside,outsideWrite].map(linuxPath)];
 }else{
  const script=path.join(work.root,'isolation-probe.ps1');await fsp.copyFile(path.join(__dirname,'isolation-probe.ps1'),script);
  command=[path.join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),'-NoProfile','-NonInteractive','-File',script,'-InputFile',input,'-OutsideFile',outside,'-OutputFile',output,'-OutsideWrite',outsideWrite];
 }
 const response=await rpc.request('command/exec',{command,cwd:backend==='wsl2'?linuxPath(work.root):work.root,permissionProfile:profile,timeoutMs:10000},15000);
 let result;try{result=JSON.parse(response.stdout);}catch{throw Object.assign(issue('CODEX_ISOLATION_UNAVAILABLE'),{stage:'isolation',diagnostic:{exitCode:response.exitCode,reason:String(response.stderr||'').replace(/(?:api[_-]?key|token|authorization)\s*[:=]\s*\S+/gi,'[redacted]').slice(0,500)}});}
 if(response.exitCode!==0||!result.inputRead||!result.outputWrite||result.outsideRead||result.outsideWrite)throw Object.assign(issue('CODEX_ISOLATION_UNAVAILABLE'),{stage:'isolation'});
 return {verified:true,inputRead:true,outputWrite:true,outsideRead:false,outsideWrite:false,profile,backend};
}
function reason(error){return {stage:error.stage||'protocol',code:error.code||'CODEX_UNAVAILABLE',detail:String(error.rpcMessage||error.diagnostic?.reason||'').replace(/(?:api[_-]?key|token|authorization)\s*[:=]\s*\S+/gi,'[redacted]').slice(0,600)};}
async function probeCodex(work,signal){
 const selected=work.executor?.backend||'auto',backends=selected==='auto'?['mxc','elevated']:[selected],attempts=[];
 for(const backend of backends){
  let rpc;
  try{
   const rt=await runtime(work,backend),{stdout}=await run(rt.executable,rt.versionArgs,{windowsHide:true,timeout:10000,maxBuffer:4096,signal});
   if(!/^codex-cli \d+\.\d+\./.test(stdout.trim()))throw Object.assign(issue('CODEX_VERSION_INVALID'),{stage:'installation'});
   rpc=openRpc(rt.executable,rt.args,{cwd:work.root,signal});await initialize(rpc);
   let account;try{account=await rpc.request('account/read',{refreshToken:false});}catch(e){throw Object.assign(e,{stage:'account'});}
   if(!account.account)throw Object.assign(issue('CODEX_ACCOUNT_REQUIRED'),{stage:'account'});
   const isolation=await verifyIsolation(rpc,work,backend);
   return {available:true,level:'executed',message:'Codex 已登录，'+(backend==='wsl2'?'WSL2':'Windows '+backend)+' 的任务目录隔离检查通过。图片工具及实际出图仍待首次生成验证。',version:stdout.trim(),backend,isolation,account:{loggedIn:true,type:account.account.type},imageGeneration:'not-tested',attempts};
  }catch(error){attempts.push({backend,...reason(error)});}
  finally{await rpc?.close();}
 }
 const last=attempts.at(-1),needsLogin=attempts.some(a=>a.code==='CODEX_ACCOUNT_REQUIRED');
 return {available:false,reason:last?.code||'CODEX_UNAVAILABLE',message:needsLogin?'Codex 尚未登录。请在所选环境登录后重新检查。':selected==='wsl2'?'WSL2 执行环境未准备好。请安装 WSL2、该环境的 Codex 和 Python 后再检查。':'Codex 的 Windows 受限执行环境未通过检查。可修复系统组件，或配置 WSL2；不会取消隔离要求。',attempts,imageGeneration:'not-tested'};
}
async function runCodexImage(snapshot,work,signal){
 const probe=await probeCodex(work,signal);if(!probe.available)throw issue(probe.reason||'CODEX_ISOLATION_UNAVAILABLE');
 const rt=await runtime(work,probe.backend),backend=rt.backend;let terminalResolve,terminalReject;
 const terminal=new Promise((resolve,reject)=>{terminalResolve=resolve;terminalReject=reject;});terminal.catch(()=>{});
 let threadId,turnId,imageItem,started=0,finished=false;
 const rpc=openRpc(rt.executable,rt.args,{cwd:work.root,signal,onNotification(message){
  const p=message.params||{};if(threadId&&p.threadId&&p.threadId!==threadId)return;if(turnId&&p.turnId&&p.turnId!==turnId)return;
  if(message.method==='item/started'&&p.item?.type==='imageGeneration'&&++started>1){rpc.request('turn/interrupt',{threadId,turnId}).catch(()=>{});terminalReject(issue('CODEX_IMAGE_BUDGET'));return;}
  if(message.method==='item/completed'&&p.item?.type==='imageGeneration'){if(p.item.failure){terminalReject(issue('CODEX_IMAGE_FAILED'));return;}imageItem=p.item;terminalResolve(p.item);}
  if(message.method==='turn/completed'){finished=true;if(!imageItem)terminalReject(issue(p.turn?.error?'CODEX_IMAGE_FAILED':'CODEX_IMAGE_MISSING'));}
 }});
 rpc.child.once('exit',()=>terminalReject(issue('CODEX_PROCESS_EXITED')));let deadline;const abort=()=>terminalReject(issue('RUN_CANCELLED'));
 try{
  await initialize(rpc);const isolation=await verifyIsolation(rpc,work,backend);
  const nativeConfig=await rpc.request('config/read',{includeLayers:false}),config={'features.image_generation':true,'features.apps':false,'features.shell_tool':false,'features.view_image':false,'web_search':'disabled'};
  for(const name of Object.keys(nativeConfig.config?.mcp_servers||{}))config['mcp_servers.'+name+'.enabled']=false;
  for(const name of Object.keys(nativeConfig.config?.plugins||{}))config['plugins.'+name+'.enabled']=false;
  const created=await rpc.request('thread/start',{cwd:rt.convert(work.root),ephemeral:true,approvalPolicy:'never',permissions:profile,runtimeWorkspaceRoots:[rt.convert(work.root)],environments:[],dynamicTools:[],config,
   developerInstructions:'Use only the native image generation tool to generate exactly one requested image. Read only the supplied image inputs. Do not use shell, apps, web, delegation, file editing or permission escalation. Stop after one image. The controller collects output.'});
  if(created.thread?.ephemeral!==true||created.activePermissionProfile?.id!==profile||created.approvalPolicy!=='never')throw issue('CODEX_ISOLATION_UNAVAILABLE');
  threadId=created.thread.id;const input=[{type:'text',text:snapshot.request+'\n画幅：'+snapshot.ratio+'。只生成一张'+(snapshot.frame==='end'?'结束':'开始')+'画面；由原生图像生成工具返回。'}];
  for(const ref of work.references||[])if(ref.kind==='image')input.push({type:'localImage',path:rt.convert(ref.path)});
  signal?.addEventListener('abort',abort,{once:true});deadline=setTimeout(()=>terminalReject(issue('CODEX_IMAGE_TIMEOUT')),180000);
  const turn=await rpc.request('turn/start',{threadId,input,permissions:profile},15000);turnId=turn.turn.id;
  const item=await terminal;const file='codex-generated.png',target=path.join(work.outputDir,file);let bytes;
  if(typeof item.result==='string'&&item.result.length){const encoded=item.result.replace(/^data:image\/[a-z]+;base64,/, '');if(encoded.length>36*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw issue('CODEX_IMAGE_INVALID');bytes=Buffer.from(encoded,'base64');}
  else if(typeof item.savedPath==='string'){
   let saved=item.savedPath,cache=path.join(process.env.CODEX_HOME||path.join(require('node:os').homedir(),'.codex'),'generated_images');
   if(backend==='wsl2'){
    const {stdout}=await run(rt.executable,['--distribution',work.executor.distro,'--exec','printenv','HOME'],{windowsHide:true,timeout:5000,maxBuffer:4096});
    const home=stdout.trim();if(!/^\/home\/[^/]+$|^\/root$/.test(home))throw issue('CODEX_ARTIFACT_UNAVAILABLE');
    cache='\\\\wsl.localhost\\'+work.executor.distro+home.replaceAll('/','\\')+'\\.codex\\generated_images';
    saved=/^\/mnt\/([a-z])\//.test(saved)?saved.replace(/^\/mnt\/([a-z])\//,(_,d)=>d.toUpperCase()+':/'):('\\\\wsl.localhost\\'+work.executor.distro+saved.replaceAll('/','\\'));
   }
   const source=await fsp.realpath(saved),allowed=[work.outputDir,cache];
   if(!allowed.some(root=>{const rel=path.relative(root,source);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);}))throw issue('CODEX_ARTIFACT_OUTSIDE_CACHE');
   const info=await fsp.lstat(saved);if(info.isSymbolicLink()||!info.isFile()||info.size>24*1024*1024)throw issue('CODEX_IMAGE_INVALID');bytes=await fsp.readFile(source);
  }else throw issue('CODEX_ARTIFACT_UNAVAILABLE');
  if(!bytes?.length||bytes.length>24*1024*1024)throw issue('CODEX_IMAGE_INVALID');
  await fsp.writeFile(target,bytes,{flag:'wx'});return {text:'Codex 原生出图已取回，请检查画面后选用。',state:'completed',artifacts:[{kind:'image',file,sha256:createHash('sha256').update(bytes).digest('hex')}],receipt:{threadId,turnId,imageId:item.id,source:'native-image-generation',isolation}};
 }finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);if(threadId&&turnId&&!finished)await rpc.request('turn/interrupt',{threadId,turnId},1500).catch(()=>{});await rpc.close();terminal.catch(()=>{});}
}

async function startCodexLogin(work,signal){
 const backend=work.executor?.backend==='wsl2'?'wsl2':'mxc',rt=await runtime(work,backend);
 let state='pending',rpc,timer,loginId;
 rpc=openRpc(rt.executable,rt.args,{cwd:work.root,signal,onNotification(message){if(message.method==='account/login/completed'&&(!loginId||message.params?.loginId===loginId)){state=message.params?.success?'complete':'failed';clearTimeout(timer);rpc.close().catch(()=>{});}}});
 try{await initialize(rpc);const result=await rpc.request('account/login/start',{type:'chatgpt'});loginId=result.loginId;
  const url=result.authUrl||result.verificationUrl;let parsed;try{parsed=new URL(url);}catch{throw issue('CODEX_LOGIN_UNAVAILABLE');}
  if(parsed.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth0.openai.com'].includes(parsed.hostname))throw issue('CODEX_LOGIN_UNAVAILABLE');
  timer=setTimeout(()=>{state='expired';rpc.close().catch(()=>{});},300000);timer.unref?.();
  return {url:parsed.href,status:()=>({state}),close:async()=>{clearTimeout(timer);if(state==='pending'&&loginId)await rpc.request('account/login/cancel',{loginId},2000).catch(()=>{});state=state==='complete'?'complete':'cancelled';await rpc.close();}};
 }catch(e){await rpc.close();throw e;}
}

module.exports={findCodex,argumentsFor,verifyIsolation,probeCodex,runCodexImage,startCodexLogin};
