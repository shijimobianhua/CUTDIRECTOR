'use strict';
const {body,send}=require('./server.cjs'),asr=require('./adapters/asr/index.cjs'),{fail}=require('./core/util.cjs');
function attach(server,store){server.intakeRoute=async(req,res,u)=>{
 if(req.method==='GET'&&u.pathname==='/asr/status'){send(res,200,asr.configuredProvider().readiness());return true;}
 if(req.method!=='POST'||u.pathname!=='/asr')return false;
 const b=await body(req),p=store.read(b.projectId);const previous=store.history(p.projectId).find(h=>h.command?.commandId===b.commandId)?.command;
 if(previous){if(previous.op!=='transcript.import'||previous.baseRevision!==b.baseRevision||previous.target!==b.assetId)fail('COMMAND_ID_CONFLICT');send(res,200,{...previous.params.result,applied:store.apply(previous)});return true;}
 if(p.revision!==b.baseRevision)fail('REVISION_CONFLICT');const asset=p.media.find(a=>a.id===b.assetId);if(!asset)fail('TARGET_NOT_FOUND');
 const provider=asr.configuredProvider();
 const result=await asr.transcribe(asset,{provider});
 const applied=store.apply({projectId:p.projectId,baseRevision:p.revision,commandId:b.commandId,actor:'agent',op:'transcript.import',target:asset.id,params:{result,assetHash:asset.hash}});
 send(res,200,{...result,applied});return true;
};}
async function command(store,b){
 require('./core/store.cjs').keys(b,['projectId','baseRevision','commandId','actor','op','target','params']);
 if(!require('../contracts/project.cjs').id(b.commandId)||!['human','agent'].includes(b.actor)||!b.params||Object.keys(b.params).length)fail('VALIDATION_ERROR');
 const requestHash=require('./core/util.cjs').hash(b);
 const p=store.read(b.projectId),previous=store.history(p.projectId).find(h=>h.command?.commandId===b.commandId)?.command;
 if(previous){if(previous.op!=='transcript.import'||previous.params.result.requestHash!==requestHash)fail('COMMAND_ID_CONFLICT');return store.apply(previous);}
 if(b.baseRevision!==p.revision)fail('REVISION_CONFLICT','Stale base revision',{currentRevision:p.revision});
 if(!b.params||Object.keys(b.params).length)fail('VALIDATION_ERROR');const asset=p.media.find(a=>a.id===b.target);if(!asset)fail('TARGET_NOT_FOUND');
 const result=await asr.transcribe(asset,{provider:asr.configuredProvider()});
 result.requestHash=requestHash;
 return store.apply({...b,op:'transcript.import',params:{result,assetHash:asset.hash}});
}
module.exports={attach,command};
