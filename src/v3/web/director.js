'use strict';

function projectDirector(project, layout) {
  const section = element('section', '', layout);
  section.className = 'director-panel';
  const directorHead=element('div','',section);directorHead.className='chat-panel-heading';
  element('h2', '剪辑导演', directorHead);
  const modelBadge=button(directorHead,'本地引导',()=>{config.open=true;picker.focus();});modelBadge.className='model-chip';
  const toolbar = element('div', '', section);
  toolbar.className = 'director-toolbar';
  const label = element('label', '对话 ', toolbar);
  const select = element('select', '', label);
  const create = button(toolbar, '新对话', () => open(true));
  const status = element('p', '正在读取对话…', section);
  status.setAttribute('role', 'status');
  status.className='director-status';
  const list = element('div', '', section);
  list.className = 'director-turns';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  const contextBox = element('details', '', section);
  element('summary', '导演目前知道什么', contextBox);
  const contextText = element('p', '正在核对工程状态…', contextBox);
  async function refreshContext() {
    try {
      const p = await api('projects/' + project.id + '/production');
      if (!section.isConnected) return;
      contextText.textContent = p.storyVersion
        ? '已保存分镜第 ' + p.storyVersion + ' 版，共 ' + p.shotCount + ' 个镜头。' +
          '已选开始图 ' + p.shotsWithStartImage + ' 个，结束图 ' + p.shotsWithEndImage +
          ' 个，视频 ' + p.shotsWithVideo + ' 个。' +
          ((p.pendingImages + p.pendingVideos) ? '还有生成任务正在处理。' : '') +
          ((p.uncertainImages + p.uncertainVideos) ? '有提交结果待核对，请先查看原任务。' : '') +
          '画面内容需要你检查。'
        : '还没有保存分镜。导演可读取工程状态，具体画面需要你提供描述。';
    } catch (error) { if (section.isConnected) contextText.textContent = describe(error); }
  }
  const config=element('details','',section);config.className='chat-config';
  element('summary','模型、方法与本次资料',config);
  const configFields=element('div','',config);configFields.className='chat-config-fields';
  const form = element('form', '', section);
  const focused = element('p', '当前：整个项目', form);
  const clear = button(form, '对整个项目说', () => focus(null));
  clear.hidden = true;
  const modelLabel = element('label', '回复方式 ', form);
  const picker = element('select', '', modelLabel);
  element('option', '本地引导', picker).value = '';
  const help = element('p', '本地引导适合问下一步。连接模型后可以问更具体的问题。', form);
  const methodLabel = element('label', '制作方法 ', form);
  const method = element('select', '', methodLabel);
  element('option', '不使用制作方法', method).value = '';
  const saveMethod = button(form, '设为项目偏好', savePreference);
  saveMethod.hidden = true;
  const cueLabel = element('label', '附上已确认版的字幕', form);
  const cues = element('input', '', cueLabel);
  cues.type = 'checkbox';
  cueLabel.hidden = true;
  const storyLabel = element('label', '', form);
  const storyCaption = element('span', '附上已保存的简报和前 8 个镜头文字', storyLabel);
  const storyConsent = element('input', '', storyLabel);
  storyConsent.type = 'checkbox';
  storyLabel.hidden = true;
  const refsLabel=element('label','附上本项目已引用的灵感和参考文字',form);
  const shareRefs=element('input','',refsLabel);shareRefs.type='checkbox';
  const message = element('label', '你想怎么剪？', form);
  const input = element('textarea', '', message);
  input.maxLength = 4000;
  input.required = true;
  input.rows = 3;
  input.placeholder = '例如：把重点留下，剪成30秒。';
  const send = element('button', '发送', form);
  send.className = 'primary';
  configFields.append(contextBox,modelLabel,help,methodLabel,saveMethod,cueLabel,storyLabel,refsLabel);
  StudioUI.composer(form,input,send);
  const prefix = 'projects/' + project.id + '/chats';
  let id;
  let selectedAsset;
  let selectedShot;
  let attempt;
  let opening;
  let sending = false;
  let pendingPoll;
  let revision = 0;
  const models = new Map();
  let restored = false;
  let focusChanged = false;
  let preferredModel = null;
  let modelChanged = false;
  const view = openView('chat:'+project.id,error=>{if(section.isConnected)status.textContent=viewError(error);});
  function saveView() {
    return view.write({message:input.value,chatId:id||null,
      focus:selectedShot?{kind:'shot',id:selectedShot.id}:selectedAsset?{kind:'asset',id:selectedAsset.id}:null,model:modelChanged ? models.get(picker.value)||null : preferredModel});
  }
  input.addEventListener('input',()=>{if(restored)saveView();});
  create.disabled = select.disabled = send.disabled = true;

  async function loadMethods(preferredValue) {
    const [methods, preference] = await Promise.all([api('skills'), api('projects/' + project.id + '/method')]);
    if (!section.isConnected) return;
    method.replaceChildren();
    element('option', '不使用制作方法', method).value = '';
    if (preference.hash) element('option', '使用项目偏好', method).value = 'project';
    for (const item of methods.filter(item => item.enabled)) {
      element('option', item.name + ' · ' + (item.manifest?.version || item.hash.slice(0, 8)), method).value = item.hash;
    }
    method.value = [...method.options].some(option => option.value === preferredValue)
      ? preferredValue : preference.hash ? 'project' : '';
    saveMethod.hidden = method.options.length === 1;
    saveMethod.textContent = method.value ? '设为项目偏好' : '清除项目偏好';
    saveMethod.disabled = method.value === 'project';
  }

  async function savePreference() {
    try {
      if (method.value === 'project') return;
      const selected = method.value || null;
      await api('projects/' + project.id + '/method', { hash: selected });
      status.textContent = selected ? '已保存项目偏好。' : '已清除项目偏好。';
      await loadMethods(selected ? 'project' : '');
    } catch (error) {
      if (section.isConnected) status.textContent = skillProblem(error);
    }
  }

  method.addEventListener('change', () => {
    saveMethod.textContent = method.value ? '设为项目偏好' : '清除项目偏好';
    saveMethod.disabled = method.value === 'project';
  });
  loadMethods().catch(error => { if (section.isConnected) status.textContent = skillProblem(error); });

  function focus(asset) {
    focusChanged = true;
    selectedAsset = asset;
    selectedShot = null;
    storyCaption.textContent='附上已保存的简报和前 8 个镜头文字';
    storyConsent.checked=false;
    focused.textContent = asset ? '当前素材：' + asset.name : '当前：整个项目';
    clear.hidden = !asset;
    saveView();
    if (asset) {
      locateWorkbench(section);
      input.focus();
    }
  }

  function focusShot(shot) {
    focusChanged=true;
    selectedAsset=null;
    selectedShot=shot;
    focused.textContent='当前：镜头 '+shot.number;
    clear.hidden=false;
    storyCaption.textContent='附上已保存的简报和当前镜头文字';
    storyConsent.checked=false;
    saveView();
    locateWorkbench(section);
    layout.dispatchEvent(new CustomEvent('cutdirector-focus-shot',{detail:shot}));
    input.focus();
  }

  function updateModel() {
    const connected = !!picker.value;
    modelBadge.textContent=connected?picker.selectedOptions[0].textContent.split(' · ').at(-1):'本地引导';
    modelBadge.title='当前对话模型：'+(picker.selectedOptions[0]?.textContent||'本地引导');
    cueLabel.hidden = storyLabel.hidden = !connected;
    if (!connected) cues.checked = storyConsent.checked = false;
    help.textContent = connected ? '发送会把本条消息、近期对话、时长和制作进度交给所选模型。勾选分镜、字幕或选择制作方法时，也会发送对应文字。图片和视频内容需要单独提供。'
      : models.size ? '本地引导适合问下一步。可选择连接的模型问更具体的问题。'
        : '还没有可用模型。可以先使用本地引导，或去 DSH 的「设置 → 模型」添加后重新打开项目。';
  }

  picker.addEventListener('change', () => {modelChanged=true;updateModel();saveView();});
  api('connections').then(async entries => {
    if (!section.isConnected) return;
    entries.forEach((entry, index) => {
      const key = String(index);
      models.set(key, { provider: entry.providerId, id: entry.modelId });
      element('option', entry.provider + ' · ' + entry.model, picker).value = key;
    });
    const saved = await view.ready;
    if (!section.isConnected) return;
    if (!modelChanged && saved?.model) {
      for (const [key, model] of models) if(model.provider===saved.model.provider && model.id===saved.model.id)picker.value=key;
    }
    updateModel();
  }).catch(() => { if (section.isConnected) updateModel(); });

  function renderTurns(turns) {
    const threadId = id;
    const signature=JSON.stringify(turns);
    if(list.dataset.signature===signature)return;
    list.dataset.signature=signature;
    const oldTop=list.scrollTop,follow=list.scrollHeight-list.scrollTop-list.clientHeight<90;
    list.replaceChildren();
    if (!turns.length) {
      const empty=element('div','',list);empty.className='chat-empty';
      element('h3','说说你的想法，\n一起把视频做好。',empty);
      element('p','可以先聊内容，再决定怎么制作。采用方案和生成前，都由你确认。',empty);
      const suggestions=element('div','',empty);suggestions.className='chat-suggestions';
      for(const text of ['帮我梳理视频重点','我该从哪一步开始？','先给我一个分镜方案']){
        button(suggestions,text,()=>{input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
      }
    }
    for (const turn of turns) {
      StudioUI.chatMessage(list,'user',turn.text);
      const response = turn.answer || (turn.state === 'pending' ? '正在核对资料，整理建议…' : '上一次回复中断了，输入还在，可以重新发送。');
      const card=StudioUI.chatMessage(list,'assistant',response);
      if(turn.state==='pending')card.classList.add('is-thinking');
      if (turn.method?.state === 'used') {
        element('small', '本次参考方法 · ' + turn.method.name + ' · ' + turn.method.hash.slice(0, 8), card);
      }
      if (turn.context?.production?.storyVersion) {
        element('small', '依据分镜第 ' + turn.context.production.storyVersion + ' 版 · ' +
          (turn.context.includeStory ? '已附分镜文字' : '工程状态摘要'), card);
      }
      if(turn.context){
        const evidence=element('details','',card);element('summary','本次用到的资料',evidence);
        const known=turn.context;
        element('p',known.includeStory?'已附上保存的分镜文字。':'没有附上分镜正文，只提供制作进度。',evidence);
        element('p',known.includeSubtitles?'已附上授权范围的字幕文字。':'没有附上字幕文字。',evidence);
        if(known.references?.length)for(const source of known.references){
          element('p',(source.title||'引用的灵感')+' · '+source.characters+'字'+(source.excerptOnly?'摘录':'')+'，保留当次依据。',evidence);
        }else element('p','没有附上灵感或公开参考正文。',evidence);
        if(known.preferences?.length)element('p','参考了 '+known.preferences.length+' 条已批准偏好，本次要求优先。',evidence);
        if(known.policy)element('small','导演沟通与剪辑规则 '+known.policy.version,evidence);
      }
      if(turn.state==='pending')button(card,'停止这次建议',async()=>{
        try{await api(prefix+'/'+threadId+'/runs/'+turn.id+'/cancel',{});await history();status.textContent='已停止这次建议，作品未修改。';}
        catch(error){status.textContent=describe(error);}
      });
      if (turn.proposal) renderProposal(card, turn, threadId);
      const action = {
        'import-media': ['选择素材', 'media-intake'],
        arrange: ['查看片段顺序', 'arrangement'],
        delivery: ['查看交付', 'delivery'],
        story: ['打开创作简报', 'story'],
        images: ['查看分镜图片', 'image-generation'],
        generation: ['查看视频试拍', 'generation'],
        review: ['检查候选画面', 'quality'],
        references: ['打开找参考', 'reference'],
        extensions: ['选择扩展制作工具', 'extensions'],
      }[turn.action];
      if (action) button(card, action[0], () => {
        const target = document.querySelector('[data-workbench-section="' + action[1] + '"]');
        locateWorkbench(target);
        if(turn.action==='extensions')target?.dispatchEvent(new CustomEvent('cutdirector-extension-request',{detail:{text:turn.text}}));
      });
    }
    list.scrollTop=follow?list.scrollHeight:oldTop;
  }

  function renderProposal(card, turn, threadId) {
    const proposal = turn.proposal;
    if(proposal.kind==='arrangement')return renderCutProposal(card,turn,threadId,project,prefix,history,refreshContext,status);
    if (proposal.appliedVersion) {
      element('p', '这份建议已保存为分镜第 ' + proposal.appliedVersion + ' 版。', card);
      if(proposal.appliedVersion>1)button(card,'撤销本次分镜修改',async()=>{
        const target=document.querySelector('[data-workbench-section="story"]');
        const local={dirty:true};
        target?.dispatchEvent(new CustomEvent('cutdirector-story-state',{detail:local}));
        if(local.dirty){status.textContent='请先保留分镜中未保存的输入，再撤销。';return;}
        try {
          const result=await api('projects/'+project.id+'/story/undo',{appliedVersion:proposal.appliedVersion,
            commandId:'undo_proposal_'+turn.id,confirm:true});
          const latest=await api('projects/'+project.id+'/story');
          target?.dispatchEvent(new CustomEvent('cutdirector-story-saved',{detail:latest}));
          await refreshContext();
          status.textContent='已撤销并保存为分镜第 '+result.version+' 版。';
        }catch(error){status.textContent=error.message==='STORY_CONFLICT'?'分镜已有后续修改，无法直接撤销。可以从历史中查看或恢复。':describe(error);}
      });
      return;
    }
    const fields = {brief:'想讲什么',audience:'给谁看',style:'整体风格',action:'画面内容',
      startFrameIdea:'开始画面',endFrameIdea:'结束画面',seconds:'时长（秒）',ratio:'画面比例',
      addShot:'新增镜头',removeShot:'移除镜头',order:'镜头顺序'};
    button(card, proposal.kind === 'create-story' ? '查看第一版分镜方案' : '查看分镜修改建议', () => {
      const target = document.querySelector('[data-workbench-section="story"]');
      const state = {dirty:true};
      target?.dispatchEvent(new CustomEvent('cutdirector-story-state', {detail:state}));
      if (state.dirty) {
        status.textContent = '分镜里有未保存输入，请先保存或保留这些内容，再查看修改建议。';
        return;
      }
      const dialog = element('dialog', '', section);
      dialog.setAttribute('aria-label','确认分镜修改');
      element('h3',proposal.kind === 'create-story' ? '检查第一版分镜方案' : '检查分镜修改建议',dialog);
      if (proposal.kind === 'create-story') {
        const draft = proposal.draft;
        element('p',draft.brief,dialog);
        if (draft.audience) element('p','给谁看 · ' + draft.audience,dialog);
        if (draft.style) element('p','风格 · ' + draft.style,dialog);
        const ratios = {'9:16':'竖屏','16:9':'横屏','1:1':'正方形'};
        element('p',ratios[draft.ratio] + ' · 目标 ' + draft.targetSeconds + ' 秒 · 镜头合计 ' + draft.shotTotalSeconds + ' 秒',dialog);
        for (const shot of draft.shots) {
          element('strong','镜头 ' + shot.number + ' · ' + shot.seconds + ' 秒',dialog);
          element('p',shot.action,dialog);
          if (shot.startFrameIdea) element('p','开始画面 · ' + shot.startFrameIdea,dialog);
          if (shot.endFrameIdea) element('p','结束画面 · ' + shot.endFrameIdea,dialog);
        }
        element('p','确认后保存第一版分镜，再逐镜准备图片和视频。',dialog);
      } else element('p','以分镜第 ' + proposal.baseVersion + ' 版为依据，确认后保存为新版本。',dialog);
      for (const change of proposal.changes) {
        element('strong',(change.shot ? '镜头 ' + change.shot + ' · ' : '') + fields[change.field],dialog);
        element('p','修改前',dialog);
        element('p',change.before || '未填写',dialog);
        element('p','修改后',dialog);
        element('p',change.after || '留空',dialog);
      }
      if (proposal.clearedSelections.length) element('p','画面要求变化，镜头 ' +
        proposal.clearedSelections.join('、') + ' 的已选图片和视频将取消选用，原素材保留在项目中。',dialog);
      const message = element('p','',dialog);
      let running = false;
      const back = button(dialog,proposal.kind === 'create-story' ? '暂不采用' : '先不修改',()=>dialog.close());
      const go = button(dialog,proposal.kind === 'create-story' ? '确认采用第一版分镜' : '确认保存新分镜',async()=>{
        if (running) return;
        running = true;
        go.disabled = back.disabled = true;
        try {
          const current = {dirty:true};
          target?.dispatchEvent(new CustomEvent('cutdirector-story-state',{detail:current}));
          if (current.dirty) throw new Error('UNSAVED_STORY');
          const result = await api(prefix + '/' + threadId + '/proposals/' + turn.id + '/approve',{confirm:true});
          const latest=await api('projects/'+project.id+'/story');
          target?.dispatchEvent(new CustomEvent('cutdirector-story-saved',{detail:latest}));
          dialog.close();
          await history();
          await refreshContext();
          status.textContent = '已保存分镜第 ' + result.version + ' 版。可以在分镜区继续检查。';
        } catch (error) {
          message.textContent = error.message === 'STORY_CONFLICT'
            ? '分镜已有新版本，这份建议已过期。请读取新版后重新提出修改。'
            : error.message === 'UNSAVED_STORY' ? '请先保存或保留分镜中的未保存输入。' : describe(error);
        } finally {running=false;go.disabled=back.disabled=false;}
      },true);
      dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      dialog.showModal();
      back.focus();
    });
  }

  async function history() {
    const run = ++revision;
    const chats = await api(prefix);
    if (!section.isConnected || run !== revision) return;
    if (!chats.some(chat => chat.id === id)) id = chats[0]?.id;
    select.replaceChildren();
    for (const chat of chats) element('option', chat.title, select).value = chat.id;
    if (id) select.value = id;
    else element('option', '尚无对话', select).value = '';
    const turns = id ? await api(prefix + '/' + id + '/turns') : [];
    if (!section.isConnected || run !== revision) return;
    renderTurns(turns);
    status.textContent = '';
  }

  async function open(userRequested) {
    if (opening) return opening;
    const key = crypto.randomUUID();
    opening = api(prefix, { commandId: key }).then(async record => {
      id = record.id;
      await history();
      if (userRequested && section.isConnected) {saveView();input.focus();}
      return record.id;
    }).catch(error => {
      if (section.isConnected) status.textContent = describe(error);
      if (!userRequested) throw error;
    }).finally(() => { opening = null; });
    return opening;
  }

  select.addEventListener('change', () => {
    id = select.value;
    saveView();
    history().catch(error => { if (section.isConnected) status.textContent = describe(error); });
  });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!sending) form.requestSubmit();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending || !restored) return;
    sending = true;
    section.setAttribute('aria-busy','true');
    const optimistic=StudioUI.chatMessage(list,'user',text);optimistic.dataset.optimistic='';
    const waiting=StudioUI.chatMessage(list,'assistant','正在整理你的要求…');waiting.classList.add('is-thinking');
    list.scrollTop=list.scrollHeight;
    for (const control of [send, input, select, create, picker, method, saveMethod, cues, storyConsent, clear]) control.disabled = true;
    try {
      const current = id || await open(false);
      const payload = { text, method: method.value || null, model: models.get(picker.value) || null,
        includeSubtitles: cues.checked, includeStory: storyConsent.checked, includeReferences:shareRefs.checked, focus: selectedAsset?.id || null, focusShotId:selectedShot?.id || null };
      const signature = JSON.stringify({ current, payload });
      if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
      status.textContent = '正在准备回复…';
      pendingPoll=setInterval(()=>{if(section.isConnected)history().catch(()=>{});else clearInterval(pendingPoll);},1000);
      const turns = await api(prefix + '/' + current + '/turns', { ...payload, commandId: attempt.id });
      if (!section.isConnected) return;
      input.value = '';
      saveView();
      attempt = undefined;
      renderTurns(turns);
      await history();
    } catch (error) {
      if (section.isConnected) status.textContent = describe(error);
    } finally {
      clearInterval(pendingPoll);
      sending = false;
      section.removeAttribute('aria-busy');
      if(list.querySelector('[data-optimistic]')){list.dataset.signature='';history().catch(()=>{});}
      for (const control of [send, input, select, create, picker, method, cues, storyConsent, clear]) control.disabled = false;
      saveMethod.disabled = method.value === 'project';
    }
  });

  view.ready.then(async value=>{
    if(!section.isConnected)return;
    if(value){
      if(!input.value)input.value=value.message||'';
      id=value.chatId||id;
      preferredModel=value.model||null;
      if(!focusChanged && value.focus?.kind==='shot') {
        const saved=await api('projects/'+project.id+'/story');
        const index=saved?.shots.findIndex(shot=>shot.id===value.focus.id) ?? -1;
        if(index>=0 && section.isConnected) {
          selectedShot={id:value.focus.id,number:index+1};
          focused.textContent='当前：镜头 '+(index+1);
          clear.hidden=false;
          storyCaption.textContent='附上已保存的简报和当前镜头文字';
        }
      }
      if(!focusChanged && value.focus?.kind==='asset') {
        const assets=await api('projects/'+project.id+'/assets');
        const item=assets.find(asset=>asset.id===value.focus.id);
        if(item&&section.isConnected){selectedAsset=item;focused.textContent='当前素材：'+item.name;clear.hidden=false;}
      }
    }
    await history();
    restored=true;
    create.disabled=select.disabled=send.disabled=false;
  }).catch(error=>{
    restored=true;
    create.disabled=select.disabled=send.disabled=false;
    if(section.isConnected)status.textContent=viewError(error);
  });
  refreshContext();
  const contextTimer = setInterval(() => {
    if (!section.isConnected) return clearInterval(contextTimer);
    if (!document.hidden) refreshContext();
  }, 7000);
  focus.reference=text=>{focus(null);input.value=text;saveView();locateWorkbench(section);input.focus();};
  focus.shot=focusShot;
  focus.currentShot=()=>selectedShot;
  return focus;
}
