import {randomBytes} from 'node:crypto';
import searchUtils from '../service/searches.cjs';
const identities=new WeakMap();
function provider(web){
 if(!web?.search||!web?.selectSearchProvider)throw Object.assign(new Error('WEB_PROVIDER_UNAVAILABLE'),{code:'WEB_PROVIDER_UNAVAILABLE'});
 const selected=web.selectSearchProvider();
 if(!identities.has(selected))identities.set(selected,randomBytes(16).toString('hex'));
 return {id:String(selected.id).slice(0,120),generation:identities.get(selected)};
}
export function searchSelection(ctx){return provider(ctx.get?.('web'));}
export async function performSearch(ctx,worker,route,input,signal){
 const selected=searchSelection(ctx);
 const claim=await worker.call(route+'/claim','POST',JSON.stringify({...input,provider:selected}),{signal});
 const value=await claim.json();
 if(!claim.ok)return {status:claim.status,value};
 if(!value.data.dispatch)return {status:200,value:{data:value.data.job}};
 const job=value.data.job;
 try{
  const current=searchSelection(ctx);
  if(current.generation!==selected.generation)throw Object.assign(new Error('SEARCH_PROVIDER_CHANGED'),{code:'SEARCH_PROVIDER_CHANGED'});
  const result=await ctx.get('web').search({query:job.query,maxResults:8},signal);
  const complete=await worker.call(route+'/finish','POST',JSON.stringify({state:'ready',result:searchUtils.sanitize(result)}),{signal:AbortSignal.timeout(10000)});
  return {status:complete.status,value:await complete.json()};
 }catch(error){
  const complete=await worker.call(route+'/finish','POST',JSON.stringify({state:'unknown',error:error.code}),{signal:AbortSignal.timeout(10000)});
  return {status:complete.status,value:await complete.json()};
 }
}
