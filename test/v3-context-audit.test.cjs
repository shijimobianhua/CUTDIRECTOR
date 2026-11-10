'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {openStore}=require('../src/v3/service/store.cjs'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{createHash}=require('node:crypto');
test('Reference sharing has a single text budget and historical receipts retain exact excerpt hashes without source bodies',t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-context-audit-')),store=openStore(root);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const project=store.mutate('project',{commandId:'p',title:'Budget audit',kind:'idea'});
 for(let index=0;index<5;index++){
   const idea=store.mutate('idea',{commandId:'idea-'+index,text:('私有灵感'+index).repeat(190)});
   store.ideas.link(project.id,{commandId:'link-'+index,ideaId:idea.id,sourceVersion:0,expectedVersion:0,mode:'reference'});
   for(let source=0;source<2;source++)store.sources.add(idea.id,{commandId:'source-'+index+'-'+source},{
     title:'来源 '+index+'-'+source,text:('私有来源正文'+index).repeat(700),kind:'text-attachment'
   });
 }
 const chat=store.chat.open(project.id,{commandId:'chat'});
 const start=includeReferences=>store.chat.start(project.id,chat.id,{commandId:includeReferences?'yes':'no',text:'请根据参考给建议',includeReferences,model:{provider:'fixture',id:'text'}});
 const turn=start(true);
 assert.equal(turn.context.references.reduce((sum,item)=>sum+item.text.length,0),5000);
 const saved=store.chat.turns(project.id,chat.id)[0].context;
 assert.equal(saved.references.length,turn.context.references.length);
 for(const [index,item]of saved.references.entries()){
   assert.equal(item.text,undefined);
   assert.equal(item.excerptDigest,createHash('sha256').update(turn.context.references[index].text).digest('hex'));
   assert.equal(item.characters,turn.context.references[index].text.length);
 }
 assert.doesNotMatch(JSON.stringify(saved),/私有来源正文|私有灵感/);
 const original=JSON.stringify(saved);
 const first=store.ideas.list().items[0];
 store.sources.add(first.id,{commandId:'later'},{title:'后来加入',text:'新的私有来源正文',kind:'text-attachment'});
 assert.equal(JSON.stringify(store.chat.turns(project.id,chat.id)[0].context),original);
 store.chat.finish(project.id,chat.id,{turnId:turn.turnId,text:'待确认的建议'});
 assert.deepEqual(start(false).context.references,[]);
 assert.deepEqual(store.chat.turns(project.id,chat.id).at(-1).context.references,[]);
});
