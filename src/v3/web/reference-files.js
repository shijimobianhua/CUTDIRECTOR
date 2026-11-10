'use strict';
function projectReferenceFiles(project,workspace,director,refreshAssets){
  const section=element('section','',workspace);
  section.dataset.workbenchSection='reference';section.tabIndex=-1;
  element('h2','先放一些参考',section);
  referenceSearch(project,section);
  element('p','参考图和视频只帮助确定方向。明确选用后才会进入可用素材。分析在本机进行，不收取模型费用。',section);
  const input=element('input','',element('label','上传参考图片或视频',section));
  input.type='file';input.multiple=true;input.accept='.mp4,.mov,.png,.jpg,.jpeg';
  const status=element('p','',section);status.setAttribute('role','status');
  const list=element('div','',section);list.className='cards';
  const prefix='projects/'+project.id+'/reference-files';
  const attempts=new WeakMap();
  input.addEventListener('change',async()=>{
    const files=[...input.files];input.disabled=true;
    try{
      for(const file of files){
        if(!attempts.has(file))attempts.set(file,crypto.randomUUID());
        status.textContent='正在保存参考「'+file.name+'」…';
        const kind=/\.(png|jpe?g)$/i.test(file.name)?'image':'video';
        const response=await fetch('./v3/'+prefix+'?'+new URLSearchParams({name:file.name,kind,commandId:attempts.get(file)}),
          {method:'POST',headers:{'X-Cutdirector-Session':session,'Content-Type':'application/octet-stream'},body:file});
        const value=await response.json();if(!response.ok)throw new Error(value.error?.code);
        attempts.delete(file);
      }
      status.textContent='参考已保存，尚未加入成片素材。';input.value='';await refresh();
    }catch(error){status.textContent=describe(error);}
    finally{input.disabled=false;}
  });
  async function refresh(){
    try{
      const files=await api(prefix);if(!section.isConnected)return;list.replaceChildren();
      if(!files.length)element('p','还没有参考。可以先从一张图或一个短视频开始。',list);
      for(const file of files){
        const card=element('article','',list);card.className='card';
        element('h3',file.name,card);element('small','只作参考 · '+(file.kind==='image'?'图片':file.durationUs/1e6+' 秒'),card);
        const route=prefix+'/'+file.id+'/';
        const preview=button(card,'查看参考',()=>{
          if(file.kind==='video')return openPreview(project,file,preview,route+'content','返回参考');
          const dialog=element('dialog','',card);dialog.setAttribute('aria-label','参考图片');
          const back=button(dialog,'返回参考',()=>dialog.close());
          const img=element('img','',dialog);img.src='./v3/'+route+'content';img.alt=file.name;img.className='generated-frame';
          dialog.addEventListener('close',()=>{dialog.remove();preview.focus();},{once:true});dialog.showModal();back.focus();
        });
        button(card,'选为可用素材',()=>confirmUse(file,card));
        if(file.kind==='video'){
          const result=element('div','',card);
          async function show(data){
            result.replaceChildren();if(!data)return;
            element('p',data.note,result);
            element('p','检测到 '+data.cutCount+' 处可能的切镜，采样 '+data.frames.length+' 张画面。',result);
            const gallery=element('div','',result);gallery.className='story-frames';
            for(const frame of data.frames){
              const figure=element('figure','',gallery);
              const image=element('img','',figure);image.src='./v3/'+route+'frames/'+frame.number;
              image.alt='参考视频第 '+(frame.timeUs/1e6).toFixed(2)+' 秒';image.className='generated-frame';
              element('figcaption',(frame.timeUs/1e6).toFixed(2)+' 秒',figure);
            }
            if(data.cutTimesUs.length)element('p','可能的切镜时间（秒） '+data.cutTimesUs.map(us=>(us/1e6).toFixed(2)).join('、'),result);
            button(result,'让导演参考这份分析',()=>director.reference?.('请参考「'+file.name+'」的结构来给制作建议。本机分析只检测到可能的切镜点，未理解画面内容。视频 '+data.durationUs/1e6+' 秒，可能切镜 '+data.cutCount+' 处，时间点（秒） '+data.cutTimesUs.slice(0,40).map(us=>(us/1e6).toFixed(2)).join('、')+'。请先问我希望借鉴什么，不能声称已经看过画面。'));
          }
          const analyze=button(card,'在本机分析参考',async()=>{
            analyze.disabled=true;status.textContent='正在提取参考画面和切镜点…';
            try{await show(await api(route+'analysis',{confirm:true}));status.textContent='本机分析完成，画面含义仍需要检查。';}
            catch(error){status.textContent=error.message==='REFERENCE_TOO_LONG'?'请选 25 分钟以内的参考视频。':describe(error);}
            finally{analyze.disabled=false;}
          });
          api(route+'analysis').then(show).catch(()=>{});
        }
      }
    }catch(error){if(section.isConnected)status.textContent=describe(error);}
  }
  function confirmUse(file,card){
    const dialog=element('dialog','',card);dialog.setAttribute('aria-label','选用参考素材');
    element('h2','把参考加入可用素材？',dialog);element('p',file.name,dialog);
    element('p','请确认你有权将这份内容用于作品。确认后只加入素材库，还需要在分镜或顺序中选用。',dialog);
    const message=element('p','',dialog);let busy=false;const commandId=crypto.randomUUID();
    const back=button(dialog,'继续只作参考',()=>dialog.close());
    const go=button(dialog,'确认加入可用素材',async()=>{
      if(busy)return;busy=true;go.disabled=back.disabled=true;
      try{await api(prefix+'/'+file.id+'/use',{commandId,confirm:true});await refreshAssets();dialog.close();status.textContent='已加入可用素材，参考原件仍保留。';}
      catch(error){message.textContent=describe(error);}finally{busy=false;go.disabled=back.disabled=false;}
    },true);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
  }
  refresh();
}
