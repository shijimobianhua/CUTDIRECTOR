'use strict';

function arkProblem(error) {
  return ({
    VIDEO_METHOD_UNAVAILABLE:'这份方法不能用于当前视频工具，请换一种试拍方法。',
    VIDEO_METHOD_TOO_LONG:'方法和画面要求合在一起太长了，请缩短补充要求。',
    IMAGE_INVALID_REQUEST: '请选择已保存的镜头，以及开始图或结束图。',
    IMAGE_REFERENCE_LIMIT: '参考图需长宽各超过 14 像素，每张不超过 8 MB。',
    IMAGE_METHOD_UNAVAILABLE: '这份方法还不能用于分镜出图，请换一份或使用默认方法。',
    SKILL_DISABLED: '这份方法已停用，请重新选择。',
    SKILL_EXPORT_PRIVATE: '这份方法包含私人路径或凭据，请先清理这些内容。',
    IMAGE_RESULT_INVALID: '返回的图片无法读取，请到方舟控制台核对这次生成。',
    IMAGE_RESULT_ASPECT: '生成图的比例与分镜不一致，请核对结果后再使用。',
    IMAGE_SUBMIT_UNKNOWN: '暂时无法确认这次出图的结果。请先到方舟控制台核对记录和费用，再决定是否重新生成。',
    IMAGE_COLLECT_FAILED: '图片已返回，保存到素材库时未完成。可以重新核对已返回图片。',
    IMAGE_PRIOR_UNKNOWN: '这一张图已有一次提交待核对，请先查看方舟记录和费用。',
    IMAGE_JOB_NOT_FOUND: '找不到这次出图记录，请重新打开项目。',
    ARK_NOT_CONFIGURED: '先在「设置 → 火山方舟」连接账号。',
    ARK_INVALID_KEY: '请检查 API Key 是否复制完整。',
    ARK_CREDENTIAL: '方舟没有接受这组凭据，请检查 API Key 和账号权限。',
    ARK_CREDENTIAL_STORE: 'Windows 凭据保护暂时不可用。',
    ARK_CONNECTION_CHANGED: '方舟连接已变更，请重新准备试拍。',
    ARK_INVALID_REQUEST: '请选择一个镜头，并设置 4 到 30 秒的整数时长。',
    ARK_FIRST_FRAME_REQUIRED: '如果使用结束图，也要为这一镜选择开始图。',
    ARK_FRAME_LIMIT: '首尾图需要长宽各 300 到 6000 像素、比例在 0.4 到 2.5 之间，每张不超过 8 MB。',
    ARK_FRAME_RATIO: '两张图的比例不同，请先换成相同比例的图片。',
    ARK_FRAME_ASPECT: '开始图和分镜的画面方向不同，请换图或调整并保存画面比例。',
    ARK_FRAME_CHANGED: '图片已变更或缺失，请核对分镜后重新准备。',
    ARK_APPROVAL_REQUIRED: '请确认费用和发送的素材后再提交。',
    ARK_NETWORK: '暂时连不上方舟，请稍后再检查。',
    ARK_REJECTED: '方舟拒绝了这组参数，请检查模型或输入。',
    ARK_RATE_LIMIT: '方舟暂时限制了请求频率。',
    ARK_BAD_RESPONSE: '方舟返回的内容无法核对。',
    ARK_RESPONSE: '方舟暂时无法处理请求。',
    ARK_PRIOR_UNKNOWN: '同一镜头已有一次提交待核对。请先检查方舟账单；如需重试，请重新准备并确认可能重复计费。',
    ARK_SUBMIT_UNKNOWN: '方舟尚未返回任务编号。请先在方舟控制台核对订单，再决定是否另起试拍。',
    ARK_NOT_FOUND: '方舟找不到原任务，可能已过期或账号不一致。',
    ARK_JOB_CANCELLED: '方舟已取消这次生成。',
    ARK_JOB_FAILED: '方舟报告这次生成失败，请在控制台查看详情。',
    ARK_JOB_EXPIRED: '这次生成在方舟已超时。',
    ARK_OUTPUT_MISSING: '方舟已生成，但这次查询没有返回下载地址。',
    ARK_UNSAFE_OUTPUT: '生成结果的下载地址不在支持范围内，请到方舟控制台下载后导入。',
    ARK_DOWNLOAD_FAILED: '生成结果还没取回，可以检查原任务后重新取回。',
    INVALID_MEDIA: '取回的视频未通过解码检查，可以重新取回原任务。',
    STORY_CONFLICT: '分镜版本有更新，请先保存并重新准备试拍。',
  })[error.message] || describe(error);
}

function arkSettings() {
  const section = element('section', '');
  element('h2', '火山方舟 · 分镜出图与试拍', section);
  element('p', '连接一次，可用 Seedream 画分镜，用 Seedance 生成短视频。每次生成前会单独确认内容和费用。', section);
  const docs = element('a', '去火山方舟获取 API Key', section);
  docs.href = 'https://ark.volcengine.com/region:cn-beijing/apikey';
  docs.target = '_blank';
  docs.rel = 'noopener noreferrer';
  const status = element('p', '正在读取连接…', section);
  status.setAttribute('role', 'status');
  const form = element('form', '', section);
  const label = element('label', 'API Key', form);
  const key = element('input', '', label);
  key.type = 'password';
  key.autocomplete = 'new-password';
  key.maxLength = 512;
  key.required = true;
  const save = element('button', '检查连接并保存', form);
  save.className = 'primary';
  const deactivate = button(section, '停用此连接', async () => {
    deactivate.disabled = true;
    try {
      apply(await api('generation-settings', { action: 'disable' }));
    } catch (error) {
      status.textContent = arkProblem(error);
    } finally {
      deactivate.disabled = false;
    }
  });
  deactivate.hidden = true;

  function apply(config) {
    if (!section.isConnected) return;
    status.textContent = config.configured
      ? '账号已连接 · Seedream 5.0 lite ' + (config.imageGeneratedOnce ? '已有通过检查的图片' : '待首次出图验证') + ' · Seedance 2.5 ' + (config.generatedOnce ? '已有可播放的视频' : '待首次试拍验证')
      : '未连接。已提交的任务仍保留原账号记录，可以在项目中查询。';
    deactivate.hidden = !config.configured;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const credential = key.value.trim();
    if (!credential) return;
    key.value = '';
    key.disabled = save.disabled = deactivate.disabled = true;
    status.textContent = '正在检查方舟连接…';
    try {
      apply(await api('generation-settings', { key: credential }));
    } catch (error) {
      status.textContent = arkProblem(error);
    } finally {
      key.disabled = save.disabled = deactivate.disabled = false;
    }
  });
  api('generation-settings').then(apply).catch(error => { if (section.isConnected) status.textContent = arkProblem(error); });
}

function projectGeneration(project, workspace, selectCandidate) {
  const section = element('section', '', workspace);
  section.dataset.workbenchSection = 'generation';
  section.tabIndex = -1;
  element('h2', '用 Seedance 试拍', section);
  button(section,'使用其他视频生成工具',()=>locateWorkbench(workspace.querySelector('[data-workbench-section="extensions"]')));
  const status = element('p', '', section);
  status.setAttribute('role', 'status');
  const form = element('div', '', section);
  const cards = element('div', '', section);
  cards.className = 'cards';
  candidateComparison(project,section,'video',selectCandidate);
  const prefix = 'projects/' + project.id + '/generations';
  const states = {
    awaiting_approval: '等待确认', dispatching: '正在提交', unknown: '提交待核对',
    queued: '排队中', running: '生成中', collecting: '取回视频中',
    collect_failed: '需要重新取回', ready: '可播放', failed: '未完成', expired: '已超时', cancelled: '已取消',
  };
  let story;
  let preferredShot;
  workspace.parentElement.addEventListener('cutdirector-focus-shot',event=>{preferredShot=event.detail.id;renderForm();});
  let config;
  let methods=[];
  let jobs = [];
  let pending = false;
  let attempt;
  let lastSignature = '';

  function renderForm() {
    form.replaceChildren();
    if (!config?.configured) {
      element('p', '连接方舟后，可以选择一个镜头试拍。已有视频也可以直接导入。', form);
      const link = element('a', '去设置连接方舟', form);
      link.href = '#/settings';
      return;
    }
    if (!story?.shots.length) {
      element('p', '先添加并保存分镜，再选择要试拍的镜头。', form);
      return;
    }
    const fields = element('form', '', form);
    const choice = element('label', '选择已保存的镜头', fields);
    const shot = element('select', '', choice);
    story.shots.forEach((item, i) => {
      element('option', '镜头 ' + (i + 1) + ' · ' + item.action.slice(0, 40), shot).value = item.id;
    });
    if(story.shots.some(item=>item.id===preferredShot))shot.value=preferredShot;
    const time = element('label', '生成时长（4–30 秒）', fields);
    const seconds = element('input', '', time);
    seconds.type = 'number';
    seconds.min = '4';
    seconds.max = '30';
    seconds.required = true;
    const setDuration = () => {
      const selected = story.shots.find(item => item.id === shot.value);
      seconds.value = String(Math.max(4, Math.ceil(selected.durationUs / 1e6)));
    };
    shot.addEventListener('change',()=>{preferredShot=shot.value;renderForm();});
    setDuration();
    const promptLabel = element('label', '补充画面要求（选填）', fields);
    const prompt = element('textarea', '', promptLabel);
    prompt.rows = 3;
    prompt.maxLength = 2000;
    prompt.placeholder = '留空会按已保存的分镜生成提示词。';
    const method=element('select','',element('label','试拍方法（选填）',fields));
    element('option','按分镜试拍',method).value='';
    for(const item of methods)element('option',item.name,method).value=item.hash;
    const audioLabel = element('label', '同时生成声音', fields);
    const audio = element('input', '', audioLabel);
    audio.type = 'checkbox';
    bindGenerationDraft(project,'video-form',shot.value,story.version,fields,{seconds,audio,method,prompt});
    const prepare = element('button', '检查试拍内容', fields);
    prepare.className = 'primary';
    fields.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      prepare.disabled = true;
      const input = { storyVersion: story.version, shotId: shot.value, seconds: Number(seconds.value),
        prompt: prompt.value, audio: audio.checked,method:method.value||null };
      const signature = JSON.stringify(input);
      if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
      status.textContent = '正在核对试拍输入…';
      try {
        const job = await api(prefix, { ...input, commandId: attempt.id });
        attempt = undefined;
        if (!section.isConnected) return;
        status.textContent = '请核对试拍内容、外传素材和计费说明。';
        approval(job);
        await refresh();
      } catch (error) {
        if (section.isConnected) status.textContent = arkProblem(error);
      } finally {
        prepare.disabled = false;
        pending = false;
      }
    });
  }

  function approval(job) {
    const dialog = element('dialog', '', section);
    dialog.setAttribute('aria-label', '确认 Seedance 试拍');
    element('h3', '确认生成 1 个镜头', dialog);
    element('p', '火山方舟 Seedance 2.5 · ' + job.spec.seconds + ' 秒 · ' + job.spec.ratio +
      (job.spec.audio ? ' · 含声音' : ' · 不生成声音'), dialog);
    if(job.spec.method)element('p','试拍方法 · '+job.spec.method.name,dialog);
    element('p', '提示词', dialog);
    element('pre', job.spec.prompt, dialog);
    element('p', job.spec.frames.length ? '发送的图片' : '本次只发送提示词。', dialog);
    for (const frame of job.spec.frames) {
      element('p', (frame.role === 'first_frame' ? '开始图 ' : '结束图 ') + frame.name, dialog);
    }
    const fee = element('label', '我确认由方舟账号计费，费用以方舟账单为准。', dialog);
    const charge = element('input', '', fee);
    charge.type = 'checkbox';
    let sharing;
    if (job.spec.frames.length) {
      const label = element('label', '我同意将上面列出的图片发给火山方舟。', dialog);
      sharing = element('input', '', label);
      sharing.type = 'checkbox';
    }
    let duplicate;
    if (job.spec.priorUnknown) {
      const prior = element('label', '这镜之前有一次提交待核对。我已核对方舟订单，了解再次生成可能重复计费。', dialog);
      duplicate = element('input', '', prior);
      duplicate.type = 'checkbox';
    }
    const cancel = button(dialog, '先不生成', () => dialog.close());
    const go = button(dialog, '确认提交试拍', async () => {
      go.disabled = true;
      cancel.disabled = true;
      charge.disabled = true;
      if (sharing) sharing.disabled = true;
      if (duplicate) duplicate.disabled = true;
      status.textContent = '正在提交给方舟…';
      try {
        const result = await api(prefix + '/' + job.id + '/approve',
          { confirmCharge: charge.checked, confirmUpload: !!sharing?.checked, acknowledgeDuplicate: !!duplicate?.checked });
        status.textContent = result.error ? arkProblem(new Error(result.error)) : '已提交。可以在下方查看进度。';
        dialog.close();
        await refresh();
      } catch (error) {
        status.textContent = arkProblem(error);
        dialog.close();
      }
    }, true);
    const update = () => { go.disabled = !charge.checked || (!!sharing && !sharing.checked) || (!!duplicate && !duplicate.checked) || job.storyVersion !== story?.version; };
    charge.addEventListener('change', update);
    sharing?.addEventListener('change', update);
    duplicate?.addEventListener('change', update);
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
      const index = story?.shots.findIndex(shot => shot.id === job.shotId) ?? -1;
      element('strong', (index >= 0 ? '镜头 ' + (index + 1) : '旧镜头') + ' · ' + states[job.state], row);
      element('p', job.spec.seconds + ' 秒 · 分镜第 ' + job.storyVersion + ' 版' + (job.paused ? ' · 暂停后台查询' : ''), row);
      if (job.error) element('p', arkProblem(new Error(job.error)), row);
      if (job.state === 'awaiting_approval' && job.storyVersion === story?.version) {
        button(row, '查看并确认试拍', () => approval(job));
      }
      if (job.candidateId) {
        const preview = button(row, '播放生成视频', async () => {
          try {
            const assets = await api('projects/' + project.id + '/assets');
            const asset = assets.find(item => item.id === job.candidateId);
            if (asset && row.isConnected) openPreview(project, asset, preview, undefined, '返回试拍');
          } catch (error) {
            status.textContent = arkProblem(error);
          }
        });
        if (index >= 0) button(row, '用这段视频', () => selectCandidate(job.shotId, job.candidateId));
      }
      if (['queued', 'running', 'collecting', 'collect_failed'].includes(job.state)) {
        const check = button(row, '查询原任务', () => action(job, 'check', check));
        const toggle = button(row, job.paused ? '继续后台查询' : '暂停后台查询', () => action(job, job.paused ? 'resume' : 'pause', toggle));
      }
      if (job.remoteId) {
        const details = element('details', '', row);
        element('summary', '任务编号', details);
        element('p', job.remoteId, details);
      }
    }
  }

  async function action(job, operation, trigger) {
    trigger.disabled = true;
    try {
      const result = await api(prefix + '/' + job.id + '/' + operation, {});
      status.textContent = operation === 'pause'
        ? '已暂停后续后台查询。方舟上的生成任务仍可能继续并计费。'
        : result.error ? arkProblem(new Error(result.error)) : '已更新任务状态。';
      await refresh();
    } catch (error) {
      if (section.isConnected) status.textContent = arkProblem(error);
    } finally {
      trigger.disabled = false;
    }
  }

  async function refresh() {
    const result = await api(prefix);
    if (!section.isConnected) return;
    const signature = JSON.stringify(result);
    if (lastSignature === signature) return;
    lastSignature = signature;
    jobs = result;
    renderJobs();
  }

  Promise.all([api('generation-settings'),api('skills')]).then(([value,library])=>{if(section.isConnected){config=value;methods=library.filter(item=>item.enabled&&item.manifest?.roles?.includes('video')&&(!item.manifest.stages?.length||item.manifest.stages.includes('generation'))&&!(item.manifest.capabilities||[]).some(value=>!['video-generation','text-advice'].includes(value)));renderForm();}})
    .catch(error => { if (section.isConnected) status.textContent = arkProblem(error); });
  refresh().catch(() => {});
  const timer = setInterval(() => {
    if (!section.isConnected) return clearInterval(timer);
    refresh().catch(() => {});
  }, 7000);
  return function update(current) {
    story = current;
    renderForm();
    renderJobs();
  };
}
