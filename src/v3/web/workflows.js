'use strict';
function projectWorkflow(project,workspace){
 const section=element('section','',workspace);section.dataset.workbenchSection='workflow';section.tabIndex=-1;
 element('h2','看看制作步骤',section);
 element('p','先用模板整理步骤。点某一步回到对应成果区，生成或写草稿仍需原来的确认。修改连线只保存步骤关系，不会删掉旧成果。',section);
 const status=element('p','正在读取…',section);status.setAttribute('role','status');
 const templateRegion=element('div','',section),graphRegion=element('div','',section),editor=element('details','',section);
 element('summary','调整步骤和连线',editor);const controls=element('div','',editor);
 const names={brief:'写一句主题',reference:'找参考',assets:'放入已有素材',story:'确定分镜',images:'画分镜图',video:'试拍视频',review:'检查画面',arrangement:'安排视频顺序',handoff:'交给剪映'};
 let current=null,draft=null,templates=[],busy=false,attempt;
 const view=openView('workflow:'+project.id,error=>{if(section.isConnected)status.textContent=viewError(error);});
 function saveInput(){if(draft)view.write({baseVersion:current?.version||0,draft});}
 async function load(){
  try{
   const [saved,available]=await Promise.all([api('projects/'+project.id+'/workflow'),api('templates')]);
   if(!section.isConnected)return;
   current=saved;templates=available;draft=saved?{nodes:structuredClone(saved.graph.nodes),edges:structuredClone(saved.graph.edges)}:null;
   const pending=await view.read();
   if(!section.isConnected)return;
   if(pending&&pending.baseVersion===(saved?.version||0))draft=pending.draft;
   render();status.textContent=saved?'已保存第 '+saved.version+' 版制作步骤。':'先选一个制作模板。';
   if(pending&&pending.baseVersion!==(saved?.version||0)){status.textContent='制作步骤已有更新，上次草案保留。';button(graphRegion,'下载上次输入',()=>downloadLocalDraft('制作步骤草案',pending));}
  }catch(error){status.textContent=workflowProblem(error);}
 }
 function render(){
  templateRegion.replaceChildren();graphRegion.replaceChildren();controls.replaceChildren();
  const select=element('select','',element('label','选一种制作方法',templateRegion));
  for(const [i,item]of templates.entries())element('option',item.title+' · '+item.version,select).value=i;
  button(templateRegion,draft?'换用这个模板':'用这个模板安排步骤',()=>{
   const template=templates[Number(select.value)];draft={nodes:structuredClone(template.nodes),edges:structuredClone(template.edges)};saveInput();render();
   status.textContent='模板已放入草案，原成果保留。检查后点「保存制作步骤」。';
  });
  const upload=element('input','',element('label','导入制作模板（JSON）',templateRegion));upload.type='file';upload.accept='.json';
  upload.addEventListener('change',async()=>{
   const file=upload.files[0];if(!file)return;
   try{if(file.size>100000)throw new Error('TEMPLATE_INVALID');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
    const preview=await api('templates',{template:value});previewTemplate(preview);
   }catch(error){status.textContent=workflowProblem(error);}
  });
  if(!draft)return;
  const groups=[...new Set(draft.nodes.map(node=>node.group).filter(Boolean))];
  for(const name of groups){const members=draft.nodes.filter(node=>node.group===name),folded=members.some(node=>node.folded);
   button(graphRegion,(folded?'展开':'收起')+'「'+name+'」 · '+members.length+'步',()=>{for(const member of members)member.folded=!folded;saveInput();render();});
  }
  drawGraph();
  const list=element('ol','',graphRegion);list.className='workflow-list';
  const states=new Map((current?.nodes||[]).map(node=>[node.id,node]));
  const groupLists=new Map();
  for(const name of groups){const details=element('details','',element('li','',list));details.open=!draft.nodes.some(node=>node.group===name&&node.folded);element('summary',name,details);groupLists.set(name,element('ol','',details));}
  for(const node of draft.nodes){
   const li=element('li','',groupLists.get(node.group)||list),state=states.get(node.id);
   element('strong',node.title||names[node.type],li);
   const description=state?.state==='disabled'?'工具已停用':state?.state==='available'?'已有可查看内容':'还需要处理';
   element('small',description+(state?.approval==='paid'?' · 生成前确认费用':state?.approval==='external-write'?' · 写入前确认':''),li);
   const sectionId={brief:'story',reference:'reference',assets:'media-intake',story:'story',images:'image-generation',video:'generation',review:'quality',arrangement:'arrangement',handoff:'delivery'}[node.type];
   button(li,'打开这一步',()=>locateWorkbench(workspace.querySelector('[data-workbench-section="'+sectionId+'"]')));
  }
  const type=element('select','',element('label','再加一步',controls));
  for(const [id,title]of Object.entries(names))element('option',title,type).value=id;
  button(controls,'添加这个步骤',()=>{draft.nodes.push({id:'node_'+crypto.randomUUID(),type:type.value});saveInput();render();});
  const remove=element('select','',element('label','要移除的步骤',controls));
  for(const node of draft.nodes)element('option',node.title||names[node.type],remove).value=node.id;
  button(controls,'移除这一步',()=>{draft.nodes=draft.nodes.filter(node=>node.id!==remove.value);draft.edges=draft.edges.filter(edge=>edge.source!==remove.value&&edge.target!==remove.value);saveInput();render();});
  const groupName=element('input','',element('label','给选中步骤分组（留空可移出）',controls));groupName.maxLength=80;
  button(controls,'设置步骤分组',()=>{const node=draft.nodes.find(node=>node.id===remove.value);if(!node)return;node.group=groupName.value.trim();node.folded=false;saveInput();render();});
  const from=element('select','',element('label','从这一步',controls)),to=element('select','',element('label','接到这一步',controls));
  for(const node of draft.nodes){element('option',node.title||names[node.type],from).value=node.id;element('option',node.title||names[node.type],to).value=node.id;}
  button(controls,'添加连线',()=>{draft.edges.push({source:from.value,target:to.value});saveInput();render();});
  for(const [index,edge]of draft.edges.entries()){
   const row=element('p',(draft.nodes.find(node=>node.id===edge.source)?.title||names[draft.nodes.find(node=>node.id===edge.source)?.type])+' → '+
     (draft.nodes.find(node=>node.id===edge.target)?.title||names[draft.nodes.find(node=>node.id===edge.target)?.type]),controls);
   button(row,'移除连线',()=>{draft.edges.splice(index,1);saveInput();render();});
  }
  const save=button(graphRegion,'保存制作步骤',saveGraph,true);save.disabled=busy;save.dataset.saveWorkflow='';
  button(controls,'重新读取已保存步骤',load);
  if(current?.version>1)button(graphRegion,'撤销上次步骤调整',undoGraph);
  button(controls,'导出这个制作模板',()=>{
   const template={schemaVersion:1,id:'my-production-template',version:'1.0.0',title:project.title+'的制作步骤',description:'导入后重新绑定素材、账户和各步输入。',license:'User supplied',
    nodes:draft.nodes.map(({id,type,title,group,folded})=>({id,type,...title?{title}:{},...group?{group,folded:!!folded}:{}})),edges:draft.edges};
   downloadLocalDraft('制作模板',template);
  });
 }
 function drawGraph(){
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');svg.classList.add('workflow-canvas');svg.setAttribute('role','group');svg.setAttribute('aria-label','制作步骤关系，下方提供相同步骤的按钮列表');
  const representatives=new Map();
  for(const node of draft.nodes)if(node.group&&node.folded&&!representatives.has(node.group))representatives.set(node.group,node);
  const visible=draft.nodes.filter(node=>!node.group||!representatives.has(node.group)||representatives.get(node.group)===node);
  const label=node=>node.group&&representatives.has(node.group)?node.group+'（'+draft.nodes.filter(other=>other.group===node.group).length+'步）':node.title||names[node.type];
  const positions=new Map(draft.nodes.map((node,index)=>[node.id,{x:node.x??80+(index%4)*240,y:node.y??60+Math.floor(index/4)*180}]));
  for(const node of draft.nodes)if(node.group&&representatives.has(node.group))positions.set(node.id,positions.get(representatives.get(node.group).id));
  const points=[...positions.values()];
  const minX=Math.min(...points.map(p=>p.x))-30,minY=Math.min(...points.map(p=>p.y))-30,maxX=Math.max(...points.map(p=>p.x))+210,maxY=Math.max(...points.map(p=>p.y))+100;
  svg.setAttribute('viewBox',[minX,minY,maxX-minX,maxY-minY].join(' '));
  function add(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(text)el.textContent=text;svg.append(el);return el;}
  for(const edge of draft.edges){const a=positions.get(edge.source),b=positions.get(edge.target);if(a&&b&&(a.x!==b.x||a.y!==b.y))add('line',{x1:a.x+160,y1:a.y+30,x2:b.x,y2:b.y+30,stroke:'currentColor','stroke-width':2});}
  for(const node of visible){const pos=positions.get(node.id);add('rect',{x:pos.x,y:pos.y,width:160,height:60,rx:12,fill:'var(--accent-soft)',stroke:'var(--accent)'});add('text',{x:pos.x+12,y:pos.y+36,fill:'var(--ink)','font-size':16},label(node));}
  for(const node of visible){
   const pos=positions.get(node.id);
   const group=document.createElementNS(ns,'g');
   group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label',(node.title||names[node.type])+'，回车打开，方向键移动');
   group.dataset.workflowNode=node.id;
   const children=[...svg.children].filter(child=>(child.tagName==='rect'&&Number(child.getAttribute('x'))===pos.x&&Number(child.getAttribute('y'))===pos.y)||
     (child.tagName==='text'&&Number(child.getAttribute('x'))===pos.x+12&&Number(child.getAttribute('y'))===pos.y+36));
   children.forEach(child=>group.append(child));svg.append(group);
   const open=()=>{if(node.group&&representatives.has(node.group)){for(const member of draft.nodes.filter(other=>other.group===node.group))member.folded=false;saveInput();render();return;}const id={brief:'story',reference:'reference',assets:'media-intake',story:'story',images:'image-generation',video:'generation',review:'quality',arrangement:'arrangement',handoff:'delivery'}[node.type];locateWorkbench(workspace.querySelector('[data-workbench-section="'+id+'"]'));};
   let drag;
   group.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const matrix=svg.getScreenCTM();if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    drag={x:point.x,y:point.y,baseX:pos.x,baseY:pos.y,moved:false};
    group.setPointerCapture(event.pointerId);group.focus();
   });
   group.addEventListener('pointermove',event=>{
    if(!drag)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const dx=point.x-drag.x,dy=point.y-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;
    if(drag.moved){node.x=Math.round(drag.baseX+dx);node.y=Math.round(drag.baseY+dy);group.setAttribute('transform','translate('+dx+' '+dy+')');}
   });
   group.addEventListener('pointerup',()=>{
    if(!drag)return;const moved=drag.moved;drag=null;
    if(moved){saveInput();render();status.textContent='步骤位置已调整，保存制作步骤后生效。';}
    else open();
   });
   group.addEventListener('pointercancel',()=>{if(drag){node.x=drag.baseX;node.y=drag.baseY;}drag=null;group.removeAttribute('transform');});
   group.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();open();return;}
    const move={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
    if(!move)return;event.preventDefault();node.x=pos.x+move[0];node.y=pos.y+move[1];saveInput();render();
    section.querySelector('[data-workflow-node="'+CSS.escape(node.id)+'"]')?.focus();
   });
  }
  const box=[minX,minY,maxX-minX,maxY-minY];
  const zoom=element('div','',graphRegion);zoom.className='actions';
  for(const [label,scale]of [['放大',0.8],['缩小',1.25],['适合窗口',0]])button(zoom,label,()=>{
   if(!scale){svg.setAttribute('viewBox',box.join(' '));return;}
   const current=svg.viewBox.baseVal,w=current.width*scale,h=current.height*scale;
   if(w<200||w>30000)return;
   svg.setAttribute('viewBox',[current.x+(current.width-w)/2,current.y+(current.height-h)/2,w,h].join(' '));
  });
  graphRegion.append(svg);
 }
 async function saveGraph(){
  if(busy||!draft)return;busy=true;
  const input={graph:draft,expectedVersion:current?.version||0},signature=JSON.stringify(input);
  if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
  try{
   const result=await api('projects/'+project.id+'/workflow',{...input,commandId:attempt.id});attempt=undefined;
   current=result;draft={nodes:result.graph.nodes,edges:result.graph.edges};saveInput();await load();status.textContent='步骤已保存。受影响的后续步骤 '+result.affected.length+' 项，已有素材和付费任务保留，需要时打开对应步骤重新检查。';
  }catch(error){status.textContent=workflowProblem(error);}finally{busy=false;section.querySelectorAll('[data-save-workflow]').forEach(button=>{button.disabled=false;});}
 }
 function undoGraph(){
  const normalize=graph=>JSON.stringify({nodes:graph.nodes.map((node,index)=>({id:node.id,type:node.type,title:node.title||'',x:node.x??80+(index%4)*240,y:node.y??60+Math.floor(index/4)*180})),edges:graph.edges});
  if(!current||normalize(draft)!==normalize(current.graph)){status.textContent='请先保存当前步骤草案，或导出保留后再撤销。';return;}
  const dialog=element('dialog','',section);dialog.setAttribute('aria-label','撤销步骤调整');
  element('h2','恢复上一次制作步骤？',dialog);element('p','只恢复步骤关系与位置，已保存的分镜、图片、视频和任务不会被删除。',dialog);
  const message=element('p','',dialog);let running=false;const version=current.version,commandId=crypto.randomUUID();
  const back=button(dialog,'保留当前步骤',()=>dialog.close());
  const go=button(dialog,'确认恢复为新版本',async()=>{
   if(running)return;running=true;back.disabled=go.disabled=true;
   try{
    const result=await api('projects/'+project.id+'/workflow/undo',{appliedVersion:version,commandId,confirm:true});
    current=result;draft={nodes:result.graph.nodes,edges:result.graph.edges};saveInput();dialog.close();await load();
    status.textContent='已恢复上一次制作步骤，并另存为第 '+result.version+' 版。';
   }catch(error){message.textContent=workflowProblem(error);}finally{running=false;back.disabled=go.disabled=false;}
  },true);
  dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
 }
 function previewTemplate(checked){
  const dialog=element('dialog','',section);dialog.setAttribute('aria-label','预览制作模板');
  element('h2',checked.template.title,dialog);element('p',checked.template.description,dialog);
  element('small','许可 '+checked.template.license+' · 版本 '+checked.template.version,dialog);
  element('p','共 '+checked.template.nodes.length+' 步，其中 '+checked.paidNodes.length+' 步可能产生生成费用。导入不会提交任务。',dialog);
  if(checked.missingCapabilities.length)element('p','有 '+checked.missingCapabilities.length+' 项工具当前已停用，需要连接后才可使用。',dialog);
  element('p','模板不携带素材和账号，应用到项目后需要重新选择。',dialog);
  const message=element('p','',dialog);let busy=false;
  const back=button(dialog,'先不导入',()=>dialog.close());
  const go=button(dialog,'确认添加模板',async()=>{
   if(busy)return;busy=true;back.disabled=go.disabled=true;
   try{await api('templates',{template:checked.template,confirm:true});dialog.close();await load();}
   catch(error){message.textContent=workflowProblem(error);}finally{busy=false;back.disabled=go.disabled=false;}
  },true);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();back.focus();
 }
 load();
}
function workflowProblem(error){
 return ({WORKFLOW_PORT_MISMATCH:'这两步需要的内容类型不同，暂时不能这样连接。',WORKFLOW_CYCLE:'这些连线绕回了前面的步骤，请移除形成循环的连线。',
 WORKFLOW_INVALID:'请保留有效步骤，移除重复或无效连线后再保存。',WORKFLOW_CONFLICT:'制作步骤已有新版本。当前草案仍保留，请先导出备份再重新读取。',
 TEMPLATE_INVALID:'这个模板格式无法读取。请使用从工作台导出的制作模板。',TEMPLATE_VERSION_CONFLICT:'已有同名同版本的另一个模板，请修改模板版本再导入。'})[error.message]||describe(error);
}
