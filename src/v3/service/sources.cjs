'use strict';
const {randomUUID,createHash}=require('node:crypto');
function issue(code,status=400){return Object.assign(new Error(code),{code,status});}
function createSources(db){
  function idea(id){const row=db.prepare('SELECT * FROM ideas WHERE id=?').get(id);if(!row)throw issue('IDEA_NOT_FOUND',404);return row;}
  function list(id){idea(id);return db.prepare('SELECT id,title,url,kind,digest,created_at FROM idea_sources WHERE idea_id=? ORDER BY created_at DESC,id DESC').all(id);}
  function get(id,sourceId){idea(id);const row=db.prepare('SELECT * FROM idea_sources WHERE idea_id=? AND id=?').get(id,sourceId);if(!row)throw issue('SOURCE_NOT_FOUND',404);return {...row,value:JSON.parse(row.value)};}
  function add(id,input,value){
    idea(id);
    if(typeof input?.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId))throw issue('INVALID_INPUT');
    if(!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>64000||typeof value.title!=='string'||value.title.length>240)throw issue('INVALID_INPUT');
    const payload=JSON.stringify({id,...input}),raw=JSON.stringify(value);
    db.exec('BEGIN IMMEDIATE');
    try{
      const previous=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
      if(previous){if(previous.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);db.exec('COMMIT');return JSON.parse(previous.result);}
      const sourceId=randomUUID(),digest=createHash('sha256').update(raw).digest('hex');
      db.prepare('INSERT INTO idea_sources VALUES (?,?,?,?,?,?,?,?,?)').run(sourceId,id,value.title,value.url||null,value.kind,digest,raw,new Date().toISOString(),1);
      const result=get(id,sourceId);
      db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
      db.prepare("INSERT INTO events(type,subject_id) VALUES ('idea.source',?)").run(id);
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function context(projectId){
    const links=db.prepare(`SELECT l.idea_id,l.revision FROM idea_links l WHERE l.project_id=? AND l.mode<>'disabled'
      AND l.revision=(SELECT MAX(x.revision) FROM idea_links x WHERE x.project_id=l.project_id AND x.idea_id=l.idea_id)
      ORDER BY l.created_at DESC LIMIT 5`).all(projectId);
    let size=0;
    const result=[];
    for(const link of links){
      if(size>=5000)break;
      const base=idea(link.idea_id);
      const text=base.text.slice(0,Math.min(1000,5000-size));
      result.push({ideaId:base.id,revision:link.revision,text,url:base.url,
        digest:createHash('sha256').update(base.text).digest('hex'),excerptOnly:text.length<base.text.length});size+=text.length;
      for(const source of list(base.id).slice(0,2)){
        if(size>=5000)break;
        const value=get(base.id,source.id);
        const excerpt=value.value.text.slice(0,Math.min(1500,5000-size));size+=excerpt.length;
        result.push({ideaId:base.id,sourceId:source.id,digest:source.digest,title:source.title,url:source.url,text:excerpt,
          excerptOnly:excerpt.length<value.value.text.length});
      }
    }
    return result;
  }
  return {idea,list,get,add,context};
}
module.exports={createSources};
