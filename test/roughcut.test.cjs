const {test}=require('node:test'),a=require('node:assert/strict');const {fixture,temp,command}=require('./helpers.cjs'),{ProjectStore}=require('../src/core/store.cjs'),{projectCaptions}=require('../src/core/captions.cjs');
function proposal(p){return {baseRevision:p.revision,items:[{segmentId:'S',assetHash:p.media[0].hash,inFrame:0,outFrame:120,reason:'retain explicit statement',evidence:[{transcriptId:'T',wordId:'W',text:'不是十元'}]}],gaps:['Second segment has no evidence; omitted']};}
function source(){const p=fixture();p.transcripts=[{id:'T',assetId:'A',model:'synthetic-test',precision:'sentence',words:[{id:'W',text:'不是十元',startUs:500000,endUs:1000000}]}];return p;}
test('roughcut applies source-traceable evidence through writer; forged evidence/stale base reject atomically',()=>{
 const s=new ProjectStore(temp());try{s.create(source());const v=proposal(s.read('P'));
 a.throws(()=>s.apply(command({op:'roughcut.apply',target:'P',params:{...v,items:[{...v.items[0],evidence:[{transcriptId:'T',wordId:'W',text:'十元'}]}]}})),{code:'EVIDENCE_INVALID'});a.equal(s.read('P').revision,0);
 s.apply(command({op:'roughcut.apply',target:'P',params:v}));a.deepEqual(s.read('P').tracks[0].segmentIds,['S']);a.equal(s.read('P').requirements.lastProposal.gaps.length,1);
 }finally{s.close();}
});
test('trim/reorder properties preserve caption instance correction and half-open source anchors',()=>{
 for(let n=0;n<30;n++){const s=new ProjectStore(temp());try{s.create(source());s.apply(command());
 s.apply(command({baseRevision:1,commandId:'reorder',op:'segment.reorder',target:'V1',params:{segmentIds:['S2','S']}}));
 s.apply(command({baseRevision:2,commandId:'trim',op:'segment.trim',target:'S',params:{inFrame:n%12,outFrame:120}}));
 const p=s.read('P'),c=projectCaptions(p)[0];a.equal(c.id,'C');a.equal(c.text,'纠正');a.equal(c.inFrame,120+12-n%12);
 a.throws(()=>s.apply(command({baseRevision:3,commandId:'bad',op:'segment.trim',target:'S',params:{inFrame:13,outFrame:120}})),{code:'PROTECTED_CONTENT'});
 const v=proposal(p);v.baseRevision=3;v.items[0].inFrame=13;a.throws(()=>s.apply(command({baseRevision:3,commandId:'drop',op:'roughcut.apply',target:'P',params:v})),{code:'EVIDENCE_INVALID'});
 }finally{s.close();}}
});
