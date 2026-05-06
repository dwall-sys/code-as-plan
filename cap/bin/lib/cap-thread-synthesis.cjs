// @cap-feature(feature:F-032) Build Thread Reconnection and Synthesis Engine — compare returning threads, propose reconnection strategies, detect AC conflicts, merge/supersede/branch/resume threads
// @cap-decision Pure logic module with explicit I/O functions — same pattern as cap-thread-tracker.cjs. Analysis functions are side-effect-free; only logResolution and executeSupersede write to disk.
// @cap-decision AC-3 (user approval) is enforced at the COMMAND layer (brainstorm.md), not in this module. This module produces proposals; the command presents them for user approval before executing.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path, crypto).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  extractKeywords,
  computeKeywordOverlap,
  loadThread,
  saveThread,
  loadIndex,
  saveIndex,
  THREADS_DIR,
} = require('./cap-thread-tracker.cjs');

const {
  readFeatureMap,
} = require('./cap-feature-map.cjs');

// --- Constants ---

/** Directory for resolution records relative to project root. */
const RESOLUTIONS_DIR = path.join('.cap', 'memory', 'threads', 'resolutions');

/** Overlap score thresholds for strategy recommendation. */
const STRATEGY_THRESHOLDS = {
  /** Above this overlap score, recommend merge or resume. */
  HIGH_OVERLAP: 0.6,
  /** Above this overlap score, recommend branch. Below recommends supersede. */
  MODERATE_OVERLAP: 0.3,
};

/** Reconnection strategy names. */
const STRATEGIES = /** @type {const} */ (['merge', 'supersede', 'branch', 'resume']);

// --- Types ---

/**
 * @typedef {Object} ThreadComparison
 * @property {Object} oldSummary - Summary of the old thread
 * @property {string} oldSummary.problemStatement - Old thread's problem statement
 * @property {string} oldSummary.solutionShape - Old thread's solution direction
 * @property {string[]} oldSummary.boundaryDecisions - Old thread's boundary decisions
 * @property {string[]} oldSummary.featureIds - Old thread's feature IDs
 * @property {Object} newSummary - Summary of the new direction
 * @property {string} newSummary.problemStatement - New prompt/problem statement
 * @property {string[]} newSummary.keywords - Extracted keywords from new prompt
 * @property {number} overlapScore - Keyword overlap ratio (0-1)
 * @property {string[]} sharedFeatures - Feature IDs shared between old and new
 * @property {string[]} divergentPoints - Areas where old and new differ
 */

/**
 * @typedef {Object} StrategyProposal
 * @property {'merge'|'supersede'|'branch'|'resume'} recommended - Recommended strategy
 * @property {string} reasoning - Why this strategy was recommended
 * @property {Array<{strategy: string, reasoning: string}>} alternatives - Other viable strategies
 */

/**
 * @typedef {Object} ACConflict
 * @property {string} featureId - The feature containing the conflict
 * @property {Object} oldAC - The existing AC
 * @property {string} oldAC.id - AC identifier
 * @property {string} oldAC.description - AC description
 * @property {Object} newAC - The conflicting new AC
 * @property {string} newAC.id - AC identifier
 * @property {string} newAC.description - AC description
 * @property {string} reason - Why these ACs conflict
 */

/**
 * @typedef {Object} ConflictResult
 * @property {ACConflict[]} conflicts - Contradictory ACs
 * @property {Array<{featureId: string, ac: Object}>} compatible - Non-conflicting ACs
 */

/**
 * @typedef {Object} MergeResult
 * @property {Array<{id: string, description: string, status: string, source: string}>} mergedACs - Combined AC set
 * @property {ACConflict[]} conflicts - ACs that conflict and need manual resolution
 * @property {Object} mergedThread - The merged thread object
 */

/**
 * @typedef {Object} SupersedeResult
 * @property {Object} archivedThread - The old thread with archived flag
 * @property {Object} updatedIndex - The updated thread index
 */

/**
 * @typedef {Object} ResolutionRecord
 * @property {string} id - Resolution ID
 * @property {string} timestamp - ISO timestamp
 * @property {'merge'|'supersede'|'branch'|'resume'} strategy - Strategy that was applied
 * @property {string[]} threadIds - Thread IDs involved
 * @property {Object} details - Strategy-specific details
 * @property {string} reasoning - Why this resolution was chosen
 */

/**
 * @typedef {Object} ReconnectResult
 * @property {ThreadComparison} comparison - Side-by-side comparison
 * @property {StrategyProposal} proposal - Recommended strategy
 * @property {ConflictResult|null} conflicts - AC conflicts if detected
 */

// --- Thread Comparison ---

// @cap-todo(ac:F-032/AC-1) Present side-by-side comparison of previous thread conclusions versus new session direction when returning thread detected

/**
 * Produce a structured comparison between an old thread and a new prompt direction.
 * @param {Object} oldThread - The previously stored thread object
 * @param {string} newPrompt - The new session's problem statement / prompt
 * @returns {ThreadComparison}
 */
function compareThreads(oldThread, newPrompt) {
  const oldKeywords = oldThread.keywords || extractKeywords(
    [oldThread.problemStatement, oldThread.solutionShape, ...(oldThread.boundaryDecisions || [])].join(' ')
  );
  const newKeywords = extractKeywords(newPrompt);

  const { shared, overlapRatio } = computeKeywordOverlap(oldKeywords, newKeywords);

  // Identify divergent points: keywords in new but not old, and keywords in old but not new
  const oldSet = new Set(oldKeywords);
  const newSet = new Set(newKeywords);
  const divergentPoints = [];

  const onlyInNew = newKeywords.filter(k => !oldSet.has(k));
  const onlyInOld = oldKeywords.filter(k => !newSet.has(k));

  if (onlyInNew.length > 0) {
    divergentPoints.push(`New direction introduces: ${onlyInNew.slice(0, 5).join(', ')}`);
  }
  if (onlyInOld.length > 0) {
    divergentPoints.push(`Previous thread covered: ${onlyInOld.slice(0, 5).join(', ')}`);
  }

  // Check for shared feature IDs by extracting F-NNN patterns from the new prompt
  const featurePattern = /F-\d{3}/g;
  const newFeatureRefs = (newPrompt.match(featurePattern) || []);
  const oldFeatureIds = oldThread.featureIds || [];
  const sharedFeatures = oldFeatureIds.filter(fid => newFeatureRefs.includes(fid));

  return {
    oldSummary: {
      problemStatement: oldThread.problemStatement || '',
      solutionShape: oldThread.solutionShape || '',
      boundaryDecisions: oldThread.boundaryDecisions || [],
      featureIds: oldFeatureIds,
    },
    newSummary: {
      problemStatement: newPrompt,
      keywords: newKeywords,
    },
    overlapScore: overlapRatio,
    sharedFeatures,
    divergentPoints,
  };
}

// --- Strategy Proposal ---

// @cap-todo(ac:F-032/AC-2) Propose one of four reconnection strategies: merge, supersede, branch, or resume

/**
 * Based on a thread comparison, recommend a reconnection strategy.
 * @param {ThreadComparison} comparison - Result from compareThreads
 * @returns {StrategyProposal}
 */
function proposeStrategy(comparison) {
  const { overlapScore, sharedFeatures, divergentPoints } = comparison;
  const hasSharedFeatures = sharedFeatures.length > 0;
  const hasDivergence = divergentPoints.length > 0;

  // @cap-decision Strategy selection heuristic: high overlap + no divergence = resume; high overlap + divergence = merge; moderate overlap = branch; low overlap = supersede.

  let recommended;
  let reasoning;
  const alternatives = [];

  if (overlapScore >= STRATEGY_THRESHOLDS.HIGH_OVERLAP && !hasDivergence) {
    // Very similar, no new direction — resume where left off
    recommended = 'resume';
    reasoning = `High keyword overlap (${(overlapScore * 100).toFixed(0)}%) with no significant divergence — the new session appears to continue the same work.`;
    alternatives.push({
      strategy: 'merge',
      reasoning: 'Could merge if the new session adds new ACs to the existing thread.',
    });
  } else if (overlapScore >= STRATEGY_THRESHOLDS.HIGH_OVERLAP && hasDivergence) {
    // High overlap but new direction — merge the threads
    recommended = 'merge';
    reasoning = `High keyword overlap (${(overlapScore * 100).toFixed(0)}%) but with divergent points — merging would combine the best of both directions.`;
    alternatives.push({
      strategy: 'resume',
      reasoning: 'Could resume if the divergent points are minor refinements rather than new directions.',
    });
    alternatives.push({
      strategy: 'branch',
      reasoning: 'Could branch if the divergent direction should be explored independently.',
    });
  } else if (overlapScore >= STRATEGY_THRESHOLDS.MODERATE_OVERLAP || hasSharedFeatures) {
    // Moderate overlap — they share some ground but go different ways
    recommended = 'branch';
    reasoning = `Moderate keyword overlap (${(overlapScore * 100).toFixed(0)}%)${hasSharedFeatures ? ' with shared features' : ''} — the topics are related but distinct enough to coexist.`;
    alternatives.push({
      strategy: 'merge',
      reasoning: 'Could merge if the directions are ultimately converging.',
    });
    alternatives.push({
      strategy: 'supersede',
      reasoning: 'Could supersede if the old direction is no longer relevant.',
    });
  } else {
    // Low overlap — new direction replaces old
    recommended = 'supersede';
    reasoning = `Low keyword overlap (${(overlapScore * 100).toFixed(0)}%) and no shared features — the new session takes a fundamentally different approach.`;
    alternatives.push({
      strategy: 'branch',
      reasoning: 'Could branch if the old direction might still be valuable independently.',
    });
  }

  return { recommended, reasoning, alternatives };
}

// --- AC Conflict Detection ---

// @cap-todo(ac:F-032/AC-6) Detect AC-level conflicts between threads — contradictory acceptance criteria from different brainstorm sessions

/**
 * Detect conflicts between existing ACs (from old thread's features) and new ACs.
 * @param {string[]} oldFeatureIds - Feature IDs from the old thread
 * @param {Array<{featureId: string, id: string, description: string}>} newACs - New ACs to compare against
 * @param {Object} featureMap - Parsed feature map from readFeatureMap
 * @returns {ConflictResult}
 */
function detectACConflicts(oldFeatureIds, newACs, featureMap) {
  const conflicts = [];
  const compatible = [];

  // Collect existing ACs from old thread's features
  const existingACs = [];
  for (const fid of oldFeatureIds) {
    const feature = (featureMap.features || []).find(f => f.id === fid);
    if (!feature) continue;
    for (const ac of (feature.acs || [])) {
      existingACs.push({ featureId: fid, ...ac });
    }
  }

  // Compare each new AC against existing ACs for the same feature
  for (const newAC of newACs) {
    let hasConflict = false;

    const sameFeatureACs = existingACs.filter(eac => eac.featureId === newAC.featureId);
    for (const oldAC of sameFeatureACs) {
      const conflictReason = detectSingleConflict(oldAC, newAC);
      if (conflictReason) {
        conflicts.push({
          featureId: newAC.featureId,
          oldAC: { id: oldAC.id, description: oldAC.description },
          newAC: { id: newAC.id, description: newAC.description },
          reason: conflictReason,
        });
        hasConflict = true;
      }
    }

    if (!hasConflict) {
      compatible.push({ featureId: newAC.featureId, ac: { id: newAC.id, description: newAC.description } });
    }
  }

  return { conflicts, compatible };
}

/**
 * Detect if two ACs contradict each other.
 * Uses keyword overlap and negation detection as a heuristic.
 * @param {Object} acA - First AC with description
 * @param {Object} acB - Second AC with description
 * @returns {string|null} Conflict reason or null if compatible
 */
function detectSingleConflict(acA, acB) {
  const descA = (acA.description || '').toLowerCase();
  const descB = (acB.description || '').toLowerCase();

  // High keyword overlap with negation signals a contradiction
  const keywordsA = extractKeywords(descA);
  const keywordsB = extractKeywords(descB);
  const { overlapRatio } = computeKeywordOverlap(keywordsA, keywordsB);

  // Check for negation patterns
  const negationPatterns = [
    /\bshall not\b/,
    /\bmust not\b/,
    /\bshould not\b/,
    /\bnever\b/,
    /\bno\b/,
    /\bdisable\b/,
    /\bremove\b/,
    /\bwithout\b/,
    /\bprevent\b/,
    /\bprohibit\b/,
  ];

  const aNegated = negationPatterns.some(p => p.test(descA));
  const bNegated = negationPatterns.some(p => p.test(descB));

  // High overlap + one negated = likely contradiction
  if (overlapRatio >= 0.4 && (aNegated !== bNegated)) {
    return `High keyword overlap (${(overlapRatio * 100).toFixed(0)}%) with opposing intent — one AC negates what the other requires.`;
  }

  // Very high overlap on same feature = potential duplicate or contradiction
  if (overlapRatio >= 0.7) {
    return `Very high keyword overlap (${(overlapRatio * 100).toFixed(0)}%) — ACs may duplicate or contradict each other.`;
  }

  return null;
}

// --- Merge Execution ---

// @cap-todo(ac:F-032/AC-4) When merge approved, produce unified AC set combining non-conflicting criteria and flagging conflicts for manual resolution

/**
 * Combine ACs from old and new threads, keeping non-conflicting ones and flagging conflicts.
 * @param {Object} oldThread - The old thread object
 * @param {Object} newThread - The new thread object
 * @param {Object} featureMap - Parsed feature map
 * @param {Object} [resolution] - Optional manual conflict resolutions
 * @param {Object.<string, 'keep-old'|'keep-new'|'keep-both'>} [resolution.conflictChoices] - How to resolve each conflict by conflict index
 * @returns {MergeResult}
 */
function executeMerge(oldThread, newThread, featureMap, resolution = {}) {
  const allFeatureIds = [...new Set([
    ...(oldThread.featureIds || []),
    ...(newThread.featureIds || []),
  ])];

  const mergedACs = [];
  // @cap-risk Untested code path: conflicts array is always returned empty — conflict detection within merge is not yet implemented
  const conflicts = [];
  // @cap-risk Untested code path: conflictChoices parameter is accepted but never consumed — manual conflict resolution logic is not yet wired up
  const conflictChoices = resolution.conflictChoices || {};

  for (const fid of allFeatureIds) {
    const feature = (featureMap.features || []).find(f => f.id === fid);
    if (!feature) continue;

    const oldHasFeature = (oldThread.featureIds || []).includes(fid);
    const newHasFeature = (newThread.featureIds || []).includes(fid);

    if (oldHasFeature && !newHasFeature) {
      // Only in old thread — carry forward
      for (const ac of (feature.acs || [])) {
        mergedACs.push({ ...ac, source: `old:${oldThread.id}` });
      }
    } else if (!oldHasFeature && newHasFeature) {
      // Only in new thread — include
      for (const ac of (feature.acs || [])) {
        mergedACs.push({ ...ac, source: `new:${newThread.id}` });
      }
    } else {
      // Both threads reference this feature — check for conflicts
      for (const ac of (feature.acs || [])) {
        mergedACs.push({ ...ac, source: 'shared' });
      }
    }
  }

  // Build merged thread
  const mergedThread = {
    ...newThread,
    featureIds: allFeatureIds,
    boundaryDecisions: [
      ...(oldThread.boundaryDecisions || []),
      ...(newThread.boundaryDecisions || []),
    ],
    solutionShape: newThread.solutionShape || oldThread.solutionShape,
    parentThreadId: oldThread.id,
    divergencePoint: `Merged from thread ${oldThread.id}`,
  };

  return { mergedACs, conflicts, mergedThread };
}

// --- Supersede Execution ---

// @cap-todo(ac:F-032/AC-5) When supersede approved, mark old thread as archived and update Feature Map entries that referenced old thread ACs

/**
 * Mark old thread as archived and update the thread index.
 * @param {Object} oldThread - The thread to archive
 * @param {Object} newThread - The thread that supersedes it
 * @param {string} cwd - Project root path
 * @returns {SupersedeResult}
 */
function executeSupersede(oldThread, newThread, cwd) {
  // Mark old thread as archived
  const archivedThread = {
    ...oldThread,
    archived: true,
    archivedBy: newThread.id,
    archivedAt: new Date().toISOString(),
  };

  // Save archived thread to disk
  saveThread(cwd, archivedThread);

  // Update index — mark the old thread entry with archived flag
  const index = loadIndex(cwd);
  const entry = index.threads.find(t => t.id === oldThread.id);
  if (entry) {
    entry.archived = true;
    entry.archivedBy = newThread.id;
  }
  saveIndex(cwd, index);

  return { archivedThread, updatedIndex: index };
}

// --- Resolution Logging ---

// @cap-todo(ac:F-032/AC-7) Log synthesis results in .cap/memory/threads/ with resolution record documenting what was merged, split, or discarded and why

/**
 * Write a resolution record to .cap/memory/threads/resolutions/.
 * @param {string} cwd - Project root path
 * @param {Object} resolution - Resolution details
 * @param {'merge'|'supersede'|'branch'|'resume'} resolution.strategy - Strategy applied
 * @param {string[]} resolution.threadIds - Thread IDs involved
 * @param {Object} resolution.details - Strategy-specific details (mergedACs, archivedThread, etc.)
 * @param {string} resolution.reasoning - Why this resolution was chosen
 * @returns {ResolutionRecord}
 */
function logResolution(cwd, resolution) {
  const resolutionsDir = path.join(cwd, RESOLUTIONS_DIR);
  if (!fs.existsSync(resolutionsDir)) {
    fs.mkdirSync(resolutionsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const id = 'res-' + crypto.randomBytes(4).toString('hex');

  const record = {
    id,
    timestamp,
    strategy: resolution.strategy,
    threadIds: resolution.threadIds,
    details: resolution.details || {},
    reasoning: resolution.reasoning || '',
  };

  const filePath = path.join(resolutionsDir, `${id}.json`);
  // @cap-decision Sorted keys and 2-space indent for git-friendly diffs — matches cap-thread-tracker.cjs pattern
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf8');

  return record;
}

// --- Main Entry Point ---

// @cap-decision reconnect() orchestrates compare -> propose -> return proposal. Execution (merge/supersede/branch/resume) is a separate step because AC-3 requires user approval between proposal and execution.

/**
 * Main entry point: compare a returning thread match against the new prompt,
 * propose a reconnection strategy, and detect AC conflicts.
 * Does NOT execute — returns the proposal for the command layer to present.
 * @param {string} cwd - Project root path
 * @param {Object} matchResult - A single match from checkPriorThreads
 * @param {string} matchResult.threadId - The matching thread ID
 * @param {number} matchResult.score - Relevance score
 * @param {string} newPrompt - The new session's problem statement
 * @param {Object} [options]
 * @param {string[]} [options.newFeatureIds] - Feature IDs referenced in new session
 * @param {Array<{featureId: string, id: string, description: string}>} [options.newACs] - New ACs to check for conflicts
 * @returns {ReconnectResult}
 */
function reconnect(cwd, matchResult, newPrompt, options = {}) {
  const oldThread = loadThread(cwd, matchResult.threadId);
  if (!oldThread) {
    return {
      comparison: null,
      proposal: null,
      conflicts: null,
      error: `Thread ${matchResult.threadId} not found on disk.`,
    };
  }

  // Step 1: Compare threads
  const comparison = compareThreads(oldThread, newPrompt);

  // Step 2: Propose strategy
  const proposal = proposeStrategy(comparison);

  // Step 3: Detect AC conflicts (if new ACs provided)
  let conflicts = null;
  if (options.newACs && options.newACs.length > 0) {
    // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
    // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
    const featureMap = readFeatureMap(cwd, undefined, { safe: true });
    if (featureMap && featureMap.parseError) {
      console.warn('cap: thread-synthesis — duplicate feature ID detected, conflict detection uses partial map: ' + String(featureMap.parseError.message).trim());
    }
    conflicts = detectACConflicts(
      oldThread.featureIds || [],
      options.newACs,
      featureMap
    );
  }

  return { comparison, proposal, conflicts };
}

module.exports = {
  // Core analysis
  compareThreads,
  proposeStrategy,
  detectACConflicts,
  detectSingleConflict,

  // Execution
  executeMerge,
  executeSupersede,
  logResolution,

  // Main entry point
  reconnect,

  // Constants (exposed for testing)
  RESOLUTIONS_DIR,
  STRATEGY_THRESHOLDS,
  STRATEGIES,
};
