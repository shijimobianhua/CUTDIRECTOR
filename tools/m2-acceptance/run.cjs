'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');for(const [key,exe] of [['FFMPEG','ffmpeg.exe'],['FFPROBE','ffprobe.exe']]){const file=path.resolve(root,'../tools/ffmpeg-4.4.1',exe);if(!process.env[key]&&fs.existsSync(file))process.env[key]=file;}
const files=['contracts','time','commands','recovery','bridge','render','acceptance','asr/provider','inspect','roughcut','m2-render','m2-http'].map(n=>'test/'+n+'.test.cjs');
const r=spawnSync(process.execPath,['--test','--test-timeout=60000',...files],{cwd:root,encoding:'utf8',env:process.env,timeout:240000,windowsHide:true});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
const report={status:r.status===0?'passed':'failed',scope:'Automated engineering checks; not real ASR or editorial acceptance',files,acceptance:{'AC-06':['roughcut.test.cjs','inspect.test.cjs'],'AC-07':['render.test.cjs','m2-render.test.cjs'],'AC-08':['m2-render.test.cjs'],'AC-09':['time.test.cjs','m2-render.test.cjs']},unverified:['Real Agent editorial selection','Real ASR quality','Human video/audio review']};
fs.mkdirSync(path.join(root,'.m2-data'),{recursive:true});fs.writeFileSync(path.join(root,'.m2-data/regression.json'),JSON.stringify(report,null,2));if(r.error)console.error(r.error.message);process.exitCode=r.status??1;
