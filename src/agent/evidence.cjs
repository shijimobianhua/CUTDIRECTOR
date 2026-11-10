'use strict';
const {microseconds}=require('../core/time.cjs');

function visibleEvidence(project,clips,captions=project.captions){
  const {fps}=project.outputSpec;
  const text=[];
  for(const clip of clips){
    const start=microseconds(clip.inFrame,fps);
    const end=microseconds(clip.outFrame,fps);
    for(const transcript of project.transcripts.filter(t=>t.assetId===clip.mediaId)){
      const words=transcript.words.filter(word=>word.startUs>=start&&word.endUs<=end).map(word=>word.text);
      text.push(words.join(''),words.join(' '));
    }
    text.push(captions.filter(c=>c.segmentId===clip.id&&c.sourceInFrame>=clip.inFrame&&c.sourceOutFrame<=clip.outFrame)
      .map(c=>c.text).join(' '));
  }
  return text;
}
const canonical=value=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
function kept(terms,evidence){
  const lines=evidence.map(canonical);
  return terms.filter(term=>lines.some(line=>line.includes(canonical(term))));
}
module.exports={visibleEvidence,kept};
