'use strict';
// Captions stay attached to a segment instance and source frames, never list positions.
function projectCaptions(p) {
 return p.captions.flatMap(c=>{
  const s=p.clips.find(s=>s.id===c.segmentId); if(!s) return [];
  const a=Math.max(s.inFrame,c.sourceInFrame), b=Math.min(s.outFrame,c.sourceOutFrame);
  return b>a?[{...c,inFrame:s.startFrame+a-s.inFrame,outFrame:s.startFrame+b-s.inFrame}]:[];
 }).sort((a,b)=>a.inFrame-b.inFrame||a.id.localeCompare(b.id));
}
function generate(p,{transcriptId,segmentIds}){
 const {fail,hash}=require('./util.cjs'),{cover,microseconds}=require('./time.cjs');
 const t=p.transcripts.find(t=>t.id===transcriptId);
 if(!t||!Array.isArray(segmentIds)||!segmentIds.length||new Set(segmentIds).size!==segmentIds.length)fail('VALIDATION_ERROR');const ids=[];
 for(const id of segmentIds){const s=p.clips.find(s=>s.id===id&&s.mediaId===t.assetId);if(!s)fail('TARGET_NOT_FOUND');
  for(const w of t.words){if(w.startUs<microseconds(s.inFrame,p.outputSpec.fps)||w.endUs>microseconds(s.outFrame,p.outputSpec.fps))continue;
   const range=cover(w.startUs,w.endUs,p.outputSpec.fps),cid='C_'+hash({segmentId:id,transcriptId,wordId:w.id}).slice(0,32);
   // Never overwrite or overlap an existing human caption instance.
   if(p.captions.some(c=>c.segmentId===id&&c.sourceInFrame<range.outFrame&&c.sourceOutFrame>range.inFrame))continue;
   p.captions.push({id:cid,segmentId:id,wordIds:[w.id],sourceInFrame:range.inFrame,sourceOutFrame:range.outFrame,text:w.text,corrections:[],transcriptId,provenance:t.provenance||'unverified'});ids.push(cid);
  }
 }return ids;
}
module.exports={projectCaptions,generate};
