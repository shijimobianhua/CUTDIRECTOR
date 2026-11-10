const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,temp}=require('./helpers.cjs'),media=require('../src/adapters/media.cjs'),{Jobs}=require('../src/core/jobs.cjs'),{ProjectStore}=require('../src/core/store.cjs'),{manifest,render,execute}=require('../src/adapters/render.cjs');
function prepared(dir){const input=path.join(dir,'中文音频.mp4');media.run(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=30000/1001','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.001','-c:v','libx264','-c:a','aac',input]);const p=fixture();p.media=[media.ingest(input,'A')];p.outputSpec={fps:{num:30000,den:1001},width:64,height:64,subtitles:'burn'};p.clips[0].outFrame=15;p.clips[1].inFrame=15;p.clips[1].outFrame=30;p.clips[1].startFrame=15;p.captions[0].sourceInFrame=0;p.captions[0].sourceOutFrame=15;return p;}
test('fractional FPS audio burn render, QA separation, verified cache reuse and invalidation',async()=>{
 const dir=temp(),p=prepared(dir),s=new ProjectStore(path.join(dir,'data'));s.create(p);let calls=0;const jobs=new Jobs(path.join(dir,'jobs'),s,{render:async(...args)=>{calls++;return render(...args);}});
 try{const j=jobs.start({projectId:'P',revision:0,requestId:'one'}),done=await jobs.settle(j.id);a.equal(done.status,'succeeded',done.error?.message);
 const report=JSON.parse(fs.readFileSync(jobs.artifact(j.id,'report.json').path));a.equal(report.file.frames,30);a.equal(report.file.status,'passed');a.equal(report.content.status,'unverified');a.equal(report.human.status,'unverified');
 const two=jobs.start({projectId:'P',revision:0,requestId:'two'});a.equal((await jobs.settle(two.id)).cacheHit,j.id);a.equal(calls,1);
 fs.appendFileSync(p.media[0].path,'changed');const bad=jobs.start({projectId:'P',revision:0,requestId:'bad'});a.equal((await jobs.settle(bad.id)).error.code,'MEDIA_CHANGED');a.throws(()=>jobs.artifact(bad.id,'video.mp4'),{code:'NOT_FOUND'});
 }finally{s.close();}
});
test('queued cancellation, running cancellation, retry and interrupted restart keep one unsettled attempt',async()=>{
 const dir=temp(),p=prepared(dir),s=new ProjectStore(path.join(dir,'data'));s.create(p);let running;const entered=new Promise(r=>running=r);
 const jobs=new Jobs(path.join(dir,'jobs'),s,{render:async(m,out,{signal})=>{fs.mkdirSync(out);running();await execute(['-re','-f','lavfi','-i','color=s=64x64:r=24','-t','60','-f','null','-'],{signal});return [];}});
 try{const req={projectId:'P',revision:0,requestId:'cancel'},j=jobs.start(req);a.equal(jobs.start(req).id,j.id);await entered;jobs.cancel(j.id);const done=await jobs.settle(j.id);a.equal(done.status,'cancelled');a.equal(done.artifacts.length,0);a.equal(fs.readdirSync(path.join(dir,'jobs')).some(n=>n.startsWith(j.id)&&n.endsWith('.partial')),false);
 const retry=jobs.retry(j.id);a.equal(retry.attempts.length,2);a.throws(()=>jobs.retry(j.id),{code:'JOB_NOT_RETRYABLE'});jobs.cancel(j.id);await jobs.settle(j.id);
 const saved=JSON.parse(fs.readFileSync(jobs.file));saved[0].status='running';saved[0].attempts.at(-1).status='running';fs.writeFileSync(jobs.file,JSON.stringify(saved));const reopened=new Jobs(path.join(dir,'jobs'),s);a.equal(reopened.read(j.id).status,'interrupted');a.equal(reopened.start(req).id,j.id);
 }finally{s.close();}
});
test('real VFR and rotated sources require normalization; missing source rejects',async()=>{
 const dir=temp(),p=prepared(dir),vfr=path.join(dir,'vfr.mp4');
 media.run(process.env.FFMPEG||'ffmpeg',['-v','error','-i',p.media[0].path,'-vf',"select='not(mod(n,3))+not(mod(n,5))'",'-vsync','vfr','-an','-c:v','libx264',vfr]);
 a.equal(media.metadata(media.probe(vfr)).vfr,true);p.media=[media.ingest(vfr,'A')];await a.rejects(()=>render(manifest(p),path.join(dir,'reject')),{code:'MEDIA_UNSUPPORTED'});
 const normalized=media.normalize(vfr,path.join(dir,'norm.mp4'),p.outputSpec.fps);a.equal(normalized.vfr,false);
 const rotated=path.join(dir,'rot.mp4');media.run(process.env.FFMPEG||'ffmpeg',['-v','error','-i',normalized.path,'-c','copy','-metadata:s:v:0','rotate=90',rotated]);a.notEqual(media.metadata(media.probe(rotated)).rotation,0);const work=media.normalize(rotated,path.join(dir,'rot-norm.mp4'),p.outputSpec.fps);a.equal(work.rotation,0);
 p.media[0].path=path.join(dir,'missing');await a.rejects(()=>render(manifest(p),path.join(dir,'missing-out')),{code:'MEDIA_MISSING'});
});
