'use strict';
let studioCanvasLoading;
function loadStudioCanvas(){
 if(window.CDCanvas)return Promise.resolve();
 if(!studioCanvasLoading)studioCanvasLoading=new Promise((resolve,reject)=>{
  if(!document.querySelector('link[data-canvas-style]')){const css=document.createElement('link');css.rel='stylesheet';css.href='./studio-canvas-island.css';css.dataset.canvasStyle='';document.head.append(css);}
  const script=document.createElement('script');script.src='./studio-canvas-island.js';script.onload=resolve;script.onerror=()=>{studioCanvasLoading=null;reject(Error('CANVAS_UNAVAILABLE'));};document.head.append(script);
 });return studioCanvasLoading;
}
function mountStudioCanvas(parent,project,data,episodeId,onChanged){
 const layout=element('div','',parent);layout.className='cd-canvas-layout';const stage=element('div','',layout);stage.className='cd-canvas-stage';const detail=element('aside','',layout);detail.className='cd-canvas-detail';element('h2','关系画布',detail);element('p','在画布里整理角色、场景、分镜与概念图。文字内容和剧本工作区同步保存。',detail);
 const status=element('p','正在打开画布…',detail);status.setAttribute('role','status');let dispose=()=>{},closed=false,saveTimer,canvas=data.documents.find(d=>d.kind==='canvas'&&d.episodeId===episodeId),pending=Promise.resolve(),lastValue;
 const episode=data.documents.find(d=>d.id===episodeId),scenes=(episode.scenes||[]).map(s=>({...s,kind:'scene',episodeId}));
 const docs=data.documents.filter(d=>d.id===episodeId||d.episodeId===episodeId&&['shot','clip'].includes(d.kind)||['character','location','prop','concept'].includes(d.kind));
 const all=[...docs,...scenes],available=new Set(all.map(d=>d.id)),stored=new Map((canvas?.nodes||[]).map(n=>[n.id,n])),rows=new Map();
 const nodes=all.map((d,i)=>{const depth=({episode:0,scene:1,shot:2,clip:3,character:4,location:4,prop:4,concept:4})[d.kind]||0,row=rows.get(depth)||0;rows.set(depth,row+1);return {id:d.id,type:'content',position:stored.has(d.id)?{x:stored.get(d.id).x,y:stored.get(d.id).y}:{x:depth*310,y:row*150},data:{label:d.title,kind:CDStudio.labels[d.kind]||'场景',depth,row,detail:(d.action||d.notes||d.prompt||'').slice(0,70)}};});
 const edges=[];
 for(const d of all){const source=d.kind==='scene'?episodeId:d.sceneId||(['shot','clip'].includes(d.kind)?episodeId:null);if(source&&available.has(source))edges.push({id:'contains-'+d.id,source,target:d.id,label:'包含',data:{derived:true}});for(const link of d.links||[])if(available.has(link.id))edges.push({id:'uses-'+d.id+'-'+link.id,source:d.id,target:link.id,label:'使用',data:{derived:true}});if(d.kind==='clip')for(const shotId of d.shotIds||[])if(available.has(shotId))edges.push({id:'clip-'+d.id+'-'+shotId,source:shotId,target:d.id,label:'生成素材',data:{derived:true}});}
 for(const [i,e]of (canvas?.edges||[]).entries())if(available.has(e.source)&&available.has(e.target))edges.push({...e,type:'smoothstep',id:'saved-'+i,label:'关联',data:{relation:e.type}});
 const save=async()=>{if(!lastValue)return;const next=lastValue;lastValue=null;pending=pending.catch(()=>{}).then(async()=>{status.textContent='正在保存布局…';canvas=await CDStudio.save(project.id,'canvas',{title:episode.title+'关系画布',episodeId,...next},canvas);status.textContent='';}).catch(e=>{CDStudio.error(status,e);lastValue=next;});await pending;};
 async function inspect(id){const d=all.find(d=>d.id===id);if(!d)return;detail.replaceChildren();element('h2',d.title,detail);
  if(d.kind==='scene'){element('p',d.blocks.map(b=>(b.speaker?b.speaker+'：':'')+b.text).join('\n'),detail);element('p','回到“写剧本”可修改这一场。',detail);return;}
  const form=element('form','',detail),name=CDStudio.field(form,'名称',d.title),notes=CDStudio.field(form,d.kind==='shot'?'画面内容':'内容',d.action||d.notes||d.brief||'','textarea'),submit=element('button','保存内容',form);submit.className='primary';const err=element('p','',form);
  form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const value={...CDStudio.clean(d),title:name.value};value[d.kind==='shot'?'action':d.kind==='episode'?'brief':'notes']=notes.value;await CDStudio.save(project.id,d.kind,value,d);await onChanged();}catch(error){CDStudio.error(err,error);}finally{submit.disabled=false;}});
 }
 loadStudioCanvas().then(()=>{if(closed||!stage.isConnected)return;status.textContent='';dispose=window.CDCanvas.mount(stage,{initialNodes:nodes,initialEdges:edges,onInspect:inspect,onChange:value=>{lastValue=value;clearTimeout(saveTimer);saveTimer=setTimeout(save,600);}});}).catch(e=>{status.textContent='画布暂时没能打开。剧本和分镜仍可正常编辑。';button(detail,'重新打开画布',()=>onChanged());});
 return ()=>{closed=true;clearTimeout(saveTimer);save().catch(()=>{});dispose();};
}
