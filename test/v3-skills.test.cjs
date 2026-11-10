'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const yazl = require('yazl');
const { openStore } = require('../src/v3/service/store.cjs');

const main = '---\nname: opening-plan\ndescription: >\n  Prepare a video opening.\nlicense: MIT\n---\nChoose one opening.\n';

async function zip(entries) {
  const file = new yazl.ZipFile();
  for (const [name, data, mode] of entries) file.addBuffer(Buffer.from(data), name, { mode: mode || 0o100644 });
  file.end();
  const parts = [];
  for await (const part of file.outputStream) parts.push(part);
  return Buffer.concat(parts);
}

test('Skills preview, ZIP exchange, version activation and scoped routing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-skill-'));
  const first = openStore(join(root, 'first'));
  const second = openStore(join(root, 'second'));
  t.after(() => { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); });
  const manifest = JSON.stringify({ schemaVersion: 1, version: '1.0.0', stages: ['storyboard'],
    roles: ['planner'], capabilities: ['text-advice'], references: ['references/tips.md'] });
  const pack = await zip([
    ['opening-plan/SKILL.md', main], ['opening-plan/cutdirector.skill.json', manifest],
    ['opening-plan/references/tips.md', 'Keep the first line short.'],
    ['opening-plan/references/source.md', 'Public reference https://agentskills.io/specification'],
    ['opening-plan/scripts/ignored.ps1', 'Write-Host never'],
  ]);
  const result = await first.skills.preview('zip', pack);
  assert.equal(first.skills.list().length, 0);
  assert.equal(result.description, 'Prepare a video opening.');
  assert.equal(result.bodyPreview, 'Choose one opening.');
  assert.deepEqual(result.ignored, ['scripts/ignored.ps1']);
  const installed = first.skills.install(result.id);
  assert.equal(installed.enabled, true);
  assert.equal(first.skills.install(result.id).hash, installed.hash);
  const profileProject = first.mutate('project', { commandId: 'p', title: 'Sample', kind: 'idea' });
  const project = profileProject.id;
  first.skills.preference(project, installed.hash);
  assert.equal(first.skills.route(project, 'project', 'brief', true).state, 'stage-mismatch');
  assert.equal(first.skills.route(project, 'project', 'storyboard', false).state, 'model-required');
  const routed = first.skills.route(project, 'project', 'storyboard', true);
  assert.equal(routed.state, 'matched');
  assert.equal(routed.role, 'planner');
  assert.equal(routed.method.references[0].text, 'Keep the first line short.');
  const saved = await first.skills.exportZip(installed.hash);
  const received = await second.skills.preview('zip', Buffer.from(saved.bytes, 'base64'));
  assert.equal(received.hash, installed.hash);
  assert.equal(received.ignored.length, 0);
  assert.equal(second.skills.install(received.id).hash, installed.hash);

  const next = await first.skills.preview('text', Buffer.from(main.replace('one opening', 'two openings')));
  assert.equal(next.previousVersions.length, 1);
  const versionTwo = first.skills.install(next.id);
  assert.notEqual(versionTwo.hash, installed.hash);
  assert.equal(first.skills.route(project, 'project', 'storyboard', true).state, 'disabled');
  first.skills.activate(installed.hash, true);
  assert.equal(first.skills.route(project, 'project', 'storyboard', true).hash, installed.hash);
  first.skills.activate(installed.hash, false);
  assert.equal(first.skills.route(project, 'project', 'storyboard', true).state, 'disabled');

  const video = await first.skills.preview('folder', Buffer.from(JSON.stringify([
    { path: 'opening-plan/SKILL.md', text: main },
    { path: 'opening-plan/cutdirector.skill.json', text: JSON.stringify({
      schemaVersion: 1, stages: ['generation'], roles: ['video'], requestedPermissions: ['paid-api'],
    }) },
  ])));
  first.skills.install(video.id);
  const routedVideo=first.skills.route(project,video.hash,'generation',true);
  assert.equal(routedVideo.state,'confirmation-required');
  assert.equal(routedVideo.executor,'seedance');
  assert.equal(routedVideo.permissions,undefined);
  assert.equal(first.generation.list(project).length,0);
});

test('Skills reject unsafe packs and exclude suspected local secrets', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cutdirector-bad-skill-'));
  const store = openStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const folder = value => store.skills.preview('folder', Buffer.from(JSON.stringify(value)));
  await assert.rejects(folder([{ path: '../SKILL.md', text: main }]), { code: 'SKILL_UNSAFE_PATH' });
  await assert.rejects(folder([{ path: 'SKILL.md', text: main }, { path: 'a.ZIP' }]), { code: 'SKILL_NESTED_ARCHIVE' });
  await assert.rejects(folder([{ path: 'SKILL.md', text: main }, { path: 'skill.md', text: main }]), { code: 'SKILL_DUPLICATE_PATH' });
  await assert.rejects(store.skills.preview('text', Buffer.from('---\nname: &x opening-plan\ndescription: *x\n---\n')), { code: 'SKILL_BAD_FRONTMATTER' });
  const link = await zip([['SKILL.md', main], ['linked.md', 'target', 0o120777]]);
  await assert.rejects(store.skills.preview('zip', link), { code: 'SKILL_UNSAFE_ENTRY' });
  const secret = await store.skills.preview('text', Buffer.from(main + 'Local test path C:\\Users\\someone\\thing.'));
  assert.deepEqual(secret.sensitive, ['SKILL.md']);
  const item = store.skills.install(secret.id);
  await assert.rejects(store.skills.exportZip(item.hash), { code: 'SKILL_EXPORT_PRIVATE' });
});
