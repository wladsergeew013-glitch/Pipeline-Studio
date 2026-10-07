(function(root){
 'use strict';
 function scenarios(C,pg){const out=[{id:'original',title:'Исходная раскладка',edges:[]}],ns=new Map(pg.nodes.map(n=>[n.id,n]));
  for(const hub of pg.nodes){const es=pg.edges.filter(e=>e.source===hub.id&&!C.edgeRelationship(pg,e)?.annotation&&ns.has(e.target));if(new Set(es.map(e=>e.target)).size<2)continue;
   out.push({id:'all:'+hub.id,title:(hub.title||hub.id).replace(/\n/g,' ')+' — все '+es.length+' связи',hub:hub.id,edges:es.map(e=>e.id)});
   if(es.length>2)for(let i=0;i<es.length-1;i++)out.push({id:'pair:'+hub.id+':'+i,title:(hub.title||hub.id).replace(/\n/g,' ')+' — пара '+(i+1)+'/'+(i+2),hub:hub.id,edges:es.slice(i,i+2).map(e=>e.id)});
   const decisions=es.filter(e=>ns.get(e.target).type==='decision');if(decisions.length===4){out.push({id:'four:'+hub.id,title:(hub.title||hub.id)+' — четыре условия',hub:hub.id,edges:decisions.map(e=>e.id)});for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)out.push({id:'four-pair:'+hub.id+':'+i+':'+j,title:(hub.title||hub.id)+' — условия '+(i+1)+'/'+(j+1),hub:hub.id,edges:[decisions[i].id,decisions[j].id]});}
  }
  for(const b of pg.buses||[]){const es=pg.edges.filter(e=>e.bus===b.id);if(es.length>1&&new Set(es.map(e=>e.source)).size>1)out.push({id:'bus:'+b.id,title:'Гребёнка '+(b.title||b.id),edges:es.map(e=>e.id),bus:b.id});}
  return out;
 }
 function apply(C,pg,scenario,options={}){return scenario.edges.length?C.setEdgeSymmetry(pg,scenario.edges,{allowCrossings:false,...options}):C.clone(pg);}
 const api={scenarios,apply};if(typeof module!=='undefined')module.exports=api;else root.SymmetryScenarios=api;
})(globalThis);
