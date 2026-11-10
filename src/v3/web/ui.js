'use strict';

// Shared motion, iconography and interaction primitives for the embedded workbench.
const StudioUI = (() => {
  const paths = {
    spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z',
    close:'M6 6l12 12M18 6L6 18', plus:'M12 5v14M5 12h14',
    arrow:'M12 19V5M5 12l7-7 7 7',back:'M19 12H5M12 5l-7 7 7 7',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    link:'M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2',
    image:'M3 3h18v18H3zM3 16l5-5 5 5 4-4 4 4M16 7h.01',
    film:'M3 3h18v18H3zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4',
    check:'M5 12l4 4L19 6',down:'M6 9l6 6 6-6',pin:'M9 3h6v6l4 4H5l4-4ZM12 13v8',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
    clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    focus:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8',
    sun:'M12 3v1M12 20v1M3 12h1M20 12h1M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    more:'M5 12h.01M12 12h.01M19 12h.01',upload:'M12 16V3M7 8l5-5 5 5M3 16v5h18v-5',
    folder:'M3 6V4h6l3 3h9v13H3Z',minus:'M5 12h14'
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  const activeMotions=new WeakMap();
  function icon(name) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');
    const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.spark);svg.append(p);return svg;
  }
  function labelIcon(control,name){control.prepend(icon(name));return control;}
  function iconButton(parent,name,label,action){
    const b=button(parent,'',action);b.className='icon-button';b.append(icon(name));b.setAttribute('aria-label',label);b.title=label;return b;
  }
  function animate(el,frames,options={}){
    if(!el||reduced()||!el.animate)return null;
    activeMotions.get(el)?.cancel();
    const animation=el.animate(frames,{duration:360,easing:ease,...options});activeMotions.set(el,animation);
    return animation;
  }
  function reveal(el,axis='y'){
    return animate(el,[{opacity:.35,transform:axis==='x'?'translateX(18px)':'translateY(12px)'},{opacity:1,transform:'none'}]);
  }
  function swap(el,work){
    const old=[...el.children].filter(n=>!n.hidden).map(n=>[n,n.getBoundingClientRect()]).filter(([,r])=>r.width&&r.height);
    work();
    for(const [n,before]of old){if(!n.isConnected||n.hidden)continue;const after=n.getBoundingClientRect();
      const dx=before.left-after.left,dy=before.top-after.top;
      if(dx||dy)animate(n,[{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'none'}],{duration:520});
    }
  }
  function dismiss(dialog){
    if(!dialog.open){dialog.remove();return;}
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.close();
  }
  function heading(parent,title,description,actions){
    const row=element('div','',parent);row.className='page-heading';
    const copy=element('div','',row);element('h1',title,copy);
    if(description)element('p',description,copy).className='muted';
    if(actions)actions(row);return row;
  }
  function empty(parent,title,description,name='spark'){
    const box=element('div','',parent);box.className='empty-state';box.append(icon(name));
    element('h2',title,box);element('p',description,box);return box;
  }
  function segmented(parent,items,current,choose,label){
    const row=element('div','',parent);row.className='segmented';row.setAttribute('role','group');row.setAttribute('aria-label',label);
    const marker=element('span','',row);marker.className='segment-marker';marker.setAttribute('aria-hidden','true');
    const controls=[];
    const update=value=>{controls.forEach(([v,b])=>b.setAttribute('aria-pressed',String(v===value)));
      const active=controls.find(([v])=>v===value)?.[1];if(!active)return;
      marker.style.width=active.offsetWidth+'px';marker.style.transform='translateX('+active.offsetLeft+'px)';};
    for(const [value,text,name]of items){const b=button(row,text,()=>{update(value);choose(value);});if(name)labelIcon(b,name);controls.push([value,b]);}
    requestAnimationFrame(()=>update(current));const ro=new ResizeObserver(()=>update(controls.find(([,b])=>b.getAttribute('aria-pressed')==='true')?.[0]||current));ro.observe(row);
    row._cleanup=()=>ro.disconnect();return row;
  }
  function chatMessage(parent,role,text){
    const article=element('article','',parent);article.className='chat-message '+(role==='user'?'is-user':'is-assistant');
    element('span',role==='user'?'你':'导演',article).className='message-author';
    element('p',text,article);return article;
  }
  function followBottom(list,work){
    const follow=list.scrollHeight-list.scrollTop-list.clientHeight<90;
    const top=list.scrollTop;work();
    if(follow)list.scrollTop=list.scrollHeight;else list.scrollTop=top;
  }
  function enterRoute(){
    const route=(location.hash.slice(2).split(/[/?]/)[0]||'home');
    document.body.dataset.route=route;
    page.getAnimations().forEach(a=>a.cancel());
    document.querySelectorAll('.shell-nav a').forEach(a=>{
      a.toggleAttribute('data-active',a.hash==='#/'+route);
    });
    if((['projects','ideas','scripts','media-tools','timeline'].includes(route))&&location.hash.split('?')[0].split('/').length>2){document.body.dataset.guide='closed';document.querySelector('#guide-panel').inert=true;document.querySelector('#guide-toggle').setAttribute('aria-expanded','false');}
    const marker=document.querySelector('.nav-marker'),active=document.querySelector('.shell-nav a[data-active]');
    if(marker&&active){marker.style.width=active.offsetWidth+'px';marker.style.transform='translateX('+active.offsetLeft+'px)';}
  }
  function composer(form,input,send){
    form.classList.add('chat-composer');input.placeholder='想怎么改，直接说…';
    input.rows=2;send.classList.add('send-button');send.textContent='';send.append(icon('arrow'));send.setAttribute('aria-label','发送消息');send.title='发送消息';
    const resize=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,144)+'px';};
    input.addEventListener('input',resize);
    const obs=new ResizeObserver(()=>{if(input.isConnected)resize();else obs.disconnect();});obs.observe(input);
  }
  function dock(panel){
    if(!panel)return;
    let raf=0,disposed=false;
    const update=()=>{raf=0;if(disposed||!panel.isConnected)return;
      if(matchMedia('(max-width:760px)').matches){panel.style.height='';panel.style.maxHeight='';return;}
      const available=Math.max(320,innerHeight-Math.max(88,panel.getBoundingClientRect().top)-20);
      panel.style.height=available+'px';panel.style.maxHeight=available+'px';
    };
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(update);};
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    const observer=new ResizeObserver(schedule);observer.observe(page);
    const removed=new MutationObserver(()=>{if(!panel.isConnected){disposed=true;observer.disconnect();removed.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);cancelAnimationFrame(raf);}});
    removed.observe(page,{childList:true});schedule();
  }
  function setup(){
    document.querySelectorAll('[data-icon]').forEach(el=>el.prepend(icon(el.dataset.icon)));
    const guide=document.querySelector('#guide-panel'),toggle=document.querySelector('#guide-toggle');
    const open=()=>{
      document.body.dataset.guide='open';toggle.setAttribute('aria-expanded','true');guide.inert=false;
      guide._assistantCleanup?.();guide.replaceChildren();mountAssistant(guide).catch(error=>{notice.textContent=describe(error);});
    };
    const close=()=>{document.body.dataset.guide='closed';toggle.setAttribute('aria-expanded','false');guide.inert=true;toggle.focus({preventScroll:true});};
    toggle.addEventListener('click',()=>document.body.dataset.guide==='open'?close():open());
    document.querySelector('#theme-toggle').addEventListener('click',()=>{
      const dark=document.documentElement.dataset.theme!=='dark'&&(document.documentElement.dataset.theme==='light'||!matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme=dark?'dark':'light';
      try{localStorage.setItem('cutdirector-ui-theme',dark?'dark':'light');}catch{}
    });
    try{const theme=localStorage.getItem('cutdirector-ui-theme');if(theme==='dark'||theme==='light')document.documentElement.dataset.theme=theme;}catch{}
    const toast=document.querySelector('#notice-region');
    const dismissNotice=iconButton(toast,'close','关闭提示',()=>{notice.textContent='';});
    dismissNotice.classList.add('toast-close');
    let noticeTimer;
    const updateNotice=()=>{
      clearTimeout(noticeTimer);
      const text=notice.textContent.trim();
      toast.classList.toggle('is-visible',!!text);toast.inert=!text;
      if(!text)return;
      const success=/已保存|已创建|已更新|已完成|已移除|已取消|已停止|已撤销|已记录|已加到|已引用|已确认|已连接|已恢复/.test(text)
        && !/未|失败|无法|出错|不一致|过期|冲突/.test(text);
      toast.dataset.tone=success?'success':'attention';
      if(success)noticeTimer=setTimeout(()=>{if(notice.textContent.trim()===text)notice.textContent='';},2800);
    };
    new MutationObserver(updateNotice).observe(notice,{childList:true,characterData:true,subtree:true});
    const setInputMode=mode=>{document.documentElement.dataset.inputMode=mode;};
    document.addEventListener('pointerdown',()=>setInputMode('pointer'),true);
    document.addEventListener('keydown',event=>{if(event.key==='Tab')setInputMode('keyboard');},true);
    setInputMode('pointer');
    // Native modal semantics are preserved; both opening and closing are animated.
    const show=HTMLDialogElement.prototype.showModal,closeModal=HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal=function(){
      show.call(this);this.setAttribute('data-dialog-open','');reveal(this);
    };
    HTMLDialogElement.prototype.close=function(value){
      if(this._closing||!this.open)return;this._closing=true;
      const finish=()=>{this._closing=false;this.removeAttribute('data-dialog-open');closeModal.call(this,value);};
      const a=animate(this,[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(12px) scale(.985)'}],{duration:160});
      if(a)a.finished.then(finish,finish);else finish();
    };
    document.addEventListener('cancel',event=>{const d=event.target;if(!(d instanceof HTMLDialogElement)||event.defaultPrevented||!d.open)return;
      event.preventDefault();d.close();
    });
    document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();page.focus();});
    new ResizeObserver(()=>{const marker=document.querySelector('.nav-marker'),active=document.querySelector('.shell-nav a[data-active]');if(marker&&active){marker.style.width=active.offsetWidth+'px';marker.style.transform='translateX('+active.offsetLeft+'px)';}}).observe(document.querySelector('.shell-nav'));
  }
  return {icon,iconButton,labelIcon,animate,reveal,swap,dismiss,heading,empty,segmented,chatMessage,followBottom,composer,enterRoute,setup,reduced,dock};
})();

function newProjectDialog(kind='idea',idea) {
  const trigger=document.activeElement;
  const dialog=element('dialog','',page);dialog.className='project-dialog';dialog.setAttribute('aria-label','新建作品');
  const close=StudioUI.iconButton(dialog,'close','取消新建作品',()=>dialog.close());close.classList.add('dialog-close');
  element('h1',kind==='footage'?'把素材剪成作品':'从一个想法开始',dialog);
  element('p',kind==='footage'?'先给作品起个名字，接下来就可以导入视频。':'写下主题，导演会陪你把它整理成镜头。',dialog);
  if(idea)element('p',idea.text,dialog);
  const form=projectForm(kind,idea,dialog);form.querySelector('h2')?.remove();
  form.querySelector('input').placeholder=kind==='footage'?'例如：周末旅行记录':'例如：一分钟介绍我的咖啡店';
  const submit=form.querySelector('button');submit.textContent='创建并开始';
  const saved=form.querySelector('input').getAttribute('aria-label');form.querySelector('input').setAttribute('aria-label',saved||'作品名称');
  dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
  dialog.showModal();form.querySelector('input').focus();
}
function settingsPage(options=new URLSearchParams()) {
  StudioUI.heading(page,'设置与工具','连接一次，之后在制作时直接选择。',row=>{
    StudioUI.labelIcon(button(row,'切换明暗外观',()=>document.querySelector('#theme-toggle').click()),'sun');
  });
  const layout=element('div','',page);layout.className='settings-layout';
  const nav=element('div','',layout);nav.className='settings-nav';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','设置分类');
  const panel=element('div','',layout);panel.className='settings-panel';
  const choices=[
    ['models','对话模型','chat',()=>{
      const section=element('section','',page);element('h2','使用 DSH 里已添加的模型',section);
      element('p','文字模型由 DSH 保管账号。添加好厂商后，回到作品对话里直接选，不用重复粘贴密钥。',section);
      button(section,'重新读取模型',()=>show('models'));connections();
    }],
    ['generation','图片与视频','image',()=>{mediaConnectionsPage();}],
    ['editor','连接剪映','film',()=>editorConnection()],
    ['methods','制作方法','spark',()=>skillLibrary()],
    ['tools','工具与能力','grid',()=>{toolHubPage();}],
    ['about','关于与旧工程','more',()=>{
      const section=element('section','',page);section.className='settings-about';element('h2','CUTDIRECTOR 视频制作',section);
      element('p','灵感、讨论、制作与交付，放在同一个工作台。',section);
      element('a','打开以前的剪辑工程',section).href='#/legacy';
      if(state.release?.tier==='personal-preview'){
        element('h3','个人试用版',section);
        element('p','以下真实效果仍待实测，界面不会把它们记作已通过。',section);
        for(const item of state.release.deferred)element('p',item.reason,section);
      }
      element('h3','界面参考与开源致谢',section);
      const a=element('a','自媒体工作台 · woniuniuniu/dsh-media-desk',section);a.href='https://github.com/woniuniuniu/dsh-media-desk';a.target='_blank';a.rel='noopener noreferrer';
      element('p','灵感墙、对话稿面及空间交互参考该 MIT 开源项目。第三方许可随插件保留。',section);
    }]
  ];
  const buttons=new Map();let active;
  function show(id){
    const choice=choices.find(c=>c[0]===id)||choices[0];active=choice[0];
    for(const [key,b]of buttons){b.setAttribute('aria-selected',String(key===active));b.tabIndex=key===active?0:-1;}
    panel.replaceChildren();panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','settings-tab-'+active);
    const before=new Set(page.children);choice[3]();
    for(const node of [...page.children])if(!before.has(node))panel.append(node);
    const route=new URL(location.hash.slice(1),'http://workbench.local');route.searchParams.set('tab',active);
    history.replaceState(null,'','#'+route.pathname+route.search);routeView?.write({route:location.hash});StudioUI.reveal(panel);
  }
  choices.forEach(([id,label,name],index)=>{
    const b=StudioUI.labelIcon(button(nav,label,()=>show(id)),name);b.id='settings-tab-'+id;b.setAttribute('role','tab');buttons.set(id,b);
    b.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
      let next=choices.findIndex(c=>c[0]===active);
      next=event.key==='Home'?0:event.key==='End'?choices.length-1:(next+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+choices.length)%choices.length;
      show(choices[next][0]);buttons.get(choices[next][0]).focus();
    });
  });
  show(options.get('tab'));
}
