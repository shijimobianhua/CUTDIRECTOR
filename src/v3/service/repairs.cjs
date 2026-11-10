'use strict';
const {existsSync,mkdirSync,renameSync,unlinkSync}=require('node:fs'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
function issue(code,status=409){return Object.assign(new Error(code),{code,status});}
function createRepairs(db,root,project,asset,mediaKind='asset'){
 function ingestStore(projectId,id){
  const expected=asset(projectId,id);
  return {project,mutate(kind,input,publish){
   if(kind!==mediaKind||input.projectId!==projectId||input.digest!==expected.digest||
    ['size','durationUs','width','height'].some(key=>input[key]!==expected[key]))throw issue('RECONNECT_DIFFERENT_FILE',422);
   const payload=JSON.stringify({kind:'repair',projectId,id,digest:input.digest,size:input.size});
   db.exec('BEGIN IMMEDIATE');
   let backup,target;
   try{
    const receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
    if(receipt){if(receipt.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT');db.exec('COMMIT');return JSON.parse(receipt.result);}
    target=join(root,'media',expected.digest);
    if(existsSync(target)){
     const folder=join(root,'repair-backups');mkdirSync(folder,{recursive:true});
     backup=join(folder,expected.digest+'-'+randomUUID());renameSync(target,backup);
    }
    publish();
    const result={id,reconnected:true};
    db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
    db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('asset.reconnected',?,?)").run(id,projectId);
    db.exec('COMMIT');return result;
   }catch(error){
    db.exec('ROLLBACK');
    if(backup){if(existsSync(target))unlinkSync(target);renameSync(backup,target);}
    throw error;
   }
  }};
 }
 return {ingestStore};
}
module.exports={createRepairs};
