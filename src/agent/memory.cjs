'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomic,fail}=require('../core/util.cjs');
const {short}=require('./context.cjs');

function createMemory(store,root){
  const file=path.join(root,'preferences.json');
  const list=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  function view(projectId){
    const p=store.read(projectId);
    const history=store.envelope(projectId).history;
    const confirmedByHuman=new Set(history.flatMap(h=>{
      if(h.actor!=='human'||h.command?.op!=='feedback.add')return [];
      const f=h.snapshot.feedback.find(item=>item.id===h.command.params.id);
      return f?.preferenceConfirmed?[JSON.stringify([f.id,f.request,f.decision,f.revision])]:[];
    }));
    const cases=p.feedback.slice(-30).reverse().map(f=>({id:f.id,rule:short(f.request,400),revision:f.revision,
      decision:f.decision,confirmed:f.preferenceConfirmed&&confirmedByHuman.has(JSON.stringify([f.id,f.request,f.decision,f.revision]))}));
    // Reconstruct low-confidence cases from committed history, including after a restart.
    const recent=history.slice(-60);
    const agentTargets=new Set();
    for(const {actor,command,revision} of recent){
      if(!command)continue;
      const key=command.op+'|'+command.target;
      if(actor==='agent')agentTargets.add(key);
      if(actor==='human'&&(command.op==='revision.restore'||agentTargets.has(key)))
        cases.push({id:command.commandId,revision,decision:'revised',confirmed:false,op:command.op});
    }
    return {cases,preferences:list().filter(x=>x.scope==='global'||x.projectId===projectId)};
  }
  function update({projectId,action,caseId,id}){
    const {cases}=view(projectId);
    const all=list();
    let entry=all.find(x=>x.id===id&&x.projectId===projectId);
    if(action==='approve'){
      const source=cases.find(c=>c.id===caseId&&c.confirmed&&c.decision==='accepted');
      if(!source?.rule.trim()) fail('AGENT_PREFERENCE_INVALID','需要已接受且明确确认的反馈');
      entry=all.find(x=>x.caseId===caseId&&x.projectId===projectId&&x.active);
      if(entry)return entry;
      entry={id:'PREF_'+randomUUID(),projectId,scope:'project',caseId,revision:source.revision,rule:source.rule,active:true};
      all.push(entry);
    }else{
      if(!entry||!entry.active||!['revoke','promote'].includes(action)) fail('AGENT_PREFERENCE_INVALID');
      if(action==='revoke')entry.active=false;
      if(action==='promote')entry.scope='global';
    }
    atomic(file,all);
    return entry;
  }
  const active=projectId=>list().filter(x=>x.active&&(x.scope==='global'||x.projectId===projectId))
    .sort((a,b)=>Number(b.scope==='project')-Number(a.scope==='project'));
  return {view,update,active};
}
module.exports={createMemory};
