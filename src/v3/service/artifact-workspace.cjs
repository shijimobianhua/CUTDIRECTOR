'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
function fail(code,status=422){throw Object.assign(new Error(code),{code,status});}
function safeLeaf(name){return typeof name==='string'&&name.length>0&&name.length<=140&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f:]/.test(name)&&!/[. ]$/.test(name)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);}
async function hash(file){const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
function createArtifactWorkspace(root,store){
 const base=path.join(root,'adapter-work');
 function directories(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('ADAPTER_PATH_INVALID');return {root:path.join(base,id),inputDir:path.join(base,id,'inputs'),outputDir:path.join(base,id,'outputs')};}
 async function trustedDirectory(directory){await fsp.mkdir(directory,{recursive:true});const real=await fsp.realpath(directory);if(path.resolve(real).toLowerCase()!==path.resolve(directory).toLowerCase())fail('ADAPTER_PATH_INVALID');return real;}
 async function prepare(job){
 const dirs=directories(job.id);await trustedDirectory(dirs.root);await trustedDirectory(dirs.inputDir);await trustedDirectory(dirs.outputDir);
 const references=[];
 for(const ref of job.snapshot.references||[]){
 const original=path.join(root,'media',ref.digest);if(await hash(original)!==ref.digest)fail('ADAPTER_INPUT_CHANGED');
 const leaf=ref.id+(ref.kind==='image'?(ref.contentType==='image/png'?'.png':'.jpg'):'.mp4'),target=path.join(dirs.inputDir,leaf);
 if(fs.existsSync(target)){if(await hash(target)!==ref.digest)fail('ADAPTER_INPUT_CHANGED');}
 else{await fsp.copyFile(original,target,fs.constants.COPYFILE_EXCL);if(await hash(target)!==ref.digest)fail('ADAPTER_INPUT_CHANGED');}
 references.push({...ref,path:target});
 }
 await fsp.writeFile(path.join(dirs.root,'task.json'),JSON.stringify(job.snapshot,null,2),{mode:0o600});
 return {...dirs,references};
 }
 async function collect(job,result){
 const dirs=directories(job.id);await trustedDirectory(dirs.outputDir);
 if(!Array.isArray(result.artifacts)||!result.artifacts.length||result.artifacts.length>1)fail('ADAPTER_ARTIFACTS_INVALID');
 let total=0;const checked=[];
 for(const artifact of result.artifacts){
 if(!safeLeaf(artifact.file)||!['image','video'].includes(artifact.kind)||artifact.kind!==(job.snapshot.capability==='image-generation'?'image':'video'))fail('ADAPTER_ARTIFACTS_INVALID');
 const file=path.join(dirs.outputDir,artifact.file),info=await fsp.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size<=0||info.size>128*1024*1024)fail('ADAPTER_ARTIFACTS_INVALID');
 if(path.resolve(await fsp.realpath(file)).toLowerCase()!==path.resolve(file).toLowerCase())fail('ADAPTER_PATH_INVALID');
 total+=info.size;if(total>256*1024*1024)fail('ADAPTER_ARTIFACT_LIMIT');
 const digest=await hash(file);if(artifact.sha256&&artifact.sha256!==digest)fail('ADAPTER_ARTIFACT_CHANGED');
 checked.push({artifact,file,digest});
 }
 const imported=[];
 for(const [index,{artifact,file,digest}]of checked.entries()){
 const request=Object.assign(fs.createReadStream(file),{headers:{'content-type':'application/octet-stream'}});
 const asset=await require('./media.cjs').ingest(request,root,store,job.project_id,'extension-'+job.id+'-'+index,artifact.file,undefined,artifact.kind==='image',{
 source:'extension',externalJobId:job.id,externalShotId:job.snapshot.shotId,externalStoryVersion:job.snapshot.storyVersion,externalFrame:job.snapshot.frame||null,
 ...(artifact.kind==='image'?{expectedRatio:job.snapshot.ratio}:{}),visualReview:'user-required'
 });
 const owned=artifact.kind==='image'?store.image(job.project_id,asset.id):store.asset(job.project_id,asset.id);
 if(owned.digest!==digest)fail('ADAPTER_ARTIFACT_CHANGED');
 imported.push({id:asset.id,kind:artifact.kind,name:asset.name,shotId:job.snapshot.shotId,frame:job.snapshot.frame||null,storyVersion:job.snapshot.storyVersion});
 }
 return imported;
 }
 return {directories,prepare,collect};
}
module.exports={createArtifactWorkspace,safeLeaf};
