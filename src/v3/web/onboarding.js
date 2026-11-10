'use strict';
function practiceProject(){
 const dialog=element('dialog','',page);element('h2','先练一次：做一条周末咖啡小短片',dialog);
 element('p','会创建一个包含主题和3个镜头文字的示例项目，没有图片和视频，也不会调用模型或花钱。你可以随意修改，再导入自己的素材。',dialog);
 const status=element('p','',dialog),commandId=crypto.randomUUID();let busy=false,exampleStory;
 button(dialog,'先返回首页',()=>{StudioUI.dismiss(dialog);});
 const create=button(dialog,'创建练习项目',async()=>{
  if(busy)return;busy=true;create.disabled=true;
  try{
   const p=await api('projects',{commandId,title:'练习 · 周末咖啡小短片',kind:'idea'});
   await api('projects/'+p.id+'/story',exampleStory||(exampleStory={commandId:commandId+'_story',expectedVersion:0,brief:'记录周末买咖啡、坐下放松的一小段生活',audience:'朋友与日常分享',style:'自然、轻松，保留真实生活感',ratio:'9:16',durationUs:25000000,
    shots:[{id:crypto.randomUUID(),action:'走到咖啡店门口，交代今天的目的地',durationUs:8000000,startFrameIdea:'街边咖啡店的门口',endFrameIdea:'推门走进店内'},
     {id:crypto.randomUUID(),action:'咖啡杯摆上桌，给一个清楚的细节画面',durationUs:8000000,startFrameIdea:'桌上留出杯子的位置',endFrameIdea:'咖啡杯和窗边光线'},
     {id:crypto.randomUUID(),action:'坐在窗边放松，用安静的画面结束',durationUs:9000000,startFrameIdea:'窗边座位和咖啡',endFrameIdea:'窗外街景'}]}));
   state=await api('bootstrap');StudioUI.dismiss(dialog);location.hash='/projects/'+p.id+'?section=story';
  }catch(error){status.textContent=describe(error);}finally{busy=false;create.disabled=false;}
 },true);dialog.showModal();
}
