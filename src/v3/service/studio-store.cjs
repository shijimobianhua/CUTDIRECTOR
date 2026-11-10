'use strict';
const {randomUUID}=require('node:crypto');
const {digest}=require('./adapter-sdk.cjs');
const kinds=new Set(['episode','source','character','location','prop','concept','shot','clip','canvas']);
function issue(code,message,status=422){throw Object.assign(new Error(message||code),{code,status});}
const text=(v,max=4000)=>typeof v==='string'&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
function install(db){
 db.exec('BEGIN IMMEDIATE');
 try{
 db.exec([
 'CREATE TABLE IF NOT EXISTS studio_documents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS studio_document_scope ON studio_documents(project_id,kind)',
 'CREATE TABLE IF NOT EXISTS studio_revisions(document_id TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(document_id,version))',
 'CREATE TABLE IF NOT EXISTS studio_receipts(command_id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS studio_bindings(project_id TEXT PRIMARY KEY REFERENCES projects(id),episode_id TEXT,story_version INTEGER,episode_version INTEGER)',
 'CREATE TABLE IF NOT EXISTS assistant_chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS assistant_turns(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES assistant_chats(id),command_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,text TEXT NOT NULL,answer TEXT,context TEXT NOT NULL,created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS studio_settings(id TEXT PRIMARY KEY,version INTEGER NOT NULL,value TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS studio_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),command_id TEXT UNIQUE NOT NULL,connection_id TEXT NOT NULL,connection_version INTEGER NOT NULL,snapshot TEXT NOT NULL,state TEXT NOT NULL,external_id TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS studio_media(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,digest TEXT NOT NULL,metadata TEXT NOT NULL)',
 'PRAGMA user_version=33'
 ].join(';'));
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function createStudio(db,store){
 install(db);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function command(input,payload,fn){
  if(!text(input?.commandId,100)||!/^[-a-zA-Z0-9_]+$/.test(input.commandId))issue('INVALID_INPUT','请重新执行这次操作。');
  const fixed=JSON.stringify(payload);
  return transaction(()=>{const old=db.prepare('SELECT * FROM studio_receipts WHERE command_id=?').get(input.commandId);if(old){if(old.payload!==fixed)issue('IDEMPOTENCY_CONFLICT','这次操作的内容已变化，请重新准备。',409);return JSON.parse(old.result);}
   const result=fn();db.prepare('INSERT INTO studio_receipts VALUES (?,?,?)').run(input.commandId,fixed,JSON.stringify(result));return result;});
 }
 function rowView(row){return row?{id:row.id,projectId:row.project_id,kind:row.kind,version:row.version,archived:!!row.archived,updatedAt:row.updated_at,...JSON.parse(row.value)}:null;}
 function get(projectId,id){store.project(projectId);const row=db.prepare('SELECT * FROM studio_documents WHERE project_id=? AND id=?').get(projectId,id);if(!row)issue('DOCUMENT_NOT_FOUND','这份内容暂时找不到了。',404);return rowView(row);}
 function list(projectId,kind,includeArchived=false){store.project(projectId);if(kind&&!kinds.has(kind))issue('INVALID_INPUT');return db.prepare('SELECT * FROM studio_documents WHERE project_id=? AND (? IS NULL OR kind=?) AND (?=1 OR archived=0) ORDER BY updated_at DESC,rowid DESC').all(projectId,kind||null,kind||null,includeArchived?1:0).map(rowView);}
 function validate(projectId,kind,value){
  if(!kinds.has(kind)||!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>(kind==='source'?4500000:1000000))issue('DOCUMENT_INVALID','请缩小本次编辑内容。');
  if(Object.keys(value).some(k=>['__proto__','constructor','prototype','id','projectId','version','kind','archived','updatedAt'].includes(k)))issue('DOCUMENT_INVALID');
  if(!text(value.title,160)||!value.title.trim())issue('DOCUMENT_INVALID','请给这份内容起个名字。');
  if(value.episodeId){const ep=get(projectId,value.episodeId);if(ep.kind!=='episode')issue('DOCUMENT_INVALID','请选择正确的分集。');}
  if(kind==='episode'){
   if(!['16:9','9:16','1:1'].includes(value.ratio)||!Number.isSafeInteger(value.durationUs)||value.durationUs<1000000||value.durationUs>1500000000||!Array.isArray(value.scenes)||value.scenes.length>500)issue('DOCUMENT_INVALID','请选择画幅，将单集时长设在 25 分钟内。');
   const ids=new Set();
   for(const scene of value.scenes){if(!uuid(scene.id)||ids.has(scene.id)||!text(scene.title,160)||!Array.isArray(scene.blocks)||scene.blocks.length>2000)issue('DOCUMENT_INVALID','请检查场景内容。');ids.add(scene.id);
    for(const b of scene.blocks){if(!uuid(b.id)||ids.has(b.id)||!['action','dialogue','narration','inner','sound'].includes(b.type)||!text(b.text,12000)||b.speaker!=null&&!text(b.speaker,120))issue('DOCUMENT_INVALID','请检查动作和台词。');ids.add(b.id);}
   }
  }
  if(kind==='source'&&(!text(value.text,4000000)||!text(value.digest,64)||!/^[a-f0-9]{64}$/.test(value.digest)))issue('DOCUMENT_INVALID');
  if(kind==='shot'&&(!text(value.action,600)||!value.action.trim()||!Number.isSafeInteger(value.durationUs)||value.durationUs<250000||value.durationUs>1500000000))issue('DOCUMENT_INVALID','请填写画面，并检查镜头时长。');
  if(kind==='clip'&&(!Array.isArray(value.shotIds)||!value.shotIds.length||value.shotIds.length>60||value.shotIds.some(id=>get(projectId,id).kind!=='shot')))issue('DOCUMENT_INVALID','请先关联需要生成的镜头。');
  if(value.links!=null){if(!Array.isArray(value.links)||value.links.length>100)issue('DOCUMENT_INVALID');for(const ref of value.links){const target=get(projectId,ref.id);if(!Number.isSafeInteger(ref.version)||ref.version<1||ref.version>target.version)issue('DOCUMENT_INVALID','关联内容的版本不正确。');}}
  if(kind==='canvas'){if(!Array.isArray(value.nodes)||value.nodes.length>2000||!Array.isArray(value.edges)||value.edges.length>5000)issue('DOCUMENT_INVALID');const ids=new Set();for(const n of value.nodes){if(!db.prepare('SELECT 1 FROM studio_documents WHERE project_id=? AND id=?').get(projectId,n.id)&&!list(projectId,'episode').some(ep=>ep.scenes.some(s=>s.id===n.id)))issue('DOCUMENT_INVALID');if(ids.has(n.id)||![n.x,n.y].every(v=>Number.isFinite(v)&&Math.abs(v)<100000))issue('DOCUMENT_INVALID');ids.add(n.id);}for(const e of value.edges)if(!ids.has(e.source)||!ids.has(e.target)||!['contains','uses','related','next'].includes(e.type||'related'))issue('DOCUMENT_INVALID');}
  if(value.imageIds){if(!Array.isArray(value.imageIds)||value.imageIds.length>40)issue('DOCUMENT_INVALID');for(const id of value.imageIds)store.image(projectId,id);}
  return structuredClone(value);
 }
 function write(id,projectId,kind,version,value,archived=false){
  const now=new Date().toISOString();db.prepare('INSERT INTO studio_documents VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,value=excluded.value,archived=excluded.archived,updated_at=excluded.updated_at').run(id,projectId,kind,version,JSON.stringify(value),archived?1:0,now);
  db.prepare('INSERT INTO studio_revisions VALUES (?,?,?,?)').run(id,version,JSON.stringify({value,archived}),now);
  db.prepare('INSERT INTO events(type,subject_id,scope_id) VALUES (?,?,?)').run('studio.changed',id,projectId);return get(projectId,id);
 }
 function save(projectId,input){
  store.project(projectId);const id=input.id||randomUUID();if(!uuid(id)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)issue('DOCUMENT_INVALID');
  const value=validate(projectId,input.kind,input.value);
  return command(input,{projectId,...input},()=>{const old=db.prepare('SELECT * FROM studio_documents WHERE id=?').get(id);
   if(old&&(old.project_id!==projectId||old.kind!==input.kind))issue('DOCUMENT_INVALID');
   if((old?.version||0)!==input.expectedVersion)issue('DOCUMENT_CONFLICT','另一窗口已保存新版。当前输入仍在，请比较后保存。',409);
   if(old?.kind==='source')issue('SOURCE_IMMUTABLE','导入原文会永久保留，请在剧本里编辑改编内容。');
   return write(id,projectId,input.kind,input.expectedVersion+1,value);
  });
 }
 function batch(projectId,input){
  store.project(projectId);if(!Array.isArray(input.operations)||!input.operations.length||input.operations.length>1000)issue('DOCUMENT_INVALID');
  return command(input,{projectId,...input},()=>{
   const ids=new Set(),changes=input.operations.map(op=>{const id=op.id||randomUUID();if(!uuid(id)||ids.has(id)||!Number.isSafeInteger(op.expectedVersion))issue('DOCUMENT_INVALID');ids.add(id);const old=db.prepare('SELECT * FROM studio_documents WHERE id=?').get(id);if(old&&(old.project_id!==projectId||old.kind!==op.kind)||((old?.version||0)!==op.expectedVersion))issue('DOCUMENT_CONFLICT','内容已经变化，请重新读取。',409);if(old?.kind==='source')issue('SOURCE_IMMUTABLE');return {id,kind:op.kind,version:op.expectedVersion+1,value:validate(projectId,op.kind,op.value),archived:op.archived===true};});
   return changes.map(c=>write(c.id,projectId,c.kind,c.version,c.value,c.archived));
  });
 }
 function history(projectId,id){get(projectId,id);return db.prepare('SELECT version,created_at AS createdAt FROM studio_revisions WHERE document_id=? ORDER BY version DESC LIMIT 100').all(id);}
 function revision(projectId,id,number){get(projectId,id);const row=db.prepare('SELECT * FROM studio_revisions WHERE document_id=? AND version=?').get(id,number);if(!row)issue('DOCUMENT_NOT_FOUND','找不到该版本。',404);return {version:number,...JSON.parse(row.value)};}
 function restore(projectId,id,input){const current=get(projectId,id);const selected=revision(projectId,id,input.version);return save(projectId,{...input,id,kind:current.kind,value:selected.value});}
 function archive(projectId,id,input){return command(input,{projectId,id,...input},()=>{const old=get(projectId,id);if(old.version!==input.expectedVersion)issue('DOCUMENT_CONFLICT','内容已更新，请重新读取。',409);const {id:_id,projectId:_p,kind,version,updatedAt,archived,...value}=old;return write(id,projectId,kind,version+1,value,input.archived!==false);});}
 function ensure(projectId){
  store.project(projectId);if(list(projectId,'episode',true).length)return;
  transaction(()=>{if(list(projectId,'episode',true).length)return;
   const ep=randomUUID(),old=store.story(projectId);write(ep,projectId,'episode',1,{title:'第一集',order:1,ratio:old?.ratio||'9:16',durationUs:old?.durationUs||300000000,brief:old?.brief||'',style:old?.style||'',scenes:[]});
   for(const [i,shot]of (old?.shots||[]).entries())write(shot.id,projectId,'shot',1,{...shot,title:'镜头 '+(i+1),episodeId:ep,order:i,scriptVersion:1});
   if(old)db.prepare('INSERT OR IGNORE INTO studio_bindings VALUES (?,?,?,?)').run(projectId,ep,old.version,1);
  });
 }
 function overview(projectId){ensure(projectId);const docs=list(projectId);const versions=new Map(docs.map(d=>[d.id,d.version]));
  return {project:store.project(projectId),documents:docs.map(d=>({...d,staleLinks:(d.links||[]).filter(r=>versions.get(r.id)!==r.version)})),binding:db.prepare('SELECT * FROM studio_bindings WHERE project_id=?').get(projectId)||null};
 }
 function index(){return store.snapshot().projects.map(p=>{ensure(p.id);return {...p,episodes:list(p.id,'episode').map(({id,title,version,updatedAt})=>({id,title,version,updatedAt}))};});}
 function publish(projectId,id,input){
  const previous=db.prepare('SELECT result FROM studio_receipts WHERE command_id=?').get('publish_'+input.commandId);
  if(previous){const old=db.prepare('SELECT payload FROM studio_receipts WHERE command_id=?').get('publish_'+input.commandId);if(old.payload!==JSON.stringify({projectId,id,...input}))issue('IDEMPOTENCY_CONFLICT','操作内容已改变。',409);return JSON.parse(previous.result);}
  const ep=get(projectId,id);if(ep.kind!=='episode'||ep.archived||ep.version!==input.expectedVersion)issue('DOCUMENT_CONFLICT','分集已更新，请重新读取。',409);
  const shots=list(projectId,'shot').filter(s=>s.episodeId===id).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!shots.length)issue('DOCUMENT_INVALID','先为这一集添加分镜。');
  const story={brief:ep.brief||ep.title,audience:ep.audience||'',style:ep.style||'',ratio:ep.ratio,durationUs:ep.durationUs,shots:shots.map(s=>({id:s.id,action:s.action,durationUs:s.durationUs,startFrameIdea:s.startFrameIdea||'',endFrameIdea:s.endFrameIdea||'',assetId:s.assetId||null,...(s.startImageId?{startImageId:s.startImageId}:{}),...(s.endImageId?{endImageId:s.endImageId}:{})}))};
  const out=store.mutate('story',{commandId:input.commandId,projectId,expectedVersion:input.storyVersion,...story});
  transaction(()=>{db.prepare('INSERT INTO studio_bindings VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET episode_id=excluded.episode_id,story_version=excluded.story_version,episode_version=excluded.episode_version').run(projectId,id,out.version,ep.version);db.prepare('INSERT OR IGNORE INTO studio_receipts VALUES (?,?,?)').run('publish_'+input.commandId,JSON.stringify({projectId,id,...input}),JSON.stringify(out));});return out;
 }
 function context(projectId,episodeId){const data=overview(projectId);const episode=data.documents.find(d=>d.id===episodeId&&d.kind==='episode');if(!episode)issue('DOCUMENT_NOT_FOUND');
  return {projectId,episode,assets:data.documents.filter(d=>['character','location','prop','concept'].includes(d.kind)),shots:data.documents.filter(d=>d.kind==='shot'&&d.episodeId===episodeId),sources:data.documents.filter(d=>d.kind==='source').map(({id,title,digest,text})=>({id,title,digest,characters:text.length})),policy:'只根据已提供的原文和已确认内容提出修改；保留人物身份、否定、数字、关键台词与用户红线。'};
 }
 return {db,command,get,list,save,batch,archive,history,revision,restore,ensure,overview,index,publish,context,digest};
}
module.exports={createStudio,issue,text,uuid};
