'use strict';

module.exports=function(){
 const block=(id,title,x,y,type='block')=>({id,title,x,y,w:170,h:90,type,materials:[]});
 const arrow=(id,source,target,from='right',to='left',direction={arrow:true})=>({
  id,source,target,sourcePort:from,targetPort:to,...direction,
 });
 const main={
  id:'main',title:'Развилка',groups:[],drawings:[],buses:[],
  nodes:[block('start','Решение',20,200,'decision'),block('left','Левая ветка',350,70),block('right','Правая ветка',350,330),block('end','Завершение',690,200)],
  edges:[arrow('to-left','start','left'),arrow('to-right','start','right'),arrow('left-end','left','end'),
   arrow('right-end','right','end'),arrow('return','start','left','top','left',{arrow:false,arrowStart:true})],
 };
 const second={id:'aux',title:'Подробности',nodes:[block('description','Описание',20,20)],edges:[],groups:[],drawings:[],buses:[]};
 const run={id:'both',title:'Обе ветви',pageId:main.id,startNodeId:'start',
  steps:[[{from:'start',edgeId:'to-left'},{from:'start',edgeId:'to-right'}],
   [{from:'left',edgeId:'left-end'}],[{from:'right',edgeId:'right-end'}]]};
 const project={format:'pipeline-studio',schemaVersion:6,id:'document-runs-test',title:'Прогоны & этапы',revision:0,
  settings:{autoSpace:false},viewState:{compact:false},pages:[main,second],materials:[],runs:[run]};
 return {project,run};
};
