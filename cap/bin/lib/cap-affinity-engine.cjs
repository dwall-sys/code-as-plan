// @cap-feature(feature:F-036) Multi-Signal Affinity Engine — computes affinity scores between thread nodes using 8 weighted signals
// @cap-decision Pure logic module — all functions take data as input and return structured results. The ONLY exception is loadConfig which reads .cap/config.json.
// @cap-decision Signals split into realtime (structural lookups, fast) and post-session (deeper analysis) groups for phased execution.
// @cap-decision Jaccard similarity used as the foundational metric across multiple signals — simple, interpretable, well-bounded (0-1), and requires no external dependencies.
// @cap-decision Band classification uses configurable thresholds so teams can tune sensitivity without code changes.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// --- Constants ---

// @cap-todo(ac:F-036/AC-2) Support 8 named signals: feature-id-overlap, shared-files, temporal-proximity, causal-chains (realtime); concept-overlap, problem-space-similarity, shared-decisions-deep, transitive-connections (post-session)

/** Ordered list of all signal names. */
const SIGNAL_NAMES = [
  'feature-id-overlap',
  'shared-files',
  'temporal-proximity',
  'causal-chains',
  'concept-overlap',
  'problem-space-similarity',
  'shared-decisions-deep',
  'transitive-connections',
];

/** Signals computed during realtime (fast, structural lookups). */
const REALTIME_SIGNALS = [
  'feature-id-overlap',
  'shared-files',
  'temporal-proximity',
  'causal-chains',
];

/** Signals computed during post-session analysis (deeper). */
const POST_SESSION_SIGNALS = [
  'concept-overlap',
  'problem-space-similarity',
  'shared-decisions-deep',
  'transitive-connections',
];

// @cap-todo(ac:F-036/AC-4) Signal weights configurable via .cap/config.json under key affinityWeights, defaults sum to 1.0

/** Default signal weights (sum to 1.0). */
const DEFAULT_WEIGHTS = {
  'feature-id-overlap': 0.20,
  'shared-files': 0.15,
  'temporal-proximity': 0.05,
  'causal-chains': 0.10,
  'concept-overlap': 0.20,
  'problem-space-similarity': 0.10,
  'shared-decisions-deep': 0.10,
  'transitive-connections': 0.10,
};

// @cap-todo(ac:F-036/AC-5) Classify scores into 4 bands: urgent (>=0.90), notify (0.75-0.89), silent (0.40-0.74), discard (<0.40) — thresholds configurable

/** Default band thresholds. */
const DEFAULT_BANDS = {
  urgent: 0.90,
  notify: 0.75,
  silent: 0.40,
  // Below silent threshold = discard
};

/** Config file path relative to project root. */
const CONFIG_FILE = path.join('.cap', 'config.json');

// --- Types ---

/**
 * @typedef {'feature-id-overlap'|'shared-files'|'temporal-proximity'|'causal-chains'|'concept-overlap'|'problem-space-similarity'|'shared-decisions-deep'|'transitive-connections'} SignalName
 */

/**
 * @typedef {Object} SignalResult
 * @property {SignalName} signal - Signal name
 * @property {number} score - Signal score (0.0-1.0)
 * @property {string} reason - Human-readable explanation
 */

/**
 * @typedef {'urgent'|'notify'|'silent'|'discard'} AffinityBand
 */

/**
 * @typedef {Object} AffinityResult
 * @property {string} sourceThreadId - First thread ID
 * @property {string} targetThreadId - Second thread ID
 * @property {number} compositeScore - Weighted composite score (0.0-1.0)
 * @property {AffinityBand} band - Classification band
 * @property {SignalResult[]} signals - Individual signal results
 * @property {string} computedAt - ISO timestamp
 */

/**
 * @typedef {Object} AffinityConfig
 * @property {Object<SignalName, number>} weights - Signal weights (should sum to 1.0)
 * @property {Object} bands - Band thresholds { urgent, notify, silent }
 */

/**
 * @typedef {Object} AffinityContext
 * @property {Object} graph - MemoryGraph instance
 * @property {Object[]} allThreads - Array of Thread objects
 * @property {Object[]} threadIndex - Array of ThreadIndexEntry objects
 */

/**
 * @typedef {Object} Thread
 * @property {string} id - Thread ID
 * @property {string} name - Human-readable name
 * @property {string} timestamp - ISO timestamp
 * @property {string|null} parentThreadId - Parent thread ID
 * @property {string|null} divergencePoint - Divergence description
 * @property {string} problemStatement - Problem being explored
 * @property {string} solutionShape - Solution direction
 * @property {string[]} boundaryDecisions - Key decisions
 * @property {string[]} featureIds - Associated feature IDs
 * @property {string[]} keywords - Problem-space keywords
 */

// --- Stop Words (shared with cap-thread-tracker.cjs pattern) ---

/** @type {Set<string>} */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
  'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you',
  'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it',
  'its', 'they', 'them', 'their', 'theirs', 'also', 'into', 'if',
]);

// --- Utility Functions ---

/**
 * Compute Jaccard similarity between two sets.
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {{ score: number, intersection: string[], union: string[] }}
 */
function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) {
    return { score: 0, intersection: [], union: [] };
  }

  const intersection = [];
  for (const item of setA) {
    if (setB.has(item)) {
      intersection.push(item);
    }
  }

  const unionSet = new Set([...setA, ...setB]);

  return {
    score: intersection.length / unionSet.size,
    intersection: intersection.sort(),
    union: [...unionSet].sort(),
  };
}

/**
 * Extract keywords from text, filtering stop words and short words.
 * @param {string} text
 * @returns {string[]} Deduplicated sorted keywords
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];

  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )].sort();
}

/**
 * Clamp a number to [0.0, 1.0].
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Truncate an array for display, appending "..." if truncated.
 * @param {string[]} items
 * @param {number} maxItems
 * @returns {string} Comma-separated display string
 */
function truncateList(items, maxItems = 5) {
  if (items.length <= maxItems) return items.join(', ');
  return items.slice(0, maxItems).join(', ') + ', ...';
}

/**
 * Find the graph node ID for a thread by its thread ID.
 * Thread nodes have metadata.threadId matching the thr-XXXX id.
 * @param {Object} graph - MemoryGraph
 * @param {string} threadId - Thread ID (thr-XXXX)
 * @returns {string|null} Graph node ID or null
 */
function findThreadNodeId(graph, threadId) {
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId === threadId) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Get feature IDs connected to a thread node in the graph.
 * Looks for edges from the thread node to feature nodes.
 * @param {Object} graph - MemoryGraph
 * @param {string} threadNodeId - Graph node ID of the thread
 * @returns {string[]} Array of feature node IDs
 */
function getConnectedFeatureNodeIds(graph, threadNodeId) {
  const featureNodeIds = [];
  for (const edge of (graph.edges || [])) {
    if (!edge.active) continue;
    let neighborId = null;
    if (edge.source === threadNodeId) neighborId = edge.target;
    else if (edge.target === threadNodeId) neighborId = edge.source;
    if (neighborId && graph.nodes[neighborId] && graph.nodes[neighborId].type === 'feature') {
      featureNodeIds.push(neighborId);
    }
  }
  return featureNodeIds;
}

/**
 * Collect file paths from feature nodes connected to a thread.
 * @param {Object} graph - MemoryGraph
 * @param {string} threadNodeId - Graph node ID of the thread
 * @returns {Set<string>} Set of file paths
 */
function collectFilesForThread(graph, threadNodeId) {
  const files = new Set();
  const featureNodeIds = getConnectedFeatureNodeIds(graph, threadNodeId);
  for (const fNodeId of featureNodeIds) {
    const node = graph.nodes[fNodeId];
    if (node && node.metadata && Array.isArray(node.metadata.files)) {
      for (const f of node.metadata.files) {
        files.add(f);
      }
    }
  }
  return files;
}

/**
 * Get graph neighbor node IDs for a given node (active edges only).
 * @param {Object} graph - MemoryGraph
 * @param {string} nodeId - Node ID
 * @returns {Set<string>} Set of neighbor node IDs
 */
function getGraphNeighbors(graph, nodeId) {
  const neighbors = new Set();
  for (const edge of (graph.edges || [])) {
    if (!edge.active) continue;
    if (edge.source === nodeId) neighbors.add(edge.target);
    else if (edge.target === nodeId) neighbors.add(edge.source);
  }
  return neighbors;
}

// --- Signal Functions ---
// @cap-todo(ac:F-036/AC-3) Each signal returns independent score (0.0-1.0) and human-readable reason string

/**
 * Signal 1: Feature ID overlap between two threads.
 * Uses Jaccard similarity on featureIds arrays.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context - Unused for this signal
 * @returns {SignalResult}
 */
function signalFeatureIdOverlap(threadA, threadB, _context) {
  const setA = new Set(threadA.featureIds || []);
  const setB = new Set(threadB.featureIds || []);
  const { score, intersection, union } = jaccard(setA, setB);

  return {
    signal: 'feature-id-overlap',
    score: clamp01(score),
    reason: intersection.length > 0
      ? `Shares ${intersection.length} of ${union.length} features: ${truncateList(intersection)}`
      : 'No shared feature IDs',
  };
}

/**
 * Signal 2: Shared files between threads.
 * Collects file paths from feature nodes connected to each thread in the graph,
 * then computes Jaccard similarity.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} context
 * @returns {SignalResult}
 */
function signalSharedFiles(threadA, threadB, context) {
  const graph = context.graph || { nodes: {}, edges: [] };

  const nodeIdA = findThreadNodeId(graph, threadA.id);
  const nodeIdB = findThreadNodeId(graph, threadB.id);

  if (!nodeIdA || !nodeIdB) {
    return {
      signal: 'shared-files',
      score: 0,
      reason: 'Thread(s) not found in graph',
    };
  }

  const filesA = collectFilesForThread(graph, nodeIdA);
  const filesB = collectFilesForThread(graph, nodeIdB);
  const { score, intersection } = jaccard(filesA, filesB);

  return {
    signal: 'shared-files',
    score: clamp01(score),
    reason: intersection.length > 0
      ? `${intersection.length} shared files: ${truncateList(intersection)}`
      : 'No shared files',
  };
}

/**
 * Signal 3: Temporal proximity between threads.
 * Inverse decay: 1 / (1 + daysBetween / 7).
 * Same day ~1.0, 1 week apart ~0.5, 1 month ~0.19.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context
 * @returns {SignalResult}
 */
function signalTemporalProximity(threadA, threadB, _context) {
  const tsA = new Date(threadA.timestamp || 0).getTime();
  const tsB = new Date(threadB.timestamp || 0).getTime();

  if (isNaN(tsA) || isNaN(tsB)) {
    return {
      signal: 'temporal-proximity',
      score: 0,
      reason: 'Invalid timestamp(s)',
    };
  }

  const daysBetween = Math.abs(tsA - tsB) / (1000 * 60 * 60 * 24);
  const score = 1 / (1 + daysBetween / 7);

  const daysLabel = daysBetween < 1
    ? 'same day'
    : `${Math.round(daysBetween)} day${Math.round(daysBetween) === 1 ? '' : 's'} apart`;

  return {
    signal: 'temporal-proximity',
    score: clamp01(score),
    reason: daysLabel,
  };
}

/**
 * Signal 4: Causal chains between threads.
 * Checks if Thread B's problem keywords appear in Thread A's solution/decisions,
 * and vice versa. Uses bidirectional keyword overlap.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context
 * @returns {SignalResult}
 */
function signalCausalChains(threadA, threadB, _context) {
  // Extract keywords from A's solution space
  const solutionKeywordsA = new Set([
    ...extractKeywords(threadA.solutionShape || ''),
    ...((threadA.boundaryDecisions || []).flatMap(d => extractKeywords(d))),
  ]);

  // Extract keywords from B's problem space
  const problemKeywordsB = new Set(extractKeywords(threadB.problemStatement || ''));

  // Forward: A's solution -> B's problem
  const forwardOverlap = [];
  for (const kw of problemKeywordsB) {
    if (solutionKeywordsA.has(kw)) forwardOverlap.push(kw);
  }

  // Extract keywords from B's solution space
  const solutionKeywordsB = new Set([
    ...extractKeywords(threadB.solutionShape || ''),
    ...((threadB.boundaryDecisions || []).flatMap(d => extractKeywords(d))),
  ]);

  // Extract keywords from A's problem space
  const problemKeywordsA = new Set(extractKeywords(threadA.problemStatement || ''));

  // Reverse: B's solution -> A's problem
  const reverseOverlap = [];
  for (const kw of problemKeywordsA) {
    if (solutionKeywordsB.has(kw)) reverseOverlap.push(kw);
  }

  // Combine unique overlapping keywords
  const allOverlap = [...new Set([...forwardOverlap, ...reverseOverlap])].sort();

  // Score: proportion of problem keywords matched, using the best direction
  const forwardDenom = problemKeywordsB.size || 1;
  const reverseDenom = problemKeywordsA.size || 1;
  const forwardScore = forwardOverlap.length / forwardDenom;
  const reverseScore = reverseOverlap.length / reverseDenom;
  const score = Math.max(forwardScore, reverseScore);

  let reason;
  if (allOverlap.length > 0) {
    const direction = forwardScore >= reverseScore ? 'A -> B' : 'B -> A';
    reason = `Causal chain detected (${direction}): ${allOverlap.length} shared concepts: ${truncateList(allOverlap)}`;
  } else {
    reason = 'No causal chain detected';
  }

  return {
    signal: 'causal-chains',
    score: clamp01(score),
    reason,
  };
}

/**
 * Signal 5: Concept overlap between threads.
 * For the prototype, uses Jaccard on keyword sets.
 * @cap-risk F-037 will enhance this with TF-IDF/taxonomy — current implementation is a keyword proxy only.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context
 * @returns {SignalResult}
 */
function signalConceptOverlap(threadA, threadB, _context) {
  const setA = new Set(threadA.keywords || []);
  const setB = new Set(threadB.keywords || []);
  const { score, intersection } = jaccard(setA, setB);

  return {
    signal: 'concept-overlap',
    score: clamp01(score),
    reason: intersection.length > 0
      ? `${intersection.length} shared concepts from keyword analysis: ${truncateList(intersection)}`
      : 'No shared concepts',
  };
}

/**
 * Signal 6: Problem-space similarity.
 * Extracts keywords from problemStatement specifically and computes Jaccard.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context
 * @returns {SignalResult}
 */
function signalProblemSpaceSimilarity(threadA, threadB, _context) {
  const kwA = extractKeywords(threadA.problemStatement || '');
  const kwB = extractKeywords(threadB.problemStatement || '');
  const setA = new Set(kwA);
  const setB = new Set(kwB);
  const { score, intersection } = jaccard(setA, setB);

  return {
    signal: 'problem-space-similarity',
    score: clamp01(score),
    reason: intersection.length > 0
      ? `Problem statements share ${intersection.length} keywords: ${truncateList(intersection)}`
      : 'No shared problem-space keywords',
  };
}

/**
 * Signal 7: Shared decisions (deep analysis).
 * Extracts keywords from all boundaryDecisions of each thread and computes Jaccard.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} _context
 * @returns {SignalResult}
 */
function signalSharedDecisionsDeep(threadA, threadB, _context) {
  const decisionsA = threadA.boundaryDecisions || [];
  const decisionsB = threadB.boundaryDecisions || [];

  const kwA = new Set(decisionsA.flatMap(d => extractKeywords(d)));
  const kwB = new Set(decisionsB.flatMap(d => extractKeywords(d)));
  const { score, intersection } = jaccard(kwA, kwB);

  return {
    signal: 'shared-decisions-deep',
    score: clamp01(score),
    reason: intersection.length > 0
      ? `${intersection.length} shared decision keywords across ${decisionsA.length + decisionsB.length} decisions: ${truncateList(intersection)}`
      : 'No shared decision keywords',
  };
}

/**
 * Signal 8: Transitive connections via shared graph neighbors.
 * Counts thread nodes connected to both A and B in the graph.
 * Score: |shared| / max(|neighbors_A|, |neighbors_B|, 1)
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} context
 * @returns {SignalResult}
 */
function signalTransitiveConnections(threadA, threadB, context) {
  const graph = context.graph || { nodes: {}, edges: [] };

  const nodeIdA = findThreadNodeId(graph, threadA.id);
  const nodeIdB = findThreadNodeId(graph, threadB.id);

  if (!nodeIdA || !nodeIdB) {
    return {
      signal: 'transitive-connections',
      score: 0,
      reason: 'Thread(s) not found in graph',
    };
  }

  const neighborsA = getGraphNeighbors(graph, nodeIdA);
  const neighborsB = getGraphNeighbors(graph, nodeIdB);

  // Remove direct connection between A and B from neighbor sets
  neighborsA.delete(nodeIdB);
  neighborsB.delete(nodeIdA);

  const shared = [];
  for (const n of neighborsA) {
    if (neighborsB.has(n)) {
      shared.push(n);
    }
  }

  const denom = Math.max(neighborsA.size, neighborsB.size, 1);
  const score = shared.length / denom;

  // Resolve labels for shared neighbors
  const labels = shared
    .map(nid => (graph.nodes[nid] && graph.nodes[nid].label) || nid)
    .sort();

  return {
    signal: 'transitive-connections',
    score: clamp01(score),
    reason: shared.length > 0
      ? `${shared.length} shared graph neighbors: ${truncateList(labels)}`
      : 'No shared graph neighbors',
  };
}

// --- Signal Registry ---

/** @type {Object<SignalName, function(Thread, Thread, AffinityContext): SignalResult>} */
const SIGNAL_FUNCTIONS = {
  'feature-id-overlap': signalFeatureIdOverlap,
  'shared-files': signalSharedFiles,
  'temporal-proximity': signalTemporalProximity,
  'causal-chains': signalCausalChains,
  'concept-overlap': signalConceptOverlap,
  'problem-space-similarity': signalProblemSpaceSimilarity,
  'shared-decisions-deep': signalSharedDecisionsDeep,
  'transitive-connections': signalTransitiveConnections,
};

// --- Configuration ---

/**
 * Load affinity configuration from .cap/config.json.
 * This is the ONLY function in the module that performs I/O.
 * @param {string} cwd - Project root directory
 * @returns {AffinityConfig} Merged configuration (user overrides + defaults)
 */
function loadConfig(cwd) {
  const configPath = path.join(cwd, CONFIG_FILE);
  let userConfig = {};

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    userConfig = parsed || {};
  } catch (_err) {
    // No config file or invalid JSON — use defaults
  }

  return mergeWithDefaults(userConfig);
}

/**
 * Merge user-supplied configuration with defaults.
 * Validates that weights sum to 1.0 (within tolerance) and normalizes if needed.
 * @param {Object} userConfig - Raw user config (may have affinityWeights, affinityBands)
 * @returns {AffinityConfig}
 */
function mergeWithDefaults(userConfig) {
  // Merge weights
  let weights = { ...DEFAULT_WEIGHTS };
  if (userConfig.affinityWeights && typeof userConfig.affinityWeights === 'object') {
    for (const signal of SIGNAL_NAMES) {
      if (typeof userConfig.affinityWeights[signal] === 'number') {
        weights[signal] = userConfig.affinityWeights[signal];
      }
    }
  }

  // Normalize weights to sum to 1.0
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1.0) > 0.001) {
    // @cap-risk Weights that do not sum to 1.0 are silently normalized — could mask user config errors
    for (const signal of SIGNAL_NAMES) {
      weights[signal] = weights[signal] / weightSum;
    }
  }

  // Merge band thresholds
  let bands = { ...DEFAULT_BANDS };
  if (userConfig.affinityBands && typeof userConfig.affinityBands === 'object') {
    if (typeof userConfig.affinityBands.urgent === 'number') bands.urgent = userConfig.affinityBands.urgent;
    if (typeof userConfig.affinityBands.notify === 'number') bands.notify = userConfig.affinityBands.notify;
    if (typeof userConfig.affinityBands.silent === 'number') bands.silent = userConfig.affinityBands.silent;
  }

  return { weights, bands };
}

// --- Core Functions ---

// @cap-todo(ac:F-036/AC-1) Compute composite affinity score (0.0-1.0) between any two thread nodes by combining 8 weighted signal scores

/**
 * Compute the full affinity between two threads using all 8 signals.
 * @param {Thread} threadA - First thread
 * @param {Thread} threadB - Second thread
 * @param {AffinityContext} context - Graph, threads, and index data
 * @param {AffinityConfig} [config] - Optional config (uses defaults if omitted)
 * @returns {AffinityResult}
 */
function computeAffinity(threadA, threadB, context, config) {
  const cfg = config || { weights: { ...DEFAULT_WEIGHTS }, bands: { ...DEFAULT_BANDS } };
  return _computeWithSignals(threadA, threadB, context, cfg, SIGNAL_NAMES);
}

/**
 * Compute affinity using only the 4 realtime signals.
 * Weights are renormalized to sum to 1.0 across the selected signals.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} context
 * @param {AffinityConfig} [config]
 * @returns {AffinityResult}
 */
function computeRealtimeAffinity(threadA, threadB, context, config) {
  const cfg = config || { weights: { ...DEFAULT_WEIGHTS }, bands: { ...DEFAULT_BANDS } };
  return _computeWithSignals(threadA, threadB, context, cfg, REALTIME_SIGNALS);
}

/**
 * Compute affinity using only the 4 post-session signals.
 * Weights are renormalized to sum to 1.0 across the selected signals.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} context
 * @param {AffinityConfig} [config]
 * @returns {AffinityResult}
 */
function computePostSessionAffinity(threadA, threadB, context, config) {
  const cfg = config || { weights: { ...DEFAULT_WEIGHTS }, bands: { ...DEFAULT_BANDS } };
  return _computeWithSignals(threadA, threadB, context, cfg, POST_SESSION_SIGNALS);
}

/**
 * Internal: compute affinity using a specific subset of signals.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {AffinityContext} context
 * @param {AffinityConfig} config
 * @param {SignalName[]} signalNames - Which signals to use
 * @returns {AffinityResult}
 */
function _computeWithSignals(threadA, threadB, context, config, signalNames) {
  const signals = [];
  let compositeScore = 0;

  // Compute renormalized weights for the selected signal subset
  const subsetWeightSum = signalNames.reduce((sum, name) => sum + (config.weights[name] || 0), 0);
  const normalizer = subsetWeightSum > 0 ? subsetWeightSum : 1;

  for (const name of signalNames) {
    const fn = SIGNAL_FUNCTIONS[name];
    if (!fn) continue;

    const result = fn(threadA, threadB, context);
    signals.push(result);

    const weight = (config.weights[name] || 0) / normalizer;
    compositeScore += result.score * weight;
  }

  compositeScore = clamp01(compositeScore);
  const band = classifyBand(compositeScore, config.bands);

  return {
    sourceThreadId: threadA.id,
    targetThreadId: threadB.id,
    compositeScore,
    band,
    signals,
    computedAt: new Date().toISOString(),
  };
}

// @cap-todo(ac:F-036/AC-8) <200ms for single thread pair with 100 thread nodes

/**
 * Compute affinity for all unique thread pairs.
 * Returns results sorted by composite score descending.
 * @param {Thread[]} threads - Array of threads to compare
 * @param {AffinityContext} context
 * @param {AffinityConfig} [config]
 * @returns {AffinityResult[]}
 */
function computeAffinityBatch(threads, context, config) {
  const cfg = config || { weights: { ...DEFAULT_WEIGHTS }, bands: { ...DEFAULT_BANDS } };
  const results = [];

  for (let i = 0; i < threads.length; i++) {
    for (let j = i + 1; j < threads.length; j++) {
      results.push(computeAffinity(threads[i], threads[j], context, cfg));
    }
  }

  // Sort descending by composite score
  results.sort((a, b) => b.compositeScore - a.compositeScore);

  return results;
}

// @cap-todo(ac:F-036/AC-5) classifyBand with configurable thresholds

/**
 * Classify a composite score into an affinity band.
 * @param {number} score - Composite score (0.0-1.0)
 * @param {Object} [bandConfig] - Band thresholds { urgent, notify, silent }
 * @returns {AffinityBand}
 */
function classifyBand(score, bandConfig) {
  const bands = bandConfig || DEFAULT_BANDS;

  if (score >= bands.urgent) return 'urgent';
  if (score >= bands.notify) return 'notify';
  if (score >= bands.silent) return 'silent';
  return 'discard';
}

// @cap-todo(ac:F-036/AC-6) Discard band scores not persisted; others stored as weighted edges with type "affinity"

/**
 * Filter affinity results to only those that should be persisted (non-discard).
 * @param {AffinityResult[]} results
 * @returns {AffinityResult[]}
 */
function filterPersistable(results) {
  return results.filter(r => r.band !== 'discard');
}

/**
 * Convert an affinity result into a graph edge suitable for addEdge().
 * Only call this for persistable (non-discard) results.
 * @param {AffinityResult} result
 * @param {Object} graph - MemoryGraph to resolve thread node IDs
 * @returns {Object|null} Graph edge object or null if thread nodes not found
 */
function toGraphEdge(result, graph) {
  const sourceNodeId = findThreadNodeId(graph, result.sourceThreadId);
  const targetNodeId = findThreadNodeId(graph, result.targetThreadId);

  if (!sourceNodeId || !targetNodeId) return null;

  return {
    source: sourceNodeId,
    target: targetNodeId,
    type: 'affinity',
    createdAt: result.computedAt,
    active: true,
    metadata: {
      compositeScore: result.compositeScore,
      band: result.band,
      signals: result.signals.map(s => ({
        signal: s.signal,
        score: s.score,
        reason: s.reason,
      })),
    },
  };
}

// --- Module Exports ---

// @cap-todo(ac:F-036/AC-7) Pure logic module — no direct I/O (except loadConfig)
// @cap-decision Exporting internal helpers prefixed with _ for testing, following project convention.

module.exports = {
  // Core affinity computation
  computeAffinity,
  computeRealtimeAffinity,
  computePostSessionAffinity,
  computeAffinityBatch,

  // Classification and filtering
  classifyBand,
  filterPersistable,
  toGraphEdge,

  // Configuration
  loadConfig,
  mergeWithDefaults,

  // Constants
  SIGNAL_NAMES,
  REALTIME_SIGNALS,
  POST_SESSION_SIGNALS,
  DEFAULT_WEIGHTS,
  DEFAULT_BANDS,

  // Internal (for testing)
  _signalFeatureIdOverlap: signalFeatureIdOverlap,
  _signalSharedFiles: signalSharedFiles,
  _signalTemporalProximity: signalTemporalProximity,
  _signalCausalChains: signalCausalChains,
  _signalConceptOverlap: signalConceptOverlap,
  _signalProblemSpaceSimilarity: signalProblemSpaceSimilarity,
  _signalSharedDecisionsDeep: signalSharedDecisionsDeep,
  _signalTransitiveConnections: signalTransitiveConnections,
  _jaccard: jaccard,
  _extractKeywords: extractKeywords,
  _clamp01: clamp01,
  _findThreadNodeId: findThreadNodeId,
  _collectFilesForThread: collectFilesForThread,
  _getGraphNeighbors: getGraphNeighbors,
  _computeWithSignals,
};
