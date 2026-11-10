'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { prepareArrangement, handoffPlan } = require('./arrangement.cjs');
const { createChat } = require('./chat.cjs');
const { prepareStory } = require('./story.cjs');
const { createSkills } = require('./skills.cjs');
const { createGenerationRepository } = require('./generation-repository.cjs');
const { createImageJobs } = require('./image-jobs.cjs');
const { createLegacyImports } = require('./legacy-imports.cjs');
const { productionContext } = require('./production.cjs');
const { approveProposal } = require('./proposals.cjs');
const { createActivity } = require('./activity.cjs');
const { createWorkspace } = require('./workspace.cjs');
const { createIdeas } = require('./ideas.cjs');
const { createVersions } = require('./versions.cjs');
const { createKnowledge } = require('./knowledge.cjs');
const { createRuntime } = require('./runtime.cjs');
const { createReferences } = require('./references.cjs');
const { createSources } = require('./sources.cjs');
const { createRegistry } = require('./registry.cjs');
const { createWorkflows } = require('./workflows.cjs');
const { createQuality } = require('./quality.cjs');
const { createBatches } = require('./batches.cjs');
const { createRepairs } = require('./repairs.cjs');
const { createSearches } = require('./searches.cjs');
const { createCandidates } = require('./candidates.cjs');
const { createNativeSettings } = require('./native-connection.cjs');

function problem(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function requiredText(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw problem('INVALID_INPUT', 400);
  }
  return value.trim();
}

function openStore(root) {
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'cutdirector-v3.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 2000;
  `);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE ideas (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('idea', 'footage')),
        idea_id TEXT REFERENCES ideas(id), created_at TEXT NOT NULL
      );
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL
      );
      CREATE TABLE events (
        seq INTEGER PRIMARY KEY, type TEXT NOT NULL, subject_id TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  } else if (version < 0 || version > 33) {
    db.close();
    throw problem('SCHEMA_UNSUPPORTED', 503);
  }

  if (version < 2) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        digest TEXT NOT NULL, metadata TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id);
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  if (version < 3) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS arrangements (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        version INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(project_id, version)
      );
      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  if (version < 4) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        version INTEGER NOT NULL, state TEXT NOT NULL, name TEXT NOT NULL,
        target TEXT NOT NULL, editor_version TEXT NOT NULL, created_at TEXT NOT NULL,
        draft_id TEXT, error TEXT
      );
      CREATE INDEX IF NOT EXISTS drafts_project ON drafts(project_id);
      CREATE TABLE IF NOT EXISTS finals (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        version INTEGER NOT NULL, handoff_id TEXT REFERENCES drafts(id),
        digest TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS finals_project ON finals(project_id);
      CREATE TABLE IF NOT EXISTS final_selection (
        project_id TEXT PRIMARY KEY REFERENCES projects(id), final_id TEXT NOT NULL REFERENCES finals(id)
      );
      PRAGMA user_version = 4;
      COMMIT;
    `);
  }

  if (version < 5) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_turns (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
        command_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, text TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, answer TEXT, action TEXT
      );
      CREATE INDEX IF NOT EXISTS chat_turns_chat ON chat_turns(chat_id);
      PRAGMA user_version = 5;
      COMMIT;
    `);
  }

  if (version < 6) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        version INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(project_id, version)
      );
      PRAGMA user_version = 6;
      COMMIT;
    `);
  }

  if (version < 7) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS skill_versions (
        hash TEXT PRIMARY KEY, name TEXT NOT NULL, descriptor TEXT NOT NULL,
        files TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skill_active (
        name TEXT PRIMARY KEY, hash TEXT NOT NULL REFERENCES skill_versions(hash), enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skill_preferences (
        project_id TEXT PRIMARY KEY REFERENCES projects(id), hash TEXT NOT NULL REFERENCES skill_versions(hash)
      );
      ALTER TABLE chat_turns ADD COLUMN method TEXT;
      PRAGMA user_version = 7;
      COMMIT;
    `);
  }

  if (version < 8) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        digest TEXT NOT NULL, metadata TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS images_project ON images(project_id);
      PRAGMA user_version = 8;
      COMMIT;
    `);
  }

  if (version < 9) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS ark_connections (
        id TEXT PRIMARY KEY, secret TEXT NOT NULL, tested_at TEXT NOT NULL,
        active INTEGER NOT NULL, generated INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ark_one_active ON ark_connections(active) WHERE active = 1;
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        shot_id TEXT NOT NULL, story_version INTEGER NOT NULL, request_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES ark_connections(id), spec TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT, remote_id TEXT,
        candidate_id TEXT REFERENCES assets(id), next_poll INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE INDEX IF NOT EXISTS generation_project ON generation_jobs(project_id);
      PRAGMA user_version = 9;
      COMMIT;
    `);
  }

  if (version < 10) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE image_jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        shot_id TEXT NOT NULL, frame TEXT NOT NULL CHECK(frame IN ('start', 'end')),
        story_version INTEGER NOT NULL, request_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES ark_connections(id),
        spec TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, approved_at TEXT,
        candidate_id TEXT REFERENCES images(id), error TEXT
      );
      CREATE INDEX image_jobs_project ON image_jobs(project_id);
      PRAGMA user_version = 10;
      COMMIT;
    `);
  }

  if (version < 11) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS legacy_imports (
        command_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id), receipt TEXT NOT NULL
      );
      PRAGMA user_version = 11;
      COMMIT;
    `);
  }

  if (version < 12) {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE chat_turns ADD COLUMN context TEXT;
      PRAGMA user_version = 12;
      COMMIT;
    `);
  }
  if (version < 13) {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE chat_turns ADD COLUMN proposal TEXT;
      PRAGMA user_version = 13;
      COMMIT;
    `);
  }
  if (version < 14) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('PRAGMA table_info(events)').all().some(column=>column.name==='scope_id')) {
        db.exec('ALTER TABLE events ADD COLUMN scope_id TEXT');
      }
      for (const table of ['image_jobs','generation_jobs','drafts']) {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS ${table}_created AFTER INSERT ON ${table} BEGIN
            INSERT INTO events(type,subject_id,scope_id) VALUES ('task.created',NEW.id,NEW.project_id);
          END;
          CREATE TRIGGER IF NOT EXISTS ${table}_changed AFTER UPDATE OF state ON ${table}
          WHEN OLD.state <> NEW.state BEGIN
            INSERT INTO events(type,subject_id,scope_id) VALUES ('task.changed',NEW.id,NEW.project_id);
          END;
        `);
      }
      db.exec('PRAGMA user_version = 14; COMMIT;');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
  }
  if(version<15) {
    db.exec(`CREATE TABLE IF NOT EXISTS view_states (scope TEXT PRIMARY KEY,version INTEGER NOT NULL,value TEXT NOT NULL);
      PRAGMA user_version = 15;`);
  }
  if(version<16) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS idea_meta (idea_id TEXT PRIMARY KEY REFERENCES ideas(id),
        version INTEGER NOT NULL,note TEXT NOT NULL,tags TEXT NOT NULL,pinned INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS idea_links (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
        idea_id TEXT NOT NULL REFERENCES ideas(id),revision INTEGER NOT NULL,mode TEXT NOT NULL,
        snapshot TEXT NOT NULL,source_version INTEGER NOT NULL,created_at TEXT NOT NULL,
        UNIQUE(project_id,idea_id,revision));
      PRAGMA user_version = 16;
      COMMIT;
    `);
  }
  if(version<17) {
    db.exec(`CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
      version INTEGER NOT NULL,scope TEXT NOT NULL,state TEXT NOT NULL,note TEXT NOT NULL,kind TEXT NOT NULL,
      source_version INTEGER NOT NULL,evidence TEXT NOT NULL,created_at TEXT NOT NULL);PRAGMA user_version=17;`);
  }
  if(version<18) {
    db.exec(`CREATE TABLE IF NOT EXISTS director_runs(turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id),
      state TEXT NOT NULL,calls INTEGER NOT NULL,tools INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS director_steps(turn_id TEXT NOT NULL REFERENCES director_runs(turn_id),
      step INTEGER NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(turn_id,step));
      PRAGMA user_version=18;`);
  }
  if(version<19) {
    db.exec(`CREATE TABLE IF NOT EXISTS reference_assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),digest TEXT NOT NULL,metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reference_analyses(reference_id TEXT PRIMARY KEY REFERENCES reference_assets(id),result TEXT NOT NULL);PRAGMA user_version=19;`);
  }
  if(version<20) {
    db.exec(`CREATE TABLE IF NOT EXISTS idea_sources(id TEXT PRIMARY KEY,idea_id TEXT NOT NULL REFERENCES ideas(id),
      title TEXT NOT NULL,url TEXT,kind TEXT NOT NULL,digest TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL);PRAGMA user_version=20;`);
  }
  if(version<21)db.exec(`CREATE TABLE IF NOT EXISTS capability_states(id TEXT PRIMARY KEY,version INTEGER NOT NULL,enabled INTEGER NOT NULL,probe TEXT);PRAGMA user_version=21;`);
  if(version<22)db.exec(`CREATE TABLE IF NOT EXISTS workflow_versions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
    version INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,version));
    CREATE TABLE IF NOT EXISTS workflow_templates(id TEXT NOT NULL,version TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,version));PRAGMA user_version=22;`);
  if(version<23)db.exec(`CREATE TABLE IF NOT EXISTS quality_checks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL,target_id TEXT NOT NULL,digest TEXT NOT NULL,story_version INTEGER NOT NULL,time_us INTEGER NOT NULL,
    verdict TEXT NOT NULL,note TEXT NOT NULL,executor TEXT NOT NULL,created_at TEXT NOT NULL);PRAGMA user_version=23;`);
  if(version<24)db.exec(`CREATE TABLE IF NOT EXISTS generation_batches(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
    request_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,story_version INTEGER NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,
    spec TEXT NOT NULL,approved_at TEXT,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);PRAGMA user_version=24;`);
  if(version<25)db.exec(`
    CREATE TRIGGER IF NOT EXISTS director_runs_changed AFTER UPDATE OF state ON director_runs WHEN OLD.state<>NEW.state BEGIN
      INSERT INTO events(type,subject_id,scope_id) SELECT 'director.changed',NEW.turn_id,c.project_id FROM chat_turns t JOIN chats c ON c.id=t.chat_id WHERE t.id=NEW.turn_id;
    END;
    CREATE TRIGGER IF NOT EXISTS generation_batches_changed AFTER UPDATE OF state ON generation_batches WHEN OLD.state<>NEW.state BEGIN
      INSERT INTO events(type,subject_id,scope_id) VALUES ('batch.changed',NEW.id,NEW.project_id);
    END;PRAGMA user_version=25;`);
  if(version<26)db.exec(`CREATE TABLE IF NOT EXISTS reference_searches(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
    request_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,query TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS reference_searches_changed AFTER UPDATE OF state ON reference_searches WHEN OLD.state<>NEW.state BEGIN
    INSERT INTO events(type,subject_id,scope_id) VALUES ('search.changed',NEW.id,NEW.project_id);END;PRAGMA user_version=26;`);
  if(version<27)db.exec(`CREATE TABLE IF NOT EXISTS local_connections(name TEXT PRIMARY KEY,version INTEGER NOT NULL,value TEXT NOT NULL);PRAGMA user_version=27;`);
  if(version<28)db.exec(`BEGIN IMMEDIATE;CREATE TABLE idea_chats(id TEXT PRIMARY KEY,idea_id TEXT NOT NULL REFERENCES ideas(id),title TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE idea_chat_turns(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES idea_chats(id),command_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,text TEXT NOT NULL,answer TEXT,state TEXT NOT NULL,context TEXT NOT NULL,created_at TEXT NOT NULL,reserved TEXT);
    PRAGMA user_version=28;COMMIT;`);
  if(version<29)db.exec(`BEGIN IMMEDIATE;CREATE TABLE extension_versions(plugin_id TEXT NOT NULL,version TEXT NOT NULL,digest TEXT NOT NULL,tool_name TEXT NOT NULL,manifest TEXT NOT NULL,selected INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(plugin_id,version));
   CREATE TABLE extension_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),command_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,plugin_id TEXT NOT NULL,digest TEXT NOT NULL,snapshot TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL,result TEXT,created_at TEXT NOT NULL,reserved TEXT);
   PRAGMA user_version=29;COMMIT;`);
  if(version<30)db.exec(`BEGIN IMMEDIATE;CREATE TRIGGER IF NOT EXISTS extension_jobs_created AFTER INSERT ON extension_jobs BEGIN INSERT INTO events(type,subject_id,scope_id) VALUES ('extension.created',NEW.id,NEW.project_id);END;
   CREATE TRIGGER IF NOT EXISTS extension_jobs_changed AFTER UPDATE OF state ON extension_jobs WHEN OLD.state<>NEW.state BEGIN INSERT INTO events(type,subject_id,scope_id) VALUES ('extension.changed',NEW.id,NEW.project_id);END;PRAGMA user_version=30;COMMIT;`);
  if(version<31)db.exec(`BEGIN IMMEDIATE;CREATE TABLE visual_reviews(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),command_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,snapshot TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL);
   CREATE TRIGGER visual_reviews_created AFTER INSERT ON visual_reviews BEGIN INSERT INTO events(type,subject_id,scope_id) VALUES ('visual.created',NEW.id,NEW.project_id);END;
   CREATE TRIGGER visual_reviews_changed AFTER UPDATE OF state ON visual_reviews WHEN OLD.state<>NEW.state BEGIN INSERT INTO events(type,subject_id,scope_id) VALUES ('visual.changed',NEW.id,NEW.project_id);END;PRAGMA user_version=31;COMMIT;`);
  if(version<32)db.exec(`BEGIN IMMEDIATE;CREATE TABLE idea_files(id TEXT PRIMARY KEY,idea_id TEXT NOT NULL REFERENCES ideas(id),digest TEXT NOT NULL,metadata TEXT NOT NULL);PRAGMA user_version=32;COMMIT;`);
  function acceptProposal(projectId, chatId, turnId, input) {
    return approveProposal(db, mutate, projectId, chatId, turnId, input);
  }
  function production(projectId) {
    project(projectId);
    return productionContext(db, projectId, story(projectId));
  }

  function project(projectId) {
    const value = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!value) {
      throw problem('PROJECT_NOT_FOUND', 404);
    }
    return value;
  }

  function projectAssets(projectId) {
    project(projectId);
    return db.prepare('SELECT id, metadata FROM assets WHERE project_id = ? ORDER BY rowid').all(projectId)
      .map(({ id, metadata }) => ({ id, ...JSON.parse(metadata) }));
  }

  function images(projectId) {
    project(projectId);
    return db.prepare('SELECT id, metadata FROM images WHERE project_id = ? ORDER BY rowid DESC').all(projectId)
      .map(({ id, metadata }) => ({ id, ...JSON.parse(metadata) }));
  }

  function image(projectId, id) {
    const row = db.prepare('SELECT digest, metadata FROM images WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!row) throw problem('ASSET_NOT_FOUND', 404);
    return { digest: row.digest, ...JSON.parse(row.metadata) };
  }

  function asset(projectId, assetId) {
    const row = db.prepare('SELECT digest, metadata FROM assets WHERE project_id = ? AND id = ?').get(projectId, assetId);
    if (!row) throw problem('ASSET_NOT_FOUND', 404);
    return { digest: row.digest, ...JSON.parse(row.metadata) };
  }

  function arrangement(projectId, version) {
    project(projectId);
    const row = version == null
      ? db.prepare('SELECT * FROM arrangements WHERE project_id = ? ORDER BY version DESC LIMIT 1').get(projectId)
      : db.prepare('SELECT * FROM arrangements WHERE project_id = ? AND version = ?').get(projectId, version);
    return row ? { id: row.id, version: row.version, createdAt: row.created_at, ...JSON.parse(row.snapshot) } : null;
  }

  function arrangementPreview(projectId, input) {
    return prepareArrangement(input, projectAssets(projectId));
  }

  function handoff(projectId, version) {
    const owner = project(projectId);
    const current = arrangement(projectId, version);
    if (!current) throw problem('ARRANGEMENT_NOT_FOUND', 404);
    const manifest = handoffPlan(current);
    const first = asset(projectId, current.clips[0].assetId);
    manifest.files = manifest.files.map(file => ({ ...file, sha256: asset(projectId, file.assetId).digest }));
    manifest.plan.name = owner.title;
    manifest.plan.canvas = { width: first.width, height: first.height, fps: 30 };
    return manifest;
  }

  function story(projectId) {
    project(projectId);
    const row = db.prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY version DESC LIMIT 1').get(projectId);
    return row ? { id: row.id, version: row.version, createdAt: row.created_at, ...JSON.parse(row.snapshot) } : null;
  }

  function delivery(projectId) {
    project(projectId);
    const drafts = db.prepare('SELECT * FROM drafts WHERE project_id = ? ORDER BY rowid DESC').all(projectId);
    const finals = db.prepare('SELECT id, version, handoff_id, metadata, created_at FROM finals WHERE project_id = ? ORDER BY rowid DESC')
      .all(projectId).map(({ metadata, ...record }) => ({ ...record, ...JSON.parse(metadata) }));
    const selected = db.prepare('SELECT final_id FROM final_selection WHERE project_id = ?').get(projectId);
    return { drafts, finals, selectedFinalId: selected?.final_id || null };
  }

  function finalAsset(projectId, id) {
    const row = db.prepare('SELECT digest, metadata FROM finals WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!row) throw problem('ASSET_NOT_FOUND', 404);
    return { digest: row.digest, ...JSON.parse(row.metadata) };
  }

  function draft(projectId, id) {
    const job = db.prepare('SELECT * FROM drafts WHERE project_id = ? AND id = ?').get(projectId, id);
    if (!job) throw problem('DRAFT_NOT_FOUND', 404);
    return job;
  }

  function transitionDraft(projectId, id, from, state, fields = {}) {
    const job = draft(projectId, id);
    if (job.state !== from) return job;
    if (state === 'writing' && arrangement(projectId)?.version !== job.version) {
      throw problem('ARRANGEMENT_CONFLICT', 409);
    }
    db.prepare('UPDATE drafts SET state = ?, draft_id = ?, error = ? WHERE project_id = ? AND id = ? AND state = ?')
      .run(state, fields.draftId || null, fields.error || null, projectId, id, from);
    return draft(projectId, id);
  }

  function snapshot() {
    return {
      ideas: db.prepare('SELECT * FROM ideas ORDER BY created_at DESC, rowid DESC LIMIT 50').all(),
      projects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC, rowid DESC LIMIT 50').all(),
      cursor: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get().seq,
    };
  }

  function mutate(kind, body, publishAsset) {
    const commandId = requiredText(body?.commandId, 100);
    let input;
    if (kind === 'idea') {
      const text = requiredText(body.text, 4000);
      let url = null;
      if (body.url) {
        try {
          const parsed = new URL(requiredText(body.url, 2048));
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw problem('INVALID_INPUT', 400);
          }
          url = parsed.href;
        } catch {
          throw problem('INVALID_INPUT', 400);
        }
      }
      input = { text, url };
    } else if (['asset', 'image', 'final', 'draft', 'finalPrimary'].includes(kind)) {
      const { commandId: unused, ...metadata } = body;
      input = metadata;
    } else if (kind === 'story') {
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw problem('INVALID_INPUT', 400);
      input = { projectId: body.projectId, expectedVersion: body.expectedVersion, data: prepareStory(body, projectAssets(body.projectId), images(body.projectId)) };
    } else if (kind === 'arrangement') {
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw problem('INVALID_INPUT', 400);
      const data = arrangementPreview(body.projectId, body);
      input = { projectId: body.projectId, expectedVersion: body.expectedVersion, data };
    } else {
      if (!['idea', 'footage'].includes(body.kind)) throw problem('INVALID_INPUT', 400);
      const ideaId = body.ideaId == null ? null : requiredText(body.ideaId, 100);
      if (ideaId && body.kind !== 'idea') throw problem('INVALID_INPUT', 400);
      input = { title: requiredText(body.title, 120), kind: body.kind, ideaId };
    }
    const payload = JSON.stringify({ kind, input });
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM receipts WHERE id = ?').get(commandId);
      if (previous) {
        if (previous.payload !== payload) throw problem('IDEMPOTENCY_CONFLICT', 409);
        db.exec('COMMIT');
        return JSON.parse(previous.result);
      }
      const id = randomUUID();
      const at = new Date().toISOString();
      let result;
      if (kind === 'idea') {
        result = { id, ...input, created_at: at };
        db.prepare('INSERT INTO ideas VALUES (?, ?, ?, ?)').run(id, input.text, input.url, at);
      } else if (kind === 'asset' || kind === 'image') {
        const { digest, projectId, ...metadata } = input;
        publishAsset();
        const statement = kind === 'image' ? 'INSERT INTO images VALUES (?, ?, ?, ?)' : 'INSERT INTO assets VALUES (?, ?, ?, ?)';
        db.prepare(statement).run(id, projectId, digest, JSON.stringify(metadata));
        result = { id, ...metadata };
      } else if (kind === 'draft') {
        if (arrangement(input.projectId)?.version !== input.version) throw problem('ARRANGEMENT_CONFLICT', 409);
        const name = 'CUTDIRECTOR-' + id;
        db.prepare('INSERT INTO drafts(id, project_id, version, state, name, target, editor_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, input.projectId, input.version, 'awaiting_approval', name, input.target, input.editorVersion, at);
        result = draft(input.projectId, id);
      } else if (kind === 'final') {
        const { digest, projectId, version, handoffId, ...metadata } = input;
        if (!arrangement(projectId, version)) throw problem('ARRANGEMENT_NOT_FOUND', 404);
        if (handoffId) {
          const linked = draft(projectId, handoffId);
          if (linked.version !== version || linked.state !== 'created') throw problem('DRAFT_NOT_READY', 409);
        }
        publishAsset();
        db.prepare('INSERT INTO finals VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, projectId, version, handoffId, digest, JSON.stringify(metadata), at);
        db.prepare('INSERT OR IGNORE INTO final_selection VALUES (?, ?)').run(projectId, id);
        result = { id, version, handoff_id: handoffId, created_at: at, ...metadata };
      } else if (kind === 'finalPrimary') {
        finalAsset(input.projectId, input.finalId);
        db.prepare('INSERT INTO final_selection VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET final_id = excluded.final_id')
          .run(input.projectId, input.finalId);
        result = { id: input.finalId };
      } else if (kind === 'story') {
        const current = story(input.projectId);
        if ((current?.version || 0) !== input.expectedVersion) throw problem('STORY_CONFLICT', 409);
        const version = input.expectedVersion + 1;
        db.prepare('INSERT INTO stories VALUES (?, ?, ?, ?, ?)')
          .run(id, input.projectId, version, JSON.stringify(input.data), at);
        result = { id, version, createdAt: at, ...input.data };
      } else if (kind === 'arrangement') {
        const current = arrangement(input.projectId);
        if ((current?.version || 0) !== input.expectedVersion) throw problem('ARRANGEMENT_CONFLICT', 409);
        const version = input.expectedVersion + 1;
        db.prepare('INSERT INTO arrangements VALUES (?, ?, ?, ?, ?)')
          .run(id, input.projectId, version, JSON.stringify(input.data), at);
        result = { id, version, createdAt: at, ...input.data };
      } else {
        if (input.ideaId && !db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(input.ideaId)) {
          throw problem('IDEA_NOT_FOUND', 404);
        }
        result = { id, title: input.title, kind: input.kind, idea_id: input.ideaId, created_at: at };
        db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(id, input.title, input.kind, input.ideaId, at);
        if(input.ideaId)ideas.initialLink(id,input.ideaId);
      }
      db.prepare('INSERT INTO events(type, subject_id, scope_id) VALUES (?, ?, ?)').run(kind + '.created', id, input.projectId || (kind==='project'?id:null));
      db.prepare('INSERT INTO receipts VALUES (?, ?, ?)').run(commandId, payload, JSON.stringify(result));
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const skills = createSkills(db, project);
  const chat = createChat(db, project, projectAssets, arrangement, story, skills);
  const generation = createGenerationRepository(db, project, story, image, skills);
  const imageJobs = createImageJobs(db, project, story, image, generation, skills);
  const legacyImports = createLegacyImports(db);
  const activity = createActivity(db, project);
  const repairs = createRepairs(db,root,project,asset);
  const imageRepairs=createRepairs(db,root,project,image,'image');
  const registry = createRegistry(db);
  const native=createNativeSettings(db);
  const candidates=createCandidates(db,project,story);
  const searches = createSearches(db,project,registry);
  const batches = createBatches(db,project,story,imageJobs,generation,registry);
  const quality = createQuality(db,project,asset,image,story);
  const workflows = createWorkflows(db,project,registry,production,arrangement);
  const sources = createSources(db);
  const references = createReferences(db,project,mutate);
  const runtime = createRuntime(db,project,story,arrangement,production);
  const knowledge = createKnowledge(db,project);
  const workspace = createWorkspace(db,project);
  const ideas = createIdeas(db,project);
  for(const row of db.prepare('SELECT p.id,p.idea_id FROM projects p WHERE p.idea_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM idea_links l WHERE l.project_id=p.id AND l.idea_id=p.idea_id)').all())ideas.initialLink(row.id,row.idea_id);
  const versions = createVersions(db,project,mutate);
  const ideaFiles=require('./idea-files.cjs').createIdeaFiles(db,ideas,mutate,references);
  const reviewAnalyzer=require('./reference-analyzer.cjs').createReferenceAnalyzer(root,{file:(p,id)=>({...asset(p,id),kind:'video'}),record:(_p,_id,result)=>result});
  const visual=require('./visual-review.cjs').createVisualReviews(db,{project,image,asset,story,registry,references},root,reviewAnalyzer);
  const extensions=require('./extensions.cjs').createExtensions(db,project,story,projectAssets,registry,{root,project,image,asset,mutate});
  const ideaChat=require('./idea-chat.cjs').createIdeaChat(db,ideas,registry);
  const studioBase={snapshot,project,story,mutate,image,images,asset,projectAssets,skills};
  const studio=require('./studio-store.cjs').createStudio(db,studioBase);
  const assistant=require('./assistant.cjs').createAssistant(studio,studioBase);
  return { studio, assistant, imageRepairs, ideaFiles, visual, extensions, ideaChat, native, candidates, searches, repairs, batches, quality, workflows, registry, sources, references, runtime, knowledge, versions, ideas, workspace, activity, acceptProposal, production, legacyImports, imageJobs, generation, chat, skills, story, images, image, snapshot, mutate, project, projectAssets, asset, arrangement, arrangementPreview, handoff, delivery, finalAsset, draft, transitionDraft, close: () => db.close() };
}

module.exports = { openStore, problem };
