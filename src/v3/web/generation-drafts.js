'use strict';
function bindGenerationDraft(project,kind,shotId,baseVersion,form,fields){
 const status=element('p','',form);status.setAttribute('role','status');
 const view=openView(kind+':'+project.id+':'+shotId,error=>{if(form.isConnected)status.textContent=viewError(error);});
 let touched=false;
 function snapshot(){
  return Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.value]));
 }
 function save(){view.write({baseVersion,draft:snapshot()});}
 form.addEventListener('input',()=>{touched=true;save();});
 form.addEventListener('change',()=>{touched=true;save();});
 view.ready.then(pending=>{
  if(!form.isConnected||touched||!pending)return;
  if(pending.baseVersion!==baseVersion){
   status.textContent='这个镜头的分镜要求已更新，上次输入仍保留。';
   if(pending.draft.prompt)button(form,'带入上次的补充要求',()=>{fields.prompt.value=pending.draft.prompt;touched=true;save();status.textContent='已带入补充文字，请按当前分镜重新核对。';});
   button(form,'下载上次输入',()=>downloadLocalDraft('镜头生成要求',pending));
   return;
  }
  for(const [key,input]of Object.entries(fields)){
   const value=pending.draft[key];if(value===undefined)continue;
   if(input.type==='checkbox')input.checked=value;
   else if(input.tagName==='SELECT'&&![...input.options].some(option=>option.value===value)){
    status.textContent='上次选择的参考或方法目前不可用，请重新选择。';
   }else input.value=value;
  }
 }).catch(error=>{if(form.isConnected)status.textContent=viewError(error);});
}
