'use strict';
function productionContext(db, projectId, saved) {
  const states = table => Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS n FROM ' + table +
    ' WHERE project_id = ? GROUP BY state').all(projectId).map(row => [row.state, row.n]));
  const images = states('image_jobs');
  const videos = states('generation_jobs');
  const shots = saved?.shots || [];
  return {
    storyVersion: saved?.version || null, shotCount: shots.length,
    shotsWithStartImage: shots.filter(shot => shot.startImageId).length,
    shotsWithEndImage: shots.filter(shot => shot.endImageId).length,
    shotsWithVideo: shots.filter(shot => shot.assetId).length,
    readyImages: images.ready || 0, readyVideos: videos.ready || 0,
    pendingImages: (images.dispatching || 0) + (images.collecting || 0),
    pendingVideos: ['dispatching', 'queued', 'running', 'collecting', 'collect_failed'].reduce((n, state) => n + (videos[state] || 0), 0),
    uncertainImages: images.unknown || 0, uncertainVideos: videos.unknown || 0,
    arkConfigured: !!db.prepare('SELECT 1 FROM ark_connections WHERE active = 1').get(),
    extensions: db.prepare('SELECT e.plugin_id,e.manifest,s.probe FROM extension_versions e JOIN capability_states s ON s.id=e.plugin_id WHERE e.selected=1 AND s.enabled=1 ORDER BY e.plugin_id LIMIT 20').all().map(row=>{const m=JSON.parse(row.manifest);return {id:row.plugin_id,title:m.title,capabilities:m.capabilities,cost:m.cost,checked:row.probe?JSON.parse(row.probe).available===true:false};}),
    visualReview: 'user-required',
  };
}
function storyEvidence(saved, focusShotId) {
  if (!saved) return null;
  return {
    version: saved.version, brief: saved.brief.slice(0, 1200), style: saved.style.slice(0, 600),
    ratio: saved.ratio, targetSeconds: saved.durationUs / 1e6, totalShots: saved.shots.length,
    includedShots: focusShotId ? 1 : Math.min(saved.shots.length, 8),
    shots: saved.shots.map((shot,index)=>({shot,index})).filter(({shot})=>!focusShotId || shot.id===focusShotId).slice(0,8).map(({shot,index}) => ({ number: index + 1,
      action: shot.action.slice(0, 600), seconds: shot.durationUs / 1e6,
      startFrameIdea: shot.startFrameIdea.slice(0, 400), endFrameIdea: shot.endFrameIdea.slice(0, 400) })),
  };
}
module.exports = { productionContext, storyEvidence };
