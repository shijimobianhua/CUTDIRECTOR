'use strict';
function beatcutControl(section,project,current,accept,hasEdits){
 button(section,'按音乐节奏安排换画面',()=>{
  if(hasEdits()){const status=section.querySelector('[role=status]');status.textContent='先确认当前片段顺序，再安排音乐节奏。';return;}
  const base=current();if(!base){section.querySelector('[role=status]').textContent='先确认一份片段顺序，再安排节奏。';return;}
  const dialog=element('dialog','',section);element('h3','让换画面对上音乐节奏',dialog);
  element('p','适合旅行、风景和画面合集。填写音乐速度后先看方案，配乐在剪映里添加和对齐。',dialog);
  const form=element('form','',dialog),status=element('p','',dialog);status.setAttribute('role','status');
  function number(title,value,min,max,step){const input=element('input','',element('label',title,form));input.type='number';input.min=min;input.max=max;input.step=step;input.value=value;input.required=true;return input;}
  const bpm=number('音乐速度（BPM，不清楚可先试120）',120,30,300,0.1),beats=number('每几拍换一次画面',4,1,16,1),seconds=number('成片多少秒',Math.min(30,base.durationUs/1e6),1,Math.min(1500,base.durationUs/1e6),0.001);
  const preview=element('button','看看节奏方案',form),result=element('div','',dialog);
  button(dialog,'返回编排',()=>{StudioUI.dismiss(dialog);});
  form.addEventListener('submit',async event=>{event.preventDefault();preview.disabled=true;result.replaceChildren();
   try{const plan=await api('projects/'+project.id+'/arrangement/beat-preview',{expectedVersion:base.version,bpm:Number(bpm.value),beatsPerCut:Number(beats.value),seconds:Number(seconds.value)});
    element('p',plan.warning,result);element('p','共 '+plan.clips.length+' 段，'+(plan.durationUs/1e6)+' 秒，尚未修改已确认版本。',result);
    const list=element('ol','',result);for(const clip of plan.clips.slice(0,12))element('li',clip.name+' · '+(clip.inUs/1e6).toFixed(2)+'到'+(clip.outUs/1e6).toFixed(2)+'秒',list);
    if(plan.clips.length>12)element('p','这里显示前12段，放入编排后可逐段检查。',result);
    button(result,'放入编排，继续检查',()=>{if(hasEdits()||current()?.version!==plan.expectedVersion){status.textContent='编排已有修改，请返回后重新生成节奏方案。';return;}accept(plan);StudioUI.dismiss(dialog);},true);
   }catch(error){status.textContent=error.explanation||describe(error);}finally{preview.disabled=false;}
  });dialog.showModal();
 });
}
