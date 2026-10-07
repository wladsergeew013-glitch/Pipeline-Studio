/* Shared by the interactive laboratory and browser/model scenario sweeps. */
(function(root){
 'use strict';
 const annotation=n=>n.type==='summary';
 function audit(C,pg,d){
  const nodes=d.nodes.filter(n=>!annotation(n)),ns=new Map(d.nodes.map(n=>[n.id,n])),bundle=C.bundleRoutes(d),issues=[];
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.anchorId===b.id||b.anchorId===a.id)continue;if(a.x<b.x+b.w-.5&&a.x+a.w>b.x+.5&&a.y<b.y+b.h-.5&&a.y+a.h>b.y+.5)issues.push({kind:'blocks',ids:[a.id,b.id].sort()});}
  const paths=d.edges.filter(e=>!e.proxy&&!e.bus).map(e=>({e,points:bundle.routes.get(e.id)?.points||[]}));
  for(const {e,points} of paths)for(const n of nodes)if(n.id!==e.source&&n.id!==e.target&&n.anchorId!==e.source&&n.anchorId!==e.target&&points.slice(1).some((b,i)=>C.segmentBox(points[i],b,n)))issues.push({kind:'line-block',ids:[e.id,n.id]});
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){const a=paths[i],b=paths[j],common=[a.e.source,a.e.target].filter(id=>id===b.e.source||id===b.e.target);let bad=false;
   for(let k=1;k<a.points.length;k++)for(let l=1;l<b.points.length;l++){const hit=C.routeIntersection(a.points[k-1],a.points[k],b.points[l-1],b.points[l]);if(!hit)continue;
    // Connections at the same endpoint, including the shared outward lead,
    // are intentional. Crossings of links from distinct row ports are not.
    if(common.length&&C.commonRouteJunction(a.points,b.points,hit))continue;bad=true;
   }if(bad)issues.push({kind:'lines',ids:[a.e.id,b.e.id].sort()});
  }
  const symmetry=(d.symmetryGroups||[]).map(g=>{const edges=d.edges.filter(e=>g.edges?.includes(e.id)),role=g.role||'target',terminal=[...new Set(edges.map(e=>e[role]))].map(id=>{const e=edges.find(e=>e[role]===id);return C.endpoint(ns.get(id),e[role+'Port'],role==='source'?'right':'left')[g.axis];}).sort((a,b)=>a-b),other=role==='source'?'target':'source',opposite=[...new Set(edges.map(e=>e[other]))].map(id=>{const e=edges.find(e=>e[other]===id);return C.endpoint(ns.get(id),e[other+'Port'],other==='source'?'right':'left')[g.axis];}),hub=opposite.length===1?edges.reduce((s,e)=>s+C.endpoint(ns.get(e[other]),e[other+'Port'],other==='source'?'right':'left')[g.axis],0)/edges.length:(Math.min(...opposite)+Math.max(...opposite))/2,steps=terminal.slice(1).map((v,i)=>v-terminal[i]),ordered=g.heads.map(id=>{const e=edges.find(e=>e[role]===id);return C.endpoint(ns.get(id),e[role+'Port'],role==='source'?'right':'left')[g.axis];}),orderError=Math.max(0,...ordered.slice(1).map((v,i)=>ordered[i]-v));return {id:g.id||g.bus,heads:g.heads,axis:g.axis,error:Math.abs((terminal[0]+terminal.at(-1))/2-hub),orderError,stepError:steps.length?Math.max(...steps)-Math.min(...steps):0};});
  const routeSymmetry=(d.symmetryGroups||[]).filter(g=>g.heads?.length%2===0).map(g=>{const axis=g.axis,cross=axis==='y'?'x':'y',es=d.edges.filter(e=>g.edges?.includes(e.id)).map(e=>({e,s:C.endpoint(ns.get(e.source),e.sourcePort,'right'),t:C.endpoint(ns.get(e.target),e.targetPort,'left')})).sort((a,b)=>a.s[axis]-b.s[axis]||a.t[axis]-b.t[axis]||a.e.id.localeCompare(b.e.id)),eligible=!g.bus&&es.length%2===0&&es.every(v=>v.s.side===es[0].s.side&&v.t.side===es[0].t.side),lanes=es.map(({e})=>{const ps=bundle.routes.get(e.id)?.points;if(ps?.length!==4||Math.abs(ps[1][cross]-ps[2][cross])>.01)return null;const span=ps.at(-1)[cross]-ps[0][cross];return span?(ps[1][cross]-ps[0][cross])/span:null;}),shapes=es.map(({e,s,t})=>(bundle.routes.get(e.id)?.points||[]).map(p=>[(p[cross]-s[cross])/(t[cross]-s[cross]||1),(p[axis]-s[axis])/(t[axis]-s[axis]||1)])),error=eligible?Math.max(0,...shapes.map((shape,i)=>{const other=shapes.at(-1-i);return shape.length!==other.length||!shape.length?1:Math.max(0,...shape.flatMap((p,j)=>p.map((v,k)=>Math.abs(v-other[j][k]))));})):null;return {id:g.id||g.bus,lanes,error,status:eligible?'checked':g.bus?'bus':'different-ports',bends:shapes.map(s=>s.length-2)};});
  for(const g of routeSymmetry)if(g.error!==null&&g.error>.01)issues.push({kind:'route-symmetry',ids:[g.id]});
  for(const g of symmetry)if(g.error>.01||g.stepError>.01||g.orderError>.01)if(!issues.some(i=>i.kind==='symmetry'&&i.ids[0]===g.id))issues.push({kind:'symmetry',ids:[g.id]});
  return {nodes:d.nodes.length,edges:d.edges.length,issues,symmetry,routeSymmetry,routingConflicts:bundle.conflicts||[],symmetryConflicts:d.symmetryConflicts||[]};
 }
 const key=i=>i.kind+':'+i.ids.join('|'),added=(before,after)=>{const old=new Set(before.issues.map(key));return after.issues.filter(i=>!old.has(key(i)));};
 const api={audit,added,key};if(typeof module!=='undefined')module.exports=api;else root.LayoutAudit=api;
})(globalThis);
