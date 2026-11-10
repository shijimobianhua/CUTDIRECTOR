const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,temp}=require('./helpers.cjs'),{ProjectStore}=require('../src/core/store.cjs'),{createServer}=require('../src/server.cjs'),{catalog}=require('../tools/skill-catalog.cjs'),{hash}=require('../src/core/util.cjs');
test('five skills load with reproducible hashes and executable tool dependencies; ASR unavailable then explicit replay',async()=>{
 const dir=temp(),p=fixture();const input=path.join(dir,'synthetic bytes');fs.writeFileSync(input,'synthetic-test ASR transport only');p.media[0].path=input;p.media[0].hash=hash(fs.readFileSync(input));p.media[0].hasAudio=true;
 const s=new ProjectStore(path.join(dir,'data'));s.create(p);const server=createServer(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));const tools=[],skills=[];
 const previous=process.env.VIDEO_ASR_FIXTURE;delete process.env.VIDEO_ASR_FIXTURE;
 try{const {apply}=await import('../src/host/index.js');apply({tools:{register:t=>(tools.push(t),()=>{})},skills:{register:k=>(skills.push(k),()=>{})},webServer:{register:()=>()=>{}},effect:f=>f()},{adapterUrl:'http://127.0.0.1:'+server.address().port});
 const cap=await tools.find(t=>t.name==='video_capabilities').execute();a.equal(skills.length,5);
 for(const k of catalog()){const loaded=skills.find(s=>s.name===k.name);a.equal(hash(loaded.content),k.hash);a.equal(cap.skills.find(s=>s.name===k.name).hash,k.hash);for(const name of k.tools)a.ok(tools.some(t=>t.name===name));a.match(loaded.content,new RegExp('name: '+k.name));a.ok(k.description.length>20);}
 const intake=tools.find(t=>t.name==='video_transcribe'),args={assetId:'A',baseRevision:0,commandId:'asr'};await a.rejects(()=>intake.execute(args,{}),{code:'PROVIDER_NOT_READY'});a.equal(s.read('P').revision,0);
 const transcript={id:'T',assetId:'A',model:'synthetic-test',language:'zh',precision:'sentence',timeUnit:'microseconds',timeReference:'asset-origin',words:[{id:'W',text:'不是十元',startUs:500000,endUs:1000000,confidence:null},{id:'W2',text:'synthetic continuation',startUs:3000000,endUs:4000000,confidence:null}],missing:[{startUs:4000000,endUs:10000000,reason:'Synthetic transport-only fixture'}],uncertain:[]};
 const file=path.join(dir,'fixture.json');fs.writeFileSync(file,JSON.stringify({fixtureVersion:1,assetHash:p.media[0].hash,provenance:{kind:'synthetic-test',source:'M3 transport test, not ASR accuracy'},transcript}));process.env.VIDEO_ASR_FIXTURE=file;
 const result=await intake.execute(args,{});a.deepEqual(await intake.execute(args,{}),result);a.equal(result.realTranscription,false);a.equal(s.read('P').transcripts[0].fixtureHash,hash(fs.readFileSync(file)));a.equal(s.read('P').transcripts[0].provenance.kind,'synthetic-test');
 // Existing caption overlap is preserved; fresh non-overlapping source words create instances.
 const before=s.read('P').captions;s.apply({projectId:'P',baseRevision:1,commandId:'captions',actor:'agent',op:'captions.generate',target:'P',params:{transcriptId:'T',segmentIds:['S']}});const captions=s.read('P').captions;a.deepEqual(captions.slice(0,before.length),before);a.equal(captions.length,before.length+1);a.equal(captions.at(-1).provenance.kind,'synthetic-test');a.deepEqual(captions.at(-1).wordIds,['W2']);

 }finally{if(previous===undefined)delete process.env.VIDEO_ASR_FIXTURE;else process.env.VIDEO_ASR_FIXTURE=previous;await new Promise(r=>server.close(r));s.close();}
});
