'use strict';
const path=require('node:path'),fs=require('node:fs');const {ProjectStore}=require('../src/core/store.cjs');const {createProject}=require('../src/adapters/fablecut.cjs');const {ingest,normalize}=require('../src/adapters/media.cjs');const {frame}=require('../src/core/time.cjs');
const [input,projectId='P']=process.argv.slice(2);if(!input)throw new Error('Usage: node tools/import-media.cjs <local-video> [projectId] [--normalize]');
const root=process.env.VIDEO_DATA||'.m1-data',store=new ProjectStore(root);
try {
 if(fs.existsSync(store.file(projectId)))require('../src/core/util.cjs').fail('COMMAND_ID_CONFLICT','Project already exists; import cannot overwrite its working media');
 const asset=ingest(input,'A1'),fps=asset.fps;
 if(process.argv.includes('--normalize')||asset.vfr||asset.rotation||asset.originUs) {
  const workDir=path.join(root,projectId,'media');if(!require('../contracts/project.cjs').id(projectId))throw new Error('Invalid projectId');fs.mkdirSync(workDir,{recursive:true});
  const working=normalize(input,path.resolve(workDir,'working.mp4'),fps);asset.workingMedia={...working,id:'W1',assetId:asset.id,conversion:{codec:'h264',fps,rotationApplied:asset.rotation,sourceOriginUs:asset.originUs}};
 }
 const p=createProject({projectId,name:path.basename(input),media:[asset],fps,width:asset.width%2?asset.width+1:asset.width,height:asset.height%2?asset.height+1:asset.height});
 p.clips=[{id:'S1',mediaId:asset.id,kind:'video',track:'V1',speed:1,inFrame:0,outFrame:frame(asset.durationUs,fps,'floor'),startFrame:0}];p.tracks[0].segmentIds=['S1'];
 store.create(require('../src/adapters/fablecut.cjs').syncNative(p));console.log(`Imported ${projectId} r0; no transcript generated. Start node src/server.cjs.`);
}finally{store.close();}
