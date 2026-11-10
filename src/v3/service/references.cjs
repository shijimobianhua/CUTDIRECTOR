'use strict';
const {randomUUID}=require('node:crypto');
function issue(code,status=400){return Object.assign(new Error(code),{code,status});}
function createReferences(db,project,mutate){
  function files(projectId){
    project(projectId);
    return db.prepare('SELECT id,metadata FROM reference_assets WHERE project_id=? ORDER BY rowid DESC').all(projectId)
      .map(row=>({id:row.id,...JSON.parse(row.metadata)}));
  }
  function file(projectId,id){
    project(projectId);
    const row=db.prepare('SELECT * FROM reference_assets WHERE project_id=? AND id=?').get(projectId,id);
    if(!row)throw issue('REFERENCE_NOT_FOUND',404);
    return {id:row.id,digest:row.digest,...JSON.parse(row.metadata)};
  }
  function save(kind,input,publish){
    project(input.projectId);
    const payload=JSON.stringify({kind,...input});
    db.exec('BEGIN IMMEDIATE');
    try{
      const previous=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
      if(previous){if(previous.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);db.exec('COMMIT');return JSON.parse(previous.result);}
      const {commandId,projectId,digest,...meta}=input,id=randomUUID();
      publish();
      db.prepare('INSERT INTO reference_assets VALUES (?,?,?,?)').run(id,projectId,digest,JSON.stringify({...meta,kind:kind==='image'?'image':'video',purpose:'reference'}));
      const result=files(projectId).find(item=>item.id===id);
      db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(commandId,payload,JSON.stringify(result));
      db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('reference.file',?,?)").run(id,projectId);
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function analysis(projectId,id){
    file(projectId,id);
    const row=db.prepare('SELECT result FROM reference_analyses WHERE reference_id=?').get(id);
    return row?JSON.parse(row.result):null;
  }
  function record(projectId,id,result){
    file(projectId,id);
    db.prepare('INSERT INTO reference_analyses VALUES (?,?) ON CONFLICT(reference_id) DO UPDATE SET result=excluded.result').run(id,JSON.stringify(result));
    db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('reference.analyzed',?,?)").run(id,projectId);
    return result;
  }
  function use(projectId,id,input){
    const source=file(projectId,id);
    if(input?.confirm!==true)throw issue('REFERENCE_USE_APPROVAL_REQUIRED',403);
    const {digest,...meta}=source;
    const {id:unused,kind,purpose,...metadata}=meta;
    return mutate(kind==='image'?'image':'asset',{...metadata,digest,projectId,commandId:input.commandId,
      source:'reference-copy',referenceId:id},()=>{});
  }
  return {files,file,analysis,record,use,ingestStore:{project,mutate:save}};
}
module.exports={createReferences};
