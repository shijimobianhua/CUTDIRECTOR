'use strict';
const fs=require('node:fs');
try{const file=process.argv[2];if(!file)throw Error('Usage: node tools/validate-tool.cjs <tool.json>');const input=JSON.parse(fs.readFileSync(file,'utf8'));require('../src/v3/service/tool-standard.cjs').validateManifest(input.manifest||input);console.log('Tool v2 manifest valid. No tool was started and no API was called.');}catch(e){console.error(e.message);process.exitCode=1;}
