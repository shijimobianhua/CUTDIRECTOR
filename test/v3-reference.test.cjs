'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync,readFileSync,writeFileSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{execFileSync}=require('node:child_process'),{Readable}=require('node:stream');
const {openStore}=require('../src/v3/service/store.cjs'),{ingest}=require('../src/v3/service/media.cjs');
const {createReferenceAnalyzer}=require('../src/v3/service/reference-analyzer.cjs');
test('Reference videos stay outside content, local FFmpeg returns real frames and cuts, explicit reuse preserves source and scopes',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-reference-')),store=openStore(root);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const file=join(root,'fixture.mp4');
 execFileSync(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x90:d=1','-f','lavfi','-i','color=c=blue:s=160x90:d=1',
 '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true});
 const p=store.mutate('project',{commandId:'p',title:'Reference',kind:'idea'}),other=store.mutate('project',{commandId:'o',title:'Other',kind:'idea'});
 const req=Readable.from([readFileSync(file)]);req.headers={'content-type':'application/octet-stream'};
 const ref=await ingest(req,root,store.references.ingestStore,p.id,'upload-reference','ref.mp4');
 assert.equal(ref.purpose,'reference');assert.deepEqual(store.projectAssets(p.id),[]);
 const analyzer=createReferenceAnalyzer(root,store.references);
 await assert.rejects(analyzer.analyze(p.id,ref.id,{}),{code:'REFERENCE_ANALYSIS_APPROVAL_REQUIRED'});
 assert.throws(()=>store.references.file(other.id,ref.id),{code:'REFERENCE_NOT_FOUND'});
 const result=await analyzer.analyze(p.id,ref.id,{confirm:true});
 assert.equal(result.visualReviewed,false);assert.equal(result.frames.length,2);
 assert.ok(result.cutTimesUs.some(time=>time>900000&&time<1100000));
 for(const frame of result.frames){const bytes=readFileSync(join(root,'media',frame.digest));assert.equal(bytes[0],255);assert.equal(bytes[1],216);}
 assert.deepEqual(store.projectAssets(p.id),[]);
 assert.throws(()=>store.references.use(p.id,ref.id,{commandId:'use'}),{code:'REFERENCE_USE_APPROVAL_REQUIRED'});
 const asset=store.references.use(p.id,ref.id,{commandId:'use',confirm:true});
 assert.equal(asset.source,'reference-copy');assert.equal(store.projectAssets(p.id).length,1);
 assert.deepEqual(store.references.use(p.id,ref.id,{commandId:'use',confirm:true}),asset);
 const source=store.references.file(p.id,ref.id);
 const bytes=readFileSync(join(root,'media',source.digest));bytes[bytes.length-1]^=1;writeFileSync(join(root,'media',source.digest),bytes);
 await assert.rejects(analyzer.analyze(p.id,ref.id,{confirm:true}),{code:'REFERENCE_CHANGED'});
});
