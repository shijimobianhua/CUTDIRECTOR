'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash,fail}=require('../core/util.cjs');
const {microseconds}=require('../core/time.cjs');
// Evidence uses source CFR coordinates and immutable input hashes, not timeline offsets.
function segments(p){return p.clips.map(s=>{const a=p.media.find(a=>a.id===s.mediaId),startUs=microseconds(s.inFrame,p.outputSpec.fps),endUs=microseconds(s.outFrame,p.outputSpec.fps);
 const transcripts=p.transcripts.filter(t=>t.assetId===a.id);
 const evidence=transcripts.flatMap(t=>t.words.filter(w=>w.startUs<endUs&&w.endUs>startUs).map(w=>({transcriptId:t.id,wordId:w.id,text:w.text,startUs:w.startUs,endUs:w.endUs,precision:t.precision,model:t.model,provenance:t.provenance||'unverified'})));
 return {segmentId:s.id,assetId:a.id,assetHash:a.hash,inFrame:s.inFrame,outFrame:s.outFrame,startUs,endUs,evidence,summary:evidence.map(w=>w.text).join(''),gaps:transcripts.length?transcripts.flatMap(t=>(t.missing||[]).filter(g=>g.startUs<endUs&&g.endUs>startUs)):[{startUs,endUs,reason:'No transcript; content unknown'}]};
});}
async function inspect(m,dir,options={}){
 const {execute}=require('./render.cjs');fs.mkdirSync(dir,{recursive:true});const p=m.snapshot,files=[],evidence=[];
 for(const s of segments(p)){
  const a=p.media.find(a=>a.id===s.assetId),w=a.workingMedia,input=w?.path||a.path;
  if(!fs.existsSync(input))fail('MEDIA_MISSING');if(hash(fs.readFileSync(input))!==(w?.hash||a.hash))fail('MEDIA_CHANGED');
  const info=require('./media.cjs').metadata(require('./media.cjs').probe(input));
  if(info.vfr||info.originUs!==0||info.rotation!==0)fail('MEDIA_UNSUPPORTED','Normalize source before frame inspection');
  const start=s.startUs/1e6,duration=Math.min(5,(s.endUs-s.startUs)/1e6);
  const image=s.segmentId+'.jpg',video=s.segmentId+'.mp4';
  await execute(['-y','-ss',String(start),'-i',input,'-frames:v','1','-vf','scale=320:-2',path.join(dir,image)],options);
  await execute(['-y','-ss',String(start),'-i',input,'-t',String(duration),'-map','0:v:0','-map','0:a:0?','-vf','scale=320:-2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,video)],options);
  s.preview={startUs:s.startUs,endUs:s.startUs+Math.round(duration*1e6),keyframe:image,video};files.push(image,video);
  evidence.push(s);
 }
 fs.writeFileSync(path.join(dir,'segments.json'),JSON.stringify({projectId:m.projectId,revision:m.revision,manifestHash:m.cacheKey,segments:evidence}));files.push('segments.json');
 return files.map(name=>({name,hash:hash(fs.readFileSync(path.join(dir,name)))}));
}
module.exports={segments,inspect};
