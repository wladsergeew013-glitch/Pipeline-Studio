'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{app,deferred,project}=require('./app_harness');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');const handler=source.slice(source.indexOf('const handleArgs='),source.indexOf('if(!app.requestSingleInstanceLock()'));
 for(const uiWins of [false,true]){
  const a=app(),gate=deferred(),start=deferred();a.run('parseDocumentText=JSON.parse');let reads=0;
  const context=vm.createContext({path,fs:{existsSync:()=>true},hidden:true,dialog:{showErrorBox:()=>{}},bridge:{remember:p=>p,metadata:async p=>{if(p.endsWith('A.html')){start.resolve();await gate.promise}return {filename:path.basename(p),digest:'digest'}},command:async(_,data)=>{reads++;return {text:JSON.stringify(project(data.nativePath.endsWith('A.html')?'A':'B'))}}},win:{webContents:{executeJavaScript:code=>Promise.resolve(a.run(code))}},externalOpenVersion:0,APath:path.resolve('A.html'),BPath:path.resolve('B.html')});
  a.run('globalThis.Studio=window.Studio');vm.runInContext(handler+'globalThis.open=handleArgs',context);
  const first=vm.runInContext('open([APath])',context);await start.promise;
  if(uiWins){a.context.local=project('UI');await a.run("activateDocument(local,{name:'UI.html'})")}else await vm.runInContext('open([BPath])',context);
  gate.resolve();await first;assert.equal(a.run('S.project.title'),uiWins?'UI':'B');console.log('PASS N13 slow external open cannot replace '+(uiWins?'a newer renderer open':'a newer external open'));
 }
 console.log('TOTAL 2');
})().catch(e=>{console.error(e);process.exitCode=1});
