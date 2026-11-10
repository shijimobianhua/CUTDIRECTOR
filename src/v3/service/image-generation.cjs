'use strict';

const { randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { mkdir, rename, stat, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { protect } = require('#cutdirector-credentials');
const { createImageArk, failure } = require('./ark.cjs');
const { openCredential, imageDataUrl } = require('./ark-input.cjs');
const { ingest } = require('./media.cjs');

function createImageGeneration(store, root, { ark = createImageArk(), vault = protect, recover = true } = {}) {
  const jobs = store.imageJobs;
  const inFlight = new Set();
  const staging = join(root, 'seedream-staging');
  let closed = false;

  function view(job) {
    const { reference, ...spec } = job.spec;
    return { id: job.id, shotId: job.shot_id, frame: job.frame, storyVersion: job.story_version,
      state: job.state, candidateId: job.candidate_id, error: job.error, createdAt: job.created_at,
      approvedAt: job.approved_at,
      spec: { ...spec, priorUnknown: jobs.unresolved(job.project_id, job.shot_id, job.frame, job.id), reference: reference ? { id: reference.id, name: reference.name } : null } };
  }

  async function keepOutput(job, bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16 * 1024 ** 2) throw failure('IMAGE_RESULT_INVALID', 422);
    await mkdir(staging, { recursive: true });
    const file = join(staging, job.id + '.jpg');
    const temp = join(staging, randomUUID() + '.partial');
    try {
      await writeFile(temp, bytes, { flag: 'wx', flush: true });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return file;
  }

  async function collect(job) {
    const { project_id: projectId, id } = job;
    const file = join(staging, id + '.jpg');
    const previous = jobs.candidate(projectId, id);
    if (previous) {
      const ready = jobs.update(projectId, id, 'ready', null, previous);
      await unlink(file).catch(() => {});
      return ready;
    }
    let exists;
    try { exists = (await stat(file)).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) return jobs.update(projectId, id, 'unknown', 'IMAGE_SUBMIT_UNKNOWN');
    const request = Object.assign(createReadStream(file), { headers: { 'content-type': 'application/octet-stream' } });
    try {
      const asset = await ingest(request, root, store, projectId, 'seedream-' + id,
        'Seedream-' + job.frame + '-' + id.slice(0, 8) + '.jpg', undefined, true, {
          source: 'seedream', imageJobId: id, expectedRatio: job.spec.ratio, visualReview: 'user-required',
        });
      const ready = jobs.update(projectId, id, 'ready', null, asset.id);
      await unlink(file).catch(() => {});
      return ready;
    } catch (error) {
      const invalid = ['INVALID_IMAGE', 'UNSUPPORTED_MEDIA', 'IMAGE_RESULT_ASPECT', 'REQUEST_TOO_LARGE'].includes(error.code);
      return jobs.update(projectId, id, invalid ? 'failed' : 'collecting',
        invalid ? error.code : 'IMAGE_COLLECT_FAILED');
    }
  }

  async function approve(projectId, id, approval, admission = () => {}) {
    const job = jobs.get(projectId, id);
    if (job.state !== 'awaiting_approval') return view(job);
    const { reference } = job.spec;
    if (approval?.confirmCharge !== true || (reference && approval?.confirmUpload !== true)) {
      throw failure('ARK_APPROVAL_REQUIRED', 403);
    }
    const verifyPrior = () => {
      if (jobs.unresolved(projectId, job.shot_id, job.frame, id) && approval?.acknowledgeDuplicate !== true) {
        throw failure('IMAGE_PRIOR_UNKNOWN');
      }
    };
    verifyPrior();
    const [key, ref] = await Promise.all([
      openCredential(store.generation, vault, job.connection_id),
      reference ? imageDataUrl(root, reference) : null,
    ]);
    verifyPrior();
    if(closed)throw failure('ARK_STOPPED',409);
    store.registry.requireEnabled('cutdirector-seedream');
    admission();
    if (!jobs.claim(projectId, id)) return view(jobs.get(projectId, id));
    inFlight.add(id);
    try {
      const bytes = await ark.generate(key, job.spec, ref);
      await keepOutput(job, bytes);
      const collecting = jobs.update(projectId, id, 'collecting');
      return view(await collect(collecting));
    } catch (error) {
      const rejected = ['ARK_REJECTED', 'ARK_CREDENTIAL', 'ARK_NOT_FOUND', 'IMAGE_RESULT_INVALID'].includes(error.code);
      return view(jobs.update(projectId, id, rejected ? 'failed' : 'unknown',
        rejected ? error.code : 'IMAGE_SUBMIT_UNKNOWN'));
    } finally {
      inFlight.delete(id);
    }
  }

  async function check(projectId, id) {
    const job = jobs.get(projectId, id);
    if (!['collecting', 'unknown'].includes(job.state) || inFlight.has(id)) return view(job);
    inFlight.add(id);
    try { return view(await collect(job)); }
    finally { inFlight.delete(id); }
  }

  if (recover) setImmediate(async () => {
    if (closed) return;
    try {
      for (const job of jobs.due()) {
        if (closed) break;
        await check(job.project_id, job.id);
      }
    } catch { /* Pending records remain available for manual recovery. */ }
  });

  return {
    list: id => jobs.list(id).map(view), prepare: (id, input) => view(jobs.prepare(id, input)),
    approve, check,
    stop() { closed = true; },
  };
}

module.exports = { createImageGeneration };
