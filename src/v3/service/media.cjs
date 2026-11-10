'use strict';

const { execFile } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream, linkSync } = require('node:fs');
const { mkdir, open, stat, unlink } = require('node:fs/promises');
const { dirname, isAbsolute, join } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { problem } = require('./store.cjs');

const run = promisify(execFile);
const maxBytes = 2 * 1024 ** 3;

async function headerOf(file) {
  const header = Buffer.alloc(12);
  const fd = await open(file, 'r');
  try {
    await fd.read(header, 0, header.length, 0);
  } finally {
    await fd.close();
  }
  return header;
}

async function inspect(file) {
  const header = await headerOf(file);
  if (header.toString('ascii', 4, 8) !== 'ftyp') throw problem('UNSUPPORTED_MEDIA', 415);
  let result;
  try {
    const { stdout } = await run(process.env.FFPROBE || 'ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0',
      '-show_streams', '-show_format', '-of', 'json', file,
    ], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
    result = JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('MEDIA_RUNTIME_UNAVAILABLE', 503);
    throw problem('INVALID_MEDIA', 422);
  }
  const video = result.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const durationUs = Math.round(Number(video?.duration || result.format?.duration) * 1e6);
  if (!video?.width || !video.height || !Number.isSafeInteger(durationUs) || durationUs <= 0) {
    throw problem('INVALID_MEDIA', 422);
  }
  return {
    durationUs, width: video.width, height: video.height, codec: video.codec_name,
    hasAudio: result.streams.some(stream => stream.codec_type === 'audio'),
    contentType: header.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4',
  };
}

async function inspectImage(file) {
  const header = await headerOf(file);
  const png = header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (!png && !jpeg) throw problem('UNSUPPORTED_MEDIA', 415);
  const format = png ? 'png_pipe' : 'jpeg_pipe';
  const ffprobe = process.env.FFPROBE || 'ffprobe';
  const ffmpeg = process.env.FFMPEG || (isAbsolute(ffprobe)
    ? join(dirname(ffprobe), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg');
  try {
    const { stdout } = await run(ffprobe, [
      '-v', 'error', '-protocol_whitelist', 'file', '-f', format,
      '-show_entries', 'stream=width,height', '-of', 'json', file,
    ], { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
    const { width, height } = JSON.parse(stdout).streams[0] || {};
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > 8192 || height > 8192 || width * height > 24000000) throw problem('INVALID_IMAGE', 422);
    await run(ffmpeg, [
      '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-f', format, '-i', file,
      '-frames:v', '1', '-f', 'null', '-',
    ], { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
    return { width, height, contentType: png ? 'image/png' : 'image/jpeg', source: 'manual' };
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('MEDIA_RUNTIME_UNAVAILABLE', 503);
    throw problem('INVALID_IMAGE', 422);
  }
}

async function verifyGeneratedVideo(file, meta) {
  if (meta.contentType !== 'video/mp4' || meta.durationUs > 35000000 ||
      meta.width > 4096 || meta.height > 4096) throw problem('INVALID_MEDIA', 422);
  const ffprobe = process.env.FFPROBE || 'ffprobe';
  const ffmpeg = process.env.FFMPEG || (isAbsolute(ffprobe)
    ? join(dirname(ffprobe), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : 'ffmpeg');
  try {
    await run(ffmpeg, [
      '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0',
      '-i', file, '-f', 'null', '-',
    ], { windowsHide: true, timeout: 90000, maxBuffer: 128 * 1024 });
  } catch (error) {
    if (error.code === 'ENOENT') throw problem('MEDIA_RUNTIME_UNAVAILABLE', 503);
    throw problem('INVALID_MEDIA', 422);
  }
}

async function ingest(req, root, store, projectId, commandId, rawName, delivery, image = false, generated) {
  store.project(projectId);
  if (req.headers['content-type'] !== 'application/octet-stream') throw problem('INVALID_INPUT', 400);
  const name = String(rawName || '').trim();
  const extensions = image ? /\.(png|jpe?g)$/i : /\.(mp4|mov)$/i;
  if (!name || name.length > 160 || /[\\/\x00-\x1f]/.test(name) || !extensions.test(name)) {
    throw problem('UNSUPPORTED_MEDIA', 415);
  }
  if (delivery && (!/\.mp4$/i.test(name) || !Number.isSafeInteger(delivery.version) || delivery.version < 1)) {
    throw problem('INVALID_INPUT', 400);
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(commandId || '')) throw problem('INVALID_INPUT', 400);
  const dir = join(root, 'media');
  await mkdir(dir, { recursive: true });
  const temp = join(dir, randomUUID() + '.partial');
  const hash = createHash('sha256');
  let size = 0;
  const ceiling = image ? 16 * 1024 ** 2 : generated ? 256 * 1024 ** 2 : maxBytes;
  try {
    const limit = new Transform({
      transform(chunk, encoding, done) {
        size += chunk.length;
        if (size > ceiling) return done(problem('REQUEST_TOO_LARGE', 413));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    // Keep the HTTP socket writable when the limit is hit so the browser receives 413.
    const output = createWriteStream(temp, { flags: 'wx' });
    try {
      await pipeline(req.iterator({ destroyOnReturn: false }), limit, output);
    } catch (error) {
      req.resume();
      throw error;
    }
    if (!size) throw problem('INVALID_MEDIA', 422);
    const meta = await (image ? inspectImage(temp) : inspect(temp));
    if (generated && !image) await verifyGeneratedVideo(temp, meta);
    if (image && generated?.expectedRatio) {
      const ratio = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }[generated.expectedRatio];
      if (!ratio || Math.abs(meta.width / meta.height / ratio - 1) > 0.03) {
        throw problem('IMAGE_RESULT_ASPECT', 422);
      }
    }
    const digest = hash.digest('hex');
    return store.mutate(image ? 'image' : delivery ? 'final' : 'asset', { commandId, projectId, name, digest, size, ...meta, ...delivery, ...generated }, () => {
      try {
        linkSync(temp, join(dir, digest));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    });
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && start <= end && end < size ? { start, end } : null;
}

async function serve(req, res, root, asset) {
  return serveFile(req, res, join(root, 'media', asset.digest), asset);
}

async function serveFile(req, res, file, asset) {
  const info = await stat(file).catch(error => { if (error.code === 'ENOENT') throw problem('ASSET_MISSING', 404); throw error; });
  if (!info.isFile() || info.size !== asset.size) throw problem('ASSET_MISSING', 404);
  const range = req.headers.range && parseRange(req.headers.range, info.size);
  const headers = { 'Content-Type': asset.contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (req.headers.range && !range) {
    res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + info.size });
    return res.end();
  }
  if (range) headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + info.size;
  headers['Content-Length'] = range ? range.end - range.start + 1 : info.size;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(file, range || undefined), res);
}

module.exports = { ingest, serve, serveFile, inspect };
