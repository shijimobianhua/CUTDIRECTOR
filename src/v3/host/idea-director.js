import policy from '../service/director-policy.cjs';
export async function respondIdea(ctx,turn,signal){
 if(!turn.choice)return {text:'可以先聊聊这条视频想讲什么、给谁看。我会帮你整理成一句清楚的主题；有了模型，也能继续帮你润色想法。'};
 try{
 const llm=ctx.get?.('llm');
 if(!(await llm.listProviders()).some(p=>p.id===turn.choice.provider)||!(await llm.listModels(turn.choice.provider)).some(m=>m.id===turn.choice.id))throw Error();
 let text='',finished=false;
 const system='你是CUTDIRECTOR灵感助手，只讨论当前灵感，不读取其他项目。帮助新手梳理主题、受众、开场和故事方向。没有工程修改、工具、上传和支付权限。不要假装看过未提供的视频。每次给一个可用建议或问一个必要问题，回复最多600字。用户可主动将你的整段回复存为补充。未附灵感正文时只根据本条消息和本对话回复，先提醒可以勾选附上。'+policy.render();
 for await(const chunk of llm.stream({provider:turn.choice.provider,model:turn.choice.id,maxTokens:1000,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
 messages:[{role:'system',content:[{type:'text',text:system}]},{role:'user',content:[{type:'text',text:JSON.stringify(turn)}]}]})){
 if(chunk.type==='text-delta')text+=chunk.text;if(text.length>2000)throw Error();
 if(chunk.type==='finish')finished=!['error','aborted','tool-calls','tool_calls'].includes(chunk.reason?.kind||chunk.reason);
 }
 if(!finished||!text.trim())throw Error();return {text:text.trim()};
 }catch{return {text:'这次灵感讨论没有完成。你的输入和原记录都在，可以换个模型再试。'};}
}
