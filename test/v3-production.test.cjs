'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { openStore } = require('../src/v3/service/store.cjs');
const { build } = require('../tools/package-v3.cjs');

test('Director uses current production state, sends storyboard text only with consent and preserves turn evidence', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cd-production-'));
  const store = openStore(join(root, 'data'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const pkg = build(join(root, 'plugin'), join(root, 'unused'));
  const { respond } = await import(pathToFileURL(join(pkg, 'host/director.js')).href);
  const p = store.mutate('project', {commandId:'p',title:'Private idea',kind:'idea'});
  const shots = Array.from({length:10}, (_,i)=>({id:randomUUID(),action:'Secret action '+i,durationUs:1000000}));
  const story = store.mutate('story', {commandId:'s',projectId:p.id,expectedVersion:0,
    brief:'Private brief',style:'Private style',ratio:'9:16',durationUs:10000000,shots});
  const chat = store.chat.open(p.id,{commandId:randomUUID()});
  const model = {provider:'sample',id:'text'};
  let calls = 0;
  let sent;
  const ctx = {get:()=>({listProviders:async()=>[{id:'sample'}],listModels:async()=>[{id:'text'}],
    async *stream(input){calls++;sent=JSON.parse(input.messages.at(-1).content[0].text);
      yield {type:'text-delta',text:'{"text":"先看分镜图片","action":"images"}'};
      yield {type:'finish',reason:'stop'};
    }})};
  const start = (text,extra={}) => store.chat.start(p.id,chat.id,{commandId:randomUUID(),text,...extra});
  const minimal = start('给一些建议',{model});
  assert.equal(minimal.context.storyEvidence,null);
  assert.doesNotMatch(JSON.stringify(minimal.context),/Private brief|Private style|Secret action/);
  assert.equal((await respond(ctx,minimal)).action,'images');
  assert.equal(sent.context.production.shotCount,10);
  store.chat.finish(p.id,chat.id,{turnId:minimal.turnId,text:'先看图片',action:'images'});
  const authorized = start('看看具体的故事',{model,includeStory:true});
  assert.equal(authorized.context.storyEvidence.brief,'Private brief');
  assert.equal(authorized.context.storyEvidence.includedShots,8);
  assert.equal(authorized.context.storyEvidence.totalShots,10);
  assert.equal((await respond(ctx,authorized)).action,'images');
  assert.equal(sent.context.storyEvidence.shots.length,8);
  store.chat.finish(p.id,chat.id,{turnId:authorized.turnId,text:'已收到文字',action:'generation'});
  assert.equal(calls,2);
  assert.equal(store.chat.turns(p.id,chat.id).at(-1).context.includeStory,true);
  assert.equal(store.chat.turns(p.id,chat.id).at(-1).context.production.storyVersion,1);
  const guide = start('下一步');
  assert.equal((await respond({},guide)).action,'images');
  store.chat.finish(p.id,chat.id,{turnId:guide.turnId,text:'准备图片',action:'images'});
  store.generation.saveConnection('opaque');
  const job = store.imageJobs.prepare(p.id,{commandId:'image',storyVersion:1,shotId:shots[0].id,frame:'start'});
  store.imageJobs.claim(p.id,job.id);
  store.imageJobs.update(p.id,job.id,'unknown','IMAGE_SUBMIT_UNKNOWN');
  const uncertain = start('开始图怎么做');
  assert.match((await respond({},uncertain)).text,/待核对/);
  store.chat.finish(p.id,chat.id,{turnId:uncertain.turnId,text:'待核对',action:'images'});
  const review = start('帮我画面检查');
  assert.match((await respond({},review)).text,/没有实际看过/);
  store.chat.finish(p.id,chat.id,{turnId:review.turnId,text:'需要检查',action:'images'});
  const skill = await store.skills.preview('folder', Buffer.from(JSON.stringify([
    {path:'SKILL.md',text:'---\nname: cup-image\ndescription: Draw a cup.\n---\nKeep the cup visible.'},
    {path:'cutdirector.skill.json',text:JSON.stringify({schemaVersion:1,roles:['image'],stages:['frames'],
      capabilities:['image-generation'],suggestedExecutor:'seedream'})},
  ])));
  store.skills.install(skill.id);
  const methodTurn = start('画图',{method:skill.hash});
  assert.equal(methodTurn.method.state,'confirmation-required');
  const methodReply = await respond({},methodTurn);
  assert.equal(methodReply.action,'images');
  assert.match(methodReply.text,/确认生成/);
  assert.equal(calls,2);
  store.chat.finish(p.id,chat.id,{turnId:methodTurn.turnId,text:methodReply.text,action:methodReply.action});
  const other = store.mutate('project',{commandId:'other',title:'Other',kind:'idea'});
  assert.equal(store.production(other.id).uncertainImages,0);
  store.mutate('story',{...story,commandId:'s2',projectId:p.id,expectedVersion:1,brief:'Updated brief'});
  assert.equal(store.production(p.id).storyVersion,2);
  assert.equal(store.chat.turns(p.id,chat.id)[0].context.production.storyVersion,1);
});
