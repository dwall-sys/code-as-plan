'use strict';

// @cap-feature(feature:F-050) Tests for cap-cluster-helpers.cjs -- pure helper utilities for cluster display.
// These tests target ≥70% line coverage on the helpers module per F-050/AC-3.

const { describe, it } = require('node:test');
const assert = require('node:assert');

const helpers = require('../cap/bin/lib/cap-cluster-helpers.cjs');

// --- Test factories ---

function makeAffinity(src, tgt, score, signals) {
  return {
    sourceThreadId: src,
    targetThreadId: tgt,
    compositeScore: score,
    signals: signals || [],
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

// --- _pairKey ---

describe('_pairKey', () => {
  it('produces canonical (sorted) key regardless of argument order', () => {
    assert.strictEqual(helpers._pairKey('a', 'b'), helpers._pairKey('b', 'a'));
  });

  it('uses lexicographic sort: smaller ID first', () => {
    assert.strictEqual(helpers._pairKey('x', 'a'), 'a|x');
    assert.strictEqual(helpers._pairKey('aaa', 'aab'), 'aaa|aab');
  });

  it('handles identical IDs', () => {
    assert.strictEqual(helpers._pairKey('same', 'same'), 'same|same');
  });
});

// --- _buildAffinityMap ---

describe('_buildAffinityMap', () => {
  it('returns an empty Map for empty input', () => {
    const map = helpers._buildAffinityMap([]);
    assert.ok(map instanceof Map);
    assert.strictEqual(map.size, 0);
  });

  it('keys results by canonical pair key', () => {
    const map = helpers._buildAffinityMap([makeAffinity('a', 'b', 0.5)]);
    assert.strictEqual(map.size, 1);
    assert.ok(map.has('a|b'));
  });

  it('keeps higher-scoring duplicate pairs', () => {
    const map = helpers._buildAffinityMap([
      makeAffinity('a', 'b', 0.3),
      makeAffinity('b', 'a', 0.9),
      makeAffinity('a', 'b', 0.5),
    ]);
    assert.strictEqual(map.get('a|b').compositeScore, 0.9);
  });
});

// --- _computeAvgAffinity ---

describe('_computeAvgAffinity', () => {
  it('returns 0 for empty members', () => {
    assert.strictEqual(helpers._computeAvgAffinity([], new Map()), 0);
  });

  it('returns 0 for a single-member cluster (no pairs to average)', () => {
    assert.strictEqual(helpers._computeAvgAffinity(['t1'], new Map()), 0);
  });

  it('averages pairwise scores for multi-member cluster', () => {
    const map = helpers._buildAffinityMap([
      makeAffinity('a', 'b', 0.6),
      makeAffinity('a', 'c', 0.4),
      makeAffinity('b', 'c', 0.8),
    ]);
    const avg = helpers._computeAvgAffinity(['a', 'b', 'c'], map);
    assert.strictEqual(Math.round(avg * 100) / 100, 0.6);
  });

  it('returns 0 when no pairs exist in the affinity map', () => {
    const map = new Map();
    assert.strictEqual(helpers._computeAvgAffinity(['x', 'y'], map), 0);
  });

  it('skips pairs not present in the map (partial coverage)', () => {
    const map = helpers._buildAffinityMap([makeAffinity('a', 'b', 0.5)]);
    const avg = helpers._computeAvgAffinity(['a', 'b', 'c'], map);
    // Only one pair (a,b) is found out of 3 possible -- avg = 0.5
    assert.strictEqual(avg, 0.5);
  });
});

// --- _isNodeDormant / _countDormantMembers / _countAllDormantNodes ---

describe('dormant-node helpers', () => {
  it('_isNodeDormant returns false for null graph', () => {
    assert.strictEqual(helpers._isNodeDormant('t1', null), false);
  });

  it('_isNodeDormant returns false for graph without nodes field', () => {
    assert.strictEqual(helpers._isNodeDormant('t1', {}), false);
  });

  it('_isNodeDormant returns false for non-thread nodes with same threadId', () => {
    const graph = makeGraph({
      nodes: {
        'n1': { type: 'feature', metadata: { threadId: 't1', dormant: true } },
      },
    });
    assert.strictEqual(helpers._isNodeDormant('t1', graph), false);
  });

  it('_isNodeDormant returns true when matching thread node has dormant:true', () => {
    const graph = makeThreadGraph(['t1', 't2'], ['t1']);
    assert.strictEqual(helpers._isNodeDormant('t1', graph), true);
    assert.strictEqual(helpers._isNodeDormant('t2', graph), false);
  });

  it('_isNodeDormant returns false for unknown threadId', () => {
    const graph = makeThreadGraph(['t1']);
    assert.strictEqual(helpers._isNodeDormant('ghost', graph), false);
  });

  it('_countDormantMembers counts only dormant members', () => {
    const graph = makeThreadGraph(['a', 'b', 'c'], ['a', 'c']);
    assert.strictEqual(helpers._countDormantMembers(['a', 'b', 'c'], graph), 2);
  });

  it('_countDormantMembers returns 0 for empty members', () => {
    assert.strictEqual(helpers._countDormantMembers([], makeGraph()), 0);
  });

  it('_countAllDormantNodes returns 0 for null graph', () => {
    assert.strictEqual(helpers._countAllDormantNodes(null), 0);
  });

  it('_countAllDormantNodes returns 0 for graph with no nodes field', () => {
    assert.strictEqual(helpers._countAllDormantNodes({}), 0);
  });

  it('_countAllDormantNodes counts every dormant thread node', () => {
    const graph = makeThreadGraph(['a', 'b', 'c', 'd'], ['a', 'b']);
    assert.strictEqual(helpers._countAllDormantNodes(graph), 2);
  });

  it('_countAllDormantNodes ignores non-thread node types', () => {
    const graph = makeGraph({
      nodes: {
        'n1': { type: 'feature', metadata: { dormant: true } },
        'n2': { type: 'thread', metadata: { threadId: 't1', dormant: true } },
      },
    });
    assert.strictEqual(helpers._countAllDormantNodes(graph), 1);
  });
});

// --- _getJoinedDate ---

describe('_getJoinedDate', () => {
  it('returns YYYY-MM-DD slice from graph node cluster.joinedAt', () => {
    const graph = makeGraph({
      nodes: {
        'n1': {
          type: 'thread',
          metadata: { threadId: 't1', cluster: { joinedAt: '2026-04-15T08:00:00.000Z' } },
        },
      },
    });
    assert.strictEqual(helpers._getJoinedDate('t1', { createdAt: 'fallback' }, graph), '2026-04-15');
  });

  it('falls back to cluster.createdAt when no graph match', () => {
    const graph = makeGraph();
    const cluster = { createdAt: '2026-02-20T00:00:00.000Z' };
    assert.strictEqual(helpers._getJoinedDate('t1', cluster, graph), '2026-02-20');
  });

  it('returns "unknown" when neither source has a date', () => {
    assert.strictEqual(helpers._getJoinedDate('t1', {}, makeGraph()), 'unknown');
  });

  it('handles null graph gracefully', () => {
    const cluster = { createdAt: '2026-01-01T00:00:00.000Z' };
    assert.strictEqual(helpers._getJoinedDate('t1', cluster, null), '2026-01-01');
  });
});

// --- _buildPairwiseRows ---

describe('_buildPairwiseRows', () => {
  it('returns empty array when no member pairs match', () => {
    const rows = helpers._buildPairwiseRows(['a', 'b'], [makeAffinity('x', 'y', 0.5)]);
    assert.deepStrictEqual(rows, []);
  });

  it('only includes pairs where both endpoints are members', () => {
    const results = [
      makeAffinity('a', 'b', 0.5),
      makeAffinity('a', 'x', 0.9), // x not a member -> excluded
    ];
    const rows = helpers._buildPairwiseRows(['a', 'b'], results);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].threadA, 'a');
  });

  it('sorts rows by score descending', () => {
    const results = [
      makeAffinity('a', 'b', 0.3),
      makeAffinity('a', 'c', 0.9),
      makeAffinity('b', 'c', 0.6),
    ];
    const rows = helpers._buildPairwiseRows(['a', 'b', 'c'], results);
    assert.strictEqual(rows.length, 3);
    assert.ok(rows[0].score >= rows[1].score);
    assert.ok(rows[1].score >= rows[2].score);
  });

  it('uses "composite" label when signals are absent', () => {
    const rows = helpers._buildPairwiseRows(['a', 'b'], [makeAffinity('a', 'b', 0.5)]);
    assert.strictEqual(rows[0].strongestSignal, 'composite');
  });

  it('uses "composite" label when signals array is empty', () => {
    const r = makeAffinity('a', 'b', 0.5, []);
    const rows = helpers._buildPairwiseRows(['a', 'b'], [r]);
    assert.strictEqual(rows[0].strongestSignal, 'composite');
  });

  it('picks the highest-scoring signal name when signals exist', () => {
    const r = makeAffinity('a', 'b', 0.7, [
      { name: 'temporal', score: 0.2 },
      { name: 'concept', score: 0.85 },
      { name: 'shared-files', score: 0.5 },
    ]);
    const rows = helpers._buildPairwiseRows(['a', 'b'], [r]);
    assert.ok(rows[0].strongestSignal.includes('concept'));
  });
});

// --- _extractSharedConcepts ---

describe('_extractSharedConcepts', () => {
  it('returns empty array for fewer than 2 member threads', () => {
    const result = helpers._extractSharedConcepts(['only-one'], [{ id: 'only-one', keywords: ['a', 'b'] }]);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when no member threads found in input', () => {
    const result = helpers._extractSharedConcepts(['ghost1', 'ghost2'], [{ id: 'real', keywords: ['x'] }]);
    assert.deepStrictEqual(result, []);
  });

  it('extracts keywords appearing in 2+ member threads', () => {
    const threads = [
      { id: 't1', keywords: ['auth', 'session', 'jwt'] },
      { id: 't2', keywords: ['auth', 'session', 'cookie'] },
      { id: 't3', keywords: ['payment'] },
    ];
    const result = helpers._extractSharedConcepts(['t1', 't2', 't3'], threads);
    assert.ok(result.includes('auth'));
    assert.ok(result.includes('session'));
    assert.ok(!result.includes('jwt'), 'jwt only in 1 thread');
    assert.ok(!result.includes('cookie'), 'cookie only in 1 thread');
    assert.ok(!result.includes('payment'), 'payment only in 1 thread');
  });

  it('handles threads without a keywords field', () => {
    const result = helpers._extractSharedConcepts(['t1', 't2'], [{ id: 't1' }, { id: 't2' }]);
    assert.deepStrictEqual(result, []);
  });

  it('limits output to top 10 keywords', () => {
    const kws = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const result = helpers._extractSharedConcepts(
      ['t1', 't2'],
      [{ id: 't1', keywords: kws }, { id: 't2', keywords: kws }]
    );
    assert.ok(result.length <= 10);
  });

  it('sorts by frequency descending', () => {
    const threads = [
      { id: 't1', keywords: ['popular', 'rare1'] },
      { id: 't2', keywords: ['popular', 'rare1'] },
      { id: 't3', keywords: ['popular'] },
    ];
    const result = helpers._extractSharedConcepts(['t1', 't2', 't3'], threads);
    assert.strictEqual(result[0], 'popular', 'most frequent should be first');
  });
});

// --- _computeDriftStatus ---

describe('_computeDriftStatus', () => {
  it('returns "stable (insufficient data)" for null graph', () => {
    assert.ok(helpers._computeDriftStatus(['a', 'b'], null).includes('insufficient data'));
  });

  it('returns "stable (insufficient data)" for graph without edges', () => {
    assert.ok(helpers._computeDriftStatus(['a', 'b'], { nodes: {} }).includes('insufficient data'));
  });

  it('returns "stable (insufficient data)" for fewer than 2 members', () => {
    assert.ok(helpers._computeDriftStatus(['a'], makeGraph()).includes('insufficient data'));
  });

  it('returns "stable (no edges)" when no affinity edges between members', () => {
    const graph = makeThreadGraph(['t1', 't2']);
    graph.edges = [];
    assert.strictEqual(helpers._computeDriftStatus(['t1', 't2'], graph), 'stable (no edges)');
  });

  it('skips inactive edges', () => {
    const graph = makeThreadGraph(['t1', 't2']);
    graph.edges = [
      { type: 'affinity', active: false, source: 'node-t1', target: 'node-t2', metadata: {} },
    ];
    assert.strictEqual(helpers._computeDriftStatus(['t1', 't2'], graph), 'stable (no edges)');
  });

  it('skips non-affinity edges', () => {
    const graph = makeThreadGraph(['t1', 't2']);
    graph.edges = [
      { type: 'depends_on', active: true, source: 'node-t1', target: 'node-t2', metadata: {} },
    ];
    assert.strictEqual(helpers._computeDriftStatus(['t1', 't2'], graph), 'stable (no edges)');
  });

  it('returns "stable (no divergence detected)" for active affinity with no decay', () => {
    const graph = makeThreadGraph(['t1', 't2']);
    graph.edges = [
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t2', metadata: {} },
    ];
    assert.ok(helpers._computeDriftStatus(['t1', 't2'], graph).includes('no divergence'));
  });

  it('returns "diverging" when more than half the edges are decayed', () => {
    const graph = makeThreadGraph(['t1', 't2', 't3']);
    graph.edges = [
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t2', metadata: { decayApplied: true } },
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t3', metadata: { decayApplied: true } },
      { type: 'affinity', active: true, source: 'node-t2', target: 'node-t3', metadata: {} },
    ];
    assert.ok(helpers._computeDriftStatus(['t1', 't2', 't3'], graph).includes('diverging'));
  });

  it('returns "minor drift" when some but not most edges are decayed', () => {
    const graph = makeThreadGraph(['t1', 't2', 't3', 't4']);
    graph.edges = [
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t2', metadata: { decayApplied: true } },
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t3', metadata: {} },
      { type: 'affinity', active: true, source: 'node-t1', target: 'node-t4', metadata: {} },
      { type: 'affinity', active: true, source: 'node-t2', target: 'node-t3', metadata: {} },
    ];
    assert.ok(helpers._computeDriftStatus(['t1', 't2', 't3', 't4'], graph).includes('minor drift'));
  });

  it('skips nodes without metadata.threadId', () => {
    const graph = makeGraph({
      nodes: {
        'n1': { type: 'thread', metadata: {} }, // no threadId
        'n2': { type: 'thread', metadata: { threadId: 't2' } },
      },
      edges: [],
    });
    const result = helpers._computeDriftStatus(['t1', 't2'], graph);
    assert.ok(result.includes('stable'));
  });

  it('skips nodes with null metadata', () => {
    const graph = makeGraph({
      nodes: {
        'n1': { type: 'thread', metadata: null },
      },
      edges: [],
    });
    assert.ok(helpers._computeDriftStatus(['t1', 't2'], graph).includes('stable'));
  });
});

// --- _findHighestAffinityPair ---

describe('_findHighestAffinityPair', () => {
  it('returns null for null input', () => {
    assert.strictEqual(helpers._findHighestAffinityPair(null), null);
  });

  it('returns null for empty array', () => {
    assert.strictEqual(helpers._findHighestAffinityPair([]), null);
  });

  it('returns the only result when array has one element', () => {
    const r = makeAffinity('a', 'b', 0.5);
    assert.strictEqual(helpers._findHighestAffinityPair([r]), r);
  });

  it('returns the highest-scoring result', () => {
    const results = [
      makeAffinity('a', 'b', 0.3),
      makeAffinity('c', 'd', 0.9),
      makeAffinity('e', 'f', 0.6),
    ];
    const best = helpers._findHighestAffinityPair(results);
    assert.strictEqual(best.compositeScore, 0.9);
    assert.strictEqual(best.sourceThreadId, 'c');
  });

  it('returns first encountered when scores are equal', () => {
    const results = [
      makeAffinity('a', 'b', 0.5),
      makeAffinity('c', 'd', 0.5),
    ];
    const best = helpers._findHighestAffinityPair(results);
    assert.strictEqual(best.sourceThreadId, 'a');
  });
});
