'use strict';

// @cap-feature(feature:F-050) Pure helper utilities for cluster display formatting.
// Extracted from the original 696-line cap-cluster-display.cjs as part of the F-050 split. These
// functions take graph/affinity/thread data as input and return primitive values (numbers, strings,
// arrays, Maps). Zero I/O. Zero requires of detect/affinity/graph/thread modules.
// @cap-decision Helpers live in their own module to keep both the formatter (cap-cluster-format.cjs)
// and the orchestrator (cap-cluster-display.cjs) under the F-050/AC-1 300-line cap.

// --- JSDoc Typedefs ---

/**
 * @typedef {Object} PairwiseRow
 * @property {string} threadA - Thread ID A
 * @property {string} threadB - Thread ID B
 * @property {number} score - Composite affinity score
 * @property {string} strongestSignal - Name of strongest signal with score
 */

// @cap-todo(ac:F-050/AC-1) Pure helpers in their own module to keep formatter file under 300 lines.

/**
 * Build a fast lookup map: "tidA|tidB" -> AffinityResult. Higher-scoring duplicates win.
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
 * Create a canonical pair key from two thread IDs (lexicographically smaller ID first).
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
 * @param {Object} cluster - Object with createdAt fallback
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
 * Build pairwise affinity rows for cluster members. Sorted by score descending.
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
 * Extract shared concepts across cluster member threads using keyword overlap (>= 2 threads).
 * @param {string[]} members - Thread IDs
 * @param {Object[]} threads - All thread objects
 * @returns {string[]} Top 10 shared concepts/keywords sorted by frequency descending
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

  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId) {
      if (members.includes(node.metadata.threadId)) {
        memberNodeIds.add(nodeId);
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

module.exports = {
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
};
