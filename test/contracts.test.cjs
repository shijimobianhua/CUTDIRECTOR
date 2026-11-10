const {test}=require('node:test'); const assert=require('node:assert/strict');
const {createProject}=require('../src/adapters/fablecut.cjs'); const {validate}=require('../contracts/project.cjs');
test('M1-T1 positive head/native mapping and negative schema examples',()=>{
 const p=createProject(); assert.equal(validate(p).fps,24);
 for(const mutate of [p=>p.revision=-1,p=>p.projectId='../P',p=>p.outputSpec.fps={num:29.97,den:1},p=>p.tracks.push(p.tracks[0]),p=>p.captions.push({id:'c'})]) {
  const bad=structuredClone(p); mutate(bad); assert.throws(()=>validate(bad));
 }
});
