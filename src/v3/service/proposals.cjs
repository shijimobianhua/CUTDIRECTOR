'use strict';

const { randomUUID } = require('node:crypto');
const { prepareStory } = require('./story.cjs');
const { bindCut } = require('./roughcut.cjs');

function invalid() {
  throw Object.assign(new Error('PROPOSAL_INVALID'), {code:'PROPOSAL_INVALID',status:422});
}
function createStoryProposal(context, input) {
  if (context?.canCreateStory !== true || context.production?.storyVersion != null ||
      Object.keys(input).some(key => !['kind','story'].includes(key))) invalid();
  const story = input.story;
  if (!story || Object.keys(story).some(key => !['brief','audience','style','ratio','seconds','shots'].includes(key)) ||
      !Array.isArray(story.shots) || story.shots.length < 1 || story.shots.length > 8) invalid();
  const shots = story.shots.map(shot => {
    if (!shot || Object.keys(shot).some(key => !['action','seconds','startFrameIdea','endFrameIdea'].includes(key)) ||
        typeof shot.seconds !== 'number') invalid();
    return {id:randomUUID(),action:shot.action,durationUs:shot.seconds * 1e6,
      startFrameIdea:shot.startFrameIdea,endFrameIdea:shot.endFrameIdea,assetId:null};
  });
  let next;
  try {
    next = prepareStory({brief:story.brief,audience:story.audience,style:story.style,
      ratio:story.ratio,durationUs:typeof story.seconds === 'number' ? story.seconds * 1e6 : NaN,shots},[],[]);
  } catch (failure) {
    if (failure.code !== 'INVALID_STORY') throw failure;
    invalid();
  }
  return {kind:'create-story',baseVersion:0,changes:[],clearedSelections:[],next,
    draft:{brief:next.brief,audience:next.audience,style:next.style,ratio:next.ratio,
      targetSeconds:next.durationUs / 1e6,shotTotalSeconds:next.shotTotalUs / 1e6,
      shots:next.shots.map((shot,index)=>({number:index+1,action:shot.action,seconds:shot.durationUs/1e6,
        startFrameIdea:shot.startFrameIdea,endFrameIdea:shot.endFrameIdea}))}};
}

function bindProposal(db, projectId, context, input) {
  if (input?.kind === 'arrangement') return bindCut(db,projectId,context,input);
  if (input?.kind === 'create-story') return createStoryProposal(context, input);
  if (!context?.includeStory || !context.production.storyVersion ||
      !Array.isArray(input?.changes) || input.changes.length < 1 || input.changes.length > 8) invalid();
  const row = db.prepare('SELECT snapshot FROM stories WHERE project_id = ? AND version = ?')
    .get(projectId, context.production.storyVersion);
  if (!row) invalid();
  const base = JSON.parse(row.snapshot);
  const next = structuredClone(base);
  const allowed = context.shotNumbers || base.shots.slice(0, 8).map((_, index) => index + 1);
  const seen = new Set();
  const changes = [];
  const cleared = new Set();
  let reordered = false;
  let structural = false;

  function clearSelections(shots) {
    for (const shot of shots) {
      const number = base.shots.findIndex(original => original.id === shot.id) + 1;
      if (number && (shot.startImageId || shot.endImageId || shot.assetId)) cleared.add(number);
      delete shot.startImageId;
      delete shot.endImageId;
      shot.assetId = null;
    }
  }

  for (const change of input.changes) {
    if (!change || Object.keys(change).some(key => !['shot', 'field', 'value'].includes(key))) invalid();
    const global = change.shot == null;
    if (global && context.focusShotId) invalid();
    if (!global && (!Number.isInteger(change.shot) || !allowed.includes(change.shot))) invalid();
    const key = (global ? 'global' : change.shot) + ':' + change.field;
    if (seen.has(key)) invalid();
    seen.add(key);
    const old = global ? base : base.shots[change.shot - 1];
    const target = global ? next : next.shots.find(shot => shot.id === old.id);
    if (!old || !target) invalid();
    let before;
    let after;

    if (change.field === 'seconds') {
      const us = change.value * 1e6;
      if (typeof change.value !== 'number' || !Number.isSafeInteger(us) ||
          us < (global ? 1000000 : 250000) || us > 1500000000 || us === old.durationUs) invalid();
      before = old.durationUs / 1e6;
      after = change.value;
      target.durationUs = us;
      if (!global) clearSelections([target]);
    } else if (change.field === 'ratio' && global) {
      if (!['9:16', '16:9', '1:1'].includes(change.value) || change.value === base.ratio) invalid();
      before = base.ratio;
      after = change.value;
      next.ratio = change.value;
      clearSelections(next.shots);
    } else if (change.field === 'addShot') {
      if (reordered) invalid();
      structural = true;
      const values = Array.isArray(change.value) ? change.value : [change.value];
      if (!values.length || values.length > 8) invalid();
      const added = values.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).some(field => !['action', 'seconds', 'startFrameIdea', 'endFrameIdea'].includes(field)) ||
            typeof value.seconds !== 'number') invalid();
        return { id: randomUUID(), action: value.action, durationUs: value.seconds * 1e6,
          startFrameIdea: value.startFrameIdea ?? '', endFrameIdea: value.endFrameIdea ?? '', assetId: null };
      });
      const at = global ? next.shots.length : next.shots.indexOf(target) + 1;
      next.shots.splice(at, 0, ...added);
      before = global ? '当前分镜末尾' : '镜头 ' + change.shot + ' 之后';
      after = values.map(value => String(value.action) + ' · ' + value.seconds + ' 秒').join('\n');
    } else if (change.field === 'removeShot' && !global) {
      if (reordered || change.value !== true) invalid();
      structural = true;
      next.shots.splice(next.shots.indexOf(target), 1);
      before = old.action;
      after = '移除这一镜，原素材仍保留';
      if (old.startImageId || old.endImageId || old.assetId) cleared.add(change.shot);
    } else if (change.field === 'order' && global) {
      if (structural || !Array.isArray(change.value) || change.value.length !== allowed.length ||
          new Set(change.value).size !== allowed.length || change.value.some(number => !allowed.includes(number))) invalid();
      reordered = true;
      const slots = base.shots.map((shot, index) => allowed.includes(index + 1) ? index : -1).filter(index => index >= 0);
      const reorderedShots=change.value.map(number=>next.shots.find(shot=>shot.id===base.shots[number-1].id));
      if(reorderedShots.some(shot=>!shot))invalid();
      slots.forEach((slot, index) => { next.shots[slot] = reorderedShots[index]; });
      before = allowed.join(' → ');
      after = change.value.join(' → ');
      if (before === after) invalid();
    } else {
      const limits = global ? { brief: 1200, audience: 240, style: 600 }
        : { action: 600, startFrameIdea: 600, endFrameIdea: 600 };
      if (!Object.hasOwn(limits, change.field) || typeof change.value !== 'string' ||
          change.value.length > limits[change.field] ||
          (!change.value.trim() && ['brief', 'action'].includes(change.field))) invalid();
      before = old[change.field];
      after = change.value.trim();
      if (before === after) invalid();
      target[change.field] = after;
      if (!global) clearSelections([target]);
      else if (change.field === 'style') clearSelections(next.shots);
    }
    changes.push({ shot: global ? null : change.shot, field: change.field, before, after });
  }

  // Existing asset ownership and all duration limits are checked again before approval.
  let validated;
  try {
    const assets = db.prepare('SELECT id,metadata FROM assets WHERE project_id = ?').all(projectId)
      .map(asset => ({ id: asset.id, ...JSON.parse(asset.metadata) }));
    const images = db.prepare('SELECT id FROM images WHERE project_id = ?').all(projectId);
    validated = prepareStory(next, assets, images);
  } catch (failure) {
    if (failure.code !== 'INVALID_STORY') throw failure;
    invalid();
  }
  return { baseVersion: context.production.storyVersion, changes, clearedSelections: [...cleared], next: validated };
}

function publicProposal(value, appliedVersion = null) {
  if (!value) return null;
  const {next, ...summary} = value;
  return {...summary,appliedVersion};
}
function approveProposal(db, mutate, projectId, chatId, turnId, input) {
  if (input?.confirm !== true) throw Object.assign(new Error('PROPOSAL_APPROVAL_REQUIRED'),{code:'PROPOSAL_APPROVAL_REQUIRED',status:403});
  const row = db.prepare(`SELECT t.proposal FROM chat_turns t JOIN chats c ON c.id = t.chat_id
    WHERE t.id = ? AND c.id = ? AND c.project_id = ? AND t.state = 'complete'`).get(turnId,chatId,projectId);
  if (!row?.proposal) throw Object.assign(new Error('PROPOSAL_NOT_FOUND'),{code:'PROPOSAL_NOT_FOUND',status:404});
  const proposal = JSON.parse(row.proposal);
  if(proposal.kind==='arrangement')require('./registry.cjs').createRegistry(db).requireEnabled('cutdirector-roughcut');
  return mutate(proposal.kind==='arrangement'?'arrangement':'story',{...proposal.next,projectId,expectedVersion:proposal.baseVersion,commandId:'proposal_'+turnId});
}
module.exports = {bindProposal,publicProposal,approveProposal};
