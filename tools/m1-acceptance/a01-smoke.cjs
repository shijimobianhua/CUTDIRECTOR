'use strict';
const fs=require('node:fs'),path=require('node:path');const {ingest}=require('../../src/adapters/media.cjs');const {createProject,syncNative}=require('../../src/adapters/fablecut.cjs');const {ProjectStore}=require('../../src/core/store.cjs');const {Jobs}=require('../../src/core/jobs.cjs');
async function main(){
 const source=process.argv[2];if(!source)throw new Error('Usage: node tools/m1-acceptance/a01-smoke.cjs <local A-01 path>');
 const root=path.resolve('.m1-data','a01-'+Date.now()),s=new ProjectStore(root);
 try {
  const asset=ingest(source,'A1'),p=createProject({projectId:'A01',media:[asset],fps:asset.fps,width:360,height:720});
  p.clips=[{id:'S1',mediaId:'A1',kind:'video',track:'V1',speed:1,inFrame:0,outFrame:24,startFrame:0}];p.tracks[0].segmentIds=['S1'];
  p.captions=[{id:'C1',segmentId:'S1',sourceInFrame:0,sourceOutFrame:24,text:'M1 渲染测试（非转写）',wordIds:[],corrections:[]}];s.create(syncNative(p));
  const jobs=new Jobs(path.join(root,'renders'),s),j=jobs.start({projectId:'A01',revision:0,requestId:'smoke'}),done=await jobs.settle(j.id);
  if(done.status!=='succeeded')throw new Error(JSON.stringify(done.error));
  s.close();const reopen=new ProjectStore(root);try{if(reopen.read('A01').revision!==0)throw new Error('Reopen failed');}finally{reopen.close();}
  console.log(JSON.stringify({status:done.status,projectId:done.projectId,revision:done.revision,sourceHash:asset.hash,artifacts:done.artifacts,evidenceRoot:root},null,2));
 }finally{s.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
