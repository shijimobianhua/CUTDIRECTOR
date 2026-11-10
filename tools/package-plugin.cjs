'use strict';
// Produces a self-contained DSH bundle; source directories are not installable packages.
const fs=require('node:fs'),path=require('node:path');
function build(destination) {
 const root=path.resolve(__dirname,'..'),out=path.resolve(destination);fs.mkdirSync(out,{recursive:true});
 for(const name of ['package.json','cordis.patch.yml','icon.svg','writer.cjs','delegate.js','model-bridge.js','bridge-auth.cjs'])fs.copyFileSync(path.join(root,'src/host',name),path.join(out,name));
 fs.writeFileSync(path.join(out,'writer-location.json'),JSON.stringify({repoRoot:root},null,2));
 fs.cpSync(path.join(root,'src/host/locale'),path.join(out,'locale'),{recursive:true});
 fs.copyFileSync(path.join(root,'src/client/client.js'),path.join(out,'client.js'));
 const source=fs.readFileSync(path.join(root,'src/host/index.js'),'utf8').replaceAll('../../skills/','./skills/');fs.writeFileSync(path.join(out,'index.js'),source);
 for(const name of ['video-editing','footage-intake','talking-head-roughcut','render-qa','revise'])fs.cpSync(path.join(root,'skills',name),path.join(out,'skills',name),{recursive:true});
 fs.writeFileSync(path.join(out,'skill-manifest.json'),JSON.stringify(require('./skill-catalog.cjs').catalog(),null,2));
 return out;
}
if(require.main===module)console.log(build(process.argv[2]||'.m1-data/plugin'));
module.exports={build};
