'use strict';
const fs=require('node:fs'),path=require('node:path');
const catalog=require('../docs/v3/evaluation-samples.json'),{reference}=require('../src/v3/service/director-policy.cjs');
function evaluate(records){
 if(!Array.isArray(records)||records.length>1000)throw Error('EXPECTED_RESPONSE_RECORDS_ARRAY');
 const variants=['baseline','specialized','preferences','revoked'],seen=new Set(),results=[];
 for(const record of records){
  const sample=catalog.samples.find(item=>item.id===record.sampleId);
  if(!sample||!variants.includes(record.variant)||typeof record.answer!=='string'||record.answer.length>100000||
    typeof record.model?.provider!=='string'||typeof record.model?.id!=='string')throw Error('INVALID_EVALUATION_RECORD');
  const model=record.model.provider+'/'+record.model.id,key=record.sampleId+'|'+model+'|'+record.variant;
  if(seen.has(key))throw Error('DUPLICATE_EVALUATION_RECORD');seen.add(key);
  const kept=sample.mustKeep.filter(term=>record.answer.includes(term));
  const measured=name=>Number.isFinite(record[name])&&record[name]>=0?record[name]:null;
  results.push({sampleId:sample.id,model,variant:record.variant,policy:record.variant==='baseline'?null:reference,
    requiredInformationRetention:sample.mustKeep.length?kept.length/sample.mustKeep.length:null,missingInformation:sample.mustKeep.filter(term=>!kept.includes(term)),
    durationErrorSeconds:sample.targetSeconds!=null&&Number.isFinite(record.actualSeconds)?Math.abs(record.actualSeconds-sample.targetSeconds):null,
    manualRework:measured('manualRework'),unauthorizedWrites:measured('unauthorizedWrites'),toolCalls:measured('toolCalls'),
    jargonMatches:[...record.answer.matchAll(/revision|transcriptId|wordId|roughcut\.apply|segment\.trim/g)].map(match=>match[0]),
    measuredInput:record.evidenceReceipt||null});
 }
 const comparisons=[];
 for(const sample of catalog.samples)for(const model of [...new Set(results.map(row=>row.model))]){
  const present=results.filter(row=>row.sampleId===sample.id&&row.model===model).map(row=>row.variant);
  comparisons.push({sampleId:sample.id,model,present,missing:variants.filter(variant=>!present.includes(variant))});
 }
 return {schemaVersion:1,createdAt:new Date().toISOString(),networkCalls:0,policy:reference,
  warning:'离线统计已提供的实际响应，不运行模型，不把缺失数据填成通过。关键词保留只作筛查，语义正确性仍需人工检查。不同模型不作为同模型对照。',
  results,comparisons,readiness:results.length?'responses-imported':'not-measured'};
}
if(require.main===module){
 const [input,output]=process.argv.slice(2);
 if(!input||!output){console.error('node tools/v3-policy-eval.cjs responses.json report.json');process.exitCode=1;}
 else{const report=evaluate(JSON.parse(fs.readFileSync(path.resolve(input),'utf8')));fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2));console.log('Offline evaluation records: '+report.results.length+'; model calls: 0');}
}
module.exports={evaluate};
