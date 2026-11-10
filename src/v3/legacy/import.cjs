'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { link, mkdir, unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { inspect } = require('../service/media.cjs');
const { problem } = require('../service/store.cjs');

function stamp(us) {
  const ms = Math.round(us / 1000);
  return String(Math.floor(ms / 3600000)).padStart(2, '0') + ':' +
    String(Math.floor(ms / 60000) % 60).padStart(2, '0') + ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0');
}

async function copyMedia(writer, root, projectId, mediaId) {
  const source = writer.file(projectId, mediaId);
  const dir = join(root, 'media');
  await mkdir(dir, { recursive: true });
  const temp = join(dir, randomUUID() + '.partial');
  const hash = createHash('sha256');
  let size = 0;
  try {
    await pipeline(createReadStream(source.path), new Transform({
      transform(bytes, encoding, done) {
        size += bytes.length;
        if (size > 2 * 1024 ** 3) return done(problem('REQUEST_TOO_LARGE', 413));
        hash.update(bytes);
        done(null, bytes);
      },
    }), createWriteStream(temp, { flags: 'wx' }));
    const digest = hash.digest('hex');
    if (digest !== source.digest) throw problem('LEGACY_MEDIA_CHANGED', 409);
    const metadata = await inspect(temp);
    try { await link(temp, join(dir, digest)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = createHash('sha256');
      for await (const bytes of createReadStream(join(dir, digest))) existing.update(bytes);
      if (existing.digest('hex') !== digest) throw problem('LEGACY_MEDIA_CHANGED', 409);
    }
    return { digest, size, ...metadata, name: mediaId + '.mp4', source: 'legacy', legacyAssetId: mediaId };
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('LEGACY_MEDIA_MISSING', 409);
    throw error;
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function createLegacyImport(writer, store, root) {
  const inFlight = new Map();
  async function perform(projectId, input, payload) {
    const previous = store.legacyImports.existing(input.commandId, payload);
    if (previous) return previous;
    const p = writer.read(projectId, input.revision);
    const detail = writer.detail(projectId);
    if (p.tracks.length !== 1 || detail.durationUs > 25 * 60 * 1e6 || !p.clips.length) {
      throw problem('LEGACY_IMPORT_UNSUPPORTED', 422);
    }
    let end = 0;
    for (const clip of writer.ordered(p)) {
      if (clip.startFrame !== end) throw problem('LEGACY_IMPORT_UNSUPPORTED', 422);
      end += clip.outFrame - clip.inFrame;
    }
    const used = [...new Set(detail.clips.map(clip => clip.mediaId))];
    const assets = [];
    for (const id of used) assets.push(await copyMedia(writer, root, projectId, id));
    const cues = writer.projectCaptions(p).map(cue => ({ text: cue.text,
      startUs: writer.microseconds(cue.inFrame, p.outputSpec.fps),
      endUs: writer.microseconds(cue.outFrame, p.outputSpec.fps) }));
    const subtitle = cues.length ? { mode: 'timeline',
      text: cues.map((cue, i) => (i + 1) + '\n' + stamp(cue.startUs) + ' --> ' + stamp(cue.endUs) + '\n' + cue.text + '\n').join('\n') } : null;
    // A human edit during asynchronous media copying invalidates this derivation.
    writer.read(projectId, input.revision);
    return store.legacyImports.commit(input.commandId, payload, { assets, clips: detail.clips, subtitle,
      title: p.name + ' · 制作副本', source: { key: writer.sourceKey(), projectId, revision: p.revision,
        conversationProjectId: projectId, deliveryProjectId: projectId }, skipped: detail.skipped });
  }

  async function run(projectId, input) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input?.commandId || '') ||
        !Number.isSafeInteger(input.revision) || input.revision < 0 || input.confirm !== true) {
      throw problem('LEGACY_IMPORT_APPROVAL', 403);
    }
    const payload = JSON.stringify({ source: writer.sourceKey(), projectId, revision: input.revision });
    const pending = inFlight.get(input.commandId);
    if (pending) {
      if (pending.payload !== payload) throw problem('IDEMPOTENCY_CONFLICT', 409);
      return pending.work;
    }
    const work = perform(projectId, input, payload);
    inFlight.set(input.commandId, { payload, work });
    try { return await work; }
    finally { inFlight.delete(input.commandId); }
  }
  return { run };
}

module.exports = { createLegacyImport };
