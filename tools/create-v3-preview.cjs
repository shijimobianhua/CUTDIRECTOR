'use strict';
const fs=require('node:fs'),path=require('node:path'),{build,verify}=require('./package-v3.cjs');
function createPreview(config){
 const status={schemaVersion:2,tier:'personal-preview',deferredByUser:true,createdAt:new Date().toISOString(),
  validation:'studio-r3 targeted domain checks, authenticated browser workflow and mock-provider integration; no full regression; no paid calls',
  deferred:[
   {id:'realTextModel',reason:'真实文字模型效果和连接，由用户试用'},
   {id:'realImage',reason:'真实图片生成及账单，按用户要求跳过'},
   {id:'realVideo',reason:'真实视频生成及账单，按用户要求跳过'},
   {id:'realVisualReview',reason:'真实模型收到画面后的效果，按用户要求跳过'},
   {id:'realSearch',reason:'DSH 搜索可能计费，按用户要求跳过'},
   {id:'policyEffect',reason:'同模型样片对照需要调用模型，按用户要求跳过'},
   {id:'nativeLong',reason:'接近25分钟的剪映精修导出，由用户试用'},
   {id:'noviceUsability',reason:'五位新手试用尚未执行'}
  ],
  implemented:[{id:'studio-scripts-storyboards',state:'implemented',validation:'versioned scripts, explicit proposal adoption and local React Flow; browser fixture checked'},{id:'independent-assistant',state:'implemented',validation:'general chat persists without creating ideas; deterministic DSH model fixture'},{id:'tool-standard-v2',state:'implemented',validation:'JSON Schema, GUI config, DPAPI, mock async provider lifecycle; real services deferred'},{id:'layered-handoff',state:'implemented',validation:'overlay/dialogue/music/volume handoff contract checked; native multitrack export deferred'},{id:'frontend-spatial-workbench',state:'implemented',validation:'authenticated browser interaction checks; responsive and reduced-motion checks; reference-led design'},{id:'external-media-plugins',state:'implemented',validation:'local media collection and poll recovery checked; real vendors deferred'},{id:'native-agent-delegation',state:'implemented',validation:'scoped DSH Agent; runtime probe required'},{id:'codex-image-executor',state:'implemented',validation:'native image events and output collection; local isolation gate fails closed'}],
  missingFeatures:[
   {id:'codex-image-executor',state:'environment-blocked',reason:'出图执行与原生产物回收已接入；当前电脑 DISM 与 SFC 均完成（exit 0）后，MXC 仍返回 0x80070002；elevated 后端不支持当前严格隔离策略。WSL2 适配器已实现，但安装管理员授权被取消，尚未验证。暂不开放原生生成，没有付费出图验收'}
  ],runtime:{mode:'local-development',portable:false,reason:'使用当前机器已安装依赖；上游 FFmpeg 下载未完成，不将旧本机二进制打入再分发包'}};
 const out=build(config.out,config.dataRoot,config.ffprobe,config.handoff,config.legacyRoot,status);verify(out);
 return {out,status,verified:true};
}
if(require.main===module){
 try{const result=createPreview(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify({out:result.out,verified:result.verified,tier:result.status.tier,deferred:result.status.deferred.map(item=>item.id),missing:result.status.missingFeatures.map(item=>item.id)}));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={createPreview};
