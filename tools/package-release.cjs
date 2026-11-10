'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash,fail}=require('../src/core/util.cjs');
function build(destination,{windows=false}={}){const root=path.resolve(__dirname,'..'),out=path.resolve(destination||path.join(root,'.m3-data/release'));
 if(fs.existsSync(out)&&fs.readdirSync(out).length)fail('PACKAGE_NOT_EMPTY','Choose an empty release directory');fs.mkdirSync(out,{recursive:true});
 for(const name of ['src','contracts','skills'])fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
 fs.mkdirSync(path.join(out,'tools'));for(const name of ['import-media.cjs','package-plugin.cjs','skill-catalog.cjs','agent-eval.cjs'])fs.copyFileSync(path.join(root,'tools',name),path.join(out,'tools',name));
 fs.copyFileSync(path.join(root,'package.json'),path.join(out,'package.json'));fs.cpSync(path.join(root,'docs/M3-running.md'),path.join(out,'README.md'));fs.copyFileSync(path.join(root,'docs/M4-running.md'),path.join(out,'M4-running.md'));
 require('./package-plugin.cjs').build(path.join(out,'plugin'));
 if(windows)require('./windows/runtime.cjs').windowsRuntime(out,root);
 const files={};function scan(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=path.join(dir,d.name);if(d.isDirectory())scan(f);else files[path.relative(out,f).replaceAll('\\','/')]=hash(fs.readFileSync(f));}}scan(out);
 fs.writeFileSync(path.join(out,'release-manifest.json'),JSON.stringify({version:1,node:'>=24',dependencies:'Node built-ins; separately configured existing FFmpeg/FFprobe',files},null,2));return out;
}
function verify(out){const m=JSON.parse(fs.readFileSync(path.join(out,'release-manifest.json')));for(const [name,h] of Object.entries(m.files)){if(hash(fs.readFileSync(path.join(out,name)))!==h)fail('PACKAGE_CHANGED',name);}return true;}
if(require.main===module){if(process.argv[2]==='--verify')console.log(verify(path.resolve(process.argv[3])));else if(process.argv[2]==='--windows')console.log(build(process.argv[3],{windows:true}));else console.log(build(process.argv[2]));}
module.exports={build,verify};
