'use strict';

const {prepareArrangement}=require('./arrangement.cjs');
function invalid() {throw Object.assign(new Error('PROPOSAL_INVALID'),{code:'PROPOSAL_INVALID',status:422});}
const protectedText=/\d|[零〇一二三四五六七八九十百千万亿两]+(?:秒|分钟|元|个|次|天|年|％|%)|不|没|别|无|未|除非|如果|只有|只要|前提|适用|条件|必须|至少|最多|承诺|保证|仅/;
function cutEvidence(confirmed,focus,request,limits={}) {
  if(!confirmed?.captions?.length)return null;
  const protectedNumbers=new Set();
  const quotes=[...request.matchAll(/[“「『"]([^”」』"\n]{1,120})[”」』"]/g)].map(match=>match[1]);
  const items=confirmed.captions.map((cue,index)=>({number:index+1,startUs:cue.startUs,endUs:cue.endUs,text:cue.text.slice(0,240)}));
  for(let index=0;index<items.length;index++) {
    const cue=items[index];
    if(protectedText.test(cue.text)||quotes.some(value=>cue.text.includes(value))) {
      protectedNumbers.add(cue.number);
      if(/不|没|无|未|除非|如果|只有|只要|前提|适用|条件|但/.test(cue.text)){
        if(index)protectedNumbers.add(index);
        if(index+1<items.length)protectedNumbers.add(index+2);
      }
    }
  }
  const relevant=items.filter(cue=>!focus||confirmed.clips.filter(clip=>clip.startUs<cue.endUs&&clip.startUs+clip.outUs-clip.inUs>cue.startUs).every(clip=>clip.assetId===focus));
  let size=0;
  const visible=[];
  for(const cue of relevant){if(visible.length>=(limits.maxItems||200)||size+cue.text.length>(limits.maxChars||12000))break;visible.push(cue);size+=cue.text.length;}
  const complete=visible.length===relevant.length&&items.length<=(limits.maxItems||200)&&confirmed.captions.every(cue=>cue.text.length<=240)&&(!focus||confirmed.clips.every(clip=>clip.assetId===focus));
  const target=/(?:剪成|剪到|缩短到|压缩到|做成|变成|保留.{0,8}?到)\s*(\d+(?:\.\d+)?)\s*(秒|s|分钟)/i.exec(request);
  return {version:confirmed.version,total:items.length,complete,focusAssetId:focus||null,
    targetSeconds:target?Number(target[1])*(target[2]==='分钟'?60:1):null,
    items:visible.map(cue=>({...cue,mustKeep:protectedNumbers.has(cue.number)}))};
}
function stamp(us) {
  const ms=Math.round(us/1000),s=Math.floor(ms/1000);
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');
}
function bindCut(db,projectId,context,input) {
  const evidence=context?.cutEvidence;
  if(!context?.includeSubtitles||!evidence?.complete||
    Object.keys(input).some(key=>!['kind','keep','targetSeconds'].includes(key))||
    !Array.isArray(input.keep)||!input.keep.length||input.keep.length>200)invalid();
  const row=db.prepare('SELECT snapshot FROM arrangements WHERE project_id=? AND version=?').get(projectId,evidence.version);
  if(!row)invalid();
  const base=JSON.parse(row.snapshot);
  const allowed=new Map(evidence.items.map(cue=>[cue.number,cue]));
  const expanded=[];
  for(const item of input.keep){
    if(item&&Object.hasOwn(item,'fromCue')){
      if(Object.keys(item).some(key=>!['fromCue','toCue','reason'].includes(key))||!Number.isInteger(item.fromCue)||!Number.isInteger(item.toCue)||item.fromCue<1||item.toCue<item.fromCue||item.toCue-item.fromCue>1999)invalid();
      for(let cue=item.fromCue;cue<=item.toCue;cue++)expanded.push({cue,reason:item.reason});
    }else expanded.push(item);
    if(expanded.length>2000)invalid();
  }
  let previous=0;
  const chosen=expanded.map(item=>{
    if(!item||Object.keys(item).some(key=>!['cue','reason'].includes(key))||
      !Number.isInteger(item.cue)||item.cue<=previous||!allowed.has(item.cue)||
      typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>240)invalid();
    previous=item.cue;
    return {...allowed.get(item.cue),reason:item.reason.trim()};
  });
  const chosenIds=new Set(chosen.map(cue=>cue.number));
  if(evidence.items.some(cue=>cue.mustKeep&&!chosenIds.has(cue.number)))invalid();
  const intervals=[];
  for(const cue of chosen) {
    const last=intervals.at(-1);
    if(last&&cue.startUs===last.endUs)last.endUs=cue.endUs;
    else intervals.push({startUs:cue.startUs,endUs:cue.endUs});
  }
  const clips=[],captions=[];
  let offset=0;
  for(const range of intervals) {
    for(const clip of base.clips) {
      const from=Math.max(range.startUs,clip.startUs),to=Math.min(range.endUs,clip.startUs+clip.outUs-clip.inUs);
      if(from>=to)continue;
      if(evidence.focusAssetId&&clip.assetId!==evidence.focusAssetId)invalid();
      const next={assetId:clip.assetId,inUs:clip.inUs+from-clip.startUs,outUs:clip.inUs+to-clip.startUs};
      const last=clips.at(-1);
      if(last&&last.assetId===next.assetId&&last.outUs===next.inUs)last.outUs=next.outUs;
      else clips.push(next);
    }
    for(const cue of chosen.filter(cue=>cue.startUs>=range.startUs&&cue.endUs<=range.endUs)) {
      captions.push({startUs:offset+cue.startUs-range.startUs,endUs:offset+cue.endUs-range.startUs,text:base.captions[cue.number-1].text});
    }
    offset+=range.endUs-range.startUs;
  }
  const target=evidence.targetSeconds??input.targetSeconds;
  if(typeof target!=='number'||!Number.isFinite(target)||target<=0||target>1500||
    (input.targetSeconds!=null&&input.targetSeconds!==target)||offset>target*1e6||offset>=base.durationUs)invalid();
  const subtitle={mode:'timeline',assetId:null,text:captions.map((cue,index)=>(index+1)+'\n'+stamp(cue.startUs)+' --> '+stamp(cue.endUs)+'\n'+cue.text).join('\n\n')};
  const assets=db.prepare('SELECT id,metadata FROM assets WHERE project_id=?').all(projectId).map(row=>({id:row.id,...JSON.parse(row.metadata)}));
  let next;
  try {next=prepareArrangement({clips,subtitle},assets);}catch {invalid();}
  return {kind:'arrangement',baseVersion:evidence.version,next,changes:[],clearedSelections:[],
    draft:{targetSeconds:target,actualSeconds:next.durationUs/1e6,originalSeconds:base.durationUs/1e6,
      protectedCount:evidence.items.filter(cue=>cue.mustKeep).length,keep:chosen.map(cue=>({...cue,sources:base.clips.filter(clip=>clip.startUs<cue.endUs&&clip.startUs+clip.outUs-clip.inUs>cue.startUs).map(clip=>({assetId:clip.assetId,name:clip.name,inUs:clip.inUs+Math.max(cue.startUs,clip.startUs)-clip.startUs,outUs:clip.inUs+Math.min(cue.endUs,clip.startUs+clip.outUs-clip.inUs)-clip.startUs}))}))}};
}
module.exports={cutEvidence,bindCut};
