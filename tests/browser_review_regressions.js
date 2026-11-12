'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{playwright:pw,launchOptions}=require('./browser_runtime');
const B=path.resolve(__dirname,'..'),checks=[],errors=[],check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
const node=(id,x,y,extra={})=>({id,type:'block',title:id,x,y,w:120,h:60,relativeLock:true,...extra}),edge=(id,source,target,extra={})=>({id,source,target,sourcePort:'right',targetPort:'left',...extra});
const fixture=()=>({id:'review',format:'pipeline-studio',schemaVersion:6,title:'Review regressions',revision:0,materials:[],viewState:{compact:false},pages:[{id:'p',title:'Page',collapseMode:'nodes',nodes:[node('a',100,100),node('b',400,100),node('c',400,300)],edges:[edge('ab','a','b',{bus:'comb'}),edge('ac','a','c',{bus:'comb'})],buses:[{id:'comb',mode:'out',hub:'a',port:'right',symmetry:false}],groups:[],drawings:[],layoutOptions:{autoSpace:false,busSymmetry:false}}]});
(async()=>{
 const base=fs.mkdtempSync(path.join(B,'qa/review-browser-')),host=http.createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404);res.end();return}res.setHeader('Content-Type','text/html;charset=utf-8');res.end(fs.readFileSync(path.join(B,'Pipeline-Studio.html')))});await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
 const browser=await pw.chromium.launch(launchOptions),p=await browser.newPage({viewport:{width:1500,height:960}});p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto('http://127.0.0.1:'+host.address().port);await p.waitForSelector('#home-new');
  await p.evaluate(async project=>{
   const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('Review-original.html',{create:true}),writer=await handle.createWritable();await writer.write(Studio.buildDocumentHTML?await Studio.buildDocumentHTML({...project,title:'Old disk content'}):'');await writer.close();
   await Studio.activateDocument(project,{name:handle.name,handle});Studio.change(()=>Studio.state.project.title='Latest browser draft');await Studio.save();window.reviewRecentKey=Studio.document.key;
  },fixture());
  for(let i=0;i<2;i++){await p.evaluate(async()=>{await Studio.closeProject();await Studio.openRecentDocument(window.reviewRecentKey)});check('Browser recent reopen '+(i+1)+' keeps the latest draft and HTML dirty state',await p.evaluate(()=>Studio.state.project.title==='Latest browser draft'&&Studio.state.fileDirty));}
  await p.evaluate(()=>{Studio.state.selected=new Set(['a','b','c']);Studio.render()});await p.keyboard.press('Control+d');
  check('Actual Ctrl+D creates a separate comb',await p.evaluate(()=>{const pg=Studio.state.project.pages[0],copied=pg.buses.find(b=>b.id!=='comb');return pg.nodes.length===6&&pg.edges.length===4&&pg.buses.length===2&&pg.edges.filter(e=>e.bus===copied.id).length===2&&copied.hub!=='a'}));
  await p.evaluate(()=>Studio.undo());check('Duplicating the comb is one undo operation',await p.evaluate(()=>Studio.state.project.pages[0].buses.length===1&&Studio.state.project.pages[0].nodes.length===3));await p.evaluate(()=>Studio.redo());
  const layout=fixture();layout.pages[0].nodes=[node('a',100,0,{collapsible:true}),node('at',340,200),node('b',150,1200,{collapsible:true}),node('bt',390,1400)];layout.pages[0].edges=[edge('a1','a','at'),edge('b1','b','bt')];layout.pages[0].buses=[];
  await p.evaluate(async project=>{await Studio.activateDocument(project,{name:'Layout.html'});const s=Studio.state;s.compact=true;s.collapsed.p=new Set(['a','b']);Studio.render();s.selected=new Set(['a','b']);Studio.arrangeSelection('left');s.collapsed.p.clear();Studio.render()},layout);
  check('Fold, compact, align and expand keeps hidden descendants with their roots',await p.evaluate(()=>{const ns=new Map(Studio.state.project.pages[0].nodes.map(n=>[n.id,n]));return ns.get('bt').y-ns.get('b').y===200&&ns.get('bt').x-ns.get('b').x===240}));
  await p.evaluate(async project=>{
   await Studio.activateDocument(project,{name:'Concurrent.html'});window.reviewWriteStarted=false;window.reviewWriteGate=new Promise(resolve=>window.reviewReleaseWrite=resolve);
   window.STUDIO_DESKTOP={call:async(route,data)=>{if(route==='pick-save')return {nativePath:'C:\\Review\\Concurrent.html'};if(route==='save'){window.reviewSavedHTML=data.text;window.reviewWriteStarted=true;await window.reviewWriteGate;return {nativePath:data.nativePath,filename:'Concurrent.html',digest:'test'}};throw Error(route)}};
   window.reviewSave=Studio.saveDocument();
  },fixture());await p.waitForFunction(()=>window.reviewWriteStarted);
  await p.evaluate(async()=>{Studio.change(()=>Studio.state.project.title='Edited while HTML was pending');window.reviewReleaseWrite();await window.reviewSave});
  check('Browser keeps a concurrent edit dirty after native HTML write',await p.evaluate(()=>Studio.state.fileDirty&&Studio.parseDocumentText(window.reviewSavedHTML).title==='Review regressions'&&Studio.state.project.title==='Edited while HTML was pending'));
  await p.evaluate(()=>{delete window.STUDIO_DESKTOP;Studio.state.dirty=false;Studio.state.fileDirty=false});
  const author=path.join(base,'author'),recipient=path.join(base,'recipient');fs.mkdirSync(author);fs.mkdirSync(path.join(recipient,'materials'),{recursive:true});
  const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').fillRect(0,0,1,1);return c.toDataURL().split(',')[1]});fs.writeFileSync(path.join(recipient,'materials/photo.png'),Buffer.from(png,'base64'));
  const doc=fixture();doc.materials=[{id:'photo',title:'Photo',kind:'image',path:'materials/photo.png',nativePath:path.join(author,'photo.png')}];
  const html=await p.evaluate(async project=>{await Studio.activateDocument(project,{name:'Process.html'});return Studio.buildDocumentHTML(await Studio.portableProject())},doc),file=path.join(recipient,'Process.html');fs.writeFileSync(file,html);
  const viewer=await browser.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto(pathToFileURL(file).href);await viewer.waitForFunction(()=>window.Studio?.state.project);
  check('Moved autonomous HTML loads the image beside the recipient document',await viewer.evaluate(async()=>{const url=await Studio.resolveMaterial(Studio.state.project.materials[0]);return new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth===1&&url.includes('/recipient/materials/photo.png'));img.onerror=()=>resolve(false);img.src=url})}));await viewer.close();
  await p.screenshot({path:path.join(B,'qa/review-browser.png')});check('New browser scenarios have no JavaScript errors',errors.length===0);
 }finally{
  await browser.close();await new Promise(resolve=>host.close(resolve));fs.writeFileSync(path.join(B,'qa/browser-review-regressions.json'),JSON.stringify({checks,errors},null,2));assert(base.startsWith(path.join(B,'qa')+path.sep+'review-browser-'));fs.rmSync(base,{recursive:true,force:true});
 }
 console.log('TOTAL',checks.length);
})().catch(e=>{console.error(e);process.exitCode=1});
