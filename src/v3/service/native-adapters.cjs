'use strict';
const common={schemaVersion:1,version:'1.0.0',hostRange:'3',platform:['win32'],entryType:'dsh-service',readiness:'probe-required',resume:'manual',cancel:true,source:'CUTDIRECTOR managed',license:'project',
 inputSchema:{type:'object',additionalProperties:true},outputSchema:{type:'object',required:['text'],properties:{text:{type:'string',maxLength:12000}},additionalProperties:true}};
const adapters=[
 {name:'cutdirector_adapter_native_codex_image',description:'Codex 原生出图（先检查本机隔离）',manifest:{...common,pluginId:'cutdirector-native-codex-image',title:'Codex 原生出图',capabilities:['image-generation'],permissions:['project-read','media-read','media-upload','paid-generation'],cost:'paid',resume:'collect-only'}},
 {name:'cutdirector_adapter_native_dsh_analysis',description:'DSH 原生只读分析（独立会话）',manifest:{...common,pluginId:'cutdirector-native-dsh-analysis',title:'DSH 原生只读分析',capabilities:['text-advice'],permissions:['project-read'],cost:'model'}}
];
module.exports={adapters};
