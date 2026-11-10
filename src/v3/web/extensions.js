'use strict';
function extensionManager(){
 const section=element('section','');element('h2','接入更多制作工具',section);
 element('p','Codex 可以负责出图，DSH 原生 Agent 可以帮忙分析。其他图片、视频服务通过已安装的兼容插件接入。每次制作前都会单独确认。',section);
 const status=element('p','',section);status.setAttribute('role','status');const region=element('div','',section);
 async function refresh(){
  try{const [found,versions]=await Promise.all([api('extensions/discover'),api('extensions')]);if(!section.isConnected)return;region.replaceChildren();
   for(const tool of found){const card=element('article','',region);card.className='card';element('h3',tool.description||tool.name,card);
    let consent;if(!tool.managed){consent=element('input','',element('label','我信任这个已安装插件，同意读取声明并检查连接',card));consent.type='checkbox';}
    element('p',tool.managed?'工作台提供的连接方式。检查只核对本机能力，不会生成内容或调用模型。':'插件在 DSH 内运行，请只添加可信来源。工作台会限制它交回的文件和工程写入，不能隔离恶意插件本身。',card);
    button(card,'接入并检查',async()=>{
     if(consent&&!consent.checked){status.textContent='请先确认你信任这个插件。';return;}
     try{
      await api('extensions/register',{toolName:tool.name,confirm:true});
      const rows=await api('extensions'),item=rows.find(row=>row.tool_name===tool.name);
      if(!item)throw Error('PLUGIN_NOT_REGISTERED');
      if(!item.selected){const current=rows.find(row=>row.plugin_id===item.plugin_id&&row.selected);await api('extensions/select',{pluginId:item.plugin_id,version:item.version,expectedDigest:current?.digest||null,confirm:true});}
      const result=await api('extensions/probe',{pluginId:item.plugin_id,confirm:true});status.textContent=result.message||'检查完成。';
      if(result.available){const entry=(await api('plugins')).find(row=>row.manifest.pluginId===item.plugin_id);if(!entry.enabled)await api('plugins/actions',{pluginId:item.plugin_id,expectedVersion:entry.version,enabled:true,confirm:true});status.textContent+=' 已启用，可在项目的「更多制作工具 → 扩展制作」使用。';}
      window.dispatchEvent(new Event('cutdirector-tools-changed'));await refresh();
     }catch(error){status.textContent=describe(error);}
    });
   }
   for(const item of versions){const card=element('article','',region);card.className='card';
    element('h3',item.manifest.title+' · '+item.version,card);element('p','来源：'+item.manifest.source+' · '+item.manifest.license,card);
    const permission={'project-read':'本次工程文字','media-read':'明确选中的素材','media-upload':'发送已选素材','network-read':'连接外部服务','paid-generation':'生成可能收费'};
    element('p','使用范围：'+item.manifest.permissions.map(value=>permission[value]||value).join('、'),card);
    element('small',item.selected?'当前选用此版本':'保留的旧版本；原有成果不会删除',card);
    if(!item.selected)button(card,'换用并检查此版本',async()=>{try{const current=versions.find(row=>row.plugin_id===item.plugin_id&&row.selected);await api('extensions/select',{pluginId:item.plugin_id,version:item.version,expectedDigest:current?.digest||null,confirm:true});const result=await api('extensions/probe',{pluginId:item.plugin_id,confirm:true});status.textContent=result.message;window.dispatchEvent(new Event('cutdirector-tools-changed'));await refresh();}catch(error){status.textContent=describe(error);}});
   }
  }catch(error){status.textContent=describe(error);}
 }
 button(section,'重新查看可接入的工具',refresh);refresh();
}
function projectExtensions(project,workspace){
 const section=element('section','',workspace);section.dataset.workbenchSection='extensions';section.tabIndex=-1;
 element('h2','让其他工具帮你制作',section);
 element('p','选一个工具，说明要做什么。图片和视频先放进候选区，由你检查后选用；分析工具只给建议。',section);
 const status=element('p','',section);status.setAttribute('role','status');
 const tools=element('select','',element('label','谁来帮忙',section)),fields=element('div','',section);
 const text=element('textarea','',element('label','这次想做什么？',section));text.maxLength=4000;text.placeholder='例如：为这一镜画一张温暖的厨房画面。';
 const includeStory=element('input','',element('label','附上保存的分镜文字',section));includeStory.type='checkbox';
 const includeMedia=element('input','',element('label','附上已有视频的名称和时长（不发送视频文件）',section));includeMedia.type='checkbox';
 const results=element('div','',section);let entries=[],saved,refs=[],models=[],busy=false,capability,shot,frame,seconds,model,referenceChecks=[];
 const labels={awaiting_approval:'等你确认',running:'正在制作',checking:'正在查结果',queued:'工具正在处理，可稍后查看',collecting:'正在取回文件',collect_failed:'文件还没取回，可继续取回',unknown:'结果待核对，不会重复发送',failed:'返回内容未通过检查',complete:'结果已返回',cancelled:'已取消'};
 const capabilityTitles={'image-generation':'画图片','video-generation':'生成一段视频','text-advice':'分析并给建议','reference-analysis':'分析参考','roughcut':'给重点剪辑建议','beatcut':'给节奏建议','reference-search':'查找公开参考'};
 const select=(parent,label,choices)=>{const el=element('select','',element('label',label,parent));for(const [value,title]of choices)element('option',title,el).value=value;return el;};
 function renderFields(){
  fields.replaceChildren();referenceChecks=[];const entry=entries.find(item=>item.manifest.pluginId===tools.value);if(!entry){element('p','还没有可用扩展。先到「设置 → 工具与能力」接入并检查，或继续使用内置制作工具。',fields);return;}
  capability=select(fields,'帮你做哪件事',entry.manifest.capabilities.map(value=>[value,capabilityTitles[value]||'给制作建议']));
  const detail=element('div','',fields);
  function detailFields(){
   detail.replaceChildren();referenceChecks=[];shot=frame=seconds=model=null;
   if(['image-generation','video-generation'].includes(capability.value)){
    shot=select(detail,'用在哪个镜头',(saved?.shots||[]).map((item,index)=>[item.id,'镜头 '+(index+1)+' · '+String(item.action||'').slice(0,40)]));
    if(!saved?.shots.length)element('p','先到「写分镜」添加并保存一个镜头。',detail);
    if(capability.value==='image-generation')frame=select(detail,'画哪个时刻',[['start','镜头开始'],['end','镜头结束']]);
    else{seconds=element('input','',element('label','这段视频多少秒',detail));seconds.type='number';seconds.min='1';seconds.max='30';seconds.value='5';}
   }
   if(tools.value==='cutdirector-native-dsh-analysis')model=select(detail,'使用 DSH 的哪个模型',models.map((item,index)=>[String(index),item.provider+' · '+item.model]));
   if(entry.manifest.permissions.includes('media-upload')){
    const list=element('fieldset','',detail);element('legend','这次发送哪些素材（选填，最多 4 个）',list);
    for(const ref of refs.filter(item=>tools.value!=='cutdirector-native-codex-image'||item.kind==='image')){const input=element('input','',element('label',(ref.kind==='image'?'图片：':'视频：')+ref.name,list));input.type='checkbox';input.value=ref.id;referenceChecks.push(input);}
    element('small','只发送这里勾选的文件。未勾选时只发文字。',list);
   }
  }
  capability.addEventListener('change',detailFields);detailFields();
 }
 async function load(){
  try{const previous=tools.value,[registered,jobs,story,images,assets,connections]=await Promise.all([api('plugins'),api('projects/'+project.id+'/extension-jobs'),api('projects/'+project.id+'/story'),api('projects/'+project.id+'/images'),api('projects/'+project.id+'/assets'),api('connections')]);if(!section.isConnected)return;
   entries=registered.filter(entry=>entry.enabled&&entry.external===true);saved=story;refs=[...images.map(item=>({...item,kind:'image'})),...assets.map(item=>({...item,kind:'video'}))];models=connections;
   tools.replaceChildren();for(const entry of entries)element('option',entry.manifest.title,tools).value=entry.manifest.pluginId;if(entries.some(item=>item.manifest.pluginId===previous))tools.value=previous;
   renderFields();results.replaceChildren();
   for(const job of jobs){const card=element('article','',results);card.className='card';element('h3',labels[job.state]||'请查看记录',card);
    element('p',job.snapshot.request,card);if(job.result){element('p',job.result.text,card);element('small','来自 '+(job.result.title||'已选工具')+'。'+(job.result.artifacts?.length?'文件已保存，还没有替换镜头。':'分析仅供参考，没有修改工程。'),card);}
    for(const artifact of job.result?.artifacts||[]){
     const media=element(artifact.kind==='image'?'img':'video','',card);media.src='./v3/projects/'+project.id+'/'+(artifact.kind==='image'?'images':'assets')+'/'+artifact.id+'/content';
     if(artifact.kind==='image'){media.alt='这次返回的候选图片';media.loading='lazy';}else{media.controls=true;media.preload='metadata';}media.className=artifact.kind==='image'?'generated-frame':'comparison-video';
    }
    if(job.result?.artifacts?.length)button(card,'去候选区检查并选用',()=>locateWorkbench(workspace.querySelector('[data-workbench-section="'+(job.snapshot.capability==='image-generation'?'image-generation':'generation')+'"]')));
    if(job.state==='awaiting_approval')review(job,card);
    if(['queued','collect_failed'].includes(job.state))button(card,job.state==='queued'?'查看处理结果':'继续取回文件（不会重新生成）',async()=>{try{status.textContent='正在取回这次已有的结果…';await api('projects/'+project.id+'/extension-jobs/'+job.id+'/check',{});await load();status.textContent='记录已更新。';}catch(error){status.textContent=describe(error);}});
    if(['running','checking','queued'].includes(job.state))button(card,'停止等待',async()=>{try{await api('projects/'+project.id+'/extension-jobs/'+job.id+'/cancel',{});await load();status.textContent='已停止等待。工具可能已开始处理，请核对它的记录和费用；不会自动重发。';}catch(error){status.textContent=describe(error);}});
   }
  }catch(error){status.textContent=describe(error);}
 }
 function review(job,parent){
  button(parent,'核对并开始',()=>{
   const dialog=element('dialog','',section);element('h3','确认这一次调用',dialog);
   const entry=entries.find(item=>item.manifest.pluginId===job.plugin_id);element('p',(entry?.manifest.title||job.plugin_id)+' · '+(entry?.manifest.version||'已固定版本'),dialog);
   element('p',job.snapshot.request,dialog);
   element('p',(job.snapshot.shotId?'用于已保存镜头；'+job.snapshot.ratio+'；'+(job.snapshot.seconds?job.snapshot.seconds+' 秒':'1 张图片')+'。':'只返回分析建议。')+(job.snapshot.story?'附上分镜文字。':'')+(job.snapshot.assets?'附上素材名称和时长。':''),dialog);
   if(job.snapshot.model)element('p','模型：'+job.snapshot.model.provider+' · '+job.snapshot.model.id+'，本次固定。',dialog);
   for(const ref of job.snapshot.references||[])element('p','将发送文件：'+ref.name,dialog);
   let upload;if(job.snapshot.references?.length){upload=element('input','',element('label','我同意把上述文件发送给这个工具及其模型服务',dialog));upload.type='checkbox';}
   const fee=element('input','',element('label','我同意本次调用。若消耗额度或收费，以对应服务账单为准；结果不明时先核对，不重复发送',dialog));fee.type='checkbox';
   button(dialog,'先不调用',()=>{StudioUI.dismiss(dialog);});
   const go=button(dialog,'确认开始',async()=>{
    if(!fee.checked||upload&&!upload.checked){status.textContent='请先确认本次调用和文件发送。';return;}go.disabled=true;
    try{status.textContent='工具正在处理，你可以继续查看项目。';StudioUI.dismiss(dialog);
     await api('projects/'+project.id+'/extension-jobs/'+job.id+'/approve',{confirm:true,allowUnknownCost:true,allowUpload:!!upload?.checked,snapshotDigest:job.snapshotDigest});await load();status.textContent='记录已更新，请查看返回结果。';
    }catch(error){status.textContent=describe(error);}
   },true);dialog.showModal();
  });
  button(parent,'取消这次准备',async()=>{try{await api('projects/'+project.id+'/extension-jobs/'+job.id+'/cancel',{});await load();}catch(error){status.textContent=describe(error);}});
 }
 section.addEventListener('cutdirector-extension-request',event=>{text.value=String(event.detail?.text||'').slice(0,4000);status.textContent='要求已带过来。请选择工具，再核对本次调用内容；尚未执行。';});
 tools.addEventListener('change',renderFields);
 button(section,'先查看这次调用内容',async()=>{if(busy||!tools.value)return;busy=true;
  try{const referenceIds=referenceChecks.filter(input=>input.checked).map(input=>input.value);if(referenceIds.length>4){status.textContent='一次最多选择 4 个参考文件。';return;}
   await api('projects/'+project.id+'/extension-jobs',{commandId:crypto.randomUUID(),pluginId:tools.value,text:text.value,capability:capability.value,includeStory:includeStory.checked,includeMedia:includeMedia.checked,referenceIds,
    ...(shot?{shotId:shot.value}:{}),...(frame?{frame:frame.value}:{}),...(seconds?{seconds:Number(seconds.value)}:{}),...(model?{model:models[Number(model.value)]?{provider:models[Number(model.value)].providerId,id:models[Number(model.value)].modelId}:null}:{})});
   await load();status.textContent='清单已准备，尚未调用工具或付费。';
  }catch(error){status.textContent=describe(error);}finally{busy=false;}
 },true);
 button(section,'刷新工具与结果',load);section.addEventListener('cutdirector-activated',load);load();
}
