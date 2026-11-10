'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {openStore}=require('../src/v3/service/store.cjs'),{createNativeConnection}=require('../src/v3/service/native-connection.cjs');
test('GUI native connection persists only verified selections, hides paths from settings responses and respects cancel and stale versions',async t=>{
 const root=mkdtempSync(join(tmpdir(),'cd-native-connect-')),data=join(root,'data'),store=openStore(data),app=join(root,'app'),library=join(root,'library');
 mkdirSync(app);mkdirSync(library);const editor=join(app,'JianyingPro.exe'),wrong=join(app,'other.exe');writeFileSync(editor,'synthetic test file, never executed');writeFileSync(wrong,'never executed');
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 let next=editor,probes=0,last;
 const service=createNativeConnection(store,data,{python:'internal-python',jyr:'internal-jyr'},value=>{last=value;},{
  componentsReady:true,choose:async()=>next,probe:async value=>{probes++;assert.equal(value.editor,editor);assert.equal(value.draftRoot,library);return {target:'verified-fixture'};}
 });
 assert.equal(service.view().enabled,false);
 let view=await service.action({action:'pick-editor',expectedVersion:0});assert.equal(view.version,1);assert.equal(view.enabled,false);
 next=library;view=await service.action({action:'pick-library',expectedVersion:1});assert.equal(view.version,2);assert.equal(probes,0);
 view=await service.action({action:'check',expectedVersion:2});assert.equal(probes,1);assert.equal(view.enabled,true);assert.equal(last.editor,editor);
 assert.doesNotMatch(JSON.stringify(view),/JianyingPro.exe|internal-python/);assert.equal(view.editor,undefined);assert.equal(view.draftRoot,undefined);
 await assert.rejects(service.action({action:'disable',expectedVersion:1}),{code:'NATIVE_CONNECTION_CONFLICT'});
 view=await service.action({action:'disable',expectedVersion:3});assert.equal(view.enabled,false);assert.equal(service.runtime().editor,null);
 next=null;const cancelled=await service.action({action:'pick-editor',expectedVersion:4});assert.equal(cancelled.version,4);
 next=wrong;await assert.rejects(service.action({action:'pick-editor',expectedVersion:4}),{code:'NATIVE_PATH_INVALID'});
 assert.equal(store.native.get().version,4);service.stop();
});
