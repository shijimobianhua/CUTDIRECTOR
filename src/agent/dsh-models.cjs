'use strict';
const {hash,fail}=require('../core/util.cjs');
const {parseAction}=require('./provider.cjs');
const auth=require('../host/bridge-auth.cjs');

function bridgeFor(req){
  const route=req.headers['x-cutdirector-bridge'];
  const match=typeof route==='string'&&/^(\d{1,5}):([a-f0-9-]{36})$/.exec(route);
  if(!match||Number(match[1])<1024||Number(match[1])>65535)return;
  const secret=auth.key();
  if(!auth.matches(req.headers['x-cutdirector-bridge-proof'],auth.sign(secret,'route',route)))fail('FORBIDDEN');
  return {base:'http://127.0.0.1:'+match[1],proof:auth.sign(secret,'call',route),instance:match[2]};
}

async function call(bridge,resource,signal,payload){
  try{
    const r=await fetch(bridge.base+resource,{method:payload?'POST':'GET',redirect:'error',
      signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(payload?45000:2500)]),
      headers:{'X-Cutdirector-Bridge-Proof':bridge.proof,...(payload?{'Content-Type':'application/json'}:{})},
      body:payload?JSON.stringify(payload):undefined});
    if(!r.ok)fail('DSH_MODEL_UNAVAILABLE');
    return await r.json();
  }catch{
    signal?.throwIfAborted();
    fail('DSH_MODEL_UNAVAILABLE','DSH 模型连接不可用。请检查 DSH 设置后重试，或手动选择其他模型');
  }
}

async function dshModels(bridge,signal){
  if(!bridge)return [];
  let result;
  try{result=await call(bridge,'/models',signal);}catch{return [];}
  if(!Array.isArray(result.models))return [];
  return result.models.map(({provider,model,label})=>({
    id:'dsh-'+hash([provider,model]).slice(0,28),model,label,source:'dsh',version:bridge.instance,vision:false,
    async next({policy,context,signal}){
      const result=await call(bridge,'/step',signal,{provider,model,policy,context});
      return parseAction(result.text);
    }
  }));
}
module.exports={bridgeFor,dshModels};
