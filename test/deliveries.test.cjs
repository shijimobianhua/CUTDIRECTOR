const {test}=require('node:test'),a=require('node:assert/strict'),path=require('node:path');const {fixture,temp,command}=require('./helpers.cjs'),{ProjectStore}=require('../src/core/store.cjs'),{Jobs}=require('../src/core/jobs.cjs'),{createServer}=require('../src/server.cjs');
test('project/feedback/delivery entries reopen and bind feedback to explicit observed revision',async()=>{
 const root=temp();let s=new ProjectStore(root);s.create(fixture());s.apply(command());const server=createServer(s),jobs=new Jobs(path.join(root,'jobs'),s);require('../src/render-routes.cjs').attach(server,jobs);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port;a.equal((await (await fetch(base+'/projects')).json()).projects[0].revision,1);
 const c=command({baseRevision:1,commandId:'feedback',op:'feedback.add',target:'P',params:{id:'F',request:'Keep corrected entity',revision:1,actualDiff:s.history('P')[1].diff,decision:'accepted',preferenceConfirmed:true}});const r=await fetch(base+'/command',{method:'POST',body:JSON.stringify(c)});a.equal(r.status,200);a.equal(s.read('P').feedback[0].revision,1);a.equal(s.read('P').revision,2);
 a.throws(()=>s.apply(command({baseRevision:2,commandId:'future',op:'feedback.add',target:'P',params:{...c.params,id:'F2',revision:99}})),{code:'VALIDATION_ERROR'});
 a.deepEqual((await (await fetch(base+'/deliveries?projectId=P')).json()).jobs,[]);
 }finally{await new Promise(r=>server.close(r));s.close();}s=new ProjectStore(root);try{a.equal(s.read('P').feedback[0].preferenceConfirmed,true);a.equal(s.list()[0].revision,2);}finally{s.close();}
});
