'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestName = 'release-manifest.json';
const jyrRevision = '181e664ed027b788ba25482518bbe9f3b5f22a92';

function hashes(directory) {
  const files = {};
  function scan(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      const relative = path.relative(directory, file).split(path.sep).join('/');
      if (relative === manifestName) continue;
      if (item.isDirectory()) scan(file);
      else if (item.isFile()) files[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw new Error('Unsupported package entry: ' + relative);
    }
  }
  scan(directory);
  return files;
}

function bundleDraftCompiler(checkout, out) {
  if (!path.isAbsolute(checkout || '')) throw new Error('Provide the absolute path to the pinned Easy Jianying checkout');
  const git = args => execFileSync('git', ['-C', checkout, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const revision = git(['rev-parse', 'HEAD']).toString().trim();
  if (revision !== jyrRevision) throw new Error('Easy Jianying checkout does not match the verified revision');
  const vendor = path.join(out, 'vendor', 'easy-jianying');
  const files = git(['ls-tree', '-r', '--name-only', jyrRevision, '--', 'jyr', 'LICENSE.md']).toString().trim().split(/\r?\n/);
  if (!files.includes('LICENSE.md') || !files.includes('jyr/plan.py')) throw new Error('Easy Jianying package is incomplete');
  for (const file of files) {
    if (!/^(LICENSE\.md|jyr\/[\w./-]+)$/.test(file) || file.split('/').includes('..')) throw new Error('Invalid vendor file');
    const target = path.join(vendor, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git(['show', jyrRevision + ':' + file]));
  }
  fs.writeFileSync(path.join(vendor, 'upstream.json'), JSON.stringify({
    repository: 'https://github.com/YeJe-cpu/easy-jianying', revision: jyrRevision, license: 'PolyForm Noncommercial 1.0.0',
  }, null, 2));
}

function build(destination, dataRoot, ffprobe, handoff, legacyRoot,release) {
  if (!destination || !dataRoot) throw new Error('Usage: node tools/package-v3.cjs <plugin-directory> <isolated-data-directory>');
  const out = path.resolve(destination);
  const data = path.resolve(dataRoot);
  const relative = path.relative(out, data);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Data must be outside the plugin directory');
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Choose an empty plugin directory');
  fs.mkdirSync(out, { recursive: true });
  for (const folder of ['host', 'web', 'service', 'legacy']) {
    fs.cpSync(path.join(root, 'src/v3', folder), path.join(out, folder), { recursive: true });
  }
  for (const folder of ['core', 'adapters']) {
    fs.cpSync(path.join(root, 'src', folder), path.join(out, 'legacy-runtime', 'src', folder), { recursive: true });
  }
  fs.cpSync(path.join(root, 'contracts'), path.join(out, 'legacy-runtime', 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(out, 'legacy-runtime', 'src', 'agent'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/agent/conversations.cjs'), path.join(out, 'legacy-runtime', 'src', 'agent/conversations.cjs'));
  fs.mkdirSync(path.join(out, 'core'));
  for (const file of ['srt.cjs', 'util.cjs', 'credentials.cjs']) fs.copyFileSync(path.join(root, 'src/core', file), path.join(out, 'core', file));
  fs.copyFileSync(path.join(root, 'src/host/icon.svg'), path.join(out, 'icon.svg'));
  fs.cpSync(path.join(root, 'src/host/locale'), path.join(out, 'locale'), { recursive: true });
  const locked = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const entry of Object.keys(locked.packages).filter(file => file.startsWith('node_modules/')&&!locked.packages[file].dev)) {
    const source = path.join(root, entry);
    if (!fs.existsSync(source)){if(locked.packages[entry].optional)continue;throw new Error('Install the locked dependencies with npm ci');}
    fs.cpSync(source, path.join(out, entry), { recursive: true });
  }
  const client = fs.readFileSync(path.join(root, 'src/client/client.js'), 'utf8')
    .replace('CUTDIRECTOR · AI 剪辑导演', 'CUTDIRECTOR 视频制作');
  fs.writeFileSync(path.join(out, 'client.js'), client);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'src/host/package.json'), 'utf8'));
  pkg.dependencies={...pkg.dependencies,...JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).dependencies};
  pkg.version = release?.tier==='personal-preview'?'0.3.0-preview.7':'0.3.0-alpha.1';
  if(release){
    if(release.schemaVersion!==2||release.tier!=='personal-preview'||release.deferredByUser!==true||!Array.isArray(release.deferred))throw new Error('RELEASE_STATUS_INVALID');
    fs.writeFileSync(path.join(out,'release-checks.json'),JSON.stringify(release,null,2));
    fs.writeFileSync(path.join(out,'service','release-status.json'),JSON.stringify(release,null,2));
  }
  pkg.exports['.'] = './host/index.js';
  pkg.exports['./tool-sdk']='./service/tool-sdk.cjs';
  pkg.exports['./tool-standard']='./service/tool-standard.cjs';
  pkg.imports = { '#cutdirector-srt': './core/srt.cjs', '#cutdirector-credentials': './core/credentials.cjs', '#cutdirector-legacy/*': './legacy-runtime/src/*' };
  pkg.files = ['host', 'web', 'service', 'legacy', 'legacy-runtime', 'core', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg', manifestName];
  if(release)pkg.files.push('release-checks.json');
  if (handoff) {
    bundleDraftCompiler(handoff.jyr, out);
    pkg.files.push('vendor');
  }
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(out, 'cordis.patch.yml'), [
    '- insert:', '    - id: video-agent', "      name: '@local/video-agent'", '      config:',
    '        dataRoot: ' + JSON.stringify(data.split(path.sep).join('/')),
    ...(legacyRoot ? ['        legacyRoot: ' + JSON.stringify(path.resolve(legacyRoot).split(path.sep).join('/'))] : []),
    ...(ffprobe ? ['        ffprobe: ' + JSON.stringify(path.resolve(ffprobe).split(path.sep).join('/'))] : []),
    ...(handoff ? ['        handoff: ' + JSON.stringify({ editor: handoff.editor, python: handoff.python, draftRoot: handoff.draftRoot })] : []), '',
  ].join('\n'));
  fs.writeFileSync(path.join(out, manifestName), JSON.stringify({ version: 1, mode: 'dsh-development', files: hashes(out) }, null, 2));
  return out;
}

async function buildPortable(destination,config){
  if(!config||typeof config!=='object')throw new Error('Portable build config required');
  const out=build(destination,config.dataRoot||path.resolve(destination,'..','unbound-profile-data'),undefined,config.handoff,config.legacyRoot);
  fs.writeFileSync(path.join(out,manifestName),JSON.stringify({version:1,mode:'building',files:{}},null,2));
  await require('./v3-portable-runtime.cjs').bundleRuntime(out,config.archives);
  if(!config.dataRoot){const file=path.join(out,'cordis.patch.yml'),YAML=require('yaml'),patch=YAML.parse(fs.readFileSync(file,'utf8'));patch[0].insert[0].config.dataRoot='@profile';fs.writeFileSync(file,YAML.stringify(patch));}
  const pkg=JSON.parse(fs.readFileSync(path.join(out,'package.json'),'utf8'));
  pkg.files.push('runtime','runtime-source.json','THIRD-PARTY-NOTICES.md');
  fs.writeFileSync(path.join(out,'package.json'),JSON.stringify(pkg,null,2));
  fs.writeFileSync(path.join(out,'THIRD-PARTY-NOTICES.md'),[
    '# CUTDIRECTOR V3 third-party components','',
    '- DSH is the required host and supplies the Node runtime. No standalone workbench launcher is included.',
    '- FFmpeg and FFprobe are pinned in runtime-source.json. Preserve runtime/ffmpeg license and build notices.',
    '- Python is the official Windows embeddable package. Preserve runtime/python/LICENSE.txt and all runtime notices.',
    '- yaml, yauzl and yazl retain their original licenses in node_modules.',
    ...(config.handoff?['- Easy Jianying is pinned in vendor/easy-jianying/upstream.json. Its PolyForm Noncommercial license remains in vendor/easy-jianying/LICENSE.md. Commercial distribution requires a compatible upstream grant or replacement.']:[]),''
  ].join('\n'));
  fs.writeFileSync(path.join(out,manifestName),JSON.stringify({version:1,mode:'dsh-portable',files:hashes(out)},null,2));
  return out;
}

function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, manifestName), 'utf8'));
  if (manifest.version !== 1 || !['dsh-development','dsh-portable'].includes(manifest.mode) ||
      JSON.stringify(manifest.files) !== JSON.stringify(hashes(directory))) {
    throw new Error('V3 plugin package does not match its manifest');
  }
  return true;
}

if (require.main === module) {
  if(process.argv[2]==='--portable')buildPortable(process.argv[3],JSON.parse(fs.readFileSync(process.argv[4],'utf8'))).then(console.log).catch(error=>{console.error(error.message);process.exitCode=1;});
  else if (process.argv[2] === '--verify') console.log(verify(path.resolve(process.argv[3])));
  else console.log(build(process.argv[2], process.argv[3], process.argv[4], process.argv[5]
    ? JSON.parse(fs.readFileSync(process.argv[5], 'utf8')) : undefined, process.argv[6]));
}

module.exports = { build, buildPortable, verify };
