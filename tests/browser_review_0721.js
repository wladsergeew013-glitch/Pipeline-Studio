'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{playwright,launchOptions}=require('./browser_runtime');
const B=path.resolve(__dirname,'..');let count=0;const check=(name,value)=>{assert(value,name);count++;console.log('PASS',name)};
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'pipeline-server-browser-')),reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const server=spawn(process.env.PYTHON||'python',['-X','utf8',path.join(B,'app/server.py'),'--port',String(port)],{env:{...process.env,STUDIO_DATA:data,STUDIO_PASSWORD:'',STUDIO_READER_PASSWORD:'',PYTHONUNBUFFERED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='';server.stderr.on('data',b=>stderr+=b);server.stdout.resume();const base='http://127.0.0.1:'+port;let browser,p;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/session')).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100))}assert(ready,'server failed: '+stderr);
  browser=await playwright.chromium.launch(launchOptions);p=await browser.newPage();await p.goto(base);await p.locator('#home-server').click();await p.waitForSelector('#stage');
  const mid=await p.evaluate(async()=>{const m=await Studio.uploadFile(new File(['ORIGINAL'],'source.pdf',{type:'application/pdf'}));await Studio.save();return m.id});
  await p.evaluate(async mid=>{Studio.change(()=>{const m=Studio.state.project.materials.find(m=>m.id===mid);m.title='RENAMED';m.version++});await Studio.save();await Studio.undo();await Studio.save()},mid);
  check('N06 Undo of own saved rename succeeds over actual HTTP',(await (await fetch(base+'/api/project')).json()).materials.find(m=>m.id===mid).title==='source.pdf');
  await p.evaluate(async mid=>{Studio.change(()=>Studio.state.project=Studio.Core.removeMaterial(Studio.state.project,mid));await Studio.save();await Studio.undo();await Studio.save();Studio.change(()=>Studio.state.project.materials.find(m=>m.id===mid).title='AFTER RESTORE');await Studio.save()},mid);
  check('N06 restored deleted ID accepts version 1 and saves another edit',(await (await fetch(base+'/api/project')).json()).materials.find(m=>m.id===mid).version===2);
  // Hold the actual registry read while a local registry edit happens.
  let release,started;let gate=new Promise(r=>release=r),waiting=new Promise(r=>started=r),reads=0;
  await p.route('**/api/materials',async route=>{reads++;const response=await route.fetch();started();await gate;await route.fulfill({response})});
  await p.evaluate(mid=>{window.openingMaterial=Studio.openMaterial(mid)},mid);await waiting;
  await p.evaluate(()=>Studio.change(()=>Studio.state.project.materials.push({id:'late-local',title:'Local',kind:'page',target:{pageId:Studio.state.project.pages[0].id},version:1})));
  release();await p.evaluate(()=>window.openingMaterial);await p.unroute('**/api/materials');
  check('N02 actual PDF viewer performs one registry GET and preserves the newer local material',reads===1&&await p.evaluate(()=>Studio.state.project.materials.some(m=>m.id==='late-local')));
  await p.locator('[data-close]').click();await p.evaluate(()=>Studio.save());
  await p.evaluate(async()=>{Studio.change(()=>Studio.state.project.pages.push(Studio.Core.createPage('Second')));await Studio.save()});
  gate=new Promise(r=>release=r);waiting=new Promise(r=>started=r);
  await p.route('**/api/upload',async route=>{started();await gate;await route.continue()});
  await p.evaluate(()=>{window.pageUpload=Studio.uploadFile(new File(['UPLOADED'],'second.pdf',{type:'application/pdf'}),null,null,{attachNodeId:Studio.state.project.pages[0].nodes[0].id})});await waiting;
  await p.evaluate(()=>Studio.pagesDialog());await p.locator('[data-switch-page="1"]').click();release();await p.evaluate(()=>window.pageUpload);await p.unroute('**/api/upload');await p.evaluate(()=>Studio.save());
  check('N08 page navigation keeps the upload and server receipt without attaching on the other page',(await (await fetch(base+'/api/project')).json()).materials.some(m=>m.filename==='second.pdf')&&await p.evaluate(()=>Studio.state.pageIndex===1&&Studio.state.project.pages[1].nodes.length===0&&!Studio.state.dirty));
  // Delayed save ACK after rename, then deletion: wire deletion needs the newer confirmed base.
  gate=new Promise(r=>release=r);waiting=new Promise(r=>started=r);let delay=true;
  await p.route('**/api/project',async route=>{if(route.request().method()==='PUT'&&delay){delay=false;const response=await route.fetch();started();await gate;await route.fulfill({response})}else await route.continue()});
  await p.evaluate(mid=>{Studio.change(()=>{const m=Studio.state.project.materials.find(m=>m.id===mid);m.title='IN FLIGHT';m.version++});window.renameSave=Studio.save()},mid);await waiting;
  await p.evaluate(mid=>Studio.change(()=>Studio.state.project=Studio.Core.removeMaterial(Studio.state.project,mid)),mid);release();await p.evaluate(async()=>{await window.renameSave;await Studio.save()});await p.unroute('**/api/project');
  check('N07 deletion after an in-flight rename uses its actual confirmed version',!(await (await fetch(base+'/api/project')).json()).materials.some(m=>m.id===mid));
  // Genuine focus + keyboard events, with HTML output captured at the native bridge boundary.
  const fixture={format:'pipeline-studio',schemaVersion:6,id:'keyboard',title:'Keyboard',revision:0,materials:[],viewState:{compact:false},pages:[{id:'p',title:'Page',collapseMode:'nodes',nodes:[{id:'a',type:'block',title:'OLD',x:100,y:100,w:120,h:60},{id:'b',type:'block',title:'B',x:450,y:100,w:120,h:60}],edges:[{id:'e',source:'a',target:'b',sourcePort:'right',targetPort:'left',arrow:true,label:'OLD'}],buses:[],groups:[],drawings:[],layoutOptions:{autoSpace:false}}]};
  await p.evaluate(async fixture=>{await Studio.activateDocument(fixture,{name:'Keyboard.html'});window.writes=[];window.STUDIO_DESKTOP={call:async(route,data)=>{if(route==='pick-save')return {nativePath:'C:/Synthetic/Keyboard.html'};if(route==='save'){window.writes.push(data.text);return {nativePath:data.nativePath,filename:'Keyboard.html',digest:'test'}}throw Error(route)}};Studio.state.selected=new Set(['a']);Studio.render()},fixture);
  await p.locator('#node-title').fill('VISIBLE NODE');await p.keyboard.press('Control+s');await p.waitForFunction(()=>window.writes.length===1);
  check('N05 Ctrl+S without blur captures the focused inspector node title',await p.evaluate(()=>Studio.parseDocumentText(window.writes.at(-1)).pages[0].nodes[0].title==='VISIBLE NODE'));
  await p.evaluate(()=>{Studio.state.selected.clear();Studio.state.selectedEdge='e';Studio.state.selectedEdges=new Set(['e']);Studio.render()});await p.locator('#edge-label').fill('VISIBLE INSPECTOR');await p.keyboard.press('Control+s');await p.waitForFunction(()=>window.writes.length===2);
  check('N05 Ctrl+S without blur captures the focused inspector edge label',await p.evaluate(()=>Studio.parseDocumentText(window.writes.at(-1)).pages[0].edges[0].label==='VISIBLE INSPECTOR'));
  await p.locator('.edge-label[data-edge="e"]').dblclick();await p.locator('#quick-edge-label').fill('VISIBLE QUICK');await p.locator('#quick-edge-label').press('Control+s');await p.waitForFunction(()=>window.writes.length===3);
  check('N12 Ctrl+S reaches the document command from the actual quick-label input',await p.evaluate(()=>Studio.parseDocumentText(window.writes.at(-1)).pages[0].edges[0].label==='VISIBLE QUICK'&&!document.querySelector('#quick-edge-label')));
  await p.evaluate(()=>{Studio.state.selectedEdge=null;Studio.state.selectedEdges.clear();Studio.state.selected=new Set(['a','b']);Studio.render()});await p.locator('[data-bulk-key="fontSize"]').fill('1001');await p.locator('[data-bulk-key="fontSize"]').press('Tab');
  await p.keyboard.press('Control+s');await p.waitForFunction(()=>window.writes.length===4);
  check('N04 bulk inspector rejects 1001 before save and its HTML reopens',await p.evaluate(async()=>{const saved=Studio.parseDocumentText(window.writes.at(-1));const ok=saved.pages[0].nodes.every(n=>n.fontSize!==1001);await Studio.activateDocument(saved,{name:'Reopened.html'});return ok&&Studio.state.project.pages[0].nodes.length===2}));
  await p.evaluate(()=>{const e=Studio.state.project.pages[0].edges[0];Studio.change(()=>Object.assign(e,{fontSize:32,labelColor:'#aa00cc'}));Studio.preparePrint()});
  check('N18 printed SVG uses the same computed label font and color as the screen',await p.evaluate(()=>{const screen=getComputedStyle(document.querySelector('#edges .edge-label[data-edge="e"]')),printed=getComputedStyle(document.querySelector('.print-area .edge-label[data-edge="e"]'));return screen.fontSize==='32px'&&printed.fontSize===screen.fontSize&&printed.fill===screen.fill&&printed.fill==='rgb(170, 0, 204)'}));
  await p.screenshot({path:path.join(B,'qa/review-0721-browser.png')});
  await p.evaluate(()=>{delete window.STUDIO_DESKTOP;Studio.state.dirty=false;Studio.state.fileDirty=false});
 }finally{
  if(p&&!p.isClosed())await p.evaluate(()=>{Studio.state.dirty=false;Studio.state.fileDirty=false}).catch(()=>{});if(browser)await browser.close();
  if(server.exitCode===null){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r)})}
  assert(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep+'pipeline-server-browser-'));fs.rmSync(data,{recursive:true,force:true});
 }
 console.log('TOTAL',count);
})().catch(e=>{console.error(e);process.exitCode=1});
