'use strict';

const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { copyFile, mkdir, mkdtemp, rm, stat, writeFile } = require('node:fs/promises');
const { isAbsolute, join } = require('node:path');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const run = promisify(execFile);

function issue(code, status = 409) {
  return Object.assign(new Error(code), { code, status });
}

async function inputs(work, root, manifest) {
  await mkdir(join(work, 'media'), { recursive: true });
  for (const file of manifest.files) {
    const source = join(root, 'media', file.sha256);
    const target = join(work, file.path);
    try {
      await copyFile(source, target);
    } catch (error) {
      if (error.code === 'ENOENT') throw issue('HANDOFF_MEDIA_CHANGED');
      throw error;
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest('hex') !== file.sha256) throw issue('HANDOFF_MEDIA_CHANGED');
  }
}

function renderSrt(cues) {
  const time = value => {
    const ms = Math.floor(value / 1000);
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor(ms / 60000) % 60;
    const seconds = Math.floor(ms / 1000) % 60;
    return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
  };
  return cues.filter(cue => Math.floor(cue.startUs / 1000) < Math.floor(cue.endUs / 1000))
    .map((cue, i) => (i + 1) + '\r\n' + time(cue.startUs) + ' --> ' + time(cue.endUs) + '\r\n' + cue.text).join('\r\n\r\n') + '\r\n';
}

async function servePack(root, store, projectId, version, res) {
  const manifest = store.handoff(projectId, version);
  const work = await mkdtemp(join(root, 'pack-'));
  try {
    await inputs(work, root, manifest);
    await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await writeFile(join(work, 'plan.json'), JSON.stringify(manifest.plan, null, 2), 'utf8');
    const arrangement = store.arrangement(projectId, version);
    const files = ['manifest.json', 'plan.json', 'media'];
    if (arrangement.captions.length) {
      await writeFile(join(work, 'captions.srt'), renderSrt(arrangement.captions), 'utf8');
      files.push('captions.srt');
    }
    const archive = join(work, 'handoff.zip');
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'bsdtar';
    try {
      await run(tar, ['-a', '-cf', archive, ...files], { cwd: work, windowsHide: true, timeout: 240000 });
    } catch {
      throw issue('PACK_RUNTIME_UNAVAILABLE', 503);
    }
    const { size } = await stat(archive);
    res.writeHead(200, {
      'Content-Type': 'application/zip', 'Content-Length': size,
      'Content-Disposition': 'attachment; filename="CUTDIRECTOR-v' + version + '.zip"',
      'Cache-Control': 'no-store',
    });
    await pipeline(createReadStream(archive), res);
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

function createDraftAdapter(root, config) {
  const enabled = ['python', 'editor', 'draftRoot', 'jyr', 'ffprobe'].every(key =>
    typeof config?.[key] === 'string' && isAbsolute(config[key]));
  let active;

  async function call(operation, job) {
    if (!enabled) throw issue('DRAFT_RUNTIME_UNAVAILABLE', 503);
    const work = await mkdtemp(join(root, 'draft-'));
    let preserve = false;
    try {
      if (operation === 'write') {
        preserve = true;
        await inputs(join(work, 'inputs'), root, job.manifest);
      }
      const request = join(work, 'request.json');
      await writeFile(request, JSON.stringify({ config, job: job && { ...job, work } }), 'utf8');
      let result;
      try {
        const { stdout } = await run(config.python, [join(__dirname, 'jianying.py'), operation, request], {
          windowsHide: true, timeout: operation === 'write' ? 230000 : 20000, maxBuffer: 128 * 1024,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
        });
        result = JSON.parse(stdout);
      } catch {
        throw issue('DRAFT_TOOL_FAILED', 503);
      }
      if (result.error) throw issue(result.error);
      return result.data;
    } finally {
      if (preserve) {
        // Keep the small backup and request for reconciliation. The registered draft owns its media.
        for (const folder of ['inputs', 'built', 'registration']) {
          await rm(join(work, folder), { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
        }
      } else {
        await rm(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      }
    }
  }

  return {
    probe: () => call('probe'),
    isActive: id => active === id,
    status: job => call('status', { id: job.id, name: job.name, target: job.target, editorVersion: job.editor_version }),
    async write(job, manifest) {
      if (active) throw issue('DRAFT_WRITER_BUSY');
      active = job.id;
      try {
        return await call('write', { id: job.id, name: job.name, target: job.target, editorVersion: job.editor_version, manifest });
      } finally {
        active = undefined;
      }
    },
  };
}

module.exports = { createDraftAdapter, servePack };
