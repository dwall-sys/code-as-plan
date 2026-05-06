// @cap-context CAP v2.0 checkpoint detector -- advisory logic for /cap:checkpoint slash command.
// Detects natural breakpoints in the workflow so the user can be nudged toward /compact before
// auto-compact degrades context quality.

'use strict';

// @cap-feature(feature:F-057) Checkpoint Command for Strategic Compact — pure logic
// @cap-decision Breakpoint detection is side-effect-free — returns a plan object, never mutates disk on its own. Orchestrator (the slash command) is responsible for invoking /cap:save and printing.
// @cap-constraint Zero runtime deps — node: built-ins only

const fs = require('node:fs');
const path = require('node:path');

const capSession = require('./cap-session.cjs');

// @cap-todo(ac:F-057/AC-2) Known terminal session-step markers that indicate a logical workflow phase has completed.
/**
 * Session-step markers that constitute a breakpoint signal when reached.
 * Kept as a Set for O(1) membership checks.
 */
const TERMINAL_STEPS = new Set([
  'test-complete',
  'review-complete',
  'prototype-complete',
  'brainstorm-complete',
  'iterate-complete',
]);

// @cap-decision Feature state ranking — used by pickBreakpoint to select the "biggest" transition when
// multiple features moved at once. Higher rank wins. 'planned' is rank 0 (not a breakpoint on its own).
/**
 * Relative weight of each feature-state value.
 * @type {Object<string, number>}
 */
const STATE_RANK = {
  shipped: 3,
  tested: 2,
  prototyped: 1,
  planned: 0,
};

// Human-readable labels for session-step breakpoints.
const STEP_REASONS = {
  'test-complete': 'Test-Phase abgeschlossen',
  'review-complete': 'Review-Phase abgeschlossen',
  'prototype-complete': 'Prototype-Phase abgeschlossen',
  'brainstorm-complete': 'Brainstorm-Phase abgeschlossen',
  'iterate-complete': 'Iterate-Phase abgeschlossen',
};

/**
 * @typedef {Object} FeatureSnapshot
 * @property {Object<string,string>} featureStates - Map of feature ID -> state (e.g., "F-054" -> "tested")
 * @property {Object<string,string>} acStatuses - Map of "F-NNN/AC-M" -> status
 */

/**
 * @typedef {Object} FeatureDiff
 * @property {string} featureId - Feature ID that changed
 * @property {'state-transition'|'ac-status-update'} type - Kind of change
 * @property {string|null} from - Previous value (null if no prior snapshot)
 * @property {string} to - New value
 * @property {string} [acId] - AC identifier (only for ac-status-update)
 */

/**
 * @typedef {Object} Breakpoint
 * @property {'feature-transition'|'ac-update'|'session-step'} kind - Which signal triggered the breakpoint
 * @property {string} [featureId] - Feature ID involved (optional for session-step)
 * @property {string} reason - Human-readable reason, used in the recommendation
 */

/**
 * @typedef {Object} CheckpointPlan
 * @property {boolean} shouldSave - Whether the orchestrator should invoke /cap:save
 * @property {string|null} saveLabel - Label to pass to /cap:save (positional [name] arg)
 * @property {string} message - Human-readable recommendation or "no breakpoint" notice
 */

/**
 * @typedef {Object} AnalyzeResult
 * @property {Breakpoint|null} breakpoint - Detected breakpoint, or null
 * @property {CheckpointPlan} plan - Plan describing what the orchestrator should do
 * @property {FeatureSnapshot} currentSnapshot - Fresh snapshot of current feature states (for applyCheckpoint)
 */

// @cap-todo(ac:F-057/AC-2) captureFeatureSnapshot — transforms a FeatureMap feature[] array into the
// flat {featureStates, acStatuses} form persisted in SESSION.json.
/**
 * Produce a minimal snapshot of feature states and AC statuses for later diffing.
 * Pure function.
 * @param {Array<{id: string, state: string, acs: Array<{id: string, status: string}>}>} features
 * @returns {FeatureSnapshot}
 */
function captureFeatureSnapshot(features) {
  const snapshot = {
    featureStates: {},
    acStatuses: {},
  };
  if (!Array.isArray(features)) return snapshot;

  for (const feature of features) {
    if (!feature || typeof feature.id !== 'string') continue;
    snapshot.featureStates[feature.id] = feature.state || 'planned';
    if (Array.isArray(feature.acs)) {
      for (const ac of feature.acs) {
        if (!ac || typeof ac.id !== 'string') continue;
        snapshot.acStatuses[`${feature.id}/${ac.id}`] = ac.status || 'pending';
      }
    }
  }
  return snapshot;
}

/**
 * Diff a single feature's state against the prior snapshot. Pushes at most one
 * state-transition diff into `out`.
 * @param {{id:string, state:string}} feature
 * @param {Object<string,string>} prevStates
 * @param {boolean} isFirstTime
 * @param {FeatureDiff[]} out
 */
function diffFeatureState(feature, prevStates, isFirstTime, out) {
  const curState = feature.state || 'planned';
  const prevState = prevStates[feature.id];

  if (isFirstTime || prevState === undefined) {
    // Both cases emit only for non-planned features — "planned" is the baseline, not a transition.
    if (curState !== 'planned') {
      out.push({ featureId: feature.id, type: 'state-transition', from: null, to: curState });
    }
    return;
  }
  if (prevState !== curState) {
    out.push({ featureId: feature.id, type: 'state-transition', from: prevState, to: curState });
  }
}

/**
 * Diff a single feature's AC statuses against the prior snapshot. Pushes any
 * ac-status-update diffs into `out`.
 * @param {{id:string, acs?:Array<{id:string, status:string}>}} feature
 * @param {Object<string,string>} prevAcs
 * @param {boolean} isFirstTime
 * @param {FeatureDiff[]} out
 */
function diffFeatureACs(feature, prevAcs, isFirstTime, out) {
  if (!Array.isArray(feature.acs)) return;
  for (const ac of feature.acs) {
    if (!ac || typeof ac.id !== 'string') continue;
    const key = `${feature.id}/${ac.id}`;
    const curStatus = ac.status || 'pending';
    const prevStatus = prevAcs[key];

    if (isFirstTime || prevStatus === undefined) {
      if (curStatus !== 'pending') {
        out.push({ featureId: feature.id, type: 'ac-status-update', acId: ac.id, from: null, to: curStatus });
      }
      continue;
    }
    if (prevStatus !== curStatus) {
      out.push({ featureId: feature.id, type: 'ac-status-update', acId: ac.id, from: prevStatus, to: curStatus });
    }
  }
}

// @cap-todo(ac:F-057/AC-2) diffFeatureStates — finds every state-transition and ac-status-update between
// a prior snapshot and the current feature array. Returns an array of diff objects.
/**
 * Compute the diff between a previous snapshot and the current feature list.
 * When prevSnapshot is null/empty, treats all non-planned features and all non-pending ACs as new
 * transitions (i.e. first-time checkpoint).
 * @param {FeatureSnapshot|null} prevSnapshot
 * @param {Array<{id: string, state: string, acs: Array<{id: string, status: string}>}>} currentFeatures
 * @returns {FeatureDiff[]}
 */
function diffFeatureStates(prevSnapshot, currentFeatures) {
  const diffs = [];
  if (!Array.isArray(currentFeatures)) return diffs;

  const prevStates = (prevSnapshot && prevSnapshot.featureStates) || {};
  const prevAcs = (prevSnapshot && prevSnapshot.acStatuses) || {};
  const isFirstTime =
    !prevSnapshot ||
    (Object.keys(prevStates).length === 0 && Object.keys(prevAcs).length === 0);

  for (const feature of currentFeatures) {
    if (!feature || typeof feature.id !== 'string') continue;
    diffFeatureState(feature, prevStates, isFirstTime, diffs);
    diffFeatureACs(feature, prevAcs, isFirstTime, diffs);
  }

  return diffs;
}

/**
 * Parse the numeric portion of a feature ID (e.g. "F-057" -> 57). Returns -1 if unparseable
 * so such IDs sort before valid ones (i.e. valid numeric IDs win "younger" comparisons).
 * @param {string} id
 * @returns {number}
 */
function featureNumericId(id) {
  const m = /^F-(\d+)$/.exec(id || '');
  return m ? parseInt(m[1], 10) : -1;
}

// @cap-todo(ac:F-057/AC-3) pickBreakpoint — applies priority rules to the diff array + session step to
// produce a single Breakpoint object (or null). Priority: feature-transition > ac-update > session-step.
/**
 * Pick the single most significant breakpoint from a diff list and an optional session step.
 * Priority:
 *   1. Feature state transitions. Tie-break by higher STATE_RANK, then by larger feature number.
 *   2. AC status updates. Tie-break by larger feature number, then by AC id string.
 *   3. Session terminal step markers.
 * Returns null if none of the above yield a signal.
 * @param {FeatureDiff[]} diffs
 * @param {string|null|undefined} sessionStep
 * @param {Array<{id: string}>} [_features] - currently unused, reserved for future reason enrichment
 * @returns {Breakpoint|null}
 */
function pickBreakpoint(diffs, sessionStep, _features) {
  const safeDiffs = Array.isArray(diffs) ? diffs : [];

  // 1. Feature-state transitions (highest priority)
  const stateTransitions = safeDiffs.filter(d => d.type === 'state-transition');
  if (stateTransitions.length > 0) {
    // Sort: higher STATE_RANK wins, then larger feature number wins.
    const sorted = [...stateTransitions].sort((a, b) => {
      const rankA = STATE_RANK[a.to] !== undefined ? STATE_RANK[a.to] : -1;
      const rankB = STATE_RANK[b.to] !== undefined ? STATE_RANK[b.to] : -1;
      if (rankA !== rankB) return rankB - rankA;
      return featureNumericId(b.featureId) - featureNumericId(a.featureId);
    });
    const winner = sorted[0];
    // Render the from-state so the reason reads as a transition, not a bare end-state.
    // First-time observations have from=null → omit the arrow to keep the message clean.
    const reason = winner.from
      ? `${winner.featureId} von ${winner.from} → ${winner.to}`
      : `${winner.featureId} auf state=${winner.to}`;
    return {
      kind: 'feature-transition',
      featureId: winner.featureId,
      reason,
    };
  }

  // 2. AC-level updates
  const acUpdates = safeDiffs.filter(d => d.type === 'ac-status-update');
  if (acUpdates.length > 0) {
    const sorted = [...acUpdates].sort((a, b) => {
      const fnumDiff = featureNumericId(b.featureId) - featureNumericId(a.featureId);
      if (fnumDiff !== 0) return fnumDiff;
      return String(b.acId || '').localeCompare(String(a.acId || ''));
    });
    const winner = sorted[0];
    return {
      kind: 'ac-update',
      featureId: winner.featureId,
      reason: `${winner.featureId}/${winner.acId} auf status=${winner.to}`,
    };
  }

  // 3. Session step marker
  if (sessionStep && TERMINAL_STEPS.has(sessionStep)) {
    return {
      kind: 'session-step',
      reason: STEP_REASONS[sessionStep] || `Session-Step ${sessionStep}`,
    };
  }

  return null;
}

// @cap-todo(ac:F-057/AC-4) analyze — main entry point. Reads session + feature map, computes plan.
//   Deviation from brainstorm-spec on AC-4: /cap:save accepts a positional [name], not a --label flag.
// @cap-decision Deviated from F-057/AC-4: /cap:save takes a positional [name] arg, not --label; using
// "checkpoint-{feature_id}" as the name. If the breakpoint is session-step (no feature context), the
// label falls back to "checkpoint-session".
// @cap-todo(ac:F-057/AC-5) analyze returns a plan with breakpoint=null and the "Kein natürlicher
// Kontextbruch erkannt." message when nothing changed and no terminal step was reached.
// @cap-todo(ac:F-057/AC-6) analyze never mutates disk and never triggers /compact — it only proposes.
/**
 * Analyze current session + feature map against the last persisted checkpoint snapshot.
 * Pure function: does NOT mutate SESSION.json.
 * @param {Object} sessionJson - Full session object (loaded via capSession.loadSession)
 * @param {{features: Array}} featureMap - Feature map object (loaded via cap-feature-map.readFeatureMap)
 * @returns {AnalyzeResult}
 */
function analyze(sessionJson, featureMap) {
  const session = sessionJson || {};
  const features = (featureMap && Array.isArray(featureMap.features)) ? featureMap.features : [];

  const prevSnapshot = session.lastCheckpointSnapshot || null;
  const currentSnapshot = captureFeatureSnapshot(features);
  const diffs = diffFeatureStates(prevSnapshot, features);
  const breakpoint = pickBreakpoint(diffs, session.step || null, features);

  if (!breakpoint) {
    return {
      breakpoint: null,
      plan: {
        shouldSave: false,
        saveLabel: null,
        message: 'Kein natürlicher Kontextbruch erkannt.',
      },
      currentSnapshot,
    };
  }

  // Sanitize featureId before interpolating into the /cap:save label — the label
  // propagates into a slash-command chain and must not carry shell-metachars even
  // if a malformed FEATURE-MAP.md ever slipped past the feature-map parser.
  const safeFeatureId = /^F-\d+$/.test(breakpoint.featureId || '') ? breakpoint.featureId : null;
  const saveLabel = safeFeatureId ? `checkpoint-${safeFeatureId}` : 'checkpoint-session';

  return {
    breakpoint,
    plan: {
      shouldSave: true,
      saveLabel,
      message: `Jetzt /compact, weil ${breakpoint.reason}.`,
    },
    currentSnapshot,
  };
}

// @cap-todo(ac:F-057/AC-4) applyCheckpoint — side-effect function, persists the current snapshot and
// timestamp to SESSION.json. Kept separate from analyze() to preserve the pure-function boundary.
/**
 * Persist the checkpoint state to SESSION.json. The path argument is the project root.
 *
 * Verifies the post-condition by re-reading SESSION.json and asserting the
 * timestamp round-tripped. An updateSession that silently fails (e.g. EACCES
 * after a race with another hook) would otherwise leave lastCheckpointAt
 * stale and the next run would emit duplicate checkpoints.
 *
 * @param {string} projectRoot - Absolute path to the project root containing .cap/SESSION.json
 * @param {FeatureSnapshot} newSnapshot - Snapshot to persist
 * @param {Date} [now] - Override timestamp (for deterministic testing). Defaults to new Date().
 * @returns {Object} Updated session object
 */
function applyCheckpoint(projectRoot, newSnapshot, now) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('applyCheckpoint: projectRoot must be a non-empty string');
  }
  const timestamp = (now instanceof Date ? now : new Date()).toISOString();
  const snapshot = newSnapshot || { featureStates: {}, acStatuses: {} };
  const updated = capSession.updateSession(projectRoot, {
    lastCheckpointAt: timestamp,
    lastCheckpointSnapshot: snapshot,
  });

  // FS post-condition: read back SESSION.json and confirm the write landed.
  // AC-4 mandates persistence; a silent write failure must throw, not pass.
  const readback = capSession.loadSession(projectRoot);
  if (!readback || readback.lastCheckpointAt !== timestamp) {
    throw new Error(
      `applyCheckpoint: SESSION.json post-condition failed — expected lastCheckpointAt=${timestamp}, got ${readback && readback.lastCheckpointAt}`,
    );
  }
  return updated;
}

/**
 * Convenience wrapper that runs analyze() and applyCheckpoint() in a single
 * call against a freshly-loaded session + feature map, eliminating the TOCTOU
 * window where the orchestrator's two Node invocations might observe
 * different FEATURE-MAP.md contents between analyze and persist.
 *
 * Orchestrators that cannot collapse both steps into one process can still
 * use analyze() + applyCheckpoint() separately, but must pass
 * result.currentSnapshot from the first call through to the second —
 * never recompute.
 *
 * @param {string} projectRoot
 * @param {{now?:Date, loadSession?:Function, readFeatureMap?:Function}} [opts]
 * @returns {AnalyzeResult & {persisted:boolean}}
 */
function analyzeAndApply(projectRoot, opts = {}) {
  const capFeatureMap = require('./cap-feature-map.cjs');
  const loadSession = opts.loadSession || capSession.loadSession;
  const readFeatureMap = opts.readFeatureMap || capFeatureMap.readFeatureMap;

  const session = loadSession(projectRoot);
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
  const featureMap = readFeatureMap(projectRoot, undefined, { safe: true });
  if (featureMap && featureMap.parseError) {
    console.warn('cap: checkpoint analyzeAndApply — duplicate feature ID detected, using partial map: ' + String(featureMap.parseError.message).trim());
  }
  const result = analyze(session, featureMap);

  if (!result.breakpoint) {
    return { ...result, persisted: false };
  }

  applyCheckpoint(projectRoot, result.currentSnapshot, opts.now);
  return { ...result, persisted: true };
}

/**
 * Helper: confirm SESSION.json exists and return its path. Used only in tests/integration flows.
 * @param {string} projectRoot
 * @returns {string}
 */
function sessionPath(projectRoot) {
  return path.join(projectRoot, '.cap', 'SESSION.json');
}

/**
 * Helper: SESSION.json existence check — tiny utility for the orchestrator.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function hasSession(projectRoot) {
  return fs.existsSync(sessionPath(projectRoot));
}

module.exports = {
  TERMINAL_STEPS,
  STATE_RANK,
  captureFeatureSnapshot,
  diffFeatureState,
  diffFeatureACs,
  diffFeatureStates,
  pickBreakpoint,
  analyze,
  applyCheckpoint,
  analyzeAndApply,
  // Exposed for test/diagnostic use
  sessionPath,
  hasSession,
};
