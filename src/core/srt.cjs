'use strict';
const {fail,hash}=require('./util.cjs');
function parseSrt(text){
 if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>2*1024*1024)fail('SRT_INVALID','SRT 为空或超过 2MB');
 const stamp=s=>{const m=/^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(s);if(!m)fail('SRT_INVALID','时间格式应为 HH:MM:SS,mmm');return ((+m[1]*3600 + +m[2]*60 + +m[3])*1000 + +m[4])*1000;};
 let previous=0;
 return text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/).map((block,i)=>{
  const lines=block.split('\n');if(/^\d+$/.test(lines[0]))lines.shift();
  const m=/^(\S+)\s+-->\s+(\S+)\s*$/.exec(lines.shift()||'');if(!m)fail('SRT_INVALID',`第 ${i+1} 段时间行无效`);
  const startUs=stamp(m[1]),endUs=stamp(m[2]),text=lines.join('\n').trim();
  if(!Number.isSafeInteger(endUs)||startUs<previous||endUs<=startUs||!text)fail('SRT_INVALID',`第 ${i+1} 段为空、重叠或时间倒置`);
  previous=endUs;return {id:'W'+(i+1),startUs,endUs,text,confidence:null};
 });
}
function importSrt(p,asset,{srt,language='und'}){
 const words=parseSrt(srt),tid='T_srt_'+hash({srt,asset:asset.hash}).slice(0,24);
 const t={id:tid,assetId:asset.id,model:'srt-import',language,precision:'segment',timeUnit:'microseconds',timeReference:'asset-origin',words,missing:[],uncertain:[]};
 require('../adapters/asr/index.cjs').validateTranscript(t,asset);
 if(p.transcripts.some(t=>t.id===tid))fail('SRT_ALREADY_IMPORTED','此 SRT 已导入');
 p.transcripts.push({...t,provenance:{kind:'srt-import',source:'User supplied UTF-8 SRT'},status:'srt-import',realTranscription:false,assetHash:asset.hash});
 const segmentIds=p.clips.filter(s=>s.mediaId===asset.id).map(s=>s.id);
 return [tid,...(segmentIds.length?require('./captions.cjs').generate(p,{transcriptId:tid,segmentIds}):[])];
}
module.exports={parseSrt,importSrt};
