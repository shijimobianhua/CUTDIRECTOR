'use strict';
const {spawnSync}=require('node:child_process'); const fs=require('node:fs');
const {hash,fail}=require('../core/util.cjs'); const {fpsCheck,frame,microseconds}=require('../core/time.cjs');
function run(bin,args) {
 const r=spawnSync(bin,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});
 if(r.error||r.status!==0) fail('MEDIA_PROCESS_FAILED',r.error?.message||r.stderr); return r.stdout;
}
function probe(file) {return JSON.parse(run(process.env.FFPROBE||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));}
function metadata(p) {
 const v=p.streams.find(s=>s.codec_type==='video'); if(!v) fail('VIDEO_MISSING');
 const rational=s=>{const [num,den]=String(s).split('/').map(Number); const f={num,den}; fpsCheck(f); return f;};
 return {durationUs:Math.round(Number(v.duration||p.format.duration)*1e6),originUs:Math.round(Number(v.start_time||p.format.start_time||0)*1e6),timeBase:v.time_base,
 fps:rational(v.avg_frame_rate),vfr:v.avg_frame_rate!==v.r_frame_rate,rotation:Number(v.side_data_list?.find(x=>x.rotation!=null)?.rotation||v.tags?.rotate||0),hasAudio:p.streams.some(s=>s.codec_type==='audio'),width:v.width,height:v.height};
}
function ingest(file,id) {return {id,path:require('node:path').resolve(file),hash:hash(fs.readFileSync(file)),...metadata(probe(file))};}
function sourceToWorking(sourceUs,originUs,fps) {return frame(sourceUs-originUs,fps);}
function workingToSource(f,originUs,fps) {return originUs+microseconds(f,fps);}
function normalize(input,output,fps) {
 fpsCheck(fps); if(require('node:path').resolve(input)===require('node:path').resolve(output)) fail('MEDIA_PATH_CONFLICT');
 run(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',`setpts=PTS-STARTPTS,fps=${fps.num}/${fps.den}`,'-af','asetpts=PTS-STARTPTS','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',output]);
 return {path:output,hash:hash(fs.readFileSync(output)),fps,mapping:'presentation-time-origin-to-cfr-nearest-half-up',...metadata(probe(output))};
}
module.exports={run,probe,metadata,ingest,normalize,sourceToWorking,workingToSource};
