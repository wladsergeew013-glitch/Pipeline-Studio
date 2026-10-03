'use strict';
// Optional local acceptance. The private document is never included in the repository.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),C=require('../app/static/core.js');
const input=path.resolve(__dirname,'../qa/user-document.json');
if(!fs.existsSync(input)){console.log('SKIP private working document is not present');process.exit(0);}
const doc=C.normalizeV6(JSON.parse(fs.readFileSync(input,'utf8'))),source=doc.pages[0],checks=[];
for(const reverse of [false,true])for(const compact of [false,true])for(const autoSpace of [false,true]){
  const p=C.clone(source);p.layoutOptions.autoSpace=autoSpace;
  const kr=p.nodes.find(n=>n.title.startsWith('КР ')),tx=p.nodes.find(n=>n.title.startsWith('ТХВ '));assert(kr&&tx);
  const [moving,target]=reverse?[tx,kr]:[kr,tx];
  const moved=C.moveNodes(p,C.dragPlan(p,[moving.id]).ids,target.x-moving.x,target.y-moving.y,moving.id);
  const d=C.display(moved,new Set(),compact),a=d.nodes.find(n=>n.id===kr.id),b=d.nodes.find(n=>n.id===tx.id);
  const overlaps=a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  if(autoSpace||compact)assert(!overlaps,'Pipeline roots overlap with layout enabled');
  const materialized=C.materializeLayout(moved,d),again=C.display(materialized,new Set(),compact);
  const drift=Math.max(...d.nodes.map(n=>{const next=again.nodes.find(q=>q.id===n.id);return Math.max(Math.abs(n.x-next.x),Math.abs(n.y-next.y));}));assert(drift<.01,'Layout drifts after materialization');
  checks.push({direction:reverse?'THV to KR':'KR to THV',compact,autoSpace,overlaps,drift});console.log('PASS',checks.at(-1));
}
fs.writeFileSync(path.resolve(__dirname,'../qa/working-document-collisions.json'),JSON.stringify({revision:doc.revision,checks},null,2));console.log('TOTAL',checks.length);
