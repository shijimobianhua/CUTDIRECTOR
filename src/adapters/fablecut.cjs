'use strict';
const {validate}=require('../../contracts/project.cjs');
function syncNative(p) {
  const rate=p.outputSpec.fps.num/p.outputSpec.fps.den;
  p.width=p.outputSpec.width; p.height=p.outputSpec.height; p.fps=rate;
  for(const c of p.clips) Object.assign(c,{in:c.inFrame/rate,start:c.startFrame/rate,duration:(c.outFrame-c.inFrame)/rate});
  return validate(p);
}
function createProject({projectId='P',name='Video project',media=[],fps={num:24,den:1},width=640,height=1280}={}) {
  return syncNative({schemaVersion:1,projectId,revision:0,name,outputSpec:{fps,width,height},requirements:{},nativeRef:'project.json',media,clips:[],tracks:[{id:'V1',segmentIds:[]}],transcripts:[],captions:[],feedback:[],archived:false});
}
module.exports={syncNative,createProject};
