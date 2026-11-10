'use strict';
const {randomUUID}=require('node:crypto');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function createIdeaFiles(db,ideas,mutate,references){
 function list(ideaId){ideas.get(ideaId);return db.prepare('SELECT * FROM idea_files WHERE idea_id=? ORDER BY rowid DESC').all(ideaId).map(row=>({id:row.id,digest:row.digest,...JSON.parse(row.metadata)}));}
 function file(ideaId,id){const found=list(ideaId).find(item=>item.id===id);if(!found)fail('ASSET_NOT_FOUND',404);return found;}
 function save(kind,input,publish){
 const {projectId:ideaId,commandId,digest,...metadata}=input;ideas.get(ideaId);
 const payload=JSON.stringify({kind,ideaId,digest,metadata}),old=db.prepare('SELECT * FROM receipts WHERE id=?').get(commandId);
 if(old){if(old.payload!==payload)fail('IDEMPOTENCY_CONFLICT');return JSON.parse(old.result);}
 db.exec('BEGIN IMMEDIATE');try{
 const id=randomUUID();publish();db.prepare('INSERT INTO idea_files VALUES (?,?,?,?)').run(id,ideaId,digest,JSON.stringify({...metadata,kind:kind==='image'?'image':'video'}));
 const result=file(ideaId,id);db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(commandId,payload,JSON.stringify(result));db.exec('COMMIT');return result;
 }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function use(ideaId,id,input){
 if(input.confirm!==true||!['reference','content'].includes(input.purpose))fail('REFERENCE_USE_APPROVAL_REQUIRED',403);
 const value=file(ideaId,id),{id:unused,kind,digest,...metadata}=value;
 const target=input.purpose==='reference'?references.ingestStore:{mutate};
 return target.mutate(kind==='image'?'image':'asset',{...metadata,digest,projectId:input.projectId,commandId:input.commandId,source:'idea-attachment',ideaFileId:id,ideaId},()=>{});
 }
 return {list,file,use,ingestStore:{project:id=>ideas.get(id),mutate:save}};
}
module.exports={createIdeaFiles};
