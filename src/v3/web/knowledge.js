'use strict';
function projectKnowledge(project,parent){
  const section=element('details','',parent);
  element('summary','让导演记住我的要求',section);
  const status=element('p','这里可以记录你对当前版本的意见。确认成为偏好后，会用于后续模型建议；当次指令优先。',section);
  const form=element('form','',section);
  const kind=element('select','',element('label','这条意见针对',form));
  for(const [value,title]of [['story','分镜'],['arrangement','视频顺序']])element('option',title,kind).value=value;
  const note=element('textarea','',element('label','下次希望怎么做',form));note.maxLength=600;note.required=true;
  const save=element('button','记录这条意见',form);
  const list=element('div','',section);
  const prefix='projects/'+project.id+'/feedback';
  let attempt;
  async function refresh(){
    try{
      const rows=await api(prefix);
      if(!section.isConnected)return;
      list.replaceChildren();
      if(!rows.length)element('p','还没有记录。记录意见不会自动改变导演的要求。',list);
      for(const row of rows){
        const card=element('article','',list);card.className='card';
        element('p',row.note,card);
        element('small',(row.state==='case'?'待确认意见':row.state==='revoked'?'已撤销':row.scope==='global'?'跨项目偏好':'本项目偏好')+' · '+(row.kind==='story'?'分镜':'顺序')+'第 '+row.source_version+' 版',card);
        if(row.project_id!==project.id){element('a','查看来源项目',card).href='#/projects/'+row.project_id;continue;}
        const actions=row.state==='case'?[['approve','确认作为本项目偏好']]:row.state==='approved'?
          [...row.scope==='project'?[['promote','用于今后的其他项目']]:[],['revoke','撤销偏好']]:[];
        for(const [action,title]of actions)button(card,title,()=>confirmChange(row,action,title));
      }
    }catch(error){if(section.isConnected)status.textContent=describe(error);}
  }
  function confirmChange(row,action,title){
    const dialog=element('dialog','',section);dialog.setAttribute('aria-label',title);
    element('h2',title,dialog);element('p',row.note,dialog);
    element('p',action==='revoke'?'后续建议将不再使用这条要求，历史记录会保留。':action==='promote'?
      '这条要求将提供给本机后续项目的文字模型。每个项目当次的要求优先，可随时撤销。':
      '这条要求将提供给本项目后续的文字模型，不会自动修改已有作品。',dialog);
    const status=element('p','',dialog);let busy=false;const commandId=crypto.randomUUID();
    const back=button(dialog,'先不改',()=>dialog.close());
    const go=button(dialog,'确认',async()=>{
      if(busy)return;busy=true;back.disabled=go.disabled=true;
      try{await api(prefix+'/'+row.id,{commandId,expectedVersion:row.version,action,confirm:true});dialog.close();await refresh();}
      catch(error){status.textContent=error.message==='FEEDBACK_CONFLICT'?'这条记录已有更新，请重新打开。':describe(error);}
      finally{busy=false;back.disabled=go.disabled=false;}
    },true);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(save.disabled)return;save.disabled=true;
    try{
      const base=await api('projects/'+project.id+'/'+kind.value);
      if(!base){status.textContent='请先保存一版'+(kind.value==='story'?'分镜':'视频顺序')+'，再记录意见。';return;}
      const input={kind:kind.value,version:base.version,note:note.value};
      const signature=JSON.stringify(input);
      if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
      await api(prefix,{...input,commandId:attempt.id});note.value='';attempt=undefined;
      status.textContent='意见已记录。你可以再决定是否让导演长期记住。';await refresh();
    }catch(error){status.textContent=describe(error);}
    finally{save.disabled=false;}
  });
  section.addEventListener('toggle',()=>{if(section.open)refresh();});
}
