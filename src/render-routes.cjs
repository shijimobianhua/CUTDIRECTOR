'use strict';
const fs=require('node:fs');const {body,send}=require('./server.cjs');
function attach(server,jobs){server.renderRoute=async(req,res,u)=>{
 if(req.method==='POST'&&u.pathname==='/job/cancel'){send(res,200,jobs.cancel((await body(req)).id));return true;}
 if(req.method==='POST'&&u.pathname==='/job/retry'){send(res,202,jobs.retry((await body(req)).id));return true;}
 if(req.method==='POST'&&u.pathname==='/render'){send(res,202,jobs.start(await body(req)));return true;}
 if(req.method==='GET'&&u.pathname==='/deliveries'){send(res,200,{jobs:jobs.jobs.filter(j=>j.projectId===u.searchParams.get('projectId')).map(j=>({id:j.id,projectId:j.projectId,revision:j.revision,status:j.status,artifacts:j.artifacts,manifestHash:j.manifest.cacheKey}))});return true;}
 if(req.method==='GET'&&u.pathname==='/job'){send(res,200,jobs.read(u.searchParams.get('id')));return true;}
 if(req.method==='GET'&&u.pathname==='/artifact'){
  const a=jobs.artifact(u.searchParams.get('id'),u.searchParams.get('name'));const size=fs.statSync(a.path).size;
  let start=0,end=size-1,status=200;const range=req.headers.range;
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match){res.writeHead(416);res.end();return true;}start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;if(start>end||start>=size){res.writeHead(416);res.end();return true;}status=206;}
  res.writeHead(status,{'Content-Type':a.name.endsWith('.mp4')?'video/mp4':a.name.endsWith('.jpg')?'image/jpeg':a.name.endsWith('.srt')?'text/plain; charset=utf-8':'application/json','Content-Length':Math.max(0,end-start+1),'Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(!size)res.end();else fs.createReadStream(a.path,{start,end}).pipe(res);return true;
 }return false;
};return server;}
module.exports={attach};
