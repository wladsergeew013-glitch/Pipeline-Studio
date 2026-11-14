'use strict';
const assert=require('node:assert/strict'),{app,deferred,project,page,node,Core:C}=require('./app_harness');
const tests=[];const test=(name,run)=>tests.push([name,run]);const turn=()=>new Promise(r=>setImmediate(r));
const edge=(id,source='a',target='b',extra={})=>({id,source,target,sourcePort:'right',targetPort:'left',arrow:true,label:'OLD',...extra});
const setup=async(p=project(),server=false)=>{const a=app();a.context.fixture=p;await a.run("activateDocument(fixture,{name:'Test.html',server:"+server+"})");return a};
const viewer=a=>a.run("modal=(title,content)=>window.viewer={title,content};document.querySelector=q=>q==='#back-registry'?{}:q==='.modal'?{querySelector:()=>null}:null");
test('N02 actual PDF opening has one guarded registry read',async()=>{
 const p=project();p.materials=[{id:'pdf',kind:'pdf',url:'https://example.test/a.pdf',version:1}];const a=await setup(p,true),gate=deferred();viewer(a);let calls=0;a.context.get=()=>{calls++;return gate.promise};a.run('request=get');const opening=a.run("openMaterial('pdf')");await turn();a.run("change(()=>S.project.materials.push({id:'new',version:1}))");gate.resolve(p.materials);await opening;assert.equal(calls,1);assert.equal(a.run('S.project.materials.length'),2);
});
test('N02 a late actual PDF opening cannot open the same ID in another document',async()=>{
 const p=project();p.materials=[{id:'pdf',kind:'pdf',url:'https://example.test/a.pdf'}];const a=await setup(p,true),gate=deferred();viewer(a);a.context.gate=gate;a.run('request=()=>gate.promise');const opening=a.run("openMaterial('pdf')");await turn();a.context.other=project('B');await a.run("activateDocument(other,{name:'B.html'})");gate.resolve(p.materials);await opening;assert.equal(a.run('S.project.materials.length'),0);assert.equal(a.context.window.viewer,undefined);
});
test('N03 internal page navigation clears port modes and rejects stale endpoints',async()=>{
 const p=project();p.pages.push(page('second'));p.pages[1].nodes=[node('b')];p.materials=[{id:'go',kind:'page',target:{pageId:'second'}}];const a=await setup(p);a.run("S.pendingPort={node:'a',port:'right'};S.addingBusPair='old';S.addingBus='old'");await a.run("openMaterial('go')");assert.equal(a.run('S.pendingPort'),null);assert.equal(a.run('S.addingBusPair'),null);a.run("connectPorts('a','right','b','left')");assert.equal(a.run('page().edges.length'),0);assert.equal(a.run('S.dirty'),false);
});
test('N04 bulk presentation bounds match loader bounds without mutating input',()=>{
 for(const [kind,list,field] of [['node','nodes','fontSize'],['edge','edges','fontSize'],['edge','edges','width'],['bus','buses','width'],['drawing','drawings','width']]){
  const p=page();p[list]=[{...(kind==='node'?node('x'):kind==='edge'?edge('x'):{id:'x'}),[field]:10}];const before=JSON.stringify(p);
  for(const v of [1001,Infinity,NaN])assert.throws(()=>C.bulkPatch(p,{[kind]:['x']},{[field]:v}));assert.equal(JSON.stringify(p),before);assert.equal(C.bulkPatch(p,{[kind]:['x']},{[field]:1000})[list][0][field],1000);
 }
});
test('N05 save snapshot flushes the focused inspector field',async()=>{
 const a=await setup();a.run("document.activeElement={closest:()=>true,matches:()=>true,dispatchEvent:()=>change(()=>page().nodes[0].title='VISIBLE')}");const p=await a.run('portableProject()');assert.equal(p.pages[0].nodes[0].title,'VISIBLE');
});
function strictServer(a){let revision=0;const materials=new Map();a.context.put=async(route,p)=>{
 assert.equal(p.revision,revision,'project revision');for(const m of p.materials){const old=materials.get(m.id);if(old){assert.equal(m.baseVersion,old.baseVersion,'material base');const content=m.title;materials.set(m.id,{...m,version:old.version+(content!==old.title?1:0),baseVersion:old.version+(content!==old.title?1:0)})}else materials.set(m.id,{...m,version:1,baseVersion:1})}
 for(const d of p.deletedMaterials||[]){const old=materials.get(d.id);assert(old,'deleted material exists');assert.equal(d.version,old.version,'deleted material base');materials.delete(d.id)}
 return {revision:++revision,materialVersions:Object.fromEntries([...materials].map(([id,m])=>[id,m.version]))};};a.run('apiPut=put');return materials}
test('N06 own saved rename can Undo/Redo as a new server edit',async()=>{
 const a=app(),materials=strictServer(a),p=project();p.materials=[{id:'m',title:'OLD',version:1}];a.context.fixture=p;await a.run("activateDocument(fixture,{name:'Server.html',server:true})");a.run("change(()=>{mat('m').title='NEW';mat('m').version++})");await a.run('save()');await a.run('undo()');await a.run('save()');assert.equal(materials.get('m').title,'OLD');assert.equal(a.run("mat('m').baseVersion"),3);await a.run('redo()');await a.run('save()');assert.equal(materials.get('m').title,'NEW');
});
test('N06 restored deleted ID accepts the lower server-assigned version',async()=>{
 const a=app(),materials=strictServer(a),p=project();p.materials=[{id:'m',title:'OLD',version:1}];a.context.fixture=p;await a.run("activateDocument(fixture,{name:'Server.html',server:true})");a.run("change(()=>mat('m').title='SECOND')");await a.run('save()');a.run("change(()=>S.project=C.removeMaterial(S.project,'m'))");await a.run('save()');assert.equal(materials.size,0);await a.run('undo()');await a.run('save()');assert.equal(a.run("mat('m').baseVersion"),1);a.run("change(()=>mat('m').title='THIRD')");await a.run('save()');assert.equal(materials.get('m').version,2);
});
test('N07 rename without save followed by deletion uses the confirmed base',async()=>{
 const a=app(),materials=strictServer(a),p=project();p.materials=[{id:'m',title:'OLD',version:1}];a.context.fixture=p;await a.run("activateDocument(fixture,{name:'Server.html',server:true})");a.run("change(()=>{mat('m').title='NEW';mat('m').version++});change(()=>S.project=C.removeMaterial(S.project,'m'))");await a.run('save()');assert.equal(materials.size,0);
});
test('N08 a page switch during upload accepts receipt and registry but cancels attachment',async()=>{
 const p=project();p.pages.push(page('second'));const a=await setup(p,true),gate=deferred();a.context.gate=gate;a.run('request=()=>gate.promise');const job=a.run("uploadFile({name:'new.pdf',size:1,type:'application/pdf'},null,null,{attachNodeId:'a'})");await turn();a.run('switchPage(1)');gate.resolve({id:'uploaded',version:1,baseVersion:1,projectRevision:2});await job;assert.equal(a.run('S.project.revision'),2);assert.equal(a.run('S.project.materials[0].id'),'uploaded');assert.equal(a.run('S.project.pages[1].nodes[0].materials.length'),0);
});
test('N09 late source reads cannot poison another document or a rebound source',async()=>{
 for(const rebind of [false,true]){const p=project();p.materials=[{id:'m',path:'same.pdf'}];const a=await setup(p),gate=deferred();a.context.gate=gate;a.context.old=new File(['A-STALE'],'same.pdf');a.context.fresh=new File(['B-CORRECT'],'same.pdf');a.run("DOC.sourceHandles.set('m',{getFile:()=>gate.promise})");const read=a.run("resolveMaterial(mat('m'))").catch(e=>e);
 if(rebind)a.run("DOC.sourceHandles.set('m',{getFile:async()=>fresh})");else{a.context.other=JSON.parse(JSON.stringify(p));await a.run("activateDocument(other,{name:'B.html'})");a.run("DOC.sourceHandles.set('m',{getFile:async()=>fresh})")}
 gate.resolve(a.context.old);assert.equal((await read).name,'AbortError');const url=await a.run("resolveMaterial(mat('m'))");assert.equal(await (await fetch(url)).text(),'B-CORRECT');}
});
test('N14 original native path does not override a preview URL',async()=>{
 const p=project();p.materials=[{id:'m',nativePath:'C:/Original.docx',previewURL:'https://example.test/preview.pdf'}];const a=await setup(p);a.run("window.STUDIO_DESKTOP={call:()=>{throw Error('wrong native role')}}");assert.equal(await a.run("resolveMaterial(mat('m'),true)"),'https://example.test/preview.pdf');
});
test('N15 available PDF preview is displayed when the original is missing',async()=>{
 const p=project();p.materials=[{id:'m',title:'Word',kind:'document',path:'missing.docx',previewURL:'https://example.test/preview.pdf'}];const a=await setup(p);viewer(a);a.run("DOC.root={queryPermission:async()=> 'granted',getFileHandle:async()=>{throw new DOMException('missing','NotFoundError')}}");await a.run("openMaterial('m')");assert.match(a.context.window.viewer.content,/<iframe[^>]+preview.pdf/);assert.match(a.context.window.viewer.content,/Оригинал недоступен/);
});
test('N16 inspector and bulk edits cannot change protected comb branches',async()=>{
 const p=project();p.pages[0].nodes.push(node('b'));p.pages[0].edges=[edge('e','a','b',{bus:'comb'}),edge('f','a','b',{bus:'comb'})];p.pages[0].buses=[{id:'comb',editLocked:true}];const a=await setup(p);a.run("S.selectedEdge='e'");const before=a.run('JSON.stringify(S.project)');a.run("onChange({target:{id:'edge-source-port',value:'top',dataset:{}}});onChange({target:{id:'edge-label',value:'NEW',dataset:{}}})");assert.equal(a.run('JSON.stringify(S.project)'),before);assert.equal(a.run('S.history.length'),0);assert.equal(a.run('S.dirty'),false);assert.equal(C.bulkPatch(p.pages[0],{edge:['e','f']},{label:'NEW'}).edges[0].label,'OLD');
});
test('Q02 removing a neighbor cannot silently unbus a protected branch',()=>{
 const p=page();p.nodes.push(node('b'));p.edges=[edge('e','a','b',{bus:'one',editLocked:true}),edge('f','a','b',{bus:'one'}),edge('g','a','b',{bus:'two'}),edge('h','a','b',{bus:'two'})];p.buses=[{id:'one'},{id:'two'}];const before=JSON.stringify(p);assert.throws(()=>C.deleteSelection(p,{edge:['f']}),/защищ/);assert.throws(()=>C.joinBus(p,'two',['f']),/защищ/);assert.equal(JSON.stringify(p),before);p.edges[0].editLocked=false;assert.equal(C.deleteSelection(p,{edge:['f']}).edges.find(e=>e.id==='e').bus,undefined);
});
test('N17 folded proxies preserve visible ports and both arrow directions',()=>{
 const p=page();p.collapseMode='nodes';p.nodes=[node('root',{collapsible:true}),node('hidden'),node('visible',{collapseBoundary:true})];p.edges=[edge('parent','root','hidden'),edge('a','hidden','visible',{targetPort:'left',arrowStart:true}),edge('b','hidden','visible',{targetPort:'top',arrowStart:true}),edge('c','hidden','visible',{targetPort:'left',arrowStart:false}),edge('d','hidden','visible',{targetPort:'left',arrowStart:true})];
 for(const reverse of [false,true]){if(reverse)p.edges.reverse();const d=C.display(p,new Set(['root']),false);const proxies=d.edges.filter(e=>e.proxy);assert.equal(proxies.length,3);assert.equal(proxies.find(e=>e.targetPort==='left'&&e.arrowStart).count,2);}
});
test('N18 generated SVG labels carry print font and color',async()=>{
 const a=await setup();a.context.e=edge('e','a','a',{label:'PRINT',fontSize:32,labelColor:'#aa00cc'});a.run('C.labelPlacement=()=>({x:0,y:0})');const html=a.run('edgeLabelHTML(e,{})');assert.match(html,/font-size="32"/);assert.match(html,/fill="#aa00cc"/);
});
(async()=>{let failed=0;for(const [name,run] of tests)try{await run();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e)}console.log('TOTAL',tests.length,'FAILED',failed);if(failed)process.exitCode=1})()
