'use strict';

const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const { serveFile } = require('../service/media.cjs');

async function verifiedFile(item) {
  const info = await stat(item.path);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(item.path)) hash.update(bytes);
  if (hash.digest('hex') !== item.digest) {
    throw Object.assign(new Error('LEGACY_MEDIA_CHANGED'), { code: 'LEGACY_MEDIA_CHANGED', status: 409 });
  }
  return { ...item, size: info.size };
}

function legacyRoutes(legacy, importer, readJson, send) {
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/legacy/')) return false;
    const match = /^\/legacy\/projects(?:\/([A-Za-z][A-Za-z0-9_-]{0,95})(?:\/(command|render|import|deliveries|conversations|media\/([A-Za-z][A-Za-z0-9_-]{0,95})\/content|jobs\/([A-Za-z][A-Za-z0-9_-]{0,95})\/(cancel|retry|artifacts\/([\w.-]{1,100}))))?)?$/.exec(url.pathname);
    try {
      if (!match) { send(res, 404, { error: { code: 'NOT_FOUND' } }); return true; }
      const [, id, action, assetId, jobId, jobAction, artifactName] = match;
      if (req.method === 'GET' || (req.method === 'HEAD' && (assetId || artifactName))) {
        if (assetId || artifactName) {
          const item = artifactName ? legacy.artifact(id, jobId, artifactName) : { ...legacy.file(id, assetId), contentType: 'video/mp4' };
          const file = await verifiedFile(item);
          await serveFile(req, res, file.path, file);
          return true;
        }
        const data = !id ? legacy.list() : !action ? legacy.detail(id)
          : action === 'deliveries' ? legacy.deliveries(id)
            : action === 'conversations' ? legacy.chats(id, url.searchParams.get('id'), url.searchParams.get('before')) : undefined;
        if (data !== undefined) { send(res, 200, { data }); return true; }
      }
      if (req.method === 'POST' && id) {
        const input = await readJson(req, 2 * 1024 * 1024);
        let data;
        if (action === 'command') data = legacy.command(id, input);
        else if (action === 'render') data = legacy.render(id, input);
        else if (action === 'import') data = await importer.run(id, input);
        else if (['cancel', 'retry'].includes(jobAction)) data = legacy.jobAction(id, jobId, jobAction);
        if (data !== undefined) { send(res, 200, { data }); return true; }
      }
      send(res, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      if (res.headersSent || res.destroyed) return true;
      const code = error.code === 'ENOENT' ? 'LEGACY_MEDIA_MISSING' : error.code;
      const known = ['NOT_FOUND', 'TARGET_NOT_FOUND', 'REVISION_CONFLICT', 'COMMAND_ID_CONFLICT',
        'REQUEST_ID_CONFLICT', 'MEDIA_MISSING', 'MEDIA_CHANGED', 'MEDIA_UNSUPPORTED', 'RANGE_INVALID',
        'VALIDATION_ERROR', 'JOB_NOT_RETRYABLE', 'AGENT_INPUT_INVALID', 'PROTECTED_CONTENT'];
      const status = error.status || (code === 'LEGACY_MEDIA_MISSING' ? 409 : known.includes(code) ? 409 : 500);
      send(res, status, { error: { code: status === 500 ? 'LEGACY_ERROR' : code } });
    }
    return true;
  };
}

module.exports = { legacyRoutes };
