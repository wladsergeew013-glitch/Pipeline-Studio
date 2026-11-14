'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{playwright,launchOptions}=require('./browser_runtime');
const B=path.resolve(__dirname,'..');let count=0,viewerHTML='';const check=(name,value)=>{assert(value,name);count++;console.log('PASS',name)};
const n=(id,x=100,y=100,extra={})=>({id,title:id,type:'block',x,y,w:120,h:60,materials:[],icons:[],...extra});
const fixture=()=>({format:'pipeline-studio',schemaVersion:6,id:'reliability',title:'Reliability',revision:0,materials:[],viewState:{compact:false},pages:[{id:'p',title:'Page',collapseMode:'nodes',nodes:[n('a'),n('b',450)],edges:[{id:'e',source:'a',target:'b',sourcePort:'right',targetPort:'left',arrow:true,arrowStart:true,label:'OLD',stroke:'#cd2434',width:5}],buses:[],drawings:[],groups:[],layoutOptions:{autoSpace:false}}]});
(async()=>{
 const host=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/viewer'?viewerHTML:fs.readFileSync(path.join(B,'Pipeline-Studio.html')))});await new Promise(r=>host.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+host.address().port,browser=await playwright.chromium.launch(launchOptions),p=await browser.newPage({viewport:{width:1500,height:980}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base);await p.waitForSelector('#home-new');
  await p.evaluate(project=>Studio.activateDocument(project,{name:'Safe.html'}),fixture());
  const malicious='13"><img src=x onerror="window.injected=1">';
  for(const kind of ['cell','bus','drawing','version','wrap']){
   const project=fixture(),pg=project.pages[0];
   if(kind==='cell')pg.nodes[0].table={cells:[[{text:'unsafe',fontSize:malicious}]],widths:[120]};
   if(kind==='bus')pg.buses=[{id:'bad',width:malicious}];
   if(kind==='drawing')pg.drawings=[{id:'bad',width:malicious,points:[{x:1,y:1},{x:2,y:2}]}];
   if(kind==='version')project.materials=[{id:'m',title:'Unsafe',version:malicious}];
   if(kind==='wrap')pg.nodes[0].table={cells:[[{text:'unsafe'}]],widths:[120],wordWrap:malicious};
   check('R01 editor rejects '+kind+' before rendering',await p.evaluate(async project=>{try{await Studio.activateDocument(project);return false}catch{return !window.injected&&Studio.state.project.title==='Reliability'}},project));
   viewerHTML=await p.evaluate(project=>Studio.buildDocumentHTML(project),project);
   const viewer=await browser.newPage();await viewer.goto(base+'/viewer');await viewer.waitForSelector('#boot-home');
   check('R01 standalone viewer rejects '+kind+' without executing markup',await viewer.evaluate(()=>!window.injected&&!window.Studio.state.project));await viewer.close();
  }
  const report=fixture();report.importReport=[{page:'Import',source_cells:malicious,nodes:malicious,edges:1,tables:0,unresolved_edges:{length:malicious},simplifications:[{id:'lane',message:'Swimlane container remains a block'}]}];
  await p.evaluate(async project=>{await Studio.activateDocument(project,{name:'Report.html'});await Studio.action('report')},report);
  check('R01 R33 import report escapes data and makes no claim about an originals copy',await p.evaluate(()=>!window.injected&&!document.querySelector('.modal img[src="x"]')&&document.querySelector('.modal').textContent.includes('13"><img')&&!document.querySelector('.modal').textContent.includes('originals')&&document.querySelector('.modal').textContent.includes('Swimlane container')));
  const table=fixture();table.pages[0].nodes[0]={...n('a'),type:'table',table:{cells:[[{text:'OLD'}],[{text:'second'}]],widths:[160]}};
  await p.evaluate(project=>Studio.activateDocument(project,{name:'Inline.html'}),table);
  await p.locator('[data-table-cell]').first().dblclick();
  await p.locator('.quick-editing').fill('NEW CELL');
  await p.evaluate(()=>{window.savedText='';window.STUDIO_DESKTOP={call:async(route,data)=>route==='pick-save'?{nativePath:'C:\\Tests\\Inline.html'}:route==='save'?(window.savedText=data.text,{nativePath:data.nativePath,filename:'Inline.html',digest:'test'}):{}}});
  await p.keyboard.press('Control+Shift+s');await p.waitForFunction(()=>window.savedText.length>0);
  check('R15 actual Ctrl+Shift+S commits quick cell text into the saved HTML',await p.evaluate(()=>Studio.parseDocumentText(window.savedText).pages[0].nodes[0].table.cells[0][0].text==='NEW CELL'));
  await p.evaluate(()=>{delete window.STUDIO_DESKTOP;Studio.state.fileDirty=false});
  await p.evaluate(project=>Studio.activateDocument(project,{name:'Label.html'}),fixture());
  await p.locator('.edge-label[data-edge="e"]').dispatchEvent('dblclick',{clientX:350,clientY:200});
  await p.locator('#quick-edge-label').fill('NEW LABEL');
  const exported=await p.evaluate(()=>Studio.portableProject());
  check('R16 exporting while a label editor is active captures the visible label',exported.pages[0].edges[0].label==='NEW LABEL');
  await p.evaluate(()=>Studio.preparePrint());
  check('R31 R32 print and canvas preserve arrow direction, custom colour and line width',await p.evaluate(()=>{
   const canvas=document.querySelector('#edges path.edge[data-edge="e"]'),printed=[...document.querySelectorAll('.print-area path')].find(p=>p.getAttribute('stroke')==='#cd2434');
   return document.querySelector('#arrowhead').getAttribute('orient')==='auto-start-reverse'&&canvas.style.strokeWidth==='5px'&&printed?.getAttribute('stroke-width')==='5'&&printed.getAttribute('marker-start')&&printed.getAttribute('marker-end');
  }));
  const bus=fixture();bus.pages[0].nodes.push(n('c',450,330));bus.pages[0].edges[0].bus='comb';bus.pages[0].edges.push({...bus.pages[0].edges[0],id:'e2',target:'c'});bus.pages[0].buses=[{id:'comb',mode:'out',hub:'a',port:'right',symmetry:false,stroke:'#24aa99',width:7}];
  await p.evaluate(async project=>{await Studio.activateDocument(project,{name:'Comb.html'});Studio.preparePrint()},bus);
  check('R32 comb colour and thickness agree in canvas and printed SVG',await p.evaluate(()=>[...document.querySelectorAll('#edges path.edge')].some(p=>p.style.strokeWidth==='7px'&&p.getAttribute('style').includes('#24aa99'))&&[...document.querySelectorAll('.print-area path')].some(p=>p.getAttribute('stroke')==='#24aa99'&&p.getAttribute('stroke-width')==='7')));
  const sourceHandles=fixture();sourceHandles.materials=[{id:'source',title:'same.pdf',kind:'pdf',path:'same.pdf',version:1}];
  await p.evaluate(async project=>{
   await Studio.activateDocument(project,{name:'Sources.html',key:'explicit-source'});
   const root=await navigator.storage.getDirectory(),projectDir=await root.getDirectoryHandle('Project',{create:true}),externalDir=await root.getDirectoryHandle('External',{create:true});
   for(const [dir,text] of [[projectDir,'ROOT'],[externalDir,'EXTERNAL']]){const file=await dir.getFileHandle('same.pdf',{create:true}),writer=await file.createWritable();await writer.write(text);await writer.close()}
   Studio.document.root=projectDir;Studio.document.sourceHandles.set('source',await externalDir.getFileHandle('same.pdf'));Studio.change(()=>Studio.state.project.title='Explicit source');await Studio.save();
  },sourceHandles);
  check('R08 an actual browser file handle wins over the connected same-named file',await p.evaluate(async()=>await (await fetch(await Studio.resolveMaterial(Studio.state.project.materials[0]))).text()==='EXTERNAL'));
  await p.evaluate(async()=>{await Studio.closeProject();await Studio.openRecentDocument('explicit-source')});
  check('R08 the chosen browser handle survives IndexedDB close and reopen',await p.evaluate(async()=>await (await fetch(await Studio.resolveMaterial(Studio.state.project.materials[0]))).text()==='EXTERNAL'));
  const native=fixture();native.materials=[{id:'native',title:'External',kind:'document',nativePath:'D:\\External\\source.docx',version:1}];
  await p.evaluate(project=>{delete window.STUDIO_DESKTOP;return Studio.activateDocument(project,{name:'Native.html'})},native);
  await p.evaluate(()=>Studio.editMaterial('native'));
  check('R18 a native-only external source can be renamed without replacement',await p.locator('#mat-title').isVisible()&&await p.locator('#mat-save').isEnabled());
  await p.locator('#mat-title').fill('Renamed source');await p.locator('#mat-save').click();
  check('R18 renaming retains the original native path',await p.evaluate(()=>Studio.state.project.materials[0].title==='Renamed source'&&Studio.state.project.materials[0].nativePath==='D:\\External\\source.docx'));
  const protectedTable=fixture();protectedTable.pages[0].nodes[0]={...n('a'),type:'table',table:{cells:[[{text:'one'}],[{text:'two'}]],widths:[160]}};
  await p.evaluate(async project=>{await Studio.activateDocument(project,{name:'Protected.html'});const pg=Studio.state.project.pages[0],t=pg.nodes[0];pg.edges[0].sourcePort=Studio.Core.ports(t).find(p=>p.rowId===t.table.rowIds[1]).id;pg.edges[0].editLocked=true;Studio.tableEditor(t)},protectedTable);
  await p.locator('[data-row-index="1"]').click();await p.locator('#remove-row').click();await p.locator('#table-save').click();
  check('R22 applying a deleted protected row leaves the complete model intact',await p.evaluate(()=>Studio.state.project.pages[0].nodes[0].table.cells.length===2&&Studio.state.project.pages[0].edges.length===1&&document.querySelector('#table-save')!==null));
  check('Browser scenarios have no uncaught JavaScript errors',errors.length===0);
 }finally{await browser.close();await new Promise(r=>host.close(r))}
 console.log('TOTAL',count);
})().catch(e=>{console.error(e);process.exitCode=1});
