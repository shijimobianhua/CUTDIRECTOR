'use strict';
const {randomUUID}=require('node:crypto');
function issue(code,status=422){return Object.assign(new Error(code),{code,status});}
function createQuality(db,project,asset,image,story){
 function list(projectId){
  project(projectId);
  return db.prepare('SELECT * FROM quality_checks WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 300').all(projectId).map(row=>({...row}));
 }
 function add(projectId,input){
  project(projectId);
  if(!input||Object.keys(input).some(key=>!['commandId','kind','targetId','storyVersion','timeUs','verdict','note','confirm'].includes(key))||
   input.confirm!==true||!['image','video'].includes(input.kind)||!['accepted','issue'].includes(input.verdict)||
   typeof input.note!=='string'||input.note.length>1000||!Number.isSafeInteger(input.timeUs)||input.timeUs<0||
   typeof input.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId))throw issue('QUALITY_INVALID');
  const payload=JSON.stringify({projectId,...input});
  const previous=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
  if(previous){if(previous.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);return JSON.parse(previous.result);}
  const target=(input.kind==='image'?image:asset)(projectId,input.targetId),saved=story(projectId);
  if(input.storyVersion!==(saved?.version||0))throw issue('QUALITY_STALE',409);
  if(input.kind==='image'&&input.timeUs!==0||input.kind==='video'&&input.timeUs>target.durationUs)throw issue('QUALITY_INVALID');
  db.exec('BEGIN IMMEDIATE');
  try{
   const receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
   if(receipt){if(receipt.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);db.exec('COMMIT');return JSON.parse(receipt.result);}
   const id=randomUUID(),created=new Date().toISOString();
   db.prepare('INSERT INTO quality_checks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,input.kind,input.targetId,target.digest,input.storyVersion,input.timeUs,input.verdict,input.note,'manual',created);
   const result=list(projectId).find(row=>row.id===id);
   db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
   db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('quality.recorded',?,?)").run(id,projectId);
   db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {list,add};
}
module.exports={createQuality};
