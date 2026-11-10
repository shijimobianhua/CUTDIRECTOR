const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {createProject}=require('../src/adapters/fablecut.cjs');
function fixture() {const p=createProject({media:[{id:'A',hash:'0'.repeat(64),path:'missing.mp4',durationUs:10000000,timeBase:'1/24',originUs:0}]});
 p.clips=[{id:'S',mediaId:'A',track:'V1',kind:'video',speed:1,inFrame:0,outFrame:120,startFrame:0},{id:'S2',mediaId:'A',track:'V1',kind:'video',speed:1,inFrame:120,outFrame:240,startFrame:120}]; p.tracks[0].segmentIds=['S','S2'];
 p.captions=[{id:'C',segmentId:'S',text:'原文',sourceInFrame:12,sourceOutFrame:60,wordIds:[],corrections:[]}]; return p;}
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'video-agent-'));
const command=(overrides={})=>({projectId:'P',baseRevision:0,commandId:'cmd',actor:'human',op:'caption.correct',target:'C',params:{text:'纠正'},...overrides});
module.exports={fixture,temp,command};
