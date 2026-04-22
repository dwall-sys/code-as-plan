// @cap-feature(feature:F-067) Thread + Cluster Navigator — RED-GREEN tests covering AC-1..AC-5.
// @cap-decision Tests use node:test + node:assert only. Zero external deps, consistent with the F-065 + F-066 test layer.
// @cap-decision Each AC has at least one dedicated describe block. Helper describes cover determinism, empty-states, and keyboard nav.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');
const threadLib = require('../cap/bin/lib/cap-thread-tracker.cjs');

// --- Fixtures --------------------------------------------------------------

function seedProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-tn-'));

  const featureMap = {
    features: [
      {
        id: 'F-001', title: 'Tag Scanner', state: 'shipped',
        acs: [], files: [], dependencies: [], usesDesign: [], metadata: {},
      },
      {
        id: 'F-067', title: 'Thread Navigator', state: 'planned',
        acs: [], files: [], dependencies: ['F-065'], usesDesign: [], metadata: {},
      },
    ],
    lastScan: null,
  };
  featureMapLib.writeFeatureMap(dir, featureMap);

  fs.mkdirSync(path.join(dir, '.cap', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cap', 'SESSION.json'), JSON.stringify({
    version: '2.0.0', activeFeature: 'F-067', step: 'prototype', lastCommand: '/cap:prototype', metadata: {},
  }));

  // Seed two threads — a parent + a child branch so parent-link coverage is real.
  const parent = threadLib.createThread({
    problemStatement: 'How should we surface neural clusters in the UI?',
    solutionShape: 'Dedicated Thread + Cluster Navigator section',
    boundaryDecisions: ['Read-only', 'No external deps'],
    featureIds: ['F-067'],
  });
  // Stabilise timestamps for deterministic sort assertions.
  parent.timestamp = '2026-04-01T10:00:00Z';
  parent.id = 'thr-parent01';
  parent.keywords = ['cluster', 'navigator', 'threads', 'ui'];
  threadLib.persistThread(dir, parent);

  const child = threadLib.branchThread(parent, {
    problemStatement: 'Keyword overlap: 3-column or Venn?',
    solutionShape: '3-column list — simpler, more accurate',
    boundaryDecisions: ['No SVG diagram for v1'],
    featureIds: ['F-067'],
    divergencePoint: 'UI detail: how to show overlap',
  });
  child.timestamp = '2026-04-10T10:00:00Z';
  child.id = 'thr-child002';
  child.parentThreadId = 'thr-parent01';
  child.keywords = ['keywords', 'overlap', 'threads', 'ui'];
  threadLib.persistThread(dir, child);

  return dir;
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// --- AC-1: Thread browser (chronological list) ------------------------------

describe('cap-ui F-067/AC-1: thread browser shows threads chronologically', () => {
  it('buildThreadData returns threads sorted newest-first', () => {
    const threads = [
      { id: 'a', name: 'A', timestamp: '2026-01-01T00:00:00Z', keywords: [] },
      { id: 'b', name: 'B', timestamp: '2026-03-01T00:00:00Z', keywords: [] },
      { id: 'c', name: 'C', timestamp: '2026-02-01T00:00:00Z', keywords: [] },
    ];
    const data = ui.buildThreadData({ threads });
    assert.deepStrictEqual(data.threads.map(t => t.id), ['b', 'c', 'a'], 'newest first');
  });

  it('buildThreadData attaches timestamp, name, featureIds, keywords to each thread', () => {
    const threads = [
      { id: 't1', name: 'T1', timestamp: '2026-01-01T00:00:00Z', featureIds: ['F-010'], keywords: ['alpha', 'beta'] },
    ];
    const data = ui.buildThreadData({ threads });
    const t = data.threads[0];
    assert.strictEqual(t.id, 't1');
    assert.strictEqual(t.name, 'T1');
    assert.strictEqual(t.timestamp, '2026-01-01T00:00:00Z');
    assert.deepStrictEqual(t.featureIds, ['F-010']);
    assert.deepStrictEqual(t.keywords, ['alpha', 'beta']);
    assert.deepStrictEqual(data.keywordIndex.t1, ['alpha', 'beta']);
  });

  it('renderThreadList emits chronologically sorted items with timestamps + names + feature IDs + keyword badges', () => {
    const threads = [
      { id: 'first', name: 'First', timestamp: '2026-04-10T10:00:00Z', featureIds: ['F-010'], keywords: ['k1', 'k2'] },
      { id: 'second', name: 'Second', timestamp: '2026-04-01T10:00:00Z', featureIds: ['F-020'], keywords: ['k3'] },
    ];
    const html = ui.renderThreadList(threads);
    assert.ok(html.includes('2026-04-10T10:00:00Z'), 'timestamp present');
    assert.ok(html.includes('2026-04-01T10:00:00Z'), 'second timestamp present');
    assert.ok(html.includes('First'), 'first name');
    assert.ok(html.includes('Second'), 'second name');
    assert.ok(html.includes('F-010'), 'feature id');
    assert.ok(html.includes('F-020'), 'feature id');
    assert.ok(html.includes('k1') && html.includes('k2'), 'keyword badges');
    // Newest first — "First" (Apr 10) should appear before "Second" (Apr 1) in the document.
    assert.ok(html.indexOf('First') < html.indexOf('Second'), 'chronological order preserved in markup');
  });

  it('renderThreadList emits a friendly empty-state when no threads', () => {
    const html = ui.renderThreadList([]);
    assert.ok(html.includes('No threads yet'), 'empty-state message present');
  });

  it('collectProjectSnapshot populates fullThreads from on-disk thread files', () => {
    const dir = seedProject();
    try {
      const snap = ui.collectProjectSnapshot(dir);
      assert.ok(Array.isArray(snap.fullThreads), 'fullThreads is an array');
      assert.strictEqual(snap.fullThreads.length, 2, 'both seeded threads loaded');
      const ids = snap.fullThreads.map(t => t.id).sort();
      assert.deepStrictEqual(ids, ['thr-child002', 'thr-parent01']);
    } finally {
      rmTmp(dir);
    }
  });
});

// --- AC-2: Thread detail view ----------------------------------------------

describe('cap-ui F-067/AC-2: thread detail view shows the five mandated fields', () => {
  const thread = {
    id: 'thr-x', name: 'Design decision', timestamp: '2026-04-20T09:00:00Z',
    problemStatement: 'Choose a cluster viz strategy.',
    solutionShape: 'List view with drift inline.',
    boundaryDecisions: ['No D3', 'No Venn'],
    featureIds: ['F-067', 'F-068'],
    keywords: [],
    parentThreadId: 'thr-parent',
  };

  it('renderThreadDetail output contains all five required fields', () => {
    const html = ui.renderThreadDetail(thread);
    assert.ok(html.includes('Problem Statement'), 'problem-statement heading');
    assert.ok(html.includes('Choose a cluster viz strategy.'), 'problem-statement body');
    assert.ok(html.includes('Solution Shape'), 'solution-shape heading');
    assert.ok(html.includes('List view with drift inline.'), 'solution-shape body');
    assert.ok(html.includes('Boundary Decisions'), 'boundary-decisions heading');
    assert.ok(html.includes('No D3'), 'first boundary decision present');
    assert.ok(html.includes('No Venn'), 'second boundary decision present');
    assert.ok(html.includes('Feature IDs'), 'feature-ids heading');
    assert.ok(html.includes('F-067') && html.includes('F-068'), 'both feature IDs rendered');
    assert.ok(html.includes('Parent Thread'), 'parent-thread heading');
    assert.ok(html.includes('thr-parent'), 'parent thread id rendered');
  });

  it('renderThreadDetail emits a parent-link that points at the parent thread anchor', () => {
    const html = ui.renderThreadDetail(thread);
    assert.ok(html.includes('href="#thread-thr-parent"'), 'parent anchor link');
    assert.ok(html.includes('data-parent-id="thr-parent"'), 'parent data attr (for JS follow)');
  });

  it('renderThreadDetail shows a root-thread message when no parent exists', () => {
    const html = ui.renderThreadDetail(Object.assign({}, thread, { parentThreadId: null }));
    assert.ok(html.includes('root thread'), 'root-thread message');
  });

  it('renderThreadDetail returns a friendly empty-state when given null', () => {
    const html = ui.renderThreadDetail(null);
    assert.ok(html.includes('Select a thread'), 'empty-state prompt');
  });

  it('buildThreadNavSection embeds thread payload for client-side detail rendering', () => {
    const data = ui.buildThreadData({
      threads: [thread],
      clusters: [],
      affinity: [],
      graph: { nodes: {}, edges: [] },
    });
    const html = ui.buildThreadNavSection({ threadData: data });
    assert.ok(html.includes('id="tn-data"'), 'payload script block present');
    assert.ok(html.includes('thr-x'), 'thread id embedded in payload');
    // Defense-in-depth: payload must not contain a literal </script that would prematurely close the tag.
    const payloadStart = html.indexOf('type="application/json">');
    const payloadEnd = html.indexOf('</script>', payloadStart);
    const payload = html.substring(payloadStart, payloadEnd);
    assert.ok(!/<\/script/i.test(payload), 'payload has no literal </script sequence');
  });
});

// --- AC-3: Cluster visualization -------------------------------------------

describe('cap-ui F-067/AC-3: cluster visualization', () => {
  it('buildThreadData enriches clusters with drift + avg affinity + pairwise + memberCount', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a', keywords: [] }, { id: 'b', keywords: [] }, { id: 'c', keywords: [] }],
      clusters: [{ id: 'cluster-1', label: 'test', members: ['a', 'b', 'c'] }],
      affinity: [
        { sourceThreadId: 'a', targetThreadId: 'b', compositeScore: 0.8 },
        { sourceThreadId: 'b', targetThreadId: 'c', compositeScore: 0.6 },
        { sourceThreadId: 'a', targetThreadId: 'c', compositeScore: 0.4 },
      ],
      graph: { nodes: {}, edges: [] },
    });
    const c = data.clusters[0];
    assert.strictEqual(c.memberCount, 3, 'member count matches');
    assert.strictEqual(c.pairwise.length, 3, 'three pairs for three members');
    // Pairwise sorted descending
    assert.ok(c.pairwise[0].score >= c.pairwise[2].score, 'pairwise sorted by score desc');
    assert.ok(Math.abs(c.avgAffinity - 0.6) < 1e-3, 'avg affinity is arithmetic mean of pairwise scores');
    assert.ok(typeof c.drift === 'string' && c.drift.length > 0, 'drift status is a non-empty string');
  });

  it('renderClusterView lists clusters with name, member count, affinity values, and drift status', () => {
    const clusters = [{
      id: 'cluster-xyz', label: 'ui·clusters', memberCount: 2, members: ['thr-a', 'thr-b'],
      pairwise: [{ a: 'thr-a', b: 'thr-b', score: 0.75 }],
      avgAffinity: 0.75, drift: 'stable (no divergence detected)', drifting: false,
    }];
    const html = ui.renderClusterView(clusters);
    assert.ok(html.includes('ui·clusters'), 'cluster name rendered');
    assert.ok(html.includes('2 members'), 'member count visible');
    assert.ok(html.includes('0.750'), 'pairwise affinity value visible (3-decimal)');
    assert.ok(html.includes('drift:'), 'drift status label');
    assert.ok(html.includes('stable (no divergence detected)'), 'drift text verbatim');
    assert.ok(html.includes('thr-a') && html.includes('thr-b'), 'members listed');
  });

  it('renderClusterView emits a friendly empty-state when there are no clusters', () => {
    const html = ui.renderClusterView([]);
    assert.ok(html.includes('No clusters detected'), 'empty-state message present');
  });

  it('buildThreadNavSection includes a dedicated clusters section with id="clusters"', () => {
    const data = ui.buildThreadData({ threads: [], clusters: [], affinity: [] });
    const html = ui.buildThreadNavSection({ threadData: data });
    assert.ok(html.includes('id="clusters"'), 'clusters section anchor present');
    assert.ok(/\bClusters\b/.test(html), 'Clusters heading text present');
  });
});

// --- AC-4: Keyword-overlap view --------------------------------------------

describe('cap-ui F-067/AC-4: keyword overlap', () => {
  const a = { id: 'a', name: 'A', keywords: ['cat', 'dog', 'fish'] };
  const b = { id: 'b', name: 'B', keywords: ['dog', 'fish', 'bird'] };

  it('renderKeywordOverlap shows shared keywords in the A∩B column', () => {
    const html = ui.renderKeywordOverlap(a, b);
    // Shared column header contains both names
    assert.ok(html.includes('A ∩ B') || html.includes('A') && html.includes('B'), 'shared column header references both names');
    // Shared keywords dog + fish appear inside at least one .tn-kw
    assert.ok(html.includes('dog'), 'shared keyword dog present');
    assert.ok(html.includes('fish'), 'shared keyword fish present');
  });

  it('renderKeywordOverlap partitions keywords into only-A and only-B columns', () => {
    const html = ui.renderKeywordOverlap(a, b);
    // Verify by column header + count: "A only (1)" = cat, "B only (1)" = bird
    assert.ok(/A only \(1\)/.test(html), 'A-only column has one keyword');
    assert.ok(/B only \(1\)/.test(html), 'B-only column has one keyword');
    assert.ok(html.includes('cat'), 'cat in A-only');
    assert.ok(html.includes('bird'), 'bird in B-only');
  });

  it('renderKeywordOverlap sorts keywords alphabetically for deterministic output', () => {
    const html1 = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: ['gamma', 'alpha', 'beta'] },
      { id: 'b', name: 'B', keywords: ['beta', 'delta', 'alpha'] }
    );
    const html2 = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: ['alpha', 'beta', 'gamma'] },
      { id: 'b', name: 'B', keywords: ['alpha', 'beta', 'delta'] }
    );
    assert.strictEqual(html1, html2, 'determinism: permuted input must yield identical output');
  });

  it('renderKeywordOverlap returns an empty-state prompt when either thread is null', () => {
    assert.ok(ui.renderKeywordOverlap(null, b).includes('Pick two threads'), 'A null -> prompt');
    assert.ok(ui.renderKeywordOverlap(a, null).includes('Pick two threads'), 'B null -> prompt');
  });

  it('renderKeywordOverlap handles disjoint keyword sets (empty intersection)', () => {
    const html = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: ['x'] },
      { id: 'b', name: 'B', keywords: ['y'] }
    );
    // Shared column should show (none) since intersection is empty
    assert.ok(html.includes('(none)'), 'empty intersection rendered as (none)');
  });

  it('buildThreadNavSection includes the overlap picker (two dropdowns + compare button)', () => {
    const data = ui.buildThreadData({ threads: [a, b] });
    const html = ui.buildThreadNavSection({ threadData: data });
    assert.ok(html.includes('id="tn-overlap-a"'), 'dropdown A');
    assert.ok(html.includes('id="tn-overlap-b"'), 'dropdown B');
    assert.ok(html.includes('id="tn-overlap-compare"'), 'compare button');
    // Thread options populated
    assert.ok(html.includes('value="a"'), 'thread a option');
    assert.ok(html.includes('value="b"'), 'thread b option');
  });
});

// --- AC-5: Drift-warning highlight -----------------------------------------

describe('cap-ui F-067/AC-5: drift warnings are highlighted', () => {
  function graphWithDecayedEdge() {
    return {
      nodes: {
        nA: { type: 'thread', metadata: { threadId: 'thr-a' } },
        nB: { type: 'thread', metadata: { threadId: 'thr-b' } },
      },
      edges: [
        { source: 'nA', target: 'nB', type: 'affinity', active: true, metadata: { decayApplied: true } },
      ],
    };
  }

  it('buildThreadData flags clusters with decayed affinity as drifting', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'thr-a', keywords: [] }, { id: 'thr-b', keywords: [] }],
      clusters: [{ id: 'c1', label: 'L', members: ['thr-a', 'thr-b'] }],
      affinity: [],
      graph: graphWithDecayedEdge(),
    });
    assert.strictEqual(data.clusters[0].drifting, true, 'drifting flag true when decay > 0');
    assert.ok(/diverging|drift/i.test(data.clusters[0].drift), 'drift text mentions drift/diverging');
  });

  it('renderClusterView applies the drift-warning CSS class to drifting clusters', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'thr-a', keywords: [] }, { id: 'thr-b', keywords: [] }],
      clusters: [{ id: 'c1', label: 'L', members: ['thr-a', 'thr-b'] }],
      affinity: [],
      graph: graphWithDecayedEdge(),
    });
    const html = ui.renderClusterView(data.clusters);
    assert.ok(html.includes('drift-warning'), 'drift-warning class applied');
    assert.ok(html.includes('tn-drift-icon'), 'inline drift icon rendered');
  });

  it('buildThreadNavCss contains the drift-warning style hook', () => {
    const css = ui.buildThreadNavCss();
    assert.ok(/\.tn-cluster\.drift-warning/.test(css), 'drift-warning selector present in CSS');
    assert.ok(/\.tn-drift-icon/.test(css), 'drift-icon style present in CSS');
  });

  it('non-drifting clusters do NOT get the drift-warning class', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a', keywords: [] }, { id: 'b', keywords: [] }],
      clusters: [{ id: 'c1', label: 'stable-one', members: ['a', 'b'] }],
      affinity: [],
      graph: { nodes: {}, edges: [] },
    });
    const html = ui.renderClusterView(data.clusters);
    assert.ok(!html.includes('drift-warning'), 'no drift-warning on stable cluster');
  });
});

// --- Keyboard navigation (F-067/D6; ties up F-066 a11y) --------------------

describe('cap-ui F-067: keyboard accessibility', () => {
  it('thread list items carry tabindex="0" and role="button"', () => {
    const html = ui.renderThreadList([
      { id: 'a', name: 'A', timestamp: '2026-01-01T00:00:00Z', featureIds: [], keywords: [] },
    ]);
    assert.ok(html.includes('tabindex="0"'), 'tabindex set');
    assert.ok(html.includes('role="button"'), 'role set');
    assert.ok(html.includes('aria-label='), 'aria-label set');
  });

  it('buildThreadNavJs wires Enter + Arrow + Escape keys on the thread list', () => {
    const js = ui.buildThreadNavJs();
    assert.ok(/keydown/.test(js), 'keydown handler');
    assert.ok(/ArrowDown/.test(js), 'arrow-down handling');
    assert.ok(/ArrowUp/.test(js), 'arrow-up handling');
    assert.ok(/'Enter'/.test(js) || /"Enter"/.test(js), 'Enter key handling');
    assert.ok(/Escape/.test(js), 'Escape handling');
  });

  it('mind-map nodes carry tabindex="0" (F-066 deferred a11y tied up here)', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [{ id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: [], designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(/tabindex="0"/.test(svg), 'mind-map node has tabindex');
    assert.ok(/role="button"/.test(svg), 'mind-map node has role');
  });

  it('mind-map JS listens for keydown events (Enter + Escape)', () => {
    const js = ui.buildMindMapJs();
    assert.ok(/addEventListener\s*\(\s*['"]keydown['"]/.test(js), 'keydown handler on mind-map');
    assert.ok(/Escape/.test(js), 'Escape clears focus');
  });
});

// --- Composition: Thread-Nav is in buildCss + buildClientJs + renderHtml ---

describe('cap-ui F-067: composition (buildCss + buildClientJs + renderHtml)', () => {
  let tmp;
  beforeEach(() => { tmp = seedProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('buildCss() includes Thread-Nav CSS', () => {
    const css = ui.buildCss();
    assert.ok(css.includes('.tn-layout'), 'thread-nav CSS present');
    assert.ok(css.includes('.tn-cluster'), 'cluster CSS present');
  });

  it('buildClientJs({ live: true }) includes Thread-Nav JS', () => {
    const js = ui.buildClientJs({ live: true });
    assert.ok(js.includes("getElementById('tn-data')"), 'thread-nav payload reader present');
  });

  it('buildClientJs({ live: false }) still includes Thread-Nav JS (snapshot mode)', () => {
    const js = ui.buildClientJs({ live: false });
    assert.ok(js.includes("getElementById('tn-data')"), 'thread-nav JS present in snapshot');
  });

  it('renderHtml (--serve) output contains the Thread-Nav + Clusters + Overlap sections', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap, options: { live: true } });
    assert.ok(html.includes('id="threads"'), 'threads section anchor');
    assert.ok(html.includes('id="clusters"'), 'clusters section anchor');
    assert.ok(html.includes('id="keyword-overlap"'), 'keyword overlap anchor');
    // The seeded thread name must appear
    assert.ok(html.includes('How should we surface neural clusters in the UI?') || html.includes('How should we surface'), 'seeded thread content present');
  });

  it('renderHtml (--share) output contains the Thread-Nav sections', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap, options: { live: false } });
    assert.ok(html.includes('id="threads"'), 'threads section in static snapshot');
    assert.ok(html.includes('id="clusters"'), 'clusters section in static snapshot');
  });

  it('createSnapshot writes a file that contains the Thread-Nav section', () => {
    ui.createSnapshot({ projectRoot: tmp });
    const html = fs.readFileSync(path.join(tmp, '.cap', 'ui', 'snapshot.html'), 'utf8');
    assert.ok(html.includes('id="threads"'), 'snapshot contains threads section');
    assert.ok(html.includes('id="clusters"'), 'snapshot contains clusters section');
  });

  it('HTML document is well-formed: single <main> open/close pair', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot: snap, options: { live: true } });
    const opens = (html.match(/<main[\s>]/g) || []).length;
    const closes = (html.match(/<\/main>/g) || []).length;
    assert.strictEqual(opens, 1, 'exactly one <main> open tag');
    assert.strictEqual(closes, 1, 'exactly one </main> close tag');
  });
});

// --- Empty-state + graceful degradation ------------------------------------

describe('cap-ui F-067: empty states', () => {
  it('buildThreadData tolerates missing fields (no threads, no clusters, no graph)', () => {
    const data = ui.buildThreadData({});
    assert.deepStrictEqual(data.threads, []);
    assert.deepStrictEqual(data.clusters, []);
    assert.deepStrictEqual(data.keywordIndex, {});
  });

  it('buildThreadNavSection renders even with fully empty input', () => {
    const html = ui.buildThreadNavSection({ threadData: { threads: [], clusters: [], keywordIndex: {} } });
    assert.ok(html.includes('id="threads"'));
    assert.ok(html.includes('No threads yet'));
    assert.ok(html.includes('No clusters detected'));
  });

  it('collectProjectSnapshot on a project without graph.json returns empty clusters without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-tn-empty-'));
    try {
      featureMapLib.writeFeatureMap(dir, { features: [], lastScan: null });
      const snap = ui.collectProjectSnapshot(dir);
      assert.ok(Array.isArray(snap.clusters), 'clusters is array');
      assert.strictEqual(snap.clusters.length, 0, 'no clusters detected in fresh project');
      assert.ok(Array.isArray(snap.fullThreads), 'fullThreads is array');
      assert.strictEqual(snap.fullThreads.length, 0, 'no threads in fresh project');
    } finally {
      rmTmp(dir);
    }
  });
});

// --- XSS hygiene -----------------------------------------------------------

describe('cap-ui F-067: escape hygiene', () => {
  it('renderThreadList escapes thread names', () => {
    const html = ui.renderThreadList([
      { id: 't', name: '<script>alert(1)</script>', timestamp: '2026-01-01T00:00:00Z', featureIds: [], keywords: [] },
    ]);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script escaped');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  });

  it('renderThreadDetail escapes problem statement content', () => {
    const html = ui.renderThreadDetail({
      id: 't', name: 'X', timestamp: '', problemStatement: '<img src=x onerror=alert(1)>',
      solutionShape: '', boundaryDecisions: [], featureIds: [], keywords: [], parentThreadId: null,
    });
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'raw img escaped');
    assert.ok(html.includes('&lt;img'), 'escaped form present');
  });

  it('renderClusterView escapes cluster labels', () => {
    const html = ui.renderClusterView([{
      id: 'c', label: '<b>x</b>', members: ['a'], memberCount: 1, pairwise: [], avgAffinity: 0, drift: 'stable', drifting: false,
    }]);
    assert.ok(!html.includes('<b>x</b>'), 'raw tag escaped');
    assert.ok(html.includes('&lt;b&gt;'), 'escaped form present');
  });
});

// --- Determinism -----------------------------------------------------------

describe('cap-ui F-067: determinism', () => {
  it('buildThreadNavSection is byte-identical for identical input', () => {
    const data = ui.buildThreadData({
      threads: [
        { id: 'a', name: 'A', timestamp: '2026-01-01T00:00:00Z', featureIds: ['F-1'], keywords: ['x'] },
        { id: 'b', name: 'B', timestamp: '2026-02-01T00:00:00Z', featureIds: ['F-2'], keywords: ['y'] },
      ],
      clusters: [{ id: 'c', label: 'L', members: ['a', 'b'] }],
      affinity: [{ sourceThreadId: 'a', targetThreadId: 'b', compositeScore: 0.5 }],
      graph: { nodes: {}, edges: [] },
    });
    const h1 = ui.buildThreadNavSection({ threadData: data });
    const h2 = ui.buildThreadNavSection({ threadData: data });
    assert.strictEqual(h1, h2, 'output must be deterministic');
  });
});

// --- No external deps (zero-deps invariant) --------------------------------

describe('cap-ui F-067: zero external deps', () => {
  it('cap-ui.cjs only requires node: built-ins and other cap/bin/lib files', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-ui.cjs'), 'utf8');
    const re = /require\(['"]([^'"]+)['"]\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const mod = m[1];
      const ok = mod.startsWith('node:') || mod.startsWith('./') || mod.startsWith('../');
      assert.ok(ok, 'forbidden external require in cap-ui.cjs: ' + mod);
    }
  });
});

// ===========================================================================
// Adversarial hardening round 2 (round-2 = "break this")
// @cap-decision Contracts locked by these tests:
//   (a) Missing timestamp sorts to the end (treated as lexicographically smallest in DESC sort).
//   (b) Tie-break is by thread id (localeCompare ascending).
//   (c) Duplicate thread ids are PRESERVED (no dedup); keywordIndex takes the last writer's keywords.
//   (d) Keyword matching is CASE-SENSITIVE. "Foo" and "foo" are distinct.
//   (e) Duplicate keywords within a thread ARE deduped via Set().
//   (f) Thread list cap is 6 keyword badges per item (visual density cap).
//   (g) Long text fields are rendered in full — no truncation.
//   (h) Avg affinity is rounded to 3 decimals. Scores outside [0, 1] are passed through (not clamped).
//   (i) `drifting` flag is derived from the drift string via /drift|diverging/i AND !/^stable/i.
//   (j) `</script>`-like sequences inside the JSON payload are escaped to `<\/script>`.
//   (k) All defensive renderers tolerate null / non-array inputs without throwing.
// ===========================================================================

// --- AC-1 adversarial: thread-data contracts -------------------------------

describe('cap-ui F-067/AC-1 adversarial: thread-data edge cases', () => {
  // @cap-todo(ac:F-067/AC-1) Contract: threads with missing/empty timestamp sort last (DESC, empty string is smallest).
  it('buildThreadData sorts threads with missing timestamp to the end', () => {
    const data = ui.buildThreadData({
      threads: [
        { id: 'a', timestamp: '2026-01-01T00:00:00Z' },
        { id: 'b' }, // no timestamp
        { id: 'c', timestamp: '2026-03-01T00:00:00Z' },
      ],
    });
    assert.deepStrictEqual(data.threads.map(t => t.id), ['c', 'a', 'b'],
      'newest first; missing-timestamp goes last');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: tie-break on equal timestamp is thread id ASCENDING (localeCompare).
  it('buildThreadData tie-breaks equal timestamps by thread id ascending', () => {
    const data = ui.buildThreadData({
      threads: [
        { id: 'z', timestamp: '2026-01-01T00:00:00Z' },
        { id: 'a', timestamp: '2026-01-01T00:00:00Z' },
        { id: 'm', timestamp: '2026-01-01T00:00:00Z' },
      ],
    });
    assert.deepStrictEqual(data.threads.map(t => t.id), ['a', 'm', 'z'],
      'id ASC tie-break for equal timestamps');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: malformed timestamp strings do not throw; they sort lexicographically.
  it('buildThreadData does NOT throw on malformed timestamp strings', () => {
    assert.doesNotThrow(() => {
      ui.buildThreadData({
        threads: [
          { id: 'a', timestamp: 'not-a-date' },
          { id: 'b', timestamp: 42 }, // numeric
          { id: 'c', timestamp: null },
        ],
      });
    });
  });

  // @cap-todo(ac:F-067/AC-1) Contract: duplicate thread ids are PRESERVED (no silent dedup).
  //   keywordIndex takes the keywords of the LAST writer with that id (since we iterate and overwrite).
  it('buildThreadData preserves duplicate thread ids (no silent dedup)', () => {
    const data = ui.buildThreadData({
      threads: [
        { id: 'dup', name: 'A', timestamp: '2026-01-01T00:00:00Z', keywords: ['x'] },
        { id: 'dup', name: 'B', timestamp: '2026-02-01T00:00:00Z', keywords: ['y'] },
      ],
    });
    assert.strictEqual(data.threads.length, 2, 'both duplicates kept');
    assert.deepStrictEqual(data.threads.map(t => t.name), ['B', 'A'], 'newest-first still applies');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: keywords are deduped PER THREAD using Set().
  it('buildThreadData dedupes repeated keywords within a single thread', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 't1', keywords: ['foo', 'foo', 'bar', 'bar', 'bar'] }],
    });
    assert.deepStrictEqual(data.keywordIndex.t1, ['bar', 'foo'], 'sorted + deduped');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: keywordIndex drops threads with no id (defensive skip).
  it('buildThreadData skips threads without an id when building keywordIndex', () => {
    const data = ui.buildThreadData({
      threads: [
        { id: null, keywords: ['kw'] },
        { keywords: ['kw2'] }, // no id key at all
        { id: 'real', keywords: ['kw3'] },
      ],
    });
    assert.deepStrictEqual(Object.keys(data.keywordIndex), ['real'],
      'only threads with an id appear in keywordIndex');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: buildThreadData tolerates a null/undefined params object.
  it('buildThreadData does NOT throw on null/undefined params', () => {
    assert.doesNotThrow(() => ui.buildThreadData(null));
    assert.doesNotThrow(() => ui.buildThreadData(undefined));
    const data = ui.buildThreadData(null);
    assert.deepStrictEqual(data.threads, []);
    assert.deepStrictEqual(data.clusters, []);
    assert.deepStrictEqual(data.keywordIndex, {});
  });

  // @cap-todo(ac:F-067/AC-1) Contract: thread list cap of 6 keyword badges per item.
  it('renderThreadList caps keyword badges at 6 per thread item', () => {
    const many = Array.from({ length: 10 }, (_, i) => 'kw' + i);
    const html = ui.renderThreadList([{
      id: 't', name: 'n', timestamp: '2026-01-01T00:00:00Z',
      featureIds: [], keywords: many,
    }]);
    const pills = html.match(/class="tn-kw"/g) || [];
    assert.strictEqual(pills.length, 6, 'exactly 6 keyword badges rendered');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: renderThreadList tolerates non-array/null input without throwing.
  it('renderThreadList returns the empty-state for null/non-array input (no throw)', () => {
    assert.doesNotThrow(() => ui.renderThreadList(null));
    assert.doesNotThrow(() => ui.renderThreadList('not-an-array'));
    assert.doesNotThrow(() => ui.renderThreadList(undefined));
    assert.ok(ui.renderThreadList(null).includes('No threads yet'), 'null -> empty-state');
    assert.ok(ui.renderThreadList('xyz').includes('No threads yet'), 'string -> empty-state');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: missing name/id/timestamp on a thread item still renders.
  it('renderThreadList renders items even when id/name/timestamp/featureIds/keywords are null', () => {
    let html;
    assert.doesNotThrow(() => {
      html = ui.renderThreadList([{ id: null, name: null, timestamp: null, featureIds: null, keywords: null }]);
    });
    assert.ok(html.includes('thread-item'), 'item structure rendered');
    assert.ok(html.includes('tabindex="0"'), 'accessibility attrs still present');
  });
});

// --- AC-2 adversarial: thread detail edge cases ----------------------------

describe('cap-ui F-067/AC-2 adversarial: thread detail edge cases', () => {
  // @cap-todo(ac:F-067/AC-2) Contract: empty boundaryDecisions shows "(none)" — field is still rendered.
  it('renderThreadDetail shows "(none)" for empty boundaryDecisions (not hidden)', () => {
    const html = ui.renderThreadDetail({
      id: 'x', name: 'X', timestamp: '',
      problemStatement: 'p', solutionShape: 's',
      boundaryDecisions: [], featureIds: [], keywords: [], parentThreadId: null,
    });
    assert.ok(html.includes('Boundary Decisions'), 'section header present');
    assert.ok(html.includes('(none)'), 'empty-list placeholder present');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: empty featureIds shows "(none)" pill.
  it('renderThreadDetail shows "(none)" for empty featureIds', () => {
    const html = ui.renderThreadDetail({
      id: 'x', name: 'X', timestamp: '',
      problemStatement: '', solutionShape: '',
      boundaryDecisions: [], featureIds: [], keywords: [], parentThreadId: null,
    });
    assert.ok(html.includes('Feature IDs'), 'section present');
    assert.ok(html.includes('(none)'), 'empty placeholder present');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: long fields (10k chars) render in full without truncation.
  it('renderThreadDetail does NOT truncate very long problemStatement (10k chars)', () => {
    const long = 'a'.repeat(10000);
    const html = ui.renderThreadDetail({
      id: 'x', name: 'X', timestamp: '',
      problemStatement: long, solutionShape: '',
      boundaryDecisions: [], featureIds: [], keywords: [], parentThreadId: null,
    });
    assert.ok(html.includes(long), '10k-char body preserved verbatim');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: parent pointing at nonexistent thread still renders as a link (no lookup in pure renderer).
  //   Client JS gates the "follow" behavior on threadById[pid]. The renderer itself is oblivious.
  it('renderThreadDetail emits parent-link markup even when parent id is unknown at render time', () => {
    const html = ui.renderThreadDetail({
      id: 'x', name: 'X', parentThreadId: 'ghost-id',
      problemStatement: '', solutionShape: '', boundaryDecisions: [], featureIds: [], keywords: [],
    });
    assert.ok(html.includes('href="#thread-ghost-id"'), 'link is emitted regardless of existence');
    assert.ok(html.includes('data-parent-id="ghost-id"'), 'data attr preserved');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: every user-supplied field is escaped in the detail view.
  it('renderThreadDetail escapes solutionShape, boundaryDecisions[], and featureIds[]', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = ui.renderThreadDetail({
      id: 't', name: 'ok', timestamp: '',
      problemStatement: '',
      solutionShape: evil,
      boundaryDecisions: [evil],
      featureIds: [evil],
      keywords: [],
      parentThreadId: null,
    });
    assert.ok(!html.includes(evil), 'raw evil string is NOT present anywhere');
    // Three escaped occurrences (solutionShape, one boundary, one featureId)
    const count = (html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length;
    assert.strictEqual(count, 3, 'all three fields are escaped independently');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: parentThreadId containing XSS must be escaped in both href and data attr.
  it('renderThreadDetail escapes XSS attempt in parentThreadId (href + data attr)', () => {
    const html = ui.renderThreadDetail({
      id: 'x', name: 'X',
      parentThreadId: 'evil"><script>alert(1)</script>',
      problemStatement: '', solutionShape: '', boundaryDecisions: [], featureIds: [], keywords: [],
    });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script tag');
    assert.ok(html.includes('&lt;script&gt;'), 'script tag escaped');
    assert.ok(html.includes('&quot;'), 'attribute quote escaped');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: aria-label and data-thread-id attributes are protected against attribute breakout.
  it('renderThreadList escapes quotes in aria-label and data-thread-id (no attr breakout)', () => {
    const html = ui.renderThreadList([
      { id: 't"id', name: 'A "quoted" & <tag>', timestamp: '', featureIds: [], keywords: [] },
    ]);
    assert.ok(html.includes('data-thread-id="t&quot;id"'), 'data-thread-id quote escaped');
    assert.ok(!/data-thread-id="t"id"/.test(html), 'no unescaped attr breakout');
    assert.ok(html.includes('&quot;quoted&quot;'), 'quotes inside name escaped');
    assert.ok(html.includes('&amp;'), 'ampersand escaped');
  });
});

// --- AC-3 adversarial: cluster rendering edge cases ------------------------

describe('cap-ui F-067/AC-3 adversarial: cluster rendering edge cases', () => {
  // @cap-todo(ac:F-067/AC-3) Contract: single-member clusters render "(single member — no pairs)".
  it('renderClusterView shows a "single member — no pairs" hint for solo clusters', () => {
    const html = ui.renderClusterView([{
      id: 'solo', label: 'solo', memberCount: 1, members: ['only'],
      pairwise: [], avgAffinity: 0, drift: 'stable (insufficient data)', drifting: false,
    }]);
    assert.ok(html.includes('single member'), 'solo hint present');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: zero-member cluster still renders (member count 0 visible).
  it('renderClusterView still renders a cluster with zero members', () => {
    const html = ui.renderClusterView([{
      id: 'empty', label: 'L', memberCount: 0, members: [],
      pairwise: [], avgAffinity: 0, drift: 'stable (insufficient data)', drifting: false,
    }]);
    assert.ok(html.includes('0 members'), 'zero-member count rendered');
    assert.ok(html.includes('single member'), 'pairwise placeholder still applies');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: cluster missing an avgAffinity property defaults to 0.000.
  it('renderClusterView defaults missing avgAffinity to 0.000', () => {
    const html = ui.renderClusterView([{
      id: 'c', label: 'L', memberCount: 2, members: ['a', 'b'],
      pairwise: [{ a: 'a', b: 'b', score: 0 }],
      drift: 'stable (no data)', drifting: false,
      // note: no avgAffinity property
    }]);
    assert.ok(html.includes('avg aff. 0.000'), 'default fallback rendered');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: affinity scores outside [0, 1] are passed through (NOT clamped).
  it('buildThreadData does NOT clamp affinity scores outside [0, 1]', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c', label: 'L', members: ['a', 'b'] }],
      affinity: [{ sourceThreadId: 'a', targetThreadId: 'b', compositeScore: 1.5 }],
    });
    assert.strictEqual(data.clusters[0].pairwise[0].score, 1.5,
      'out-of-range score preserved verbatim');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: avgAffinity rounded to 3 decimals.
  it('buildThreadData rounds avgAffinity to 3 decimal places', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c', label: 'L', members: ['a', 'b'] }],
      affinity: [{ sourceThreadId: 'a', targetThreadId: 'b', compositeScore: 1 / 3 }],
    });
    assert.strictEqual(data.clusters[0].avgAffinity, 0.333, '1/3 rounded to 0.333');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: pairwise is sorted DESC by score for deterministic top-N display.
  it('buildThreadData sorts pairwise rows DESC by score', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      clusters: [{ id: 'c', label: 'L', members: ['a', 'b', 'c', 'd'] }],
      affinity: [
        { sourceThreadId: 'a', targetThreadId: 'b', compositeScore: 0.2 },
        { sourceThreadId: 'c', targetThreadId: 'd', compositeScore: 0.9 },
        { sourceThreadId: 'b', targetThreadId: 'c', compositeScore: 0.5 },
      ],
    });
    const scores = data.clusters[0].pairwise.map(p => p.score);
    const sortedDesc = [...scores].sort((x, y) => y - x);
    assert.deepStrictEqual(scores, sortedDesc, 'pairwise sorted DESC');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: missing cluster id → empty data-cluster-id attr (renders, no throw).
  it('renderClusterView tolerates a cluster with no id (empty data attr)', () => {
    const html = ui.renderClusterView([{
      label: 'L', memberCount: 0, members: [], pairwise: [],
      avgAffinity: 0, drift: 'stable', drifting: false,
    }]);
    assert.ok(html.includes('data-cluster-id=""'), 'empty data-cluster-id attribute emitted');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: renderClusterView tolerates null / non-array input.
  it('renderClusterView returns the empty-state for null / non-array input (no throw)', () => {
    assert.doesNotThrow(() => ui.renderClusterView(null));
    assert.doesNotThrow(() => ui.renderClusterView('xyz'));
    assert.ok(ui.renderClusterView(null).includes('No clusters detected'));
  });

  // @cap-todo(ac:F-067/AC-3) Contract: XSS in member id is escaped in .tn-member pill.
  it('renderClusterView escapes member ids (XSS defense in list)', () => {
    const html = ui.renderClusterView([{
      id: 'c', label: 'L', memberCount: 1, members: ['<script>alert(1)</script>'],
      pairwise: [], avgAffinity: 0, drift: 'stable', drifting: false,
    }]);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'member id not raw');
    assert.ok(html.includes('&lt;script&gt;'), 'member id escaped');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: drift string is escaped in the drift-status div.
  it('renderClusterView escapes the drift status string (XSS defense)', () => {
    const html = ui.renderClusterView([{
      id: 'c', label: 'L', memberCount: 2, members: ['a', 'b'],
      pairwise: [{ a: 'a', b: 'b', score: 0.5 }],
      avgAffinity: 0.5, drift: '<b>evil</b>', drifting: false,
    }]);
    assert.ok(!html.includes('<b>evil</b>'), 'drift text not raw');
    assert.ok(html.includes('&lt;b&gt;evil&lt;/b&gt;'), 'drift text escaped');
  });

  // @cap-todo(ac:F-067/AC-3) Contract: pairwise top is capped at 3 rows for visual density.
  it('renderClusterView displays at most 3 pairwise rows per cluster', () => {
    const pairwise = Array.from({ length: 10 }, (_, i) => ({ a: 'a' + i, b: 'b' + i, score: 1 - i * 0.05 }));
    const html = ui.renderClusterView([{
      id: 'c', label: 'L', memberCount: 6, members: ['a0', 'b0', 'a1', 'b1', 'a2', 'b2'],
      pairwise, avgAffinity: 0.8, drift: 'stable', drifting: false,
    }]);
    // Count <li> rows inside the .tn-pairwise list by counting "↔" separators (one per pair).
    const arrows = (html.match(/↔/g) || []).length;
    assert.strictEqual(arrows, 3, 'at most 3 pairwise rows rendered');
  });

  // @cap-todo(ac:F-067/AC-3) Performance: 100-thread / 20-cluster input renders in <500ms.
  it('buildThreadData + renderClusterView handle 100 threads + 20 clusters in under 500ms', () => {
    const threads = Array.from({ length: 100 }, (_, i) => ({
      id: 't' + i, name: 'T' + i,
      timestamp: new Date(2026, 0, 1 + i).toISOString(),
      featureIds: ['F-' + i], keywords: ['kw' + (i % 10)],
    }));
    const clusters = Array.from({ length: 20 }, (_, c) => ({
      id: 'c' + c, label: 'cluster-' + c,
      members: threads.slice(c * 5, c * 5 + 5).map(t => t.id),
    }));
    const start = Date.now();
    const data = ui.buildThreadData({ threads, clusters, affinity: [], graph: { nodes: {}, edges: [] } });
    const listHtml = ui.renderThreadList(data.threads);
    const clusterHtml = ui.renderClusterView(data.clusters);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, 'under 500ms (actual: ' + elapsed + 'ms)');
    assert.ok(listHtml.length > 0 && clusterHtml.length > 0, 'real output produced');
  });
});

// --- AC-4 adversarial: keyword-overlap edge cases --------------------------

describe('cap-ui F-067/AC-4 adversarial: keyword overlap edge cases', () => {
  // @cap-todo(ac:F-067/AC-4) Contract: keyword comparison is CASE-SENSITIVE. "Foo" ≠ "foo".
  it('renderKeywordOverlap treats case-differing keywords as distinct (case-sensitive)', () => {
    const html = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: ['Foo'] },
      { id: 'b', name: 'B', keywords: ['foo'] }
    );
    // Intersection should be empty; each "only" column should show the one keyword.
    const aOnly = /A only \(1\)/.test(html);
    const bOnly = /B only \(1\)/.test(html);
    const noShared = html.includes('(none)');
    assert.ok(aOnly, 'A-only has 1 element');
    assert.ok(bOnly, 'B-only has 1 element');
    assert.ok(noShared, 'shared column empty');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: empty keyword arrays on both sides → all three columns show "(none)".
  it('renderKeywordOverlap renders three "(none)" columns when both threads have empty keywords', () => {
    const html = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: [] },
      { id: 'b', name: 'B', keywords: [] }
    );
    const noneCount = (html.match(/\(none\)/g) || []).length;
    assert.strictEqual(noneCount, 3, 'all 3 columns say (none)');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: identical threads → A∩B fully populated, only-A/only-B empty.
  it('renderKeywordOverlap: identical keyword sets → shared column full, both only-* columns empty', () => {
    const html = ui.renderKeywordOverlap(
      { id: 'a', name: 'A', keywords: ['x', 'y'] },
      { id: 'b', name: 'B', keywords: ['y', 'x'] }
    );
    // Two "(none)" pieces (only-A, only-B). Intersection count visible.
    const noneCount = (html.match(/\(none\)/g) || []).length;
    assert.strictEqual(noneCount, 2, 'only-A and only-B empty');
    assert.ok(/∩ B \(2\)/.test(html), 'intersection header shows count 2');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: one empty + one populated → handled symmetrically.
  it('renderKeywordOverlap handles one-empty symmetrically', () => {
    const populated = { id: 'p', name: 'P', keywords: ['a', 'b'] };
    const empty = { id: 'e', name: 'E', keywords: [] };
    const h1 = ui.renderKeywordOverlap(populated, empty);
    const h2 = ui.renderKeywordOverlap(empty, populated);
    // In h1: shared=(none), onlyA=2, onlyB=(none). In h2: shared=(none), onlyA=(none), onlyB=2.
    assert.ok(/P only \(2\)/.test(h1), 'h1 shows P has 2 only-keywords');
    assert.ok(/P only \(2\)/.test(h2), 'h2 shows P has 2 only-keywords (symmetric)');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: column headers (which contain user-supplied names) are escaped.
  it('renderKeywordOverlap escapes thread names in column headers (XSS defense)', () => {
    const a = { id: 'a', name: '<img src=x onerror=alert(1)>', keywords: ['k'] };
    const b = { id: 'b', name: 'B', keywords: ['k'] };
    const html = ui.renderKeywordOverlap(a, b);
    assert.ok(!html.includes('<img src=x'), 'raw img tag not present');
    assert.ok(html.includes('&lt;img'), 'img tag escaped in header');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: keywords in pill pills are escaped.
  it('renderKeywordOverlap escapes keyword content (XSS defense)', () => {
    const a = { id: 'a', name: 'A', keywords: ['<script>alert(1)</script>'] };
    const b = { id: 'b', name: 'B', keywords: [] };
    const html = ui.renderKeywordOverlap(a, b);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag absent');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: missing keywords property is tolerated (treated as empty).
  //   Non-array wrong-typed keywords (e.g. string) are NOT tolerated — renderKeywordOverlap trusts
  //   its caller to pass a Thread shape. buildThreadData is the defensive gate; its output is the
  //   only thing the renderer should ever see in practice.
  it('renderKeywordOverlap tolerates missing keywords field (treats as empty)', () => {
    const a = { id: 'a', name: 'A' }; // no keywords field
    const b = { id: 'b', name: 'B' }; // no keywords field
    let html;
    assert.doesNotThrow(() => { html = ui.renderKeywordOverlap(a, b); });
    const noneCount = (html.match(/\(none\)/g) || []).length;
    assert.strictEqual(noneCount, 3, 'all three columns empty');
  });

  // @cap-risk(feature:F-067) renderKeywordOverlap does NOT defend against a caller passing a non-array
  //   `keywords` (e.g. a string). It assumes its input came through buildThreadData (which DOES defend).
  //   This is an intentional contract split: derivation is defensive, rendering is not. Documented here
  //   so future refactors do not accidentally break the derivation gate.
  it('renderKeywordOverlap throws when keywords is a non-array type (contract: caller must pass Thread shape)', () => {
    const a = { id: 'a', name: 'A', keywords: 'not-an-array' };
    const b = { id: 'b', name: 'B', keywords: [] };
    assert.throws(() => ui.renderKeywordOverlap(a, b), TypeError,
      'non-array keywords throws — caller must pre-normalise via buildThreadData');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: name-free thread falls back to id in column headers.
  it('renderKeywordOverlap falls back to thread id when name is missing', () => {
    const a = { id: 'id-a', keywords: ['x'] };
    const b = { id: 'id-b', keywords: ['y'] };
    const html = ui.renderKeywordOverlap(a, b);
    assert.ok(html.includes('id-a'), 'A id in header');
    assert.ok(html.includes('id-b'), 'B id in header');
  });
});

// --- AC-5 adversarial: drift warning edge cases ----------------------------

describe('cap-ui F-067/AC-5 adversarial: drift-warning edge cases', () => {
  function graphWithDecayed(members, decayedPairs) {
    const nodes = {};
    members.forEach((m, i) => { nodes['n' + i] = { type: 'thread', metadata: { threadId: m } }; });
    const edges = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const isDecayed = decayedPairs.some(p => (p[0] === members[i] && p[1] === members[j]) || (p[0] === members[j] && p[1] === members[i]));
        edges.push({
          source: 'n' + i, target: 'n' + j,
          type: 'affinity', active: true,
          metadata: { decayApplied: isDecayed },
        });
      }
    }
    return { nodes, edges };
  }

  // @cap-todo(ac:F-067/AC-5) Contract: "minor drift" text triggers drifting=true.
  it('minor-drift edges (1/3 decayed) → drifting=true + drift-warning class', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b', 'c'] }],
      affinity: [],
      graph: graphWithDecayed(['a', 'b', 'c'], [['a', 'b']]),
    });
    assert.ok(/minor drift/i.test(data.clusters[0].drift), 'drift text is "minor drift"');
    assert.strictEqual(data.clusters[0].drifting, true, 'drifting=true');
    const html = ui.renderClusterView(data.clusters);
    assert.ok(html.includes('drift-warning'), 'drift-warning class applied');
    assert.ok(html.includes('tn-drift-icon'), 'drift-icon rendered');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: "diverging" text (>50% decayed) triggers drifting=true.
  it('majority-decayed edges (2/3) → "diverging" text + drifting=true', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b', 'c'] }],
      affinity: [],
      graph: graphWithDecayed(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]),
    });
    assert.ok(/diverging/i.test(data.clusters[0].drift), 'drift text is "diverging"');
    assert.strictEqual(data.clusters[0].drifting, true, 'drifting=true');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: "stable (no divergence detected)" → drifting=false.
  it('stable edges (0 decayed) → drifting=false + NO drift-warning class', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b'] }],
      affinity: [],
      graph: graphWithDecayed(['a', 'b'], []),
    });
    assert.ok(/^stable/.test(data.clusters[0].drift), 'drift text starts with "stable"');
    assert.strictEqual(data.clusters[0].drifting, false, 'drifting=false');
    const html = ui.renderClusterView(data.clusters);
    assert.ok(!html.includes('drift-warning'), 'no drift-warning class');
    assert.ok(!html.includes('tn-drift-icon'), 'no drift-icon rendered');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: "stable (insufficient data)" (<2 members) → drifting=false.
  it('insufficient-data drift (<2 members) → drifting=false', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'solo' }],
      clusters: [{ id: 'c1', label: 'L', members: ['solo'] }],
      affinity: [],
      graph: { nodes: {}, edges: [] },
    });
    assert.ok(data.clusters[0].drift.startsWith('stable'), 'drift text starts with stable');
    assert.strictEqual(data.clusters[0].drifting, false, 'drifting=false');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: missing graph → defaults to "stable (...)" + drifting=false.
  //   The derivation tolerates undefined graph entirely.
  it('missing graph defaults drift to stable + drifting=false', () => {
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b'] }],
      affinity: [],
      // no graph
    });
    assert.ok(data.clusters[0].drift.startsWith('stable'), 'drift starts with stable');
    assert.strictEqual(data.clusters[0].drifting, false, 'drifting=false');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: graph.edges empty + active=false edges ignored.
  it('only inactive decayed edges → drifting=false (inactive edges are ignored)', () => {
    const graph = {
      nodes: {
        nA: { type: 'thread', metadata: { threadId: 'a' } },
        nB: { type: 'thread', metadata: { threadId: 'b' } },
      },
      edges: [
        { source: 'nA', target: 'nB', type: 'affinity', active: false, metadata: { decayApplied: true } },
      ],
    };
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b'] }],
      affinity: [], graph,
    });
    assert.strictEqual(data.clusters[0].drifting, false, 'inactive edges ignored');
  });

  // @cap-todo(ac:F-067/AC-5) Contract: `drifting` flag requires drift text to NOT start with "stable".
  //   i.e. an adversarial drift value like "stable (drift-like)" must NOT falsely trigger drifting.
  it('drift text starting with "stable" suppresses the drift-warning even if drift-substring present', () => {
    // Construct a cluster bypass: we render a cluster where `drifting` has been evaluated.
    // Since the derivation enforces "start with stable -> drifting=false", we verify via direct derivation:
    // Use a "stable" verdict from the helper, then prove drifting is false and renderer omits class.
    const data = ui.buildThreadData({
      threads: [{ id: 'a' }, { id: 'b' }],
      clusters: [{ id: 'c1', label: 'L', members: ['a', 'b'] }],
      affinity: [],
      graph: graphWithDecayed(['a', 'b'], []), // produces "stable (no divergence detected)"
    });
    assert.strictEqual(data.clusters[0].drifting, false,
      'drift starts with "stable" regardless of words after');
    // Even the manual/downstream cluster with custom drift text that starts with "stable" must NOT flag.
    const manual = ui.renderClusterView([{
      id: 'c', label: 'L', memberCount: 2, members: ['a', 'b'],
      pairwise: [{ a: 'a', b: 'b', score: 0.5 }], avgAffinity: 0.5,
      drift: 'stable (contains the word drift as a red herring)', drifting: false,
    }]);
    assert.ok(!manual.includes('drift-warning'), 'renderer does not add class when drifting=false');
  });
});

// --- Payload / script-injection defense-in-depth ---------------------------

describe('cap-ui F-067 adversarial: JSON payload XSS defense', () => {
  // @cap-todo(ac:F-067/AC-2) Contract: `</script>` literal inside the thread payload is neutralised.
  //   Verified by regex: we should find no uppercase-or-lowercase </script that would break the tag.
  it('buildThreadNavSection escapes `</script>` inside the JSON payload (case-insensitive)', () => {
    const data = ui.buildThreadData({
      threads: [{
        id: 'a', name: 'A', timestamp: '2026-01-01T00:00:00Z',
        problemStatement: '</script><script>alert(1)</script>',
        solutionShape: '</SCRIPT>',
        keywords: [],
      }],
    });
    const section = ui.buildThreadNavSection({ threadData: data });
    // Extract the payload text between <script id="tn-data" ...> and </script>
    const startMarker = 'id="tn-data" type="application/json">';
    const start = section.indexOf(startMarker) + startMarker.length;
    const end = section.indexOf('</script>', start);
    const payload = section.substring(start, end);
    // No literal </script (any case) inside payload.
    assert.ok(!/<\/script/i.test(payload), 'no case-insensitive </script inside payload');
    // Escape sequence <\/ must be present (verifying the defense).
    assert.ok(payload.includes('<\\/script'), 'escape sequence present');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: payload embeds parentThreadId for client-side follow.
  it('buildThreadNavSection embeds parentThreadId in the JSON payload', () => {
    const data = ui.buildThreadData({
      threads: [{
        id: 'child', name: 'c', timestamp: '2026-01-01T00:00:00Z',
        parentThreadId: 'parent-1', keywords: [],
      }],
    });
    const section = ui.buildThreadNavSection({ threadData: data });
    assert.ok(section.includes('"parentThreadId":"parent-1"'),
      'parentThreadId present in embedded JSON');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: payload JSON parses as valid JSON (after unescape defense).
  it('buildThreadNavSection payload is valid JSON (after reversing `<\\/` → `</`)', () => {
    const data = ui.buildThreadData({
      threads: [{
        id: 'a', name: 'A', timestamp: '2026-01-01T00:00:00Z',
        problemStatement: '</script>',
        keywords: ['k'],
      }],
    });
    const section = ui.buildThreadNavSection({ threadData: data });
    const startMarker = 'id="tn-data" type="application/json">';
    const start = section.indexOf(startMarker) + startMarker.length;
    const end = section.indexOf('</script>', start);
    const payload = section.substring(start, end);
    // Browser-equivalent read: DOM textContent still contains the `<\/` sequence literally.
    // JSON.parse can handle `<\/` because JSON spec allows \/ as an escape for /.
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(payload); }, 'payload is valid JSON');
    assert.strictEqual(parsed.threads[0].problemStatement, '</script>',
      'round-trip preserves problemStatement');
  });
});

// --- Keyboard a11y adversarial ---------------------------------------------

describe('cap-ui F-067 adversarial: keyboard accessibility wiring', () => {
  // @cap-todo(ac:F-067/AC-1) Contract: client JS wires Home + End in addition to Arrow keys.
  it('buildThreadNavJs wires Home + End keys for list-jumping', () => {
    const js = ui.buildThreadNavJs();
    assert.ok(/Home/.test(js), 'Home key handling present');
    assert.ok(/End/.test(js), 'End key handling present');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: Space key triggers selection (in addition to Enter).
  it('buildThreadNavJs treats Space as equivalent to Enter', () => {
    const js = ui.buildThreadNavJs();
    // Either 'Enter' || ' ' or " " should appear alongside 'Enter'
    assert.ok(/'Enter'\s*\|\|\s*e\.key\s*===\s*' '|"Enter"\s*\|\|\s*e\.key\s*===\s*" "/.test(js)
      || (/'Enter'|"Enter"/.test(js) && /' '|" "/.test(js)),
      'Space key is handled as an activator');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: keyboard handler calls preventDefault so Space doesn't scroll the page.
  it('buildThreadNavJs calls preventDefault to suppress native key behavior', () => {
    const js = ui.buildThreadNavJs();
    assert.ok(/preventDefault\(\)/.test(js), 'preventDefault used in key handler');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: keyboard nav inside list uses the list element's scope (not window).
  it('buildThreadNavJs scopes the keydown listener to the #thread-nav-list element', () => {
    const js = ui.buildThreadNavJs();
    assert.ok(/thread-nav-list/.test(js), 'list id referenced in JS');
    assert.ok(/addEventListener\(['"]keydown['"]/.test(js), 'keydown wired');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: :focus-visible rule exists so keyboard-only focus is visible.
  it('buildThreadNavCss has a :focus-visible rule on .tn-thread', () => {
    const css = ui.buildThreadNavCss();
    assert.ok(/\.tn-thread:focus-visible/.test(css), 'focus-visible on tn-thread');
  });

  // @cap-todo(ac:F-067/AC-1) Contract: Escape is referenced as a branch, not as a substring of another keyword.
  it('buildThreadNavJs branches on Escape via string equality (not substring)', () => {
    const js = ui.buildThreadNavJs();
    // Prefer an equality comparison so it's not a coincidental substring.
    assert.ok(/e\.key\s*===\s*['"]Escape['"]/.test(js), 'Escape key compared via ===');
  });

  // @cap-todo(ac:F-067/AC-2) Contract: parent-link click wiring exists on the detail panel.
  it('buildThreadNavJs wires parent-link click on the detail panel', () => {
    const js = ui.buildThreadNavJs();
    assert.ok(/tn-parent-link/.test(js), 'parent-link selector referenced');
    assert.ok(/data-parent-id/.test(js), 'data-parent-id read');
  });

  // @cap-todo(ac:F-067/AC-4) Contract: compare button + both selects wire change handlers.
  it('buildThreadNavJs wires change handlers on both overlap selects (auto-recompute)', () => {
    const js = ui.buildThreadNavJs();
    const changeHandlerCount = (js.match(/addEventListener\(['"]change['"]/g) || []).length;
    assert.ok(changeHandlerCount >= 2, 'at least two change handlers (selA + selB)');
  });
});

// --- Regression guards for prior features ----------------------------------

describe('cap-ui F-067: regression guards for prior features', () => {
  // F-001: CAP_TAG_TYPES stability is asserted indirectly. We just verify the scanner-facing
  //   tag taxonomy length has not regressed (tag scanner lives in a separate lib).
  it('F-001 guard: CAP_TAG_TYPES length is still 4', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(scanner.CAP_TAG_TYPES.length, 4, 'CAP_TAG_TYPES count stable (feature/todo/risk/decision)');
  });

  // F-066: mind-map should still expose keyboard wiring, which F-067 reused.
  it('F-066 guard: mind-map nodes still carry role="button" + tabindex="0"', () => {
    const g = ui.buildGraphData({
      featureMap: { features: [{ id: 'F-001', title: 'A', state: 'shipped', dependencies: [], usesDesign: [], metadata: {} }] },
      designTokens: [], designComponents: [],
    });
    const layouted = ui.runForceLayout(g.nodes, g.edges);
    const svg = ui.renderMindMapSvg(layouted, g.edges);
    assert.ok(/tabindex="0"/.test(svg), 'mind-map node tabindex preserved');
    assert.ok(/role="button"/.test(svg), 'mind-map node role preserved');
  });

  // F-067 composition: the renderHtml shape must not regress — every required section anchor exists.
  it('F-067 composition guard: all three section anchors appear exactly once in serve-mode HTML', () => {
    const tmp = seedProject();
    try {
      const snap = ui.collectProjectSnapshot(tmp);
      const html = ui.renderHtml({ snapshot: snap, options: { live: true } });
      assert.strictEqual((html.match(/id="threads"/g) || []).length, 1, 'threads anchor exactly once');
      assert.strictEqual((html.match(/id="clusters"/g) || []).length, 1, 'clusters anchor exactly once');
      assert.strictEqual((html.match(/id="keyword-overlap"/g) || []).length, 1, 'keyword-overlap anchor exactly once');
    } finally {
      rmTmp(tmp);
    }
  });
});
