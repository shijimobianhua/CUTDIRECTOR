'use strict';

function renderCutProposal(card,turn,threadId,project,prefix,history,refreshContext,status) {
  const proposal=turn.proposal;
  const target=document.querySelector('[data-workbench-section=arrangement]');
  const editable=()=>{
    const state={dirty:true};
    target?.dispatchEvent(new CustomEvent('cutdirector-arrangement-state',{detail:state}));
    if(state.dirty){status.textContent='顺序里有未确认输入，请先确认或保留这些内容。';return false;}
    return true;
  };
  async function update(){
    const latest=await api('projects/'+project.id+'/arrangement');
    target?.dispatchEvent(new CustomEvent('cutdirector-arrangement-saved',{detail:latest}));
    await refreshContext();
  }
  if(proposal.appliedVersion){
    element('p','这份剪辑建议已确认成第 '+proposal.appliedVersion+' 版顺序。',card);
    if(proposal.appliedVersion>1)button(card,'撤销本次剪辑建议',async()=>{
      if(!editable())return;
      try {
        const result=await api('projects/'+project.id+'/arrangement/undo',{appliedVersion:proposal.appliedVersion,commandId:'undo_proposal_'+turn.id,confirm:true});
        await update();
        status.textContent='已撤销，保存为第 '+result.version+' 版顺序。';
      }catch(error){status.textContent=error.message==='ARRANGEMENT_CONFLICT'?'顺序已有后续改动。可以从历史中查看或恢复。':describe(error);}
    });
    return;
  }
  button(card,'查看重点剪辑建议',()=>{
    if(!editable())return;
    const dialog=element('dialog','',card);
    dialog.setAttribute('aria-label','确认重点剪辑建议');
    const draft=proposal.draft;
    element('h2','检查要留下的内容',dialog);
    element('p','原来 '+draft.originalSeconds+' 秒，建议保留 '+draft.actualSeconds+' 秒，目标不超过 '+draft.targetSeconds+' 秒。',dialog);
    element('p','依据已确认的第 '+proposal.baseVersion+' 版顺序和字幕。数字、否定、条件等 '+draft.protectedCount+' 条内容及相邻语境已按规则保留，仍需要你检查含义是否完整。',dialog);
    for(const cue of draft.keep){
      element('strong',(cue.startUs/1e6)+'–'+(cue.endUs/1e6)+' 秒 · 原话 '+cue.number,dialog);
      element('p',cue.text,dialog);
      element('small',cue.reason+(cue.mustKeep?' · 必须保留内容':''),dialog);
      for(const source of cue.sources||[]){
        const trigger=button(dialog,'看原视频这段',()=>openPreview(project,{id:source.assetId,name:source.name,previewRange:{inUs:source.inUs,outUs:source.outUs}},trigger,undefined,'返回剪辑建议'));
        element('small',source.name+' · '+source.inUs/1e6+'–'+source.outUs/1e6+' 秒',dialog);
      }
    }
    const message=element('p','',dialog);
    const actions=element('div','',dialog);actions.className='dialog-actions';
    let busy=false;
    const back=button(actions,'先不修改',()=>dialog.close());
    const go=button(actions,'确认保留这些内容',async()=>{
      if(busy||!editable())return;
      busy=true;go.disabled=back.disabled=true;
      try {
        const result=await api(prefix+'/'+threadId+'/proposals/'+turn.id+'/approve',{confirm:true});
        await update();dialog.close();await history();
        status.textContent='已确认第 '+result.version+' 版顺序，请预览检查，再交给剪映。';
      }catch(error){message.textContent=error.message==='ARRANGEMENT_CONFLICT'?'顺序已有新版本，请重新提出剪辑建议。':describe(error);}
      finally{busy=false;go.disabled=back.disabled=false;}
    },true);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.showModal();back.focus();
  });
}
