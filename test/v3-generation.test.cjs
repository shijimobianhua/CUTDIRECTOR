'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { openStore } = require('../src/v3/service/store.cjs');
const { createGeneration } = require('../src/v3/service/generation.cjs');
const { createArk, failure, model } = require('../src/v3/service/ark.cjs');

test('Ark sends only the approved payload to its fixed API and never attaches a key to output downloads', async () => {
  const calls = [];
  const transport = createArk(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('?page_size=1')) return Response.json({ items: [] });
    if (options.method === 'POST') return Response.json({ id: 'cgt-20261106-test' });
    if (url.includes('/tasks/')) return Response.json({ id: 'cgt-20261106-test', status: 'succeeded',
      content: { video_url: 'https://ark-test.tos-cn-beijing.volces.com/sample.mp4' } });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
  });
  await transport.probe('test-only-key');
  const id = await transport.submit('test-only-key', { model, prompt: 'A cup', ratio: '1:1', seconds: 4, audio: false },
    [{ role: 'first_frame', dataUrl: 'data:image/png;base64,AA==' }]);
  const result = await transport.poll('test-only-key', id);
  await transport.download(result.videoUrl);
  assert.equal(calls[1].url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  assert.deepEqual(JSON.parse(calls[1].options.body).content, [
    { type: 'text', text: 'A cup' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' }, role: 'first_frame' },
  ]);
  assert.equal(calls[3].options.headers, undefined);
  assert.equal(calls[3].options.redirect, 'error');
  for (const url of ['http://ark.tos-cn-beijing.volces.com/x', 'https://127.0.0.1/test',
    'https://ark.tos-cn-beijing.volces.com.example.com/x', 'https://key@ark.tos-cn-beijing.volces.com/x']) {
    await assert.rejects(transport.download(url), { code: 'ARK_UNSAFE_OUTPUT' });
  }
  assert.equal(calls.length, 4);
});

test('Seedance gates spending, resumes the original task and imports one validated candidate', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-gen-'));
  let store = openStore(root);
  let service;
  t.after(() => { service?.stop(); store?.close(); rmSync(root, { recursive: true, force: true }); });

  const output = join(root, 'result.mp4');
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x320:d=4', '-c:v', 'libx264', output,
  ], { windowsHide: true });
  const bytes = readFileSync(output);
  let submits = 0;
  let downloads = 0;
  let polls = 0;
  const transport = {
    async probe(key) { assert.equal(key, 'trial-only-key'); },
    async submit(key, spec, frames) {
      assert.equal(key, 'trial-only-key');
      submits++;
      assert.equal(spec.seconds, 4);
      assert.equal(frames[0].role, 'first_frame');
      if (spec.prompt === 'Timeout sample') throw failure('ARK_NETWORK', 503);
      await new Promise(resolve => setTimeout(resolve, 30));
      return 'cgt-20261106-test';
    },
    async poll(key, id) {
      assert.equal(key, 'trial-only-key');
      assert.equal(id, 'cgt-20261106-test');
      polls++;
      return polls === 1 ? { state: 'running' } : { state: 'succeeded', videoUrl: 'https://safe.mock/result' };
    },
    async download() {
      downloads++;
      if (downloads === 1) throw failure('ARK_DOWNLOAD_FAILED', 502);
      return new Response(bytes, { headers: { 'Content-Type': 'video/mp4' } }).body;
    },
  };
  const vault = async (mode, value) => mode === 'seal' ? 'protected:' + Buffer.from(value).toString('base64')
    : Buffer.from(value.split(':')[1], 'base64').toString();
  const open = () => createGeneration(store, root, { ark: transport, vault, auto: false });
  service = open();
  assert.equal(service.config().configured, false);
  const settings = await service.save({ key: 'trial-only-key' });
  assert.equal(settings.configured, true);
  assert.equal(settings.generatedOnce, false);
  assert.doesNotMatch(JSON.stringify(settings), /trial-only-key|protected:/);
  const project = store.mutate('project', { commandId: 'project', title: 'Seedance test', kind: 'idea' });
  const other = store.mutate('project', { commandId: 'other', title: 'Other', kind: 'idea' });
  const frameBytes = Buffer.from('synthetic frame payload for transport only');
  const digest = createHash('sha256').update(frameBytes).digest('hex');
  mkdirSync(join(root, 'media'));
  const image = store.mutate('image', {
    commandId: 'image', projectId: project.id, name: 'frame.png', digest,
    size: frameBytes.length, width: 320, height: 320, contentType: 'image/png', source: 'manual',
  }, () => writeFileSync(join(root, 'media', digest), frameBytes));
  const shotId = '12a45678-0000-0000-0000-000000000001';
  const story = store.mutate('story', { commandId: 'story', projectId: project.id, expectedVersion: 0,
    ratio: '1:1', brief: 'A cup', durationUs: 4000000,
    shots: [{ id: shotId, action: 'Hold on a cup', durationUs: 4000000, startImageId: image.id }] });
  const prepare = { commandId: 'trial', storyVersion: story.version, shotId, seconds: 4 };
  const job = service.prepare(project.id, prepare);
  assert.equal(service.prepare(project.id, prepare).id, job.id);
  assert.equal(job.spec.frames[0].name, 'frame.png');
  assert.throws(() => service.prepare(project.id, { ...prepare, seconds: 5 }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.approve(other.id, job.id, {}), { code: 'GENERATION_NOT_FOUND' });
  await assert.rejects(service.approve(project.id, job.id, { confirmCharge: true }), { code: 'ARK_APPROVAL_REQUIRED' });
  assert.equal(submits, 0);
  const approved = { confirmCharge: true, confirmUpload: true };
  const results = await Promise.all([service.approve(project.id, job.id, approved), service.approve(project.id, job.id, approved)]);
  assert.ok(results.some(item => item.remoteId === 'cgt-20261106-test'));
  assert.equal(submits, 1);
  assert.equal((await service.check(project.id, job.id)).state, 'running');
  assert.equal(service.pause(project.id, job.id, true).paused, true);
  assert.equal(service.pause(project.id, job.id, false).paused, false);
  assert.equal((await service.check(project.id, job.id)).state, 'collect_failed');

  service.stop();
  store.close();
  store = openStore(root);
  service = open();
  const done = await service.check(project.id, job.id);
  assert.equal(done.state, 'ready');
  assert.equal(store.asset(project.id, done.candidateId).source, 'seedance');
  assert.equal(store.asset(project.id, done.candidateId).durationUs, 4000000);
  assert.equal((await service.check(project.id, job.id)).candidateId, done.candidateId);
  assert.equal(downloads, 2);
  assert.equal(service.config().generatedOnce, true);

  const uncertain = service.prepare(project.id, { ...prepare, commandId: 'timeout', prompt: 'Timeout sample' });
  assert.equal((await service.approve(project.id, uncertain.id, approved)).state, 'unknown');
  assert.equal((await service.approve(project.id, uncertain.id, approved)).state, 'unknown');
  assert.equal(submits, 2);

  const crash = service.prepare(project.id, { ...prepare, commandId: 'interrupted' });
  assert.equal(crash.spec.priorUnknown, true);
  await assert.rejects(service.approve(project.id, crash.id, approved), { code: 'ARK_PRIOR_UNKNOWN' });
  assert.equal(store.generation.claim(project.id, crash.id), true);
  const stale = service.prepare(project.id, { ...prepare, commandId: 'stale' });
  store.mutate('story', { ...story, commandId: 'new-story', projectId: project.id, expectedVersion: 1 });
  await assert.rejects(service.approve(project.id, stale.id, { ...approved, acknowledgeDuplicate: true }), { code: 'STORY_CONFLICT' });
  service.stop();
  store.close();
  store = openStore(root);
  service = open();
  assert.equal((await service.approve(project.id, crash.id, approved)).state, 'unknown');
  assert.equal(submits, 2);
});
