'use strict';

const { Readable } = require('node:stream');
const { protect } = require('#cutdirector-credentials');
const { createArk, failure } = require('./ark.cjs');
const { ingest } = require('./media.cjs');
const { openCredential, imageDataUrl } = require('./ark-input.cjs');

const remoteStates = new Set(['queued', 'running', 'collecting', 'collect_failed']);

function createGeneration(store, root, { ark = createArk(), vault = protect, auto = true } = {}) {
  const repo = store.generation;
  const checking = new Set();
  let closed = false;
  let ticking = false;

  function view(job) {
    const { frames, ...spec } = job.spec;
    return { id: job.id, projectId: job.project_id, shotId: job.shot_id, storyVersion: job.story_version,
      state: job.state, remoteId: job.remote_id, candidateId: job.candidate_id, createdAt: job.created_at,
      approvedAt: job.approved_at, paused: !!job.paused, error: job.error,
      spec: { ...spec, frames: frames.map(({ id, name, role, width, height }) => ({ id, name, role, width, height })) } };
  }

  async function credential(id) {
    return openCredential(repo, vault, id);
  }

  async function save(input) {
    const key = input?.key;
    if (typeof key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(key)) throw failure('ARK_INVALID_KEY', 400);
    await ark.probe(key);
    let sealed;
    try { sealed = await vault('seal', key); }
    catch { throw failure('ARK_CREDENTIAL_STORE', 503); }
    return repo.saveConnection(sealed);
  }

  async function approvedFrames(job) {
    return Promise.all(job.spec.frames.map(async frame => ({
      role: frame.role, dataUrl: await imageDataUrl(root, frame),
    })));
  }

  async function approve(projectId, id, approval, admission = () => {}) {
    const job = repo.get(projectId, id);
    if (job.state !== 'awaiting_approval') return view(job);
    if (approval?.confirmCharge !== true || (job.spec.frames.length && approval?.confirmUpload !== true)) {
      throw failure('ARK_APPROVAL_REQUIRED', 403);
    }
    if (repo.unresolved(projectId, job.shot_id, id) && approval?.acknowledgeDuplicate !== true) {
      throw failure('ARK_PRIOR_UNKNOWN', 409);
    }
    const [key, frames] = await Promise.all([credential(job.connection_id), approvedFrames(job)]);
    if (repo.unresolved(projectId, job.shot_id, id) && approval?.acknowledgeDuplicate !== true) {
      throw failure('ARK_PRIOR_UNKNOWN', 409);
    }
    if(closed)throw failure('ARK_STOPPED',409);
    store.registry.requireEnabled('cutdirector-seedance');
    admission();
    if (!repo.claim(projectId, id)) return view(repo.get(projectId, id));
    try {
      const remoteId = await ark.submit(key, job.spec, frames);
      return view(repo.update(projectId, id, { state: 'queued', remote_id: remoteId, error: null, next_poll: Date.now() + 8000 }));
    } catch (error) {
      const knownRejected = ['ARK_CREDENTIAL', 'ARK_REJECTED', 'ARK_NOT_FOUND'].includes(error.code);
      return view(repo.update(projectId, id, {
        state: knownRejected ? 'failed' : 'unknown',
        error: knownRejected ? error.code : 'ARK_SUBMIT_UNKNOWN',
      }));
    }
  }

  async function check(projectId, id) {
    let job = repo.get(projectId, id);
    if (!job.remote_id || !remoteStates.has(job.state) || checking.has(id)) return view(job);
    checking.add(id);
    try {
      const recovered = repo.candidate(projectId, id);
      if (recovered) return view(repo.update(projectId, id, { state: 'ready', candidate_id: recovered, error: null }));
      const key = await credential(job.connection_id);
      const result = await ark.poll(key, job.remote_id);
      if (closed) return view(job);
      if (result.state !== 'succeeded') {
        const error = ['failed', 'cancelled', 'expired'].includes(result.state) ? 'ARK_JOB_' + result.state.toUpperCase() : null;
        return view(repo.update(projectId, id, { state: result.state, error, next_poll: Date.now() + 10000 }));
      }
      job = repo.update(projectId, id, { state: 'collecting', error: null, next_poll: Date.now() + 20000 });
      if (!result.videoUrl) throw failure('ARK_OUTPUT_MISSING', 502);
      const body = await ark.download(result.videoUrl);
      const stream = Object.assign(Readable.fromWeb(body), { headers: { 'content-type': 'application/octet-stream' } });
      const candidate = await ingest(stream, root, store, projectId, 'seedance-' + id,
        'Seedance-' + id.slice(0, 8) + '.mp4', undefined, false, { generationId: id, source: 'seedance' });
      return view(repo.update(projectId, id, { state: 'ready', candidate_id: candidate.id, error: null }));
    } catch (error) {
      if (closed) return view(job);
      const code = error.status ? error.code : 'ARK_DOWNLOAD_FAILED';
      const collecting = ['collecting', 'collect_failed'].includes(job.state);
      const pause = collecting || ['ARK_CREDENTIAL', 'ARK_CREDENTIAL_STORE', 'ARK_NOT_FOUND'].includes(code);
      return view(repo.update(projectId, id, {
        state: collecting ? 'collect_failed' : job.state,
        error: code, paused: pause ? 1 : job.paused,
        next_poll: Date.now() + 30000,
      }));
    } finally {
      checking.delete(id);
    }
  }

  async function tick() {
    if (closed || ticking) return;
    ticking = true;
    try {
      const jobs = repo.due(Date.now());
      await Promise.allSettled(jobs.map(job => check(job.project_id, job.id)));
    } finally {
      ticking = false;
    }
  }
  const timer = auto ? setInterval(() => { tick().catch(() => {}); }, 4500) : null;
  timer?.unref();

  function pause(projectId, id, paused) {
    const job = repo.get(projectId, id);
    if (!remoteStates.has(job.state)) return view(job);
    return view(repo.update(projectId, id, { paused: paused ? 1 : 0, ...(!paused ? { next_poll: Date.now() } : {}) }));
  }

  return {
    config: repo.config, save, disable: repo.disableConnection,
    list: id => repo.list(id).map(view), prepare: (id, body) => view(repo.prepare(id, body)),
    approve, check, pause,
    stop() { closed = true; if (timer) clearInterval(timer); },
  };
}

module.exports = { createGeneration };
