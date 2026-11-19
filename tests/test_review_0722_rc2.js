'use strict';
const assert = require('node:assert/strict');
const {Core: C, node, page} = require('./app_harness');

const edge = (id, source, target, extra = {}) => ({
    id, source, target, sourcePort: 'right', targetPort: 'left', arrow: true, ...extra
});
const display = (pg, compact = false) => C.display(pg, new Set(), compact);
const point = (view, id) => {
    const n = view.nodes.find(n => n.id === id);
    return [n.x, n.y];
};
const nearPoint = (actual, expected) => {
    assert(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < .001, `${actual} != ${expected}`);
};
const reopen = pg => C.normalizeV6(JSON.parse(JSON.stringify({
    schemaVersion: 6, pages: [pg], materials: []
}))).pages[0];

let checks = 0;
let failures = 0;
function test(name, run) {
    try {
        run();
        console.log('PASS', name);
        checks++;
    } catch (error) {
        console.error('FAIL', name, error);
        failures++;
    }
}

function symmetricPage() {
    return {
        ...page(),
        collapseMode: 'nodes',
        nodes: [
            node('hub', {x: 0, y: 0}),
            node('host', {x: 300, y: 0}),
            node('sibling', {x: 300, y: 300}),
            node('image', {type: 'image', x: 315, y: 25, anchorId: 'host', anchorX: 15, anchorY: 25})
        ],
        edges: [edge('one', 'hub', 'host', {bus: 'comb'}), edge('two', 'hub', 'sibling', {bus: 'comb'})],
        buses: [{id: 'comb', hub: 'hub', mode: 'out', port: 'right', symmetry: true, alignGap: 240}]
    };
}

for (const compact of [false, true]) {
    test(`V22-01 repeated fixation of a symmetric attachment stays in place (compact=${compact})`, () => {
        let pg = symmetricPage();
        const original = display(pg, compact);
        assert.notEqual(point(original, 'host')[1], pg.nodes[1].y);
        for (let cycle = 0; cycle < 2; cycle++) {
            const fixed = C.setNodeLocks(pg, ['image'], true, display(pg, compact));
            assert.deepEqual(point(display(fixed, compact), 'image'), point(original, 'image'));
            pg = C.setNodeLocks(fixed, ['image'], false, display(fixed, compact));
            assert.deepEqual(point(display(pg, compact), 'image'), point(original, 'image'));
            assert.equal(pg.nodes[3].anchorY, 25);
        }
        assert.deepEqual(point(display(reopen(pg), compact), 'image'), point(original, 'image'));
    });
}

test('V22-01 releasing a fixed image respects the host position after a deliberate move', () => {
    const pg = symmetricPage();
    const view = display(pg);
    const fixed = C.setNodeLocks(pg, ['image'], true, view);
    const moved = C.moveNodes(fixed, new Set(['host']), 70, -110, 'host');
    assert.notDeepEqual(point(display(moved), 'host'), point(view, 'host'));
    assert.deepEqual(point(display(moved), 'image'), point(view, 'image'));
    const released = C.setNodeLocks(moved, ['image'], false, display(moved));
    const after = display(released);
    nearPoint(point(after, 'image'), point(view, 'image'));
    const next = C.moveNodes(released, new Set(['host','sibling']), 50, 0, 'host');
    const nextView = display(next);
    const [hx, hy] = point(after, 'host');
    const [nx, ny] = point(nextView, 'host');
    const [ix, iy] = point(after, 'image');
    nearPoint(point(nextView, 'image'), [ix + nx - hx, iy + ny - hy]);
});

test('V22-01 releasing a nested anchor preserves a still fixed child', () => {
    let pg = symmetricPage();
    pg.nodes.push(node('nested', {type: 'image', anchorId: 'image', anchorX: 30, anchorY: 18}));
    const reference = display(pg);
    pg = C.setNodeLocks(pg, ['image', 'nested'], true, reference);
    pg = C.moveNodes(pg, new Set(['host','sibling']), 35, 10, 'host');
    pg = C.setNodeLocks(pg, ['image'], false, display(pg));
    const after = display(reopen(pg));
    assert.deepEqual(point(after, 'image'), point(reference, 'image'));
    assert.deepEqual(point(after, 'nested'), point(reference, 'nested'));
});

function groupedPage() {
    return {
        ...page(),
        collapseMode: 'groups',
        nodes: [node('a', {x: 0, y: 20}), node('b', {x: 300, y: 20})],
        groups: [{id: 'g', title: 'Group', members: ['a', 'b']}]
    };
}

for (const compact of [false, true]) {
    test(`V22-02 fixation keeps the selected block and its group neighbour (compact=${compact})`, () => {
        const pg = groupedPage();
        const view = display(pg, compact);
        const fixed = C.setNodeLocks(pg, ['a'], true, view);
        assert.deepEqual(fixed.nodes[1], pg.nodes[1]);
        for (const next of [fixed, reopen(fixed), C.setNodeLocks(fixed, ['a'], false, display(fixed, compact))]) {
            for (const id of ['a', 'b']) assert.deepEqual(point(display(next, compact), id), point(view, id));
        }
    });
    test(`V22-02 duplicate keeps group membership and the visible 38px step (compact=${compact})`, () => {
        const pg = groupedPage();
        const view = display(pg, compact);
        if (compact) assert.deepEqual(point(view, 'a'), [280,80]);
        const {page: copied, ids: [copy]} = C.duplicateSelection(pg, ['a'], view);
        assert(copied.groups[0].members.includes(copy));
        assert.deepEqual(copied.nodes.slice(0, 2), pg.nodes);
        assert.deepEqual(point(display(reopen(copied), compact), copy), point(view, 'a').map(v => v + 38));
        assert.deepEqual(point(display(copied, compact), 'b'), point(view, 'b'));
    });
}

test('V22-02 legacy compact layout keeps copies beside ungrouped originals and symmetric groups', () => {
    const pg = symmetricPage();
    pg.collapseMode = 'groups';
    pg.groups = [{id: 'targets', title: 'Targets', members: ['host', 'sibling']}];
    const view = display(pg, true);
    for (const id of ['hub', 'host', 'image']) {
        const {page: copied, ids: [copy]} = C.duplicateSelection(pg, [id], view);
        assert.deepEqual(point(display(reopen(copied), true), copy), point(view, id).map(v => v + 38));
    }
});

console.log('TOTAL', checks, 'FAILED', failures);
if (failures) process.exitCode = 1;
