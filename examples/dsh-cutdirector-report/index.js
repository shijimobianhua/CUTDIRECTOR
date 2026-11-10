import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
export const inject=['tools','skills'];
export function apply(ctx){
 ctx.skills.register({name:'weekend-vlog-example',source:'CUTDIRECTOR example',provider:'runtime',description:'把周末生活想法整理成简单镜头，仅本机示例。',content:'先写一句主题，再按到达、细节、结束三个画面整理；没有素材时不要声称已经拍摄或剪完。'});
 for(const version of ['1.0.0','1.1.0']){
 ctx.tools.register({
  name:'cutdirector_adapter_local_rhythm_report__'+version.replaceAll('.','_'),
  description:'镜头节奏检查 '+version,
  parameters:{type:'object',properties:{action:{type:'string',enum:['manifest','probe','execute']},input:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false},
  output:{schema:{type:'object',additionalProperties:true},render(_args,value){return [{type:'text',text:JSON.stringify(value)}];}},
  isConcurrencySafe:()=>true,timeoutMs:5000,
  async execute(args,exec){
   exec.signal.throwIfAborted();
   if(args.action==='manifest')return {...manifest,version};
   if(args.action==='probe')return {available:true,message:'本机镜头时长检查可用，不访问网络、不调用模型。'};
   if(args.action!=='execute'||!args.input||typeof args.input.request!=='string')throw Error('INVALID_INPUT');
   const shots=args.input.story?.shots||[],assets=args.input.assets||[];
   if(!shots.length&&!assets.length)return {text:'这次没有附上分镜或素材信息。勾选你要检查的资料，再准备一次调用；不会自行读取其他工程。'};
   const seconds=shots.reduce((sum,shot)=>sum+Number(shot.durationUs||0)/1e6,0),long=shots.filter(shot=>shot.durationUs>10000000).length;
   return {text:'已根据本次附上的文字和时长检查：'+shots.length+'个镜头，镜头总长'+seconds+'秒，'+assets.length+'段素材。'+
    (long?'有'+long+'个镜头超过10秒，可以检查是否需要拆成两个画面。':'可以先按当前顺序预览节奏。')+
    '这里只核对时长，没有看过实际画面或听过声音，也没有修改分镜。'+(version==='1.1.0'?'本次使用1.1版检查规则。':'')};
  }
 });
 }
}
