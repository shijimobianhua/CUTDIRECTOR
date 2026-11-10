'use strict';

const page = document.querySelector('#page');
const notice = document.querySelector('#notice');
const session = document.querySelector('meta[name=cutdirector-session]').content;
let state;
let settingsRequest = 0;
let routeView;
let navigationTransition;
const uploadAttempts = new WeakMap();

function element(tag, text, parent = page) {
  const item = document.createElement(tag);
  item.textContent = text;
  parent.append(item);
  return item;
}

function button(parent, label, action, primary = false) {
  const item = element('button', label, parent);
  item.type = 'button';
  if (primary) item.className = 'primary';
  item.addEventListener('click', action);
  return item;
}

async function api(route, input) {
  const response = await fetch('./v3/' + route, {
    method: input ? 'POST' : 'GET',
    headers: { 'X-Cutdirector-Session': session, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.code), { explanation: value.error?.message });
  return value.data;
}

function describe(error) {
  if (error.explanation) return error.explanation;
  const readable={PLUGIN_PROBE_REQUIRED:'先检查这个扩展，再启用。',PLUGIN_CONFLICT:'工具设置已更新，请重新读取。',PLUGIN_VERSION_CONFLICT:'这个版本的内容发生变化，请让插件提供新版本号。',EXTENSION_CHANGED:'工具版本已变更，请按新版本重新准备这次调用。',EXTENSION_SCOPE_UNSUPPORTED:'这个工具申请了工作台未开放的权限。请使用已支持的图片、视频或建议工具。',EXTENSION_APPROVAL_REQUIRED:'请重新核对这次调用，并确认费用和文件发送。',EXTENSION_UPLOAD_NOT_DECLARED:'这个工具没有声明素材发送能力，请取消文件勾选。',APPROVAL_EXPIRED:'这次确认已过期，请重新准备调用清单。',PLUGIN_NOT_REGISTERED:'还没有登记这个工具，请到设置添加。',VISUAL_APPROVAL_REQUIRED:'发送画面前，请确认本次上传和模型费用。',QUALITY_STALE:'分镜已更新，请按新要求重新检查。',IDEA_CONFLICT:'这条灵感已有新补充，请根据新内容继续讨论。',REFERENCE_ANALYSIS_STOPPED:'分析已停止。重新打开工作台后，可以再分析这段参考。',REFERENCE_CHANGED:'参考文件发生变化，请重新上传后分析。',REFERENCE_ANALYSIS_FAILED:'这段参考暂时没能分析。可以先播放查看，或换一个短视频。',REFERENCE_ANALYSIS_BUSY:'已有参考正在分析，完成后再试。',ASSET_MISSING:'文件暂时找不到了，请重新选择原文件。',RUN_STALE:'作品已经更新，请再发一次要求。',RUN_BUDGET:'这次分析到达上限，请缩小到一个镜头或一段内容。'};
  if(readable[error.message])return readable[error.message];
  if(error.message==='CAPABILITY_DISABLED')return '这个工具已停用，可以在设置的「工具与能力」中重新启用。';
  if(error.message==='DATA_ROOT_BUSY')return '另一个 DSH 窗口正在使用这份工作台数据。关闭那个窗口后，再点重试。';
  if(error.message==='SCHEMA_UNSUPPORTED')return '这份数据来自更新的工作台版本，请换回相应版本再打开。';
  if (error.message === 'CHAT_BUSY') return '导演正在回答上一条，请稍后再试。';
  if (error.message === 'ARRANGEMENT_CONFLICT') return '顺序已有新版本。当前输入仍在，可以先查看已确认版本。';
  if (error.message === 'OPEN_FROM_DSH') return '请从 DSH 侧栏重新打开 CUTDIRECTOR，再继续。';
  if (error.message === 'UNSUPPORTED_MEDIA' || error.message === 'INVALID_MEDIA') return '这段视频无法读取，请选择可以正常播放的 MP4 或 MOV。';
  if (error.message === 'MEDIA_RUNTIME_UNAVAILABLE') return '视频读取组件暂时不可用，请联系工作台维护者。';
  if (error.message === 'REQUEST_TOO_LARGE') return '这段视频超过 2 GB，请先缩小文件。';
  if (error.message === 'INVALID_INPUT') return '请检查文字长度或链接地址，再试一次。';
  return '暂时没完成，请稍后重试。';
}

function formSubmit(form, label, route, input, update) {
  const submit = element('button', label, form);
  submit.className = 'primary';
  let attempt;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = input();
    const signature = JSON.stringify(data);
    if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
    submit.disabled = true;
    notice.textContent = '';
    try {
      const saved = await api(route, { ...data, commandId: attempt.id });
      attempt = undefined;
      if (form.isConnected) update(saved);
      else state = await api('bootstrap');
    } catch (error) {
      if (form.isConnected) notice.textContent = describe(error);
    } finally {
      submit.disabled = false;
    }
  });
}

function ideaForm(parent = page, onSaved) {
  const form = element('form', '', parent);
  const label = element('label', '记个想法', form);
  const text = element('textarea', '', label);
  text.required = true;
  text.maxLength = 4000;
  text.rows = 3;
  text.style.display = 'block';
  text.placeholder = '一句话就够了';
  const url = element('input', '', form);
  url.type = 'url';
  url.placeholder = '来源链接（选填）';
  url.setAttribute('aria-label', '来源链接');
  const capture=openView('capture',error=>{if(form.isConnected)notice.textContent=viewError(error);});
  let touched=false;
  capture.ready.then(value=>{if(form.isConnected&&!touched&&value){text.value=value.text;url.value=value.url;}}).catch(()=>{});
  form.addEventListener('input',()=>{touched=true;capture.write({text:text.value,url:url.value});});
  formSubmit(form, '保存想法', 'ideas', () => ({ text: text.value, url: url.value }), (idea) => {
    state.ideas = [idea, ...state.ideas.filter((item) => item.id !== idea.id)];
    form.reset();
    capture.write({text:'',url:''});
    notice.textContent = '想法已保存。';
    if(onSaved)Promise.resolve(onSaved(idea)).catch(error=>{notice.textContent=describe(error);});
    else render();
    text.focus({preventScroll:true});
  });
  return form;
}

function projectForm(kind, idea, parent = page) {
  const form = element('form', '', parent);
  element('h2', '给项目起个名字', form);
  const title = element('input', '', form);
  title.setAttribute('aria-label', '项目名称');
  title.required = true;
  title.maxLength = 120;
  title.value = idea?.text.slice(0, 40) || '';
  formSubmit(form, '创建项目', 'projects', () => ({ title: title.value, kind, ideaId: idea?.id }), (project) => {
    state.projects = [project, ...state.projects.filter((item) => item.id !== project.id)];
    notice.textContent = '项目已创建。';
    location.hash = '/projects/' + project.id;
  });
  title.focus();
  return form;
}

function listProjects() {
  const cards = element('div', '');
  cards.className = 'cards project-grid';
  for (const project of state.projects) {
    const card = element('article', '', cards);card.className = 'card project-card';
    const cover=element('div','',card);cover.className='project-cover';cover.append(StudioUI.icon(project.kind==='idea'?'spark':'film'));
    const body=element('div','',card);body.className='project-card-body';
    element('h2',project.title,body);
    element('p',(project.kind==='idea'?'从灵感开始':'用已有素材制作')+(project.created_at?' · '+new Date(project.created_at).toLocaleDateString('zh-CN'):''),
      body).className='project-date';
    button(body, '继续制作', () => { location.hash = '/projects/' + project.id; });
  }
  if (!state.projects.length) {
    const empty=StudioUI.empty(page,'开始你的第一条视频','有想法就和导演聊，有素材就导入。制作过程会保存在这里。','film');
    button(empty,'新建作品',()=>newProjectDialog('idea'),true);
    button(empty,'先试一个练习项目',practiceProject);
  }
}

async function connections() {
  const request = ++settingsRequest;
  const region = element('section', '正在检查当前 DSH 模型…');
  try {
    const models = await api('connections');
    if (request !== settingsRequest || !region.isConnected) return;
    region.textContent = '';
    if (!models.length) element('p', '打开 DSH 的设置，在「模型」添加服务，然后回来重新检查。', region);
    else for (const model of models) element('p', model.provider + ' · ' + model.model, region);
  } catch (error) {
    if (region.isConnected) region.textContent = describe(error);
  }
}

function mediaRoute(project) {
  return 'projects/' + project.id + '/assets';
}

async function uploadVideo(project, file) {
  if (!uploadAttempts.has(file)) uploadAttempts.set(file, crypto.randomUUID());
  const query = new URLSearchParams({ name: file.name, commandId: uploadAttempts.get(file) });
  const response = await fetch('./v3/' + mediaRoute(project) + '?' + query, {
    method: 'POST',
    headers: { 'X-Cutdirector-Session': session, 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.code);
  uploadAttempts.delete(file);
  return value.data;
}

function openPreview(project, asset, trigger, contentRoute, returnLabel = '返回素材') {
  const dialog = element('dialog', '');
  dialog.setAttribute('aria-label', '预览 ' + asset.name);
  element('h2', asset.name, dialog);
  const back = button(dialog, returnLabel, () => dialog.close(), true);
  const video = element('video', '', dialog);
  video.controls = true;
  video.preload = 'metadata';
  if(asset.previewRange){
    video.addEventListener('loadedmetadata',()=>{video.currentTime=asset.previewRange.inUs/1e6;},{once:true});
    video.addEventListener('timeupdate',()=>{if(!video.paused&&video.currentTime>=asset.previewRange.outUs/1e6)video.pause();});
    element('p','本次建议区间 '+asset.previewRange.inUs/1e6+'–'+asset.previewRange.outUs/1e6+' 秒，可拖动检查前后语境。',dialog);
  }
  video.src = './v3/' + (contentRoute || mediaRoute(project) + '/' + asset.id + '/content');
  video.addEventListener('error', () => {
    if (dialog.open) element('p', '暂时无法播放这段视频。素材仍保留在项目里。', dialog);
  }, { once: true });
  dialog.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
  }, { once: true });
  dialog.showModal();
  back.focus();
}

async function projectMedia(project, workspace, focusDirector, sourceText) {
  const intake = element('section', '', workspace);
  intake.dataset.workbenchSection = 'media-intake';
  intake.tabIndex = -1;
  element('h2', '素材', intake);
  const form = element('form', '', intake);
  const label = element('label', '选择视频（MP4 或 MOV）', form);
  const input = element('input', '', label);
  input.type = 'file';
  input.accept = '.mp4,.mov,video/mp4,video/quicktime';
  input.multiple = true;
  const list = element('div', '正在读取素材…', intake);
  const progress = element('p', '', intake);
  progress.setAttribute('role', 'status');
  let stageArrangement;
  const updateStory = projectStory(project, workspace, sourceText, clips => stageArrangement?.(clips), refresh, focusDirector.shot);
  const updateArrangement = projectArrangement(project, workspace);
  projectReferenceFiles(project,workspace,focusDirector,refresh);
  projectWorkflow(project,workspace);
  projectExtensions(project,workspace);
  projectQuality(project,workspace);
  projectBatches(project,workspace);
  stageArrangement = updateArrangement.populate;

  async function refresh() {
    try {
      const assets = await api(mediaRoute(project));
      if (!list.isConnected) return;
      list.textContent = '';
      list.className = 'cards';
      updateArrangement(assets);
      updateStory(assets);
      if (!assets.length) element('p', '还没有素材。先选择一段视频。', list);
      for (const asset of assets) {
        const card = element('article', '', list);
        card.className = 'card';
        element('strong', asset.name, card);
        element('p', (asset.durationUs / 1e6).toFixed(1) + ' 秒 · ' + asset.width + ' × ' + asset.height, card);
        const preview = button(card, '播放预览', () => openPreview(project, asset, preview));
        button(card, '问导演怎么剪这段', () => focusDirector(asset));
        const repair=element('details','',card);
        element('summary','文件丢失或无法播放？',repair);
        element('p','重新选择原来的文件，只修复素材副本，不改变片段和历史版本。选错文件会被拦住。',repair);
        const picker=element('input','',element('label','重新选择原文件',repair));picker.type='file';picker.accept='.mp4,.mov';
        picker.addEventListener('change',async()=>{
          const file=picker.files[0];if(!file)return;
          if(!uploadAttempts.has(file))uploadAttempts.set(file,crypto.randomUUID());
          picker.disabled=true;
          try{
            const response=await fetch('./v3/'+mediaRoute(project)+'/'+asset.id+'/reconnect?'+new URLSearchParams({commandId:uploadAttempts.get(file)}),
              {method:'POST',headers:{'X-Cutdirector-Session':session,'Content-Type':'application/octet-stream'},body:file});
            const value=await response.json();if(!response.ok)throw new Error(value.error?.code);
            uploadAttempts.delete(file);picker.value='';progress.textContent='原文件已重新连接，已有编排和历史版本保留。';
          }catch(error){progress.textContent=error.message==='RECONNECT_DIFFERENT_FILE'?'这个文件与原素材不一致，请重新选择原文件。':describe(error);}
          finally{picker.disabled=false;}
        });
      }
    } catch (error) {
      if (list.isConnected) {
        list.textContent = describe(error);
        button(list, '重新读取', refresh);
      }
    }
  }

  const submit = element('button', '导入视频', form);
  submit.className = 'primary';
  let files = [];
  input.addEventListener('change', () => { files = [...input.files]; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled || !files.length) return;
    submit.disabled = true;
    input.disabled = true;
    const retry = [];
    const messages = [];
    for (const [index, file] of files.entries()) {
      if (!form.isConnected) break;
      progress.textContent = '正在读取第 ' + (index + 1) + ' 段视频…';
      try {
        await uploadVideo(project, file);
      } catch (error) {
        retry.push(file);
        messages.push(file.name + ' · ' + describe(error));
      }
    }
    files = retry;
    input.value = '';
    input.disabled = false;
    submit.disabled = false;
    progress.textContent = messages.join(' ') || '视频已导入。';
    submit.textContent = retry.length ? '重试未导入的视频' : '导入视频';
    await refresh();
  });
  await refresh();
}

async function render() {
  if (!state) return;
  const address = new URL(location.hash.slice(1) || '/home', 'http://workbench.local');
  const [route, id] = address.pathname.slice(1).split('/');
  const options = address.searchParams;
  document.body.dataset.detail = String(!!id);
  page.replaceChildren();
  StudioUI.enterRoute();
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#/' + route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if(route==='scripts'){
    await scriptsPage(id,options);
  } else if(route==='timeline'){
    await timelinePage(id);
  } else if(route==='media-tools'){
    await mediaWorkspacePage(id,options);
  } else if (route === 'tasks') {
    taskCenter();
  } else if (route === 'legacy') {
    legacyPage(id ? id + address.search : undefined);
  } else if (route === 'settings') {
    settingsPage(options);
  } else if (route === 'ideas') {
    await ideasPage(id, options);
  } else if (route === 'projects') {
    if (id) {
      const requested = location.hash;
      const loading = element('p', '正在打开项目…');
      let project;
      try {
        project = await api('projects/' + id);
      } catch (error) {
        if (loading.isConnected) loading.textContent = describe(error);
        return;
      }
      if (!loading.isConnected || location.hash !== requested) return;
      loading.remove();
      const heading=StudioUI.heading(page,project.title,'在左边和导演讨论，在右边查看和调整作品。');
      const studioLinks=element('div','',heading);studioLinks.className='cd-actions';
      element('a','剧本与分镜',studioLinks).href='#/scripts/'+id;
      element('a','制作素材',studioLinks).href='#/media-tools/'+id;
      element('a','画面与声音',studioLinks).href='#/timeline/'+id;
      const back=button(heading,'全部作品',()=>{location.hash='/projects';});StudioUI.labelIcon(back,'back');
      const context=element('details','',page);context.className='project-context';
      element('summary','项目资料、偏好与历史版本',context);
      const contextGrid=element('div','',context);contextGrid.className='project-context-grid';
      projectVersions(project, contextGrid);
      projectReferences(project, contextGrid);
      projectKnowledge(project, contextGrid);
      if (project.legacySource) {
        const source = project.legacySource.source;
        element('p', '来自旧工程「' + source.projectId + '」第 ' + source.revision + ' 版的制作副本');
        element('a', '查看来源旧工程', page).href = '#/legacy/' + encodeURIComponent(source.projectId) + '?source=' + encodeURIComponent(source.key);
      }
      const idea = state.ideas.find((item) => item.id === project.idea_id);
      if (idea) element('p', '来自灵感 · ' + idea.text,context);
      const layout = element('div', '');
      layout.className = 'project-layout';
      const focusDirector = projectDirector(project, layout);
      const workspace = element('div', '', layout);
      workspace.className = 'project-work';
      workspace.hidden=true;
      const opening=element('p','正在打开项目成果…',layout);opening.setAttribute('role','status');
      await projectMedia(project, workspace, focusDirector, idea?.text);
      if (location.hash !== requested || !workspace.isConnected) return;
      setupProjectLayout(project,layout,workspace,options.get('section'));
      workspace.hidden=false;opening.remove();layout.dataset.layoutReady='true';
      const restoredShot=focusDirector.currentShot?.();
      if(restoredShot)layout.dispatchEvent(new CustomEvent('cutdirector-focus-shot',{detail:restoredShot}));
      const section = options.get('section');
      if (['story','image-generation','generation','arrangement','delivery','media-intake','reference','workflow','quality','batches'].includes(section)) {
        const target = workspace.querySelector('[data-workbench-section="' + section + '"]');
        locateWorkbench(target);
      }
    } else {
      StudioUI.heading(page,'我的作品','每一条视频，从想法到成片都在这里。',row=>{
        const actions=element('div','',row);actions.className='actions';
        button(actions,'导入视频制作',()=>newProjectDialog('footage'));
        StudioUI.labelIcon(button(actions,'新建作品',()=>newProjectDialog('idea'),true),'plus');
      });
      listProjects();
      element('a','找回以前的剪辑工程',page).href='#/legacy';
    }
  } else {
    homePage();
  }
}

async function boot() {
  try {
    state = await api('bootstrap');
    // Preview limitations remain available under Settings → About, without occupying the creation toolbar.
    routeView = openView('global',error=>{notice.textContent=viewError(error);});
    const previous = await routeView.ready.catch(()=>null);
    if(!location.hash && previous?.route)location.hash=previous.route;
    else {await render();StudioUI.reveal(page);}
  } catch (error) {
    page.replaceChildren();
    element('p', describe(error));
    button(page, '重试', boot);
  }
}

window.addEventListener('hashchange', () => {
  routeView?.write({route:location.hash});
  navigationTransition?.skipTransition();
  const update=async()=>{window.scrollTo({top:0,left:0,behavior:'instant'});await render();page.focus({preventScroll:true});};
  if(document.startViewTransition&&!StudioUI.reduced()){
    navigationTransition=document.startViewTransition(update);
    navigationTransition.finished.catch(()=>{});
  }else {update().then(()=>StudioUI.reveal(page)).catch(error=>{notice.textContent=describe(error);});}
});
StudioUI.setup();
boot();
async function refreshTaskBadge() {
  try {
    const counts=await api('task-summary');
    const total=counts.waiting+counts.active+counts.attention;
    const link=document.querySelector('nav a[href="#/tasks"]');
    if(link){link.textContent='任务';if(total){const badge=element('span',String(total),link);badge.className='task-count';}}
  }catch{ /* The task page retains its explicit retry action. */ }
}
refreshTaskBadge();
setInterval(()=>{if(!document.hidden)refreshTaskBadge();},15000);
