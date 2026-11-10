'use strict';
function issue(code,status=422){return Object.assign(new Error(code),{code,status});}
function createCandidates(db,project,story){
 function list(projectId,input){
  project(projectId);
  if(!['image','video'].includes(input.kind)||!Number.isSafeInteger(input.before)||input.before<1)throw issue('INVALID_INPUT');
  const saved=story(projectId),shot=saved?.shots.find(shot=>shot.id===input.shotId);
  if(!shot)throw issue('SHOT_NOT_FOUND',404);
  const images=input.kind==='image',table=images?'images':'assets',jobs=images?'image_jobs':'generation_jobs',link=images?'imageJobId':'generationId';
  const rows=db.prepare(`SELECT a.rowid AS sequence,a.id,a.metadata,COALESCE(j.shot_id,json_extract(a.metadata,'$.externalShotId')) AS shot_id,COALESCE(j.story_version,json_extract(a.metadata,'$.externalStoryVersion')) AS story_version ${images?",COALESCE(j.frame,json_extract(a.metadata,'$.externalFrame')) AS frame":''}
    FROM ${table} a LEFT JOIN ${jobs} j ON j.id=json_extract(a.metadata,'$.${link}')
    WHERE a.project_id=? AND a.rowid<? AND (COALESCE(j.shot_id,json_extract(a.metadata,'$.externalShotId')) IS NULL OR COALESCE(j.shot_id,json_extract(a.metadata,'$.externalShotId'))=?) ORDER BY a.rowid DESC LIMIT 51`).all(projectId,input.before,shot.id);
  const items=rows.slice(0,50).map(row=>({id:row.id,...JSON.parse(row.metadata),shotId:row.shot_id,storyVersion:row.story_version,
   frame:row.frame||null,selected:images?[shot.startImageId,shot.endImageId].includes(row.id):shot.assetId===row.id}));
  return {currentStoryVersion:saved.version,items,nextBefore:rows.length>50?rows[49].sequence:null};
 }
 return {list};
}
module.exports={createCandidates};
