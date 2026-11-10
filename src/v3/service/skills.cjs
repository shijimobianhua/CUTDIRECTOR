'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { crc32 } = require('node:zlib');
const YAML = require('yaml');
const yauzl = require('yauzl');
const yazl = require('yazl');

const MiB = 1024 * 1024;
const maxRaw = 10 * MiB;
const maxText = 4 * MiB;
const maxFile = MiB;
const maxEntries = 256;
const stages = new Set(['brief', 'storyboard', 'frames', 'review', 'generation', 'arrangement', 'handoff']);
const roles = new Set(['planner', 'image', 'visual-qa', 'video', 'roughcut', 'editor']);
const manifestKeys = new Set(['schemaVersion', 'skillId', 'version', 'stages', 'roles', 'capabilities',
  'inputKinds', 'outputKinds', 'scopes', 'requestedPermissions', 'suggestedExecutor', 'references']);

function issue(code, status = 422) {
  return Object.assign(new Error(code), { code, status });
}

function check(valid, code) {
  if (!valid) throw issue(code);
}

function safePath(value, directory = false) {
  check(typeof value === 'string' && value.length > 0 && value.length < 250 && !/[\\:\x00-\x1f\x7f<>?"*|]/.test(value), 'SKILL_UNSAFE_PATH');
  const path = (directory ? value.replace(/\/$/, '') : value).normalize('NFC');
  check(path.split('/').every(part => part && !/[. ]$/.test(part) && part !== '.' && part !== '..' &&
    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)), 'SKILL_UNSAFE_PATH');
  check(path.split('/').length <= 8, 'SKILL_UNSAFE_PATH');
  check(!/\.(zip|7z|rar|tar|tgz|gz|bz2|xz|zst|cab|iso)$/i.test(path), 'SKILL_NESTED_ARCHIVE');
  return path;
}

function supported(path) {
  return /(?:^|\/)(SKILL\.md|cutdirector\.skill\.json|LICEN[CS]E(?:\.(md|txt))?)$/i.test(path) ||
    /(?:^|\/)references\/.+\.(md|txt)$/i.test(path);
}

async function zipEntries(buffer) {
  try {
    const zip = await yauzl.fromBufferPromise(buffer, { strictFileNames: true, validateEntrySizes: true });
    const entries = [];
    let expanded = 0;
    let accepted = 0;
    const deadline = Date.now() + 8000;
    try {
      for await (const entry of zip.eachEntry()) {
        const isDirectory = entry.fileName.endsWith('/');
        const path = safePath(entry.fileName, isDirectory);
        const attributes = entry.externalFileAttributes;
        const type = (attributes >>> 16) & 0xf000;
        check(!(attributes & 0x400) && !(entry.generalPurposeBitFlag & 1) &&
          [0, isDirectory ? 0x4000 : 0x8000].includes(type), 'SKILL_UNSAFE_ENTRY');
        expanded += entry.uncompressedSize;
        check(Date.now() <= deadline && entries.length < maxEntries && expanded <= 50 * MiB &&
          entry.uncompressedSize <= Math.max(entry.compressedSize, 1) * 200, 'SKILL_LIMIT');
        let bytes;
        if (!isDirectory && supported(path)) {
          accepted += entry.uncompressedSize;
          check(entry.uncompressedSize <= maxFile && accepted <= maxText, 'SKILL_LIMIT');
          const stream = await zip.openReadStreamPromise(entry);
          const chunks = [];
          for await (const chunk of stream) {
            check(Date.now() <= deadline, 'SKILL_LIMIT');
            chunks.push(chunk);
          }
          bytes = Buffer.concat(chunks);
          check(crc32(bytes) === entry.crc32, 'SKILL_BAD_ZIP');
        }
        entries.push({ path, directory: isDirectory, bytes });
      }
      return entries;
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error.status) throw error;
    throw issue('SKILL_BAD_ZIP');
  }
}

function folderEntries(raw) {
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw issue('SKILL_INVALID_TEXT');
  }
  check(Array.isArray(value) && value.length <= maxEntries, 'SKILL_LIMIT');
  return value.map(entry => {
    const path = safePath(entry?.path);
    if (!supported(path)) return { path };
    check(typeof entry.text === 'string' && Buffer.byteLength(entry.text) <= maxFile, 'SKILL_LIMIT');
    return { path, bytes: Buffer.from(entry.text, 'utf8') };
  });
}

function decode(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    check(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), 'SKILL_INVALID_TEXT');
    return text.replace(/\r\n?/g, '\n');
  } catch {
    throw issue('SKILL_INVALID_TEXT');
  }
}

function description(text) {
  const head = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  check(head && head[1].length <= 16000, 'SKILL_BAD_FRONTMATTER');
  let meta;
  try {
    const doc = YAML.parseDocument(head[1], { schema: 'core', customTags: [], merge: false, uniqueKeys: true });
    check(!doc.errors.length && !doc.warnings.length, 'SKILL_BAD_FRONTMATTER');
    YAML.visit(doc, { Alias() { throw issue('SKILL_BAD_FRONTMATTER'); } });
    meta = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw issue('SKILL_BAD_FRONTMATTER');
  }
  check(meta && typeof meta.name === 'string' && meta.name.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name), 'SKILL_BAD_NAME');
  check(typeof meta.description === 'string' && meta.description.trim().length > 0 &&
    meta.description.length <= 1024, 'SKILL_BAD_FRONTMATTER');
  for (const [key, size] of [['license', 500], ['compatibility', 500], ['allowed-tools', 1000]]) {
    check(meta[key] == null || (typeof meta[key] === 'string' && meta[key].length <= size), 'SKILL_BAD_FRONTMATTER');
  }
  return { name: meta.name, description: meta.description.trim(), license: meta.license || '',
    compatibility: meta.compatibility || '', declaredTools: meta['allowed-tools'] || '',
    body: text.slice(head[0].length).trim() };
}

function parseManifest(raw, files) {
  if (!raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch { throw issue('SKILL_BAD_MANIFEST'); }
  check(value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 1 &&
    Object.keys(value).every(key => manifestKeys.has(key)), 'SKILL_BAD_MANIFEST');
  for (const key of ['skillId', 'version', 'suggestedExecutor']) {
    check(value[key] == null || (typeof value[key] === 'string' && value[key].length <= 120 && value[key].trim()), 'SKILL_BAD_MANIFEST');
  }
  for (const key of ['stages', 'roles', 'capabilities', 'inputKinds', 'outputKinds', 'scopes', 'requestedPermissions', 'references']) {
    if (value[key] == null) continue;
    const list = value[key];
    check(Array.isArray(list) && list.length <= 40 && new Set(list).size === list.length &&
      list.every(item => typeof item === 'string' && item.length <= 200 && item.trim()), 'SKILL_BAD_MANIFEST');
  }
  check((value.stages || []).every(stage => stages.has(stage)) && (value.roles || []).every(role => roles.has(role)) &&
    (value.scopes || []).every(scope => ['project', 'profile'].includes(scope)) &&
    (value.references || []).every(ref => /^references\//.test(ref) && Object.hasOwn(files, ref)), 'SKILL_BAD_MANIFEST');
  return value;
}

function validateEntries(entries) {
  const seen = new Set();
  let size = 0;
  for (const entry of entries) {
    const lower = entry.path.toLowerCase();
    check(!seen.has(lower), 'SKILL_DUPLICATE_PATH');
    seen.add(lower);
    size += entry.bytes?.length || 0;
  }
  check(size <= maxText, 'SKILL_LIMIT');
  const mains = entries.filter(entry => !entry.directory && /(?:^|\/)SKILL\.md$/.test(entry.path));
  check(mains.length === 1 && mains[0].bytes, 'SKILL_MISSING_MAIN');
  const prefix = mains[0].path.slice(0, -'SKILL.md'.length);
  check(!prefix || /^[^/]+\/$/.test(prefix), 'SKILL_UNSAFE_PATH');
  const files = Object.create(null);
  const ignored = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    check(!prefix || entry.path.startsWith(prefix), 'SKILL_MULTIPLE_ROOTS');
    const path = entry.path.slice(prefix.length);
    if (entry.bytes && (['SKILL.md', 'cutdirector.skill.json'].includes(path) ||
        /^LICEN[CS]E(?:\.(md|txt))?$/i.test(path) || /^references\/.+\.(md|txt)$/i.test(path))) {
      files[path] = decode(entry.bytes);
    } else ignored.push(path);
  }
  const { body, ...info } = description(files['SKILL.md']);
  check(!prefix || prefix === info.name + '/', 'SKILL_BAD_NAME');
  const manifest = parseManifest(files['cutdirector.skill.json'], files);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  return { ...info, manifest, hash, files: sorted, ignored };
}

function sensitive(files) {
  return Object.entries(files).filter(([, value]) =>
    /(?:(?:^|[\s"'(])(?:[a-zA-Z]:[\\/]|\/(?:Users|home)\/|\\\\[^\s\\]+\\)|\b(?:sk-[\w-]{16,}|AKIA[0-9A-Z]{16}|Bearer\s+[\w.-]{16,})\b|-----BEGIN [\w ]*PRIVATE KEY-----)/i.test(value)
  ).map(([name]) => name);
}

async function encodeZip(name, files) {
  const zip = new yazl.ZipFile();
  for (const [file, value] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(value, 'utf8'), name + '/' + file, { mtime: new Date('2000-01-01T00:00:00Z') });
  }
  zip.end();
  const parts = [];
  for await (const chunk of zip.outputStream) parts.push(chunk);
  return Buffer.concat(parts);
}

function createSkills(db, project) {
  const previews = new Map();
  const ttl = 15 * 60 * 1000;

  function get(hash) {
    const record = db.prepare('SELECT * FROM skill_versions WHERE hash = ?').get(hash);
    if (!record) throw issue('SKILL_NOT_FOUND', 404);
    return record;
  }

  function list() {
    const rows = db.prepare(`SELECT v.hash, v.name, v.descriptor, v.created_at, a.hash AS active, a.enabled
      FROM skill_versions v LEFT JOIN skill_active a ON v.name = a.name ORDER BY v.rowid DESC`).all();
    return rows.map(({ descriptor, active, enabled, ...row }) => ({
      ...row, ...JSON.parse(descriptor), active: active === row.hash, enabled: active === row.hash && !!enabled,
    }));
  }

  async function preview(kind, raw) {
    check(Buffer.isBuffer(raw) && raw.length <= maxRaw, 'SKILL_LIMIT');
    const entries = kind === 'zip' ? await zipEntries(raw)
      : kind === 'folder' ? folderEntries(raw) : [{ path: 'SKILL.md', bytes: raw }];
    if (kind === 'text') check(raw.length <= maxFile, 'SKILL_LIMIT');
    const draft = validateEntries(entries);
    const now = Date.now();
    for (const [id, value] of previews) if (value.expires <= now) previews.delete(id);
    if (previews.size >= 6) previews.delete(previews.keys().next().value);
    const id = randomUUID();
    previews.set(id, { draft, expires: now + ttl });
    const { files, ...meta } = draft;
    const other = list().filter(row => row.name === draft.name);
    return { id, ...meta, bodyPreview: description(files['SKILL.md']).body.slice(0, 12000), files: Object.keys(files), duplicate: other.some(row => row.hash === draft.hash),
      previousVersions: other.map(row => ({ hash: row.hash, created_at: row.created_at })), sensitive: sensitive(files) };
  }

  function install(id) {
    const entry = previews.get(id);
    if (!entry || entry.expires <= Date.now()) throw issue('SKILL_PREVIEW_EXPIRED', 404);
    if (entry.installed) return entry.installed;
    const { files, ignored, ...meta } = entry.draft;
    db.exec('BEGIN IMMEDIATE');
    try {
      const old = db.prepare('SELECT 1 FROM skill_versions WHERE hash = ?').get(meta.hash);
      if (!old) {
        check(db.prepare('SELECT COUNT(*) AS n FROM skill_versions').get().n < 200, 'SKILL_LIMIT');
        db.prepare('INSERT INTO skill_versions VALUES (?, ?, ?, ?, ?)').run(meta.hash, meta.name,
          JSON.stringify(meta), JSON.stringify(files), new Date().toISOString());
        db.prepare(`INSERT INTO skill_active VALUES (?, ?, 1)
          ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, enabled = 1`).run(meta.name, meta.hash);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    entry.installed = list().find(row => row.hash === meta.hash);
    return entry.installed;
  }

  function activate(hash, enabled) {
    const record = get(hash);
    if (!enabled) {
      db.prepare('UPDATE skill_active SET enabled = 0 WHERE name = ? AND hash = ?').run(record.name, hash);
    } else {
      db.prepare(`INSERT INTO skill_active VALUES (?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, enabled = 1`).run(record.name, hash);
    }
    return list().find(row => row.hash === hash);
  }

  function preference(projectId, input) {
    project(projectId);
    if (input === undefined) {
      return { hash: db.prepare('SELECT hash FROM skill_preferences WHERE project_id = ?').get(projectId)?.hash || null };
    }
    if (input === null) {
      db.prepare('DELETE FROM skill_preferences WHERE project_id = ?').run(projectId);
    } else {
      get(input);
      check(list().some(row => row.hash === input && row.enabled), 'SKILL_DISABLED');
      db.prepare(`INSERT INTO skill_preferences VALUES (?, ?)
        ON CONFLICT(project_id) DO UPDATE SET hash = excluded.hash`).run(projectId, input);
    }
    return { hash: input };
  }

  function exportInfo(hash) {
    const record = get(hash);
    const files = JSON.parse(record.files);
    return { name: record.name, files: Object.keys(files), sensitive: sensitive(files) };
  }

  async function exportZip(hash) {
    const record = get(hash);
    const files = JSON.parse(record.files);
    check(!sensitive(files).length, 'SKILL_EXPORT_PRIVATE');
    const zip = await encodeZip(record.name, files);
    return { name: record.name + '.zip', bytes: zip.toString('base64') };
  }

  function route(projectId, choice, stage, allowModel) {
    if (!choice) return null;
    const hash = choice === 'project' ? preference(projectId).hash : choice;
    if (!hash) return null;
    const row = list().find(skill => skill.hash === hash && skill.enabled);
    if (!row) return { hash, state: 'disabled' };
    const receipt = { hash, name: row.name, stage };
    const rule = row.manifest;
    if (rule?.stages?.length && !rule.stages.includes(stage)) return { ...receipt, state: 'stage-mismatch' };
    if (stage === 'frames' && rule?.roles?.includes('image')) {
      try {
        imageMethod(hash);
        return { ...receipt, state: 'confirmation-required', role: 'image', executor: 'seedream' };
      } catch (error) {
        return { ...receipt, state: error.code === 'SKILL_EXPORT_PRIVATE' ? 'private-text' : 'executor-missing' };
      }
    }
    if(stage==='generation'&&rule?.roles?.includes('video')){
      try{videoMethod(hash);return {...receipt,state:'confirmation-required',role:'video',executor:'seedance'};}
      catch(error){return {...receipt,state:error.code==='SKILL_EXPORT_PRIVATE'?'private-text':'executor-missing'};}
    }
    if(stage==='review'&&rule?.roles?.includes('visual-qa')){
      try{checklist(hash,'visual-qa');return {...receipt,state:'confirmation-required',role:'visual-qa',executor:'user'};}
      catch{return {...receipt,state:'executor-missing'};}
    }
    if(stage==='handoff'&&rule?.roles?.includes('editor')){
      try{checklist(hash,'editor');return {...receipt,state:'confirmation-required',role:'editor',executor:'user'};}
      catch{return {...receipt,state:'executor-missing'};}
    }
    const roughcut=stage==='arrangement'&&rule?.roles?.includes('roughcut');
    if (rule?.roles?.length && !rule.roles.includes('planner')&&!roughcut) return { ...receipt, state: 'executor-missing' };
    if (rule?.capabilities?.some(capability => !['text-advice',...(roughcut?['roughcut-proposal']:[])].includes(capability))) return { ...receipt, state: 'executor-missing' };
    if (['frames', 'review', 'generation', 'handoff'].includes(stage) && rule?.roles?.length) {
      return { ...receipt, state: 'executor-missing' };
    }
    if (!allowModel) return { ...receipt, state: 'model-required' };
    const files = JSON.parse(get(hash).files);
    if (sensitive(files).length) return { ...receipt, state: 'private-text' };
    const body = description(files['SKILL.md']).body;
    const references = (rule?.references || []).map(path => ({ path, text: files[path].slice(0, 2500) })).slice(0, 4);
    return { ...receipt, state: 'matched', role: roughcut?'roughcut':'planner', method: { body: body.slice(0, 8000), references } };
  }

  function imageMethod(hash) {
    const row = list().find(skill => skill.hash === hash && skill.enabled);
    check(!!row, 'SKILL_DISABLED');
    const rule = row.manifest;
    check(rule?.roles?.includes('image') &&
      (!rule.stages?.length || rule.stages.includes('frames')) &&
      !(rule.capabilities || []).some(value => !['image-generation', 'text-advice'].includes(value)) &&
      (!rule.suggestedExecutor || ['seedream', 'ark-image', 'ark'].includes(rule.suggestedExecutor)),
    'IMAGE_METHOD_UNAVAILABLE');
    const files = JSON.parse(get(hash).files);
    check(!sensitive(files).length, 'SKILL_EXPORT_PRIVATE');
    return { hash, name: row.name, body: description(files['SKILL.md']).body.slice(0, 1200) };
  }

  function videoMethod(hash){
    const row=list().find(skill=>skill.hash===hash&&skill.enabled),rule=row?.manifest;
    check(rule?.roles?.includes('video')&&(!rule.stages?.length||rule.stages.includes('generation'))&&
      !(rule.capabilities||[]).some(value=>!['video-generation','text-advice'].includes(value))&&
      (!rule.suggestedExecutor||['seedance','ark-video','ark'].includes(rule.suggestedExecutor)),'VIDEO_METHOD_UNAVAILABLE');
    const files=JSON.parse(get(hash).files);check(!sensitive(files).length,'SKILL_EXPORT_PRIVATE');
    return {hash,name:row.name,body:description(files['SKILL.md']).body.slice(0,1200)};
  }
  function checklist(hash,role){
    check(['visual-qa','editor'].includes(role),'SKILL_CHECKLIST_UNAVAILABLE');
    const row=list().find(skill=>skill.hash===hash&&skill.enabled),rule=row?.manifest;
    const stage=role==='visual-qa'?'review':'handoff';
    check(rule?.roles?.includes(role)&&(!rule.stages?.length||rule.stages.includes(stage))&&
      !(rule.capabilities||[]).some(value=>!['text-advice','manual-review',...(role==='editor'?['draft-handoff']:[])].includes(value)),
      'SKILL_CHECKLIST_UNAVAILABLE');
    const files=JSON.parse(get(hash).files);check(!sensitive(files).length,'SKILL_EXPORT_PRIVATE');
    return {hash,name:row.name,role,executor:'user',body:description(files['SKILL.md']).body.slice(0,8000)};
  }
  function promptMethod(hash,stage){
    const row=list().find(s=>s.hash===hash&&s.enabled),rule=row?.manifest;check(!!row,'SKILL_DISABLED');check(!rule?.stages?.length||rule.stages.includes(stage),'SKILL_EXECUTOR_MISMATCH');
    const files=JSON.parse(get(hash).files);check(!sensitive(files).length,'SKILL_EXPORT_PRIVATE');return {hash,name:row.name,state:'matched',stage,role:'prompt-preparation',targetExecutor:rule?.suggestedExecutor||null,method:{body:description(files['SKILL.md']).body.slice(0,8000),references:(rule?.references||[]).slice(0,4).map(path=>({path,text:files[path].slice(0,2500)}))}};
  }
  function forExecutor(hash,role,executor,model=''){
    const row=list().find(s=>s.hash===hash&&s.enabled),rule=row?.manifest;
    check(!!row,'SKILL_DISABLED');check(rule?.roles?.includes(role),'SKILL_EXECUTOR_MISMATCH');
    const stage=role==='image'?'frames':role==='video'?'generation':'review';check(!rule.stages?.length||rule.stages.includes(stage),'SKILL_EXECUTOR_MISMATCH');
    const aliases={seedream:'ark-image',seedance:'ark-video',ark:role==='image'?'ark-image':'ark-video'};const preferred=aliases[rule.suggestedExecutor]||rule.suggestedExecutor;
    check(!preferred||preferred==='any'||preferred===executor||preferred==='h3'&&['runninghub','comfyui'].includes(executor),'SKILL_EXECUTOR_MISMATCH');
    const files=JSON.parse(get(hash).files);check(!sensitive(files).length,'SKILL_EXPORT_PRIVATE');
    return {hash,name:row.name,role,stage,executor,body:description(files['SKILL.md']).body.slice(0,4000)};
  }
  return { list, preview, install, activate, preference, exportInfo, exportZip, route, imageMethod,videoMethod,checklist,forExecutor,promptMethod };
}

module.exports = { createSkills, maxRaw };
