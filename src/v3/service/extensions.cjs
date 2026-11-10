'use strict';
const {randomUUID}=require('node:crypto'),{validateManifest,builtins}=require('./registry.cjs'),{digest,validate}=require('./adapter-sdk.cjs');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function createExtensions(db,project,story,assets,registry,media){
 db.exec("UPDATE extension_jobs SET state='unknown' WHERE state='running';UPDATE extension_jobs SET state='queued' WHERE state='checking';UPDATE extension_jobs SET state='collect_failed' WHERE state='collecting'");
 const workspace=media?require('./artifact-workspace.cjs').createArtifactWorkspace(media.root,media):null;
 function list(){return db.prepare('SELECT * FROM extension_versions ORDER BY rowid DESC').all().map(row=>({...row,manifest:JSON.parse(row.manifest),selected:!!row.selected}));}
 function register(input){
 const manifest=validateManifest(input.manifest);
 if(input.confirm!==true||!/^cutdirector_adapter_[a-zA-Z0-9_]{1,100}$/.test(input.toolName)||builtins.some(item=>item.pluginId===manifest.pluginId))fail('PLUGIN_APPROVAL_REQUIRED',403);
 if(manifest.entryType!=='dsh-service'||manifest.permissions.includes('draft-write')||manifest.capabilities.some(c=>!['text-advice','reference-analysis','roughcut','beatcut','reference-search','image-generation','video-generation'].includes(c)))fail('EXTENSION_SCOPE_UNSUPPORTED',422);
 const generating=manifest.capabilities.some(c=>['image-generation','video-generation'].includes(c));
 if(generating&&(!manifest.permissions.includes('media-read')||!manifest.permissions.includes('paid-generation')&&manifest.cost!=='free'))fail('EXTENSION_SCOPE_UNSUPPORTED',422);
 const value=JSON.stringify(manifest),hash=digest(manifest),old=db.prepare('SELECT * FROM extension_versions WHERE plugin_id=? AND version=?').get(manifest.pluginId,manifest.version);
 if(old){if(old.digest!==hash||old.tool_name!==input.toolName)fail('PLUGIN_VERSION_CONFLICT');return old;}
 db.prepare('INSERT INTO extension_versions VALUES (?,?,?,?,?,?,?)').run(manifest.pluginId,manifest.version,hash,input.toolName,value,0,new Date().toISOString());
 return {pluginId:manifest.pluginId,version:manifest.version,digest:hash};
 }
 function select(input){
 if(input.confirm!==true)fail('PLUGIN_APPROVAL_REQUIRED',403);
 const row=db.prepare('SELECT * FROM extension_versions WHERE plugin_id=? AND version=?').get(input.pluginId,input.version);if(!row)fail('PLUGIN_NOT_REGISTERED',404);
 const current=db.prepare('SELECT digest FROM extension_versions WHERE plugin_id=? AND selected=1').get(input.pluginId);
 if((current?.digest||null)!==(input.expectedDigest||null))fail('PLUGIN_CONFLICT');
 db.exec('BEGIN IMMEDIATE');try{
 db.prepare('UPDATE extension_versions SET selected=0 WHERE plugin_id=?').run(input.pluginId);
 db.prepare('UPDATE extension_versions SET selected=1 WHERE plugin_id=? AND version=?').run(input.pluginId,input.version);
 db.prepare('INSERT INTO capability_states VALUES (?,1,0,NULL) ON CONFLICT(id) DO UPDATE SET version=version+1,enabled=0,probe=NULL').run(input.pluginId);
 db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 return list();
 }
 function entry(id){const row=db.prepare('SELECT * FROM extension_versions WHERE plugin_id=? AND selected=1').get(id);if(!row)fail('PLUGIN_NOT_REGISTERED',404);return {...row,manifest:JSON.parse(row.manifest)};}
 function job(projectId,id){project(projectId);const row=db.prepare('SELECT * FROM extension_jobs WHERE project_id=? AND id=?').get(projectId,id);if(!row)fail('TASK_NOT_FOUND',404);return {...row,snapshotDigest:digest(JSON.parse(row.snapshot)),snapshot:JSON.parse(row.snapshot),result:row.result?JSON.parse(row.result):null};}
 function jobs(projectId){project(projectId);return db.prepare('SELECT id FROM extension_jobs WHERE project_id=? ORDER BY rowid DESC LIMIT 50').all(projectId).map(row=>job(projectId,row.id));}
 function prepare(projectId,input){
 project(projectId);const selected=entry(input.pluginId);registry.requireEnabled(input.pluginId);
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000||typeof input.commandId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.commandId))fail('INVALID_INPUT',400);
 const capability=input.capability||selected.manifest.capabilities[0];if(!selected.manifest.capabilities.includes(capability))fail('EXTENSION_SCOPE_UNSUPPORTED',422);
 const saved=story(projectId),snapshot={request:input.text,projectId,storyVersion:saved?.version||0,
  ...(input.includeStory===true?{story:saved}:{}),...(input.includeMedia===true?{assets:assets(projectId).map(({id,name,durationUs,width,height})=>({id,name,durationUs,width,height}))}:{} )};
 const generating=['image-generation','video-generation'].includes(capability);
 if(generating){
 const shot=saved?.shots.find(shot=>shot.id===input.shotId);if(!shot)fail('SHOT_NOT_FOUND',404);
 if(capability==='image-generation'&&!['start','end'].includes(input.frame))fail('INVALID_INPUT',400);
 const seconds=Number(input.seconds||5);if(!Number.isInteger(seconds)||seconds<1||seconds>30)fail('INVALID_INPUT',400);
 Object.assign(snapshot,{capability,shotId:shot.id,shot:{...shot},ratio:saved.ratio,...(capability==='image-generation'?{frame:input.frame}:{seconds})});
 }
 const ids=input.referenceIds||[];if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))fail('INVALID_INPUT',400);
 if(ids.length){
 if(!media||!selected.manifest.permissions.includes('media-read')||!selected.manifest.permissions.includes('media-upload'))fail('EXTENSION_UPLOAD_NOT_DECLARED',403);
 snapshot.references=ids.map(id=>{let source,kind='image';try{source=media.image(projectId,id);}catch(error){if(error.code!=='ASSET_NOT_FOUND')throw error;kind='video';source=media.asset(projectId,id);}
 return {id,kind,digest:source.digest,name:source.name,contentType:source.contentType};});
 }
 if(input.pluginId==='cutdirector-native-codex-image'&&snapshot.references?.some(ref=>ref.kind!=='image'))fail('INVALID_INPUT',400);
 if(input.model){if(!input.model||typeof input.model.provider!=='string'||typeof input.model.id!=='string'||input.model.provider.length>200||input.model.id.length>200)fail('INVALID_MODEL',400);snapshot.model={provider:input.model.provider,id:input.model.id};}
 if(input.pluginId==='cutdirector-native-dsh-analysis'&&!snapshot.model)fail('INVALID_MODEL',400);
 validate(snapshot,selected.manifest.inputSchema);
 const payload=JSON.stringify({pluginId:input.pluginId,commandId:input.commandId,snapshot}),old=db.prepare('SELECT * FROM extension_jobs WHERE command_id=?').get(input.commandId);
 if(old){if(old.project_id!==projectId||old.payload!==payload)fail('IDEMPOTENCY_CONFLICT');return job(projectId,old.id);}
 const id=randomUUID();db.prepare('INSERT INTO extension_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,input.commandId,payload,input.pluginId,selected.digest,JSON.stringify(snapshot),'awaiting_approval',Date.now()+900000,null,new Date().toISOString(),null);return job(projectId,id);
 }
 function fixed(current){const selected=entry(current.plugin_id);registry.requireEnabled(current.plugin_id);if(selected.digest!==current.digest)fail('EXTENSION_CHANGED');return selected;}
 function claim(projectId,id,input){
 const current=job(projectId,id);if(current.state!=='awaiting_approval')return {...current,dispatch:false};
 const selected=fixed(current);if(current.expires_at<Date.now())fail('APPROVAL_EXPIRED');
 if(input.confirm!==true||input.snapshotDigest!==digest(current.snapshot)||input.allowUnknownCost!==true&&selected.manifest.cost!=='free'||current.snapshot.references?.length&&input.allowUpload!==true)fail('EXTENSION_APPROVAL_REQUIRED',403);
 if((story(projectId)?.version||0)!==current.snapshot.storyVersion)fail('STORY_CONFLICT');
 const changed=db.prepare("UPDATE extension_jobs SET state='running' WHERE id=? AND state='awaiting_approval'").run(id).changes;
 return {...job(projectId,id),dispatch:!!changed,toolName:selected.tool_name,manifest:selected.manifest};
 }
 async function inputs(projectId,id){const current=job(projectId,id);if(!['running','checking'].includes(current.state)||!workspace)fail('EXTENSION_NOT_RUNNING');return workspace.prepare(current);}
 function claimCheck(projectId,id){
 const current=job(projectId,id);
 if(current.state==='collect_failed')return {...current,dispatch:false,collect:true};
 const selected=fixed(current);
 if(current.state!=='queued'||!current.result?.externalId)return {...current,dispatch:false};
 const changed=db.prepare("UPDATE extension_jobs SET state='checking' WHERE id=? AND state='queued'").run(id).changes;
 return {...job(projectId,id),dispatch:!!changed,toolName:selected.tool_name,manifest:selected.manifest,externalId:current.result.externalId};
 }
 async function collect(projectId,id){
 const current=job(projectId,id);if(!['collect_failed','collecting'].includes(current.state)||!current.result?.pending)return current;
 db.prepare("UPDATE extension_jobs SET state='collecting' WHERE id=?").run(id);
 try{
 const artifacts=await workspace.collect(current,current.result.pending);
 const still=job(projectId,id);if(still.state!=='collecting')return still;
 const result={...current.result,artifacts,advisoryOnly:false};delete result.pending;
 db.prepare("UPDATE extension_jobs SET state='complete',result=? WHERE id=? AND state='collecting'").run(JSON.stringify(result),id);
 }catch{db.prepare("UPDATE extension_jobs SET state='collect_failed' WHERE id=? AND state='collecting'").run(id);}
 return job(projectId,id);
 }
 async function finish(projectId,id,input){
 const current=job(projectId,id);if(!['running','checking'].includes(current.state))return current;
 let result=current.result,state=current.state==='checking'?'queued':'unknown';
 if(input.ok===true){try{
 const selected=db.prepare('SELECT manifest FROM extension_versions WHERE plugin_id=? AND digest=?').get(current.plugin_id,current.digest);if(!selected)fail('EXTENSION_CHANGED');
 const manifest=JSON.parse(selected.manifest);validate(input.result,manifest.outputSchema);
 if(typeof input.result?.text!=='string'||input.result.text.length>12000)fail('EXTENSION_OUTPUT_INVALID',422);
 const base={text:input.result.text,title:manifest.title,executor:current.plugin_id,versionDigest:current.digest,advisoryOnly:true,evidenceDigest:digest(current.snapshot),storyVersion:current.snapshot.storyVersion};
 if(current.plugin_id==='cutdirector-native-dsh-analysis')base.isolation={mode:'scoped-readonly',steps:input.result.isolation?.steps||0,reads:input.result.isolation?.reads||0};
 if(input.result.state==='submitted'){
 if(manifest.resume!=='poll'||typeof input.result.externalId!=='string'||!input.result.externalId.length||input.result.externalId.length>240||current.result?.externalId&&current.result.externalId!==input.result.externalId)fail('EXTENSION_OUTPUT_INVALID');
 result={...base,externalId:input.result.externalId};state='queued';
 }else if(['image-generation','video-generation'].includes(current.snapshot.capability)){
 if(!workspace||!Array.isArray(input.result.artifacts)||!input.result.artifacts.length)fail('EXTENSION_OUTPUT_INVALID');
 result={...base,pending:{artifacts:input.result.artifacts.map(({file,kind,sha256})=>({file,kind,...(sha256?{sha256}:{})}))},externalId:current.result?.externalId||null};state='collecting';
 }else{result=base;state='complete';}
 }catch{state='failed';result={text:'扩展返回的内容没有通过检查。请核对工具端结果，勿重复付费发送。'};}}
 db.prepare('UPDATE extension_jobs SET state=?,result=? WHERE id=? AND state=?').run(state,result?JSON.stringify(result):null,id,current.state);
 return state==='collecting'?collect(projectId,id):job(projectId,id);
 }
 function cancel(projectId,id){
 const current=job(projectId,id);if(!['awaiting_approval','running','checking','queued'].includes(current.state))return current;
 db.prepare("UPDATE extension_jobs SET state=? WHERE id=? AND state=?").run(current.state==='awaiting_approval'?'cancelled':'unknown',id,current.state);
 return job(projectId,id);
 }
 return {list,register,select,entry,prepare,claim,inputs,claimCheck,collect,finish,cancel,jobs,job};
}
module.exports={createExtensions};
