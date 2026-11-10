'use strict';
const {validateManifest,validateValue,digest}=require('./tool-standard.cjs');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function defineTool(manifest,implementation){
 const fixed=freeze(validateManifest(manifest)),manifestDigest=digest(fixed);
 for(const key of ['probe','submit'])if(typeof implementation[key]!=='function')throw Error('Tool must implement '+key);
 for(const key of ['poll','cancel'])if(fixed.lifecycle[key]&&typeof implementation[key]!=='function')throw Error('Declared lifecycle requires '+key);
 const clone=v=>structuredClone(v);
 return Object.freeze({
 manifest:fixed,manifestDigest,
 async probe(context={}){const result=await implementation.probe(freeze(clone(context)));if(typeof result?.available!=='boolean')throw Error('Invalid probe response');return result;},
 async prepare(input,context={}){validateValue(input,fixed.inputSchema);const normalized=implementation.prepare?await implementation.prepare(freeze(clone(input)),freeze(clone(context))):input;validateValue(normalized,fixed.inputSchema);const estimate=implementation.estimate?await implementation.estimate(freeze(clone(normalized))):{kind:fixed.cost,amount:null};return {input:clone(normalized),inputDigest:digest(normalized),manifestDigest,permissions:[...fixed.permissions],estimate};},
 async submit(prepared,approval,context={}){
  if(approval?.confirm!==true||approval.manifestDigest!==manifestDigest||approval.inputDigest!==prepared.inputDigest||digest(prepared.input)!==prepared.inputDigest||!Number.isSafeInteger(approval.expiresAt)||approval.expiresAt<=Date.now()||fixed.cost!=='free'&&approval.allowCharge!==true||fixed.permissions.some(p=>!approval.permissions?.includes(p)))throw Error('TOOL_APPROVAL_REQUIRED');
  const result=await implementation.submit(freeze(clone(prepared.input)),context);return validateResult(result);
 },
 async poll(externalId,context={}){if(!fixed.lifecycle.poll)throw Error('TOOL_POLL_UNSUPPORTED');return validateResult(await implementation.poll(externalId,context));},
 async cancel(externalId,context={}){if(!fixed.lifecycle.cancel)throw Error('TOOL_CANCEL_UNSUPPORTED');return implementation.cancel(externalId,context);},
 async collect(result,context={}){const collected=implementation.collect?await implementation.collect(result,context):result;return validateResult(collected);}
 });
 function validateResult(result){if(!result||!['queued','running','complete','failed'].includes(result.state))throw Error('TOOL_OUTPUT_INVALID');if(result.state==='queued'&&(typeof result.externalId!=='string'||!result.externalId))throw Error('TOOL_OUTPUT_INVALID');if(result.state==='complete')validateValue(result.data||{},fixed.outputSchema);return clone(result);}
}
module.exports={defineTool};
