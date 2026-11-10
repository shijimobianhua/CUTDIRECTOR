'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),{join,extname}=require('node:path'),{Readable}=require('node:stream'),{randomUUID,createHash}=require('node:crypto'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const {issue}=require('./studio-store.cjs'),{ingest}=require('./media.cjs');
const run=promisify(execFile);
function createStudioMedia(studio,store,root){
 async function add(projectId,name,bytes,commandId,kind,extra={}){
  store.project(projectId);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>256*1024*1024)issue('MEDIA_INVALID','素材为空或超过 256 MB。');
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(kind!=='audio'){
   const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));const leaf=kind==='image'?'image'+(png?'.png':'.jpg'):'video.mp4';
   const request=Object.assign(Readable.from([bytes]),{headers:{'content-type':'application/octet-stream'}});
   return {...await ingest(request,root,store,projectId,commandId,leaf,undefined,kind==='image',{...extra,source:'studio-tool',visualReview:'user-required'}),kind};
  }
  const dir=join(root,'media');await fsp.mkdir(dir,{recursive:true});const temp=join(dir,randomUUID()+'.audio');
  try{await fsp.writeFile(temp,bytes,{flag:'wx'});const header=bytes.subarray(0,16);if(!(header.toString('ascii',0,4)==='RIFF'||header.toString('ascii',0,3)==='ID3'||header.toString('ascii',0,4)==='OggS'||header.toString('ascii',4,8)==='ftyp'||header[0]===255&&(header[1]&224)===224))issue('MEDIA_INVALID','请选择 WAV、MP3、M4A 或 OGG 音频。');
   const {stdout}=await run(process.env.FFPROBE||'ffprobe',['-v','error','-protocol_whitelist','file','-show_streams','-show_format','-of','json',temp],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});const data=JSON.parse(stdout),audio=data.streams?.find(s=>s.codec_type==='audio'),durationUs=Math.round(Number(audio?.duration||data.format?.duration)*1e6);
   if(!audio||data.streams.some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)||!Number.isSafeInteger(durationUs)||durationUs<1||durationUs>1500000000)issue('MEDIA_INVALID','无法读取音频时长，或超过 25 分钟。');
   const types={mp3:'audio/mpeg',pcm_s16le:'audio/wav',pcm_s24le:'audio/wav',pcm_f32le:'audio/wav',aac:'audio/mp4',vorbis:'audio/ogg',opus:'audio/ogg'};
   const meta={kind:'audio',name:String(name||'音频').replace(/[\\/\0-\x1f]/g,'').slice(0,160),durationUs,codec:audio.codec_name,contentType:types[audio.codec_name]||'audio/wav',size:bytes.length,...extra};
   const asset=store.mutate('asset',{commandId,projectId,digest,...meta},()=>{try{fs.linkSync(temp,join(dir,digest));}catch(e){if(e.code!=='EEXIST')throw e;}});return {...asset,kind:'audio'};
  }finally{await fsp.unlink(temp).catch(()=>{});}
 }
 async function references(projectId,refs){
  const out=[];let total=0;for(const ref of refs){const owned=ref.kind==='image'?store.image(projectId,ref.id):store.asset(projectId,ref.id);
   if(owned.digest!==ref.digest)issue('MEDIA_CHANGED','参考素材已经变化，请重新准备。',409);
   const bytes=await fsp.readFile(join(root,'media',owned.digest));total+=bytes.length;if(total>64*1024*1024||bytes.length>32*1024*1024||createHash('sha256').update(bytes).digest('hex')!==ref.digest)issue('MEDIA_CHANGED');
   out.push({...ref,bytes});
  }return out;
 }
 return {add,references};
}
module.exports={createStudioMedia};
