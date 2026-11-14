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
  let project=await (await fetch(base+'/api/project')).json(),material=project.materials.find(m=>m.id===mid);
  check('R04 real browser upload and autosave agree on project revision and material base',await p.evaluate(({mid,revision,version})=>Studio.state.project.revision===revision&&Studio.state.project.materials.find(m=>m.id===mid).baseVersion===version,{mid,revision:project.revision,version:material.version}));
  await p.evaluate(async mid=>{Studio.change(()=>{const m=Studio.state.project.materials.find(m=>m.id===mid);m.title='Current rename';m.version++});await Studio.save()},mid);
  project=await (await fetch(base+'/api/project')).json();material=project.materials.find(m=>m.id===mid);
  check('R04 a real browser metadata edit gets the server-assigned next version',material.title==='Current rename'&&material.version===2&&await (await fetch(base+'/media/'+material.asset)).text()==='ORIGINAL');
  let release,started;const gate=new Promise(r=>release=r),waiting=new Promise(r=>started=r);
  await p.route('**/api/upload',async route=>{started();await gate;await route.continue()});
  await p.evaluate(()=>{window.pendingUpload=Studio.uploadFile(new File(['SECOND'],'another.pdf',{type:'application/pdf'}))});
  await waiting;await p.evaluate(()=>{Studio.change(()=>Studio.state.project.title='Edited during upload');window.pendingSave=Studio.save()});release();
  await p.evaluate(()=>Promise.all([window.pendingUpload,window.pendingSave]));await p.unroute('**/api/upload');
  project=await (await fetch(base+'/api/project')).json();
  check('R04 graph autosave waits for a delayed upload and keeps both results',project.title==='Edited during upload'&&project.materials.some(m=>m.filename==='another.pdf')&&await p.evaluate(revision=>!Studio.state.dirty&&Studio.state.project.revision===revision,project.revision));
  const remote=await (await fetch(base+'/api/upload',{method:'POST',headers:{'X-File-Name':'replacement.pdf','X-Replace-Material':mid},body:'REPLACEMENT'})).json();
  const conflict=await p.evaluate(async mid=>{Studio.change(()=>{const m=Studio.state.project.materials.find(m=>m.id===mid);m.title='Stale edit';m.version++});try{await Studio.save();return false}catch{return Studio.state.dirty}},mid);
  project=await (await fetch(base+'/api/project')).json();material=project.materials.find(m=>m.id===mid);
  check('R04 a stale browser rename preserves the replacement and the unsaved local edit',conflict&&material.asset===remote.asset&&material.title==='Current rename'&&material.version===3&&project.revision===remote.projectRevision);
 }finally{
  if(p&&!p.isClosed())await p.evaluate(()=>{Studio.state.dirty=false;Studio.state.fileDirty=false}).catch(()=>{});if(browser)await browser.close();
  if(server.exitCode===null){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r)})}
  assert(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep+'pipeline-server-browser-'));fs.rmSync(data,{recursive:true,force:true});
 }
 console.log('TOTAL',count);
})().catch(e=>{console.error(e);process.exitCode=1});
