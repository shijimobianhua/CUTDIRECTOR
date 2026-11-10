'use strict';
const viewSessions=new Map();
function openView(scope,onError=()=>{}){
 if(!viewSessions.has(scope)){
  let version=0,value=null,conflicted=false,loaded=false,loading=null,pending=Promise.resolve(),lastDraft;
  async function ensure(){if(loaded)return;if(!loading)loading=api('views?'+new URLSearchParams({scope})).then(r=>{version=r.version;value=r.value;loaded=true;}).finally(()=>{loading=null;});await loading;}
  const controller={
   read(){return pending.catch(()=>{}).then(async()=>{await ensure();return structuredClone(value);});},
   write(next){const copy=structuredClone(next);lastDraft=copy;const task=pending.catch(()=>{}).then(async()=>{
    await ensure();if(conflicted)throw Object.assign(Error('VIEW_CONFLICT'),{scope});
    try{const saved=await api('views',{scope,expectedVersion:version,value:copy});version=saved.version;value=copy;}
    catch(e){const current=await api('views?'+new URLSearchParams({scope})).catch(()=>null);if(current&&JSON.stringify(current.value)===JSON.stringify(copy)){version=current.version;value=copy;return;}if(e.message==='VIEW_CONFLICT')conflicted=true;throw Object.assign(e,{scope});}
   });pending=task;return task;},
   retry(){return lastDraft===undefined?controller.read():controller.write(lastDraft);},
   export(){return structuredClone(lastDraft??value);},
   reload(){loaded=false;conflicted=false;return controller.read();}
  };viewSessions.set(scope,controller);
 }
 const c=viewSessions.get(scope);
 return {ready:c.read(),read:()=>c.read(),retry:()=>c.retry(),reload:()=>c.reload(),export:()=>c.export(),write(value){const task=c.write(value);task.catch(e=>onError(Object.assign(e,{scope})));return task;}};
}
function downloadLocalDraft(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='CUTDIRECTOR-'+name+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function viewError(error,scope=error.scope){
 if(scope==='global')return error.message==='OPEN_FROM_DSH'?'页面连接需要更新，请从 DSH 侧栏重新打开。当前页面位置暂未保存。':'页面位置暂未保存，你可以继续操作。重新连接后会再保存。';
 return error.message==='VIEW_CONFLICT'?'另一窗口保存了新版。当前文字仍在，请先复制或导出，再比较后继续。':'草稿暂未保存。当前文字仍在，请先复制或导出；连接恢复后可重试保存。';
}
