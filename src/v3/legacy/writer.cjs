'use strict';

const fs = require('node:fs');
const { isAbsolute, join, relative, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { ProjectStore } = require('#cutdirector-legacy/core/store.cjs');
const { Jobs } = require('#cutdirector-legacy/core/jobs.cjs');
const { projectCaptions } = require('#cutdirector-legacy/core/captions.cjs');
const { microseconds } = require('#cutdirector-legacy/core/time.cjs');
const { createConversations } = require('#cutdirector-legacy/agent/conversations.cjs');
const { problem } = require('../service/store.cjs');

const projectPattern = /^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function createLegacyWriter(root, currentRoot) {
  let store;
  let jobs;
  let conversations;
  let closed = false;
  const configured = typeof root === 'string' && isAbsolute(root);

  function ensure() {
    if (closed) throw problem('LEGACY_CLOSED', 503);
    if (!configured) throw problem('LEGACY_NOT_CONFIGURED', 503);
    if (store) return store;
    let target;
    try {
      if (!fs.statSync(root).isDirectory()) throw new Error('Missing directory');
      target = fs.realpathSync(root);
    } catch { throw problem('LEGACY_UNAVAILABLE', 503); }
    const current = fs.realpathSync(currentRoot);
    const overlaps = (a, b) => { const rel = relative(a, b); return !rel || (!rel.startsWith('..') && !isAbsolute(rel)); };
    if (overlaps(target, current) || overlaps(current, target)) throw problem('LEGACY_ROOT_CONFLICT', 503);
    try { store = new ProjectStore(target, { recoverStale: true }); }
    catch (error) {
      if (error.code === 'WRITER_LOCKED') throw problem('LEGACY_WRITER_BUSY', 409);
      throw error;
    }
    return store;
  }

  function read(id, revision) {
    if (!projectPattern.test(id)) throw problem('LEGACY_PROJECT_NOT_FOUND', 404);
    try {
      const value = ensure().read(id);
      if (revision != null && value.revision !== revision) throw problem('LEGACY_REVISION_CONFLICT', 409);
      return value;
    } catch (error) {
      if (error.code === 'NOT_FOUND') throw problem('LEGACY_PROJECT_NOT_FOUND', 404);
      throw error;
    }
  }

  function sourceKey() {
    return createHash('sha256').update(ensure().root).digest('hex');
  }

  function file(id, assetId) {
    const media = read(id).media.find(item => item.id === assetId);
    if (!media) throw problem('LEGACY_MEDIA_MISSING', 404);
    const value = media.workingMedia || media;
    if (typeof value.path !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash || '')) {
      throw problem('LEGACY_MEDIA_MISSING', 404);
    }
    return { path: resolve(value.path), digest: value.hash, id: media.id };
  }

  function ordered(project) {
    return project.tracks.flatMap(track => track.segmentIds.map(id => project.clips.find(clip => clip.id === id)));
  }

  function detail(id) {
    const p = read(id);
    const fps = p.outputSpec.fps;
    const clips = ordered(p).map(clip => ({ id: clip.id, mediaId: clip.mediaId, track: clip.track,
      inFrame: clip.inFrame, outFrame: clip.outFrame, inUs: microseconds(clip.inFrame, fps),
      outUs: microseconds(clip.outFrame, fps), startUs: microseconds(clip.startFrame, fps) }));
    return {
      projectId: p.projectId, sourceKey: sourceKey(), name: p.name, revision: p.revision, fps, tracks: p.tracks,
      clips, captions: p.captions.map(item => ({ id: item.id, text: item.text })),
      media: p.media.map(item => ({ id: item.id, name: item.name || item.id,
        available: fs.existsSync(item.workingMedia?.path || item.path) })),
      history: ensure().history(id).map(item => ({ revision: item.revision,
        op: item.command?.op || 'project.create', actor: item.actor || item.command?.actor || 'human' })),
      durationUs: clips.reduce((end, clip) => Math.max(end, clip.startUs + clip.outUs - clip.inUs), 0),
      skipped: ['旧会话和反馈继续保存在旧工程', '旧工程渲染和历史版本继续保存在兼容区',
        '新工程使用微秒时间，片段边界会按原帧率换算'],
    };
  }

  function list() {
    if (!configured) return { configured: false, projects: [] };
    return { configured: true, sourceKey: sourceKey(), projects: ensure().list() };
  }

  function command(id, input) {
    read(id);
    if (!input || Object.keys(input).some(key => !['baseRevision', 'commandId', 'op', 'target', 'params'].includes(key)) ||
        !['segment.trim', 'segment.reorder', 'caption.correct', 'revision.restore'].includes(input.op)) {
      throw problem('LEGACY_COMMAND_DENIED', 403);
    }
    try {
      return ensure().apply({ ...input, projectId: id, actor: 'human' });
    } catch (error) {
      const status = ['REVISION_CONFLICT', 'COMMAND_ID_CONFLICT'].includes(error.code) ? 409 : 422;
      throw problem(error.code || 'LEGACY_COMMAND_FAILED', status);
    }
  }

  function scheduler() {
    ensure();
    jobs ||= new Jobs(join(store.root, 'renders'), store);
    return jobs;
  }

  function job(id, jobId) {
    read(id);
    const value = scheduler().read(jobId);
    if (value.projectId !== id) throw problem('LEGACY_JOB_NOT_FOUND', 404);
    return value;
  }

  function jobView(value) {
    return { id: value.id, revision: value.revision, state: value.status, type: value.manifest.type,
      error: value.error?.code || null,
      artifacts: value.artifacts.map(item => ({ name: item.name, hash: item.hash })) };
  }

  function deliveries(id) {
    read(id);
    return scheduler().jobs.filter(item => item.projectId === id).map(jobView).reverse();
  }

  function render(id, input) {
    if (!['preview', 'export'].includes(input?.type)) throw problem('INVALID_INPUT', 400);
    read(id);
    try { return jobView(scheduler().start({ projectId: id, revision: input.revision, requestId: input.requestId, type: input.type })); }
    catch (error) { throw problem(error.code || 'LEGACY_RENDER_FAILED', 409); }
  }

  function jobAction(id, jobId, action) {
    job(id, jobId);
    return jobView(action === 'cancel' ? scheduler().cancel(jobId) : scheduler().retry(jobId));
  }

  function artifact(id, jobId, name) {
    job(id, jobId);
    const item = scheduler().artifact(jobId, name);
    return { path: item.path, digest: item.hash, contentType: name.endsWith('.mp4') ? 'video/mp4'
      : name.endsWith('.srt') ? 'text/plain; charset=utf-8' : 'application/json' };
  }

  function chats(id, chatId, before) {
    read(id);
    conversations ||= createConversations(store, join(store.root, '_agent'), runId => {
      if (!uuidPattern.test(runId)) throw problem('NOT_FOUND', 404);
      const file = join(store.root, '_agent', 'runs', runId + '.json');
      let run;
      try {
        if (fs.statSync(file).size > 2 * 1024 ** 2) throw new Error('Large record');
        run = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch { throw problem('NOT_FOUND', 404); }
      return { id: run.id, projectId: run.projectId, conversationId: run.conversationId,
        request: String(run.request || '').slice(0, 12000),
        reply: String(run.reply || run.proposal?.text || '').slice(0, 16000), createdAt: run.createdAt };
    });
    if (!chatId) return conversations.list(id);
    if (chatId !== 'legacy' && !uuidPattern.test(chatId)) throw problem('INVALID_INPUT', 400);
    return conversations.detail(id, chatId, before || null);
  }

  async function close() {
    closed = true;
    if (jobs) {
      for (const id of jobs.controllers.keys()) jobs.cancel(id);
      await Promise.allSettled([...jobs.pending.values()]);
    }
    store?.close();
  }

  return { list, read, detail, command, file, sourceKey, ordered, projectCaptions, microseconds,
    deliveries, render, jobAction, artifact, chats, close };
}

module.exports = { createLegacyWriter };
