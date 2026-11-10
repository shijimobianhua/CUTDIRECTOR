'use strict';
const {fail}=require('../core/util.cjs');

function configuredDelegate(env=process.env){
  const port=Number(env.VIDEO_DSH_ANALYSIS_PORT);
  const token=env.VIDEO_DSH_ANALYSIS_TOKEN;
  if(env.VIDEO_DSH_ANALYSIS_ISOLATED!=='1'||!Number.isInteger(port)||port<1024||port>65535||
     typeof token!=='string'||token.length<32)return undefined;
  return {isolated:true,async analyze({evidence,signal}){
    const result=await fetch('http://127.0.0.1:'+port+'/analysis',{method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({evidence})});
    if(!result.ok)fail('DSH_ANALYSIS_UNAVAILABLE');
    return result.json();
  }};
}
module.exports={configuredDelegate};
