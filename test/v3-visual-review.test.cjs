'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {openStore}=require('../src/v3/service/store.cjs'),{build}=require('../tools/package-v3.cjs');
test('Visual review prepares actual pixels locally, sends image blocks after consent, records attachment evidence and dispatches once',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-visual-')),s=openStore(join(root,'data'));
 t.after(async()=>{await s.visual.stop();s.close();rmSync(root,{recursive:true,force:true});});
 const p=s.mutate('project',{commandId:'p',title:'Vision',kind:'idea'}),file=join(root,'frame.png');
 execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=green:s=160x90','-frames:v','1',file],{windowsHide:true});
 const bytes=readFileSync(file),digest=createHash('sha256').update(bytes).digest('hex');
 mkdirSync(join(root,'data','media'),{recursive:true});
 const image=s.mutate('image',{commandId:'image',projectId:p.id,digest,name:'frame.png',contentType:'image/png',size:bytes.length,width:160,height:90},()=>writeFileSync(join(root,'data','media',digest),bytes));
 const prepared=await s.visual.prepare(p.id,{commandId:'prepare',kind:'image',targetId:image.id,model:{provider:'fixture',id:'vision'}});
 assert.equal(prepared.state,'awaiting_approval');assert.equal(prepared.snapshot.frames.length,1);
 assert.throws(()=>s.visual.claim(p.id,prepared.id,{confirm:true}),{code:'VISUAL_APPROVAL_REQUIRED'});
 const pkg=build(join(root,'plugin'),join(root,'unused')),{reviewVisually}=await import(pathToFileURL(join(pkg,'host/visual-review.js')).href);
 let calls=0;
 const ctx={get:name=>name==='llm'?{prepareCall:async config=>({config,inputModalities:['text','image'],async *stream(request){
  calls++;const images=request.messages[1].content.filter(part=>part.type==='image');assert.equal(images.length,1);assert.match(images[0].attachment.attachmentId,/^sha256:/);
  yield {type:'text-delta',text:'只看到绿色画面，请人工确认素材内容。'};yield {type:'finish',reason:'stop'};
 }})}:{admitPromptContent:async content=>content.map(part=>part.type==='image'?{type:'image',attachment:{attachmentId:'sha256:'+createHash('sha256').update(Buffer.from(part.data,'base64')).digest('hex'),width:160,height:90}}:part)}};
 const worker={async call(route,method,body){const action=route.split('/').at(-1);try{return Response.json({data:await s.visual[action](p.id,prepared.id,JSON.parse(body))});}catch(e){return Response.json({error:{code:e.code}},{status:e.status||500});}}};
 const approval={confirm:true,allowUpload:true,allowUnknownCost:true};
 const result=await reviewVisually(ctx,worker,'/fixture',approval,AbortSignal.timeout(5000));
 assert.equal(result.value.data.state,'complete');assert.equal(result.value.data.result.framesSent.length,1);assert.equal(calls,1);
 await reviewVisually(ctx,worker,'/fixture',approval,AbortSignal.timeout(5000));assert.equal(calls,1);
 assert.equal(s.quality.list(p.id).length,0);
});
