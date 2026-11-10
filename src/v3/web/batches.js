'use strict';
function projectBatches(project,workspace){
 const section=element('section','',workspace);section.dataset.workbenchSection='batches';section.tabIndex=-1;
 element('h2','一次安排几个镜头',section);
 element('p','先准备一批任务再统一核对。每批最多 10 镜，同时最多提交 2 项。需要人工判断的选用和交接仍逐步确认。',section);
 const status=element('p','',section);status.setAttribute('role','status');
 const form=element('form','',section),list=element('div','',section);list.className='cards';
 const kind=element('select','',element('label','这次准备什么',form));
 element('option','每镜的开始图',kind).value='image';element('option','每镜一段试拍视频',kind).value='video';
 const seconds=element('input','',element('label','每段视频多少秒（出图时忽略）',form));seconds.type='number';seconds.min='4';seconds.max='30';seconds.value='5';seconds.required=true;
 const choices=element('fieldset','',form);element('legend','选 1 到 10 个已保存镜头',choices);
 const prepare=element('button','准备这批任务',form);prepare.className='primary';
 const prefix='projects/'+project.id+'/batches';let story,attempt,pendingPrepare=false,reloadSequence=0;
 async function reloadShots(){
  const sequence=++reloadSequence;prepare.disabled=true;
  let saved;
  try{saved=await api('projects/'+project.id+'/story');}
  finally{if(sequence===reloadSequence)prepare.disabled=pendingPrepare;}
  if(!section.isConnected||sequence!==reloadSequence)return;
  const previous=new Set([...choices.querySelectorAll('input:checked')].map(input=>input.value));
  story=saved;choices.replaceChildren();element('legend','选 1 到 10 个已保存镜头',choices);
  for(const [index,shot]of (saved?.shots||[]).entries()){
   const input=element('input','',element('label','镜头 '+(index+1)+' · '+shot.action.slice(0,50),choices));
   input.type='checkbox';input.value=shot.id;input.checked=previous.has(shot.id);
  }
  if(!saved?.shots.length)element('p','先保存分镜，再来准备一批任务。',choices);
 }
 async function refresh(){
  try{
   const batches=await api(prefix);if(!section.isConnected)return;list.replaceChildren();
   const states={awaiting_approval:'等待你确认',dispatching:'正在逐项提交',submitted:'已提交，继续查看各项结果',paused:'已暂停后续提交',interrupted:'上次提交中断，未自动重发',cancelled:'已停止后续提交'};
   for(const batch of batches){
    const card=element('article','',list);card.className='card';
    element('h3',(batch.kind==='image'?'分镜出图':'视频试拍')+' · '+batch.maxJobs+' 项',card);
    element('p',states[batch.state]||'需要检查',card);element('small','分镜第 '+batch.storyVersion+' 版'+(batch.maxSeconds?' · 合计 '+batch.maxSeconds+' 秒':''),card);
    for(const job of batch.jobs){const state={awaiting_approval:'等待确认',cancelled:'已取消',dispatching:'正在提交',unknown:'结果待核对',queued:'排队中',running:'生成中',ready:'已有结果',collecting:'正在取回',failed:'这项未完成',collect_failed:'需要重新取回',expired:'已超时'}[job.state]||'需要检查';element('p','镜头 '+((story?.shots.findIndex(shot=>shot.id===job.shotId)??-1)+1)+' · '+state,card);}
    if(['awaiting_approval','paused','interrupted'].includes(batch.state))button(card,'检查这批内容和费用',()=>approve(batch,card));
    if(!['submitted','cancelled'].includes(batch.state))button(card,'停止后续提交',async()=>{
      try{await api(prefix+'/'+batch.id+'/cancel',{});status.textContent='已停止后续提交。已经提交到方舟的任务仍可能继续并计费。';await refresh();}
      catch(error){status.textContent=arkProblem(error);}
    });
    button(card,'查看各项结果',()=>locateWorkbench(workspace.querySelector('[data-workbench-section="'+(batch.kind==='image'?'image-generation':'generation')+'"]')));
   }
  }catch(error){if(section.isConnected)status.textContent=arkProblem(error);}
 }
 function approve(batch,card){
  const dialog=element('dialog','',card);dialog.setAttribute('aria-label','批量生成确认');
  element('h2','先检查整批再提交',dialog);
  element('p','火山方舟 · '+batch.maxJobs+' 项'+(batch.maxSeconds?' · 共 '+batch.maxSeconds+' 秒':'图片')+' · 分镜第 '+batch.storyVersion+' 版',dialog);
  for(const job of batch.jobs){
   element('h3','镜头 '+((story?.shots.findIndex(shot=>shot.id===job.shotId)??-1)+1)+(job.seconds?' · '+job.seconds+' 秒':''),dialog);
   element('pre',job.prompt,dialog);
   for(const name of job.uploadNames)element('p','将上传 '+name,dialog);
   if(['unknown','dispatching'].includes(job.state))element('p','这项已有提交待核对。本批不会重新提交，请到原任务核对。',dialog);
  }
  element('p','目前没有可验证的实时金额报价，实际费用以方舟账单为准。确认范围只包含上面列出的任务，不会追加新镜头。',dialog);
  const charge=element('input','',element('label','我接受金额未知的这批生成，由我的方舟账号计费',dialog));charge.type='checkbox';
  const sharing=element('input','',element('label','我同意将上面列出的文字和图片发给方舟',dialog));sharing.type='checkbox';
  const message=element('p','',dialog);let busy=false;
  const back=button(dialog,'先不生成',()=>dialog.close());
  const go=button(dialog,'确认提交这批任务',async()=>{
   if(busy||!charge.checked||!sharing.checked)return;busy=true;back.disabled=go.disabled=true;
   try{
    await api(prefix+'/'+batch.id+'/approve',{maxJobs:batch.maxJobs,maxSeconds:batch.maxSeconds,confirmCharge:true,confirmUpload:true,acceptUnknownPrice:true});
    dialog.close();status.textContent='正在按确认范围提交。可以离开页面，稍后到任务页继续查看。';await refresh();
   }catch(error){message.textContent=batchProblem(error);}finally{busy=false;back.disabled=false;update();}
  },true);
  function update(){go.disabled=busy||!charge.checked||!sharing.checked;}
  charge.addEventListener('change',update);sharing.addEventListener('change',update);update();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(prepare.disabled)return;
  const shots=[...choices.querySelectorAll('input:checked')].map(input=>input.value);
  if(!shots.length||shots.length>10){status.textContent='请选 1 到 10 个镜头。';return;}
  pendingPrepare=true;prepare.disabled=true;
  const input={storyVersion:story.version,kind:kind.value,shots,...kind.value==='image'?{frame:'start'}:{seconds:Number(seconds.value)}};
  const signature=JSON.stringify(input);if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
  try{await api(prefix,{...input,commandId:attempt.id});attempt=undefined;status.textContent='任务已准备，还没有提交生成。请检查这批内容和费用。';await refresh();}
  catch(error){status.textContent=batchProblem(error);}finally{pendingPrepare=false;prepare.disabled=false;}
 });
 function batchProblem(error){return ({BATCH_EXPIRED:'这批确认已过期。请按当前分镜重新准备，避免旧要求被提交。',BATCH_APPROVAL_REQUIRED:'请核对整批数量、时长和外传内容后再确认。',BATCH_INVALID:'请选 1 到 10 个有效镜头，并核对视频时长。'})[error.message]||arkProblem(error);}
 workspace.addEventListener('cutdirector-story-version',()=>{reloadShots().catch(error=>{status.textContent=arkProblem(error);});});
 section.addEventListener('cutdirector-activated',()=>{reloadShots().then(refresh).catch(error=>{status.textContent=arkProblem(error);});});
 button(section,'重新读取分镜和任务',async()=>{await reloadShots();await refresh();});
 reloadShots().then(refresh).catch(error=>{status.textContent=arkProblem(error);});
 const timer=setInterval(()=>{if(!section.isConnected)clearInterval(timer);else if(!document.hidden)refresh();},5000);
}
