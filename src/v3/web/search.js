'use strict';
function referenceSearch(project,parent){
 const region=element('details','',parent);element('summary','去网上找一些参考',region);
 element('p','使用当前 DSH 的搜索服务。一次搜索可能消耗模型额度，提交前单独确认。这里不会上传你的图片或视频。',region);
 const status=element('p','',region);status.setAttribute('role','status');
 const form=element('form','',region),query=element('input','',element('label','想找哪类视频或做法',form));query.maxLength=500;query.required=true;query.placeholder='例如：咖啡店旅行 vlog 的开场结构';
 const prepare=element('button','先检查搜索内容',form),list=element('div','',region);list.className='cards';
 const prefix='projects/'+project.id+'/reference-searches';let attempt;
 function problem(error){return ({WEB_PROVIDER_UNAVAILABLE:'DSH 还没有可用的搜索服务。你仍可保存链接或上传参考。',WEB_PROVIDER_AMBIGUOUS:'DSH 配置了多个搜索服务，请先在 DSH 设置中选定一个。',WEB_PROVIDER_CREDENTIAL_MISSING:'搜索服务还需要在 DSH 中配置凭据。',WEB_PROVIDER_CONFIGURED_MISSING:'DSH 选定的搜索服务当前没有加载，请在 DSH 设置中检查。',WEB_PROVIDER_CONFIGURED_UNAVAILABLE:'DSH 选定的搜索服务暂时不可用。',SEARCH_PROVIDER_CHANGED:'搜索服务刚有变更，请重新准备并确认。',SEARCH_APPROVAL_REQUIRED:'请先核对搜索文字和额度说明。'})[error.message]||describe(error);}
 async function refresh(){
  try{
   const jobs=await api(prefix);if(!region.isConnected)return;list.replaceChildren();
   for(const job of jobs){
    const card=element('article','',list);card.className='card';
    element('h3',job.query,card);
    const states={awaiting_approval:'还没有搜索，等待你确认',dispatching:'正在搜索',unknown:'上次搜索的结果待核对，请先查看 DSH 或厂商记录，避免重复消耗额度。',ready:'参考已取回'};
    element('p',states[job.state]||'需要检查',card);
    if(job.state==='awaiting_approval')button(card,'查看搜索确认',()=>approval(job,card));
    for(const [index,source]of (job.result?.sources||[]).entries()){
     const row=element('div','',card),link=element('a',source.title,row);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
     if(source.snippet)element('p',source.snippet,row);
     if(source.publishedAt)element('small',source.publishedAt,row);
     const save=button(row,'存入灵感并引用',async()=>{
      save.disabled=true;
      try{
       const idea=await api('ideas',{commandId:'searchidea_'+job.id+'_'+index,text:source.title+'\n'+source.snippet,url:source.url});
       const linked=await api('projects/'+project.id+'/references?all=true');
       if(!linked.some(item=>item.idea_id===idea.id&&item.mode!=='disabled'))await api('projects/'+project.id+'/references',{commandId:'searchref_'+job.id+'_'+index,ideaId:idea.id,sourceVersion:0,expectedVersion:0,mode:'reference'});
       status.textContent='已存入灵感，并作为这个项目的参考。发给导演前仍需勾选附上参考文字。';save.textContent='已保存并引用';
      }catch(error){status.textContent=problem(error);save.disabled=false;}
     });
    }
    if(job.state==='ready'&&!job.result?.sources.length)element('p','这次没有找到可用来源。可以换一种更具体的说法，重新确认后再搜。',card);
   }
  }catch(error){status.textContent=problem(error);}
 }
 function approval(job,card){
  const dialog=element('dialog','',card);dialog.setAttribute('aria-label','确认公开参考搜索');
  element('h2','确认搜索这段文字？',dialog);element('p',job.query,dialog);
  element('p','使用 DSH 中的搜索服务「'+job.provider.id+'」，最多取回 8 个来源。这会发出一次搜索请求，可能消耗一次模型调用的额度，金额以服务账单为准。',dialog);
  const consent=element('input','',element('label','我同意发送以上搜索文字，并接受可能产生的模型费用',dialog));consent.type='checkbox';
  const message=element('p','',dialog);let busy=false;
  const back=button(dialog,'先不搜索',()=>dialog.close());
  const go=button(dialog,'确认搜索一次',async()=>{
   if(busy||!consent.checked)return;busy=true;go.disabled=back.disabled=true;
   try{await api(prefix+'/'+job.id+'/approve',{confirmCharge:true,confirmQuery:true});dialog.close();await refresh();}
   catch(error){message.textContent=problem(error);}finally{busy=false;back.disabled=false;go.disabled=!consent.checked;}
  },true);
  consent.addEventListener('change',()=>{go.disabled=busy||!consent.checked;});go.disabled=true;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(prepare.disabled)return;prepare.disabled=true;
  const value=query.value.trim();if(attempt?.query!==value)attempt={query:value,id:crypto.randomUUID()};
  try{const job=await api(prefix,{commandId:attempt.id,query:value});await refresh();if(job.state==='awaiting_approval')approval(job,list);else status.textContent='这次请求已有记录，请先查看原结果。';}
  catch(error){if(['IDEMPOTENCY_CONFLICT','SEARCH_PROVIDER_CHANGED'].includes(error.message))attempt=undefined;status.textContent=problem(error);}finally{prepare.disabled=false;}
 });
 button(region,'重新读取搜索记录',refresh);
 region.addEventListener('toggle',()=>{if(region.open)refresh();});
}
