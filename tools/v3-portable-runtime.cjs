'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{crc32}=require('node:zlib');
const yauzl=require('yauzl'),runtimes=require('./v3-runtimes.json');
async function extract(archive,destination,pin,transform){
 const bytes=fs.readFileSync(archive);
 if(createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw new Error('RUNTIME_CHECKSUM_MISMATCH: '+pin.archive);
 const zip=await yauzl.fromBufferPromise(bytes,{strictFileNames:true,validateEntrySizes:true});
 let expanded=0,count=0;
 try{
  for await(const entry of zip.eachEntry()){
   const raw=entry.fileName;
   if(!/^[a-zA-Z0-9_ .+@()\/-]+$/.test(raw)||raw.split('/').some(part=>part==='..'||part==='.')||
    raw.startsWith('/')||++count>2000||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw new Error('RUNTIME_UNSAFE_ARCHIVE');
   expanded+=entry.uncompressedSize;if(expanded>512*1024*1024||entry.uncompressedSize>256*1024*1024)throw new Error('RUNTIME_ARCHIVE_LIMIT');
   if(raw.endsWith('/'))continue;
   const relative=transform(raw);if(!relative)continue;
   const target=path.join(destination,relative);
   const stream=await zip.openReadStreamPromise(entry),parts=[];let size=0;
   for await(const part of stream){size+=part.length;if(size>entry.uncompressedSize)throw new Error('RUNTIME_ARCHIVE_LIMIT');parts.push(part);}
   const output=Buffer.concat(parts);
   if(crc32(output)!==entry.crc32)throw new Error('RUNTIME_ARCHIVE_INVALID');
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output,{flag:'wx'});
  }
 }finally{zip.close();}
}
async function bundleRuntime(out,archives){
 if(!archives?.ffmpeg||!archives?.python)throw new Error('Provide verified FFmpeg and Python archives');
 await extract(archives.ffmpeg,path.join(out,'runtime','ffmpeg'),runtimes.ffmpeg,raw=>{
  const match=/^[^/]+\/(.+)$/.exec(raw);if(!match)return null;
  const relative=match[1];
  if(/^bin\/(ffmpeg|ffprobe)\.exe$/.test(relative))return path.basename(relative);
  if(!relative.startsWith('bin/')&&!/\.(exe|dll)$/i.test(relative))return relative;
  return null;
 });
 await extract(archives.python,path.join(out,'runtime','python'),runtimes.python,raw=>raw);
 for(const file of ['runtime/ffmpeg/ffmpeg.exe','runtime/ffmpeg/ffprobe.exe','runtime/python/python.exe','runtime/python/LICENSE.txt']){
  if(!fs.existsSync(path.join(out,file)))throw new Error('RUNTIME_REQUIRED_FILE_MISSING: '+file);
 }
 const ffmpegLicense=fs.readdirSync(path.join(out,'runtime','ffmpeg')).find(name=>/^LICENSE/i.test(name));
 if(!ffmpegLicense)throw new Error('FFMPEG_LICENSE_MISSING');
 fs.writeFileSync(path.join(out,'runtime-source.json'),JSON.stringify(runtimes,null,2));
}
module.exports={bundleRuntime,runtimes};
