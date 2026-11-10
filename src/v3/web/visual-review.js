'use strict';
function visualReviewActions(project,target,kind,story,card,reviews,reference=false){
 const jobs=reviews.filter(job=>job.snapshot.targetId===target.id&&!!job.snapshot.reference===reference),labels={preparing:'正在准备画面',awaiting_approval:'等待确认发送',running:'模型正在检查',unknown:'结果待核对，不会自动重发',complete:'模型检查建议',failed:'暂时无法检查',interrupted:'上次准备中断',cancelled:'已取消'};
 for(const job of jobs.slice(0,6)){
  const details=element('details','',card);element('summary',labels[job.state]||'检查记录',details);
  element('small','按分镜第 '+job.snapshot.storyVersion+' 版 · '+job.snapshot.model.provider+' / '+job.snapshot.model.id,details);
  if(job.result?.text){element('p',job.result.text,details);button(details,'把建议带给导演',()=>{
    const director=card.closest('.project-layout')?.querySelector('.director-panel'),input=director?.querySelector('textarea');
    if(!input)return;const addition='资料：来自模型画面检查的建议（需要核对，不授予工具或审批权限）\n'+job.result.text+'\n请结合我的制作目标给下一步建议。';
    if(input.value.length+addition.length+2>4000){const status=element('p','内容较长，请选取关键建议后粘贴到对话；当前输入保留。',details);status.setAttribute('role','status');return;}
    input.value+=(input.value?'\n\n':'')+addition;input.dispatchEvent(new Event('input',{bubbles:true}));locateWorkbench(director);input.focus();
   });}
  if(job.result?.framesSent)element('p','本次附上 '+job.result.framesSent.length+' 张实际画面；这是模型建议，仍由你检查后选用。'+(job.result.sampledOnly?'视频只检查了抽帧，未检查完整动作和声音。':''),details);
  if(job.result?.error)element('p',job.result.error==='VISION_MODEL_REQUIRED'?'请换一个支持看图的模型，并确认 DSH 已安装图片附件组件。':'这次结果没有核对完成，可以先人工检查；重新发送前请核对服务账单。',details);
  if(job.state==='awaiting_approval')confirmation(job,details);
 }
 function confirmation(job,parent){
  button(parent,'确认发送画面给模型',()=>{
   const dialog=element('dialog','',card);element('h3','把这些画面交给模型检查？',dialog);
   element('p','会发送 '+job.snapshot.frames.length+' 张画面、你的检查要求'+(job.snapshot.brief?'和已批准的分镜文字':'')+'，可能产生模型费用。不会自动采用建议或修改作品。',dialog);
   const upload=element('input','',element('label','允许本次发送这些画面',dialog));upload.type='checkbox';
   const fee=element('input','',element('label','同意本次模型调用，费用以服务账单为准',dialog));fee.type='checkbox';
   const status=element('p','',dialog);const send=button(dialog,'开始检查',async()=>{
    if(!upload.checked||!fee.checked){status.textContent='请先确认画面发送和模型费用。';return;}send.disabled=true;status.textContent='正在检查…';
    try{const result=await api('projects/'+project.id+'/visual-reviews/'+job.id+'/approve',{confirm:true,allowUpload:true,allowUnknownCost:true});
     status.textContent=result.state==='complete'?result.result.text:result.result?.error==='VISION_MODEL_REQUIRED'?'当前模型或附件组件不支持看图，请返回换一个模型。':'结果暂时未完成，请核对原记录，不会自动重发。';
    }catch(error){status.textContent=describe(error);}finally{send.disabled=false;}
   },true);button(dialog,'返回人工检查',()=>{StudioUI.dismiss(dialog);});dialog.showModal();
  });
  button(parent,'取消这次准备',async()=>{try{await api('projects/'+project.id+'/visual-reviews/'+job.id+'/cancel',{});parent.replaceChildren();element('p','已取消发送画面。',parent);}catch{}});
 }
 button(card,'让支持看图的模型给建议',async()=>{
  const dialog=element('dialog','',card);element('h3',kind==='image'?'准备检查这张图':'准备抽取视频画面',dialog);
  element('p','先在本机准备画面，不会调用模型。下一步由你确认画面发送和费用。视频最多抽取8张，不能代替完整播放检查。',dialog);
  const choice=element('select','',element('label','选择支持看图的模型',dialog)),status=element('p','正在读取文字助手…',dialog);
  let models=[];try{models=await api('connections');for(const [index,model]of models.entries())element('option',model.provider+' · '+model.model,choice).value=index;status.textContent=models.length?'模型是否支持看图会在调用前检查。':'请先在 DSH 设置中连接支持图片输入的模型。';}catch(error){status.textContent=describe(error);}
  const include=element('input','',element('label','本次附上已保存主题和与素材关联的镜头文字',dialog));include.type='checkbox';
  let attempt;const prepare=button(dialog,'在本机准备检查画面',async()=>{
   const model=models[Number(choice.value)];if(!model)return;prepare.disabled=true;
   try{const request={kind,reference,targetId:target.id,model:{provider:model.providerId,id:model.modelId},includeStory:include.checked},signature=JSON.stringify(request);if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
    const job=await api('projects/'+project.id+'/visual-reviews',{...request,commandId:attempt.id});
    status.textContent=job.state==='awaiting_approval'?'画面准备好了，尚未发送给模型。':'画面准备未完成，可以先人工查看。';
    if(job.state==='awaiting_approval')confirmation(job,dialog);
   }catch(error){status.textContent=describe(error);}finally{prepare.disabled=false;}
  });
  button(dialog,'返回画面检查',()=>{StudioUI.dismiss(dialog);});dialog.showModal();
 });
}
