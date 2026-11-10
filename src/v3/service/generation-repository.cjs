'use strict';

const { randomUUID } = require('node:crypto');
const { failure, model, imageModel } = require('./ark.cjs');

function createGenerationRepository(db, project, story, image, skills) {
  // A submission without its remote receipt must never be automatically sent again.
  db.prepare("UPDATE generation_jobs SET state = 'unknown', error = 'ARK_SUBMIT_UNKNOWN' WHERE state = 'dispatching'").run();

  function active() {
    return db.prepare('SELECT * FROM ark_connections WHERE active = 1 LIMIT 1').get();
  }

  function config() {
    const value = active();
    const imageGeneratedOnce = value && !!db.prepare("SELECT 1 FROM image_jobs WHERE connection_id = ? AND state = 'ready' LIMIT 1").get(value.id);
    return { configured: !!value, model, imageModel, testedAt: value?.tested_at || null,
      generatedOnce: !!value?.generated, imageGeneratedOnce: !!imageGeneratedOnce };
  }

  function connection(id) {
    const value = db.prepare('SELECT * FROM ark_connections WHERE id = ?').get(id);
    if (!value) throw failure('ARK_NOT_CONFIGURED', 503);
    return value;
  }

  function saveConnection(sealed) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE ark_connections SET active = 0 WHERE active = 1').run();
      db.prepare('INSERT INTO ark_connections VALUES (?, ?, ?, 1, 0)')
        .run(randomUUID(), sealed, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return config();
  }

  function disableConnection() {
    db.prepare('UPDATE ark_connections SET active = 0 WHERE active = 1').run();
    return config();
  }

  function deserialize(row) {
    const { spec, ...rest } = row;
    return { ...rest, spec: JSON.parse(spec) };
  }

  function get(projectId, id) {
    const value = db.prepare('SELECT * FROM generation_jobs WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!value) throw failure('GENERATION_NOT_FOUND', 404);
    return deserialize(value);
  }

  function list(projectId) {
    project(projectId);
    return db.prepare('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY rowid DESC LIMIT 100')
      .all(projectId).map(deserialize);
  }

  function due(now) {
    return db.prepare(`SELECT * FROM generation_jobs
      WHERE state IN ('queued', 'running', 'collecting', 'collect_failed') AND paused = 0 AND next_poll <= ?
      ORDER BY next_poll, rowid LIMIT 2`).all(now).map(deserialize);
  }

  function unresolved(projectId, shotId, exceptId = '') {
    return !!db.prepare(`SELECT 1 FROM generation_jobs WHERE project_id = ? AND shot_id = ? AND id <> ?
      AND state IN ('dispatching', 'unknown') LIMIT 1`).get(projectId, shotId, exceptId);
  }

  function prepare(projectId, input) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input?.commandId || '') ||
        !/^[a-f0-9-]{36}$/.test(input.shotId || '') ||
        !Number.isSafeInteger(input.storyVersion) || input.storyVersion < 1 ||
        !Number.isSafeInteger(input.seconds) || input.seconds < 4 || input.seconds > 30 ||
        (input.method != null && !/^[a-f0-9]{64}$/.test(input.method)) ||
        (input.prompt != null && (typeof input.prompt !== 'string' || input.prompt.length > 2000))) {
      throw failure('ARK_INVALID_REQUEST', 400);
    }
    const payload = JSON.stringify({ projectId, storyVersion: input.storyVersion, shotId: input.shotId,
      seconds: input.seconds, audio: input.audio === true, prompt: input.prompt?.trim() || '',...(input.method?{method:input.method}:{}) });
    const prior = db.prepare('SELECT * FROM generation_jobs WHERE request_id = ?').get(input.commandId);
    if (prior) {
      if (prior.payload !== payload) throw failure('IDEMPOTENCY_CONFLICT');
      return deserialize(prior);
    }
    const owner = active();
    if (!owner) throw failure('ARK_NOT_CONFIGURED', 503);
    const version = story(projectId);
    if (version?.version !== input.storyVersion) throw failure('STORY_CONFLICT');
    const shot = version.shots.find(item => item.id === input.shotId);
    if (!shot) throw failure('SHOT_NOT_FOUND', 404);
    if (shot.endImageId && !shot.startImageId) throw failure('ARK_FIRST_FRAME_REQUIRED', 422);
    const frames = [
      [shot.startImageId, 'first_frame'],
      [shot.endImageId, 'last_frame'],
    ].filter(([id]) => id).map(([id, role]) => {
      const item = image(projectId, id);
      if (item.size > 8 * 1024 ** 2 || Math.min(item.width, item.height) < 300 ||
          Math.max(item.width, item.height) > 6000 || item.width / item.height < 0.4 || item.width / item.height > 2.5) {
        throw failure('ARK_FRAME_LIMIT', 422);
      }
      return { id, role, name: item.name, size: item.size, digest: item.digest, type: item.contentType,
        width: item.width, height: item.height };
    });
    const targetRatio = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }[version.ratio];
    if (frames[0] && Math.abs(frames[0].width / frames[0].height / targetRatio - 1) > 0.03) {
      throw failure('ARK_FRAME_ASPECT', 422);
    }
    if (frames.length === 2 && Math.abs(frames[0].width * frames[1].height /
        (frames[1].width * frames[0].height) - 1) > 0.03) throw failure('ARK_FRAME_RATIO', 422);
    const prompt = input.prompt?.trim() || [shot.action, version.style, shot.startFrameIdea, shot.endFrameIdea]
      .filter(Boolean).join('。').slice(0, 2000);
    const method=input.method?skills.videoMethod(input.method):null;
    const finalPrompt=method?[method.body,prompt].filter(Boolean).join('\n\n'):prompt;
    if(finalPrompt.length>2000)throw failure('VIDEO_METHOD_TOO_LONG',422);
    const spec = { model, prompt:finalPrompt,...method?{method:{hash:method.hash,name:method.name}}:{}, ratio: version.ratio, seconds: input.seconds, audio: input.audio === true, frames,
      priorUnknown: unresolved(projectId, shot.id) };
    const id = randomUUID();
    db.prepare(`INSERT INTO generation_jobs(id, project_id, shot_id, story_version, request_id, payload, connection_id, spec,
      state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', ?)`)
      .run(id, projectId, input.shotId, input.storyVersion, input.commandId, payload, owner.id, JSON.stringify(spec), new Date().toISOString());
    return get(projectId, id);
  }

  function claim(projectId, id) {
    const job = get(projectId, id);
    if (job.state !== 'awaiting_approval') return false;
    if (active()?.id !== job.connection_id) throw failure('ARK_CONNECTION_CHANGED');
    if (story(projectId)?.version !== job.story_version) throw failure('STORY_CONFLICT');
    if(job.spec.method)skills.videoMethod(job.spec.method.hash);
    const result = db.prepare("UPDATE generation_jobs SET state = 'dispatching', approved_at = ? WHERE id = ? AND state = 'awaiting_approval'")
      .run(new Date().toISOString(), id);
    return !!result.changes;
  }

  function update(projectId, id, patch) {
    const job = { ...get(projectId, id), ...patch };
    db.prepare(`UPDATE generation_jobs SET state = ?, remote_id = ?, candidate_id = ?, next_poll = ?, error = ?, paused = ?
      WHERE project_id = ? AND id = ?`).run(job.state, job.remote_id, job.candidate_id, job.next_poll, job.error, job.paused, projectId, id);
    if (patch.state === 'ready') db.prepare('UPDATE ark_connections SET generated = 1 WHERE id = ?').run(job.connection_id);
    return get(projectId, id);
  }

  function candidate(projectId, id) {
    return db.prepare(`SELECT id FROM assets WHERE project_id = ? AND json_extract(metadata, '$.generationId') = ? LIMIT 1`)
      .get(projectId, id)?.id || null;
  }

  return { active, config, connection, saveConnection, disableConnection, get, list, due, prepare, claim, update, candidate, unresolved };
}

module.exports = { createGenerationRepository };
