'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
// Stream browser files to a generated local path; never accept a client filesystem path.
async function upload(req,store){
 const dir=path.join(store.root,'uploads');fs.mkdirSync(dir,{recursive:true});
 const id='Video_'+randomUUID().replaceAll('-',''),file=path.join(dir,id+'.source');let size=0;
 try{
  await pipeline(req,new Transform({transform(chunk,encoding,done){size+=chunk.length;done(size>2*1024**3?new Error('视频超过 2GB，请选择较小的视频'):null,chunk);}}),fs.createWriteStream(file,{flags:'wx'}));
  if(!size)throw new Error('请选择非空的视频文件');
  const name=String(new URL(req.url,'http://localhost').searchParams.get('name')||'我的视频').slice(0,160);
  store.apply({projectId:id,baseRevision:0,commandId:'upload_'+randomUUID(),actor:'human',op:'project.import',target:id,params:{path:path.resolve(file),name}});
  return {projectId:id};
 }catch(e){fs.rmSync(file,{force:true});throw e;}
}
module.exports={upload};
