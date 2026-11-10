'use strict';
const {existsSync,realpathSync,statSync}=require('node:fs'),{join,basename,isAbsolute,relative,sep}=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createDraftAdapter}=require('./delivery.cjs');
const run=promisify(execFile);
function issue(code,status=409){return Object.assign(new Error(code),{code,status});}
function createNativeSettings(db){
 function get(){const row=db.prepare("SELECT * FROM local_connections WHERE name='jianying'").get();return row?{version:row.version,...JSON.parse(row.value)}:null;}
 function save(expectedVersion,value){
  if(db.prepare("SELECT 1 FROM drafts WHERE state='writing' LIMIT 1").get())throw issue('DRAFT_WRITER_BUSY');
  const current=get();
  if((current?.version||0)!==expectedVersion)throw issue('NATIVE_CONNECTION_CONFLICT');
  const record={editor:value.editor||null,draftRoot:value.draftRoot||null,enabled:value.enabled===true,checkedAt:value.checkedAt||null};
  db.prepare("INSERT INTO local_connections VALUES ('jianying',?,?) ON CONFLICT(name) DO UPDATE SET version=excluded.version,value=excluded.value")
   .run(expectedVersion+1,JSON.stringify(record));return get();
 }
 return {get,save};
}
async function chooseNative(kind,signal){
 if(process.platform!=='win32')throw issue('NATIVE_PICKER_UNAVAILABLE',503);
 const body=kind==='editor'?
 "$dialog=New-Object System.Windows.Forms.OpenFileDialog;$dialog.Title='选择剪映专业版程序';$dialog.Filter='剪映专业版 (JianyingPro.exe)|JianyingPro.exe';$dialog.CheckFileExists=$true;if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write((ConvertTo-Json -InputObject $dialog.FileName -Compress))}else{[Console]::Write('null')}":
 "$dialog=New-Object System.Windows.Forms.FolderBrowserDialog;$dialog.Description='选择剪映草稿文件夹';$dialog.ShowNewFolderButton=$false;if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write((ConvertTo-Json -InputObject $dialog.SelectedPath -Compress))}else{[Console]::Write('null')}";
 const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;"+body+";$dialog.Dispose()";
 try{const {stdout}=await run('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,timeout:180000,maxBuffer:16384,signal});return JSON.parse(stdout);}
 catch{throw issue('NATIVE_PICKER_UNAVAILABLE',503);}
}
function createNativeConnection(store,root,baseline,onChange,{choose=chooseNative,probe,componentsReady}={}){
 const controllers=new Set();let active=false,closed=false;
 function components(){return componentsReady??!!(baseline?.python&&baseline?.jyr&&existsSync(baseline.python)&&existsSync(join(baseline.jyr,'jyr','plan.py')));}
 function selected(){const saved=store.native.get();return saved||{version:0,editor:baseline?.editor||null,draftRoot:baseline?.draftRoot||null,enabled:!!baseline?.editor&&!!baseline?.draftRoot};}
 function runtime(){const value=selected();return {...baseline,...value,editor:value.enabled?value.editor:null,draftRoot:value.enabled?value.draftRoot:null};}
 function view(){
  const value=selected();return {version:value.version,componentsReady:components(),editorChosen:!!value.editor,libraryChosen:!!value.draftRoot,
   enabled:value.enabled,checkedAt:value.checkedAt||null};
 }
 function pathAllowed(value,kind){
  if(typeof value!=='string'||!isAbsolute(value)||!existsSync(value))throw issue('NATIVE_PATH_INVALID',422);
  const path=realpathSync(value),info=statSync(path);
  if(kind==='editor'&&(!info.isFile()||basename(path).toLowerCase()!=='jianyingpro.exe')||kind==='library'&&!info.isDirectory())throw issue('NATIVE_PATH_INVALID',422);
  const overlaps=(a,b)=>{const rel=relative(a,b);return !rel||!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);};
  if(overlaps(realpathSync(root),path)||overlaps(path,realpathSync(root)))throw issue('NATIVE_PATH_INVALID',422);
  return path;
 }
 async function action(input){
  if(!input||Object.keys(input).some(key=>!['action','expectedVersion'].includes(key))||
   !['pick-editor','pick-library','default-library','check','disable'].includes(input.action)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw issue('INVALID_INPUT',400);
  if(active||closed)throw issue('NATIVE_CONNECTION_BUSY');
  if(!components()&&input.action!=='disable')throw issue('DRAFT_RUNTIME_UNAVAILABLE',503);
  if(selected().version!==input.expectedVersion)throw issue('NATIVE_CONNECTION_CONFLICT');
  active=true;const controller=new AbortController();controllers.add(controller);
  try{
   let next={...selected(),enabled:false,checkedAt:null};
   if(input.action==='pick-editor'||input.action==='pick-library'){
    const kind=input.action==='pick-editor'?'editor':'library',picked=await choose(kind,controller.signal);
    if(picked==null)return view();
    next[kind==='editor'?'editor':'draftRoot']=pathAllowed(picked,kind);
   }else if(input.action==='default-library'){
    next.draftRoot=pathAllowed(join(process.env.LOCALAPPDATA||'','JianyingPro','User Data','Projects','com.lveditor.draft'),'library');
   }else if(input.action==='check'){
    if(!next.editor||!next.draftRoot)throw issue('NATIVE_SELECTION_REQUIRED',422);
    await (probe||((config)=>createDraftAdapter(root,config).probe()))({...baseline,...next});
    next.enabled=true;next.checkedAt=new Date().toISOString();
   }
   if(closed||controller.signal.aborted)throw issue('NATIVE_CONNECTION_BUSY');
   store.native.save(input.expectedVersion,next);
   onChange(runtime());return view();
  }finally{active=false;controllers.delete(controller);}
 }
 return {view,runtime,action,stop(){closed=true;for(const controller of controllers)controller.abort();}};
}
module.exports={createNativeSettings,createNativeConnection,chooseNative};
