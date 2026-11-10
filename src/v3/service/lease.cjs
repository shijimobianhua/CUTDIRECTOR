'use strict';
const {DatabaseSync}=require('node:sqlite'),{mkdirSync}=require('node:fs'),{join,isAbsolute}=require('node:path'),{randomBytes}=require('node:crypto');
function acquireLease(root){
 if(!isAbsolute(root))throw new Error('Absolute data root required');
 mkdirSync(root,{recursive:true});
 const db=new DatabaseSync(join(root,'cutdirector-v3.sqlite'));db.exec('PRAGMA busy_timeout=2000;CREATE TABLE IF NOT EXISTS writer_lease(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,pid INTEGER NOT NULL);');
 const token=randomBytes(24).toString('hex');
 db.exec('BEGIN IMMEDIATE');
 try{
  const row=db.prepare('SELECT * FROM writer_lease WHERE id=1').get();
  if(row){
   let alive=false;
   try{process.kill(row.pid,0);alive=true;}catch(error){if(error.code!=='ESRCH')alive=true;}
   if(alive)throw Object.assign(new Error('DATA_ROOT_BUSY'),{code:'DATA_ROOT_BUSY',status:409});
  }
  db.prepare('INSERT INTO writer_lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,pid=excluded.pid').run(token,process.pid);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');db.close();throw error;}
 let released=false;
 return {release(){
  if(released)return;released=true;
  try{db.prepare('DELETE FROM writer_lease WHERE id=1 AND token=?').run(token);}finally{db.close();}
 }};
}
module.exports={acquireLease};
