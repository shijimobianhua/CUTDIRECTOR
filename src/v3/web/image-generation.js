'use strict';

function projectImageGeneration(project, workspace, selectFrame) {
  const section = element('section', '', workspace);
  section.dataset.workbenchSection = 'image-generation';
  section.tabIndex = -1;
  element('h2', '先画一张分镜图', section);
  element('p', '选择一个已保存的镜头，画开始或结束时的画面。满意后再选用，继续生成视频。', section);
  button(section,'用 Codex 或其他出图工具',()=>locateWorkbench(workspace.querySelector('[data-workbench-section="extensions"]')));
  const status = element('p', '', section);
  status.setAttribute('role', 'status');
  const form = element('div', '', section);
  const cards = element('div', '', section);
  cards.className = 'cards';
  candidateComparison(project,section,'image',selectFrame);
  const prefix = 'projects/' + project.id + '/image-jobs';
  const states = { awaiting_approval: '等待确认', dispatching: '正在出图', unknown: '结果待核对',
    collecting: '正在保存图片', ready: '可以选用', failed: '未完成' };
  let story;
  let preferredShot;
  workspace.parentElement.addEventListener('cutdirector-focus-shot',event=>{preferredShot=event.detail.id;renderForm();});
  let images = [];
  let methods = [];
  let config;
  let jobs = [];
  let attempt;
  let busy = false;
  let lastSignature = '';

  function select(parent, label, choices) {
    const input = element('select', '', element('label', label, parent));
    for (const [value, text] of choices) element('option', text, input).value = value;
    return input;
  }

  function renderForm() {
    form.replaceChildren();
    if (!config?.configured) {
      element('p', '可以连接方舟按镜头画图，或用上方的 Codex 和扩展工具，也可以导入自己的图片。', form);
      element('a', '去设置连接方舟', form).href = '#/settings';
      return;
    }
    if (!story?.shots.length) {
      element('p', '先添加并保存一个镜头，再来画分镜图。', form);
      return;
    }
    const fields = element('form', '', form);
    const shot = select(fields, '画哪个镜头', story.shots.map((item, i) =>
      [item.id, '镜头 ' + (i + 1) + ' · ' + item.action.slice(0, 40)]));
    if(story.shots.some(item=>item.id===preferredShot))shot.value=preferredShot;
    const frame = select(fields, '画哪个时刻', [['start', '镜头开始'], ['end', '镜头结束']]);
    const reference = select(fields, '参考图（选填）', [['', '本次不发参考图'],
      ...images.map(item => [item.id, item.name])]);
    const method = select(fields, '画面方法（选填）', [['', '按分镜画'],
      ...methods.map(item => [item.hash, item.name])]);
    const prompt = element('textarea', '', element('label', '补充画面要求（选填）', fields));
    prompt.maxLength = 1500;
    prompt.rows = 3;
    prompt.placeholder = '留空会使用这个镜头的画面描述和整体风格。';
    bindGenerationDraft(project,'image-form',shot.value,story.version,fields,{frame,referenceId:reference,method,prompt});
    shot.addEventListener('change',()=>{preferredShot=shot.value;renderForm();});
    const prepare = element('button', '查看这次出图内容', fields);
    prepare.className = 'primary';
    prepare.disabled = busy;
    fields.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      prepare.disabled = true;
      const input = { shotId: shot.value, frame: frame.value, storyVersion: story.version,
        prompt: prompt.value, referenceId: reference.value || null, method: method.value || null };
      const signature = JSON.stringify(input);
      if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
      status.textContent = '正在整理这次出图内容…';
      try {
        const job = await api(prefix, { ...input, commandId: attempt.id });
        if (!section.isConnected) return;
        if (job.state === 'awaiting_approval') approval(job);
        else status.textContent = '这次请求已经处理，请查看下方记录。需要新图时，修改画面要求后再准备。';
        await refresh();
      } catch (error) {
        if (section.isConnected) status.textContent = arkProblem(error);
      } finally {
        busy = false;
        prepare.disabled = false;
      }
    });
  }

  function approval(job) {
    const dialog = element('dialog', '', section);
    dialog.setAttribute('aria-label', '确认分镜出图');
    element('h3', '确认生成 1 张分镜图', dialog);
    element('p', '火山方舟 · Seedream 5.0 lite · ' + job.spec.size + ' · ' +
      (job.frame === 'start' ? '镜头开始的画面' : '镜头结束的画面'), dialog);
    if (job.spec.method) element('p', '画面方法 · ' + job.spec.method.name, dialog);
    element('p', '发送给方舟的完整画面要求', dialog);
    element('pre', job.spec.prompt, dialog);
    if (job.spec.reference) {
      element('p', '参考图 · ' + job.spec.reference.name, dialog);
      const img = element('img', '', dialog);
      img.className = 'generated-frame';
      img.alt = '本次将发送的参考图';
      img.src = './v3/projects/' + project.id + '/images/' + job.spec.reference.id + '/content';
    } else element('p', '本次只发送上面的画面要求。', dialog);
    const checkbox = text => {
      const input = element('input', '', element('label', text, dialog));
      input.type = 'checkbox';
      return input;
    };
    const charge = checkbox('我确认由方舟账号计费，费用以方舟账单为准。');
    const sharing = job.spec.reference && checkbox('我同意将这张参考图发给火山方舟。');
    const duplicate = job.spec.priorUnknown
      ? checkbox('此前有一次出图待核对。我已检查方舟记录，了解再次生成可能重复计费。') : undefined;
    let submitting = false;
    const cancel = button(dialog, '先不生成', () => dialog.close());
    const go = button(dialog, '确认出图', async () => {
      if (submitting) return;
      submitting = true;
      update();
      cancel.disabled = true;
      status.textContent = '正在出图，通常需要稍等片刻…';
      try {
        const result = await api(prefix + '/' + job.id + '/approve', {
          confirmCharge: charge.checked, confirmUpload: !!sharing?.checked,
          acknowledgeDuplicate: !!duplicate?.checked,
        });
        status.textContent = result.error ? arkProblem(new Error(result.error))
          : result.state === 'ready' ? '图片已取回，请检查画面后选用。' : '任务已提交，请在下方查看进度。';
        attempt = undefined;
        dialog.close();
        await refresh();
      } catch (error) {
        if (section.isConnected) status.textContent = arkProblem(error);
        dialog.close();
        refresh().catch(() => {});
      }
    }, true);
    const update = () => {
      go.disabled = submitting || !charge.checked || (!!sharing && !sharing.checked) ||
        (!!duplicate && !duplicate.checked) || job.storyVersion !== story?.version;
    };
    charge.addEventListener('change', update);
    sharing?.addEventListener('change', update);
    duplicate?.addEventListener('change', update);
    dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    update();
    dialog.showModal();
    cancel.focus();
  }

  function renderJobs() {
    cards.replaceChildren();
    for (const job of jobs) {
      const row = element('article', '', cards);
      row.className = 'card';
      const index = story?.shots.findIndex(item => item.id === job.shotId) ?? -1;
      const title = (index >= 0 ? '镜头 ' + (index + 1) : '旧镜头') +
        (job.frame === 'start' ? ' · 开始图' : ' · 结束图');
      element('strong', title + ' · ' + (states[job.state] || job.state), row);
      element('p', '分镜第 ' + job.storyVersion + ' 版 · Seedream', row);
      if (job.error) element('p', arkProblem(new Error(job.error)), row);
      if (job.state === 'awaiting_approval') {
        if (job.storyVersion === story?.version) button(row, '查看并确认出图', () => approval(job));
        else element('p', '分镜已更新，请按当前版本重新准备。', row);
      }
      if (job.candidateId) {
        element('p', '请你检查人物、道具和文字，满意后再选用。', row);
        const img = element('img', '', row);
        img.className = 'generated-frame';
        img.alt = title + '的生成结果';
        img.loading = 'lazy';
        img.src = './v3/projects/' + project.id + '/images/' + job.candidateId + '/content';
        if (index >= 0) {
          button(row, job.frame === 'start' ? '选作镜头开始图' : '选作镜头结束图',
            () => selectFrame(job.shotId, job.frame, job.candidateId));
          if (job.storyVersion !== story?.version) element('p', '这是旧版分镜的图片，选用前请核对当前画面要求。', row);
        }
      }
      if (['collecting', 'unknown'].includes(job.state)) {
        const check = button(row, '核对已返回图片', async () => {
          check.disabled = true;
          try {
            const result = await api(prefix + '/' + job.id + '/check', {});
            if (!section.isConnected) return;
            status.textContent = result.error ? arkProblem(new Error(result.error)) : '已更新图片记录。';
            await refresh();
          } catch (error) {
            if (section.isConnected) status.textContent = arkProblem(error);
          } finally { check.disabled = false; }
        });
      }
    }
  }

  async function refresh() {
    const next = await api(prefix);
    if (!section.isConnected) return;
    const signature = JSON.stringify(next);
    if (signature === lastSignature) return;
    lastSignature = signature;
    jobs = next;
    renderJobs();
  }

  Promise.all([api('generation-settings'), api('skills')]).then(([connection, library]) => {
    if (!section.isConnected) return;
    config = connection;
    methods = library.filter(item => item.enabled && item.manifest?.roles?.includes('image') &&
      (!item.manifest.stages?.length || item.manifest.stages.includes('frames')) &&
      !(item.manifest.capabilities || []).some(value => !['image-generation', 'text-advice'].includes(value)) &&
      (!item.manifest.suggestedExecutor || ['seedream', 'ark-image', 'ark'].includes(item.manifest.suggestedExecutor)));
    renderForm();
  }).catch(error => { if (section.isConnected) status.textContent = arkProblem(error); });
  refresh().catch(error => { if (section.isConnected) status.textContent = arkProblem(error); });
  const timer = setInterval(() => {
    if (!section.isConnected) return clearInterval(timer);
    refresh().catch(() => {});
  }, 7000);
  return function update(current, library) {
    story = current;
    images = library;
    renderForm();
    renderJobs();
  };
}
