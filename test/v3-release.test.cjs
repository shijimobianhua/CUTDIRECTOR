'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {openStore}=require('../src/v3/service/store.cjs'),{acquireLease}=require('../src/v3/service/lease.cjs');
const {createBackup,verifyBackup,restoreBackup}=require('../tools/v3-data-backup.cjs'),{buildPortable,verify}=require('../tools/package-v3.cjs');
test('Offline V3 backup refuses a live owner, preserves a consistent database and media, restores to a new root and detects tampering',t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-backup-')),source=join(root,'data'),backup=join(root,'backup'),restore=join(root,'restored');
 let store=openStore(source);const p=store.mutate('project',{commandId:'p',kind:'idea',title:'Preserve me'});store.close();
 mkdirSync(join(source,'media'));writeFileSync(join(source,'media','sample'),'private local media');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const lease=acquireLease(source);
 assert.throws(()=>acquireLease(source),{code:'DATA_ROOT_BUSY'});
 assert.throws(()=>createBackup(source,backup),{code:'DATA_ROOT_BUSY'});
 lease.release();
 const result=createBackup(source,backup);assert.equal(result.kind,'v3');assert.equal(verifyBackup(backup).kind,'v3');
 restoreBackup(backup,restore);store=openStore(restore);assert.equal(store.project(p.id).title,'Preserve me');store.close();
 const restoredLease=acquireLease(restore);restoredLease.release();
 assert.equal(readFileSync(join(restore,'media','sample'),'utf8'),'private local media');
 assert.throws(()=>restoreBackup(backup,restore),/BACKUP_TARGET_NOT_EMPTY/);
 writeFileSync(join(backup,'media','sample'),'modified');
 assert.throws(()=>verifyBackup(backup),/BACKUP_CONTENT_CHANGED/);
 assert.equal(readFileSync(join(source,'media','sample'),'utf8'),'private local media');
});
test('Legacy backup keeps source files and excludes live writer lock metadata',t=>{
 const {lock}=require('../src/core/util.cjs'),root=mkdtempSync(join(tmpdir(),'cd-legacy-backup-')),source=join(root,'old'),backup=join(root,'backup');
 mkdirSync(source);writeFileSync(join(source,'project.json'),'{"revision":7}');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const release=lock(source);
 assert.throws(()=>createBackup(source,backup),{code:'WRITER_LOCKED'});release();
 createBackup(source,backup);
 const checked=verifyBackup(backup);assert.equal(checked.kind,'legacy');assert.equal(checked.files['.writer.lock'],undefined);
 assert.equal(readFileSync(join(backup,'project.json'),'utf8'),'{"revision":7}');
});
test('Failed portable runtime assembly cannot be mistaken for a verified plugin release',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-portable-')),archive=join(root,'wrong.zip'),out=join(root,'plugin');
 t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(archive,'not an upstream runtime');
 await assert.rejects(buildPortable(out,{dataRoot:join(root,'data'),archives:{ffmpeg:archive,python:archive}}),/RUNTIME_CHECKSUM_MISMATCH/);
 assert.throws(()=>verify(out),/does not match/);
});

test('Profile install backs up data, rejects live writers and rolls back without losing manual edits',t=>{
 const fs=require('node:fs'),{build}=require('../tools/package-v3.cjs'),{planInstall,applyInstall,rollbackInstall}=require('../tools/install-v3.cjs');
 const root=mkdtempSync(join(tmpdir(),'cd-install-')),a=join(root,'old-data'),b=join(root,'new-data');
 for(const dir of [a,b]){const store=openStore(dir);store.mutate('project',{commandId:'p',kind:'idea',title:'Saved project'});store.close();}
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const old=build(join(root,'old-plugin'),a),next=build(join(root,'new-plugin'),b),profile=join(root,'v3-preview');
 mkdirSync(join(profile,'node_modules','@local'),{recursive:true});
 const file=join(profile,'package.json'),link=join(profile,'node_modules','@local','video-agent');
 const pkg={name:'isolated-profile',dependencies:{'@local/video-agent':'link:'+old,'keep-me':'1.0.0'}};
 writeFileSync(file,JSON.stringify(pkg));fs.symlinkSync(old,link,'junction');
 const plan=planInstall(next,profile);assert.equal(plan.dataRoots.length,2);
 const lease=acquireLease(b);assert.throws(()=>applyInstall(plan,join(root,'busy')),{code:'DATA_ROOT_BUSY'});lease.release();
 assert.equal(fs.realpathSync(link),old);
 const installed=applyInstall(plan,join(root,'backup'));assert.equal(fs.realpathSync(link),next);
 assert.equal(verifyBackup(join(root,'backup','data-0')).kind,'v3');
 rollbackInstall(installed.receipt);assert.equal(fs.realpathSync(link),old);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),pkg);
 const second=applyInstall(planInstall(next,profile),join(root,'backup2'));
 writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file,'utf8')),manual:'preserve'}));
 assert.throws(()=>rollbackInstall(second.receipt),/ROLLBACK_PROFILE_CHANGED/);
 assert.equal(JSON.parse(readFileSync(file,'utf8')).manual,'preserve');
 const formal=join(root,'desktop');mkdirSync(formal);writeFileSync(join(formal,'package.json'),'{}');
 assert.throws(()=>planInstall(next,formal),/RELEASE_GATES_PENDING/);
});
