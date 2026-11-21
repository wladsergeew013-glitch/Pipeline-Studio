'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {playwright, launchOptions} = require('./browser_runtime');
const {Core: C, node, page, project} = require('./app_harness');

const root = path.resolve(__dirname, '..');
const edge = (id, source, target, extra = {}) => ({
    id, source, target, sourcePort: 'right', targetPort: 'left', arrow: true, ...extra
});
const cell = (text, extra = {}) => ({text, ...extra});
const draw = (id, anchor) => ({
    id, anchor, type: 'line', color: '#334455', width: 2, points: [{x: 30, y: -25}, {x: 90, y: -25}]
});
const table = (id, x, y, cells, rowIds) => {
    const n = node(id, {
        x, y, w: cells[0].length * 160, h: 180, type: 'table',
        table: {cells, rowIds, colIds: cells[0].map((_, i) => 'col-' + i)}
    });
    C.initTable(n);
    return n;
};
const rowPort = (n, row, side = 'right') => C.ports(n).find(p => p.rowId === row && p.side === side).id;
let checks = 0;
function pass(name) {
    console.log('PASS', name);
    checks++;
}

function symmetricFixture() {
    const f = project('Attachment'), pg = f.pages[0];
    f.viewState = {compact: true, collapsed: {p: []}};
    pg.collapseMode = 'nodes';
    pg.nodes = [
        node('hub', {x: 0, y: 0}), node('host', {x: 330, y: 0}), node('sibling', {x: 330, y: 300}),
        node('image', {x: 345, y: 25, w: 64, h: 32, type: 'image', anchorId: 'host', anchorX: 15, anchorY: 25}),
        node('other', {x: 650, y: 420})
    ];
    pg.edges = [edge('first', 'hub', 'host', {bus: 'comb'}), edge('second', 'hub', 'sibling', {bus: 'comb'})];
    pg.buses = [{id: 'comb', hub: 'hub', mode: 'out', port: 'right', symmetry: true, alignGap: 240}];
    return f;
}

function groupFixture() {
    const f = project('Legacy group'), pg = f.pages[0];
    f.viewState = {compact: true, collapsed: {p: []}};
    pg.collapseMode = 'groups';
    pg.nodes = [node('a', {x: 0, y: 20}), node('b', {x: 300, y: 20})];
    pg.groups = [{id: 'g', title: 'Review group', members: ['a', 'b']}];
    return f;
}

function branchFixture() {
    const f = project('Подготовка проекта'), pg = f.pages[0];
    pg.title = 'Рабочая схема';
    const start = table('start', 0, 90, [
        [cell('Выбранная ячейка', {rowspan: 2}), cell('Соседняя ячейка')],
        [null, cell('Другая ячейка')],
        [cell('Соседняя ветка'), cell('Другой столбец')]
    ], ['one', 'two', 'other']);
    const end = table('end', 1030, 155, [[cell('Финишная ячейка')]], ['finish']);
    start.title = 'Исходные данные';
    end.title = 'Комплект на проверку';
    start.table.rowBehavior = {one: {collapsible: true}};
    f.viewState = {
        compact: false, collapsed: {p: []}, collapsedRows: {p: [C.rowKey('start', 'one')]}
    };
    pg.collapseMode = 'nodes';
    pg.nodes = [
        start, end, node('before', {x: -270, y: 10}), node('a', {title: 'Проверка схемы', x: 500, y: 80}),
        node('b', {title: 'Уточнение данных', x: 500, y: 290}), node('omitted', {x: 500, y: 510}),
        node('body', {x: 730, y: 530}), node('annotation', {title: 'Комментарий', type: 'comment', x: 735, y: 15}),
        node('reference', {x: 730, y: 690})
    ];
    pg.edges = [
        edge('incoming', 'before', 'start', {targetPort: rowPort(start, 'one', 'left')}),
        edge('from-one', 'start', 'a', {sourcePort: rowPort(start, 'one')}),
        edge('from-two', 'b', 'start', {targetPort: rowPort(start, 'two', 'left'), parentRole: 'target', arrow: false, arrowStart: true}),
        edge('from-other', 'start', 'omitted', {sourcePort: rowPort(start, 'other')}),
        edge('from-body', 'start', 'body'),
        edge('to-end-a', 'a', 'end'), edge('to-end-b', 'b', 'end'),
        edge('cycle', 'end', 'a'),
        edge('note', 'annotation', 'a'),
        edge('nonflow', 'a', 'reference', {flow: false, parentRole: 'none'})
    ];
    pg.drawings = [draw('branch-mark', 'a'), draw('unrelated-mark', 'omitted'), draw('free-mark', null)];
    f.pages.push({...page('other-page'), nodes: [node('next-page')]});
    return f;
}

(async () => {
    const browser = await playwright.chromium.launch(launchOptions);
    const p = await browser.newPage({viewport: {width: 1440, height: 960}});
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const activate = f => p.evaluate(async project => {
        await Studio.activateDocument(project, {name: 'Review.html'});
    }, f);
    const savedHTML = () => p.evaluate(async () => Studio.buildDocumentHTML(await Studio.portableProject(false)));
    const reopen = html => p.evaluate(async text => Studio.activateDocument(Studio.parseDocumentText(text), {name: 'Reopened.html'}), html);
    const positions = () => p.evaluate(() => Object.fromEntries(Studio.state.display.nodes.map(n => [n.id, [n.x, n.y]])));
    const select = ids => p.evaluate(ids => {
        Studio.state.selected = new Set(ids);
        Studio.render();
    }, ids);
    const focusAt = async (id, r, c) => {
        await p.locator(`#nodes [data-node="${id}"] [data-table-cell="${r},${c}"] .cell-text`).click({button: 'right'});
        await p.locator('[data-context="isolate-branch"]').click();
        await p.locator('[data-branch-mode="only"]').click();
        await p.locator('[data-action="exit-branch-focus"]').waitFor();
    };
    const viewState = () => p.evaluate(() => {
        const s = Studio.state;
        return {
            model: JSON.stringify(s.project), losses: [s.dirty, s.fileDirty, s.history.length, s.redo.length, s.editVersion],
            folds: Object.fromEntries(Object.entries(s.collapsedRows).map(([id, rows]) => [id, [...rows]])),
            camera: {...s.view}, ids: s.display.nodes.map(n => n.id).sort()
        };
    });
    try {
        await p.goto(pathToFileURL(path.join(root, 'Pipeline-Studio.html')).href);
        await p.waitForSelector('#home-new');
        for (const method of ['inspector', 'context', 'bulk']) {
            await activate(symmetricFixture());
            const before = await positions();
            await select(method === 'bulk' ? ['image', 'other'] : ['image']);
            for (let i = 0; i < 2; i++) {
                for (const locked of [true, false]) {
                    if (method === 'inspector') await p.locator('#node-locked').setChecked(locked);
                    else if (method === 'bulk') await p.locator('[data-bulk-key="locked"]').selectOption(String(locked));
                    else {
                        await p.locator('#nodes [data-node="image"]').click({button: 'right'});
                        await p.locator(locked ? '[data-context="lock"]' : '[data-context="unlock"]').click();
                    }
                    assert.deepEqual((await positions()).image, before.image);
                }
            }
            await p.keyboard.press('Control+z');
            await p.keyboard.press('Control+y');
            assert.equal(await p.evaluate(() => Studio.state.history.length), 4);
            assert.deepEqual((await positions()).image, before.image);
            await reopen(await savedHTML());
            assert.deepEqual((await positions()).image, before.image);
            pass('V22-01 ' + method + ' lock and unlock twice without drift through Undo/Redo and HTML reopen');
        }

        await activate(groupFixture());
        await select(['a']);
        const beforeGroup = await positions();
        assert.deepEqual(beforeGroup, {a: [280, 80], b: [580, 80]});
        await p.locator('#node-locked').check();
        assert.deepEqual(await positions(), beforeGroup);
        await p.keyboard.press('Control+z');
        await p.keyboard.press('Control+y');
        await reopen(await savedHTML());
        assert.deepEqual(await positions(), beforeGroup);
        pass('V22-02 group fixation preserves both positions after Undo/Redo and reopening');
        await activate(groupFixture());
        await select(['a']);
        await p.keyboard.press('Control+d');
        const copy = await p.evaluate(() => [...Studio.state.selected][0]);
        assert.deepEqual((await positions())[copy], [318, 118]);
        await p.keyboard.press('Control+z');
        assert(!(copy in await positions()));
        await p.keyboard.press('Control+y');
        await reopen(await savedHTML());
        assert.deepEqual(await positions(), {...beforeGroup, [copy]: [318, 118]});
        pass('V22-02 Ctrl+D in compact groups keeps its offset and membership on reopen');

        await activate(branchFixture());
        const full = await viewState();
        await focusAt('start', 0, 0);
        assert.deepEqual((await viewState()).ids, ['a','annotation','b','end','start']);
        const cropped = p.locator('#nodes [data-node="start"]');
        assert.equal(await cropped.locator('[data-table-cell]').count(), 1);
        assert.equal(await cropped.locator('.cell-text').textContent(), 'Выбранная ячейка');
        assert.equal(await cropped.locator('[data-table-cell]').getAttribute('rowspan'), '2');
        assert.deepEqual(await p.evaluate(() => Studio.state.display.edges.map(e => e.id).sort()),
            ['cycle','from-one','from-two','note','to-end-a','to-end-b']);
        assert.deepEqual(await p.locator('#ink [data-drawing]').evaluateAll(els => els.map(el => el.dataset.drawing)), ['branch-mark']);
        pass('Isolates the merged cell and both owned row paths, keeping only reachable nodes and drawings');
        assert.equal(await p.locator('#tools').isVisible(), false);
        await p.keyboard.press('Delete');
        await p.keyboard.press('Control+d');
        await cropped.locator('.cell-text').dblclick();
        assert.equal(await p.locator('.quick-editing').count(), 0);
        const stage = await p.locator('#stage').boundingBox();
        const fitted = (await viewState()).camera;
        await p.mouse.move(stage.x + 25, stage.y + 25);
        await p.mouse.down();
        await p.mouse.move(stage.x + 95, stage.y + 80, {steps: 3});
        await p.mouse.up();
        assert.notDeepEqual((await viewState()).camera, fitted);
        await p.locator('[data-action="fit"]').click();
        assert.deepEqual((await viewState()).camera, fitted);
        assert.deepEqual((await viewState()).losses, full.losses);
        pass('Focus allows pan and fit while editor gestures leave the document and history intact');
        await p.screenshot({path: path.join(root, 'qa/branch-focus-0722-rc2.png')});
        const html = await savedHTML();
        const payload = await p.evaluate(html => Studio.parseDocumentText(html), html);
        assert.equal(payload.pages[0].nodes.length, 9);
        assert.equal(payload.pages[0].nodes.find(n => n.id === 'start').table.cells[2][0].text, 'Соседняя ветка');
        assert.deepEqual(payload.viewState.collapsedRows, full.folds);
        assert.equal(Object.hasOwn(payload.viewState, 'branchFocus'), false);
        await focusAt('end', 0, 0);
        assert.deepEqual((await viewState()).ids, ['end']);
        await p.keyboard.press('Escape');
        assert.deepEqual(await viewState(), full);
        pass('A terminal cell can be isolated and Esc restores original camera, folds and document');

        await focusAt('start', 0, 0);
        await p.locator('#page-trigger').click();
        await p.locator('[data-switch-page="1"]').click();
        assert.deepEqual((await viewState()).ids, ['next-page']);
        assert.equal(await p.locator('[data-action="exit-branch-focus"]').count(), 0);
        await reopen(html);
        assert.deepEqual((await viewState()).ids, full.ids);
        pass('Switching page and reopening the saved full HTML clear focus');

        const fixture = fs.mkdtempSync(path.join(root, 'qa/branch-focus-reader-'));
        const reader = path.join(fixture, 'Document.html');
        fs.writeFileSync(reader, html);
        await p.goto(pathToFileURL(reader).href);
        await p.waitForSelector('#nodes [data-node="start"]');
        assert.equal(await p.evaluate(() => Studio.state.readOnly), true);
        await focusAt('start', 0, 0);
        assert.deepEqual((await viewState()).ids, ['a','annotation','b','end','start']);
        await p.locator('[data-action="exit-branch-focus"]').click();
        assert.deepEqual((await viewState()).ids, full.ids);
        pass('Autonomous read-only HTML supports the same context command and exit button');

        const legacy = branchFixture();
        const legacyPage = legacy.pages[0];
        legacyPage.collapseMode = 'groups';
        legacyPage.groups = [{id: 'closed', title: 'Скрытая группа', members: ['a', 'b', 'end']}];
        legacy.viewState.collapsed = {p: ['closed']};
        legacy.viewState.collapsedRows = {};
        await activate(legacy);
        const beforeLegacy = await viewState();
        assert(beforeLegacy.ids.includes('group:closed'));
        await focusAt('start', 0, 0);
        assert.deepEqual((await viewState()).ids, ['a','annotation','b','end','start']);
        await p.locator('[data-action="exit-branch-focus"]').click();
        assert.deepEqual(await viewState(), beforeLegacy);
        pass('Focus expands the selected path through a legacy group and restores its collapsed state');

        assert.deepEqual(errors, []);
        pass('RC2 browser scenarios produce no page errors');
        console.log('TOTAL', checks);
    } finally {
        await browser.close();
    }
})().catch(error => {console.error(error);process.exitCode = 1;});
