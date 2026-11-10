const {test}=require('node:test'); const a=require('node:assert/strict');
const t=require('../src/core/time.cjs'); const m=require('../src/adapters/media.cjs'); const {projectCaptions}=require('../src/core/captions.cjs');
test('rational time, half-up, outward bounds and nonzero source origin',()=>{
 const fps={num:30000,den:1001}; a.equal(t.frame(1001000,fps),30); a.equal(t.frame(62500,{num:24,den:1}),2);
 a.deepEqual(t.cover(1,40000,fps),{inFrame:0,outFrame:2,policy:'outward'});
 a.equal(m.sourceToWorking(3001000,2000000,fps),30); a.equal(m.workingToSource(30,2000000,fps),3001000);
 a.throws(()=>t.frame(-1,fps)); a.throws(()=>t.cover(1,1,fps));
});
test('rotation, silent stream and Chinese path metadata; instance captions follow reorder and trim',()=>{
 const p={streams:[{codec_type:'video',avg_frame_rate:'30000/1001',r_frame_rate:'30/1',time_base:'1/90000',start_time:'2',duration:'3',tags:{rotate:'90'}}],format:{filename:'中文.mp4'}};
 a.equal(m.metadata(p).rotation,90); a.equal(m.metadata(p).hasAudio,false); a.equal(m.metadata(p).vfr,true);
 const c={id:'C',segmentId:'S',sourceInFrame:10,sourceOutFrame:30,text:'纠正'};
 const project={clips:[{id:'S',inFrame:20,outFrame:40,startFrame:100}],captions:[c]};
 a.deepEqual(projectCaptions(project).map(x=>[x.inFrame,x.outFrame,x.text]),[[100,110,'纠正']]);
 a.throws(()=>m.metadata({streams:[]}));
});
