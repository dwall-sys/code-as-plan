'use strict';

// @cap-feature(feature:F-040, primary:true) Cluster display orchestrator -- thin module that wires
// the pure formatters (cap-cluster-format.cjs), helper utilities (cap-cluster-helpers.cjs), and the
// I/O layer (cap-cluster-io.cjs) into a single public surface. This is the canonical module for
// /cap:cluster and /cap:status integration.
// @cap-feature(feature:F-050) Refactored from a 696-line single file into a 4-module split:
//   - cap-cluster-format.cjs  : 4 public format* functions (no I/O)
//   - cap-cluster-helpers.cjs : 11 pure _* helpers shared by formatters and tests
//   - cap-cluster-io.cjs      : disk loaders, affinity + clustering pipeline, structured diagnostics
//   - cap-cluster-display.cjs : this orchestrator -- re-exports the union for backward compatibility
// @cap-decision Public API of cap-cluster-display.cjs is preserved exactly -- callers see the same 19
// exports as before refactor (verified via Object.keys diff in F-050/AC-4 acceptance gate).
// @cap-decision Re-export pattern (explicit property assignment) chosen over `Object.assign(...)` so the
// canonical export list is greppable in this file -- a future reader can verify the public surface
// without having to load three other modules.

// @cap-todo(ac:F-050/AC-1) Split into format/helpers/io/orchestrator modules; orchestrator stays under 60 lines.
// @cap-todo(ac:F-050/AC-4) Public API unchanged -- this module re-exports the union of format + helpers + io.

const format = require('./cap-cluster-format.cjs');
const helpers = require('./cap-cluster-helpers.cjs');
const io = require('./cap-cluster-io.cjs');

module.exports = {
  // --- Pure formatting (re-exported from cap-cluster-format.cjs) ---
  formatClusterOverview: format.formatClusterOverview,
  formatClusterDetail: format.formatClusterDetail,
  formatNeuralMemoryStatus: format.formatNeuralMemoryStatus,
  formatRealtimeNotifications: format.formatRealtimeNotifications,

  // --- I/O convenience (re-exported from cap-cluster-io.cjs) ---
  loadAndFormatOverview: io.loadAndFormatOverview,
  loadAndFormatDetail: io.loadAndFormatDetail,
  loadAndFormatStatus: io.loadAndFormatStatus,

  // --- Internal helpers (re-exported from cap-cluster-helpers.cjs for testing + backward compat) ---
  _buildAffinityMap: helpers._buildAffinityMap,
  _pairKey: helpers._pairKey,
  _computeAvgAffinity: helpers._computeAvgAffinity,
  _countDormantMembers: helpers._countDormantMembers,
  _isNodeDormant: helpers._isNodeDormant,
  _countAllDormantNodes: helpers._countAllDormantNodes,
  _getJoinedDate: helpers._getJoinedDate,
  _buildPairwiseRows: helpers._buildPairwiseRows,
  _extractSharedConcepts: helpers._extractSharedConcepts,
  _computeDriftStatus: helpers._computeDriftStatus,
  _findHighestAffinityPair: helpers._findHighestAffinityPair,

  // --- I/O internal (re-exported from cap-cluster-io.cjs for testing + backward compat) ---
  _loadClusterData: io._loadClusterData,
};
