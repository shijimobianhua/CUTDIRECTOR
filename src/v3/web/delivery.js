'use strict';

function projectDelivery(project, workspace) {
  const section = element('section', '', workspace);
  section.dataset.workbenchSection = 'delivery';
  section.tabIndex = -1;
  element('h2', '交付和成片', section);
  methodChecklist(section,'editor');
  const status = element('p', '', section);
  status.setAttribute('role', 'status');
  const controls = element('div', '', section);
  let version = 0;
  let busy = false;
  let data;
  let request = 0;
  const prefix = 'projects/' + project.id + '/';
  const label = {
    awaiting_approval: '等待确认', writing: '正在创建', uncertain: '需要核对', failed: '未创建', created: '已登记',
  };

  function explain(error) {
    return ({
      EDITOR_OPEN: '请先保存并退出剪映，再回来检查。',
      EDITOR_UNVERIFIED: '当前剪映版本还未通过验证，可以下载素材包。',
      EDITOR_UNAVAILABLE: '找不到剪映专业版，可以先下载素材包。',
      DRAFT_LIBRARY_UNAVAILABLE: '请先打开剪映并新建一个空白项目，然后退出剪映。',
      DRAFT_LIBRARY_UNSUPPORTED: '当前草稿库格式还未通过验证，可以下载素材包。',
      DRAFT_RUNTIME_UNAVAILABLE: '剪映交接组件暂时未配置，可以下载素材包。',
      DRAFT_TOOL_FAILED: '剪映工具未能完成检查，可以下载素材包。',
      DRAFT_TARGET_CHANGED: '剪映安装或草稿库已变更，请重新检查。',
      DRAFT_WRITER_BUSY: '有一份草稿正在创建或需要核对。',
      HANDOFF_MEDIA_CHANGED: '有素材变更或丢失，请检查素材后重新确认。',
      DRAFT_REGISTRATION_UNCERTAIN: '暂时无法核对登记结果。请先到剪映首页查找这份草稿。',
    })[error.message] || describe(error);
  }

  async function perform(action) {
    if (busy) return;
    busy = true;
    const buttons = [...controls.querySelectorAll('button,input,select')].filter(item => !item.disabled);
    buttons.forEach(item => { item.disabled = true; });
    try {
      await action();
    } catch (error) {
      if (section.isConnected) status.textContent = explain(error);
    } finally {
      busy = false;
      buttons.forEach(item => { item.disabled = false; });
    }
  }

  function approval(job) {
    const dialog = element('dialog', '', section);
    dialog.setAttribute('aria-label', '确认创建剪映草稿');
    element('h3', '创建一份新剪映草稿', dialog);
    element('p', '使用确认版第 ' + job.version + ' 版。剪映版本 ' + job.editor_version + '。', dialog);
    element('p', '草稿名称：' + job.name, dialog);
    element('p', '写入位置：' + job.target, dialog);
    const cancel = button(dialog, '先不创建', () => dialog.close());
    const confirm = button(dialog, '确认创建新草稿', () => {
      dialog.close();
      perform(async () => {
        status.textContent = '正在创建剪映草稿…';
        const result = await api(prefix + 'drafts/' + job.id + '/approve', {});
        status.textContent = result.state === 'created'
          ? '草稿已登记。重新打开剪映，在首页找「' + result.name + '」。'
          : result.error ? explain(new Error(result.error)) : '草稿正在创建，请稍后核对。';
        await refresh();
      });
    }, true);
    confirm.disabled = job.version !== version;
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    cancel.focus();
  }

  async function prepare() {
    await perform(async () => {
      status.textContent = '正在检查剪映和草稿库…';
      const job = await api(prefix + 'drafts', { version, commandId: crypto.randomUUID() });
      status.textContent = '检查完成，请确认创建。';
      await refresh();
      if (section.isConnected) approval(job);
    });
  }

  async function refresh() {
    const id = ++request;
    try {
      const result = await api(prefix + 'delivery');
      if (section.isConnected && id === request) {
        data = result;
        renderDelivery();
      }
    } catch (error) {
      if (section.isConnected && id === request) status.textContent = explain(error);
    }
  }

  function renderDelivery() {
    controls.replaceChildren();
    if (!version) {
      element('p', '先确认一版视频顺序，就可以下载素材包或创建剪映草稿。', controls);
      return;
    }
    const actions = element('div', '', controls);
    actions.className = 'actions';
    button(actions, '检查并交给剪映', prepare, true);
    const pack = element('a', '下载第 ' + version + ' 版素材交接包', actions);
    pack.href = './v3/' + prefix + 'handoff-pack/' + version;
    pack.download = '';

    for (const job of data?.drafts || []) {
      const row = element('p', '第 ' + job.version + ' 版 · ' + label[job.state] + ' · ' + job.name, controls);
      if (job.state === 'awaiting_approval' && job.version === version) {
        button(row, '查看并确认', () => approval(job));
      } else if (['writing', 'uncertain'].includes(job.state)) {
        button(row, '核对登记', () => perform(async () => {
          const result = await api(prefix + 'drafts/' + job.id);
          status.textContent = result.state === 'created'
            ? '已确认草稿登记。' : '还未能核对，请在剪映首页查找这份草稿。';
          await refresh();
        }));
      }
    }

    element('h3', '导回成片', controls);
    const form = element('form', '', controls);
    const scope = element('label', '关联哪一次交接', form);
    const select = element('select', '', scope);
    element('option', '第 ' + version + ' 版 · 手动导出', select).value = '';
    for (const job of data?.drafts || []) {
      if (job.state === 'created') element('option', '第 ' + job.version + ' 版 · ' + job.name, select).value = job.id;
    }
    const wrapper = element('label', '选择剪映导出的 MP4', form);
    const fileInput = element('input', '', wrapper);
    fileInput.type = 'file';
    fileInput.accept = '.mp4,video/mp4';
    const save = element('button', '归档成片', form);
    save.className = 'primary';
    let attempt;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const file = fileInput.files[0];
      if (!file) {
        status.textContent = '请先选择一个 MP4 文件。';
        return;
      }
      const job = data?.drafts.find(item => item.id === select.value);
      perform(async () => {
        const selectedVersion = job?.version || version;
        if (attempt?.file !== file || attempt?.version !== selectedVersion || attempt?.handoffId !== job?.id) {
          attempt = { file, version: selectedVersion, handoffId: job?.id, id: crypto.randomUUID() };
        }
        const query = new URLSearchParams({ name: file.name, commandId: attempt.id, version: selectedVersion });
        if (job) query.set('handoffId', job.id);
        status.textContent = '正在保存成片…';
        const response = await fetch('./v3/' + prefix + 'finals?' + query, {
          method: 'POST', headers: { 'X-Cutdirector-Session': session, 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.code);
        status.textContent = '成片已归档。';
        await refresh();
      });
    });

    for (const final of data?.finals || []) {
      const selected = final.id === data.selectedFinalId;
      const row = element('div', '', controls);
      row.className = 'card';
      element('p', final.name + ' · 第 ' + final.version + ' 版 · ' + (final.durationUs / 1e6).toFixed(2) +
        ' 秒' + (selected ? ' · 主版本' : ''), row);
      const preview = button(row, '播放成片', () => openPreview(project, final, preview,
        prefix + 'finals/' + final.id + '/content', '返回交付'));
      if (!selected) button(row, '设为主版本', () => perform(async () => {
        await api(prefix + 'finals/' + final.id + '/primary', { commandId: crypto.randomUUID() });
        status.textContent = '已更新主版本。';
        await refresh();
      }));
    }
  }

  renderDelivery();
  refresh();
  return function update(confirmedVersion) {
    if (version === confirmedVersion) return;
    version = confirmedVersion;
    renderDelivery();
  };
}
