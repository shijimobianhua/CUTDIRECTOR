'use strict';
const {fail}=require('./util.cjs'),{microseconds}=require('./time.cjs');
// The Agent supplies editorial choices. This validator cannot judge speech quality.
function validateProposal(p,v){
 if(!v||v.baseRevision!==p.revision)fail('REVISION_CONFLICT');
 if(!Array.isArray(v.items)||!v.items.length||!Array.isArray(v.gaps)||v.gaps.some(g=>typeof g!=='string'||!g.trim()))fail('PROPOSAL_INVALID','Explicit items and gaps required');
 const ids=new Set();
 for(const x of v.items){const s=p.clips.find(s=>s.id===x.segmentId),asset=p.media.find(a=>a.id===s?.mediaId);
  if(!s||ids.has(s.id)||!Number.isSafeInteger(x.inFrame)||!Number.isSafeInteger(x.outFrame)||x.inFrame<s.inFrame||x.outFrame>s.outFrame||x.outFrame<=x.inFrame)fail('RANGE_INVALID');ids.add(s.id);
  if(x.assetHash!==asset.hash||typeof x.reason!=='string'||!x.reason.trim()||!Array.isArray(x.evidence)||!x.evidence.length)fail('PROPOSAL_INVALID','Every retained item needs hash-bound evidence and reason');
  for(const e of x.evidence){const t=p.transcripts.find(t=>t.id===e.transcriptId&&t.assetId===asset.id),w=t?.words.find(w=>w.id===e.wordId);
   if(!w||e.text!==w.text||w.startUs<microseconds(x.inFrame,p.outputSpec.fps)||w.endUs>microseconds(x.outFrame,p.outputSpec.fps))fail('EVIDENCE_INVALID');
  }
 }
 // Human-corrected caption instances must remain visible and unchanged.
 for(const c of p.captions.filter(c=>c.corrections.length)){const x=v.items.find(x=>x.segmentId===c.segmentId);
  if(!x||x.inFrame>c.sourceInFrame||x.outFrame<c.sourceOutFrame)fail('PROTECTED_CONTENT',c.id);
 }
 return structuredClone(v);
}
function applyProposal(p,v){validateProposal(p,v);if(p.tracks.length!==1)fail('MEDIA_UNSUPPORTED');
 const keep=new Set(v.items.map(x=>x.segmentId));p.clips=p.clips.filter(s=>keep.has(s.id));p.captions=p.captions.filter(c=>keep.has(c.segmentId));
 let startFrame=0;for(const x of v.items){const s=p.clips.find(s=>s.id===x.segmentId);s.inFrame=x.inFrame;s.outFrame=x.outFrame;s.startFrame=startFrame;startFrame+=x.outFrame-x.inFrame;}
 p.tracks[0].segmentIds=v.items.map(x=>x.segmentId);p.requirements={...p.requirements,lastProposal:structuredClone(v)};return [...keep];
}
function protectTrim(p,s,v){for(const c of p.captions.filter(c=>c.segmentId===s.id&&c.corrections.length)){
 // Existing partially visible corrections stay protected over their current intersection.
 if(v.inFrame>Math.max(s.inFrame,c.sourceInFrame)||v.outFrame<Math.min(s.outFrame,c.sourceOutFrame))fail('PROTECTED_CONTENT',c.id);
}}
module.exports={validateProposal,applyProposal,protectTrim};
