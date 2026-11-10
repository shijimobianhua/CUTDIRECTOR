'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {ProjectStore}=require('../src/core/store.cjs');
const {microseconds}=require('../src/core/time.cjs');
const {createAgent}=require('../src/agent/loop.cjs');
const {providers}=require('../src/agent/provider.cjs');
const {kept,visibleEvidence}=require('../src/agent/evidence.cjs');
const {hash}=require('../src/core/util.cjs');

async function settle(agent,id){
  let run=agent.view(id);
  while(['planning','executing'].includes(run.status)){
    await delay(50);
    run=agent.view(id);
  }
  return run;
}
async function evaluate({file,modelId,models=providers()}){
  const content=fs.readFileSync(file,'utf8');
  const samples=JSON.parse(content);
  if(!Array.isArray(samples)||!samples.length)throw new Error('Evaluation requires a nonempty array');
  const results=[];
  for(const sample of samples){
    const fixture=JSON.parse(fs.readFileSync(path.resolve(path.dirname(file),sample.project),'utf8'));
    for(const variant of ['baseline','specialized','preferences']){
      const root=fs.mkdtempSync(path.join(os.tmpdir(),'cutdirector-eval-'));
      const store=new ProjectStore(root);
      try{
        const {projectId}=fixture;
        store.create(fixture);
        const agent=createAgent({store,models,specialized:variant!=='baseline'});
        // Each condition uses an identical project and edit revision.
        for(const [i,rule] of (sample.preferences||[]).entries()){
          const id='F'+i;
          store.apply({projectId,baseRevision:store.read(projectId).revision,commandId:'EVAL_'+i,
            actor:'human',op:'feedback.add',target:projectId,params:{id,request:rule,actualDiff:[],
              decision:'accepted',preferenceConfirmed:true}});
          if(variant==='preferences')agent.memory.update({projectId,action:'approve',caseId:id});
        }
        const revision=store.read(projectId).revision;
        const id=randomUUID();
        agent.start({id,projectId,modelId,request:sample.request,mode:sample.mode||'edit',intent:sample.intent});
        let run=await settle(agent,id);
        const unauthorizedWrites=store.read(projectId).revision-revision;
        if(run.status==='awaiting-approval'&&run.proposal.op!=='render'){
          agent.approve(id,run.proposal.id);
          run=await settle(agent,id);
        }
        const project=store.read(projectId);
        const duration=microseconds(project.clips.reduce((sum,c)=>sum+c.outFrame-c.inFrame,0),project.outputSpec.fps)/1e6;
        const terms=sample.expect?.mustKeep||sample.intent?.mustKeep||[];
        const preserved=kept(terms,visibleEvidence(project,project.clips)).length;
        const target=sample.expect?.targetSec??sample.intent?.targetSec;
        results.push({id:sample.id,variant,status:run.status,modelSteps:run.steps,
          toolCalls:run.toolCalls||0,unauthorizedWrites,preserved,required:terms.length,
          durationErrorSec:target===undefined?null:Math.abs(duration-target),
          reviewRequired:true,error:run.error?.code});
      }finally{
        store.close();
        fs.rmSync(root,{recursive:true,force:true});
      }
    }
  }
  return {fixtureHash:hash(content),modelId,results};
}
module.exports={evaluate};
if(require.main===module){
  const [file,modelId]=process.argv.slice(2);
  if(!file||!modelId)throw new Error('Usage: node tools/agent-eval.cjs <samples.json> <model-id>');
  evaluate({file,modelId}).then(report=>{
    console.log(JSON.stringify(report,null,2));
    if(report.results.some(r=>r.unauthorizedWrites||r.error))process.exitCode=1;
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
