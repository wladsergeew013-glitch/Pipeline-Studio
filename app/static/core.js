/* Pure model operations. Shared by editor and automated tests. */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const uid=prefix=>prefix+'-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
const defaultPorts=()=>[{id:'left',side:'left',x:0,y:.5},{id:'right',side:'right',x:1,y:.5},{id:'top',side:'top',x:.5,y:0},{id:'bottom',side:'bottom',x:.5,y:1}];
function ports(n){const out=[...(n.ports||[])];for(const p of defaultPorts())if(!out.some(x=>x.id===p.id))out.push(p);return out;}
function port(n,id,fallback='right') { return ports(n).find(p=>p.id===id)||defaultPorts().find(p=>p.id===fallback); }
function endpoint(n,pid,fallback){const p=port(n,pid,fallback);return {x:n.x+n.w*p.x,y:n.y+n.h*p.y,side:p.side};}
function validateTable(t){
 const rows=t.cells.length,cols=t.cells[0]?.length||0;if(!rows||!cols)throw Error('Таблица пуста');const occupied=Array.from({length:rows},()=>Array(cols).fill(false));
 for(let r=0;r<rows;r++){if(t.cells[r].length!==cols)throw Error('Разное число столбцов');for(let c=0;c<cols;c++){const v=t.cells[r][c];if(!v)continue;const rs=v.rowspan||1,cs=v.colspan||1;if(rs<1||cs<1||r+rs>rows||c+cs>cols)throw Error('Объединение выходит за границы');for(let i=r;i<r+rs;i++)for(let j=c;j<c+cs;j++){if(occupied[i][j])throw Error('Перекрывающиеся объединения');occupied[i][j]=true;if((i!==r||j!==c)&&t.cells[i][j])throw Error('Скрытая ячейка не пуста');}}}
 if(occupied.some(row=>row.some(v=>!v)))throw Error('Неполная сетка ячеек');return true;
}
function normalizedRange(a,b){return {r0:Math.min(a.r,b.r),r1:Math.max(a.r,b.r),c0:Math.min(a.c,b.c),c1:Math.max(a.c,b.c)};}
function mergeTable(table,a,b){
 const t=clone(table),q=normalizedRange(a,b),texts=[];if(q.r0===q.r1&&q.c0===q.c1)throw Error('Выберите диапазон: первая ячейка → Shift + последняя');
 for(let r=0;r<t.cells.length;r++)for(let c=0;c<t.cells[r].length;c++){const v=t.cells[r][c];if(!v)continue;const re=r+(v.rowspan||1)-1,ce=c+(v.colspan||1)-1;const hit=r<=q.r1&&re>=q.r0&&c<=q.c1&&ce>=q.c0;if(hit&&(r<q.r0||re>q.r1||c<q.c0||ce>q.c1))throw Error('Диапазон пересекает объединение. Сначала разъедините его.');}
 const first=t.cells[q.r0][q.c0];if(!first)throw Error('Начало диапазона скрыто объединением');
 for(let r=q.r0;r<=q.r1;r++)for(let c=q.c0;c<=q.c1;c++){if(t.cells[r][c]?.text)texts.push(t.cells[r][c].text);t.cells[r][c]=null;}
 t.cells[q.r0][q.c0]={...first,text:texts.join('\n'),html:'',rowspan:q.r1-q.r0+1,colspan:q.c1-q.c0+1};validateTable(t);return t;
}
function splitTable(table,r,c){const t=clone(table),v=t.cells[r]?.[c];if(!v)throw Error('Выберите начало объединенной ячейки');for(let i=r;i<r+(v.rowspan||1);i++)for(let j=c;j<c+(v.colspan||1);j++)t.cells[i][j]={text:i===r&&j===c?v.text:'',rowspan:1,colspan:1,fill:v.fill||'#ffffff'};validateTable(t);return t;}
function bounds(nodes){if(!nodes.length)return {x:0,y:0,w:500,h:400};const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return {x,y,w:Math.max(...nodes.map(n=>n.x+n.w))-x,h:Math.max(...nodes.map(n=>n.y+n.h))-y};}
/** A node belongs to one direct group; parentId forms a checked forest. */
function hierarchy(page){
 const byId=new Map(),children=new Map(),owner=new Map(),nodes=new Set(page.nodes.map(n=>n.id));
 for(const g of page.groups||[]){if(!g.id||byId.has(g.id))throw Error('Повторяющийся ID подпроцесса');byId.set(g.id,g);children.set(g.id,[]);}
 const roots=[];
 for(const g of byId.values()){
  if(g.parentId){if(!byId.has(g.parentId))throw Error('Родитель подпроцесса не найден');children.get(g.parentId).push(g);}else roots.push(g);
  for(const id of g.members||[]){if(!nodes.has(id))throw Error('В подпроцессе указан отсутствующий блок');if(owner.has(id))throw Error('Блок включён сразу в несколько подпроцессов');owner.set(id,g.id);}
  const seen=new Set([g.id]);let parent=g.parentId;
  while(parent){if(seen.has(parent))throw Error('Подпроцесс нельзя вложить в самого себя или своего потомка');seen.add(parent);if(seen.size>32)throw Error('Максимальная глубина подпроцессов: 32');parent=byId.get(parent)?.parentId;}
 }
 const sort=list=>list.sort((a,b)=>(a.order||0)-(b.order||0)||String(a.id).localeCompare(String(b.id)));
 sort(roots);for(const list of children.values())sort(list);
 const memo=new Map();function members(id){if(!memo.has(id))memo.set(id,[...(byId.get(id)?.members||[]),...(children.get(id)||[]).flatMap(g=>members(g.id))]);return memo.get(id);}
 function ancestors(id){const out=[];let g=byId.get(id);while(g){out.push(g.id);g=byId.get(g.parentId);}return out;}
 const flat=[];function walk(g,depth){flat.push({group:g,depth,path:ancestors(g.id).reverse().map(id=>byId.get(id).title).join(' / ')});for(const child of children.get(g.id))walk(child,depth+1);}roots.forEach(g=>walk(g,0));
 return {byId,children,owner,roots,members,ancestors,flat};
}
function reparentGroup(page,id,parentId){const p=clone(page),g=p.groups.find(g=>g.id===id);if(!g)throw Error('Подпроцесс не найден');g.parentId=parentId||null;hierarchy(p);return p;}
function dissolveGroup(page,id){
 const p=clone(page),g=p.groups.find(g=>g.id===id);if(!g)throw Error('Подпроцесс не найден');
 const parent=p.groups.find(x=>x.id===g.parentId);if(parent)parent.members.push(...g.members);
 p.groups.forEach(x=>{if(x.parentId===id)x.parentId=g.parentId||null;});
 p.nodes.forEach(n=>{if(g.members.includes(n.id))n.group=g.parentId||null;});p.groups=p.groups.filter(x=>x.id!==id);hierarchy(p);return p;
}
function display(page,collapsed=new Set(),compact=true,foldedTables=new Set()){
 const h=hierarchy(page),actual=new Map(page.nodes.map(n=>[n.id,n])),out=[],frames=[],map=new Map();let cursor=80,right=520;
 const effective=n=>({...n,x:n.x+(n.offsetX||0),y:n.y+(n.offsetY||0),h:foldedTables.has(n.id)?74:n.h});
 const translate=(unit,dx,dy)=>{const bx=unit.box.x,by=unit.box.y;unit.nodes.forEach(n=>{n.x+=dx;n.y+=dy;});unit.frames.forEach(f=>{f.x+=dx;f.y+=dy;});unit.box={...unit.box,x:bx+dx,y:by+dy};};
 function pack(units){
  if(!compact||!units.length)return;
  const intervals=units.map(u=>[u.box.y,u.box.y+u.box.h]).sort((a,b)=>a[0]-b[0]),bands=[];
  for(const v of intervals){const last=bands.at(-1);if(last&&v[0]<=last[1]+40)last[1]=Math.max(last[1],v[1]);else bands.push([...v]);}
  for(const unit of units){let cut=0;for(let i=1;i<bands.length;i++)if(unit.box.y>=bands[i][0])cut+=Math.max(0,bands[i][0]-bands[i-1][1]-48);translate(unit,0,-cut);}
 }
 function groupUnit(g,depth){
  const ids=h.members(g.id),members=ids.map(id=>actual.get(id)).filter(n=>!n.anchorId),bb=bounds(members.map(effective));
  if(collapsed.has(g.id)){
   const n={id:'group:'+g.id,type:'summary',title:g.title,x:bb.x,y:bb.y,w:250,h:86,fill:'#ffffff',stroke:g.color||'#7376e6',groupId:g.id,count:members.length,materials:[...new Set(ids.flatMap(id=>actual.get(id).materials||[]))],ports:defaultPorts()};
   ids.forEach(id=>map.set(id,n.id));const f={...n,x:n.x-20,y:n.y-32,w:n.w+40,h:n.h+52,color:g.color||'#7376e6',id:g.id,depth};return {nodes:[n],frames:[f],box:f};
  }
  const units=(g.members||[]).map(id=>actual.get(id)).filter(n=>!n.anchorId).map(n=>{map.set(n.id,n.id);const a=effective(n);return {nodes:[a],frames:[],box:{...a}};});
  for(const child of h.children.get(g.id))units.push(groupUnit(child,depth+1));
  if(!units.length){const f={id:g.id,title:g.title,x:bb.x,y:bb.y,w:270,h:60,color:g.color||'#7376e6',depth};return {nodes:[],frames:[f],box:f};}
  pack(units);const b=bounds(units.map(u=>u.box));const f={...b,x:b.x-20,y:b.y-32,w:b.w+40,h:b.h+52,title:g.title,color:g.color||'#7376e6',id:g.id,depth};
  return {nodes:units.flatMap(u=>u.nodes),frames:[f,...units.flatMap(u=>u.frames)],box:f};
 }
 for(const g of h.roots){
  const unit=groupUnit(g,0);if(compact)translate(unit,260-unit.box.x,cursor-32-unit.box.y);
  out.push(...unit.nodes);frames.push(...unit.frames);cursor=unit.box.y+unit.box.h+56;right=Math.max(right,unit.box.x+unit.box.w);
 }
 let oy=100;
 for(const n of page.nodes.filter(n=>!h.owner.has(n.id)&&!n.anchorId)){
  const isRoot=!page.edges.some(e=>e.target===n.id)&&String(n.title).trim()==='ПД';
  out.push({...effective(n),x:(compact?(isRoot?30:right+95):n.x)+(n.offsetX||0),y:(compact?(isRoot?Math.max(100,cursor/2-80):oy):n.y)+(n.offsetY||0)});if(!isRoot)oy+=n.h+72;map.set(n.id,n.id);
 }
 for(const n of page.nodes.filter(n=>n.anchorId)){
  const host=out.find(x=>x.id===map.get(n.anchorId));if(!host||host.type==='summary'){map.set(n.id,host?.id);continue;}
  // An anchored image is part of its host visually, regardless of registry membership.
  out.push({...n,x:host.x+(n.anchorX||0),y:host.y+(n.anchorY||0)});map.set(n.id,n.id);
 }
 const edgeMap=new Map();
 for(const e of page.edges){
  const src=map.get(e.source),dst=map.get(e.target);if(!src||!dst||src===dst&&e.source!==e.target)continue;
  const proxy=src!==e.source||dst!==e.target;
  // Never merge real parallel edges. Only aggregate collapsed boundary connections.
  const key=proxy?[src,dst,src===e.source?e.sourcePort:'',dst===e.target?e.targetPort:'',e.arrow!==false,e.dashed===true].join('|'):'edge:'+e.id;
  const ex=edgeMap.get(key);if(ex){ex.count++;ex.originalIds.push(e.id);if(e.label&&!ex.label.split(' / ').includes(e.label))ex.label=[ex.label,e.label].filter(Boolean).join(' / ');continue;}
  edgeMap.set(key,{...e,source:src,target:dst,sourcePort:src===e.source?e.sourcePort:'right',targetPort:dst===e.target?e.targetPort:'left',count:1,proxy,originalIds:[e.id]});
 }
 return {nodes:out,edges:[...edgeMap.values()],frames,map};
}
/** Bake a projected compact view before precise manual positioning. Hidden contents are translated, not discarded. */
function materializeLayout(page,d){
 const p=clone(page),ns=new Map(p.nodes.map(n=>[n.id,n])),visible=new Map(d.nodes.map(n=>[n.id,n]));
 const hidden=new Map();for(const n of p.nodes){const mapped=d.map.get(n.id);if(mapped?.startsWith('group:')&&!n.anchorId){if(!hidden.has(mapped))hidden.set(mapped,[]);hidden.get(mapped).push(n);}}
 for(const [id,list] of hidden){const b=bounds(list.map(n=>({...n,x:n.x+(n.offsetX||0),y:n.y+(n.offsetY||0)}))),summary=visible.get(id);if(!summary)continue;for(const n of list){n.x=n.x+(n.offsetX||0)+summary.x-b.x;n.y=n.y+(n.offsetY||0)+summary.y-b.y;n.offsetX=n.offsetY=0;}}
 for(const v of d.nodes){const n=ns.get(v.id);if(n&&!n.anchorId){n.x=v.x;n.y=v.y;n.offsetX=n.offsetY=0;}}
 return p;
}
function arrange(page,ids,mode){
 const p=clone(page),wanted=new Set(ids),nodes=p.nodes.filter(n=>wanted.has(n.id)&&!n.anchorId);if(nodes.length<2)throw Error('Выберите минимум два независимых блока');
 for(const n of nodes){n.x+=n.offsetX||0;n.y+=n.offsetY||0;n.offsetX=n.offsetY=0;}
 const b=bounds(nodes);
 if(mode==='horizontal'||mode==='vertical'){
  if(nodes.length<3)throw Error('Для распределения выберите минимум три блока');const x=mode==='horizontal',pos=x?'x':'y',size=x?'w':'h';nodes.sort((a,b)=>a[pos]-b[pos]);const span=nodes.at(-1)[pos]+nodes.at(-1)[size]-nodes[0][pos],gap=(span-nodes.reduce((s,n)=>s+n[size],0))/(nodes.length-1);if(gap<0)throw Error('Недостаточно места: раздвиньте крайние блоки');let cur=nodes[0][pos];for(const n of nodes){n[pos]=cur;cur+=n[size]+gap;}
 }else for(const n of nodes){if(mode==='left')n.x=b.x;else if(mode==='right')n.x=b.x+b.w-n.w;else if(mode==='center')n.x=b.x+(b.w-n.w)/2;else if(mode==='top')n.y=b.y;else if(mode==='bottom')n.y=b.y+b.h-n.h;else if(mode==='middle')n.y=b.y+(b.h-n.h)/2;else throw Error('Неизвестное выравнивание');}
 return p;
}
/** Insert/delete a whole table axis without corrupting merged spans. */
function tableAxis(table,axis,index,remove=false){
 validateTable(table);const t=clone(table),rows=t.cells.length,cols=t.cells[0].length,isRow=axis==='row',old=isRow?rows:cols;
 if(!['row','col'].includes(axis)||!Number.isInteger(index)||index<0||index>(remove?old-1:old))throw Error('Некорректный индекс строки / столбца');
 if(remove&&old===1)throw Error('Нельзя удалить последнюю строку / столбец');
 const cells=Array.from({length:rows+(isRow?(remove?-1:1):0)},()=>Array(cols+(!isRow?(remove?-1:1):0)).fill(null));
 const occupied=cells.map(row=>row.map(()=>false));
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const v=t.cells[r][c];if(!v)continue;let pos=isRow?r:c,span=isRow?(v.rowspan||1):(v.colspan||1);
  if(remove){if(pos===index&&span===1)continue;if(pos>index)pos--;else if(pos<=index&&pos+span>index)span--;}
  else {if(pos>=index)pos++;else if(pos+span>index)span++;}
  const nr=isRow?pos:r,nc=isRow?c:pos;if(isRow)v.rowspan=span;else v.colspan=span;
  cells[nr][nc]=v;for(let i=nr;i<nr+(v.rowspan||1);i++)for(let j=nc;j<nc+(v.colspan||1);j++)occupied[i][j]=true;
 }
 for(let r=0;r<cells.length;r++)for(let c=0;c<cells[r].length;c++)if(!occupied[r][c])cells[r][c]={text:'',rowspan:1,colspan:1,fill:'#ffffff'};
 t.cells=cells;if(!isRow){t.widths=t.widths||Array(cols).fill(170);if(remove)t.widths.splice(index,1);else t.widths.splice(index,0,t.widths[Math.max(0,index-1)]||170);}validateTable(t);return t;
}
function edgePath(edge,ns){
 const a=ns.get(edge.source),b=ns.get(edge.target);if(!a||!b)return null;
 const s=endpoint(a,edge.sourcePort,'right'),t=endpoint(b,edge.targetPort,'left');
 const vectors={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]},sv=vectors[s.side]||vectors.right,tv=vectors[t.side]||vectors.left,stub=24;
 const p={x:s.x+sv[0]*stub,y:s.y+sv[1]*stub},q={x:t.x+tv[0]*stub,y:t.y+tv[1]*stub},horizontal=v=>v.side==='left'||v.side==='right';
 let mids=[],controls=[];
 if(!edge.proxy&&edge.waypoints?.length){
  controls=edge.waypoints.map(w=>({x:s.x+w.dx,y:s.y+w.dy}));let last=p,hor=horizontal(s);
  for(const w of controls){mids.push(hor?{x:w.x,y:last.y}:{x:last.x,y:w.y},w);last=w;hor=!hor;}
  mids.push(horizontal(t)?{x:last.x,y:q.y}:{x:q.x,y:last.y});
 }else if(edge.source===edge.target){
  // Route a self-loop outside the node, retaining distinct fixed stubs.
  const x=a.x+a.w+52,y=a.y-52;
  if(s.side===t.side&&Math.abs(s.x-t.x)+Math.abs(s.y-t.y)<.1){
   const tangent={x:-sv[1]*52,y:sv[0]*52};mids=[{x:p.x+sv[0]*40,y:p.y+sv[1]*40},{x:p.x+sv[0]*40+tangent.x,y:p.y+sv[1]*40+tangent.y},{x:p.x+tangent.x,y:p.y+tangent.y}];
  }else {const left=a.x-52,top=a.y-52,right=a.x+a.w+52,bottom=a.y+a.h+52;
   const outer=z=>({x:z.side==='left'?left:z.side==='right'?right:z.x,y:z.side==='top'?top:z.side==='bottom'?bottom:z.y});
   const u=outer(s),v=outer(t);mids=[u];if(horizontal(s)===horizontal(t)){if(horizontal(s))mids.push({x:u.x,y:top},{x:v.x,y:top});else mids.push({x:right,y:u.y},{x:right,y:v.y});}else mids.push(horizontal(s)?{x:u.x,y:v.y}:{x:v.x,y:u.y});mids.push(v);
  }
 }else if(horizontal(s)&&horizontal(t)){
  if(s.side===t.side){const x=s.side==='right'?Math.max(p.x,q.x)+24:Math.min(p.x,q.x)-24;mids=[{x,y:p.y},{x,y:q.y}];}
  else if((s.side==='right'&&p.x>q.x)||(s.side==='left'&&p.x<q.x)){const y=Math.min(a.y,b.y)-48;mids=[{x:p.x,y},{x:q.x,y}];}
  else {const x=(p.x+q.x)/2;mids=[{x,y:p.y},{x,y:q.y}];}
 }else if(!horizontal(s)&&!horizontal(t)){
  if(s.side===t.side){const y=s.side==='bottom'?Math.max(p.y,q.y)+24:Math.min(p.y,q.y)-24;mids=[{x:p.x,y},{x:q.x,y}];}
  else if((s.side==='bottom'&&p.y>q.y)||(s.side==='top'&&p.y<q.y)){const x=Math.max(a.x+a.w,b.x+b.w)+48;mids=[{x,y:p.y},{x,y:q.y}];}
  else {const y=(p.y+q.y)/2;mids=[{x:p.x,y},{x:q.x,y}];}
 }else mids=[horizontal(s)?{x:q.x,y:p.y}:{x:p.x,y:q.y}];
 const pts=[s,p,...mids,q,t].filter((v,i,all)=>!i||Math.abs(v.x-all[i-1].x)+Math.abs(v.y-all[i-1].y)>.001);
 const length=pts.slice(1).reduce((acc,v,i)=>acc+Math.hypot(v.x-pts[i].x,v.y-pts[i].y),0);let left=length/2,mid=s;
 for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);if(left<=d){const f=d?left/d:0;mid={x:pts[i-1].x+(pts[i].x-pts[i-1].x)*f,y:pts[i-1].y+(pts[i].y-pts[i-1].y)*f};break;}left-=d;}
 return {d:pts.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),x:mid.x,y:mid.y,points:pts,controls};
}
function autoLayout(page,groupId){
 const p=clone(page),group=groupId?p.groups.find(g=>g.id===groupId):null;const members=group?new Set(hierarchy(p).members(group.id)):new Set(p.nodes.map(n=>n.id));const nodes=p.nodes.filter(n=>members.has(n.id)&&!n.anchorId);const edges=p.edges.filter(e=>members.has(e.source)&&members.has(e.target)&&e.source!==e.target);const adj=new Map(nodes.map(n=>[n.id,[]]));for(const e of edges)adj.get(e.source)?.push(e.target);
 // Tarjan SCC makes layout terminate even with cyclic workflows.
 let index=0;const stack=[],indices=new Map(),low=new Map(),on=new Set(),components=[];
 function visit(id){indices.set(id,index);low.set(id,index++);stack.push(id);on.add(id);for(const next of adj.get(id)||[]){if(!indices.has(next)){visit(next);low.set(id,Math.min(low.get(id),low.get(next)));}else if(on.has(next))low.set(id,Math.min(low.get(id),indices.get(next)));}if(low.get(id)===indices.get(id)){const c=[];let v;do{v=stack.pop();on.delete(v);c.push(v);}while(v!==id);components.push(c);}}
 for(const n of nodes)if(!indices.has(n.id))visit(n.id);const ci=new Map();components.forEach((c,i)=>c.forEach(id=>ci.set(id,i)));const rank=components.map(()=>0);
 for(let pass=0;pass<components.length;pass++){let changed=false;for(const e of edges){const a=ci.get(e.source),b=ci.get(e.target);if(a!==b&&rank[b]<rank[a]+1){rank[b]=rank[a]+1;changed=true;}}if(!changed)break;}
 const columns=new Map();for(const n of nodes){const r=rank[ci.get(n.id)];if(!columns.has(r))columns.set(r,[]);columns.get(r).push(n);}let x=group?Math.min(...nodes.map(n=>n.x)):50;
 for(const [,col] of [...columns.entries()].sort((a,b)=>a[0]-b[0])){let y=50;col.sort((a,b)=>a.y-b.y).forEach(n=>{n.x=x;n.y=y;n.offsetX=0;n.offsetY=0;y+=n.h+58;});x+=Math.max(...col.map(n=>n.w))+130;}
 return p;
}
const api={clone,uid,ports,port,endpoint,bounds,validateTable,mergeTable,splitTable,normalizedRange,display,edgePath,autoLayout,hierarchy,reparentGroup,dissolveGroup,materializeLayout,arrange,tableAxis};root.Core=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
/* 0.3 model: graph-driven collapse, persistent row ports and shared connection buses. */
(function(root){
'use strict';
const C=root.Core, old={...C};
const effective=n=>({...n,x:n.x+(n.offsetX||0),y:n.y+(n.offsetY||0)});
const finite=(n,d=0)=>Number.isFinite(Number(n))?Number(n):d;
function tableMetrics(n){
 const t=n.table;if(!t)return {heights:[],centers:[],header:34,total:n.h};
 const cols=t.cells[0]?.length||1,widths=Array.from({length:cols},(_,i)=>Math.max(32,finite(t.widths?.[i],150)));
 const scale=(n.w||widths.reduce((a,b)=>a+b,0))/widths.reduce((a,b)=>a+b,0),font=n.fontSize||13;
 const heights=t.cells.map((row,r)=>{
  if(t.heights?.[r]>0)return Math.max(24,t.heights[r]);
  let height=36;row.forEach((cell,c)=>{if(!cell||(cell.rowspan||1)>1)return;
   const width=widths.slice(c,c+(cell.colspan||1)).reduce((a,b)=>a+b,0)*scale-18;
   const chars=Math.max(2,Math.floor(width/(font*.54))),lines=String(cell.text||'').split('\n').reduce((s,v)=>s+Math.max(1,Math.ceil(v.length/chars)),0);
   height=Math.max(height,Math.ceil(lines*font*1.35+18));
  });return height;
 });
 // Spread space needed by merged content over auto-height rows only.
 t.cells.forEach((row,r)=>row.forEach((cell,c)=>{if(!cell||(cell.rowspan||1)<=1)return;
  const rs=cell.rowspan, width=widths.slice(c,c+(cell.colspan||1)).reduce((a,b)=>a+b,0)*scale-18;
  const chars=Math.max(2,Math.floor(width/(font*.54))),need=String(cell.text||'').split('\n').reduce((s,v)=>s+Math.max(1,Math.ceil(v.length/chars)),0)*font*1.35+18;
  const have=heights.slice(r,r+rs).reduce((a,b)=>a+b,0),auto=heights.slice(r,r+rs).map((_,i)=>r+i).filter(i=>!t.heights?.[i]);
  if(need>have&&auto.length)for(const i of auto)heights[i]+=Math.ceil((need-have)/auto.length);
 }));
 const header=38,centers=[];let y=header;for(const h of heights){centers.push(y+h/2);y+=h;}
 return {heights,centers,header,total:y+((n.materials||[]).length?30:3),widths};
}
function initTable(n){
 const t=n.table;if(!t)return;
 const rows=t.cells.length,cols=t.cells[0]?.length||1;
 t.widths=Array.from({length:cols},(_,i)=>Math.max(32,finite(t.widths?.[i],150)));
 t.heights=Array.from({length:rows},(_,i)=>Math.max(0,finite(t.heights?.[i],0)));
 t.rowIds=Array.from({length:rows},(_,i)=>t.rowIds?.[i]||C.uid('row'));
 if(new Set(t.rowIds).size!==rows)throw Error('Повторяются идентификаторы строк таблицы');
 if(!n.portConfig)n.portConfig={body:['left'],rows:['right']};
 // Preserve imported endpoint IDs; annotate old row endpoints rather than renumbering them.
 const sourceRows=String(n.original?.style||'').includes('swimlane');
 if(sourceRows)for(const p of n.ports||[]){
  if(p.rowId||p.side!=='right'||!p.id.includes('-'))continue;
  const oldY=p.y*(n.h||100),row=Math.max(0,Math.min(rows-1,Math.round((oldY-45)/30)));
  p.rowId=t.rowIds[row];
 }
 for(const side of ['left','right'])for(const rowId of t.rowIds){
  if(!(n.ports||[]).some(p=>p.rowId===rowId&&p.side===side)){
   n.ports=n.ports||[];n.ports.push({id:'row:'+rowId+':'+side,rowId,side,x:side==='left'?0:1,y:.5});
  }
 }
}
function ports(n){
 const ps=old.ports(n).map(p=>({...p}));
 if(!n.table)return ps;
 const t=n.table,m=tableMetrics(n),height=n.h||m.total;
 for(const p of ps){if(p.rowId){const r=(t.rowIds||[]).indexOf(p.rowId);p.y=r>=0?m.centers[r]/height:.5;p.x=p.side==='left'?0:1;}
  else if(p.id==='left'||p.id==='right')p.y=m.header/2/height;
 }
 return ps;
}
function port(n,id,fallback='right'){return ports(n).find(p=>p.id===id)||old.port({},fallback,fallback);}
function endpoint(n,id,fallback){const p=port(n,id,fallback);return {x:n.x+n.w*p.x,y:n.y+n.h*p.y,side:p.side};}
function visiblePorts(n,edges=[]){
 const used=new Set(edges.flatMap(e=>[e.source===n.id?e.sourcePort:null,e.target===n.id?e.targetPort:null]));
 let list=ports(n);
 if(n.table){const cfg=n.portConfig||{body:['left'],rows:['right']};list=list.filter(p=>p.rowId?(n.table.rowIds||[]).includes(p.rowId)&&(cfg.rows||[]).includes(p.side)&&!n.tableFolded:(cfg.body||[]).includes(p.side)&&p.id===p.side);
 }else if(n.portConfig?.body)list=list.filter(p=>n.portConfig.body.includes(p.side));
 // One visual handle per physical location. Existing edges still retain their own IDs.
 list.sort((a,b)=>Number(used.has(b.id))-Number(used.has(a.id))||Number(!!b.rowId)-Number(!!a.rowId));
 const result=[];for(const p of list)if(!result.some(q=>q.side===p.side&&Math.abs(q.x-p.x)<.005&&Math.abs(q.y-p.y)<.005))result.push(p);
 return result;
}
function tableAxis(t,axis,index,remove=false){
 const ids=t.rowIds||t.cells.map(()=>C.uid('row')),hs=t.heights||t.cells.map(()=>0),out=old.tableAxis(t,axis,index,remove);
 if(axis==='row'){out.rowIds=[...ids];out.heights=[...hs];if(remove){out.rowIds.splice(index,1);out.heights.splice(index,1);}else{out.rowIds.splice(index,0,C.uid('row'));out.heights.splice(index,0,0);}}
 return out;
}
function graph(page){
 const byId=new Map(page.nodes.map(n=>[n.id,n])),adj=new Map(page.nodes.map(n=>[n.id,[]]));
 for(const e of page.edges){if(e.flow===false||!byId.has(e.source)||!byId.has(e.target))continue;adj.get(e.source).push(e.target);
  // A line without an arrow is an association. A connected note belongs to the chain,
  // regardless of which end the original draw.io author drew first.
  if(e.arrow===false)adj.get(e.target).push(e.source);
 }
 for(const n of page.nodes)if(n.anchorId&&adj.has(n.anchorId))adj.get(n.anchorId).push(n.id);
 return {byId,adj};
}
function descendants(page,id){
 const {byId,adj}=graph(page),seen=new Set(),stack=[...(adj.get(id)||[])];
 while(stack.length){const next=stack.pop();if(next===id||seen.has(next)||byId.get(next)?.collapseBoundary)continue;seen.add(next);stack.push(...(adj.get(next)||[]));}
 return seen;
}
function collapseState(page,collapsed){
 const {byId,adj}=graph(page),roots=page.nodes.filter(n=>n.collapsible&&collapsed.has(n.id)).map(n=>n.id);
 const candidates=new Set(),sets=new Map();for(const id of roots){const ds=descendants(page,id);sets.set(id,ds);ds.forEach(n=>candidates.add(n));}
 const visible=new Set(page.nodes.filter(n=>!candidates.has(n.id)).map(n=>n.id));
 // Keep a representative folding root in a fully cyclic group instead of losing the whole canvas.
 for(const r of roots)if(candidates.has(r)&&!roots.some(other=>other!==r&&!candidates.has(other)&&sets.get(other).has(r))){
  const cycles=roots.filter(other=>other===r||sets.get(r).has(other)&&sets.get(other)?.has(r));
  if(cycles.length>1&&r===[...cycles].sort()[0])visible.add(r);
 }
 const queue=[...visible];for(let i=0;i<queue.length;i++){const id=queue[i];if(roots.includes(id))continue;for(const next of adj.get(id)||[])if(!visible.has(next)){visible.add(next);queue.push(next);}}
 const hidden=new Set(page.nodes.filter(n=>!visible.has(n.id)).map(n=>n.id)),owner=new Map();
 const activeRoots=roots.filter(id=>visible.has(id));
 // A hidden node belongs to the first visible collapsing ancestor for movement/proxy endpoints.
 for(const r of activeRoots)for(const id of sets.get(r))if(hidden.has(id)&&!owner.has(id))owner.set(id,r);
 return {visible,hidden,owner,sets,roots:activeRoots};
}
function display(page,collapsed=new Set(),compact=true,folded=new Set()){
 // Legacy containers remain a compatibility option. Node-driven collapse is the default.
 if(page.collapseMode==='groups'||!page.collapseMode&&(page.groups||[]).length&&!page.nodes.some(n=>n.collapsible))return old.display(page,collapsed,compact,folded);
 const state=collapseState(page,collapsed),map=new Map(),nodes=[];
 for(const n of page.nodes){if(state.hidden.has(n.id)){map.set(n.id,state.owner.get(n.id));continue;}const v=effective(n);if(n.table){v.h=folded.has(n.id)?74:tableMetrics(v).total;v.tableFolded=folded.has(n.id);}v.hiddenCount=[...state.hidden].filter(id=>state.owner.get(id)===n.id).length;nodes.push(v);map.set(n.id,n.id);}
 if(compact){
  // Close vacant horizontal bands without changing column order or saved coordinates.
  const list=nodes.filter(n=>!n.anchorId).map(n=>[n.y,n.y+n.h]).sort((a,b)=>a[0]-b[0]),bands=[];
  for(const interval of list){const last=bands.at(-1);if(last&&interval[0]<=last[1]+30)last[1]=Math.max(last[1],interval[1]);else bands.push([...interval]);}
  for(const n of nodes){let cut=0;for(let i=1;i<bands.length;i++)if(n.y>=bands[i][0])cut+=Math.max(0,bands[i][0]-bands[i-1][1]-56);n.y-=cut;}
 }
 for(const n of nodes)if(n.anchorId){const host=nodes.find(x=>x.id===n.anchorId);if(host){n.x=host.x+(n.anchorX||0);n.y=host.y+(n.anchorY||0);}}
 const edges=[],edgeMap=new Map();
 for(const e of page.edges){const source=map.get(e.source),target=map.get(e.target);if(!source||!target||source===target&&e.source!==e.target)continue;
  // Hidden nodes cannot invent visible arrows along a collapsed chain.
  if(state.hidden.has(e.source)&&state.hidden.has(e.target))continue;
  const proxy=source!==e.source||target!==e.target;
  const key=proxy?[source,target,e.arrow!==false,e.dashed===true].join('|'):'edge:'+e.id;
  if(edgeMap.has(key)){const x=edgeMap.get(key);x.count++;x.originalIds.push(e.id);continue;}
  const v={...e,source,target,sourcePort:source===e.source?e.sourcePort:'right',targetPort:target===e.target?e.targetPort:'left',proxy,count:1,originalIds:[e.id]};
  edges.push(v);edgeMap.set(key,v);
 }
 return {nodes,edges,frames:[],map,hidden:state.hidden,hiddenOwner:state.owner,collapseState:state,buses:page.buses||[]};
}
function materializeLayout(page,d){
 if(page.collapseMode==='groups'||!page.collapseMode&&(page.groups||[]).length&&!page.nodes.some(n=>n.collapsible))return old.materializeLayout(page,d);
 const p=C.clone(page),shown=new Map(d.nodes.map(n=>[n.id,n])),original=new Map(page.nodes.map(n=>[n.id,effective(n)]));
 for(const n of p.nodes){if(n.anchorId)continue;const v=shown.get(n.id);if(v){n.x=v.x;n.y=v.y;n.offsetX=n.offsetY=0;}else{const r=d.hiddenOwner?.get(n.id),host=shown.get(r),base=original.get(r);if(host&&base){n.x+=(n.offsetX||0)+host.x-base.x;n.y+=(n.offsetY||0)+host.y-base.y;n.offsetX=n.offsetY=0;}}}
 return p;
}
function autoLayout(page,groupId){const p=old.autoLayout(page,groupId),before=new Map(page.nodes.map(n=>[n.id,n]));for(const n of p.nodes)if(n.locked)Object.assign(n,{x:before.get(n.id).x,y:before.get(n.id).y,offsetX:before.get(n.id).offsetX||0,offsetY:before.get(n.id).offsetY||0});return p;}
function arrange(page,ids,mode){return old.arrange(page,ids.filter(id=>!page.nodes.find(n=>n.id===id)?.locked),mode);}
function edgePath(e,ns){
 // The old router has pure coordinate logic. Resolve row ports to concrete geometry first.
 const resolve=n=>n?{...n,ports:ports(n)}:n;
 return old.edgePath(e,new Map([[e.source,resolve(ns.get(e.source))],[e.target,resolve(ns.get(e.target))]]));
}
function pathData(pts){const p=pts.filter((x,i)=>!i||Math.abs(x.x-pts[i-1].x)+Math.abs(x.y-pts[i-1].y)>.001);return {d:p.map((x,i)=>(i?'L':'M')+x.x+','+x.y).join(' '),points:p,x:(p[0].x+p.at(-1).x)/2,y:(p[0].y+p.at(-1).y)/2,controls:[]};}
function bundleRoutes(d){
 const ns=new Map(d.nodes.map(n=>[n.id,n])),routes=new Map(),buses=[];
 for(const e of d.edges){const route=edgePath(e,ns);if(route)routes.set(e.id,route);}
 for(const bus of d.buses||[]){
  const incoming=bus.mode==='in',hubId=bus.hub||bus.source,hub=ns.get(hubId);if(!hub)continue;
  const pid=bus.port||bus.sourcePort,anchor=endpoint(hub,pid,incoming?'left':'right');
  const es=d.edges.filter(e=>{if(e.bus!==bus.id||e.proxy||e[incoming?'target':'source']!==hubId)return false;const p=endpoint(hub,e[incoming?'targetPort':'sourcePort'],incoming?'left':'right');return p.side===anchor.side&&Math.abs(p.x-anchor.x)+Math.abs(p.y-anchor.y)<.01;});if(es.length<2)continue;
  const vertical=anchor.side==='left'||anchor.side==='right',sign=anchor.side==='left'||anchor.side==='top'?-1:1;
  const dist=Math.max(24,Math.abs(finite(bus.offset,70))),axis=(vertical?anchor.x:anchor.y)+sign*dist;
  const entries=[];
  for(const e of es){const other=ns.get(incoming?e.source:e.target);if(!other)continue;const tip=endpoint(other,incoming?e.sourcePort:e.targetPort,incoming?'right':'left');
   const vector={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]}[tip.side],stub={x:tip.x+vector[0]*24,y:tip.y+vector[1]*24};
   const join=vertical?{x:axis,y:stub.y}:{x:stub.x,y:axis};
   const pts=incoming?[tip,stub,join]:[join,stub,tip];const path=pathData(pts);routes.set(e.id,{...path,bus:bus.id,busIncoming:incoming});entries.push({join,edge:e});
  }
  if(entries.length<2)continue;
  const center=vertical?{x:axis,y:anchor.y}:{x:anchor.x,y:axis};
  const values=[vertical?center.y:center.x,...entries.map(x=>vertical?x.join.y:x.join.x)],lo=Math.min(...values),hi=Math.max(...values);
  const trunk=vertical?pathData([{x:axis,y:lo},{x:axis,y:hi}]):pathData([{x:lo,y:axis},{x:hi,y:axis}]);
  const lead=pathData(incoming?[center,anchor]:[anchor,center]);
  buses.push({id:bus.id,mode:incoming?'in':'out',hubId,vertical,axis,anchor,center,lead,trunk,handle:vertical?{x:axis,y:(lo+hi)/2}:{x:(lo+hi)/2,y:axis},arrow:incoming&&es.some(e=>e.arrow),dashed:es.every(e=>e.dashed),entries});
 }
 return {routes,buses};
}
function combineEdges(page,ids,mode='out'){
 const p=C.clone(page),es=p.edges.filter(e=>ids.includes(e.id));if(es.length<2)throw Error('Для гребёнки выберите минимум две связи');
 const incoming=mode==='in',key=incoming?'target':'source',portKey=incoming?'targetPort':'sourcePort',hub=es[0][key],hubNode=p.nodes.find(n=>n.id===hub),p0=port(hubNode,es[0][portKey],incoming?'left':'right');
 if(es.some(e=>e[key]!==hub||(()=>{const x=port(hubNode,e[portKey],incoming?'left':'right');return x.side!==p0.side||Math.abs(x.x-p0.x)+Math.abs(x.y-p0.y)>.01;})()))throw Error('У гребёнки должен быть один общий выход или один общий вход');
 p.buses=p.buses||[];const id=C.uid('bus');p.buses.push({id,mode:incoming?'in':'out',hub,port:es[0][portKey],offset:70,title:'Общая линия'});es.forEach(e=>e.bus=id);p.buses=p.buses.filter(b=>p.edges.filter(e=>e.bus===b.id).length>=2);return p;
}
function normalizeV3(p){
 const was=p.schemaVersion||1;p.schemaVersion=3;p.settings={autoBus:true,...p.settings};
 for(const pg of p.pages){pg.buses=pg.buses||[];pg.collapseMode=pg.collapseMode||'nodes';const nodeIds=new Set();for(const n of pg.nodes){if(!n.id||nodeIds.has(n.id))throw Error('Повторяется ID блока');nodeIds.add(n.id);initTable(n);if(n.table)n.h=tableMetrics(n).total;n.locked=!!n.locked;}
  for(const e of pg.edges){if(!nodeIds.has(e.source)||!nodeIds.has(e.target))throw Error('Связь указывает на отсутствующий блок');}
  if(was<3){
   // Mark the entry blocks of old named sections. Membership is NOT the collapse criterion.
   for(const g of pg.groups||[]){const ids=new Set(g.members);const entries=pg.nodes.filter(n=>ids.has(n.id)&&pg.edges.some(e=>e.target===n.id&&!ids.has(e.source)&&e.arrow!==false));
    for(const n of entries)if(n.collapsible===undefined)n.collapsible=true;
   }
  }
  for(const n of pg.nodes)n.collapsible=!!n.collapsible;
 }
 return p;
}
Object.assign(C,{tableMetrics,initTable,ports,port,endpoint,visiblePorts,tableAxis,graph,descendants,collapseState,display,materializeLayout,autoLayout,arrange,edgePath,bundleRoutes,combineEdges,normalizeV3});
})(globalThis);
/* 0.4 — presentation-safe folding, branch envelopes, editing snaps and extendable buses.
 * Model geometry is never overwritten by display(). All graph decisions use stable IDs.
 * A note is a contextual attachment, not an alternate process entry, unless flowNode=true
 * or the edge explicitly has role='flow'. Its drawn arrow is never reversed.
 */
(function(root){
'use strict';
const C=root.Core, prior={...C};
const effective=n=>({...n,x:n.x+(n.offsetX||0),y:n.y+(n.offsetY||0)});
function graph(pg){
 const byId=new Map(pg.nodes.map(n=>[n.id,n])),adj=new Map(pg.nodes.map(n=>[n.id,[]])),incoming=new Map(pg.nodes.map(n=>[n.id,[]]));
 const add=(a,b)=>{if(a!==b&&!adj.get(a).includes(b)){adj.get(a).push(b);incoming.get(b).push(a);}};
 for(const e of pg.edges){const source=byId.get(e.source),target=byId.get(e.target);if(!source||!target)continue;
  if(C.edgeRelationship){const r=C.edgeRelationship(pg,e);if(r)add(r.parent,r.child);}
  else if(e.flow!==false){const sn=source.type==='note'&&!source.flowNode,tn=target.type==='note'&&!target.flowNode;if(e.role!=='flow'&&sn!==tn)add(sn?target.id:source.id,sn?source.id:target.id);else add(source.id,target.id);}
 }
 for(const n of pg.nodes)if(n.anchorId&&byId.has(n.anchorId))add(n.anchorId,n.id);
 return {byId,adj,incoming};
}
function descendants(pg,id,g=graph(pg)){
 const seen=new Set(),stack=[...(g.adj.get(id)||[])];
 while(stack.length){const next=stack.pop();if(next===id||seen.has(next)||g.byId.get(next)?.collapseBoundary)continue;seen.add(next);stack.push(...(g.adj.get(next)||[]));}
 return seen;
}
function collapseState(pg,collapsed=new Set()){
 const g=graph(pg),roots=pg.nodes.filter(n=>n.collapsible&&collapsed.has(n.id)).map(n=>n.id),rootSet=new Set(roots),sets=new Map(),candidates=new Set();
 for(const id of roots){const ds=descendants(pg,id,g);sets.set(id,ds);for(const x of ds)candidates.add(x);}
 const visible=new Set(pg.nodes.filter(n=>!candidates.has(n.id)).map(n=>n.id));
 // Keep one root in a cycle without leaking the whole cycle or depending on list order.
 for(const r of roots)if(candidates.has(r)&&!roots.some(o=>o!==r&&!candidates.has(o)&&sets.get(o).has(r))){
  const cycle=roots.filter(o=>o===r||sets.get(r).has(o)&&sets.get(o)?.has(r));
  if(r===[...cycle].sort()[0])visible.add(r);
 }
 const queue=[...visible];for(let i=0;i<queue.length;i++){const id=queue[i];if(rootSet.has(id))continue;for(const next of g.adj.get(id)||[])if(!visible.has(next)){visible.add(next);queue.push(next);}}
 const hidden=new Set(pg.nodes.filter(n=>!visible.has(n.id)).map(n=>n.id)),active=roots.filter(id=>visible.has(id)),owner=new Map(),owners=new Map();
 for(const r of active)for(const id of sets.get(r))if(hidden.has(id)){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(r);if(!owner.has(id))owner.set(id,r);}
 return {visible,hidden,owner,owners,sets,roots:active,graph:g};
}
const intersects=(a,b,gap=0)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
/** Structural top-level branch envelopes; a shared downstream stage joins its owning branches.
 * This is layout-only, and has no influence on what is collapsed. */
function layoutUnits(pg){
 const g=graph(pg),heads=pg.nodes.filter(n=>n.collapsible&&!n.anchorId),sets=new Map(heads.map(n=>[n.id,descendants(pg,n.id,g)]));
 const top=heads.filter(n=>!heads.some(o=>o.id!==n.id&&sets.get(o.id).has(n.id)&&(!sets.get(n.id).has(o.id)||o.id<n.id)));
 if(!top.length)return [{id:'all',heads:[],members:new Set(pg.nodes.map(n=>n.id)),rank:Math.min(0,...pg.nodes.map(n=>n.y))}];
 const parent=new Map(top.map(n=>[n.id,n.id]));
 const find=x=>{while(parent.get(x)!==x){parent.set(x,parent.get(parent.get(x)));x=parent.get(x);}return x;};
 const membership=new Map();
 for(const n of top)for(const id of [n.id,...sets.get(n.id)]){
  // Shared annotations must not fuse otherwise independent branch envelopes.
  if(['note','comment'].includes(g.byId.get(id)?.type))continue;
  if(membership.has(id)){const a=find(n.id),b=find(membership.get(id));if(a!==b)parent.set(b,a);}else membership.set(id,n.id);
 }
 const units=new Map();for(const n of top){const id=find(n.id);if(!units.has(id))units.set(id,{id,heads:[],members:new Set(),rank:Infinity});const u=units.get(id);u.heads.push(n.id);u.rank=Math.min(u.rank,n.y+(n.offsetY||0));for(const x of [n.id,...sets.get(n.id)])u.members.add(x);}
 const ordered=[...units.values()].sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id));const used=new Set();
 for(const u of ordered)for(const id of [...u.members]){if(used.has(id))u.members.delete(id);else used.add(id);}
 const extras=new Set(pg.nodes.filter(n=>!used.has(n.id)).map(n=>n.id)),outside=new Set();
 // Entire disconnected components are independent layout bands too. Common
 // upstream parents touching an existing branch remain outside those bands.
 while(extras.size){const first=extras.values().next().value,members=new Set(),stack=[first];let attached=false;
  while(stack.length){const id=stack.pop();if(!extras.delete(id))continue;members.add(id);for(const k of [...g.adj.get(id),...g.incoming.get(id)]){if(used.has(k))attached=true;else if(extras.has(k))stack.push(k);}}
  if(attached)for(const id of members)outside.add(id);else ordered.push({id:'component:'+first,heads:[],members,rank:Math.min(...[...members].map(id=>effective(g.byId.get(id)).y))});
 }
 ordered.sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id));
 if(outside.size)ordered.push({id:'outside',heads:[],members:outside,rank:Infinity,outside:true});
 return ordered;
}
/** Preserve x and resolve rectangle collisions. Only compaction packs branch envelopes.
 * Locked rectangles are immovable obstacles. Remaining lock/lock conflicts are reported.
 */
function spaceBranches(pg,nodes,compact,options={}){
 const raw=new Map(pg.nodes.map(n=>[n.id,effective(n)])),shown=new Map(nodes.map(n=>[n.id,n])),offsets=new Map(pg.nodes.map(n=>[n.id,{x:0,y:0}]));
 const conflicts=[];if(options.autoSpace===false&&!compact)return {offsets,conflicts,units:[]};
 const units=layoutUnits(pg),gap=Number.isFinite(options.branchGap)?Math.max(24,options.branchGap):64;
 const annotation=n=>n.type==='comment'||n.type==='note'&&!n.flowNode;const forkOffsets=new Map(),g=graph(pg);const locked=nodes.filter(n=>n.locked&&!n.anchorId&&!annotation(n));const placed=[...locked];
 function packForks(list){
  if(!compact||!options.hidden?.size)return;
  const local=new Set(list.map(n=>n.id));
  // Folded inner branches shrink before their outer envelope is packed.
  const parents=list.filter(n=>!n.table&&n.type!=='decision'&&!annotation(n)).sort((a,b)=>descendants(pg,a.id,g).size-descendants(pg,b.id,g).size);
  for(const parent of parents){const all=descendants(pg,parent.id,g);if(![...all].some(id=>options.hidden.has(id)))continue;
   const links=pg.edges.filter(e=>e.source===parent.id&&C.edgeRelationship(pg,e)?.parent===parent.id&&!C.edgeRelationship(pg,e)?.annotation),heads=[...new Set(links.map(e=>e.target))].map(id=>shown.get(id)).filter(n=>n&&local.has(n.id));
   if(heads.length<2||heads.some(n=>n.x<parent.x+parent.w))continue;
   const branches=heads.map(n=>({n,ids:new Set([n.id,...descendants(pg,n.id,g)])})),counts=new Map();for(const b of branches)for(const id of b.ids)counts.set(id,(counts.get(id)||0)+1);
   for(const b of branches)b.ids=new Set([...b.ids].filter(id=>counts.get(id)===1&&id!==parent.id));
   if(branches.some(b=>[...b.ids].some(id=>{const n=shown.get(id);return n?.locked&&!annotation(n)})))continue;
   const bounds=b=>C.bounds([...b.ids].map(id=>shown.get(id)).filter(n=>n&&!n.anchorId&&!annotation(n)));
   branches.sort((a,b)=>bounds(a).y-bounds(b).y);let cursor=null;
   for(const b of branches){const box=bounds(b),dy=cursor===null?0:cursor-box.y;
    if(dy)for(const id of b.ids){const n=shown.get(id);if(n&&!n.locked&&!n.anchorId)n.y+=dy;if(!g.byId.get(id)?.locked)forkOffsets.set(id,(forkOffsets.get(id)||0)+dy);}
    cursor=box.y+dy+box.h+gap;
   }
  }
 }
 function resolve(list){
  packForks(list);
  const anchors=list.filter(n=>!n.anchorId&&!annotation(n)),local=anchors.filter(n=>n.locked);
  const loose=anchors.filter(n=>!n.locked).sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id));
  for(const n of loose){if(options.autoSpace!==false){for(let pass=0;pass<=local.length;pass++){const hits=local.filter(q=>intersects(n,q,compact?18:0));if(!hits.length)break;n.y=Math.max(...hits.map(q=>q.y+q.h))+24;}}local.push(n);}
 }
 let cursor=null;
 for(const unit of units.filter(u=>!u.outside)){
  const list=[...unit.members].map(id=>shown.get(id)).filter(Boolean);if(!list.length)continue;resolve(list);
  let bb=C.bounds(list.filter(n=>!n.anchorId&&!annotation(n)).length?list.filter(n=>!n.anchorId&&!annotation(n)):list);let shift=cursor===null||!compact?0:cursor-bb.y;
  if(options.autoSpace===false&&!compact)shift=0;
  if(list.some(n=>n.locked&&!annotation(n)))shift=0;
  if(shift)for(const n of list)if(!n.locked&&!n.anchorId)n.y+=shift;
  // Avoid fixed obstacles / previous envelopes with intersecting columns.
  if(options.autoSpace!==false){
   if(!compact){
    // Shared drawing bands are independent of movement ownership: only
    // colliding blocks move in free placement, never their entire band.
    for(const n of list)if(!n.locked&&!n.anchorId&&!annotation(n))for(let pass=0;pass<=placed.length;pass++){const hits=placed.filter(q=>q.id!==n.id&&intersects(n,q));if(!hits.length)break;n.y=Math.max(...hits.map(q=>q.y+q.h))+24;}
   }else for(let pass=0;pass<=placed.length;pass++){
    let dy=0;for(const n of list)if(!n.locked&&!n.anchorId&&!annotation(n))for(const q of placed)if(q.id!==n.id&&intersects(n,q,18))dy=Math.max(dy,q.y+q.h+24-n.y);
    if(dy<=0)break;for(const n of list)if(!n.locked&&!n.anchorId)n.y+=dy;shift+=dy;
   }
  }
  bb=C.bounds(list.filter(n=>!n.anchorId&&!annotation(n)).length?list.filter(n=>!n.anchorId&&!annotation(n)):list);cursor=cursor===null?bb.y+bb.h+gap:Math.max(cursor,bb.y+bb.h+gap);
  // Hidden contents move with their own envelope, not with an arbitrary sibling root.
  for(const id of unit.members){const n=raw.get(id);if(n&&!n.locked)offsets.set(id,{x:0,y:shift+(forkOffsets.get(id)||0)});}
  for(const n of list)if(!n.locked&&!n.anchorId&&!annotation(n))placed.push(n);
 }
 const outside=units.find(u=>u.outside);if(outside&&options.autoSpace!==false){
  for(const id of outside.members){const n=shown.get(id);if(!n||n.locked||n.anchorId||annotation(n))continue;
   // A fan-out parent follows the centre of its visible direct destinations in auto layout.
   const targets=(graph(pg).adj.get(id)||[]).map(k=>shown.get(k)).filter(Boolean);
   if(compact&&targets.length>1&&targets.every(t=>t.x>n.x+n.w))n.y=(Math.min(...targets.map(t=>t.y+t.h/2))+Math.max(...targets.map(t=>t.y+t.h/2)))/2-n.h/2;
   for(let i=0;i<=placed.length;i++){const hit=placed.filter(q=>q.id!==id&&intersects(n,q,compact?18:0));if(!hit.length)break;n.y=Math.max(...hit.map(q=>q.y+q.h))+24;}placed.push(n);
  }
 }
 for(const n of nodes){const r=raw.get(n.id);if(r&&!n.anchorId)offsets.set(n.id,{x:n.x-r.x,y:n.y-r.y});}
 for(let i=0;i<locked.length;i++)for(let j=i+1;j<locked.length;j++)if(intersects(locked[i],locked[j]))conflicts.push([locked[i].id,locked[j].id]);
 return {offsets,conflicts,units};
}
function display(pg,collapsed=new Set(),compact=true,folded=new Set(),options={}){
 if(pg.collapseMode==='groups'||!pg.collapseMode&&(pg.groups||[]).length&&!pg.nodes.some(n=>n.collapsible))return prior.display(pg,collapsed,compact,folded);
 options={...(pg.layoutOptions||{}),...options};const state=collapseState(pg,collapsed),map=new Map(),nodes=[];
 const rowState=options.collapsedRows?.size&&C.rowCollapseState?C.rowCollapseState(pg,options.collapsedRows,collapsed):null;
 if(rowState)for(const id of rowState.hidden){state.hidden.add(id);state.visible.delete(id);state.owner.set(id,rowState.owner.get(id));}
 for(const n of pg.nodes){if(state.hidden.has(n.id)){map.set(n.id,state.owner.get(n.id));continue;}
  const v=effective(n);if(n.table){v.h=folded.has(n.id)?74+(C.tableMetrics(v).footer||0):C.tableMetrics(v).total;v.tableFolded=folded.has(n.id);}
  const ds=state.sets.get(n.id)||new Set();v.hiddenCount=[...ds].filter(id=>state.hidden.has(id)).length;v.sharedVisibleCount=[...ds].filter(id=>state.visible.has(id)).length;
  nodes.push(v);map.set(n.id,n.id);
 }
 const layout=spaceBranches(pg,nodes,compact,{...options,hidden:state.hidden});
 for(const n of nodes)if(n.anchorId){const host=nodes.find(x=>x.id===n.anchorId);if(host){n.x=host.x+(n.anchorX||0);n.y=host.y+(n.anchorY||0);}}
 const edges=[],dedupe=new Map();for(const e of pg.edges){const sh=state.hidden.has(e.source),th=state.hidden.has(e.target);if(sh&&th)continue;
  const source=map.get(e.source),target=map.get(e.target);if(!source||!target||(source===target&&e.source!==e.target))continue;
  // Never redirect one folded root to another root merely because they share hidden descendants.
  if(th&&state.roots.includes(e.source)&&state.sets.get(e.source)?.has(e.target))continue;
  if(sh&&state.roots.includes(e.target)&&state.sets.get(e.target)?.has(e.source))continue;
  const proxy=sh||th,key=proxy?[source,target,e.arrow!==false,e.dashed===true,e.flow===false].join('|'):'edge:'+e.id;
  if(dedupe.has(key)){const out=dedupe.get(key);out.count++;out.originalIds.push(e.id);continue;}
  const rowOwner=sh&&rowState?.owners.get(e.source),rowNode=rowOwner?.row&&pg.nodes.find(n=>n.id===source),rowPort=rowNode&&C.ports(rowNode).find(p=>p.rowId===rowOwner.row&&p.side==='right');
  const out={...e,source,target,sourcePort:sh?(rowPort?.id||'right'):e.sourcePort,targetPort:th?'left':e.targetPort,proxy,count:1,originalIds:[e.id]};
  if(proxy){delete out.waypoints;delete out.points;delete out.bus;}edges.push(out);dedupe.set(key,out);
 }
 return {nodes,edges,frames:[],map,hidden:state.hidden,hiddenOwner:state.owner,collapseState:state,buses:pg.buses||[],layoutOffsets:layout.offsets,layoutConflicts:layout.conflicts,units:layout.units};
}
function materializeLayout(pg,d){
 if(!d.layoutOffsets)return prior.materializeLayout(pg,d);
 const p=C.clone(pg),shown=new Map(d.nodes.map(n=>[n.id,n]));
 for(const n of p.nodes){if(n.anchorId||n.locked)continue;const v=shown.get(n.id),delta=d.layoutOffsets.get(n.id)||{x:0,y:0};n.x=v?v.x:n.x+(n.offsetX||0)+delta.x;n.y=v?v.y:n.y+(n.offsetY||0)+delta.y;n.offsetX=n.offsetY=0;}
 return p;
}
function movementSet(pg,selected,options={}){
 const wanted=new Set([...selected].filter(id=>pg.nodes.some(n=>n.id===id))),g=graph(pg);
 if(options.descendants){
  const ds=new Set();for(const id of wanted)for(const next of descendants(pg,id,g))ds.add(next);
  if(options.shared)for(const id of ds)wanted.add(id);
  else {const test={...pg,nodes:pg.nodes.map(n=>({...n,collapsible:wanted.has(n.id)}))},hidden=collapseState(test,wanted).hidden;for(const id of hidden)wanted.add(id);}
 }
 if(options.hiddenOwner)for(const [id,owner] of options.hiddenOwner)if(wanted.has(owner))wanted.add(id);
 for(let pass=0;pass<2;pass++)for(const n of pg.nodes)if(n.anchorId&&wanted.has(n.anchorId))wanted.add(n.id);
 return new Set([...wanted].filter(id=>!g.byId.get(id)?.locked));
}
function samePort(n,a,b,fallback='right'){const p=C.port(n,a,fallback),q=C.port(n,b,fallback);return p.side===q.side&&Math.abs(p.x-q.x)+Math.abs(p.y-q.y)<.005;}
function busCandidates(pg,ids){const edges=pg.edges.filter(e=>ids.includes(e.id));if(!edges.length)return[];return ['out','in'].flatMap(mode=>{const incoming=mode==='in',key=incoming?'target':'source',pk=incoming?'targetPort':'sourcePort',hub=edges[0][key],n=pg.nodes.find(n=>n.id===hub);if(!n||edges.some(e=>e[key]!==hub||!samePort(n,e[pk],edges[0][pk],incoming?'left':'right')))return[];return [{mode,hub,port:edges[0][pk],title:n.title,count:pg.edges.filter(e=>e[key]===hub&&samePort(n,e[pk],edges[0][pk],incoming?'left':'right')).length}];});}
function combineEdges(pg,ids,mode='out'){
 const candidate=busCandidates(pg,ids).find(c=>c.mode===mode);if(!candidate||ids.length<2)throw Error('Нужны минимум две связи, имеющие общий порт');
 const p=C.clone(pg),hub=p.nodes.find(n=>n.id===candidate.hub);p.buses=p.buses||[];
 let bus=p.buses.find(b=>b.mode===mode&&b.hub===candidate.hub&&samePort(hub,b.port,candidate.port,mode==='in'?'left':'right'));
 if(!bus){bus={id:C.uid('bus'),mode,hub:candidate.hub,port:candidate.port,offset:70,title:'Общая линия'};p.buses.push(bus);}
 for(const e of p.edges)if(ids.includes(e.id))e.bus=bus.id;
 p.buses=p.buses.filter(b=>p.edges.filter(e=>e.bus===b.id).length>=2);return p;
}
function joinBus(pg,id,edgeIds){
 const p=C.clone(pg),b=p.buses?.find(x=>x.id===id);if(!b)throw Error('Гребёнка не найдена');const incoming=b.mode==='in',key=incoming?'target':'source',pk=incoming?'targetPort':'sourcePort',n=p.nodes.find(n=>n.id===b.hub);
 for(const id of edgeIds){const e=p.edges.find(e=>e.id===id);if(!e||e[key]!==b.hub||!samePort(n,e[pk],b.port,incoming?'left':'right'))throw Error('У добавляемых связей должен быть тот же общий порт');e.bus=b.id;}
 p.buses=p.buses.filter(x=>p.edges.filter(e=>e.bus===x.id).length>=2);return p;
}
function bundleRoutes(d){const out=prior.bundleRoutes(d);for(const b of out.buses){
 // The drag marker is at the physical intersection of lead and trunk, not mid-spine.
 b.handle={...b.center};b.commonPort=(d.buses||[]).find(x=>x.id===b.id)?.port;
 }return out;}
/** Snap a dragged anchor to geometry in *screen*-constant tolerance; no mutation. */
function snapMove(nodes,ids,anchorId,dx,dy,zoom=1,mode={},axis=null){
 const moving=new Set(ids),a=nodes.find(n=>n.id===anchorId);if(!a)return {dx,dy,guides:[]};
 const tolerance=8/Math.max(.05,zoom),candidates={x:[],y:[]},others=nodes.filter(n=>!moving.has(n.id)&&!n.anchorId);
 const propose=(axis,own,value,n,kind)=>{const delta=value-own;if(Math.abs(delta)<=tolerance)candidates[axis].push({delta,value,n,kind});};
 for(const b of others){
  if(mode.edges){for(const v of [a.x+dx,a.x+a.w+dx])for(const t of [b.x,b.x+b.w])propose('x',v,t,b,'edge');for(const v of [a.y+dy,a.y+a.h+dy])for(const t of [b.y,b.y+b.h])propose('y',v,t,b,'edge');}
  if(mode.centers){propose('x',a.x+a.w/2+dx,b.x+b.w/2,b,'center');propose('y',a.y+a.h/2+dy,b.y+b.h/2,b,'center');}
  if(mode.ports){for(const pa of C.visiblePorts(a))for(const pb of C.visiblePorts(b)){
   const av={x:a.x+a.w*pa.x+dx,y:a.y+a.h*pa.y+dy},bv={x:b.x+b.w*pb.x,y:b.y+b.h*pb.y};
   if(['left','right'].includes(pa.side)&&['left','right'].includes(pb.side))propose('y',av.y,bv.y,b,'port');
   if(['top','bottom'].includes(pa.side)&&['top','bottom'].includes(pb.side))propose('x',av.x,bv.x,b,'port');
  }}
 }
 const guides=[];for(const coord of ['x','y']){if(axis&&coord!==axis)continue;const chosen=candidates[coord].sort((x,y)=>Math.abs(x.delta)-Math.abs(y.delta))[0];
  if(chosen){if(coord==='x')dx+=chosen.delta;else dy+=chosen.delta;guides.push({axis:coord,value:chosen.value,kind:chosen.kind,from:chosen.n.id,to:anchorId});}
  else if(mode.grid){const step=Math.max(2,Math.min(500,Number(mode.gridSize)||20));if(coord==='x')dx=Math.round((a.x+dx)/step)*step-a.x;else dy=Math.round((a.y+dy)/step)*step-a.y;}
 }
 return {dx,dy,guides};
}
function normalizeV4(p){prior.normalizeV3(p);p.schemaVersion=4;p.settings={autoSpace:true,...p.settings};for(const pg of p.pages){pg.layoutOptions={autoSpace:p.settings.autoSpace,...pg.layoutOptions};}return p;}
Object.assign(C,{graph,descendants,collapseState,layoutUnits,spaceBranches,display,materializeLayout,movementSet,samePort,busCandidates,combineEdges,joinBus,bundleRoutes,snapMove,normalizeV4});
})(globalThis);

/* 0.5 — one bus entity, isolated component layouts and folded-branch movement.
 * A bus groups the drawing of existing edge pairs; it NEVER invents graph edges.
 * The geometry stored on a connection is independent of its arrow and flow flags.
 */
(function(root){
'use strict';
const C=root.Core,prev={...C},finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const vec={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
function tableMetrics(n){
 // Port geometry and routing must use the same live metrics as rendered tables.
 // Newer model versions replace Core.tableMetrics; do not retain the old estimate.
 if(n.table&&C.tableMetrics!==tableMetrics)return C.tableMetrics(n);
 const m=prev.tableMetrics(n);if(!n.table)return m;
 const dataBottom=m.header+m.heights.reduce((a,b)=>a+b,0),footer=(n.materials||[]).length?40:0;
 return {...m,dataBottom,footer,total:dataBottom+footer+3};
}
function ports(n){
 if(n._resizePorts)return n._resizePorts;
 const ps=prev.ports(n).map(p=>({...p}));
 if(n.table){const m=tableMetrics(n),height=n.h||m.total;
  for(const p of ps){
   if(p.rowId){const i=n.table.rowIds?.indexOf(p.rowId);p.y=i>=0?m.centers[i]/height:.5;p.x=p.side==='left'?0:1;}
   else if(['left','right'].includes(p.side)&&!p.customPosition){
    // Imported legacy body aliases and the visible '+' use exactly one anchor.
    p.x=p.side==='left'?0:1;p.y=(n.tableBodyPosition==='header'?m.header/2:(n.tableFolded?37:m.dataBottom/2))/height;
   }
  }
 }
 if(n.type==='decision')for(const p of ps){
  if(p.side==='left')p.x=Math.abs(2*p.y-1)/2;
  if(p.side==='right')p.x=1-Math.abs(2*p.y-1)/2;
  if(p.side==='top')p.y=Math.abs(2*p.x-1)/2;
  if(p.side==='bottom')p.y=1-Math.abs(2*p.x-1)/2;
 }
 return ps;
}
function port(n,id,fallback='right'){return ports(n||{}).find(p=>p.id===id)||ports(n||{}).find(p=>p.id===fallback)||{id:fallback,side:fallback,x:fallback==='left'?0:1,y:.5};}
function endpoint(n,id,fallback='right'){const p=port(n,id,fallback);return {x:n.x+n.w*p.x,y:n.y+n.h*p.y,side:p.side};}
function samePort(n,a,b,fallback='right'){const p=port(n,a,fallback),q=port(n,b,fallback);return p.side===q.side&&Math.abs(p.x-q.x)+Math.abs(p.y-q.y)<.005;}
function visiblePorts(n,edges=[]){
 let ps=ports(n),cfg=n.portConfig||(n.table?{body:['left'],rows:['right']}:{body:['left','right','top','bottom']});
 ps=ps.filter(p=>p.rowId?!!n.table&&!n.tableFolded&&(n.table.rowIds||[]).includes(p.rowId)&&(cfg.rows||[]).includes(p.side):(cfg.body||[]).includes(p.side)&&(!n.table||p.id===p.side));
 const result=[];for(const p of ps){if(result.some(q=>samePort(n,q.id,p.id)))continue;
  p.occupied=edges.some(e=>e.source===n.id&&samePort(n,e.sourcePort,p.id,'right')||e.target===n.id&&samePort(n,e.targetPort,p.id,'left'));result.push(p);
 }return result;
}
function components(pg){const map=new Map(pg.nodes.map(n=>[n.id,[]]));
 const link=(a,b)=>{if(map.has(a)&&map.has(b)){map.get(a).push(b);map.get(b).push(a);}};
 for(const e of pg.edges)link(e.source,e.target);for(const n of pg.nodes)if(n.anchorId)link(n.id,n.anchorId);
 const seen=new Set(),out=[];for(const n of pg.nodes){if(seen.has(n.id))continue;const q=[n.id],ids=new Set();while(q.length){const id=q.pop();if(seen.has(id))continue;seen.add(id);ids.add(id);q.push(...map.get(id));}out.push(ids);}return out;
}
function display(pg,folds=new Set(),compact=true,folded=new Set(),options={}){
 if(pg.collapseMode==='groups')return prev.display(pg,folds,compact,folded,options);
 const pieces=components(pg);if(pieces.length<=1)return prev.display(pg,folds,compact,folded,options);
 // Unconnected blocks and components never become obstacles for another process.
 const out={nodes:[],edges:[],frames:[],map:new Map(),hidden:new Set(),hiddenOwner:new Map(),buses:pg.buses||[],layoutOffsets:new Map(),layoutConflicts:[],units:[]};
 for(const ids of pieces){const part={...pg,nodes:pg.nodes.filter(n=>ids.has(n.id)),edges:pg.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
  const d=prev.display(part,folds,compact,folded,options);
  for(const k of ['nodes','edges','frames','layoutConflicts','units'])out[k].push(...(d[k]||[]));
  for(const k of ['map','hiddenOwner','layoutOffsets'])for(const [a,b] of d[k]||[])out[k].set(a,b);
  for(const id of d.hidden)out.hidden.add(id);
 }out.collapseState=C.collapseState(pg,folds);return out;
}
function dragPlan(pg,selection,folds=new Set(),mode={}){
 const selected=new Set(selection),automatic=new Set([...selected].filter(id=>folds.has(id)&&pg.nodes.find(n=>n.id===id)?.collapsible));
 let ids=new Set(selected),base={...pg,nodes:pg.nodes.map(n=>({...n,locked:false}))};
 if(mode.moveChain)ids=C.movementSet(base,selected,{descendants:true,shared:!!mode.shared});
 else if(automatic.size){
  const own=C.movementSet(base,automatic,{descendants:true,shared:false}),hidden=C.collapseState(pg,folds).hidden;
  for(const id of own)if(hidden.has(id)||automatic.has(id))ids.add(id);
 }
 // Attached artwork and images move once, through their host coordinate system.
 for(let i=0;i<pg.nodes.length;i++){let changed=false;for(const n of pg.nodes)if(n.anchorId&&ids.has(n.anchorId)&&!ids.has(n.id)){ids.add(n.id);changed=true;}if(!changed)break;}
 const locked=[...ids].filter(id=>pg.nodes.find(n=>n.id===id)?.locked);
 return {ids,automatic:automatic.size>0,locked};
}
function moveRouteObjects(pg,ids,dx,dy,base){
 const oldBus=new Map((base.buses||[]).map(b=>[b.id,b]));
 for(const b of pg.buses||[]){const old=oldBus.get(b.id);if(!old||!Number.isFinite(old.axis))continue;const es=base.edges.filter(e=>e.bus===b.id);if(es.length&&es.every(e=>ids.has(e.source)&&ids.has(e.target)))b.axis=old.axis+(b.orientation==='horizontal'?dy:dx);}
 for(const s of pg.drawings||[]){if(!s.anchor||!ids.has(s.anchor))continue;/* relative paths follow host automatically */}
}
function pathData(points,controls=[]){
 const ps=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>.001);
 if(!ps.length)return {d:'',points:[],controls,x:0,y:0};
 let half=ps.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-ps[i].x,p.y-ps[i].y),0)/2,m=ps[0];
 for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],d=Math.hypot(b.x-a.x,b.y-a.y);if(half<=d){const t=d?half/d:0;m={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};break;}half-=d;}
 return {d:ps.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),points:ps,controls,x:m.x,y:m.y};
}
function roundedPath(ps,radius=14){
 if(ps.length<3)return pathData(ps).d;let d=`M${ps[0].x},${ps[0].y}`;
 for(let i=1;i<ps.length-1;i++){const a=ps[i-1],b=ps[i],c=ps[i+1],l1=Math.hypot(b.x-a.x,b.y-a.y),l2=Math.hypot(c.x-b.x,c.y-b.y);if(!l1||!l2)continue;
  const r=Math.min(radius,l1/2,l2/2),p={x:b.x+(a.x-b.x)*r/l1,y:b.y+(a.y-b.y)*r/l1},q={x:b.x+(c.x-b.x)*r/l2,y:b.y+(c.y-b.y)*r/l2};
  d+=` L${p.x},${p.y} Q${b.x},${b.y} ${q.x},${q.y}`;
 }const z=ps.at(-1);return d+` L${z.x},${z.y}`;
}
function orthogonalize(ps){const out=[];for(const p of ps){const a=out.at(-1);if(a&&Math.abs(a.x-p.x)>.001&&Math.abs(a.y-p.y)>.001){const b=out.at(-2);out.push(b&&Math.abs(a.x-b.x)<.001?{x:a.x,y:p.y}:{x:p.x,y:a.y});}out.push({...p});}return out;}
function orthogonalPath(edge,ns){
 const a=ns.get(edge.source),b=ns.get(edge.target);if(!a||!b)return null;
 const s=endpoint(a,edge.sourcePort,'right'),t=endpoint(b,edge.targetPort,'left');
 const vectors={left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]},sv=vectors[s.side]||vectors.right,tv=vectors[t.side]||vectors.left,stub=24;
 const p={x:s.x+sv[0]*stub,y:s.y+sv[1]*stub},q={x:t.x+tv[0]*stub,y:t.y+tv[1]*stub},horizontal=v=>v.side==='left'||v.side==='right';
 let mids=[],controls=[];
 if(!edge.proxy&&edge.waypoints?.length){
  controls=edge.waypoints.map(w=>({x:s.x+w.dx,y:s.y+w.dy}));let last=p,hor=horizontal(s);
  for(const w of controls){mids.push(hor?{x:w.x,y:last.y}:{x:last.x,y:w.y},w);last=w;hor=!hor;}
  mids.push(horizontal(t)?{x:last.x,y:q.y}:{x:q.x,y:last.y});
 }else if(edge.source===edge.target){
  // Route a self-loop outside the node, retaining distinct fixed stubs.
  const x=a.x+a.w+52,y=a.y-52;
  if(s.side===t.side&&Math.abs(s.x-t.x)+Math.abs(s.y-t.y)<.1){
   const tangent={x:-sv[1]*52,y:sv[0]*52};mids=[{x:p.x+sv[0]*40,y:p.y+sv[1]*40},{x:p.x+sv[0]*40+tangent.x,y:p.y+sv[1]*40+tangent.y},{x:p.x+tangent.x,y:p.y+tangent.y}];
  }else {const left=a.x-52,top=a.y-52,right=a.x+a.w+52,bottom=a.y+a.h+52;
   const outer=z=>({x:z.side==='left'?left:z.side==='right'?right:z.x,y:z.side==='top'?top:z.side==='bottom'?bottom:z.y});
   const u=outer(s),v=outer(t);mids=[u];if(horizontal(s)===horizontal(t)){if(horizontal(s))mids.push({x:u.x,y:top},{x:v.x,y:top});else mids.push({x:right,y:u.y},{x:right,y:v.y});}else mids.push(horizontal(s)?{x:u.x,y:v.y}:{x:v.x,y:u.y});mids.push(v);
  }
 }else if(horizontal(s)&&horizontal(t)){
  if(s.side===t.side){const x=s.side==='right'?Math.max(p.x,q.x)+24:Math.min(p.x,q.x)-24;mids=[{x,y:p.y},{x,y:q.y}];}
  else if((s.side==='right'&&p.x>q.x)||(s.side==='left'&&p.x<q.x)){const y=Math.min(a.y,b.y)-48;mids=[{x:p.x,y},{x:q.x,y}];}
  else {const x=(p.x+q.x)/2;mids=[{x,y:p.y},{x,y:q.y}];}
 }else if(!horizontal(s)&&!horizontal(t)){
  if(s.side===t.side){const y=s.side==='bottom'?Math.max(p.y,q.y)+24:Math.min(p.y,q.y)-24;mids=[{x:p.x,y},{x:q.x,y}];}
  else if((s.side==='bottom'&&p.y>q.y)||(s.side==='top'&&p.y<q.y)){const x=Math.max(a.x+a.w,b.x+b.w)+48;mids=[{x,y:p.y},{x,y:q.y}];}
  else {const y=(p.y+q.y)/2;mids=[{x:p.x,y},{x:q.x,y}];}
 }else mids=[horizontal(s)?{x:q.x,y:p.y}:{x:p.x,y:q.y}];
 const pts=[s,p,...mids,q,t].filter((v,i,all)=>!i||Math.abs(v.x-all[i-1].x)+Math.abs(v.y-all[i-1].y)>.001);
 const length=pts.slice(1).reduce((acc,v,i)=>acc+Math.hypot(v.x-pts[i].x,v.y-pts[i].y),0);let left=length/2,mid=s;
 for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);if(left<=d){const f=d?left/d:0;mid={x:pts[i-1].x+(pts[i].x-pts[i-1].x)*f,y:pts[i-1].y+(pts[i].y-pts[i-1].y)*f};break;}left-=d;}
 return {d:pts.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),x:mid.x,y:mid.y,points:pts,controls};
}

function edgePath(e,ns){
 const a=ns.get(e.source),b=ns.get(e.target);if(!a||!b)return null;let r;
 if(e.manualRoute?.length&&!e.proxy){const s=endpoint(a,e.sourcePort,'right'),t=endpoint(b,e.targetPort,'left'),sv=vec[s.side],tv=vec[t.side];
  const inner=e.manualRoute.map(p=>({x:s.x+p.dx,y:s.y+p.dy}));
  r=pathData(orthogonalize([s,{x:s.x+sv.x*24,y:s.y+sv.y*24},...inner,{x:t.x+tv.x*24,y:t.y+tv.y*24},t]));
 }else r=orthogonalPath(e,ns);
 if(e.style==='wire')r.d=roundedPath(r.points);
 if(e.style==='straight')r=pathData([endpoint(a,e.sourcePort,'right'),endpoint(b,e.targetPort,'left')]);
 return r;
}
function saveManualRoute(e,points,s){const out={...e};out.manualRoute=points.slice(2,-2).map(p=>({dx:p.x-s.x,dy:p.y-s.y}));if(!out.manualRoute.length)out.manualRoute=points.slice(1,-1).map(p=>({dx:p.x-s.x,dy:p.y-s.y}));delete out.waypoints;delete out.manualRouteMode;return out;}
function moveEdgeSegment(e,ns,index,delta){
 if(e.bus)throw Error('У гребёнки перемещается общая линия. Для отдельного сегмента сначала выведите ветвь из гребёнки.');
 const route=C.edgePath({...e,style:'orthogonal'},ns),ps=route?.points?.map(p=>({...p}));
 if(!ps||index<1||index>=ps.length-2)throw Error('Выберите внутренний сегмент: концы закреплены за портами');
 const p=ps[index],q=ps[index+1],vertical=Math.abs(p.x-q.x)<.01,key=vertical?'x':'y';
 const fixedFirst={...ps[1]},fixedLast={...ps.at(-2)};p[key]+=delta;q[key]+=delta;
 if(index===ps.length-3)ps.splice(ps.length-1,0,fixedLast);if(index===1)ps.splice(1,0,fixedFirst);
 return saveManualRoute(e,orthogonalize(ps),ps[0]);
}
function busCandidates(pg,ids){return prev.busCandidates(pg,ids);}
function cleanBuses(p){p.buses=(p.buses||[]).filter(b=>p.edges.filter(e=>e.bus===b.id).length>=2);const ids=new Set(p.buses.map(b=>b.id));for(const e of p.edges)if(e.bus&&!ids.has(e.bus))delete e.bus;return p;}
function upgradeBus(p,b){const ids=p.edges.filter(e=>e.bus===b.id).map(e=>e.id),cs=busCandidates(p,ids);const valid=cs.find(c=>c.mode===b.mode&&c.hub===b.hub);if(!valid){b.mode='free';delete b.hub;delete b.port;b.orientation=b.orientation||'vertical';}else b.port=valid.port;return b;}
function combineEdges(pg,ids,requested='auto'){
 const selected=new Set(ids),busIds=new Set(pg.edges.filter(e=>selected.has(e.id)&&e.bus).map(e=>e.bus));for(const e of pg.edges)if(busIds.has(e.bus))selected.add(e.id);const unique=[...selected],es=pg.edges.filter(e=>selected.has(e.id));if(es.length<2)throw Error('Выберите минимум две связи');
 const p=C.clone(pg);p.buses=p.buses||[];const candidates=busCandidates(p,unique),choice=candidates.find(c=>c.mode===requested)||candidates[0];
 // Joining existing bus preserves its identity and geometry; no second entity type.
 const previousIds=[...new Set(es.map(e=>e.bus).filter(Boolean))];let b=previousIds.length===1?p.buses.find(b=>b.id===previousIds[0]):null;
 if(!b){b={id:C.uid('bus'),title:'Гребёнка',mode:choice?.mode||'free',orientation:'vertical',offset:70};if(choice){b.hub=choice.hub;b.port=choice.port;}p.buses.push(b);}
 for(const e of p.edges)if(unique.includes(e.id))e.bus=b.id;upgradeBus(p,b);return cleanBuses(p);
}
function joinBus(pg,id,edgeIds){const p=C.clone(pg),b=p.buses?.find(b=>b.id===id);if(!b)throw Error('Гребёнка не найдена');
 for(const id of new Set(edgeIds)){const e=p.edges.find(e=>e.id===id);if(!e)throw Error('Связь не найдена');e.bus=b.id;}
 upgradeBus(p,b);return cleanBuses(p);
}
function terminalTap(tip,axis,vertical,node){
 const v=vec[tip.side]||vec.right,projection=vertical?(axis-tip.x)*v.x:(axis-tip.y)*v.y,clearance=projection>0?Math.min(24,projection):24,stub={x:tip.x+v.x*clearance,y:tip.y+v.y*clearance};
 let join=vertical?{x:axis,y:stub.y}:{x:stub.x,y:axis},points=[tip,stub];
 // A fixed port must leave its block outward even if the spine is on the other
 // side. Bypass this terminal's rectangle; do not draw backwards through it.
 if(vertical&&((tip.side==='right'&&axis<=node.x+node.w)||(tip.side==='left'&&axis>=node.x))){
  const y=tip.y-node.y<=node.y+node.h-tip.y?node.y-24:node.y+node.h+24;
  join={x:axis,y};points.push({x:stub.x,y},join);
 }else if(!vertical&&((tip.side==='bottom'&&axis<=node.y+node.h)||(tip.side==='top'&&axis>=node.y))){
  const x=tip.x-node.x<=node.x+node.w-tip.x?node.x-24:node.x+node.w+24;
  join={x,y:axis};points.push({x,y:stub.y},join);
 }else points.push(vertical?{x:join.x,y:stub.y}:{x:stub.x,y:join.y},join);
 return {join,...pathData(orthogonalize(points))};
}
function bundleRoutes(d){
 const ns=new Map(d.nodes.map(n=>[n.id,n])),routes=new Map(),buses=[];
 for(const e of d.edges){const path=C.edgePath(e,ns);if(path)routes.set(e.id,path);}
 for(const savedBus of d.buses||[]){const es=d.edges.filter(e=>e.bus===savedBus.id&&!e.proxy&&ns.has(e.source)&&ns.has(e.target));if(es.length<2)continue;
  const bus={...savedBus};
  if(bus.mode!=='free'){
   const incoming=bus.mode==='in',k=incoming?'target':'source',pk=k+'Port',h=ns.get(bus.hub);
   if(!h||es.some(e=>e[k]!==bus.hub||!samePort(h,e[pk],bus.port,incoming?'left':'right')))bus.mode='free';
  }
  const incoming=bus.mode==='in',hub=ns.get(bus.hub),shared=bus.mode!=='free'&&hub;
  if(shared){
   const anchor=endpoint(hub,bus.port,incoming?'left':'right'),vertical=['left','right'].includes(anchor.side),direction=['left','top'].includes(anchor.side)?-1:1,axis=(vertical?anchor.x:anchor.y)+direction*Math.max(24,Math.abs(finite(bus.offset,70)));
   const center=vertical?{x:axis,y:anchor.y}:{x:anchor.x,y:axis},entries=[];
   for(const e of es){const terminal=ns.get(incoming?e.source:e.target),tip=endpoint(terminal,incoming?e.sourcePort:e.targetPort,incoming?'right':'left'),tap=terminalTap(tip,axis,vertical,terminal),join=tap.join;
    const pts=tap.points,path=pathData(incoming?pts:[...pts].reverse());if(e.style==='wire'||bus.style==='wire')path.d=roundedPath(path.points);
    routes.set(e.id,{...path,bus:bus.id,busIncoming:incoming});entries.push({join,edge:e});
   }
   const values=[vertical?center.y:center.x,...entries.map(e=>vertical?e.join.y:e.join.x)],lo=Math.min(...values),hi=Math.max(...values),trunk=pathData(vertical?[{x:axis,y:lo},{x:axis,y:hi}]:[{x:lo,y:axis},{x:hi,y:axis}]),lead=pathData(incoming?[center,anchor]:[anchor,center]);
   buses.push({id:bus.id,mode:bus.mode,hubId:hub.id,vertical,axis,anchor,center,lead,trunk,handle:{...center},commonPort:bus.port,arrow:incoming&&es.some(e=>e.arrow),dashed:es.every(e=>e.dashed),entries});continue;
  }
  // Several sources and destinations share one spine. Keep source→target pairs.
  const vertical=bus.orientation!=='horizontal',terminals=new Map();
  const key=(n,p,fall)=>{const pt=endpoint(ns.get(n),p,fall);return n+'|'+pt.side+'|'+pt.x.toFixed(3)+'|'+pt.y.toFixed(3);};
  for(const e of es)for(const [role,n,p,fallback] of [['source',e.source,e.sourcePort,'right'],['target',e.target,e.targetPort,'left']]){const k=key(n,p,fallback);let t=terminals.get(k);if(!t){t={id:k,node:n,port:p,tip:endpoint(ns.get(n),p,fallback),source:false,target:false,arrow:false};terminals.set(k,t);}t[role]=true;if(role==='target'&&e.arrow)t.arrow=true;}
  const all=[...terminals.values()],sources=all.filter(t=>t.source),targets=all.filter(t=>t.target),coord=vertical?'x':'y';
  const start=Math.max(...sources.map(t=>t.tip[coord])),end=Math.min(...targets.map(t=>t.tip[coord]));
  let axis=Number.isFinite(bus.axis)?bus.axis:(start<end?(start+end)/2:(Math.min(...all.map(t=>t.tip[coord]))+Math.max(...all.map(t=>t.tip[coord])))/2);
  if(!Number.isFinite(bus.axis)){// A new spine/drag handle must not be hidden under a terminal node.
   const obstacles=[...new Set(all.map(t=>t.node))].map(id=>ns.get(id));
   const clear=x=>obstacles.every(n=>vertical?(x<n.x-18||x>n.x+n.w+18):(x<n.y-18||x>n.y+n.h+18));
   if(!clear(axis)){const candidates=obstacles.flatMap(n=>vertical?[n.x-36,n.x+n.w+36]:[n.y-36,n.y+n.h+36]).filter(clear);candidates.sort((a,b)=>Math.abs(a-axis)-Math.abs(b-axis));if(candidates.length)axis=candidates[0];}
  }
  const entries=[],segments=[];for(const t of all){const tap=terminalTap(t.tip,axis,vertical,ns.get(t.node)),join=tap.join;
   t.join=join;t.path=tap;entries.push({join,node:t.node});const points=t.arrow?[...t.path.points].reverse():t.path.points,path=pathData(points);if(bus.style==='wire')path.d=roundedPath(points);segments.push({...path,arrow:t.arrow,node:t.node});
  }
  const values=entries.map(e=>vertical?e.join.y:e.join.x),lo=Math.min(...values),hi=Math.max(...values),trunk=pathData(vertical?[{x:axis,y:lo},{x:axis,y:hi}]:[{x:lo,y:axis},{x:hi,y:axis}]);
  const handle={...entries[0].join},empty=pathData([]),center=handle,anchor=all[0].tip;
  for(const e of es){const s=terminals.get(key(e.source,e.sourcePort,'right')),t=terminals.get(key(e.target,e.targetPort,'left'));const full=pathData([...s.path.points,t.join,...[...t.path.points].reverse()]);routes.set(e.id,{...full,bus:bus.id,busIncoming:true,paint:false,hitD:s.path.d+' '+t.path.d});}
  buses.push({id:bus.id,mode:'free',vertical,axis,anchor,center,handle,lead:empty,trunk,segments,terminals:all,entries,arrow:false,dashed:es.every(e=>e.dashed)});
 }return {routes,buses};
}
function normalizeV5(p){prev.normalizeV4(p);p.schemaVersion=5;
 for(const pg of p.pages){for(const n of pg.nodes){if(n.table)n.h=tableMetrics(n).total;}cleanBuses(pg);for(const b of pg.buses||[])upgradeBus(pg,b);}return p;
}
Object.assign(C,{tableMetrics,ports,port,endpoint,visiblePorts,samePort,components,display,dragPlan,moveRouteObjects,pathData,roundedPath,edgePath,moveEdgeSegment,combineEdges,joinBus,cleanBuses,bundleRoutes,normalizeV5});
})(globalThis);

/* 0.6 — optional bus symmetry, stable cell addresses and content-driven row sizing.
 * View layout never writes into the user's saved coordinates. Detached components
 * are processed independently. A manually moved/locked band is never re-centred.
 */
(function(root){
'use strict';
const C=root.Core,prev={...C};
const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const center=(n,axis='y')=>n[axis]+n[axis==='y'?'h':'w']/2;
function cellMaterialIds(cell){return [...new Set([cell?.material,...(cell?.materials||[])].filter(id=>typeof id==='string'&&id))];}
function initTable(n){prev.initTable(n);if(!n.table)return;const t=n.table;
 t.colIds=Array.from({length:t.cells[0]?.length||1},(_,i)=>t.colIds?.[i]||C.uid('col'));
 if(new Set(t.colIds).size!==t.colIds.length)throw Error('Повторяются идентификаторы столбцов');
 if(t.autoSize===undefined)t.autoSize=t.heights.every(h=>!h);
}
function tableAxis(t,axis,index,remove=false){const out=prev.tableAxis(t,axis,index,remove),ids=[...(t.colIds||Array.from({length:t.cells[0].length},()=>C.uid('col')))];
 if(axis==='col')ids.splice(index,remove?1:0,...(remove?[]:[C.uid('col')]));out.colIds=ids;return out;}
function mergeTable(t,a,b){const q=C.normalizedRange(a,b),ids=[];for(let r=q.r0;r<=q.r1;r++)for(let c=q.c0;c<=q.c1;c++)ids.push(...cellMaterialIds(t.cells[r]?.[c]));const out=prev.mergeTable(t,a,b);const cell=out.cells[q.r0][q.c0];if(ids.length){cell.materials=[...new Set(ids)];delete cell.material;}return out;}
function splitTable(t,r,c){
 const original=t.cells[r]?.[c],out=prev.splitTable(t,r,c);
 // Splitting changes spans only. Keep the anchor's HTML, styling and links.
 if(original)out.cells[r][c]={...C.clone(original),rowspan:1,colspan:1};
 return out;
}
function tableMetrics(n){
 const t=n.table;if(!t)return prev.tableMetrics(n);const cols=t.cells[0]?.length||1,widths=Array.from({length:cols},(_,i)=>Math.max(32,finite(t.widths?.[i],150))),sum=widths.reduce((a,b)=>a+b,0),scale=Math.max(1,(n.w||sum)-3)/sum,font=n.fontSize||13;
 const auto=r=>t.autoSize===true||!t.heights?.[r],heights=t.cells.map((_,r)=>auto(r)?36:Math.max(24,t.heights[r]));
 const need=(cell,c)=>{const width=widths.slice(c,c+(cell.colspan||1)).reduce((a,b)=>a+b,0)*scale-1;
  if(C.measureCell){const h=C.measureCell(n,cell,width);if(Number.isFinite(h)&&h>0)return Math.ceil(h+2);}
  const chars=Math.max(2,Math.floor((width-18)/(font*.54))),lines=String(cell.text||'').split('\n').reduce((s,v)=>s+Math.max(1,Math.ceil(v.length/chars)),0);
  return Math.ceil(lines*font*1.35+18+cellMaterialIds(cell).length*36);
 };
 t.cells.forEach((row,r)=>row.forEach((cell,c)=>{if(cell&&(cell.rowspan||1)===1&&auto(r))heights[r]=Math.max(heights[r],need(cell,c));}));
 t.cells.forEach((row,r)=>row.forEach((cell,c)=>{if(!cell||(cell.rowspan||1)<=1)return;const end=Math.min(heights.length,r+cell.rowspan),have=heights.slice(r,end).reduce((a,b)=>a+b,0),rows=[];for(let i=r;i<end;i++)if(auto(i))rows.push(i);const extra=need(cell,c)-have;if(extra>0&&rows.length)for(const i of rows)heights[i]+=Math.ceil(extra/rows.length);}));
 const header=38,centers=[];let y=header;for(const h of heights){centers.push(y+h/2);y+=h;}const footer=(n.materials||[]).length?(C.measureSources?C.measureSources(n):40):0;
 // Centers use the outer node origin: 1 px node border + half collapsed table border.
 return {widths,heights,centers:centers.map(c=>c+1.5),header,dataBottom:y,footer,total:y+footer+3};
}
function cellTarget(project,target){const pg=project.pages.find(p=>p.id===target?.pageId),n=pg?.nodes.find(n=>n.id===target.nodeId);if(!n?.table)return null;
 const r=n.table.rowIds?.indexOf(target.rowId),c=n.table.colIds?.indexOf(target.colId);if(r<0||c<0||r===undefined||c===undefined)return null;
 for(let i=0;i<=r;i++)for(let j=0;j<=c;j++){const cell=n.table.cells[i]?.[j];if(cell&&i+(cell.rowspan||1)>r&&j+(cell.colspan||1)>c)return {page:pg,node:n,row:i,col:j,cell};}return null;}
/** Smallest view-only symmetry envelope. An actual bus overrides the page default.
 * Implicit fan-outs from one physical body port are included without changing edges.
 */
function symmetricLayout(pg,d,folds,compact,opts){
 if(opts.busSymmetry!==true)return d;const shown=new Map(d.nodes.map(n=>[n.id,n])),raw=new Map(pg.nodes.map(n=>[n.id,n])),g=C.graph(pg),gap=Math.max(24,finite(opts.symmetryGap,64));
 const protectedNode=n=>!!(n?.locked||n?.symmetryManual),units=C.layoutUnits(pg).filter(u=>!u.outside&&u.heads?.length),offsets=d.layoutOffsets||(d.layoutOffsets=new Map());
 const shiftIds=(ids,delta)=>{if(Math.abs(delta)<.001)return;for(const id of ids){const n=shown.get(id);if(n&&!n.anchorId)n.y+=delta;const o=offsets.get(id)||{x:0,y:0};offsets.set(id,{x:o.x,y:o.y+delta});}};
 function localHeads(u){const heads=u.heads.map(id=>shown.get(id)).filter(Boolean).sort((a,b)=>center(a)-center(b));if(!heads.length||heads.some(protectedNode))return;
  const body=[...u.members].map(id=>shown.get(id)).filter(n=>n&&!n.anchorId&&!u.heads.includes(n.id));
  // All participating heads form one visual band, never two competing owners.
  const middle=body.length?(Math.min(...body.map(n=>n.y))+Math.max(...body.map(n=>n.y+n.h)))/2:(Math.min(...heads.map(n=>n.y))+Math.max(...heads.map(n=>n.y+n.h)))/2;
  const span=heads.reduce((s,n)=>s+n.h,0)+gap*(heads.length-1);let y=middle-span/2;
  for(const n of heads){const delta=y-n.y;n.y=y;const o=offsets.get(n.id)||{x:0,y:0};offsets.set(n.id,{x:o.x,y:o.y+delta});y+=n.h+gap;}
 }
 // Only units reached through a common upstream fan-out participate in packing.
 const heads=new Set(units.flatMap(u=>u.heads));const parents=pg.nodes.filter(n=>shown.has(n.id)&&!n.anchorId&&(g.adj.get(n.id)||[]).filter(id=>heads.has(id)&&shown.has(id)).length>=2);
 const groups=[];
 for(const parent of parents){const direct=new Set(g.adj.get(parent.id)||[]),owned=units.filter(u=>u.heads.some(id=>direct.has(id))),bus=pg.buses?.find(b=>b.hub===parent.id&&b.mode==='out');if(bus?.symmetry===false)continue;
  const set=new Set(owned.flatMap(u=>[...u.members]));if(groups.some(q=>q.parent.id===parent.id))continue;groups.push({parent,owned,set});}
 for(const {parent,owned,set} of groups){
  for(const u of owned)localHeads(u);
  let cursor=null;
  for(const u of owned){const list=[...u.members].map(id=>shown.get(id)).filter(n=>n&&!n.anchorId);if(!list.length)continue;let b=C.bounds(list);let delta=cursor===null?0:cursor-b.y;
   // Symmetry packs every visible band. Manual bands are authoritative obstacles.
   const pinned=list.some(protectedNode);if(pinned)delta=0;
   shiftIds(u.members,delta);b=C.bounds(list);cursor=b.y+b.h+gap;
  }
  const body=[...set].map(id=>shown.get(id)).filter(n=>n&&!n.anchorId),p=shown.get(parent.id);
  if(body.length&&!protectedNode(p)){const delta=(Math.min(...body.map(n=>n.y))+Math.max(...body.map(n=>n.y+n.h)))/2-center(p);shiftIds(new Set([p.id]),delta);}
 }
 // Generic small fan-in/out buses outside the structural bands: symmetric terminals.
 // Do not re-pack descendants shared with another controlling band.
 const controlled=new Set(groups.flatMap(q=>[q.parent.id,...q.set]));
 for(const bus of pg.buses||[]){if(bus.symmetry===false)continue;const es=d.edges.filter(e=>e.bus===bus.id&&!e.proxy);if(es.length<2)continue;const mode=bus.mode;
  if(!['in','out'].includes(mode))continue;const hub=shown.get(bus.hub);if(!hub||controlled.has(hub.id)||protectedNode(hub))continue;
  const ids=[...new Set(es.map(e=>mode==='out'?e.target:e.source))],ns=ids.map(id=>shown.get(id));if(ns.some(n=>!n||controlled.has(n.id)||protectedNode(n)||n.table))continue;
  const vertical=['left','right'].includes(C.endpoint(hub,bus.port,mode==='in'?'left':'right').side),axis=vertical?'y':'x',size=vertical?'h':'w';ns.sort((a,b)=>center(a,axis)-center(b,axis));
  const total=ns.reduce((s,n)=>s+n[size],0)+gap*(ns.length-1),mid=(Math.min(...ns.map(n=>n[axis]))+Math.max(...ns.map(n=>n[axis]+n[size])))/2;let p=mid-total/2;
  for(const n of ns){const delta=p-n[axis];n[axis]=p;const o=offsets.get(n.id)||{x:0,y:0};offsets.set(n.id,{...o,[axis]:o[axis]+delta});p+=n[size]+gap;}const delta=mid-center(hub,axis);hub[axis]+=delta;const o=offsets.get(hub.id)||{x:0,y:0};offsets.set(hub.id,{...o,[axis]:o[axis]+delta});
 }
 // Re-anchor standalone pictures after any owner movement. Inline icons are relative already.
 for(const n of d.nodes)if(n.anchorId){const h=shown.get(n.anchorId);if(h){n.x=h.x+(n.anchorX||0);n.y=h.y+(n.anchorY||0);}}
 d.symmetryGroups=groups.map(q=>({parent:q.parent.id,heads:q.owned.flatMap(u=>u.heads)}));return d;
}
function display(pg,folds=new Set(),compact=true,folded=new Set(),options={}){const opts={...pg.layoutOptions,...options},d=prev.display(pg,folds,compact,folded,options);return symmetricLayout(pg,d,folds,compact,opts);}
function setTableAutoSize(n,enabled){
 initTable(n);if(!n.table)return;
 // Turning automatic sizing off freezes the currently displayed rows, not zeroes
 // (zero is the independent per-row automatic-height setting).
 if(!enabled)n.table.heights=[...tableMetrics(n).heights];
 n.table.autoSize=!!enabled;
}
function normalizeV6(p){prev.normalizeV5(p);p.schemaVersion=6;for(const pg of p.pages){pg.layoutOptions={busSymmetry:true,symmetryGap:64,...pg.layoutOptions};for(const n of pg.nodes){if(n.relativeLock===undefined)n.relativeLock=true;initTable(n);}}return p;}
Object.assign(C,{cellMaterialIds,initTable,tableAxis,mergeTable,splitTable,tableMetrics,cellTarget,setTableAutoSize,symmetricLayout,display,normalizeV6});
})(globalThis);

/* 0.7: additive schema-6 behaviors; coordinates remain authoritative on disk. */
(function(root){
 const C=root.Core,prev={...C};
 const vectors={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
 function simplify(points){const out=[];for(const p of points){if(out.length&&Math.hypot(p.x-out.at(-1).x,p.y-out.at(-1).y)<.001)continue;out.push({...p});while(out.length>2){const [a,b,c]=out.slice(-3);if(Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))>.001)break;out.splice(out.length-2,1);}}return out;}
 function descendants(pg,id){return C.relativeDescendantsGraph?C.relativeDescendantsGraph(pg,id):C.descendants(pg,id);}
 function dragPlan(pg,selection,folds,mode){const plan=prev.dragPlan(pg,selection,folds,mode);for(const id of [...plan.ids])if(pg.nodes.find(n=>n.id===id)?.relativeLock)for(const next of descendants(pg,id))plan.ids.add(next);for(let i=0;i<pg.nodes.length;i++){let changed=false;for(const n of pg.nodes)if(n.anchorId&&plan.ids.has(n.anchorId)&&!plan.ids.has(n.id)){plan.ids.add(n.id);changed=true;}if(!changed)break;}plan.locked=[...plan.ids].filter(id=>pg.nodes.find(n=>n.id===id)?.locked);return plan;}
 function display(pg,folds=new Set(),compact=true,folded=new Set(),options={}){
  const sized={...pg,nodes:pg.nodes.map(n=>n.table&&C.fitTableWords?C.fitTableWords(n):n.autoSize&&C.measureNode?{...n,...C.measureNode(n)}:n),buses:(pg.buses||[]).map(b=>b.autoAlign!==undefined?{...b,symmetry:false}:b)};
  const d=prev.display(sized,folds,compact,folded,options),shown=new Map(d.nodes.map(n=>[n.id,n])),offsets=d.layoutOffsets||new Map();
  const shift=(ids,key,delta)=>{d.layoutOffsets=offsets;for(const id of ids){const n=shown.get(id);if(!n||n.anchorId||n.locked||n.editLocked)continue;n[key]+=delta;const o=offsets.get(id)||{x:0,y:0};offsets.set(id,{...o,[key]:o[key]+delta});}};
  for(const bus of pg.buses||[]){if(!bus.autoAlign||!['in','out'].includes(bus.mode))continue;const hub=shown.get(bus.hub);if(!hub)continue;const es=d.edges.filter(e=>e.bus===bus.id&&!e.proxy),ids=[...new Set(es.map(e=>bus.mode==='out'?e.target:e.source))],heads=ids.map(id=>shown.get(id));if(heads.length<2||heads.some(n=>!n||n.locked))continue;
   const port=C.endpoint(hub,bus.port,bus.mode==='in'?'left':'right'),axis=['left','right'].includes(port.side)?'y':'x',size=axis==='y'?'h':'w',gap=Math.max(16,Number(bus.alignGap)||64);
   const branches=heads.map(n=>{const own=new Set([n.id]);if(bus.mode==='out')for(const id of descendants(pg,n.id))own.add(id);own.delete(hub.id);return {n,own};});
   if(branches.some(b=>[...b.own].some(id=>{const n=shown.get(id);return n?.locked&&n.type!=='comment'&&(n.type!=='note'||n.flowNode)})))continue;
   // Shared downstream nodes keep their position; each exclusive branch moves once.
   const counts=new Map();for(const b of branches)for(const id of b.own)counts.set(id,(counts.get(id)||0)+1);for(const b of branches)b.own=new Set([...b.own].filter(id=>counts.get(id)===1));
   branches.sort((a,b)=>a.n[axis]-b.n[axis]);const boxes=branches.map(b=>C.bounds([...b.own].map(id=>shown.get(id)).filter(n=>n&&!n.anchorId&&n.type!=='comment'&&(n.type!=='note'||n.flowNode)))),span=boxes.reduce((s,b)=>s+b[size],0)+gap*(heads.length-1);let cursor=port[axis]-span/2;
   branches.forEach((b,i)=>{shift(b.own,axis,cursor-boxes[i][axis]);cursor+=boxes[i][size]+gap;});
  }
  for(const n of d.nodes)if(n.anchorId){const host=shown.get(n.anchorId);if(host){n.x=host.x+(n.anchorX||0);n.y=host.y+(n.anchorY||0);}}
  return d;
 }
 function removeEdgeSegment(e,ns,index){if(e.bus)throw Error('Сначала выведите ветвь из гребёнки');const route=C.edgePath({...e,style:'orthogonal'},ns),ps=route?.points.map(p=>({...p}));if(!ps||index<1||index>=ps.length-2)throw Error('Концы связи закреплены за портами');
  const out={...e};delete out.waypoints;delete out.manualRoute;delete out.manualRouteMode;
  const minimal=C.edgePath(out,ns);if(simplify(ps).length<=simplify(minimal.points).length)return out;
  // Collapse two bends, then join the remaining pieces with one right angle.
  ps.splice(index,2);const joined=[];for(const p of ps){const last=joined.at(-1);if(last&&Math.abs(p.x-last.x)>.001&&Math.abs(p.y-last.y)>.001){const before=joined.at(-2);joined.push(before&&Math.abs(last.x-before.x)<.001?{x:last.x,y:p.y}:{x:p.x,y:last.y});}joined.push(p);}const inner=simplify(joined).slice(1,-1),s=ps[0];if(inner.length){out.manualRoute=inner.map(p=>({dx:p.x-s.x,dy:p.y-s.y}));out.manualRouteMode='polyline';}return out;
 }
 // Try short routes with variable clearance before the fixed-stub fallback.
 function edgePath(e,ns){if(e.manualRouteMode==='polyline'&&e.manualRoute?.length&&e.style!=='straight'){
  const a=ns.get(e.source),b=ns.get(e.target);if(!a||!b)return null;const s=C.endpoint(a,e.sourcePort,'right'),t=C.endpoint(b,e.targetPort,'left'),points=[s,...e.manualRoute.map(p=>({x:s.x+p.dx,y:s.y+p.dy}))];const last=points.at(-1);if(Math.abs(last.x-t.x)>.001&&Math.abs(last.y-t.y)>.001)points.push(['left','right'].includes(t.side)?{x:last.x,y:t.y}:{x:t.x,y:last.y});points.push(t);const r=C.pathData(simplify(points)),sv=vectors[s.side],tv=vectors[t.side];
  const crosses=(u,v,n)=>Math.abs(u.x-v.x)<.001?u.x>n.x+.5&&u.x<n.x+n.w-.5&&Math.max(u.y,v.y)>n.y+.5&&Math.min(u.y,v.y)<n.y+n.h-.5:u.y>n.y+.5&&u.y<n.y+n.h-.5&&Math.max(u.x,v.x)>n.x+.5&&Math.min(u.x,v.x)<n.x+n.w-.5;
  if(e.source!==e.target&&r.points.length>1&&((r.points[1].x-s.x)*sv.x+(r.points[1].y-s.y)*sv.y<=0||(r.points.at(-2).x-t.x)*tv.x+(r.points.at(-2).y-t.y)*tv.y<=0||r.points.length>2&&Math.hypot(r.points.at(-2).x-t.x,r.points.at(-2).y-t.y)<18||r.points.slice(1).some((v,i)=>crosses(r.points[i],v,a)||crosses(r.points[i],v,b)))){const auto={...e};delete auto.manualRoute;delete auto.manualRouteMode;delete auto.waypoints;return edgePath(auto,ns);}if(e.style==='wire')r.d=C.roundedPath(r.points);return r;
 }
 if(e.source!==e.target&&!e.proxy&&e.manualRoute?.length&&e.style!=='straight'){
 const route=prev.edgePath(e,ns),a=ns.get(e.source),b=ns.get(e.target),ps=simplify(route.points),s=ps[0],t=ps.at(-1),sv=vectors[s.side],tv=vectors[t.side];
 const crosses=(u,v,n)=>Math.abs(u.x-v.x)<.001?u.x>n.x+.5&&u.x<n.x+n.w-.5&&Math.max(u.y,v.y)>n.y+.5&&Math.min(u.y,v.y)<n.y+n.h-.5:u.y>n.y+.5&&u.y<n.y+n.h-.5&&Math.max(u.x,v.x)>n.x+.5&&Math.min(u.x,v.x)<n.x+n.w-.5;
 if(sv&&tv&&((ps[1].x-s.x)*sv.x+(ps[1].y-s.y)*sv.y<=0||(ps.at(-2).x-t.x)*tv.x+(ps.at(-2).y-t.y)*tv.y<=0||ps.length>2&&Math.hypot(ps.at(-2).x-t.x,ps.at(-2).y-t.y)<18||ps.slice(1).some((v,i)=>crosses(ps[i],v,a)||crosses(ps[i],v,b)))){const auto={...e};delete auto.manualRoute;delete auto.manualRouteMode;delete auto.waypoints;return edgePath(auto,ns);}return route;
 }
 if(e.source===e.target||e.proxy||e.waypoints?.length||e.manualRoute?.length||e.style==='straight')return prev.edgePath(e,ns);
  const a=ns.get(e.source),b=ns.get(e.target);if(!a||!b)return null;const s=C.endpoint(a,e.sourcePort,'right'),t=C.endpoint(b,e.targetPort,'left'),sv=vectors[s.side],tv=vectors[t.side];if(!sv||!tv)return prev.edgePath(e,ns);
  const opposed=sv.x*tv.x+sv.y*tv.y===-1,gap=(t.x-s.x)*sv.x+(t.y-s.y)*sv.y,clearance=opposed&&gap>0?Math.max(.25,Math.min(28,gap/2)):28,p={x:s.x+sv.x*clearance,y:s.y+sv.y*clearance},q={x:t.x+tv.x*clearance,y:t.y+tv.y*clearance};
  const candidates=[[p,{x:q.x,y:p.y},q],[p,{x:p.x,y:q.y},q]];
  for(const x of [(p.x+q.x)/2,Math.min(a.x,b.x)-32,Math.max(a.x+a.w,b.x+b.w)+32])candidates.push([p,{x,y:p.y},{x,y:q.y},q]);
  for(const y of [(p.y+q.y)/2,Math.min(a.y,b.y)-32,Math.max(a.y+a.h,b.y+b.h)+32])candidates.push([p,{x:p.x,y},{x:q.x,y},q]);
  const crosses=(u,v,n)=>Math.abs(u.x-v.x)<.001?u.x>n.x+.5&&u.x<n.x+n.w-.5&&Math.max(u.y,v.y)>n.y+.5&&Math.min(u.y,v.y)<n.y+n.h-.5:u.y>n.y+.5&&u.y<n.y+n.h-.5&&Math.max(u.x,v.x)>n.x+.5&&Math.min(u.x,v.x)<n.x+n.w-.5;
  const safe=[];for(const mids of candidates){const ps=simplify([s,...mids,t]);if(ps.length<2)continue;const first=ps[1],last=ps.at(-2);if((first.x-s.x)*sv.x+(first.y-s.y)*sv.y<=0||(last.x-t.x)*tv.x+(last.y-t.y)*tv.y<=0)continue;if(ps.slice(1).some((v,i)=>crosses(ps[i],v,a)||crosses(ps[i],v,b)))continue;
   // Preserve endpoint handles without reintroducing reversed segments.
   const firstLength=Math.hypot(first.x-s.x,first.y-s.y),lastLength=Math.hypot(last.x-t.x,last.y-t.y);if(ps.length>2&&(firstLength<clearance-.001||lastLength<clearance-.001))continue;
   const sp={x:s.x+sv.x*Math.min(clearance,firstLength),y:s.y+sv.y*Math.min(clearance,firstLength)},tp={x:t.x+tv.x*Math.min(clearance,lastLength),y:t.y+tv.y*Math.min(clearance,lastLength)};
   const points=[s,sp,...ps.slice(1,-1),tp,t].filter((v,i,all)=>!i||Math.hypot(v.x-all[i-1].x,v.y-all[i-1].y)>.001),length=points.slice(1).reduce((sum,v,i)=>sum+Math.hypot(v.x-points[i].x,v.y-points[i].y),0);safe.push({points,length,score:length+Math.max(0,ps.length-2)*18});}
  if(!safe.length)return prev.edgePath(e,ns);safe.sort((a,b)=>a.score-b.score||a.points.length-b.points.length);const r=C.pathData(safe[0].points);if(e.style==='wire')r.d=C.roundedPath(r.points);return r;
 }
 function inlineMaterialIds(cell){return [...new Set([...String(cell?.html||'').matchAll(/<a\b[^>]*\bdata-open-material\s*=\s*["']([a-zA-Z0-9_.:-]{1,200})["']/gi)].map(m=>m[1]))];}
 function cellMaterialIds(cell){return [...new Set([...prev.cellMaterialIds(cell),...inlineMaterialIds(cell)])];}
 function mergeTable(t,a,b){const range=C.normalizedRange(a,b),parts=[],escape=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');for(let r=range.r0;r<=range.r1;r++)for(let c=range.c0;c<=range.c1;c++){const cell=t.cells[r]?.[c];if(cell)parts.push(cell.html||escape(cell.text));}const out=prev.mergeTable(t,a,b);if(parts.some(p=>p.includes('<')))out.cells[range.r0][range.c0].html=parts.join('<br>');return out;}
 function endpoint(n,id,fallback){if(n._resizePorts){const p=n._resizePorts.find(p=>p.id===id)||n._resizePorts.find(p=>p.side===fallback);if(p)return {...p,x:n.x+p.x*n.w,y:n.y+p.y*n.h};}return prev.endpoint(n,id,fallback);}
 Object.assign(C,{endpoint,inlineMaterialIds,cellMaterialIds,mergeTable,relativeDescendants:descendants,dragPlan,display,removeEdgeSegment,edgePath,simplifyRoute:simplify});
})(globalThis);

(function(C){
const patterns=[".ави2", ".ад1р", ".ади2", ".аи2", ".ак1в", ".ак1р", ".аль5", ".ас1п", ".ау2", ".аш1х", ".аэ2", ".бе2з1а2", ".бе2з1у2", ".бе2з3о2", ".бе2с1т", ".без1на", ".без1р", ".би2б1л", ".бу1г", ".взъ2", ".во1в2", ".во2п1л", ".во2с3тор", ".во2ск", ".во3п2ло", ".воз1на", ".вс6п", ".въ2", ".вып2ле", ".выс2п", ".гос1к", ".дво2е", ".де2зи", ".ди2а", ".ди2сто", ".до1см", ".за3в2ра", ".за3п2н", ".зас2", ".зау2", ".заш2", ".звуко3", ".зо2о3", ".иг1л", ".иг1р", ".ие2", ".из1н", ".из1р", ".изо2бл", ".ии2", ".ио2", ".ис1ти", ".ис1то", ".ис5тр", ".иу2", ".ию2", ".кон2трн", ".ле1м", ".ль2", ".ме2ж3", ".ме3ж4ам", ".ме3ж4ах", ".ме3ж4е", ".ме6жи2о", ".мо2г1л", ".на1ч2н", ".на1ш2ко", ".на2и", ".на5в6", ".не1в", ".не1з2", ".не1х", ".не3о2тр", ".не5л", ".неа2", ".небе2з1о2", ".нем2но", ".ни1с2к", ".нос5к", ".оа2", ".об1ла", ".об1ле", ".об1ло", ".об1лу", ".об1ре", ".об1ру", ".об3о2ст", ".об5лив", ".об5лит", ".обе2з1о2", ".обе2с1т", ".обо1ль", ".ог5н", ".оз2", ".ос1пин", ".ос2пар", ".от1р", ".от1хл", ".от3в", ".ото1м2", ".по1в2", ".по1ж2", ".по2дыг", ".по2дым", ".по2дын", ".по2дыс1", ".по2дыт", ".по2дыщ", ".по2ст1ин", ".по3дыми", ".под1во", ".пре1л", ".пре2ж1д", ".при1г2н", ".при1м2н", ".при3к2н", ".прис2к", ".про1сну", ".про3сл", ".прос2", ".ра2зо", ".ра2с1та", ".ра2с1те", ".ра2с1тек", ".ра2с1теч", ".ра2с1ти", ".реги6о", ".ро2х1", ".сек1с2т", ".сеп5т", ".соп1л", ".тек1с", ".топ1л", ".тран2с1", ".трех1", ".ть2", ".уг1ле", ".уг1ло", ".уд2л", ".уд2р", ".уе2", ".ук2", ".ур6в", ".ую2", ".фи2зо", ".хим1ч", ".хла2", ".ча2е", ".че2ст1в", ".чер2ст1", ".четырех1", ".эо2", ".эя2", ".юа2", ".яи2", "1адм", "1апп", "1атак", "1б2лаго", "1бв", "1бе", "1бл", "1бри", "1бу", "1бю", "1бя", "1в2нук", "1в2нуч", "1в2сп", "1в2сх", "1в2сю", "1в2шив", "1ваг", "1вак", "1вег", "1велл", "1вер.", "1вз2", "1вих", "1вич", "1вл", "1вок", "1воя", "1вп", "1вр2", "1вуд", "1вы", "1вю", "1га", "1гор", "1гр", "1д2ворь", "1д2лев", "1д2невк", "1д2невок", "1д2раж", "1д2разн", "1движ", "1двиз", "1дж", "1дзе.", "1дневн", "1дняш", "1дов", "1дот", "1доч", "1дресс", "1дро2г1н", "1дроб", "1дром", "1дун", "1дье", "1дья", "1жг", "1жд", "1жму", "1зву", "1зол", "1зри", "1зу", "1кав", "1кае", "1кап", "1кат", "1каю", "1кив", "1кл", "1ковы", "1комп", "1кон", "1коо", "1кос", "1кош", "1кр", "1ла2пь", "1ланд", "1леде", "1ли2п1т", "1льо", "1лью", "1лют.", "1м2нож", "1маг", "1мед", "1мей", "1мен.", "1мкн", "1мон", "1мще", "1мы.", "1на.", "1на1г", "1на1с2", "1над", "1ниц", "1но.", "1ной", "1ном", "1нох", "1ною.", "1нрав", "1ньо", "1нью", "1ня", "1о2б1лач", "1о2биж", "1о2боз", "1обес", "1объ", "1окт", "1отд", "1отп", "1п2ленк", "1п2ленок", "1п2леноч", "1п2лет", "1п2салм", "1пе.", "1пенз", "1печ", "1пис", "1плав", "1плаз", "1пле2с1к", "1плик", "1плос1к", "1плы", "1по", "1пр", "1птих", "1пу.", "1пя", "1р2ви.", "1р2вите.", "1раб", "1ралг", "1реги", "1реза", "1рекла", "1рисо", "1росш", "1рыб", "1с2каф", "1с2клон", "1с2кре1ст", "1с2креб", "1с2паль", "1с2посаб", "1с4творч", "1са", "1св", "1се", "1сж", "1си", "1скоп", "1сл", "1со", "1сп2лю.", "1ср", "1сто", "1стров", "1су", "1сфе", "1схе", "1счас", "1счит", "1съ2", "1сы", "1ся", "1т2кан", "1т2ре2з1в", "1т2ряс", "1т2рях", "1т4верд", "1т4вор", "1такт", "1тека", "1текш", "1терл", "1тече", "1ткн", "1тле", "1толк", "1торс", "1торц", "1точн", "1тощ", "1тре2с1к", "1треб", "1триб", "1труб", "1тяну", "1узл", "1ф2тор", "1фа", "1фи", "1фл", "1фо", "1фр6", "1фтонг", "1фы", "1х2лын", "1хв", "1хи", "1хлеб", "1хлор", "1хр", "1ху.", "1цам", "1цах.", "1цв", "1це", "1ци", "1цо", "1цу.", "1цы", "1чел", "1чив", "1чик", "1чла", "1чле", "1чо", "1чт", "1чх", "1ш2в", "1ш2кол", "1ш2мы2г1н", "1ши2б1л", "1шпе", "1шпил", "1ште", "1шту", "1шю", "1щи", "1э2к", "2а1ма", "2а3о", "2б1д", "2б1лен", "2б1ля", "2б1н", "2б1т", "2б1ц", "2б1ш", "2б5к", "2блас", "2бль", "2бр.", "2брь", "2в1лаб", "2в1лен", "2в1ли", "2в1лю", "2в1ляе", "2в1лял", "2в1ляю", "2в1ми", "2в1ре.", "2в1ро", "2в1ры.", "2в1терп", "2вль", "2вр.", "2г1б", "2г1к", "2г1м", "2г1п", "2г1с", "2г1ш", "2г5т", "2гроп", "2д1инсти", "2д1к", "2д1м", "2д1ро.", "2д1с", "2д1ф", "2д3ш2", "2джс", "2дны", "2доблач", "2докт", "2дрс", "2дь3те.", "2е1ко", "2е1о", "2енр", "2ж1к", "2ж1ц", "2жаве", "2жавл", "2ждл", "2ждь", "2з1б", "2з1да", "2з1инт", "2з1инф", "2з1к", "2з1с", "2здн", "2зна.", "2зны", "2и1вы", "2имене", "2к1б", "2к1г", "2к1к", "2к1ла.", "2к1лак", "2к1ли.", "2к1ло.", "2к1м", "2к1т", "2к1ц", "2к1ш", "2казк", "2кл.", "2кль", "2кн", "2кс", "2л1н", "2л1орг", "2м1в2", "2м1изд", "2м1л", "2м1ш", "2н1с", "2н1ц", "2н1ш", "2нбе", "2невн", "2нотд", "2няш", "2о1а2", "2о1г", "2о1за", "2о1и", "2о1ры", "2о1со", "2о1те", "2о1тр", "2о1у2", "2о1хи", "2о1э", "2о5хро", "2ов", "2ол", "2ом", "2опир", "2остал", "2осф", "2оф", "2п1к", "2п1лю.", "2п1люсь.", "2п1м", "2п1н", "2п1п", "2п1сис", "2п1ст", "2п1том", "2п1ф", "2п1ц", "2п1ч", "2п1ш", "2п3ту", "2пс.", "2псе", "2псо", "2псу", "2псы", "2р1орг", "2р1укс", "2рисп", "2с1лиру", "2с1лок", "2с1лоц", "2с1му", "2сбу", "2ск.", "2скн", "2сль", "2смен.", "2сны", "2сск", "2ств.", "2стерл", "2стк", "2стн", "2сть.", "2сфор", "2сэ2", "2сяз", "2т1вей", "2т1г", "2т1инф", "2т1м", "2т1н", "2т1п", "2т1с", "2т1ф", "2т1ц", "2т1щ", "2т1э", "2тамп", "2томщ", "2тонг", "2тр.", "2трабо", "2трб", "2трг", "2трд", "2трм", "2трп", "2трр", "2трф", "2туч", "2ть.", "2ф1в", "2ф1лен", "2ф1н", "2ф1орг", "2ф1с", "2х1ве", "2х1г", "2х1с", "2х1у2г", "2ц1г", "2ц1з", "2ц1к", "2ц1л", "2ц1м", "2ц1о2д", "2ц1от", "2ц1п", "2ц1с", "2ц1т", "2ч1м", "2чтм", "2ш1ф", "2щ1н", "2юм", "2юю.", "2юя.", "2яю.", "2яя.", "3в2лия", "3европ", "3з2вуч", "3зис", "3и2мено", "3и2мену", "3к6ниж", "3ная", "3ник", "3ную", "3ны", "3о2т1ряд", "3п2сих", "3план", "3с2лав", "3с2лов", "3с2луж", "3с2посо", "3хор", "3ч2мок", "3чий", "5би2о", "5бот", "5боц", "5вая", "5вуа", "5двину", "5деб", "5до.", "5дью", "5жев", "5зо.", "5зью", "5инж", "5инсп", "5к6то.", "5коа", "5коры", "5л6жеш", "5лиг", "5лицо", "5личи", "5мий", "5минг", "5моти", "5нап", "5нац", "5ниб", "5откр", "5посы", "5прое6", "5с2наб", "5скоя", "5смес", "5смы", "5сты", "5течь", "5тиге", "5тиз.", "5туды", "5тушев", "5хоз", "5хом", "5хоу", "5ца.", "5чан", "5шло", "5штр", "6б1б", "6б1г", "6б1м", "6б1с2", "6б1щ", "6бл.", "6бь.", "6в5рац", "6вн.", "6вск", "6вь.", "6г5лай", "6гл.", "6гн.", "6гр.", "6грек", "6д1б", "6д5роз", "6дж.", "6дз.", "6дн.", "6дотд", "6др.", "6дт.", "6дь.", "6евол", "6евыд", "6жд.", "6з1ж", "6з1м", "6з1ру", "6зная", "6зь.", "6ип", "6й1", "6к1ф", "6кв.", "6кеа", "6кр.", "6л1с2", "6ль.", "6льш", "6м1б", "6м1м", "6м1п", "6м1т", "6м1че", "6мс.", "6мь.", "6нр.", "6нь.", "6о5ба", "6одар", "6окл", "6окол", "6охор", "6пл.", "6пль.", "6пр.", "6прь.", "6пт.", "6пь.", "6с1з", "6с5чу", "6скон", "6сл.", "6слям", "6ср.", "6сс.", "6сст", "6ст.", "6стр.", "6студы", "6стьд", "6стьс", "6сь.", "6т1б", "6т1ред", "6т1т", "6твь.", "6тинж", "6тл.", "6томс", "6трв", "6труп", "6тч.", "6тш.", "6фр.", "6фь.", "6х1ч", "6х5ви", "6хв.", "6хрь.", "6хуем.", "6хуй.", "6хую.", "6хуя.", "6ценни", "6ч1к", "6ч5лег", "6ч5леж", "6чт.", "6чь.", "6ш1б", "6шв.", "6шл.", "6шь.", "6щь.", "6ъ1", "а1а", "а1ба", "а1бе", "а1би", "а1бо", "а1бр", "а1бу", "а1бх", "а1бы", "а1бье", "а1бьи", "а1бью", "а1бья", "а1бя", "а1ва", "а1во", "а1ву", "а1вы", "а1вье", "а1вьи", "а1вью", "а1вья", "а1вэ", "а1вю", "а1вя", "а1га", "а1ге", "а1ги", "а1гл", "а1го", "а1да", "а1двор", "а1де", "а1ди", "а1до", "а1дра", "а1ду", "а1дцат", "а1ды", "а1дьи", "а1дью", "а1дю", "а1дя", "а1е", "а1жа", "а1же", "а1жж", "а1жи", "а1жм", "а1жо", "а1жу", "а1жье", "а1жьи", "а1жью", "а1жья", "а1за", "а1зе", "а1зи", "а1зо", "а1зы", "а1зье", "а1зью", "а1зья", "а1зю", "а1зя", "а1и", "а1ка", "а1ке", "а1ки", "а1ко", "а1ку", "а1кы", "а1ла", "а1ле", "а1ло", "а1лу", "а1лы", "а1лье", "а1льи", "а1лья", "а1лю", "а1ля", "а1ме", "а1ми", "а1мо", "а1му", "а1мы", "а1мье", "а1мьи", "а1мью", "а1мья", "а1мя", "а1на", "а1не", "а1ни", "а1но", "а1ну", "а1ны", "а1нье", "а1ньи", "а1нью", "а1нья", "а1ню", "а1ня", "а1п", "а1р6а", "а1ре", "а1ри", "а1ро", "а1ру", "а1ры", "а1рье", "а1рьи", "а1рью", "а1рья", "а1рю", "а1ря", "а1с2ше", "а1са", "а1се", "а1си", "а1со", "а1ста", "а1сте", "а1сти", "а1сту", "а1сты", "а1стье", "а1стью", "а1стья", "а1стю", "а1стя", "а1су", "а1сы", "а1сье", "а1сьи", "а1сью", "а1сья", "а1сю", "а1та", "а1те", "а1ти", "а1то", "а1тр", "а1ту", "а1ты", "а1тье", "а1тьи", "а1тью", "а1тья", "а1тю", "а1тя", "а1у", "а1фа", "а1фе", "а1фи", "а1фо", "а1фу", "а1фья", "а1фя", "а1ха", "а1хе", "а1хи", "а1хо", "а1ху", "а1ца", "а1це", "а1ци", "а1цо", "а1цу", "а1ч2не", "а1ча", "а1че", "а1чи", "а1чу", "а1чье", "а1чьи", "а1чью", "а1чья", "а1ша", "а1ше", "а1ши", "а1шо", "а1шу", "а1шье", "а1шьи", "а1шью", "а1шья", "а1щ", "а1э1", "а1ю", "а1я", "а2в1ля", "а2в1п", "а2в1ра", "а2вот", "а2дын", "а2зри", "а2н1об", "а2н5уз", "а2п1с", "а2п1т", "а2с1тир", "а2скоп", "а2уле", "а2ум", "а2ун", "а2ус", "а2уэ", "а2ш1лы", "а2эр", "а3гу", "а3и2г1р", "а5ве", "а5ви", "а5дви", "а5з6у", "а5ли", "а5стры", "а6нинс", "а6томн", "аа2п1", "аг1ва", "аг1д", "ага5с6", "ад1а2ген", "ад1руга", "ад5рез", "ади2о", "адь2", "ае2ди", "аз1ве", "аз1ви", "аз1во", "аз1р", "аи6з5", "айм2а", "ак1н", "ак1с", "акоп5л", "аль1д", "ам1но", "ам1ч", "ан1р", "ан2кро", "ан2скр", "ан2сп", "ан2сур", "ан2сц", "ана2с3н", "анс1у", "ао2ст", "ао6к", "ап1рел", "ар2т1ор", "арт2р", "ас1к", "ас1пу", "ас1х", "ас1ч", "ас3по", "ас5лет", "ас5лям", "ас5лях", "ас5ми", "асс2ме", "асс6п", "аст1ву", "аста2п1", "ат1л", "ат5ви", "атх1л", "ау2чи", "аут1р", "ауэ1р", "аф1ри", "ач1т", "аш1лив", "аш1та", "ая2з", "б1ва", "б1во", "б1вя", "б1ж", "б1з6", "б1лав", "б1лег", "б1лож", "б1лом", "б1раст", "б1рыв", "б1ф", "б1х", "б1ч", "б5лиза", "бас1м", "бе2д1р", "бе2з1у4с", "бе2зы", "бе2с1к", "бе2ста", "бег1л", "бег1н", "без1д2", "без5в", "безы2з1в", "бес1х", "бес1ч", "бес3п", "бесс2", "би5стр", "био5с", "бис2к1в", "бл1исп", "бле2с1к", "бо1д6р", "бо1жж", "бо1з", "бо1рв", "бо1с", "бо2ес", "бо2мч", "бо2сс", "бо3м2ле", "боз2л", "бра6сл", "бст6", "буг1л", "в1б", "в1в", "в1г", "в1д", "в1к", "в1лаг", "в1ма", "в1мо", "в1н", "в1с2", "в1т", "в1ф", "в1х", "в1ц", "в1ч", "в1ш", "в1щ", "в2нуш", "в2хож", "в2чер", "в5рас", "в6би", "в6кус", "в6сег", "в6ход", "ва1д", "ва2дл", "ва2дн", "ван5с6", "вах1", "вдо1с", "ве2д1р", "ве2с1к", "ве2ст1в", "вез1до", "верт1ля", "вет3в2", "вет4в3л", "вз6р", "взыс5", "ви2ам", "ви2б1р", "ви2зн", "ви5аф", "ви5ол", "виа1с", "вк1н", "во1дво", "во1п", "во2ж3ж", "во2с1пе", "во2с3ток", "во2с3точ", "во2стр", "во3з2дан", "воз1в", "вои2с", "вос1к", "впо6л", "вра2ж5д", "вро5т", "вто3к2", "ву1з", "ву1ст", "ву5г", "вче6т5", "вы1ск", "вы1сп", "вы1тв", "вы1х", "вы1ш", "вы5п", "выпу2к1", "г1г", "г1з", "г1ляе", "г1лят", "г1ляю", "г1ч", "г2нив", "г2ном", "г2раб", "га1ст", "га2у", "ге2од", "ге2оп", "ге2ос", "ге2оц", "ге6об", "ги1с", "ги2б1л", "ги2д1р", "гко1в", "го1з", "го1п", "го2зл", "го2с1а", "го2сб", "гос3с", "грив1к", "гро2м1ч", "гс2шиб", "д1ва", "д1ве", "д1вид", "д1вис", "д1вод", "д1г2", "д1д", "д1за", "д1зв", "д1зо", "д1л", "д1н", "д1п", "д1рас", "д1реж", "д1руб", "д1рыв", "д1ряд", "д1т", "д1х", "д1ч", "д2воя", "д5зем", "д5зи", "да4о", "дву1ш", "дву2х1", "дд2в", "де1ст", "де1х", "де2ес", "де2з1а2", "де2з1о2", "де2о", "дес2к", "ди2ад", "ди2ам", "ди2в1л", "ди2о5с", "ди2об", "ди2с1е", "ди5он", "ди5х", "дис1тр", "дмо1с", "дно5д", "до1бр", "до1д2", "до1з", "до1п", "до1рв", "до1с2п", "до1сн", "до1ш2", "до2ру", "до6бла", "дох1л", "дро2ж3ж", "дря2б1", "дс2н", "дс3кн", "ду1п", "ду1ст", "ду2о", "ду2п3л", "дым1н", "дэ1г", "е1а", "е1ба", "е1бе", "е1би", "е1бо", "е1бр", "е1бу", "е1бы", "е1бье", "е1бью", "е1бья", "е1бю", "е1бя", "е1ва", "е1ве", "е1ви", "е1во", "е1ву", "е1вы", "е1вье", "е1вью", "е1вья", "е1вю", "е1вя", "е1га", "е1гд", "е1ге", "е1ги", "е1глам", "е1го", "е1гу", "е1д2лин", "е1да", "е1де", "е1ди", "е1до", "е1ду", "е1ды", "е1дью", "е1дю", "е1дя", "е1е", "е1жа", "е1же", "е1жо", "е1жу", "е1жье", "е1жьи", "е1жью", "е1жья", "е1за", "е1зе", "е1зи", "е1зо", "е1зу", "е1зы", "е1зью", "е1зья", "е1зю", "е1зя", "е1и", "е1ка", "е1кв", "е1ке", "е1ки", "е1ку", "е1ла", "е1ле", "е1ли", "е1ло", "е1лу", "е1лы", "е1лье", "е1льи", "е1лья", "е1лю", "е1ля", "е1ма", "е1ме", "е1мо", "е1му", "е1мы", "е1мье", "е1мьи", "е1мью", "е1мья", "е1мя", "е1на", "е1не", "е1ни", "е1но", "е1ну", "е1ны", "е1нье", "е1ньи", "е1нью", "е1нья", "е1нэ", "е1ню", "е1ня", "е1о2кр", "е1па", "е1пе", "е1пи", "е1по", "е1пу", "е1пы", "е1пье", "е1пьи", "е1пью", "е1пья", "е1пя", "е1ра", "е1ре", "е1ри", "е1ро", "е1ру", "е1ры", "е1рье", "е1рью", "е1рья", "е1рю", "е1ря", "е1с2г", "е1с2клад", "е1с2пот", "е1са", "е1сб", "е1сд", "е1се", "е1си", "е1ск", "е1см", "е1со", "е1сок.", "е1ста", "е1ств", "е1сте", "е1сти", "е1стр", "е1сту", "е1сты", "е1стье", "е1стью", "е1стья", "е1стю", "е1стя", "е1су", "е1сы", "е1сье", "е1сьи", "е1сью", "е1сья", "е1тье", "е1тьи", "е1тью", "е1тья", "е1тю", "е1у2", "е1фа", "е1фе", "е1фи", "е1фо", "е1фу", "е1ха", "е1хе", "е1хи", "е1хо", "е1ху", "е1ца", "е1це", "е1ци", "е1цо", "е1цу", "е1ча", "е1че", "е1чи", "е1чу", "е1чье", "е1чьи", "е1чью", "е1чья", "е1ша", "е1ше", "е1ши", "е1шл", "е1шо", "е1шта", "е1шу", "е1шью", "е1ща", "е1ще", "е1щи", "е1що", "е1щу", "е1щью", "е1э", "е1ю", "е1я", "е2в1мо", "е2в1рит", "е2д1о2щ", "е2оди", "е2она", "е2оро", "е2пси", "е2р1у2п", "е2с1би", "е2с3пу", "е2х1у2ч", "е2хк", "е3жи", "е3звон", "е3ола", "е3он.", "е3та", "е3те", "е3ти", "е3то", "е3ту", "е3ты", "е3тя", "е5ми", "е5ол.", "е5олы", "е5охл", "е5ста.", "е6стиг", "еа2де", "еа2з", "еа2т1р", "еа6да", "ев2ним", "ев2нят", "ево2с", "ег1ла.", "ег1ло", "ег1лы", "еж1м", "еж1р", "ежа6т", "ез1во", "ез5ви", "еи2г", "еи2д", "еи2м", "ек1н", "ек1сту", "ем1не", "ем1ного", "ем1ч", "ен1ри", "ео1с", "ео2б", "ео2дет", "ео2ж", "ео2кон", "ео2ру", "ео2ч", "ео2щ", "ео6хв", "еоб1л", "еоу4", "еп1ле", "еп1ли.", "еп1та", "еп1то", "еп5те", "еп5тич", "еп5тур", "епи1т2р", "ер1ват", "ер1тя", "ер6кл", "ере1д2р", "ере1дв", "ере1зв", "ере1п", "ере1с2с", "ере5гн", "ереп2л", "ери1ск", "ерис2", "еро6б", "ес1п", "ес2кле", "ес2кош", "ес2пас", "ес5кур", "ескрип1", "ет1л", "ет1р", "ет2рд", "еу3то", "ех1о2к", "ех5об", "еш1то", "ж1б", "ж1ж", "ж1з", "ж1л", "ж1ма", "ж1н", "ж1п", "ж1с", "ж1т", "ж1ч", "ж2же", "жат1в", "же1с2п", "же5д2", "жео2", "жи2в1л", "жи2л1от", "жи2л1у2п", "з1акт", "з1вк", "з1вя", "з1г", "з1дв", "з1де", "з1ди", "з1ду", "з1ды", "з1дя", "з1з", "з1л", "з1не", "з1ни", "з1но", "з1ну", "з1ню", "з1общ", "з1окс", "з1орг", "з1п", "з1ра", "з1род", "з1ряд", "з1т", "з1ц", "з1ч", "з1ш", "з1э", "з2вук", "з2вяк", "з2г1ни", "з2г1ну", "з2рак", "з2рач", "з5вет", "з5гна", "з5дом", "з5рез", "з6вон", "з6ть", "за1вче", "за1г2", "за1др", "за1з2", "за1кв", "за1р2д", "за1р2ж", "за1с", "за1х", "за1ш", "за2шк", "за3тм", "за5тв", "за5у", "зае2", "зан5с6", "зас2н", "зас4по", "зат2", "зач2т", "зая6", "зв2н", "зве2т3в", "зд2ва", "зди2с", "зз2л", "зи6ни", "зи6оно", "зо1б", "зо1д2р", "зо1з2", "зо1м2н", "зо1рв", "зо1с2", "зо1щ", "зо2бил", "зо3м2л", "зок2", "и1а", "и1ба", "и1бе", "и1би", "и1бо", "и1бр", "и1бу", "и1бы", "и1бье", "и1бью", "и1бю", "и1в2с", "и1ва", "и1ве", "и1ви", "и1во", "и1ву", "и1вье", "и1вью", "и1вья", "и1вя", "и1га", "и1ге", "и1ги", "и1гл", "и1го", "и1гу", "и1да", "и1де", "и1ди", "и1до", "и1др", "и1ду", "и1ды", "и1дю", "и1дя", "и1е", "и1жа", "и1же", "и1жж", "и1жи", "и1жо", "и1жу", "и1з2вез", "и1за", "и1зе", "и1зи", "и1зна", "и1зо", "и1зр", "и1зу", "и1зы", "и1зью", "и1зю", "и1зя", "и1и", "и1ка", "и1кв", "и1ке", "и1ки", "и1ко", "и1ку", "и1кю", "и1ла", "и1ле", "и1ли", "и1ло", "и1лу", "и1лы", "и1лье", "и1льи", "и1лья", "и1лю", "и1ля", "и1ма", "и1ме", "и1мо", "и1му", "и1мы", "и1мье", "и1мьи", "и1мью", "и1мья", "и1мя", "и1на", "и1не", "и1ни", "и1но", "и1ну", "и1ны", "и1нье", "и1ньи", "и1нью", "и1нья", "и1ню1", "и1ня", "и1о", "и1па", "и1пи", "и1пл", "и1по", "и1пу", "и1пы", "и1пью", "и1пю", "и1пя", "и1ра", "и1ре", "и1ри", "и1ро", "и1ру", "и1ры", "и1рье", "и1рьи", "и1рью", "и1рья", "и1рю", "и1ря", "и1с2ни", "и1са", "и1се", "и1си", "и1со", "и1ста", "и1сте", "и1сти", "и1стра", "и1сту", "и1сты", "и1стье", "и1стью", "и1стья", "и1стю", "и1стя", "и1су", "и1сы", "и1сье", "и1сьи", "и1сью", "и1сья", "и1сю", "и1т2раг", "и1т2рес", "и1т2рон", "и1те", "и1ти", "и1то", "и1ту", "и1ты", "и1тье", "и1тью", "и1тья", "и1тю", "и1тя", "и1у", "и1фа", "и1фе", "и1фи", "и1фо", "и1фу", "и1ха", "и1хе", "и1хи", "и1хо", "и1ху", "и1ца", "и1це", "и1ци", "и1цо", "и1цу", "и1ча", "и1че", "и1чи", "и1чу", "и1чье", "и1чьи", "и1чью", "и1чья", "и1ш2п", "и1ша", "и1ше", "и1ши", "и1шл", "и1шо", "и1шу", "и1шье", "и1шью", "и1шья", "и1ща", "и1ще", "и1щи", "и1що", "и1щу", "и1э", "и1ю", "и1я", "и2а1г", "и2ап", "и2аф", "и2евод", "и2к1ч", "и2л1а2ц", "и2о1с2к", "и2опр", "и2ох", "и2оц", "и2пси", "и2с1тин", "и2т1л", "и2ш1лы", "и2юл", "и2юн", "и5гд", "и5ми", "и5оле", "и5пе", "и5та", "и6п5тиз", "и6тот", "иа1ск", "иас2", "иг1н", "ид1ц", "иди3ом", "иди5а", "ие2ди", "из1в", "из1д", "из1реч", "из2ва", "из2гн", "изг1не", "изо1т", "изо2б1р", "изо2о", "изыс1", "ик1н", "икс1ту", "иле1п", "иле2п1л", "иль1д", "им1н", "ино1д2ра", "ино1с", "инс2", "иню2ш", "ио2ста", "ио5сп", "иоб1ре", "ип1та", "ип1те", "ип1то", "ип1ту", "ир5в", "ис1б", "ис1к", "ис1м", "ис1п", "ис1тек", "ис1ч", "ис5тец", "иск1н", "ист1в", "ит1ва", "ит1ве", "ит1р", "ит5ву", "иу2г", "иу2ч", "иу6р", "ия2д", "й2дв", "й2ль", "й2мс", "й2нв", "й2с1б", "й2сн", "й2сш", "й5о", "й6с5ф", "йер1в", "йко5п", "йс2ко", "йх2ск", "к1д", "к1на", "к1но", "к1п", "к1ск", "к1х", "к1ч", "к2вак", "к2о1бес", "к2св", "к2сл", "к2ст1ак", "к5ж", "к5лий", "к5сте.", "ка1д", "ка1сп", "ка1ст", "ка2д1р", "ка2дн", "ка2ж1д", "ка2п1л", "ка2п1ре", "ка3ус", "каз1на", "кам5н", "каш3л", "ква2д1р", "ке1ст", "ке5гли", "ке5д", "кеп1ти", "ки3о2с3к", "ки4с3л", "ки5о", "клю1ч", "клю2чн", "кно2п3л", "ко1знан", "ко1ск", "ко2мин", "ко2с3н", "ко2св", "ко2тл", "ко5ств", "ког2н", "копу5", "кор1в", "кос1мо", "кост1ля", "кри2о5", "кро2пл", "кс1п", "кс1тр", "кт2рис", "кус1к", "л1ба", "л1би", "л1бо", "л1в", "л1г", "л1д6", "л1жа", "л1же", "л1жи", "л1за", "л1зе", "л1зо", "л1зы", "л1к", "л1л", "л1м", "л1п", "л1т", "л1ф", "л1х6", "л1ц", "л1ча", "л1че", "л1чи", "л1чу", "л1чь", "л1ш6", "л1щ", "л2вк", "л2вн", "л2вст", "л2гат", "л2ль", "л2тк", "л5бы", "л6т5л", "лау1", "ле1т2р", "ле2б1л", "ле2о", "ле2п1т", "лег5л", "лен2д1р", "леп5ло", "ли2б1р", "ли2в1л", "ли2к1в", "ли2п1л", "ли2т1уп", "ли2тоб", "ли5стр", "ли6ос", "ли6х5в", "лк1н", "ллю1", "ло1д6р", "ло1з", "ло1пл", "ло1ску", "ло6бор", "лос5ка", "лох5л", "лс2то", "лу1д2", "лу1с", "лу2д3к", "лу2д3л", "лу2д3н", "лу3б2р", "лу5т", "лф2т", "ль2тот", "люк1в", "м1г", "м1ж", "м1з", "м1к", "м1на", "м1нее.", "м1ней.", "м1ное", "м1нос", "м1с", "м1ф", "м1ц", "м2м1н", "м2мк", "м2с1ор", "м2сти", "м5неп", "м5ний", "м5нов", "м5нот", "м5х", "м5э", "м6ат", "м6ль", "ма1сб", "ма2вз", "ма2с1л", "ма2т1р", "ма2у", "ма6чт", "маг1н", "мад1ри", "ман2д1арм", "мат1в", "ме2д1осм", "ме2о", "ме2с1к", "ме2ч1т", "межо2т1", "мете2о", "мз6д", "ми2ок", "ми6з5ан", "миро3з2", "много1", "мо1м", "мо1п", "мо1ско", "мо2ж3ж", "мо2т3р", "мо3о", "моз2г1л", "моск1в", "мосо2м3н", "мп2л", "мпо2ч", "мс2н", "му1г", "му5с6к", "мы4с3л", "н1б", "н1в2", "н1г", "н1д", "н1ж", "н1з", "н1к", "н1л", "н1м", "н1н", "н1п", "н1т", "н1ф", "н1х", "н1ч", "н1щ", "н2дв", "н2дг", "н2дл", "н2дн", "н2с1ля", "н2с1м", "н2сн", "н2сф", "н2тк", "н2тл", "н2тр1а2г", "н2трок", "н2тш", "н2шн", "н6дц", "на1з2", "на1кв", "на1м2ного", "на1мн", "на1рв", "на1х", "на1шл", "на1шп", "на3ивн", "на3из", "на3ит", "на5э", "наи1с2к", "нао2т", "нау6ч", "нгоу5", "нд2сп", "нд6з", "нде2с1", "не1в2д", "не1гл", "не1гн", "не1др", "не1зн", "не1мн", "не1п2", "не1с2н", "не1с2п", "не1ст", "не1сч", "не1т2р", "не2а3по", "не2вра", "не2рот", "не3о2гр", "не3о2дин", "не3о6с", "не5кст", "не5рж", "не5с6х", "нев2п", "недо1с", "нее6", "неи2", "нео2п", "нео2пр", "нео2р", "нео2х", "нео2ц", "нес2к", "нет2л", "неу5стр", "нея6", "ни1п", "ни1стр", "ни5кт", "нила6", "нк5ро", "нко1п", "но1з", "но1п", "но1тв", "но2пт", "но5е", "но5о", "но5ш", "ном5н", "ноп2л", "нсу2р", "нт2р", "нтиа2", "нтио2", "ну1ск", "ну1т2р", "о1бе", "о1би", "о1бо", "о1бу", "о1бы", "о1бье", "о1бьи", "о1бью", "о1бья", "о1в2в", "о1в2се", "о1в2т", "о1ва", "о1ве", "о1ви", "о1вм", "о1во", "о1ву", "о1вы", "о1вье", "о1вьи", "о1вью", "о1вья", "о1вя", "о1га", "о1ге", "о1ги", "о1го", "о1гу", "о1да", "о1де", "о1ди", "о1до", "о1дру", "о1ду", "о1ды", "о1дью", "о1дю", "о1дя", "о1е", "о1жа", "о1же", "о1жже", "о1жи", "о1жм", "о1жо", "о1жу", "о1жье", "о1жьи", "о1жью", "о1жья", "о1зе", "о1зи", "о1зо", "о1зу", "о1зы", "о1зье", "о1зьи", "о1зью", "о1зья", "о1зя", "о1ка", "о1кв", "о1ке", "о1ки", "о1ко", "о1ку", "о1ла", "о1ле", "о1ли", "о1лу", "о1лы", "о1лье", "о1льи", "о1лья", "о1лю", "о1ля", "о1ма", "о1ме", "о1ми", "о1мо", "о1му", "о1мч", "о1мы", "о1мье", "о1мья", "о1мя", "о1на", "о1не", "о1ни", "о1но", "о1ну", "о1ны", "о1нье", "о1ньи", "о1нью", "о1нья", "о1ню", "о1ня", "о1о2", "о1па", "о1пе", "о1пи", "о1по", "о1пу", "о1пы", "о1пье", "о1пьи", "о1пью", "о1пья", "о1пя", "о1ра", "о1рват", "о1ре", "о1ри", "о1ро", "о1ру", "о1рье", "о1рью", "о1рья", "о1рю", "о1ря", "о1с2кла", "о1с2пор", "о1с2то", "о1с2шив", "о1са", "о1сб", "о1се", "о1си", "о1сне", "о1сним", "о1спе", "о1ста", "о1сте", "о1сти", "о1стр", "о1сту", "о1сты", "о1стье", "о1стьи", "о1стью", "о1стья", "о1стю", "о1стя", "о1су", "о1сче", "о1сы", "о1сье", "о1сьи", "о1сью", "о1сья", "о1сю", "о1та", "о1то", "о1ту", "о1ты", "о1тье", "о1тьи", "о1тью", "о1тья", "о1тя", "о1фа", "о1фе", "о1фи", "о1фо", "о1фу", "о1фье", "о1фьи", "о1фью", "о1фья", "о1ха", "о1хе", "о1хо", "о1ху", "о1ца", "о1це", "о1ци", "о1че", "о1чи", "о1чл", "о1чу", "о1чье", "о1чьи", "о1чью", "о1чья", "о1ш2л", "о1ша", "о1ше", "о1ши", "о1шо", "о1шу", "о1шье", "о1шью", "о1ща", "о1ще", "о1щи", "о1щу", "о1щью", "о1ю", "о1я", "о2б1раж", "о2б1раз", "о2в1па", "о2вры", "о2д1о2бол", "о2д1о2дея", "о2д3раж", "о2дотр", "о2евр", "о2з1вол", "о2з1но", "о2з1ну", "о2з1об", "о2зня", "о2зым", "о2зьт", "о2к1а2у", "о2нн", "о2ф1ак", "о2ф1ра", "о2ш3лы", "о3в2люб", "о3ло", "о3отр", "о3с2бер", "о3ти", "о5двиг", "о5ом", "о5пте", "о5ру.", "о5спу", "о5ть6м", "о5х6т", "о5ча", "о6тва", "о6шн", "об1в", "об1о2с3н", "об1ращ", "об2луди", "об5лик", "об5лич", "об5рад", "об5рам", "ово5стр", "овыс2п", "од1ра", "од1рос", "од1э", "од2лит", "оди5ап", "одо1с", "одс2п", "одь1яч", "ое2д", "ое2с", "оз1до", "оз1ро", "оз2дор", "оз5дю", "озо2б1л", "ои2г6", "ои2з", "ои2ме", "ои2му", "ои6о", "ок1з", "ок1ну", "ок5не", "олу3д4", "олуо2", "оль1д", "ом1ного", "ом1р", "ом2ня", "он2трат", "он6тру", "онс2", "оп1та", "оп1ти", "ор1исп", "ор2б1л", "ор5ть", "ор5тя", "орас6пр", "ос1ка.", "ос1кам", "ос1ках", "ос1ке", "ос1ки", "ос1кой", "ос1ку.", "ос1мет", "ос1мос", "ос1пы", "ос2н", "ос2с1м", "ос2св", "ос3ного", "ос3ною", "ос5ба", "ос5ми", "ос5нит", "ос6пле", "от1в", "от1л", "от1раз", "от1у2ж", "от1у2т", "от1у2ч", "от2лев", "ото1д2ра", "ото2чь", "оту2а", "оту2че", "офо2р", "ох1рис", "оэ5ти", "оя2в", "оя2д", "оя2з", "оя6р", "п1д", "п1ла.", "п1лен", "п1лютс", "п1ля", "п1ск", "п1тр", "п1туа", "п1ты", "п1тя", "п1щ", "п2леде", "п2ляс", "п2ляш", "п3леть.", "п5лова", "п5тил", "п6е", "па1с2к", "па2в", "па2с1то", "па2ск1в", "па5во", "па5др", "пав1л", "пах1л", "пе2п1л", "пе2тл", "пе6с5к", "пеп1т", "пер1в", "пер2м1ал", "пере3о6с", "пи2ск", "пи5с2коп", "пле2в1р", "по1д2раг", "по1з", "по1мн", "по1п", "по1ск", "по1см", "по1сх", "по1х", "по2д1ж", "по2д1о2к", "по2д1о2си", "по2д1руб", "по2д1рул", "по2д1рум", "по2д1руч", "по2д1у2ро", "по2дь", "по3вли", "по5б", "по5сс", "пог6", "пое2", "поз2л", "пос2", "поэ1м", "ппо1д", "пре2до2т", "пре2дох", "прей2с1к", "при1в2н", "при1вк", "при1л", "при1с", "при1т", "при2тч", "приль2", "прис2п", "приче2с1к", "про1д2л", "про1д2ра", "про1р", "про1ск", "пт1в", "пу2б1л", "пуг1л", "пуг3н", "пх6н", "р1б", "р1ва.", "р1вар", "р1вац", "р1веж", "р1вей", "р1вен", "р1ви", "р1во", "р1г", "р1д", "р1ж", "р1за", "р1зе", "р1зи", "р1зо", "р1зя", "р1к", "р1л", "р1м", "р1н", "р1п", "р1р", "р1с", "р1та", "р1те", "р1ти", "р1то", "р1тр", "р1ту", "р1ты", "р1тью", "р1тю", "р1ф", "р1ха", "р1хе", "р1хло", "р1хов", "р1хуш", "р1ц", "р1ч", "р1ш", "р1щ", "р2г1л", "р2г1н", "р2гв", "р2гг", "р2гот", "р2д1ц", "р2дл", "р2дн", "р2дч", "р2жн", "р2ль", "р2м1н", "р2м5ч", "р2мк", "р2мс", "р2мф", "р2сн", "р2т1акт", "р2т1л", "р2т1об", "р2узл", "р2хв", "р2ш1р", "р2шк", "р2шн", "р2щ3в2", "р5вя", "р5хот", "р6дв", "р6мщ", "р6хре", "ра2зобл", "ра2п1л", "ра2с1та", "ра2с1тер", "ра2с1то", "ра2с1ту", "ра2с1тя", "ра2так", "ра3зорен", "ра3зори", "ра5ун", "ра5ус", "ра6сля", "ра6стуш", "раа6", "раз1в", "рас1пы", "рас1т2л", "рас1тра", "рас1трог", "рас3тян", "расто2пл", "рат1в", "рах1л", "раэ2", "ре1г2н", "ре1зр", "ре1р2", "ре1с2п", "ре1сч", "ре1т2р", "ре2д1о2бе", "ре2д1о2пе", "ре2д1о2се", "ре2д1у2г", "ре2д3о2ли", "ре2допр", "ре2дос", "ре2к1ват", "ре2ос", "ре2х1р", "рег1ли", "ред1р", "рее2", "рей2х", "рем1н", "рео2д", "рео2ц", "реп5ло", "ри1дв", "ри1жм", "ри1зв", "ри1мч", "рис2м", "риу2", "рк1н", "рк6ни", "ро1дв", "ро1зв", "ро1зр", "ро1пл", "ро1с2кл", "ро1см", "ро1х", "ро2г1не", "ро2г1ну", "ро2с1л", "ро2х1н", "ро5бр", "ро5спа", "ро5спл", "ро5шт", "рое6х", "рои2с", "рооп1р", "рор2в", "рпус1к", "рро1", "ррос6", "рс6п", "рт1в", "рт1лю", "руг1в", "руг1л", "руг1н", "рх1оп", "ры2г1н", "рыт1в", "рых1", "рю5ква", "рю5кве", "с1вен", "с1да", "с1до", "с1н", "с1па", "с1пил", "с1пит", "с1пл", "с1с", "с1хо", "с1ц", "с1чат", "с1чл", "с1ш6", "с1щ", "с2воя", "с2гор", "с2добн", "с2катн", "с2клер", "с2пеш", "с2раб", "с2рез", "с2сб", "с2сн", "с2сори", "с2тяну", "с2цена", "с3с2не", "с5ге", "с5ди", "с5на.", "с5ное", "с5ной", "с5ном", "с6как", "са2б1л", "само1", "сва6е", "свах2", "све2т", "све2т1л", "свер2хи", "сверх1", "сг6", "се1гн", "се1з", "сего1", "сегод2", "секс1т", "сер1ве", "сер5ва", "си2п1л", "си3ом", "ск1ну", "ск2вер", "ско2б1л", "смо2г1л", "сму2г1", "со1бр", "со1д2ра", "со1ж", "со1з", "со1л2г", "со1м2", "со1р2в", "со1с2", "со1тв", "со2в1м", "со2сь", "со2тле", "со3з2да", "со5вл", "со5о", "со5щ", "со6с5н", "сп2люсь.", "сс1во", "ст1ли", "ст5вер", "ств2л", "сто1пл", "су1гл", "су2б", "су2ев", "су2ни", "суб1а", "суб1л", "супе2р1", "сче2с1к", "съ2е3ма", "съе3д", "съе3л", "съе3мо", "съе3х", "сы2п3ле", "сып1лю", "т1вой", "т1вою", "т1д2", "т1ж", "т1з", "т1к", "т1лог", "т1рез", "т1рыв", "т1ха", "т1хо", "т1ч", "т1ш2", "т2вл", "т2рав", "т2сд", "т4рщ", "та1ст", "таме2н", "тво1з", "те1ст", "те2к1л", "те2ос", "те2п1л", "те2р1ак", "те6хо", "тег1н", "тек1ста", "теле3о", "тем5н", "тер1в", "тере2о", "тет1р2а", "ти1стр", "ти2в1л", "ти2г1л", "ти5а", "ти5ок", "тк2но", "то1бр", "то1д", "то1з", "то1с2", "то2дн", "то2ж1д", "тооп1", "трдо2", "тре2х", "тс2к", "тс2н", "ту2пр", "туп1л", "тыс5к", "ть6му", "у1а", "у1ба", "у1бе", "у1би", "у1бо", "у1бу", "у1бы", "у1бье", "у1бью", "у1бья", "у1бю", "у1бя", "у1ва", "у1ве", "у1ви", "у1во", "у1ву", "у1вы", "у1вье", "у1вью", "у1вя", "у1га", "у1ге", "у1ги", "у1го", "у1гу", "у1да", "у1де", "у1ди", "у1до", "у1ду", "у1ды", "у1дьи", "у1дью", "у1дю", "у1дя", "у1е", "у1жа", "у1же", "у1жи", "у1жо", "у1жу", "у1жье", "у1жьи", "у1жью", "у1жья", "у1за", "у1зе", "у1зи", "у1зо", "у1зу", "у1зы", "у1зья", "у1зя", "у1и", "у1ка", "у1ке", "у1ки", "у1ко", "у1ку", "у1кья", "у1ла", "у1ли", "у1ло", "у1лу", "у1лы", "у1лье", "у1льи", "у1лья", "у1лю", "у1ля", "у1ма", "у1ме", "у1ми", "у1мо", "у1му", "у1мы", "у1мье", "у1мью", "у1мья", "у1мя", "у1на", "у1не", "у1ни", "у1но", "у1ну", "у1ны", "у1нье", "у1ньи", "у1нью", "у1нья", "у1ню", "у1ня", "у1о", "у1па", "у1пе", "у1пи", "у1по", "у1пу", "у1пы", "у1пье", "у1пью", "у1пья", "у1пю", "у1пя", "у1ра", "у1ре", "у1ри", "у1ро", "у1ру", "у1ры", "у1рье", "у1рьи", "у1рью", "у1рья", "у1рю", "у1ря", "у1са", "у1се", "у1си", "у1см", "у1со", "у1ста", "у1сте", "у1сти", "у1сту", "у1сты", "у1стье", "у1стью", "у1стья", "у1стя", "у1су", "у1сф", "у1сы", "у1сье", "у1сью", "у1сья", "у1сю", "у1та", "у1те", "у1ти", "у1тл", "у1то", "у1ту", "у1ты", "у1тье", "у1тью", "у1тья", "у1тю", "у1тя", "у1у", "у1фа", "у1фе", "у1фи", "у1фо", "у1фу", "у1фье", "у1фьи", "у1фью", "у1фья", "у1ха", "у1хе", "у1хи", "у1хо", "у1ху", "у1ца", "у1це", "у1ци", "у1цу", "у1ча", "у1че", "у1чи", "у1чу", "у1чье", "у1чьи", "у1чью", "у1чья", "у1ша", "у1ше", "у1ши", "у1шо", "у1шу", "у1шье", "у1шьи", "у1шью", "у1шья", "у1ща", "у1ще", "у1щи", "у1що", "у1щу", "у1ю", "у1я", "у2б1р", "у2д1р", "у2ес", "у2х1р", "у2хв", "у2ш1лы", "у4ныв", "у5ле", "у5мр", "у5ол", "у5шл", "у5э", "у6але", "у6ас", "у6зел", "у6трь", "уд2в", "уд2рс", "уе1р", "уе2ди", "уз5дю", "ук1в", "ук5н", "укос6", "уль1д", "ум1ног", "уо2к", "ур1в", "ус1ка", "ус1ке", "ус1ки", "ус1ком", "ус1ч", "ус2кр", "ус2по", "ус5ков", "ус5ку.", "ут5ла", "уть6м", "уу2с", "ух1л", "ух1м", "ух1о2к", "уш3п", "уэ5ла", "уэ5ле", "уя2з", "ф1б", "ф1г", "ф1к", "ф1м", "ф1т", "ф1ф", "ф1ш", "ф2узл", "фа5у", "фаг1н", "фар5в", "фе1д", "фе2д1р", "фе2с1к", "фени6", "фи1д", "фи1с2к", "фи2дн", "фи3о", "фи6нин", "фото1", "фра5с", "фре2с1к", "х1б", "х1д6", "х1з", "х1к", "х1ли", "х1ло.", "х1лу", "х1лы", "х1ля", "х1ма", "х1ми", "х1н", "х1осн", "х1п", "х1т", "х1у2ро", "х1ф6", "х1х", "х1ц", "х1ш", "х1э", "х2лип", "х2ляб", "х4ны", "х5ла.", "х5мет", "х5осм", "хе6о5", "хи2зы", "хие2", "хо1тв", "хо2пе", "хоз1ар", "хри2п1л", "хро2м1ч", "ц1б", "ц1д", "ц1н", "ц1р", "ц1ц", "ца2п1л", "це1д", "це2д1р", "цей6т5", "ци2к1л", "ци2ф1р", "ч1в", "ч1н", "ч1с", "ч1ч", "ч1ш", "ча2т1л", "чар3т", "част1в", "чет1вер", "чех1л", "чи2с1л", "чу2ж1д", "ш1к", "ш1ля", "ш1м", "ш1н", "ш1с", "ш1ц", "ш2кив", "ш2лем", "ш2лют.", "ш2пр", "ш5ч", "ш6леш", "шаг1н", "ше1с", "шео2", "ши2в1л", "ши2ф1р", "ще1д", "ще1с", "ще2д1р", "щи2п3л", "ъ1я2", "ъе2", "ъе3х", "ъем3н", "ъю6с", "ъю6т", "ы1ба", "ы1бе", "ы1би", "ы1бо", "ы1бр", "ы1бу", "ы1бы", "ы1бье", "ы1бьи", "ы1бью", "ы1бья", "ы1бя", "ы1ва", "ы1ве", "ы1ви", "ы1во", "ы1ву", "ы1вы", "ы1вя", "ы1г", "ы1га", "ы1ге", "ы1ги", "ы1го", "ы1гу", "ы1да", "ы1дв", "ы1де", "ы1ди", "ы1до", "ы1ду", "ы1ды", "ы1дю", "ы1дя", "ы1е2", "ы1жа", "ы1же", "ы1жж", "ы1жи", "ы1жм", "ы1жо", "ы1жр", "ы1жу", "ы1за", "ы1зв", "ы1зд", "ы1зе", "ы1зо", "ы1зр", "ы1зу", "ы1зы", "ы1зя", "ы1и2", "ы1ка", "ы1ке", "ы1ки", "ы1ко", "ы1ку", "ы1ла", "ы1ле", "ы1ли", "ы1ло", "ы1лу", "ы1лы", "ы1лье", "ы1льи", "ы1лья", "ы1лю", "ы1ля", "ы1ма", "ы1ме", "ы1ми", "ы1мо", "ы1му", "ы1мы", "ы1мя", "ы1на", "ы1не", "ы1ни", "ы1но", "ы1ну", "ы1ны", "ы1нье", "ы1ньи", "ы1нью", "ы1нья", "ы1ню", "ы1ня", "ы1па", "ы1пе", "ы1пи", "ы1по", "ы1пу", "ы1пы", "ы1пье", "ы1пью", "ы1пя", "ы1ра", "ы1рв", "ы1ре", "ы1ри", "ы1ро", "ы1ру", "ы1ры", "ы1рье", "ы1рью", "ы1рья", "ы1рю", "ы1ря", "ы1са", "ы1се", "ы1си", "ы1со", "ы1ст", "ы1ста", "ы1сте", "ы1сти", "ы1сту", "ы1сты", "ы1стью", "ы1су", "ы1сы", "ы1сье", "ы1сьи", "ы1сью", "ы1сья", "ы1т6р", "ы1та", "ы1те", "ы1ти", "ы1то", "ы1ту", "ы1ты", "ы1тье", "ы1тьи", "ы1тью", "ы1тья", "ы1тя", "ы1у2", "ы1ха", "ы1хе", "ы1хи", "ы1хо", "ы1ху", "ы1ц", "ы1ца", "ы1це", "ы1ча", "ы1че", "ы1чи", "ы1чу", "ы1чье", "ы1чьи", "ы1чью", "ы1чья", "ы1ша", "ы1ше", "ы1ши", "ы1шо", "ы1шу", "ы1шью", "ы1шья", "ы1ща", "ы1ще", "ы1щи", "ы1що", "ы1щу", "ы1я2", "ы2з1вол", "ы2с1ку", "ы5см", "ы6шн", "ык1в", "ык5н", "ым1ч", "ып1ле", "ыре2х", "ыс2мей", "ыс5ки", "ыс6па", "ыс6пл", "ыш1ле", "ь1б", "ь1ва", "ь1ве", "ь1ви", "ь1г", "ь1де", "ь1ди", "ь1ж", "ь1з", "ь1к", "ь1м", "ь1н", "ь1п", "ь1с", "ь1т", "ь1х", "ь1ч", "ь1ш", "ь1щ", "ь1э", "ь2к1ло", "ь2нул", "ь2сн", "ь2сти", "ь2стя", "ь2ф1ра", "ь5дь", "ь5дя", "ь5фе", "ь6зн", "ь6зя.", "ь6мс", "ь6ща", "ь6ще", "ь6щу", "ьдо1", "ьк5н", "ьти5с", "ьхо2", "э1ля", "э1нь", "э1о", "э1я", "э2д", "э5зи", "э5ка", "э5ке", "э5лы", "э5ри", "э5ш", "э6в", "э6ф", "эд1р", "эк1в", "эк1з", "эк1л", "эк2ск", "экс1", "экс2и", "эль5", "эро1", "эс1к", "эс2па", "эс5м", "ю1а", "ю1б", "ю1ба", "ю1бе", "ю1би", "ю1бо", "ю1бу", "ю1бы", "ю1бя", "ю1ва", "ю1ве", "ю1ви", "ю1во", "ю1ву", "ю1вы", "ю1га", "ю1ге", "ю1ги", "ю1го", "ю1гу", "ю1да", "ю1де", "ю1ди", "ю1до", "ю1ду", "ю1ды", "ю1дью", "ю1дя", "ю1е", "ю1жа", "ю1же", "ю1жи", "ю1жо", "ю1жу", "ю1жье", "ю1жьи", "ю1жью", "ю1жья", "ю1за", "ю1зе", "ю1зи", "ю1зо", "ю1зу", "ю1зы", "ю1зю", "ю1зя", "ю1и", "ю1ка", "ю1ке", "ю1ки", "ю1ко", "ю1ку", "ю1ла", "ю1ле", "ю1ло", "ю1лу", "ю1лы", "ю1лю", "ю1ля", "ю1ма", "ю1ме", "ю1ми", "ю1мо", "ю1му", "ю1мы", "ю1на", "ю1не", "ю1ни", "ю1но", "ю1ну", "ю1ны", "ю1ню", "ю1ня", "ю1о", "ю1па", "ю1пи", "ю1по", "ю1ра", "ю1ре", "ю1ри", "ю1ро", "ю1ру", "ю1ры", "ю1рю", "ю1ря", "ю1са", "ю1се", "ю1со", "ю1ста", "ю1сте", "ю1сти", "ю1стр", "ю1сту", "ю1сты", "ю1стью", "ю1стя", "ю1су", "ю1сы", "ю1сю", "ю1та", "ю1те", "ю1ти", "ю1то", "ю1ту", "ю1ты", "ю1тя", "ю1фа", "ю1фе", "ю1фя", "ю1ха", "ю1хе", "ю1хи", "ю1хо", "ю1ху", "ю1це", "ю1ци", "ю1ша", "ю1ше", "ю1ши", "ю1шо", "ю1шу", "ю1ща", "ю1ще", "ю1щи", "ю1що", "ю1щу", "ю1ю", "ю1я", "ю2бч", "ю2д1ж", "ю2ли", "ю2с1к", "юй2д1", "юйдо6", "юк1з", "юк1н", "юм1н", "юмини5", "я1ба", "я1бе", "я1би", "я1бо", "я1бр", "я1бу", "я1бы", "я1бью", "я1бя", "я1ва", "я1ве", "я1ви", "я1во", "я1ву", "я1вы", "я1вью", "я1вя", "я1га", "я1ге", "я1ги", "я1го", "я1гу", "я1да", "я1де", "я1ди", "я1до", "я1ду", "я1ды", "я1дью", "я1дю", "я1дя", "я1е", "я1жа", "я1же", "я1жи", "я1жо", "я1жу", "я1жье", "я1жьи", "я1жью", "я1жья", "я1за", "я1зе", "я1зи", "я1зо", "я1зу", "я1зы", "я1зью", "я1зья", "я1зю", "я1зя", "я1и", "я1ка", "я1ке", "я1ки", "я1ко", "я1ку", "я1ла", "я1ле", "я1ли", "я1ло", "я1лу", "я1лы", "я1лю", "я1ля", "я1ма", "я1ме", "я1ми", "я1мо", "я1му", "я1мы", "я1мя", "я1на", "я1не", "я1ни", "я1но", "я1ну", "я1ны", "я1нье", "я1ньи", "я1нью", "я1нья", "я1ню", "я1ня", "я1па", "я1пе", "я1пи", "я1по", "я1пу", "я1пы", "я1пье", "я1пью", "я1пья", "я1пя", "я1ра", "я1ре", "я1ри", "я1ро", "я1ру", "я1ры", "я1рье", "я1рью", "я1рья", "я1ря", "я1са", "я1се", "я1си", "я1со", "я1ста", "я1сти", "я1сту", "я1сты", "я1стье", "я1стью", "я1стья", "я1су", "я1сы", "я1та", "я1те", "я1то", "я1ту", "я1ты", "я1тье", "я1тью", "я1тья", "я1тю", "я1тя", "я1у", "я1ха", "я1хе", "я1хи", "я1хо", "я1ху", "я1ца", "я1це", "я1ци", "я1цу", "я1ча", "я1че", "я1чи", "я1чу", "я1чье", "я1чьи", "я1чью", "я1чья", "я1ша", "я1ше", "я1ши", "я1шо", "я1шу", "я1ща", "я1ще", "я1щи", "я1що", "я1щу", "я1ю", "я1я", "я2в1л", "я5стр", "я5ти", "яг1л", "яг5н", "яз1в", "як1н", "яс1к", "яс6т", "ят1в", "ях1ле"];
const trie={},cache=new Map();for(const pattern of patterns){if(!pattern||pattern.startsWith('%'))continue;let letters='',values=[0];for(const ch of pattern){if(/[0-9]/.test(ch))values[values.length-1]=+ch;else{letters+=ch;values.push(0);}}let node=trie;for(const ch of letters)node=node[ch]||(node[ch]={});node.values=values;}
C.hyphenateRussian=text=>String(text||'').replace(/[А-Яа-яЁё]{4,}/g,word=>{if(cache.has(word))return cache.get(word);const lower='.'+word.toLowerCase()+'.',values=Array(lower.length+1).fill(0);for(let i=0;i<lower.length;i++){let node=trie;for(let j=i;j<lower.length;j++){node=node[lower[j]];if(!node)break;if(node.values)node.values.forEach((n,k)=>values[i+k]=Math.max(values[i+k],n));}}let out='';for(let i=0;i<word.length;i++){out+=word[i];if(i>=1&&i<word.length-2&&values[i+2]%2)out+='­';}if(cache.size>3000)cache.clear();cache.set(word,out);return out;});
})(globalThis.Core);

/* 0.7.2: visible segments, local route edits and connected-port snapping. */
(function(C){
 const previous={...C},vectors={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 function routeSegments(route){const points=C.simplifyRoute(route?.points||[]);return points.slice(0,-1).map((a,index)=>{const b=points[index+1];return {index,a,b,length:distance(a,b),vertical:Math.abs(a.x-b.x)<.001,terminal:index===0||index===points.length-2};});}
 function labelPlacement(edge,route){
  if(edge.labelCentered===false)return {x:route.x,y:route.y-7,angle:0};
  const segments=routeSegments(route);if(!segments.length)return {x:route.x,y:route.y-7,angle:0};
  const chosen=segments.find(s=>s.index===edge.labelSegment)||[...segments].sort((a,b)=>(b.length+(b.vertical?0:80))-(a.length+(a.vertical?0:80)))[0];
  return {x:(chosen.a.x+chosen.b.x)/2+(chosen.vertical?-7:0),y:(chosen.a.y+chosen.b.y)/2-(chosen.vertical?0:7),angle:chosen.vertical?-90:0,segment:chosen.index};
 }
 function validPath(ps,e,ns){
  if(ps.length<2)return false;const s=ps[0],t=ps.at(-1),sv=vectors[C.endpoint(ns.get(e.source),e.sourcePort,'right').side],tv=vectors[C.endpoint(ns.get(e.target),e.targetPort,'left').side];
  if((ps[1].x-s.x)*sv.x+(ps[1].y-s.y)*sv.y<=0||(ps.at(-2).x-t.x)*tv.x+(ps.at(-2).y-t.y)*tv.y<=0)return false;
  if(ps.length>2&&distance(ps.at(-2),t)<18)return false;
  const crosses=(a,b,n)=>Math.abs(a.x-b.x)<.001?a.x>n.x+.5&&a.x<n.x+n.w-.5&&Math.max(a.y,b.y)>n.y+.5&&Math.min(a.y,b.y)<n.y+n.h-.5:a.y>n.y+.5&&a.y<n.y+n.h-.5&&Math.max(a.x,b.x)>n.x+.5&&Math.min(a.x,b.x)<n.x+n.w-.5;
  return ps.slice(1).every((b,i)=>{const a=ps[i];return (Math.abs(a.x-b.x)<.001||Math.abs(a.y-b.y)<.001)&&![ns.get(e.source),ns.get(e.target)].some(n=>crosses(a,b,n));});
 }
 function storedPath(e,points){const out={...e,manualRouteMode:'polyline',manualRoute:points.slice(1,-1).map(p=>({dx:p.x-points[0].x,dy:p.y-points[0].y}))};delete out.waypoints;if(!out.manualRoute.length){delete out.manualRoute;delete out.manualRouteMode;}return out;}
 function removeVisibleSegment(e,ns,index){
  if(e.bus)throw Error('Сначала выведите ветвь из гребёнки');
  const ps=C.simplifyRoute(C.edgePath(e,ns).points);
  if(index<=0||index>=ps.length-2)throw Error('Конечный сегмент закреплён за портом. Удалите внутренний изгиб или выровняйте порты блоков.');
  const key=Math.abs(ps[index].x-ps[index+1].x)<.001?'x':'y',candidates=[];
  // Collapse onto one adjacent parallel segment. All distant corners stay put.
  for(const value of [ps[index-1][key],ps[index+2][key]]){
   const changed=ps.map(p=>({...p}));changed[index][key]=changed[index+1][key]=value;
   const compact=C.simplifyRoute(changed);if(compact.length>=ps.length||!validPath(compact,e,ns))continue;
   const out=storedPath(e,compact),actual=C.simplifyRoute(C.edgePath(out,ns).points);
   if(actual.length!==compact.length||actual.some((p,i)=>distance(p,compact[i])>.01))continue;
   candidates.push({out,cost:Math.abs(value-ps[index][key])});
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  if(!candidates.length)throw Error('Этот изгиб нужен для подключения к портам. Его удаление разорвёт связь; выровняйте порты блоков.');
  return candidates[0].out;
 }
 function moveVisibleSegment(e,ns,index,delta){const ps=C.simplifyRoute(C.edgePath(e,ns).points);if(index<=0||index>=ps.length-2)return e;const key=Math.abs(ps[index].x-ps[index+1].x)<.001?'x':'y';ps[index][key]+=delta;ps[index+1][key]+=delta;return validPath(ps,e,ns)?storedPath(e,ps):e;}
 function connectionAxis(a,b){if(a.side==='left'&&b.side==='right'&&a.x>b.x||a.side==='right'&&b.side==='left'&&a.x<b.x)return 'y';if(a.side==='top'&&b.side==='bottom'&&a.y>b.y||a.side==='bottom'&&b.side==='top'&&a.y<b.y)return 'x';return null;}
 function snapConnectedMove(nodes,edges,ids,anchorId,dx,dy,zoom=1,mode={},axis=null){
  const out=previous.snapMove(nodes,ids,anchorId,dx,dy,zoom,mode,axis);out.straightEdges=[];if(!mode.connections)return out;
  const ns=new Map(nodes.map(n=>[n.id,n])),moving=new Set(ids),candidates={x:[],y:[]},tolerance=10/Math.max(.05,zoom);
  for(const edge of edges){if(edge.proxy||edge.bus||moving.has(edge.source)===moving.has(edge.target)||!ns.has(edge.source)||!ns.has(edge.target))continue;
   const s=C.endpoint(ns.get(edge.source),edge.sourcePort,'right'),t=C.endpoint(ns.get(edge.target),edge.targetPort,'left'),sm=moving.has(edge.source),own=sm?s:t,other=sm?t:s;
   const shifted={...own,x:own.x+dx,y:own.y+dy},key=connectionAxis(shifted,other);if(!key||axis&&axis!==key)continue;
   const correction=other[key]-shifted[key];if(Math.abs(correction)<=tolerance)candidates[key].push({key,correction,edge,own,other,sm});
  }
  for(const key of ['x','y']){const c=candidates[key].sort((a,b)=>Math.abs(a.correction)-Math.abs(b.correction))[0];if(!c)continue;
   if(key==='x')out.dx=dx+c.correction;else out.dy=dy+c.correction;
   out.guides=out.guides.filter(g=>g.axis!==key);out.guides.push({axis:key,value:c.other[key],kind:'connection',from:c.sm?c.edge.target:c.edge.source,to:c.sm?c.edge.source:c.edge.target});
   out.straightEdges.push(...candidates[key].filter(v=>Math.abs(v.correction-c.correction)<.01).map(v=>v.edge.id));
  }
  return out;
 }
 function normalizeV6(p){previous.normalizeV6(p);for(const pg of p.pages)for(const e of pg.edges)if(e.labelCentered===undefined)e.labelCentered=true;return p;}
 function mergeTable(t,a,b){const range=C.normalizedRange(a,b),options={};for(let r=range.r0;r<=range.r1;r++)for(let c=range.c0;c<=range.c1;c++)Object.assign(options,t.cells[r]?.[c]?.sourceOptions);const out=previous.mergeTable(t,a,b);if(Object.keys(options).length)out.cells[range.r0][range.c0].sourceOptions=options;return out;}
 Object.assign(C,{routeSegments,labelPlacement,removeVisibleSegment,moveVisibleSegment,connectionAxis,snapConnectedMove,normalizeV6,mergeTable});
})(globalThis.Core);

/* 0.7.3: per-row continuation controls and independently movable chain members. */
(function(C){
 const previous={...C};
 const rowKey=(node,row)=>node+'::'+row;
 function rowContinuations(pg){return pg.nodes.flatMap(n=>!n.table?[]:n.table.rowIds.map((id,index)=>({node:n.id,row:id,index,key:rowKey(n.id,id),edges:pg.edges.filter(e=>{const rel=C.edgeRelationship?.(pg,e);return (rel?rel.parent===n.id:e.source===n.id&&e.flow!==false)&&C.port(n,e.source===n.id?e.sourcePort:e.targetPort,'right').rowId===id;})})));}
 function rowCollapseState(pg,rows=new Set(),folds=new Set()){
  const controls=rowContinuations(pg),virtual=new Map(controls.map(r=>[r.key,'row:'+r.key])),ports=new Map(pg.nodes.map(n=>[n.id,n]));
  const nodes=pg.nodes.map(n=>({...n})),edges=pg.edges.map(e=>{const rel=C.edgeRelationship?.(pg,e),parent=rel?.parent||e.source,n=ports.get(parent),side=e.source===parent?'source':'target',r=n?.table&&C.port(n,e[side+'Port'],'right').rowId,key=r&&rowKey(n.id,r);return virtual.has(key)?{...e,[side]:virtual.get(key)}:{...e};}),collapsed=new Set(folds);
  for(const r of controls){nodes.push({id:virtual.get(r.key),type:'text',collapsible:true});edges.push({id:'row-owner:'+r.key,source:r.node,target:virtual.get(r.key),flow:true});if(rows.has(r.key))collapsed.add(virtual.get(r.key));}
  const state=previous.collapseState({...pg,nodes,edges},collapsed),hidden=new Set([...state.hidden].filter(id=>ports.has(id))),owner=new Map(),owners=new Map(),counts=new Map();
  for(const r of controls){if(rows.has(r.key))hidden.delete(r.node);counts.set(r.key,[...(state.sets.get(virtual.get(r.key))||[])].filter(id=>hidden.has(id)).length);}
  const decode=id=>id?.startsWith('row:')?controls.find(r=>virtual.get(r.key)===id):null;
  for(const id of hidden){const root=state.owner.get(id),r=decode(root);owner.set(id,r?.node||root);owners.set(id,r||{node:root});}
  return {hidden,owner,owners,counts,controls};
 }
 function display(pg,folds=new Set(),compact=true,folded=new Set(),options={}){
  const d=previous.display(pg,folds,compact,folded,options),rows=options.collapsedRows||new Set();if(!rows.size)return d;
  const state=rowCollapseState(pg,rows,folds),hidden=new Set([...d.hidden,...state.hidden]),byId=new Map(pg.nodes.map(n=>[n.id,n]));
  d.nodes=d.nodes.filter(n=>!hidden.has(n.id));const shown=new Set(d.nodes.map(n=>n.id));
  for(const id of state.hidden){d.hiddenOwner.set(id,state.owner.get(id));d.map.set(id,state.owner.get(id));}
  const edges=[],seen=new Set();for(const e of d.edges){const sh=hidden.has(e.source),th=hidden.has(e.target);if(sh&&th)continue;
   if(th)continue;let out=e;if(sh){const root=state.owners.get(e.source),source=root?.node||d.hiddenOwner.get(e.source);if(!shown.has(source)||source===e.target)continue;const rowPort=root?.row&&C.ports(byId.get(source)).find(p=>p.rowId===root.row&&p.side==='right');out={...e,source,sourcePort:rowPort?.id||'right',proxy:true};delete out.bus;delete out.manualRoute;delete out.waypoints;}
   if(!shown.has(out.source)||!shown.has(out.target))continue;const key=out.proxy?[out.source,out.sourcePort,out.target,out.targetPort,out.arrow,out.arrowStart].join('|'):out.id;if(seen.has(key))continue;seen.add(key);edges.push(out);
  }
  d.edges=edges;d.hidden=hidden;d.rowCollapseState=state;return d;
 }
 function tableAxis(t,axis,index,remove=false){const out=previous.tableAxis(t,axis,index,remove);if(out.rowBehavior){const ids=new Set(out.rowIds);out.rowBehavior=Object.fromEntries(Object.entries(out.rowBehavior).filter(([id])=>ids.has(id)));}return out;}
 function dragPlan(pg,selection,folds=new Set(),mode={}){
  const selected=new Set(selection),plan=previous.dragPlan(pg,selection,folds,mode);
  if(mode.collapsedRows?.size){const state=rowCollapseState(pg,mode.collapsedRows,folds);for(const [id,owner] of state.owner)if(selected.has(owner))plan.ids.add(id);}
  // Absolute locks pin only those blocks. A pinned descendant must not lock its parent.
  plan.stationary=[...plan.ids].filter(id=>!selected.has(id)&&pg.nodes.find(n=>n.id===id)?.locked);
  for(const id of plan.stationary)plan.ids.delete(id);
  for(const n of pg.nodes)if(n.anchorId&&plan.stationary.includes(n.anchorId))plan.ids.delete(n.id);
  plan.locked=[...selected].filter(id=>pg.nodes.find(n=>n.id===id)?.locked);return plan;
 }
 function internalTarget(p,m){const pageId=m.target?.pageId||m.url?.split(',')[1],page=p.pages.find(pg=>pg.id===pageId);if(!page)return null;if(m.kind==='node'){const node=page.nodes.find(n=>n.id===m.target?.nodeId);return node?{page,node}:null;}return {page};}
 function normalizeV6(p){previous.normalizeV6(p);for(const pg of p.pages)for(const e of pg.edges)if(e.arrowStart===undefined)e.arrowStart=false;for(const m of p.materials||[])if(m.kind==='page'||m.url?.startsWith('data:page/id,')){m.kind='page';m.target||={pageId:m.url?.split(',')[1]};if(!m.title||m.title.startsWith('data:page/'))m.title=internalTarget(p,m)?.page.title||'Внутренняя ссылка на удалённый лист';}return p;}
 function bundleRoutes(d){const out=previous.bundleRoutes(d);for(const b of out.buses){const edges=d.edges.filter(e=>e.bus===b.id);b.arrowStart=b.mode==='out'&&edges.some(e=>e.arrowStart);if(b.mode==='out')for(const e of edges)out.routes.get(e.id).busOutgoing=true;
   for(const segment of b.segments||[]){const terminal=b.terminals.find(t=>t.node===segment.node&&Math.abs(t.tip.x-(segment.points[0]?.x||0))+Math.abs(t.tip.y-(segment.points[0]?.y||0))<.01);segment.arrowStart=!!terminal&&edges.some(e=>e.source===terminal.node&&e.arrowStart&&C.samePort(d.nodes.find(n=>n.id===terminal.node),e.sourcePort,terminal.port,'right'));}
  }return out;}
 Object.assign(C,{rowKey,rowContinuations,rowCollapseState,display,tableAxis,dragPlan,normalizeV6,bundleRoutes,internalTarget});
})(globalThis.Core);

/* Source removal is a single undoable document operation. File contents stay intact. */
(function(C){
 function unlinkHTML(html,id){return typeof html==='string'?html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,(whole,attrs,text)=>{const m=attrs.match(/\bdata-open-material\s*=\s*(["'])(.*?)\1/i);return m&&m[2]===id?text:whole;}):html;}
 function removeMaterial(project,id){
  const material=(project.materials||[]).find(m=>m.id===id);if(!material)return C.clone(project);
  if(project.pages.some(p=>p.nodes.some(n=>n.imageMaterial===id||n.icons?.some(ic=>ic.material===id))))throw new Error('Источник используется как изображение блока. Сначала замените изображение.');
  const out=C.clone(project);out.materials=out.materials.filter(m=>m.id!==id);
  for(const m of out.materials)if(m.previewMaterial===id)delete m.previewMaterial;
  for(const pg of out.pages)for(const n of pg.nodes){n.materials=(n.materials||[]).filter(x=>x!==id);if(n.html)n.html=unlinkHTML(n.html,id);for(const row of n.table?.cells||[])for(const cell of row){if(!cell)continue;if(cell.material===id)delete cell.material;if(cell.materials)cell.materials=cell.materials.filter(x=>x!==id);if(cell.sourceOptions)delete cell.sourceOptions[id];if(cell.html)cell.html=unlinkHTML(cell.html,id);}}
  out.deletedMaterials=[...(out.deletedMaterials||[]).filter(x=>x.id!==id),{id,version:material.version||1}];return out;
 }
 Object.assign(C,{removeMaterial});
})(globalThis.Core);

/* 0.7.5: explicit ownership, scoped symmetry and mixed selection. */
(function(C){
 const prev={...C},annotation=n=>n?.type==='comment'||n?.type==='note'&&!n.flowNode;
 function edgeRelationship(pg,e){const a=pg.nodes.find(n=>n.id===e.source),b=pg.nodes.find(n=>n.id===e.target);if(!a||!b||a.id===b.id)return null;
  // Comments belong to their neighbour regardless of the visible arrow direction.
  if((a.type==='comment')!==(b.type==='comment'))return {parent:a.type==='comment'?b.id:a.id,child:a.type==='comment'?a.id:b.id,annotation:true};
  if(e.parentRole==='none'||e.flow===false)return null;
  if(e.parentRole==='source'||e.parentRole==='target')return {parent:e.parentRole==='source'?a.id:b.id,child:e.parentRole==='source'?b.id:a.id,annotation:false};
  if(e.role!=='flow'&&annotation(a)!==annotation(b))return {parent:annotation(a)?b.id:a.id,child:annotation(a)?a.id:b.id,annotation:true};
  return {parent:a.id,child:b.id,annotation:false};
 }
 function relativeDescendantsGraph(pg,id){const g=C.graph(pg),out=new Set(),queue=[id];for(let i=0;i<queue.length;i++)for(const next of g.adj.get(queue[i])||[])if(next!==id&&!out.has(next)){out.add(next);queue.push(next);}return out;}
 function normalizeV6(p){const tableSizes=new Map(p.pages.flatMap(pg=>pg.nodes.filter(n=>n.table).map(n=>[pg.id+'::'+n.id,{w:n.w,h:n.h}]))),globals=new Map(p.pages.map(pg=>[pg.id,pg.layoutOptions?.busSymmetry===true]));prev.normalizeV6(p);for(const pg of p.pages){for(const b of pg.buses||[]){if(b.symmetry===undefined)b.symmetry=b.autoAlign??globals.get(pg.id);b.autoAlign=!!b.symmetry;b.alignGap||=pg.layoutOptions.symmetryGap||64;}for(const n of pg.nodes){const size=tableSizes.get(pg.id+'::'+n.id);if(size&&Number.isFinite(size.w)&&Number.isFinite(size.h)){n.w=size.w;n.h=size.h;}if(n.type==='decision'&&n.branchSymmetry===undefined)n.branchSymmetry=globals.get(pg.id);}pg.layoutOptions.busSymmetry=false;}return p;}
 function alignTargets(pg,d,hub,edges,axis,gap){const shown=new Map(d.nodes.map(n=>[n.id,n])),heads=[...new Set(edges.map(e=>e.target))].map(id=>shown.get(id)).filter(Boolean);if(heads.length<2)return;
  const size=axis==='y'?'h':'w',perp=axis==='y'?'x':'y',parent=shown.get(hub);if(!parent)return;heads.sort((a,b)=>a[axis]-b[axis]);
  const branches=heads.map(n=>({n,ids:new Set([n.id,...relativeDescendantsGraph(pg,n.id)])}));for(const b of branches)b.ids.delete(hub);
  const count=new Map();for(const b of branches)for(const id of b.ids)count.set(id,(count.get(id)||0)+1);
  for(const b of branches)b.ids=new Set([...b.ids].filter(id=>count.get(id)===1));
  if(branches.some(b=>[...b.ids].some(id=>{const n=shown.get(id);return n&&!annotation(n)&&(n.locked||n.editLocked)})))return;
  const step=Math.max(Math.max(...heads.map(n=>n[size]))+gap,parent[size]+gap),mid=parent[axis]+parent[size]/2;
  const edgeFor=n=>edges.find(e=>e.target===n.id),end=n=>C.endpoint(n,edgeFor(n).targetPort,'left');
  const common=Math.max(...heads.map(n=>end(n)[perp]));
  for(let i=0;i<branches.length;i++){const b=branches[i],point=end(b.n),delta=mid+(i-(branches.length-1)/2)*step-point[axis],cross=common-point[perp];for(const id of b.ids){const n=shown.get(id);if(!n||n.anchorId||n.locked||n.editLocked)continue;n[axis]+=delta;n[perp]+=cross;const o=d.layoutOffsets.get(id)||{x:0,y:0};d.layoutOffsets.set(id,{...o,[axis]:o[axis]+delta,[perp]:o[perp]+cross});}}
  (d.symmetryGroups||=[]).push({parent:hub,heads:heads.map(n=>n.id)});
 }
 // Symmetry follows actual connection ports, including table body/row anchors.
 function combSymmetry(pg,d,b){
  const shown=new Map(d.nodes.map(n=>[n.id,n])),edges=d.edges.filter(e=>e.bus===b.id&&!e.proxy&&shown.has(e.source)&&shown.has(e.target));if(edges.length<2)return;
  const hub=b.mode!=='free'&&shown.get(b.hub),hubPoint=hub&&C.endpoint(hub,b.port,b.mode==='in'?'left':'right'),axis=hubPoint?(['left','right'].includes(hubPoint.side)?'y':'x'):(b.orientation==='horizontal'?'x':'y'),perp=axis==='y'?'x':'y',size=axis==='y'?'h':'w';
  const terminals=role=>{const out=new Map();for(const e of edges){const n=shown.get(e[role]),port=e[role+'Port'],point=C.endpoint(n,port,role==='source'?'right':'left'),old=out.get(n.id);if(old&&Math.abs(old.point[axis]-point[axis])>.01)return null;out.set(n.id,{n,port,point,role});}return [...out.values()].sort((a,b)=>a.point[axis]-b.point[axis]||a.n.id.localeCompare(b.n.id));};
  const sources=terminals('source'),targets=terminals('target');if(!sources||!targets)return;
  const groups=hub?[b.mode==='in'?sources:targets]:[sources,targets],all=groups.flat(),heads=new Set(all.map(t=>t.n.id));if(all.some(t=>t.n.locked||t.n.editLocked)||all.length!==heads.size)return;
  // Stop at other comb terminals. Shared downstream nodes retain their position.
  const g=C.graph({...pg,edges:pg.edges.filter(e=>e.bus!==b.id)}),branches=all.map(t=>{const ids=new Set([t.n.id]),queue=[t.n.id];for(let i=0;i<queue.length;i++)for(const id of g.adj.get(queue[i])||[])if(id!==hub?.id&&!heads.has(id)&&!ids.has(id)){ids.add(id);queue.push(id);}return {...t,ids};}),counts=new Map();for(const t of branches)for(const id of t.ids)counts.set(id,(counts.get(id)||0)+1);
  for(const t of branches)t.ids=new Set([...t.ids].filter(id=>counts.get(id)===1));
  if(branches.some(t=>[...t.ids].some(id=>{const n=shown.get(id);return n&&!annotation(n)&&(n.locked||n.editLocked)})))return;
  const mid=hubPoint?hubPoint[axis]:(sources[0].point[axis]+sources.at(-1).point[axis])/2,gap=Math.max(16,Number(b.alignGap)||64);
  for(const group of groups){let step=group.length>1?(group.at(-1).point[axis]-group[0].point[axis])/(group.length-1):0;
   for(let i=1;i<group.length;i++){const a=group[i-1],c=group[i];step=Math.max(step,a.n[axis]+a.n[size]-a.point[axis]+c.point[axis]-c.n[axis]+gap);}
   const common=group.reduce((s,t)=>s+t.point[perp],0)/group.length,alignCross=group.every(t=>t.point.side===group[0].point.side);
   group.forEach((t,i)=>{const delta=mid+(i-(group.length-1)/2)*step-t.point[axis],cross=alignCross?common-t.point[perp]:0,branch=branches.find(q=>q.n.id===t.n.id);for(const id of branch.ids){const n=shown.get(id);if(!n||n.anchorId||n.locked||n.editLocked)continue;n[axis]+=delta;n[perp]+=cross;const o=d.layoutOffsets.get(id)||{x:0,y:0};d.layoutOffsets.set(id,{...o,[axis]:o[axis]+delta,[perp]:o[perp]+cross});}});
  }
  (d.symmetryGroups||=[]).push({bus:b.id,parent:hub?.id,heads:[...heads]});
  for(const n of d.nodes)if(n.anchorId){const host=shown.get(n.anchorId);if(host){n.x=host.x+(n.anchorX||0);n.y=host.y+(n.anchorY||0);}}
 }
 function display(pg,folds=new Set(),compact=true,folded=new Set(),options={}){const protectedPg={...pg,nodes:pg.nodes.map(n=>n.editLocked?{...n,locked:true}:n),buses:(pg.buses||[]).map(b=>({...b,autoAlign:false,symmetry:false}))};
  const d=prev.display(protectedPg,folds,compact,folded,options),hadOffsets=!!d.layoutOffsets;d.layoutOffsets||=new Map();
  for(const n of pg.nodes)if(n.type==='decision'&&n.branchSymmetry){const edges=d.edges.filter(e=>e.source===n.id&&!e.proxy&&!e.bus&&!edgeRelationship(pg,e)?.annotation);const sides=edges.map(e=>C.port(n,e.sourcePort).side),axis=sides.includes('left')&&sides.includes('right')?'x':'y';alignTargets(pg,d,n.id,edges,axis,Math.max(16,Number(n.branchGap)||64));}
  for(const b of pg.buses||[])if(b.symmetry||b.symmetry===undefined&&b.autoAlign)combSymmetry(pg,d,b);
  // An annotation follows any layout movement of its host; it cannot push its host away.
  const shown=new Map(d.nodes.map(n=>[n.id,n])),raw=new Map(pg.nodes.map(n=>[n.id,n])),owners=new Map();for(const e of pg.edges){const r=edgeRelationship(pg,e);if(r?.annotation&&!owners.has(r.child))owners.set(r.child,r.parent);}
  for(const [child,parent] of owners){const n=shown.get(child),host=shown.get(parent),o=raw.get(child),h=raw.get(parent);if(!n||!host||!o||!h||n.locked||n.editLocked)continue;n.x=o.x+(o.offsetX||0)+host.x-h.x-(h.offsetX||0);n.y=o.y+(o.offsetY||0)+host.y-h.y-(h.offsetY||0);d.layoutOffsets.set(child,{x:n.x-o.x-(o.offsetX||0),y:n.y-o.y-(o.offsetY||0)});}
  for(const n of d.nodes)if(raw.has(n.id))n.locked=!!raw.get(n.id).locked;if(!hadOffsets&&!d.layoutOffsets.size)delete d.layoutOffsets;return d;
 }
 function dragPlan(pg,selection,folds=new Set(),mode={}){return prev.dragPlan({...pg,nodes:pg.nodes.map(n=>n.editLocked?{...n,locked:true}:n)},selection,folds,mode);}
 function rectangleHits(d,pg,rect,contain=true){const inside=p=>p.x>=rect.x&&p.x<=rect.x+rect.w&&p.y>=rect.y&&p.y<=rect.y+rect.h,box=n=>contain?n.x>=rect.x&&n.y>=rect.y&&n.x+n.w<=rect.x+rect.w&&n.y+n.h<=rect.y+rect.h:n.x<=rect.x+rect.w&&n.x+n.w>=rect.x&&n.y<=rect.y+rect.h&&n.y+n.h>=rect.y;
  const segment=(a,b)=>{if(inside(a)||inside(b))return true;let t0=0,t1=1;for(const [p,q] of [[a.x-b.x,a.x-rect.x],[b.x-a.x,rect.x+rect.w-a.x],[a.y-b.y,a.y-rect.y],[b.y-a.y,rect.y+rect.h-a.y]]){if(!p){if(q<0)return false;}else{const t=q/p;if(p<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);if(t0>t1)return false;}}return true;};
  const path=points=>points.length&&(contain?points.every(inside):points.some((p,i)=>i&&segment(points[i-1],p))),nodes=new Set(d.nodes.filter(n=>n.type!=='summary'&&box(n)).map(n=>n.id)),edges=new Set(),drawings=new Set(),buses=new Set(),ns=new Map(d.nodes.map(n=>[n.id,n])),bundle=C.bundleRoutes(d);for(const e of d.edges)if(!e.proxy&&path(bundle.routes.get(e.id)?.points||C.edgePath(e,ns)?.points||[]))edges.add(e.id);for(const b of bundle.buses){const parts=[b.lead,b.trunk,...(b.segments||[]),...d.edges.filter(e=>e.bus===b.id).map(e=>bundle.routes.get(e.id))].filter(p=>p?.points?.length);if(parts.length&&(contain?parts.every(p=>path(p.points)):parts.some(p=>path(p.points)))){buses.add(b.id);for(const e of d.edges)if(e.bus===b.id)edges.delete(e.id);}}
  for(const drawing of pg.drawings||[]){const host=drawing.anchor&&ns.get(drawing.anchor);if(drawing.anchor&&!host)continue;const points=(drawing.points||[]).map(p=>({x:p.x+(host?.x||0),y:p.y+(host?.y||0)}));if(['rect','ellipse'].includes(drawing.type)&&points.length>1){const a=points[0],b=points.at(-1);if(box({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)}))drawings.add(drawing.id);}else if(path(points))drawings.add(drawing.id);}return {nodes,edges,drawings,buses};
 }
 function bulkPatch(pg,selection,patch,category='all'){const out=C.clone(pg);for(const [list,kind] of [['nodes','node'],['edges','edge'],['buses','bus'],['drawings','drawing']])for(const item of out[list]||[]){if(!(selection[kind]||[]).includes(item.id)||(category!=='all'&&category!==(kind==='node'?item.type:kind)))continue;if(item.editLocked&&!Object.hasOwn(patch,'editLocked'))continue;for(const [key,value] of Object.entries(patch)){const allowed={node:['editLocked','color','fill','fontSize','relativeLock','collapsible','locked','autoSize','tableAutoSize','tableWordWrap','branchSymmetry','branchGap'],edge:['editLocked','color','arrow','arrowStart','dashed','parentRole','style','labelCentered'],bus:['editLocked','color','symmetry','alignGap','style'],drawing:['editLocked','color','width']};if(!allowed[kind].includes(key)||(key.startsWith('branch')&&item.type!=='decision')||(key.startsWith('table')&&!item.table))continue;if(key==='color'){item[kind==='drawing'?'color':kind==='node'?'stroke':'stroke']=value;}else if(key==='tableAutoSize'&&item.table)C.setTableAutoSize(item,value);else if(key==='tableWordWrap'&&item.table)item.table.wordWrap=value;else if(key==='symmetry'&&kind==='bus'){item.symmetry=value;item.autoAlign=value;}else if(key==='autoSize'&&kind==='node'){if(value){item.autoBaseW=item.w;item.autoBaseH=item.h;}item.autoSize=value;}else item[key]=value;}}return out;}
 Object.assign(C,{edgeRelationship,relativeDescendantsGraph,normalizeV6,display,dragPlan,rectangleHits,bulkPatch,combSymmetry});
})(globalThis.Core);

/* Deletion keeps protected objects and their required endpoints intact. */
Core.deleteSelection=function(pg,selection){
 const nodes=new Set(selection.node||[]),edges=new Set(selection.edge||[]),drawings=new Set(selection.drawing||[]),buses=new Set(selection.bus||[]);
 for(const n of pg.nodes)if(n.editLocked)nodes.delete(n.id);
 for(const e of pg.edges)if(e.editLocked){nodes.delete(e.source);nodes.delete(e.target);edges.delete(e.id);buses.delete(e.bus);}
 for(const d of pg.drawings||[])if(d.editLocked){nodes.delete(d.anchor);drawings.delete(d.id);}
 for(const b of pg.buses||[])if(b.editLocked){buses.delete(b.id);for(const e of pg.edges.filter(e=>e.bus===b.id)){edges.delete(e.id);nodes.delete(e.source);nodes.delete(e.target);}}
 for(const n of pg.nodes)if(n.anchorId&&nodes.has(n.anchorId)&&!n.editLocked)nodes.add(n.id);
 const out=Core.clone(pg);out.nodes=out.nodes.filter(n=>!nodes.has(n.id));out.edges=out.edges.filter(e=>!edges.has(e.id)&&!nodes.has(e.source)&&!nodes.has(e.target));out.drawings=(out.drawings||[]).filter(d=>!drawings.has(d.id)&&!nodes.has(d.anchor));out.groups?.forEach(g=>g.members=g.members.filter(id=>!nodes.has(id)));out.buses=(out.buses||[]).filter(b=>!buses.has(b.id));for(const e of out.edges)if(buses.has(e.bus))delete e.bus;Core.cleanBuses(out);return JSON.stringify(out)===JSON.stringify(pg)?pg:out;
};

(function(C){const arrange=C.arrange,autoLayout=C.autoLayout;
 C.arrange=(pg,ids,mode)=>arrange(pg,ids.filter(id=>!pg.nodes.find(n=>n.id===id)?.editLocked),mode);
 C.autoLayout=(pg,group)=>{const model={...pg,edges:pg.edges.map(e=>{const r=C.edgeRelationship(pg,e);return r?{...e,source:r.parent,target:r.child}:null}).filter(Boolean)},out=autoLayout(model,group);out.edges=C.clone(pg.edges);for(let i=0;i<out.nodes.length;i++)if(pg.nodes[i].editLocked)out.nodes[i]=C.clone(pg.nodes[i]);return out;};
})(Core);
