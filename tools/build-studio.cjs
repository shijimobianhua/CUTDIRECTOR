'use strict';
const {buildSync}=require('esbuild');
const {join}=require('node:path');
const root=join(__dirname,'..');
const result=buildSync({write:false,entryPoints:[join(root,'src/v3/frontend/canvas.jsx')],bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof',outfile:join(root,'src/v3/web/studio-canvas-island.js'),define:{'process.env.NODE_ENV':'"production"'}});
for(const file of result.outputFiles)require('node:fs').writeFileSync(file.path,file.contents);
console.log('Built local canvas island (React Flow); no CDN runtime.');
