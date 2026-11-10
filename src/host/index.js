import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import writer from './writer.cjs';
import {startDelegate} from './delegate.js';
import {startModelBridge} from './model-bridge.js';
export const inject=['tools','webServer','skills'];
export function apply(ctx,config={}) {
 let modelBridge;
 const base=String(config.adapterUrl||'http://127.0.0.1:7793').replace(/\/+$/,''); let projectId=config.projectId||'P';
 const lifecycle=writer.writerLifecycle(base,config,import.meta.url);
 const icon=readFileSync(new URL('./icon.svg',import.meta.url));
 // Keep registration synchronous. Routes and tools await the same startup attempt.
 lifecycle.ensure().catch(()=>{});
 async function api(route,method='GET',data,signal) {await lifecycle.ensure();if(route!=='/project/open'){const active=await fetch(base+'/active',{signal});if(active.ok){projectId=(await active.json()).projectId;if(route.includes('projectId=')){const u=new URL(route,base);u.searchParams.set('projectId',projectId);route=u.pathname+u.search;}if(data?.projectId&&data.projectId!==projectId)throw Object.assign(new Error('PROJECT_CHANGED: active project changed; reread before writing'),{code:'PROJECT_CHANGED'});}}const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal}); const value=await r.json(); if(!r.ok) throw Object.assign(new Error(value.code+': '+value.message),value);return value;}
 const skillNames=['video-editing','footage-intake','talking-head-roughcut','render-qa','revise'];
 const skillInfo=skillNames.map(name=>{const file=new URL(`../../skills/${name}/SKILL.md`,import.meta.url),content=readFileSync(file,'utf8');return {name,path:file.pathname,content,description:content.match(/^description: (.+)$/m)[1],hash:createHash('sha256').update(content).digest('hex')};});
 const tools=[
  {name:'video_project_read',description:'Read authoritative project, revision, selected segment IDs and history before editing.',parameters:{},execute:(_,exec)=>api('/project?projectId='+encodeURIComponent(projectId),'GET',null,exec?.signal)},
  {name:'video_project_apply',description:'Apply a command using observed baseRevision and stable commandId. Conflicts require reread; never force. Returns actual before/after diff.',parameters:{baseRevision:{type:'integer',required:true},commandId:{type:'string',required:true},op:{type:'string',required:true},target:{type:'string',required:true},params:{type:'object',required:true}},execute:(args,exec)=>api('/command','POST',{...args,projectId,actor:'agent'},exec?.signal)},
  {name:'video_render_start',description:'Render a captured revision to H264 MP4 and external UTF8 SRT. Reuse requestId for identical retry.',parameters:{revision:{type:'integer',required:true},requestId:{type:'string',required:true},type:{type:'string',required:true}},execute:(args,exec)=>api('/render','POST',{...args,projectId},exec?.signal)},
  {name:'video_job_read',description:'Read rendering status and revision-bound published artifacts. Failed and incomplete outputs are never published.',parameters:{id:{type:'string',required:true}},execute:(args,exec)=>api('/job?id='+encodeURIComponent(args.id),'GET',null,exec?.signal)},
  {name:'video_inspect',description:'Extract hash-bound source segment summaries, keyframes and up to five-second previews. Poll job and read segments.json via artifact.',parameters:{revision:{type:'integer',required:true},requestId:{type:'string',required:true}},execute:(args,exec)=>api('/render','POST',{...args,projectId,type:'inspect'},exec?.signal)},
  {name:'video_artifact_read',description:'Read a published JSON report/segment evidence or UTF8 SRT. Binary evidence is available at the returned artifact URL.',parameters:{id:{type:'string',required:true},name:{type:'string',required:true}},execute:async(args,exec)=>{const url='/artifact?id='+encodeURIComponent(args.id)+'&name='+encodeURIComponent(args.name);if(!/\.(json|srt)$/.test(args.name))return {url:'/video-agent'+url};await lifecycle.ensure();const r=await fetch(base+url,{signal:exec?.signal});if(!r.ok)throw new Error(await r.text());const text=await r.text();return args.name.endsWith('.json')?JSON.parse(text):{text};}},
  {name:'video_transcribe',description:'Run configured local ASR intake. No provider returns PROVIDER_NOT_READY. Explicit VIDEO_ASR_FIXTURE is hash-bound fixture replay, never real recognition.',parameters:{baseRevision:{type:'integer',required:true},commandId:{type:'string',required:true},assetId:{type:'string',required:true}},execute:(args,exec)=>api('/asr','POST',{...args,projectId},exec?.signal)},
  {name:'video_job_cancel',description:'Cancel an unsettled render or inspection job; poll until terminal.',parameters:{id:{type:'string',required:true}},execute:(args,exec)=>api('/job/cancel','POST',args,exec?.signal)},
  {name:'video_job_retry',description:'Append an attempt to failed, interrupted or cancelled job. Concurrent retry rejects.',parameters:{id:{type:'string',required:true}},execute:(args,exec)=>api('/job/retry','POST',args,exec?.signal)},
  {name:'video_capabilities',description:'Read available command, provider and skill provenance boundaries.',parameters:{},execute:()=>({skills:skillInfo.map(({content,path,...s})=>s),commands:['captions.generate','caption.correct','segment.trim','segment.reorder','roughcut.apply','batch','revision.restore','feedback.add'],asr:'Local provider absent by default; explicit fixture replay only',unsupported:['new segment instances/splits','multitrack','speed changes'],jobs:'local authoritative writer; DSH runtime job mapping unverified'})},
  {name:'video_projects_read',description:'List reopenable local projects.',parameters:{},execute:(_,exec)=>api('/projects','GET',null,exec?.signal)},
  {name:'video_project_open',description:'Switch page and Agent to an existing project after verifying it exists.',parameters:{projectId:{type:'string',required:true}},execute:async(args,exec)=>{await api('/project/open','POST',args,exec?.signal);return api('/project','GET',null,exec?.signal);}},
  {name:'video_deliveries_read',description:'List version-bound artifacts and reports for current project.',parameters:{},execute:(_,exec)=>api('/deliveries?projectId='+encodeURIComponent(projectId),'GET',null,exec?.signal)}
 ];
 const normalizeParams=(spec={})=>{
  if(spec.type==='object') return spec;
  const properties={}, required=[];
  for(const [key,value] of Object.entries(spec)){
   const {required:isRequired,...schema}=value;
   properties[key]=schema;
   if(isRequired) required.push(key);
  }
  return {type:'object',properties,...(required.length?{required}:{})};
 };
 for(const tool of tools) tool.parameters=normalizeParams(tool.parameters);
 for(const tool of tools) tool.presentCall=()=>({card:'generic',title:tool.name,kind:tool.name.endsWith('read')?'read':'edit'});
 const renderOutput=(value)=>[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}];
 for(const tool of tools) tool.output={schema:{type:'object',additionalProperties:true,properties:{}},render:(_args,value)=>renderOutput(value)};
 async function route(req,res) {
  try {
   const u=new URL(req.url,'http://localhost'); const suffix=u.pathname.slice('/video-agent'.length);
   if(suffix==='/icon.svg'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-cache'});return res.end(icon);}
   await lifecycle.ensure();
   if(['/','/workbench.js','/agent.js','/workbench.css','/upload'].includes(suffix)&&((suffix==='/upload'&&req.method==='POST')||(suffix!=='/upload'&&req.method==='GET'))){
    const upstream=await fetch(base+suffix+u.search,{method:req.method,...(suffix==='/upload'?{body:req,duplex:'half',headers:{'Content-Type':'application/octet-stream'}}:{})});
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'"});
    for await(const chunk of upstream.body)res.write(chunk);return res.end();
   }

   if(suffix==='/project/open'&&req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks));const read=await api('/project/open','POST',b);projectId=b.projectId;res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(read));}
   if(['/agent/models','/agent/run','/agent/events','/agent/approve','/agent/cancel','/agent/resume','/agent/memory','/agent/latest','/agent/conversations','/agent/conversation','/agent/conversation/open','/agent/model-settings','/agent/model-discover'].includes(suffix)){
    if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)){res.writeHead(403);return res.end();}
    const post=req.method==='POST';
    const upstream=await fetch(base+suffix+u.search,{method:req.method,signal:AbortSignal.timeout(60000),
     headers:{...modelBridge?.headers(),...(post?{'Content-Type':req.headers['content-type']||'','X-Cutdirector':req.headers['x-cutdirector']||''}:{})},
     ...(post?{body:req,duplex:'half'}:{})});
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-cache'});
    for await(const chunk of upstream.body)res.write(chunk);
    return res.end();
   }
   const active=await fetch(base+'/active');if(active.ok)projectId=(await active.json()).projectId;
   if(!['/active','/media','/transcript/srt','/asr/status','/projects','/deliveries','/project','/command','/selection','/asr','/render','/job','/job/cancel','/job/retry','/artifact'].includes(suffix)) {res.writeHead(404);return res.end();}
   const chunks=[];let size=0; for await(const c of req){size+=c.length;if(size>2*1024*1024) throw new Error('Body too large');chunks.push(c);}
   let payload=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
   if(suffix==='/command') payload={...payload,projectId:payload.projectId||projectId,actor:'human'};
   if(suffix==='/selection')payload={...payload,projectId:payload.projectId||projectId};
   // Preserve explicit project identity and baseRevision from the visible workbench.
   if(payload?.projectId&&payload.projectId!==projectId&&payload.op!=='project.import'){res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({code:'PROJECT_CHANGED',message:'Active project changed; reread before writing'}));}
   if(!u.searchParams.has('projectId'))u.searchParams.set('projectId',projectId);
   const upstream=await fetch(base+suffix+u.search,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.range?{Range:req.headers.range}:{})},body:payload?JSON.stringify(payload):undefined});
   const headers={'Content-Type':upstream.headers.get('content-type')||'application/json'};for(const name of ['content-length','content-range','accept-ranges'])if(upstream.headers.has(name))headers[name]=upstream.headers.get(name);
   res.writeHead(upstream.status,headers); for await(const chunk of upstream.body) res.write(chunk);res.end();
  } catch(e){res.writeHead(e.status||502,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code||'UPSTREAM_ERROR',message:e.message}));}
 }
 ctx.effect(()=>{
  const off=tools.map(t=>ctx.tools.register(t));off.push(ctx.webServer.register({kind:'prefix',path:'/video-agent',handler:route}));
  for(const name of ['video-editing','footage-intake','talking-head-roughcut','render-qa','revise']) {const file=new URL(`../../skills/${name}/SKILL.md`,import.meta.url);off.push(ctx.skills.register({name,description:readFileSync(file,'utf8').match(/^description: (.+)$/m)[1],whenToUse:'Video editing and revision requests',content:readFileSync(file,'utf8'),source:'runtime',path:file.pathname,invocation:{modelInvocable:true,userInvocable:true}}));}
  modelBridge=startModelBridge(ctx);
  if(modelBridge)off.push(()=>modelBridge.close());
  const stopDelegate=startDelegate(ctx);
  if(stopDelegate)off.push(stopDelegate);
  return ()=>off.forEach(f=>f());
 },'video-agent: shared command bridge');
}
