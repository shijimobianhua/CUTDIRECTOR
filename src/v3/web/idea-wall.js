'use strict';

// One ordered library. Existing records, attachments and conversation routes stay unchanged.
function openIdeaCard(idea,origin){
  if(origin)origin.style.viewTransitionName='idea-detail';
  location.hash='/ideas/'+idea.id;
}
function ideaWall(region,options=new URLSearchParams()){
  region.className='idea-library';
  StudioUI.heading(region,'灵感库','记下想法和参考，准备好时再和导演展开。');
  const capture=element('section','',region);capture.className='library-capture';
  const form=ideaForm(capture,async()=>{
    query.value='';options.delete('q');selectedFilter='all';rememberQuery();await load();
  });
  const text=form.querySelector('textarea');text.rows=2;text.placeholder='记一个想法，或者描述你想拍的视频…';
  const source=form.querySelector('input[type=url]');
  const sourceDetails=element('details','',form);sourceDetails.className='capture-source';
  element('summary','附上来源链接（选填）',sourceDetails);sourceDetails.append(source);
  const save=form.querySelector('button');save.textContent='保存灵感';StudioUI.labelIcon(save,'plus');

  const toolbar=element('div','',region);toolbar.className='library-toolbar';
  const filters=element('div','',toolbar);filters.className='library-filters';filters.setAttribute('role','group');filters.setAttribute('aria-label','灵感分类');
  const filterButtons=new Map();let selectedFilter='all';
  for(const [key,label]of [['all','全部'],['pinned','已置顶'],['links','有链接']]){
    const b=button(filters,label,()=>{selectedFilter=key;draw();});filterButtons.set(key,b);
  }
  const search=element('form','',toolbar);search.className='library-search';search.append(StudioUI.icon('search'));
  const query=element('input','',search);query.type='search';query.maxLength=200;query.value=options.get('q')||'';query.placeholder='搜索想法、标签…';query.setAttribute('aria-label','搜索灵感');
  const clear=StudioUI.iconButton(search,'close','清除搜索',()=>{query.value='';searchNow();query.focus({preventScroll:true});});
  clear.hidden=!query.value;
  const count=element('p','',region);count.className='library-count';count.setAttribute('role','status');
  const grid=element('div','',region);grid.className='idea-grid';
  const empty=element('div','',region);empty.className='empty-state';empty.hidden=true;
  const status=element('p','正在读取灵感…',region);status.className='library-status';status.setAttribute('role','status');
  const more=button(region,'查看更多灵感',()=>load(true));more.className='library-more';more.hidden=true;
  let rows=new Map(),cursor,request=0,busy=false,searchTimer;
  const nodes=new Map(),fileCache=new Map(),hydrated=new Set();
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);hydrate(entry.target);}
  },{rootMargin:'160px'});
  function rememberQuery(){
    const params=new URLSearchParams();if(query.value.trim())params.set('q',query.value.trim());
    const route='#/ideas'+(params.size?'?'+params:'');
    history.replaceState(null,'',route);routeView?.write({route});
  }
  function searchNow(){
    clearTimeout(searchTimer);query.value=query.value.slice(0,200);options.set('q',query.value.trim());
    clear.hidden=!query.value;rememberQuery();load();
  }
  query.addEventListener('input',event=>{clear.hidden=!query.value;clearTimeout(searchTimer);if(!event.isComposing)searchTimer=setTimeout(searchNow,220);});
  query.addEventListener('compositionend',searchNow);
  search.addEventListener('submit',event=>{event.preventDefault();searchNow();});
  async function hydrate(card){
    const id=card.dataset.ideaId;if(hydrated.has(id))return;hydrated.add(id);
    try{
      const files=fileCache.get(id)||await api('ideas/'+id+'/files');fileCache.set(id,files);
      if(!card.isConnected||!files.length)return;
      const image=files.find(file=>file.kind==='image');
      if(image){
        const img=document.createElement('img');img.className='idea-thumbnail';img.alt=image.name;img.loading='lazy';
        img.src='./v3/ideas/'+id+'/files/'+image.id+'/content';img.addEventListener('error',()=>img.remove(),{once:true});
        card.querySelector('.idea-open').prepend(img);
      }else card.querySelector('.idea-kind').textContent='视频参考';
    }catch{/* The source note remains available if an attachment cannot be read. */}
  }
  function makeCard(idea){
    const card=element('article','',grid);card.className='idea-tile';card.dataset.ideaId=idea.id;
    const open=button(card,'',()=>openIdeaCard(idea,card));open.className='idea-open';
    const kind=element('span',idea.pinned?'已置顶':idea.url?'参考链接':'随手记录',open);kind.className='idea-kind';
    if(idea.pinned)kind.prepend(StudioUI.icon('pin'));else if(idea.url)kind.prepend(StudioUI.icon('link'));
    element('p',idea.text,open).className='idea-title';
    if(idea.note)element('p',idea.note.slice(0,100),open).className='idea-excerpt';
    const foot=element('div','',open);foot.className='idea-meta';
    element('span',idea.tags?.length?idea.tags.slice(0,2).join(' · '):'待展开的想法',foot);
    element('time',new Date(idea.created_at).toLocaleDateString('zh-CN',{month:'short',day:'numeric'}),foot);
    observer.observe(card);return card;
  }
  function draw(){
    const items=[...rows.values()].filter(item=>selectedFilter==='all'||(selectedFilter==='pinned'?item.pinned:!!item.url));
    for(const [key,b]of filterButtons)b.setAttribute('aria-pressed',String(key===selectedFilter));
    StudioUI.swap(grid,()=>{
      const visible=new Set(items.map(item=>item.id));
      for(const [id,node]of nodes)node.hidden=!visible.has(id);
      for(const item of items){
        let card=nodes.get(item.id);
        if(!card){card=makeCard(item);nodes.set(item.id,card);StudioUI.reveal(card);}
        const wasHidden=card.hidden;card.hidden=false;grid.append(card);if(wasHidden)StudioUI.reveal(card);
      }
    });
    count.textContent=items.length?'显示 '+items.length+' 条'+(cursor?'，可继续加载':''):'';
    empty.hidden=!!items.length;
    if(!items.length){
      empty.replaceChildren();element('h2',query.value?'没有找到相关灵感':selectedFilter==='all'?'记下第一条灵感':'这里还没有这类灵感',empty);
      element('p',query.value?'换个关键词，或清除搜索查看全部。':'上面写一句话就能保存，图片和视频可以在灵感详情里补充。',empty);
      if(query.value||selectedFilter!=='all')button(empty,'查看全部灵感',()=>{query.value='';selectedFilter='all';searchNow();});
    }
    more.hidden=!cursor;
  }
  async function load(append=false){
    if(append&&busy)return;
    const version=++request;busy=true;more.disabled=true;grid.setAttribute('aria-busy','true');
    status.textContent=nodes.size?'':'正在读取灵感…';
    try{
      const data=await api('ideas?'+new URLSearchParams({q:options.get('q')||'',...(append&&cursor?{cursor}:{})}));
      if(!region.isConnected||version!==request)return;
      if(!append){for(const node of nodes.values())node.remove();nodes.clear();hydrated.clear();rows.clear();}
      data.items.forEach(item=>rows.set(item.id,item));cursor=data.nextCursor;status.textContent='';draw();
    }catch(error){
      if(region.isConnected&&version===request){status.textContent=describe(error);more.hidden=false;more.textContent='重新读取灵感';}
    }finally{if(version===request){busy=false;more.disabled=false;grid.removeAttribute('aria-busy');}}
  }
  const cleanup=new MutationObserver(()=>{
    if(!region.isConnected){observer.disconnect();cleanup.disconnect();clearTimeout(searchTimer);request++;}
  });cleanup.observe(page,{childList:true});
  load();
}

function homePage(){
  const home=element('div','');home.className='home-dashboard';
  StudioUI.heading(home,'创作工作台','开始一条视频，或接着完成你的作品。');
  const layout=element('div','',home);layout.className='home-layout';
  const main=element('div','',layout);main.className='home-main';
  const start=element('section','',main);start.className='home-start';
  element('h2','开始新的作品',start);element('p','有素材就导入，只有一个想法也可以开始。',start);
  const actions=element('div','',start);actions.className='actions';
  StudioUI.labelIcon(button(actions,'用已有视频制作',()=>newProjectDialog('footage'),true),'film');
  StudioUI.labelIcon(button(actions,'从想法开始制作',()=>newProjectDialog('idea')),'spark');
  const recent=element('section','',main);recent.className='home-recent';
  const heading=element('div','',recent);heading.className='section-heading';element('h2','继续制作',heading);
  element('a','全部作品',heading).href='#/projects';
  if(state.projects.length){
    const list=element('div','',recent);list.className='home-project-list';
    for(const project of state.projects.slice(0,5)){
      const a=element('a','',list);a.className='home-project-row';a.href='#/projects/'+project.id;a.append(StudioUI.icon('film'));
      const copy=element('span','',a);element('strong',project.title,copy);
      element('small',project.kind==='idea'?'从想法开始':'使用已有素材',copy);
      element('span','继续制作',a).className='project-row-action';
    }
  }else{
    const box=StudioUI.empty(recent,'第一条作品，从这里开始','选择上方的制作方式，过程和结果都会保存在这里。','film');
    button(box,'先试一个练习项目',practiceProject);
  }
  const side=element('aside','',layout);side.className='home-side';
  const tasks=element('section','',side);tasks.className='home-side-section';
  element('h2','接下来做什么',tasks);
  const taskStatus=element('p','正在读取待办…',tasks);
  const taskLink=element('a','查看制作任务',tasks);taskLink.href='#/tasks';
  api('task-summary').then(counts=>{
    if(!taskStatus.isConnected)return;
    const pending=counts.waiting+counts.attention;
    taskStatus.textContent=pending?'有 '+pending+' 项需要你确认或检查。':counts.active?'有 '+counts.active+' 项正在处理，可以继续制作其他内容。':'目前没有待办，可以开始新的作品。';
  }).catch(()=>{if(taskStatus.isConnected)taskStatus.textContent='到任务页查看最新进度。';});
  const inspiration=element('section','',side);inspiration.className='home-side-section';
  element('h2','最近的灵感',inspiration);
  if(state.ideas.length){
    const links=element('div','',inspiration);links.className='home-idea-links';
    for(const idea of state.ideas.slice(0,3))element('a',idea.text,links).href='#/ideas/'+idea.id;
  }else element('p','还没准备好开工？先去记下一个想法。',inspiration);
  element('a','打开灵感库',inspiration).href='#/ideas';
  const models=element('section','',side);models.className='home-side-section';
  element('h2','制作准备',models);
  const modelStatus=element('p','正在检查对话模型…',models);
  element('a','设置模型与制作工具',models).href='#/settings';
  api('connections').then(entries=>{
    if(modelStatus.isConnected)modelStatus.textContent=entries.length?'已有可选对话模型，进入作品后即可选择。':'可以先整理素材，想和模型讨论时再连接账号。';
  }).catch(()=>{if(modelStatus.isConnected)modelStatus.textContent='模型和工具可以在设置里查看。';});
  const footer=element('div','',home);footer.className='home-footer';
  element('a','找回以前的剪辑工程',footer).href='#/legacy';
}
