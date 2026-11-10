'use strict';
const {createHash}=require('node:crypto');
const {validateManifest}=require('./registry.cjs');
function invalid(code='ADAPTER_CONTRACT_INVALID'){throw Object.assign(new Error(code),{code,status:422});}
function validate(value,schema,depth=0){
 if(depth>6||!schema||!['object','array','string','number','integer','boolean'].includes(schema.type))invalid();
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))invalid();
  if(schema.required?.some(key=>!Object.hasOwn(value,key)))invalid();
  for(const [key,item]of Object.entries(value)){
   if(!Object.hasOwn(schema.properties||{},key)){if(schema.additionalProperties!==true)invalid();continue;}
   validate(item,schema.properties[key],depth+1);
  }
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length>(schema.maxItems||500))invalid();
  value.forEach(item=>validate(item,schema.items,depth+1));
 }else if(schema.type==='integer'){if(!Number.isSafeInteger(value))invalid();}
 else if(typeof value!==schema.type||schema.type==='number'&&!Number.isFinite(value))invalid();
 if(typeof value==='string'&&value.length>(schema.maxLength||64000))invalid();
 if(typeof value==='number'&&(value<(schema.minimum??-Number.MAX_SAFE_INTEGER)||value>(schema.maximum??Number.MAX_SAFE_INTEGER)))invalid();
 if(schema.enum&&!schema.enum.includes(value))invalid();
 return value;
}
function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function defineAdapter(manifest,implementation){
 const fixed=validateManifest(manifest),versionDigest=digest(fixed);
 if(['probe','prepare','execute','validate'].some(name=>typeof implementation[name]!=='function'))invalid();
 const clone=value=>JSON.parse(JSON.stringify(value));
 return Object.freeze({
  manifest:clone(fixed),versionDigest,
  async probe(context){
   const result=await implementation.probe(Object.freeze(clone(context)));
   if(typeof result?.available!=='boolean')invalid();
   return {available:result.available,message:String(result.message||'').slice(0,400)};
  },
  async prepare(snapshot){
   validate(snapshot,fixed.inputSchema);
   const input=await implementation.prepare(Object.freeze(clone(snapshot)));
   validate(input,fixed.inputSchema);
   return {input:clone(input),inputDigest:digest(input),versionDigest,permissions:[...fixed.permissions]};
  },
  async execute(prepared,approval){
   if(!approval||approval.confirm!==true||approval.inputDigest!==prepared.inputDigest||approval.versionDigest!==versionDigest||
     digest(prepared.input)!==prepared.inputDigest||!Number.isSafeInteger(approval.expiresAt)||approval.expiresAt<=Date.now()||
     !Array.isArray(approval.permissions)||fixed.permissions.some(permission=>!approval.permissions.includes(permission)))invalid('ADAPTER_APPROVAL_REQUIRED');
   const result=await implementation.execute(Object.freeze(clone(prepared.input)));
   validate(result,fixed.outputSchema);
   if(await implementation.validate(clone(result))!==true)invalid('ADAPTER_OUTPUT_INVALID');
   return clone(result);
  }
 });
}
module.exports={defineAdapter,validate,digest};
