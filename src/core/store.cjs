'use strict';
const fs=require('node:fs'); const path=require('node:path');
const {validate,id,integer}=require('../../contracts/project.cjs'); const {syncNative}=require('../adapters/fablecut.cjs');
const {atomic,lock,hash,fail}=require('./util.cjs');
function keys(obj,allowed) {if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k))) fail('VALIDATION_ERROR','Unknown fields or invalid object');}
function pack(p,track) {let n=0; for(const sid of track.segmentIds) {const s=p.clips.find(x=>x.id===sid); s.startFrame=n; n+=s.outFrame-s.inFrame;}}
function operate(p,c) {
 const v=c.params; const target=(list)=>{const x=p[list].find(x=>x.id===c.target); if(!x) fail('TARGET_NOT_FOUND'); return x;};
 switch(c.op) {
 case 'transcript.srt': {keys(v,['srt','language']);return require('./srt.cjs').importSrt(p,target('media'),v);}
 case 'captions.generate': {keys(v,['transcriptId','segmentIds']);if(c.target!==p.projectId)fail('TARGET_NOT_FOUND');return require('./captions.cjs').generate(p,v);}
 case 'transcript.import': {keys(v,['result','assetHash']);const asset=target('media');if(v.assetHash!==asset.hash)fail('MEDIA_CHANGED');const r=v.result;if(!r?.provenance||!(r.status==='fixture-replay'&&r.realTranscription===false&&r.fixtureHash||r.status==='external-provider'&&r.realTranscription===true&&r.provenance.kind==='external-command'))fail('ASR_INVALID');const t=require('../adapters/asr/index.cjs').validateTranscript(r.transcript,asset);if(p.transcripts.some(x=>x.id===t.id))fail('VALIDATION_ERROR','Transcript ID already exists');p.transcripts.push({...t,provenance:r.provenance,...(r.fixtureHash?{fixtureHash:r.fixtureHash}:{}),realTranscription:r.realTranscription,status:r.status,assetHash:asset.hash});return [t.id];}
 case 'roughcut.apply': {if(c.target!==p.projectId)fail('TARGET_NOT_FOUND');return require('./roughcut.cjs').applyProposal(p,v);}
 case 'caption.correct': {keys(v,['text']); if(typeof v.text!=='string') fail('VALIDATION_ERROR'); const x=target('captions'); x.corrections.push({previous:x.text,text:v.text,actor:c.actor}); x.text=v.text; return [x.id];}
 case 'segment.trim': {keys(v,['inFrame','outFrame']); const s=target('clips'); if(!integer(v.inFrame)||!integer(v.outFrame)||v.outFrame<=v.inFrame||v.inFrame<s.inFrame||v.outFrame>s.outFrame) fail('RANGE_INVALID'); require('./roughcut.cjs').protectTrim(p,s,v); Object.assign(s,v); pack(p,p.tracks.find(x=>x.id===s.track)); return [s.id];}
 case 'segment.reorder': {keys(v,['segmentIds']); const t=target('tracks'); if(!Array.isArray(v.segmentIds)||v.segmentIds.length!==t.segmentIds.length||new Set(v.segmentIds).size!==t.segmentIds.length||v.segmentIds.some(x=>!t.segmentIds.includes(x))) fail('VALIDATION_ERROR'); t.segmentIds=[...v.segmentIds]; pack(p,t); return t.segmentIds;}
 case 'asset.relocate': {keys(v,['path']); if(typeof v.path!=='string') fail('VALIDATION_ERROR'); const x=target('media'); if(!fs.existsSync(v.path)) fail('MEDIA_MISSING'); if(hash(fs.readFileSync(v.path))!==x.hash) fail('MEDIA_CHANGED'); x.path=path.resolve(v.path); return [x.id];}
 case 'project.archive': keys(v,[]); p.archived=true; return [p.projectId];
 case 'feedback.add': {keys(v,['id','request','actualDiff','decision','preferenceConfirmed','revision']); if(!id(v.id)||typeof v.request!=='string'||!Array.isArray(v.actualDiff)||!['accepted','rejected','revised','pending'].includes(v.decision)||typeof v.preferenceConfirmed!=='boolean'||v.revision!==undefined&&(!integer(v.revision)||v.revision>p.revision)||p.feedback.some(x=>x.id===v.id)) fail('VALIDATION_ERROR'); p.feedback.push({...v,projectId:p.projectId,revision:v.revision??p.revision}); return [v.id];}
 case 'batch': {keys(v,['commands']); if(!Array.isArray(v.commands)||!v.commands.length||v.commands.length>100) fail('VALIDATION_ERROR'); return v.commands.flatMap(x=>{keys(x,['op','target','params']); if(['batch','revision.restore'].includes(x.op)) fail('VALIDATION_ERROR'); return operate(p,{...x,actor:c.actor});});}
 default: fail('VALIDATION_ERROR','Unsupported operation');
 }
}
class ProjectStore {
 constructor(root,options={}) {this.root=path.resolve(root); this.release=lock(this.root,{recoverStale:options.recoverStale}); this.closed=false; this.beforeRename=options.beforeRename;}
 close() {if(!this.closed){this.closed=true; this.release();}}
 file(projectId) {if(this.closed) fail('WRITER_CLOSED'); if(!id(projectId)) fail('VALIDATION_ERROR'); return path.join(this.root,projectId,'project.json');}
 envelope(projectId) {const f=this.file(projectId); if(!fs.existsSync(f)) fail('NOT_FOUND'); const e=JSON.parse(fs.readFileSync(f,'utf8')); validate(e.project); return e;}
 create(project) {validate(project); const f=this.file(project.projectId); if(fs.existsSync(f)) fail('COMMAND_ID_CONFLICT'); const p=structuredClone(project); if(p.revision!==0) fail('VALIDATION_ERROR'); atomic(f,{project:p,history:[{revision:0,parent:null,snapshot:p}],ledger:{}},this.beforeRename); return this.read(p.projectId);}
 list(){return fs.readdirSync(this.root,{withFileTypes:true}).filter(x=>x.isDirectory()&&id(x.name)&&fs.existsSync(path.join(this.root,x.name,'project.json'))).map(x=>{const p=this.read(x.name);return {projectId:p.projectId,name:p.name,revision:p.revision,archived:!!p.archived};});}
 read(projectId) {return structuredClone(this.envelope(projectId).project);}
 history(projectId) {return structuredClone(this.envelope(projectId).history);}
 apply(command) {
  keys(command,['projectId','baseRevision','commandId','op','target','params','actor']);
  if(!id(command.commandId)||!integer(command.baseRevision)||!['human','agent'].includes(command.actor)||typeof command.op!=='string'||typeof command.target!=='string') fail('VALIDATION_ERROR');
  // Reject non-JSON values instead of letting digest and persisted request disagree.
  const jsonValue=v=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.every(jsonValue)||v&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(v).every(jsonValue);
  if(!jsonValue(command)) fail('VALIDATION_ERROR','Commands must contain JSON values');
  const c=structuredClone(command), digest=hash(c);
  if(c.op==='project.import'&&!fs.existsSync(this.file(c.projectId))){
   const p=require('./import-media.cjs').importProject(this.root,c),result={ok:true,projectId:p.projectId,revision:0,commandId:c.commandId,affectedIds:p.clips.map(s=>s.id),diff:[]};
   atomic(this.file(p.projectId),{project:p,history:[{revision:0,parent:null,snapshot:p,command:c}],ledger:{[c.commandId]:{digest,result}}},this.beforeRename);return structuredClone(result);
  }
  const e=this.envelope(c.projectId), stored=Object.hasOwn(e.ledger,c.commandId)?e.ledger[c.commandId]:null;
  if(stored) {if(stored.digest!==digest) fail('COMMAND_ID_CONFLICT'); return structuredClone(stored.result);}
  if(c.baseRevision!==e.project.revision) fail('REVISION_CONFLICT','Stale base revision',{currentRevision:e.project.revision});
  const before=structuredClone(e.project); let p=structuredClone(before), affectedIds;
  if(['revision.restore','project.archive','feedback.add','batch'].includes(c.op)&&c.target!==p.projectId) fail('TARGET_NOT_FOUND');
  if(c.op==='revision.restore') {
   keys(c.params,['revision']); if(!integer(c.params.revision)) fail('VALIDATION_ERROR');
   const h=e.history.find(x=>x.revision===c.params.revision); if(!h) fail('NOT_FOUND');
   p=structuredClone(h.snapshot); affectedIds=[p.projectId];
  } else affectedIds=operate(p,c);
  p.revision=before.revision+1; syncNative(p); validate(p);
  const diff=Object.keys(p).filter(k=>hash(p[k])!==hash(before[k])).map(key=>({key,before:before[key],after:p[key]}));
  const result={ok:true,projectId:p.projectId,revision:p.revision,commandId:c.commandId,affectedIds,diff};
  e.project=p; e.history.push({revision:p.revision,parent:before.revision,command:c,actor:c.actor,diff,snapshot:p});
  Object.defineProperty(e.ledger,c.commandId,{value:{digest,result},enumerable:true,configurable:true,writable:true});
  atomic(this.file(p.projectId),e,this.beforeRename); return structuredClone(result);
 }
}
module.exports={ProjectStore,operate,keys};
