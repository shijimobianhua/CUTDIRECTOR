import React,{useState,useCallback,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,Background,Controls,MiniMap,Handle,Position,applyNodeChanges,applyEdgeChanges,addEdge,useReactFlow,ReactFlowProvider} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
const h=React.createElement;
function Card({data,selected}){return h('div',{className:'cd-flow-card'+(selected?' is-selected':'')},h(Handle,{type:'target',position:Position.Left}),h('small',null,data.kind),h('strong',null,data.label),data.detail?h('span',null,data.detail):null,h(Handle,{type:'source',position:Position.Right}));}
const nodeTypes={content:Card};
function Board({initialNodes,initialEdges,onChange,onInspect}){
 const [nodes,setNodes]=useState(initialNodes),[edges,setEdges]=useState(initialEdges),flow=useReactFlow();
 const emit=(ns,es)=>onChange({nodes:ns.map(n=>({id:n.id,x:n.position.x,y:n.position.y})),edges:es.filter(e=>!e.data?.derived).map(e=>({source:e.source,target:e.target,type:e.data?.relation||'related'}))});
 const changeNodes=useCallback(changes=>{setNodes(old=>{const next=applyNodeChanges(changes.filter(c=>c.type!=='remove'),old);if(changes.some(c=>c.type==='position'&&c.dragging===false))emit(next,edges);return next;});},[edges]);
 const changeEdges=useCallback(changes=>{setEdges(old=>{const filtered=changes.filter(c=>c.type!=='remove'||!old.find(e=>e.id===c.id)?.data?.derived);const next=applyEdgeChanges(filtered,old);if(filtered.some(c=>c.type==='remove'))emit(nodes,next);return next;});},[nodes]);
 const connect=useCallback(connection=>{if(connection.source===connection.target)return;setEdges(old=>{const next=addEdge({...connection,id:crypto.randomUUID(),data:{relation:'related'},label:'关联'},old);emit(nodes,next);return next;});},[nodes]);
 const arrange=()=>{const next=nodes.map((n,i)=>({...n,position:{x:(n.data.depth||0)*310,y:(n.data.row??i)*150}}));setNodes(next);emit(next,edges);requestAnimationFrame(()=>flow.fitView({duration:450,padding:.16}));};
 return h(React.Fragment,null,h('div',{className:'cd-canvas-toolbar'},h('button',{type:'button',onClick:arrange},'自动排布'),h('button',{type:'button',onClick:()=>flow.fitView({duration:450,padding:.16})},'查看全部'),h('span',null,'拖动卡片整理；连接圆点建立关联；双击查看内容')),
 h(ReactFlow,{nodes,edges,nodeTypes,onNodesChange:changeNodes,onEdgesChange:changeEdges,onConnect:connect,onNodeDoubleClick:(_event,node)=>onInspect(node.id),fitView:true,minZoom:.15,maxZoom:1.8,deleteKeyCode:['Backspace','Delete'],nodesDraggable:true,proOptions:{hideAttribution:false},ariaLabelConfig:{'controls.zoomIn.ariaLabel':'放大画布','controls.zoomOut.ariaLabel':'缩小画布','controls.fitView.ariaLabel':'查看全部'},defaultEdgeOptions:{type:'smoothstep'},colorMode:document.documentElement.dataset.theme==='dark'?'dark':'light'},h(Background,{gap:24,size:1,color:'var(--cd-line, #d8dfe7)'}),h(Controls,{showInteractive:false}),h(MiniMap,{pannable:true,zoomable:true})));
}
window.CDCanvas={mount(element,props){const root=createRoot(element);root.render(h(ReactFlowProvider,null,h(Board,props)));return ()=>root.unmount();}};
