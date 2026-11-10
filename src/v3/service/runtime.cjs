'use strict';
function issue(code,status=409){return Object.assign(new Error(code),{code,status});}
const tools=['inspect-project','read-shot','read-subtitles','list-candidates'];
function createRuntime(db,project,story,arrangement,production){
  db.prepare("UPDATE director_runs SET state='interrupted' WHERE state IN ('model','tool','ready')").run();
  function get(projectId,chatId,turnId){
    project(projectId);
    const row=db.prepare('SELECT r.* FROM director_runs r JOIN chat_turns t ON t.id=r.turn_id JOIN chats c ON c.id=t.chat_id WHERE r.turn_id=? AND c.id=? AND c.project_id=?').get(turnId,chatId,projectId);
    if(!row)throw issue('RUN_NOT_FOUND',404);
    return row;
  }
  function assertFresh(projectId,turnId){
    const context=JSON.parse(db.prepare('SELECT context FROM chat_turns WHERE id=?').get(turnId).context);
    if((story(projectId)?.version||null)!==(context.production.storyVersion||null)||
      (arrangement(projectId)?.version||null)!==(context.arrangementVersion||null))throw issue('RUN_STALE');
    return context;
  }
  function begin(projectId,chatId,turnId){
    const row=get(projectId,chatId,turnId);
    if(row.state!=='ready')throw issue(row.state==='cancelled'?'RUN_CANCELLED':'RUN_NOT_READY');
    if(row.calls>=4||Date.now()-Date.parse(row.created_at)>90000)throw issue('RUN_BUDGET');
    assertFresh(projectId,turnId);
    const result=db.prepare("UPDATE director_runs SET state='model',calls=calls+1 WHERE turn_id=? AND state='ready'").run(turnId);
    if(!result.changes)throw issue('RUN_NOT_READY');
    return get(projectId,chatId,turnId);
  }
  function read(projectId,chatId,turnId,input){
    const row=get(projectId,chatId,turnId);
    if(row.state!=='model')throw issue(row.state==='cancelled'?'RUN_CANCELLED':'RUN_NOT_READY');
    if(row.tools>=6||!input||Object.keys(input).some(key=>!['tool','number','after'].includes(key))||!tools.includes(input.tool))throw issue('RUN_BUDGET');
    const context=assertFresh(projectId,turnId);
    // The transition is persisted before executing a registered, synchronous read.
    db.prepare("UPDATE director_runs SET state='tool',tools=tools+1 WHERE turn_id=? AND state='model'").run(turnId);
    let result;
    try{
      if(input.tool==='inspect-project')result=production(projectId);
      if(input.tool==='read-shot'){
        if(!context.includeStory||!context.shotNumbers.includes(input.number))throw issue('RUN_TOOL_FORBIDDEN',403);
        const saved=story(projectId),shot=saved.shots[input.number-1];
        result={version:saved.version,number:input.number,action:shot.action,seconds:shot.durationUs/1e6,startFrameIdea:shot.startFrameIdea,endFrameIdea:shot.endFrameIdea};
      }
      if(input.tool==='read-subtitles'){
        if(!context.includeSubtitles)throw issue('RUN_TOOL_FORBIDDEN',403);
        const after=input.after??0;
        if(!Number.isInteger(after)||after<0)throw issue('RUN_TOOL_FORBIDDEN',403);
        const evidence=context.cutEvidence?.items||[],last=evidence.at(-1)?.number||0;
        if(after>last)throw issue('RUN_TOOL_FORBIDDEN',403);
        if(after===last&&!context.cutEvidence?.complete){
          const request=db.prepare('SELECT text FROM chat_turns WHERE id=?').get(turnId).text;
          const all=require('./roughcut.cjs').cutEvidence(arrangement(projectId),context.cutEvidence?.focusAssetId,request,{maxItems:2000,maxChars:64000});
          let size=0;const page=[];
          for(const cue of all?.items||[]){if(cue.number<=after)continue;if(page.length>=200||size+cue.text.length>6000)break;page.push(cue);size+=cue.text.length;}
          const items=[...evidence,...page],complete=all?.complete===true&&items.length===all.total;
          context.cutEvidence={...context.cutEvidence,items,complete};
          db.prepare('UPDATE chat_turns SET context=? WHERE id=?').run(JSON.stringify(context),turnId);
          result={version:context.arrangementVersion,items:page,total:all?.total||0,complete,nextAfter:page.at(-1)?.number||after};
        }else result={version:context.arrangementVersion,items:evidence.filter(cue=>cue.number>after).slice(0,20),total:context.cutEvidence?.total||0,complete:context.cutEvidence?.complete===true};
      }
      if(input.tool==='list-candidates'){
        const rows=db.prepare('SELECT id,shot_id,story_version,state FROM generation_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 20').all(projectId);
        result={items:rows};
      }
      db.prepare('INSERT INTO director_steps VALUES (?,?,?,?,?)').run(turnId,row.tools+1,JSON.stringify(input),JSON.stringify(result),new Date().toISOString());
      db.prepare("UPDATE director_runs SET state='ready' WHERE turn_id=? AND state='tool'").run(turnId);
      return result;
    }catch(error){
      db.prepare("UPDATE director_runs SET state='ready' WHERE turn_id=? AND state='tool'").run(turnId);
      throw error;
    }
  }
  function finish(projectId,chatId,turnId){
    const row=get(projectId,chatId,turnId);
    if(row.state==='cancelled')throw issue('RUN_CANCELLED');
    db.prepare("UPDATE director_runs SET state='complete' WHERE turn_id=? AND state IN ('model','ready')").run(turnId);
  }
  function cancel(projectId,chatId,turnId){
    get(projectId,chatId,turnId);
    db.prepare("UPDATE director_runs SET state='cancelled' WHERE turn_id=? AND state NOT IN ('complete','cancelled')").run(turnId);
    db.prepare("UPDATE chat_turns SET state='interrupted',answer='已停止这次建议。已保存的作品和记录都在。' WHERE id=? AND chat_id=? AND state='pending'").run(turnId,chatId);
    return {stopped:true};
  }
  return {get,begin,read,finish,cancel};
}
module.exports={createRuntime,tools};
