'use strict';

const {randomUUID} = require('node:crypto');

function problem(code,status=400) {
  return Object.assign(new Error(code),{code,status});
}
function createIdeas(db, project) {
  db.function('idea_search',{deterministic:true},value=>String(value||'').normalize('NFKC').toLowerCase());
  function get(id) {
    const row=db.prepare(`SELECT i.*,COALESCE(m.version,0) AS version,COALESCE(m.pinned,0) AS pinned,
      COALESCE(m.note,'') AS note,COALESCE(m.tags,'[]') AS tags FROM ideas i
      LEFT JOIN idea_meta m ON m.idea_id=i.id WHERE i.id=?`).get(id);
    if(!row)throw problem('IDEA_NOT_FOUND',404);
    return {...row,pinned:!!row.pinned,tags:JSON.parse(row.tags)};
  }
  function list(input={}) {
    const q=String(input.q||'').normalize('NFKC').trim().toLowerCase();
    if(q.length>200)throw problem('INVALID_INPUT');
    const args=[];
    const where=[];
    if(q){where.push("instr(idea_search(i.text || ' ' || COALESCE(m.note,'') || ' ' || COALESCE(m.tags,'')),?)>0");args.push(q);}
    if(input.tag){where.push("EXISTS (SELECT 1 FROM json_each(COALESCE(m.tags,'[]')) WHERE value=?)");args.push(input.tag);}
    if(input.cursor) {
      let cursor;
      try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());}catch{throw problem('INVALID_INPUT');}
      if(!Array.isArray(cursor)||cursor.length!==3||![0,1].includes(cursor[0])||
        cursor.slice(1).some(value=>typeof value!=='string'||value.length>100))throw problem('INVALID_INPUT');
      where.push('(COALESCE(m.pinned,0),i.created_at,i.id)<(?,?,?)');args.push(...cursor);
    }
    const rows=db.prepare(`SELECT i.id FROM ideas i LEFT JOIN idea_meta m ON m.idea_id=i.id
      ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY COALESCE(m.pinned,0) DESC,i.created_at DESC,i.id DESC LIMIT 31`).all(...args);
    const items=rows.slice(0,30).map(row=>get(row.id));
    const last=items.at(-1);
    return {items,nextCursor:rows.length>30?Buffer.from(JSON.stringify([last.pinned?1:0,last.created_at,last.id])).toString('base64url'):null};
  }
  function transaction(kind,input,work) {
    if(typeof input?.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId))throw problem('INVALID_INPUT');
    const payload=JSON.stringify({kind,...input});
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
      if(previous) {
        if(previous.payload!==payload)throw problem('IDEMPOTENCY_CONFLICT',409);
        db.exec('COMMIT');
        return JSON.parse(previous.result);
      }
      const result=work();
      db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
      db.exec('COMMIT');
      return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function update(id,input) {
    if(!input||Object.keys(input).some(key=>!['commandId','expectedVersion','note','tags','pinned'].includes(key))||
      !Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw problem('INVALID_INPUT');
    return transaction('idea.update',{...input,id},()=>{
      const value=get(id);
      if(value.version!==input.expectedVersion)throw problem('IDEA_CONFLICT',409);
      const note=input.note??value.note;
      const tags=input.tags??value.tags;
      const pinned=input.pinned??value.pinned;
      if(typeof note!=='string'||note.length>2000||typeof pinned!=='boolean'||
        !Array.isArray(tags)||tags.length>8||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>24))throw problem('INVALID_INPUT');
      db.prepare(`INSERT INTO idea_meta VALUES (?,?,?,?,?)
        ON CONFLICT(idea_id) DO UPDATE SET version=excluded.version,note=excluded.note,tags=excluded.tags,pinned=excluded.pinned`)
        .run(id,value.version+1,note,JSON.stringify([...new Set(tags.map(tag=>tag.trim()))]),pinned?1:0);
      db.prepare("INSERT INTO events(type,subject_id) VALUES ('idea.updated',?)").run(id);
      return get(id);
    });
  }
  function links(projectId,includeDisabled=false) {
    project(projectId);
    return db.prepare(`SELECT l.* FROM idea_links l WHERE l.project_id=? AND l.revision=(
      SELECT MAX(x.revision) FROM idea_links x WHERE x.project_id=l.project_id AND x.idea_id=l.idea_id)
      ${includeDisabled ? '' : "AND l.mode <> 'disabled'"} ORDER BY l.created_at`).all(projectId)
      .map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));
  }
  function initialLink(projectId,ideaId) {
    const value=get(ideaId);
    db.prepare('INSERT INTO idea_links VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(),projectId,ideaId,1,'reference',JSON.stringify(value),value.version,new Date().toISOString());
  }
  function link(projectId,input) {
    project(projectId);
    if(!input||Object.keys(input).some(key=>!['commandId','ideaId','sourceVersion','expectedVersion','mode'].includes(key))||
      !['reference','use','disabled'].includes(input.mode)||
      !Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw problem('INVALID_INPUT');
    return transaction('idea.link',{...input,projectId},()=>{
      const source=get(input.ideaId);
      if(source.version!==input.sourceVersion)throw problem('IDEA_CONFLICT',409);
      const previous=db.prepare('SELECT MAX(revision) AS n FROM idea_links WHERE project_id=? AND idea_id=?').get(projectId,input.ideaId).n||0;
      if(previous!==input.expectedVersion)throw problem('IDEA_LINK_CONFLICT',409);
      db.prepare('INSERT INTO idea_links VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),projectId,input.ideaId,previous+1,
        input.mode,JSON.stringify(source),source.version,new Date().toISOString());
      db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('reference.changed',?,?)").run(input.ideaId,projectId);
      return {projectId,ideaId:input.ideaId,revision:previous+1,mode:input.mode};
    });
  }
  function related(id) {
    const source=get(id);
    const tokenize=value=>{
      const normalized=value.normalize('NFKC').toLowerCase();
      const words=normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]+/g)||[];
      return new Set(words.flatMap(word=>/^[a-z0-9]+$/.test(word)?[word]:Array.from(word.slice(0,-1),(_,index)=>word.slice(index,index+2))));
    };
    const terms=tokenize(source.text+' '+source.tags.join(' '));
    return db.prepare('SELECT id FROM ideas WHERE id<>? ORDER BY created_at DESC,id LIMIT 500').all(id).map(row=>{
      const item=get(row.id);
      const score=[...tokenize(item.text+' '+item.tags.join(' '))].filter(term=>terms.has(term)).length;
      return {item,score};
    }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||b.item.created_at.localeCompare(a.item.created_at)||a.item.id.localeCompare(b.item.id))
      .slice(0,3).map(row=>row.item);
  }
  function detail(id) {
    const item=get(id);
    const projects=db.prepare(`SELECT DISTINCT p.id,p.title FROM projects p LEFT JOIN idea_links l ON p.id=l.project_id
      WHERE p.idea_id=? OR l.idea_id=? ORDER BY p.created_at DESC`).all(id,id);
    return {...item,projects,related:related(id)};
  }
  return {get,list,update,links,link,initialLink,detail};
}
module.exports={createIdeas};
