'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomic,fail}=require('../core/util.cjs');
const {compatible,endpoint,modelHttp}=require('./provider.cjs');

const { protect } = require('../core/credentials.cjs');

function address(input){
  const kind=input.kind;
  if(!['deepseek','compatible','local'].includes(kind))fail('AGENT_CONFIG_INVALID');
  const url=endpoint(kind==='deepseek'?'https://api.deepseek.com':input.baseUrl);
  if(kind==='local'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))
    fail('AGENT_CONFIG_INVALID','免密服务仅支持本机回环地址');
  url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  return url.href.replace(/\/$/,'');
}

function createSettings(root,vault=protect){
  const file=path.join(root,'_agent','providers.json');
  const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{entries:[],defaultId:null};
  const publicEntry=({id,kind,baseUrl,model,label,vision,secret})=>({id,kind,baseUrl,model,label,vision,hasKey:!!secret});
  function view(){
    const state=read();
    return {entries:state.entries.map(publicEntry),defaultId:state.defaultId};
  }
  function adapters(){
    return read().entries.map(entry=>compatible({...entry,endpoint:entry.baseUrl+'/chat/completions'},
      ()=>entry.secret?vault('open',entry.secret):undefined));
  }
  async function candidate(input){
    const old=input.id?read().entries.find(item=>item.id===input.id):null;
    if(input.id&&!old)fail('NOT_FOUND');
    const baseUrl=address(input);
    const supplied=input.key;
    if(supplied!==undefined&&(typeof supplied!=='string'||supplied.length>4096||/[\r\n]/.test(supplied)))
      fail('AGENT_CONFIG_INVALID','API Key 格式无效');
    const key=input.kind==='local'?undefined:(supplied?.trim()||
      (old?.baseUrl===baseUrl&&old.secret?await vault('open',old.secret):undefined));
    if(input.kind==='deepseek'&&!key)fail('MODEL_CREDENTIAL_INVALID','请先粘贴 API Key');
    if(old?.secret&&old.baseUrl!==baseUrl&&!key&&input.kind!=='local')
      fail('MODEL_CREDENTIAL_INVALID','更换接口地址后请重新输入 API Key');
    return {old,key,baseUrl};
  }
  async function discover(input,signal){
    const {key,baseUrl}=await candidate(input);
    const result=await modelHttp(baseUrl+'/models',key,{signal});
    return {models:(Array.isArray(result?.data)?result.data:[]).filter(m=>typeof m?.id==='string'&&m.id.length<=200)
      .slice(0,250).map(m=>({id:m.id,label:typeof m.name==='string'?m.name.slice(0,200):m.id,
        vision:Array.isArray(m.input_modalities)&&m.input_modalities.includes('image')}))};
  }
  async function update(input,signal){
    if(['remove','default'].includes(input.action)){
      const current=read();
      if(!current.entries.some(item=>item.id===input.id))fail('NOT_FOUND');
      if(input.action==='remove')current.entries=current.entries.filter(item=>item.id!==input.id);
      if(input.action==='default'||current.defaultId===input.id)
        current.defaultId=input.action==='default'?input.id:current.entries[0]?.id??null;
      atomic(file,current);
      return view();
    }
    if(input.action!=='save')fail('AGENT_CONFIG_INVALID');
    const {old,key,baseUrl}=await candidate(input);
    const model=typeof input.model==='string'?input.model.trim():'';
    if(!model||model.length>200)fail('AGENT_CONFIG_INVALID','请选择或输入模型 ID');
    const result=await modelHttp(baseUrl+'/chat/completions',key,{signal,payload:{model,max_tokens:96,...(input.kind==='deepseek'?{thinking:{type:'disabled'}}:{}),
      messages:[{role:'user',content:'Reply with OK.'}]}});
    if(typeof result?.choices?.[0]?.message?.content!=='string'||!result.choices[0].message.content.trim())
      fail('MODEL_OUTPUT_INVALID','服务没有返回可用的聊天回复');
    const secret=key?await vault('seal',key):null;
    signal?.throwIfAborted();
    const current=read();
    if(old&&!current.entries.some(item=>item.id===old.id&&item.version===old.version))
      fail('AGENT_STATE_CONFLICT','配置已在另一页面修改，请刷新');
    const entry={id:old?.id||'local-'+randomUUID(),version:randomUUID(),kind:input.kind,baseUrl,model,
      label:typeof input.label==='string'&&input.label.trim()?input.label.trim().slice(0,100):model,
      vision:input.vision===true,secret};
    current.entries=current.entries.filter(item=>item.id!==entry.id).concat(entry);
    if(!current.defaultId)current.defaultId=entry.id;
    atomic(file,current);
    return view();
  }
  return {view,adapters,discover,update};
}
module.exports={createSettings,protect};
