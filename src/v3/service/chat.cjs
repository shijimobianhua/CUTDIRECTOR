'use strict';

const { randomUUID } = require('node:crypto');
const { productionContext, storyEvidence } = require('./production.cjs');
const { bindProposal, publicProposal } = require('./proposals.cjs');
const { cutEvidence } = require('./roughcut.cjs');
const {reference:policyReference}=require('./director-policy.cjs');

function error(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function clean(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw error('INVALID_INPUT', 400);
  return value.trim();
}

function stageFor(text) {
  if (/(首尾[帧图]|出图|画图|生图|首图|尾图|开始图|结束图|开头图|结尾图)/.test(text)) return 'frames';
  if (/(画面审核|画面检查|审片|角色一致)/.test(text)) return 'review';
  if (/(生成视频|视频生成|试拍|seedance)/i.test(text)) return 'generation';
  if (/(交给剪映|写草稿|创建草稿)/.test(text)) return 'handoff';
  if (/(剪辑|粗剪|找重点|保留重点|字幕|片段|时间线)/.test(text)) return 'arrangement';
  if (/(分镜|镜头|开场|旁白)/.test(text)) return 'storyboard';
  return 'brief';
}

function createChat(db, project, projectAssets, arrangement, story, skills) {
  // A pending inference from an earlier Host may have reached the provider.
  // Surface the interrupted turn and let the user decide whether to send again.
  db.prepare("UPDATE chat_turns SET state = 'interrupted' WHERE state = 'pending'").run();

  function thread(projectId, id) {
    const value = db.prepare('SELECT * FROM chats WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!value) throw error('CHAT_NOT_FOUND', 404);
    return value;
  }

  function list(projectId) {
    project(projectId);
    return db.prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 50').all(projectId);
  }

  function open(projectId, input) {
    project(projectId);
    const id = clean(input?.commandId, 100);
    const previous = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    if (previous) {
      if (previous.project_id !== projectId) throw error('IDEMPOTENCY_CONFLICT', 409);
      return previous;
    }
    const now = new Date().toISOString();
    db.prepare('INSERT INTO chats VALUES (?, ?, ?, ?)').run(id, projectId, '新对话', now);
    return thread(projectId, id);
  }

  function turns(projectId, id, limit = 50) {
    thread(projectId, id);
    return db.prepare('SELECT id, text, answer, action, state, created_at, method, context, proposal FROM chat_turns WHERE chat_id = ? ORDER BY rowid DESC LIMIT ?')
      .all(id, limit).reverse().map(row => ({ ...row, proposal: publicProposal(row.proposal ? JSON.parse(row.proposal) : null,
        JSON.parse(db.prepare('SELECT result FROM receipts WHERE id = ?').get('proposal_'+row.id)?.result || 'null')?.version || null), context: row.context ? JSON.parse(row.context) : null, method: row.method ? JSON.parse(row.method) : null }));
  }

  function start(projectId, id, input) {
    const record = thread(projectId, id);
    const requestId = clean(input?.commandId, 100);
    const text = clean(input?.text, 4000);
    const choice = input.model == null ? null : {
      provider: clean(input.model.provider, 120), id: clean(input.model.id, 180),
    };
    const focus = input.focus == null ? null : clean(input.focus, 100);
    const assets = projectAssets(projectId);
    if (focus && !assets.some(asset => asset.id === focus)) throw error('ASSET_NOT_FOUND', 404);
    if(choice)require('./registry.cjs').createRegistry(db).requireEnabled('cutdirector-director');
    const includeSubtitles = !!choice && input.includeSubtitles === true;
    const includeStory = !!choice && input.includeStory === true;
    const includeReferences=!!choice&&input.includeReferences===true;
    const focusShotId = input.focusShotId == null ? null : clean(input.focusShotId,100);
    const savedFocusStory = story(projectId);
    const focusShotIndex = focusShotId ? savedFocusStory?.shots.findIndex(shot=>shot.id===focusShotId) : -1;
    if(focusShotId && (focus || focusShotIndex==null || focusShotIndex<0))throw error('SHOT_NOT_FOUND',404);
    const method = input.method == null ? null : clean(input.method, 64);
    if (method && method !== 'project' && !/^[a-f0-9]{64}$/.test(method)) throw error('INVALID_INPUT', 400);
    const payload = JSON.stringify({ id, text, choice, focus, includeSubtitles, ...(method ? { method } : {}), ...(includeStory ? { includeStory: true } : {}), ...(includeReferences?{includeReferences:true}:{}), ...(focusShotId ? {focusShotId} : {}) });
    const previous = db.prepare('SELECT * FROM chat_turns WHERE command_id = ?').get(requestId);
    if (previous) {
      if (previous.payload !== payload) throw error('IDEMPOTENCY_CONFLICT', 409);
      return { dispatch: false, turns: turns(projectId, id) };
    }
    if (db.prepare("SELECT 1 FROM chat_turns WHERE chat_id = ? AND state = 'pending'").get(id)) {
      throw error('CHAT_BUSY', 409);
    }

    const history = turns(projectId, id, 8).filter(turn => turn.state === 'complete')
      .map(({ text, answer }) => ({ text: text.slice(0, 1200), answer: answer.slice(0, 1200) }));
    const now = new Date().toISOString();
    const turnId = randomUUID();
    const confirmed = arrangement(projectId);
    const subtitleEvidence = includeSubtitles
      ? confirmed?.captions.slice(0, 40).map(cue => ({ startUs: cue.startUs, endUs: cue.endUs, text: cue.text.slice(0, 120) })) || []
      : [];
    const selected = assets.find(asset => asset.id === focus);
    const savedStory = story(projectId);
    const production = productionContext(db, projectId, savedStory);
    const cut=includeSubtitles ? cutEvidence(confirmed,focus,text) : null;
    const context = {
      policy:policyReference,
      cutEvidence:cut,
      references:includeReferences?require('./sources.cjs').createSources(db).context(projectId):[],
      preferences:require('./knowledge.cjs').createKnowledge(db,project).context(projectId),
      production, focusShotNumber:focusShotId ? focusShotIndex+1 : null,
      storyEvidence: includeStory ? storyEvidence(savedStory,focusShotId) : null,
      projectKind: project(projectId).kind, storySaved: !!savedStory,
      importedCount: assets.length, confirmedSeconds: confirmed ? confirmed.durationUs / 1e6 : null,
      selectedSeconds: selected ? selected.durationUs / 1e6 : null,
      subtitleAvailable: !!confirmed?.captions.length, subtitleEvidence,
    };
    const stage=stageFor(text);
    const routed = skills.route(projectId, method, focusShotId && stage==='brief' ? 'storyboard' : stage, !!choice);
    const { method: instructions, ...receipt } = routed || {};
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO chat_turns(id, chat_id, command_id, payload, text, state, created_at, method, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(turnId, id, requestId, payload, text, 'pending', now, routed ? JSON.stringify(receipt) : null,
          JSON.stringify({ policy:policyReference, production, includeStory, includeSubtitles, includeReferences,
            references:context.references.map(({text,...source})=>({...source,characters:text.length,excerptDigest:require('node:crypto').createHash('sha256').update(text).digest('hex')})), canCreateStory: !!choice && !savedStory,
            preferences:context.preferences.map(({id,version,scope})=>({id,version,scope})), arrangementVersion:confirmed?.version||null,
            cutEvidence:cut, focusShotId, shotNumbers:focusShotId ? [focusShotIndex+1] : savedStory?.shots.slice(0,8).map((_,index)=>index+1) || [] }));
      if(choice)db.prepare('INSERT INTO director_runs VALUES (?,?,?,?,?)').run(turnId,'ready',0,0,now);
      db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?')
        .run(record.title === '新对话' ? Array.from(text).slice(0, 30).join('') : record.title, now, id);
      db.exec('COMMIT');
    } catch (failure) {
      db.exec('ROLLBACK');
      throw failure;
    }
    return { dispatch: true, turnId, text, choice, history, context,
      method: routed ? { ...receipt, instructions } : null };
  }

  function finish(projectId, id, input) {
    thread(projectId, id);
    let answer = clean(input?.text, 6000);
    const action = ['import-media', 'arrange', 'delivery', 'story', 'images', 'generation', 'review','references','extensions'].includes(input.action) ? input.action : null;
    const row = db.prepare('SELECT method, context FROM chat_turns WHERE id = ? AND chat_id = ?').get(input.turnId, id);
    const method = row?.method ? JSON.parse(row.method) : null;
    let proposal = null;
    if (input.proposal) {
      try { proposal = bindProposal(db, projectId, row?.context ? JSON.parse(row.context) : null, input.proposal); }
      catch (failure) {
        if (failure.code !== 'PROPOSAL_INVALID') throw failure;
        answer = answer.slice(0, 5600) + (input.proposal.kind==='arrangement' ? '\n这份剪辑建议未通过核对。需要完整的字幕依据，并保留数字、否定和适用条件。请换一个目标时长或缩小选片范围。' : '\n这份分镜建议未通过核对。请说明视频主题和目标时长；修改已有分镜时，请附上已保存的分镜文字。');
      }
    }
    if (method?.state === 'matched') method.state = input.usedMethod === true ? 'used' : 'not-used';
    const result = db.prepare("UPDATE chat_turns SET answer = ?, action = ?, method = ?, proposal = ?, state = 'complete' WHERE id = ? AND chat_id = ? AND state = 'pending'")
      .run(answer, action, method ? JSON.stringify(method) : null, proposal ? JSON.stringify(proposal) : null, input.turnId, id);
    if (!result.changes && !db.prepare("SELECT 1 FROM chat_turns WHERE id = ? AND chat_id = ? AND state = 'complete'").get(input.turnId, id)) {
      throw error('CHAT_TURN_NOT_FOUND', 404);
    }
    return turns(projectId, id);
  }

  return { list, open, turns, start, finish };
}

module.exports = { createChat };
