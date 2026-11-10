'use strict';

const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const model = 'doubao-seedance-2-5-260628';
const imageModel = 'doubao-seedream-5-0-lite-260128';
const imageEndpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const maxDownload = 256 * 1024 ** 2;

function failure(code, status = 409) {
  return Object.assign(new Error(code), { code, status });
}

function remoteId(id) {
  return typeof id === 'string' && /^cgt-[a-zA-Z0-9-]{6,120}$/.test(id);
}

async function boundedJson(response, limit) {
  if (!response.body) throw failure('ARK_BAD_RESPONSE', 502);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw failure('ARK_BAD_RESPONSE', 502);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw failure('ARK_BAD_RESPONSE', 502);
  }
}

async function requestArk(fetchImpl, url, key, body, { limit = 1024 ** 2, timeout = body ? 30000 : 12000 } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw failure('ARK_NETWORK', 503);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw failure('ARK_CREDENTIAL', 403);
      if ([400, 422].includes(response.status)) throw failure('ARK_REJECTED', 422);
      if (response.status === 404) throw failure('ARK_NOT_FOUND', 404);
      if (response.status === 429) throw failure('ARK_RATE_LIMIT', 429);
      throw failure('ARK_RESPONSE', 502);
    }
    return boundedJson(response, limit);
}

function createArk(fetchImpl = fetch) {
  const request = (key, suffix, body) => requestArk(fetchImpl, endpoint + suffix, key, body);
  return {
    async probe(key) {
      const result = await request(key, '?page_size=1');
      if (!Array.isArray(result?.items)) throw failure('ARK_BAD_RESPONSE', 502);
    },
    async submit(key, spec, frames) {
      const content = [{ type: 'text', text: spec.prompt }, ...frames.map(({ role, dataUrl }) => ({
        type: 'image_url', image_url: { url: dataUrl }, role,
      }))];
      const result = await request(key, '', {
        model: spec.model, content, ratio: spec.ratio, duration: spec.seconds, resolution: '720p',
        generate_audio: spec.audio, output_format: 'mp4', watermark: true, execution_expires_after: 3600,
      });
      if (!remoteId(result?.id)) throw failure('ARK_BAD_RESPONSE', 502);
      return result.id;
    },
    async poll(key, id) {
      if (!remoteId(id)) throw failure('ARK_BAD_RESPONSE', 502);
      const result = await request(key, '/' + encodeURIComponent(id));
      const valid = ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired'];
      if (result?.id !== id || !valid.includes(result.status)) throw failure('ARK_BAD_RESPONSE', 502);
      return { state: result.status, videoUrl: typeof result.content?.video_url === 'string' ? result.content.video_url : null };
    },
    async download(value) {
      let url;
      try { url = new URL(value); } catch { throw failure('ARK_UNSAFE_OUTPUT', 422); }
      const allow = /^(?:[a-z0-9-]+\.)*tos-cn-(?:beijing|shanghai|guangzhou|zhangjiakou)\.volces\.com$/i;
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !allow.test(url.hostname)) {
        throw failure('ARK_UNSAFE_OUTPUT', 422);
      }
      let response;
      try {
        // A signed TOS URL is the download credential. Never forward the API Key.
        response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      } catch {
        throw failure('ARK_DOWNLOAD_FAILED', 502);
      }
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      const size = Number(response.headers.get('content-length'));
      if (!response.ok || !response.body || !['video/mp4', 'application/octet-stream'].includes(type) ||
          !Number.isFinite(size) || size < 0 || size > maxDownload) {
        await response.body?.cancel().catch(() => {});
        throw failure('ARK_DOWNLOAD_FAILED', 502);
      }
      return response.body;
    },
  };
}

function createImageArk(fetchImpl = fetch) {
  return {
    async generate(key, spec, reference) {
      const value = await requestArk(fetchImpl, imageEndpoint, key, {
        model: imageModel, prompt: spec.prompt, size: spec.size,
        response_format: 'b64_json', output_format: 'jpeg', sequential_image_generation: 'disabled', watermark: true,
        ...(reference ? { image: reference } : {}),
      }, { limit: 23 * 1024 ** 2, timeout: 150000 });
      if (Array.isArray(value?.data) && value.data.length === 1 && value.data[0]?.error) {
        throw failure('ARK_REJECTED', 422);
      }
      const data = Array.isArray(value?.data) && value.data.length === 1 ? value.data[0]?.b64_json : null;
      if (typeof data !== 'string' || data.length < 4 || data.length > Math.ceil(16 * 1024 ** 2 / 3) * 4 ||
          data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        throw failure('ARK_BAD_RESPONSE', 502);
      }
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length || bytes.length > 16 * 1024 ** 2) throw failure('ARK_BAD_RESPONSE', 502);
      return bytes;
    },
  };
}

module.exports = { createArk, createImageArk, failure, model, imageModel, maxDownload };
