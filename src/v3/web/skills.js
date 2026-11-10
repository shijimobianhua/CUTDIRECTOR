'use strict';

function skillProblem(error) {
  return ({
    SKILL_SOURCE_UNAVAILABLE:'DSH 里的这项方法暂时无法读取。可以换一项，或从本机文件导入。',
    SKILL_BAD_ZIP: '这个 ZIP 无法读取。请重新打包后再试。',
    SKILL_LIMIT: '文件数量、体积或压缩比例超出了限制。',
    SKILL_UNSAFE_PATH: '压缩包中有不安全的文件路径，无法导入。',
    SKILL_UNSAFE_ENTRY: '压缩包里包含链接、加密项或其他特殊文件。',
    SKILL_NESTED_ARCHIVE: '请先移除包内的其他压缩包。',
    SKILL_DUPLICATE_PATH: '包里存在重名文件，请保留一份。',
    SKILL_INVALID_TEXT: '制作方法和参考说明需要使用 UTF-8 文本。',
    SKILL_BAD_FRONTMATTER: 'SKILL.md 顶部的名称或说明格式不正确。',
    SKILL_BAD_NAME: '方法名请用小写字母、数字和连字符，目录名与方法名保持一致。',
    SKILL_MISSING_MAIN: '请选择包含一个 SKILL.md 的文件夹或 ZIP。',
    SKILL_MULTIPLE_ROOTS: '请每次只导入一个制作方法。',
    SKILL_BAD_MANIFEST: '制作方法清单不完整或格式不正确。',
    SKILL_PREVIEW_EXPIRED: '这次预览已过期，请重新选择文件。',
    SKILL_EXPORT_PRIVATE: '发现疑似密钥或本机路径，请清理后再导出。',
    SKILL_DISABLED: '这项制作方法已停用，请选择已启用的版本。',
  })[error.message] || describe(error);
}

function skillLibrary() {
  const section = element('section', '');
  element('h2', '制作方法', section);
  element('p', '把经常用的分镜写法、剪辑检查清单导入，在项目对话中选择使用。', section);
  const status = element('p', '正在读取…', section);
  status.setAttribute('role', 'status');
  const picker = element('div', '', section);
  const preview = element('div', '', section);
  const cards = element('div', '', section);
  cards.className = 'cards';
  let busy = false;

  async function perform(action) {
    if (busy) return;
    busy = true;
    const controls = [...section.querySelectorAll('button,input')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      await action();
    } catch (error) {
      if (section.isConnected) status.textContent = skillProblem(error);
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
    }
  }

  function filePicker(label, folder) {
    const wrapper = element('label', label, picker);
    const file = element('input', '', wrapper);
    file.type = 'file';
    if (folder) {
      file.webkitdirectory = true;
      file.multiple = true;
    } else file.accept = '.zip,.md';
    file.addEventListener('change', () => {
      const chosen = [...file.files];
      if (!chosen.length) return;
      perform(async () => {
        preview.replaceChildren();
        status.textContent = '正在检查文件…';
        if (chosen.length > 256 || (!folder && chosen[0].size > 10 * 1024 ** 2)) throw new Error('SKILL_LIMIT');
        const format = folder ? 'folder' : /\.zip$/i.test(chosen[0].name) ? 'zip' : 'text';
        let body = chosen[0];
        if (folder) {
          const entries = [];
          let size = 0;
          for (const entry of chosen) {
            const path = entry.webkitRelativePath || entry.name;
            const allowed = /(?:^|\/)(SKILL\.md|cutdirector\.skill\.json|LICEN[CS]E(?:\.(md|txt))?)$/i.test(path) ||
              /(?:^|\/)references\/.+\.(md|txt)$/i.test(path);
            const value = { path };
            if (allowed) {
              size += entry.size;
              if (entry.size > 1024 ** 2 || size > 4 * 1024 ** 2) throw new Error('SKILL_LIMIT');
              try {
                value.text = new TextDecoder('utf-8', { fatal: true }).decode(await entry.arrayBuffer());
              } catch {
                throw new Error('SKILL_INVALID_TEXT');
              }
            }
            entries.push(value);
          }
          body = JSON.stringify(entries);
        }
        const response = await fetch('./v3/skills/preview/' + format, {
          method: 'POST', headers: { 'X-Cutdirector-Session': session, 'Content-Type': 'application/octet-stream' }, body,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.code);
        if (!section.isConnected) return;
        status.textContent = '请核对内容，再确认导入。';
        showPreview(result.data);
      }).finally(() => { file.value = ''; });
    });
  }

  button(picker,'查看 DSH 里已有的方法',()=>perform(async()=>{
    const methods=await api('dsh-skills');preview.replaceChildren();
    if(!methods.length){status.textContent='当前 DSH 没有可导入的方法，仍可从文件或 ZIP 导入。';return;}
    for(const method of methods){const card=element('article','',preview);card.className='card';element('h3',method.name,card);element('p',method.description,card);
      button(card,'读取并预览这个方法',()=>perform(async()=>{const value=await api('dsh-skills/preview',{name:method.name,confirm:true});showPreview(value);}));
    }
    status.textContent='这里先列出用途。选择后才读取正文，确认导入时保存一个本机版本，不会运行其中脚本。';
  }));
  function fileList(parent, paths) {
    const list = element('ul', '', parent);
    for (const path of paths) element('li', path, list);
  }

  function showPreview(method) {
    preview.replaceChildren();
    const card = element('article', '', preview);
    card.className = 'card';
    element('h3', method.name, card);
    element('p', method.description, card);
    element('p', '许可证 ' + (method.license || '包内未声明'), card);
    if (method.manifest?.roles?.length) element('p', '声明的执行角色 ' + method.manifest.roles.join('、'), card);
    if (method.manifest?.capabilities?.length) element('p', '需要的能力 ' + method.manifest.capabilities.join('、'), card);
    if (method.manifest?.requestedPermissions?.length || method.declaredTools) {
      element('p', '包内的权限和工具声明仅供查看，导入时不会取得权限。', card);
    }
    element('p', '将导入的文件', card);
    fileList(card, method.files);
    if (method.ignored.length) {
      const details = element('details', '', card);
      element('summary', method.ignored.length + ' 个文件会忽略，包括脚本和非文本资源', details);
      fileList(details, method.ignored);
    }
    if (method.sensitive.length) element('p', '有文件包含疑似密钥或本机路径，不能发送给模型或导出。', card);
    if (method.duplicate) element('p', '这份内容已经导入。', card);
    else if (method.previousVersions.length) element('p', '确认后启用新版本，旧版本仍可恢复。', card);
    const body = element('details', '', card);
    element('summary', '查看方法内容', body);
    // The server may retain reference text, but the preview only shows the main instructions.
    element('pre', method.bodyPreview || '请在本机打开 SKILL.md 查看完整内容。', body);
    const install = button(card, '确认导入', () => perform(async () => {
      const saved = await api('skills/install', { id: method.id });
      if (!section.isConnected) return;
      preview.replaceChildren();
      status.textContent = '已导入「' + saved.name + '」。';
      await refresh();
    }), true);
    install.disabled = method.duplicate;
    button(card, '取消预览', () => { preview.replaceChildren(); status.textContent = ''; });
  }

  function showExport(method, data) {
    preview.replaceChildren();
    const card = element('article', '', preview);
    card.className = 'card';
    element('h3', '导出 ' + data.name, card);
    fileList(card, data.files);
    if (data.sensitive.length) {
      element('p', '以下文件可能含密钥或私有路径。请在原文件中清理后重新导入。', card);
      fileList(card, data.sensitive);
    }
    if (!data.sensitive.length) {
      const download = element('a', '确认下载 ZIP', card);
      download.href = './v3/skills/' + method.hash + '/download';
      download.download = data.name + '.zip';
      download.addEventListener('click', () => { status.textContent = '下载已请求，请查看浏览器下载。'; });
    }
    button(card, '取消导出', () => preview.replaceChildren());
  }

  async function refresh() {
    try {
      const methods = await api('skills');
      if (!section.isConnected) return;
      cards.replaceChildren();
      if (!methods.length) element('p', '还没有制作方法。可选择 SKILL.md、文件夹或 ZIP。', cards);
      for (const method of methods) {
        const row = element('article', '', cards);
        row.className = 'card';
        element('h3', method.name, row);
        element('p', method.description, row);
        element('p', (method.manifest?.version || method.hash.slice(0, 8)) + ' · ' +
          (method.enabled ? '已启用' : method.active ? '已停用' : '旧版本'), row);
        button(row, method.enabled ? '停用' : '启用此版本', () => perform(async () => {
          await api('skills/' + method.hash + (method.enabled ? '/disable' : '/enable'), {});
          status.textContent = method.enabled ? '已停用。' : '已启用选中版本。';
          await refresh();
        }));
        button(row, '导出预览', () => perform(async () => {
          const data = await api('skills/' + method.hash + '/export-info');
          if (section.isConnected) showExport(method, data);
        }));
      }
    } catch (error) {
      if (section.isConnected) status.textContent = skillProblem(error);
    }
  }

  filePicker('选择 SKILL.md 或 ZIP', false);
  filePicker('选择制作方法文件夹', true);
  status.textContent = '';
  refresh();
}

function methodChecklist(parent,role){
  const region=element('details','',parent);
  element('summary',role==='editor'?'交接前的检查方法（选填）':'按制作方法逐项检查（选填）',region);
  element('p','这是供你使用的检查清单，不会自动运行程序，也没有调用视觉模型。',region);
  const select=element('select','',element('label','选择已添加的方法',region));
  element('option','先不使用方法',select).value='';
  const output=element('div','',region);
  let request=0;
  api('skills').then(items=>{
    if(!region.isConnected)return;
    for(const item of items.filter(item=>item.enabled&&item.manifest?.roles?.includes(role)))element('option',item.name,select).value=item.hash;
  }).catch(()=>{});
  select.addEventListener('change',async()=>{
    const current=++request;output.replaceChildren();
    if(!select.value)return;
    try{
      const method=await api('skills/'+select.value+'/checklist?'+new URLSearchParams({role}));
      if(!region.isConnected||current!==request)return;
      element('pre',method.body,output);
      element('small',method.name+' · '+method.hash.slice(0,8)+' · 由你检查',output);
    }catch(error){if(region.isConnected&&current===request)element('p',skillProblem(error),output);}
  });
}