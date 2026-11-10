'use strict';
const http=require('node:http'),https=require('node:https'),{lookup}=require('node:dns/promises'),{isIP}=require('node:net');
function issue(code){return Object.assign(new Error(code),{code,status:422});}
function publicIP(address){
  if(isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(
      b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||
      a===203&&b===0&&c===113||a>=224);
  }
  if(isIP(address)===6){
    const ip=new URL('http://['+address+']/').hostname.slice(1,-1).toLowerCase();
    const [first,second]=ip.split(':').map(group=>parseInt(group||'0',16));
    return first>=0x2000&&first<=0x3fff&&first!==0x2002&&!(first===0x2001&&[0,2,0x10,0x20,0xdb8].includes(second));
  }
  return false;
}
function endpoint(raw){
  let url;
  try{url=new URL(raw);}catch{throw issue('SOURCE_URL_INVALID');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>2048||
    url.port&&url.port!==(url.protocol==='https:'?'443':'80'))throw issue('SOURCE_URL_INVALID');
  url.hash='';
  return url;
}
async function readPublic(raw,options={}){
  const resolve=options.lookup||lookup,request=options.request||((url,config,callback)=>(url.protocol==='https:'?https:http).request(url,config,callback));
  const deadline=Date.now()+12000;
  async function fetch(url,redirects){
    const hostname=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await new Promise((resolveLookup,rejectLookup)=>{
      const timer=setTimeout(()=>rejectLookup(issue('SOURCE_UNAVAILABLE')),Math.max(1,deadline-Date.now()));
      Promise.resolve(resolve(hostname,{all:true,verbatim:true})).then(resolveLookup,rejectLookup).finally(()=>clearTimeout(timer));
    });
    if(!addresses.length||addresses.some(record=>!publicIP(record.address)))throw issue('SOURCE_PRIVATE_ADDRESS');
    if(Date.now()>deadline)throw issue('SOURCE_UNAVAILABLE');
    return new Promise((resolve,reject)=>{
      const chosen=addresses[0];
      const req=request(url,{method:'GET',agent:false,headers:{'User-Agent':'CUTDIRECTOR-Reference/3','Accept':'text/html,text/plain','Accept-Encoding':'identity'},
        lookup:(_hostname,config,callback)=>callback(null,...(config?.all?[[chosen]]:[chosen.address,chosen.family]))},response=>{
        if([301,302,303,307,308].includes(response.statusCode)){
          response.resume();
          let next;
          try{next=endpoint(new URL(response.headers.location,url).href);}catch(error){reject(error);return;}
          if(redirects>=3||url.protocol==='https:'&&next.protocol!=='https:'){reject(issue('SOURCE_REDIRECT'));return;}
          fetch(next,redirects+1).then(resolve,reject);return;
        }
        const type=response.headers['content-type']||'';
        if(response.statusCode!==200||!/^text\/(html|plain)(;|$)/i.test(type)||
          /charset\s*=\s*["']?(?!utf-8|utf8)[a-z0-9-]+/i.test(type)||
          response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){
          response.resume();reject(issue('SOURCE_UNREADABLE'));return;
        }
        let size=0;const parts=[];
        response.on('data',part=>{size+=part.length;if(size>2*1024*1024){req.destroy(issue('SOURCE_TOO_LARGE'));return;}parts.push(part);});
        response.once('error',reject);
        response.once('end',()=>{
          try{resolve({url:url.href,type,raw:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))});}
          catch{reject(issue('SOURCE_UNREADABLE'));}
        });
      });
      const timer=setTimeout(()=>req.destroy(issue('SOURCE_UNAVAILABLE')),Math.max(1,deadline-Date.now()));
      req.once('error',error=>reject(error.status?error:issue('SOURCE_UNAVAILABLE')));
      req.once('close',()=>clearTimeout(timer));req.end();
    });
  }
  const result=await fetch(endpoint(raw),0);
  function entities(text){return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,key)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    if(key[0]!=='#')return named[key.toLowerCase()]||' ';
    const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):' ';
  });}
  const title=entities(/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(result.raw)?.[1]||'公开参考').replace(/<[^>]*>/g,'').trim().slice(0,240);
  const text=entities(result.type.startsWith('text/plain')?result.raw:result.raw
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<!--[^]*?-->/g,' ').replace(/<\/(p|div|h[1-6]|li|article|section)>|<br\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' '))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
  if(text.length<20)throw issue('SOURCE_UNREADABLE');
  return {url:result.url,title,text:text.slice(0,12000),truncated:text.length>12000,readAt:new Date().toISOString(),kind:'public-page'};
}
module.exports={readPublic,publicIP,endpoint};
