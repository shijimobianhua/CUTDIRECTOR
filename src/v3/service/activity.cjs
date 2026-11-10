'use strict';

function issue(code,status=400) { return Object.assign(new Error(code),{code,status}); }
const groups = {
  awaiting_approval:'waiting', submitting:'active', dispatching:'active', queued:'active', checking:'active', running:'active', collecting:'active',
  collect_failed:'attention', unknown:'attention', uncertain:'attention', writing:'active',
  failed:'attention', expired:'attention', cancelled:'finished', ready:'finished', created:'finished',
  preparing:'active',thinking:'active',reading:'active',complete:'finished',interrupted:'attention',submitted:'finished',paused:'attention',
};
const union = `
 SELECT id,project_id,shot_id,state,created_at,'image' AS kind FROM image_jobs
 UNION ALL SELECT id,project_id,shot_id,state,created_at,'video' AS kind FROM generation_jobs
 UNION ALL SELECT id,project_id,NULL AS shot_id,state,created_at,'draft' AS kind FROM drafts
 UNION ALL SELECT r.turn_id,c.project_id,NULL,CASE WHEN r.state IN ('model','ready') THEN 'thinking' WHEN r.state='tool' THEN 'reading' ELSE r.state END,r.created_at,'director' FROM director_runs r JOIN chat_turns t ON t.id=r.turn_id JOIN chats c ON c.id=t.chat_id
 UNION ALL SELECT id,project_id,NULL,state,created_at,'batch' FROM generation_batches
 UNION ALL SELECT id,project_id,NULL,state,created_at,'search' FROM reference_searches
 UNION ALL SELECT id,project_id,NULL,state,created_at,'extension' FROM extension_jobs
 UNION ALL SELECT id,project_id,NULL,state,created_at,'visual' FROM visual_reviews
 UNION ALL SELECT id,project_id,NULL,state,created_at,'studio' FROM studio_jobs`;
function createActivity(db, project) {
  function events(projectId, after=0) {
    project(projectId);
    if (!Number.isSafeInteger(after) || after<0) throw issue('INVALID_INPUT');
    const rows=db.prepare('SELECT seq,type,subject_id AS subjectId FROM events WHERE scope_id = ? AND seq > ? ORDER BY seq LIMIT 200').all(projectId,after);
    const latest=db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events').get().n;
    if(after>latest)return {items:[],cursor:latest,reset:true};
    return {items:rows,cursor:rows.length===200?rows.at(-1).seq:latest};
  }
  function summary(projectId) {
    if(projectId)project(projectId);
    const counts={waiting:0,active:0,attention:0,finished:0};
    const rows=db.prepare('SELECT state,COUNT(*) AS n FROM ('+union+')'+(projectId?' WHERE project_id=?':'')+' GROUP BY state').all(...(projectId?[projectId]:[]));
    for(const row of rows)counts[groups[row.state]||'attention']+=row.n;
    return counts;
  }
  function tasks(input={}) {
    const args=[];
    const filters=[];
    if(input.projectId){ project(input.projectId);filters.push('t.project_id = ?');args.push(input.projectId); }
    if(input.group) {
      if(!['waiting','active','attention','finished'].includes(input.group))throw issue('INVALID_INPUT');
      const states=Object.entries(groups).filter(([,group])=>group===input.group).map(([state])=>state);
      filters.push('t.state IN ('+states.map(()=>'?').join(',')+')');args.push(...states);
    }
    if(input.cursor){
      let cursor;
      try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{throw issue('INVALID_INPUT');}
      if(!Array.isArray(cursor)||cursor.length!==3||cursor.some(v=>typeof v!=='string'||v.length>100))throw issue('INVALID_INPUT');
      filters.push('(t.created_at,t.id,t.kind) < (?,?,?)');args.push(...cursor);
    }
    const rows=db.prepare(`SELECT t.*,p.title FROM (${union}) t JOIN projects p ON p.id=t.project_id
      ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY t.created_at DESC,t.id DESC,t.kind DESC LIMIT 51`).all(...args);
    const items=rows.slice(0,50).map(row=>({id:row.id,projectId:row.project_id,shotId:row.shot_id,
      state:row.state,createdAt:row.created_at,kind:row.kind,title:row.title,group:groups[row.state]||'attention',
      section:({image:'image-generation',video:'generation',draft:'delivery',director:'story',batch:'batches',search:'reference',extension:'extensions',visual:'quality',studio:'studio-media'})[row.kind]}));
    const last=items.at(-1);
    return {counts:summary(input.projectId),items,nextCursor:rows.length>50?Buffer.from(JSON.stringify([last.createdAt,last.id,last.kind])).toString('base64url'):null};
  }
  return {events,tasks,summary};
}
module.exports={createActivity};
