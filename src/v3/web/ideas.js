'use strict';

function beginIdeaProject(idea) { newProjectDialog('idea',idea); }

async function ideasPage(id, options = new URLSearchParams()) {
  const region = element('section', '');
  const status = element('p', '正在读取灵感…', region);
  status.setAttribute('role', 'status');
  try {
    if (id) {
      const idea = await api('ideas/' + id);
      if (!region.isConnected) return;
      status.textContent = '';
      region.className='idea-detail';
      const heading=element('div','',region);heading.className='idea-detail-header';
      StudioUI.labelIcon(button(heading,'返回灵感库',()=>{location.hash='/ideas';}),'back');
      element('h1','把想法展开',heading);
      button(heading,'开始做视频',()=>beginIdeaProject(idea),true);
      const layout=element('div','',region);layout.className='idea-detail-layout';
      layout.dataset.ideaTab=options.get('tab')==='chat'?'chat':'notes';
      const content=element('div','',layout);content.className='idea-detail-content';
      const tabs=element('div','',content);tabs.className='idea-content-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','灵感资料');
      const notes=element('div','',content),references=element('div','',content),production=element('div','',content);
      const panes=[['notes','想法与补充',notes],['references','图片与参考',references],['production','用于制作',production]];
      const tabButtons=new Map();
      function selectPane(id){for(const [key,,pane]of panes){pane.hidden=key!==id;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','idea-tab-'+key);pane.id='idea-pane-'+key;}
        for(const [key,b]of tabButtons){b.setAttribute('aria-selected',String(key===id));b.tabIndex=key===id?0:-1;}
        StudioUI.reveal(panes.find(p=>p[0]===id)[2]);
      }
      panes.forEach(([id,label],index)=>{const b=button(tabs,label,()=>selectPane(id));b.id='idea-tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-controls','idea-pane-'+id);tabButtons.set(id,b);
        b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?panes.length-1:(index+(e.key==='ArrowRight'?1:-1)+panes.length)%panes.length;selectPane(panes[next][0]);tabButtons.get(panes[next][0]).focus();});
      });
      selectPane('notes');
      const original = element('article', '', notes);
      original.className = 'card idea-original';
      original.style.viewTransitionName='idea-detail';
      element('h2', '原始记录', original);
      element('p', idea.text, original);
      element('small', new Date(idea.created_at).toLocaleString(), original);
      if (idea.url) {
        const source = element('a', '打开原始出处', original);
        source.href = idea.url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
      }
      const form = element('form', '', notes);
      form.className='idea-note-form';
      const note = element('textarea', '', element('label', '补充想法（原记录会保留）', form));
      note.value = idea.note;
      note.maxLength = 2000;
      const tags = element('input', '', element('label', '标签，用逗号分隔', form));
      tags.value = idea.tags.join('，');
      const pinned = element('input', '', element('label', '置顶这条灵感', form));
      pinned.type = 'checkbox';
      pinned.checked = idea.pinned;
      const save = element('button', '保存补充', form);
      const draft=openView('idea:'+idea.id,error=>{if(region.isConnected)status.textContent=viewError(error);});
      let touched=false;
      const saveDraft=()=>draft.write({baseVersion:idea.version,note:note.value,tags:tags.value,pinned:pinned.checked});
      draft.ready.then(value=>{
        if(!region.isConnected||touched||!value)return;
        if(value.baseVersion===idea.version){note.value=value.note;tags.value=value.tags;pinned.checked=value.pinned;}
        else {status.textContent='灵感已有新补充，上次输入仍保留。';button(form,'下载上次输入',()=>downloadLocalDraft('灵感补充',value));}
      }).catch(()=>{});
      form.addEventListener('input',()=>{touched=true;saveDraft();});
      let attempt;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (save.disabled) return;
        const input = { expectedVersion: idea.version, note: note.value,
          tags: tags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), pinned: pinned.checked };
        const signature = JSON.stringify(input);
        if (attempt?.signature !== signature) attempt = { signature, id: crypto.randomUUID() };
        save.disabled = true;
        try {
          const updated = await api('ideas/' + idea.id, { ...input, commandId: attempt.id });
          Object.assign(idea,updated);note.value=updated.note;tags.value=updated.tags.join('，');pinned.checked=updated.pinned;
          saveDraft();
          attempt = undefined;
          if (region.isConnected) status.textContent = '补充已保存，原始记录保留。';
        } catch (error) {
          if (region.isConnected) status.textContent = error.message === 'IDEA_CONFLICT'
            ? '这条灵感已有新的补充，当前输入保留。请先复制后重新打开。' : describe(error);
        } finally { save.disabled = false; }
      });
      const discussion=ideaDiscussion(idea,layout,updated=>{idea.version=updated.version;idea.note=updated.note;note.value=updated.note;saveDraft();},()=>note.value!==idea.note||tags.value!==idea.tags.join('，')||pinned.checked!==idea.pinned);
      layout.prepend(discussion);
      ideaSources(idea,references);
      ideaAttachments(idea,references);
      const projects = element('section', '', production);
      element('h2', '从这里继续制作', projects);
      for (const project of idea.projects) {
        element('a', '继续「' + project.title + '」', projects).href = '#/projects/' + project.id;
      }
      button(projects, idea.projects.length ? '另做一个新项目' : '开始做视频', () => beginIdeaProject(idea), true);
      if (state.projects.length) {
        const projectChoice = element('select', '', element('label', '加到已有项目', projects));
        for (const project of state.projects) element('option', project.title, projectChoice).value = project.id;
        const mode = element('select', '', element('label', '在项目中怎么用', projects));
        element('option', '只作参考', mode).value = 'reference';
        element('option', '可用于视频内容', mode).value = 'use';
        const attach = button(projects, '确认引用这条灵感', async () => {
          attach.disabled = true;
          try {
            const projectId = projectChoice.value;
            const references = await api('projects/' + projectId + '/references?all=true');
            const previous = references.find(link => link.idea_id === idea.id);
            await api('projects/' + projectId + '/references', {
              commandId: crypto.randomUUID(), ideaId: idea.id, sourceVersion: idea.version,
              expectedVersion: previous?.revision || 0, mode: mode.value,
            });
            if (region.isConnected) status.textContent = '已引用到项目。资料外发或生成还会另行确认。';
          } catch (error) {
            if (region.isConnected) status.textContent = ['IDEA_CONFLICT', 'IDEA_LINK_CONFLICT'].includes(error.message)
              ? '灵感或项目引用已有更新，请重新读取后确认。' : describe(error);
          } finally { attach.disabled = false; }
        });
      }
      element('h2', '相关灵感', production);
      element('p', '从已记录的想法中，找到相关的线索。', production);
      for (const item of idea.related) {
        const card = element('article', '', production);
        card.className = 'card';
        element('p', item.text, card);
        element('a', '查看这条灵感', card).href = '#/ideas/' + item.id;
      }
      return;
    }
    status.remove();
    ideaWall(region,options);
  } catch (error) { if (region.isConnected) status.textContent = describe(error); }
}

function projectReferences(project, parent) {
  if (!project.references?.length) return;
  const box = element('details', '', parent);
  element('summary', '引用的灵感与出处', box);
  for (const link of project.references) {
    const card = element('article', '', box);
    card.className = 'card';
    element('p', link.snapshot.text, card);
    element('small', link.mode === 'use' ? '可用于视频内容' : '只作参考', card);
    if (link.snapshot.note) element('p', link.snapshot.note, card);
    element('a', '回到原始灵感', card).href = '#/ideas/' + link.idea_id;
    const remove = button(card, '撤回这条引用', async () => {
      remove.disabled = true;
      try {
        const current = await api('ideas/' + link.idea_id);
        await api('projects/' + project.id + '/references', { commandId: crypto.randomUUID(),
          ideaId: link.idea_id, sourceVersion: current.version, expectedVersion: link.revision, mode: 'disabled' });
        card.remove();
      } catch (error) { notice.textContent = describe(error); remove.disabled = false; }
    });
  }
}
