const {test}=require('node:test');const a=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {ProjectStore}=require('../src/core/store.cjs');const {Jobs}=require('../src/core/jobs.cjs');const {fixture,temp,command}=require('./helpers.cjs');const media=require('../src/adapters/media.cjs');const {manifest,render}=require('../src/adapters/render.cjs');
test('r1 rendering survives r2 edit; durable request replay; failed output unpublished',async()=>{
 const dir=temp(),s=new ProjectStore(dir);s.create(fixture());s.apply(command());let release;const wait=new Promise(r=>release=r);
 const jobs=new Jobs(path.join(dir,'renders'),s,{render:async(m,out)=>{await wait;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'video.mp4'),'test-only injected renderer');return [{name:'video.mp4',hash:require('../src/core/util.cjs').hash(fs.readFileSync(path.join(out,'video.mp4')))}];}});
 try {const request={projectId:'P',revision:1,requestId:'request'};const j=jobs.start(request);a.equal(jobs.start(request).id,j.id);a.throws(()=>jobs.start({...request,revision:0}),{code:'REQUEST_ID_CONFLICT'});
 s.apply(command({baseRevision:1,commandId:'edit',params:{text:'r2'}}));release();const done=await jobs.settle(j.id);a.equal(done.revision,1);a.equal(done.artifacts[0].revision,1);a.equal(done.manifest.snapshot.captions[0].text,'纠正');
 const reload=new Jobs(path.join(dir,'renders'),s);a.equal(reload.start(request).id,j.id);
 const broken=new Jobs(path.join(dir,'failed'),s,{render:async(_,out)=>{fs.mkdirSync(out);fs.writeFileSync(path.join(out,'video.mp4'),'partial');throw new Error('injected');}});
 const b=broken.start({...request,revision:2,requestId:'broken'});a.equal((await broken.settle(b.id)).status,'failed');a.throws(()=>broken.artifact(b.id,'video.mp4'),{code:'NOT_FOUND'});
 }finally{s.close();}
});
test('real FFmpeg: Chinese path silent media normalization, stitched MP4 decode, SRT and hash',async()=>{
 const dir=temp(),input=path.join(dir,'中文输入.mp4'),normalized=path.join(dir,'中文工作.mp4');
 media.run(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc=size=64x64:rate=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p',input]);
 const work=media.normalize(input,normalized,{num:24,den:1});a.equal(work.hasAudio,false);
 const asset=media.ingest(normalized,'A'),p=fixture();p.media=[asset];p.outputSpec={fps:{num:24,den:1},width:64,height:64};p.clips[0].outFrame=12;p.clips[1].inFrame=12;p.clips[1].outFrame=24;p.clips[1].startFrame=12;p.captions[0].sourceInFrame=0;p.captions[0].sourceOutFrame=12;
 const m=manifest(p),out=path.join(dir,'out');const files=await render(m,out);a.equal(files.length,3);a.match(fs.readFileSync(path.join(out,'captions.srt'),'utf8'),/原文/);a.equal(media.metadata(media.probe(path.join(out,'video.mp4'))).hasAudio,true);
 p.captions[0].text='changed';a.notEqual(manifest(p).cacheKey,m.cacheKey);
 p.media[0].hash='0'.repeat(64);await a.rejects(()=>render(manifest(p),path.join(dir,'bad')),{code:'MEDIA_CHANGED'});
});
