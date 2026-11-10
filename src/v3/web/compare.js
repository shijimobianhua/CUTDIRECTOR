'use strict';
function candidateComparison(project,parent,kind,onSelect){
 const region=element('details','',parent);
 element('summary',kind==='image'?'并排比较两张候选图':'并排比较两段候选视频',region);
 const content=element('div','',region);let request=0;
 async function load(){
  const run=++request;content.replaceChildren();
  try{
   const story=await api('projects/'+project.id+'/story');if(!region.isConnected||run!==request)return;
   if(!story?.shots.length){element('p','先保存分镜，再比较对应镜头的候选。',content);return;}
   const shotPicker=element('select','',element('label','比较哪个镜头',content));
   for(const [index,shot]of story.shots.entries())element('option','镜头 '+(index+1),shotPicker).value=shot.id;
   const frame=kind==='image'?element('select','',element('label','选作哪个时刻',content)):null;
   if(frame){element('option','镜头开始',frame).value='start';element('option','镜头结束',frame).value='end';}
   const status=element('p','',content),pickers=element('div','',content),views=element('div','',content);
   pickers.className='actions';views.className='candidate-comparison';
   let cursor=null,items=[],reading=false;
   async function read(more=false){
    if(reading)return;reading=true;
    try{
     const result=await api('projects/'+project.id+'/candidates?'+new URLSearchParams({kind,shotId:shotPicker.value,before:more&&cursor?cursor:Number.MAX_SAFE_INTEGER}));
     if(!content.isConnected||run!==request)return;
     items=more?[...items,...result.items]:result.items;cursor=result.nextBefore;renderPicks();
     status.textContent=items.length?'选择两份候选查看。选用后仍需保存分镜。':'这一镜还没有候选，可以先导入或生成。';
    }catch(error){status.textContent=describe(error);}finally{reading=false;}
   }
   function renderPicks(){
    pickers.replaceChildren();views.querySelectorAll('video').forEach(video=>video.pause());views.replaceChildren();
    const active=[];
    for(const [index,label]of ['左边','右边'].entries()){
     const picker=element('select','',element('label',label,pickers));active.push(picker);
     for(const item of items)element('option',item.name+(item.storyVersion?' · 分镜第 '+item.storyVersion+' 版':' · 手工素材')+(item.selected?' · 已选':''),picker).value=item.id;
     if(items[index])picker.value=items[index].id;
    }
    const panels=active.map(()=>{const panel=element('article','',views);panel.className='card';return panel;});
    function renderPanel(index){
     const panel=panels[index],item=items.find(item=>item.id===active[index].value);
     panel.querySelector('video')?.pause();panel.replaceChildren();if(!item)return;
     element('h3',item.name,panel);
     element('small',item.storyVersion?'分镜第 '+item.storyVersion+' 版候选':'手工导入素材',panel);
     const media=element(kind==='image'?'img':'video','',panel);
     media.src='./v3/projects/'+project.id+'/'+(kind==='image'?'images':'assets')+'/'+item.id+'/content';
     if(kind==='image'){media.alt=item.name;media.className='generated-frame';}else{media.controls=true;media.preload='metadata';media.className='comparison-video';}
     button(panel,'选用这一份',()=>{
      const choose=async()=>{
       const selected=await onSelect(shotPicker.value,...kind==='image'?[frame.value,item.id]:[item.id]);
       status.textContent=selected===true?'已放入分镜草案，请在分镜区检查并保存。':'这份候选暂时没有放入分镜，请先查看分镜区的提示。';
      };
      if(item.storyVersion&&item.storyVersion!==story.version){
       const dialog=element('dialog','',region);dialog.setAttribute('aria-label','选用旧版本候选');
       element('h2','要选用以前的候选吗？',dialog);element('p','它对应分镜第 '+item.storyVersion+' 版，当前是第 '+story.version+' 版，画面要求可能不同。原候选会保留。',dialog);
       const back=button(dialog,'继续比较',()=>dialog.close());const go=button(dialog,'确认放入当前分镜',async()=>{go.disabled=true;try{await choose();dialog.close();}catch(error){status.textContent=describe(error);go.disabled=false;}},true);
       dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
      }else choose().catch(error=>{status.textContent=describe(error);});
     });
    }
    active.forEach((picker,index)=>{picker.addEventListener('change',()=>renderPanel(index));renderPanel(index);});
    if(cursor)button(pickers,'再看一些候选',()=>read(true));
    if(kind==='video'&&items.length)button(pickers,'都回到开头',()=>views.querySelectorAll('video').forEach(video=>{video.pause();video.currentTime=0;}));
   }
   shotPicker.addEventListener('change',()=>{cursor=null;read();});await read();
  }catch(error){if(region.isConnected)element('p',describe(error),content);}
 }
 region.addEventListener('toggle',()=>{if(region.open)load();else content.querySelectorAll('video').forEach(video=>video.pause());});
 button(region,'更新候选列表',load);
}
