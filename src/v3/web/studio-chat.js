'use strict';
async function scriptDirectorDialog(project,episode,stage='script',onChanged){
 const dialog=element('dialog','',page);dialog.className='cd-director-dialog';dialog.setAttribute('aria-label','导演讨论');
 const head=CDStudio.actions(dialog);element('h2','一起完善 · '+episode.title,head);button(head,'返回剧本',()=>StudioUI.dismiss(dialog));
 const status=element('p','正在准备对话…',dialog);status.setAttribute('role','status');
 const history=element('div','',dialog);history.className='cd-messages';history.setAttribute('role','log');
 const form=element('form','',dialog);form.className='cd-stage-form';
 const stageInput=CDStudio.select(form,'这次想做什么',[['chat','聊聊这一集'],['script','完善剧本'],['storyboard','拆成分镜'],['assets','整理角色与场景'],['prompts','写视频制作要求'],['review','检查内容与连续性']],stage);
 const input=CDStudio.field(form,'告诉导演你的要求',({script:'根据当前内容完善这一集剧本，保留已有重点。',storyboard:'把当前一集拆成可以制作的分镜，给出每镜时长和关联的剧本段落。',assets:'从当前剧本整理角色、场景和道具，并写出概念图的制作要求。',prompts:'把已经保存的分镜组织成生成片段，并标明各份参考素材的用途。',review:'检查这一集的剧情、对白时长与前后动作，有问题先给建议。'})[stage]||'','textarea');input.maxLength=12000;
 const settings=element('details','',form);element('summary','模型、原文与制作方法',settings);let modelSelect;
 const sources=await CDStudio.request('projects/'+project.id+'/documents?kind=source'),source=CDStudio.select(settings,'本次附上的原文',[['','不附原文'],...sources.map(s=>[s.id,s.title])]);
 const range=CDStudio.actions(settings),from=CDStudio.field(range,'从第几个字开始',0,'number'),length=CDStudio.field(range,'最多附上多少字',16000,'number');from.min='0';length.min='1';length.max='32000';
 const methodWrap=element('div','',settings);let method;try{const library=await api('skills');method=CDStudio.select(methodWrap,'制作方法',[['','工作台默认'],...(Array.isArray(library)?library:library.skills||[]).map(s=>[s.hash||s.digest||s.id,s.name||s.title||'制作方法'])]);}catch{}
 const actions=CDStudio.actions(form),submit=element('button','发送给导演',actions);submit.className='primary';submit.disabled=true;let chatId,turns=[],timer,busy=false,attempt;
 const stop=button(actions,'停止回答',async()=>{const t=turns.find(t=>t.state==='pending');if(t)await CDStudio.request('assistant/chats/'+chatId+'/turns/'+t.id+'/cancel',{});await refresh();});stop.hidden=true;
 const cleanup=()=>clearTimeout(timer);dialog.addEventListener('close',cleanup,{once:true});dialog.showModal();
 async function refresh(){
  clearTimeout(timer);if(!dialog.isConnected||!dialog.open)return;
  turns=await CDStudio.request('assistant/chats/'+chatId+'/turns');if(!dialog.isConnected)return;
  StudioUI.followBottom(history,()=>{history.replaceChildren();for(const t of turns){StudioUI.chatMessage(history,'user',t.text);if(t.proposal){const answer=StudioUI.chatMessage(history,'assistant','');CDStudio.proposal(answer,t,chatId,onChanged);}else if(t.answer)StudioUI.chatMessage(history,'assistant',t.answer);else if(t.state==='pending')element('p','导演正在整理建议…',history).className='cd-thinking';else element('p','上次回答被中断，输入仍在。',history);}});
  busy=turns.some(t=>t.state==='pending');submit.disabled=busy;stop.hidden=!busy;status.textContent=busy?'建议生成中，尚未修改剧本。':'建议可逐项查看，采用后才会保存。';
  if(busy)timer=setTimeout(()=>refresh().catch(e=>CDStudio.error(status,e)),1600);
 }
 form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!input.value.trim())return;if(!modelSelect?.value){status.textContent='先选择一个对话模型。';return;}submit.disabled=true;
  const payload={text:input.value.trim(),model:JSON.parse(modelSelect.value),stage:stageInput.value,projectId:project.id,episodeId:episode.id,includeProject:true,...(source.value?{sourceId:source.value,sourceStart:Number(from.value),sourceEnd:Math.min(sources.find(s=>s.id===source.value).text.length,Number(from.value)+Number(length.value))}:{}),...(method?.value?{method:method.value}:{})};
  const signature=JSON.stringify(payload);if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
  try{await CDStudio.request('assistant/chats/'+chatId+'/turns',{...payload,commandId:attempt.id});input.value='';attempt=null;await refresh();}catch(error){CDStudio.error(status,error);submit.disabled=false;}});
 try{modelSelect=await CDStudio.models(settings);const list=await CDStudio.request('assistant/chats?scope=episode&scopeId='+episode.id);chatId=list[0]?.id;if(!chatId){const chat=await CDStudio.request('assistant/chats',{title:episode.title+' · 导演讨论',scope:'episode',scopeId:episode.id,projectId:project.id,expectedVersion:0,commandId:crypto.randomUUID()});chatId=chat.id;}await refresh();}catch(e){CDStudio.error(status,e);}
}
