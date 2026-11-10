'use strict';
function taskCenter() {
  const region=element('section','');
  StudioUI.heading(region,'制作任务','等待确认、正在处理和需要检查的事项，都在这里。');
  const filter=element('select','',element('label','查看哪类任务',region));
  for(const [id,text] of [['','全部'],['waiting','等待确认'],['active','正在处理'],['attention','需要处理'],['finished','已完成或已停止']])element('option',text,filter).value=id;
  const status=element('p','正在读取…',region);
  status.setAttribute('role','status');
  const cards=element('div','',region);
  cards.className='cards task-list';
  const labels={awaiting_approval:'等待你确认',submitting:'正在提交',dispatching:'正在提交',queued:'排队中',running:'处理中',
    collecting:'正在取回',collect_failed:'需要重新取回',unknown:'结果待核对',uncertain:'结果待核对',
    writing:'正在创建草稿',failed:'这一步未完成',expired:'已超时',cancelled:'已取消',ready:'可查看',
    created:'草稿已创建',preparing:'正在准备画面',thinking:'正在准备建议',reading:'正在核对资料',complete:'建议已完成',interrupted:'上次处理中断',submitted:'整批已提交',paused:'后续提交已暂停'};
  let cursor=null;
  let busy=false;
  const rows=new Map();
  const more=button(region,'查看更多任务',()=>refresh(true));
  async function refresh(append=false) {
    if(busy)return;
    busy=true;
    more.disabled=true;
    try {
      const query=new URLSearchParams({...filter.value?{group:filter.value}:{},...append&&cursor?{cursor}:{}});
      const data=await api('tasks?'+query);
      if(!region.isConnected)return;
      if(!append)rows.clear();
      data.items.forEach(item=>rows.set(item.kind+':'+item.id,item));
      cursor=data.nextCursor;
      cards.replaceChildren();
      for(const item of rows.values()) {
        const card=element('article','',cards);
        card.className='card';
        element('strong',item.title,card);
        const kind=({image:'分镜出图',video:'视频试拍',draft:'剪映草稿',director:'导演建议',batch:'一批镜头',search:'查找参考'})[item.kind]||'制作任务';
        element('p',kind+' · '+(labels[item.state]||'需要检查'),card);
        element('small',new Date(item.createdAt).toLocaleString(),card);
        if(item.state==='unknown'||item.state==='uncertain')element('p','先核对原任务，再决定是否重新提交。',card);
        const link=element('a','回到项目处理',card);
        link.href=item.kind==='studio'?'#/media-tools/'+item.projectId+'?task='+item.id:'#/projects/'+item.projectId+'?section='+item.section+'&task='+item.id;
      }
      status.textContent=rows.size?'共显示 '+rows.size+' 项。':'这里还没有这类任务。';
      more.hidden=!cursor;
    }catch(error){if(region.isConnected)status.textContent=describe(error);}
    finally{busy=false;more.disabled=false;}
  }
  filter.addEventListener('change',()=>{cursor=null;refresh();});
  button(region,'重新检查',()=>refresh());
  refresh();
  const timer=setInterval(()=>{
    if(!region.isConnected)return clearInterval(timer);
    if(!document.hidden&&!cursor)refresh();
  },7000);
}
