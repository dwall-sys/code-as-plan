// @cap-feature(feature:F-038) Neural Cluster Detection — single-linkage clustering over thread nodes, divergence-based decay, dormant node management, and auto-labeling
// @cap-decision Pure logic module — zero I/O, zero external dependencies. All functions accept data and return structured results.
// @cap-decision Single-linkage clustering chosen for simplicity and interpretability — MAX affinity between any members of two clusters determines merge eligibility.
// @cap-decision Divergence-based decay uses MAX of three drift metrics (file-drift, keyword-drift, cluster-drift) as the combined decay factor, applied with a configurable damping rate (default 0.3) to prevent abrupt weight drops.
// @cap-decision No time-based decay — only measured divergence reduces scores. A thread from 6 months ago with still-relevant keywords keeps full affinity.
// @cap-decision Cluster IDs are stable hashes of sorted member thread IDs — deterministic as long as membership does not change.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (crypto).

'use strict';

const crypto = require('node:crypto');

// --- Constants ---

// @cap-todo(ac:F-038/AC-1) Configurable linkage threshold (default 0.40)
/** Default linkage threshold for cluster merging. */
const DEFAULT_LINKAGE_THRESHOLD = 0.40;

// @cap-todo(ac:F-038/AC-3) Decay rate controls how aggressively drift reduces edge weights.
/** Default decay damping rate — new weight = current * (1 - maxDrift * DECAY_RATE). */
const DEFAULT_DECAY_RATE = 0.3;

// @cap-todo(ac:F-038/AC-5) Dormant nodes reactivate when new affinity score >= 0.40
/** Threshold for dormant node reactivation. */
const DORMANT_REACTIVATION_THRESHOLD = 0.40;

// --- Types ---

/**
 * @typedef {Object} Cluster
 * @property {string} id - Stable cluster ID (hash of sorted member thread IDs)
 * @property {string[]} members - Array of thread IDs in this cluster
 * @property {string} label - Auto-generated label from top 2-3 concepts
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} ClusterResult
 * @property {Cluster[]} clusters - Detected clusters
 * @property {Object} graph - Mutated graph with cluster membership assigned
 */

/**
 * @typedef {Object} DriftMetrics
 * @property {number} fileDrift - File intersection drift (0.0-1.0)
 * @property {number} keywordDrift - Keyword Jaccard divergence (0.0-1.0)
 * @property {number} clusterDrift - Cluster affinity drift (0.0-1.0)
 * @property {number} maxDrift - Maximum of the three drift metrics
 */

/**
 * @typedef {Object} DecayResult
 * @property {Array<{source: string, target: string, oldWeight: number, newWeight: number}>} decayedEdges - Edges that had their weight reduced
 * @property {string[]} dormantNodes - Node IDs newly marked dormant
 * @property {string[]} reactivatedNodes - Node IDs reactivated from dormancy
 */

/**
 * @typedef {Object} AffinityResult
 * @property {string} sourceThreadId - First thread ID
 * @property {string} targetThreadId - Second thread ID
 * @property {number} compositeScore - Weighted composite score (0.0-1.0)
 * @property {string} band - Classification band
 * @property {Object[]} signals - Individual signal results
 * @property {string} computedAt - ISO timestamp
 */

/**
 * @typedef {Object} ClusterDetectionOptions
 * @property {number} [linkageThreshold] - Minimum affinity for cluster merging
 * @property {Object<string, string[]>} [taxonomy] - Concept taxonomy for labeling
 * @property {number} [decayRate] - Decay damping rate
 */

// --- Utility Functions ---

/**
 * Clamp a number to [0.0, 1.0].
 * @param {number} n
 * @returns {number}
 */
function _clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Compute Jaccard similarity between two sets.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Similarity score (0.0-1.0)
 */
function _jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionCount++;
  }

  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

/**
 * Find the graph node ID for a thread by its thread ID.
 * Thread nodes have metadata.threadId matching the thr-XXXX id.
 * @param {Object} graph - MemoryGraph
 * @param {string} threadId - Thread ID (thr-XXXX)
 * @returns {string|null} Graph node ID or null
 */
function _findThreadNodeId(graph, threadId) {
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId === threadId) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Get all active affinity edges from the graph.
 * @param {Object} graph - MemoryGraph
 * @returns {Object[]} Active affinity edges
 */
function _getAffinityEdges(graph) {
  return (graph.edges || []).filter(e => e.active && e.type === 'affinity');
}

/**
 * Collect file paths from feature nodes connected to a thread node.
 * @param {Object} graph - MemoryGraph
 * @param {string} threadNodeId - Graph node ID of the thread
 * @returns {Set<string>} Set of file paths
 */
function _collectFilesForThread(graph, threadNodeId) {
  const files = new Set();
  for (const edge of (graph.edges || [])) {
    if (!edge.active) continue;
    let neighborId = null;
    if (edge.source === threadNodeId) neighborId = edge.target;
    else if (edge.target === threadNodeId) neighborId = edge.source;
    if (neighborId && graph.nodes[neighborId] && graph.nodes[neighborId].type === 'feature') {
      const node = graph.nodes[neighborId];
      if (node.metadata && Array.isArray(node.metadata.files)) {
        for (const f of node.metadata.files) {
          files.add(f);
        }
      }
    }
  }
  return files;
}

// --- Clustering ---

// @cap-todo(ac:F-038/AC-1) Single-linkage clustering over thread nodes using affinity scores as distance metric
/**
 * Detect clusters from pairwise affinity results using single-linkage clustering.
 *
 * Algorithm: Start with each thread as its own cluster. Repeatedly merge the two
 * clusters with highest inter-cluster affinity (single-linkage = MAX affinity between
 * any member of cluster A and any member of cluster B), as long as that affinity >= threshold.
 *
 * @param {AffinityResult[]} affinityResults - Pairwise affinity results
 * @param {Object} [options]
 * @param {number} [options.linkageThreshold] - Minimum affinity for merging (default 0.40)
 * @returns {Array<{id: string, members: string[]}>} Clusters (without labels yet)
 */
function detectClusters(affinityResults, options) {
  const threshold = (options && options.linkageThreshold != null)
    ? options.linkageThreshold
    : DEFAULT_LINKAGE_THRESHOLD;

  // Collect all unique thread IDs
  const threadIdSet = new Set();
  for (const r of affinityResults) {
    threadIdSet.add(r.sourceThreadId);
    threadIdSet.add(r.targetThreadId);
  }

  // Initialize: each thread is its own cluster
  // Map from thread ID -> cluster index
  const threadIds = [...threadIdSet];
  const clusterMap = new Map();
  let nextClusterIdx = 0;

  for (const tid of threadIds) {
    clusterMap.set(tid, nextClusterIdx++);
  }

  // Build a fast lookup of affinity scores: "tidA|tidB" -> score (canonical key order)
  const pairScores = new Map();
  for (const r of affinityResults) {
    const key = _pairKey(r.sourceThreadId, r.targetThreadId);
    // Keep the maximum score if duplicates exist
    const existing = pairScores.get(key) || 0;
    if (r.compositeScore > existing) {
      pairScores.set(key, r.compositeScore);
    }
  }

  // Single-linkage: repeatedly merge the two clusters with the highest inter-cluster affinity
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;

    // Find distinct cluster indices
    const clusterIndices = [...new Set(clusterMap.values())];
    if (clusterIndices.length <= 1) break;

    // Build cluster -> members mapping
    const clusterMembers = new Map();
    for (const [tid, cidx] of clusterMap) {
      if (!clusterMembers.has(cidx)) clusterMembers.set(cidx, []);
      clusterMembers.get(cidx).push(tid);
    }

    // Find the pair of clusters with the highest single-linkage affinity
    let bestAffinity = -1;
    let bestPair = null;
    const clusterIdxList = [...clusterMembers.keys()];

    for (let i = 0; i < clusterIdxList.length; i++) {
      for (let j = i + 1; j < clusterIdxList.length; j++) {
        const membersI = clusterMembers.get(clusterIdxList[i]);
        const membersJ = clusterMembers.get(clusterIdxList[j]);

        // Single-linkage: MAX affinity between any member pair
        let maxAffinity = 0;
        for (const mA of membersI) {
          for (const mB of membersJ) {
            const key = _pairKey(mA, mB);
            const score = pairScores.get(key) || 0;
            if (score > maxAffinity) maxAffinity = score;
          }
        }

        if (maxAffinity > bestAffinity) {
          bestAffinity = maxAffinity;
          bestPair = [clusterIdxList[i], clusterIdxList[j]];
        }
      }
    }

    // Merge if above threshold
    if (bestPair && bestAffinity >= threshold) {
      const [keepIdx, mergeIdx] = bestPair;
      for (const [tid, cidx] of clusterMap) {
        if (cidx === mergeIdx) {
          clusterMap.set(tid, keepIdx);
        }
      }
      mergedSomething = true;
    }
  }

  // Build final cluster objects
  const clusterGroups = new Map();
  for (const [tid, cidx] of clusterMap) {
    if (!clusterGroups.has(cidx)) clusterGroups.set(cidx, []);
    clusterGroups.get(cidx).push(tid);
  }

  const clusters = [];
  for (const members of clusterGroups.values()) {
    members.sort();
    clusters.push({
      id: generateClusterId(members),
      members,
    });
  }

  // Sort clusters by size descending, then by ID for stability
  clusters.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));

  return clusters;
}

/**
 * Create a canonical pair key from two thread IDs (alphabetically sorted).
 * @param {string} tidA
 * @param {string} tidB
 * @returns {string}
 */
function _pairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}|${tidB}` : `${tidB}|${tidA}`;
}

// @cap-todo(ac:F-038/AC-7) Cluster ID derived from sorted member thread IDs hash (stable as long as members don't change)
/**
 * Generate a stable cluster ID from sorted member thread IDs.
 * @param {string[]} memberThreadIds - Thread IDs (will be sorted internally)
 * @returns {string} Cluster ID in format "cluster-{8 hex chars}"
 */
function generateClusterId(memberThreadIds) {
  const sorted = [...memberThreadIds].sort();
  const hash = crypto.createHash('sha256')
    .update(sorted.join('|'))
    .digest('hex')
    .substring(0, 8);
  return `cluster-${hash}`;
}

// @cap-todo(ac:F-038/AC-2) Auto-generated dynamic labels from top 2-3 weighted concepts — ephemeral, recalculated each run
/**
 * Generate a cluster label from the combined text of member threads projected into concept space.
 * Uses the SEED_TAXONOMY from cap-semantic-pipeline for concept projection.
 * Labels are ephemeral — recalculated each time, never stored as permanent names.
 *
 * @param {Object[]} memberThreads - Thread objects that are members of the cluster
 * @param {Object<string, string[]>} taxonomy - Concept taxonomy { concept: [keywords] }
 * @returns {string} Label in format "concept1 \u00b7 concept2 \u00b7 concept3"
 */
function generateClusterLabel(memberThreads, taxonomy) {
  if (!memberThreads || memberThreads.length === 0) return 'unnamed';
  if (!taxonomy || Object.keys(taxonomy).length === 0) return 'unnamed';

  // Combine all thread text
  const combinedText = memberThreads.map(t => _getThreadText(t)).join(' ');

  // Project into concept space
  const conceptScores = _projectToConcepts(combinedText, taxonomy);

  // Take top 2-3 concepts by weight
  const sorted = [...conceptScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, score]) => score > 0);

  if (sorted.length === 0) return 'unnamed';

  return sorted.map(([concept]) => concept).join(' \u00b7 ');
}

/**
 * Extract combined text from a thread for concept projection.
 * @param {Object} thread - Thread object
 * @returns {string}
 */
function _getThreadText(thread) {
  const parts = [];
  if (thread.problemStatement) parts.push(thread.problemStatement);
  if (thread.solutionShape) parts.push(thread.solutionShape);
  if (Array.isArray(thread.boundaryDecisions)) {
    parts.push(...thread.boundaryDecisions);
  }
  if (Array.isArray(thread.keywords)) {
    parts.push(thread.keywords.join(' '));
  }
  if (thread.name) parts.push(thread.name);
  return parts.join(' ');
}

/**
 * Project text into concept space using a taxonomy.
 * Mirrors the logic of cap-semantic-pipeline.cjs projectToConcepts but inlined
 * to avoid cross-module dependency.
 *
 * @param {string} text - Text to project
 * @param {Object<string, string[]>} taxonomy - Concept taxonomy
 * @returns {Map<string, number>} Concept -> weight mapping
 */
function _projectToConcepts(text, taxonomy) {
  /** @type {Map<string, number>} */
  const vector = new Map();

  if (!text || typeof text !== 'string') return vector;

  const lowerText = text.toLowerCase();

  for (const [concept, keywords] of Object.entries(taxonomy)) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (lowerText.indexOf(kw) !== -1) {
        matchCount++;
      }
    }
    const score = keywords.length > 0 ? matchCount / keywords.length : 0;
    if (score > 0) {
      vector.set(concept, score);
    }
  }

  return vector;
}

// --- Divergence Decay ---

// @cap-todo(ac:F-038/AC-3) Divergence-based decay using 3 drift metrics: file-drift, keyword-drift, cluster-drift
// @cap-todo(ac:F-038/AC-6) No time-based decay — only measured divergence reduces scores
/**
 * Compute drift metrics between two threads based on their current state vs. previous affinity.
 *
 * Three drift metrics:
 * 1. file-drift: Shrinking file intersection relative to original shared files
 * 2. keyword-drift: Jaccard divergence of current keyword sets
 * 3. cluster-drift: Drop in average affinity to cluster members vs. original
 *
 * @param {Object} threadNodeA - Graph node for thread A
 * @param {Object} threadNodeB - Graph node for thread B
 * @param {Object} graph - MemoryGraph
 * @param {Object} previousAffinity - Previous affinity edge metadata { compositeScore, originalSharedFiles }
 * @param {Object} [currentAffinityMap] - Map of pair keys to current affinity scores
 * @returns {DriftMetrics}
 */
function computeDrift(threadNodeA, threadNodeB, graph, previousAffinity, currentAffinityMap) {
  // --- File drift ---
  const filesA = _collectFilesForThread(graph, threadNodeA.id);
  const filesB = _collectFilesForThread(graph, threadNodeB.id);

  let currentSharedFiles = 0;
  for (const f of filesA) {
    if (filesB.has(f)) currentSharedFiles++;
  }

  const originalSharedFiles = (previousAffinity && previousAffinity.originalSharedFiles != null)
    ? previousAffinity.originalSharedFiles
    : currentSharedFiles;

  const fileDrift = originalSharedFiles > 0
    ? _clamp01(1 - (currentSharedFiles / originalSharedFiles))
    : 0;

  // --- Keyword drift ---
  const keywordsA = new Set(
    (threadNodeA.metadata && Array.isArray(threadNodeA.metadata.keywords))
      ? threadNodeA.metadata.keywords
      : []
  );
  const keywordsB = new Set(
    (threadNodeB.metadata && Array.isArray(threadNodeB.metadata.keywords))
      ? threadNodeB.metadata.keywords
      : []
  );

  const keywordSimilarity = _jaccard(keywordsA, keywordsB);
  const keywordDrift = _clamp01(1 - keywordSimilarity);

  // --- Cluster drift ---
  // If either node has a cluster, compute average affinity to cluster members
  // vs. the original average affinity stored in the edge
  let clusterDrift = 0;

  if (currentAffinityMap && previousAffinity && previousAffinity.compositeScore > 0) {
    const tidA = threadNodeA.metadata && threadNodeA.metadata.threadId;
    const tidB = threadNodeB.metadata && threadNodeB.metadata.threadId;

    if (tidA && tidB) {
      const key = _pairKey(tidA, tidB);
      const currentScore = currentAffinityMap.get(key) || 0;
      const originalScore = previousAffinity.compositeScore;

      if (originalScore > 0) {
        clusterDrift = _clamp01(1 - (currentScore / originalScore));
      }
    }
  }

  return {
    fileDrift,
    keywordDrift,
    clusterDrift,
    maxDrift: Math.max(fileDrift, keywordDrift, clusterDrift),
  };
}

// @cap-todo(ac:F-038/AC-4) Decay reduces affinity edge weights but never deletes nodes; dormant nodes get dormant:true flag
/**
 * Apply decay to affinity edges in the graph based on drift results.
 * Reduces edge weights: newWeight = currentWeight * (1 - maxDrift * decayRate).
 * Never deletes nodes or edges.
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {Map<string, DriftMetrics>} driftResults - Map of pair key -> DriftMetrics
 * @param {Object} [options]
 * @param {number} [options.decayRate] - Damping rate (default 0.3)
 * @returns {{ decayedEdges: Array<{source: string, target: string, oldWeight: number, newWeight: number}> }}
 */
function applyDecay(graph, driftResults, options) {
  const decayRate = (options && options.decayRate != null) ? options.decayRate : DEFAULT_DECAY_RATE;
  const decayedEdges = [];

  // Build thread node ID -> thread ID mapping for quick lookup
  const nodeToThread = new Map();
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId) {
      nodeToThread.set(nodeId, node.metadata.threadId);
    }
  }

  for (const edge of (graph.edges || [])) {
    if (!edge.active || edge.type !== 'affinity') continue;

    const tidSource = nodeToThread.get(edge.source);
    const tidTarget = nodeToThread.get(edge.target);
    if (!tidSource || !tidTarget) continue;

    const key = _pairKey(tidSource, tidTarget);
    const drift = driftResults.get(key);
    if (!drift || drift.maxDrift <= 0) continue;

    const oldWeight = (edge.metadata && edge.metadata.compositeScore != null)
      ? edge.metadata.compositeScore
      : 0;

    const newWeight = oldWeight * (1 - drift.maxDrift * decayRate);

    if (!edge.metadata) edge.metadata = {};
    edge.metadata.compositeScore = newWeight;

    // Store original shared files count for future drift calculations
    if (edge.metadata.originalSharedFiles == null) {
      // First decay pass — snapshot the current state as baseline
      // This is set externally or defaults to 0 if not present
    }

    decayedEdges.push({
      source: edge.source,
      target: edge.target,
      oldWeight,
      newWeight,
    });
  }

  graph.lastUpdated = new Date().toISOString();

  return { decayedEdges };
}

// --- Dormant Node Management ---

// @cap-todo(ac:F-038/AC-4) dormant nodes get dormant:true flag
/**
 * Mark a node as dormant. Sets metadata.dormant = true.
 * Does NOT delete the node or its edges.
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {string} nodeId - Graph node ID to mark dormant
 * @returns {Object} The mutated graph
 */
function markDormant(graph, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return graph;

  if (!node.metadata) node.metadata = {};
  node.metadata.dormant = true;
  node.updatedAt = new Date().toISOString();
  graph.lastUpdated = new Date().toISOString();

  return graph;
}

// @cap-todo(ac:F-038/AC-5) Dormant nodes reactivate when new affinity score >= 0.40
/**
 * Reactivate a dormant node. Sets metadata.dormant = false.
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {string} nodeId - Graph node ID to reactivate
 * @returns {Object} The mutated graph
 */
function reactivateNode(graph, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return graph;

  if (!node.metadata) node.metadata = {};
  node.metadata.dormant = false;
  node.updatedAt = new Date().toISOString();
  graph.lastUpdated = new Date().toISOString();

  return graph;
}

/**
 * Check which dormant nodes should be reactivated based on new affinity results.
 * A dormant node reactivates when any new affinity score touching it is >= reactivation threshold.
 *
 * @param {Object} graph - MemoryGraph
 * @param {AffinityResult[]} newAffinityResults - New affinity results to check
 * @param {Object} [options]
 * @param {number} [options.reactivationThreshold] - Score threshold (default 0.40)
 * @returns {string[]} List of reactivated graph node IDs
 */
function checkReactivation(graph, newAffinityResults, options) {
  const threshold = (options && options.reactivationThreshold != null)
    ? options.reactivationThreshold
    : DORMANT_REACTIVATION_THRESHOLD;

  const reactivated = [];

  // Find all dormant thread node IDs and their thread IDs
  const dormantNodes = new Map(); // threadId -> nodeId
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.dormant === true) {
      dormantNodes.set(node.metadata.threadId, nodeId);
    }
  }

  if (dormantNodes.size === 0) return reactivated;

  for (const result of newAffinityResults) {
    if (result.compositeScore < threshold) continue;

    // Check if either thread in this result is dormant
    for (const tid of [result.sourceThreadId, result.targetThreadId]) {
      const nodeId = dormantNodes.get(tid);
      if (nodeId) {
        reactivateNode(graph, nodeId);
        reactivated.push(nodeId);
        dormantNodes.delete(tid); // Don't reactivate twice
      }
    }
  }

  return reactivated;
}

/**
 * Identify thread nodes whose ALL affinity edges are below the silent threshold,
 * and mark them as dormant.
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {Object} [options]
 * @param {number} [options.dormantThreshold] - Below this, edges count as weak (default 0.40)
 * @returns {string[]} List of newly dormant node IDs
 */
function identifyAndMarkDormant(graph, options) {
  const threshold = (options && options.dormantThreshold != null)
    ? options.dormantThreshold
    : DEFAULT_LINKAGE_THRESHOLD;

  const newlyDormant = [];

  // Build thread node ID -> thread ID mapping
  const threadNodeIds = [];
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.active) {
      threadNodeIds.push(nodeId);
    }
  }

  for (const nodeId of threadNodeIds) {
    const node = graph.nodes[nodeId];
    // Skip already dormant nodes
    if (node.metadata && node.metadata.dormant === true) continue;

    // Find all active affinity edges touching this node
    const affinityEdges = (graph.edges || []).filter(e =>
      e.active && e.type === 'affinity' &&
      (e.source === nodeId || e.target === nodeId)
    );

    // If no affinity edges, skip (don't mark dormant for nodes with no edges at all)
    if (affinityEdges.length === 0) continue;

    // Check if ALL edges are below threshold
    const allBelowThreshold = affinityEdges.every(e =>
      (e.metadata && e.metadata.compositeScore != null)
        ? e.metadata.compositeScore < threshold
        : true
    );

    if (allBelowThreshold) {
      markDormant(graph, nodeId);
      newlyDormant.push(nodeId);
    }
  }

  return newlyDormant;
}

// --- Cluster Membership ---

// @cap-todo(ac:F-038/AC-7) Cluster membership stored as computed property on thread nodes
/**
 * Assign cluster membership to thread nodes in the graph.
 * Updates each thread node's metadata with cluster info:
 *   metadata.cluster = { id, label, joinedAt }
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {Cluster[]} clusters - Clusters with id, members, and label
 * @returns {Object} The mutated graph
 */
function assignClusterMembership(graph, clusters) {
  const now = new Date().toISOString();

  // Build thread ID -> cluster mapping
  const threadToCluster = new Map();
  for (const cluster of clusters) {
    for (const tid of cluster.members) {
      threadToCluster.set(tid, cluster);
    }
  }

  // Update graph nodes
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type !== 'thread') continue;

    const threadId = node.metadata && node.metadata.threadId;
    if (!threadId) continue;

    const cluster = threadToCluster.get(threadId);
    if (cluster) {
      if (!node.metadata) node.metadata = {};
      // Preserve existing joinedAt if cluster hasn't changed
      const existingCluster = node.metadata.cluster;
      const joinedAt = (existingCluster && existingCluster.id === cluster.id)
        ? existingCluster.joinedAt
        : now;

      node.metadata.cluster = {
        id: cluster.id,
        label: cluster.label,
        joinedAt,
      };
      node.updatedAt = now;
    } else {
      // Thread not in any cluster — clear cluster membership
      if (node.metadata && node.metadata.cluster) {
        delete node.metadata.cluster;
        node.updatedAt = now;
      }
    }
  }

  graph.lastUpdated = now;
  return graph;
}

// --- Full Pipeline ---

// @cap-todo(ac:F-038/AC-8) Clustering completes within 500ms for 200 nodes and 1000 edges
/**
 * Run full cluster detection pipeline:
 * 1. Detect clusters from affinity scores (single-linkage)
 * 2. Generate labels for each cluster
 * 3. Assign cluster membership to graph nodes
 *
 * @param {AffinityResult[]} affinityResults - Pairwise affinity results
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {Object[]} threads - Thread objects for label generation
 * @param {Object} [options]
 * @param {number} [options.linkageThreshold] - Minimum affinity for merging
 * @param {Object<string, string[]>} [options.taxonomy] - Concept taxonomy for labeling
 * @returns {ClusterResult}
 */
function runClusterDetection(affinityResults, graph, threads, options) {
  const taxonomy = (options && options.taxonomy) || null;
  const linkageThreshold = (options && options.linkageThreshold != null)
    ? options.linkageThreshold
    : DEFAULT_LINKAGE_THRESHOLD;

  // 1. Detect clusters
  const rawClusters = detectClusters(affinityResults, { linkageThreshold });

  // Build thread ID -> thread object map for label generation
  const threadMap = new Map();
  for (const t of threads) {
    threadMap.set(t.id, t);
  }

  // 2. Generate labels and finalize clusters
  const now = new Date().toISOString();
  const clusters = rawClusters.map(rc => {
    const memberThreads = rc.members
      .map(tid => threadMap.get(tid))
      .filter(Boolean);

    const label = taxonomy
      ? generateClusterLabel(memberThreads, taxonomy)
      : _generateFallbackLabel(memberThreads);

    return {
      id: rc.id,
      members: rc.members,
      label,
      createdAt: now,
    };
  });

  // 3. Assign membership to graph nodes
  assignClusterMembership(graph, clusters);

  return { clusters, graph };
}

/**
 * Generate a fallback label when no taxonomy is provided.
 * Uses top keywords from member threads.
 *
 * @param {Object[]} memberThreads - Thread objects
 * @returns {string}
 */
function _generateFallbackLabel(memberThreads) {
  if (!memberThreads || memberThreads.length === 0) return 'unnamed';

  // Collect keyword frequency
  const kwFreq = new Map();
  for (const t of memberThreads) {
    for (const kw of (t.keywords || [])) {
      kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
    }
  }

  const sorted = [...kwFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, count]) => count > 0);

  if (sorted.length === 0) return 'unnamed';

  return sorted.map(([kw]) => kw).join(' \u00b7 ');
}

/**
 * Run full decay pass:
 * 1. Compute drift for each affinity edge
 * 2. Apply decay to edge weights
 * 3. Identify and mark dormant nodes
 * 4. Check for reactivations from new affinity results
 *
 * @param {Object} graph - MemoryGraph (mutated)
 * @param {AffinityResult[]} currentAffinities - Current affinity results
 * @param {AffinityResult[]} [previousAffinities] - Previous affinity results (for cluster-drift baseline)
 * @param {Object} [options]
 * @param {number} [options.decayRate] - Decay damping rate (default 0.3)
 * @param {number} [options.dormantThreshold] - Threshold for dormancy (default 0.40)
 * @returns {DecayResult}
 */
function runDecayPass(graph, currentAffinities, previousAffinities, options) {
  const decayRate = (options && options.decayRate != null) ? options.decayRate : DEFAULT_DECAY_RATE;
  const dormantThreshold = (options && options.dormantThreshold != null)
    ? options.dormantThreshold
    : DEFAULT_LINKAGE_THRESHOLD;

  // Build current affinity lookup
  const currentAffinityMap = new Map();
  for (const r of currentAffinities) {
    const key = _pairKey(r.sourceThreadId, r.targetThreadId);
    currentAffinityMap.set(key, r.compositeScore);
  }

  // Build previous affinity lookup for baseline
  const previousAffinityMap = new Map();
  if (previousAffinities) {
    for (const r of previousAffinities) {
      const key = _pairKey(r.sourceThreadId, r.targetThreadId);
      previousAffinityMap.set(key, {
        compositeScore: r.compositeScore,
        originalSharedFiles: null, // Will be computed from graph state
      });
    }
  }

  // Also build from existing graph edges as baseline
  const nodeToThread = new Map();
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId) {
      nodeToThread.set(nodeId, node.metadata.threadId);
    }
  }

  // 1. Compute drift for each active affinity edge
  const driftResults = new Map();

  for (const edge of _getAffinityEdges(graph)) {
    const tidSource = nodeToThread.get(edge.source);
    const tidTarget = nodeToThread.get(edge.target);
    if (!tidSource || !tidTarget) continue;

    const key = _pairKey(tidSource, tidTarget);
    const nodeA = graph.nodes[edge.source];
    const nodeB = graph.nodes[edge.target];
    if (!nodeA || !nodeB) continue;

    // Get previous affinity baseline from the edge itself or from previous results
    const prevFromMap = previousAffinityMap.get(key);
    const previousAffinity = prevFromMap || {
      compositeScore: (edge.metadata && edge.metadata.compositeScore) || 0,
      originalSharedFiles: (edge.metadata && edge.metadata.originalSharedFiles) || null,
    };

    const drift = computeDrift(nodeA, nodeB, graph, previousAffinity, currentAffinityMap);
    driftResults.set(key, drift);
  }

  // 2. Apply decay
  const { decayedEdges } = applyDecay(graph, driftResults, { decayRate });

  // 3. Mark dormant nodes
  const dormantNodes = identifyAndMarkDormant(graph, { dormantThreshold });

  // 4. Check reactivations
  const reactivatedNodes = checkReactivation(graph, currentAffinities, {
    reactivationThreshold: dormantThreshold,
  });

  return {
    decayedEdges,
    dormantNodes,
    reactivatedNodes,
  };
}

// --- Module Exports ---

// @cap-decision Exporting internal helpers prefixed with _ for testing, following project convention.
module.exports = {
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

  // Internal (for testing)
  _clamp01,
  _jaccard,
  _findThreadNodeId,
  _getAffinityEdges,
  _collectFilesForThread,
  _pairKey,
  _getThreadText,
  _projectToConcepts,
  _generateFallbackLabel,
};
