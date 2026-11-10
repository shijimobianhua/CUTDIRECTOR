'use strict';
const fs=require('node:fs'),path=require('node:path'),{fail}=require('./core/util.cjs');
function attach(server,store){server.webRoute=(req,res,u)=>{
 if(req.method!=='GET')return false;
 const files={'/icon.svg':['../host/icon.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/agent.js':['agent.js','text/javascript; charset=utf-8'],'/workbench.js':['workbench.js','text/javascript; charset=utf-8'],'/workbench.css':['workbench.css','text/css; charset=utf-8']};
 if(files[u.pathname]){const [file,type]=files[u.pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; object-src 'none'; frame-ancestors 'self'"});res.end(fs.readFileSync(path.join(__dirname,'web',file)));return true;}
 if(u.pathname!=='/media')return false;
 const p=store.read(u.searchParams.get('projectId')),asset=p.media.find(a=>a.id===u.searchParams.get('assetId'));if(!asset)fail('TARGET_NOT_FOUND');
 const file=asset.workingMedia?.path;if(!file||!fs.existsSync(file))fail('MEDIA_MISSING','H.264 工作媒体不存在，请重新导入');
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416);res.end();return true;}start=+m[1];end=m[2]?Math.min(+m[2],end):end;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return true;}status=206;}
 res.writeHead(status,{'Content-Type':'video/mp4','Content-Length':size?end-start+1:0,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(size)fs.createReadStream(file,{start,end}).pipe(res);else res.end();return true;
};}
module.exports={attach};
