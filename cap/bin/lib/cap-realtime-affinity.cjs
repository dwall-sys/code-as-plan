// @cap-feature(feature:F-039) Realtime Affinity Detection — evaluates 4 realtime signals against all existing threads during an active session, surfaces results via gradient UX bands, caches in SESSION.json
// @cap-decision I/O module — loads threads, graph, and session state to orchestrate realtime affinity detection. Pure logic (detect, format) separated from I/O (load, cache).
// @cap-decision Gradient UX — presentation scales with affinity weight: urgent gets full context block, notify gets one-liner, silent is stored only, discard is dropped entirely.
// @cap-decision Session caching under realtimeAffinity key — persists results across agent hand-offs within the same session without recomputation.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path) and sibling CAP modules.

'use strict';

const path = require('node:path');

// --- Lazy Requires ---
// @cap-decision Lazy require pattern avoids circular dependency issues and keeps startup fast — modules loaded only when needed.

/** @returns {import('./cap-affinity-engine.cjs')} */
function _engine() { return require('./cap-affinity-engine.cjs'); }

/** @returns {import('./cap-thread-tracker.cjs')} */
function _tracker() { return require('./cap-thread-tracker.cjs'); }

/** @returns {import('./cap-memory-graph.cjs')} */
function _graph() { return require('./cap-memory-graph.cjs'); }

/** @returns {import('./cap-session.cjs')} */
function _session() { return require('./cap-session.cjs'); }

// --- Types ---

/**
 * @typedef {Object} RealtimeMatch
 * @property {string} threadId - Target thread ID
 * @property {string} threadName - Target thread name
 * @property {number} score - Composite affinity score (0.0-1.0)
 * @property {string} band - Affinity band: 'urgent'|'notify'|'silent'
 * @property {string} strongestSignal - Name of the highest-scoring signal
 * @property {number} strongestScore - Score of the strongest signal (0.0-1.0)
 * @property {string} strongestReason - Human-readable reason from the strongest signal
 */

/**
 * @typedef {Object} RealtimeResult
 * @property {string} activeThreadId - The thread being compared against
 * @property {string} computedAt - ISO timestamp of computation
 * @property {RealtimeMatch[]} matches - Matches sorted by score descending (excludes discard band)
 */

/**
 * @typedef {Object} FormattedNotification
 * @property {string} band - 'urgent'|'notify'|'silent'
 * @property {string} text - Formatted display text
 * @property {string} threadId - Thread ID for follow-up actions
 */

// --- Core Detection ---

// @cap-todo(ac:F-039/AC-1) During an active session, evaluate 4 realtime signals against all existing threads whenever the active thread context changes
// @cap-todo(ac:F-039/AC-2) Realtime evaluation of all 4 signals against full thread index shall complete within 200ms

/**
 * Detect realtime affinity between the active thread and all other threads.
 * Evaluates only the 4 realtime signals (feature-id-overlap, shared-files,
 * temporal-proximity, causal-chains) for speed.
 *
 * @param {import('./cap-thread-tracker.cjs').Thread} activeThread - The currently active thread
 * @param {import('./cap-thread-tracker.cjs').Thread[]} allThreads - All known threads (self is filtered out)
 * @param {import('./cap-affinity-engine.cjs').AffinityContext} context - Graph and thread data
 * @param {import('./cap-affinity-engine.cjs').AffinityConfig} [config] - Optional affinity config
 * @returns {RealtimeResult}
 */
function detectRealtimeAffinity(activeThread, allThreads, context, config) {
  const engine = _engine();
  const cfg = config || engine.loadConfig(process.cwd());
  const computedAt = new Date().toISOString();
  const matches = [];

  for (const thread of allThreads) {
    // Skip self-comparison
    if (thread.id === activeThread.id) continue;

    const result = engine.computeRealtimeAffinity(activeThread, thread, context, cfg);

    // Discard band is not stored
    if (result.band === 'discard') continue;

    // Find strongest signal
    const strongest = _findStrongestSignal(result.signals);

    matches.push({
      threadId: thread.id,
      threadName: thread.name || thread.id,
      score: result.compositeScore,
      band: result.band,
      strongestSignal: strongest.signal,
      strongestScore: strongest.score,
      strongestReason: strongest.reason,
    });
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return {
    activeThreadId: activeThread.id,
    computedAt,
    matches,
  };
}

/**
 * Find the highest-scoring signal from a signal results array.
 * @param {import('./cap-affinity-engine.cjs').SignalResult[]} signals
 * @returns {import('./cap-affinity-engine.cjs').SignalResult}
 */
function _findStrongestSignal(signals) {
  if (!signals || signals.length === 0) {
    return { signal: 'unknown', score: 0, reason: 'No signals computed' };
  }

  let best = signals[0];
  for (let i = 1; i < signals.length; i++) {
    if (signals[i].score > best.score) {
      best = signals[i];
    }
  }
  return best;
}

// --- Formatting ---

// @cap-todo(ac:F-039/AC-3) Threads scoring in urgent band (>=0.90) surfaced as full context block with thread name, strongest signal, and load-context offer

/**
 * Format an urgent-band match as a full context block.
 * @param {RealtimeMatch} match
 * @returns {string}
 */
function formatUrgentBlock(match) {
  return [
    '',
    '--- Strongly related thread found ---',
    `Thread: "${match.threadName}" (${match.threadId})`,
    `Strongest signal: ${match.strongestSignal} (${match.strongestScore.toFixed(2)}) — ${match.strongestReason}`,
    '',
    'Load this thread\'s context? [yes/no]',
    '',
  ].join('\n');
}

// @cap-todo(ac:F-039/AC-4) Threads scoring in notify band (0.75-0.89) surfaced as compact single-line notification

/**
 * Format a notify-band match as a compact one-liner.
 * @param {RealtimeMatch} match
 * @returns {string}
 */
function formatNotifyLine(match) {
  return `Related: "${match.threadName}" — ${match.strongestSignal} (${match.strongestScore.toFixed(2)})`;
}

// @cap-todo(ac:F-039/AC-5) Threads scoring in silent band (0.40-0.74) produce no visible output — only queryable via /cap:status

/**
 * Format all results according to their band.
 * Silent-band matches are included in the output array but marked as silent
 * so callers can choose whether to display them.
 *
 * @param {RealtimeResult} result - Detection result
 * @returns {FormattedNotification[]}
 */
function formatResults(result) {
  const notifications = [];

  for (const match of result.matches) {
    switch (match.band) {
      case 'urgent':
        notifications.push({
          band: 'urgent',
          text: formatUrgentBlock(match),
          threadId: match.threadId,
        });
        break;
      case 'notify':
        notifications.push({
          band: 'notify',
          text: formatNotifyLine(match),
          threadId: match.threadId,
        });
        break;
      case 'silent':
        // Silent: no visible output, but included for queryability
        notifications.push({
          band: 'silent',
          text: '',
          threadId: match.threadId,
        });
        break;
      // discard: never reaches here (filtered in detectRealtimeAffinity)
    }
  }

  return notifications;
}

// --- Session Cache ---

// @cap-todo(ac:F-039/AC-7) Realtime affinity results cached in SESSION.json under key realtimeAffinity so they persist across agent hand-offs

/**
 * Cache realtime affinity results in SESSION.json under the realtimeAffinity key.
 * @param {string} cwd - Project root directory
 * @param {RealtimeResult} result - Detection results to cache
 */
function cacheResults(cwd, result) {
  const session = _session();
  session.updateSession(cwd, {
    realtimeAffinity: {
      activeThreadId: result.activeThreadId,
      computedAt: result.computedAt,
      results: result.matches.map(m => ({
        threadId: m.threadId,
        threadName: m.threadName,
        score: m.score,
        band: m.band,
        strongestSignal: m.strongestSignal,
        strongestScore: m.strongestScore,
        strongestReason: m.strongestReason,
      })),
    },
  });
}

/**
 * Load cached realtime affinity results from SESSION.json.
 * @param {string} cwd - Project root directory
 * @returns {RealtimeResult|null} Cached result or null if not present
 */
function loadCachedResults(cwd) {
  const session = _session();
  const data = session.loadSession(cwd);
  const cached = data.realtimeAffinity;

  if (!cached || !cached.activeThreadId) return null;

  return {
    activeThreadId: cached.activeThreadId,
    computedAt: cached.computedAt,
    matches: (cached.results || []).map(r => ({
      threadId: r.threadId,
      threadName: r.threadName,
      score: r.score,
      band: r.band,
      strongestSignal: r.strongestSignal,
      strongestScore: r.strongestScore,
      strongestReason: r.strongestReason,
    })),
  };
}

/**
 * Clear cached realtime affinity results from SESSION.json.
 * @param {string} cwd - Project root directory
 */
function clearCache(cwd) {
  const session = _session();
  session.updateSession(cwd, { realtimeAffinity: null });
}

// --- Integration Hooks ---

// @cap-todo(ac:F-039/AC-6) Realtime detector integrates with cap-brainstormer at session start and with cap-thread-tracker when thread context is updated

/**
 * Called by cap-brainstormer at session start.
 * Loads all threads, runs realtime affinity detection, caches results,
 * and returns formatted notifications for display.
 *
 * @param {string} cwd - Project root directory
 * @param {import('./cap-thread-tracker.cjs').Thread} activeThread - The active thread for this session
 * @returns {FormattedNotification[]}
 */
function onSessionStart(cwd, activeThread) {
  const { allThreads, context, config } = _loadDetectionContext(cwd);

  const result = detectRealtimeAffinity(activeThread, allThreads, context, config);
  cacheResults(cwd, result);
  return formatResults(result);
}

/**
 * Called when thread context changes mid-session (e.g., user switches threads).
 * If the active thread has not changed, returns cached results.
 * Otherwise, recomputes and caches fresh results.
 *
 * @param {string} cwd - Project root directory
 * @param {import('./cap-thread-tracker.cjs').Thread} activeThread - The new active thread
 * @returns {FormattedNotification[]}
 */
function onThreadContextChange(cwd, activeThread) {
  // Check if we can reuse cached results
  const cached = loadCachedResults(cwd);
  if (cached && cached.activeThreadId === activeThread.id) {
    return formatResults(cached);
  }

  // Recompute
  return onSessionStart(cwd, activeThread);
}

/**
 * Load all data needed for realtime affinity detection.
 * Consolidates thread index loading, thread data loading, graph loading,
 * and config loading into a single helper.
 *
 * @param {string} cwd - Project root directory
 * @returns {{ allThreads: import('./cap-thread-tracker.cjs').Thread[], context: import('./cap-affinity-engine.cjs').AffinityContext, config: import('./cap-affinity-engine.cjs').AffinityConfig }}
 */
function _loadDetectionContext(cwd) {
  const tracker = _tracker();
  const graphMod = _graph();
  const engine = _engine();

  const index = tracker.loadIndex(cwd);
  const graph = graphMod.loadGraph(cwd);
  const config = engine.loadConfig(cwd);

  // Load full thread data for each entry in the index
  const allThreads = [];
  for (const entry of index.threads || []) {
    const thread = tracker.loadThread(cwd, entry.id);
    if (thread) {
      allThreads.push(thread);
    }
  }

  const context = {
    graph,
    allThreads,
    threadIndex: index.threads || [],
  };

  return { allThreads, context, config };
}

// --- Query ---

/**
 * Return cached silent-band matches for /cap:status display.
 * Silent matches produce no visible output during normal flow but
 * are accessible on demand.
 *
 * @param {string} cwd - Project root directory
 * @returns {RealtimeMatch[]} Silent-band matches, or empty array if no cache
 */
function getSilentMatches(cwd) {
  const cached = loadCachedResults(cwd);
  if (!cached) return [];
  return cached.matches.filter(m => m.band === 'silent');
}

/**
 * Return all cached matches regardless of band, for diagnostic use.
 * @param {string} cwd - Project root directory
 * @returns {RealtimeMatch[]} All cached matches, or empty array
 */
function getAllCachedMatches(cwd) {
  const cached = loadCachedResults(cwd);
  if (!cached) return [];
  return cached.matches;
}

// --- Module Exports ---

// @cap-decision Exporting internal helpers prefixed with _ for testing, following project convention.

module.exports = {
  // Core detection
  detectRealtimeAffinity,

  // Formatting
  formatUrgentBlock,
  formatNotifyLine,
  formatResults,

  // Session cache
  cacheResults,
  loadCachedResults,
  clearCache,

  // Integration hooks
  onSessionStart,
  onThreadContextChange,

  // Query
  getSilentMatches,
  getAllCachedMatches,

  // Internal (for testing)
  _findStrongestSignal,
  _loadDetectionContext,
};
