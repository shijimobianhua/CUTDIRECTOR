'use strict';

function locateWorkbench(target) {
  if (!target) return;
  const workspace = target.closest('.project-work');
  if (workspace && target.dataset.workbenchSection) {
    workspace.dispatchEvent(new CustomEvent('cutdirector-open-section', {detail: target.dataset.workbenchSection}));
  }
  const layout = target.closest('.project-layout');
  if (layout) layout.dataset.panel = workspace ? 'project' : 'chat';
  target.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  target.focus({preventScroll: true});
}

function setupProjectLayout(project, layout, workspace, requestedSection) {
  layout.dataset.panel = 'project';
  const switcher = element('div', '', page);
  switcher.className = 'project-switcher';
  layout.before(switcher);
  const work = button(switcher, '项目成果', () => { layout.dataset.panel = 'project'; });
  const chat = button(switcher, '和导演对话', () => {
    layout.dataset.panel = 'chat';
    layout.querySelector('.director-panel textarea')?.focus();
  });
  const inspector = element('aside', '', layout);
  inspector.className = 'shot-inspector';
  const drawer = element('dialog', '', layout);
  drawer.setAttribute('aria-label','当前镜头详情');
  const back = button(inspector, '返回项目', () => drawer.close());
  back.className = 'inspector-close';
  let drawerTrigger;
  const details = element('div', '', inspector);
  element('h2', '当前镜头', details);
  element('p', '在分镜卡中选择「和导演改这一镜」，这里会显示它的已保存内容。', details);
  drawerTrigger=button(switcher, '查看当前镜头', () => {
    drawer.append(back,details);
    drawer.showModal();
    back.focus();
  });
  drawer.addEventListener('close',()=>{
    inspector.append(back,details);
    if(drawerTrigger.isConnected)drawerTrigger.focus();
  });

  const nav = element('div', '', workspace);
  nav.className = 'project-stages';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', '制作步骤');
  workspace.prepend(nav);
  const sections = [...workspace.querySelectorAll(':scope > section[data-workbench-section]')];
  const order=project.kind==='idea'?['story','reference','media-intake','image-generation','generation','quality','arrangement','delivery','batches','workflow']:['media-intake','reference','arrangement','quality','delivery','story','image-generation','generation','batches','workflow'];
  order.push('extensions');
  sections.sort((a,b)=>order.indexOf(a.dataset.workbenchSection)-order.indexOf(b.dataset.workbenchSection));
  const advanced=new Set(project.kind==='idea'?['batches','workflow','extensions','reference','media-intake','quality']:['batches','workflow','extensions','reference','story','image-generation','generation','quality']);
  const more=element('details','',nav);more.className='more-tools';
  const moreTitle=element('summary','更多制作工具',more);
  const moreOptions=element('div','',more);
  const titles = {
    extensions:'扩展制作', story: '写分镜', batches:'一批镜头', quality:'检查画面', reference:'找参考', 'media-intake': '已有素材', 'image-generation': '画分镜图',
    generation: '试拍视频', arrangement: '安排顺序', delivery: '交付成片', workflow: '制作步骤',
  };
  const buttons = new Map();
  let current = '';
  function select(sectionId, remember = true, keyboard = false) {
    if (!sections.some(section => section.dataset.workbenchSection === sectionId)) return;
    current = sectionId;
    more.open=keyboard&&advanced.has(sectionId);moreTitle.textContent=advanced.has(sectionId)?'更多 · '+titles[sectionId]:'更多制作工具';
    for (const section of sections) {
      const active = section.dataset.workbenchSection === sectionId;
      section.hidden = !active;
      section.setAttribute('role', 'tabpanel');
    }
    for (const [id, button] of buttons) {
      button.setAttribute('aria-selected', String(id === sectionId));
      button.tabIndex = id === sectionId ? 0 : -1;
    }
    layout.dataset.panel = 'project';
    const activeSection=sections.find(section=>section.dataset.workbenchSection===sectionId);
    activeSection?.dispatchEvent(new CustomEvent('cutdirector-activated'));
    StudioUI.reveal(activeSection);
    if (remember) {
      const address = new URL(location.hash.slice(1), 'http://workbench.local');
      address.searchParams.set('section', sectionId);
      window.history.replaceState(null, '', '#' + address.pathname + address.search);
      routeView?.write({route: location.hash});
    }
  }
  for (const section of sections) {
    const id = section.dataset.workbenchSection;
    section.id = 'work-section-' + id;
    const tab = button(advanced.has(id)?moreOptions:nav, titles[id] || '查看成果', () => {select(id);if(advanced.has(id))section.focus();});
    tab.id='work-tab-'+id;section.setAttribute('aria-labelledby',tab.id);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', section.id);
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const ids = [...buttons.keys()];
      let index = ids.indexOf(current);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = ids.length - 1;
      else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      select(ids[index],true,true);
      buttons.get(ids[index]).focus();
    });
    buttons.set(id, tab);
  }
  nav.append(more,drawerTrigger);
  StudioUI.dock(layout.querySelector('.director-panel'));
  workspace.addEventListener('cutdirector-open-section', event => select(event.detail));
  let focusSequence = 0;
  layout.addEventListener('cutdirector-focus-shot', async event => {
    const request = ++focusSequence;
    try {
      const saved = await api('projects/' + project.id + '/story');
      const shot = saved?.shots.find(shot => shot.id === event.detail.id);
      if (!shot || !layout.isConnected || request !== focusSequence) return;
      details.replaceChildren();
      element('h2', '镜头 ' + (saved.shots.indexOf(shot) + 1), details);
      element('p', shot.action, details);
      element('p', shot.durationUs / 1e6 + ' 秒 · 分镜第 ' + saved.version + ' 版', details);
      for (const [key, title] of [['startImageId', '开始图'], ['endImageId', '结束图']]) {
        element('h3', title, details);
        if (shot[key]) {
          const img = element('img', '', details);
          img.src = './v3/projects/' + project.id + '/images/' + shot[key] + '/content';
          img.alt = '这个镜头已选的' + title;
          img.className = 'generated-frame';
        } else element('p', '还没选图', details);
      }
      element('p', shot.assetId ? '已选视频，可在分镜区查看或更换。' : '还没选视频。', details);
      for (const [id, title] of [['story', '查看分镜'], ['image-generation', '准备图片'], ['generation', '准备视频']]) {
        button(details, title, () => {
          if(drawer.open)drawer.close();
          select(id);
          sections.find(section => section.dataset.workbenchSection === id)?.focus();
        });
      }
    } catch (error) { if (layout.isConnected) notice.textContent = describe(error); }
  });
  select(requestedSection || (project.kind === 'idea' ? 'story' : 'media-intake'), false);
  work.setAttribute('aria-label', '查看项目成果');
  chat.setAttribute('aria-label', '打开导演对话');
}
