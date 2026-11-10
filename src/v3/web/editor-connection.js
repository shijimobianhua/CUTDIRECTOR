'use strict';
function editorConnection(){
 const section=element('section','');
 element('h2','连接剪映',section);
 element('p','选一次剪映程序和草稿位置，之后都在这里继续。只有你确认创建草稿时，才会写入剪映。',section);
 const status=element('p','正在检查连接…',section);status.setAttribute('role','status');
 const controls=element('div','',section);controls.className='actions';
 const message={NATIVE_CONNECTION_BUSY:'正在处理另一项连接操作，请稍等。',NATIVE_CONNECTION_CONFLICT:'连接设置已更新，请重新读取后再操作。',
  NATIVE_SELECTION_REQUIRED:'先选择剪映程序和草稿位置，再检查连接。',NATIVE_PATH_INVALID:'这个位置暂时不能使用。草稿库需要先在剪映中新建一个空白项目，然后退出剪映。',
  NATIVE_PICKER_UNAVAILABLE:'文件选择窗口没有完成。可以稍后重试，或先下载素材包。',
  DRAFT_RUNTIME_UNAVAILABLE:'剪映交接组件暂时不可用，请更新工作台插件。你仍可下载素材包继续制作。',
  EDITOR_OPEN:'请先保存并退出剪映，再检查连接。',EDITOR_UNVERIFIED:'这个剪映版本还没有通过验证，目前可以使用素材包继续制作。',
  DRAFT_WRITER_BUSY:'有一份草稿正在创建，完成后再更改连接。'};
 let current,busy=false;
 async function load(){
  try{const value=await api('editor-settings');if(!section.isConnected)return;current=value;render();}
  catch(error){status.textContent=describe(error);}
 }
 function render(){
  controls.replaceChildren();
  status.textContent=!current.componentsReady?'剪映交接组件还需要更新，仍可使用素材包继续制作。':
   current.enabled?'已经连接，可以在交付区检查并创建新草稿。':
   (current.editorChosen?'已选择剪映程序。':'还没有选择剪映程序。')+(current.libraryChosen?'已选择草稿位置，请检查连接。':'还需要选择草稿位置。');
  for(const [action,title]of [['pick-editor',current.editorChosen?'重新选择剪映程序':'选择剪映程序'],['default-library','使用剪映默认草稿位置'],['pick-library','选择其他草稿位置'],['check','检查并启用连接'],['disable','停用剪映连接']]){
   const control=button(controls,title,()=>perform(action),action==='check');
   control.disabled=busy||!current.componentsReady&&action!=='disable'||action==='disable'&&!current.enabled;
  }
 }
 async function perform(action){
  if(busy)return;busy=true;render();
  status.textContent=action.startsWith('pick-')?'请在打开的选择窗口中选择，取消后会保留原设置。':'正在检查连接…';
  try{current=await api('editor-settings',{action,expectedVersion:current.version});if(section.isConnected)render();}
  catch(error){if(section.isConnected)status.textContent=message[error.message]||describe(error);}
  finally{busy=false;const text=status.textContent;render();status.textContent=text;}
 }
 button(section,'重新读取连接',load);load();
}
