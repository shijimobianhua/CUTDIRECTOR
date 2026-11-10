'use strict';
const {randomUUID}=require('node:crypto');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function text(value,max=4000){if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_INPUT',400);return value.trim();}
function createIdeaChat(db,ideas,registry){
 db.prepare("UPDATE idea_chat_turns SET state='interrupted' WHERE state='pending'").run();
 const idea=id=>ideas.get(id);
 function chat(ideaId,id){idea(ideaId);const row=db.prepare('SELECT * FROM idea_chats WHERE idea_id=? AND id=?').get(ideaId,id);if(!row)fail('CHAT_NOT_FOUND',404);return row;}
 function list(ideaId){idea(ideaId);return db.prepare('SELECT * FROM idea_chats WHERE idea_id=? ORDER BY rowid DESC LIMIT 50').all(ideaId);}
 function open(ideaId,input){idea(ideaId);const id=text(input.commandId,100),old=db.prepare('SELECT * FROM idea_chats WHERE id=?').get(id);if(old){chat(ideaId,id);return old;}
 db.prepare('INSERT INTO idea_chats VALUES (?,?,?,?)').run(id,ideaId,'新对话',new Date().toISOString());return chat(ideaId,id);}
 function turns(ideaId,id){chat(ideaId,id);return db.prepare('SELECT id,text,answer,state,context,created_at FROM idea_chat_turns WHERE chat_id=? ORDER BY rowid DESC LIMIT 50').all(id).reverse().map(row=>({...row,context:JSON.parse(row.context),applied:JSON.parse(db.prepare('SELECT result FROM receipts WHERE id=?').get('idea_note_'+row.id)?.result||'null')}));}
 function start(ideaId,id,input){
 chat(ideaId,id);const request=text(input.commandId,100),message=text(input.text);
 const choice=input.model?{provider:text(input.model.provider,120),id:text(input.model.id,180)}:null;
 const payload=JSON.stringify({id,message,choice,includeIdea:input.includeIdea===true}),old=db.prepare('SELECT * FROM idea_chat_turns WHERE command_id=?').get(request);
 if(old){if(old.payload!==payload)fail('IDEMPOTENCY_CONFLICT');return {dispatch:false,turns:turns(ideaId,id)};}
 if(choice)registry.requireEnabled('cutdirector-director');
 if(db.prepare("SELECT 1 FROM idea_chat_turns WHERE chat_id=? AND state='pending'").get(id))fail('CHAT_BUSY');
 const base=idea(ideaId),context={ideaVersion:base.version,includeIdea:!!choice&&input.includeIdea===true,note:base.note,
 policy:require('./director-policy.cjs').reference},turnId=randomUUID(),history=turns(ideaId,id).filter(row=>row.state==='complete').slice(-8).map(row=>({text:row.text.slice(0,1000),answer:row.answer.slice(0,1000)}));
 db.prepare('INSERT INTO idea_chat_turns VALUES (?,?,?,?,?,?,?,?,?,?)').run(turnId,id,request,payload,message,null,'pending',JSON.stringify(context),new Date().toISOString(),null);
 db.prepare('UPDATE idea_chats SET title=? WHERE id=? AND title=?').run(message.slice(0,30),id,'新对话');
 return {dispatch:true,turnId,text:message,choice,history,context:{...context,note:undefined,...context.includeIdea?{idea:{text:base.text,note:base.note,url:base.url}}:{}}};
 }
 function finish(ideaId,id,input){chat(ideaId,id);const answer=text(input.text,2000);db.prepare("UPDATE idea_chat_turns SET answer=?,state='complete' WHERE id=? AND chat_id=? AND state='pending'").run(answer,input.turnId,id);return turns(ideaId,id);}
 function apply(ideaId,id,turnId,input){
 chat(ideaId,id);if(input.confirm!==true)fail('IDEA_APPROVAL_REQUIRED',403);
 const row=db.prepare("SELECT * FROM idea_chat_turns WHERE id=? AND chat_id=? AND state='complete'").get(turnId,id);if(!row)fail('CHAT_TURN_NOT_FOUND',404);
 const receipt=db.prepare('SELECT result FROM receipts WHERE id=?').get('idea_note_'+turnId);if(receipt)return JSON.parse(receipt.result);
 const context=JSON.parse(row.context);return ideas.update(ideaId,{commandId:'idea_note_'+turnId,expectedVersion:context.ideaVersion,note:row.answer});
 }
 function undo(ideaId,id,turnId,input){
 chat(ideaId,id);if(input.confirm!==true)fail('IDEA_APPROVAL_REQUIRED',403);
 const done=db.prepare('SELECT result FROM receipts WHERE id=?').get('idea_note_'+turnId);if(!done)fail('IDEA_NOT_APPLIED');
 const prior=db.prepare('SELECT result FROM receipts WHERE id=?').get('undo_idea_note_'+turnId);if(prior)return JSON.parse(prior.result);
 const row=db.prepare('SELECT context FROM idea_chat_turns WHERE id=? AND chat_id=?').get(turnId,id);if(!row)fail('CHAT_TURN_NOT_FOUND',404);
 return ideas.update(ideaId,{commandId:'undo_idea_note_'+turnId,expectedVersion:JSON.parse(done.result).version,note:JSON.parse(row.context).note});
 }
 return {list,open,turns,start,finish,apply,undo};
}
module.exports={createIdeaChat};
