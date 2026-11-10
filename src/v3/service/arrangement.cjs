'use strict';

const { parseSrt } = require('#cutdirector-srt');

function invalid(code, message) {
  throw Object.assign(new Error(message), { code, status: 422 });
}

const maxDurationUs = 25 * 60 * 1000000;

function prepareArrangement(input, assets) {
  if (!Array.isArray(input?.clips) || input.clips.length < 1 || input.clips.length > 500) {
    invalid('INVALID_ARRANGEMENT', '请添加 1 到 500 个视频片段。');
  }

  const source = new Map(assets.map(asset => [asset.id, asset]));
  const ranges = new Map();
  let durationUs = 0;
  const clips = input.clips.map((clip, index) => {
    const { assetId, inUs, outUs } = clip || {};
    const asset = source.get(assetId);
    if (!asset || asset.kind==='audio') invalid('INVALID_ARRANGEMENT', '第 ' + (index + 1) + ' 段的素材不在这个项目里。');
    if (!Number.isSafeInteger(inUs) || !Number.isSafeInteger(outUs) ||
        inUs < 0 || outUs <= inUs || outUs > asset.durationUs) {
      invalid('INVALID_ARRANGEMENT', '第 ' + (index + 1) + ' 段的开始和结束时间超出素材范围。');
    }
    const assetRanges = ranges.get(assetId) || [];
    if (assetRanges.some(range => inUs < range.outUs && outUs > range.inUs)) {
      invalid('INVALID_ARRANGEMENT', '第 ' + (index + 1) + ' 段和同一素材的另一个片段重叠。');
    }
    assetRanges.push({ inUs, outUs });
    ranges.set(assetId, assetRanges);
    const startUs = durationUs;
    durationUs += outUs - inUs;
    const volume=clip.volume??1;
    if(!Number.isFinite(volume)||volume<0||volume>4)invalid('INVALID_ARRANGEMENT','请检查原片音量。');
    return { assetId, name: asset.name, inUs, outUs, startUs, ...(volume!==1?{volume}:{}) };
  });
  if (durationUs > maxDurationUs) invalid('ARRANGEMENT_TOO_LONG', '请把选中的片段缩短到 25 分钟以内。');

  let subtitle = null;
  let captions = [];
  if (input.subtitle != null) {
    const { mode, assetId, text } = input.subtitle;
    if (!['source', 'timeline'].includes(mode) || (mode === 'source' && !ranges.has(assetId))) {
      invalid('INVALID_SUBTITLE_SCOPE', '请选择字幕对应的已用素材，或选择整条视频。');
    }
    let cues;
    try {
      cues = parseSrt(text);
    } catch (error) {
      if (error.code !== 'SRT_INVALID') throw error;
      invalid('INVALID_SUBTITLE', error.message);
    }
    const limit = mode === 'source' ? source.get(assetId).durationUs : durationUs;
    if (cues.at(-1).endUs > limit) invalid('INVALID_SUBTITLE', '字幕结束时间超过对应视频的时长。');
    subtitle = { mode, assetId: mode === 'source' ? assetId : null, text };
    if (mode === 'timeline') {
      captions = cues.map(({ startUs, endUs, text }) => ({ startUs, endUs, text }));
    } else {
      for (const clip of clips.filter(clip => clip.assetId === assetId)) {
        for (const cue of cues) {
          if (cue.startUs >= clip.outUs) break;
          const from = Math.max(cue.startUs, clip.inUs);
          const to = Math.min(cue.endUs, clip.outUs);
          if (from < to) captions.push({
            startUs: clip.startUs + from - clip.inUs,
            endUs: clip.startUs + to - clip.inUs,
            text: cue.text,
          });
        }
      }
    }
  }
  const extra=require('./timeline-layers.cjs').layers(input,source,durationUs,invalid);
  return { clips, durationUs, subtitle, captions,...(extra.overlayClips.length||extra.audioClips.length?extra:{}) };
}

function handoffPlan(arrangement) {
  if (!arrangement) invalid('ARRANGEMENT_REQUIRED', '请先确认一版视频顺序。');
  const seconds = us => us / 1000000;
  const files = new Map([...arrangement.clips,...(arrangement.overlayClips||[]),...(arrangement.audioClips||[])].map(clip => {
    const found=/\.(mp4|mov|wav|mp3|m4a|ogg)$/i.exec(clip.name);
    const extension=found?'.'+found[1].toLowerCase():'.mp4';
    return [clip.assetId, { assetId: clip.assetId, name: clip.name, path: 'media/' + clip.assetId + extension }];
  }));
  const tracks = [{
    type: 'video',
    clips: arrangement.clips.map(clip => ({
      src: files.get(clip.assetId).path,
      in: seconds(clip.inUs), out: seconds(clip.outUs), start: seconds(clip.startUs),...(clip.volume!=null?{volume:clip.volume}:{}),
    })),
  }];
  tracks.push(...require('./timeline-layers.cjs').handoffLayers(arrangement,files));
  if (arrangement.captions.length) tracks.push({
    type: 'subtitle',
    clips: arrangement.captions.map(cue => ({
      text: cue.text, start: seconds(cue.startUs), duration: seconds(cue.endUs - cue.startUs),
    })),
  });
  return {
    version: arrangement.version,
    durationUs: arrangement.durationUs,
    files: [...files.values()],
    plan: { tracks },
  };
}

module.exports = { prepareArrangement, handoffPlan };
