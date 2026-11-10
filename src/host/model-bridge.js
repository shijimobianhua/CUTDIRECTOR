import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import auth from './bridge-auth.cjs';

async function catalog(llm){
  const providers=llm.listProviders().slice(0,50);
  const results=await Promise.allSettled(providers.map(async provider=>{
    const models=await llm.listModels(provider.id);
    return models.slice(0,150).map(model=>({provider:provider.id,model:model.id,
      label:(provider.name||provider.id)+' · '+model.name}));
  }));
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}

async function step(llm,input,signal){
  const {provider,model,policy,context}=input;
  if(typeof policy!=='string'||policy.length>14000||!context||typeof context!=='object'||
     JSON.stringify(context).length>24000||!(await catalog(llm)).some(m=>m.provider===provider&&m.model===model))
    throw Object.assign(new Error(),{code:'DSH_MODEL_UNAVAILABLE'});
  signal.throwIfAborted();
  const request={
    provider,model,maxTokens:2048,messages:[
      {role:'system',content:[{type:'text',text:policy}]},
      {role:'user',content:[{type:'text',text:JSON.stringify(context)+'\n\n请按上面的规则，只输出一个 JSON 对象。普通回答示例：{"kind":"reply","text":"我可以帮你剪视频。"}。需要剪辑时，按 proposal 或 tool 的字段输出。不要在 JSON 外写文字。'}]}
    ]
  };
  let text='',finish;
  for await(const chunk of llm.stream({...request,signal})){
    if(chunk.type==='text-delta')text+=chunk.text;
    if(chunk.type==='finish')finish=chunk;
    if(text.length>16000)throw Object.assign(new Error(),{code:'MODEL_OUTPUT_INVALID'});
  }
  const reason=finish?.reason?.kind||finish?.reason;
  if(!finish||!text.trim()||['error','aborted','length','tool-calls','tool_calls'].includes(reason))
    throw Object.assign(new Error(),{code:'DSH_MODEL_UNAVAILABLE'});
  return {text};
}

export function startModelBridge(ctx){
  const llm=ctx.get?.('llm');
  if(typeof llm?.listProviders!=='function'||typeof llm?.stream!=='function')return;
  let secret;
  try{secret=auth.key();}catch{return;}
  const instance=randomUUID();
  let route;
  const server=createServer(async(req,res)=>{
    const expected=auth.sign(secret,'call',route||'');
    if(!route||req.headers.host!=='127.0.0.1:'+server.address()?.port||
       !auth.matches(req.headers['x-cutdirector-bridge-proof'],expected)){
      res.writeHead(403).end();return;
    }
    const controller=new AbortController();
    res.on('close',()=>controller.abort());
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(44000)]);
    function send(code,value){
      if(!res.destroyed)res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    }
    try{
      if(req.method==='GET'&&req.url==='/models'){send(200,{models:await catalog(llm)});return;}
      if(req.method!=='POST'||req.url!=='/step'){send(404,{});return;}
      const chunks=[];
      let bytes=0;
      for await(const part of req){
        bytes+=part.length;
        if(bytes>100000)throw new Error('Request too large');
        chunks.push(part);
      }
      send(200,await step(llm,JSON.parse(Buffer.concat(chunks)),signal));
    }catch(error){
      const code=error.code==='MODEL_OUTPUT_INVALID'?'MODEL_OUTPUT_INVALID':'DSH_MODEL_UNAVAILABLE';
      send(503,{code});
    }
  });
  server.on('error',()=>{route=undefined;});
  server.listen(0,'127.0.0.1',()=>{route=server.address().port+':'+instance;});
  server.unref();
  return {
    headers:()=>route?{'X-Cutdirector-Bridge':route,'X-Cutdirector-Bridge-Proof':auth.sign(secret,'route',route)}:{},
    close:()=>{route=undefined;server.closeAllConnections();server.close();}
  };
}
