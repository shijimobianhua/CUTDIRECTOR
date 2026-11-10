'use strict';

function invalid() { throw Object.assign(new Error('INVALID_VIEW'), {code:'INVALID_VIEW',status:400}); }
function keys(value, allowed) {
  if(!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)))invalid();
}
function string(value,max) { if(typeof value!=='string'||value.length>max)invalid(); }
function createWorkspace(db,project) {
  function checkScope(scope) {
    if(['global','capture','assistant'].includes(scope))return;
    const form=/^(image-form|video-form):([a-f0-9-]{36}):([a-f0-9-]{36})$/.exec(scope||'');
    if(form){
      project(form[2]);
      if(!db.prepare("SELECT 1 FROM stories s,json_each(s.snapshot,'$.shots') AS j WHERE s.project_id=? AND json_extract(j.value,'$.id')=? LIMIT 1").get(form[2],form[3]))invalid();
      return;
    }
    const assistantDraft=/^assistant-draft:([a-f0-9-]{36})$/.exec(scope||'');if(assistantDraft){if(!db.prepare('SELECT 1 FROM assistant_chats WHERE id=?').get(assistantDraft[1]))invalid();return;}
    const studioDraft=/^studio-draft:([a-f0-9-]{36})$/.exec(scope||'');
    if(studioDraft){if(!db.prepare('SELECT 1 FROM studio_documents WHERE id=?').get(studioDraft[1]))invalid();return;}
    const match=/^(idea-chat|chat|story|arrangement|idea|workflow):([a-f0-9-]{36})$/.exec(scope||'');
    if(!match)invalid();
    if(['idea','idea-chat'].includes(match[1])) {if(!db.prepare('SELECT 1 FROM ideas WHERE id=?').get(match[2]))invalid();}
    else project(match[2]);
  }
  function get(scope) {
    checkScope(scope);
    const row=db.prepare('SELECT version,value FROM view_states WHERE scope = ?').get(scope);
    return row?{version:row.version,value:JSON.parse(row.value)}:{version:0,value:null};
  }
  function save(input) {
    const {scope,expectedVersion,value}=input||{};
    checkScope(scope);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)invalid();
    if(scope==='global') {
      keys(value,['route']);
      string(value.route,500);
      if(!/^#\/[a-zA-Z0-9%+?=&/_:.-]*$/.test(value.route))invalid();
    } else if(scope.startsWith('assistant-draft:')) {
      keys(value,['draft','model']);string(value.draft,12000);if(value.model!=null){keys(value.model,['provider','id']);string(value.model.provider,120);string(value.model.id,180);}
    } else if(scope.startsWith('studio-draft:')) {
      keys(value,['baseVersion','draft']);if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<1)invalid();
      if(value.draft!=null&&(!value.draft||typeof value.draft!=='object'||JSON.stringify(value.draft).length>1000000))invalid();
    } else if(scope==='assistant') {
      keys(value,['chatId','draft','model']);string(value.draft,12000);
      if(value.chatId!=null&&!db.prepare('SELECT 1 FROM assistant_chats WHERE id=?').get(value.chatId))invalid();
      if(value.model!=null){keys(value.model,['provider','id']);string(value.model.provider,120);string(value.model.id,180);}
    } else if(scope==='capture') {
      keys(value,['text','url']);string(value.text,4000);string(value.url,2000);
    } else if(scope.startsWith('idea:')) {
      keys(value,['baseVersion','note','tags','pinned']);
      if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<0)invalid();
      string(value.note,2000);string(value.tags,240);if(typeof value.pinned!=='boolean')invalid();
    } else if(scope.startsWith('image-form:')||scope.startsWith('video-form:')) {
      keys(value,['baseVersion','draft']);if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<1)invalid();
      const image=scope.startsWith('image-form:');
      keys(value.draft,image?['frame','referenceId','method','prompt']:['seconds','audio','method','prompt']);
      string(value.draft.prompt,image?1500:2000);string(value.draft.method,64);
      if(value.draft.method&&!/^[a-f0-9]{64}$/.test(value.draft.method))invalid();
      if(image){
        if(!['start','end'].includes(value.draft.frame))invalid();
        string(value.draft.referenceId,100);
        if(value.draft.referenceId&&!db.prepare('SELECT 1 FROM images WHERE project_id=? AND id=?').get(scope.split(':')[1],value.draft.referenceId))invalid();
      }else {string(value.draft.seconds,40);if(typeof value.draft.audio!=='boolean')invalid();}
    } else if(scope.startsWith('workflow:')) {
      keys(value,['baseVersion','draft']);if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<0)invalid();
      keys(value.draft,['nodes','edges']);
      if(!Array.isArray(value.draft.nodes)||value.draft.nodes.length>30||!Array.isArray(value.draft.edges)||value.draft.edges.length>80)invalid();
      for(const node of value.draft.nodes){
        keys(node,['id','type','title','x','y','group','folded']);if(node.group!=null)string(node.group,80);if(node.folded!=null&&typeof node.folded!=='boolean')invalid();string(node.id,64);string(node.type,40);if(node.title!=null)string(node.title,80);
        if(node.x!=null&&(!Number.isFinite(node.x)||Math.abs(node.x)>10000)||node.y!=null&&(!Number.isFinite(node.y)||Math.abs(node.y)>10000))invalid();
      }
      for(const edge of value.draft.edges){keys(edge,['source','target']);string(edge.source,64);string(edge.target,64);}
    } else if(scope.startsWith('arrangement:')) {
      keys(value,['baseVersion','clips','subtitle']);
      if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<0||!Array.isArray(value.clips)||value.clips.length>500)invalid();
      const assets=new Set(db.prepare('SELECT id FROM assets WHERE project_id=?').all(scope.slice(12)).map(row=>row.id));
      for(const clip of value.clips) {
        keys(clip,['assetId','inTime','outTime']);
        if(!assets.has(clip.assetId))invalid();
        string(clip.inTime,40);string(clip.outTime,40);
      }
      if(value.subtitle!=null) {
        keys(value.subtitle,['mode','assetId','text']);
        if(!['source','timeline'].includes(value.subtitle.mode))invalid();
        if(value.subtitle.mode==='source'&&!assets.has(value.subtitle.assetId))invalid();
        string(value.subtitle.text,200000);
      }
    } else if(scope.startsWith('chat:')||scope.startsWith('idea-chat:')) {
      keys(value,['message','chatId','focus','model']);
      string(value.message,4000);
      if(value.chatId!=null){const idea=scope.startsWith('idea-chat:');if(!db.prepare(idea?'SELECT 1 FROM idea_chats WHERE idea_id=? AND id=?':'SELECT 1 FROM chats WHERE project_id=? AND id=?').get(scope.slice(idea?10:5),value.chatId))invalid();}
      if(value.model!=null){keys(value.model,['provider','id']);string(value.model.provider,120);string(value.model.id,180);}
      if(value.focus!=null){keys(value.focus,['kind','id']);if(!['asset','shot'].includes(value.focus.kind)||!/^[a-f0-9-]{36}$/.test(value.focus.id))invalid();}
    } else {
      keys(value,['baseVersion','draft']);
      if(!Number.isSafeInteger(value.baseVersion)||value.baseVersion<0)invalid();
      keys(value.draft,['id','version','createdAt','brief','audience','style','ratio','durationUs','shotTotalUs','shots']);
      const draft=value.draft;
      string(draft.brief,1200);string(draft.audience,240);string(draft.style,600);
      if(!['16:9','9:16','1:1'].includes(draft.ratio)||!Array.isArray(draft.shots)||draft.shots.length>60)invalid();
      for(const shot of draft.shots) {
        keys(shot,['id','action','durationUs','startFrameIdea','endFrameIdea','assetId','startImageId','endImageId']);
        string(shot.action,600);string(shot.startFrameIdea,600);string(shot.endFrameIdea,600);
      }
    }
    const raw=JSON.stringify(value);
    if(Buffer.byteLength(raw)>(scope.startsWith('studio-draft:')?4*1024*1024:256*1024))invalid();
    db.exec('BEGIN IMMEDIATE');
    try {
      const current=get(scope);
      if(current.version!==expectedVersion)throw Object.assign(new Error('VIEW_CONFLICT'),{code:'VIEW_CONFLICT',status:409});
      db.prepare(`INSERT INTO view_states VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET version=excluded.version,value=excluded.value`)
        .run(scope,expectedVersion+1,raw);
      db.exec('COMMIT');
      return {version:expectedVersion+1,value};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {get,save};
}
module.exports={createWorkspace};
