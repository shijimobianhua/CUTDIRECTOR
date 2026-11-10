'use strict';
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const {stat,writeFile}=require('node:fs/promises'),{join,dirname,isAbsolute}=require('node:path');
const run=promisify(execFile);
function issue(code,status=422){return Object.assign(new Error(code),{code,status});}
async function digest(file,signal){const hash=createHash('sha256');for await(const chunk of createReadStream(file,{signal}))hash.update(chunk);return hash.digest('hex');}
function createReferenceAnalyzer(root,refs,options={}){
  const active=new Map(),controller=new AbortController(),execute=options.run||run;
  let closed=false;
  function check(){if(closed)throw issue('REFERENCE_ANALYSIS_STOPPED',409);}
  async function analyze(projectId,id,input){
    check();
    if(input?.confirm!==true)throw issue('REFERENCE_ANALYSIS_APPROVAL_REQUIRED',403);
    const source=refs.file(projectId,id);
    if(source.kind!=='video')throw issue('REFERENCE_VIDEO_REQUIRED');
    if(source.durationUs>1500000000)throw issue('REFERENCE_TOO_LONG');
    if(active.has(id))return active.get(id);
    if(active.size>=2)throw issue('REFERENCE_ANALYSIS_BUSY',409);
    const task=(async()=>{
      const file=join(root,'media',source.digest),info=await stat(file).catch(()=>{throw issue('ASSET_MISSING',404);});
      if(!info.isFile()||info.size!==source.size||await digest(file,controller.signal)!==source.digest)throw issue('REFERENCE_CHANGED');
      check();
      const ffprobe=process.env.FFPROBE,ffmpeg=process.env.FFMPEG||(isAbsolute(ffprobe||'')?join(dirname(ffprobe),process.platform==='win32'?'ffmpeg.exe':'ffmpeg'):'ffmpeg');
      let output;
      try{output=await execute(ffmpeg,['-hide_banner','-nostdin','-protocol_whitelist','file','-f','mov','-enable_drefs','0','-i',file,
        '-vf','select=gt(scene\\,0.28),showinfo','-an','-f','null','-'],{windowsHide:true,signal:controller.signal,timeout:90000,maxBuffer:2*1024*1024});}
      catch(error){check();throw issue(error.code==='ENOENT'?'MEDIA_RUNTIME_UNAVAILABLE':'REFERENCE_ANALYSIS_FAILED');}
      check();
      const cuts=[...output.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match=>Math.round(Number(match[1])*1e6)).filter(time=>time>0&&time<source.durationUs);
      const frames=[];
      const sampleCount=Math.min(8,Math.ceil(source.durationUs/1000000));
      for(let index=0;index<sampleCount;index++){
        check();
        const timeUs=Math.round(index*source.durationUs/sampleCount);
        let bytes;
        try{bytes=(await execute(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file','-ss',String(timeUs/1e6),'-f','mov','-enable_drefs','0','-i',file,
          '-frames:v','1','-vf','scale=min(640\\,iw):-2','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,signal:controller.signal,timeout:15000,maxBuffer:3*1024*1024,encoding:'buffer'})).stdout;}
        catch{check();throw issue('REFERENCE_ANALYSIS_FAILED');}
        check();
        if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw issue('REFERENCE_ANALYSIS_FAILED');
        const hash=createHash('sha256').update(bytes).digest('hex');
        await writeFile(join(root,'media',hash),bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        frames.push({number:index+1,timeUs,digest:hash,size:bytes.length,contentType:'image/jpeg',name:'参考画面 '+(index+1)});
      }
      check();
      return refs.record(projectId,id,{executor:'cutdirector-reference-ffmpeg',version:1,sourceDigest:source.digest,
        createdAt:new Date().toISOString(),durationUs:source.durationUs,width:source.width,height:source.height,
        cutTimesUs:[...new Set(cuts)].slice(0,200),cutCount:cuts.length,frames,
        visualReviewed:false,note:'已在本机提取画面和可能的切镜点。没有调用视觉模型，人物、动作与内容含义需要人工检查。'});
    })();
    active.set(id,task);
    try{return await task;}catch(error){check();throw error;}finally{active.delete(id);}
  }
  function stop(){closed=true;controller.abort();return Promise.allSettled([...active.values()]);}
  return {analyze,stop};
}
module.exports={createReferenceAnalyzer};
