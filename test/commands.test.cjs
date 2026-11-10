const {test}=require('node:test'); const a=require('node:assert/strict'); const {ProjectStore}=require('../src/core/store.cjs'); const {fixture,temp,command}=require('./helpers.cjs');
test('single writer, atomic batch, durable idempotency and concurrent stale requests',async()=>{
 const dir=temp(); let s=new ProjectStore(dir); try {
 s.create(fixture()); a.throws(()=>new ProjectStore(dir),{code:'WRITER_LOCKED'});
 const results=await Promise.allSettled([command(),command({commandId:'other'})].map(c=>Promise.resolve().then(()=>s.apply(c))));
 a.equal(results.filter(r=>r.status==='fulfilled').length,1); a.equal(results[1].reason.code,'REVISION_CONFLICT');
 const original=s.apply(command()); a.throws(()=>s.apply(command({params:{text:'different'}})),{code:'COMMAND_ID_CONFLICT'});
 const batch=command({commandId:'batch',baseRevision:1,op:'batch',target:'P',params:{commands:[{op:'caption.correct',target:'C',params:{text:'bad'}},{op:'segment.trim',target:'missing',params:{inFrame:0,outFrame:1}}]}});
 a.throws(()=>s.apply(batch),{code:'TARGET_NOT_FOUND'}); a.equal(s.read('P').captions[0].text,'纠正'); a.equal(s.read('P').revision,1);
 s.close(); s=new ProjectStore(dir); a.deepEqual(s.apply(command()),original);
 a.throws(()=>s.apply({...command(),force:true}),{code:'VALIDATION_ERROR'});
 } finally {s.close();}
});
