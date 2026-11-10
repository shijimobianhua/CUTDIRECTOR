'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {acquireLease}=require('../src/v3/service/lease.cjs'),{lock}=require('../src/core/util.cjs');
const manifestName='cutdirector-backup.json';
function hash(file){const digest=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,size));}finally{fs.closeSync(fd);}return digest.digest('hex');}
function files(root){
 const result={};
 function scan(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=path.join(directory,entry.name),relative=path.relative(root,file).split(path.sep).join('/');
   if(entry.isSymbolicLink()||!entry.isDirectory()&&!entry.isFile())throw new Error('BACKUP_UNSUPPORTED_ENTRY');
   if(entry.isDirectory())scan(file);else result[relative]=file;
  }
 }scan(root);return result;
}
function emptyTarget(source,destination){
 const a=fs.realpathSync(source),b=path.resolve(destination),relative=path.relative(a,b),reverse=path.relative(b,a);
 if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)||
  !reverse.startsWith('..'+path.sep)&&reverse!=='..'&&!path.isAbsolute(reverse))throw new Error('BACKUP_ROOT_OVERLAP');
 if(fs.existsSync(b)&&(fs.lstatSync(b).isSymbolicLink()||fs.readdirSync(b).length))throw new Error('BACKUP_TARGET_NOT_EMPTY');
 fs.mkdirSync(b,{recursive:true});
 const real=fs.realpathSync(b),normalize=value=>process.platform==='win32'?value.toLowerCase():value;
 if(normalize(real)!==normalize(b))throw new Error('BACKUP_TARGET_REDIRECTED');
 return {source:a,target:b};
}
function createBackup(source,destination,options={}){
 const roots=emptyTarget(source,destination),v3=fs.existsSync(path.join(roots.source,'cutdirector-v3.sqlite'));
 const lease=v3?acquireLease(roots.source):null,release=v3?()=>lease.release():lock(roots.source,{recoverStale:true});
 let retained=false;
 try{
  const entries=files(roots.source),digests={};
  if(v3){
   const db=new DatabaseSync(path.join(roots.source,'cutdirector-v3.sqlite'));
   try{db.prepare('VACUUM INTO ?').run(path.join(roots.target,'cutdirector-v3.sqlite'));}finally{db.close();}
   const copy=new DatabaseSync(path.join(roots.target,'cutdirector-v3.sqlite'));
   try{copy.exec('DELETE FROM writer_lease;');if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('BACKUP_DATABASE_INVALID');}finally{copy.close();}
   digests['cutdirector-v3.sqlite']=hash(path.join(roots.target,'cutdirector-v3.sqlite'));
  }
  for(const [relative,file]of Object.entries(entries)){
   if(relative==='.writer.lock'||v3&&/^cutdirector-v3\.sqlite(?:-wal|-shm)?$/.test(relative))continue;
   const target=path.join(roots.target,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);
   const copied=hash(target);if(copied!==hash(file))throw new Error('BACKUP_SOURCE_CHANGED');digests[relative]=copied;
  }
  const manifest={schemaVersion:1,kind:v3?'v3':'legacy',createdAt:new Date().toISOString(),files:digests};
  fs.writeFileSync(path.join(roots.target,manifestName),JSON.stringify(manifest,null,2),{flag:'wx'});
  verifyBackup(roots.target);const result={path:roots.target,kind:manifest.kind,files:Object.keys(digests).length};
  if(options.retainLease){retained=true;result.release=release;}return result;
 }finally{if(!retained)release();}
}
function verifyBackup(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,manifestName),'utf8'));
 if(manifest.schemaVersion!==1||!['v3','legacy'].includes(manifest.kind)||!manifest.files||typeof manifest.files!=='object')throw new Error('BACKUP_MANIFEST_INVALID');
 const entries=files(root);delete entries[manifestName];
 const expected=Object.keys(manifest.files).sort();
 if(JSON.stringify(expected)!==JSON.stringify(Object.keys(entries).sort()))throw new Error('BACKUP_FILE_SET_CHANGED');
 for(const relative of expected)if(!/^[a-f0-9]{64}$/.test(manifest.files[relative])||hash(entries[relative])!==manifest.files[relative])throw new Error('BACKUP_CONTENT_CHANGED');
 return manifest;
}
function restoreBackup(source,destination){
 const manifest=verifyBackup(source),roots=emptyTarget(source,destination);
 for(const relative of Object.keys(manifest.files)){
  const target=path.join(roots.target,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(roots.source,relative),target,fs.constants.COPYFILE_EXCL);
  if(hash(target)!==manifest.files[relative])throw new Error('RESTORE_CONTENT_CHANGED');
 }
 return {path:roots.target,kind:manifest.kind,files:Object.keys(manifest.files).length};
}
if(require.main===module){
 try{const [action,source,destination]=process.argv.slice(2);const result=action==='create'?createBackup(source,destination):action==='restore'?restoreBackup(source,destination):action==='verify'?{verified:!!verifyBackup(source)}:null;if(!result)throw new Error('Usage: create|verify|restore <source> [new empty destination]');console.log(JSON.stringify(result));}
 catch(error){console.error(error.code||error.message);process.exitCode=1;}
}
module.exports={createBackup,verifyBackup,restoreBackup};
