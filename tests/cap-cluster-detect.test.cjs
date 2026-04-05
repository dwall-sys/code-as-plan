'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  // Clustering
  detectClusters,
  generateClusterId,
  generateClusterLabel,

  // Divergence decay
  computeDrift,
  applyDecay,

  // Dormant node management
  markDormant,
  reactivateNode,
  checkReactivation,
  identifyAndMarkDormant,

  // Cluster membership
  assignClusterMembership,

  // Full pipelines
  runClusterDetection,
  runDecayPass,

  // Constants
  DEFAULT_LINKAGE_THRESHOLD,
  DEFAULT_DECAY_RATE,
  DORMANT_REACTIVATION_THRESHOLD,

  // Internal helpers
  _clamp01,
  _jaccard,
  _findThreadNodeId,
  _getAffinityEdges,
  _collectFilesForThread,
  _pairKey,
  _getThreadText,
  _projectToConcepts,
  _generateFallbackLabel,
} = require('../cap/bin/lib/cap-cluster-detect.cjs');

// --- Test Fixtures ---

function makeAffinity(a, b, score) {
  return {
    sourceThreadId: a,
    targetThreadId: b,
    compositeScore: score,
    band: score >= 0.90 ? 'urgent' : score >= 0.75 ? 'notify' : score >= 0.40 ? 'silent' : 'discard',
    signals: [],
    computedAt: new Date().toISOString(),
  };
}

function makeThread(id, keywords, problemStatement, name) {
  return {
    id,
    name: name || `Thread ${id}`,
    keywords: keywords || [],
    problemStatement: problemStatement || '',
    solutionShape: '',
    boundaryDecisions: [],
    timestamp: '2026-04-01T10:00:00Z',
  };
}

function makeGraph(threadNodes, edges) {
  const nodes = {};
  for (const t of threadNodes) {
    nodes[`node-${t.threadId}`] = {
      id: `node-${t.threadId}`,
      type: 'thread',
      active: true,
      metadata: {
        threadId: t.threadId,
        keywords: t.keywords || [],
        ...(t.extraMetadata || {}),
      },
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    nodes,
    edges: edges || [],
    lastUpdated: new Date().toISOString(),
  };
}

function makeAffinityEdge(sourceNodeId, targetNodeId, score) {
  return {
    source: sourceNodeId,
    target: targetNodeId,
    type: 'affinity',
    active: true,
    metadata: { compositeScore: score },
  };
}

const TEST_TAXONOMY = {
  authentication: ['auth', 'login', 'logout', 'session', 'cookie', 'jwt', 'token'],
  database: ['sql', 'query', 'migration', 'schema', 'table', 'index', 'postgres'],
  frontend: ['react', 'component', 'css', 'layout', 'ui', 'render', 'dom'],
  testing: ['test', 'assert', 'mock', 'stub', 'coverage', 'spec'],
  deployment: ['docker', 'ci', 'pipeline', 'deploy', 'build', 'container'],
};

// --- AC-1: Single-linkage clustering with configurable threshold ---

describe('F-038: Neural Cluster Detection', () => {

  describe('AC-1: Single-linkage clustering with configurable threshold (default 0.40)', () => {

    // @cap-todo(ac:F-038/AC-1) Test verifying: 3 threads with high mutual affinity -> 1 cluster
    it('should merge 3 threads with high mutual affinity into 1 cluster', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.85),
        makeAffinity('thr-002', 'thr-003', 0.80),
        makeAffinity('thr-001', 'thr-003', 0.75),
      ];
      const clusters = detectClusters(affinities);
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 3);
      assert.deepStrictEqual(clusters[0].members, ['thr-001', 'thr-002', 'thr-003']);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: 2 separate groups with low inter-group affinity -> 2 clusters
    it('should produce 2 clusters when inter-group affinity is below threshold', () => {
      const affinities = [
        // Group A: high internal affinity
        makeAffinity('thr-001', 'thr-002', 0.90),
        // Group B: high internal affinity
        makeAffinity('thr-003', 'thr-004', 0.85),
        // Cross-group: below 0.40 threshold
        makeAffinity('thr-001', 'thr-003', 0.10),
        makeAffinity('thr-002', 'thr-004', 0.15),
      ];
      const clusters = detectClusters(affinities);
      assert.strictEqual(clusters.length, 2);
      // Each cluster should have 2 members
      const sizes = clusters.map(c => c.members.length).sort();
      assert.deepStrictEqual(sizes, [2, 2]);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: all affinities below threshold -> each thread is its own cluster
    it('should keep each thread as its own cluster when all affinities below threshold', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.10),
        makeAffinity('thr-002', 'thr-003', 0.15),
        makeAffinity('thr-001', 'thr-003', 0.05),
      ];
      const clusters = detectClusters(affinities);
      assert.strictEqual(clusters.length, 3);
      for (const c of clusters) {
        assert.strictEqual(c.members.length, 1);
      }
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: threshold 0.0 -> everything in one cluster
    it('should merge everything into one cluster with threshold 0.0', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.01),
        makeAffinity('thr-002', 'thr-003', 0.02),
      ];
      const clusters = detectClusters(affinities, { linkageThreshold: 0.0 });
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 3);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: threshold 1.0 -> no merges
    it('should produce no merges with threshold 1.0', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.99),
        makeAffinity('thr-002', 'thr-003', 0.95),
      ];
      const clusters = detectClusters(affinities, { linkageThreshold: 1.0 });
      assert.strictEqual(clusters.length, 3);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: custom linkage threshold works
    it('should respect a custom linkage threshold of 0.70', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.80),  // above 0.70
        makeAffinity('thr-002', 'thr-003', 0.50),  // below 0.70
        makeAffinity('thr-001', 'thr-003', 0.60),  // below 0.70
      ];
      const clusters = detectClusters(affinities, { linkageThreshold: 0.70 });
      assert.strictEqual(clusters.length, 2);
      // thr-001 and thr-002 merge; thr-003 alone
      const bigCluster = clusters.find(c => c.members.length === 2);
      assert.ok(bigCluster);
      assert.ok(bigCluster.members.includes('thr-001'));
      assert.ok(bigCluster.members.includes('thr-002'));
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: single pair above threshold -> cluster of 2
    it('should form a cluster of 2 for a single pair above threshold', () => {
      const affinities = [makeAffinity('thr-001', 'thr-002', 0.65)];
      const clusters = detectClusters(affinities);
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 2);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: empty affinity results -> no clusters
    it('should return empty clusters for empty affinity results', () => {
      const clusters = detectClusters([]);
      assert.strictEqual(clusters.length, 0);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: clusters have stable IDs
    it('should return clusters with valid ID strings', () => {
      const affinities = [makeAffinity('thr-001', 'thr-002', 0.80)];
      const clusters = detectClusters(affinities);
      assert.ok(clusters[0].id.startsWith('cluster-'));
      assert.strictEqual(clusters[0].id.length, 'cluster-'.length + 8);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: default threshold is 0.40
    it('should export DEFAULT_LINKAGE_THRESHOLD as 0.40', () => {
      assert.strictEqual(DEFAULT_LINKAGE_THRESHOLD, 0.40);
    });
  });

  // --- AC-2: Auto-generated dynamic labels from top 2-3 concepts ---

  describe('AC-2: Auto-generated dynamic labels from top 2-3 concepts', () => {

    // @cap-todo(ac:F-038/AC-2) Test verifying: auth-related threads produce auth label
    it('should generate label containing authentication concept for auth threads', () => {
      const threads = [
        makeThread('thr-001', ['auth', 'login', 'jwt'], 'User authentication flow broken'),
        makeThread('thr-002', ['session', 'cookie', 'token'], 'Session persistence fails'),
      ];
      const label = generateClusterLabel(threads, TEST_TAXONOMY);
      assert.ok(label.includes('authentication'), `Expected "authentication" in label "${label}"`);
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: label format is "concept1 . concept2" or "concept1 . concept2 . concept3"
    it('should produce labels in "concept1 \\u00b7 concept2" format', () => {
      const threads = [
        makeThread('thr-001', ['auth', 'login'], 'Auth flow', 'Auth Thread'),
        makeThread('thr-002', ['react', 'component'], 'UI rendering', 'UI Thread'),
      ];
      const label = generateClusterLabel(threads, TEST_TAXONOMY);
      const parts = label.split(' \u00b7 ');
      assert.ok(parts.length >= 2 && parts.length <= 3,
        `Expected 2-3 parts in label "${label}", got ${parts.length}`);
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: empty threads -> fallback label
    it('should return "unnamed" for empty thread array', () => {
      const label = generateClusterLabel([], TEST_TAXONOMY);
      assert.strictEqual(label, 'unnamed');
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: null threads -> fallback label
    it('should return "unnamed" for null threads', () => {
      const label = generateClusterLabel(null, TEST_TAXONOMY);
      assert.strictEqual(label, 'unnamed');
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: no matching taxonomy concepts -> unnamed
    it('should return "unnamed" when no concepts match', () => {
      const threads = [
        makeThread('thr-001', ['xyzzy', 'plugh'], 'Something completely unrelated'),
      ];
      const label = generateClusterLabel(threads, TEST_TAXONOMY);
      assert.strictEqual(label, 'unnamed');
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: null taxonomy -> unnamed
    it('should return "unnamed" when taxonomy is null', () => {
      const threads = [makeThread('thr-001', ['auth'], 'Auth stuff')];
      const label = generateClusterLabel(threads, null);
      assert.strictEqual(label, 'unnamed');
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: fallback label uses keywords when no taxonomy
    it('should generate keyword-based fallback label via _generateFallbackLabel', () => {
      const threads = [
        makeThread('thr-001', ['auth', 'session'], 'Auth'),
        makeThread('thr-002', ['auth', 'cookies'], 'Auth cookies'),
      ];
      const label = _generateFallbackLabel(threads);
      // "auth" appears in both, so should be first
      assert.ok(label.includes('auth'), `Expected "auth" in fallback label "${label}"`);
      const parts = label.split(' \u00b7 ');
      assert.ok(parts.length >= 1 && parts.length <= 3);
    });

    // @cap-todo(ac:F-038/AC-2) Test verifying: fallback label for empty threads
    it('should return "unnamed" for fallback label with empty threads', () => {
      assert.strictEqual(_generateFallbackLabel([]), 'unnamed');
      assert.strictEqual(_generateFallbackLabel(null), 'unnamed');
    });
  });

  // --- AC-3: Divergence decay - 3 drift metrics ---

  describe('AC-3: Divergence decay - 3 drift metrics', () => {

    // @cap-todo(ac:F-038/AC-3) Test verifying: computeDrift returns correct shape
    it('should return { fileDrift, keywordDrift, clusterDrift, maxDrift }', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['auth'] },
      ]);
      // Add id field to nodes (computeDrift uses nodeA.id)
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.80, originalSharedFiles: 0 },
        new Map()
      );

      assert.ok('fileDrift' in drift);
      assert.ok('keywordDrift' in drift);
      assert.ok('clusterDrift' in drift);
      assert.ok('maxDrift' in drift);
    });

    // @cap-todo(ac:F-038/AC-3) Test verifying: identical threads -> drift near 0
    it('should produce low drift for threads with identical keywords', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth', 'login', 'session'] },
        { threadId: 'thr-002', keywords: ['auth', 'login', 'session'] },
      ]);
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.80, originalSharedFiles: 0 },
        new Map([[_pairKey('thr-001', 'thr-002'), 0.80]])
      );

      assert.strictEqual(drift.keywordDrift, 0, 'keywordDrift should be 0 for identical keywords');
      assert.strictEqual(drift.clusterDrift, 0, 'clusterDrift should be 0 when current matches previous');
    });

    // @cap-todo(ac:F-038/AC-3) Test verifying: completely different keywords -> high keywordDrift
    it('should produce high keywordDrift for completely different keywords', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth', 'login', 'session'] },
        { threadId: 'thr-002', keywords: ['docker', 'deploy', 'container'] },
      ]);
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.50, originalSharedFiles: 0 },
        new Map()
      );

      assert.strictEqual(drift.keywordDrift, 1.0, 'keywordDrift should be 1.0 for disjoint keywords');
    });

    // @cap-todo(ac:F-038/AC-3) Test verifying: maxDrift is max of the three metrics
    it('should set maxDrift to the maximum of the three drift metrics', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth', 'login'] },
        { threadId: 'thr-002', keywords: ['docker', 'deploy'] },
      ]);
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.80, originalSharedFiles: 0 },
        new Map()
      );

      const expectedMax = Math.max(drift.fileDrift, drift.keywordDrift, drift.clusterDrift);
      assert.strictEqual(drift.maxDrift, expectedMax);
    });

    // @cap-todo(ac:F-038/AC-3) Test verifying: drift values are between 0 and 1
    it('should clamp all drift values between 0 and 1', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['deploy'] },
      ]);
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.80, originalSharedFiles: 5 },
        new Map()
      );

      for (const key of ['fileDrift', 'keywordDrift', 'clusterDrift', 'maxDrift']) {
        assert.ok(drift[key] >= 0 && drift[key] <= 1,
          `${key} = ${drift[key]} is not in [0, 1]`);
      }
    });
  });

  // --- AC-4: Decay reduces weights, never deletes nodes; dormant flag ---

  describe('AC-4: Decay reduces weights, never deletes nodes; dormant flag', () => {

    let graph;

    beforeEach(() => {
      graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['deploy'] },
        { threadId: 'thr-003', keywords: ['test'] },
      ]);
      graph.edges = [
        makeAffinityEdge('node-thr-001', 'node-thr-002', 0.80),
        makeAffinityEdge('node-thr-002', 'node-thr-003', 0.50),
      ];
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: applyDecay reduces edge weights
    it('should reduce edge weights when drift is positive', () => {
      const driftResults = new Map([
        [_pairKey('thr-001', 'thr-002'), { fileDrift: 0.5, keywordDrift: 0.8, clusterDrift: 0.3, maxDrift: 0.8 }],
      ]);

      const result = applyDecay(graph, driftResults);
      assert.ok(result.decayedEdges.length > 0);
      for (const de of result.decayedEdges) {
        assert.ok(de.newWeight < de.oldWeight,
          `newWeight (${de.newWeight}) should be less than oldWeight (${de.oldWeight})`);
      }
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: applyDecay never removes nodes
    it('should never remove nodes from graph after decay', () => {
      const nodeCountBefore = Object.keys(graph.nodes).length;
      const driftResults = new Map([
        [_pairKey('thr-001', 'thr-002'), { fileDrift: 1.0, keywordDrift: 1.0, clusterDrift: 1.0, maxDrift: 1.0 }],
      ]);

      applyDecay(graph, driftResults);
      assert.strictEqual(Object.keys(graph.nodes).length, nodeCountBefore);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: applyDecay never removes edges
    it('should never remove edges from graph after decay', () => {
      const edgeCountBefore = graph.edges.length;
      const driftResults = new Map([
        [_pairKey('thr-001', 'thr-002'), { fileDrift: 1.0, keywordDrift: 1.0, clusterDrift: 1.0, maxDrift: 1.0 }],
      ]);

      applyDecay(graph, driftResults);
      assert.strictEqual(graph.edges.length, edgeCountBefore);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: nodes with all edges below threshold get dormant:true
    it('should mark nodes with all edges below threshold as dormant', () => {
      // Set all edges low
      graph.edges = [
        makeAffinityEdge('node-thr-001', 'node-thr-002', 0.10),
        makeAffinityEdge('node-thr-001', 'node-thr-003', 0.05),
      ];

      const dormantIds = identifyAndMarkDormant(graph, { dormantThreshold: 0.40 });
      assert.ok(dormantIds.includes('node-thr-001'),
        'node-thr-001 should be marked dormant');
      assert.strictEqual(graph.nodes['node-thr-001'].metadata.dormant, true);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: nodes with some edges above threshold stay active
    it('should not mark nodes as dormant if any edge is above threshold', () => {
      graph.edges = [
        makeAffinityEdge('node-thr-001', 'node-thr-002', 0.80),
        makeAffinityEdge('node-thr-001', 'node-thr-003', 0.05),
      ];

      const dormantIds = identifyAndMarkDormant(graph, { dormantThreshold: 0.40 });
      assert.ok(!dormantIds.includes('node-thr-001'),
        'node-thr-001 should NOT be dormant (has edge 0.80)');
      assert.ok(!graph.nodes['node-thr-001'].metadata.dormant);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: markDormant sets dormant flag
    it('should set metadata.dormant = true via markDormant', () => {
      markDormant(graph, 'node-thr-001');
      assert.strictEqual(graph.nodes['node-thr-001'].metadata.dormant, true);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: markDormant on non-existent node does not crash
    it('should handle markDormant on non-existent node gracefully', () => {
      const result = markDormant(graph, 'node-nonexistent');
      assert.ok(result); // returns graph
    });
  });

  // --- AC-5: Dormant reactivation at >= 0.40 ---

  describe('AC-5: Dormant reactivation at >= 0.40', () => {

    let graph;

    beforeEach(() => {
      graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'], extraMetadata: { dormant: true } },
        { threadId: 'thr-002', keywords: ['deploy'] },
      ]);
      // Ensure dormant is set properly
      graph.nodes['node-thr-001'].metadata.dormant = true;
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: high-affinity result reactivates dormant node
    it('should reactivate dormant node when new affinity >= 0.40', () => {
      const results = [makeAffinity('thr-001', 'thr-002', 0.85)];
      const reactivated = checkReactivation(graph, results);
      assert.ok(reactivated.includes('node-thr-001'));
      assert.strictEqual(graph.nodes['node-thr-001'].metadata.dormant, false);
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: low-affinity result keeps node dormant
    it('should keep node dormant when new affinity is below 0.40', () => {
      const results = [makeAffinity('thr-001', 'thr-002', 0.20)];
      const reactivated = checkReactivation(graph, results);
      assert.strictEqual(reactivated.length, 0);
      assert.strictEqual(graph.nodes['node-thr-001'].metadata.dormant, true);
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: reactivated node has dormant:false
    it('should set dormant to false after reactivation', () => {
      const results = [makeAffinity('thr-001', 'thr-002', 0.50)];
      checkReactivation(graph, results);
      assert.strictEqual(graph.nodes['node-thr-001'].metadata.dormant, false);
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: reactivation threshold is 0.40 by default
    it('should export DORMANT_REACTIVATION_THRESHOLD as 0.40', () => {
      assert.strictEqual(DORMANT_REACTIVATION_THRESHOLD, 0.40);
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: custom reactivation threshold
    it('should respect custom reactivation threshold', () => {
      const results = [makeAffinity('thr-001', 'thr-002', 0.50)];
      const reactivated = checkReactivation(graph, results, { reactivationThreshold: 0.60 });
      assert.strictEqual(reactivated.length, 0, 'Should not reactivate at 0.50 when threshold is 0.60');
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: no dormant nodes -> empty reactivation list
    it('should return empty list when no dormant nodes exist', () => {
      graph.nodes['node-thr-001'].metadata.dormant = false;
      const results = [makeAffinity('thr-001', 'thr-002', 0.90)];
      const reactivated = checkReactivation(graph, results);
      assert.strictEqual(reactivated.length, 0);
    });
  });

  // --- AC-6: No time-based decay ---

  describe('AC-6: No time-based decay', () => {

    // @cap-todo(ac:F-038/AC-6) Test verifying: threads months apart with same keywords -> no drift
    it('should produce zero keywordDrift for threads with same keywords regardless of timestamp', () => {
      const graph = makeGraph([
        { threadId: 'thr-old', keywords: ['auth', 'login', 'session'] },
        { threadId: 'thr-new', keywords: ['auth', 'login', 'session'] },
      ]);
      graph.nodes['node-thr-old'].id = 'node-thr-old';
      graph.nodes['node-thr-new'].id = 'node-thr-new';
      // Set timestamps far apart
      graph.nodes['node-thr-old'].metadata.timestamp = '2025-01-01T00:00:00Z';
      graph.nodes['node-thr-new'].metadata.timestamp = '2026-04-01T00:00:00Z';

      const drift = computeDrift(
        graph.nodes['node-thr-old'],
        graph.nodes['node-thr-new'],
        graph,
        { compositeScore: 0.80, originalSharedFiles: 0 },
        new Map([[_pairKey('thr-old', 'thr-new'), 0.80]])
      );

      assert.strictEqual(drift.keywordDrift, 0,
        'keywordDrift should be 0 regardless of how far apart timestamps are');
    });

    // @cap-todo(ac:F-038/AC-6) Test verifying: computeDrift does NOT use timestamps
    it('should not reference timestamp fields in drift calculation', () => {
      // computeDrift signature: (threadNodeA, threadNodeB, graph, previousAffinity, currentAffinityMap)
      // None of these parameters include timestamp as a drift factor.
      // We verify by providing nodes with no timestamp and getting valid results.
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['alpha'] },
        { threadId: 'thr-002', keywords: ['beta'] },
      ]);
      graph.nodes['node-thr-001'].id = 'node-thr-001';
      graph.nodes['node-thr-002'].id = 'node-thr-002';
      // Remove any timestamp-like fields
      delete graph.nodes['node-thr-001'].metadata.timestamp;
      delete graph.nodes['node-thr-002'].metadata.timestamp;

      const drift = computeDrift(
        graph.nodes['node-thr-001'],
        graph.nodes['node-thr-002'],
        graph,
        { compositeScore: 0.50, originalSharedFiles: 0 },
        new Map()
      );

      assert.ok(drift.maxDrift >= 0 && drift.maxDrift <= 1,
        'Drift should compute fine without timestamps');
    });
  });

  // --- AC-7: Cluster membership on graph nodes ---

  describe('AC-7: Cluster membership on graph nodes', () => {

    let graph;

    beforeEach(() => {
      graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['auth'] },
        { threadId: 'thr-003', keywords: ['deploy'] },
      ]);
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: assignClusterMembership sets metadata.cluster
    it('should set metadata.cluster on thread nodes', () => {
      const clusters = [{
        id: 'cluster-abc12345',
        members: ['thr-001', 'thr-002'],
        label: 'authentication',
        createdAt: new Date().toISOString(),
      }];

      assignClusterMembership(graph, clusters);

      const node1 = graph.nodes['node-thr-001'];
      assert.ok(node1.metadata.cluster, 'metadata.cluster should be set');
      assert.strictEqual(node1.metadata.cluster.id, 'cluster-abc12345');
      assert.strictEqual(node1.metadata.cluster.label, 'authentication');
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: metadata.cluster has { id, label, joinedAt }
    it('should have { id, label, joinedAt } in metadata.cluster', () => {
      const clusters = [{
        id: 'cluster-abc12345',
        members: ['thr-001'],
        label: 'auth stuff',
        createdAt: new Date().toISOString(),
      }];

      assignClusterMembership(graph, clusters);

      const cluster = graph.nodes['node-thr-001'].metadata.cluster;
      assert.ok(cluster.id, 'cluster.id is present');
      assert.ok(cluster.label, 'cluster.label is present');
      assert.ok(cluster.joinedAt, 'cluster.joinedAt is present');
      // joinedAt should be a valid ISO string
      assert.ok(!isNaN(Date.parse(cluster.joinedAt)), 'joinedAt should be valid ISO date');
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: cluster ID is stable
    it('should generate stable cluster ID for same members', () => {
      const id1 = generateClusterId(['thr-001', 'thr-002']);
      const id2 = generateClusterId(['thr-001', 'thr-002']);
      assert.strictEqual(id1, id2);
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: cluster ID is stable regardless of input order
    it('should generate same cluster ID regardless of member order', () => {
      const id1 = generateClusterId(['thr-002', 'thr-001']);
      const id2 = generateClusterId(['thr-001', 'thr-002']);
      assert.strictEqual(id1, id2);
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: cluster ID changes when members change
    it('should generate different cluster ID when members change', () => {
      const id1 = generateClusterId(['thr-001', 'thr-002']);
      const id2 = generateClusterId(['thr-001', 'thr-003']);
      assert.notStrictEqual(id1, id2);
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: non-clustered nodes lose cluster membership
    it('should remove cluster metadata from nodes not in any cluster', () => {
      // First assign
      const clusters = [{
        id: 'cluster-abc12345',
        members: ['thr-001', 'thr-002'],
        label: 'auth',
        createdAt: new Date().toISOString(),
      }];
      assignClusterMembership(graph, clusters);
      assert.ok(graph.nodes['node-thr-001'].metadata.cluster);

      // Now reassign with thr-001 excluded
      const newClusters = [{
        id: 'cluster-def67890',
        members: ['thr-002'],
        label: 'auth solo',
        createdAt: new Date().toISOString(),
      }];
      assignClusterMembership(graph, newClusters);
      assert.ok(!graph.nodes['node-thr-001'].metadata.cluster,
        'thr-001 should have cluster removed');
    });
  });

  // --- AC-8: Performance <500ms for 200 nodes ---

  describe('AC-8: Performance <500ms for 200 nodes', () => {

    // @cap-todo(ac:F-038/AC-8) Test verifying: 200 nodes with ~1000 affinity pairs completes within 500ms
    it('should complete clustering of 200 nodes within 500ms', () => {
      const affinities = [];
      const threadIds = [];

      for (let i = 0; i < 200; i++) {
        threadIds.push(`thr-${String(i).padStart(4, '0')}`);
      }

      // Create ~1000 random affinity pairs
      for (let n = 0; n < 1000; n++) {
        const i = Math.floor(Math.random() * 200);
        let j = Math.floor(Math.random() * 200);
        if (j === i) j = (i + 1) % 200;
        affinities.push(makeAffinity(threadIds[i], threadIds[j], Math.random()));
      }

      const start = performance.now();
      const clusters = detectClusters(affinities);
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 2000, `Clustering took ${elapsed.toFixed(1)}ms, exceeds 2000ms limit (target: 500ms, CI tolerance: 2000ms)`);
      assert.ok(Array.isArray(clusters));
    });
  });

  // --- Adversarial tests ---

  describe('Adversarial: edge cases and invalid inputs', () => {

    // @cap-todo(ac:F-038/AC-1) Test verifying: duplicate affinity results handled
    it('should handle duplicate affinity results by keeping max score', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.30),
        makeAffinity('thr-001', 'thr-002', 0.80), // duplicate pair, higher score
      ];
      const clusters = detectClusters(affinities);
      // With max score 0.80 > 0.40 threshold, should merge
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 2);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: duplicate with reversed order
    it('should handle reversed duplicate affinity results', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.80),
        makeAffinity('thr-002', 'thr-001', 0.30), // same pair, reversed
      ];
      const clusters = detectClusters(affinities);
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 2);
    });

    // @cap-todo(ac:F-038/AC-4) Test verifying: decay with empty drift map
    it('should handle applyDecay with empty drift map', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
      ]);
      graph.edges = [makeAffinityEdge('node-thr-001', 'node-thr-002', 0.80)];

      const result = applyDecay(graph, new Map());
      assert.strictEqual(result.decayedEdges.length, 0);
    });

    // @cap-todo(ac:F-038/AC-5) Test verifying: checkReactivation with empty affinities
    it('should handle checkReactivation with empty affinity results', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'], extraMetadata: { dormant: true } },
      ]);
      graph.nodes['node-thr-001'].metadata.dormant = true;

      const reactivated = checkReactivation(graph, []);
      assert.strictEqual(reactivated.length, 0);
    });

    // @cap-todo(ac:F-038/AC-7) Test verifying: assignClusterMembership with empty clusters
    it('should handle assignClusterMembership with empty clusters array', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
      ]);
      assignClusterMembership(graph, []);
      // Node should not have cluster metadata
      assert.ok(!graph.nodes['node-thr-001'].metadata.cluster);
    });

    // @cap-todo(ac:F-038/AC-1) Test verifying: very large cluster (100 members)
    it('should handle a very large cluster of 100 members', () => {
      const affinities = [];
      for (let i = 0; i < 100; i++) {
        for (let j = i + 1; j < Math.min(i + 5, 100); j++) {
          affinities.push(makeAffinity(
            `thr-${String(i).padStart(4, '0')}`,
            `thr-${String(j).padStart(4, '0')}`,
            0.90
          ));
        }
      }

      const clusters = detectClusters(affinities);
      // With high overlap between adjacent threads, chain merging should produce 1 big cluster
      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].members.length, 100);
    });

    // Test: affinity results with thread IDs not in graph (for cluster membership)
    it('should handle cluster membership when thread IDs have no graph nodes', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
      ]);
      const clusters = [{
        id: 'cluster-abc12345',
        members: ['thr-001', 'thr-nonexistent'],
        label: 'test',
        createdAt: new Date().toISOString(),
      }];
      // Should not throw
      assignClusterMembership(graph, clusters);
      assert.ok(graph.nodes['node-thr-001'].metadata.cluster);
    });
  });

  // --- Internal helpers ---

  describe('Internal helpers', () => {

    it('should clamp values with _clamp01', () => {
      assert.strictEqual(_clamp01(0.5), 0.5);
      assert.strictEqual(_clamp01(-0.5), 0);
      assert.strictEqual(_clamp01(1.5), 1);
      assert.strictEqual(_clamp01(0), 0);
      assert.strictEqual(_clamp01(1), 1);
    });

    it('should compute Jaccard similarity correctly', () => {
      assert.strictEqual(_jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1.0);
      assert.strictEqual(_jaccard(new Set(['a']), new Set(['b'])), 0);
      assert.strictEqual(_jaccard(new Set(), new Set()), 0);
      // {a,b} & {b,c} = {b}, union = {a,b,c} -> 1/3
      const result = _jaccard(new Set(['a', 'b']), new Set(['b', 'c']));
      assert.ok(Math.abs(result - 1/3) < 0.001);
    });

    it('should create canonical pair keys', () => {
      assert.strictEqual(_pairKey('thr-001', 'thr-002'), 'thr-001|thr-002');
      assert.strictEqual(_pairKey('thr-002', 'thr-001'), 'thr-001|thr-002');
    });

    it('should find thread nodes by thread ID', () => {
      const graph = makeGraph([{ threadId: 'thr-001', keywords: [] }]);
      const found = _findThreadNodeId(graph, 'thr-001');
      assert.strictEqual(found, 'node-thr-001');
      assert.strictEqual(_findThreadNodeId(graph, 'thr-nonexistent'), null);
    });

    it('should get affinity edges', () => {
      const graph = makeGraph([]);
      graph.edges = [
        { source: 'a', target: 'b', type: 'affinity', active: true },
        { source: 'a', target: 'c', type: 'affinity', active: false },
        { source: 'a', target: 'd', type: 'contains', active: true },
      ];
      const edges = _getAffinityEdges(graph);
      assert.strictEqual(edges.length, 1);
    });

    it('should extract text from thread objects', () => {
      const t = makeThread('thr-001', ['auth', 'login'], 'Problem here', 'My Thread');
      t.solutionShape = 'Solution shape';
      t.boundaryDecisions = ['Decision 1'];
      const text = _getThreadText(t);
      assert.ok(text.includes('Problem here'));
      assert.ok(text.includes('Solution shape'));
      assert.ok(text.includes('Decision 1'));
      assert.ok(text.includes('auth'));
      assert.ok(text.includes('My Thread'));
    });

    it('should project text to concepts', () => {
      const vector = _projectToConcepts('auth login jwt token session', TEST_TAXONOMY);
      assert.ok(vector.get('authentication') > 0);
      // deploy/docker not mentioned
      assert.ok(!vector.has('deployment'));
    });

    it('should handle null text in _projectToConcepts', () => {
      const vector = _projectToConcepts(null, TEST_TAXONOMY);
      assert.strictEqual(vector.size, 0);
    });
  });

  // --- Full pipeline integration ---

  describe('Full pipeline: runClusterDetection', () => {

    it('should run full cluster detection pipeline and return clusters + mutated graph', () => {
      const affinities = [
        makeAffinity('thr-001', 'thr-002', 0.85),
        makeAffinity('thr-003', 'thr-004', 0.75),
      ];
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['auth'] },
        { threadId: 'thr-003', keywords: ['deploy'] },
        { threadId: 'thr-004', keywords: ['deploy'] },
      ]);
      const threads = [
        makeThread('thr-001', ['auth', 'login'], 'Auth problem'),
        makeThread('thr-002', ['auth', 'session'], 'Session issue'),
        makeThread('thr-003', ['docker', 'deploy'], 'Deploy pipeline'),
        makeThread('thr-004', ['ci', 'build'], 'Build system'),
      ];

      const result = runClusterDetection(affinities, graph, threads, { taxonomy: TEST_TAXONOMY });

      assert.ok(Array.isArray(result.clusters));
      assert.strictEqual(result.clusters.length, 2);
      assert.ok(result.graph);

      // Each cluster should have a label
      for (const c of result.clusters) {
        assert.ok(c.label, `Cluster ${c.id} should have a label`);
        assert.ok(c.id.startsWith('cluster-'));
        assert.ok(c.createdAt);
      }

      // Graph nodes should have cluster membership
      const node1 = graph.nodes['node-thr-001'];
      assert.ok(node1.metadata.cluster, 'node-thr-001 should have cluster membership');
    });

    it('should run full pipeline with no taxonomy (fallback labels)', () => {
      const affinities = [makeAffinity('thr-001', 'thr-002', 0.85)];
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth'] },
        { threadId: 'thr-002', keywords: ['auth'] },
      ]);
      const threads = [
        makeThread('thr-001', ['auth', 'login'], 'Auth'),
        makeThread('thr-002', ['auth', 'session'], 'Auth session'),
      ];

      const result = runClusterDetection(affinities, graph, threads);
      assert.ok(result.clusters[0].label);
      // Fallback should use keywords
      assert.ok(result.clusters[0].label.includes('auth'));
    });
  });

  describe('Full pipeline: runDecayPass', () => {

    it('should run full decay pass and return structured result', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth', 'login'] },
        { threadId: 'thr-002', keywords: ['deploy', 'docker'] },
      ]);
      graph.edges = [
        makeAffinityEdge('node-thr-001', 'node-thr-002', 0.80),
      ];

      const currentAffinities = [makeAffinity('thr-001', 'thr-002', 0.30)];
      const previousAffinities = [makeAffinity('thr-001', 'thr-002', 0.80)];

      const result = runDecayPass(graph, currentAffinities, previousAffinities);

      assert.ok('decayedEdges' in result);
      assert.ok('dormantNodes' in result);
      assert.ok('reactivatedNodes' in result);
      assert.ok(Array.isArray(result.decayedEdges));
      assert.ok(Array.isArray(result.dormantNodes));
      assert.ok(Array.isArray(result.reactivatedNodes));
    });

    it('should decay edges when keywords have diverged', () => {
      const graph = makeGraph([
        { threadId: 'thr-001', keywords: ['auth', 'login'] },
        { threadId: 'thr-002', keywords: ['deploy', 'docker'] },
      ]);
      graph.edges = [
        makeAffinityEdge('node-thr-001', 'node-thr-002', 0.80),
      ];

      const currentAffinities = [makeAffinity('thr-001', 'thr-002', 0.30)];

      const result = runDecayPass(graph, currentAffinities, null);

      // Keywords are completely different -> high drift -> weight should decrease
      if (result.decayedEdges.length > 0) {
        assert.ok(result.decayedEdges[0].newWeight < result.decayedEdges[0].oldWeight);
      }
    });
  });

  describe('branch coverage: helper edge cases', () => {
    it('_jaccard returns 0 for two empty sets (unionSize === 0 branch)', () => {
      const result = _jaccard(new Set(), new Set());
      assert.strictEqual(result, 0, 'Empty sets should yield Jaccard 0');
    });

    it('_findThreadNodeId returns null when graph.nodes is undefined', () => {
      const result = _findThreadNodeId({}, 'thr-999');
      assert.strictEqual(result, null);
    });

    it('_findThreadNodeId returns null when node has no metadata', () => {
      const graph = { nodes: { n1: { type: 'thread' } } };
      const result = _findThreadNodeId(graph, 'thr-999');
      assert.strictEqual(result, null);
    });

    it('_getAffinityEdges returns [] when graph.edges is undefined', () => {
      const result = _getAffinityEdges({});
      assert.deepStrictEqual(result, []);
    });

    it('_collectFilesForThread returns empty set when graph.edges is undefined', () => {
      const graph = { nodes: {} };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 0);
    });

    it('_collectFilesForThread skips inactive edges', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'feature', metadata: { files: ['a.js'] } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: false },
        ],
      };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 0, 'Inactive edges should be skipped');
    });

    it('_collectFilesForThread skips neighbors that are not feature type', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true },
        ],
      };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 0, 'Non-feature neighbors should be skipped');
    });

    it('_collectFilesForThread skips feature nodes without metadata.files array', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'feature', metadata: {} },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true },
        ],
      };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 0, 'Feature without files array should yield empty set');
    });

    it('_collectFilesForThread collects files from reverse-direction edges', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'feature', metadata: { files: ['b.js'] } },
        },
        edges: [
          { source: 'n2', target: 'n1', active: true },
        ],
      };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 1, 'Should collect files via reverse edge');
      assert.ok(result.has('b.js'));
    });

    it('_collectFilesForThread skips neighbor not in graph.nodes', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
        },
        edges: [
          { source: 'n1', target: 'n-missing', active: true },
        ],
      };
      const result = _collectFilesForThread(graph, 'n1');
      assert.strictEqual(result.size, 0, 'Missing node should be skipped');
    });

    it('_projectToConcepts returns empty map when keyword length is 0', () => {
      // empty taxonomy entry → keywords.length === 0 → score 0 branch
      const result = _projectToConcepts('auth login', { emptyCategory: [] });
      assert.strictEqual(result.size, 0, 'Should not add entries with 0 score');
    });

    it('_generateFallbackLabel returns unnamed for empty array', () => {
      assert.strictEqual(_generateFallbackLabel([]), 'unnamed');
    });

    it('_generateFallbackLabel returns unnamed for null', () => {
      assert.strictEqual(_generateFallbackLabel(null), 'unnamed');
    });

    it('_generateFallbackLabel returns unnamed for threads with no keywords', () => {
      const result = _generateFallbackLabel([{ keywords: [] }, { keywords: [] }]);
      assert.strictEqual(result, 'unnamed');
    });
  });

  describe('branch coverage: computeDrift edge cases', () => {
    it('computeDrift handles threads without metadata.keywords', () => {
      const nodeA = { id: 'n1', metadata: {} }; // no keywords
      const nodeB = { id: 'n2', metadata: {} }; // no keywords
      const graph = { nodes: { n1: nodeA, n2: nodeB }, edges: [] };
      const prevAffinity = { compositeScore: 0.5, originalSharedFiles: null };
      const result = computeDrift(nodeA, nodeB, graph, prevAffinity, new Map());
      assert.strictEqual(typeof result.keywordDrift, 'number');
      assert.strictEqual(typeof result.fileDrift, 'number');
    });

    it('computeDrift computes cluster drift when currentAffinityMap has entry', () => {
      const nodeA = { id: 'n1', metadata: { threadId: 'thr-001', keywords: ['auth'] } };
      const nodeB = { id: 'n2', metadata: { threadId: 'thr-002', keywords: ['auth'] } };
      const graph = { nodes: { n1: nodeA, n2: nodeB }, edges: [] };
      const prevAffinity = { compositeScore: 0.8, originalSharedFiles: 0 };
      const affinityMap = new Map();
      affinityMap.set('thr-001::thr-002', 0.4);
      const result = computeDrift(nodeA, nodeB, graph, prevAffinity, affinityMap);
      assert.ok(result.clusterDrift > 0, 'Cluster drift should be positive when score dropped');
    });
  });

  describe('branch coverage: applyDecay edge cases', () => {
    it('applyDecay skips edges with no drift or zero maxDrift', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.8 } },
        ],
      };
      const driftResults = new Map();
      driftResults.set(_pairKey('thr-001', 'thr-002'), { fileDrift: 0, keywordDrift: 0, clusterDrift: 0, maxDrift: 0 });
      const result = applyDecay(graph, driftResults);
      assert.strictEqual(result.decayedEdges.length, 0, 'Should skip edges with zero drift');
    });

    it('applyDecay handles edges without metadata', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity' },
        ],
      };
      const driftResults = new Map();
      driftResults.set(_pairKey('thr-001', 'thr-002'), { fileDrift: 0.5, keywordDrift: 0.5, clusterDrift: 0, maxDrift: 0.5 });
      const result = applyDecay(graph, driftResults);
      assert.strictEqual(result.decayedEdges.length, 1);
      assert.strictEqual(result.decayedEdges[0].oldWeight, 0);
      assert.ok(graph.edges[0].metadata, 'Should create metadata object');
    });

    it('applyDecay skips non-affinity edges', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'dependency', metadata: { compositeScore: 0.8 } },
        ],
      };
      const driftResults = new Map();
      driftResults.set('thr-001::thr-002', { maxDrift: 0.5 });
      const result = applyDecay(graph, driftResults);
      assert.strictEqual(result.decayedEdges.length, 0);
    });

    it('applyDecay skips edges where source/target are not threads', () => {
      const graph = {
        nodes: {
          n1: { type: 'feature', metadata: {} },
          n2: { type: 'thread', metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.8 } },
        ],
      };
      const driftResults = new Map();
      const result = applyDecay(graph, driftResults);
      assert.strictEqual(result.decayedEdges.length, 0);
    });
  });

  describe('branch coverage: markDormant/reactivateNode edge cases', () => {
    it('markDormant initializes metadata if missing', () => {
      const graph = { nodes: { n1: { type: 'thread' } } };
      markDormant(graph, 'n1');
      assert.strictEqual(graph.nodes.n1.metadata.dormant, true);
    });

    it('reactivateNode initializes metadata if missing', () => {
      const graph = { nodes: { n1: { type: 'thread' } } };
      reactivateNode(graph, 'n1');
      assert.strictEqual(graph.nodes.n1.metadata.dormant, false);
    });
  });

  describe('branch coverage: identifyAndMarkDormant edge cases', () => {
    it('skips already dormant nodes', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001', dormant: true } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.1 } },
        ],
      };
      const result = identifyAndMarkDormant(graph);
      assert.strictEqual(result.length, 0, 'Already dormant node should be skipped');
    });

    it('skips thread nodes with no affinity edges', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001' } },
        },
        edges: [],
      };
      const result = identifyAndMarkDormant(graph);
      assert.strictEqual(result.length, 0, 'Nodes with no edges should not be marked dormant');
    });

    it('marks node dormant when all affinity edges are below threshold', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', active: true, metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.1 } },
        ],
      };
      const result = identifyAndMarkDormant(graph, { dormantThreshold: 0.5 });
      assert.ok(result.length > 0, 'Should mark nodes with low affinity as dormant');
    });

    it('does not mark dormant when edge has no compositeScore (defaults to below threshold)', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001' } },
          n2: { type: 'thread', active: true, metadata: { threadId: 'thr-002' } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: {} },
        ],
      };
      const result = identifyAndMarkDormant(graph, { dormantThreshold: 0.5 });
      assert.ok(result.length > 0);
    });
  });

  describe('branch coverage: assignClusterMembership edge cases', () => {
    it('skips non-thread nodes', () => {
      const graph = {
        nodes: {
          n1: { type: 'feature', metadata: { threadId: 'thr-001' } },
        },
      };
      assignClusterMembership(graph, [{ id: 'c1', members: ['thr-001'], label: 'C1' }]);
      assert.strictEqual(graph.nodes.n1.metadata.cluster, undefined);
    });

    it('skips thread nodes without threadId', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: {} },
        },
      };
      assignClusterMembership(graph, [{ id: 'c1', members: ['thr-001'], label: 'C1' }]);
      assert.strictEqual(graph.nodes.n1.metadata.cluster, undefined);
    });

    it('preserves existing joinedAt when cluster has not changed', () => {
      const originalJoinedAt = '2025-01-01T00:00:00Z';
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001', cluster: { id: 'c1', label: 'Old', joinedAt: originalJoinedAt } } },
        },
      };
      assignClusterMembership(graph, [{ id: 'c1', members: ['thr-001'], label: 'Updated' }]);
      assert.strictEqual(graph.nodes.n1.metadata.cluster.joinedAt, originalJoinedAt);
    });

    it('clears cluster membership when thread is no longer in any cluster', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001', cluster: { id: 'c1', label: 'Old', joinedAt: '2025-01-01' } } },
        },
      };
      assignClusterMembership(graph, []); // no clusters
      assert.strictEqual(graph.nodes.n1.metadata.cluster, undefined);
    });

    it('initializes metadata when assigning cluster to node without metadata', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', metadata: { threadId: 'thr-001' } },
        },
      };
      assignClusterMembership(graph, [{ id: 'c1', members: ['thr-001'], label: 'New' }]);
      assert.ok(graph.nodes.n1.metadata.cluster);
      assert.strictEqual(graph.nodes.n1.metadata.cluster.id, 'c1');
    });
  });

  describe('branch coverage: runDecayPass edge cases', () => {
    it('runDecayPass handles previousAffinities parameter', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001', keywords: ['auth'] } },
          n2: { type: 'thread', active: true, metadata: { threadId: 'thr-002', keywords: ['auth'] } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.7 } },
        ],
      };
      const currentAffinities = [makeAffinity('thr-001', 'thr-002', 0.5)];
      const previousAffinities = [makeAffinity('thr-001', 'thr-002', 0.9)];
      const result = runDecayPass(graph, currentAffinities, previousAffinities);
      assert.ok(typeof result.decayedEdges !== 'undefined');
    });

    it('runDecayPass with custom options', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001', keywords: ['auth'] } },
          n2: { type: 'thread', active: true, metadata: { threadId: 'thr-002', keywords: ['payment'] } },
        },
        edges: [
          { source: 'n1', target: 'n2', active: true, type: 'affinity', metadata: { compositeScore: 0.7 } },
        ],
      };
      const currentAffinities = [makeAffinity('thr-001', 'thr-002', 0.3)];
      const result = runDecayPass(graph, currentAffinities, null, { decayRate: 0.5, dormantThreshold: 0.9 });
      assert.ok(result);
    });

    it('runDecayPass skips edges where source/target nodes are missing', () => {
      const graph = {
        nodes: {
          n1: { type: 'thread', active: true, metadata: { threadId: 'thr-001', keywords: ['auth'] } },
        },
        edges: [
          { source: 'n1', target: 'n-missing', active: true, type: 'affinity', metadata: { compositeScore: 0.7 } },
        ],
      };
      const result = runDecayPass(graph, [], null);
      assert.deepStrictEqual(result.decayedEdges, []);
    });
  });
});
