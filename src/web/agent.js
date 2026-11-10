'use strict';
(()=>{
  const get=id=>document.getElementById(id);
  const dialog=get('agentDialog');
  const model=get('agentModel');
  let projectId,conversationId,run,stream,models=[],draft,before;
  let turns=[],viewGeneration=0,refreshWorkbench=false;
  const composer=get('agentForm');
  const current=generation=>generation===viewGeneration&&dialog.open;
  const projectQuery=()=>'?projectId='+encodeURIComponent(projectId);
  async function request(route,data){
    const response=await fetch(base+'/agent/'+route,data?{method:'POST',
      headers:{'Content-Type':'application/json','X-Cutdirector':'agent-v1'},body:JSON.stringify(data)}:{});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.message||result.code),{code:result.code});
    return result;
  }
  function friendlyError(code){
    if(['PROVIDER_NOT_READY','DSH_MODEL_UNAVAILABLE','MODEL_CREDENTIAL_INVALID','MODEL_TIMEOUT','MODEL_UNREACHABLE'].includes(code))
      return '模型暂时用不了。请检查模型设置，或换一个模型再试。';
    if(code==='MODEL_OUTPUT_INVALID')return '这个模型的回复格式有问题。可以换一个模型，再发送一次。';
    if(['AGENT_SCOPE_INVALID','AGENT_PROPOSAL_INVALID','AGENT_TOOL_INVALID'].includes(code))return '这次的剪辑方案超出了可用范围。请选中要改的片段，或直接说要保留或剪掉哪一段。';
    if(code==='AGENT_PROTECTED_CONTENT')return '暂时无法确认会保留你指定的内容。请导入字幕，或调整这次的保留要求。';
    if(code==='AGENT_INPUT_INVALID')return '请检查这次的文字和剪辑设置，再发送一次。';
    if(['PROJECT_CHANGED','REVISION_CONFLICT'].includes(code))return '视频已经有了新的改动，请重新发送这次要求。';
    if(code==='AGENT_STATE_CONFLICT')return '这条对话还有一项任务，请先完成或取消。';
    return '这一步没完成，请重试。';
  }
  function showError(error){get('agentError').textContent=friendlyError(error.code);}
  function button(label,action){
    const el=document.createElement('button');
    el.type='button';el.textContent=label;
    el.onclick=async()=>{
      get('agentError').textContent='';
      el.disabled=true;
      try{await action();}catch(error){showError(error);}finally{el.disabled=false;}
    };
    return el;
  }
  const labels={planning:'正在分析',executing:'正在执行已授权操作','awaiting-approval':'等待确认',
    proposed:'方案已就绪',replied:'已回复',applied:'剪辑已提交',delivered:'产物已发布',
    cancelled:'已取消',stale:'工程已更新，请重新提案',failed:'任务失败',interrupted:'任务可恢复'};
  const inProgress=run=>['planning','executing'].includes(run?.status);
  function paragraph(parent,text){
    const element=document.createElement('p');
    element.textContent=text;
    parent.append(element);
  }
  function message(parent,author,text){
    const bubble=document.createElement('div');
    bubble.className='agent-message '+(author==='你'?'agent-user':'agent-director');
    const label=document.createElement('strong');
    label.textContent=author;
    bubble.append(label);
    paragraph(bubble,text);
    parent.append(bubble);
    return bubble;
  }
  function renderTurns(scrollToEnd=false){
    const transcript=get('agentResult');
    transcript.replaceChildren();
    for(const turn of turns){
      const row=document.createElement('article');
      message(row,'你',turn.request);
      const response=turn.reply||turn.proposal?.text||(turn.result?'剪辑处理完成。':null);
      const bubble=message(row,'剪辑导演',turn.error?friendlyError(turn.error.code):response||labels[turn.status]||'');
      if(turn.result?.file==='passed')paragraph(bubble,'视频文件已检查，可以打开看看。');
      for(const artifact of turn.result?.artifacts||[]){
        if(!['video.mp4','captions.srt','subtitles.srt'].includes(artifact.name))continue;
        const url=base+'/artifact?id='+encodeURIComponent(turn.result.jobId)+'&name='+encodeURIComponent(artifact.name);
        if(artifact.name==='video.mp4'){
          const play=document.createElement('button');
          play.type='button';
          play.dataset.play=url;
          play.dataset.preview=String(turn.result.type!=='export');
          play.textContent=turn.result.type==='export'?'播放成片':'播放预览';
          bubble.append(play);
        }else{
          const link=document.createElement('a');
          link.href=url;
          link.download=artifact.name;
          link.textContent='下载字幕';
          bubble.append(link,document.createTextNode(' '));
        }
      }
      if(turn.proposal||turn.result||turn.error){
        const details=document.createElement('details');
        const summary=document.createElement('summary');
        summary.textContent='技术详情';
        const pre=document.createElement('pre');
        pre.textContent=JSON.stringify({proposal:turn.proposal,result:turn.result,error:turn.error},null,2);
        details.append(summary,pre);
        bubble.append(details);
      }
      transcript.append(row);
    }
    if(!turns.length)paragraph(transcript,'你可以告诉我想怎么剪，也可以先问我一个问题。');
    if(scrollToEnd)transcript.scrollTop=transcript.scrollHeight;
  }
  function showContext(intent={},selection=[]){
    const info=[selection.length?'已选 '+selection.length+' 个片段':'使用当前视频'];
    if(intent.targetSec)info.push('目标 '+intent.targetSec+' 秒');
    if(intent.mustKeep?.length)info.push('必须保留 '+intent.mustKeep.join('、'));
    get('agentContext').textContent=info.join(' · ');
  }
  function show(next){
    if(next?.projectId!==projectId||next?.conversationId!==conversationId)return;
    const isNew=next.id!==run?.id;
    run=next;
    if(['applied','delivered'].includes(run.status))refreshWorkbench=true;
    const index=turns.findIndex(turn=>turn.id===next.id);
    if(index<0)turns.push(next);else turns[index]=next;
    const blocked=inProgress(run)||['awaiting-approval','interrupted'].includes(run.status);
    get('agentSend').disabled=blocked;
    get('agentStatus').textContent=labels[run.status]||'';
    showContext(run.intent,run.selection);
    renderTurns(isNew||!inProgress(run));
    const actions=get('agentActions');actions.replaceChildren();
    if(run.status==='awaiting-approval')actions.append(button('确认并执行',()=>act('approve',{proposalId:run.proposal.id})));
    if(blocked)actions.append(button('取消任务',()=>act('cancel')));
    if(run.status==='replied'&&(run.guidance?.importSubtitles||run.reply?.startsWith('转写就是'))&&state.project?.media?.length){
      actions.append(button('导入已有字幕',()=>{
        dialog.addEventListener('close',()=>{
          get('advancedDialog').showModal();
          get('srtFile').focus();
        },{once:true});
        dialog.close();
      }));
    }
    const suggestion=run.status==='replied'?run.guidance?.request:run.status==='applied'?'生成预览':null;
    if(suggestion){
      actions.append(button(suggestion,()=>{
        get('agentPrompt').value=suggestion;
        composer.requestSubmit();
      }));
    }
    if(run.status==='interrupted'||run.status==='failed'&&(run.pending?.kind==='render'||['DSH_MODEL_UNAVAILABLE','PROVIDER_NOT_READY','MODEL_TIMEOUT','MODEL_UNREACHABLE','MODEL_CREDENTIAL_INVALID'].includes(run.error?.code)))
      actions.append(button('恢复或重试',()=>act('resume')));
  }
  function subscribe(next){
    stream?.close();show(next);
    if(!inProgress(next))return;
    const source=new EventSource(base+'/agent/events?id='+encodeURIComponent(next.id));
    stream=source;
    source.onmessage=event=>{
      const update=JSON.parse(event.data);
      if(!inProgress(update))source.close();
      if(stream===source&&dialog.open)show(update);
    };
    source.onerror=async()=>{
      source.close();
      try{
        const latest=await request('run?id='+encodeURIComponent(next.id));
        if(stream===source&&dialog.open)subscribe(latest);
      }catch(error){if(stream===source&&dialog.open)showError(error);}
    };
  }
  async function act(action,data={}){
    const generation=viewGeneration;
    const next=await request(action,{id:run.id,...data});
    if(current(generation))subscribe(next);
  }
  async function loadMemory(){
    const current=projectId;
    const data=await request('memory?projectId='+encodeURIComponent(current));
    if(current!==projectId)return;
    const list=get('agentMemory');list.replaceChildren();
    for(const entry of data.preferences.filter(item=>item.active)){
      const row=document.createElement('p');
      row.textContent=(entry.scope==='global'?'跨项目 · ':'当前工程 · ')+entry.rule+'（r'+entry.revision+'） ';
      if(entry.projectId===current){
        const change=action=>async()=>{await request('memory',{projectId:current,action,id:entry.id});await loadMemory();};
        row.append(button('撤销',change('revoke')));
        if(entry.scope==='project')row.append(button('允许跨项目使用',change('promote')));
      }
      list.append(row);
    }
    for(const entry of data.cases.filter(item=>item.confirmed&&item.decision==='accepted'&&
        !data.preferences.some(pref=>pref.caseId===item.id&&pref.active))){
      const row=document.createElement('p');row.textContent=entry.rule+' ';
      row.append(button('启用为工程偏好',async()=>{
        await request('memory',{projectId:current,action:'approve',caseId:entry.id});await loadMemory();
      }));list.append(row);
    }
  }
  async function loadModels(){
    const current=model.value;
    const capabilities=await request('models');
    models=capabilities.models;
    model.replaceChildren();
    for(const [name,items] of [['DSH 已配置',models.filter(m=>m.source==='dsh')],
      ['CUTDIRECTOR 本地配置',models.filter(m=>m.source!=='dsh')]]){
      if(!items.length)continue;
      const group=document.createElement('optgroup');group.label=name;
      group.append(...items.map(item=>new Option(item.label,item.id)));
      model.append(group);
    }
    const preferred=models.some(m=>m.id===current)?current:
      models.find(m=>m.source==='dsh')?.id||capabilities.defaultId||models[0]?.id;
    if(preferred)model.value=preferred;
    get('agentDelegateOption').hidden=!capabilities.dsh;
    if(!models.length&&!run&&conversationId!=='legacy')get('agentStatus').textContent='你可以先问我怎么用。开始剪辑前，请在设置中添加模型。';
  }
  const setup=get('modelDialog'),kind=get('modelKind'),key=get('modelKey'),url=get('modelUrl'),name=get('modelName');
  let editing,discovered=[];
  function kindChanged(){
    get('modelUrlRow').hidden=kind.value==='deepseek';
    get('modelKeyRow').hidden=kind.value==='local';
    get('modelKeyHelp').hidden=kind.value!=='deepseek';
    url.required=kind.value!=='deepseek';
    if(kind.value==='deepseek')url.value='';
  }
  function edit(entry){
    editing=entry?.id;
    kind.value=entry?.kind||'deepseek';url.value=entry?.baseUrl||'';
    key.value='';key.placeholder=entry?.hasKey?'已保存，留空沿用':'在这里粘贴 API Key';
    name.value=entry?.model||'';get('modelVision').checked=!!entry?.vision;
    discovered=[];get('modelOptions').replaceChildren();
    get('modelStatus').textContent='';get('modelError').textContent='';
    kindChanged();
  }
  const settingsInput=()=>({id:editing,kind:kind.value,baseUrl:url.value,key:key.value,
    model:name.value,vision:get('modelVision').checked});
  async function loadSettings(){
    const state=await request('model-settings');
    const list=get('modelSaved');list.replaceChildren();
    for(const entry of state.entries){
      const row=document.createElement('p');
      row.textContent=entry.label+(entry.id===state.defaultId?' · 默认 ':' ');
      row.append(button('编辑或换 Key',()=>edit(entry)));
      if(entry.id!==state.defaultId)row.append(button('设为默认',()=>changeSetting('default',entry.id)));
      row.append(button('移除',async()=>{
        await changeSetting('remove',entry.id);
        if(editing===entry.id)edit();
      }));
      list.append(row);
    }
  }
  async function changeSetting(action,id){
    await request('model-settings',{action,id});
    await Promise.all([loadModels(),loadSettings()]);
  }
  async function configAction(action){
    get('modelError').textContent='';
    const buttons=[get('modelDiscover'),get('modelSave')];
    buttons.forEach(b=>b.disabled=true);
    try{await action();}
    catch(error){get('modelError').textContent=error.message;get('modelStatus').textContent='';}
    finally{buttons.forEach(b=>b.disabled=false);}
  }
  kind.onchange=()=>{key.value='';discovered=[];get('modelOptions').replaceChildren();kindChanged();};
  name.onchange=()=>{
    const candidate=discovered.find(item=>item.id===name.value);
    if(candidate)get('modelVision').checked=candidate.vision;
  };
  get('modelDiscover').onclick=()=>configAction(async()=>{
    get('modelStatus').textContent='正在读取模型目录…';
    discovered=(await request('model-discover',settingsInput())).models;
    get('modelOptions').replaceChildren(...discovered.map(item=>new Option(item.label,item.id)));
    if(discovered.length&&!name.value){name.value=discovered[0].id;name.onchange();}
    get('modelStatus').textContent=discovered.length?'已读取模型目录，可选择或输入模型 ID。':'接口未列出模型，请手动输入模型 ID。';
  });
  get('modelForm').onsubmit=event=>{
    event.preventDefault();
    return configAction(async()=>{
      get('modelStatus').textContent='正在发送短测试请求…';
      const saved=await request('model-settings',{action:'save',...settingsInput()});
      const entry=saved.entries.find(item=>item.id===editing)||saved.entries.at(-1);
      edit(entry);
      await Promise.all([loadModels(),loadSettings()]);
      if(entry)model.value=entry.id;
      get('modelStatus').textContent='测试通过，模型已保存。';
    });
  };
  get('agentManageModels').onclick=async()=>{
    edit();setup.showModal();
    try{await loadSettings();}catch(error){get('modelError').textContent=error.message;}
  };
  get('modelClose').onclick=()=>setup.close();
  get('modelNew').onclick=()=>edit();
  setup.addEventListener('close',()=>{key.value='';});

  async function loadChats(){
    const generation=viewGeneration;
    const data=await request('conversations'+projectQuery());
    if(!current(generation))return null;
    const select=get('agentChats');
    select.replaceChildren(...data.conversations.map(chat=>new Option(chat.title,chat.id)),new Option('旧记录','legacy'));
    if(conversationId)select.value=conversationId;
    return data;
  }
  async function openChat(id,remember=false){
    const generation=++viewGeneration;
    stream?.close();stream=null;run=null;draft=null;turns=[];before=null;
    conversationId=id;
    get('agentChats').value=id;
    get('agentOlder').hidden=true;
    for(const name of ['agentResult','agentActions','agentStatus','agentError'])get(name).replaceChildren();
    composer.hidden=id==='legacy';
    const selectedModel=model.value;
    composer.reset();
    if(selectedModel)model.value=selectedModel;
    get('agentSend').disabled=true;
    if(remember&&id!=='legacy')await request('conversation/open',{projectId,id});
    const detail=await request('conversation'+projectQuery()+'&id='+encodeURIComponent(id));
    if(!current(generation))return;
    turns=detail.runs;
    before=detail.nextBefore;
    get('agentOlder').hidden=!before;
    get('agentSend').disabled=false;
    showContext(detail.intent,detail.selection);
    if(id!=='legacy'&&turns.length)subscribe(turns.at(-1));
    else renderTurns(true);
    if(id==='legacy')get('agentStatus').textContent=detail.unreadable?'有旧记录无法读取。可以开启新对话。':'这里可以回看旧对话。点击「新对话」继续剪辑。';
    else if(!models.length&&!run)get('agentStatus').textContent='你可以先问我怎么用。开始剪辑前，请在设置中添加模型。';
  }
  async function newChat(){
    const generation=viewGeneration;
    const chat=await request('conversations',{projectId});
    if(!current(generation))return;
    await loadChats();
    if(current(generation))await openChat(chat.id);
  }
  get('agentNewChat').onclick=async()=>{
    const control=get('agentNewChat');
    control.disabled=true;
    try{await newChat();}catch(error){showError(error);}finally{control.disabled=false;}
  };
  get('agentChats').onchange=event=>openChat(event.target.value,true).catch(showError);
  get('agentOlder').onclick=async()=>{
    const generation=viewGeneration;
    const button=get('agentOlder');
    button.disabled=true;
    try{
      const detail=await request('conversation'+projectQuery()+'&id='+encodeURIComponent(conversationId)+'&before='+encodeURIComponent(before));
      if(!current(generation))return;
      const transcript=get('agentResult');
      const distance=transcript.scrollHeight-transcript.scrollTop;
      turns=[...detail.runs,...turns];
      before=detail.nextBefore;
      button.hidden=!before;
      renderTurns();
      transcript.scrollTop=transcript.scrollHeight-distance;
    }catch(error){if(current(generation))showError(error);}finally{button.disabled=false;}
  };
  get('agentOpen').onclick=async()=>{
    if(!state.project)return;
    const generation=++viewGeneration;
    projectId=state.project.projectId;run=null;conversationId=null;
    get('agentChats').replaceChildren();
    get('agentNewChat').disabled=true;
    get('agentSend').disabled=true;
    for(const name of ['agentResult','agentActions','agentStatus','agentError','agentContext'])get(name).replaceChildren();
    dialog.showModal();
    try{
      const [data]=await Promise.all([loadChats(),loadModels()]);
      if(!current(generation))return;
      if(data?.recentId)await openChat(data.recentId);
      else await newChat();
      await loadMemory();
    }catch(error){if(dialog.open)showError(error);}
    finally{get('agentNewChat').disabled=false;}
  };
  get('agentClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    viewGeneration++;stream?.close();stream=null;get('agentOpen').focus();
    if(refreshWorkbench){
      refreshWorkbench=false;
      work(async()=>{await refresh();await jobs();});
    }
  });
  get('agentForm').onsubmit=async event=>{
    event.preventDefault();
    if(state.project?.projectId!==projectId){showError(new Error('当前视频已切换，请重新打开对话'));return;}
    const generation=viewGeneration;
    const intent={};
    const seconds=get('agentSeconds').value;
    const keep=get('agentKeep').value;
    if(seconds)intent.targetSec=Number(seconds);
    if(keep)intent.mustKeep=keep.split('\n').map(x=>x.trim()).filter(Boolean);
    const payload={projectId,conversationId,selection:[...state.selection],modelId:model.value,
      request:get('agentPrompt').value,mode:get('agentProposalOnly').checked?'proposal':'edit',
      allowFrame:get('agentFrame').checked,allowDelegate:get('agentDelegate').checked,intent};
    const signature=JSON.stringify(payload);
    if(draft?.signature!==signature)draft={signature,id:crypto.randomUUID()};
    get('agentSend').disabled=true;get('agentError').textContent='';
    try{
      const next=await request('run',{id:draft.id,...payload});
      if(!current(generation))return;
      draft=null;
      get('agentPrompt').value='';get('agentSeconds').value='';get('agentKeep').value='';
      subscribe(next);
    }catch(error){
      if(current(generation)){showError(error);get('agentSend').disabled=false;}
      return;
    }
    try{await loadChats();}catch(error){if(current(generation))showError(error);}
  };
})();
