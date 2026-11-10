'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
for(const [key,exe] of [['FFMPEG','ffmpeg.exe'],['FFPROBE','ffprobe.exe']]) {const known=path.resolve(root,'../tools/ffmpeg-4.4.1',exe);if(!process.env[key]&&fs.existsSync(known))process.env[key]=known;}
const tests=['contracts','time','commands','recovery','bridge','render','acceptance'].map(n=>`test/${n}.test.cjs`);
const result=spawnSync(process.execPath,['--test','--test-timeout=60000',...tests],{cwd:root,env:process.env,encoding:'utf8',timeout:180000,windowsHide:true});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)console.error(result.error.message);process.exitCode=result.status??1;
