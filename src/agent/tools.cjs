'use strict';
const fs=require('node:fs');
const {fail}=require('../core/util.cjs');
const {detail,short}=require('./context.cjs');
const {protectTrim,validateProposal}=require('../core/roughcut.cjs');
const {visibleEvidence,kept}=require('./evidence.cjs');

const edits=['segment.trim','caption.correct','roughcut.apply','render'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function proposal(value,project,run){
  const {op,target,params,text}=value;
  if(!edits.includes(op)||!object(params)||typeof text!=='string'||!text.trim()||
      typeof target!=='string'||JSON.stringify(params).length>12000) fail('AGENT_PROPOSAL_INVALID');
  const selected=id=>!run.selection.length||run.selection.includes(id);
  if(op==='segment.trim'){
    const clip=project.clips.find(c=>c.id===target);
    const {inFrame,outFrame}=params;
    if(!clip||!selected(clip.id)||Object.keys(params).length!==2||![inFrame,outFrame].every(Number.isSafeInteger)||
       inFrame<clip.inFrame||outFrame>clip.outFrame||inFrame>=outFrame) fail('AGENT_SCOPE_INVALID');
    protectTrim(project,clip,params);
  }
  if(op==='caption.correct'){
    const caption=project.captions.find(c=>c.id===target);
    if(!caption||!selected(caption.segmentId)||typeof params.text!=='string'||params.text.length>1000||
       Object.keys(params).length!==1) fail('AGENT_SCOPE_INVALID');
  }
  if(op==='roughcut.apply'){
    if(target!==project.projectId||run.selection.length) fail('AGENT_SCOPE_INVALID','整轨粗剪需要全工程范围');
    validateProposal(project,{...params,baseRevision:project.revision});
  }
  if(op==='render'&&(target!==project.projectId||Object.keys(params).length!==1||
    !['preview','export','inspect'].includes(params.type))) fail('AGENT_PROPOSAL_INVALID');
  const terms=run.intent.mustKeep||[];
  if(terms.length&&op!=='render'){
    const clips=op==='roughcut.apply'?params.items.map(item=>({
      ...project.clips.find(c=>c.id===item.segmentId),inFrame:item.inFrame,outFrame:item.outFrame
    })):project.clips.map(c=>op==='segment.trim'&&c.id===target?{...c,...params}:c);
    const captions=op==='caption.correct'?project.captions.map(c=>c.id===target?{...c,text:params.text}:c):project.captions;
    if(kept(terms,visibleEvidence(project,clips,captions)).length!==terms.length)
      fail('AGENT_PROTECTED_CONTENT','无法验证剪辑后仍保留全部指定内容，请补充转写或调整提案');
  }
  return {op,target,params:op==='roughcut.apply'?{...params,baseRevision:project.revision}:params,
    text:short(text,1800),more:value.more===true,revision:project.revision};
}

function artifactJob(jobs,project,id){
  const job=jobs?.read(id);
  if(!job||job.projectId!==project.projectId||job.revision!==project.revision||job.status!=='succeeded')
    fail('AGENT_SCOPE_INVALID','产物必须来自本工程的当前版本');
  return job;
}

function digest(jobs,job){
  const artifacts=job.artifacts.map(({name,hash})=>({name,hash}));
  const out={jobId:job.id,revision:job.revision,type:job.manifest.type,artifacts};
  if(artifacts.some(a=>a.name==='report.json')){
    const report=JSON.parse(fs.readFileSync(jobs.artifact(job.id,'report.json').path,'utf8'));
    out.file=report.file.status;
    out.content='unverified';
    out.human='unverified';
  }
  return out;
}

function registry({jobs,delegate}){
  return {
    segment:{description:'{segmentId,revision,after?} Read evidence in the pinned selection.',execute:({args,project,run})=>({data:detail(project,run,args)})},
    qa:{description:'{jobId} Read current revision file QA.',execute:({args,project})=>({data:digest(jobs,artifactJob(jobs,project,args.jobId))})},
    frame:{description:'{jobId,name} Send one verified current-revision JPG to the configured vision model.',enabled:({run,provider})=>run.allowFrame&&provider.vision,
      execute:({args,project})=>{
        const job=artifactJob(jobs,project,args.jobId);
        if(job.manifest.type!=='inspect'||typeof args.name!=='string'||!/^[\w.-]+\.jpg$/.test(args.name)) fail('AGENT_TOOL_INVALID');
        const file=jobs.artifact(job.id,args.name).path;
        if(fs.statSync(file).size>1024*1024) fail('AGENT_TOOL_INVALID','关键帧超过发送上限');
        return {data:{jobId:job.id,name:args.name,revision:project.revision,visual:'frame-available'},
          image:'data:image/jpeg;base64,'+fs.readFileSync(file).toString('base64')};
      }},
    dsh_analyze:{description:'{segmentId,revision} Delegate read-only analysis of this bounded evidence page.',
      enabled:({run})=>run.allowDelegate&&delegate?.isolated===true,
      execute:async({args,project,run,signal})=>{
        const evidence=detail(project,run,{segmentId:args.segmentId,revision:args.revision});
        const result=await delegate.analyze({evidence,signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
        if(typeof result?.text!=='string') fail('AGENT_DELEGATE_INVALID');
        return {data:{source:'dsh',segmentId:evidence.segmentId,revision:evidence.revision,text:short(result.text,1800)}};
      }}
  };
}
module.exports={edits,proposal,digest,registry,object};
