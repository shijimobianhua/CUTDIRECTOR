window.__ModuleLoader__.load({id:'@local/video-agent',factory(require){
 const h=require('react').createElement;
 function Page(){
  return h('iframe',{title:'CUTDIRECTOR · AI 剪辑导演',src:'/video-agent/',
    style:{width:'100%',height:'100%',border:0,display:'block'}});
 }
 return {inject:['slots'],apply(ctx){
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'video-agent'},Page));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'video-agent',order:5,label:()=> 'CUTDIRECTOR'},()=>h('img',{src:'/video-agent/icon.svg',width:24,height:24,alt:''})));
 }};
}});
