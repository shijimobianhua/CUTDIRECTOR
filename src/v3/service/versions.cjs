'use strict';

function issue(code,status=400) {
  return Object.assign(new Error(code),{code,status});
}
function createVersions(db, project, mutate) {
  function table(kind) {
    if(!['story','arrangement'].includes(kind))throw issue('INVALID_INPUT');
    return kind==='story'?'stories':'arrangements';
  }
  function snapshot(projectId,kind,version) {
    project(projectId);
    if(!Number.isSafeInteger(version)||version<1)throw issue('INVALID_INPUT');
    const row=db.prepare('SELECT * FROM '+table(kind)+' WHERE project_id=? AND version=?').get(projectId,version);
    if(!row)throw issue('VERSION_NOT_FOUND',404);
    return {version:row.version,createdAt:row.created_at,...JSON.parse(row.snapshot)};
  }
  function list(projectId,kind,before=Number.MAX_SAFE_INTEGER) {
    project(projectId);
    if(!Number.isSafeInteger(before)||before<1)throw issue('INVALID_INPUT');
    const rows=db.prepare('SELECT version,created_at,snapshot FROM '+table(kind)+
      ' WHERE project_id=? AND version<? ORDER BY version DESC LIMIT 21').all(projectId,before);
    const items=rows.slice(0,20).map(row=>{
      const value=JSON.parse(row.snapshot);
      return {version:row.version,createdAt:row.created_at,
        count:kind==='story'?value.shots.length:value.clips.length,
        seconds:(kind==='story'?value.shotTotalUs:value.durationUs)/1e6};
    });
    return {items,nextBefore:rows.length>20?items.at(-1).version:null};
  }
  function restore(projectId,kind,input) {
    if(input?.confirm!==true)throw issue('VERSION_APPROVAL_REQUIRED',403);
    const value=snapshot(projectId,kind,input.version);
    return mutate(kind,{...value,projectId,expectedVersion:input.expectedVersion,commandId:input.commandId});
  }
  function undo(projectId,kind,input) {
    if(!Number.isSafeInteger(input?.appliedVersion)||input.appliedVersion<2)throw issue('UNDO_NOT_AVAILABLE',409);
    return restore(projectId,kind,{...input,version:input.appliedVersion-1,expectedVersion:input.appliedVersion});
  }
  return {list,snapshot,restore,undo};
}
module.exports={createVersions};
