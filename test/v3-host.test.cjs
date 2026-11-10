'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { build, verify } = require('../tools/package-v3.cjs');

test('DSH Host gates the embedded page and persists idempotent writes in the configured profile', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-v3-'));
  t.after(async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true });
        return;
      } catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 11) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  });
  const pkg = build(join(root, 'plugin'), join(root, 'profile-one'));
  assert.equal(verify(pkg), true);
  const { apply } = await import(pathToFileURL(join(pkg, 'host/index.js')).href);
  let modelCalls = 0;
  let expectedMethod;

  async function start(dataRoot) {
    let route;
    let stop;
    apply({
      webServer: { register(options) { route = options.handler; return () => {}; } },
      effect(effect) { stop = effect(); },
      get(name) {
        if(name==='profileContext')return {dir:join(root,'host-managed-profile')};
        assert.equal(name, 'llm');
        return {
          listProviders: () => [{ id: 'sample', name: 'Sample' }],
          listModels: async () => [{ id: 'text', name: 'Text model' }],
          async *stream(request) {
            modelCalls++;
            assert.equal(request.provider, 'sample');
            assert.equal(request.model, 'text');
            const payload = JSON.parse(request.messages.at(-1).content[0].text);
            assert.deepEqual(payload.context.subtitleEvidence, []);
            assert.equal(payload.context.importedCount, 2);
            if (expectedMethod) assert.equal(payload.method.body, expectedMethod);
            yield { type: 'text-delta', text: '可以先试两个不同的开场。' };
            yield { type: 'finish', reason: 'stop' };
          },
        };
      },
    }, { dataRoot });
    const server = createServer(route);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    return {
      origin,
      async close() {
        stop();
        await new Promise((resolve) => server.close(resolve));
      },
    };
  }

  async function embed(host) {
    const url = host.origin + '/video-agent/';
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url + 'v3/bootstrap')).status, 403);
    const response = await fetch(url, {
      headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin', Referer: host.origin + '/' },
    });
    assert.equal(response.status, 200);
    const session = (await response.text()).match(/name="cutdirector-session" content="([a-f0-9]+)"/)[1];
    const api = (route, data, origin = host.origin) => fetch(url + 'v3/' + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        'Sec-Fetch-Site': 'same-origin', 'X-Cutdirector-Session': session,
        ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    api.media = (route, { data, range, cookie = true } = {}) => fetch(url + 'v3/' + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        ...(range ? { Range: range } : {}),
        ...(cookie ? { Cookie: response.headers.get('set-cookie').split(';')[0] } : {}),
        ...(data ? { 'X-Cutdirector-Session': session, 'Content-Type': 'application/octet-stream', Origin: host.origin } : {}),
      },
      body: data,
    });
    return api;
  }

  let host = await start(join(root, 'profile-one'));
  try {
    const api = await embed(host);
    assert.deepEqual((await (await api('connections')).json()).data, [{ provider: 'Sample', model: 'Text model', providerId: 'sample', modelId: 'text' }]);
    const input = { commandId: 'capture', text: 'A short video' };
    assert.equal((await api('ideas', input, 'https://example.org')).status, 403);
    const idea = (await (await api('ideas', input)).json()).data;
    assert.deepEqual((await (await api('ideas', input)).json()).data, idea);
    assert.equal((await api('ideas', { ...input, text: 'Changed' })).status, 409);
    const project = { commandId: 'convert', title: 'Short', kind: 'idea', ideaId: idea.id };
    assert.equal((await api('projects', { ...project, ideaId: 'missing' })).status, 404);
    const projectResponse = await api('projects', project);
    assert.equal(projectResponse.status, 200);
    const savedProject = (await projectResponse.json()).data;
    const imageJobs = 'projects/' + savedProject.id + '/image-jobs';
    assert.deepEqual((await (await api(imageJobs)).json()).data, []);
    const noConnection = await api(imageJobs, { commandId: 'image-unconnected', storyVersion: 1,
      shotId: '12a45678-0000-0000-0000-000000000001', frame: 'start' });
    assert.equal(noConnection.status, 503);
    assert.equal((await noConnection.json()).error.code, 'ARK_NOT_CONFIGURED');
    assert.equal((await api(imageJobs + '/12a45678-0000-0000-0000-000000000001/approve',
      { confirmCharge: true })).status, 404);
    assert.equal((await fetch(host.origin + '/video-agent/' + 'v3/' + imageJobs)).status, 403);
    const media = 'projects/' + savedProject.id + '/assets';
    const sample = join(root, 'sample.mp4');
    execFileSync(process.env.FFMPEG || 'ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:d=1', '-c:v', 'libx264', sample,
    ], { windowsHide: true });
    const video = readFileSync(sample);
    const rejectFile = await api.media(media + '?name=bad.mp4&commandId=bad', { data: Buffer.from('not a video') });
    assert.equal(rejectFile.status, 415);
    const upload = media + '?name=sample.mp4&commandId=sample';
    const uploaded = await api.media(upload, { data: video });
    assert.equal(uploaded.status, 200);
    const asset = (await uploaded.json()).data;
    assert.equal(asset.durationUs, 1000000);
    assert.deepEqual((await (await api.media(upload, { data: video })).json()).data, asset);
    assert.equal((await api.media(media + '?name=other.mp4&commandId=sample', { data: video })).status, 409);
    const content = media + '/' + asset.id + '/content';
    assert.equal((await api.media(content, { cookie: false })).status, 403);
    const partial = await api.media(content, { range: 'bytes=0-15' });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 0-15/' + video.length);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), video.subarray(0, 16));
    assert.equal((await api.media(content, { range: 'bytes=99999999-' })).status, 416);
    const otherProject = (await (await api('projects', { commandId: 'other', title: 'Other', kind: 'footage' })).json()).data;
    assert.equal((await api.media(content.replace(savedProject.id, otherProject.id))).status, 404);
    const uploadedSecond = await api.media(media + '?name=second.mp4&commandId=second', { data: video });
    assert.equal(uploadedSecond.status, 200);
    const second = (await uploadedSecond.json()).data;
    const arrangement = 'projects/' + savedProject.id + '/arrangement';
    const plan = 'projects/' + savedProject.id + '/handoff-plan/';
    const clips = [
      { assetId: second.id, inUs: 0, outUs: 400000 },
      { assetId: asset.id, inUs: 600000, outUs: 900000 },
      { assetId: asset.id, inUs: 0, outUs: 200000 },
    ];
    const subtitle = { mode: 'source', assetId: asset.id, text: '1\n00:00:00,100 --> 00:00:00,800\nA subtitle\n' };
    assert.equal((await api(plan + '1')).status, 404);
    assert.equal((await api(arrangement + '/preview', { clips: [...clips, clips[2]] })).status, 422);
    assert.equal((await api(arrangement + '/preview', { clips, subtitle: { ...subtitle, text: 'bad' } })).status, 422);
    assert.equal((await api(arrangement + '/preview', { clips: [{ ...clips[0], assetId: otherProject.id }] })).status, 422);
    const preview = (await (await api(arrangement + '/preview', { clips, subtitle })).json()).data;
    assert.equal(preview.durationUs, 900000);
    assert.deepEqual(preview.captions.map(c => [c.startUs, c.endUs]), [[400000, 600000], [800000, 900000]]);
    assert.equal((await (await api(arrangement)).json()).data, null);
    const confirm = { commandId: 'confirm-arrangement', expectedVersion: 0, clips, subtitle };
    const first = (await (await api(arrangement, confirm)).json()).data;
    assert.equal(first.version, 1);
    assert.deepEqual((await (await api(arrangement, confirm)).json()).data, first);
    assert.equal((await api(arrangement, { ...confirm, commandId: 'stale-arrangement' })).status, 409);
    const manifest = (await (await api(plan + '1')).json()).data;
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.plan.tracks[0].clips.length, 3);
    assert.equal(manifest.plan.tracks[1].clips.length, 2);
    assert.ok(manifest.files.every(file => /^media\//.test(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)));
    const next = (await (await api(arrangement, {
      ...confirm, commandId: 'new-arrangement', expectedVersion: 1, clips: clips.slice().reverse(),
    })).json()).data;
    assert.equal(next.version, 2);
    assert.deepEqual((await (await api(plan + '1')).json()).data, manifest);
    const prefix = 'projects/' + savedProject.id + '/';
    assert.equal((await api(prefix + 'drafts', { commandId: 'prepare-draft', version: 2 })).status, 503);
    if (process.platform === 'win32') {
      const pack = await api.media(prefix + 'handoff-pack/1');
      assert.equal(pack.status, 200);
      assert.equal(pack.headers.get('content-type'), 'application/zip');
      const zip = join(root, 'pack.zip');
      writeFileSync(zip, Buffer.from(await pack.arrayBuffer()));
      const listing = execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-tf', zip], { encoding: 'utf8' });
      for (const file of ['manifest.json', 'plan.json', 'captions.srt', ...manifest.files.map(file => file.path)]) {
        assert.ok(listing.split(/\r?\n/).includes(file), file);
      }
    }
    const archive = prefix + 'finals?version=1&name=first.mp4&commandId=archive-first';
    const firstFinal = (await (await api.media(archive, { data: video })).json()).data;
    assert.deepEqual((await (await api.media(archive, { data: video })).json()).data, firstFinal);
    const finalResponse = await api.media(prefix + 'finals?version=2&name=second.mp4&commandId=archive-second', { data: video });
    assert.equal(finalResponse.status, 200);
    const secondFinal = (await finalResponse.json()).data;
    assert.equal((await (await api(prefix + 'delivery')).json()).data.selectedFinalId, firstFinal.id);
    assert.equal((await api(prefix + 'finals/' + secondFinal.id + '/primary', { commandId: 'select-final' })).status, 200);
    assert.equal((await api.media(prefix + 'finals/' + secondFinal.id + '/content', { range: 'bytes=0-15' })).status, 206);
    assert.equal((await api('projects/' + otherProject.id + '/finals/' + secondFinal.id + '/primary',
      { commandId: 'cross-project-final' })).status, 404);
    const previewMethod = await api.media('skills/preview/text', { data: Buffer.from(
      '---\nname: opening-check\ndescription: Opening checklist.\n---\nKeep the product visible.\n') });
    assert.equal(previewMethod.status, 200);
    const skill = (await previewMethod.json()).data;
    assert.equal((await api('skills/install', { id: skill.id })).status, 200);
    const skillDownload = 'skills/' + skill.hash + '/download';
    assert.equal((await api.media(skillDownload, { cookie: false })).status, 403);
    const zipMethod = await api.media(skillDownload);
    assert.equal(zipMethod.status, 200);
    assert.match(zipMethod.headers.get('content-disposition'), /opening-check\.zip/);
    assert.equal(Buffer.from(await zipMethod.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await api(prefix + 'method', { hash: skill.hash })).status, 200);
    const frameFile = join(root, 'frame.png');
    execFileSync(process.env.FFMPEG || 'ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90', '-frames:v', '1', '-update', '1', frameFile,
    ], { windowsHide: true });
    const picture = await api.media(prefix + 'images?name=frame.png&commandId=frame-one', { data: readFileSync(frameFile) });
    assert.equal(picture.status, 200);
    const image = (await picture.json()).data;
    assert.equal(image.width, 160);
    const imageRoute = prefix + 'images/' + image.id + '/content';
    const imageReply = await api.media(imageRoute);
    assert.equal(imageReply.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imageReply.arrayBuffer()), readFileSync(frameFile));
    assert.equal((await api.media(imageRoute.replace(savedProject.id, otherProject.id))).status, 404);
    const story = prefix + 'story';
    assert.equal((await (await api(story)).json()).data, null);
    const shot = { id: '12345678-0000-0000-0000-000000000001', action: 'Open with product close-up',
      durationUs: 750000, startFrameIdea: 'Product on table', endFrameIdea: 'Product fills frame', assetId: asset.id,
      startImageId: image.id };
    const creative = { commandId: 'story', expectedVersion: 0, brief: 'Product introduction',
      ratio: '9:16', durationUs: 1500000, shots: [shot] };
    assert.equal((await api(story, { ...creative, shots: [{ ...shot, durationUs: 1300000 }] })).status, 422);
    const storyResponse = await api(story, creative);
    assert.equal(storyResponse.status, 200);
    const savedStory = (await storyResponse.json()).data;
    assert.equal((await (await api(prefix + 'production')).json()).data.shotCount, 1);
    assert.equal((await fetch(host.origin + '/video-agent/v3/' + prefix + 'production')).status, 403);
    assert.equal(savedStory.version, 1);
    assert.deepEqual(savedStory.shots, [shot]);
    assert.equal((await api(story, { ...creative, commandId: 'stale-story' })).status, 409);
    const chats = prefix + 'chats';
    const chat = (await (await api(chats, { commandId: '0abc1234-0000-0000-0000-000000000000' })).json()).data;
    const turns = chats + '/' + chat.id + '/turns';
    const local = await api(turns, { text: '你好', commandId: 'hello' });
    assert.equal(local.status, 200);
    assert.match((await local.json()).data[0].answer, /你好/);
    expectedMethod = 'Keep the product visible.';
    const connected = { text: '请给我两个开场建议', method: 'project', focus: asset.id, commandId: 'model',
      model: { provider: 'sample', id: 'text' } };
    const modelReply = await api(turns, connected);
    assert.equal(modelReply.status, 200);
    const answer = (await modelReply.json()).data.at(-1);
    assert.match(answer.answer, /两个不同的开场/);
    assert.equal(answer.method.state, 'used');
    assert.equal(answer.method.hash, skill.hash);
    assert.equal(modelCalls, 1);
    assert.equal((await api(turns, connected)).status, 200);
    assert.equal(modelCalls, 1);
    assert.equal((await api(turns.replace(savedProject.id, otherProject.id))).status, 404);
    assert.equal((await api(turns.replace('/turns', '/finish'), { text: 'invalid' })).status, 404);
    await host.close();
    host = undefined;
    host = await start(join(root, 'profile-one'));
    const again = await embed(host);
    const snapshot = (await (await again('bootstrap')).json()).data;
    assert.equal(snapshot.ideas.length, 1);
    assert.equal(snapshot.projects.find(p => p.id === savedProject.id).idea_id, idea.id);
    assert.ok(snapshot.cursor >= 12);
    assert.equal((await (await again(prefix + 'method')).json()).data.hash, skill.hash);
    assert.equal((await (await again(prefix + 'images')).json()).data[0].id, image.id);
    assert.deepEqual((await (await again(story)).json()).data, savedStory);
    assert.equal((await (await again(prefix + 'delivery')).json()).data.selectedFinalId, secondFinal.id);
    assert.equal((await (await again(turns)).json()).data.length, 2);
    assert.deepEqual((await (await again(media)).json()).data, [asset, second]);
    assert.equal((await (await again(arrangement)).json()).data.version, 2);
    assert.deepEqual((await (await again(plan + '1')).json()).data, manifest);
    await host.close();
    host = undefined;
    host = await start(join(root, 'profile-two'));
    const isolated = await embed(host);
    assert.deepEqual((await (await isolated('bootstrap')).json()).data, { ideas: [], projects: [], cursor: 0 });
    await host.close();host=await start('@profile');
    const automatic=await embed(host);
    const autoProject=await (await automatic('projects',{commandId:'auto-project',kind:'idea',title:'No path setup'})).json();
    assert.equal(autoProject.data.title,'No path setup');
    assert.ok(readFileSync(join(root,'host-managed-profile','data','cutdirector-v3','cutdirector-v3.sqlite')).length>0);
    writeFileSync(join(pkg, 'unexpected.exe'), '');
    assert.throws(() => verify(pkg), /manifest/);
  } finally {
    await host?.close();
  }
});
