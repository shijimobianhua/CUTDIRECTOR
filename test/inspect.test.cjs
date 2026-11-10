const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,temp}=require('./helpers.cjs'),media=require('../src/adapters/media.cjs'),{manifest,render}=require('../src/adapters/render.cjs');
test('source inspection creates bounded real keyframe/preview evidence; changed input rejects',async()=>{
 const dir=temp(),input=path.join(dir,'源.mp4');media.run(process.env.FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=24','-t','1','-c:v','libx264',input]);
 const p=fixture();p.media=[media.ingest(input,'A')];p.clips=[{...p.clips[0],outFrame:24}];p.tracks[0].segmentIds=['S'];
 const out=path.join(dir,'inspect'),files=await render(manifest(p,'inspect'),out);a.equal(files.length,3);
 const info=JSON.parse(fs.readFileSync(path.join(out,'segments.json')));a.equal(info.segments[0].assetHash,p.media[0].hash);a.match(info.segments[0].gaps[0].reason,/unknown/);a.equal(media.metadata(media.probe(path.join(out,'S.mp4'))).width,320);
 p.media[0].hash='0'.repeat(64);await a.rejects(()=>render(manifest(p,'inspect'),path.join(dir,'bad')),{code:'MEDIA_CHANGED'});
});
