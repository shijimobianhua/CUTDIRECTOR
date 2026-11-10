'use strict';
function ideaAttachments(idea,region){
 const section=element('section','',region);section.className='card';element('h2','灵感里的图片和视频',section);
 element('p','先放在这里作参考。只有你明确加到项目里，才会成为项目参考或可用素材。不会自动发给模型。',section);
 const picker=element('input','',element('label','添加图片或视频',section));picker.type='file';picker.accept='.png,.jpg,.jpeg,.mp4,.mov';picker.multiple=true;
 const status=element('p','',section);status.setAttribute('role','status');const list=element('div','',section),attempts=new WeakMap(),completed=new WeakSet();
 picker.addEventListener('change',async()=>{
  picker.disabled=true;try{
   for(const file of picker.files){if(completed.has(file))continue;if(!attempts.has(file))attempts.set(file,crypto.randomUUID());status.textContent='正在保存 '+file.name;
    const params=new URLSearchParams({commandId:attempts.get(file),name:file.name,kind:/\.(png|jpe?g)$/i.test(file.name)?'image':'video'});
    const response=await fetch('./v3/ideas/'+idea.id+'/files?'+params,{method:'POST',headers:{'X-Cutdirector-Session':session,'Content-Type':'application/octet-stream'},body:file});
    const value=await response.json();if(!response.ok)throw Error(value.error?.code);completed.add(file);
   }picker.value='';status.textContent='附件已保存在这条灵感里。';await refresh();
  }catch(error){status.textContent=describe(error);}finally{picker.disabled=false;}
 });
 async function refresh(){
  try{const files=await api('ideas/'+idea.id+'/files');if(!section.isConnected)return;list.replaceChildren();
   for(const file of files){const card=element('article','',list);card.className='card';element('h3',file.name,card);
    button(card,file.kind==='image'?'查看图片':'播放参考视频',()=>{
     const dialog=element('dialog','',card);dialog.setAttribute('aria-label','灵感附件预览');
     const back=button(dialog,'返回这条灵感',()=>{StudioUI.dismiss(dialog);});
     const content=element(file.kind==='image'?'img':'video','',dialog);content.src='./v3/ideas/'+idea.id+'/files/'+file.id+'/content';
     if(file.kind==='image'){content.alt=file.name;content.className='generated-frame';}else content.controls=true;
     dialog.addEventListener('close',()=>{if(content.pause)content.pause();dialog.remove();});dialog.showModal();back.focus();
    });
    if(state.projects.length){
     const project=element('select','',element('label','加到哪个项目',card));for(const item of state.projects)element('option',item.title,project).value=item.id;
     const purpose=element('select','',element('label','在项目中怎么用',card));element('option','只作参考',purpose).value='reference';element('option','允许用进视频内容',purpose).value='content';
     const commandId=crypto.randomUUID();button(card,'确认加到这个项目',async()=>{
      try{await api('ideas/'+idea.id+'/files/'+file.id+'/use',{projectId:project.value,purpose:purpose.value,commandId,confirm:true});status.textContent='已加到所选项目，原附件保留。';}
      catch(error){status.textContent=describe(error);}
     });
    }else element('p','开始制作项目后，可以把这份附件加入项目。',card);
   }
  }catch(error){status.textContent=describe(error);}
 }
 refresh();
}
