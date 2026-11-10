'use strict';
const {createHash}=require('node:crypto');
const permissions=new Set(['project-read','media-read','network-read','media-upload','paid-generation','draft-write']);
const capabilities=new Set(['text-advice','reference-analysis','reference-search','image-generation','video-generation','roughcut','beatcut','visual-review','draft-handoff']);
const builtins=[
 {pluginId:'cutdirector-search',version:'1.0.0',title:'查找公开参考',capability:'reference-search',entryType:'dsh-service',permissions:['network-read'],cost:'model',resume:'manual',cancel:false},
 {pluginId:'cutdirector-director',version:'1.0.0',title:'剪辑导演',capability:'text-advice',entryType:'dsh-service',permissions:['project-read'],cost:'model',resume:'manual',cancel:true},
 {pluginId:'cutdirector-reference-ffmpeg',version:'1.0.0',title:'参考视频分析',capability:'reference-analysis',entryType:'controlled-cli',permissions:['media-read'],cost:'free',resume:'restart',cancel:true},
 {pluginId:'cutdirector-seedream',version:'1.0.0',title:'画分镜图',capability:'image-generation',entryType:'https-api',permissions:['project-read','media-upload','paid-generation'],cost:'paid',resume:'collect-only',cancel:false},
 {pluginId:'cutdirector-seedance',version:'1.0.0',title:'视频试拍',capability:'video-generation',entryType:'https-api',permissions:['project-read','media-upload','paid-generation'],cost:'paid',resume:'poll',cancel:false},
 {pluginId:'cutdirector-roughcut',version:'1.0.0',title:'字幕重点剪辑',capability:'roughcut',entryType:'local-policy',permissions:['project-read'],cost:'model',resume:'manual',cancel:true},
 {pluginId:'cutdirector-beatcut',version:'1.0.0',title:'按音乐节奏换画面',capability:'beatcut',entryType:'local-policy',permissions:['project-read'],cost:'free',resume:'restart',cancel:true},
 {pluginId:'cutdirector-visual-qa',version:'1.0.0',title:'模型看图检查',capability:'visual-review',entryType:'dsh-service',permissions:['project-read','media-upload'],cost:'model',resume:'manual',cancel:true},
 {pluginId:'cutdirector-jianying',version:'1.0.0',title:'交给剪映',capability:'draft-handoff',entryType:'controlled-cli',permissions:['media-read','draft-write'],cost:'free',resume:'reconcile',cancel:false},
].map(({capability,...entry})=>({schemaVersion:1,hostRange:'3',platform:['win32'],capabilities:[capability],inputSchema:{type:'object'},outputSchema:{type:'object'},
  readiness:'probe-required',source:'CUTDIRECTOR bundled',license:'project',...entry}));
function issue(code,status=422){return Object.assign(new Error(code),{code,status});}
function validateManifest(value){
 const keys=['schemaVersion','pluginId','version','hostRange','platform','capabilities','entryType','inputSchema','outputSchema','permissions','cost','readiness','resume','cancel','source','license','title'];
 if(!value||Object.keys(value).some(key=>!keys.includes(key))||value.schemaVersion!==1||
   !/^[a-z][a-z0-9-]{2,79}$/.test(value.pluginId)||!/^\d+\.\d+\.\d+$/.test(value.version)||value.hostRange!=='3'||
   !Array.isArray(value.platform)||!value.platform.length||value.platform.some(p=>!['win32','linux','darwin'].includes(p))||
   !Array.isArray(value.capabilities)||!value.capabilities.length||value.capabilities.some(c=>!capabilities.has(c))||
   !Array.isArray(value.permissions)||value.permissions.some(p=>!permissions.has(p))||
   !['controlled-cli','https-api','dsh-service','local-policy'].includes(value.entryType)||
   !['free','model','paid'].includes(value.cost)||typeof value.cancel!=='boolean'||
   !['restart','manual','poll','collect-only','reconcile'].includes(value.resume)||value.readiness!=='probe-required'||
   ![value.inputSchema,value.outputSchema].every(s=>s&&s.type==='object'&&Object.keys(s).every(k=>['type','required','properties','additionalProperties'].includes(k)))||
   ![value.source,value.license,value.title].every(text=>typeof text==='string'&&text.length>0&&text.length<=240))throw issue('PLUGIN_MANIFEST_INVALID');
 if(value.cost==='paid'&&!value.permissions.includes('paid-generation'))throw issue('PLUGIN_MANIFEST_INVALID');
 return JSON.parse(JSON.stringify(value));
}
function createRegistry(db){
 function list(){
  const external=db.prepare('SELECT manifest FROM extension_versions WHERE selected=1').all().map(row=>JSON.parse(row.manifest));
  return [...builtins,...external].map(manifest=>{
   const row=db.prepare('SELECT * FROM capability_states WHERE id=?').get(manifest.pluginId);
   return {manifest,external:!builtins.some(item=>item.pluginId===manifest.pluginId),enabled:row?!!row.enabled:true,version:row?.version||0,probe:row?.probe?JSON.parse(row.probe):null,
     manifestDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
  });
 }
 function requireEnabled(id){
   const entry=list().find(entry=>entry.manifest.pluginId===id);
   if(!entry?.enabled)throw issue('CAPABILITY_DISABLED',409);
   return entry;
 }
 function configure(input){
   if(!input||Object.keys(input).some(key=>!['pluginId','expectedVersion','enabled','confirm'].includes(key))||
     input.confirm!==true||typeof input.enabled!=='boolean')throw issue('PLUGIN_APPROVAL_REQUIRED',403);
   const entry=list().find(entry=>entry.manifest.pluginId===input.pluginId);
   if(!entry)throw issue('PLUGIN_NOT_REGISTERED',404);
   if(input.expectedVersion!==entry.version)throw issue('PLUGIN_CONFLICT',409);
   if(input.enabled&&!builtins.some(item=>item.pluginId===input.pluginId)&&entry.probe?.available!==true)throw issue('PLUGIN_PROBE_REQUIRED',409);
   const result=db.prepare('INSERT INTO capability_states(id,version,enabled,probe) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled WHERE capability_states.version=?')
    .run(input.pluginId,entry.version+1,input.enabled?1:0,entry.probe?JSON.stringify(entry.probe):null,input.expectedVersion);
   if(input.expectedVersion!==entry.version||!result.changes)throw issue('PLUGIN_CONFLICT',409);
   return list().find(entry=>entry.manifest.pluginId===input.pluginId);
 }
 function probe(id,result){
   const entry=list().find(entry=>entry.manifest.pluginId===id);
   if(!entry)throw issue('PLUGIN_NOT_REGISTERED',404);
   const sanitized={available:result.available===true,checkedAt:new Date().toISOString(),message:String(result.message||'').slice(0,400),level:result.level==='executed'?'executed':'detected'};
   db.prepare('INSERT INTO capability_states VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET probe=excluded.probe').run(id,entry.version,entry.enabled?1:0,JSON.stringify(sanitized));
   return sanitized;
 }
 return {list,configure,requireEnabled,probe};
}
module.exports={validateManifest,createRegistry,builtins};
