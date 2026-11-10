'use strict';
const {frame}=require('../core/time.cjs');

const seconds='(\\d{1,4}(?:\\.\\d{1,3})?|[一二两三四五六七八九十半])\\s*(秒|分钟|s)';
const explicit=new RegExp('^(?:请|帮我)?\\s*(剪掉|删掉|去掉|保留)\\s*(开头|片头|结尾|片尾|前|最后)\\s*'+seconds+'[。！!\\s]*$','i');
const duration=new RegExp('(?:剪到|剪成|缩到|缩成|改到|改成|时长[为是]|提取|保留重点)[，,\\s]*'+seconds+'(?=$|[，,。；;！!\\s])','i');
const chinese={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,半:0.5};
const amount=(value,unit)=>(chinese[value]??Number(value))*(unit==='分钟'?60:1);
const affirmative=/^(?:可以|行|好(?:的)?|(?:开始|继续)(?:剪辑?|吧|把)?[吧把]?|剪吧)[。！!?\s]*$/;

function requestedDuration(request){
  if(/(?:不|别)(?:用|要)?(?:剪|缩|改|提取)|[？?]/.test(request))return null;
  const match=duration.exec(request);
  const value=match&&amount(match[1],match[2]);
  return value>0&&value<=86400?value:null;
}

function workflow(project,run,history){
  const clips=project.clips.filter(clip=>!run.selection.length||run.selection.includes(clip.id));
  if(/^(?:生成|做个?|导出)?\s*预览[。！!\s]*$/.test(run.request)){
    if(!clips.length)return {reply:'请先上传一段视频，再生成预览。'};
    return {proposal:{op:'render',target:project.projectId,params:{type:'preview'},text:'生成当前剪辑的预览视频。'}};
  }
  const direct=explicit.exec(run.request);
  const yes=affirmative.test(run.request);
  const last=history.at(-1);
  const suggested=yes&&last?.guidance?.request&&last.revision===run.revision&&
    last.selection.length===run.selection.length&&last.selection.every(id=>run.selection.includes(id));
  const trim=direct||(suggested?explicit.exec(last.guidance.request):null);
  if(trim){
    if(clips.length!==1)return {reply:clips.length?'请先选中要剪的一个片段，然后再发这句话。':'请先上传要剪的视频。'};
    const [clip]=clips;
    const [,verb,where,value,unit]=trim;
    const time=amount(value,unit);
    const count=frame(Math.round(time*1000000),project.outputSpec.fps);
    if(!count||count>=clip.outFrame-clip.inFrame)
      return {reply:'这个时长不适合当前片段。请选一个比片段短、至少能保留一帧的时长。'};
    const keep=verb==='保留';
    const head=['开头','片头','前'].includes(where);
    const cutFromStart=keep?!head:head;
    const change=keep?clip.outFrame-clip.inFrame-count:count;
    return {proposal:{op:'segment.trim',target:clip.id,
      params:{inFrame:clip.inFrame+(cutFromStart?change:0),outFrame:clip.outFrame-(cutFromStart?0:change)},
      text:(keep?'保留':'剪掉')+(head?'开头':'结尾')+time+'秒。'}};
  }
  const goal=run.intent.targetSec;
  const contentGoal=/重点|精华|摘要|高光/.test(run.request);
  if(!yes&&!contentGoal&&!requestedDuration(run.request))return null;
  if(!clips.length)return {reply:'请先上传一段视频，然后告诉我想剪到多长。'};
  if(yes&&!goal)return {reply:'可以。你想剪掉哪一段，还是想保留重点压缩时长？可以直接说「剪掉开头两秒」。'};
  const hasEvidence=clips.some(clip=>project.transcripts.some(t=>t.assetId===clip.mediaId&&t.words.length)||
    project.captions.some(caption=>caption.segmentId===clip.id));
  if(hasEvidence)return null;
  const reply='还没有视频里说的话，我暂时无法判断哪些是重点。你可以导入字幕，或者指定保留哪一段。';
  const fallback=clips.length===1&&goal>0&&
    frame(Math.round(goal*1000000),project.outputSpec.fps)<clips[0].outFrame-clips[0].inFrame;
  const request=fallback?'保留开头'+goal+'秒':null;
  return {reply:request?reply+' 想先试一版的话，可以点「'+request+'」。':reply,
    guidance:{importSubtitles:true,...(request?{request}:{})}};
}
module.exports={workflow,requestedDuration};
