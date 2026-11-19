'use strict';
const assert=require('node:assert/strict');
const C=require('../app/static/core.js');
const fixture=require('./runs_fixture.js');
const {project,run}=fixture();
const leg=(from,edgeId)=>({from,edgeId});

assert.equal(C.validatePresentation(project),project);
let view=C.inspectRun(project,run);
assert.equal(view.error,'');
assert.deepEqual(view.stages.map(stage=>stage.active),[['left','right'],['right','end'],['end']]);
assert.equal(view.stages[0].legs.length,2);
assert.equal(view.active[0].id,'end');

const loop={...run,steps:[[leg('start','to-left')],[leg('left','return')],[leg('start','to-right')]]};
view=C.inspectRun(project,loop);
assert.equal(view.error,'');
assert.equal(view.stages[1].legs[0].reverse,true);
assert.equal(view.active[0].id,'right');

const invalid={...run,steps:[[leg('start','to-left')],[leg('right','right-end')]]};
view=C.inspectRun(project,invalid);
assert.match(view.error,/Шаг 2/);
assert.equal(view.stages.length,1);
assert.ok(view.choices.some(leg=>leg.edge.id==='left-end'));
assert.match(C.inspectRun(project,{...run,pageId:'deleted'}).error,/удалён/);
assert.throws(()=>C.validateRuns([run,run]),/Некорректный прогон/);
assert.throws(()=>C.validateRuns([{...run,steps:[[leg('start','to-left'),leg('start','to-left')]]}]),/Повтор перехода/);
assert.doesNotThrow(()=>C.validateRuns(undefined));

const xml=C.packDocumentXML('Решение & проверка','<body>]]></body>');
assert.ok(xml.startsWith('<?xml version="1.0"'));
assert.ok(xml.includes('<title>Решение &amp; проверка</title>'));
assert.ok(xml.includes(']]]]><![CDATA[>'));
console.log('Run model covers split, merge, loop, reverse connection, stale route and XML quoting.');
