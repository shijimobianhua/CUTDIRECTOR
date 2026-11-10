'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const {temp}=require('./helpers.cjs');
const {lock}=require('../src/core/util.cjs');
const {build}=require('../tools/package-release.cjs');
const {writerLifecycle}=require('../src/host/writer.cjs');

test('dead locks recover once, live and malformed owners remain protected',()=>{
 const root=temp(),file=path.join(root,'.writer.lock');
 const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8',windowsHide:true});
 fs.writeFileSync(file,JSON.stringify({pid:Number(dead.stdout),startedAt:'old'}));
 const release=lock(root,{recoverStale:true});
 assert.equal(JSON.parse(fs.readFileSync(file)).pid,process.pid);
 assert.throws(()=>lock(root,{recoverStale:true}),{code:'WRITER_LOCKED'});
 release();
 fs.writeFileSync(file,'{}');
 assert.throws(()=>lock(root,{recoverStale:true}),{code:'WRITER_LOCKED'});
 assert.equal(fs.readFileSync(file,'utf8'),'{}');
});

test('an unhealthy live writer lock prevents a second spawn and logs a clear failure',async()=>{
 const root=temp(),data=path.join(root,'.m1-data');
 fs.mkdirSync(data);
 const ownership=JSON.stringify({pid:process.pid,startedAt:'live-owner'});
 fs.writeFileSync(path.join(data,'.writer.lock'),ownership);
 const server=http.createServer((_req,res)=>{res.writeHead(503);res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const lifecycle=writerLifecycle('http://127.0.0.1:'+server.address().port,{repoRoot:root});
  await assert.rejects(lifecycle.ensure(),{code:'WRITER_UNAVAILABLE',status:503});
  assert.equal(fs.readFileSync(path.join(data,'.writer.lock'),'utf8'),ownership);
  const log=fs.readFileSync(path.join(root,'.m3-data/writer-start.log'),'utf8');
  assert.match(log,/Live writer PID/);
  assert.doesNotMatch(log,/Starting /);
 } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('packaged Host cold starts once, survives Host disposal, reuses PID and reports startup failure',async()=>{
 const root=temp(),release=build(path.join(root,'release'));
 const portServer=http.createServer();
 await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
 const port=portServer.address().port;
 await new Promise(resolve=>portServer.close(resolve));
 const {apply}=await import(require('node:url').pathToFileURL(path.join(release,'plugin/index.js')));
 let dispose;
 function host(config) {
  let handler;
  apply({tools:{register:()=>()=>{}},skills:{register:()=>()=>{}},webServer:{register:route=>(handler=route.handler,()=>{})},effect:fn=>{dispose=fn();}},config);
  return http.createServer(handler);
 }
 const config={adapterUrl:'http://127.0.0.1:'+port,repoRoot:root};
 let facade=host(config),pid;
 try {
  await new Promise(resolve=>facade.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+facade.address().port+'/video-agent';
  const responses=await Promise.all(Array.from({length:8},()=>fetch(url+'/projects')));
  for(const response of responses) assert.equal(response.status,200,await response.text());
  pid=JSON.parse(fs.readFileSync(path.join(root,'.m1-data/.writer.lock'))).pid;
  const icon=await fetch(url+'/icon.svg');
  assert.equal(icon.headers.get('content-type'),'image/svg+xml');
  assert.equal(await icon.text(),fs.readFileSync('src/host/icon.svg','utf8'));
  dispose();
  await new Promise(resolve=>facade.close(resolve));
  process.kill(pid,0);
  facade=host(config);
  await new Promise(resolve=>facade.listen(0,'127.0.0.1',resolve));
  assert.equal((await fetch('http://127.0.0.1:'+facade.address().port+'/video-agent/projects')).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.m1-data/.writer.lock'))).pid,pid);
 } finally {
  dispose();
  await new Promise(resolve=>facade.close(resolve));
  if(pid) process.kill(pid);
 }
 // An invalid lock must fail closed and still allow the Host-owned icon.
 const broken=temp();
 fs.mkdirSync(path.join(broken,'.m1-data'));
 fs.writeFileSync(path.join(broken,'.m1-data/.writer.lock'),'invalid');
 facade=host({...config,repoRoot:broken});
 await new Promise(resolve=>facade.listen(0,'127.0.0.1',resolve));
 try {
  const url='http://127.0.0.1:'+facade.address().port+'/video-agent';
  const response=await fetch(url+'/projects');
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'WRITER_UNAVAILABLE');
  assert.equal((await fetch(url+'/icon.svg')).status,200);
  assert.match(fs.readFileSync(path.join(broken,'.m3-data/writer-start.log'),'utf8'),/writer unavailable/);
 } finally { dispose(); await new Promise(resolve=>facade.close(resolve)); }
});
