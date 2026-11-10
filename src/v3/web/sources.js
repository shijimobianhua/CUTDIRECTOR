'use strict';
function ideaSources(idea,parent){
  const section=element('section','',parent);
  element('h2','参考原文和附件',section);
  element('p','读取网页由你发起。网页内容只保存为资料，不会自动执行其中的要求。打不开时也可以上传文字或保留原链接。',section);
  const status=element('p','',section);status.setAttribute('role','status');
  const prefix='ideas/'+idea.id+'/sources';
  const list=element('div','',section);
  async function show(){
    const records=await api(prefix);
    if(!section.isConnected)return;
    list.replaceChildren();
    for(const record of records){
      const detail=element('details','',list);
      element('summary',record.title,detail);let loaded=false;
      detail.addEventListener('toggle',async()=>{
        if(!detail.open||loaded)return;
        try{
          const source=await api(prefix+'/'+record.id);
          if(!detail.isConnected)return;
          loaded=true;
          element('small',new Date(source.created_at).toLocaleString()+(source.value.truncated?' · 只保存了前一部分':''),detail);
          if(source.url){const link=element('a','打开出处',detail);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';}
          element('pre',source.value.text,detail);
        }catch(error){status.textContent=sourceProblem(error);}
      });
    }
  }
  const read=idea.url?button(section,'读取这个公开网页',async()=>{
    read.disabled=true;status.textContent='正在读取公开网页…';
    try{await api(prefix,{commandId:crypto.randomUUID(),action:'read',confirm:true});status.textContent='原文已保存，可以展开检查。';await show();}
    catch(error){status.textContent=sourceProblem(error);}finally{read.disabled=false;}
  }):null;
  const upload=element('input','',element('label','上传文字附件（TXT、Markdown、SRT）',section));
  upload.type='file';upload.accept='.txt,.md,.srt';
  upload.addEventListener('change',async()=>{
    const file=upload.files[0];if(!file)return;upload.disabled=true;
    try{
      if(file.size>192000)throw new Error('SOURCE_TOO_LARGE');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      if(text.length>64000)throw new Error('SOURCE_TOO_LARGE');
      await api(prefix,{commandId:crypto.randomUUID(),action:'attachment',name:file.name,text,confirm:true});
      upload.value='';status.textContent='附件已保存。';await show();
    }catch(error){status.textContent=sourceProblem(error);}finally{upload.disabled=false;}
  });
  show().catch(error=>{if(section.isConnected)status.textContent=sourceProblem(error);});
}
function sourceProblem(error){
  return ({SOURCE_PRIVATE_ADDRESS:'这个地址属于本机或内网。请粘贴公开网页，或上传文字附件。',
    SOURCE_UNREADABLE:'这个网页没有可直接读取的原文。可以保留链接，或上传你有权使用的文字。',
    SOURCE_UNAVAILABLE:'暂时连不上这个网页。原链接仍保留，可以稍后再试。',
    SOURCE_REDIRECT:'这个网页的跳转无法安全读取。请打开原链接核对。',
    SOURCE_TOO_LARGE:'这份内容太长，请缩短文字或分成几份上传。',
    SOURCE_URL_INVALID:'请使用公开网页的 HTTP 或 HTTPS 地址。'})[error.message]||describe(error);
}
