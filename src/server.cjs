'use strict';
const http=require('node:http'); const fs=require('node:fs'); const {ProjectStore}=require('./core/store.cjs'); const {fail}=require('./core/util.cjs');
const send=(res,status,value)=>{const b=JSON.stringify(value); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(b);};
async function body(req) {const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>2*1024*1024)fail('VALIDATION_ERROR','Body too large');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('VALIDATION_ERROR','Invalid JSON');}}
function createServer(store,{jobs,models,delegate}={}) {
 const selections=new Map(); let activeProjectId=store.list()[0]?.projectId||'P'; const server=http.createServer(async(req,res)=>{
  try {
   const u=new URL(req.url,'http://localhost');
   if(req.headers.origin&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) fail('FORBIDDEN');
   if(req.method==='GET'&&u.pathname==='/health') return send(res,200,{ok:true});
   if(req.method==='GET'&&u.pathname==='/active')return send(res,200,{projectId:activeProjectId});
   if(req.method==='POST'&&u.pathname==='/project/open'){const b=await body(req);store.read(b.projectId);if(activeProjectId!==b.projectId){server.agentProjectChanged?.(b.projectId);activeProjectId=b.projectId;}return send(res,200,{projectId:activeProjectId});}
   if(req.method==='POST'&&u.pathname==='/upload'){const result=await require('./upload.cjs').upload(req,store);if(activeProjectId!==result.projectId){server.agentProjectChanged?.(result.projectId);activeProjectId=result.projectId;}return send(res,200,result);}
   if(server.webRoute&&server.webRoute(req,res,u))return;
   if(req.method==='GET'&&u.pathname==='/projects')return send(res,200,{projects:store.list()});
   const projectId=u.searchParams.get('projectId')||activeProjectId;
   if(req.method==='GET'&&u.pathname==='/project') {const project=store.read(projectId);return send(res,200,{project,selection:selections.get(projectId)||[],history:store.history(projectId).map(({snapshot,...h})=>h),mediaStatus:project.media.map(a=>({id:a.id,code:fs.existsSync(a.workingMedia?.path||a.path)?'AVAILABLE':'MEDIA_MISSING'}))});}
   if(req.method==='POST'&&u.pathname==='/command') {const b=await body(req);return send(res,200,b.op==='transcript.asr'?await require('./intake-routes.cjs').command(store,b):store.apply(b));}
   // Validation/preview only. Persist the returned operation through /command.
   if(req.method==='POST'&&u.pathname==='/transcript/srt') {const b=await body(req);return send(res,200,{entries:require('./core/srt.cjs').parseSrt(b.srt),op:'transcript.srt'});}
   if(req.method==='POST'&&u.pathname==='/selection') {const b=await body(req),p=store.read(b.projectId); if(!Array.isArray(b.segmentIds)||b.segmentIds.some(id=>!p.clips.some(s=>s.id===id))) fail('TARGET_NOT_FOUND'); selections.set(p.projectId,b.segmentIds); return send(res,200,{ok:true});}
   if(server.agentRoute&&await server.agentRoute(req,res,u))return;
   if(server.intakeRoute&&await server.intakeRoute(req,res,u)) return;
   if(server.renderRoute&&await server.renderRoute(req,res,u)) return;
   send(res,404,{code:'NOT_FOUND'});
  } catch(e) {send(res,['REVISION_CONFLICT','COMMAND_ID_CONFLICT','WRITER_LOCKED','PROJECT_CHANGED','AGENT_STATE_CONFLICT'].includes(e.code)?409:e.code==='PROVIDER_NOT_READY'?503:e.code==='NOT_FOUND'?404:e.code==='FORBIDDEN'?403:400,{code:e.code||'INTERNAL_ERROR',message:e.message,currentRevision:e.currentRevision});}
 }); require('./intake-routes.cjs').attach(server,store);require('./web-routes.cjs').attach(server,store);require('./agent/routes.cjs').attach(server,{store,jobs,models,delegate,body,send,isActive:id=>id===activeProjectId});return server;
}
module.exports={createServer,body,send};
if(require.main===module) {
 const store=new ProjectStore(process.env.VIDEO_DATA||'.m1-data',{recoverStale:true});
 try {if(process.argv[2]==='--import') store.create(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));}
 catch(e){store.close();throw e;}
 const {Jobs}=require('./core/jobs.cjs'); const jobs=new Jobs(require('node:path').join(store.root,'renders'),store); const server=createServer(store,{jobs}); require('./render-routes.cjs').attach(server,jobs);
 server.on('error',e=>{console.error(e.message);store.close();process.exitCode=1;});
 server.listen(Number(process.env.PORT||7793),'127.0.0.1',()=>console.log('CUTDIRECTOR writer http://127.0.0.1:'+server.address().port));
 let stopping=false;
 for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{if(stopping)return;stopping=true;for(const id of jobs.controllers.keys())jobs.cancel(id);await Promise.allSettled([...jobs.pending.values()]);server.close(()=>{store.close();process.exit(0);});});
}
module.exports={createServer,body,send};
