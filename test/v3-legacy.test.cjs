'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { ProjectStore } = require('../src/core/store.cjs');
const { createProject } = require('../src/adapters/fablecut.cjs');
const { build, verify } = require('../tools/package-v3.cjs');

function fixture(root) {
  mkdirSync(root, { recursive: true });
  const file = join(root, 'sample.mp4');
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'color=c=green:s=320x180:d=3:r=24', '-c:v', 'libx264', file], { windowsHide: true });
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const p = createProject({ projectId: 'Old', name: '旧工程测试', width: 320, height: 180,
    media: [{ id: 'A', hash: digest, path: file, durationUs: 3000000, timeBase: '1/24', originUs: 0 }] });
  p.clips = [{ id: 'S1', mediaId: 'A', track: 'V1', kind: 'video', speed: 1, inFrame: 0, outFrame: 24, startFrame: 0 },
    { id: 'S2', mediaId: 'A', track: 'V1', kind: 'video', speed: 1, inFrame: 24, outFrame: 48, startFrame: 24 }];
  p.tracks[0].segmentIds = ['S1', 'S2'];
  p.captions = [{ id: 'C', segmentId: 'S1', text: '原字幕', sourceInFrame: 12, sourceOutFrame: 20,
    wordIds: [], corrections: [] }];
  const store = new ProjectStore(root);
  store.create(p);
  store.create({ ...p, projectId: 'Other', name: 'Other', captions: [] });
  const chatId = randomUUID();
  const runId = randomUUID();
  mkdirSync(join(root, '_agent/chat-index'), { recursive: true });
  mkdirSync(join(root, '_agent/runs'), { recursive: true });
  writeFileSync(join(root, '_agent/chat-index/Old.json'), JSON.stringify({ schemaVersion: 1, recentId: chatId,
    chats: [{ id: chatId, projectId: 'Old', title: '旧对话', runs: [runId] }] }));
  writeFileSync(join(root, '_agent/runs', runId + '.json'), JSON.stringify({
    id: runId, projectId: 'Old', conversationId: chatId, request: '剪短一点', reply: '先保留重点',
    secret: 'must-not-be-returned', context: { path: file } }));
  return { store, file, chatId };
}

test('Packaged DSH legacy routes retain scoped edits, history, conversations, renders and atomic V3 derivation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-legacy-'));
  const oldRoot = join(root, 'old');
  const currentRoot = join(root, 'v3');
  const old = fixture(oldRoot);
  const pkg = build(join(root, 'plugin'), currentRoot, process.env.FFPROBE, undefined, oldRoot);
  assert.equal(verify(pkg), true);
  const { apply } = await import(pathToFileURL(join(pkg, 'host/index.js')).href);
  let dispose;
  let host;
  async function start() {
    let handler;
    const inheritedFfmpeg = process.env.FFMPEG;
    delete process.env.FFMPEG;
    try {
      apply({ webServer: { register(route) { handler = route.handler; return () => {}; } },
        effect(fn) { dispose = fn(); } }, { dataRoot: currentRoot, legacyRoot: oldRoot, ffprobe: process.env.FFPROBE });
    } finally {
      if (inheritedFfmpeg !== undefined) process.env.FFMPEG = inheritedFfmpeg;
    }
    host = createServer(handler);
    host.listen(0, '127.0.0.1');
    await once(host, 'listening');
    const origin = 'http://127.0.0.1:' + host.address().port;
    const entry = await fetch(origin + '/video-agent/', {
      headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin', Referer: origin + '/' } });
    const session = (await entry.text()).match(/name="cutdirector-session" content="([a-f0-9]+)"/)[1];
    const cookie = entry.headers.get('set-cookie').split(';')[0];
    const api = async (route, body, options = {}) => {
      const response = await fetch(origin + '/video-agent/v3/' + route, { method: body ? 'POST' : 'GET',
        headers: { 'Sec-Fetch-Site': 'same-origin', 'X-Cutdirector-Session': session,
          ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...options },
        body: body ? JSON.stringify(body) : undefined });
      return response;
    };
    api.data = async (route, body) => {
      const response = await api(route, body);
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value.data;
    };
    api.binary = (route, authenticated = true) => fetch(origin + '/video-agent/v3/' + route, {
      headers: { 'Sec-Fetch-Site': 'same-origin', Range: 'bytes=0-15', ...(authenticated ? { Cookie: cookie } : {}) } });
    return api;
  }
  async function stop() {
    dispose();
    await new Promise(resolve => host.close(resolve));
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  t.after(async () => {
    old.store.close();
    if (host?.listening) await stop();
    rmSync(root, { recursive: true, force: true });
  });
  let api = await start();
  const busy = await api('legacy/projects');
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, 'LEGACY_WRITER_BUSY');
  old.store.close();
  assert.equal((await api.data('legacy/projects')).projects.length, 2);
  const base = 'legacy/projects/Old';
  const detail = await api.data(base);
  assert.equal(detail.revision, 0);
  assert.doesNotMatch(JSON.stringify(detail), /sample.mp4|must-not-be-returned/);
  const chat = await api.data(base + '/conversations?id=' + old.chatId);
  assert.equal(chat.runs[0].reply, '先保留重点');
  assert.doesNotMatch(JSON.stringify(chat), /secret|context|sample.mp4/);
  assert.equal((await api(base + '/command', { commandId: 'deny', baseRevision: 0,
    op: 'project.import', target: 'Old', params: { path: 'arbitrary' } })).status, 403);
  const trim = { commandId: 'trim', baseRevision: 0, op: 'segment.trim', target: 'S1',
    params: { inFrame: 6, outFrame: 24 } };
  assert.equal((await api.data(base + '/command', trim)).revision, 1);
  assert.equal((await api.data(base + '/command', trim)).revision, 1);
  assert.equal((await api(base + '/command', { ...trim, commandId: 'stale' })).status, 409);
  const video = base + '/media/A/content';
  assert.equal((await api.binary(video, false)).status, 403);
  const range = await api.binary(video);
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  const request = { revision: 1, requestId: 'render-old', type: 'preview' };
  const job = await api.data(base + '/render', request);
  let result;
  for (let i = 0; i < 120; i++) {
    result = (await api.data(base + '/deliveries')).find(item => item.id === job.id);
    if (!['queued', 'running'].includes(result.state)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  const artifact = base + '/jobs/' + job.id + '/artifacts/video.mp4';
  assert.equal((await api.binary(artifact)).status, 206);
  assert.equal((await api('legacy/projects/Other/jobs/' + job.id + '/retry', {})).status, 404);
  await api.data(base + '/command', { commandId: 'caption', baseRevision: 1, op: 'caption.correct',
    target: 'C', params: { text: '已修正字幕' } });
  assert.equal((await api.data(base + '/render', request)).id, job.id);
  assert.equal((await api(base + '/import', { commandId: 'copy-old', revision: 1, confirm: true })).status, 409);
  assert.equal((await api(base + '/import', { commandId: 'copy-old', revision: 2 })).status, 403);
  const input = { commandId: 'copy-old', revision: 2, confirm: true };
  const [first, second] = await Promise.all([api.data(base + '/import', input), api.data(base + '/import', input)]);
  assert.equal(first.projectId, second.projectId);
  const v3 = 'projects/' + first.projectId;
  assert.equal((await api.data(v3)).legacySource.source.revision, 2);
  const arrangement = await api.data(v3 + '/arrangement');
  assert.equal(arrangement.durationUs, 1750000);
  assert.equal(arrangement.captions[0].text, '已修正字幕');
  const copied = (await api.data(v3 + '/assets'))[0];
  assert.equal((await api.data('bootstrap')).projects.length, 1);
  assert.equal((await api.data(base)).revision, 2);
  const restored = await api.data(base + '/command', { commandId: 'restore', baseRevision: 2,
    op: 'revision.restore', target: 'Old', params: { revision: 0 } });
  assert.equal(restored.revision, 3);
  assert.equal((await api.data(base)).captions[0].text, '原字幕');
  assert.equal((await api.data(base)).history.length, 4);
  await stop();
  api = await start();
  assert.equal((await api.data(base + '/import', input)).projectId, first.projectId);
  unlinkSync(old.file);
  assert.equal((await api.binary(v3 + '/assets/' + copied.id + '/content')).status, 206);
  const failed = await api(base + '/import', { commandId: 'missing', revision: 3, confirm: true });
  assert.equal(failed.status, 409);
  assert.equal((await failed.json()).error.code, 'LEGACY_MEDIA_MISSING');
  assert.equal((await api.data('bootstrap')).projects.length, 1);
  assert.equal((await api.data(v3 + '/arrangement')).version, 1);
});

test('Legacy derivation rejects an edit during copying and leaves the V3 database unchanged', async t => {
  const { openStore } = require('../src/v3/service/store.cjs');
  const { createLegacyWriter } = require('../src/v3/legacy/writer.cjs');
  const { createLegacyImport } = require('../src/v3/legacy/import.cjs');
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-legacy-race-'));
  const old = fixture(join(root, 'old'));
  old.store.close();
  const currentRoot = join(root, 'v3');
  const store = openStore(currentRoot);
  const writer = createLegacyWriter(join(root, 'old'), currentRoot);
  t.after(async () => { await writer.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const original = writer.file;
  let edit = true;
  writer.file = (...args) => {
    const value = original(...args);
    if (edit) {
      edit = false;
      queueMicrotask(() => writer.command('Old', { commandId: 'human-edit', baseRevision: 0,
        op: 'caption.correct', target: 'C', params: { text: '复制期间的新字幕' } }));
    }
    return value;
  };
  const importer = createLegacyImport(writer, store, currentRoot);
  await assert.rejects(importer.run('Old', { commandId: 'copy-race', revision: 0, confirm: true }),
    { code: 'LEGACY_REVISION_CONFLICT' });
  assert.equal(store.snapshot().projects.length, 0);
  assert.equal(writer.detail('Old').revision, 1);
  const result = await importer.run('Old', { commandId: 'copy-race-next', revision: 1, confirm: true });
  assert.equal(store.arrangement(result.projectId).captions[0].text, '复制期间的新字幕');
  assert.equal(store.snapshot().projects.length, 1);
});
