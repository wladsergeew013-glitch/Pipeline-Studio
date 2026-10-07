'use strict';
const C=require('../app/static/core'),A=require('./layout_audit'),assert=require('node:assert/strict');
const n=(id,x,y,extra={})=>({id,title:id,type:'block',x,y,w:120,h:60,relativeLock:true,collapsible:true,...extra}),e=(id,source,target,extra={})=>({id,source,target,sourcePort:'right',targetPort:'left',arrow:true,...extra});
const fixture=()=>({id:'p',collapseMode:'nodes',layoutOptions:{autoSpace:true},nodes:[n('pd',-250,0,{collapsible:false}),n('ar',0,100),n('ar-end',700,650,{h:300}),n('vk',0,1200),n('ov',0,1324),n('drawings',400,1100),n('volumes',400,1800),n('d-end',800,1150),n('v-end',800,2100)],edges:[e('pa','pd','ar'),e('pv','pd','vk'),e('po','pd','ov'),e('ae','ar','ar-end'),e('vd','vk','drawings',{bus:'comb'}),e('vv','vk','volumes',{bus:'comb'}),e('ov','ov','volumes',{bus:'comb'}),e('de','drawings','d-end'),e('ve','volumes','v-end')],buses:[{id:'comb',mode:'free',symmetry:true,alignGap:64,orientation:'vertical'}],groups:[],drawings:[]});
const view=(p,folds=new Set(),compact=true,autoSpace=true)=>C.display(p,folds,compact,new Set(),{autoSpace}),near=(a,b)=>assert(Math.abs(a-b)<.01,`${a} != ${b}`),by=d=>new Map(d.nodes.map(n=>[n.id,n]));let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
function centred(d){const ns=by(d),point=(id,side)=>C.endpoint(ns.get(id),side,side).y;near((point('vk','right')+point('ov','right'))/2,(point('drawings','left')+point('volumes','left'))/2);assert(ns.get('drawings').y<ns.get('volumes').y);}
if(require.main===module){
test('The shared comb keeps one centre and output order in every adaptive mode',()=>{const p=fixture(),before=C.clone(p);for(const compact of [false,true])for(const autoSpace of [false,true])for(const folds of [new Set(),new Set(['ar'])])centred(view(p,folds,compact,autoSpace));assert.deepEqual(p,before);});
test('Opening an unrelated workflow translates the entire shared workflow uniformly',()=>{const p=fixture(),a=by(view(p,new Set(['ar']))),b=by(view(p)),ids=['vk','ov','drawings','volumes','d-end','v-end'],dx=b.get('vk').x-a.get('vk').x,dy=b.get('vk').y-a.get('vk').y;for(const id of ids){near(b.get(id).x-a.get(id).x,dx);near(b.get(id).y-a.get(id).y,dy);}});
test('Repeated partial folding never changes the internal shared arrangement',()=>{const p=fixture(),first=view(p);for(let i=0;i<6;i++){centred(view(p,new Set(['ar'])));assert.deepEqual(view(p),first);}});
test('The audit reports a displaced free-comb centre',()=>{const p=fixture(),d=view(p,new Set(),false,false);d.nodes.find(n=>n.id==='volumes').y+=75;const g=A.audit(C,p,d).symmetry.filter(g=>g.id==='comb');assert(g.some(g=>g.error>30));});
console.log('TOTAL',count);}
module.exports={fixture};
