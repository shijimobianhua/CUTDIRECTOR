'use strict';
const {fail}=require('../src/core/util.cjs'); const {fpsCheck}=require('../src/core/time.cjs');
const id = v => typeof v==='string' && /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
function validate(p) {
  const bad=m=>fail('VALIDATION_ERROR',m);
  if(!p||p.schemaVersion!==1||!id(p.projectId)||!integer(p.revision)||!p.name?.trim()) bad('Invalid project head');
  fpsCheck(p.outputSpec?.fps);
  if(!Number.isInteger(p.outputSpec.width)||p.outputSpec.width<=0||p.outputSpec.width%2||!Number.isInteger(p.outputSpec.height)||p.outputSpec.height<=0||p.outputSpec.height%2) bad('Output dimensions must be positive even integers');
  const maps={};
  for(const key of ['media','clips','tracks','transcripts','captions','feedback']) {
    if(!Array.isArray(p[key])) bad(`${key} must be an array`);
    maps[key]=new Map(); for(const x of p[key]) { if(!x||!id(x.id)||maps[key].has(x.id)) bad(`Invalid/duplicate ${key} id`); maps[key].set(x.id,x); }
  }
  for(const a of p.media) if(!/^[a-f0-9]{64}$/.test(a.hash)||typeof a.path!=='string'||!integer(a.durationUs)||!a.timeBase||!Number.isFinite(a.originUs)) bad('Invalid asset');
  for(const t of p.tracks) if(!Array.isArray(t.segmentIds)||new Set(t.segmentIds).size!==t.segmentIds.length||t.segmentIds.some(x=>!maps.clips.has(x))) bad('Invalid track references');
  for(const s of p.clips) {
    if(!maps.media.has(s.mediaId)||!maps.tracks.has(s.track)||s.kind!=='video'||s.speed!==1||![s.inFrame,s.outFrame,s.startFrame].every(integer)||s.outFrame<=s.inFrame) bad('Invalid segment');
    if(p.tracks.filter(t=>t.segmentIds.includes(s.id)).length!==1||!maps.tracks.get(s.track).segmentIds.includes(s.id)) bad('Segment must belong to exactly one track');
    const endUs=require('../src/core/time.cjs').microseconds(s.outFrame,p.outputSpec.fps);
    if(endUs>maps.media.get(s.mediaId).durationUs+require('../src/core/time.cjs').microseconds(1,p.outputSpec.fps)) bad('Source bounds exceeded');
  }
  for(const c of p.captions) {
    const s=maps.clips.get(c.segmentId);
    if(!s||typeof c.text!=='string'||!integer(c.sourceInFrame)||!integer(c.sourceOutFrame)||c.sourceOutFrame<=c.sourceInFrame||!Array.isArray(c.corrections)||!Array.isArray(c.wordIds)) bad('Invalid caption anchor');
  }
  for(const t of p.transcripts) if(!maps.media.has(t.assetId)||!Array.isArray(t.words)||!['word','sentence','segment'].includes(t.precision)||typeof t.model!=='string') bad('Invalid transcript');
  for(const f of p.feedback) if(f.projectId!==p.projectId||!integer(f.revision)||f.revision>p.revision||typeof f.request!=='string') bad('Invalid feedback');
  return p;
}
module.exports={validate,id,integer};
