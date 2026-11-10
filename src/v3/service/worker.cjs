'use strict';

const { createServer } = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { isAbsolute } = require('node:path');
const { openStore, problem } = require('./store.cjs');
const { ingest, serve } = require('./media.cjs');
const { createDraftAdapter, servePack } = require('./delivery.cjs');
const { maxRaw } = require('./skills.cjs');
const { createGeneration } = require('./generation.cjs');
const { createImageGeneration } = require('./image-generation.cjs');
const { createLegacyWriter } = require('../legacy/writer.cjs');
const { createLegacyImport } = require('../legacy/import.cjs');
const { legacyRoutes } = require('../legacy/routes.cjs');
const { createReferenceAnalyzer } = require('./reference-analyzer.cjs');
const { readPublic } = require('./public-source.cjs');
const { probeCapability } = require('./capability-probe.cjs');
const { createBatchRunner } = require('./batches.cjs');
const { acquireLease } = require('./lease.cjs');
const { createNativeConnection } = require('./native-connection.cjs');

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBytes(req, limit) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw problem('REQUEST_TOO_LARGE', 413);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

async function readJson(req, limit = 16384) {
  if (req.headers['content-type'] !== 'application/json') throw problem('INVALID_INPUT', 400);
  const bytes = await readBytes(req, limit);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw problem('INVALID_INPUT', 400);
  }
}

function start({ secret, root, handoff, legacyRoot }) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret) || !isAbsolute(root)) {
    throw new Error('Invalid worker configuration');
  }
  const lease=acquireLease(root);
  let store;
  try{store=openStore(root);}catch(error){lease.release();throw error;}
  const analyzer=createReferenceAnalyzer(root,store.references);
  const key = Buffer.from(secret);
  let adapter=createDraftAdapter(root,handoff);
  const native=createNativeConnection(store,root,handoff,config=>{adapter=createDraftAdapter(root,config);});
  adapter=createDraftAdapter(root,native.runtime());
  const generation = createGeneration(store, root);
  const imageGeneration = createImageGeneration(store, root);
  const batchRunner=createBatchRunner(store.batches,imageGeneration,generation);
  const legacy = createLegacyWriter(legacyRoot, root);
  const legacyImport = createLegacyImport(legacy, store, root);
  const handleLegacy = legacyRoutes(legacy, legacyImport, readJson, send);
  const studioRoutes=require('./studio-routes.cjs').createStudioRoutes(store,root,readJson,readBytes,send);

  async function reconcile(projectId, job) {
    if (!['writing', 'uncertain'].includes(job.state) || adapter.isActive(job.id)) return job;
    try {
      const result = await adapter.status(job);
      if (result) return store.transitionDraft(projectId, job.id, job.state, 'created', result);
    } catch {
      // A missing or unreadable library cannot prove that the write did not happen.
    }
    return store.transitionDraft(projectId, job.id, job.state, 'uncertain', { error: 'DRAFT_REGISTRATION_UNCERTAIN' });
  }

  async function approve(projectId, id) {
    let job = store.draft(projectId, id);
    if (job.state !== 'awaiting_approval') return reconcile(projectId, job);
    const ready = await adapter.probe();
    if (ready.target !== job.target || ready.version !== job.editor_version) throw problem('DRAFT_TARGET_CHANGED', 409);
    job = store.draft(projectId, id);
    if (job.state !== 'awaiting_approval') return reconcile(projectId, job);
    store.registry.requireEnabled('cutdirector-jianying');
    const manifest = store.handoff(projectId, job.version);
    store.transitionDraft(projectId, id, 'awaiting_approval', 'writing');
    try {
      const result = await adapter.write(job, manifest);
      return store.transitionDraft(projectId, id, 'writing', 'created', result);
    } catch (error) {
      const known = ['EDITOR_OPEN', 'EDITOR_UNVERIFIED', 'DRAFT_WRITER_BUSY', 'HANDOFF_MEDIA_CHANGED',
        'DRAFT_DURATION_MISMATCH', 'DRAFT_STRUCTURE_MISMATCH', 'DRAFT_MEDIA_MISSING'];
      if (known.includes(error.code)) {
        return store.transitionDraft(projectId, id, 'writing', 'failed', { error: error.code });
      }
      return reconcile(projectId, store.draft(projectId, id));
    }
  }
  const server = createServer(async (req, res) => {
    const proof = Buffer.from(req.headers['x-cutdirector-worker'] || '');
    if (req.headers.host !== '127.0.0.1:' + server.address().port ||
        proof.length !== key.length || !timingSafeEqual(key, proof)) {
      return send(res, 403, { error: { code: 'FORBIDDEN' } });
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (await studioRoutes.handle(req,res,url)) return;
      if (await handleLegacy(req, res, url)) return;
      const versionRoute = /^\/projects\/([a-f0-9-]{36})\/(story|arrangement)\/(versions(?:\/(\d+))?|restore|undo)$/.exec(url.pathname);
      if(versionRoute) {
        const [,projectId,kind,action,number]=versionRoute;
        if(req.method==='GET' && action.startsWith('versions'))return send(res,200,{data:number
          ? store.versions.snapshot(projectId,kind,Number(number))
          : store.versions.list(projectId,kind,url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined)});
        if(req.method==='POST' && ['restore','undo'].includes(action))return send(res,200,{data:store.versions[action](projectId,kind,await readJson(req))});
      }
      if(url.pathname==='/plugins/probe'&&req.method==='POST')return send(res,200,{data:await probeCapability(store,adapter,await readJson(req))});
      if(url.pathname==='/editor-settings'&&req.method==='GET')return send(res,200,{data:native.view()});
      if(url.pathname==='/editor-settings'&&req.method==='POST')return send(res,200,{data:await native.action(await readJson(req))});
      const ideaFiles=/^\/ideas\/([a-f0-9-]{36})\/files(?:\/([a-f0-9-]{36})\/(content|use))?$/.exec(url.pathname);
      if(ideaFiles){const [,ideaId,id,action]=ideaFiles;
       if(!id&&req.method==='GET')return send(res,200,{data:store.ideaFiles.list(ideaId)});
       if(action==='content'&&['GET','HEAD'].includes(req.method))return serve(req,res,root,store.ideaFiles.file(ideaId,id));
       if(action==='use'&&req.method==='POST')return send(res,200,{data:store.ideaFiles.use(ideaId,id,await readJson(req))});
       if(!id&&req.method==='POST')return send(res,200,{data:await ingest(req,root,store.ideaFiles.ingestStore,ideaId,url.searchParams.get('commandId'),url.searchParams.get('name'),undefined,url.searchParams.get('kind')==='image')});
      }
      const visual=/^\/projects\/([a-f0-9-]{36})\/visual-reviews(?:\/([a-f0-9-]{36})\/(claim|inputs|guard|finish|cancel))?$/.exec(url.pathname);
      if(visual){const [,projectId,id,action]=visual;
       if(req.method==='GET')return send(res,200,{data:store.visual.list(projectId)});
       if(req.method==='POST'){const input=await readJson(req,150000);return send(res,200,{data:await (id?store.visual[action](projectId,id,input):store.visual.prepare(projectId,input))});}
      }
      if(url.pathname==='/extensions'&&req.method==='GET')return send(res,200,{data:store.extensions.list()});
      if(url.pathname==='/extensions/entry'&&req.method==='POST')return send(res,200,{data:store.extensions.entry((await readJson(req)).pluginId)});
      if(url.pathname==='/extensions/probe'&&req.method==='POST'){const input=await readJson(req);return send(res,200,{data:store.registry.probe(input.pluginId,input.result)});}
      if(['/extensions/register','/extensions/select'].includes(url.pathname)&&req.method==='POST')return send(res,200,{data:store.extensions[url.pathname.split('/').at(-1)](await readJson(req,128000))});
      const extension=/^\/projects\/([a-f0-9-]{36})\/extension-jobs(?:\/([a-f0-9-]{36})\/(claim|inputs|claimCheck|collect|finish|cancel))?$/.exec(url.pathname);
      if(extension){const [,projectId,id,action]=extension;
       if(req.method==='GET')return send(res,200,{data:store.extensions.jobs(projectId)});
       if(req.method==='POST'){const input=await readJson(req,150000);return send(res,200,{data:await (id?store.extensions[action](projectId,id,input):store.extensions.prepare(projectId,input))});}
      }
      const beat=/^\/projects\/([a-f0-9-]{36})\/arrangement\/beat-preview$/.exec(url.pathname);
      if(beat&&req.method==='POST'){store.registry.requireEnabled('cutdirector-beatcut');return send(res,200,{data:require('./beatcut.cjs').beatPreview(store.arrangement(beat[1]),store.projectAssets(beat[1]),await readJson(req))});}
      const ideaChat=/^\/ideas\/([a-f0-9-]{36})\/chats(?:\/([a-f0-9-]{36})\/(turns|finish)(?:\/([a-f0-9-]{36})\/(apply|undo))?)?$/.exec(url.pathname);
      if(ideaChat){const [,ideaId,id,action,turnId,operation]=ideaChat;
        if(req.method==='GET')return send(res,200,{data:id?store.ideaChat.turns(ideaId,id):store.ideaChat.list(ideaId)});
        if(req.method==='POST'){const input=await readJson(req,32000);return send(res,200,{data:!id?store.ideaChat.open(ideaId,input):operation?store.ideaChat[operation](ideaId,id,turnId,input):store.ideaChat[action==='finish'?'finish':'start'](ideaId,id,input)});}
      }
      const candidates=/^\/projects\/([a-f0-9-]{36})\/candidates$/.exec(url.pathname);
      if(candidates&&req.method==='GET')return send(res,200,{data:store.candidates.list(candidates[1],{kind:url.searchParams.get('kind'),shotId:url.searchParams.get('shotId'),before:Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER)})});
      const search=/^\/projects\/([a-f0-9-]{36})\/reference-searches(?:\/([a-f0-9-]{36})\/(claim|finish))?$/.exec(url.pathname);
      if(search){
        const [,projectId,id,action]=search;
        if(!id&&req.method==='GET')return send(res,200,{data:store.searches.list(projectId)});
        if(req.method==='POST'){const input=await readJson(req,128000);return send(res,200,{data:!id?store.searches.prepare(projectId,input):store.searches[action](projectId,id,input)});}
      }
      const batch=/^\/projects\/([a-f0-9-]{36})\/batches(?:\/([a-f0-9-]{36})\/(approve|cancel))?$/.exec(url.pathname);
      if(batch){
        const [,projectId,id,action]=batch;
        if(!id&&req.method==='GET')return send(res,200,{data:store.batches.list(projectId)});
        if(req.method==='POST'){
          const input=await readJson(req,20000);
          return send(res,200,{data:!id?store.batches.prepare(projectId,input):action==='approve'?batchRunner.start(projectId,id,input):store.batches.cancel(projectId,id)});
        }
      }
      const quality=/^\/projects\/([a-f0-9-]{36})\/quality$/.exec(url.pathname);
      if(quality&&req.method==='GET')return send(res,200,{data:store.quality.list(quality[1])});
      if(quality&&req.method==='POST')return send(res,200,{data:store.quality.add(quality[1],await readJson(req))});
      if(url.pathname==='/templates'&&req.method==='GET')return send(res,200,{data:store.workflows.templates()});
      if(url.pathname==='/templates'&&req.method==='POST'){const input=await readJson(req,100000);return send(res,200,{data:input.confirm===true?store.workflows.importTemplate(input.template):store.workflows.preview(input.template)});}
      const workflow=/^\/projects\/([a-f0-9-]{36})\/workflow(?:\/(undo))?$/.exec(url.pathname);
      if(workflow&&req.method==='GET')return send(res,200,{data:store.workflows.status(workflow[1])});
      if(workflow&&req.method==='POST')return send(res,200,{data:store.workflows[workflow[2]?'undo':'save'](workflow[1],await readJson(req,100000))});
      if(url.pathname==='/plugins'&&req.method==='GET')return send(res,200,{data:store.registry.list()});
      if(url.pathname==='/plugins/actions'&&req.method==='POST')return send(res,200,{data:store.registry.configure(await readJson(req))});
      const source=/^\/ideas\/([a-f0-9-]{36})\/sources(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
      if(source){
        const [,ideaId,sourceId]=source;
        if(req.method==='GET')return send(res,200,{data:sourceId?store.sources.get(ideaId,sourceId):store.sources.list(ideaId)});
        if(req.method==='POST'&&!sourceId){
          const input=await readJson(req,260000);
          if(input.confirm!==true)throw problem('SOURCE_READ_APPROVAL_REQUIRED',403);
          const base=store.sources.idea(ideaId);
          let value;
          if(input.action==='read'){
            if(!base.url)throw problem('SOURCE_URL_INVALID',422);
            value=await readPublic(base.url);
          }else if(input.action==='attachment'&&typeof input.name==='string'&&/^[^\\/\x00-\x1f]{1,120}\.(txt|md|srt)$/i.test(input.name)&&typeof input.text==='string'&&input.text.length<=64000){
            value={title:input.name,text:input.text,kind:'text-attachment'};
          }else throw problem('INVALID_INPUT',400);
          return send(res,200,{data:store.sources.add(ideaId,input,value)});
        }
      }
      const reference=/^\/projects\/([a-f0-9-]{36})\/reference-files(?:\/([a-f0-9-]{36})\/(content|analysis|use|frames\/(\d+)))?$/.exec(url.pathname);
      if(reference){
        const [,projectId,id,action,number]=reference;
        if(!id&&req.method==='GET')return send(res,200,{data:store.references.files(projectId)});
        if(!id&&req.method==='POST')return send(res,200,{data:await ingest(req,root,store.references.ingestStore,projectId,url.searchParams.get('commandId'),url.searchParams.get('name'),undefined,url.searchParams.get('kind')==='image')});
        if(action==='content'&&['GET','HEAD'].includes(req.method))return serve(req,res,root,store.references.file(projectId,id));
        if(action==='analysis'&&req.method==='GET')return send(res,200,{data:store.references.analysis(projectId,id)});
        if(action==='analysis'&&req.method==='POST'){store.registry.requireEnabled('cutdirector-reference-ffmpeg');return send(res,200,{data:await analyzer.analyze(projectId,id,await readJson(req))});}
        if(action==='use'&&req.method==='POST')return send(res,200,{data:store.references.use(projectId,id,await readJson(req))});
        if(number&&['GET','HEAD'].includes(req.method)){
          const frame=store.references.analysis(projectId,id)?.frames.find(frame=>frame.number===Number(number));
          if(!frame)throw problem('REFERENCE_NOT_FOUND',404);
          return serve(req,res,root,frame);
        }
      }
      const run=/^\/projects\/([a-f0-9-]{36})\/chats\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})\/(begin|read|finish|cancel)$/.exec(url.pathname);
      if(run&&req.method==='POST'){
        const [,projectId,chatId,turnId,action]=run;
        return send(res,200,{data:store.runtime[action](projectId,chatId,turnId,await readJson(req))});
      }
      const feedback=/^\/projects\/([a-f0-9-]{36})\/feedback(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
      if(feedback&&req.method==='GET'&&!feedback[2])return send(res,200,{data:store.knowledge.list(feedback[1])});
      if(feedback&&req.method==='POST')return send(res,200,{data:feedback[2]?store.knowledge.change(feedback[1],feedback[2],await readJson(req)):store.knowledge.add(feedback[1],await readJson(req))});
      const ideaRoute = /^\/ideas(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
      if(ideaRoute && req.method==='GET')return send(res,200,{data:ideaRoute[1]?store.ideas.detail(ideaRoute[1]):store.ideas.list(Object.fromEntries(url.searchParams))});
      if(ideaRoute?.[1] && req.method==='POST')return send(res,200,{data:store.ideas.update(ideaRoute[1],await readJson(req))});
      const references = /^\/projects\/([a-f0-9-]{36})\/references$/.exec(url.pathname);
      if(references && req.method==='GET')return send(res,200,{data:store.ideas.links(references[1],url.searchParams.get('all')==='true')});
      if(references && req.method==='POST')return send(res,200,{data:store.ideas.link(references[1],await readJson(req))});
      if (url.pathname === '/views' && req.method === 'GET') return send(res, 200, { data: store.workspace.get(url.searchParams.get('scope')) });
      if (url.pathname === '/views' && req.method === 'POST') return send(res, 200, { data: store.workspace.save(await readJson(req, 5*1024*1024)) });
      if (url.pathname === '/task-summary' && req.method === 'GET') return send(res, 200, {data:store.activity.summary()});
      if (url.pathname === '/tasks' && req.method === 'GET') return send(res, 200, { data: store.activity.tasks({projectId:url.searchParams.get('projectId'),cursor:url.searchParams.get('cursor'),group:url.searchParams.get('group')}) });
      if (url.pathname === '/events' && req.method === 'GET') return send(res, 200, { data: store.activity.events(url.searchParams.get('projectId'), Number(url.searchParams.get('after') || 0)) });
      const imageReconnect=/^\/projects\/([a-f0-9-]{36})\/images\/([a-f0-9-]{36})\/reconnect$/.exec(url.pathname);
      if(imageReconnect&&req.method==='POST'){const [,projectId,id]=imageReconnect;return send(res,200,{data:await ingest(req,root,store.imageRepairs.ingestStore(projectId,id),projectId,url.searchParams.get('commandId'),store.image(projectId,id).name,undefined,true)});}
      const reconnect=/^\/projects\/([a-f0-9-]{36})\/assets\/([a-f0-9-]{36})\/reconnect$/.exec(url.pathname);
      if(reconnect&&req.method==='POST'){
        const [,projectId,id]=reconnect,expected=store.asset(projectId,id);
        return send(res,200,{data:await ingest(req,root,store.repairs.ingestStore(projectId,id),projectId,url.searchParams.get('commandId'),expected.name)});
      }
      const collection = /^\/projects\/([a-f0-9-]{36})\/assets$/.exec(url.pathname);
      const item = /^\/projects\/([a-f0-9-]{36})\/assets\/([a-f0-9-]{36})\/content$/.exec(url.pathname);
      if (url.pathname === '/generation-settings') {
        if (req.method === 'GET') return send(res, 200, { data: generation.config() });
        if (req.method === 'POST') {
          const body = await readJson(req, 4096);
          const data = body?.action === 'disable' ? generation.disable() : await generation.save(body);
          return send(res, 200, { data });
        }
      }
      const task = /^\/projects\/([a-f0-9-]{36})\/generations(?:\/([a-f0-9-]{36})\/(approve|check|pause|resume))?$/.exec(url.pathname);
      if (task) {
        const [, projectId, id, action] = task;
        if (!id && req.method === 'GET') return send(res, 200, { data: generation.list(projectId) });
        if (req.method === 'POST') {
          const input = await readJson(req, 12000);
          if(!id||action==='approve')store.registry.requireEnabled('cutdirector-seedance');
          const data = !id ? generation.prepare(projectId, input)
            : action === 'approve' ? await generation.approve(projectId, id, input)
              : action === 'check' ? await generation.check(projectId, id)
                : generation.pause(projectId, id, action === 'pause');
          return send(res, 200, { data });
        }
      }
      const imageTask = /^\/projects\/([a-f0-9-]{36})\/image-jobs(?:\/([a-f0-9-]{36})\/(approve|check))?$/.exec(url.pathname);
      if (imageTask) {
        const [, projectId, id, action] = imageTask;
        if (!id && req.method === 'GET') return send(res, 200, { data: imageGeneration.list(projectId) });
        if (req.method === 'POST') {
          const input = await readJson(req, 12000);
          if(!id||action==='approve')store.registry.requireEnabled('cutdirector-seedream');
          const data = !id ? imageGeneration.prepare(projectId, input)
            : action === 'approve' ? await imageGeneration.approve(projectId, id, input)
              : await imageGeneration.check(projectId, id);
          return send(res, 200, { data });
        }
      }
      const frame = /^\/projects\/([a-f0-9-]{36})\/images(?:\/([a-f0-9-]{36})\/content)?$/.exec(url.pathname);
      if (frame) {
        const [, projectId, imageId] = frame;
        if (!imageId && req.method === 'GET') return send(res, 200, { data: store.images(projectId) });
        if (!imageId && req.method === 'POST') {
          const data = await ingest(req, root, store, projectId, url.searchParams.get('commandId'), url.searchParams.get('name'), undefined, true);
          return send(res, 200, { data });
        }
        if (imageId && ['GET', 'HEAD'].includes(req.method)) return await serve(req, res, root, store.image(projectId, imageId));
      }
      const skill = /^\/skills(?:\/(preview\/(zip|folder|text)|install|([a-f0-9]{64})\/(enable|disable|export-info|download|checklist)))?$/.exec(url.pathname);
      if (skill) {
        const [, action, format, hash, operation] = skill;
        if (req.method === 'GET' && !action) return send(res, 200, { data: store.skills.list() });
        if (req.method === 'POST' && format) {
          if (req.headers['content-type'] !== 'application/octet-stream') throw problem('INVALID_INPUT', 400);
          return send(res, 200, { data: await store.skills.preview(format, await readBytes(req, maxRaw)) });
        }
        if (req.method === 'POST' && action === 'install') {
          return send(res, 200, { data: store.skills.install((await readJson(req))?.id) });
        }
        if (req.method === 'POST' && ['enable', 'disable'].includes(operation)) {
          return send(res, 200, { data: store.skills.activate(hash, operation === 'enable') });
        }
        if (req.method === 'GET' && operation === 'checklist') return send(res,200,{data:store.skills.checklist(hash,url.searchParams.get('role'))});
        if (req.method === 'GET' && operation === 'export-info') return send(res, 200, { data: store.skills.exportInfo(hash) });
        if (req.method === 'GET' && operation === 'download') {
          const archive = await store.skills.exportZip(hash);
          const bytes = Buffer.from(archive.bytes, 'base64');
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length,
            'Content-Disposition': 'attachment; filename="' + archive.name + '"', 'Cache-Control': 'no-store' });
          return res.end(bytes);
        }
      }
      const method = /^\/projects\/([a-f0-9-]{36})\/method$/.exec(url.pathname);
      if (method && req.method === 'GET') return send(res, 200, { data: store.skills.preference(method[1]) });
      if (method && req.method === 'POST') {
        const { hash } = await readJson(req);
        if (hash !== null && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw problem('INVALID_INPUT', 400);
        return send(res, 200, { data: store.skills.preference(method[1], hash) });
      }
      const approval = /^\/projects\/([a-f0-9-]{36})\/chats\/([a-f0-9-]{36})\/proposals\/([a-f0-9-]{36})\/approve$/.exec(url.pathname);
      if (approval && req.method === 'POST') return send(res, 200, { data: store.acceptProposal(approval[1], approval[2], approval[3], await readJson(req)) });
      const chat = /^\/projects\/([a-f0-9-]{36})\/chats(?:\/([a-f0-9-]{36})\/(turns|finish))?$/.exec(url.pathname);
      if (chat) {
        const [, projectId, id, action] = chat;
        if (req.method === 'GET' && !id) return send(res, 200, { data: store.chat.list(projectId) });
        if (req.method === 'GET' && action === 'turns') return send(res, 200, { data: store.chat.turns(projectId, id) });
        if (req.method === 'POST') {
          const body = await readJson(req, 32000);
          const data = !id ? store.chat.open(projectId, body)
            : action === 'turns' ? store.chat.start(projectId, id, body)
            : store.chat.finish(projectId, id, body);
          return send(res, 200, { data });
        }
      }
      const delivery = /^\/projects\/([a-f0-9-]{36})\/(delivery|handoff-pack\/(\d+)|drafts(?:\/([a-f0-9-]{36})(\/approve)?)?|finals(?:\/([a-f0-9-]{36})\/(content|primary))?)$/.exec(url.pathname);
      if (delivery) {
        const [, projectId, action, versionText, draftId, approvePath, finalId, finalAction] = delivery;
        if (action === 'delivery' && req.method === 'GET') return send(res, 200, { data: store.delivery(projectId) });
        if (versionText && req.method === 'GET') return await servePack(root, store, projectId, Number(versionText), res);
        if (action === 'drafts' && req.method === 'POST') {
          const body = await readJson(req);
          if (!Number.isSafeInteger(body?.version) || body.version < 1) throw problem('INVALID_INPUT', 400);
          store.handoff(projectId, body.version);
          if (store.delivery(projectId).drafts.some(job => ['writing', 'uncertain'].includes(job.state))) {
            throw problem('DRAFT_WRITER_BUSY', 409);
          }
          const ready = await adapter.probe();
          const data = store.mutate('draft', { commandId: body.commandId, projectId, version: body.version,
            target: ready.target, editorVersion: ready.version });
          return send(res, 200, { data });
        }
        if (draftId && approvePath && req.method === 'POST') return send(res, 200, { data: await approve(projectId, draftId) });
        if (draftId && !approvePath && req.method === 'GET') {
          return send(res, 200, { data: await reconcile(projectId, store.draft(projectId, draftId)) });
        }
        if (action === 'finals' && req.method === 'POST') {
          const handoffId = url.searchParams.get('handoffId');
          if (handoffId && !/^[a-f0-9-]{36}$/.test(handoffId)) throw problem('INVALID_INPUT', 400);
          const data = await ingest(req, root, store, projectId, url.searchParams.get('commandId'),
            url.searchParams.get('name'), { version: Number(url.searchParams.get('version')), handoffId });
          return send(res, 200, { data });
        }
        if (finalId && finalAction === 'content' && ['GET', 'HEAD'].includes(req.method)) {
          return await serve(req, res, root, store.finalAsset(projectId, finalId));
        }
        if (finalId && finalAction === 'primary' && req.method === 'POST') {
          const body = await readJson(req);
          return send(res, 200, { data: store.mutate('finalPrimary', { commandId: body?.commandId, projectId, finalId }) });
        }
      }
      const production = /^\/projects\/([a-f0-9-]{36})\/production$/.exec(url.pathname);
      if (production && req.method === 'GET') return send(res, 200, { data: store.production(production[1]) });
      const story = /^\/projects\/([a-f0-9-]{36})\/story$/.exec(url.pathname);
      if (story && req.method === 'GET') return send(res, 200, { data: store.story(story[1]) });
      if (story && req.method === 'POST') {
        const data = store.mutate('story', { ...await readJson(req, 512000), projectId: story[1] });
        return send(res, 200, { data });
      }
      const project = /^\/projects\/([a-f0-9-]{36})(?:\/(arrangement(?:\/preview)?|handoff-plan\/(\d+)))?$/.exec(url.pathname);
      if (project) {
        const [, id, operation, version] = project;
        if (req.method === 'GET' && !operation) return send(res, 200, { data: { ...store.project(id), legacySource: store.legacyImports.source(id), references:store.ideas.links(id) } });
        if (req.method === 'GET' && operation === 'arrangement') return send(res, 200, { data: store.arrangement(id) });
        if (req.method === 'GET' && version && Number.isSafeInteger(Number(version))) {
          return send(res, 200, { data: store.handoff(id, Number(version)) });
        }
        if (req.method === 'POST' && ['arrangement', 'arrangement/preview'].includes(operation)) {
          const body = await readJson(req, 5 * 1024 * 1024);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('INVALID_INPUT', 400);
          const data = operation === 'arrangement'
            ? store.mutate('arrangement', { ...body, projectId: id })
            : store.arrangementPreview(id, body);
          return send(res, 200, { data });
        }
      }
      if (collection && req.method === 'GET') return send(res, 200, { data: store.projectAssets(collection[1]) });
      if (collection && req.method === 'POST') {
        const data = await ingest(req, root, store, collection[1], url.searchParams.get('commandId'), url.searchParams.get('name'));
        return send(res, 200, { data });
      }
      if (item && ['GET', 'HEAD'].includes(req.method)) {
        return await serve(req, res, root, store.asset(item[1], item[2]));
      }
      if (req.method === 'GET' && req.url === '/bootstrap') {
        return send(res, 200, { data: {...store.snapshot(),release:require('./release-status.json')} });
      }
      if (req.method === 'POST' && ['/ideas', '/projects'].includes(req.url)) {
        const data = store.mutate(req.url === '/ideas' ? 'idea' : 'project', await readJson(req));
        return send(res, 200, { data });
      }
      send(res, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      send(res, error.status || 500, { error: { code: error.status ? error.code : 'WORKER_ERROR', ...(error.status&&error.message!==error.code ? { message: error.message } : {}) } });
    }
  });
  server.requestTimeout = 5 * 60 * 1000;
  server.listen(0, '127.0.0.1', () => {
    process.send?.({ type: 'ready', protocol: 1, port: server.address().port });
  });
  process.once('disconnect', async () => {
    studioRoutes.stop();
    native.stop();
    batchRunner.stop();
    generation.stop();
    imageGeneration.stop();
    await Promise.all([legacy.close(),analyzer.stop(),store.visual.stop()]);
    server.closeAllConnections();
    server.close(() => {
      store.close();
      lease.release();
      process.exit(0);
    });
  });
}

if (!process.send) throw new Error('This worker requires the DSH Host IPC channel');
process.once('message',config=>{try{start(config);}catch(error){const code=['DATA_ROOT_BUSY','SCHEMA_UNSUPPORTED'].includes(error.code)?error.code:'WORKER_START_FAILED';process.send?.({type:'startup-error',code},()=>process.exit(1));}});
