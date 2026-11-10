const {test}=require('node:test'); const a=require('node:assert/strict'); const {ProjectStore}=require('../src/core/store.cjs'); const {fixture,temp,command}=require('./helpers.cjs');
test('r3 restores r1 as r4, immutable history and reopen current revision',()=>{
 const dir=temp(); let s=new ProjectStore(dir); try {s.create(fixture());
 for(let i=0;i<3;i++) s.apply(command({baseRevision:i,commandId:'c'+i,params:{text:'text'+i}}));
 s.apply(command({baseRevision:3,commandId:'restore',op:'revision.restore',target:'P',params:{revision:1}}));
 a.equal(s.read('P').revision,4); a.equal(s.read('P').captions[0].text,'text0'); a.equal(s.history('P')[3].snapshot.captions[0].text,'text2');
 s.close(); s=new ProjectStore(dir); a.equal(s.read('P').revision,4);
 a.throws(()=>s.apply(command({baseRevision:4,commandId:'bad',op:'revision.restore',target:'P',params:{revision:99}})),{code:'NOT_FOUND'});
 } finally {s.close();}
});
test('injected pre-rename failure leaves project, history and ledger unchanged on reopen',()=>{
 const dir=temp(); let s=new ProjectStore(dir); s.create(fixture()); s.close();
 s=new ProjectStore(dir,{beforeRename:()=>{throw new Error('injected crash');}});
 try {a.throws(()=>s.apply(command()),/injected crash/);} finally {s.close();}
 s=new ProjectStore(dir); try {a.equal(s.read('P').revision,0); a.equal(s.history('P').length,1); a.equal(s.apply(command()).revision,1);} finally {s.close();}
});
