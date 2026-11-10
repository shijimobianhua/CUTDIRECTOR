'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const YAML=require('yaml');
const {acquireLease}=require('../src/v3/service/lease.cjs'),{lock}=require('../src/core/util.cjs');
const {verify}=require('./package-v3.cjs'),{createBackup,verifyBackup}=require('./v3-data-backup.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
function atomic(file,text){const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,text,{flag:'wx'});fs.renameSync(temp,file);}
function inside(root,target){const relative=path.relative(root,target);return !!relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function planInstall(pluginDirectory,profileDirectory,options={}){
 const plugin=fs.realpathSync(pluginDirectory),profile=fs.realpathSync(profileDirectory);
 verify(plugin);
 const file=path.join(profile,'package.json'),raw=fs.readFileSync(file,'utf8'),pkg=JSON.parse(raw);
 const target=path.join(profile,'node_modules','@local','video-agent');
 if(!inside(profile,target))throw new Error('INSTALL_PROFILE_PATH_INVALID');
 let previousTarget=null;
 if(fs.existsSync(target)){
  if(!fs.lstatSync(target).isSymbolicLink())throw new Error('INSTALL_EXISTING_DIRECTORY_IS_NOT_A_LINK');
  previousTarget=fs.realpathSync(target);
 }
 if(path.basename(profile)==='desktop'){
  const gatesFile=path.join(plugin,'release-checks.json');
  const gates=fs.existsSync(gatesFile)?JSON.parse(fs.readFileSync(gatesFile,'utf8')):{};
  const personalPreview=options.personalPreview===true&&gates.schemaVersion===2&&gates.tier==='personal-preview'&&gates.deferredByUser===true&&Array.isArray(gates.deferred);
  if(!personalPreview&&['localRegression','nativeShort','nativeLong','realImage','realVideo','noviceUsability'].some(key=>gates[key]!==true))throw new Error('RELEASE_GATES_PENDING');
 }
 const next={...pkg,dependencies:{...pkg.dependencies,'@local/video-agent':'link:'+plugin.split(path.sep).join('/')}};
 const nextRaw=JSON.stringify(next,null,2)+'\n';
 const configured=[];
 for(const directory of [plugin,previousTarget].filter(Boolean)){
  const patch=path.join(directory,'cordis.patch.yml');if(!fs.existsSync(patch))continue;
  const rows=YAML.parse(fs.readFileSync(patch,'utf8'));
  for(const row of Array.isArray(rows)?rows:[])for(const entry of row.insert||[])for(const key of ['dataRoot','legacyRoot']){
    const value=entry.config?.[key],root=value==='@profile'?path.join(profile,'data','cutdirector-v3'):value;if(typeof root==='string'&&path.isAbsolute(root)&&fs.existsSync(root))configured.push(root);
  }
 }
 const roots=[...new Set([...(options.dataRoots||[]),...configured].map(root=>fs.realpathSync(root)))];
 if(new Set(roots).size!==roots.length)throw new Error('INSTALL_DUPLICATE_DATA_ROOT');
 return {schemaVersion:1,personalPreview:options.personalPreview===true,plugin,profile,file,target,previousTarget,beforeDigest:digest(raw),afterDigest:digest(nextRaw),
  nextRaw,previousRaw:raw,dataRoots:roots};
}
function applyInstall(plan,backupDirectory){
 if(plan?.schemaVersion!==1)throw new Error('INSTALL_PLAN_INVALID');
 const profile=fs.realpathSync(plan.profile),target=path.join(profile,'node_modules','@local','video-agent'),file=path.join(profile,'package.json');
 if(target!==plan.target||file!==plan.file||!inside(profile,target))throw new Error('INSTALL_PLAN_INVALID');
 planInstall(plan.plugin,plan.profile,{personalPreview:plan.personalPreview===true});
 if(digest(fs.readFileSync(file,'utf8'))!==plan.beforeDigest)throw new Error('INSTALL_PROFILE_CHANGED');
 if(plan.previousTarget){
  if(!fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==plan.previousTarget)throw new Error('INSTALL_LINK_CHANGED');
 }else if(fs.existsSync(target))throw new Error('INSTALL_LINK_CHANGED');
 const backup=path.resolve(backupDirectory);
 if(inside(profile,backup)||inside(plan.plugin,backup)||backup===profile||backup===plan.plugin)throw new Error('INSTALL_BACKUP_ROOT_INVALID');
 if(fs.existsSync(backup)&&fs.readdirSync(backup).length)throw new Error('INSTALL_BACKUP_NOT_EMPTY');
 fs.mkdirSync(backup,{recursive:true});
 const lockFile=path.join(profile,'.cutdirector-install.lock'),fd=fs.openSync(lockFile,'wx');
 let changedLink=false,changedPackage=false;
 const held=[];
 try{
  for(const [index,root]of plan.dataRoots.entries())held.push(createBackup(root,path.join(backup,'data-'+index),{retainLease:true}).release);
  fs.writeFileSync(path.join(backup,'package.json'),plan.previousRaw,{flag:'wx'});
  const receipt={schemaVersion:1,plugin:plan.plugin,profile,target,previousTarget:plan.previousTarget,beforeDigest:plan.beforeDigest,afterDigest:plan.afterDigest,
   personalPreview:plan.personalPreview===true,dataRoots:plan.dataRoots,createdAt:new Date().toISOString(),state:'prepared'};
  const receiptFile=path.join(backup,'install-receipt.json');atomic(receiptFile,JSON.stringify(receipt,null,2));
  if(digest(fs.readFileSync(file,'utf8'))!==plan.beforeDigest)throw new Error('INSTALL_PROFILE_CHANGED');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(plan.previousTarget)fs.unlinkSync(target);
  try{fs.symlinkSync(plan.plugin,target,'junction');changedLink=true;}
  catch(error){if(plan.previousTarget)fs.symlinkSync(plan.previousTarget,target,'junction');throw error;}
  atomic(file,plan.nextRaw);changedPackage=true;
  receipt.state='installed';atomic(receiptFile,JSON.stringify(receipt,null,2));
  return {receipt:receiptFile,profile,plugin:plan.plugin,backupFiles:plan.dataRoots.length};
 }catch(error){
  if(changedLink&&fs.lstatSync(target).isSymbolicLink()&&fs.realpathSync(target)===plan.plugin){
   fs.unlinkSync(target);if(plan.previousTarget)fs.symlinkSync(plan.previousTarget,target,'junction');
  }
  if(changedPackage&&digest(fs.readFileSync(file,'utf8'))===plan.afterDigest)atomic(file,plan.previousRaw);
  throw error;
 }finally{for(const release of held.reverse())release();fs.closeSync(fd);fs.unlinkSync(lockFile);}
}
function rollbackInstall(receiptFile){
 const backup=path.dirname(fs.realpathSync(receiptFile)),receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 if(receipt.schemaVersion!==1||receipt.state!=='installed')throw new Error('INSTALL_RECEIPT_INVALID');
 const profile=fs.realpathSync(receipt.profile),target=path.join(profile,'node_modules','@local','video-agent'),file=path.join(profile,'package.json');
 if(target!==receipt.target||!inside(profile,target)||digest(fs.readFileSync(file,'utf8'))!==receipt.afterDigest)throw new Error('ROLLBACK_PROFILE_CHANGED');
 if(!fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==receipt.plugin)throw new Error('ROLLBACK_LINK_CHANGED');
 const previous=fs.readFileSync(path.join(backup,'package.json'),'utf8');
 const held=[];
 if(digest(previous)!==receipt.beforeDigest)throw new Error('ROLLBACK_BACKUP_CHANGED');
 for(const [index]of receipt.dataRoots.entries())verifyBackup(path.join(backup,'data-'+index));
 const lockFile=path.join(profile,'.cutdirector-install.lock'),fd=fs.openSync(lockFile,'wx');
 try{
  for(const root of receipt.dataRoots){const lease=fs.existsSync(path.join(root,'cutdirector-v3.sqlite'))?acquireLease(root):null;held.push(lease?()=>lease.release():lock(root,{recoverStale:true}));}
  fs.unlinkSync(target);
  try{if(receipt.previousTarget)fs.symlinkSync(receipt.previousTarget,target,'junction');atomic(file,previous);}
  catch(error){if(!fs.existsSync(target))fs.symlinkSync(receipt.plugin,target,'junction');throw error;}
  atomic(receiptFile,JSON.stringify({...receipt,state:'rolled-back',rolledBackAt:new Date().toISOString()},null,2));
  return {profile,restoredPlugin:receipt.previousTarget,preservedV3Data:true};
 }finally{for(const release of held.reverse())release();fs.closeSync(fd);fs.unlinkSync(lockFile);}
}
if(require.main===module){
 try{
  const [action,a,b,c]=process.argv.slice(2);
  if(action==='plan'){const p=planInstall(a,b,{personalPreview:process.argv.includes('--personal-preview')});console.log(JSON.stringify({profile:p.profile,plugin:p.plugin,previousTarget:p.previousTarget,profileUnchanged:true},null,2));}
  else if(action==='apply')console.log(JSON.stringify(applyInstall(planInstall(a,b,{personalPreview:process.argv.includes('--personal-preview')}),c)));
  else if(action==='rollback')console.log(JSON.stringify(rollbackInstall(a)));
  else throw new Error('Usage: plan <plugin> <profile> | apply <plugin> <profile> <new backup directory> | rollback <receipt>');
 }catch(error){console.error(error.code||error.message);process.exitCode=1;}
}
module.exports={planInstall,applyInstall,rollbackInstall};
