'use strict';
const {Core:C,node:n,page,project}=require('./app_harness'),assert=require('node:assert/strict');
let count=0;const test=(name,fn)=>{fn();console.log('PASS',name);count++};
const edge=(id,source,target,extra={})=>({id,source,target,sourcePort:'right',targetPort:'left',arrow:true,...extra});
const pg=(nodes,edges=[],extra={})=>({...page(),collapseMode:'nodes',nodes,edges,...extra});
test('R21 protected descendants retain every required anchor ancestor in any node order',()=>{
 for(const kind of ['edge','drawing','bus']){
  const p=pg([n('child',{type:'image',anchorId:'middle'}),n('root'),n('middle',{anchorId:'root'}),n('other')],[edge('e','child','other')]);
  if(kind==='edge')p.edges[0].editLocked=true;
  if(kind==='drawing')p.drawings=[{id:'d',anchor:'child',editLocked:true,points:[]}];
  if(kind==='bus'){p.edges[0].bus='b';p.edges.push(edge('e2','child','root',{bus:'b'}));p.buses=[{id:'b',editLocked:true}];}
  const out=C.deleteSelection(p,{node:['root']});assert.deepEqual(out,p);
 }
 const p=pg([n('child',{anchorId:'middle'}),n('root'),n('middle',{anchorId:'root'})]);
 assert.equal(C.deleteSelection(p,{node:['root']}).nodes.length,0);
});
test('R22 table preflight rejects the entire row change for protected edges or combs',()=>{
 for(const bus of [false,true]){
  const t=n('t',{type:'table',table:{cells:[[{text:'one'}],[{text:'two'}]],widths:[120]}});
  C.initTable(t);const port=C.ports(t).find(p=>p.rowId===t.table.rowIds[1]);
  const p=pg([t,n('a')],[edge('row','t','a',{sourcePort:port.id,editLocked:!bus,bus:bus?'b':null})],{buses:bus?[{id:'b',editLocked:true}]:[]}),before=C.clone(p),next=C.clone(t.table);
  next.cells.pop();next.rowIds.pop();assert.throws(()=>C.preflightTableChange(p,'t',next),/защищ/);assert.deepEqual(p,before);
 }
});
test('R23 joining protected connections or taking one from a protected comb is atomic',()=>{
 for(const kind of ['edge','source','target']){
  const p=pg([n('a'),n('b'),n('c')],[edge('one','a','b',{bus:'source',editLocked:kind==='edge'}),edge('two','a','c',{bus:'source'})],{buses:[{id:'source',editLocked:kind==='source'},{id:'target',editLocked:kind==='target'}]}),before=C.clone(p);
  assert.throws(()=>C.joinBus(p,'target',['one']),/защищ/);assert.deepEqual(p,before);
 }
});
test('R24 a locked anchored image keeps absolute position when its host moves or is projected',()=>{
 const p=pg([n('host'),n('image',{type:'image',x:130,y:140,anchorId:'host',anchorX:30,anchorY:40,locked:true})]),before=C.anchorPositions(p).get('image');
 const out=C.moveNodes(p,new Set(['host']),75,55,'host');
 assert.deepEqual(C.anchorPositions(out).get('image'),before);
 const shown=C.display(out,new Set(),true).nodes.find(n=>n.id==='image');assert.equal(shown.x,before.x);assert.equal(shown.y,before.y);
 const nested=pg([n('child',{anchorId:'image',anchorX:5,anchorY:5,locked:true}),p.nodes[1],p.nodes[0]]),expected=C.anchorPositions(nested),moved=C.moveNodes(nested,new Set(['host']),75,55,'host');
 for(const id of ['image','child'])assert.deepEqual(C.anchorPositions(moved).get(id),expected.get(id));
});
test('R25 R26 bulk dimension changes respect fixation while a title change replaces rich text',()=>{
 const p=pg([n('locked',{locked:true,html:'<b>OLD</b>'}),n('free',{html:'<b>OLD</b>'})]);
 const out=C.bulkPatch(p,{node:['locked','free']},{w:400,h:250,title:'NEW'});
 assert.equal(out.nodes[0].w,120);assert.equal(out.nodes[0].h,60);assert.equal(out.nodes[1].w,400);
 for(const n of out.nodes){assert.equal(n.title,'NEW');assert.equal(n.html,undefined);}
});
test('R27 table body-port position uses only the model enum',()=>{
 const t=n('t',{table:{cells:[[{text:'x'}]],widths:[120]}}),p=pg([t]);
 for(const value of ['center','header'])assert.equal(C.bulkPatch(p,{node:['t']},{tableBodyPosition:value}).nodes[0].tableBodyPosition,value);
 assert.throws(()=>C.bulkPatch(p,{node:['t']},{tableBodyPosition:'above'}));
});
test('R28 a mirrored cohort moves a free comb by its own displacement on either axis',()=>{
 for(const axis of ['x','y']){
  const p=pg([n('a'),n('b',{x:400}),n('c',{x:600})],[edge('b1','b','c',{bus:'free'}),edge('b2','c','b',{bus:'free'})],{buses:[{id:'free',mode:'free',axis:900,orientation:axis==='x'?'vertical':'horizontal'}]}),out=C.clone(p);
  for(const n of out.nodes)if(n.id!=='a')n[axis]+=20;
  C.moveRouteObjects(out,new Set(['a','b','c']),-20,-20,p);assert.equal(out.buses[0].axis,920);
  const plan={model:p,moving:new Set(['a']),mirrors:[{ids:new Set(['b','c']),axis,factor:-1}],strict:false,before:C.display(p,new Set(),false)};
  const mirrored=C.moveNodes(p,new Set(['a']),axis==='x'?-20:0,axis==='y'?-20:0,'a',plan);
  assert.equal(mirrored.buses[0].axis,920);assert.equal(p.buses[0].axis,900);
 }
});
test('R01 shared normalization rejects markup and alternate bad types, preserving numeric legacy input',()=>{
 for(const value of ['13"><img src=x>',false,{},Infinity]){
  for(const kind of ['cell','bus','drawing','version','wrap']){
   const p=project();
   if(kind==='cell')p.pages[0].nodes[0].table={cells:[[{fontSize:value}]]};
   if(kind==='wrap')p.pages[0].nodes[0].table={cells:[[{text:'ok'}]],wordWrap:value};
   if(kind==='bus')p.pages[0].buses=[{id:'b',width:value}];
   if(kind==='drawing')p.pages[0].drawings=[{id:'d',width:value,points:[]}];
   if(kind==='version')p.materials=[{id:'m',version:value}];
   assert.throws(()=>C.normalizeV6(p),undefined,kind);
  }
 }
 const p=project();p.pages[0].nodes[0].fontSize='16.5';p.pages[0].drawings=[{id:'d',width:1.25,points:[]}];C.normalizeV6(p);assert.equal(p.pages[0].nodes[0].fontSize,16.5);
});
console.log('TOTAL',count);
