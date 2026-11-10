'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {fail}=require('../../src/core/util.cjs');

function windowsRuntime(out,root){
  if(process.platform!=='win32')fail('WINDOWS_BUILD_REQUIRED');
  const node=process.env.CUTDIRECTOR_PACKAGE_NODE||process.execPath;
  const ffmpeg=process.env.CUTDIRECTOR_PACKAGE_FFMPEG||path.resolve(root,'../tools/ffmpeg-4.4.1');
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const expected=[node,compiler,...['ffmpeg.exe','ffprobe.exe'].map(name=>path.join(ffmpeg,name))];
  if(expected.some(file=>!fs.existsSync(file)))fail('WINDOWS_RUNTIME_MISSING');
  const runtime=path.join(out,'runtime');
  const media=path.join(runtime,'ffmpeg');
  fs.mkdirSync(media,{recursive:true});
  fs.copyFileSync(node,path.join(runtime,'node.exe'));
  for(const name of fs.readdirSync(ffmpeg)){
    if(/^(ffmpeg|ffprobe)\.exe$|\.dll$|^SOURCE\.md$|^COPYING|^LICENSE/i.test(name))
      fs.copyFileSync(path.join(ffmpeg,name),path.join(media,name));
  }
  for(const name of ['LICENSE','LICENSE.txt']){
    const license=path.join(path.dirname(node),name);
    if(fs.existsSync(license))fs.copyFileSync(license,path.join(runtime,name));
  }
  execFileSync(compiler,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll',
    '/out:'+path.join(out,'打开 CUTDIRECTOR.exe'),path.join(__dirname,'Launcher.cs')],{windowsHide:true});
}
module.exports={windowsRuntime};
