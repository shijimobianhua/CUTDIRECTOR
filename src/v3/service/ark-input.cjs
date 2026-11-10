'use strict';

const { createHash } = require('node:crypto');
const { readFile, stat } = require('node:fs/promises');
const { join } = require('node:path');
const { failure } = require('./ark.cjs');

async function openCredential(repo, vault, id) {
  try { return await vault('open', repo.connection(id).secret); }
  catch { throw failure('ARK_CREDENTIAL_STORE', 503); }
}

async function imageDataUrl(root, frame) {
  try {
    const file = join(root, 'media', frame.digest);
    if ((await stat(file)).size !== frame.size) throw new Error('Size changed');
    const bytes = await readFile(file);
    if (bytes.length !== frame.size || createHash('sha256').update(bytes).digest('hex') !== frame.digest) {
      throw new Error('Hash changed');
    }
    return 'data:' + frame.type + ';base64,' + bytes.toString('base64');
  } catch {
    throw failure('ARK_FRAME_CHANGED', 422);
  }
}

module.exports = { openCredential, imageDataUrl };
