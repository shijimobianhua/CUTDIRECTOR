'use strict';

const { randomUUID } = require('node:crypto');
const { prepareArrangement } = require('./arrangement.cjs');

function createLegacyImports(db) {
  function existing(commandId, payload) {
    const value = db.prepare('SELECT * FROM legacy_imports WHERE command_id = ?').get(commandId);
    if (!value) return null;
    if (value.payload !== payload) throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    return JSON.parse(value.receipt);
  }

  function commit(commandId, payload, input) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = existing(commandId, payload);
      if (previous) { db.exec('COMMIT'); return previous; }
      const id = randomUUID();
      const now = new Date().toISOString();
      const assets = input.assets.map(asset => ({ ...asset, id: randomUUID() }));
      const ids = new Map(assets.map(asset => [asset.legacyAssetId, asset.id]));
      const arrangement = prepareArrangement({ clips: input.clips.map(clip => ({
        assetId: ids.get(clip.mediaId), inUs: clip.inUs, outUs: clip.outUs,
      })), subtitle: input.subtitle }, assets);
      db.prepare("INSERT INTO projects VALUES (?, ?, 'footage', NULL, ?)").run(id, input.title.slice(0, 120), now);
      for (const asset of assets) {
        const { id: assetId, digest, ...metadata } = asset;
        db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(assetId, id, digest, JSON.stringify(metadata));
      }
      db.prepare('INSERT INTO arrangements VALUES (?, ?, 1, ?, ?)')
        .run(randomUUID(), id, JSON.stringify(arrangement), now);
      const receipt = { projectId: id, source: input.source, skipped: input.skipped,
        media: assets.map(asset => ({ assetId: asset.id, sourceAssetId: asset.legacyAssetId, digest: asset.digest })),
        createdAt: now };
      db.prepare('INSERT INTO legacy_imports VALUES (?, ?, ?, ?)').run(commandId, payload, id, JSON.stringify(receipt));
      db.prepare("INSERT INTO events(type, subject_id) VALUES ('legacy.imported', ?)").run(id);
      db.exec('COMMIT');
      return receipt;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function source(projectId) {
    const row = db.prepare('SELECT receipt FROM legacy_imports WHERE project_id = ?').get(projectId);
    return row ? JSON.parse(row.receipt) : null;
  }
  return { existing, commit, source };
}

module.exports = { createLegacyImports };
