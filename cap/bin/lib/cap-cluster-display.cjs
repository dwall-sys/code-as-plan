'use strict';

// @cap-feature(feature:F-040) Cluster display formatting module -- pure formatters for cluster overview, detail, status section, and realtime notifications.
// @cap-decision Pure formatting functions take data as input and return markdown strings. No direct I/O in formatters for testability. I/O convenience functions wrap formatters with data loading.

const path = require('node:path');

// --- Lazy-loaded dependencies ---

/** @returns {typeof import('./cap-cluster-detect.cjs')} */
function _clusterDetect() {
  return require(path.join(__dirname, 'cap-cluster-detect.cjs'));
}

/** @returns {typeof import('./cap-affinity-engine.cjs')} */
function _affinityEngine() {
  return require(path.join(__dirname, 'cap-affinity-engine.cjs'));
}

/** @returns {typeof import('./cap-realtime-affinity.cjs')} */
function _realtimeAffinity() {
  return require(path.join(__dirname, 'cap-realtime-affinity.cjs'));
}

/** @returns {typeof import('./cap-semantic-pipeline.cjs')} */
function _semanticPipeline() {
  return require(path.join(__dirname, 'cap-semantic-pipeline.cjs'));
}

/** @returns {typeof import('./cap-memory-graph.cjs')} */
function _memoryGraph() {
  return require(path.join(__dirname, 'cap-memory-graph.cjs'));
}

/** @returns {typeof import('./cap-thread-tracker.cjs')} */
function _threadTracker() {
  return require(path.join(__dirname, 'cap-thread-tracker.cjs'));
}

// --- JSDoc Typedefs ---

/**
 * @typedef {Object} Cluster
 * @property {string} id - Cluster ID (hash of sorted member IDs)
 * @property {string[]} members - Thread IDs in this cluster
 * @property {string} label - Human-readable label (e.g., "auth · session · cookies")
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} ClusterOverviewRow
 * @property {number} index - 1-based row number
 * @property {string} label - Cluster label
 * @property {number} memberCount - Number of threads
 * @property {number} avgAffinity - Average pairwise affinity score
 * @property {number} dormantCount - Number of dormant members
 */

/**
 * @typedef {Object} PairwiseRow
 * @property {string} threadA - Thread ID A
 * @property {string} threadB - Thread ID B
 * @property {number} score - Composite affinity score
 * @property {string} strongestSignal - Name of strongest signal
 */

// --- Pure Formatting Functions (no I/O) ---

// @cap-todo(ac:F-040/AC-1) Format overview table of all clusters with labels, member counts, avg affinity, dormant count
// @cap-todo(ac:F-040/AC-7) Consistent markdown table formatting with aligned headers

/**
 * Format a cluster overview table showing all detected clusters.
 *
 * @param {Cluster[]} clusters - Detected clusters with labels and members
 * @param {Object} graph - MemoryGraph instance
 * @param {Object[]} [affinityResults] - Pairwise affinity results for avg score calculation
 * @returns {string} Formatted markdown overview
 */
function formatClusterOverview(clusters, graph, affinityResults) {
  if (!clusters || clusters.length === 0) {
    return [
      'Neural Memory Clusters',
      '',
      'No clusters detected. Run /cap:iterate or /cap:prototype to build thread history,',
      'then affinity scores will be computed automatically.',
    ].join('\n');
  }

  const affinityMap = _buildAffinityMap(affinityResults || []);
  const rows = [];
  let totalThreads = 0;
  let totalDormant = 0;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const memberCount = cluster.members.length;
    const avgAffinity = _computeAvgAffinity(cluster.members, affinityMap);
    const dormantCount = _countDormantMembers(cluster.members, graph);

    totalThreads += memberCount;
    totalDormant += dormantCount;

    rows.push({
      index: i + 1,
      label: cluster.label,
      memberCount,
      avgAffinity,
      dormantCount,
    });
  }

  const lines = [
    'Neural Memory Clusters',
    '',
    '| # | Label | Members | Avg Affinity | Dormant |',
    '|---|-------|---------|-------------|---------|',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.index} | ${row.label} | ${row.memberCount} threads | ${row.avgAffinity.toFixed(2)} | ${row.dormantCount} |`
    );
  }

  lines.push('');
  lines.push(`Total: ${clusters.length} clusters, ${totalThreads} threads, ${totalDormant} dormant nodes`);

  return lines.join('\n');
}

// @cap-todo(ac:F-040/AC-2) Format detail view: members table, pairwise affinity, shared concepts, drift status

/**
 * Format a cluster detail view with members, pairwise scores, shared concepts, drift status.
 *
 * @param {Cluster} cluster - The cluster to display
 * @param {Object[]} affinityResults - All pairwise affinity results
 * @param {Object} graph - MemoryGraph instance
 * @param {Object[]} threads - All thread objects (from thread tracker)
 * @returns {string} Formatted markdown detail view
 */
function formatClusterDetail(cluster, affinityResults, graph, threads) {
  if (!cluster) {
    return 'Cluster not found. Run /cap:cluster to see available clusters.';
  }

  const threadMap = new Map();
  for (const t of threads) {
    threadMap.set(t.id, t);
  }

  const lines = [];

  // Header
  lines.push(`Cluster: ${cluster.label}`);
  lines.push('');

  // Members table
  lines.push('Members:');
  lines.push('| Thread | Name | Joined | Dormant |');
  lines.push('|--------|------|--------|---------|');

  for (const memberId of cluster.members) {
    const thread = threadMap.get(memberId);
    const name = thread ? (thread.name || thread.id) : memberId;
    const joined = _getJoinedDate(memberId, cluster, graph);
    const isDormant = _isNodeDormant(memberId, graph);
    lines.push(`| ${memberId} | ${name} | ${joined} | ${isDormant ? 'yes' : 'no'} |`);
  }

  lines.push('');

  // Pairwise affinity table
  const pairRows = _buildPairwiseRows(cluster.members, affinityResults);

  if (pairRows.length > 0) {
    lines.push('Pairwise Affinity:');
    lines.push('| Thread A | Thread B | Score | Strongest Signal |');
    lines.push('|----------|----------|-------|-----------------|');

    for (const row of pairRows) {
      lines.push(`| ${row.threadA} | ${row.threadB} | ${row.score.toFixed(2)} | ${row.strongestSignal} |`);
    }

    lines.push('');
  }

  // Shared concepts
  const concepts = _extractSharedConcepts(cluster.members, threads);
  if (concepts.length > 0) {
    lines.push(`Shared Concepts: ${concepts.join(', ')}`);
  } else {
    lines.push('Shared Concepts: (none detected)');
  }

  // Drift status
  const driftStatus = _computeDriftStatus(cluster.members, graph);
  lines.push(`Drift Status: ${driftStatus}`);

  return lines.join('\n');
}

// @cap-todo(ac:F-040/AC-3) Format Neural Memory section for /cap:status integration

/**
 * Format the Neural Memory status section for /cap:status.
 *
 * @param {Cluster[]} clusters - Detected clusters
 * @param {Object} graph - MemoryGraph instance
 * @param {Object[]} [affinityResults] - Pairwise affinity results for highest pair
 * @returns {string} Formatted status section
 */
function formatNeuralMemoryStatus(clusters, graph, affinityResults) {
  const activeClusters = (clusters || []).length;
  const dormantCount = _countAllDormantNodes(graph);

  // Find highest affinity pair
  const highestPair = _findHighestAffinityPair(affinityResults || []);

  // Last clustering timestamp from graph metadata
  const lastClustering = (graph && graph.metadata && graph.metadata.lastClusteredAt)
    ? graph.metadata.lastClusteredAt
    : (graph && graph.lastUpdated) || 'never';

  const lines = [
    'Neural Memory',
    `  Active clusters: ${activeClusters}`,
    `  Dormant nodes: ${dormantCount}`,
  ];

  if (highestPair) {
    lines.push(
      `  Highest affinity: ${highestPair.sourceThreadId} \u2194 ${highestPair.targetThreadId} (${highestPair.compositeScore.toFixed(2)}, ${highestPair.band || 'unknown'})`
    );
  } else {
    lines.push('  Highest affinity: (no pairs computed)');
  }

  lines.push(`  Last clustering: ${lastClustering}`);

  return lines.join('\n');
}

// @cap-todo(ac:F-040/AC-4) Format realtime notifications for /cap:start passive check
// @cap-todo(ac:F-040/AC-5) Format realtime notifications for /cap:brainstorm passive check

/**
 * Format realtime affinity notifications for display during /cap:start or /cap:brainstorm.
 * Shows urgent and notify-band threads before session work begins.
 *
 * @param {Array<{band: string, text: string, threadId: string}>} notifications - Formatted notification objects
 * @returns {string} Formatted notification block, or empty string if nothing to show
 */
function formatRealtimeNotifications(notifications) {
  if (!notifications || notifications.length === 0) return '';

  const urgent = notifications.filter(n => n.band === 'urgent');
  const notify = notifications.filter(n => n.band === 'notify');

  if (urgent.length === 0 && notify.length === 0) return '';

  const lines = ['Related Threads (Neural Memory)'];
  lines.push('');

  if (urgent.length > 0) {
    for (const u of urgent) {
      lines.push(u.text);
    }
    lines.push('');
  }

  if (notify.length > 0) {
    for (const n of notify) {
      lines.push(n.text);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- I/O Convenience Functions ---

// @cap-todo(ac:F-040/AC-6) I/O convenience wrappers load data from disk and delegate to pure formatters

/**
 * Load all data and format the cluster overview.
 *
 * @param {string} cwd - Project root directory
 * @returns {string} Formatted overview string
 */
function loadAndFormatOverview(cwd) {
  const { clusters, graph, affinityResults } = _loadClusterData(cwd);
  return formatClusterOverview(clusters, graph, affinityResults);
}

/**
 * Load all data and format a cluster detail view.
 *
 * @param {string} cwd - Project root directory
 * @param {string} clusterLabel - Label of the cluster to display
 * @returns {string} Formatted detail string
 */
function loadAndFormatDetail(cwd, clusterLabel) {
  const { clusters, graph, affinityResults, threads } = _loadClusterData(cwd);

  // Find cluster by label (case-insensitive partial match)
  const normalizedLabel = (clusterLabel || '').toLowerCase().trim();
  const cluster = clusters.find(c =>
    c.label.toLowerCase() === normalizedLabel ||
    c.label.toLowerCase().includes(normalizedLabel)
  );

  if (!cluster) {
    const available = clusters.map(c => `  - ${c.label}`).join('\n');
    return [
      `Cluster "${clusterLabel}" not found.`,
      '',
      'Available clusters:',
      available || '  (none)',
    ].join('\n');
  }

  return formatClusterDetail(cluster, affinityResults, graph, threads);
}

/**
 * Load all data and format the Neural Memory status section.
 * Designed for integration into /cap:status output.
 *
 * @param {string} cwd - Project root directory
 * @returns {string} Formatted status section
 */
function loadAndFormatStatus(cwd) {
  const { clusters, graph, affinityResults } = _loadClusterData(cwd);
  return formatNeuralMemoryStatus(clusters, graph, affinityResults);
}

// --- Internal Helpers ---

/**
 * Load graph, threads, compute affinity, and run cluster detection.
 * Shared data loading for all I/O convenience functions.
 *
 * @param {string} cwd - Project root directory
 * @returns {{clusters: Cluster[], graph: Object, affinityResults: Object[], threads: Object[]}}
 */
function _loadClusterData(cwd) {
  const graphMod = _memoryGraph();
  const threadMod = _threadTracker();
  const affinityMod = _affinityEngine();
  const clusterMod = _clusterDetect();
  const semanticMod = _semanticPipeline();

  // Load graph
  let graph;
  try {
    graph = graphMod.loadGraph(cwd);
  } catch (_err) {
    graph = graphMod.createGraph();
  }

  // Load thread index and all threads
  let threads = [];
  try {
    const index = threadMod.loadIndex(cwd);
    const entries = index.threads || [];
    for (const entry of entries) {
      try {
        const thread = threadMod.loadThread(cwd, entry.id);
        if (thread) threads.push(thread);
      } catch (_e) {
        // Skip unloadable threads
      }
    }
  } catch (_err) {
    // No thread index -- return empty
  }

  // Load affinity config and compute batch affinity
  let affinityResults = [];
  try {
    const config = affinityMod.loadConfig(cwd);
    const context = { graph, allThreads: threads, threadIndex: threads };
    affinityResults = affinityMod.computeAffinityBatch(threads, config, context);
    affinityResults = affinityMod.filterPersistable(affinityResults);
  } catch (_err) {
    // Affinity computation failed -- proceed with empty results
  }

  // Run cluster detection
  let clusters = [];
  try {
    const taxonomy = semanticMod.SEED_TAXONOMY;
    const result = clusterMod.runClusterDetection(affinityResults, graph, threads, { taxonomy });
    clusters = result.clusters || [];
    graph = result.graph || graph;
  } catch (_err) {
    // Cluster detection failed -- proceed with empty clusters
  }

  return { clusters, graph, affinityResults, threads };
}

/**
 * Build a fast lookup map: "tidA|tidB" -> AffinityResult.
 * @param {Object[]} affinityResults
 * @returns {Map<string, Object>}
 */
function _buildAffinityMap(affinityResults) {
  const map = new Map();
  for (const r of affinityResults) {
    const key = _pairKey(r.sourceThreadId, r.targetThreadId);
    const existing = map.get(key);
    if (!existing || r.compositeScore > existing.compositeScore) {
      map.set(key, r);
    }
  }
  return map;
}

/**
 * Create a canonical pair key from two thread IDs.
 * @param {string} tidA
 * @param {string} tidB
 * @returns {string}
 */
function _pairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}|${tidB}` : `${tidB}|${tidA}`;
}

/**
 * Compute average pairwise affinity for cluster members.
 * @param {string[]} members - Thread IDs
 * @param {Map<string, Object>} affinityMap
 * @returns {number}
 */
function _computeAvgAffinity(members, affinityMap) {
  if (members.length < 2) return 0;

  let total = 0;
  let count = 0;

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const key = _pairKey(members[i], members[j]);
      const result = affinityMap.get(key);
      if (result) {
        total += result.compositeScore;
        count++;
      }
    }
  }

  return count > 0 ? total / count : 0;
}

/**
 * Count dormant members in a cluster.
 * @param {string[]} members - Thread IDs
 * @param {Object} graph - MemoryGraph
 * @returns {number}
 */
function _countDormantMembers(members, graph) {
  let count = 0;
  for (const threadId of members) {
    if (_isNodeDormant(threadId, graph)) count++;
  }
  return count;
}

/**
 * Check if a thread node is marked dormant in the graph.
 * @param {string} threadId - Thread ID
 * @param {Object} graph - MemoryGraph
 * @returns {boolean}
 */
function _isNodeDormant(threadId, graph) {
  if (!graph || !graph.nodes) return false;

  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId === threadId) {
      return node.metadata.dormant === true;
    }
  }
  return false;
}

/**
 * Count all dormant nodes in the graph.
 * @param {Object} graph - MemoryGraph
 * @returns {number}
 */
function _countAllDormantNodes(graph) {
  if (!graph || !graph.nodes) return 0;

  let count = 0;
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'thread' && node.metadata && node.metadata.dormant === true) {
      count++;
    }
  }
  return count;
}

/**
 * Get the date a thread joined a cluster (from graph metadata or cluster creation time).
 * @param {string} threadId
 * @param {Cluster} cluster
 * @param {Object} graph
 * @returns {string} ISO date (YYYY-MM-DD) or 'unknown'
 */
function _getJoinedDate(threadId, cluster, graph) {
  // Try to get join date from graph node metadata
  if (graph && graph.nodes) {
    for (const node of Object.values(graph.nodes)) {
      if (node.type === 'thread' && node.metadata && node.metadata.threadId === threadId) {
        if (node.metadata.cluster && node.metadata.cluster.joinedAt) {
          return node.metadata.cluster.joinedAt.slice(0, 10);
        }
      }
    }
  }

  // Fallback to cluster creation time
  if (cluster.createdAt) {
    return cluster.createdAt.slice(0, 10);
  }

  return 'unknown';
}

/**
 * Build pairwise affinity rows for cluster members.
 * @param {string[]} members - Thread IDs
 * @param {Object[]} affinityResults - All affinity results
 * @returns {PairwiseRow[]}
 */
function _buildPairwiseRows(members, affinityResults) {
  const memberSet = new Set(members);
  const rows = [];

  for (const r of affinityResults) {
    if (memberSet.has(r.sourceThreadId) && memberSet.has(r.targetThreadId)) {
      // Find strongest signal
      let strongestSignal = 'composite';
      let strongestScore = r.compositeScore;

      if (r.signals && r.signals.length > 0) {
        const best = r.signals.reduce((a, b) => (b.score > a.score ? b : a), r.signals[0]);
        strongestSignal = `${best.name} (${best.score.toFixed(2)})`;
        strongestScore = r.compositeScore;
      }

      rows.push({
        threadA: r.sourceThreadId,
        threadB: r.targetThreadId,
        score: strongestScore,
        strongestSignal,
      });
    }
  }

  // Sort by score descending
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/**
 * Extract shared concepts across cluster member threads using keyword overlap.
 * @param {string[]} members - Thread IDs
 * @param {Object[]} threads - All thread objects
 * @returns {string[]} Shared concepts/keywords
 */
function _extractSharedConcepts(members, threads) {
  const memberSet = new Set(members);
  const memberThreads = threads.filter(t => memberSet.has(t.id));

  if (memberThreads.length < 2) return [];

  // Count keyword frequency across member threads
  const kwFreq = new Map();
  for (const t of memberThreads) {
    const keywords = t.keywords || [];
    for (const kw of keywords) {
      kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
    }
  }

  // Keep keywords appearing in at least 2 member threads
  const shared = [];
  for (const [kw, count] of kwFreq) {
    if (count >= 2) {
      shared.push(kw);
    }
  }

  // Sort by frequency descending, take top 10
  shared.sort((a, b) => (kwFreq.get(b) || 0) - (kwFreq.get(a) || 0));
  return shared.slice(0, 10);
}

/**
 * Compute drift status for a cluster by checking affinity edge decay in the graph.
 * @param {string[]} members - Thread IDs
 * @param {Object} graph - MemoryGraph
 * @returns {string} Human-readable drift status
 */
function _computeDriftStatus(members, graph) {
  if (!graph || !graph.edges || members.length < 2) {
    return 'stable (insufficient data)';
  }

  // Find thread node IDs for members
  const memberNodeIds = new Set();
  const threadIdToNodeId = new Map();

  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId) {
      if (members.includes(node.metadata.threadId)) {
        memberNodeIds.add(nodeId);
        threadIdToNodeId.set(node.metadata.threadId, nodeId);
      }
    }
  }

  // Check affinity edges between cluster members for decay signals
  let decayedCount = 0;
  let totalEdges = 0;

  for (const edge of graph.edges) {
    if (edge.type !== 'affinity' || !edge.active) continue;
    if (memberNodeIds.has(edge.source) && memberNodeIds.has(edge.target)) {
      totalEdges++;
      if (edge.metadata && edge.metadata.decayApplied) {
        decayedCount++;
      }
    }
  }

  if (totalEdges === 0) return 'stable (no edges)';
  if (decayedCount === 0) return 'stable (no divergence detected)';

  const decayRatio = decayedCount / totalEdges;
  if (decayRatio > 0.5) return `diverging (${decayedCount}/${totalEdges} edges decayed)`;
  if (decayRatio > 0) return `minor drift (${decayedCount}/${totalEdges} edges decayed)`;

  return 'stable (no divergence detected)';
}

/**
 * Find the highest-scoring affinity pair across all results.
 * @param {Object[]} affinityResults
 * @returns {Object|null} The highest-scoring AffinityResult, or null
 */
function _findHighestAffinityPair(affinityResults) {
  if (!affinityResults || affinityResults.length === 0) return null;

  let best = affinityResults[0];
  for (let i = 1; i < affinityResults.length; i++) {
    if (affinityResults[i].compositeScore > best.compositeScore) {
      best = affinityResults[i];
    }
  }
  return best;
}

// --- Module Exports ---

module.exports = {
  // Pure formatting (no I/O)
  formatClusterOverview,
  formatClusterDetail,
  formatNeuralMemoryStatus,
  formatRealtimeNotifications,

  // I/O convenience
  loadAndFormatOverview,
  loadAndFormatDetail,
  loadAndFormatStatus,

  // Internal (for testing)
  _buildAffinityMap,
  _pairKey,
  _computeAvgAffinity,
  _countDormantMembers,
  _isNodeDormant,
  _countAllDormantNodes,
  _getJoinedDate,
  _buildPairwiseRows,
  _extractSharedConcepts,
  _computeDriftStatus,
  _findHighestAffinityPair,
  _loadClusterData,
};
