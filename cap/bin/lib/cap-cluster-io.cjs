'use strict';

// @cap-feature(feature:F-050) I/O layer extracted from cap-cluster-display.cjs.
// Loads data from disk (graph.json, thread-index.json, threads/{id}.json), runs affinity computation
// and cluster detection, and exposes loadAndFormat* convenience wrappers that delegate to cap-cluster-format.
// @cap-feature(feature:F-040) Cluster I/O wrappers -- load disk state then format.
// @cap-decision Each silent catch site in the original _loadClusterData() now emits a structured diagnostic
// via cap-logger.debug(). The recovery semantics (return null/empty) are preserved so the public API and
// caller behavior do not change. Only difference: with CAP_DEBUG=1 set, failures become visible.

const path = require('node:path');
const logger = require('./cap-logger.cjs');
const format = require('./cap-cluster-format.cjs');

// --- Lazy-loaded dependencies (avoid circular requires + speed up cold start) ---

/** @returns {typeof import('./cap-cluster-detect.cjs')} */
function _clusterDetect() {
  return require(path.join(__dirname, 'cap-cluster-detect.cjs'));
}

/** @returns {typeof import('./cap-affinity-engine.cjs')} */
function _affinityEngine() {
  return require(path.join(__dirname, 'cap-affinity-engine.cjs'));
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
  return format.formatClusterOverview(clusters, graph, affinityResults);
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

  return format.formatClusterDetail(cluster, affinityResults, graph, threads);
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
  return format.formatNeuralMemoryStatus(clusters, graph, affinityResults);
}

// --- Internal: shared data loader with structured diagnostics ---

// @cap-todo(ac:F-050/AC-2) Each catch site emits a structured diagnostic (op, file, errorType, errorMessage,
// recoveryAction) via cap-logger.debug() instead of silently swallowing the error.

/**
 * Load graph, threads, compute affinity, and run cluster detection.
 * Shared data loading for all I/O convenience functions.
 *
 * @param {string} cwd - Project root directory
 * @returns {{clusters: Object[], graph: Object, affinityResults: Object[], threads: Object[]}}
 */
function _loadClusterData(cwd) {
  const graphMod = _memoryGraph();
  const threadMod = _threadTracker();
  const affinityMod = _affinityEngine();
  const clusterMod = _clusterDetect();
  const semanticMod = _semanticPipeline();

  // --- 1. Load graph ---
  // @cap-risk(feature:F-050) Graph load fallback creates an empty graph -- callers see a fresh blank
  // graph instead of a hard error. Now visible via CAP_DEBUG so failures are debuggable.
  const graphPath = path.join(cwd, '.cap', 'memory', 'graph.json');
  let graph;
  try {
    graph = graphMod.loadGraph(cwd);
  } catch (err) {
    logger.debug(logger.fromError('loadClusterData.loadGraph', err, {
      file: graphPath,
      recoveryAction: 'creating empty graph via createGraph()',
    }));
    graph = graphMod.createGraph();
  }

  // --- 2. Load thread index and all threads ---
  const indexPath = path.join(cwd, '.cap', 'memory', 'thread-index.json');
  let threads = [];
  try {
    const index = threadMod.loadIndex(cwd);
    const entries = index.threads || [];
    for (const entry of entries) {
      // @cap-risk(feature:F-050) Per-thread load fallback skips unloadable threads -- they vanish
      // from cluster output. Now visible via CAP_DEBUG so partial losses are debuggable.
      try {
        const thread = threadMod.loadThread(cwd, entry.id);
        if (thread) threads.push(thread);
      } catch (err) {
        const threadFile = path.join(cwd, '.cap', 'memory', 'threads', `${entry.id}.json`);
        logger.debug(logger.fromError('loadClusterData.loadThread', err, {
          file: threadFile,
          threadId: entry.id,
          recoveryAction: 'skipping this thread; continuing with remaining entries',
        }));
      }
    }
  } catch (err) {
    logger.debug(logger.fromError('loadClusterData.loadIndex', err, {
      file: indexPath,
      recoveryAction: 'returning empty threads array',
    }));
  }

  // --- 3. Load affinity config and compute batch affinity ---
  // @cap-risk(feature:F-050) Affinity failure returns empty results -- cluster detection will see no
  // edges and produce no clusters. Now visible via CAP_DEBUG so silent emptiness is debuggable.
  let affinityResults = [];
  try {
    const config = affinityMod.loadConfig(cwd);
    const context = { graph, allThreads: threads, threadIndex: threads };
    // Signature is computeAffinityBatch(threads, context, config) — swapped here
    // meant `context` landed in `config`, `config.weights` was undefined, and the
    // whole affinity pipeline silently returned empty results. User-visible
    // symptom: /cap:cluster kept reporting "No clusters detected" even on
    // projects with 20+ threads and curated cluster entries in thread-index.json.
    affinityResults = affinityMod.computeAffinityBatch(threads, context, config);
    affinityResults = affinityMod.filterPersistable(affinityResults);
  } catch (err) {
    logger.debug(logger.fromError('loadClusterData.computeAffinity', err, {
      threadCount: threads.length,
      recoveryAction: 'returning empty affinityResults array',
    }));
    affinityResults = [];
  }

  // --- 4. Run cluster detection ---
  // @cap-risk(feature:F-050) Cluster detection failure returns empty cluster list -- the user sees
  // "no clusters detected" even when threads exist. Now visible via CAP_DEBUG.
  let clusters = [];
  try {
    const taxonomy = semanticMod.SEED_TAXONOMY;
    const result = clusterMod.runClusterDetection(affinityResults, graph, threads, { taxonomy });
    clusters = result.clusters || [];
    graph = result.graph || graph;
  } catch (err) {
    logger.debug(logger.fromError('loadClusterData.runClusterDetection', err, {
      affinityResultCount: affinityResults.length,
      threadCount: threads.length,
      recoveryAction: 'returning empty clusters array; preserving original graph',
    }));
    clusters = [];
  }

  return { clusters, graph, affinityResults, threads };
}

module.exports = {
  // I/O convenience
  loadAndFormatOverview,
  loadAndFormatDetail,
  loadAndFormatStatus,

  // Internal (for testing)
  _loadClusterData,
};
