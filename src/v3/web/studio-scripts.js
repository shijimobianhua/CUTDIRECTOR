'use strict';
const scriptDrafts=new Map();
async function scriptsPage(projectId,options=new URLSearchParams()){
 if(!projectId){
  StudioUI.heading(page,'剧本','故事、角色与分镜，按作品放在一起。',head=>button(head,'新建剧本',()=>createScriptProjectDialog('full'),true));
  const starts=CDStudio.actions(page);starts.classList.add('cd-start-paths');button(starts,'第一次做：先试 10 秒',()=>createScriptProjectDialog('beginner'),true);button(starts,'创作完整一集',()=>createScriptProjectDialog('full'));
  const root=element('div','',page);root.className='cd-script-library';const status=element('p','正在读取剧本…',root);
  try{const rows=await CDStudio.request('index');if(!root.isConnected)return;status.remove();if(!rows.length)StudioUI.empty(root,'从一个故事开始','新建作品后，可以自己写，也可以导入小说或剧本。','film');for(const p of rows){const card=element('article','',root);card.className='cd-library-card';const title=element('a',p.title,card);title.href='#/scripts/'+p.id;element('p',p.episodes.length+' 集 · 每集的剧本与分镜分别保存',card);for(const ep of p.episodes.slice(0,3))element('a',ep.title,card).href='#/scripts/'+p.id+'?episode='+ep.id;}}
  catch(e){CDStudio.error(status,e);}return;
 }
 const root=element('div','',page);root.className='cd-script-space';let data=await CDStudio.request('projects/'+projectId);if(!root.isConnected)return;
 const project=data.project;let episodeId=options.get('episode'),activeTab=options.get('tab')||'script',sceneId=options.get('scene'),dirty=false,saving=false,pendingSave=Promise.resolve(),saveTimer,draftView,episode,draft,epoch=0;
 const heading=StudioUI.heading(root,project.title,'剧本、分镜和素材都在这个作品里。',head=>{const a=element('a','返回作品',head);a.href='#/projects/'+projectId;});
 const saveState=element('span','',heading);saveState.className='cd-save-state';saveState.setAttribute('role','status');
 const controls=CDStudio.actions(root);const episodeSelect=CDStudio.select(controls,'当前一集',[]),newEpisode=button(controls,'添加一集',async()=>{await flush();const old=data.documents.filter(d=>d.kind==='episode');const ep=await CDStudio.save(projectId,'episode',{title:'第 '+(old.length+1)+' 集',order:old.length+1,ratio:'9:16',durationUs:300000000,brief:'',style:'',scenes:[]});episodeId=ep.id;await reload();});
 button(controls,'导入小说或剧本',()=>importDialog());button(controls,'历史版本',()=>CDStudio.history(projectId,episode,root,reload));button(controls,'导出剧本',()=>CDStudio.download(project.title+'-'+episode.title+'.md',toMarkdown(draft),'text/markdown'));
 const guide=element('details','',root);guide.className='cd-workflow-guide';element('summary','短剧制作路线 · 从剧本到成片',guide);const steps=element('ol','',guide);for(const text of ['先确定故事和台词：角色说话、心里想的和画外音分别标清。','固定角色、场景和道具：选好概念图，记下统一画风、光线和声音。','拆分镜并规划素材段落：一段生成可以覆盖多个镜头。','先做 5 秒小样：检查脸、声音和口型，再制作其他片段。','优先修剪或补拍问题片段，挑选满意版本。','安排对白、反应画面与配乐，交给剪映继续精修。'])element('li',text,steps);const guideActions=CDStudio.actions(guide);button(guideActions,'请导演写制作要求',async()=>{await flush();scriptDirectorDialog(project,episode,'prompts',reload);});element('a','进入图片与视频制作',guideActions).href='#/media-tools/'+projectId+'?episode='+(episodeId||'');element('a','安排画面与声音',guideActions).href='#/timeline/'+projectId;
 const nav=element('div','',root);nav.className='cd-work-tabs';nav.setAttribute('aria-label','剧本工作区');
 const content=element('div','',root);content.className='cd-script-content';let canvasDispose;
 const status=element('p','',root);status.setAttribute('role','status');
 function route(){const mediaLink=guide.querySelector('a');if(mediaLink)mediaLink.href='#/media-tools/'+projectId+'?episode='+episodeId;const q=new URLSearchParams({episode:episodeId,tab:activeTab});history.replaceState(null,'','#/scripts/'+projectId+'?'+q);routeView?.write({route:location.hash});}
 function updateList(){episodeSelect.replaceChildren();for(const e of data.documents.filter(d=>d.kind==='episode').sort((a,b)=>(a.order||0)-(b.order||0))){const o=element('option',e.title,episodeSelect);o.value=e.id;}episodeSelect.value=episodeId;}
 async function choose(){
  episode=data.documents.find(d=>d.kind==='episode'&&d.id===episodeId)||data.documents.find(d=>d.kind==='episode');episodeId=episode.id;draft=structuredClone(scriptDrafts.get(episodeId)||CDStudio.clean(episode));
  draftView=openView('studio-draft:'+episodeId,e=>{CDStudio.error(status,e);});
  try{const saved=await draftView.ready;if(saved?.draft){if(saved.baseVersion===episode.version){draft=saved.draft;dirty=true;}else{status.textContent='发现一份未合并的输入。可以导出，再与当前版本比较。';button(status,'导出未合并草稿',()=>CDStudio.download('未合并剧本.json',saved));}}}catch(e){CDStudio.error(status,e);}
  sceneId=draft.scenes.find(s=>s.id===sceneId)?.id||draft.scenes[0]?.id;updateList();route();draw();
 }
 episodeSelect.addEventListener('change',async()=>{await flush();episodeId=episodeSelect.value;await choose();});
 async function flush(){
  clearTimeout(saveTimer);if(!dirty)return pendingSave;
  const value=structuredClone(draft),target=episode,id=episodeId,revision=epoch;
  const work=pendingSave.catch(()=>{}).then(async()=>{
   saving=true;saveState.textContent='正在保存…';
   try{await draftView.write({baseVersion:target.version,draft:value});const current=data.documents.find(d=>d.id===id)||target;
    const saved=await CDStudio.save(projectId,'episode',value,current);data.documents=data.documents.map(d=>d.id===id?saved:d);
    if(episodeId===id){episode=saved;if(epoch===revision){dirty=false;scriptDrafts.delete(id);await draftView.write({baseVersion:saved.version,draft:null});saveState.textContent='';}else saveState.textContent='正在保存后续修改…';}return saved;
   }catch(e){saveState.textContent='尚未保存';CDStudio.error(status,e);throw e;}finally{saving=false;}
  });pendingSave=work;return work;
 }
 function changed(){dirty=true;epoch++;scriptDrafts.set(episodeId,structuredClone(draft));saveState.textContent='正在记录…';clearTimeout(saveTimer);const view=draftView,value=structuredClone(draft),baseVersion=episode.version;view.write({baseVersion,draft:value}).catch(e=>CDStudio.error(status,e));saveTimer=setTimeout(()=>flush().catch(()=>{}),850);}
 async function reload(){await flush().catch(()=>{});data=await CDStudio.request('projects/'+projectId);if(root.isConnected)await choose();}
 function draw(){
  canvasDispose?.();canvasDispose=null;nav.replaceChildren();content.replaceChildren();
  for(const [key,label]of [['script','写剧本'],['board','分镜'],['assets','角色与场景'],['canvas','关系画布'],['sources','原文资料']]){const b=button(nav,label,async()=>{await flush();activeTab=key;route();draw();});b.setAttribute('aria-pressed',String(activeTab===key));}
  if(activeTab==='script')drawScript();else if(activeTab==='board')drawBoard();else if(activeTab==='assets')drawAssets();else if(activeTab==='canvas')canvasDispose=mountStudioCanvas(content,project,data,episodeId,reload);else drawSources();
  StudioUI.reveal(content);
 }
 function drawScript(){
  const layout=element('div','',content);layout.className='cd-script-editor';
  const outline=element('aside','',layout);outline.className='cd-script-outline';element('h2','场景目录',outline);
  for(const scene of draft.scenes){const b=button(outline,scene.title,()=>{sceneId=scene.id;draw();});b.setAttribute('aria-current',scene.id===sceneId?'true':'false');}
  button(outline,'添加场景',()=>{const s={id:crypto.randomUUID(),title:'场景 '+(draft.scenes.length+1),blocks:[{id:crypto.randomUUID(),type:'action',speaker:'',text:''}]};draft.scenes.push(s);sceneId=s.id;changed();draw();});
  const writing=element('div','',layout);writing.className='cd-script-writing';
  const metadata=element('details','',writing);element('summary','这一集的方向与时长',metadata);
  const title=CDStudio.field(metadata,'分集名称',draft.title),brief=CDStudio.field(metadata,'这一集讲什么',draft.brief||'','textarea'),style=CDStudio.field(metadata,'统一画风',draft.style||'');
  const settings=CDStudio.actions(metadata),ratio=CDStudio.select(settings,'画面比例',[['9:16','竖屏'],['16:9','横屏'],['1:1','方形']],draft.ratio),duration=CDStudio.field(settings,'目标时长（秒）',draft.durationUs/1e6,'number');duration.min='1';duration.max='1500';
  for(const el of [title,brief,style,ratio,duration])el.addEventListener('input',()=>{draft.title=title.value;draft.brief=brief.value;draft.style=style.value;draft.ratio=ratio.value;draft.durationUs=Math.round(Number(duration.value)*1e6);changed();});
  const scene=draft.scenes.find(s=>s.id===sceneId);
  if(!scene){const empty=StudioUI.empty(writing,'写下第一个场景','可以从一段动作、一句对白开始，也可以先导入已有文字。','film');button(empty,'添加第一个场景',()=>outline.querySelector('button')?.click(),true);}
  else{
   const top=CDStudio.actions(writing),name=CDStudio.field(top,'当前场景',scene.title);name.addEventListener('input',()=>{scene.title=name.value;changed();});
   button(top,'上移场景',()=>{const i=draft.scenes.indexOf(scene);if(i>0){[draft.scenes[i-1],draft.scenes[i]]=[draft.scenes[i],draft.scenes[i-1]];changed();draw();}});
   button(top,'移除场景',()=>{const d=element('dialog','',root);element('h2','移除这个场景？',d);element('p','移除后会保存新版本，可以从历史恢复。',d);button(d,'保留',()=>StudioUI.dismiss(d));button(d,'确认移除',()=>{draft.scenes=draft.scenes.filter(s=>s.id!==scene.id);sceneId=draft.scenes[0]?.id;changed();StudioUI.dismiss(d);draw();});d.showModal();});
   const blocks=element('div','',writing);blocks.className='cd-script-blocks';
   for(const [i,block]of scene.blocks.entries()){
    const row=element('div','',blocks);row.className='cd-script-block';row.dataset.blockId=block.id;const meta=CDStudio.actions(row);
    const type=CDStudio.select(meta,'内容类型',[['action','动作'],['dialogue','对白'],['narration','旁白 / 画外音'],['inner','内心独白'],['sound','音效']],block.type);
    const speaker=CDStudio.field(meta,'说话的人',block.speaker||'');speaker.hidden=!['dialogue','inner','narration'].includes(block.type);speaker.parentElement.hidden=speaker.hidden;
    const words=CDStudio.field(row,'内容',block.text,'textarea');words.rows=Math.max(2,Math.min(12,block.text.split('\n').length+1));words.maxLength=12000;
    type.addEventListener('change',()=>{block.type=type.value;speaker.parentElement.hidden=!['dialogue','inner','narration'].includes(block.type);changed();});speaker.addEventListener('input',()=>{block.speaker=speaker.value;changed();});words.addEventListener('input',()=>{block.text=words.value;changed();});
    const buttons=CDStudio.actions(row);button(buttons,'上移',()=>{if(i){[scene.blocks[i-1],scene.blocks[i]]=[scene.blocks[i],scene.blocks[i-1]];changed();draw();}});
    button(buttons,'删除这段',()=>{scene.blocks.splice(i,1);changed();draw();});
   }
   const add=CDStudio.actions(writing);for(const [type,label]of [['action','加动作'],['dialogue','加对白'],['inner','加内心独白'],['sound','加音效']])button(add,label,()=>{scene.blocks.push({id:crypto.randomUUID(),type,speaker:'',text:''});changed();draw();});
  }
  const related=element('aside','',layout);related.className='cd-script-related';element('h2','与这一场有关',related);
  const shots=data.documents.filter(d=>d.kind==='shot'&&d.episodeId===episodeId&&(!sceneId||d.sceneId===sceneId));for(const shot of shots.slice(0,12)){const b=button(related,shot.title,()=>editShot(shot));element('small',shot.action.slice(0,70),b);}
  if(!shots.length)element('p','还没有关联分镜。剧本写好后，可以请导演拆镜头。',related);
  button(related,'请导演帮我完善',async()=>{await flush();scriptDirectorDialog(project,episode,'script',reload);},true);
  button(related,'从剧本拆分镜',async()=>{await flush();scriptDirectorDialog(project,episode,'storyboard',reload);});
  button(related,'立即保存',()=>flush().catch(()=>{}));
  button(related,'导出当前输入',()=>CDStudio.download('当前剧本输入.json',draft));
  const guide=element('p','动作写画面里能看到的事；心里的话可以单独标成内心独白。',related);guide.className='muted';
 }
 function drawBoard(){
  const top=CDStudio.actions(content);element('h2',episode.title+' · 分镜',top);button(top,'添加镜头',()=>editShot());button(top,'导演拆镜',()=>scriptDirectorDialog(project,episode,'storyboard',reload));
  button(top,'用于图片、试拍与交付',async()=>{try{const current=await api('projects/'+projectId+'/story');await CDStudio.request('projects/'+projectId+'/documents/'+episodeId+'/publish',{expectedVersion:episode.version,storyVersion:current?.version||0,commandId:crypto.randomUUID()});notice.textContent='这一集的分镜已用于制作。';location.hash='/projects/'+projectId+'?section=story';}catch(e){CDStudio.error(status,e);}},true);
  button(top,'生成片段',()=>{location.hash='/media-tools/'+projectId+'?episode='+episodeId;});
  const shots=data.documents.filter(d=>d.kind==='shot'&&d.episodeId===episodeId).sort((a,b)=>(a.order||0)-(b.order||0));
  const view=CDStudio.select(top,'排列方式',[['cards','镜头卡片'],['table','分镜表']],'cards'),grid=element('div','',content);
  function renderShots(){grid.replaceChildren();grid.className=view.value==='cards'?'cd-shot-grid':'cd-shot-table';
   if(!shots.length)StudioUI.empty(grid,'把故事变成镜头','可以自己添加镜头，或让导演先给一份建议。','film');
   const shown=shots.slice(0,Number(grid.dataset.limit||60));
   for(const [i,s]of shown.entries()){const card=element('article','',grid);card.className='cd-shot-card';element('small','镜头 '+(i+1)+' · '+(s.durationUs/1e6)+' 秒',card);element('h3',s.title,card);
    if(s.startImageId){const img=element('img','',card);img.src='./v3/projects/'+projectId+'/images/'+s.startImageId+'/content';img.alt=s.title+'的已选画面';img.loading='lazy';}
    element('p',s.action,card);if(s.scriptVersion&&s.scriptVersion!==episode.version)element('p','剧本有更新，请检查这一镜。',card).className='cd-attention';
    if(s.staleLinks?.length)element('p','关联资料已有新版。',card);
    const row=CDStudio.actions(card);button(row,'调整这一镜',()=>editShot(s));if(s.sceneId)button(row,'查看剧本来源',()=>{sceneId=s.sceneId;activeTab='script';route();draw();requestAnimationFrame(()=>{const target=s.sourceBlockIds?.[0]&&content.querySelector('[data-block-id="'+s.sourceBlockIds[0]+'"]');target?.scrollIntoView({block:'center',behavior:StudioUI.reduced()?'instant':'smooth'});StudioUI.reveal(target);});});button(row,'复制',async()=>{await CDStudio.save(projectId,'shot',{...CDStudio.clean(s),title:s.title+' 副本',order:(s.order||0)+.1});await reload();});button(row,'拆成两镜',async()=>{try{const half=Math.floor(s.durationUs/2);if(half<250000){status.textContent='镜头太短，无法再拆。';return;}const first={...CDStudio.clean(s),durationUs:half},second={...first,title:s.title+' · 后半镜',durationUs:s.durationUs-half,order:(s.order||0)+.01};await CDStudio.request('projects/'+projectId+'/documents/batch',{commandId:crypto.randomUUID(),operations:[{id:s.id,kind:'shot',expectedVersion:s.version,value:first},{kind:'shot',expectedVersion:0,value:second}]});await reload();}catch(e){CDStudio.error(status,e);}});button(row,'与下一镜合并',async()=>{const next=shots[i+1];if(!next){status.textContent='后面没有可合并的镜头。';return;}const action=s.action+'；'+next.action;if(action.length>600){status.textContent='两镜合并的描述较长，请先精简后再合并。';return;}try{await CDStudio.request('projects/'+projectId+'/documents/batch',{commandId:crypto.randomUUID(),operations:[{id:s.id,kind:'shot',expectedVersion:s.version,value:{...CDStudio.clean(s),action,durationUs:s.durationUs+next.durationUs,assetId:s.assetId===next.assetId?s.assetId:null,sourceBlockIds:[...new Set([...(s.sourceBlockIds||[]),...(next.sourceBlockIds||[])])]}},{id:next.id,kind:'shot',expectedVersion:next.version,value:CDStudio.clean(next),archived:true}]});await reload();}catch(e){CDStudio.error(status,e);}});button(row,'上移',async()=>{if(i>0){const prior=shots[i-1];await CDStudio.save(projectId,'shot',{...CDStudio.clean(s),order:prior.order||0},s);await CDStudio.save(projectId,'shot',{...CDStudio.clean(prior),order:s.order||i},prior);await reload();}});
   }
   if(shown.length<shots.length)button(grid,'再显示 60 镜',()=>{grid.dataset.limit=String(shown.length+60);renderShots();});
  }view.addEventListener('change',renderShots);renderShots();
  const clips=data.documents.filter(d=>d.kind==='clip'&&d.episodeId===episodeId);if(clips.length){element('h2','已规划的生成片段',content);for(const clip of clips){const card=element('article','',content);card.className='cd-clip-row';element('h3',clip.title,card);element('p',clip.shotIds.length+' 个分镜 · '+(clip.seconds||5)+' 秒',card);element('p',clip.prompt||'',card);const a=element('a','去生成这一段',card);a.href='#/media-tools/'+projectId+'?episode='+episodeId+'&target='+clip.id;}}
 }
 async function editShot(old){
  const dialog=element('dialog','',root);dialog.className='cd-dialog';element('h2',old?'调整这一镜':'添加镜头',dialog);
  const form=element('form','',dialog),name=CDStudio.field(form,'镜头名称',old?.title||'新镜头'),action=CDStudio.field(form,'观众会看到什么',old?.action||'','textarea'),seconds=CDStudio.field(form,'时长（秒）',(old?.durationUs||5000000)/1e6,'number'),scene=CDStudio.select(form,'来自哪个场景',[['','暂不关联'],...draft.scenes.map(s=>[s.id,s.title])],old?.sceneId||'');
  seconds.min='.25';seconds.max='1500';seconds.step='.25';action.maxLength=600;
  const start=CDStudio.field(form,'开头画面要求',old?.startFrameIdea||'','textarea'),end=CDStudio.field(form,'结尾画面要求',old?.endFrameIdea||'','textarea');
  const imgs=await api('projects/'+projectId+'/images'),image=CDStudio.select(form,'已选概念图 / 开始图',[['','暂不选择'],...imgs.map(i=>[i.id,i.name])],old?.startImageId||'');
  const row=CDStudio.actions(form);button(row,'返回',()=>StudioUI.dismiss(dialog));const submit=element('button','保存镜头',row);submit.className='primary';const err=element('p','',form);
  if(old){button(row,'历史版本',()=>CDStudio.history(projectId,old,root,reload));button(row,'归档镜头',async()=>{await CDStudio.request('projects/'+projectId+'/documents/'+old.id+'/archive',{expectedVersion:old.version,commandId:crypto.randomUUID()});StudioUI.dismiss(dialog);await reload();});}
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await CDStudio.save(projectId,'shot',{...(old?CDStudio.clean(old):{}),title:name.value,action:action.value,durationUs:Math.round(Number(seconds.value)*1e6),episodeId,sceneId:scene.value||null,startFrameIdea:start.value,endFrameIdea:end.value,scriptVersion:episode.version,order:old?.order??data.documents.filter(d=>d.kind==='shot').length,...(image.value?{startImageId:image.value}:{startImageId:null})},old);StudioUI.dismiss(dialog);await reload();}catch(error){CDStudio.error(err,error);}finally{submit.disabled=false;}});dialog.showModal();
 }
 function drawAssets(){const actions=CDStudio.actions(content);element('h2','角色、场景与概念图',actions);button(actions,'让导演整理',()=>scriptDirectorDialog(project,episode,'assets',reload));for(const [kind,label]of [['character','添加角色'],['location','添加场景'],['prop','添加道具'],['concept','添加概念图']])button(actions,label,()=>editAsset(kind));
  const grid=element('div','',content);grid.className='cd-asset-grid';for(const doc of data.documents.filter(d=>['character','location','prop','concept'].includes(d.kind))){const card=element('article','',grid);card.className='cd-asset-card';element('small',CDStudio.labels[doc.kind],card);element('h3',doc.title,card);if(doc.imageIds?.[0]){const img=element('img','',card);img.src='./v3/projects/'+projectId+'/images/'+doc.imageIds[0]+'/content';img.alt=doc.title;img.loading='lazy';}element('p',doc.notes||doc.prompt||'',card);button(card,'编辑资料',()=>editAsset(doc.kind,doc));element('a','制作概念图',card).href='#/media-tools/'+projectId+'?episode='+episodeId+'&target='+doc.id;}
 }
 async function editAsset(kind,old){const dialog=element('dialog','',root);dialog.className='cd-dialog';element('h2',(old?'编辑':'添加')+CDStudio.labels[kind],dialog);const form=element('form','',dialog),title=CDStudio.field(form,'名称',old?.title||''),notes=CDStudio.field(form,'固定设定',old?.notes||'','textarea'),prompt=CDStudio.field(form,'概念图要求',old?.prompt||'','textarea'),voice=kind==='character'?CDStudio.field(form,'固定声音描述',old?.voiceDescription||'','textarea'):null;
  const images=await api('projects/'+projectId+'/images'),img=CDStudio.select(form,'选用项目里的图片',[['','暂不选择'],...images.map(i=>[i.id,i.name])],old?.imageIds?.[0]||'');const row=CDStudio.actions(form);button(row,'返回',()=>StudioUI.dismiss(dialog));const submit=element('button','保存资料',row);submit.className='primary';const err=element('p','',form);
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await CDStudio.save(projectId,kind,{...(old?CDStudio.clean(old):{}),title:title.value,notes:notes.value,prompt:prompt.value,...(voice?{voiceDescription:voice.value}:{}),imageIds:img.value?[img.value]:[]},old);StudioUI.dismiss(dialog);await reload();}catch(error){CDStudio.error(err,error);}finally{submit.disabled=false;}});dialog.showModal();}
 function drawSources(){element('h2','保留的原文资料',content);element('p','原文单独保留。剧本中的改编不会覆盖它，发给模型时可只选择相关区间。',content);for(const source of data.documents.filter(d=>d.kind==='source')){const card=element('article','',content);card.className='cd-source-card';element('h3',source.title,card);element('small',source.text.length+' 字 · 已保留来源摘要',card);const details=element('details','',card);element('summary','查看原文',details);const pre=element('pre',source.text.slice(0,50000),details);if(source.text.length>50000)element('p','这里先显示前 50000 字，完整原文可导出。',details);button(card,'导出全部文字',()=>CDStudio.download(source.title+'.txt',source.text,'text/plain'));const original=element('a','下载原文件',card);original.href='./v3/studio/projects/'+projectId+'/documents/'+source.id+'/original';original.download=source.title;}}
 async function importDialog(){
  const dialog=element('dialog','',root);dialog.className='cd-dialog';element('h2','导入小说或剧本',dialog);element('p','先保留原文，再选择是否把选定的文字放入当前剧本。',dialog);
  const file=CDStudio.field(dialog,'选择文件','','file');file.accept='.txt,.md,.docx';const status=element('p','',dialog),preview=element('div','',dialog);let parsed,attempt;
  file.addEventListener('change',async()=>{const f=file.files[0];if(!f)return;status.textContent='正在读取文字…';try{parsed=await CDStudio.upload(projectId,f);preview.replaceChildren();element('p','读取到 '+parsed.characters+' 字。原文件会保留。',preview);element('pre',parsed.text.slice(0,2500),preview);status.textContent='先检查上方内容，再确认导入。';}catch(e){CDStudio.error(status,e);}});
  const put=element('input','',element('label','同时把选定文字按场景加入当前剧本',dialog));put.type='checkbox';
  const range=CDStudio.actions(dialog),from=CDStudio.field(range,'从第几个字开始',0,'number'),count=CDStudio.field(range,'选取字数',10000,'number');count.max='100000';count.min='1';from.min='0';
  const actions=CDStudio.actions(dialog);button(actions,'返回',()=>StudioUI.dismiss(dialog));button(actions,'确认导入',async()=>{
   if(!parsed)return;try{if(!attempt)attempt=crypto.randomUUID();await CDStudio.save(projectId,'source',{title:parsed.title,text:parsed.text,digest:parsed.digest},null,attempt);
    if(put.checked){const start=Number(from.value),size=Number(count.value);if(!Number.isInteger(start)||start<0||!Number.isInteger(size)||size<1||size>100000)throw Object.assign(Error('INVALID_INPUT'),{explanation:'请将本次导入范围设为 1 到 100000 字。'});const text=parsed.text.slice(start,start+size);draft.scenes.push(...parseLocalScenes(text));changed();await flush();}
    StudioUI.dismiss(dialog);await reload();notice.textContent='原文已保存。';
   }catch(e){CDStudio.error(status,e);}},true);dialog.showModal();
 }
 function parseLocalScenes(text){return text.split(/\n(?=第[一二三四五六七八九十百\d]+[章节集场幕]|#{1,4}\s|[0-9]+[-－][0-9]+\s)/).filter(Boolean).map((part,i)=>{const lines=part.split('\n').filter(s=>s.trim());return {id:crypto.randomUUID(),title:lines.length>1?lines.shift().slice(0,160):'导入场景 '+(i+1),blocks:lines.map(line=>{const speech=/^([^：:]{1,30})[：:]\s*(.*)$/.exec(line);return {id:crypto.randomUUID(),type:speech?/内心独白/.test(speech[1])?'inner':/旁白|画外音/.test(speech[1])?'narration':'dialogue':'action',speaker:speech?.[1]||'',text:speech?.[2]||line};})};});}
 function toMarkdown(value){return '# '+value.title+'\n\n'+value.scenes.map(s=>'## '+s.title+'\n\n'+s.blocks.map(b=>(b.type==='action'?'△ ':b.speaker?b.speaker+'（'+({dialogue:'对白',inner:'内心独白',narration:'旁白',sound:'音效'}[b.type]||'')+'）：':'')+b.text).join('\n\n')).join('\n\n');}
 const observer=new MutationObserver(()=>{if(!root.isConnected){clearTimeout(saveTimer);flush().catch(()=>{});canvasDispose?.();observer.disconnect();}});observer.observe(page,{childList:true});
 await choose();
}

async function createScriptProjectDialog(mode='full'){
 const dialog=element('dialog','',page);dialog.className='cd-dialog';element('h2',mode==='beginner'?'先做一段 10 秒的小样':'开始一集短剧',dialog);element('p',mode==='beginner'?'先用一个角色、一个场景和一句台词跑通制作。':'先写剧本，确定角色与场景，再逐段试拍。',dialog);
 const form=element('form','',dialog),title=CDStudio.field(form,'作品名称'),brief=CDStudio.field(form,'故事或想法','','textarea'),style=CDStudio.select(form,'先选一种画风',[['3D 国漫','3D 国漫'],['2D 动漫','2D 动漫'],['真人写实','真人写实'],['自定','稍后再定']],'3D 国漫');title.required=true;
 const row=CDStudio.actions(form);button(row,'返回',()=>StudioUI.dismiss(dialog));const submit=element('button','建立剧本工作区',row);submit.className='primary';const status=element('p','',form);let attempt;
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const signature=JSON.stringify([title.value,brief.value,style.value]);if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};const project=await api('projects',{commandId:attempt.id,title:title.value,kind:'idea'}),data=await CDStudio.request('projects/'+project.id),ep=data.documents.find(d=>d.kind==='episode');await CDStudio.save(project.id,'episode',{...CDStudio.clean(ep),title:mode==='beginner'?'10 秒试做':'第一集',durationUs:mode==='beginner'?10000000:300000000,brief:brief.value,style:style.value==='自定'?'':style.value,workflowProfile:mode==='beginner'?'h3-beginner':'short-drama'},ep,attempt.id+'_episode');state=await api('bootstrap');StudioUI.dismiss(dialog);location.hash='/scripts/'+project.id;}catch(error){CDStudio.error(status,error);}finally{submit.disabled=false;}});dialog.showModal();title.focus();
}
