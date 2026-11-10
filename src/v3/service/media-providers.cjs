'use strict';
const {issue}=require('./studio-store.cjs');
const {createMcp}=require('./mcp-client.cjs');
const {validateUrl}=require('./tool-connections.cjs');
const at=(v,path)=>String(path||'').split('.').filter(Boolean).reduce((a,k)=>a?.[k],v);
function mapped(value,scope){if(Array.isArray(value))return value.map(v=>mapped(v,scope));if(value&&typeof value==='object'){if(Object.keys(value).length===1&&typeof value.$value==='string'){const v=at(scope,value.$value);if(v===undefined)issue('TOOL_PARAMETERS_INVALID','模板引用的参数不存在：'+value.$value);return v;}return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapped(v,scope)]));}return value;}
async function bounded(response,max=4*1024*1024){let length=0;const chunks=[];if(!response.body)issue('TOOL_RESPONSE_INVALID');for await(const chunk of response.body){length+=chunk.length;if(length>max)issue('TOOL_RESPONSE_INVALID','工具返回内容过大。');chunks.push(chunk);}return Buffer.concat(chunks);}
function createProviders({fetcher=fetch}={}){
 async function request(c,key,path,body,{method=body?'POST':'GET',signal,limit=4*1024*1024,auth=true,headers={}}={}){
  const base=validateUrl(c.baseUrl,c.allowLocal===true),url=new URL(path||'',base.href.endsWith('/')?base:base.href+'/');
  if(url.origin!==base.origin)issue('TOOL_PARAMETERS_INVALID','接口路径必须属于已配置的服务。');
  let response;try{response=await fetcher(url,{method,redirect:'error',headers:{...(auth&&key?{[c.authHeader||'Authorization']:(c.authPrefix===undefined?'Bearer ':c.authPrefix)+key}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:signal||AbortSignal.timeout(120000)});}catch(e){if(signal?.aborted)issue('RUN_CANCELLED','已停止等待，请核对服务端状态。',409);issue('TOOL_NETWORK','服务暂时连不上，请检查地址和网络。',503);}
  if(!response.ok){await response.body?.cancel();issue(response.status===401||response.status===403?'TOOL_CREDENTIAL':'TOOL_HTTP','服务返回 '+response.status+'，请检查连接配置。',response.status===401?401:502);}
  const bytes=await bounded(response,limit);if(!bytes.length)return {};
  try{return JSON.parse(bytes.toString('utf8'));}catch{issue('TOOL_RESPONSE_INVALID','工具返回的不是 JSON。');}
 }
 async function mcp(c,key,action,input,signal){const client=await createMcp(c,key,{signal,fetcher});try{if(action==='probe')return {available:true,tools:(await client.list()).map(t=>({name:t.name,description:String(t.description||'').slice(0,400),inputSchema:t.inputSchema,annotations:t.annotations||null})),message:'MCP 已连接，尚未调用具体工具。'};const tools=await client.list(),tool=tools.find(t=>t.name===c.toolName);if(!tool)issue('TOOL_NOT_FOUND','这个 MCP 工具已被移除，请重新选择。');require('./tool-standard.cjs').validateValue(input,tool.inputSchema);const result=await client.call(c.toolName,input);if(result.isError)issue('TOOL_REMOTE_ERROR','工具报告执行失败，请先核对它的记录。');return {state:'complete',data:result.structuredContent||{text:(result.content||[]).filter(i=>i.type==='text').map(i=>i.text).join('\n')},artifacts:result.structuredContent?.artifacts||(result.content||[]).filter(i=>i.type==='image'&&typeof i.data==='string').map(i=>({kind:'image',base64:i.data}))};}finally{await client.close();}}
 async function graph(c,key,signal){if(c.workflow&&Object.keys(c.workflow).length)return c.workflow;if(c.workflowId){const r=await request(c,key,'/api/openapi/getJsonApiFormat',{apiKey:key,workflowId:c.workflowId},{signal});if(r.code!==0)issue('WORKFLOW_UNAVAILABLE','无法读取工作流，请确认它已在你的账号下可运行。');try{return JSON.parse(r.data.prompt);}catch{issue('WORKFLOW_FORMAT','请导入 API 格式工作流。');}}issue('WORKFLOW_REQUIRED','请选择工作流或导入 API 格式 JSON。');}
 function inspectGraph(g){if(!g||Array.isArray(g)||g.nodes||Object.keys(g).length>2000||Object.values(g).some(n=>!n||typeof n.class_type!=='string'||!n.inputs))issue('WORKFLOW_FORMAT','这是界面排版格式。请在 ComfyUI 导出 API 格式，或填写 RunningHub 工作流 ID 后读取。');return g;}
 function suggestions(g){inspectGraph(g);const map=[],imageNodes=[],audioNodes=[];for(const [id,n]of Object.entries(g)){if(/LoadImage/.test(n.class_type))imageNodes.push([id,n]);if(/LoadAudio/.test(n.class_type))audioNodes.push([id,n]);for(const field of Object.keys(n.inputs)){const source=({prompt:'input.prompt',text:/CLIPTextEncode/.test(n.class_type)?'input.prompt':null,seconds:'input.seconds',duration:'input.seconds',aspect_ratio:'input.ratio',seed:'input.seed',resolution:'input.resolution',mode:'input.mode'})[field];if(source&&!Array.isArray(n.inputs[field]))map.push({nodeId:id,fieldName:field,source});}}
  imageNodes.sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([id],i)=>map.push({nodeId:id,fieldName:'image',source:'images.'+i}));audioNodes.sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([id,n],i)=>map.push({nodeId:id,fieldName:Object.hasOwn(n.inputs,'audio')?'audio':'file',source:'audio.'+i}));return map;}
 async function probe(connection,key,signal){
  const c=connection.config,t=connection.manifest.transport;
  if(t.startsWith('mcp-'))return mcp({...c,transport:t},key,'probe',null,signal);
  if(['comfyui','runninghub'].includes(t)){const g=inspectGraph(await graph(c,key,signal));if(t==='comfyui'){const info=await request(c,key,'/object_info',undefined,{signal});const missing=[...new Set(Object.values(g).map(n=>n.class_type))].filter(n=>!info[n]);if(missing.length)return {available:false,message:'缺少节点：'+missing.slice(0,8).join('、'),missing};}
   return {available:true,message:'工作流结构已读取，请核对素材槽位。没有提交生成。',workflow:g,mappings:suggestions(g)};}
  if(t==='codex'||t==='dsh')return {available:false,message:'通过 DSH Host 检查此工具。'};
  if(['openai-image','ark-image','ark-video'].includes(t)){const r=await request(c,key,'models',undefined,{signal,limit:1024*1024});return {available:true,message:'服务已连接；模型是否具备所选媒体能力需要实际生成验证。',models:(r.data||[]).map(x=>({id:x.id,name:x.id})).slice(0,100)};}
  if(!c.http?.probe) return {available:true,level:'configured',message:'参数格式已检查；此工具没有只读连接检查，真实调用尚未验证。'};
  await request(c,key,c.http.probe.path,undefined,{signal});return {available:true,message:'只读连接检查完成，没有提交制作。'};
 }
 async function upload(c,key,ref,transport,signal){
  const form=new FormData();form.append('file',new Blob([ref.bytes],{type:ref.contentType}),ref.name);if(transport==='runninghub'){form.append('apiKey',key);form.append('fileType','input');}else form.append('overwrite','false');
  const r=await request(c,key,transport==='runninghub'?'/task/openapi/upload':'/upload/'+(ref.kind==='audio'?'audio':'image'),form,{signal});
  const name=transport==='runninghub'?r.data?.fileName:r.name;if(!name)issue('MEDIA_UPLOAD_FAILED','参考素材上传没有完成。');return name;
 }
 const dataUrl=r=>'data:'+r.contentType+';base64,'+r.bytes.toString('base64');
 async function submit(connection,key,snapshot,references,signal){
  const c=connection.config,t=connection.manifest.transport,input=snapshot.input;
  if(t.startsWith('mcp-'))return mcp({...c,transport:t},key,'execute',input,signal);
  if(t==='openai-image'){
   let r;if(references.length){const form=new FormData();form.append('model',c.model);form.append('prompt',input.prompt);form.append('n','1');if(input.size)form.append('size',input.size);for(const ref of references)form.append('image[]',new Blob([ref.bytes],{type:ref.contentType}),ref.name);for(const [k,v]of Object.entries(c.parameters||{}))form.append(k,String(v));r=await request(c,key,'images/edits',form,{signal,limit:36*1024*1024});}
   else r=await request(c,key,'images/generations',{...c.parameters,model:c.model,prompt:input.prompt,n:1,...(input.size?{size:input.size}:{})},{signal,limit:36*1024*1024});
   const item=r.data?.[0];if(!item)issue('TOOL_RESPONSE_INVALID');return {state:'complete',data:{text:'图片已生成，请检查后选用。'},artifacts:[{kind:'image',...(item.b64_json?{base64:item.b64_json}:{url:item.url})}]};
  }
  if(t==='ark-image'){const r=await request(c,key,'images/generations',{...c.parameters,model:c.model,prompt:input.prompt,size:input.size||'2K',response_format:'b64_json',output_format:'png',sequential_image_generation:'disabled',watermark:true,...(references.length?{image:references.length===1?dataUrl(references[0]):references.map(dataUrl)}:{})},{signal,limit:36*1024*1024});if(!r.data?.[0]?.b64_json)issue('TOOL_RESPONSE_INVALID');return {state:'complete',data:{text:'图片已生成，请检查后选用。'},artifacts:[{kind:'image',base64:r.data[0].b64_json}]};}
  if(t==='ark-video'){const content=[{type:'text',text:input.prompt},...references.map((r,i)=>({type:'image_url',image_url:{url:dataUrl(r)},role:input.mode==='keyframes'?(i?'last_frame':'first_frame'):'reference_image'}))];const r=await request(c,key,'contents/generations/tasks',{...c.parameters,model:c.model,content,duration:input.seconds||5,ratio:input.ratio||'9:16',generate_audio:input.audio!==false},{signal});if(!r.id)issue('TOOL_RESPONSE_INVALID');return {state:'queued',externalId:r.id};}
  if(t==='runninghub'||t==='comfyui'){
   const g=structuredClone(inspectGraph(await graph(c,key,signal))),scope={input,images:[],audio:[],references:[]};
   if(t==='runninghub'&&c.workflowId&&c.workflow){const latest=inspectGraph(await graph({...c,workflow:null},key,signal));if(require('./tool-standard.cjs').digest(latest)!==require('./tool-standard.cjs').digest(c.workflow))issue('WORKFLOW_CHANGED','服务端工作流已修改，请重新检查连接和本次调用。');}
   for(const ref of references){const name=await upload(c,key,ref,t,signal);(ref.kind==='audio'?scope.audio:scope.images).push(name);scope.references.push(name);}
   const bindings=c.mappings?.length?c.mappings:suggestions(g),nodeInfoList=[];
   for(const b of bindings){if(!g[b.nodeId]||!Object.hasOwn(g[b.nodeId].inputs,b.fieldName))issue('WORKFLOW_CHANGED','工作流节点或参数发生变化，请重新检查连接。');const value=at(scope,b.source);
    if(value===undefined){if(/^(images|audio)\./.test(b.source))issue('WORKFLOW_REFERENCE_MISSING','工作流需要更多素材，或仍有未关闭的素材槽位。请在接入设置核对。');continue;}
    g[b.nodeId].inputs[b.fieldName]=value;nodeInfoList.push({nodeId:String(b.nodeId),fieldName:b.fieldName,fieldValue:String(value)});}
   if(t==='runninghub'){if(!c.workflowId)issue('WORKFLOW_REQUIRED','RunningHub 需要填写你账号下的工作流 ID。');const r=await request(c,key,'/task/openapi/create',{apiKey:key,workflowId:c.workflowId,nodeInfoList,...(c.instanceType?{instanceType:c.instanceType}:{})},{signal});if(r.code!==0||!r.data?.taskId)issue('TOOL_REMOTE_ERROR','工作流提交被拒绝，请先核对服务端记录。');return {state:'queued',externalId:r.data.taskId};}
   const r=await request(c,key,'/prompt',{prompt:g,client_id:snapshot.jobId},{signal});if(!r.prompt_id)issue('WORKFLOW_FORMAT','工作流没有通过服务端检查。');return {state:'queued',externalId:r.prompt_id};
  }
  if(t==='http'){const scope={input,references:references.map(r=>({kind:r.kind,name:r.name,contentType:r.contentType,dataUrl:dataUrl(r)}))},h=c.http;if(!h?.submit)issue('CONNECTION_INVALID');
   const r=await request(c,key,h.submit.path,mapped(h.submit.body||{},scope),{method:h.submit.method||'POST',signal,limit:36*1024*1024});
   return normalizeHttp(r,h);
  }
  issue('TOOL_HOST_REQUIRED','这个工具需要通过 DSH Host 执行。');
 }
 function normalizeHttp(r,h){const externalId=h.taskIdPath?at(r,h.taskIdPath):null;if(externalId)return {state:'queued',externalId:String(externalId)};const found=h.artifactsPath?at(r,h.artifactsPath):[];const items=Array.isArray(found)?found:found?[found]:[];const artifacts=h.artifactMapping?items.map(item=>mapped(h.artifactMapping,{item,response:r})):items;return {state:'complete',data:h.dataMapping?mapped(h.dataMapping,{response:r}):{text:String(h.textPath?at(r,h.textPath)||'工具已完成。':'工具已完成。').slice(0,16000)},artifacts};}
 async function poll(connection,key,id,signal){
  const c=connection.config,t=connection.manifest.transport;
  if(t==='ark-video'){const r=await request(c,key,'contents/generations/tasks/'+encodeURIComponent(id),undefined,{signal});if(['failed','cancelled','expired'].includes(r.status))return {state:'failed'};return r.status==='succeeded'?{state:'complete',data:{text:'视频已生成。'},artifacts:[{kind:'video',url:r.content?.video_url}]}:{state:'running'};}
  if(t==='runninghub'){const r=await request(c,key,'/task/openapi/outputs',{apiKey:key,taskId:id},{signal});if(r.code===804||r.code===813)return {state:'running'};if(r.code!==0){const status=await request(c,key,'/task/openapi/status',{apiKey:key,taskId:id},{signal});if(['FAILED','CANCELLED'].includes(status.data))return {state:'failed'};return {state:'running'};}if(!Array.isArray(r.data))return {state:'running'};return {state:'complete',data:{text:'工作流已完成。'},artifacts:r.data.map(item=>({kind:/mp4|mov|video/i.test(item.fileType||item.fileUrl)?'video':/wav|mp3|audio/i.test(item.fileType||item.fileUrl)?'audio':'image',url:item.fileUrl}))};}
  if(t==='comfyui'){const r=await request(c,key,'/history/'+encodeURIComponent(id),undefined,{signal});const task=r[id];if(!task)return {state:'running'};if(task.status?.status_str==='error')return {state:'failed'};const artifacts=[];for(const output of Object.values(task.outputs||{}))for(const [kind,items]of [['image',output.images],['video',output.gifs||output.videos],['audio',output.audio]])for(const file of items||[])artifacts.push({kind,url:new URL('/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'}),c.baseUrl).href});return artifacts.length?{state:'complete',data:{text:'工作流已完成。'},artifacts}:{state:'running'};}
  if(t==='http'&&c.http?.status){const h=c.http,r=await request(c,key,h.status.path.replace('{id}',encodeURIComponent(id)),h.status.body?mapped(h.status.body,{externalId:id}):undefined,{method:h.status.method||'GET',signal});const state=at(r,h.statusPath);if((h.failedValues||['failed','cancelled']).includes(state))return {state:'failed'};if(!(h.doneValues||['complete','succeeded']).includes(state))return {state:'running'};return normalizeHttp(r,{...h,taskIdPath:null});}
  issue('TOOL_POLL_UNSUPPORTED','这个工具未提供任务查询，请到服务端核对结果。');
 }
 async function cancel(connection,key,id,signal){const c=connection.config,t=connection.manifest.transport;if(t==='runninghub')return request(c,key,'/task/openapi/cancel',{apiKey:key,taskId:id},{signal});
  // ComfyUI /interrupt is global. Only remove this queued job; running jobs remain unknown.
  if(t==='comfyui'){await request(c,key,'/queue',{delete:[id]},{signal});return {pendingOnly:true};}
  issue('TOOL_CANCEL_UNSUPPORTED','该工具不支持确认停止，请核对服务端任务。');}
 async function download(connection,url,signal){
  const c=connection.config,parsed=new URL(url),base=new URL(c.baseUrl||'https://invalid.example');
  const ark=connection.manifest.transport.startsWith('ark-')&&/^(?:[a-z0-9-]+\.)*tos-cn-(?:beijing|shanghai|guangzhou|zhangjiakou)\.volces\.com$/i.test(parsed.hostname);
  const allowed=parsed.origin===base.origin||(c.downloadHosts||[]).includes(parsed.hostname)||ark;
  if(!allowed||parsed.username||parsed.password||parsed.protocol!=='https:'&&!(parsed.origin===base.origin&&parsed.protocol==='http:'))issue('OUTPUT_HOST_REQUIRED','结果来自 '+parsed.hostname+'。请在该服务设置里允许这个下载域名，再取回结果。');
  const response=await fetcher(parsed,{redirect:'error',signal:signal||AbortSignal.timeout(120000)});if(!response.ok)issue('MEDIA_DOWNLOAD_FAILED','结果暂时无法下载，可稍后重新取回。');return bounded(response,256*1024*1024);
 }
 return {probe,submit,poll,cancel,download,graph,suggestions,request};
}
module.exports={createProviders,mapped,at,bounded};
