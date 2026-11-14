'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Core=require('../app/static/core.js');
const source=fs.readFileSync(path.join(__dirname,'../app/static/app.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
function app({normalize=false}={}){
 const context=vm.createContext({Core,URL,Blob,File,DOMException,Event,console,EMOJI:{},Map,Set,Date,Promise,location:{protocol:'file:',hostname:'',origin:'file://',href:'file:///C:/Project/Process.html',pathname:'/C:/Project/Process.html'},document:{activeElement:null,addEventListener(){},querySelector(){return null}},window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
 vm.runInContext(source,context);const run=s=>vm.runInContext(s,context);
 run("renderShell=render=renderTop=renderInspector=fit=updateStatus=toast=closeFilePopover=closeNodeStatus=closeModal=()=>{};apiPut=async()=>({revision:1});");
 run("if(typeof finishInitialization==='function')finishInitialization()");
 if(!normalize)run('normalize=x=>x');
 return {context,run,studio:context.window.Studio};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const node=(id='a',extra={})=>({id,title:id,type:'block',x:100,y:100,w:120,h:60,materials:[],icons:[],...extra});
const page=(id='p')=>({id,title:id,nodes:[node()],edges:[],buses:[],groups:[],drawings:[],layoutOptions:{autoSpace:false},symmetrySets:[]});
const project=(title='Test')=>({format:'pipeline-studio',schemaVersion:6,id:'project-'+title,title,revision:0,materials:[],pages:[page()]});
module.exports={app,deferred,node,page,project,Core};
