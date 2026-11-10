'use strict';
const fs=require('node:fs'),path=require('node:path'),{fail}=require('./util.cjs');
function importProject(root,c){
 const {ingest,normalize}=require('../adapters/media.cjs'),{createProject,syncNative}=require('../adapters/fablecut.cjs'),{frame}=require('./time.cjs');
 if(c.baseRevision!==0||c.target!==c.projectId||typeof c.params.path!=='string'||!c.params.path.trim()||Object.keys(c.params).some(k=>!['path','name'].includes(k)))fail('VALIDATION_ERROR');
 const asset=ingest(c.params.path,'A1'),dir=path.join(root,c.projectId,'media',c.commandId);fs.mkdirSync(dir,{recursive:true});
 try {const w=normalize(asset.path,path.join(dir,'working.mp4'),asset.fps);asset.workingMedia={...w,id:'W1',assetId:asset.id,conversion:{codec:'h264',sourceOriginUs:asset.originUs}};
 const p=createProject({projectId:c.projectId,name:c.params.name||path.basename(asset.path),media:[asset],fps:asset.fps,width:Math.ceil(asset.width/2)*2,height:Math.ceil(asset.height/2)*2});
 p.clips=[{id:'S1',mediaId:asset.id,kind:'video',track:'V1',speed:1,inFrame:0,outFrame:frame(asset.durationUs,asset.fps,'floor'),startFrame:0}];p.tracks[0].segmentIds=['S1'];return syncNative(p);
 }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
module.exports={importProject};
