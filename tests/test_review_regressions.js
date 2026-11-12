'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),C=require('../app/static/core.js');
const source=fs.readFileSync(path.join(__dirname,'../app/static/app.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
const checks=[],test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name)};
const node=(id,x=0,y=0,extra={})=>({id,type:'block',title:id,x,y,w:120,h:60,relativeLock:true,...extra});
const edge=(id,source,target,extra={})=>({id,source,target,sourcePort:'right',targetPort:'left',...extra});
const page=(nodes,edges=[],extra={})=>({id:'p',title:'Page',collapseMode:'nodes',nodes,edges,buses:[],groups:[],drawings:[],layoutOptions:{autoSpace:false,busSymmetry:false},...extra});
const project=(title='Draft')=>({format:'pipeline-studio',schemaVersion:6,id:'doc',title,revision:0,materials:[],pages:[page([node('a')])]});
function app(){
 const context=vm.createContext({Core:C,URL,Blob,console,EMOJI:{},Map,Set,Date,Promise,location:{protocol:'file:',hostname:'',href:'file:///D:/Recipient/Project/Process.html',pathname:'/D:/Recipient/Project/Process.html'},document:{addEventListener(){},querySelector(){return null}},window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(source,context);
 vm.runInContext("renderShell=render=fit=updateStatus=toast=closeFilePopover=closeNodeStatus=finishEdgeLabel=closeModal=()=>{};normalize=x=>x;hydrateAssets=async()=>{};buildDocumentHTML=async p=>JSON.stringify(p);",context);
 return {context,run:s=>vm.runInContext(s,context)};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
(async()=>{
 await test('Recent draft survives two reopens with an older original file',async()=>{
  const a=app(),old=project('Old disk'),fresh=project('Latest draft');a.context.old=old;a.context.fresh=fresh;
  await a.run("recentDocuments=[{key:'recent',name:'Original.html',fileDirty:true}];volatileStore.set('document:recent',fresh);volatileStore.set('recent-v3',recentDocuments);volatileStore.set('handle:recent',{name:'Original.html',queryPermission:async()=> 'granted',getFile:async()=>({text:async()=>JSON.stringify(old)})});");
  for(let i=0;i<2;i++){await a.run("openRecentDocument('recent')");assert.equal(a.run('S.project.title'),'Latest draft');assert.equal(a.run('S.fileDirty'),true);assert.equal(a.run("volatileStore.get('recent-v3')[0].fileDirty"),true);}
  assert.equal(a.run("volatileStore.get('document:recent').title"),'Latest draft');
 });
 for(const native of [false,true])await test((native?'Native':'Browser')+' HTML save keeps edits made during the write dirty',async()=>{
  const a=app(),gate=deferred();a.context.fixture=project('Before save');a.context.gate=gate;
  await a.run("activateDocument(fixture,{name:'Original.html',nativePath:'C:\\\\Author\\\\Process.html'})");
  a.context.writes=[];
  if(native)a.run("window.STUDIO_DESKTOP={call:async(route,data)=>{if(route==='save'){writes.push(JSON.parse(data.text));await gate.promise;return {nativePath:data.nativePath,digest:'saved',filename:'Process.html'}};throw Error(route)}};");
  else a.run("DOC.handle={name:'Original.html',queryPermission:async()=> 'granted',createWritable:async()=>({write:async blob=>{writes.push(JSON.parse(await blob.text()));await gate.promise},close:async()=>{}})};");
  const saving=a.run('saveDocument()');while(!a.context.writes.length)await new Promise(r=>setImmediate(r));
  a.run("S.project.title='Edited during save';changed()");gate.resolve();await saving;
  assert.equal(a.context.writes[0].title,'Before save');assert.equal(a.run('S.project.title'),'Edited during save');assert.equal(a.run('S.fileDirty'),true);
  assert.equal(a.run("volatileStore.get('recent-v3')[0].fileDirty"),true);assert.equal(a.run("volatileStore.get('document:'+DOC.key).title"),'Edited during save');
  await a.run('saveDocument()');assert.equal(a.run('S.fileDirty'),false);
 });
 await test('A save finishing after switching documents cannot change the active document',async()=>{
  const a=app(),gate=deferred();a.context.fixture=project('First');a.context.second=project('Second');a.context.gate=gate;
  await a.run("activateDocument(fixture,{name:'First.html'})");a.run("DOC.handle={name:'First.html',queryPermission:async()=> 'granted',createWritable:async()=>({write:async()=>{window.writing=true;await gate.promise},close:async()=>{}})};");
  const saving=a.run('saveDocument()');while(!a.run('window.writing'))await new Promise(r=>setImmediate(r));
  await a.run("activateDocument(second,{name:'Second.html',fileDirty:true})");gate.resolve();await saving;
  assert.equal(a.run('S.project.title'),'Second');assert.equal(a.run('DOC.name'),'Second.html');assert.equal(a.run('S.fileDirty'),true);
 });
 await test('Moved HTML resolves original and preview relative to its new location',async()=>{
  const a=app();a.run("DOC.direct=true;S.project={materials:[]}");
  a.context.m={id:'image',path:'materials/photo.png',nativePath:'C:\\Author\\Project\\materials\\photo.png',previewPath:'materials/preview.pdf',previewNativePath:'C:\\Author\\Project\\materials\\preview.pdf'};
  assert.equal(a.run('assetURL(m)'),'file:///D:/Recipient/Project/materials/photo.png');
  assert.equal(await a.run('resolveMaterial(m,true)'),'file:///D:/Recipient/Project/materials/preview.pdf');
  a.context.m.path='../shared/photo.png';assert.equal(a.run('assetURL(m)'),'file:///D:/Recipient/shared/photo.png');
 });
 await test('First save and Save As rebase nested original and PDF preview paths',async()=>{
  const a=app();a.context.fixture=project();await a.run("activateDocument(fixture)");
  a.context.m={id:'m',path:'diagram.png',nativePath:'C:\\Project\\materials\\diagram.png',previewPath:'old.pdf',previewNativePath:'C:\\Project\\previews\\diagram.pdf'};a.run('S.project.materials=[m]');
  let saved=await a.run("portableProject(false,documentSnapshot(),'C:\\\\Project\\\\Process.html')");assert.equal(saved.materials[0].path,'materials/diagram.png');assert.equal(saved.materials[0].previewPath,'previews/diagram.pdf');
  saved=await a.run("portableProject(false,documentSnapshot(),'C:\\\\Project\\\\Reports\\\\Process.html')");assert.equal(saved.materials[0].path,'../materials/diagram.png');assert.equal(saved.materials[0].previewPath,'../previews/diagram.pdf');
  saved=await a.run("portableProject(false,documentSnapshot(),'D:\\\\Elsewhere\\\\Process.html')");assert.equal(saved.materials[0].path,undefined);assert.equal(saved.materials[0].nativePath,a.context.m.nativePath);
  assert.equal(a.context.m.path,'diagram.png');
 });
 await test('Fold, compact, align and expand preserves hidden branch geometry',async()=>{
  const a=app(),pg=page([node('a',10,0,{collapsible:true}),node('at',250,200),node('b',50,1200,{collapsible:true}),node('bt',290,1400)],[edge('a1','a','at'),edge('b1','b','bt')]);
  a.context.fixture={...project(),pages:[pg]};await a.run("activateDocument(fixture,{name:'Layout.html'});S.compact=true;S.selected=new Set(['a','b']);S.display=C.display(page(),new Set(['a','b']),true);");
  assert(a.run("S.display.nodes.find(n=>n.id==='b').y")<1200);a.run("arrangeSelection('left')");
  const out=a.run('page()'),host=out.nodes.find(n=>n.id==='b'),child=out.nodes.find(n=>n.id==='bt');assert.equal(child.y-host.y,200);assert.equal(child.x-host.x,240);
 });
 await test('Native Save As persists rebased paths in HTML, current state and browser draft',async()=>{
  const a=app();a.context.fixture=project('First save');await a.run('activateDocument(fixture)');
  a.context.m={id:'nested',path:'diagram.png',nativePath:'C:\\Project\\materials\\diagram.png'};a.run('S.project.materials=[m]');
  a.run("window.STUDIO_DESKTOP={call:async(route,data)=>{if(route==='pick-save')return {nativePath:'C:\\\\Project\\\\Reports\\\\Process.html'};if(route==='link')return {openURL:'pipelinestudio://test'};if(route==='save'){window.saved=JSON.parse(data.text);return {nativePath:data.nativePath,filename:'Process.html',digest:'written'}};throw Error(route)}}");
  await a.run('saveDocument(true)');assert.equal(a.run('window.saved.materials[0].path'),'../materials/diagram.png');assert.equal(a.run('S.project.materials[0].path'),'../materials/diagram.png');assert.equal(a.run("volatileStore.get('document:'+DOC.key).materials[0].path"),'../materials/diagram.png');assert.equal(a.run('S.fileDirty'),false);
 });
 await test('Duplicated complete and partial combs own new IDs and symmetry groups',async()=>{
  const pg=page([node('a'),node('b',300,0),node('c',300,200),node('d',300,400)],[edge('ab','a','b',{bus:'bus'}),edge('ac','a','c',{bus:'bus'}),edge('ad','a','d',{bus:'bus'})],{buses:[{id:'bus',hub:'a',mode:'out',port:'right'}],symmetrySets:[{id:'sym',edges:['ab','ac','ad'],enabled:true}]});
  const original=C.clone(pg);for(const selected of [['a','b','c','d'],['a','b','c']]){const {page:out,ids}=C.duplicateSelection(pg,selected),copied=out.edges.filter(e=>ids.includes(e.source));assert.equal(out.buses.length,2);assert(copied.every(e=>e.bus===out.buses[1].id&&e.bus!=='bus'));assert(ids.includes(out.buses[1].hub));assert.equal(out.symmetrySets.length,2);assert(out.symmetrySets[1].edges.every(id=>copied.some(e=>e.id===id)));}
  const {page:partial,ids}=C.duplicateSelection(pg,['a','b']);assert.equal(partial.buses.length,1);assert.equal(partial.edges.find(e=>ids.includes(e.source)).bus,undefined);assert.deepEqual(pg,original);
 });
 await test('Deleting an image owner preserves protected image and its anchor',async()=>{
  const pg=page([node('parent',300,400),node('image',0,0,{type:'image',anchorId:'parent',anchorX:10,anchorY:10,editLocked:true})]);
  const out=C.deleteSelection(pg,{node:['parent','image']});assert(out.nodes.some(n=>n.id==='parent'));assert.equal(out.nodes.find(n=>n.id==='image').anchorId,'parent');assert.deepEqual(C.display(out,new Set(),false).nodes,C.display(pg,new Set(),false).nodes);
 });
 console.log('TOTAL',checks.length);
})().catch(e=>{console.error(e);process.exitCode=1});
