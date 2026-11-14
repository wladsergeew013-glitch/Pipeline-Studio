'use strict';
const assert=require('node:assert/strict'),{app,deferred,project,Core}=require('./app_harness');
const tests=[],test=async(name,fn)=>{await fn();tests.push(name);console.log('PASS',name)};
(async()=>{
 await test('R02 two activations completed in reverse order never overwrite the other draft',async()=>{
  const a=app(),gate=deferred();a.context.A=project('A');a.context.B=project('B');a.context.gate=gate;
  a.run("const realGet=dbGet;dbGet=async key=>key==='handle:A'?gate.promise:realGet(key)");
  const first=a.run("activateDocument(A,{name:'A.html',key:'A'})");await new Promise(r=>setImmediate(r));await a.run("activateDocument(B,{name:'B.html',key:'B'})");gate.resolve(null);await first;
  assert.equal(a.run('DOC.key'),'B');assert.equal(a.run('S.project.title'),'B');assert.equal(a.run("volatileStore.get('document:B').title"),'B');
 });
 await test('R03 overlapping native Save As operations keep source identity through a third save',async()=>{
  const a=app(),gate=deferred(),win=require('node:path').win32;let picks=0,writes=0;const saved=[];a.context.fixture=project();a.context.fixture.materials=[{id:'m',path:'materials/source.pdf'}];await a.run("activateDocument(fixture,{name:'Process.html',nativePath:'C:\\\\Project\\\\Process.html'})");
  a.context.bridge=async(route,data)=>{if(route==='pick-save')return {nativePath:++picks===1?'C:\\Project\\Reports\\First.html':'C:\\Project\\Second.html'};if(route==='stat')return {state:'ok',nativePath:data.path?win.resolve(win.dirname(data.documentPath),data.path):data.nativePath};if(route==='link')return {openURL:'pipelinestudio://test'};if(route==='save'){const p=JSON.parse(data.text);saved.push(p);if(++writes===1)await gate.promise;return {nativePath:data.nativePath,filename:win.basename(data.nativePath),digest:'written'}}throw Error(route)};
  a.run("window.STUDIO_DESKTOP={call:bridge};buildDocumentHTML=async p=>JSON.stringify(p)");const one=a.run('saveDocument(true)');while(!writes)await new Promise(r=>setImmediate(r));const two=a.run('saveDocument(true)');gate.resolve();await Promise.all([one,two]);await a.run('saveDocument()');
  assert.equal(picks,2);for(const p of saved)assert.equal(p.materials[0].nativePath,'C:\\Project\\materials\\source.pdf');assert.equal(a.run('S.project.materials[0].nativePath'),'C:\\Project\\materials\\source.pdf');assert.equal(a.run('S.fileDirty'),false);
 });
 await test('R05 a late server upload cannot attach to a newly opened local document',async()=>{
  const a=app(),gate=deferred();a.context.A=project('A');a.context.B=project('B');a.context.gate=gate;await a.run("activateDocument(A,{name:'A.html',server:true})");a.run('request=()=>gate.promise');const upload=a.run("uploadFile({name:'old.pdf',size:3,type:'application/pdf'},null,null,{attachNodeId:'a'})");const observed=upload.catch(e=>e);await a.run("activateDocument(B,{name:'B.html'})");gate.resolve({id:'old',title:'Old',asset:'a'.repeat(32),version:1});await observed;
  assert.equal(a.run('S.project.materials.length'),0);assert.equal(a.run('page().nodes[0].materials.length'),0);assert.equal(a.run('S.fileDirty'),false);
 });
 await test('R06 a late registry response preserves a newer local registry edit',async()=>{
  const a=app(),gate=deferred();a.context.fixture=project();a.context.gate=gate;await a.run("activateDocument(fixture,{name:'Server.html',server:true})");a.run('request=()=>gate.promise');const refresh=a.run('refreshMaterialRegistry()');await new Promise(r=>setImmediate(r));a.run("S.project.materials.push({id:'new',title:'New',version:1});changed()");gate.resolve([]);await refresh;assert.equal(a.run("S.project.materials[0].id"),'new');
 });
 await test('R07 Undo and Redo restore opened file bytes and handles',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture,{name:'Files.html'})");a.context.old=new File(['OLD'],'a.pdf',{type:'application/pdf'});a.context.fresh=new File(['NEW'],'b.pdf',{type:'application/pdf'});await a.run('uploadFile(old)');const id=a.run('S.project.materials[0].id');a.context.id=id;await a.run('uploadFile(fresh,id)');await a.run('undo()');let url=await a.run('resolveMaterial(S.project.materials[0])');assert.equal(await (await fetch(url)).text(),'OLD');await a.run('redo()');url=await a.run('resolveMaterial(S.project.materials[0])');assert.equal(await (await fetch(url)).text(),'NEW');
 });
 await test('R08 explicit file handle wins over a same-named file in the connected folder',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture,{name:'Files.html'})");a.context.local=new File(['ROOT'],'same.pdf');a.context.external=new File(['EXTERNAL'],'same.pdf');a.run("S.project.materials=[{id:'m',path:'same.pdf'}];DOC.sourceHandles.set('m',{getFile:async()=>external});DOC.root={queryPermission:async()=> 'granted',getFileHandle:async()=>({getFile:async()=>local})}");const url=await a.run('resolveMaterial(S.project.materials[0])');assert.equal(await (await fetch(url)).text(),'EXTERNAL');
 });
 await test('R12 R13 a new page supports interaction and Undo/Redo restores its active index',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture,{name:'Pages.html'})");a.run("inputDialog=(title,label,value,accept)=>accept('New page')");await a.run("action('new-page')");assert(Array.isArray(a.run('page().buses')));assert(Array.isArray(a.run('page().symmetrySets')));await a.run('undo()');assert.equal(a.run('S.pageIndex'),0);assert.equal(a.run('page().id'),'p');await a.run('redo()');assert.equal(a.run('S.pageIndex'),1);assert.equal(a.run('page().title'),'New page');
 });
 await test('R14 Undo and Redo restore the full collapsed row state including an empty set',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture,{name:'Rows.html'})");a.run("S.collapsedRows={p:new Set()};change(()=>S.collapsedRows.p.add('row'))");await a.run('undo()');assert.equal(a.run('S.collapsedRows.p.size'),0);await a.run('redo()');assert.equal(a.run("S.collapsedRows.p.has('row')"),true);
 });
 await test('R15 Ctrl+S inside quick editing prevents default and saves through the document command',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture,{name:'Keys.html'})");a.context.event={key:'s',code:'KeyS',ctrlKey:true,shiftKey:true,target:{closest:q=>q==='.quick-editing'?{}:null},preventDefault(){this.prevented=true}};a.run("quickEdit={};saveDocument=async asNew=>{window.savedAs=asNew};onKey(event)");await new Promise(r=>setImmediate(r));assert.equal(a.context.event.prevented,true);assert.equal(a.context.window.savedAs,true);
 });
 await test('R16 export commits the visible connection label before creating its snapshot',async()=>{
  const a=app();a.context.fixture=project();a.context.fixture.pages[0].edges=[{id:'e',source:'a',target:'a',label:'OLD'}];await a.run("activateDocument(fixture,{name:'Label.html'})");a.run("quickEdgeEdit={edge:'e',value:'NEW',segment:0};edgePress=null");const p=await a.run('portableProject()');assert.equal(p.pages[0].edges[0].label,'NEW');
 });
 await test('R02 a late server open cannot change the active local document or server flag',async()=>{
  const a=app(),gate=deferred();a.context.gate=gate;a.context.fixture=project('Local');a.run('request=()=>gate.promise');const opening=a.run('openServerDocument()');await a.run("activateDocument(fixture,{name:'Local.html'})");gate.resolve({role:'editor'});await opening;assert.equal(a.run('S.server'),false);assert.equal(a.run('S.project.title'),'Local');
 });
 await test('R08 the explicitly selected source handle survives draft close and reopen',async()=>{
  const a=app();a.context.fixture=project();a.context.fixture.materials=[{id:'m',path:'same.pdf'}];a.context.external=new File(['EXTERNAL'],'same.pdf');await a.run("activateDocument(fixture,{name:'Files.html',key:'files'})");a.run("DOC.sourceHandles.set('m',{getFile:async()=>external});changed()");await a.run('save()');await a.run("activateDocument(fixture,{name:'Files.html',key:'files'})");const url=await a.run('resolveMaterial(S.project.materials[0])');assert.equal(await (await fetch(url)).text(),'EXTERNAL');
 });
 await test('R17 a native-only PDF preview is opened and audited as a preview',async()=>{
  const a=app();a.context.fixture=project();a.context.fixture.materials=[{id:'m',title:'Word',kind:'document',nativePath:'C:/Original.docx',previewNativePath:'D:/Preview.pdf'}];await a.run("activateDocument(fixture,{name:'Preview.html'})");
  a.context.calls=[];a.run("window.STUDIO_DESKTOP={call:async(route,data)=>{calls.push({route,data});return {state:'ok',nativePath:data.nativePath}}};v5OpenMaterial=async()=>{window.previewOpened=true};materialExternal=()=>{throw Error('preview skipped')}");
  await a.run("openMaterial('m')");assert.equal(a.context.window.previewOpened,true);const results=await a.run('checkAllMaterials({network:false})');assert.equal(results.length,2);assert(results.every(r=>r.state==='ok'));assert.equal(results.find(r=>r.preview).source,'D:/Preview.pdf');
 });
 await test('R02 edits in the current document during another open are saved before handover',async()=>{
  const a=app(),gate=deferred();a.context.A=project('A');a.context.B=project('B');a.context.gate=gate;await a.run("activateDocument(A,{name:'A.html',key:'A'})");
  a.run("const getBeforeHandover=dbGet;dbGet=async key=>key==='handle:B'?gate.promise:getBeforeHandover(key)");
  const opening=a.run("activateDocument(B,{name:'B.html',key:'B'})");await new Promise(r=>setImmediate(r));a.run("change(()=>S.project.title='Late edit in A')");gate.resolve(null);await opening;
  assert.equal(a.run("volatileStore.get('document:A').title"),'Late edit in A');assert.equal(a.run('S.project.title'),'B');
 });
 console.log('TOTAL',tests.length);
})().catch(e=>{console.error(e);process.exitCode=1});
