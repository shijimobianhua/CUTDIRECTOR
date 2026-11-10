'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const {createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createReferenceAnalyzer}=require('../src/v3/service/reference-analyzer.cjs');
for(const phase of ['scene analysis','frame extraction'])test('Plugin shutdown stops owned process during '+phase+' and prevents late records',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-ref-stop-'));mkdirSync(join(root,'media'));
 const bytes=Buffer.from('owned fixture'),digest=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(root,'media',digest),bytes);
 let calls=0,records=0,pid,started;
 const ready=new Promise(resolve=>started=resolve);
 const analyzer=createReferenceAnalyzer(root,{
   file(){return {kind:'video',durationUs:2000000,digest,size:bytes.length};},
   record(){records++;throw new Error('must not publish after stop');}
 },{
   run:async(command,args,options)=>{
     calls++;
     if(phase==='frame extraction'&&calls===1)return {stderr:'pts_time:1'};
     assert.ok(options.signal instanceof AbortSignal);
     const child=promisify(execFile)(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:options.signal,windowsHide:true});
     pid=child.child.pid;
     child.child.once('spawn',started);
     return child;
   }
 });
 t.after(async()=>{await analyzer.stop();rmSync(root,{recursive:true,force:true});});
 const pending=analyzer.analyze('project','reference',{confirm:true});
 const rejected=assert.rejects(pending,{code:'REFERENCE_ANALYSIS_STOPPED'});
 await ready;
 await analyzer.stop();
 await rejected;
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 assert.equal(records,0);assert.equal(calls,phase==='scene analysis'?1:2);
 await assert.rejects(analyzer.analyze('project','reference',{confirm:true}),{code:'REFERENCE_ANALYSIS_STOPPED'});
 assert.equal(records,0);
});
