'use strict';
async function timelinePage(projectId){
 const project=await api('projects/'+projectId),root=element('div','',page);root.className='cd-timeline';
 StudioUI.heading(root,'画面与声音 · '+project.title,'保留对白，把反应画面盖上去；配乐和音效单独安排。',head=>{element('a','返回作品',head).href='#/projects/'+projectId+'?section=arrangement';});
 let saved=await api('projects/'+projectId+'/arrangement'),assets=await api('projects/'+projectId+'/assets');if(!root.isConnected)return;
 if(!saved){const empty=StudioUI.empty(root,'先确定主画面的顺序','回到作品安排视频顺序，确认后再添加反应画面、配乐和音效。','film');element('a','去安排顺序',empty).href='#/projects/'+projectId+'?section=arrangement';return;}
 let value=structuredClone(saved),dirty=false,attempt;
 const status=element('p','',root);status.setAttribute('role','status');const tools=CDStudio.actions(root);const upload=CDStudio.field(tools,'添加音乐或声音','','file');upload.accept='.wav,.mp3,.m4a,.ogg';upload.addEventListener('change',async()=>{try{await CDStudio.upload(projectId,upload.files[0],'audio');assets=await api('projects/'+projectId+'/assets');status.textContent='声音已添加，可以选到下面的轨道里。';draw();}catch(e){CDStudio.error(status,e);}upload.value='';});
 button(tools,'保存这一版',save,true);button(tools,'导出当前剪辑单',()=>CDStudio.download(project.title+'-画面与声音.json',value));const region=element('div','',root);
 function modified(){dirty=true;status.textContent='有修改，保存后可交给剪映。';}
 function inputTime(parent,label,v,change){const f=CDStudio.field(parent,label,v/1e6,'number');f.min='0';f.step='.1';f.addEventListener('input',()=>{change(Math.round(Number(f.value)*1e6));modified();});return f;}
 function draw(){region.replaceChildren();const main=element('section','',region);element('h2','主画面与原声',main);element('p','整片 '+value.durationUs/1e6+' 秒。主画面顺序继续在作品页调整。',main);
  for(const [i,clip]of value.clips.entries()){const row=element('article','',main);row.className='cd-layer-row';element('strong',(i+1)+' · '+clip.name,row);element('p','整片 '+clip.startUs/1e6+'–'+(clip.startUs+clip.outUs-clip.inUs)/1e6+' 秒',row);const volume=CDStudio.field(row,'原片音量（0 是静音，1 是原音量）',clip.volume??1,'number');volume.min='0';volume.max='4';volume.step='.1';volume.addEventListener('input',()=>{clip.volume=Number(volume.value);modified();});
   button(row,'把原声单独放到声音轨',()=>{const asset=assets.find(a=>a.id===clip.assetId);if(!asset?.hasAudio){status.textContent='这段素材没有可用声音。';return;}value.audioClips||=[];value.audioClips.push({...clip,role:'dialogue',volume:clip.volume??1,fadeInUs:0,fadeOutUs:0,keyframes:[]});clip.volume=0;modified();draw();});}
  for(const [type,title]of [['overlayClips','盖在主画面上的反应镜头'],['audioClips','对白、音效与配乐']]){
   const section=element('section','',region);element('h2',title,section);element('p',type==='overlayClips'?'只覆盖画面，原来的对白可以继续播放。':'对白、配乐和音效分别设置音量；不会把混合音轨当作已分离的人声。',section);
   value[type]||=[];
   for(const [i,clip]of value[type].entries()){const row=element('article','',section);row.className='cd-layer-row';
    const choices=assets.filter(a=>type==='overlayClips'?a.kind!=='audio':a.kind==='audio'||a.hasAudio),asset=CDStudio.select(row,'素材',choices.map(a=>[a.id,a.name]),clip.assetId);asset.addEventListener('change',()=>{clip.assetId=asset.value;clip.name=assets.find(a=>a.id===asset.value).name;modified();});
    const times=CDStudio.actions(row);inputTime(times,'素材开始（秒）',clip.inUs,v=>clip.inUs=v);inputTime(times,'素材结束（秒）',clip.outUs,v=>clip.outUs=v);inputTime(times,'放在整片第几秒',clip.startUs,v=>clip.startUs=v);
    const volume=CDStudio.field(row,'音量（0–4）',clip.volume??(type==='overlayClips'?0:1),'number');volume.min='0';volume.max='4';volume.step='.1';volume.addEventListener('input',()=>{clip.volume=Number(volume.value);modified();});
    if(type==='audioClips'){const role=CDStudio.select(row,'声音用途',[['dialogue','对白'],['music','配乐'],['effect','音效']],clip.role||'dialogue');role.addEventListener('change',()=>{clip.role=role.value;modified();});
     const fades=CDStudio.actions(row);inputTime(fades,'淡入（秒）',clip.fadeInUs||0,v=>clip.fadeInUs=v);inputTime(fades,'淡出（秒）',clip.fadeOutUs||0,v=>clip.fadeOutUs=v);
     const advanced=element('details','',row);element('summary','按时间改变音量',advanced);element('p','每行填写“片段内秒数, 音量”，按时间从小到大。可以在对白出现时降低配乐。',advanced);const points=CDStudio.field(advanced,'音量变化',(clip.keyframes||[]).map(p=>p.timeUs/1e6+', '+p.volume).join('\n'),'textarea');points.addEventListener('input',()=>{clip.keyframes=points.value.split('\n').filter(s=>s.trim()).map(s=>{const [t,v]=s.split(/[,，]/).map(Number);return {timeUs:Math.round(t*1e6),volume:v};});modified();});
    }
    button(row,'移除这一段',()=>{value[type].splice(i,1);modified();draw();});
   }
   button(section,type==='overlayClips'?'添加反应镜头':'添加声音',()=>{const asset=assets.find(a=>type==='overlayClips'?a.kind!=='audio':a.kind==='audio'||a.hasAudio);if(!asset){status.textContent='先在作品中添加对应素材。';return;}value[type].push({assetId:asset.id,name:asset.name,inUs:0,outUs:Math.min(asset.durationUs,value.durationUs,3000000),startUs:0,volume:type==='overlayClips'?0:1,role:type==='overlayClips'?'reaction':'dialogue',fadeInUs:0,fadeOutUs:0,keyframes:[]});modified();draw();});
  }
 }
 async function save(){const payload={...value,expectedVersion:saved.version};const signature=JSON.stringify(payload);if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};try{saved=await api('projects/'+projectId+'/arrangement',{...payload,commandId:attempt.id});value=structuredClone(saved);dirty=false;attempt=null;status.textContent='画面与声音已保存，可以交给剪映。';draw();}catch(e){CDStudio.error(status,e);}}
 draw();
}
