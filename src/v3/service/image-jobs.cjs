'use strict';

const { randomUUID } = require('node:crypto');
const { failure, imageModel } = require('./ark.cjs');

const dimensions = { '16:9': '2560x1440', '9:16': '1440x2560', '1:1': '2048x2048' };

function createImageJobs(db, project, story, image, ark, skills) {
  db.prepare("UPDATE image_jobs SET state = 'unknown', error = 'IMAGE_SUBMIT_UNKNOWN' WHERE state = 'dispatching'").run();

  function deserialize(row) {
    const { spec, ...rest } = row;
    return { ...rest, spec: JSON.parse(spec) };
  }

  function get(projectId, id) {
    const row = db.prepare('SELECT * FROM image_jobs WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!row) throw failure('IMAGE_JOB_NOT_FOUND', 404);
    return deserialize(row);
  }

  function list(projectId) {
    project(projectId);
    return db.prepare('SELECT * FROM image_jobs WHERE project_id = ? ORDER BY rowid DESC LIMIT 100')
      .all(projectId).map(deserialize);
  }

  function due() {
    return db.prepare("SELECT * FROM image_jobs WHERE state IN ('collecting', 'unknown') ORDER BY rowid DESC LIMIT 100")
      .all().map(deserialize);
  }

  function unresolved(projectId, shotId, frame, exceptId = '') {
    return !!db.prepare(`SELECT 1 FROM image_jobs WHERE project_id = ? AND shot_id = ? AND frame = ?
      AND id <> ? AND state IN ('dispatching', 'unknown') LIMIT 1`).get(projectId, shotId, frame, exceptId);
  }

  function prepare(projectId, input) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input?.commandId || '') ||
        !/^[a-f0-9-]{36}$/.test(input.shotId || '') ||
        !Number.isSafeInteger(input.storyVersion) || input.storyVersion < 1 ||
        !['start', 'end'].includes(input.frame) ||
        (input.referenceId != null && !/^[a-f0-9-]{36}$/.test(input.referenceId)) ||
        (input.method != null && !/^[a-f0-9]{64}$/.test(input.method)) ||
        (input.prompt != null && (typeof input.prompt !== 'string' || input.prompt.length > 1500))) {
      throw failure('IMAGE_INVALID_REQUEST', 400);
    }
    const requested = { projectId, version: input.storyVersion, shot: input.shotId,
      frame: input.frame, reference: input.referenceId || null, prompt: input.prompt?.trim() || '',
      method: input.method || null };
    const payload = JSON.stringify(requested);
    const previous = db.prepare('SELECT * FROM image_jobs WHERE request_id = ?').get(input.commandId);
    if (previous) {
      if (previous.payload !== payload) throw failure('IDEMPOTENCY_CONFLICT');
      return deserialize(previous);
    }

    const connection = ark.active();
    if (!connection) throw failure('ARK_NOT_CONFIGURED', 503);
    const version = story(projectId);
    if (version?.version !== requested.version) throw failure('STORY_CONFLICT');
    const shot = version.shots.find(item => item.id === requested.shot);
    if (!shot) throw failure('SHOT_NOT_FOUND', 404);
    let reference = null;
    if (requested.reference) {
      const source = image(projectId, requested.reference);
      if (source.size > 8 * 1024 ** 2 || source.width < 15 || source.height < 15 ||
          source.width * source.height > 36000000 || source.width / source.height < 1 / 16 || source.width / source.height > 16) throw failure('IMAGE_REFERENCE_LIMIT', 422);
      reference = { id: requested.reference, name: source.name, size: source.size, digest: source.digest, type: source.contentType };
    }
    const method = requested.method ? skills.imageMethod(requested.method) : null;
    const intent = requested.frame === 'start' ? '镜头开始的静帧' : '镜头结束的静帧';
    const idea = requested.frame === 'start' ? shot.startFrameIdea : shot.endFrameIdea;
    const prompt = requested.prompt || [intent, idea || shot.action, version.style].filter(Boolean).join('。').slice(0, 1500);
    const fullPrompt = method ? prompt + '\n画面制作要求：' + method.body : prompt;
    const spec = { model: imageModel, size: dimensions[version.ratio], ratio: version.ratio, prompt: fullPrompt,
      reference, method: method && { hash: method.hash, name: method.name },
      priorUnknown: unresolved(projectId, requested.shot, requested.frame) };
    const id = randomUUID();
    db.prepare(`INSERT INTO image_jobs(id, project_id, shot_id, frame, story_version, request_id, payload,
      connection_id, spec, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', ?)`)
      .run(id, projectId, requested.shot, requested.frame, requested.version, input.commandId, payload,
        connection.id, JSON.stringify(spec), new Date().toISOString());
    return get(projectId, id);
  }

  function claim(projectId, id) {
    const job = get(projectId, id);
    if (job.state !== 'awaiting_approval') return false;
    if (ark.active()?.id !== job.connection_id) throw failure('ARK_CONNECTION_CHANGED');
    if (story(projectId)?.version !== job.story_version) throw failure('STORY_CONFLICT');
    if (job.spec.method) skills.imageMethod(job.spec.method.hash);
    return !!db.prepare("UPDATE image_jobs SET state = 'dispatching', approved_at = ? WHERE id = ? AND state = 'awaiting_approval'")
      .run(new Date().toISOString(), id).changes;
  }

  function update(projectId, id, state, error = null, candidate = null) {
    get(projectId, id);
    db.prepare('UPDATE image_jobs SET state = ?, error = ?, candidate_id = ? WHERE id = ? AND project_id = ?')
      .run(state, error, candidate, id, projectId);
    return get(projectId, id);
  }

  function candidate(projectId, id) {
    return db.prepare(`SELECT id FROM images WHERE project_id = ? AND json_extract(metadata, '$.imageJobId') = ? LIMIT 1`)
      .get(projectId, id)?.id || null;
  }

  return { get, list, due, unresolved, prepare, claim, update, candidate };
}

module.exports = { createImageJobs };
