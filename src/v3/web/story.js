'use strict';

function projectStory(project, workspace, sourceText, stageArrangement, refreshAssets, focusShot) {
  const section = element('section', '', workspace);
  section.dataset.workbenchSection = 'story';
  section.tabIndex = -1;
  const disclosure = element('details', '', section);
  disclosure.open = project.kind === 'idea';
  element('summary', '创作简报和分镜', disclosure);
  const status = element('p', '正在读取…', disclosure);
  status.setAttribute('role', 'status');
  const fields = element('div', '', disclosure);
  const prefix = 'projects/' + project.id + '/story';
  let assets = [];
  let images = [];
  let uploadingImage = false;
  let draft;
  let saved;
  let cleanDraft;
  let editingBrief=false;
  const editingShots=new Set();
  const view = openView('story:'+project.id,error=>{if(section.isConnected)status.textContent=viewError(error);});
  function saveDraft() {
    if(draft)view.write({baseVersion:saved?.version||0,draft});
  }
  let busy = false;
  let attempt;
  const updateImages = projectImageGeneration(project, workspace, selectFrame);
  const updateGeneration = projectGeneration(project, workspace, selectCandidate);

  async function selectFrame(shotId, frame, imageId) {
    if (busy || uploadingImage) return;
    try {
      const library = await api('projects/' + project.id + '/images');
      const shot = draft?.shots.find(item => item.id === shotId);
      if (!shot || !library.some(item => item.id === imageId) || !section.isConnected) return;
      images = library;
      shot[frame === 'start' ? 'startImageId' : 'endImageId'] = imageId;
      disclosure.open = true;
      saveDraft();
      status.textContent = '已选用这张图，保存分镜后生效。';
      render();
      locateWorkbench(section);
      return true;
    } catch (error) {
      if (section.isConnected) status.textContent = describe(error);
    }
  }

  async function selectCandidate(shotId, assetId) {
    if (busy) return;
    try {
      const library = await api('projects/' + project.id + '/assets');
      const asset = library.find(item => item.id === assetId);
      const shot = draft?.shots.find(item => item.id === shotId);
      if (!asset || !shot || !section.isConnected) return;
      if (asset.durationUs < shot.durationUs) {
        status.textContent = '这段视频比计划的镜头短，请先调整分镜时长。';
        return;
      }
      assets = library;
      shot.assetId = asset.id;
      disclosure.open = true;
      saveDraft();
      status.textContent = '已选用这段视频，保存分镜后生效。';
      render();
      locateWorkbench(section);
      await refreshAssets();
      return true;
    } catch (error) {
      if (section.isConnected) status.textContent = describe(error);
    }
  }

  function initialize(value) {
    saved = value;
    workspace.dispatchEvent(new CustomEvent('cutdirector-story-version',{detail:saved?.version||0}));
    updateGeneration(saved);
    updateImages(saved, images);
    draft = value ? structuredClone(value) : {
      brief: (sourceText || '').slice(0, 1200), audience: '', style: '', ratio: '9:16', durationUs: 20000000, shots: [],
    };
    cleanDraft = JSON.stringify(draft);
    attempt = undefined;
    status.textContent = saved ? '已保存第 ' + saved.version + ' 版。' : '先写一句这条片想讲什么。';
    render();
  }

  section.addEventListener('cutdirector-story-state', event => {
    event.detail.dirty = !draft || busy || uploadingImage || JSON.stringify(draft) !== cleanDraft;
  });
  section.addEventListener('cutdirector-story-saved', event => {
    if (busy || uploadingImage || JSON.stringify(draft) !== cleanDraft) {
      status.textContent = '导演已保存一个新版本，当前未保存输入仍保留。请先复制这些输入，再重新打开项目。';
      return;
    }
    initialize(event.detail);
    saveDraft();
  });

  function edited() {
    saveDraft();
    status.textContent = '修改尚未保存。';
  }

  function field(parent, name, type, value, onInput, maxLength) {
    const label = element('label', name, parent);
    const input = element(type === 'text' ? 'textarea' : 'input', '', label);
    if (type !== 'text') {
      input.type = 'number';
      input.min = '0';
      input.step = '0.25';
    } else {
      input.maxLength = maxLength;
      input.rows = 2;
    }
    input.value = value;
    input.addEventListener('input', () => { onInput(input.value); edited(); });
    return input;
  }

  function choice(parent, name, options, selected, setter) {
    const label = element('label', name, parent);
    const select = element('select', '', label);
    for (const [id, text] of options) element('option', text, select).value = id;
    select.value = selected;
    select.addEventListener('change', () => { setter(select.value); edited(); });
  }

  function framePicker(parent, shot, key, label) {
    const box = element('div', '', parent);
    box.className = 'story-frame';
    element('h4', label, box);
    const selected = images.find(image => image.id === shot[key]);
    if (selected) {
      const preview = element('img', '', box);
      preview.alt = label + ' · ' + selected.name;
      preview.src = './v3/projects/' + project.id + '/images/' + selected.id + '/content';
      preview.loading = 'lazy';
      element('p', selected.width + ' × ' + selected.height, box);
      const expected = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 }[draft.ratio];
      if (Math.abs(selected.width / selected.height / expected - 1) > 0.03) {
        element('p', '图片比例和简报不同，后续可能需要裁剪。', box);
      }
    } else element('p', '还没选图。可以导入现有图片。', box);
    if (images.length) {
      choice(box, '选用图片', [['', '暂不选'], ...images.map(image => [image.id, image.name])], shot[key] || '',
        value => { if (value) shot[key] = value; else delete shot[key]; render(); });
    }
    const labelNode = element('label', '导入 PNG 或 JPEG', box);
    const upload = element('input', '', labelNode);
    upload.type = 'file';
    upload.accept = '.png,.jpg,.jpeg,image/png,image/jpeg';
    upload.disabled = uploadingImage;
    upload.addEventListener('change', async () => {
      const file = upload.files[0];
      if (!file || uploadingImage || busy) return;
      uploadingImage = true;
      upload.disabled = true;
      status.textContent = '正在读取图片…';
      try {
        if (file.size > 16 * 1024 ** 2) throw new Error('IMAGE_TOO_LARGE');
        const query = new URLSearchParams({ name: file.name, commandId: crypto.randomUUID() });
        const response = await fetch('./v3/projects/' + project.id + '/images?' + query, {
          method: 'POST', headers: { 'X-Cutdirector-Session': session, 'Content-Type': 'application/octet-stream' }, body: file,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.code);
        if (!section.isConnected) return;
        images = [result.data, ...images.filter(item => item.id !== result.data.id)];
        shot[key] = result.data.id;
        updateImages(saved, images);
        saveDraft();
        status.textContent = '图片已导入，保存分镜后会记住所选版本。';
      } catch (error) {
        if (section.isConnected) status.textContent = error.message === 'IMAGE_TOO_LARGE' || error.message === 'REQUEST_TOO_LARGE'
          ? '图片超过 16 MB，请换一张。'
          : ['INVALID_IMAGE', 'UNSUPPORTED_MEDIA'].includes(error.message)
            ? '这张图片无法读取，请换一张有效的 PNG 或 JPEG。' : describe(error);
      } finally {
        uploadingImage = false;
        if (section.isConnected) render();
      }
    });
  }

  function render() {
    if (!draft || !section.isConnected) return;
    fields.replaceChildren();
    const overview=element('div','',fields);overview.className='story-overview';
    element('h2',draft.brief||'先聊聊，你想拍什么？',overview);
    element('p',draft.shots.length+' 个镜头 · '+draft.durationUs/1e6+' 秒 · '+({'9:16':'竖屏','16:9':'横屏','1:1':'正方形'}[draft.ratio]||draft.ratio),overview);
    const brief=element('details','',fields);brief.className='story-brief-edit';brief.open=editingBrief||!draft.brief;
    brief.addEventListener('toggle',()=>{editingBrief=brief.open;});
    element('summary','修改主题、受众与风格',brief);
    field(brief, '这条片想讲什么', 'text', draft.brief, value => { draft.brief = value; }, 1200);
    field(brief, '给谁看（选填）', 'text', draft.audience, value => { draft.audience = value; }, 240);
    field(brief, '想要的风格（选填）', 'text', draft.style, value => { draft.style = value; }, 600);
    choice(brief, '画面方向', [['9:16', '竖屏'], ['16:9', '横屏'], ['1:1', '正方形']], draft.ratio, value => { draft.ratio = value; });
    field(brief, '目标时长（秒）', 'number', draft.durationUs / 1e6, value => { draft.durationUs = Math.round(Number(value) * 1e6); });
    element('h3', '镜头安排', fields);
    if (!draft.shots.length) element('p', '把视频分成几段，每段写清会看到什么。', fields);
    const cards = element('div', '', fields);cards.className='story-board';
    for (const [index, shot] of draft.shots.entries()) {
      const card = element('article', '', cards);
      card.className = 'card story-shot';
      const cover=images.find(image=>image.id===shot.startImageId);
      if(cover){const img=element('img','',card);img.className='shot-cover';img.src='./v3/projects/'+project.id+'/images/'+cover.id+'/content';img.alt='镜头 '+(index+1)+' 已选开始画面';img.loading='lazy';}
      const head=element('div','',card);head.className='shot-card-heading';
      element('strong', '镜头 ' + (index + 1), head);element('small',shot.durationUs/1e6+' 秒',head);
      element('p',shot.action||'写下这一镜会发生什么。',card).className='shot-action';
      const discuss=button(card,'和导演改这一镜',()=>{
        if(JSON.stringify(draft)!==cleanDraft || !saved?.shots.some(item=>item.id===shot.id)) {
          status.textContent='请先保存当前分镜，再和导演讨论这一镜。';
          return;
        }
        focusShot?.({id:shot.id,number:index+1});
      });
      discuss.disabled=!saved?.shots.some(item=>item.id===shot.id);
      const editor=element('details','',card);editor.className='shot-editor';editor.open=editingShots.has(shot.id)||!shot.action;
      editor.addEventListener('toggle',()=>{if(editor.open)editingShots.add(shot.id);else editingShots.delete(shot.id);});
      element('summary','调整这一镜',editor);
      field(editor, '画面发生什么', 'text', shot.action, value => { shot.action = value; }, 600);
      field(editor, '时长（秒）', 'number', shot.durationUs / 1e6, value => { shot.durationUs = Math.round(Number(value) * 1e6); });
      field(editor, '镜头开始的画面（选填）', 'text', shot.startFrameIdea, value => { shot.startFrameIdea = value; }, 600);
      field(editor, '镜头结束的画面（选填）', 'text', shot.endFrameIdea, value => { shot.endFrameIdea = value; }, 600);
      const frames = element('div', '', editor);
      frames.className = 'story-frames';
      framePicker(frames, shot, 'startImageId', '镜头开始的图');
      framePicker(frames, shot, 'endImageId', '镜头结束的图');
      choice(editor, '已导入的素材', [['', '稍后准备'], ...assets.map(asset => [asset.id, asset.name])],
        shot.assetId || '', value => { shot.assetId = value || null; });
      for (const [step, label] of [[-1, '镜头上移'], [1, '镜头下移']]) {
        const move = button(editor, label, () => {
          [draft.shots[index], draft.shots[index + step]] = [draft.shots[index + step], draft.shots[index]];
          edited();
          render();
        });
        move.disabled = index + step < 0 || index + step >= draft.shots.length;
      }
      button(editor, '移除镜头', () => { draft.shots.splice(index, 1); edited(); render(); });
    }
    const add = button(fields, '添加一个镜头', () => {
      draft.shots.push({ id: crypto.randomUUID(), action: '', durationUs: 5000000,
        startFrameIdea: '', endFrameIdea: '', assetId: null });
      edited();
      render();
      fields.querySelector('.story-shot:last-child textarea')?.focus();
    });
    add.disabled = draft.shots.length >= 60;
    button(fields, '保存简报和分镜', save, true);
    if (saved?.shots.length && saved.shots.every(shot => shot.assetId)) {
      button(fields, '把已保存分镜带入编排', () => {
        const offsets = new Map();
        const clips = saved.shots.map(shot => {
          const inUs = offsets.get(shot.assetId) || 0;
          const outUs = inUs + shot.durationUs;
          offsets.set(shot.assetId, outUs);
          return { assetId: shot.assetId, inUs, outUs };
        });
        if (clips.some(clip => clip.outUs > (assets.find(asset => asset.id === clip.assetId)?.durationUs || 0))) {
          status.textContent = '有素材被多个镜头使用，总时长超过了源视频。请缩短镜头或换素材。';
          return;
        }
        if (stageArrangement(clips)) status.textContent = '已带入编排区，请检查并确认。';
      });
    }
  }

  async function save() {
    if (busy || uploadingImage) return;
    busy = true;
    const expectedVersion = saved?.version || 0;
    const input = { ...draft, expectedVersion };
    const signature = JSON.stringify(input);
    if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
    const enabled = [...fields.querySelectorAll('button,input,textarea,select')].filter(item => !item.disabled);
    enabled.forEach(item => { item.disabled = true; });
    status.textContent = '正在保存…';
    try {
      const result = await api(prefix, { ...input, commandId: attempt.id });
      if (section.isConnected) {initialize(result);saveDraft();}
    } catch (error) {
      if (section.isConnected) status.textContent = error.message === 'STORY_CONFLICT'
        ? '已经有人保存了新版本。请先保留当前内容，再重新打开项目。' : describe(error);
    } finally {
      enabled.forEach(item => { item.disabled = false; });
      busy = false;
    }
  }

  Promise.all([api(prefix), api('projects/' + project.id + '/images'), view.ready]).then(([value, library, pending]) => {
    if (section.isConnected) {
      images = library;
      initialize(value);
      if(pending && pending.baseVersion===(saved?.version||0)) {
        draft=pending.draft;
        if(JSON.stringify(draft)!==cleanDraft)status.textContent='已恢复未保存的分镜输入。';
        render();
      } else if(pending){status.textContent='分镜已有新版本，旧草稿保存在本机。请先核对版本后再继续。';button(disclosure,'下载上次输入',()=>downloadLocalDraft('未保存分镜',pending));}
    }
  })
    .catch(error => { if (section.isConnected) status.textContent = describe(error); });
  return function update(nextAssets) {
    assets = nextAssets;
    if (!busy) render();
  };
}
