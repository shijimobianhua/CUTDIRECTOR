'use strict';
const {fail,hash}=require('../core/util.cjs');

function endpoint(value){
  let url;
  try {url=new URL(value);}catch{fail('AGENT_CONFIG_INVALID','请输入有效的模型接口地址');}
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.hash||url.search||
     !(url.protocol==='https:'||(local&&url.protocol==='http:')))
    fail('AGENT_CONFIG_INVALID','远程接口须使用 HTTPS，本机接口可使用 HTTP');
  return url;
}
async function modelHttp(url,key,{payload,signal}={}){
  let response;
  try{
    response=await fetch(url,{method:payload?'POST':'GET',redirect:'error',
      signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)]),
      headers:{...(payload?{'Content-Type':'application/json'}:{}),...(key?{Authorization:'Bearer '+key}:{})},
      body:payload?JSON.stringify(payload):undefined});
  }catch(error){
    signal?.throwIfAborted();
    fail(error.name==='TimeoutError'?'MODEL_TIMEOUT':'MODEL_UNREACHABLE','无法连接模型服务，请核对地址或稍后重试');
  }
  if(!response.ok){
    if([401,403].includes(response.status))fail('MODEL_CREDENTIAL_INVALID','API Key 无效或没有模型权限');
    fail('MODEL_REQUEST_FAILED','模型服务返回 HTTP '+response.status);
  }
  const chunks=[];
  let length=0;
  for await(const part of response.body){
    length+=part.length;
    if(length>1024*1024)fail('MODEL_OUTPUT_INVALID','模型响应超出大小上限');
    chunks.push(part);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{fail('MODEL_OUTPUT_INVALID','模型服务未返回有效 JSON');}
}
function parseAction(raw){
  if(typeof raw!=='string'||raw.length>16000) fail('MODEL_OUTPUT_INVALID');
  try{return JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,''));}
  catch{fail('MODEL_OUTPUT_INVALID','模型必须返回一个 JSON 对象');}
}
function compatible({id,model,endpoint:address,vision=false,source='local',label=model,version},readKey){
  const url=endpoint(address);
  return {id,model,vision,source,label,version,async next({policy,context,image,signal}){
    const input=JSON.stringify(context);
    const content=image&&vision?[{type:'text',text:input},{type:'image_url',image_url:{url:image}}]:input;
    const result=await modelHttp(url,await readKey(),{signal,payload:{
      model,max_tokens:2048,messages:[{role:'system',content:policy},{role:'user',content}]}});
    return parseAction(result?.choices?.[0]?.message?.content);
  }};
}
function providers(config=process.env.VIDEO_AGENT_MODELS){
  if(!config)return [];
  const entries=JSON.parse(config);
  if(!Array.isArray(entries))fail('AGENT_CONFIG_INVALID');
  const ids=new Set();
  return entries.map(entry=>{
    const {id,model,keyEnv,vision=false}=entry;
    if(typeof id!=='string'||!/^[\w-]{1,48}$/.test(id)||ids.has(id)||
       typeof model!=='string'||!model.trim()||
       (keyEnv!==undefined&&!/^[A-Z_][A-Z_0-9]*$/.test(keyEnv))||typeof vision!=='boolean')
      fail('AGENT_CONFIG_INVALID');
    ids.add(id);
    return compatible({...entry,source:'environment',version:hash([entry.endpoint,model,keyEnv??null,vision])},()=>{
      const key=keyEnv&&process.env[keyEnv];
      if(keyEnv&&!key)fail('PROVIDER_NOT_READY','模型凭据未配置');
      return key;
    });
  });
}
module.exports={providers,compatible,endpoint,modelHttp,parseAction};
