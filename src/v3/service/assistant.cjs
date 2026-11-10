'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {issue,text}=require('./studio-store.cjs');
function createAssistant(studio,store){
 const db=studio.db;
 db.prepare("UPDATE assistant_turns SET state='interrupted' WHERE state='pending'").run();
 function chat(id){const r=db.prepare('SELECT * FROM assistant_chats WHERE id=?').get(id);if(!r)issue('CHAT_NOT_FOUND','对话暂时找不到。',404);return {...r,...JSON.parse(r.value),value:undefined};}
 function list(q='',scope='general',scopeId=null){return db.prepare("SELECT id,title,version,updated_at AS updatedAt FROM assistant_chats WHERE title LIKE ? AND COALESCE(json_extract(value,'$.scope'),'general')=? AND (? IS NULL OR json_extract(value,'$.scopeId')=?) ORDER BY updated_at DESC LIMIT 100").all('%'+String(q).slice(0,120)+'%',scope,scopeId,scopeId);}
 function save(input){
  const id=input.id||randomUUID(),old=input.id?chat(input.id):null;

  return studio.command(input,{type:'assistant',...input},()=>{
   if(old&&old.version!==input.expectedVersion)issue('DOCUMENT_CONFLICT','对话已更新，请重新打开。',409);
   const value={draft:String(input.draft??old?.draft??'').slice(0,12000),model:input.model??old?.model??null,projectId:input.projectId??old?.projectId??null,scope:input.scope||old?.scope||'general',scopeId:input.scopeId||old?.scopeId||null};
   if(!['general','episode'].includes(value.scope))issue('INVALID_INPUT');
   if(value.projectId)store.project(value.projectId);
   if(value.model&&(!text(value.model.provider,120)||!text(value.model.id,180)))issue('INVALID_INPUT');
   const title=String(input.title||old?.title||'新对话').slice(0,120),now=new Date().toISOString();
   db.prepare('INSERT INTO assistant_chats VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,version=excluded.version,value=excluded.value,updated_at=excluded.updated_at').run(id,title,(old?.version||0)+1,JSON.stringify(value),now);return chat(id);
  });
 }
 function turns(id,before){chat(id);const rows=db.prepare('SELECT rowid AS cursor,* FROM assistant_turns WHERE chat_id=? AND rowid<? ORDER BY rowid DESC LIMIT 50').all(id,Number(before)||Number.MAX_SAFE_INTEGER);return rows.reverse().map(({payload,context,command_id,...r})=>({...r,context:JSON.parse(context),proposal:JSON.parse(context).stage==='chat'?null:publicProposal(r,JSON.parse(context))}));}
 function readProposal(answer,state){if(state!=='complete'||!answer)return null;try{const p=JSON.parse(answer.replace(/^(\s*)\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60\s*$/g,''));return p&&Array.isArray(p.documents)?p:null;}catch{return null;}}
 function publicProposal(row,context){const p=readProposal(row.answer,row.state);if(!p)return null;const applied=new Set();for(const r of db.prepare('SELECT payload FROM studio_receipts WHERE command_id LIKE ?').all('proposal_'+row.id+'_%')){try{for(const i of JSON.parse(r.payload).selection?.indices||[])applied.add(i);}catch{}}let stale=false;try{stale=!!context.project?.episode&&studio.get(context.projectId,context.episodeId).version!==context.project.episode.version;}catch{stale=true;}return {...p,stale,appliedIndices:[...applied]};}
 function turn(id,turnId){chat(id);const r=db.prepare('SELECT * FROM assistant_turns WHERE chat_id=? AND id=?').get(id,turnId);if(!r)issue('CHAT_NOT_FOUND','消息暂时找不到。',404);return r;}
 function prepare(id,input){
  const current=chat(id);
  if(!text(input.text,12000)||!input.text.trim())issue('INVALID_INPUT','请先输入想聊的内容。');
  const model=input.model||current.model;if(!model)issue('MODEL_REQUIRED','请先选一个对话模型。');
  if(!text(model.provider,120)||!text(model.id,180))issue('INVALID_INPUT');
  const payload=JSON.stringify(input),old=db.prepare('SELECT * FROM assistant_turns WHERE command_id=?').get(input.commandId);
  if(old){if(old.chat_id!==id||old.payload!==payload)issue('IDEMPOTENCY_CONFLICT','这条消息已变化，请重新发送。',409);return {dispatch:false,id:old.id,state:old.state};}
  if(db.prepare("SELECT 1 FROM assistant_turns WHERE chat_id=? AND state='pending'").get(id))issue('CHAT_BUSY','助手还在回答，可以先停止。',409);
  const stage=input.stage||'chat';
  if(!['chat','script','storyboard','assets','prompts','review'].includes(stage))issue('INVALID_INPUT');
  const context={model,stage,projectId:input.projectId||null,episodeId:input.episodeId||null,skill:null,conversationVersion:require('./assistant-model.cjs').VERSION,clock:{now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}};
  if(input.projectId){store.project(input.projectId);if(input.includeProject===true){if(input.episodeId)context.project=studio.context(input.projectId,input.episodeId);else context.project={project:store.project(input.projectId),story:store.story(input.projectId),assets:store.projectAssets(input.projectId).map(({id,name,durationUs,kind})=>({id,name,durationUs,kind:kind||'video'}))};}}
  if(stage!=='chat'&&!context.project?.episode)issue('INVALID_INPUT','请从剧本里选择当前一集。');
  if(input.sourceId){const source=studio.get(input.projectId,input.sourceId);if(source.kind!=='source')issue('INVALID_INPUT');
   const start=Number(input.sourceStart||0),end=Number(input.sourceEnd||Math.min(source.text.length,start+16000));
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>source.text.length||end-start>32000)issue('INVALID_INPUT','每次先选一段原文，最多 32000 字。');
   context.source={id:source.id,digest:source.digest,start,end,text:source.text.slice(start,end)};
  }
  if(input.method&&context.projectId){const routed=store.skills.route(context.projectId,input.method,stage==='script'?'brief':stage==='assets'?'frames':stage==='prompts'?'generation':stage==='review'?'review':'storyboard',true);if(routed){if(['disabled','stage-mismatch','private-text','executor-missing'].includes(routed.state))issue('SKILL_EXECUTOR_MISMATCH','这份方法不适合当前阶段，或尚未启用。请换一份方法。');context.skill=routed.method?routed:store.skills.promptMethod(routed.hash,routed.stage);}}
  if(JSON.stringify(context).length>170000)issue('CONTEXT_TOO_LONG','这一集内容较长，请先选择一个场景进行讨论。');
  const history=turns(id).filter(t=>t.state==='complete').slice(-12).map(t=>({id:t.id,model:t.context.model,stage:t.context.stage,text:t.text.slice(0,6000),answer:t.answer?.slice(0,8000)}));
  context.historyIds=history.map(t=>t.id);
  const turnId=randomUUID(),now=new Date().toISOString();
  studio.command(input,{type:'assistant-turn',id,...input},()=>{
   db.prepare('INSERT INTO assistant_turns VALUES (?,?,?,?,?,?,?,?,?)').run(turnId,id,input.commandId,payload,'pending',input.text.trim(),null,JSON.stringify(context),now);
   db.prepare('UPDATE assistant_chats SET title=CASE WHEN title=? THEN ? ELSE title END,updated_at=? WHERE id=?').run('新对话',input.text.trim().slice(0,40),now,id);return {id:turnId};
  });
  return {dispatch:true,id:turnId,model,context,history,text:input.text.trim()};
 }
 function finish(id,turnId,input){
  const old=turn(id,turnId);if(old.state!=='pending')return {state:old.state};
  if(!['complete','failed','cancelled'].includes(input.state)||!text(input.answer,50000))issue('INVALID_INPUT');
  const context=JSON.parse(old.context);if(input.failure)context.failure=require('./assistant-model.cjs').safeFailure(input.failure);
  db.prepare("UPDATE assistant_turns SET state=?,answer=?,context=? WHERE id=? AND state='pending'").run(input.state,input.answer,JSON.stringify(context),turnId);
  return {state:input.state};
 }
 function convert(id,turnId,input){
  const current=turn(id,turnId),value=input.from==='user'?current.text:current.answer;
  if(!value||current.state==='pending')issue('INVALID_INPUT');
  if(input.kind==='idea')return store.mutate('idea',{commandId:input.commandId,text:value.slice(0,4000),url:''});
  if(input.kind==='project')return store.mutate('project',{commandId:input.commandId,title:String(input.title||value.slice(0,40)).slice(0,120),kind:'idea'});
  issue('INVALID_INPUT');
 }
 function apply(id,turnId,input){
  const current=turn(id,turnId),context=JSON.parse(current.context),proposal=readProposal(current.answer,current.state);
  if(context.stage==='chat'||!proposal||!context.projectId||!context.episodeId||input.confirm!==true)issue('PROPOSAL_INVALID','请先检查建议，再确认采用。');
  const stableId='proposal_'+turnId+'_'+createHash('sha256').update(JSON.stringify(input.indices||[])).digest('hex').slice(0,16);
  const receipt=db.prepare('SELECT result FROM studio_receipts WHERE command_id=?').get(stableId);if(receipt)return JSON.parse(receipt.result);
  const applied=publicProposal(current,context).appliedIndices;if(input.indices?.some(i=>applied.includes(i)))issue('PROPOSAL_ALREADY_APPLIED','已采用的建议不需要再保存，请只勾选未采用的部分。',409);
  const episode=studio.get(context.projectId,context.episodeId);
  if(episode.version!==context.project.episode.version)issue('DOCUMENT_CONFLICT','剧本已更新，请针对新版重新生成建议。',409);
  const selected=input.indices;
  if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(i=>!Number.isInteger(i)||!proposal.documents[i]))issue('PROPOSAL_INVALID');
  // Validate every change before any write. Each document uses a stable command ID.
  const allowed=new Set(['episode','shot','character','location','prop','concept','clip']);
  const inputs=selected.map(i=>{const d=proposal.documents[i];if(!allowed.has(d.kind))issue('PROPOSAL_INVALID');let old=null;
   if(d.id){old=studio.get(context.projectId,d.id);if(old.kind!==d.kind)issue('PROPOSAL_INVALID');}
   if(d.kind==='episode'&&d.id!==episode.id)issue('PROPOSAL_INVALID');
   const value={...d.value};if(d.kind!=='episode'&&!['character','location','prop','concept'].includes(d.kind))value.episodeId=episode.id;
   const frozen=context.project.shots.find(s=>s.id===d.id)||context.project.assets.find(s=>s.id===d.id)||(d.id===episode.id?context.project.episode:null);
   if(old&&(!frozen||old.version!==frozen.version))issue('DOCUMENT_CONFLICT','关联内容已有新版本，请重新检查建议。',409);
   if(d.kind==='shot')value.scriptVersion=episode.version+(selected.some(index=>proposal.documents[index].kind==='episode')?1:0);
   return {commandId:input.commandId+'_'+i,id:d.id||undefined,kind:d.kind,expectedVersion:old?.version||0,value};});
  return studio.batch(context.projectId,{commandId:stableId,selection:{turnId,indices:input.indices},operations:inputs.map(({commandId,...op})=>op)});
 }
 return {list,chat,save,turns,prepare,finish,convert,apply};
}
module.exports={createAssistant};
