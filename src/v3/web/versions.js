'use strict';

function projectVersions(project, parent) {
  const region = element('details', '', parent);
  element('summary', '以前保存的版本与撤销', region);
  const kind = element('select', '', element('label', '查看哪部分', region));
  element('option', '简报和分镜', kind).value = 'story';
  element('option', '片段顺序和字幕', kind).value = 'arrangement';
  const status = element('p', '', region);
  status.setAttribute('role', 'status');
  const rows = element('div', '', region);
  let nextBefore;
  let sequence = 0;
  const more = button(region, '查看更多版本', () => load(true));
  const prefix = 'projects/' + project.id + '/';
  async function load(append = false) {
    const request = ++sequence;
    const currentKind = kind.value;
    try {
      const query = append && nextBefore ? '?' + new URLSearchParams({before: nextBefore}) : '';
      const data = await api(prefix + currentKind + '/versions' + query);
      if (!region.isConnected || request !== sequence) return;
      if (!append) rows.replaceChildren();
      nextBefore = data.nextBefore;
      for (const item of data.items) {
        const row = element('article', '', rows);
        row.className = 'card';
        element('strong', '第 ' + item.version + ' 版', row);
        element('p', item.count + (currentKind === 'story' ? ' 个镜头' : ' 个片段') +
          ' · ' + Number(item.seconds || 0).toFixed(1) + ' 秒', row);
        button(row, '查看并恢复这一版', () => review(currentKind, item.version));
      }
      status.textContent = data.items.length ? '' : '还没有保存过这一部分。';
      more.hidden = !nextBefore;
    } catch (error) { if (region.isConnected) status.textContent = describe(error); }
  }
  async function review(currentKind, version) {
    const target = document.querySelector('[data-workbench-section="' + currentKind + '"]');
    const state = {dirty: true};
    target?.dispatchEvent(new CustomEvent('cutdirector-' + currentKind + '-state', {detail: state}));
    if (state.dirty) {
      status.textContent = '当前有未保存或未确认的输入，请先保留这些内容再恢复版本。';
      return;
    }
    try {
      const [snapshot, current] = await Promise.all([
        api(prefix + currentKind + '/versions/' + version), api(prefix + currentKind),
      ]);
      if (!region.isConnected) return;
      const dialog = element('dialog', '', region);
      dialog.setAttribute('aria-label', '恢复已保存版本');
      element('h3', '查看第 ' + version + ' 版', dialog);
      if (currentKind === 'story') {
        element('p', snapshot.brief, dialog);
        for (const [index, shot] of snapshot.shots.entries()) {
          element('p', '镜头 ' + (index + 1) + ' · ' + shot.durationUs / 1e6 + ' 秒 · ' + shot.action, dialog);
        }
      } else {
        for (const [index, clip] of snapshot.clips.entries()) {
          element('p', '片段 ' + (index + 1) + ' · ' + clip.name + ' · ' + clip.inUs / 1e6 + ' 至 ' + clip.outUs / 1e6 + ' 秒', dialog);
        }
        element('p', '字幕 ' + snapshot.captions.length + ' 条', dialog);
      }
      element('p', '确认后另存为新版本，历史素材选用会一并恢复。已提交的生成与交接任务保留原记录。', dialog);
      const message = element('p', '', dialog);
      const actions = element('div', '', dialog);
      actions.className = 'dialog-actions';
      let running = false;
      const commandId = crypto.randomUUID();
      const back = button(actions, '保留当前版本', () => dialog.close());
      const restore = button(actions, '确认恢复为新版本', async () => {
        if (running) return;
        running = true;
        restore.disabled = back.disabled = true;
        try {
          const local = {dirty: true};
          target?.dispatchEvent(new CustomEvent('cutdirector-' + currentKind + '-state', {detail: local}));
          if (local.dirty) throw new Error('UNSAVED_LOCAL');
          const result = await api(prefix + currentKind + '/restore', {
            version, expectedVersion: current?.version || 0, commandId, confirm: true,
          });
          const latest = await api(prefix + currentKind);
          target?.dispatchEvent(new CustomEvent('cutdirector-' + currentKind + '-saved', {detail: latest}));
          dialog.close();
          await load();
          status.textContent = '已恢复并保存为第 ' + result.version + ' 版。';
        } catch (error) {
          message.textContent = ['STORY_CONFLICT', 'ARRANGEMENT_CONFLICT'].includes(error.message)
            ? '已经有后续修改，当前内容保留。请重新读取版本后再决定。'
            : error.message === 'UNSAVED_LOCAL' ? '当前有未保存输入，请先保留。' : describe(error);
        } finally { running = false; restore.disabled = back.disabled = false; }
      }, true);
      dialog.addEventListener('cancel', event => { if (running) event.preventDefault(); });
      dialog.addEventListener('close', () => dialog.remove(), {once: true});
      dialog.showModal();
      back.focus();
    } catch (error) { status.textContent = describe(error); }
  }
  region.addEventListener('toggle', () => { if (region.open) load(); });
  kind.addEventListener('change', () => load());
}
