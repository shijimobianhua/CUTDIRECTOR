'use strict';

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'INVALID_STORY', status: 422 });
}

function text(value, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    invalid('请填写这条片想讲什么，并检查输入长度。');
  }
  return value.trim();
}

function prepareStory(input, assets, images = []) {
  if (!['16:9', '9:16', '1:1'].includes(input.ratio) ||
      !Number.isSafeInteger(input.durationUs) || input.durationUs < 1000000 || input.durationUs > 1500000000) {
    invalid('请选择画面比例，并设置 1 秒到 25 分钟的目标时长。');
  }
  if (!Array.isArray(input.shots) || input.shots.length > 1000) invalid('每集最多支持 1000 个镜头，请分集保存。');
  const source = new Map(assets.map(asset => [asset.id, asset]));
  const ids = new Set();
  const imageIds = new Set(images.map(image => image.id));
  let shotTotalUs = 0;
  const shots = input.shots.map((shot, index) => {
    if (!shot || !/^[a-f0-9-]{36}$/.test(shot.id) || ids.has(shot.id) ||
        !Number.isSafeInteger(shot.durationUs) || shot.durationUs < 250000 || shot.durationUs > input.durationUs) {
      invalid('请检查第 ' + (index + 1) + ' 镜的时长。');
    }
    const asset = shot.assetId ? source.get(shot.assetId) : null;
    if (shot.assetId && (!asset || asset.durationUs < shot.durationUs)) {
      invalid('第 ' + (index + 1) + ' 镜引用的素材缺失或比计划更短。');
    }
    for (const imageId of [shot.startImageId, shot.endImageId]) {
      if (imageId != null && !imageIds.has(imageId)) invalid('第 ' + (index + 1) + ' 镜引用的首尾图不在这个项目里。');
    }
    ids.add(shot.id);
    shotTotalUs += shot.durationUs;
    return { id: shot.id, action: text(shot.action, 600, true), durationUs: shot.durationUs,
      startFrameIdea: text(shot.startFrameIdea, 600), endFrameIdea: text(shot.endFrameIdea, 600),
      assetId: asset?.id || null,
      ...(shot.startImageId ? { startImageId: shot.startImageId } : {}),
      ...(shot.endImageId ? { endImageId: shot.endImageId } : {}) };
  });
  if (shotTotalUs > input.durationUs) invalid('分镜合计超过目标时长，请缩短部分镜头。');
  return {
    brief: text(input.brief, 1200, true), audience: text(input.audience, 240), style: text(input.style, 600),
    ratio: input.ratio, durationUs: input.durationUs, shotTotalUs, shots,
  };
}

module.exports = { prepareStory };
