'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {mkdir,writeFile,readFile}=require('node:fs/promises');
const {join}=require('node:path');
const yauzl=require('yauzl');
const {issue}=require('./studio-store.cjs');
function decode(bytes){if(bytes[0]===255&&bytes[1]===254)return bytes.subarray(2).toString('utf16le');try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{try{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{issue('IMPORT_ENCODING','无法识别文字编码，请先另存为 UTF-8 文本。');}}}
function entities(s){return s.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi,(_a,x,n,k)=>x||n?String.fromCodePoint(parseInt(x||n,x?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k]||''));}
async function extract(name,bytes){
 if(!/\.(txt|md|docx)$/i.test(name)||bytes.length>12*1024*1024||!bytes.length)issue('IMPORT_FORMAT','请选择 TXT、Markdown 或 DOCX，文件不超过 12 MB。');
 let content;
 if(/\.docx$/i.test(name)){
  let zip;try{zip=await yauzl.fromBufferPromise(bytes,{strictFileNames:true,validateEntrySizes:true});let found=false,count=0;
   try{for await(const entry of zip.eachEntry()){if(++count>3000||entry.uncompressedSize>24*1024*1024)issue('IMPORT_LIMIT','文档过大，请分章导入。');if(entry.fileName==='word/document.xml'){if(found||entry.uncompressedSize>Math.max(entry.compressedSize,1)*200)issue('IMPORT_LIMIT');found=true;const stream=await zip.openReadStreamPromise(entry),parts=[];let total=0;for await(const p of stream){total+=p.length;if(total>24*1024*1024)issue('IMPORT_LIMIT');parts.push(p);}const xml=Buffer.concat(parts).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))issue('IMPORT_FORMAT');content=entities(xml.replace(/<\/w:p>/g,'\n').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<[^>]*>/g,''));}}
   }finally{zip.close();}
  }catch(e){if(e.status)throw e;issue('IMPORT_FORMAT','这份 DOCX 无法读取，可以另存为 TXT 后导入。');}
 }else content=decode(bytes);
 if(!content||content.length>4000000||content.includes('\0'))issue('IMPORT_LIMIT','没有可读取的文字，或原文超过 400 万字。');
 return content.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
}
function parseScenes(text){
 const lines=text.split('\n'),scenes=[];let current=null;
 for(const line of lines){const t=line.trim();if(!t)continue;const heading=/^(?:第[一二三四五六七八九十百\d]+[章节集场幕]|#{1,4}\s|[0-9]+[-－][0-9]+\s)/.test(t);
  if(!current||heading){current={id:randomUUID(),title:heading?t.slice(0,160):'场景 '+(scenes.length+1),blocks:[]};scenes.push(current);if(heading)continue;}
  const speech=/^([^：:\n]{1,30})[：:]\s*(.*)$/.exec(t);
  const type=/内心独白/.test(speech?.[1]||'')?'inner':/画外音|旁白/.test(speech?.[1]||'')?'narration':speech?'dialogue':/^[【\[]音效/.test(t)?'sound':'action';
  current.blocks.push({id:randomUUID(),type,speaker:speech?speech[1]:'',text:(speech?speech[2]:t.replace(/^△\s*/,''))});
 }
 return scenes;
}
function createSources(studio,root){
 const dir=join(root,'studio-originals');
 async function preview(name,bytes){const content=await extract(name,bytes),digest=createHash('sha256').update(bytes).digest('hex');await mkdir(dir,{recursive:true});await writeFile(join(dir,digest),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});return {title:name,text:content,digest,characters:content.length,scenes:parseScenes(content.slice(0,100000)),previewLimit:100000,originalSaved:true};}
 async function original(projectId,id){const source=studio.get(projectId,id);if(source.kind!=='source')issue('DOCUMENT_NOT_FOUND');const bytes=await readFile(join(dir,source.digest));if(createHash('sha256').update(bytes).digest('hex')!==source.digest)issue('SOURCE_CHANGED');return {bytes,name:source.title};}
 return {preview,original,parseScenes};
}
module.exports={createSources,extract,parseScenes};
