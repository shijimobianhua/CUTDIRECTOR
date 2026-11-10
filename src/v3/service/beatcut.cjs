'use strict';
const {prepareArrangement}=require('./arrangement.cjs');
function fail(code,message,status=422){throw Object.assign(new Error(message),{code,status});}
function stamp(us){const ms=Math.round(us/1000),s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');}
function beatPreview(current,assets,input){
 if(!current||input.expectedVersion!==current.version)fail('ARRANGEMENT_CONFLICT','顺序已有更新，请重新读取后再试。',409);
 const {bpm,beatsPerCut,seconds}=input;
 if(!Number.isFinite(bpm)||bpm<30||bpm>300||!Number.isInteger(beatsPerCut)||beatsPerCut<1||beatsPerCut>16||!Number.isFinite(seconds)||seconds<1||seconds>1500||Math.round(seconds*1e6)>current.durationUs)
 fail('BEAT_INPUT_INVALID','音乐速度填30到300，每1到16拍切一次，目标时长不能超过已有视频。');
 const target=Math.round(seconds*1e6),step=60000000/bpm*beatsPerCut;
 if(Math.ceil(target/step)+current.clips.length>500)fail('BEAT_TOO_MANY','切换太频繁，请增加每次切换间隔或缩短成片。');
 const sources=current.clips.map(clip=>({...clip,cursor:clip.inUs})),clips=[],captions=[];let total=0,index=0;
 while(total<target){
  let chosen=null;
  for(let i=0;i<sources.length;i++){const source=sources[index++%sources.length];if(source.cursor<source.outUs){chosen=source;break;}}
  if(!chosen)fail('BEAT_SOURCE_SHORT','可用画面不够，请缩短目标时长或增加素材。');
  const boundary=Math.min(target,Math.round((Math.floor((total+0.01)/step)+1)*step));
  const amount=Math.min(boundary-total,chosen.outUs-chosen.cursor);
  if(amount<=0)fail('BEAT_INPUT_INVALID','节奏计算没有完成，请调整音乐速度。');
  const inUs=chosen.cursor,outUs=inUs+amount,originalStart=chosen.startUs+inUs-chosen.inUs;
  clips.push({assetId:chosen.assetId,inUs,outUs});
  for(const cue of current.captions||[]){const from=Math.max(cue.startUs,originalStart),to=Math.min(cue.endUs,originalStart+amount);
   if(Math.round(to/1000)>Math.round(from/1000))captions.push({startUs:total+from-originalStart,endUs:total+to-originalStart,text:cue.text});
  }
  chosen.cursor=outUs;total+=amount;
 }
 const subtitle=captions.length?{mode:'timeline',assetId:null,text:captions.map((cue,i)=>(i+1)+'\n'+stamp(cue.startUs)+' --> '+stamp(cue.endUs)+'\n'+cue.text).join('\n\n')}:null;
 const result=prepareArrangement({clips,subtitle},assets);
 return {...result,expectedVersion:current.version,beatPlan:{bpm,beatsPerCut,seconds,source:'user-supplied-tempo',audioAnalyzed:false},
 warning:'这是按你填写的音乐速度安排换画面的方案，没有自动识别音乐，也没有添加配乐。有对白时请检查句子是否被打断；配乐可在剪映中添加和对齐。'};
}
module.exports={beatPreview};
