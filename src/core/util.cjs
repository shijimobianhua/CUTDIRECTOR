'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
const hash = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
function fail(code, message = code, details = {}) { throw Object.assign(new Error(message), {code, ...details}); }
function atomic(file, value, beforeRename) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { beforeRename?.(); fs.renameSync(tmp, file); } catch(e) { fs.rmSync(tmp, {force:true}); throw e; }
}
function lock(dir, {recoverStale=false}={}) {
  fs.mkdirSync(dir, {recursive:true}); const file=path.join(dir,'.writer.lock');
  let fd;
  try { fd=fs.openSync(file,'wx'); } catch(e) {
    if(e.code!=='EEXIST') throw e;
    if(!recoverStale) fail('WRITER_LOCKED','Writer lock exists; stop the owner and reconcile before removing it');
    const previous=fs.readFileSync(file,'utf8');
    let owner; try { owner=JSON.parse(previous); } catch { fail('WRITER_LOCKED','Unreadable writer lock requires reconciliation'); }
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0) fail('WRITER_LOCKED','Invalid writer PID requires reconciliation');
    try { process.kill(owner.pid,0); fail('WRITER_LOCKED','Writer PID '+owner.pid+' is still alive'); }
    catch(error) { if(error.code!=='ESRCH') throw error; }
    // An immutable claim per dead generation prevents two recoverers from deleting
    // a newly acquired lock. Keep the claim even after successful recovery.
    const claim=file+'.recovered-'+hash(previous);
    let recovery;
    try { recovery=fs.openSync(claim,'wx'); } catch(error) {
      if(error.code==='EEXIST') fail('WRITER_LOCKED','Stale lock recovery already claimed; retry or reconcile interrupted recovery');
      throw error;
    }
    fs.closeSync(recovery);
    if(fs.readFileSync(file,'utf8')!==previous) fail('WRITER_LOCKED','Writer owner changed during recovery');
    fs.unlinkSync(file);
    try { fd=fs.openSync(file,'wx'); } catch(error) {
      if(error.code==='EEXIST') fail('WRITER_LOCKED','Another writer acquired the lock');
      throw error;
    }
  }
  const ownership=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),token:randomUUID()});
  fs.writeFileSync(fd, ownership); fs.closeSync(fd);
  let closed=false; return () => { if(!closed) { closed=true; if(fs.readFileSync(file,'utf8')===ownership) fs.unlinkSync(file); } };
}
module.exports={canonical,hash,fail,atomic,lock};
