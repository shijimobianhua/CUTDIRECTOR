import { createHash,randomBytes } from 'node:crypto';
import { readFileSync,existsSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createWorker } from './worker.js';
import { runDirector } from './loop.js';
import {respondIdea} from './idea-director.js';
import {extensionTools,callExtension} from './extensions.js';
import {reviewVisually} from './visual-review.js';
import {performSearch,searchSelection} from './search.js';
import {createStudioHost} from './studio.js';

export const inject = ['webServer'];

const prefix = '/video-agent';
const assets = new Map([
  ['/studio.css',['../web/studio.css','text/css; charset=utf-8']],
  ...['studio-common','studio-chat','studio-scripts','studio-tools','studio-media','studio-timeline','studio-canvas','studio-canvas-island'].map(name=>['/'+name+'.js',['../web/'+name+'.js','text/javascript; charset=utf-8']]),
  ['/studio-canvas-island.css',['../web/studio-canvas-island.css','text/css; charset=utf-8']],
  ['/ui.js', ['../web/ui.js', 'text/javascript; charset=utf-8']],
  ['/idea-wall.js', ['../web/idea-wall.js', 'text/javascript; charset=utf-8']],
  ['/onboarding.js', ['../web/onboarding.js', 'text/javascript; charset=utf-8']],
  ['/idea-files.js', ['../web/idea-files.js', 'text/javascript; charset=utf-8']],
  ['/visual-review.js', ['../web/visual-review.js', 'text/javascript; charset=utf-8']],
  ['/extensions.js', ['../web/extensions.js', 'text/javascript; charset=utf-8']],
  ['/beatcut.js', ['../web/beatcut.js', 'text/javascript; charset=utf-8']],
  ['/idea-chat.js', ['../web/idea-chat.js', 'text/javascript; charset=utf-8']],
  ['/editor-connection.js', ['../web/editor-connection.js', 'text/javascript; charset=utf-8']],
  ['/generation-drafts.js', ['../web/generation-drafts.js', 'text/javascript; charset=utf-8']],
  ['/compare.js', ['../web/compare.js', 'text/javascript; charset=utf-8']],
  ['/search.js', ['../web/search.js', 'text/javascript; charset=utf-8']],
  ['/batches.js', ['../web/batches.js', 'text/javascript; charset=utf-8']],
  ['/quality.js', ['../web/quality.js', 'text/javascript; charset=utf-8']],
  ['/workflows.js', ['../web/workflows.js', 'text/javascript; charset=utf-8']],
  ['/tools.js', ['../web/tools.js', 'text/javascript; charset=utf-8']],
  ['/sources.js', ['../web/sources.js', 'text/javascript; charset=utf-8']],
  ['/reference-files.js', ['../web/reference-files.js', 'text/javascript; charset=utf-8']],
  ['/knowledge.js', ['../web/knowledge.js', 'text/javascript; charset=utf-8']],
  ['/roughcut.js', ['../web/roughcut.js', 'text/javascript; charset=utf-8']],
  ['/project-layout.js', ['../web/project-layout.js', 'text/javascript; charset=utf-8']],
  ['/versions.js', ['../web/versions.js', 'text/javascript; charset=utf-8']],
  ['/ideas.js', ['../web/ideas.js', 'text/javascript; charset=utf-8']],
  ['/views.js', ['../web/views.js', 'text/javascript; charset=utf-8']],
  ['/tasks.js', ['../web/tasks.js', 'text/javascript; charset=utf-8']],
  ['/legacy.js', ['../web/legacy.js', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['../icon.svg', 'image/svg+xml']],
  ['/v3.js', ['../web/workbench.js', 'text/javascript; charset=utf-8']],
  ['/arrangement.js', ['../web/arrangement.js', 'text/javascript; charset=utf-8']],
  ['/delivery.js', ['../web/delivery.js', 'text/javascript; charset=utf-8']],
  ['/director.js', ['../web/director.js', 'text/javascript; charset=utf-8']],
  ['/story.js', ['../web/story.js', 'text/javascript; charset=utf-8']],
  ['/generation.js', ['../web/generation.js', 'text/javascript; charset=utf-8']],
  ['/image-generation.js', ['../web/image-generation.js', 'text/javascript; charset=utf-8']],
  ['/skills.js', ['../web/skills.js', 'text/javascript; charset=utf-8']],
  ['/v3.css', ['../web/workbench.css', 'text/css; charset=utf-8']],
]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type, 'Content-Security-Policy': csp,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function sameHost(value, host) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}

export function apply(ctx, config = {}) {
  const bundledProbe=fileURLToPath(new URL('../runtime/ffmpeg/ffprobe.exe',import.meta.url));
  const bundledPython=fileURLToPath(new URL('../runtime/python/python.exe',import.meta.url));
  const ffprobe=existsSync(bundledProbe)?bundledProbe:config.ffprobe;
  const draftConfig = config.handoff && {
    ...config.handoff, ffprobe, ...(existsSync(bundledPython)?{python:bundledPython}:{}),
    jyr: fileURLToPath(new URL('../vendor/easy-jianying', import.meta.url)),
  };
  const profile=(!config.dataRoot||config.dataRoot==='@profile')?ctx.get?.('profileContext'):null;
  const dataRoot=(!config.dataRoot||config.dataRoot==='@profile')&&isAbsolute(profile?.dir||'')?join(profile.dir,'data','cutdirector-v3'):config.dataRoot;
  const worker = isAbsolute(dataRoot || '') ? createWorker(dataRoot, ffprobe, draftConfig, config.legacyRoot) : null;
  const studioHost=worker?createStudioHost(ctx,worker,dataRoot):null;
  const sessions = new Map();
  const desktopSessions=new Map();
  function desktopIdentity(req){
    if(req.headers.origin||req.headers['sec-fetch-site']||!req.headers.cookie)return null;
    if(req.headers.referer){try{const ref=new URL(req.headers.referer);if(ref.protocol!=='dsh-app:'||ref.hostname!=='app')return null;}catch{return null;}}
    let connection;try{connection=ctx.get?.('connection');}catch{return null;}
    if(typeof connection?.requestRejection!=='function'||connection.requestRejection(req)!==undefined)return null;
    return createHash('sha256').update(req.headers.cookie).digest('hex');
  }
  const running = new Map();
  const mediaCookie = 'cutdirector_media_' + randomBytes(8).toString('hex');
  const sessionTtl = 30 * 60 * 1000;
  const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.slice(prefix.length);
    const desktop=desktopIdentity(req);
    const referenceSearch = /^\/v3\/projects\/[a-f0-9-]{36}\/reference-searches$/.test(path);
    const searchApprove = /^\/v3\/projects\/[a-f0-9-]{36}\/reference-searches\/([a-f0-9-]{36})\/approve$/.exec(path);
    const referenceFiles = /^\/v3\/projects\/[a-f0-9-]{36}\/reference-files$/.test(path);
    const referenceAction = /^\/v3\/projects\/[a-f0-9-]{36}\/reference-files\/[a-f0-9-]{36}\/(analysis|use)$/.test(path);
    const referenceContent = /^\/v3\/projects\/[a-f0-9-]{36}\/reference-files\/[a-f0-9-]{36}\/(content|frames\/\d+)$/.test(path);
    const reconnect = /^\/v3\/projects\/[a-f0-9-]{36}\/(?:assets|images)\/[a-f0-9-]{36}\/reconnect$/.test(path);
    const collection = /^\/v3\/projects\/[a-f0-9-]{36}\/assets$/.test(path);
    const content = /^\/v3\/projects\/[a-f0-9-]{36}\/assets\/[a-f0-9-]{36}\/content$/.test(path);
    const project = /^\/v3\/projects\/[a-f0-9-]{36}(?:\/(arrangement|production|candidates|handoff-plan\/\d+))?$/.test(path);
    const arrangementWrite = /^\/v3\/projects\/[a-f0-9-]{36}\/arrangement(?:\/(?:preview|beat-preview))?$/.test(path) && req.method === 'POST';
    const deliveryRead = /^\/v3\/projects\/[a-f0-9-]{36}\/(delivery|drafts\/[a-f0-9-]{36})$/.test(path);
    const pack = /^\/v3\/projects\/[a-f0-9-]{36}\/handoff-pack\/\d+$/.test(path);
    const frameCollection = /^\/v3\/projects\/[a-f0-9-]{36}\/images$/.test(path);
    const frameContent = /^\/v3\/projects\/[a-f0-9-]{36}\/images\/[a-f0-9-]{36}\/content$/.test(path);
    const finalContent = /^\/v3\/projects\/[a-f0-9-]{36}\/finals\/[a-f0-9-]{36}\/content$/.test(path);
    const finalUpload = /^\/v3\/projects\/[a-f0-9-]{36}\/finals$/.test(path);
    const legacyRead = /^\/v3\/legacy\/projects(?:\/[A-Za-z][A-Za-z0-9_-]{0,95}(?:\/(deliveries|conversations))?)?$/.test(path);
    const legacyWrite = /^\/v3\/legacy\/projects\/[A-Za-z][A-Za-z0-9_-]{0,95}\/(command|render|import|jobs\/[A-Za-z][A-Za-z0-9_-]{0,95}\/(cancel|retry))$/.test(path);
    const legacyContent = /^\/v3\/legacy\/projects\/[A-Za-z][A-Za-z0-9_-]{0,95}\/(media\/[A-Za-z][A-Za-z0-9_-]{0,95}\/content|jobs\/[A-Za-z][A-Za-z0-9_-]{0,95}\/artifacts\/[A-Za-z0-9_.-]{1,100})$/.test(path);
    const imageJobs = /^\/v3\/projects\/[a-f0-9-]{36}\/image-jobs$/.test(path);
    const imageAction = /^\/v3\/projects\/[a-f0-9-]{36}\/image-jobs\/[a-f0-9-]{36}\/(approve|check)$/.test(path);
    const generationSettings = path === '/v3/generation-settings';
    const generationJobs = /^\/v3\/projects\/[a-f0-9-]{36}\/generations$/.test(path);
    const generationAction = /^\/v3\/projects\/[a-f0-9-]{36}\/generations\/[a-f0-9-]{36}\/(approve|check|pause|resume)$/.test(path);
    const skillPreview = /^\/v3\/skills\/preview\/(zip|folder|text)$/.test(path) && req.method === 'POST';
    const skillDownload = /^\/v3\/skills\/[a-f0-9]{64}\/download$/.test(path);
    const skillRead = /^\/v3\/skills(?:\/[a-f0-9]{64}\/(?:export-info|checklist))?$/.test(path);
    const skillWrite = /^\/v3\/skills\/(?:install|[a-f0-9]{64}\/(?:enable|disable))$/.test(path);
    const methodPref = /^\/v3\/projects\/[a-f0-9-]{36}\/method$/.test(path);
    const story = /^\/v3\/projects\/[a-f0-9-]{36}\/story$/.test(path);
    const cancelRun = /^\/v3\/projects\/[a-f0-9-]{36}\/chats\/[a-f0-9-]{36}\/runs\/([a-f0-9-]{36})\/cancel$/.exec(path);
    const chat = /^\/v3\/projects\/[a-f0-9-]{36}\/chats(?:\/[a-f0-9-]{36}\/turns)?$/.test(path);
    const ideaFiles=/^\/v3\/ideas\/[a-f0-9-]{36}\/files(?:\/[a-f0-9-]{36}\/(content|use))?$/.test(path);
    const ideaFileUpload=ideaFiles&&path.endsWith('/files')&&req.method==='POST';
    const ideaFileContent=ideaFiles&&path.endsWith('/content');
    const visualRoute=/^\/v3\/projects\/[a-f0-9-]{36}\/visual-reviews(?:\/[a-f0-9-]{36}\/(approve|cancel))?$/.test(path);
    const extensionRoute=/^\/v3\/extensions(?:\/(discover|register|select|probe))?$/.test(path);
    const extensionJobs=/^\/v3\/projects\/[a-f0-9-]{36}\/extension-jobs(?:\/[a-f0-9-]{36}\/(approve|check|cancel))?$/.test(path);
    const ideaChat=/^\/v3\/ideas\/[a-f0-9-]{36}\/chats(?:\/[a-f0-9-]{36}\/turns(?:\/[a-f0-9-]{36}\/(apply|undo))?)?$/.test(path);
    const ideaSend=ideaChat&&path.endsWith('/turns')&&req.method==='POST';
    const ideaSources = /^\/v3\/ideas\/[a-f0-9-]{36}\/sources(?:\/[a-f0-9-]{36})?$/.test(path);
    const ideaRoute = /^\/v3\/ideas(?:\/[a-f0-9-]{36})?$/.test(path);
    const workflow = /^\/v3\/projects\/[a-f0-9-]{36}\/(workflow(?:\/undo)?|quality|batches(?:\/[a-f0-9-]{36}\/(?:approve|cancel))?)$/.test(path);
    const feedback = /^\/v3\/projects\/[a-f0-9-]{36}\/feedback(?:\/[a-f0-9-]{36})?$/.test(path);
    const references = /^\/v3\/projects\/[a-f0-9-]{36}\/references$/.test(path);
    const versionRead = /^\/v3\/projects\/[a-f0-9-]{36}\/(story|arrangement)\/versions(?:\/\d+)?$/.test(path);
    const versionWrite = /^\/v3\/projects\/[a-f0-9-]{36}\/(story|arrangement)\/(restore|undo)$/.test(path);
    const proposalApproval = /^\/v3\/projects\/[a-f0-9-]{36}\/chats\/[a-f0-9-]{36}\/proposals\/[a-f0-9-]{36}\/approve$/.test(path);
    const chatSend = chat && path.endsWith('/turns') && req.method === 'POST';
    const draftApprove = /^\/v3\/projects\/[a-f0-9-]{36}\/drafts\/[a-f0-9-]{36}\/approve$/.test(path);
    const deliveryWrite = /^\/v3\/projects\/[a-f0-9-]{36}\/(drafts|finals\/[a-f0-9-]{36}\/primary)$/.test(path);
    const upload = (ideaFileUpload || collection || finalUpload || frameCollection || referenceFiles || reconnect) && req.method === 'POST';
    const studioRoute=/^\/v3\/studio\/(?:index|presets|standard|connections|dsh-tools|codex-diagnostics|codex-login(?:\/[a-f0-9-]{36})?|connections\/[a-f0-9-]{36}\/(?:probe|export|remove)|assistant\/chats(?:\/[a-f0-9-]{36}(?:\/turns(?:\/[a-f0-9-]{36}\/(?:apply|convert|cancel))?)?)?|projects\/[a-f0-9-]{36}(?:\/(?:import|audio|context|jobs(?:\/[a-f0-9-]{36}(?:\/(?:approve|check|cancel|reconcile))?)?|documents(?:\/(?:batch|[a-f0-9-]{36}(?:\/(?:versions(?:\/\d+)?|restore|archive|publish|original))?))?))?)$/.test(path);
    const studioDownload=studioRoute&&path.endsWith('/original')&&req.method==='GET';
    const studioUpload=studioRoute&&/\/(import|audio)$/.test(path)&&req.method==='POST';
    const method = req.method;
    if (method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      return send(res, 200, readFileSync(new URL(file, import.meta.url)), type);
    }
    if (method === 'GET' && path === '/') {
      const destination=req.headers['sec-fetch-dest'];
      const embedded=destination==='iframe'||!!desktop&&(!destination||destination==='empty');
      if(isAbsolute(dataRoot||'')){try{
        let connection;try{connection=ctx.get?.('connection');}catch{}
        let rejection='unavailable';try{if(connection?.requestRejection)rejection=connection.requestRejection(req)??null;}catch{rejection='error';}
        let ref;try{ref=new URL(req.headers.referer).protocol;}catch{ref=null;}
        writeFileSync(join(dataRoot,'entry-diagnostic.json'),JSON.stringify({at:new Date().toISOString(),destination:destination||null,site:req.headers['sec-fetch-site']||null,hasOrigin:!!req.headers.origin,hasCookie:!!req.headers.cookie,referrerProtocol:ref,hostAdmission:rejection,desktopRecognized:!!desktop,embedded},null,2));
      }catch{}}
      if (!embedded ||
          (!desktop&&(req.headers['sec-fetch-site'] !== 'same-origin'||!sameHost(req.headers.referer, req.headers.host)))) {
        return send(res, 403, { error: { code: 'OPEN_FROM_DSH' } });
      }
      const now = Date.now();
      for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
      if (sessions.size >= 256) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, now + sessionTtl);
      if(desktop){const tokens=desktopSessions.get(desktop)||new Set();for(const old of tokens)if(!sessions.has(old))tokens.delete(old);tokens.add(token);desktopSessions.set(desktop,tokens);if(desktopSessions.size>256)desktopSessions.delete(desktopSessions.keys().next().value);}
      return send(res, 200, page.replace('EMBED_SESSION_TOKEN', token), 'text/html; charset=utf-8', {
        'Set-Cookie': mediaCookie + '=' + token + '; HttpOnly; SameSite=Strict; Path=' + prefix + '/v3/',
      });
    }

    if (!((studioRoute&&['GET','POST'].includes(method)) || (method === 'GET' && ['/v3/dsh-skills', '/v3/bootstrap', '/v3/connections', '/v3/tasks', '/v3/task-summary', '/v3/events', '/v3/views', '/v3/plugins', '/v3/templates','/v3/editor-settings'].includes(path)) ||
          (method === 'POST' && ['/v3/dsh-skills/preview', '/v3/ideas', '/v3/projects', '/v3/views', '/v3/plugins/actions', '/v3/plugins/probe', '/v3/templates','/v3/editor-settings'].includes(path)) ||
          ((project || deliveryRead || pack || skillRead || skillDownload || legacyRead || versionRead) && method === 'GET') || ((ideaFiles || visualRoute || extensionRoute || extensionJobs || ideaChat || chat || story || ideaRoute || ideaSources || references || feedback || workflow || referenceSearch || referenceFiles || referenceAction || methodPref || generationSettings || generationJobs || imageJobs) && ['GET', 'POST'].includes(method)) ||
          ((generationAction || imageAction || cancelRun || searchApprove) && method === 'POST') || skillPreview || (skillWrite && method === 'POST') || arrangementWrite ||
          ((deliveryWrite || draftApprove || legacyWrite || proposalApproval || versionWrite) && method === 'POST') || upload ||
          ((collection || frameCollection) && method === 'GET') || ((ideaFileContent || content || finalContent || frameContent || legacyContent || referenceContent) && ['GET', 'HEAD'].includes(method)))) {
      return send(res, 404, { error: { code: 'NOT_FOUND' } });
    }
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(mediaCookie + '='))?.slice(mediaCookie.length + 1);
    const mediaRequest=studioDownload||ideaFileContent||content||finalContent||frameContent||legacyContent||referenceContent||pack||skillDownload;
    const desktopToken=desktop&&mediaRequest?[...(desktopSessions.get(desktop)||[])].reverse().find(value=>sessions.get(value)>Date.now()):undefined;
    const token = req.headers['x-cutdirector-session'] || (mediaRequest ? cookie||desktopToken : undefined);
    if ((!desktop&&req.headers['sec-fetch-site'] !== 'same-origin') ||
        (!desktop&&method === 'POST' && !sameHost(req.headers.origin, req.headers.host)) ||
        !(sessions.get(token) > Date.now())) {
      return send(res, 403, { error: { code: 'OPEN_FROM_DSH' } });
    }
    sessions.set(token, Date.now() + sessionTtl);

    if(cancelRun){
      if(!worker)return send(res,503,{error:{code:'DATA_ROOT_REQUIRED'}});
      const response=await worker.call(path.slice('/v3'.length),'POST','{}');
      if(response.ok)running.get(cancelRun[1])?.abort();
      return send(res,response.status,await response.json());
    }
    if(path==='/v3/dsh-skills'&&method==='GET'){
      const skills=ctx.get?.('skills');if(!skills?.list)return send(res,200,{data:[]});
      const rows=await skills.list({cwd:ctx.get?.('profileContext')?.dir,signal:AbortSignal.timeout(10000)});
      return send(res,200,{data:rows.filter(row=>row.invocation?.userInvocable!==false).slice(0,200).map(({name,description,provider})=>({name,description,provider}))});
    }
    if(path==='/v3/extensions/discover'&&method==='GET')return send(res,200,{data:extensionTools(ctx)});
    if (path === '/v3/connections') {
      const llm = ctx.get?.('llm');
      if (!llm?.listProviders || !llm?.listModels) return send(res, 200, { data: [] });
      const providers = (await llm.listProviders()).slice(0, 30);
      const groups = await Promise.allSettled(providers.map(async (provider) => {
        const models = await llm.listModels(provider.id);
        return models.slice(0, 100).map((model) => ({
          provider: provider.name || provider.id, model: model.name || model.id, providerId: provider.id, modelId: model.id,
        }));
      }));
      return send(res, 200, { data: groups.flatMap((group) => group.status === 'fulfilled' ? group.value : []) });
    }

    if (!worker) return send(res, 503, { error: { code: 'DATA_ROOT_REQUIRED' } });
    if (studioDownload || studioUpload || upload || ideaFileContent || content || finalContent || frameContent || legacyContent || referenceContent || pack || skillPreview || skillDownload) {
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      const response = await worker.call(path.slice('/v3'.length) + url.search, method, studioUpload || upload || skillPreview ? req : undefined, {
        stream: studioUpload || upload || skillPreview, contentType: req.headers['content-type'], range: req.headers.range,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60 * 1000)]),
      });
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition']) {
        if (response.headers.has(name)) headers[name] = response.headers.get(name);
      }
      res.writeHead(response.status, headers);
      if (!response.body) return res.end();
      return await pipeline(response.body, res);
    }
    let body;
    if (method === 'POST') {
      if (req.headers['content-type'] !== 'application/json') return send(res, 400, { error: { code: 'INVALID_INPUT' } });
      const chunks = [];
      let size = 0;
      const limit = studioRoute ? 40*1024*1024 : path === '/v3/views' ? 5*1024*1024 : ideaSources || workflow || path==='/v3/templates' ? 300000 : arrangementWrite ? 5 * 1024 * 1024 : story ? 512000 : chatSend ? 32000 : 16384;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) return send(res, 413, { error: { code: 'REQUEST_TOO_LARGE' } });
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    if(studioRoute){const result=await studioHost.handle(path.slice('/v3'.length),method,body?JSON.parse(body.toString('utf8')):undefined);if(result)return send(res,result.status,result.value);}
    if(path==='/v3/dsh-skills/preview'&&method==='POST'){
      const input=JSON.parse(body.toString('utf8')),skills=ctx.get?.('skills');
      if(input.confirm!==true||typeof input.name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name))return send(res,403,{error:{code:'PLUGIN_APPROVAL_REQUIRED'}});
      let skill;try{skill=await skills?.get(input.name,{cwd:ctx.get?.('profileContext')?.dir,signal:AbortSignal.timeout(10000)});}catch{return send(res,422,{error:{code:'SKILL_SOURCE_UNAVAILABLE'}});}
      if(!skill||skill.invocation?.userInvocable===false||typeof skill.content!=='string'||skill.content.length>64000)return send(res,422,{error:{code:'SKILL_LIMIT'}});
      const text='---\nname: '+JSON.stringify(skill.name)+'\ndescription: '+JSON.stringify(skill.description)+'\n---\n'+skill.content;
      const preview=await worker.call('/skills/preview/folder','POST',Buffer.from(JSON.stringify([{path:skill.name+'/SKILL.md',text}])),{contentType:'application/octet-stream'});
      return send(res,preview.status,await preview.json());
    }
    if(visualRoute&&path.endsWith('/approve')&&method==='POST'){
      const route=path.slice('/v3'.length,-'/approve'.length),id=route.split('/').at(-1),controller=new AbortController();running.set(id,controller);
      try{const result=await reviewVisually(ctx,worker,route,JSON.parse(body.toString('utf8')),AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));return send(res,result.status,result.value);}
      finally{running.delete(id);}
    }
    if(extensionRoute&&method==='POST'&&path!=='/v3/extensions/select'){
      const input=JSON.parse(body.toString('utf8'));
      if(input.confirm!==true)return send(res,403,{error:{code:'PLUGIN_APPROVAL_REQUIRED'}});
      if(path.endsWith('/register')){
       const manifest=await callExtension(ctx,input.toolName,{action:'manifest'},AbortSignal.timeout(15000),dataRoot);
       body=JSON.stringify({toolName:input.toolName,manifest,confirm:true});
      }else if(path.endsWith('/probe')){
       const entryResponse=await worker.call('/extensions/entry','POST',JSON.stringify({pluginId:input.pluginId}));
       const entry=await entryResponse.json();if(!entryResponse.ok)return send(res,entryResponse.status,entry);
       const result=await callExtension(ctx,entry.data.tool_name,{action:'probe'},AbortSignal.timeout(30000),dataRoot);
       body=JSON.stringify({pluginId:input.pluginId,result:{available:result.available===true,message:String(result.message||'').slice(0,400)}});
      }
    }
    if(extensionJobs&&path.endsWith('/cancel')&&method==='POST'){
      const id=path.split('/').at(-2);running.get(id)?.abort();
    }
    if(extensionJobs&&(path.endsWith('/approve')||path.endsWith('/check'))&&method==='POST'){
      const checking=path.endsWith('/check'),route=path.slice('/v3'.length,checking?-'/check'.length:-'/approve'.length),claim=await worker.call(route+(checking?'/claimCheck':'/claim'),'POST',body),value=await claim.json();
      if(claim.ok&&value.data.collect){const collected=await worker.call(route+'/collect','POST','{}',{signal:AbortSignal.timeout(5*60*1000)});return send(res,collected.status,await collected.json());}
      if(!claim.ok||!value.data.dispatch)return send(res,claim.status,value);
      const controller=new AbortController();running.set(value.data.id,controller);
      let result;
      try{
      const inputs=await worker.call(route+'/inputs','POST','{}'),prepared=await inputs.json();if(!inputs.ok)throw Error('EXTENSION_INPUT_FAILED');
      result=await callExtension(ctx,value.data.toolName,{action:checking?'status':'execute',jobId:value.data.id,input:value.data.snapshot,workspace:prepared.data,...(checking?{externalId:value.data.externalId}:{})},AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),dataRoot);
      }
      catch{const finish=await worker.call(route+'/finish','POST',JSON.stringify({ok:false}));return send(res,finish.status,await finish.json());}
      finally{running.delete(value.data.id);}
      const finish=await worker.call(route+'/finish','POST',JSON.stringify({ok:true,result}),{signal:AbortSignal.timeout(5*60*1000)});return send(res,finish.status,await finish.json());
    }
    if(path==='/v3/plugins/probe'){
      const input=JSON.parse(body.toString('utf8'));
      let detected=false;
      if(input.pluginId==='cutdirector-search'){try{searchSelection(ctx);detected=true;}catch{}}
      if(input.pluginId==='cutdirector-visual-qa')detected=!!ctx.get?.('llm')?.prepareCall&&!!ctx.get?.('attachments')?.admitPromptContent;
      if(input.pluginId==='cutdirector-director'){
        const llm=ctx.get?.('llm');
        if(llm?.listProviders&&llm?.listModels){for(const provider of (await llm.listProviders()).slice(0,30)){if((await llm.listModels(provider.id)).length){detected=true;break;}}}
      }
      body=JSON.stringify({pluginId:input.pluginId,detected});
    }
    if(referenceSearch&&method==='POST')body=JSON.stringify({...JSON.parse(body.toString('utf8')),provider:searchSelection(ctx)});
    if(searchApprove){
      const controller=new AbortController();running.set(searchApprove[1],controller);
      try{const result=await performSearch(ctx,worker,path.slice('/v3'.length,-'/approve'.length),JSON.parse(body.toString('utf8')),AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]));return send(res,result.status,result.value);}
      finally{running.delete(searchApprove[1]);}
    }
    const response = await worker.call(path.slice('/v3'.length) + url.search, method, body,
      (studioRoute || visualRoute || draftApprove || generationAction || imageAction || generationSettings || legacyWrite || referenceAction || ideaSources || path==='/v3/editor-settings') ? { signal: AbortSignal.timeout(5 * 60 * 1000) } : undefined);
    const value = await response.json();
    if(ideaSend&&response.ok){
      if(!value.data.dispatch)return send(res,200,{data:value.data.turns});
      const controller=new AbortController();running.set(value.data.turnId,controller);
      try{const result=await respondIdea(ctx,value.data,controller.signal);
        const complete=await worker.call(path.slice('/v3'.length,-'/turns'.length)+'/finish','POST',JSON.stringify({...result,turnId:value.data.turnId}));
        return send(res,complete.status,await complete.json());
      }finally{running.delete(value.data.turnId);}
    }
    if (!chatSend || !response.ok) return send(res, response.status, value);
    if (!value.data.dispatch) return send(res, 200, { data: value.data.turns });
    const controller=new AbortController();
    running.set(value.data.turnId,controller);
    let answer;
    try{answer=await runDirector(ctx,worker,path.slice('/v3'.length,-'/turns'.length)+'/runs/'+value.data.turnId,value.data,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));}
    finally{running.delete(value.data.turnId);}
    const complete = await worker.call(path.slice('/v3'.length, -'/turns'.length) + '/finish', 'POST',
      JSON.stringify({ ...answer, turnId: value.data.turnId }));
    if(complete.status===404){
      const saved=await worker.call(path.slice('/v3'.length),'GET');
      return send(res,saved.status,await saved.json());
    }
    return send(res, complete.status, await complete.json());
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: prefix, handler(req, res) {
      return handle(req, res).catch(error => {
        const code=['DATA_ROOT_BUSY','SCHEMA_UNSUPPORTED','WEB_PROVIDER_UNAVAILABLE','WEB_PROVIDER_AMBIGUOUS','WEB_PROVIDER_CONFIGURED_MISSING','WEB_PROVIDER_CONFIGURED_UNAVAILABLE'].includes(error.code)?error.code:'WORKBENCH_UNAVAILABLE';
        if (!res.headersSent) send(res, 503, { error: { code } });
      });
    } });
    worker?.call('/bootstrap', 'GET').then(response => response.body?.cancel()).catch(() => {});
    return () => {
      studioHost?.close();
      sessions.clear();desktopSessions.clear();
      for(const controller of running.values())controller.abort();
      running.clear();
      dispose();
      worker?.close();
    };
  }, 'cutdirector-v3: embedded workbench');
}
