'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fail}=require('../../core/util.cjs');
function run(bin,args,timeout,env=process.env){return new Promise((resolve,reject)=>{
 const child=spawn(bin,args,{windowsHide:true,shell:false,env,stdio:['ignore','pipe','pipe']});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let out='',err='',size=0,code;const stop=c=>{code=c;child.kill();};
 const timer=setTimeout(()=>stop('ASR_TIMEOUT'),timeout);
 child.stdout.on('data',c=>{size+=Buffer.byteLength(c);if(size>2*1024*1024)stop('ASR_OUTPUT_TOO_LARGE');else out+=c;});child.stderr.on('data',c=>{err=(err+c).slice(-4096);});
 child.on('error',e=>{clearTimeout(timer);reject(Object.assign(new Error(e.message),{code:'ASR_COMMAND_FAILED'}));});
 child.on('close',status=>{clearTimeout(timer);if(code||status!==0)reject(Object.assign(new Error(err||code||`命令退出 ${status}`),{code:code||'ASR_COMMAND_FAILED'}));else resolve(out);});
});}
class CommandProvider{
 constructor(command,{timeout=Number(process.env.VIDEO_ASR_TIMEOUT_MS||120000)}={}){this.command=command;this.timeout=Number.isFinite(timeout)&&timeout>0?timeout:120000;}
 readiness(){return {status:'external-command-ready',realProvider:true,reason:'已配置外部本地命令；识别质量与模型由 provider 提供'};}
 async transcribe(asset){let argv;try{argv=this.command.trim().startsWith('[')?JSON.parse(this.command):[this.command];}catch{fail('ASR_CONFIG_INVALID','VIDEO_ASR_CMD 应为可执行文件路径或 JSON argv 数组');}if(!Array.isArray(argv)||!argv.length||argv.some(s=>typeof s!=='string'||!s))fail('ASR_CONFIG_INVALID');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-asr-')),audio=path.join(dir,'audio.wav');
 try{await run(process.env.FFMPEG||'ffmpeg',['-nostdin','-v','error','-y','-i',asset.path,'-vn','-af','asetpts=PTS-STARTPTS','-ac','1','-ar','16000',audio],this.timeout);
  const output=await run(argv[0],[...argv.slice(1),audio],this.timeout,{...process.env,VIDEO_ASR_ASSET_ID:asset.id,VIDEO_ASR_ASSET_HASH:asset.hash,VIDEO_ASR_DURATION_US:String(asset.durationUs)});let transcript;try{transcript=JSON.parse(output);}catch{fail('ASR_INVALID','外部命令 stdout 必须是 JSON transcript');}
  return {status:'external-provider',realTranscription:true,provenance:{kind:'external-command',source:'VIDEO_ASR_CMD'},transcript:require('./index.cjs').validateTranscript(transcript,asset)};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
}
module.exports={CommandProvider,run};
