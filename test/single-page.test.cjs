'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('DSH embeds the shared workbench without a native conversation dependency',()=>{
  let plugin;
  const slots=[];
  const createElement=(type,props)=>({type,props});
  const code=fs.readFileSync(require.resolve('../src/client/client.js'),'utf8');
  vm.runInNewContext(code,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>({createElement}));}}}});
  plugin.apply({slots:{inject:(_,install)=>install(),register:(options,component)=>slots.push({options,component})}});
  const page=slots.find(slot=>slot.options.name==='main').component();
  assert.equal(page.type,'iframe');
  assert.equal(page.props.src,'/video-agent/');
  assert.equal(slots.length,2);
  assert.doesNotMatch(code,/conversation|session/);
});
