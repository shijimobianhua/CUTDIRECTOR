'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash}=require('../src/core/util.cjs');
const dependencies={'video-editing':['video_project_read','video_project_apply','video_render_start','video_job_read'],'footage-intake':['video_project_apply','video_inspect','video_transcribe','video_artifact_read'],'talking-head-roughcut':['video_project_read','video_project_apply'],'render-qa':['video_job_read','video_artifact_read'],revise:['video_project_read','video_project_apply']};
function catalog(root=path.resolve(__dirname,'../skills')){return Object.entries(dependencies).map(([name,tools])=>{const content=fs.readFileSync(path.join(root,name,'SKILL.md'),'utf8');return {name,description:content.match(/^description: (.+)$/m)[1],hash:hash(content),tools};});}
module.exports={catalog};
