'use strict';
const {microseconds}=require('../core/time.cjs');
const {fail}=require('../core/util.cjs');
const LIMIT=11500;
const short=(value,size=160)=>typeof value==='string'?value.slice(0,size):'';
const fits=value=>JSON.stringify(value).length<=LIMIT;

function brief(project,run,preferences,tools) {
  const {projectId,revision,outputSpec,clips,tracks,transcripts}=project;
  const context={projectId,revision,outputSpec,selection:run.selection,request:run.request,
    intent:run.intent,mode:run.mode,step:run.steps,tools,
    segmentCount:clips.length,transcriptCount:transcripts.length,
    previous:run.previous||null,history:[],preferences:[],segments:[]};
  for(const turn of (run.history||[]).slice().reverse()){
    context.history.unshift(turn);
    if(!fits(context)){context.history.shift();break;}
  }
  for(const entry of preferences.slice(0,5)){
    context.preferences.push({id:entry.id,rule:entry.rule});
    if(!fits(context)){context.preferences.pop();break;}
  }
  const selected=new Set(run.selection);
  const byId=new Map(clips.map(clip=>[clip.id,clip]));
  for(const id of tracks.flatMap(track=>track.segmentIds)){
    if(selected.size&&!selected.has(id))continue;
    const {mediaId,inFrame,outFrame,startFrame}=byId.get(id);
    context.segments.push({id,mediaId,inFrame,outFrame,startFrame});
    if(context.segments.length>30||!fits(context)){context.segments.pop();break;}
  }
  context.moreSegments=context.segments.length<(selected.size||clips.length);
  return context;
}

function detail(project,run,{segmentId,revision,after=0}={}) {
  if(revision!==project.revision) fail('REVISION_CONFLICT');
  if(!Number.isSafeInteger(after)||after<0) fail('AGENT_TOOL_INVALID');
  const clip=project.clips.find(item=>item.id===segmentId);
  if(!clip||(run.selection.length&&!run.selection.includes(segmentId))) fail('AGENT_SCOPE_INVALID');
  const asset=project.media.find(item=>item.id===clip.mediaId);
  const start=microseconds(clip.inFrame,project.outputSpec.fps);
  const end=microseconds(clip.outFrame,project.outputSpec.fps);
  const entries=[
    ...project.captions.filter(c=>c.segmentId===segmentId).map(c=>({
      kind:'caption',id:c.id,text:short(c.text,300),inFrame:c.sourceInFrame,outFrame:c.sourceOutFrame,
      corrected:!!c.corrections.length})),
    ...project.transcripts.filter(t=>t.assetId===clip.mediaId).flatMap(t=>
      t.words.filter(w=>w.startUs>=start&&w.endUs<=end).map(w=>({
        kind:'word',transcriptId:t.id,precision:t.precision,provenance:t.status,
        wordId:w.id,text:short(w.text,300),startUs:w.startUs,endUs:w.endUs})))
  ];
  if(after>entries.length) fail('AGENT_TOOL_INVALID');
  const items=[];
  for(const item of entries.slice(after,after+30)){
    items.push(item);
    if(JSON.stringify(items).length>3900){items.pop();break;}
  }
  return {segmentId,revision,assetHash:asset.hash,items,
    next:after+items.length<entries.length?after+items.length:null};
}
module.exports={brief,detail,short};
