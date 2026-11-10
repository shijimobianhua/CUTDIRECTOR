'use strict';
async function toolCenter(){
 extensionManager();
 const section=element('section','');element('h2','工具与能力',section);
 element('p','查看目前有哪些工具。停用后不会再提交新任务，已经提交的任务和已保存成果会保留。',section);
 element('p','新增插件请先通过 DSH 的插件入口安装。制作方法文件只提供方法，不会自动安装程序或获得上传、花钱、写草稿的权限。',section);
 const status=element('p','',section);status.setAttribute('role','status');
 const list=element('div','',section);list.className='cards';
 const labels={'project-read':'读取当前工程','media-read':'读取已选素材','network-read':'访问公开网页','media-upload':'上传已批准的素材','paid-generation':'付费生成','draft-write':'创建剪映草稿'};
 async function refresh(){
  try{
   const entries=await api('plugins');if(!section.isConnected)return;list.replaceChildren();
   for(const entry of entries){
    const card=element('article','',list);card.className='card';
    element('h3',entry.manifest.title,card);element('small','版本 '+entry.manifest.version+' · '+(entry.enabled?'已启用':'已停用'),card);
    element('p',entry.probe?.message||'还没有重新检查。首次使用时仍会验证所需连接。',card);
    if(entry.probe)element('small',(entry.probe.level==='executed'?'已有执行记录':'连接或组件检测')+' · '+new Date(entry.probe.checkedAt).toLocaleString(),card);
    element('p',entry.manifest.permissions.map(value=>labels[value]).join('、'),card);
    const cost={free:'本机操作，不产生模型费用',model:'可能消耗模型额度，以对应服务账单为准',paid:'生成前会单独确认费用'};
    element('small',cost[entry.manifest.cost],card);
    const check=button(card,'重新检查',async()=>{
      check.disabled=true;
      try{await api(entry.external?'extensions/probe':'plugins/probe',{pluginId:entry.manifest.pluginId,...entry.external?{confirm:true}:{}});await refresh();}
      catch(error){status.textContent=describe(error);}finally{check.disabled=false;}
    });
    button(card,entry.enabled?'停用这个工具':'启用这个工具',async()=>{
      try{await api('plugins/actions',{pluginId:entry.manifest.pluginId,expectedVersion:entry.version,enabled:!entry.enabled,confirm:true});await refresh();}
      catch(error){status.textContent=error.message==='PLUGIN_CONFLICT'?'设置已有更新，请重新打开再操作。':describe(error);}
    });
   }
  }catch(error){if(section.isConnected)status.textContent=describe(error);}
 }
 window.addEventListener('cutdirector-tools-changed',()=>{if(section.isConnected)refresh();});
 refresh();
}
