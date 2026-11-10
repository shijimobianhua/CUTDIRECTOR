const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../src/web/index.html'),'utf8');
const code=fs.readFileSync(require.resolve('../src/web/workbench.js'),'utf8');
function client(project=null){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,addEventListener(){},getAttribute(){return '';},setAttribute(){},removeAttribute(){},hasAttribute(){return false;},showModal(){this.open=true;},close(){this.open=false;}}]));
 const listeners={},requests=[],projectButtons=['preview','export','asset','asr','generate','srtImport'].map(id=>elements.get(id));
 for(const b of projectButtons)b.hasAttribute=n=>n==='data-project';
 const context=vm.createContext({document:{getElementById:id=>{a.ok(elements.has(id),`Missing DOM element: ${id}`);return elements.get(id);},querySelector:()=>({setAttribute(){}}),querySelectorAll:selector=>selector==='button,select,input,textarea'?projectButtons:[],addEventListener:(event,fn)=>listeners[event]=fn},window:{addEventListener(){}},location:{pathname:'/',origin:'http://localhost'},crypto:{randomUUID:()=> 'test-command'},setInterval(){},fetch:async(route,options)=>{requests.push({route,options});const values={'/projects':{projects:project?[project]:[]},'/active':{projectId:'P'},'/project?projectId=P':{project,selection:[],history:[]},'/deliveries?projectId=P':{jobs:[]},'/asr/status':{code:'PROVIDER_NOT_READY'}};return {ok:true,json:async()=>values[route]||{}};}});
 vm.runInContext(code,context);
 return {elements,context,requests,listeners};
}
const settled=()=>new Promise(r=>setImmediate(r));
test('thumbnail drawing contains portrait, landscape and square frames without distortion',async()=>{
 const {context}=client();await settled();
 for(const [width,height] of [[1080,1920],[1920,1080],[640,640],[1920,1080]]){
  const calls=[],drawing={fillRect:(...args)=>calls.push(args),drawImage:(...args)=>calls.push(args)};
  context.canvas={width:216,height:384,getContext:()=>drawing};
  context.video={videoWidth:width,videoHeight:height};
  vm.runInContext('paintThumbnail(canvas,video)',context);
  a.equal(drawing.fillStyle,'#faf9f5');a.deepEqual(calls[0],[0,0,216,384]);
  const [,x,y,w,h]=calls[1];a.equal(w/h,width/height);
  a.equal(x,(216-w)/2);a.equal(y,(384-h)/2);a.ok(w<=216&&h<=384);
 }
 const css=fs.readFileSync(require.resolve('../src/web/workbench.css'),'utf8');
 a.match(css,/#timeline canvas\{[^}]*height:auto;aspect-ratio:9\/16;[^}]*object-fit:contain/);
 a.match(css,/\.player-wrap video\{[^}]*object-fit:contain/);
});
test('standalone empty workspace initializes all controls and exposes honest ASR readiness',async()=>{
 const {elements:e,requests}=client();await settled();
 a.equal(e.get('mediaCount').textContent,'—');a.match(e.get('status').textContent,/尚无视频/);
 a.match(e.get('provider').textContent,/PROVIDER_NOT_READY.*VIDEO_ASR_CMD/);
 a.equal(e.get('export').disabled,true);a.ok(requests.every(r=>!r.options.body));
 e.get('newProject').onclick();a.equal(e.get('importDialog').open,true);
});
test('conflict retains edits, avoids false saved state and preserves revision command envelope',async()=>{
 const {elements:e,context,requests,listeners}=client();await settled();
 e.get('srt').value='保留用户输入';
 context.fetch=async(route,options)=>{requests.push({route,options});return {ok:false,json:async()=>({code:'REVISION_CONFLICT',message:'stale'})};};
 await vm.runInContext("state.project={projectId:'P',revision:7};work(()=>command('caption.correct','C1',{text:'修正'}))",context);
 const payload=JSON.parse(requests.at(-1).options.body);a.equal(requests.at(-1).route,'/command');a.equal(payload.baseRevision,7);a.equal(payload.commandId,'ui_test-command');a.equal(payload.actor,'human');
 a.equal(e.get('srt').value,'保留用户输入');a.equal(e.get('error').hidden,false);a.match(e.get('status').textContent,/视频已被修改/);a.equal(e.get('export').disabled,false);
 listeners.input({target:{closest:()=>true}});a.match(e.get('status').textContent,/未保存/);
});

test('default UI exposes readable captions and clip durations, with technical fields only in advanced drawer',async()=>{
 const p=require('./helpers.cjs').fixture();p.name='我的视频';const {elements:e}=client(p);await settled();
 a.match(e.get('segments').innerHTML,/片段 1/);a.match(e.get('timeline').innerHTML,/<canvas width="216" height="384"/);a.match(e.get('captions').innerHTML,/字幕文本/);
 for(const id of ['captions','segments','timeline','projectName','status','playInfo'])a.doesNotMatch(e.get(id).innerHTML+e.get(id).textContent,/projectId|revision|inFrame|outFrame|H.264|SRT|manifest/);
 a.match(e.get('trim').innerHTML,/inFrame/);a.equal(e.get('advancedDialog').open,false);
 a.doesNotMatch(html.split('<dialog id="advancedDialog"')[0],/projectId|baseRevision|SRT|H.264|provider|manifest/);
});
test('file picker and drag-drop share automatic upload without asking for paths or IDs',async()=>{
 const {elements:e,requests}=client();await settled();const file={name:'作品.mp4'};
 await e.get('videoFile').onchange({target:{files:[file]}});let upload=requests.find(r=>r.route.startsWith('/upload?'));a.equal(upload.options.body,file);a.equal(upload.options.headers['Content-Type'],'application/octet-stream');
 const count=requests.length;await e.get('dropZone').ondrop({preventDefault(){},dataTransfer:{files:[file]}});await settled();a.ok(requests.slice(count).some(r=>r.route.startsWith('/upload?')));
});
