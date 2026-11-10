const {test}=require('node:test');const a=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const {ProjectStore}=require('../src/core/store.cjs');const {createServer}=require('../src/server.cjs');const {fixture,temp,command}=require('./helpers.cjs');
test('AC-01..05 automated architecture: read, correct then trim, conflict, replay/restore, reopen/missing media/history',async()=>{
 const root=temp();let s=new ProjectStore(root);s.create(fixture());let server=createServer(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let base='http://127.0.0.1:'+server.address().port;const api=async(route,c)=>{const r=await fetch(base+route,{method:c?'POST':'GET',body:c?JSON.stringify(c):undefined});return {status:r.status,value:await r.json()};};
 try {
  const page=(await api('/project')).value.project;const agent=(await api('/project')).value.project;a.deepEqual(page,agent);
  const human=(await api('/command',command())).value;a.equal(human.revision,1);
  const trim=command({actor:'agent',commandId:'trim',baseRevision:1,op:'segment.trim',target:'S',params:{inFrame:1,outFrame:120}});
  const trimmed=(await api('/command',trim)).value;a.equal(trimmed.revision,2);a.ok(trimmed.diff.some(x=>x.key==='clips'));a.equal(s.read('P').captions[0].text,'纠正');
  a.equal((await api('/command',command({commandId:'stale'}))).status,409);
  a.deepEqual((await api('/command',trim)).value,trimmed);a.equal((await api('/command',{...trim,params:{inFrame:2,outFrame:120}})).value.code,'COMMAND_ID_CONFLICT');
  const restore=command({commandId:'restore',baseRevision:2,op:'revision.restore',target:'P',params:{revision:1}});a.equal((await api('/command',restore)).value.revision,3);
  await new Promise(r=>server.close(r));s.close();s=new ProjectStore(root);server=createServer(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const reopened=(await api('/project')).value;a.equal(reopened.project.revision,3);a.equal(reopened.project.clips[0].inFrame,0);a.equal(reopened.project.captions[0].text,'纠正');a.equal(reopened.mediaStatus[0].code,'MEDIA_MISSING');a.equal(reopened.history.length,4);
 }finally{await new Promise(r=>server.close(r));s.close();}
});
test('self-contained DSH bundle loads Host, skills and Client registration without dependencies',async()=>{
 const out=require('../tools/package-plugin.cjs').build(path.join(temp(),'plugin'));const pkg=JSON.parse(fs.readFileSync(path.join(out,'package.json')));a.equal(pkg.exports['./client'],'./client.js');
 const host=await import(require('node:url').pathToFileURL(path.join(out,'index.js')));const tools=[],skills=[];host.apply({tools:{register:t=>(tools.push(t),()=>{})},skills:{register:s=>(skills.push(s),()=>{})},webServer:{register:()=>()=>{}},effect:f=>f()});a.ok(tools.some(t=>t.name==='video_inspect'));a.ok(tools.some(t=>t.name==='video_project_apply'));a.equal(skills.length,5);
 let client;vm.runInNewContext(fs.readFileSync(path.join(out,'client.js'),'utf8'),{window:{__ModuleLoader__:{load:v=>client=v}}});const plugin=client.factory(n=>n==='react'?{Component:class{},createElement(){}}:null);const slots=[];
 plugin.apply({effect:f=>f(),locale:{register:()=>()=>{}},slots:{inject:(_,f)=>f(),register:(config)=>{slots.push(config);}}});a.ok(slots.some(s=>s.name==='main'&&s.key==='video-agent'));a.ok(!slots.some(s=>s.name==='video-agent.conversation'));a.ok(slots.some(s=>s.name==='sidebar.panellist'));a.ok(!slots.some(s=>['shell.overlay','conversation.composer.dock'].includes(s.name)));
});
