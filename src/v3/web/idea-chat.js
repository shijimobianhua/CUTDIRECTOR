'use strict';
function ideaDiscussion(idea,region,applyResult,hasEdits){
 const section=element('section','',region);section.className='idea-chat-panel';
 const chatHead=element('div','',section);chatHead.className='chat-panel-heading';element('h2','灵感导演',chatHead);
 const modelBadge=button(chatHead,'本地引导',()=>{config.open=true;picker.focus();});modelBadge.className='model-chip';
 element('p','聊清楚想法，再决定怎么拍。',section).className='muted';
 const toolbar=element('div','',section);toolbar.className='director-toolbar';
 const threads=element('select','',element('label','当前对话',toolbar));
 const create=button(toolbar,'新对话',async()=>{if(busy)return;create.disabled=true;
  try{const chat=await api('ideas/'+idea.id+'/chats',{commandId:crypto.randomUUID()});await loadThreads(chat.id);save();input.focus();}
  catch(error){status.textContent=describe(error);}finally{create.disabled=false;}
 });
 const status=element('p','',section);status.setAttribute('role','status');status.className='director-status';
 const list=element('div','',section);list.className='director-turns';list.setAttribute('role','log');list.setAttribute('aria-live','polite');
 const config=element('details','',section);config.className='chat-config';element('summary','模型与本次资料',config);
 const fields=element('div','',config);fields.className='chat-config-fields';
 const picker=element('select','',element('label','对话模型',fields));element('option','先用本地引导',picker).value='';
 const include=element('input','',element('label','附上原始灵感与已保存补充',fields));include.type='checkbox';
 element('p','勾选后，这次会把灵感文字交给所选模型。图片和视频不会自动发送。',fields);
 const form=element('form','',section),input=element('textarea','',element('label','想聊什么？',form));input.maxLength=4000;input.required=true;
 const submit=element('button','发送',form);submit.className='primary';StudioUI.composer(form,input,submit);
 let id=null,attempt,busy=false,historyRevision=0;
 const models=new Map(),view=openView('idea-chat:'+idea.id,error=>{if(section.isConnected)status.textContent=viewError(error);});
 const save=()=>view.write({message:input.value,chatId:id,focus:null,model:models.get(picker.value)||null});
 const modelLabel=()=>{modelBadge.textContent=picker.value?picker.selectedOptions[0].textContent.split(' · ').at(-1):'本地引导';modelBadge.title=picker.selectedOptions[0]?.textContent||'本地引导';};
 input.addEventListener('input',save);picker.addEventListener('change',()=>{modelLabel();save();});
 function empty(){
  const box=element('div','',list);box.className='chat-empty';element('h3','先有一个念头，\n再一起想清楚。',box);
  element('p','聊聊想讲什么、给谁看。合适的建议可以存为补充，不会自动替你改。',box);
  const suggestions=element('div','',box);suggestions.className='chat-suggestions';
  for(const text of ['怎么把这个想法拍成视频？','帮我想一个吸引人的开头','先问我几个问题']){
   button(suggestions,text,()=>{input.value=text;include.checked=!!picker.value;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
  }
 }
 async function history(){
  const revision=++historyRevision,thread=id;
  const turns=id?await api('ideas/'+idea.id+'/chats/'+thread+'/turns'):[];
  if(!section.isConnected||id!==thread||revision!==historyRevision)return;
  StudioUI.followBottom(list,()=>{
   list.replaceChildren();if(!turns.length)empty();
   for(const turn of turns){
    StudioUI.chatMessage(list,'user',turn.text);
    const card=StudioUI.chatMessage(list,'assistant',turn.answer||(turn.state==='pending'?'正在整理想法…':'上次讨论中断，输入和原记录都在。'));
    if(turn.state==='pending')card.classList.add('is-thinking');
    const evidence=element('details','',card);element('summary','本次用到的资料',evidence);
    element('small',turn.context?.includeIdea?'附上了原始灵感和保存的补充':'没有附上灵感正文',evidence);
    if(turn.state==='complete')button(card,turn.applied?'撤销存入补充':'存为灵感补充',()=>{
     if(hasEdits()){status.textContent='你正在编辑补充，请先保存当前输入，再采用对话建议。';return;}
     const dialog=element('dialog','',section);dialog.setAttribute('aria-label',turn.applied?'撤销补充':'确认采用建议');
     element('h3',turn.applied?'撤销这次补充':'用这条建议更新补充',dialog);
     element('p',turn.applied?'会恢复采用建议前的补充，原始记录保留。后续已经手改时会保留手改内容。':'会替换已保存的补充，原始记录保留。你可以稍后撤销。',dialog);
     const message=element('p','',dialog);const controls=element('div','',dialog);controls.className='dialog-actions';let applying=false;
     const back=button(controls,'先不改',()=>dialog.close());
     const confirm=button(controls,'确认',async()=>{
      if(applying)return;applying=true;confirm.disabled=back.disabled=true;
      try{
       const updated=await api('ideas/'+idea.id+'/chats/'+thread+'/turns/'+turn.id+'/'+(turn.applied?'undo':'apply'),{confirm:true});
       applyResult(updated);status.textContent='补充已更新，原始记录保留。';dialog.close();await history();
      }catch(error){message.textContent=error.message==='IDEA_CONFLICT'?'灵感已有新补充，这条旧建议不会覆盖它。请根据新内容重新讨论。':describe(error);}
      finally{applying=false;confirm.disabled=back.disabled=false;}
     },true);
     dialog.addEventListener('cancel',event=>{if(applying)event.preventDefault();});
     dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
    });
   }
  });
 }
 async function loadThreads(selected){
  const entries=await api('ideas/'+idea.id+'/chats');if(!section.isConnected)return;
  threads.replaceChildren();for(const chat of entries)element('option',chat.title,threads).value=chat.id;
  id=entries.some(chat=>chat.id===selected)?selected:entries[0]?.id||null;
  if(id)threads.value=id;else element('option','新的讨论',threads).value='';
  await history();
 }
 threads.addEventListener('change',()=>{id=threads.value;save();history().catch(error=>{status.textContent=describe(error);});});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!busy)form.requestSubmit();}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!input.value.trim())return;
  busy=true;submit.disabled=input.disabled=threads.disabled=picker.disabled=create.disabled=include.disabled=true;section.setAttribute('aria-busy','true');
  try{
   if(!id){const chat=await api('ideas/'+idea.id+'/chats',{commandId:crypto.randomUUID()});await loadThreads(chat.id);}
   const request={text:input.value,includeIdea:include.checked,model:models.get(picker.value)||null},signature=JSON.stringify({id,...request});
   if(attempt?.signature!==signature)attempt={signature,commandId:crypto.randomUUID()};
   StudioUI.chatMessage(list,'user',input.value);
   StudioUI.chatMessage(list,'assistant','正在整理想法…').classList.add('is-thinking');list.scrollTop=list.scrollHeight;
   status.textContent='正在整理想法…';
   await api('ideas/'+idea.id+'/chats/'+id+'/turns',{...request,commandId:attempt.commandId});
   if(!section.isConnected)return;
   input.value='';include.checked=false;attempt=null;save();await history();status.textContent='';
  }catch(error){if(section.isConnected){status.textContent=describe(error);history().catch(()=>{});}}
  finally{busy=false;section.removeAttribute('aria-busy');submit.disabled=input.disabled=threads.disabled=picker.disabled=create.disabled=include.disabled=false;}
 });
 (async()=>{try{
  const entries=await api('connections'),saved=await view.ready;if(!section.isConnected)return;
  entries.forEach((entry,index)=>{const key=String(index);models.set(key,{provider:entry.providerId,id:entry.modelId});element('option',entry.provider+' · '+entry.model,picker).value=key;});
  if(saved){input.value=saved.message;for(const [key,model]of models)if(model.provider===saved.model?.provider&&model.id===saved.model?.id)picker.value=key;}
  modelLabel();await loadThreads(saved?.chatId);
 }catch(error){if(section.isConnected){status.textContent=describe(error);empty();}}})();
 return section;
}
