'use strict';
const Ajv=require('ajv/dist/2020');
const {digest}=require('./adapter-sdk.cjs');
const {issue}=require('./studio-store.cjs');
const ajv=new Ajv({strict:true,allErrors:true,validateFormats:false});
const manifestSchema={type:'object',additionalProperties:false,required:['schemaVersion','id','version','title','transport','capabilities','permissions','inputSchema','outputSchema','limits','cost','lifecycle','source','license'],
 properties:{
 schemaVersion:{const:2},id:{type:'string',pattern:'^[a-z][a-z0-9.-]{2,79}$'},version:{type:'string',pattern:'^[0-9]+\\.[0-9]+\\.[0-9]+$'},title:{type:'string',minLength:1,maxLength:160},
 transport:{enum:['openai-image','ark-image','ark-video','runninghub','comfyui','http','mcp-http','mcp-stdio','dsh','codex']},
 capabilities:{type:'array',minItems:1,maxItems:30,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9.-]{1,100}$'}},
 permissions:{type:'array',uniqueItems:true,items:{enum:['project-read','media-read','media-upload','network-read','paid-generation','local-execution']}},
 inputSchema:{type:'object'},outputSchema:{type:'object'},limits:{type:'object',additionalProperties:false,properties:{images:{type:'integer',minimum:0,maximum:100},audio:{type:'integer',minimum:0,maximum:20},video:{type:'integer',minimum:0,maximum:20},maxSeconds:{type:'integer',minimum:1,maximum:1500},ratios:{type:'array',items:{type:'string',maxLength:20}}}},
 cost:{enum:['free','paid','unknown']},lifecycle:{type:'object',additionalProperties:false,required:['submit','poll','cancel','idempotent'],properties:{submit:{const:true},poll:{type:'boolean'},cancel:{type:'boolean'},idempotent:{type:'boolean'}}},
 source:{type:'string',maxLength:1000},license:{type:'string',maxLength:200},description:{type:'string',maxLength:4000},hostRange:{const:'3'},dependencies:{type:'array',maxItems:100,items:{type:'string',maxLength:200}}
 }};
const check=ajv.compile(manifestSchema);
function inspectSchema(schema){const raw=JSON.stringify(schema);if(raw.length>40000||/"(?:\$ref|\$dynamicRef)"\s*:\s*"(?!#)/.test(raw))issue('TOOL_MANIFEST_INVALID','只允许包内的参数引用。');try{ajv.compile(schema);}catch{issue('TOOL_MANIFEST_INVALID','输入输出参数格式不完整。');}}
function validateManifest(value){if(!check(value))issue('TOOL_MANIFEST_INVALID','工具说明格式不正确：'+check.errors.slice(0,3).map(e=>e.instancePath+' '+e.message).join('；'));inspectSchema(value.inputSchema);inspectSchema(value.outputSchema);if(value.cost!=='free'&&!value.permissions.includes('paid-generation'))issue('TOOL_MANIFEST_INVALID','收费或费用未知的工具需要声明额度确认。');if(value.transport==='mcp-stdio'&&!value.permissions.includes('local-execution'))issue('TOOL_MANIFEST_INVALID','本地服务需要声明启动程序权限。');return structuredClone(value);}
function validateValue(value,schema){const fn=ajv.compile(schema);if(!fn(value))issue('TOOL_PARAMETERS_INVALID','参数与这个工具的说明不一致。');}
const genericInput={type:'object',required:['prompt'],additionalProperties:true,properties:{prompt:{type:'string',minLength:1,maxLength:12000}}};
const genericOutput={type:'object',additionalProperties:true};
function preset(transport,title,capabilities,limits={}){
 return {schemaVersion:2,id:'user.'+transport,version:'1.0.0',title,transport,capabilities,permissions:['project-read','media-read','media-upload','network-read','paid-generation',...(transport==='mcp-stdio'?['local-execution']:[])],inputSchema:genericInput,outputSchema:genericOutput,limits:{images:4,audio:0,video:0,maxSeconds:15,ratios:['16:9','9:16','1:1'],...limits},cost:'unknown',lifecycle:{submit:true,poll:!['openai-image','ark-image','codex','dsh','http','mcp-http','mcp-stdio'].includes(transport),cancel:['comfyui','runninghub'].includes(transport),idempotent:false},source:'用户自行配置',license:'用户配置；服务遵循厂商条款',hostRange:'3'};
}
const presets=[
 {...preset('openai-image','OpenAI / 兼容图片接口',['image-generation'],{images:10}),baseUrl:'https://api.openai.com/v1',model:'',downloadHosts:[]},
 {...preset('ark-image','火山方舟图片',['image-generation']),baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:''},
 {...preset('ark-video','火山方舟视频',['video-generation'],{images:2}),baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:''},
 {...preset('runninghub','RunningHub 工作流',['image-generation','video-generation'],{images:9,audio:3}),baseUrl:'https://www.runninghub.cn',workflowId:'',mappings:[],downloadHosts:[]},
 {...preset('comfyui','本机 ComfyUI',['image-generation','video-generation'],{images:9,audio:3}),baseUrl:'http://127.0.0.1:8188',workflow:{},mappings:[]},
 {...preset('http','自定义 HTTP 工具',['text-advice']),baseUrl:'https://',http:{submit:{path:'/run',method:'POST',body:{prompt:{$value:'input.prompt'}}},artifactsPath:'artifacts',textPath:'text'}},
 {...preset('mcp-http','MCP 远程工具',['text-advice']),baseUrl:'https://',toolName:''},
 {...preset('mcp-stdio','MCP 本地工具',['text-advice']),command:'',args:[],toolName:''},
 {...preset('dsh','已安装的 DSH 工具',['text-advice']),toolName:''},
 {...preset('codex','Codex 原生图片',['image-generation'],{images:9}),baseUrl:'',model:''}
];
const stages={script:{roles:['planner'],capabilities:['text-advice']},storyboard:{roles:['planner'],capabilities:['text-advice']},assets:{roles:['image'],capabilities:['image-generation']},prompts:{roles:['video'],capabilities:['video-generation']},review:{roles:['visual-qa'],capabilities:['visual-review']},generation:{roles:['video'],capabilities:['video-generation']}};
module.exports={validateManifest,validateValue,presets,preset,manifestSchema,stages,digest};
