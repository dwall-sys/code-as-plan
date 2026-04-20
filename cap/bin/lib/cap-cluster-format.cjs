'use strict';

// @cap-feature(feature:F-050) Pure formatting layer extracted from cap-cluster-display.cjs.
// This module contains only the 4 public format* functions. Internal helpers live in cap-cluster-helpers.cjs.
// All functions take data as input and return strings -- no I/O, no requires of detect/affinity/graph modules.
// @cap-feature(feature:F-040) Cluster display formatting -- overview, detail, status, realtime notifications.
// @cap-decision Helpers separated into cap-cluster-helpers.cjs to keep this file under the F-050/AC-1
// 300-line limit. Trade-off: one extra require per format function. Cost is negligible because helpers
// are loaded once at module initialization.

const helpers = require('./cap-cluster-helpers.cjs');

// --- JSDoc Typedefs ---

/**
 * @typedef {Object} Cluster
 * @property {string} id - Cluster ID (hash of sorted member IDs)
 * @property {string[]} members - Thread IDs in this cluster
 * @property {string} label - Human-readable label (e.g., "auth . session . cookies")
 * @property {string} createdAt - ISO timestamp
 */

// --- Pure Formatting Functions (no I/O) ---

// @cap-todo(ac:F-050/AC-1) Pure formatter module -- no I/O, no requires of detect/affinity/graph modules.
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

  const affinityMap = helpers._buildAffinityMap(affinityResults || []);
  const rows = [];
  let totalThreads = 0;
  let totalDormant = 0;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const memberCount = cluster.members.length;
    const avgAffinity = helpers._computeAvgAffinity(cluster.members, affinityMap);
    const dormantCount = helpers._countDormantMembers(cluster.members, graph);

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
    const joined = helpers._getJoinedDate(memberId, cluster, graph);
    const isDormant = helpers._isNodeDormant(memberId, graph);
    lines.push(`| ${memberId} | ${name} | ${joined} | ${isDormant ? 'yes' : 'no'} |`);
  }

  lines.push('');

  // Pairwise affinity table
  const pairRows = helpers._buildPairwiseRows(cluster.members, affinityResults);

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
  const concepts = helpers._extractSharedConcepts(cluster.members, threads);
  if (concepts.length > 0) {
    lines.push(`Shared Concepts: ${concepts.join(', ')}`);
  } else {
    lines.push('Shared Concepts: (none detected)');
  }

  // Drift status
  const driftStatus = helpers._computeDriftStatus(cluster.members, graph);
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
  const dormantCount = helpers._countAllDormantNodes(graph);

  // Find highest affinity pair
  const highestPair = helpers._findHighestAffinityPair(affinityResults || []);

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

module.exports = {
  formatClusterOverview,
  formatClusterDetail,
  formatNeuralMemoryStatus,
  formatRealtimeNotifications,
};
