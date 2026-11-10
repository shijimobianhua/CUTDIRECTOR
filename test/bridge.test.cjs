const {test}=require('node:test');const a=require('node:assert/strict'); const {ProjectStore}=require('../src/core/store.cjs');const {createServer}=require('../src/server.cjs');const {fixture,temp,command}=require('./helpers.cjs');
test('DSH tools and page facade share authoritative command entry and selection',async()=>{
 const store=new ProjectStore(temp());store.create(fixture());const server=createServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const registrations=[],routes=[];const ctx={tools:{register:t=>(registrations.push(t),()=>{})},skills:{register:()=>()=>{}},webServer:{register:r=>(routes.push(r),()=>{})},effect:f=>f()};
 try {
  const {apply}=await import('../src/host/index.js');apply(ctx,{adapterUrl:'http://127.0.0.1:'+server.address().port});
  const facade=require('node:http').createServer(routes[0].handler);await new Promise(r=>facade.listen(0,'127.0.0.1',r));
  try {const base='http://127.0.0.1:'+facade.address().port+'/video-agent';
   const page=await fetch(base+'/');a.equal(page.status,200);a.match(await page.text(),/<title>CUTDIRECTOR/);
   const icon=await fetch(base+'/icon.svg');a.equal(icon.status,200);a.match(icon.headers.get('content-type'),/image\/svg\+xml/);a.match(await icon.text(),/viewBox="0 0 24 24"/);
   const r=await fetch(base+'/command',{method:'POST',body:JSON.stringify(command())});a.equal(r.status,200);
   await fetch(base+'/selection',{method:'POST',body:JSON.stringify({segmentIds:['S']})});
   const read=await registrations[0].execute({},{});a.equal(read.project.captions[0].text,'纠正');a.deepEqual(read.selection,['S']);
   const result=await registrations[1].execute({baseRevision:1,commandId:'agent',op:'segment.trim',target:'S',params:{inFrame:1,outFrame:120}},{});
   a.equal(result.revision,2);a.equal(store.read('P').captions[0].text,'纠正');
   const conflict=await fetch(base+'/command',{method:'POST',body:JSON.stringify(command({commandId:'stale'}))});a.equal(conflict.status,409);
   a.equal((await fetch(base+'/active')).status,200);
   a.equal((await fetch(base+'/asr/status')).status,200);
   const srt=await fetch(base+'/transcript/srt',{method:'POST',body:JSON.stringify({srt:'1\n00:00:00,000 --> 00:00:01,000\ntext\n'})});a.equal(srt.status,200);a.equal(store.read('P').revision,2);
   const wrong=await fetch(base+'/command',{method:'POST',body:JSON.stringify(command({projectId:'other',baseRevision:2,commandId:'wrong-project'}))});a.equal(wrong.status,409);a.equal((await wrong.json()).code,'PROJECT_CHANGED');a.equal(store.read('P').revision,2);

  }finally{await new Promise(r=>facade.close(r));}
 }finally{await new Promise(r=>server.close(r));store.close();}
});
