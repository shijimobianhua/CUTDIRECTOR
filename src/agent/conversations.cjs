'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomic,fail}=require('../core/util.cjs');

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function readJSON(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}

function createConversations(store,root,view){
  const index=projectId=>{
    store.read(projectId);
    const file=path.join(root,'chat-index',projectId+'.json');
    return {file,data:readJSON(file,{schemaVersion:1,recentId:null,chats:[]})};
  };
  function list(projectId){
    const {data}=index(projectId);
    return {recentId:data.recentId,conversations:data.chats.map(summary).reverse()};
  }
  function summary({runs,...chat}){return chat;}
  function create(projectId){
    const {file,data}=index(projectId);
    const now=new Date().toISOString();
    const chat={schemaVersion:1,id:randomUUID(),projectId,title:'新对话',createdAt:now,updatedAt:now,runs:[]};
    data.chats.push(chat);
    data.recentId=chat.id;
    atomic(file,data);
    return summary(chat);
  }
  function locate(projectId,id){
    const state=index(projectId);
    const chat=state.data.chats.find(chat=>chat.id===id);
    if(!chat)fail('NOT_FOUND');
    return {...state,chat};
  }
  function open(projectId,id){
    const {file,data,chat}=locate(projectId,id);
    data.recentId=chat.id;
    atomic(file,data);
    return summary(chat);
  }
  function ownedRun(projectId,id,conversationId){
    try{
      const run=view(id);
      if(run.projectId===projectId&&run.conversationId===conversationId)return run;
    }catch(error){if(error.code!=='NOT_FOUND')throw error;}
    return null;
  }
  function runsFor(chat,ids=chat.runs){
    return ids.map(id=>ownedRun(chat.projectId,id,chat.id)).filter(Boolean);
  }
  function legacy(projectId){
    const dir=path.join(root,'runs');
    if(!fs.existsSync(dir))return {runs:[],unreadable:0};
    const runs=[];
    let unreadable=0;
    for(const name of fs.readdirSync(dir)){
      const id=name.slice(0,-5);
      if(!name.endsWith('.json')||!uuid.test(id))continue;
      try{
        const run=ownedRun(projectId,id,undefined);
        if(run)runs.push({...run,createdAt:run.createdAt||fs.statSync(path.join(dir,name)).birthtime.toISOString()});
      }catch(error){if(error instanceof SyntaxError)unreadable++;else throw error;}
    }
    runs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    return {runs,unreadable};
  }
  function detail(projectId,id,before){
    store.read(projectId);
    const chat=id==='legacy'?null:locate(projectId,id).chat;
    const old=chat?null:legacy(projectId);
    const ids=chat?.runs??old.runs.map(run=>run.id);
    const end=before===null?ids.length:ids.indexOf(before);
    if(end<0)fail('AGENT_INPUT_INVALID');
    const start=Math.max(0,end-20);
    const turns=chat?runsFor(chat,ids.slice(start,end)):old.runs.slice(start,end);
    const latest=chat?recent(chat,1).at(-1):null;
    return {conversation:chat?summary(chat):{id:'legacy',projectId,title:'旧记录'},
      intent:latest?.intent??{},selection:latest?.selection??[],runs:turns,unreadable:old?.unreadable??0,
      nextBefore:start>0?ids[start]:null};
  }
  function recent(chat,limit){
    const results=[];
    for(let i=chat.runs.length-1;i>=0&&results.length<limit;i--){
      const run=ownedRun(chat.projectId,chat.runs[i],chat.id);
      if(run)results.unshift(run);
    }
    return results;
  }
  function previous(projectId,id){
    return recent(locate(projectId,id).chat,6);
  }
  function register(run){
    const {file,data,chat}=locate(run.projectId,run.conversationId);
    if(chat.runs.includes(run.id))return;
    if(!chat.runs.length)chat.title=run.request.replace(/\s+/g,' ').slice(0,36);
    chat.runs.push(run.id);
    chat.updatedAt=run.createdAt;
    atomic(file,data);
  }
  return {create,list,open,detail,previous,register};
}
module.exports={createConversations};
