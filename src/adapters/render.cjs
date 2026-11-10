'use strict';
const fs=require('node:fs'); const path=require('node:path'); const {spawn}=require('node:child_process');
const {hash,fail}=require('../core/util.cjs'); const {probe,metadata}=require('./media.cjs'); const {projectCaptions}=require('../core/captions.cjs');
function execute(args,{signal,cwd}={}) {return new Promise((resolve,reject)=>{
 const p=spawn(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error',...args],{windowsHide:true,signal,cwd});let log='';const timer=setTimeout(()=>p.kill(),120000);
 p.stderr.on('data',c=>{log=(log+c).slice(-16000);});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Object.assign(new Error(log||`FFmpeg exit ${code}`),{code:signal?.aborted?'CANCELLED':'RENDER_FAILED'}));else resolve();});
 });}
function manifest(project,type='export') {
 if(!['preview','export','inspect'].includes(type)) fail('VALIDATION_ERROR');
 const p=structuredClone(project);if(p.tracks.length!==1||!p.clips.length)fail('MEDIA_UNSUPPORTED','M1 requires one nonempty video track');
 let end=0; for(const id of p.tracks[0].segmentIds) {const s=p.clips.find(c=>c.id===id);if(s.startFrame!==end)fail('MEDIA_UNSUPPORTED','M1 requires contiguous clips');end+=s.outFrame-s.inFrame;}
 const content={version:1,projectId:p.projectId,revision:p.revision,type,outputSpec:p.outputSpec,inputs:p.media.map(a=>({id:a.id,hash:a.hash,workingHash:a.workingMedia?.hash})),snapshot:p,renderer:'ffmpeg-h264-aac-srt-burn-v2'};
 return {...content,cacheKey:hash(content)};
}
function stamp(frame,fps) {const ms=Math.round(frame*1000*fps.den/fps.num);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
async function render(m,dir,options={}) {
 dir=path.resolve(dir);
 if(m.type==='inspect')return require('./inspect.cjs').inspect(m,dir,options);
 fs.mkdirSync(dir,{recursive:true}); const p=m.snapshot, fps=p.outputSpec.fps,rate=fps.num/fps.den;
 const ordered=p.tracks[0].segmentIds.map(id=>p.clips.find(s=>s.id===id));
 for(let i=0;i<ordered.length;i++) {
  const s=ordered[i],a=p.media.find(a=>a.id===s.mediaId),w=a.workingMedia, input=w?.path||a.path;
  if(!fs.existsSync(input))fail('MEDIA_MISSING',input);if(hash(fs.readFileSync(input))!==(w?.hash||a.hash))fail('MEDIA_CHANGED',input);
  const info=metadata(probe(input)); if(info.vfr||info.originUs!==0||info.rotation!==0)fail('MEDIA_UNSUPPORTED','Normalize VFR, rotated or nonzero-origin media first');
  const duration=(s.outFrame-s.inFrame)/rate;
  const args=['-y','-ss',String(s.inFrame/rate),'-i',input];if(!info.hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
  args.push('-t',String(duration),'-map','0:v:0','-map',info.hasAudio?'0:a:0':'1:a:0','-vf',`setpts=PTS-STARTPTS,scale=${p.outputSpec.width}:${p.outputSpec.height}:force_original_aspect_ratio=decrease,pad=${p.outputSpec.width}:${p.outputSpec.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps.num}/${fps.den}`,'-af',`asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=duration=${duration}`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2',path.join(dir,`part${i}.mp4`));
  await execute(args,options);
 }
 fs.writeFileSync(path.join(dir,'concat.txt'),ordered.map((_,i)=>`file 'part${i}.mp4'`).join('\n'));
 const output=path.join(dir,'video.mp4'); await execute(['-y','-f','concat','-safe','1','-i',path.join(dir,'concat.txt'),'-vf',`fps=${fps.num}/${fps.den}`,'-frames:v',String(ordered.reduce((n,s)=>n+s.outFrame-s.inFrame,0)),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],options);
 const captions=projectCaptions(p);const srt=captions.map((c,i)=>`${i+1}\n${stamp(c.inFrame,fps)} --> ${stamp(c.outFrame,fps)}\n${c.text}\n`).join('\n');fs.writeFileSync(path.join(dir,'captions.srt'),srt,'utf8');
 // Burn from a relative, generated file name to avoid Windows drive/Chinese path filter escaping.
 if(p.outputSpec.subtitles==='burn'&&captions.length){
  const burned=path.join(dir,'burned.mp4');await execute(['-y','-i',output,'-vf','subtitles=captions.srt','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',burned],{...options,cwd:dir});fs.renameSync(burned,output);
 }
 const report=metadata(probe(output));
 const expected=ordered.reduce((n,s)=>n+s.outFrame-s.inFrame,0)/rate;
 if(report.width!==p.outputSpec.width||report.height!==p.outputSpec.height||!report.hasAudio||Math.abs(report.durationUs/1e6-expected)>Math.max(.25,2/rate))fail('RENDER_VALIDATION_FAILED');
 await require('./qa.cjs').qa(m,dir,{execute,signal:options.signal});
 // Intermediate parts are private and are removed after successful validation.
 for(let i=0;i<ordered.length;i++)fs.unlinkSync(path.join(dir,`part${i}.mp4`));fs.unlinkSync(path.join(dir,'concat.txt'));
 return ['video.mp4','captions.srt','report.json'].map(name=>({name,hash:hash(fs.readFileSync(path.join(dir,name)))}));
}
module.exports={execute,manifest,render,stamp};
