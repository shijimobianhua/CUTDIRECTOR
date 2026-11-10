'use strict';
const fs=require('node:fs');const {fail,hash}=require('../../core/util.cjs');const {id,integer}=require('../../../contracts/project.cjs');
// Word/sentence/segment entries are retained at the provider's declared precision.
// Times are integer microseconds relative to the asset origin, never guessed word alignment.
function validateTranscript(t,asset) {
 const bad=m=>fail('ASR_INVALID',m);
 if(!t||!id(t.id)||t.assetId!==asset.id||typeof t.model!=='string'||!t.model.trim()||typeof t.language!=='string'||!['word','sentence','segment'].includes(t.precision)||t.timeUnit!=='microseconds'||t.timeReference!=='asset-origin')bad('Invalid transcript identity, precision or clock');
 if(!Array.isArray(t.words)||!Array.isArray(t.missing)||!Array.isArray(t.uncertain))bad('Explicit words/missing/uncertain arrays required');
 const ids=new Set();let previous=0;
 for(const w of t.words) {
  if(!id(w.id)||ids.has(w.id)||typeof w.text!=='string'||!w.text.trim()||!integer(w.startUs)||!integer(w.endUs)||w.endUs<=w.startUs||w.startUs<previous||w.endUs>asset.durationUs||w.confidence!==null&&(!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>1))bad('Invalid or overlapping timed entry');
  ids.add(w.id);previous=w.endUs;
 }
 for(const gap of t.missing)if(!integer(gap.startUs)||!integer(gap.endUs)||gap.endUs<=gap.startUs||gap.endUs>asset.durationUs||typeof gap.reason!=='string'||!gap.reason.trim())bad('Invalid missing range');
 for(const u of t.uncertain)if(!ids.has(u.wordId)||typeof u.reason!=='string'||!u.reason.trim())bad('Invalid uncertainty reference');
 if(!t.words.length&&!t.missing.length)bad('Empty output must explain missing coverage');
 return structuredClone(t);
}
class UnavailableProvider {
 readiness(){return {status:'provider-not-ready',code:'PROVIDER_NOT_READY',realProvider:false,reason:'No local ASR model/provider configured. No media is sent over the network.'};}
 async transcribe(){fail('PROVIDER_NOT_READY',this.readiness().reason);}
}
class FixtureProvider {
 constructor(file){this.file=file;}
 readiness(){return {status:fs.existsSync(this.file)?'fixture-ready':'provider-not-ready',realProvider:false,fixturePath:this.file};}
 async transcribe(asset){
  if(!fs.existsSync(this.file))fail('PROVIDER_NOT_READY','Explicit ASR fixture path does not exist');
  const f=JSON.parse(fs.readFileSync(this.file,'utf8'));
  if(f.fixtureVersion!==1||!['recorded-provider-output','synthetic-test'].includes(f.provenance?.kind)||typeof f.provenance.source!=='string'||!f.provenance.source.trim())fail('ASR_INVALID','Fixture requires explicit provenance');
  if(f.assetHash!==asset.hash)fail('MEDIA_CHANGED','Fixture does not belong to this asset');
  return {status:'fixture-replay',realTranscription:false,provenance:f.provenance,fixtureHash:hash(fs.readFileSync(this.file)),transcript:validateTranscript(f.transcript,asset)};
 }
}
async function transcribe(asset,{provider=new UnavailableProvider()}={}) {
 if(!asset||!id(asset.id)||!integer(asset.durationUs))fail('ASR_INVALID','Asset required');
 if(asset.hasAudio===false)fail('ASR_NO_AUDIO','Asset has no audio stream');
 if(!fs.existsSync(asset.path))fail('MEDIA_MISSING');
 if(hash(fs.readFileSync(asset.path))!==asset.hash)fail('MEDIA_CHANGED');
 return provider.transcribe(asset);
}
function configuredProvider(){return process.env.VIDEO_ASR_CMD?new (require('./command.cjs').CommandProvider)(process.env.VIDEO_ASR_CMD):process.env.VIDEO_ASR_FIXTURE?new FixtureProvider(process.env.VIDEO_ASR_FIXTURE):new UnavailableProvider();}
module.exports={UnavailableProvider,FixtureProvider,validateTranscript,transcribe,configuredProvider};
