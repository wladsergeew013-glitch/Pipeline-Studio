'use strict';
const fs=require('node:fs'),path=require('node:path');
const {playwright:pw,launchOptions}=require('./browser_runtime');
const B=path.resolve(__dirname,'..'),out=path.join(B,'qa/status-capture');fs.mkdirSync(out,{recursive:true});
const n=(id,type,x,y,w,h)=>({id,type,title:{decision:'Вывод из модели',block:'Проектирование',table:'Вывод объёмов'}[type],x,y,w,h,fill:'#ffffff',stroke:'#9aa8bf',fontSize:14,relativeLock:true,locked:true,editLocked:true,collapsible:true,materials:[],icons:[]});
const nodes=[n('condition','decision',100,180,190,140),n('block','block',410,215,220,70),n('table','table',770,160,260,180)];
nodes[0].branchSymmetry=true;
nodes[2].table={widths:[260],autoSize:false,heights:[38,38,38],rowIds:['r1','r2','r3'],colIds:['c1'],cells:[[{text:'Спецификация фундаментов'}],[{text:'Ведомость расхода стали'}],[{text:'Экспликация свай'}]],rowBehavior:{r1:{collapsible:true},r2:{collapsible:true}}};
const edges=[];for(const id of ['condition','block','table']){nodes.push({id:id+'-child',type:'block',title:'Продолжение',x:1350,y:200+edges.length*140,w:140,h:60,relativeLock:true});edges.push({id:'e-'+id,source:id,target:id+'-child',sourcePort:'right',targetPort:'left',arrow:true})}
const doc={format:'pipeline-studio',schemaVersion:6,id:'status-capture',title:'Статусы до изменений',revision:0,materials:[],viewState:{compact:false},pages:[{id:'p',title:'Статусы',collapseMode:'nodes',nodes,edges,buses:[],groups:[],drawings:[],layoutOptions:{autoSpace:false,busSymmetry:false}}]};
(async()=>{const browser=await pw.chromium.launch(launchOptions),p=await browser.newPage({viewport:{width:1680,height:920}});try{
await p.goto('file:///'+B.replaceAll('\\','/')+'/Pipeline-Studio.html');await p.waitForSelector('#home-new');
await p.evaluate(async d=>{await Studio.activateDocument(d,{name:'Statuses.html'});const s=Studio.state;s.view={x:30,y:50,z:1};s.compact=false;Studio.render()},doc);
for(const id of ['condition','block','table']){const b=await p.locator('#nodes [data-node="'+id+'"]').boundingBox();await p.screenshot({path:path.join(out,id+'.png'),clip:{x:b.x-35,y:b.y-45,width:b.width+70,height:b.height+110}})}
await p.locator('#stage').screenshot({path:path.join(out,'all-statuses.png')});
await p.evaluate(()=>{for(const id of ['condition','block','table'])Studio.toggleNode(id)});
await p.locator('#stage').screenshot({path:path.join(out,'collapsed-statuses.png')});
console.log(JSON.stringify({screenshots:out}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
