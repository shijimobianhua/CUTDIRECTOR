'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { openStore } = require('../src/v3/service/store.cjs');
const { createImageGeneration } = require('../src/v3/service/image-generation.cjs');
const { createImageArk, imageModel, failure } = require('../src/v3/service/ark.cjs');

test('Seedream requests exactly one image at the fixed API and rejects malformed output', async () => {
  let response = { data: [{ b64_json: Buffer.from('sample-image').toString('base64') }] };
  let calls = 0;
  const ark = createImageArk(async (url, options) => {
    calls++;
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer unit-test');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { model: imageModel, prompt: 'A cup', size: '2048x2048',
      response_format: 'b64_json', output_format: 'jpeg', sequential_image_generation: 'disabled',
      watermark: true, image: 'data:image/jpeg;base64,AA==' });
    return Response.json(response);
  });
  const generate = () => ark.generate('unit-test', { prompt: 'A cup', size: '2048x2048' }, 'data:image/jpeg;base64,AA==');
  assert.equal((await generate()).toString(), 'sample-image');
  response = { data: [{ url: 'https://untrusted.example/output' }] };
  await assert.rejects(generate(), { code: 'ARK_BAD_RESPONSE' });
  response = { data: [{ b64_json: 'AA==' }, { b64_json: 'AA==' }] };
  await assert.rejects(generate(), { code: 'ARK_BAD_RESPONSE' });
  response = { data: [{ error: { code: 'blocked' } }] };
  await assert.rejects(generate(), { code: 'ARK_REJECTED' });
  assert.equal(calls, 4);
});

test('Image generation requires approval, validates candidates, freezes methods and recovers local output without resubmission', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-image-'));
  let store = openStore(root);
  let service;
  t.after(() => { service?.stop(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const result = join(root, 'sample.jpg');
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x320', '-frames:v', '1', result,
  ], { windowsHide: true });
  const bytes = readFileSync(result);
  let submits = 0;
  let referenceReceived;
  const ark = { async generate(key, spec, reference) {
    assert.equal(key, 'unit-test');
    submits++;
    referenceReceived = reference;
    if (spec.prompt === 'timeout') throw failure('ARK_NETWORK', 503);
    if (spec.prompt === 'bad') return Buffer.from('invalid image');
    await new Promise(resolve => setTimeout(resolve, 10));
    return bytes;
  } };
  const vault = async (mode, value) => { assert.equal(mode, 'open'); assert.equal(value, 'sealed'); return 'unit-test'; };
  const open = () => createImageGeneration(store, root, { ark, vault, recover: false });
  service = open();
  const project = store.mutate('project', { commandId: 'project', title: 'Images', kind: 'idea' });
  const other = store.mutate('project', { commandId: 'other', title: 'Other', kind: 'idea' });
  const shotId = randomUUID();
  const story = store.mutate('story', { commandId: 'story', projectId: project.id, expectedVersion: 0,
    ratio: '1:1', brief: 'A cup', durationUs: 4000000,
    shots: [{ id: shotId, action: 'A cup on a table', durationUs: 4000000 }] });
  const input = { commandId: 'image-one', storyVersion: 1, shotId, frame: 'start' };
  assert.throws(() => service.prepare(project.id, input), { code: 'ARK_NOT_CONFIGURED' });
  store.generation.saveConnection('sealed');
  const job = service.prepare(project.id, input);
  assert.equal(service.prepare(project.id, input).id, job.id);
  assert.throws(() => service.prepare(project.id, { ...input, frame: 'end' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.approve(project.id, job.id, {}), { code: 'ARK_APPROVAL_REQUIRED' });
  await assert.rejects(service.approve(other.id, job.id, { confirmCharge: true }), { code: 'IMAGE_JOB_NOT_FOUND' });
  assert.equal(submits, 0);
  const approve = { confirmCharge: true };
  const results = await Promise.all([service.approve(project.id, job.id, approve), service.approve(project.id, job.id, approve)]);
  const ready = results.find(item => item.state === 'ready');
  assert.ok(ready);
  assert.equal(submits, 1);
  assert.equal(store.images(project.id).length, 1);
  const candidate = store.image(project.id, ready.candidateId);
  assert.equal(candidate.source, 'seedream');
  assert.equal(candidate.visualReview, 'user-required');
  assert.equal(candidate.width, 320);
  assert.equal(candidate.imageJobId, job.id);
  assert.equal(store.story(project.id).version, 1);
  assert.equal(store.story(project.id).shots[0].startImageId, undefined);
  assert.equal(store.generation.config().imageGeneratedOnce, true);
  assert.doesNotMatch(JSON.stringify(service.list(project.id)), /sealed|unit-test|"digest"/);
  assert.equal((await service.check(project.id, job.id)).candidateId, ready.candidateId);

  const refJob = service.prepare(project.id, { ...input, commandId: 'with-ref', frame: 'end', referenceId: ready.candidateId });
  await assert.rejects(service.approve(project.id, refJob.id, approve), { code: 'ARK_APPROVAL_REQUIRED' });
  assert.equal((await service.approve(project.id, refJob.id, { ...approve, confirmUpload: true })).state, 'ready');
  const changed = service.prepare(project.id, { ...input, frame: 'end', commandId: 'changed-reference', referenceId: ready.candidateId });
  const beforeChanged = submits;
  const referencePath = join(root, 'media', candidate.digest);
  writeFileSync(referencePath, Buffer.alloc(bytes.length));
  await assert.rejects(service.approve(project.id, changed.id, { ...approve, confirmUpload: true }), { code: 'ARK_FRAME_CHANGED' });
  assert.equal(submits, beforeChanged);
  writeFileSync(referencePath, bytes);
  assert.ok(referenceReceived.startsWith('data:image/jpeg;base64,'));
  assert.equal(Buffer.from(referenceReceived.split(',')[1], 'base64').equals(bytes), true);

  const main = '---\nname: cup-image\ndescription: Draw a cup.\n---\nKeep the cup visible.\n';
  const preview = await store.skills.preview('folder', Buffer.from(JSON.stringify([
    { path: 'SKILL.md', text: main },
    { path: 'cutdirector.skill.json', text: JSON.stringify({ schemaVersion: 1, roles: ['image'],
      stages: ['frames'], capabilities: ['image-generation'], suggestedExecutor: 'seedream' }) },
  ])));
  const method = store.skills.install(preview.id);
  const methodJob = service.prepare(project.id, { ...input, commandId: 'method', method: method.hash });
  assert.match(methodJob.spec.prompt, /Keep the cup visible/);
  store.skills.activate(method.hash, false);
  await assert.rejects(service.approve(project.id, methodJob.id, approve), { code: 'SKILL_DISABLED' });

  const bad = service.prepare(project.id, { ...input, commandId: 'bad', prompt: 'bad' });
  assert.equal((await service.approve(project.id, bad.id, approve)).state, 'failed');
  const pending = service.prepare(project.id, { ...input, commandId: 'pending-before-timeout' });
  const timeout = service.prepare(project.id, { ...input, commandId: 'timeout', prompt: 'timeout' });
  assert.equal((await service.approve(project.id, timeout.id, approve)).state, 'unknown');
  assert.equal(service.list(project.id).find(item => item.id === pending.id).spec.priorUnknown, true);
  const before = submits;
  assert.equal((await service.approve(project.id, timeout.id, approve)).state, 'unknown');
  assert.equal((await service.check(project.id, timeout.id)).state, 'unknown');
  assert.equal(submits, before);
  const recovery = service.prepare(project.id, { ...input, commandId: 'recovery' });
  await assert.rejects(service.approve(project.id, recovery.id, approve), { code: 'IMAGE_PRIOR_UNKNOWN' });
  assert.equal(store.imageJobs.claim(project.id, recovery.id), true);
  mkdirSync(join(root, 'seedream-staging'), { recursive: true });
  writeFileSync(join(root, 'seedream-staging', recovery.id + '.jpg'), bytes);

  const stale = service.prepare(project.id, { ...input, commandId: 'stale' });
  store.mutate('story', { ...story, commandId: 'next-story', projectId: project.id, expectedVersion: 1,
    shots: [{ ...story.shots[0], startImageId: ready.candidateId }] });
  assert.equal(store.story(project.id).shots[0].startImageId, ready.candidateId);
  await assert.rejects(service.approve(project.id, stale.id, { ...approve, acknowledgeDuplicate: true }), { code: 'STORY_CONFLICT' });
  service.stop();
  store.close();
  store = openStore(root);
  service = open();
  assert.equal(store.imageJobs.get(project.id, recovery.id).state, 'unknown');
  const recovered = await service.check(project.id, recovery.id);
  assert.equal(recovered.state, 'ready');
  const count = store.images(project.id).length;
  assert.equal((await service.check(project.id, recovery.id)).candidateId, recovered.candidateId);
  assert.equal(store.images(project.id).length, count);
  assert.equal(submits, before);

  // The decoder uses the frozen ratio even when the returned file is a valid image.
  store.mutate('story', { ...store.story(project.id), commandId: 'wide', projectId: project.id, expectedVersion: 2, ratio: '16:9' });
  const wide = service.prepare(project.id, { ...input, storyVersion: 3, frame: 'end', commandId: 'wide-job' });
  const wideResult = await service.approve(project.id, wide.id, approve);
  assert.equal(wideResult.state, 'failed');
  assert.equal(wideResult.error, 'IMAGE_RESULT_ASPECT');
  assert.equal(store.images(project.id).length, count);
});

test('Version 9 projects and pending video jobs survive the image-job schema upgrade', t => {
  const { DatabaseSync } = require('node:sqlite');
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-image-upgrade-'));
  let store = openStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = store.mutate('project', { commandId: 'p', title: 'Existing project', kind: 'idea' });
  const shotId = randomUUID();
  store.mutate('story', { commandId: 's', projectId: project.id, expectedVersion: 0, ratio: '1:1',
    brief: 'Keep existing media', durationUs: 4000000,
    shots: [{ id: shotId, action: 'A cup', durationUs: 4000000 }] });
  store.generation.saveConnection('protected-existing-connection');
  const job = store.generation.prepare(project.id, { commandId: 'video', storyVersion: 1, shotId, seconds: 4 });
  store.close();
  const legacy = new DatabaseSync(join(root, 'cutdirector-v3.sqlite'));
  legacy.exec('DROP TABLE image_jobs; DROP TABLE legacy_imports; ALTER TABLE chat_turns DROP COLUMN context; ALTER TABLE chat_turns DROP COLUMN proposal; PRAGMA user_version = 9;');
  legacy.close();
  store = openStore(root);
  assert.equal(store.project(project.id).title, 'Existing project');
  assert.equal(store.story(project.id).version, 1);
  assert.equal(store.generation.list(project.id)[0].id, job.id);
  assert.equal(store.generation.list(project.id)[0].state, 'awaiting_approval');
  assert.equal(store.generation.config().configured, true);
  assert.equal(store.generation.config().imageGeneratedOnce, false);
  assert.deepEqual(store.imageJobs.list(project.id), []);
});
