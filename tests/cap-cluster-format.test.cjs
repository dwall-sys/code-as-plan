'use strict';

// @cap-feature(feature:F-050) Tests for cap-cluster-format.cjs -- pure formatter functions.
// Targets ≥70% line coverage on the format module per F-050/AC-3.

const { describe, it } = require('node:test');
const assert = require('node:assert');

const format = require('../cap/bin/lib/cap-cluster-format.cjs');

// --- Test factories ---

function makeCluster(opts = {}) {
  return {
    id: opts.id || 'c1',
    members: opts.members || ['t1', 't2'],
    label: opts.label || 'auth . session',
    createdAt: opts.createdAt || '2026-04-01T00:00:00.000Z',
  };
}

function makeGraph(opts = {}) {
  return {
    nodes: opts.nodes || {},
    edges: opts.edges || [],
    metadata: opts.metadata || {},
    lastUpdated: opts.lastUpdated || '2026-04-01T00:00:00.000Z',
  };
}

function makeThreadGraph(threadIds, dormantIds = []) {
  const nodes = {};
  for (const tid of threadIds) {
    nodes[`node-${tid}`] = {
      type: 'thread',
      metadata: { threadId: tid, dormant: dormantIds.includes(tid) },
    };
  }
  return makeGraph({ nodes });
}

function makeAffinity(src, tgt, score, signals) {
  return {
    sourceThreadId: src,
    targetThreadId: tgt,
    compositeScore: score,
    band: score >= 0.9 ? 'urgent' : score >= 0.75 ? 'notify' : 'silent',
    signals: signals || [],
  };
}

// --- formatClusterOverview ---

describe('formatClusterOverview', () => {
  it('returns "No clusters detected" message for empty clusters', () => {
    const out = format.formatClusterOverview([], makeGraph(), []);
    assert.ok(out.includes('No clusters detected'));
    assert.ok(out.includes('Neural Memory Clusters'));
  });

  it('returns "No clusters detected" for null clusters', () => {
    const out = format.formatClusterOverview(null, makeGraph(), []);
    assert.ok(out.includes('No clusters detected'));
  });

  it('renders markdown table headers', () => {
    const out = format.formatClusterOverview([makeCluster()], makeGraph(), []);
    assert.ok(out.includes('| # | Label | Members | Avg Affinity | Dormant |'));
    assert.ok(out.includes('|---|'));
  });

  it('renders one row per cluster with member count', () => {
    const clusters = [
      makeCluster({ label: 'auth', members: ['t1', 't2'] }),
      makeCluster({ id: 'c2', label: 'ui', members: ['t3'] }),
    ];
    const out = format.formatClusterOverview(clusters, makeGraph(), []);
    assert.ok(out.includes('auth'));
    assert.ok(out.includes('ui'));
    assert.ok(out.includes('2 threads'));
    assert.ok(out.includes('1 threads'));
  });

  it('computes avg affinity from results', () => {
    const clusters = [makeCluster({ members: ['t1', 't2'] })];
    const out = format.formatClusterOverview(clusters, makeGraph(), [makeAffinity('t1', 't2', 0.85)]);
    assert.ok(out.includes('0.85'));
  });

  it('counts dormant members per cluster', () => {
    const clusters = [makeCluster({ members: ['t1', 't2', 't3'] })];
    const graph = makeThreadGraph(['t1', 't2', 't3'], ['t1', 't2']);
    const out = format.formatClusterOverview(clusters, graph, []);
    // Dormant count column should show 2
    const lines = out.split('\n').filter(l => l.includes('|') && l.includes('threads'));
    assert.ok(lines.length >= 1);
    // Last column is dormant count
    assert.ok(lines[0].endsWith('| 2 |'));
  });

  it('outputs total summary line', () => {
    const clusters = [
      makeCluster({ members: ['t1', 't2'] }),
      makeCluster({ id: 'c2', members: ['t3', 't4', 't5'] }),
    ];
    const out = format.formatClusterOverview(clusters, makeGraph(), []);
    assert.ok(out.includes('Total: 2 clusters'));
    assert.ok(out.includes('5 threads'));
  });

  it('handles null affinityResults parameter', () => {
    const out = format.formatClusterOverview([makeCluster()], makeGraph(), null);
    assert.ok(out.includes('Neural Memory Clusters'));
    assert.ok(out.includes('0.00'), 'avg should be 0 when no affinity data');
  });
});

// --- formatClusterDetail ---

describe('formatClusterDetail', () => {
  it('returns "Cluster not found" for null cluster', () => {
    const out = format.formatClusterDetail(null, [], makeGraph(), []);
    assert.ok(out.includes('Cluster not found'));
  });

  it('returns "Cluster not found" for undefined cluster', () => {
    const out = format.formatClusterDetail(undefined, [], makeGraph(), []);
    assert.ok(out.includes('Cluster not found'));
  });

  it('shows cluster label in header', () => {
    const cluster = makeCluster({ label: 'auth . session . cookies' });
    const out = format.formatClusterDetail(cluster, [], makeGraph(), []);
    assert.ok(out.includes('Cluster: auth . session . cookies'));
  });

  it('renders members table with thread names', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const threads = [
      { id: 't1', name: 'Auth Handler' },
      { id: 't2', name: 'Session Mgr' },
    ];
    const out = format.formatClusterDetail(cluster, [], makeGraph(), threads);
    assert.ok(out.includes('Members:'));
    assert.ok(out.includes('Auth Handler'));
    assert.ok(out.includes('Session Mgr'));
  });

  it('falls back to thread.id when name missing', () => {
    const cluster = makeCluster({ members: ['t1'] });
    const threads = [{ id: 't1' }]; // no name
    const out = format.formatClusterDetail(cluster, [], makeGraph(), threads);
    assert.ok(out.includes('| t1 | t1 |'));
  });

  it('falls back to memberId when thread not in input', () => {
    const cluster = makeCluster({ members: ['ghost'] });
    const out = format.formatClusterDetail(cluster, [], makeGraph(), []);
    assert.ok(out.includes('ghost'));
  });

  it('omits pairwise table when no matching pairs', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const out = format.formatClusterDetail(cluster, [], makeGraph(), []);
    assert.ok(!out.includes('Pairwise Affinity:'));
  });

  it('renders pairwise table with rows when matching pairs exist', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const out = format.formatClusterDetail(
      cluster,
      [makeAffinity('t1', 't2', 0.65)],
      makeGraph(),
      []
    );
    assert.ok(out.includes('Pairwise Affinity:'));
    assert.ok(out.includes('| Thread A | Thread B | Score | Strongest Signal |'));
    assert.ok(out.includes('0.65'));
  });

  it('shows shared concepts when threads have keyword overlap', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const threads = [
      { id: 't1', keywords: ['auth', 'jwt'] },
      { id: 't2', keywords: ['auth', 'cookie'] },
    ];
    const out = format.formatClusterDetail(cluster, [], makeGraph(), threads);
    assert.ok(out.includes('Shared Concepts: auth'));
  });

  it('shows "(none detected)" when no shared concepts', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const threads = [
      { id: 't1', keywords: ['a'] },
      { id: 't2', keywords: ['b'] },
    ];
    const out = format.formatClusterDetail(cluster, [], makeGraph(), threads);
    assert.ok(out.includes('Shared Concepts: (none detected)'));
  });

  it('shows drift status', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const out = format.formatClusterDetail(cluster, [], makeGraph(), []);
    assert.ok(out.includes('Drift Status:'));
  });

  it('marks dormant members as "yes" in members table', () => {
    const cluster = makeCluster({ members: ['t1', 't2'] });
    const graph = makeThreadGraph(['t1', 't2'], ['t1']);
    const threads = [{ id: 't1' }, { id: 't2' }];
    const out = format.formatClusterDetail(cluster, [], graph, threads);
    // First member t1 is dormant -> last col should be "yes"
    const memberLines = out.split('\n').filter(l => l.startsWith('| t'));
    assert.ok(memberLines[0].endsWith('| yes |'));
    assert.ok(memberLines[1].endsWith('| no |'));
  });
});

// --- formatNeuralMemoryStatus ---

describe('formatNeuralMemoryStatus', () => {
  it('shows zero counts for empty input', () => {
    const out = format.formatNeuralMemoryStatus([], makeGraph(), []);
    assert.ok(out.includes('Neural Memory'));
    assert.ok(out.includes('Active clusters: 0'));
    assert.ok(out.includes('Dormant nodes: 0'));
    assert.ok(out.includes('(no pairs computed)'));
  });

  it('counts active clusters from input array length', () => {
    const out = format.formatNeuralMemoryStatus([makeCluster(), makeCluster({ id: 'c2' })], makeGraph(), []);
    assert.ok(out.includes('Active clusters: 2'));
  });

  it('handles null clusters input', () => {
    const out = format.formatNeuralMemoryStatus(null, makeGraph(), []);
    assert.ok(out.includes('Active clusters: 0'));
  });

  it('handles null graph input', () => {
    const out = format.formatNeuralMemoryStatus([], null, []);
    assert.ok(out.includes('Dormant nodes: 0'));
    assert.ok(out.includes('Last clustering: never'));
  });

  it('handles undefined affinityResults', () => {
    const out = format.formatNeuralMemoryStatus([], makeGraph(), undefined);
    assert.ok(out.includes('(no pairs computed)'));
  });

  it('shows highest-affinity pair with band', () => {
    const out = format.formatNeuralMemoryStatus([], makeGraph(), [
      makeAffinity('alpha', 'beta', 0.30),
      makeAffinity('gamma', 'delta', 0.92),
    ]);
    assert.ok(out.includes('gamma'));
    assert.ok(out.includes('delta'));
    assert.ok(out.includes('0.92'));
    assert.ok(out.includes('urgent'));
  });

  it('falls back to "unknown" band when missing', () => {
    const out = format.formatNeuralMemoryStatus([], makeGraph(), [
      { sourceThreadId: 'x', targetThreadId: 'y', compositeScore: 0.5 },
    ]);
    assert.ok(out.includes('unknown'));
  });

  it('reads lastClusteredAt from graph metadata', () => {
    const graph = makeGraph({ metadata: { lastClusteredAt: '2026-04-15T10:00:00.000Z' } });
    const out = format.formatNeuralMemoryStatus([], graph, []);
    assert.ok(out.includes('Last clustering: 2026-04-15T10:00:00.000Z'));
  });

  it('falls back to graph.lastUpdated when lastClusteredAt missing', () => {
    const graph = makeGraph({ lastUpdated: '2026-03-15T00:00:00.000Z' });
    const out = format.formatNeuralMemoryStatus([], graph, []);
    assert.ok(out.includes('2026-03-15T00:00:00.000Z'));
  });

  it('shows "never" when no timestamp available anywhere', () => {
    const out = format.formatNeuralMemoryStatus([], { metadata: {}, nodes: {} }, []);
    assert.ok(out.includes('Last clustering: never'));
  });
});

// --- formatRealtimeNotifications ---

describe('formatRealtimeNotifications', () => {
  it('returns empty string for null input', () => {
    assert.strictEqual(format.formatRealtimeNotifications(null), '');
  });

  it('returns empty string for undefined input', () => {
    assert.strictEqual(format.formatRealtimeNotifications(undefined), '');
  });

  it('returns empty string for empty array', () => {
    assert.strictEqual(format.formatRealtimeNotifications([]), '');
  });

  it('returns empty string when only silent notifications present', () => {
    assert.strictEqual(
      format.formatRealtimeNotifications([{ band: 'silent', text: 'x', threadId: 't' }]),
      ''
    );
  });

  it('returns empty string for unrecognized bands', () => {
    assert.strictEqual(
      format.formatRealtimeNotifications([
        { band: 'debug', text: 'x', threadId: 't' },
        { band: 'trace', text: 'y', threadId: 'u' },
      ]),
      ''
    );
  });

  it('renders urgent notifications under header', () => {
    const out = format.formatRealtimeNotifications([
      { band: 'urgent', text: 'URGENT: thread-a', threadId: 'a' },
    ]);
    assert.ok(out.includes('Related Threads (Neural Memory)'));
    assert.ok(out.includes('URGENT: thread-a'));
  });

  it('renders notify notifications under header', () => {
    const out = format.formatRealtimeNotifications([
      { band: 'notify', text: 'Related: thread-b', threadId: 'b' },
    ]);
    assert.ok(out.includes('Related: thread-b'));
  });

  it('orders urgent before notify', () => {
    const out = format.formatRealtimeNotifications([
      { band: 'notify', text: 'NOTIFY-X', threadId: 'x' },
      { band: 'urgent', text: 'URGENT-Y', threadId: 'y' },
    ]);
    assert.ok(out.indexOf('URGENT-Y') < out.indexOf('NOTIFY-X'));
  });

  it('excludes silent notifications from output', () => {
    const out = format.formatRealtimeNotifications([
      { band: 'urgent', text: 'URG', threadId: 'a' },
      { band: 'silent', text: 'SIL', threadId: 'b' },
    ]);
    assert.ok(out.includes('URG'));
    assert.ok(!out.includes('SIL'));
  });
});
