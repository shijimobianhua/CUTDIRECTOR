import {respond} from './director.js';

export async function runDirector(ctx,worker,route,turn,signal){
  const trace=[];
  const invoke=async(action,input={})=>{
    const response=await worker.call(route+'/'+action,'POST',JSON.stringify(input),{signal});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error?.code),{code:value.error?.code});
    return value.data;
  };
  if(!turn.choice)return respond(ctx,turn,{signal});
  try{
    for(let step=0;step<4;step++){
      await invoke('begin');
      const result=await respond(ctx,{...turn,context:{...turn.context,toolResults:trace}},{signal,tools:true});
      if(!result.toolRequest){await invoke('finish');return result;}
      const evidence=await invoke('read',result.toolRequest);
      trace.push({request:result.toolRequest,result:evidence});
    }
    await invoke('finish');
    return {text:'这次已经核对了几项资料。请把要改的内容缩小到一个镜头或一段字幕，我会接着给具体建议。'};
  }catch(error){
    const messages={RUN_CANCELLED:'已停止这次建议。已保存的作品和记录都在。',
      RUN_STALE:'作品刚刚有了新版本。请再发一次要求，我会根据新版给建议。',
      RUN_BUDGET:'这次核对已到上限。请缩小到一个镜头或一段内容再试。',
      RUN_TOOL_FORBIDDEN:'这项分析需要你先选择对象，并明确附上相应文字。'};
    await worker.call(route+'/finish','POST','{}',{signal:AbortSignal.timeout(5000)}).then(response=>response.body?.cancel()).catch(()=>{});
    return {text:signal?.aborted?'已停止这次建议。已保存的作品和记录都在。':
      messages[error.code]||'这次分析中断了。记录已经保留，可以重新发送继续。'};
  }
}
