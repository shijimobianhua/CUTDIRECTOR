'use strict';

function projectArrangement(project, workspace) {
  const section = element('section', '', workspace);
  section.dataset.workbenchSection = 'arrangement';
  section.tabIndex = -1;
  element('h2', '安排视频顺序', section);
  const status = element('p', '正在读取已确认版本…', section);
  status.setAttribute('role', 'status');
  const editor = element('div', '', section);
  const output = element('div', '', section);
  const route = 'projects/' + project.id + '/arrangement';
  const updateDelivery = projectDelivery(project, workspace);
  let assets = [];
  let clips = [];
  let saved = null;
  let loaded = false;
  let dirty = false;
  let busy = false;
  let subtitle = null;
  let attempt;
  beatcutControl(section,project,()=>saved,plan=>{clips=plan.clips.map(({assetId,inUs,outUs})=>({assetId,inTime:String(inUs/1e6),outTime:String(outUs/1e6)}));subtitle=plan.subtitle;edit();renderEditor();},()=>!loaded||busy||dirty);
  const view=openView('arrangement:'+project.id,error=>{if(section.isConnected)status.textContent=viewError(error);});
  function saveInput(){if(loaded)view.write({baseVersion:saved?.version||0,clips,subtitle});}

  function edit() {
    dirty = true;
    saveInput();
    output.replaceChildren();
    status.textContent = saved ? '有未确认的改动。交接仍使用第 ' + saved.version + ' 版。' : '还没确认这份顺序。';
  }

  function reset(current) {
    dirty = false;
    saved = current;
    updateDelivery(current?.version || 0);
    subtitle = current?.subtitle || null;
    clips = (current?.clips || assets.map(a => ({ assetId: a.id, inUs: 0, outUs: a.durationUs })))
      .map(({ assetId, inUs, outUs }) => ({ assetId, inTime: String(inUs / 1e6), outTime: String(outUs / 1e6) }));
    attempt = undefined;
    status.textContent = current ? '已确认第 ' + current.version + ' 版。' : '先调整顺序和每段的时间。';
  }

  section.addEventListener('cutdirector-arrangement-state',event=>{event.detail.dirty=!loaded||busy||dirty;});
  section.addEventListener('cutdirector-arrangement-saved',event=>{
    if(busy||dirty){status.textContent='已有新确认版本，当前未确认输入仍保留。请核对后再操作。';return;}
    reset(event.detail);
    saveInput();
    renderEditor();
  });

  function field(parent, label, value, onInput) {
    const wrapper = element('label', label, parent);
    const input = element('input', '', wrapper);
    input.type = 'number';
    input.min = '0';
    input.step = '0.000001';
    input.value = value;
    input.addEventListener('input', () => { onInput(input.value); edit(); });
  }

  function choose(parent, options, value, onChange, label) {
    const wrapper = element('label', label, parent);
    const select = element('select', '', wrapper);
    for (const [id, name] of options) element('option', name, select).value = id;
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function renderEditor(focusSelector) {
    if (!section.isConnected || !loaded) return;
    editor.replaceChildren();
    if (!assets.length) {
      element('p', '先导入一段视频，再来安排顺序。', editor);
      return;
    }
    const list = element('ol', '', editor);
    list.className = 'arrangement-list';
    clips.forEach((clip, index) => {
      const row = element('li', '', list);
      const asset = assets.find(a => a.id === clip.assetId);
      element('strong', (index + 1) + '. ' + (asset?.name || '素材缺失'), row);
      field(row, '从（秒）', clip.inTime, value => { clip.inTime = value; });
      field(row, '到（秒）', clip.outTime, value => { clip.outTime = value; });
      for (const [step, label] of [[-1, '上移'], [1, '下移']]) {
        const move = button(row, label, () => {
          const next = index + step;
          [clips[index], clips[next]] = [clips[next], clips[index]];
          edit();
          renderEditor('[data-row="' + next + '"]');
        });
        move.disabled = index + step < 0 || index + step >= clips.length;
      }
      const remove = button(row, '移除片段', () => {
        clips.splice(index, 1);
        edit();
        renderEditor('[data-add-clip]');
      });
      remove.dataset.row = index;
    });

    const options = assets.map(a => [a.id, a.name]);
    const assetSelector = choose(editor, options, options[0][0], () => {}, '再选一段素材');
    const add = button(editor, '添加片段', () => {
      const selected = assets.find(a => a.id === assetSelector.value);
      clips.push({ assetId: selected.id, inTime: '0', outTime: String(selected.durationUs / 1e6) });
      edit();
      renderEditor('[data-row="' + (clips.length - 1) + '"]');
    });
    add.dataset.addClip = '';

    element('h3', '字幕（可选）', editor);
    const subtitleLabel = element('label', '导入 SRT 字幕', editor);
    const file = element('input', '', subtitleLabel);
    file.type = 'file';
    file.accept = '.srt';
    file.addEventListener('change', async () => {
      const selected = file.files[0];
      if (!selected) return;
      try {
        if (selected.size > 2 * 1024 * 1024) throw new Error();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer());
        subtitle = { mode: subtitle?.mode || 'timeline', assetId: subtitle?.assetId || null, text };
        edit();
        renderEditor('[data-subtitle-target]');
      } catch {
        status.textContent = '请使用不超过 2 MB 的 UTF-8 SRT 字幕文件。';
        file.value = '';
      }
    });
    if (subtitle) {
      const target = choose(editor, [['timeline', '整条视频'], ...options],
        subtitle.mode === 'source' ? subtitle.assetId : 'timeline', (value) => {
          subtitle.mode = value === 'timeline' ? 'timeline' : 'source';
          subtitle.assetId = value === 'timeline' ? null : value;
          edit();
        }, '这份字幕对应');
      target.dataset.subtitleTarget = '';
      button(editor, '移除字幕', () => {
        subtitle = null;
        edit();
        renderEditor();
      });
    }

    const actions = element('div', '', editor);
    actions.className = 'actions';
    button(actions, '检查顺序和字幕', () => submit(false));
    button(actions, '确认这版顺序', () => submit(true), true);
    button(actions, '载入已确认版本', loadSaved);
    if (saved) button(actions, '下载第 ' + saved.version + ' 版交接清单', download);
    if (focusSelector) editor.querySelector(focusSelector)?.focus();
  }

  async function loadSaved() {
    try {
      const current = await api(route);
      if (!section.isConnected) return;
      loaded = true;
      reset(current);
      const previous=await view.read();
      if(!section.isConnected)return;
      output.replaceChildren();
      if(previous && previous.baseVersion===(current?.version||0)){
        const original=JSON.stringify({clips,subtitle});
        clips=previous.clips;subtitle=previous.subtitle;
        dirty=original!==JSON.stringify({clips,subtitle});
        if(dirty)status.textContent='已恢复上次未确认的输入。';
      }else if(previous) {
        status.textContent='已确认版本更新了。上次未确认输入仍保留，可先下载备份，再继续。';
        button(output,'下载上次输入',()=>downloadLocalDraft('未确认编排',previous));
      }
      renderEditor();
      if(saved && !previous)show(saved);
    } catch (error) {
      if (section.isConnected) {
        status.textContent = describe(error);
        editor.replaceChildren();
        button(editor, '重新读取', loadSaved);
      }
    }
  }

  function show(arrangement) {
    output.replaceChildren();
    element('p', '共 ' + arrangement.clips.length + ' 段 · ' + (arrangement.durationUs / 1e6).toFixed(3) + ' 秒', output);
    if (!arrangement.captions.length) return;
    element('h3', '字幕预览 · ' + arrangement.captions.length + ' 条', output);
    const cues = element('ol', '', output);
    for (const cue of arrangement.captions.slice(0, 12)) {
      element('li', (cue.startUs / 1e6).toFixed(3) + ' 秒 · ' + cue.text, cues);
    }
    if (arrangement.captions.length > 12) element('p', '这里显示前 12 条，确认时会保存全部字幕。', output);
  }

  async function submit(commit) {
    if (busy) return;
    const toUs = value => value.trim() ? Math.round(Number(value) * 1e6) : null;
    const input = {
      clips: clips.map(clip => ({ assetId: clip.assetId, inUs: toUs(clip.inTime), outUs: toUs(clip.outTime),...(saved?.clips.find(old=>old.assetId===clip.assetId&&old.inUs===toUs(clip.inTime)&&old.outUs===toUs(clip.outTime))?.volume!=null?{volume:saved.clips.find(old=>old.assetId===clip.assetId&&old.inUs===toUs(clip.inTime)&&old.outUs===toUs(clip.outTime)).volume}:{}) })),
      subtitle,...(saved?.overlayClips||saved?.audioClips?{overlayClips:saved.overlayClips||[],audioClips:saved.audioClips||[]}:{}),
    };
    const expectedVersion = saved?.version || 0;
    const signature = JSON.stringify({ ...input, expectedVersion });
    if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
    busy = true;
    const controls = [...editor.querySelectorAll('button,input,select')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    status.textContent = commit ? '正在确认…' : '正在检查…';
    try {
      const result = await api(commit ? route : route + '/preview', commit
        ? { ...input, expectedVersion, commandId: attempt.id } : input);
      if (!section.isConnected) return;
      if (commit) {
        reset(result);
        saveInput();
        renderEditor();
        editor.querySelector('.actions .primary')?.focus();
      } else status.textContent = '已检查。确认这版顺序后才能用于交接。';
      show(result);
    } catch (error) {
      if (section.isConnected) status.textContent = describe(error);
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
    }
  }

  async function download() {
    try {
      const manifest = await api('projects/' + project.id + '/handoff-plan/' + saved.version);
      if (!section.isConnected) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
      const link = element('a', '', section);
      link.href = url;
      link.download = 'CUTDIRECTOR-交接清单-v' + manifest.version + '.json';
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '清单已下载。它记录顺序、区间和字幕，视频文件仍在项目素材库中。';
    } catch (error) {
      status.textContent = describe(error);
    }
  }

  function update(nextAssets) {
    if (!section.isConnected) return;
    const wasEmpty = !assets.length;
    assets = nextAssets;
    if (!loaded) loadSaved();
    else if (wasEmpty && !saved && !clips.length) {
      reset(null);
      renderEditor();
    } else if (!busy) renderEditor();
  }
  update.populate = (input) => {
    if (!loaded || busy || !section.isConnected) return false;
    clips = input.map(({ assetId, inUs, outUs }) => ({ assetId, inTime: String(inUs / 1e6), outTime: String(outUs / 1e6) }));
    edit();
    renderEditor();
    locateWorkbench(section);
    return true;
  };
  return update;
}
