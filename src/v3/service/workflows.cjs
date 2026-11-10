'use strict';
const {randomUUID}=require('node:crypto');
const stages={
 brief:{section:'story',input:'',output:'brief'},
 reference:{section:'reference',input:'brief',output:'reference'},
 assets:{section:'media-intake',input:'',output:'media'},
 story:{section:'story',input:['brief','reference'],output:'shots'},
 images:{section:'image-generation',input:['shots','reference'],output:'images',capability:'cutdirector-seedream'},
 video:{section:'generation',input:'images',output:'media',capability:'cutdirector-seedance'},
 review:{section:'reference',input:'media',output:'media'},
 arrangement:{section:'arrangement',input:'media',output:'arrangement'},
 handoff:{section:'delivery',input:'arrangement',output:'draft',capability:'cutdirector-jianying'}
};
function issue(code,status=422){return Object.assign(new Error(code),{code,status});}
const builtinTemplates=[
 {schemaVersion:1,id:'existing-media',version:'1.0.0',title:'整理已有视频',description:'导入自己的素材，确认顺序和字幕，再交给剪映。',license:'CUTDIRECTOR project',
  nodes:[{id:'assets',type:'assets'},{id:'arrange',type:'arrangement'},{id:'handoff',type:'handoff'}],
  edges:[{source:'assets',target:'arrange'},{source:'arrange',target:'handoff'}]},
 {schemaVersion:1,id:'idea-to-video',version:'1.0.0',title:'从想法开始',description:'先确定分镜，逐镜出图和试拍。生成前逐项确认上传和费用。',license:'CUTDIRECTOR project',
  nodes:[{id:'brief',type:'brief'},{id:'story',type:'story'},{id:'images',type:'images'},{id:'video',type:'video'},{id:'review',type:'review'},{id:'arrange',type:'arrangement'},{id:'handoff',type:'handoff'}],
  edges:[{source:'brief',target:'story'},{source:'story',target:'images'},{source:'images',target:'video'},{source:'video',target:'review'},{source:'review',target:'arrange'},{source:'arrange',target:'handoff'}]}
];
function validateGraph(value){
 if(!value||Object.keys(value).some(key=>!['nodes','edges'].includes(key))||!Array.isArray(value.nodes)||!value.nodes.length||value.nodes.length>30||!Array.isArray(value.edges)||value.edges.length>80)throw issue('WORKFLOW_INVALID');
 const ids=new Set();
 const nodes=value.nodes.map((node,index)=>{
  if(!node||Object.keys(node).some(key=>!['id','type','title','x','y','group','folded'].includes(key))||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id)||ids.has(node.id)||!Object.hasOwn(stages,node.type)||
    node.title!=null&&(typeof node.title!=='string'||node.title.length>80))throw issue('WORKFLOW_INVALID');
  if(node.group!=null&&(typeof node.group!=='string'||node.group.length>80)||node.folded!=null&&typeof node.folded!=='boolean')throw issue('WORKFLOW_INVALID');
  ids.add(node.id);
  const result={id:node.id,type:node.type,title:node.title||'',x:node.x??80+(index%4)*240,y:node.y??60+Math.floor(index/4)*180};
  if(!Number.isFinite(result.x)||!Number.isFinite(result.y)||Math.abs(result.x)>10000||Math.abs(result.y)>10000)throw issue('WORKFLOW_INVALID');
  if(node.group)result.group=node.group;
  if(node.folded===true)result.folded=true;
  return result;
 });
 const unique=new Set(),incoming=new Map(nodes.map(node=>[node.id,0])),following=new Map(nodes.map(node=>[node.id,[]]));
 const edges=value.edges.map(edge=>{
  if(!edge||Object.keys(edge).some(key=>!['source','target'].includes(key))||!ids.has(edge.source)||!ids.has(edge.target)||edge.source===edge.target)throw issue('WORKFLOW_INVALID');
  const key=edge.source+':'+edge.target;if(unique.has(key))throw issue('WORKFLOW_INVALID');unique.add(key);
  const source=nodes.find(node=>node.id===edge.source),target=nodes.find(node=>node.id===edge.target);
  if(!(Array.isArray(stages[target.type].input)?stages[target.type].input:[stages[target.type].input]).includes(stages[source.type].output))throw issue('WORKFLOW_PORT_MISMATCH');
  incoming.set(edge.target,incoming.get(edge.target)+1);following.get(edge.source).push(edge.target);
  return {source:edge.source,target:edge.target};
 });
 const queue=nodes.filter(node=>!incoming.get(node.id)).map(node=>node.id),order=[];
 while(queue.length){const id=queue.shift();order.push(id);for(const target of following.get(id)){incoming.set(target,incoming.get(target)-1);if(!incoming.get(target))queue.push(target);}}
 if(order.length!==nodes.length)throw issue('WORKFLOW_CYCLE');
 return {nodes,edges,order};
}
function validateTemplate(input){
 if(!input||Object.keys(input).some(key=>!['schemaVersion','id','version','title','description','license','nodes','edges'].includes(key))||
  input.schemaVersion!==1||!/^[a-z][a-z0-9-]{2,79}$/.test(input.id)||!/^\d+\.\d+\.\d+$/.test(input.version)||
  !['title','description','license'].every(key=>typeof input[key]==='string'&&input[key].length>0&&input[key].length<1000))throw issue('TEMPLATE_INVALID');
 const graph=validateGraph({nodes:input.nodes,edges:input.edges});
 return {...input,nodes:graph.nodes,edges:graph.edges};
}
function createWorkflows(db,project,registry,production,arrangement){
 function get(projectId){
  project(projectId);
  const row=db.prepare('SELECT * FROM workflow_versions WHERE project_id=? ORDER BY version DESC LIMIT 1').get(projectId);
  return row?{version:row.version,createdAt:row.created_at,graph:JSON.parse(row.snapshot)}:null;
 }
 function templates(){return [...builtinTemplates,...db.prepare('SELECT value FROM workflow_templates ORDER BY rowid DESC').all().map(row=>JSON.parse(row.value))];}
 function preview(value){
  const template=validateTemplate(value);
  const disabled=template.nodes.map(node=>stages[node.type].capability).filter(id=>id&&!registry.list().find(entry=>entry.manifest.pluginId===id)?.enabled);
  const paid=template.nodes.filter(node=>['images','video'].includes(node.type)).map(node=>node.id);
  return {template,missingCapabilities:[...new Set(disabled)],paidNodes:paid,needsLocalBinding:true};
 }
 function importTemplate(value){
  const checked=preview(value),template=checked.template;
  db.prepare('INSERT INTO workflow_templates VALUES (?,?,?) ON CONFLICT(id,version) DO NOTHING').run(template.id,template.version,JSON.stringify(template));
  const previous=db.prepare('SELECT value FROM workflow_templates WHERE id=? AND version=?').get(template.id,template.version);
  if(previous.value!==JSON.stringify(template))throw issue('TEMPLATE_VERSION_CONFLICT',409);
  return checked;
 }
 function save(projectId,input){
  project(projectId);const graph=validateGraph(input.graph);
  if(typeof input.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.commandId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw issue('WORKFLOW_INVALID');
  const payload=JSON.stringify({projectId,graph,expectedVersion:input.expectedVersion});
  db.exec('BEGIN IMMEDIATE');
  try{
   const receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(input.commandId);
   if(receipt){if(receipt.payload!==payload)throw issue('IDEMPOTENCY_CONFLICT',409);db.exec('COMMIT');return JSON.parse(receipt.result);}
   const before=get(projectId);
   if((before?.version||0)!==input.expectedVersion)throw issue('WORKFLOW_CONFLICT',409);
   const changed=new Set(graph.nodes.filter(node=>node.type!==before?.graph.nodes.find(old=>old.id===node.id)?.type).map(node=>node.id));
   if(JSON.stringify(before?.graph.edges)!==JSON.stringify(graph.edges))for(const edge of [...(before?.graph.edges||[]),...graph.edges])changed.add(edge.target);
   for(let i=0;i<graph.nodes.length;i++)for(const edge of graph.edges)if(changed.has(edge.source))changed.add(edge.target);
   db.prepare('INSERT INTO workflow_versions VALUES (?,?,?,?,?)').run(randomUUID(),projectId,input.expectedVersion+1,JSON.stringify(graph),new Date().toISOString());
   const result={...get(projectId),affected:[...changed]};
   db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(input.commandId,payload,JSON.stringify(result));
   db.prepare("INSERT INTO events(type,subject_id,scope_id) VALUES ('workflow.changed',?,?)").run(projectId,projectId);
   db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function status(projectId){
  const workflow=get(projectId);if(!workflow)return null;
  const p=production(projectId),arranged=arrangement(projectId),assets=db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id=?').get(projectId).n;
  const saved=JSON.parse(db.prepare('SELECT snapshot FROM stories WHERE project_id=? ORDER BY version DESC LIMIT 1').get(projectId)?.snapshot||'null');
  const selected=[...new Set((saved?.shots||[]).flatMap(shot=>[shot.assetId,shot.startImageId,shot.endImageId]).filter(Boolean))];
  if(!selected.length&&arranged)selected.push(...new Set(arranged.clips.map(clip=>clip.assetId)));
  const reviewed=selected.length>0&&selected.every(id=>{const latest=db.prepare('SELECT * FROM quality_checks WHERE project_id=? AND target_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(projectId,id);
    const owned=db.prepare('SELECT digest FROM images WHERE project_id=? AND id=? UNION ALL SELECT digest FROM assets WHERE project_id=? AND id=?').get(projectId,id,projectId,id);
    return latest?.executor==='manual'&&latest.verdict==='accepted'&&latest.story_version===(p.storyVersion||0)&&latest.digest===owned?.digest;});
  const complete={brief:!!p.storyVersion,story:!!p.storyVersion,images:p.shotCount>0&&p.shotsWithStartImage===p.shotCount,
   video:p.shotCount>0&&p.shotsWithVideo===p.shotCount,assets:assets>0,arrangement:!!arranged,reference:!!db.prepare('SELECT 1 FROM reference_assets WHERE project_id=?').get(projectId),
   review:reviewed,handoff:!!db.prepare("SELECT 1 FROM drafts WHERE project_id=? AND state='created' AND version=?").get(projectId,arranged?.version||0)};
  const nodes=workflow.graph.nodes.map(node=>{
   const capability=stages[node.type].capability,entry=capability?registry.list().find(entry=>entry.manifest.pluginId===capability):null;
   const blocked=!!entry&&!entry.enabled;
   return {...node,section:stages[node.type].section,state:blocked?'disabled':complete[node.type]?'available':'needs-action',
    approval:node.type==='images'||node.type==='video'?'paid':node.type==='handoff'?'external-write':'local',
    inputKind:stages[node.type].input,outputKind:stages[node.type].output};
  });
  return {...workflow,nodes};
 }
 function undo(projectId,input){
  if(input?.confirm!==true||!Number.isSafeInteger(input.appliedVersion)||input.appliedVersion<2)throw issue('WORKFLOW_APPROVAL_REQUIRED',403);
  const row=db.prepare('SELECT snapshot FROM workflow_versions WHERE project_id=? AND version=?').get(projectId,input.appliedVersion-1);
  if(!row)throw issue('WORKFLOW_INVALID');
  const old=JSON.parse(row.snapshot);
  return save(projectId,{commandId:input.commandId,expectedVersion:input.appliedVersion,graph:{nodes:old.nodes,edges:old.edges}});
 }
 return {get,save,templates,preview,importTemplate,status,undo};
}
module.exports={createWorkflows,validateGraph,validateTemplate,stages,builtinTemplates};
