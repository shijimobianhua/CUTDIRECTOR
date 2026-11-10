'use strict';
const {randomUUID}=require('node:crypto');
function issue(code,status=400){return Object.assign(new Error(code),{code,status});}
function createKnowledge(db,project) {
  const record=row=>row?{...row,evidence:JSON.parse(row.evidence)}:null;
  function list(projectId) {
    if(projectId)project(projectId);
    return db.prepare('SELECT * FROM feedback WHERE '+(projectId?'project_id=? OR scope=\'global\'':"scope='global'")+
      ' ORDER BY created_at DESC,id DESC LIMIT 100').all(...(projectId?[projectId]:[])).map(record);
  }
  function get(projectId,id) {
    const row=db.prepare('SELECT * FROM feedback WHERE id=? AND project_id=?').get(id,projectId);
    if(!row)throw issue('FEEDBACK_NOT_FOUND',404);
    return record(row);
  }
  function transaction(kind,input,work) {
    if(typeof input.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId))throw issue('INVALID_INPUT');
    const payload=JSON.stringify({kind,...input});
    db.exec('BEGIN IMMEDIATE');
    try {
      const receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
      if(receipt){if(receipt.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);db.exec('COMMIT');return JSON.parse(receipt.result);}
      const result=work();
      db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
      db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('feedback.changed',?,?)").run(result.id,input.projectId);
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function add(projectId,input) {
    project(projectId);
    if(!input||Object.keys(input).some(key=>!['commandId','note','kind','version'].includes(key))||
      typeof input.note!=='string'||!input.note.trim()||input.note.length>600||!['story','arrangement'].includes(input.kind)||
      !Number.isSafeInteger(input.version)||input.version<1)throw issue('INVALID_INPUT');
    const table=input.kind==='story'?'stories':'arrangements';
    const base=db.prepare('SELECT snapshot FROM '+table+' WHERE project_id=? AND version=?').get(projectId,input.version);
    if(!base)throw issue('VERSION_NOT_FOUND',404);
    return transaction('feedback.add',{...input,projectId},()=>{
      const id=randomUUID();
      db.prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,projectId,1,'project','case',
        input.note.trim(),input.kind,input.version,JSON.stringify({kind:input.kind,version:input.version}),new Date().toISOString());
      return get(projectId,id);
    });
  }
  function change(projectId,id,input) {
    project(projectId);
    if(!input||input.confirm!==true||Object.keys(input).some(key=>!['commandId','expectedVersion','action','confirm'].includes(key))||
      !['approve','promote','revoke'].includes(input.action))throw issue('PREFERENCE_APPROVAL_REQUIRED',403);
    return transaction('feedback.change',{...input,projectId,id},()=>{
      const row=get(projectId,id);
      if(row.version!==input.expectedVersion)throw issue('FEEDBACK_CONFLICT',409);
      if(input.action==='promote'&&row.state!=='approved')throw issue('PREFERENCE_APPROVAL_REQUIRED',403);
      const state=input.action==='revoke'?'revoked':'approved',scope=input.action==='promote'?'global':row.scope;
      db.prepare('UPDATE feedback SET version=version+1,state=?,scope=? WHERE id=?').run(state,scope,id);
      return get(projectId,id);
    });
  }
  function context(projectId) {
    project(projectId);
    const rows=db.prepare("SELECT * FROM feedback WHERE state='approved' AND (project_id=? OR scope='global') ORDER BY CASE WHEN project_id=? THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 8").all(projectId,projectId);
    let used=0;
    return rows.filter(row=>(used+=row.note.length)<=2400).map(row=>({id:row.id,version:row.version,
      scope:row.scope==='global'?'跨项目': '本项目',rule:row.note,evidence:{kind:row.kind,version:row.source_version}}));
  }
  return {list,add,change,context};
}
module.exports={createKnowledge};
