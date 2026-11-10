'use strict';
function projectQuality(project,workspace){
 const section=element('section','',workspace);section.dataset.workbenchSection='quality';section.tabIndex=-1;
 element('h2','检查画面再选用',section);
 methodChecklist(section,'visual-qa');
 element('p','逐项查看人物、道具、文字和衔接。你保存的检查记录属于人工检查；需要模型建议时，先准备画面，再确认发送和费用。分镜要求变化后，请重新核对。',section);
 const status=element('p','',section);status.setAttribute('role','status');
 const rows=element('div','',section);rows.className='cards';let refreshSequence=0;
 async function refresh(){
  const sequence=++refreshSequence;
  try{
   const [assets,images,reviews,story,visual,references]=await Promise.all([api('projects/'+project.id+'/assets'),api('projects/'+project.id+'/images'),api('projects/'+project.id+'/quality'),api('projects/'+project.id+'/story'),api('projects/'+project.id+'/visual-reviews'),api('projects/'+project.id+'/reference-files')]);
   if(!section.isConnected||sequence!==refreshSequence||section.querySelector('dialog[open]'))return;rows.replaceChildren();
   if(!assets.length&&!images.length)element('p','还没有可检查的图片或视频。可以先导入素材，或到出图和试拍区准备候选。',rows);
   for(const [kind,items]of [['image',images],['video',assets]])for(const target of items){
    const card=element('article','',rows);card.className='card';
    element('h3',target.name,card);
    const checks=reviews.filter(row=>row.kind===kind&&row.target_id===target.id),latest=checks[0];
    element('p',!latest?'还没记录检查':latest.story_version!==(story?.version||0)?'分镜已更新，需要重新核对':latest.verdict==='accepted'?'你已检查，认为可用':'你记录了需要修改的问题',card);
    const preview=button(card,kind==='video'?'播放检查':'放大检查',()=>{
     if(kind==='video')return openPreview(project,target,preview,undefined,'返回画面检查');
     const dialog=element('dialog','',card);dialog.setAttribute('aria-label','图片检查');
     const back=button(dialog,'返回画面检查',()=>dialog.close());
     const img=element('img','',dialog);img.src='./v3/projects/'+project.id+'/images/'+target.id+'/content';img.alt=target.name;img.className='generated-frame';
     dialog.addEventListener('close',()=>{dialog.remove();preview.focus();},{once:true});dialog.showModal();back.focus();
    });
    visualReviewActions(project,target,kind,story,card,visual);
    if(kind==='image'){
      const repair=element('details','',card);element('summary','图片打不开？重新连接原文件',repair);
      const picker=element('input','',element('label','选择原来的 PNG 或 JPG 图片',repair));picker.type='file';picker.accept='.png,.jpg,.jpeg';
      const attempts=new WeakMap(),message=element('p','',repair);
      picker.addEventListener('change',async()=>{const file=picker.files[0];if(!file)return;if(!attempts.has(file))attempts.set(file,crypto.randomUUID());picker.disabled=true;
       try{const response=await fetch('./v3/projects/'+project.id+'/images/'+target.id+'/reconnect?'+new URLSearchParams({commandId:attempts.get(file)}),{method:'POST',headers:{'X-Cutdirector-Session':session,'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw Error(result.error?.code);message.textContent='原图片已重新连接，已有选择和历史保留。';}
       catch(error){message.textContent=error.message==='RECONNECT_DIFFERENT_FILE'?'这张图片与原文件不一致，请重新选择原图片。':describe(error);}finally{picker.disabled=false;}
      });
    }
    button(card,'记录检查结果',()=>record(kind,target,story,card));
    if(checks.length){
     const history=element('details','',card);element('summary','查看检查记录',history);
     for(const check of checks.slice(0,10)){element('p',(check.verdict==='accepted'?'可用':'有问题')+' · '+check.time_us/1e6+' 秒 · '+check.note,history);
      element('small','人工检查 · 分镜第 '+check.story_version+' 版 · '+new Date(check.created_at).toLocaleString(),history);}
    }
   }
   for(const target of references){const card=element('article','',rows);card.className='card';element('h3',target.name+'（只作参考）',card);
    element('p','可以分析参考画面的结构、人物、构图和风格，不会把文件自动加入成片。视频只检查抽帧。',card);
    visualReviewActions(project,target,target.kind,story,card,visual,true);
   }
  }catch(error){if(section.isConnected)status.textContent=describe(error);}
 }
 function record(kind,target,story,card){
  const dialog=element('dialog','',card);dialog.setAttribute('aria-label','记录检查结果');
  element('h2','这份素材检查得怎么样？',dialog);element('p',target.name,dialog);
  const form=element('form','',dialog);
  const verdict=element('select','',element('label','检查结果',form));
  element('option','有问题，需要修改',verdict).value='issue';element('option','我检查过，认为可用',verdict).value='accepted';
  const time=element('input','',element('label','问题出现在第几秒（图片填 0）',form));time.type='number';time.min='0';time.step='0.001';time.max=String((target.durationUs||0)/1e6);time.value='0';time.required=true;
  const note=element('textarea','',element('label','记录给自己或导演的说明',form));note.maxLength=1000;
  const message=element('p','',form);let busy=false;const commandId=crypto.randomUUID();
  const back=button(form,'返回检查',()=>dialog.close());
  const save=element('button','保存检查记录',form);save.className='primary';
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;busy=true;back.disabled=save.disabled=true;
   try{await api('projects/'+project.id+'/quality',{commandId,kind,targetId:target.id,storyVersion:story?.version||0,
     timeUs:Math.round(Number(time.value)*1e6),verdict:verdict.value,note:note.value,confirm:true});dialog.close();await refresh();}
   catch(error){message.textContent=error.message==='QUALITY_STALE'?'分镜刚有了更新，请返回后按新要求重新检查。':describe(error);}
   finally{busy=false;back.disabled=save.disabled=false;}
  });
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
 }
 section.addEventListener('cutdirector-activated',()=>{if(!section.querySelector('dialog[open]'))refresh();});
 button(section,'重新读取候选和记录',refresh);
 refresh();
}
