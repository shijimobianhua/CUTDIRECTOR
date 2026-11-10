'use strict';
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{join,dirname,isAbsolute}=require('node:path');
const run=promisify(execFile);
async function probeCapability(store,adapter,input){
 const id=input?.pluginId;
 if(!store.registry.list().some(entry=>entry.manifest.pluginId===id))throw Object.assign(new Error('PLUGIN_NOT_REGISTERED'),{code:'PLUGIN_NOT_REGISTERED',status:404});
 let available=false,message='还需要连接',level='detected';
 if(id==='cutdirector-search'){available=input.detected===true;message=available?'已检测到 DSH 搜索服务。搜索会消耗模型额度，需要单独确认，真实检索尚待验证。':'请先在 DSH 中配置网页搜索服务。';}
 if(id==='cutdirector-director'){available=input.detected===true;message=available?'当前 DSH 配置中有文字模型。尚未验证实际回复。':'请在 DSH 设置中添加文字模型。';}
 if(id==='cutdirector-visual-qa'){available=input.detected===true;message=available?'DSH 模型与图片附件通道已接入。实际调用前还会检查所选模型支持看图，效果待你实测。':'需要 DSH 模型服务和图片附件组件。也可以继续人工检查。';}
 if(id==='cutdirector-beatcut'){available=true;message='可以按你填写的音乐速度安排切换。没有自动听音乐，配乐在剪映中添加。';}
 if(id==='cutdirector-roughcut'){available=true;message='字幕区间与内容保护校验可用。提出建议仍需要文字模型和明确分享字幕。';}
 if(['cutdirector-seedream','cutdirector-seedance'].includes(id)){
  const config=store.generation.config();available=config.configured;
  const used=id==='cutdirector-seedream'?config.imageGeneratedOnce:config.generatedOnce;
  level=used?'executed':'detected';
  message=available?used?'已有取回并校验的生成结果。':'账号已连接，真实生成仍需确认费用后验证。':'请先连接方舟账号。';
 }
 if(id==='cutdirector-reference-ffmpeg'){
  try{
   const ffprobe=process.env.FFPROBE,ffmpeg=process.env.FFMPEG||(isAbsolute(ffprobe||'')?join(dirname(ffprobe),process.platform==='win32'?'ffmpeg.exe':'ffmpeg'):'ffmpeg');
   await run(ffmpeg,['-version'],{timeout:3000,windowsHide:true,maxBuffer:65536});
   available=true;message='本机视频读取组件可用。分析不会上传参考文件。';
  }catch{message='本机视频读取组件需要修复。';}
 }
 if(id==='cutdirector-jianying'){
  try{const result=await adapter.probe();available=!!result.target;message=available?'已检测到可用草稿库。实际写入前仍会重新检查剪映是否关闭。':'需要连接可验证的剪映草稿库。';}
  catch{message='剪映草稿连接还没有通过检查。仍可使用素材交接包。';}
 }
 return store.registry.probe(id,{available,message,level});
}
module.exports={probeCapability};
