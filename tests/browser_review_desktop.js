'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{playwright:pw}=require('./browser_runtime');
const B=path.resolve(__dirname,'..'),exe=process.env.STUDIO_DESKTOP_EXE||path.join(B,'desktop/dist/win-unpacked/Pipeline Studio.exe'),version=fs.readFileSync(path.join(B,'VERSION'),'utf8').trim(),checks=[],errors=[],check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS',name)};
const fixture=()=>({id:'native-review',format:'pipeline-studio',schemaVersion:6,title:'Native review',revision:0,materials:[],viewState:{compact:false},pages:[{id:'p',title:'Page',collapseMode:'nodes',nodes:['a','b','c'].map((id,i)=>({id,title:id,type:'block',x:i?400:100,y:i===2?300:100,w:120,h:60,relativeLock:true})),edges:[{id:'ab',source:'a',target:'b',sourcePort:'right',targetPort:'left',bus:'comb'},{id:'ac',source:'a',target:'c',sourcePort:'right',targetPort:'left',bus:'comb'}],buses:[{id:'comb',hub:'a',mode:'out',port:'right',symmetry:false}],groups:[],drawings:[],layoutOptions:{autoSpace:false,busSymmetry:false}}]});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').match(/<script id="pipeline-document" type="application\/json">([\s\S]*?)<\/script>/)[1]);
(async()=>{
 const base=fs.mkdtempSync(path.join(B,'qa/review-desktop-')),author=path.join(base,'author'),recipient=path.join(base,'recipient');fs.mkdirSync(path.join(author,'materials'),{recursive:true});fs.mkdirSync(path.join(author,'Reports'));fs.mkdirSync(path.join(recipient,'materials'),{recursive:true});
 const source=path.join(author,'materials/diagram.png'),target=path.join(author,'Process.html'),saveAs=path.join(author,'Reports/Process.html');fs.writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=','base64'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await pw._electron.launch({executablePath:exe,args:['--studio-hidden','--studio-no-register','--studio-test-profile',path.join(base,'profile')],env,timeout:60000}),p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);
 try{
  await p.waitForSelector('#home-new');check('Packaged EXE and editor both report '+version,(await app.evaluate(({app})=>app.getVersion()))===version&&(await p.locator('.version-tag').innerText())===version);
  await app.evaluate(({dialog},{source,target})=>{global.reviewPick=source;global.reviewTarget=target;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[global.reviewPick]});dialog.showSaveDialog=async()=>({canceled:false,filePath:global.reviewTarget});},{source,target});
  await p.evaluate(async project=>{await Studio.activateDocument(project);const info=await STUDIO_DESKTOP.call('pick',{});Studio.change(()=>Studio.state.project.materials.push({...info,id:'nested',title:'Nested image',kind:'image',version:1}));await Studio.saveDocument()},fixture());
  check('First native save serializes a nested source from the selected HTML location',read(target).materials[0].path==='materials/diagram.png'&&await p.evaluate(()=>Studio.state.project.materials[0].path==='materials/diagram.png'&&!Studio.state.fileDirty));
  await app.evaluate((_,file)=>global.reviewTarget=file,saveAs);await p.evaluate(()=>Studio.saveDocument(true));
  check('Native Save As rebases the nested source in the file and active document',read(saveAs).materials[0].path==='../materials/diagram.png'&&await p.evaluate(()=>Studio.state.project.materials[0].path==='../materials/diagram.png'));
  await app.evaluate((_,file)=>{const fs=process.getBuiltinModule('fs');global.reviewWriteFile=fs.promises.writeFile;global.reviewPause=true;global.reviewWriting=false;fs.promises.writeFile=async function(target,...args){if(global.reviewPause&&String(target).startsWith(file+'.studio-')){global.reviewWriting=true;await new Promise(resolve=>global.reviewRelease=resolve)}return global.reviewWriteFile.call(this,target,...args)};},saveAs);
  await p.evaluate(()=>{Studio.change(()=>Studio.state.project.title='Snapshot written to HTML');window.reviewSaving=Studio.saveDocument()});
  const deadline=Date.now()+15000;while(!await app.evaluate(()=>global.reviewWriting)){if(Date.now()>deadline)throw Error('Native write did not start');await new Promise(r=>setTimeout(r,25));}
  await p.evaluate(()=>Studio.change(()=>Studio.state.project.title='Edited during native write'));
  await app.evaluate(()=>{global.reviewPause=false;global.reviewRelease();process.getBuiltinModule('fs').promises.writeFile=global.reviewWriteFile});await p.evaluate(()=>window.reviewSaving);
  check('Actual asynchronous native write leaves later edits marked unsaved',read(saveAs).title==='Snapshot written to HTML'&&await p.evaluate(()=>Studio.state.project.title==='Edited during native write'&&Studio.state.fileDirty));
  await p.evaluate(()=>Studio.saveDocument());check('A second native save writes the later edit and clears the dirty state',read(saveAs).title==='Edited during native write'&&await p.evaluate(()=>!Studio.state.fileDirty));
  const moved=path.join(recipient,'Process.html'),movedSource=path.join(recipient,'materials/diagram.png');fs.copyFileSync(target,moved);fs.copyFileSync(source,movedSource);
  await p.evaluate(()=>Studio.closeProject());await app.evaluate((_,file)=>global.reviewPick=file,moved);await p.locator('#home-open').click();await p.waitForSelector('#stage');
  const resolved=await p.evaluate(()=>Studio.resolveMaterial(Studio.state.project.materials[0]));
  check('Packaged EXE resolves transferred HTML sources beside the recipient document',resolved===pathToFileURL(movedSource).href&&fs.existsSync(source));
  await p.evaluate(()=>{Studio.state.selected=new Set(['a','b','c']);Studio.render()});await p.keyboard.press('Control+d');
  check('Packaged Ctrl+D creates separate original and copied combs',await p.evaluate(()=>{const pg=Studio.state.project.pages[0];return pg.nodes.length===6&&pg.buses.length===2&&pg.edges.filter(e=>e.bus===pg.buses[0].id).length===2&&pg.edges.filter(e=>e.bus===pg.buses[1].id).length===2}));
  await p.evaluate(()=>Studio.undo());check('Packaged duplication remains a single undo operation',await p.evaluate(()=>Studio.state.project.pages[0].nodes.length===3&&Studio.state.project.pages[0].buses.length===1));
  check('Packaged review scenarios produce no JavaScript errors',errors.length===0);
 }finally{
  await app.evaluate(()=>{if(global.reviewRelease)global.reviewRelease();if(global.reviewWriteFile)process.getBuiltinModule('fs').promises.writeFile=global.reviewWriteFile}).catch(()=>{});
  if(!p.isClosed())await p.evaluate(()=>{Studio.state.dirty=false;Studio.state.fileDirty=false});await app.close();fs.writeFileSync(path.join(B,'qa/browser-review-desktop.json'),JSON.stringify({checks,errors},null,2));assert(base.startsWith(path.join(B,'qa')+path.sep+'review-desktop-'));fs.rmSync(base,{recursive:true,force:true});
 }
 console.log('TOTAL',checks.length);
})().catch(e=>{console.error(e);process.exitCode=1});
