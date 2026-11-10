'use strict';
function layers(input,source,durationUs,invalid){
 const collect=(items,type)=>{
  if(items==null)return [];if(!Array.isArray(items)||items.length>500)invalid('INVALID_ARRANGEMENT','附加轨道最多 500 个片段。');
  return items.map((clip,index)=>{
   const asset=source.get(clip.assetId),{inUs,outUs,startUs}=clip||{};
   if(!asset||type==='video'&&asset.kind==='audio'||type==='audio'&&asset.kind!=='audio'&&!asset.hasAudio||![inUs,outUs,startUs].every(Number.isSafeInteger)||inUs<0||outUs<=inUs||outUs>asset.durationUs||startUs<0||startUs+outUs-inUs>durationUs)invalid('INVALID_ARRANGEMENT','附加轨道第 '+(index+1)+' 段超出素材或整片范围。');
   const volume=clip.volume??(type==='video'?0:1);if(!Number.isFinite(volume)||volume<0||volume>4)invalid('INVALID_ARRANGEMENT','音量范围为 0 到 4。');
   const length=outUs-inUs,fadeInUs=clip.fadeInUs||0,fadeOutUs=clip.fadeOutUs||0;
   if(![fadeInUs,fadeOutUs].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=length)||fadeInUs+fadeOutUs>length)invalid('INVALID_ARRANGEMENT','淡入淡出时间超过片段时长。');
   const keyframes=clip.keyframes||[];if(!Array.isArray(keyframes)||keyframes.length>200||keyframes.some((p,i)=>!Number.isSafeInteger(p.timeUs)||p.timeUs<0||p.timeUs>length||!Number.isFinite(p.volume)||p.volume<0||p.volume>4||i>0&&keyframes[i-1].timeUs>=p.timeUs))invalid('INVALID_ARRANGEMENT','请按时间顺序填写音量变化。');
   const role=type==='audio'?(clip.role||'dialogue'):'reaction';if(!['dialogue','music','effect','reaction'].includes(role))invalid('INVALID_ARRANGEMENT','请选择对白、配乐或音效。');
   return {assetId:clip.assetId,name:asset.name,inUs,outUs,startUs,volume,role,fadeInUs,fadeOutUs,keyframes};
  });
 };
 return {overlayClips:collect(input.overlayClips,'video'),audioClips:collect(input.audioClips,'audio')};
}
function handoffLayers(arrangement,files){
 const seconds=v=>v/1e6,tracks=[];
 for(const [type,clips]of [['video',arrangement.overlayClips||[]],['audio',arrangement.audioClips||[]]]){
  const lanes=[];
  for(const clip of [...clips].sort((a,b)=>a.startUs-b.startUs)){
   let lane=lanes.find(l=>l.endUs<=clip.startUs&&l.role===clip.role);if(!lane){lane={type,role:clip.role,endUs:0,clips:[]};lanes.push(lane);}
   lane.clips.push({src:files.get(clip.assetId).path,in:seconds(clip.inUs),out:seconds(clip.outUs),start:seconds(clip.startUs),volume:clip.volume,fade:{in:seconds(clip.fadeInUs),out:seconds(clip.fadeOutUs)},...(clip.keyframes.length?{keyframes:{volume:clip.keyframes.map(p=>[seconds(p.timeUs),p.volume])}}:{})});lane.endUs=clip.startUs+clip.outUs-clip.inUs;
  }
  for(const {endUs,role,...lane}of lanes)tracks.push(lane);
 }
 return tracks;
}
module.exports={layers,handoffLayers};
