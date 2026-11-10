const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {fixture,temp}=require('./helpers.cjs'),{ProjectStore}=require('../src/core/store.cjs'),{Jobs}=require('../src/core/jobs.cjs'),{createServer}=require('../src/server.cjs'),{hash}=require('../src/core/util.cjs');
test('published evidence supports byte range, rejects invalid ranges and changed artifact',async()=>{
 const dir=temp(),s=new ProjectStore(dir);s.create(fixture());const jobs=new Jobs(path.join(dir,'jobs'),s,{render:async(m,out)=>{fs.mkdirSync(out);fs.writeFileSync(path.join(out,'S.mp4'),'synthetic range-test bytes');return [{name:'S.mp4',hash:hash('synthetic range-test bytes')}];}});const server=createServer(s);require('../src/render-routes.cjs').attach(server,jobs);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const j=jobs.start({projectId:'P',revision:0,requestId:'inspect',type:'inspect'});await jobs.settle(j.id);const url='http://127.0.0.1:'+server.address().port+'/artifact?id='+j.id+'&name=S.mp4';
 const r=await fetch(url,{headers:{Range:'bytes=0-8'}});a.equal(r.status,206);a.equal(await r.text(),'synthetic');a.equal((await fetch(url,{headers:{Range:'bytes=999-'}})).status,416);
 fs.writeFileSync(jobs.artifact(j.id,'S.mp4').path,'tampered');a.equal((await fetch(url)).status,400);
 }finally{await new Promise(r=>server.close(r));s.close();}
});
