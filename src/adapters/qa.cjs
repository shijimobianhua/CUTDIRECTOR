'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash,fail}=require('../core/util.cjs'),{probe,metadata,run}=require('./media.cjs');
async function qa(m,dir,{execute,signal}={}){
 const file=path.join(dir,'video.mp4'),p=m.snapshot,fps=p.outputSpec.fps,raw=probe(file),info=metadata(raw);
 const v=raw.streams.find(s=>s.codec_type==='video'),audio=raw.streams.find(s=>s.codec_type==='audio');
 const expectedFrames=p.clips.reduce((n,s)=>n+s.outFrame-s.inFrame,0),expectedDuration=expectedFrames*fps.den/fps.num;
 const counted=JSON.parse(run(process.env.FFPROBE||'ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',file]));
 const frames=Number(counted.streams[0]?.nb_read_frames);
 await execute(['-i',file,'-f','null','-'],{signal});
 const srt=fs.readFileSync(path.join(dir,'captions.srt'),'utf8');const captions=require('../core/captions.cjs').projectCaptions(p);
 const checks={decoded:true,dimensions:info.width===p.outputSpec.width&&info.height===p.outputSpec.height,audio:!!audio&&audio.codec_name==='aac',fps:Math.abs(info.fps.num/info.fps.den-fps.num/fps.den)<.001,frames:frames===expectedFrames,duration:Math.abs(info.durationUs/1e6-expectedDuration)<=Math.max(.1,2*fps.den/fps.num),subtitles:captions.every(c=>srt.includes(c.text))};
 const report={projectId:m.projectId,revision:m.revision,manifestHash:m.cacheKey,file:{status:Object.values(checks).every(Boolean)?'passed':'failed',checks,frames,expectedFrames,expectedDuration,codec:v.codec_name,...info,hash:hash(fs.readFileSync(file)),subtitleHash:hash(srt)},content:{status:'unverified',captionInstances:captions.map(c=>({id:c.id,segmentId:c.segmentId,text:c.text})),gaps:p.requirements?.lastProposal?.gaps||[],reason:'Structural checks do not establish speech accuracy, meaning, negation or completeness'},human:{status:'unverified',items:['Watch cuts and burned subtitles','Listen to speech, sync and audio transitions','Check entities, numbers, negation and omissions against source']}};
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report));if(report.file.status!=='passed')fail('RENDER_VALIDATION_FAILED',JSON.stringify(checks));return report;
}
module.exports={qa};
