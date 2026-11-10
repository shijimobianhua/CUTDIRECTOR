'use strict';

const legacyDraftInputs = new Map();

function legacyMessage(error) {
  return ({
    LEGACY_NOT_CONFIGURED: '还没有连接旧工程目录。升级安装时可连接已备份的旧工程。',
    LEGACY_WRITER_BUSY: '旧工作台正在使用这些工程。请先结束旧版任务并关闭旧工作台，再重新打开。',
    LEGACY_UNAVAILABLE: '暂时找不到旧工程目录，请检查磁盘是否连接。',
    LEGACY_SOURCE_CHANGED: '来源旧工程目录已经变更，请先核对升级配置。',
    LEGACY_ROOT_CONFLICT: '新旧工程目录重合，需要重新检查升级配置。',
    LEGACY_PROJECT_NOT_FOUND: '找不到这个旧工程，请返回列表重新选择。',
    LEGACY_REVISION_CONFLICT: '旧工程已有更新，请先保留当前输入，再重新读取。',
    REVISION_CONFLICT: '旧工程已有更新，请先保留当前输入，再重新读取。',
    COMMAND_ID_CONFLICT: '这次操作编号已用于其他内容，请重新打开工程后再试。',
    LEGACY_MEDIA_MISSING: '有视频文件找不到了。请先恢复原文件，再继续。',
    LEGACY_MEDIA_CHANGED: '视频文件发生变化，请先核对原素材。',
    LEGACY_IMPORT_APPROVAL: '请先查看复制范围，再确认开始制作。',
    LEGACY_IMPORT_UNSUPPORTED: '这次可复制单视频轨、连续排列且总长不超过 25 分钟的旧工程。',
    INVALID_ARRANGEMENT: '有片段在同一素材中的区间重叠，暂时无法带入新编排。可以先在兼容区处理。',
    INVALID_SUBTITLE: '部分字幕时间无法带入新工程，请先在兼容区核对字幕。',
    RANGE_INVALID: '请在当前片段范围内设置开始和结束时间。',
    LEGACY_COMMAND_DENIED: '兼容区暂不支持这项操作。',
    PROTECTED_CONTENT: '这次裁剪影响了必须保留的内容，请调整范围。',
    LEGACY_JOB_NOT_FOUND: '这项任务不属于当前工程，请重新读取。',
  })[error.message] || describe(error);
}

async function legacyPage(id) {
  const [projectId, query = ''] = (id || '').split('?');
  const expectedSource = new URLSearchParams(query).get('source');
  id = projectId;
  const region = element('section', '');
  region.dataset.legacyWorkbench = '';
  const status = element('p', '正在读取旧工程…', region);
  status.setAttribute('role', 'status');
  const content = element('div', '', region);
  const prefix = 'legacy/projects' + (id ? '/' + encodeURIComponent(id) : '');
  let current;
  let busy = false;
  let importAttempt;
  let renderAttempt;

  async function reload() {
    try {
      const value = await api(prefix);
      if (!region.isConnected) return;
      if (expectedSource && expectedSource !== value.sourceKey) throw new Error('LEGACY_SOURCE_CHANGED');
      current = value;
      content.replaceChildren();
      status.textContent = '';
      if (!id) {
        element('h1', '旧工程', content);
        element('p', '在这里继续查看、修正和导出以前的工程，也可以复制素材到新版开始制作。', content);
        if (!value.configured) { status.textContent = legacyMessage(new Error('LEGACY_NOT_CONFIGURED')); return; }
        if (!value.projects.length) element('p', '这个目录里还没有旧工程。', content);
        for (const project of value.projects) {
          const card = element('article', '', content);
          card.className = 'card';
          element('strong', project.name, card);
          element('p', '第 ' + project.revision + ' 版' + (project.archived ? ' · 已归档' : ''), card);
          button(card, '打开旧工程', () => { location.hash = '/legacy/' + project.projectId; });
        }
        return;
      }
      renderProject();
    } catch (error) {
      if (!region.isConnected) return;
      status.textContent = legacyMessage(error);
      content.replaceChildren();
      button(content, '重新读取', reload);
    }
  }

  async function saveCommand(op, target, params, commandId) {
    if (busy) return;
    busy = true;
    status.textContent = '正在保存…';
    try {
      await api(prefix + '/command', { commandId, baseRevision: current.revision, op, target, params });
      await reload();
      if (region.isConnected) status.textContent = '已保存为新版本。';
    } catch (error) {
      if (region.isConnected) status.textContent = legacyMessage(error);
    } finally { busy = false; }
  }

  function confirm(title, text, label, action) {
    const dialog = element('dialog', '', region);
    dialog.setAttribute('aria-label', title);
    element('h2', title, dialog);
    element('p', text, dialog);
    const status = element('p', '', dialog);
    status.setAttribute('role', 'status');
    let running = false;
    const back = button(dialog, '先返回', () => dialog.close());
    const go = button(dialog, label, async () => {
      if (running) return;
      running = true;
      go.disabled = back.disabled = true;
      status.textContent = '正在处理，请稍候…';
      try {
        await action();
        dialog.close();
      } catch (error) {
        status.textContent = legacyMessage(error);
      } finally {
        running = false;
        go.disabled = back.disabled = false;
      }
    }, true);
    dialog.addEventListener('cancel', event => { if (running) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    back.focus();
  }

  function remember(input, field) {
    const key = current.sourceKey + ':' + id + ':' + current.revision + ':' + field;
    if (legacyDraftInputs.has(key)) {
      input.value = legacyDraftInputs.get(key);
      status.textContent = '已恢复尚未保存的输入。';
    }
    input.addEventListener('input', () => {
      legacyDraftInputs.set(key, input.value);
      if (legacyDraftInputs.size > 500) legacyDraftInputs.delete(legacyDraftInputs.keys().next().value);
      status.textContent = '修改尚未保存。';
    });
  }

  function renderProject() {
    button(content, '返回旧工程列表', () => { location.hash = '/legacy'; });
    element('h1', current.name, content);
    element('p', '旧工程第 ' + current.revision + ' 版 · ' + (current.durationUs / 1e6).toFixed(2) + ' 秒', content);
    button(content, '重新读取工程', reload);
    button(content, '用这些素材开始制作', () => {
      const version = current.revision;
      const signature = id + ':' + version;
      if (importAttempt?.signature !== signature) importAttempt = { signature, id: crypto.randomUUID() };
      confirm('复制到新版开始制作', '复制当前第 ' + version + ' 版用到的视频、片段顺序和可见字幕。' +
        current.skipped.join('。') + '。原工程会保留。', '确认复制并打开新项目', async () => {
          const result = await api(prefix + '/import', { commandId: importAttempt.id, revision: version, confirm: true });
          state = await api('bootstrap');
          location.hash = '/projects/' + result.projectId;
        });
    }, true);
    const clips = element('section', '', content);
    element('h2', '片段与裁剪', clips);
    const rate = current.fps.num / current.fps.den;
    for (const [index, clip] of current.clips.entries()) {
      const card = element('article', '', clips);
      card.className = 'card';
      element('strong', '片段 ' + (index + 1), card);
      const media = current.media.find(item => item.id === clip.mediaId);
      if (!media?.available) element('p', '原视频文件缺失', card);
      const preview = button(card, '播放原视频', () => openPreview({ id: current.projectId },
        { name: media?.name || '旧视频' }, preview, prefix + '/media/' + clip.mediaId + '/content', '返回旧工程'));
      preview.disabled = !media?.available;
      const form = element('form', '', card);
      const field = (label, value) => {
        const input = element('input', '', element('label', label, form));
        input.type = 'number';
        input.step = '0.001';
        input.min = '0';
        input.required = true;
        input.value = value.toFixed(3);
        return input;
      };
      const start = field('从第几秒保留', clip.inFrame / rate);
      const end = field('保留到第几秒', clip.outFrame / rate);
      remember(start, clip.id + ':start');
      remember(end, clip.id + ':end');
      const submit = element('button', '保存这段裁剪', form);
      let attempt;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const params = { inFrame: Math.round(Number(start.value) * rate), outFrame: Math.round(Number(end.value) * rate) };
        const signature = JSON.stringify(params);
        if (attempt?.signature !== signature) attempt = { signature, id: 'L_' + crypto.randomUUID() };
        submit.disabled = true;
        await saveCommand('segment.trim', clip.id, params, attempt.id);
        submit.disabled = false;
      });
      for (const [step, label] of [[-1, '片段上移'], [1, '片段下移']]) {
        const move = button(card, label, () => {
          const track = current.tracks.find(item => item.id === clip.track);
          const ids = [...track.segmentIds];
          const from = ids.indexOf(clip.id);
          const to = from + step;
          [ids[from], ids[to]] = [ids[to], ids[from]];
          saveCommand('segment.reorder', track.id, { segmentIds: ids }, 'L_' + crypto.randomUUID());
        });
        const track = current.tracks.find(item => item.id === clip.track);
        const at = track.segmentIds.indexOf(clip.id) + step;
        move.disabled = at < 0 || at >= track.segmentIds.length;
      }
    }
    const captions = element('section', '', content);
    element('h2', '修正字幕', captions);
    if (!current.captions.length) element('p', '这个工程还没有字幕。', captions);
    for (const caption of current.captions) {
      const form = element('form', '', captions);
      const text = element('textarea', '', element('label', '字幕文字', form));
      text.value = caption.text;
      text.maxLength = 12000;
      remember(text, caption.id + ':text');
      const submit = element('button', '保存字幕', form);
      let attempt;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (attempt?.text !== text.value) attempt = { text: text.value, id: 'L_' + crypto.randomUUID() };
        submit.disabled = true;
        await saveCommand('caption.correct', caption.id, { text: text.value }, attempt.id);
        submit.disabled = false;
      });
    }
    const history = element('details', '', content);
    element('summary', '查看与恢复以前的版本', history);
    for (const entry of current.history) {
      const row = element('p', '第 ' + entry.revision + ' 版', history);
      if (entry.revision !== current.revision) {
        button(row, '恢复这一版', () => {
          const commandId = 'L_' + crypto.randomUUID();
          confirm('恢复旧版本', '把第 ' + entry.revision + ' 版恢复为一个新版本。当前内容仍能从历史中找到。',
            '确认恢复', async () => {
              const result = await api(prefix + '/command', { commandId, baseRevision: current.revision,
                op: 'revision.restore', target: id, params: { revision: entry.revision } });
              await reload();
              return result;
            });
        });
      }
    }
    const chat = element('section', '', content);
    element('h2', '以前的对话', chat);
    loadChats(chat);
    const deliveries = element('section', '', content);
    deliveries.dataset.legacyDeliveries = '';
    element('h2', '预览和导出', deliveries);
    for (const [type, label] of [['preview', '生成预览'], ['export', '导出旧工程']]) {
      button(deliveries, label, async () => {
        if (busy) return;
        busy = true;
        const signature = type + ':' + current.revision;
        if (renderAttempt?.signature !== signature) renderAttempt = { signature, id: 'L_' + crypto.randomUUID() };
        try {
          await api(prefix + '/render', { revision: current.revision, requestId: renderAttempt.id, type });
          renderAttempt = undefined;
          await loadJobs(deliveries);
        } catch (error) { status.textContent = legacyMessage(error); }
        finally { busy = false; }
      });
    }
    element('div', '', deliveries).dataset.jobList = '';
    loadJobs(deliveries);
  }

  async function loadChats(box) {
    const turns = element('div', '', box);
    try {
      const list = await api(prefix + '/conversations');
      if (!box.isConnected) return;
      const choices = element('select', '', element('label', '选择旧对话', box));
      const chats = [...list.conversations, { id: 'legacy', title: '更早的记录' }];
      chats.forEach(chat => { element('option', chat.title, choices).value = chat.id; });
      let before = null;
      const more = button(box, '查看更早消息', () => load(true));
      async function load(older) {
        try {
          const requestId = choices.value;
          const query = new URLSearchParams({ id: requestId, ...(older && before ? { before } : {}) });
          const detail = await api(prefix + '/conversations?' + query);
          if (!box.isConnected || choices.value !== requestId) return;
          if (!older) turns.replaceChildren();
          const group = document.createElement('div');
          for (const run of detail.runs) {
            element('strong', '你', group);
            element('p', run.request, group);
            element('strong', '剪辑导演', group);
            element('p', run.reply || '这条旧任务没有保存回复。', group);
          }
          turns.prepend(group);
          if (!turns.textContent) element('p', '这段对话还没有消息。', turns);
          before = detail.nextBefore;
          more.hidden = !before;
        } catch (error) { if (box.isConnected) turns.textContent = legacyMessage(error); }
      }
      choices.addEventListener('change', () => { before = null; load(false); });
      await load(false);
    } catch (error) { if (box.isConnected) turns.textContent = legacyMessage(error); }
  }

  async function loadJobs(box) {
    try {
      const list = await api(prefix + '/deliveries');
      if (!box.isConnected) return;
      const rows = box.querySelector('[data-job-list]');
      rows.replaceChildren();
      const labels = { queued: '排队中', running: '处理中', succeeded: '已完成', interrupted: '已中断',
        failed: '未完成', cancelled: '已取消' };
      for (const job of list) {
        const row = element('article', '', rows);
        row.className = 'card';
        element('strong', '第 ' + job.revision + ' 版 · ' + labels[job.state], row);
        if (job.error) element('p', '这次处理未完成，可以重试原任务。', row);
        for (const action of ['queued', 'running'].includes(job.state) ? ['cancel']
          : ['failed', 'interrupted', 'cancelled'].includes(job.state) ? ['retry'] : []) {
          button(row, action === 'cancel' ? '取消任务' : '重试原任务', async () => {
            try { await api(prefix + '/jobs/' + job.id + '/' + action, {}); await loadJobs(box); }
            catch (error) { status.textContent = legacyMessage(error); }
          });
        }
        for (const artifact of job.artifacts) {
          if (!['video.mp4', 'captions.srt'].includes(artifact.name)) continue;
          const path = prefix + '/jobs/' + job.id + '/artifacts/' + artifact.name;
          const link = element('a', artifact.name.endsWith('.mp4') ? '下载视频' : '下载字幕', row);
          link.href = './v3/' + path;
          link.download = artifact.name;
          if (artifact.name.endsWith('.mp4')) {
            const preview = button(row, '播放处理结果', () => openPreview({ id },
              { name: '旧工程第 ' + job.revision + ' 版' }, preview, path, '返回旧工程'));
          }
        }
      }
    } catch (error) { if (box.isConnected) status.textContent = legacyMessage(error); }
  }

  await reload();
  if (id) {
    const timer = setInterval(() => {
      if (!region.isConnected) return clearInterval(timer);
      const box = region.querySelector('[data-legacy-deliveries]');
      if (box && !document.hidden) loadJobs(box);
    }, 3000);
  }
}
