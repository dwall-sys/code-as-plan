// @cap-context CAP v2.0 status drift reconciliation -- one-shot tool that cleans up historical
// AC-status drift introduced before F-041 (parser bug) and F-042 (state-transition propagation)
// were merged. Combines two reconciliation phases plus a verification phase.
// @cap-decision Dry-run is the DEFAULT mode for safety. The reconciliation rewrites FEATURE-MAP.md
// in place once the user passes --apply, so a no-op preview that shows every proposed change is the
// correct safety net. Confirmation prompt is a second guard before any write.
// @cap-decision Phase 2 heuristic for state-from-code-presence is two-step: (1) collect impl files
// from @cap-feature tags grouped by feature ID, then (2) for each impl file check the filesystem
// for a sibling test file (basename + .test.<ext>) under tests/. If both impl and test exist
// propose 'tested', if only impl exists propose 'prototyped'. Filesystem check is required because
// test files in this project do NOT carry @cap-feature tags (test framework detects implementation
// via filename convention, not annotations). Lifecycle definition is in CLAUDE.md
// (planned -> prototyped -> tested -> shipped).
// @cap-decision Mirror-directory dedup: the project keeps cap/bin/lib/*.cjs mirrored at
// .claude/cap/bin/lib/*.cjs. The tag scan returns BOTH copies. Phase 2 dedupes by basename so a
// feature with one canonical impl + one mirror does not appear as "two impl files".
// @cap-decision F-043 (this feature) is excluded from Phase 2 because the user explicitly requires
// it to remain in the developer's hands -- promoting F-043 to prototyped via its own reconciliation
// run would be a circular self-promotion that masks intent.
// @cap-constraint Zero external dependencies. Uses only Node.js built-ins (fs, path, readline).

'use strict';

// @cap-feature(feature:F-043) Reconcile Status Drift in Existing Feature Map -- one-shot module that
// proposes, prints, and (with --apply) commits the AC-status and feature-state corrections needed
// to bring FEATURE-MAP.md back in sync with the implementation reality.

const fs = require('node:fs');
const path = require('node:path');

const featureMap = require('./cap-feature-map.cjs');
const tagScanner = require('./cap-tag-scanner.cjs');

const AUDIT_LOG_RELATIVE = path.join('.cap', 'memory', 'reconciliation-2026-04.md');

// Test-file detection is intentionally simple — basename suffix check. Avoids depending on
// test-detector.cjs (which uses package.json heuristics) and keeps Phase 2 self-contained.
const TEST_FILE_SUFFIXES = ['.test.cjs', '.test.js', '.test.mjs', '.test.ts', '.test.tsx'];

// Test directory candidates checked when probing the filesystem for a sibling test file.
// Order matters: the most common location wins.
const TEST_DIR_CANDIDATES = ['tests', 'test', '__tests__'];

// Mirror directory prefix that is treated as a duplicate of the canonical cap/ tree.
// Files seen here are folded into their cap/-rooted counterpart for dedup purposes.
const MIRROR_PREFIX = '.claude' + path.sep;

// Features explicitly excluded from Phase 2 (state-from-code-presence). F-043 is the
// reconciliation tool itself -- promoting it via its own reconciliation run would be a
// circular self-promotion that masks the developer's intent for the feature.
const PHASE2_EXCLUDED_FEATURES = new Set(['F-043']);

/**
 * @typedef {Object} AcChange
 * @property {string} acId - AC identifier (e.g., "AC-1")
 * @property {string} from - Previous AC status
 * @property {string} to - New AC status
 */

/**
 * @typedef {Object} Phase1Entry
 * @property {string} featureId - Feature identifier (e.g., "F-019")
 * @property {string} state - Feature state (always 'tested' or 'shipped')
 * @property {AcChange[]} acChanges - Per-AC promotions
 */

/**
 * @typedef {Object} Phase2Entry
 * @property {string} featureId - Feature identifier
 * @property {string} fromState - Previous feature state (always 'planned')
 * @property {string} toState - Proposed feature state ('prototyped' or 'tested')
 * @property {string[]} implFiles - Implementation files detected via tag scan
 * @property {string[]} testFiles - Test files detected via tag scan
 * @property {AcChange[]} propagatedAcChanges - AC promotions that follow from the state change
 */

/**
 * @typedef {Object} ReconciliationPlan
 * @property {Phase1Entry[]} phase1 - AC-status promotions for tested/shipped features
 * @property {Phase2Entry[]} phase2 - Feature-state updates for planned features with code
 * @property {number} preDriftCount - Drift count before reconciliation
 * @property {number} totalAcPromotions - Total AC mutations across both phases
 * @property {number} totalStateUpdates - Total feature-state mutations (Phase 2 only)
 * @property {number} totalChanges - totalAcPromotions + totalStateUpdates
 * @property {string} auditLogPath - Relative path to audit log target
 */

// @cap-api isTestFile(relativePath) -- internal helper for Phase 2 detection.
// Exported for the test suite so the heuristic can be exercised in isolation.
/**
 * @param {string} filePath - Relative or absolute file path
 * @returns {boolean}
 */
function isTestFile(filePath) {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return TEST_FILE_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

// @cap-api canonicalizePath(filePath) -- folds .claude/ mirror paths into their cap/ counterparts
// so dedup-by-canonical-path collapses both copies into one entry.
/**
 * @param {string} filePath - Relative file path from project root
 * @returns {string}
 */
function canonicalizePath(filePath) {
  if (!filePath) return filePath;
  if (filePath.startsWith(MIRROR_PREFIX)) {
    return filePath.slice(MIRROR_PREFIX.length);
  }
  return filePath;
}

// @cap-api groupTagsByFeatureFiles(tags) -- aggregates @cap-feature tags into per-feature impl
// file sets, deduped by canonical path so cap/ + .claude/cap/ mirror pairs collapse.
// Returns: Object<featureId, { impl: string[] }>
// @cap-decision Only @cap-feature tags are considered for Phase 2 (not @cap-todo). Implementation
// presence is signalled by an explicit feature-tagged file; @cap-todo references are too lossy
// (an AC reference in a test alone shouldn't promote the feature past 'planned').
// @cap-decision Test-file presence is NOT inferred from tags (test files in this project are
// untagged). Use detectTestFileForImpl() instead, which checks the filesystem for sibling
// test/<basename>.test.<ext> files.
/**
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} tags
 * @returns {Object<string, { impl: string[] }>}
 */
function groupTagsByFeatureFiles(tags) {
  const groups = {};
  const seen = new Set(); // dedupe by featureId+canonicalPath pair
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata && tag.metadata.feature;
    if (!featureId) continue;
    if (isTestFile(tag.file)) continue; // test files are not impl-presence signals
    const canonical = canonicalizePath(tag.file);
    const key = `${featureId}::${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!groups[featureId]) groups[featureId] = { impl: [] };
    groups[featureId].impl.push(canonical);
  }
  return groups;
}

// @cap-api detectTestFileForImpl(projectRoot, implPath) -- filesystem probe for a sibling test
// file matching the implementation file's basename. Returns the relative test path if found.
// @cap-decision Probes tests/, test/, __tests__/ at the project root in that order. The CAP
// project uses tests/ (per CLAUDE.md), but the probe is generalized so the reconciler stays
// usable in projects following other conventions.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} implPath - Canonical (cap/-rooted) impl file path
 * @returns {string|null} - Relative path to the test file, or null if none found
 */
function detectTestFileForImpl(projectRoot, implPath) {
  if (!implPath) return null;
  const ext = path.extname(implPath); // e.g. '.cjs'
  const baseName = path.basename(implPath, ext); // e.g. 'cap-memory-engine'
  // Try test extensions in the same family first (cjs->cjs, ts->ts, ...) then fall back to others.
  const matchingSuffix = TEST_FILE_SUFFIXES.find(s => s.endsWith(ext));
  const candidates = matchingSuffix
    ? [matchingSuffix, ...TEST_FILE_SUFFIXES.filter(s => s !== matchingSuffix)]
    : TEST_FILE_SUFFIXES;

  for (const dir of TEST_DIR_CANDIDATES) {
    for (const suffix of candidates) {
      const rel = path.join(dir, baseName + suffix);
      const abs = path.join(projectRoot, rel);
      if (fs.existsSync(abs)) {
        return rel;
      }
    }
  }
  return null;
}

// @cap-api planReconciliation(projectRoot) -- pure planner that returns the structured plan
// without writing anything. Safe to call repeatedly; the result is the input to formatPlan
// and executeReconciliation.
// @cap-todo(ac:F-043/AC-1) Phase 1 scans every drifting feature reported by detectDrift and
// proposes promoting each pending AC to 'tested'. Covers F-019..F-026, F-036..F-040, F-041
// in the live FEATURE-MAP.md (and any other drifting feature added later — the planner is
// derived from detectDrift, not a hard-coded ID list, so it stays correct as new drift appears).
// @cap-todo(ac:F-043/AC-3) Phase 2 walks features still in 'planned' state, intersects their
// IDs with @cap-feature tag scan results, and proposes prototyped/tested based on impl + test
// file presence. F-027/F-028/F-029/F-034 are the immediate beneficiaries.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {ReconciliationPlan}
 */
function planReconciliation(projectRoot, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
  const fm = featureMap.readFeatureMap(projectRoot, appPath, { safe: true });
  if (fm && fm.parseError) {
    console.warn('cap: reconcile — duplicate feature ID detected, plan uses partial map: ' + String(fm.parseError.message).trim());
  }
  const drift = featureMap.detectDrift(projectRoot, appPath);

  // Phase 1: AC-status promotions for shipped/tested features that still have pending ACs.
  const phase1 = [];
  let totalAcPromotions = 0;
  for (const driftEntry of drift.features) {
    const acChanges = driftEntry.pendingAcs.map(ac => ({
      acId: ac.id,
      from: 'pending',
      to: 'tested',
    }));
    if (acChanges.length === 0) continue;
    totalAcPromotions += acChanges.length;
    phase1.push({
      featureId: driftEntry.id,
      state: driftEntry.state,
      acChanges,
    });
  }

  // Phase 2: feature-state updates for planned features whose code presence implies progress.
  // @cap-todo(ac:F-043/AC-3) Tag scanner is the source of truth for impl presence; the filesystem
  // is the source of truth for test presence (test files in this project do not carry tags).
  const tagScanRoot = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const tags = tagScanner.scanDirectory(tagScanRoot, { projectRoot });
  const featureFiles = groupTagsByFeatureFiles(tags);

  const phase2 = [];
  let totalStateUpdates = 0;
  for (const feature of fm.features) {
    if (feature.state !== 'planned') continue;
    if (PHASE2_EXCLUDED_FEATURES.has(feature.id)) continue;
    const fileGroups = featureFiles[feature.id];
    if (!fileGroups || fileGroups.impl.length === 0) continue;
    const implFiles = fileGroups.impl;

    // Probe the filesystem for sibling test files.
    const testFiles = [];
    const seenTests = new Set();
    for (const impl of implFiles) {
      const test = detectTestFileForImpl(projectRoot, impl);
      if (test && !seenTests.has(test)) {
        seenTests.add(test);
        testFiles.push(test);
      }
    }

    // @cap-decision Heuristic: impl + at least one test => 'tested'; impl-only => 'prototyped'.
    const toState = testFiles.length > 0 ? 'tested' : 'prototyped';

    // Compute propagated AC changes that updateFeatureState would apply when toState === 'tested'.
    // updateFeatureState promotes pending|prototyped -> tested only on the 'tested' transition.
    const propagatedAcChanges = [];
    if (toState === 'tested') {
      for (const ac of feature.acs) {
        if (ac.status === 'pending' || ac.status === 'prototyped') {
          propagatedAcChanges.push({
            acId: ac.id,
            from: ac.status,
            to: 'tested',
          });
        }
      }
    }

    totalStateUpdates += 1;
    totalAcPromotions += propagatedAcChanges.length;

    phase2.push({
      featureId: feature.id,
      fromState: feature.state,
      toState,
      implFiles,
      testFiles,
      propagatedAcChanges,
    });
  }

  return {
    phase1,
    phase2,
    preDriftCount: drift.driftCount,
    totalAcPromotions,
    totalStateUpdates,
    totalChanges: totalAcPromotions + totalStateUpdates,
    auditLogPath: AUDIT_LOG_RELATIVE,
  };
}

// @cap-api formatPlan(plan) -- markdown-friendly preview of the plan, used by --dry-run output.
// Pure function: input plan, output string. No I/O.
/**
 * @param {ReconciliationPlan} plan
 * @returns {string}
 */
function formatPlan(plan) {
  if (!plan) return 'Status Drift Reconciliation -- no plan available.';

  const lines = [];
  lines.push('Status Drift Reconciliation -- Dry Run');
  lines.push('');

  lines.push(`Phase 1 -- AC promotion (${plan.phase1.length} features):`);
  if (plan.phase1.length === 0) {
    lines.push('  (no AC-status drift detected)');
  } else {
    for (const entry of plan.phase1) {
      lines.push(`  ${entry.featureId} [${entry.state}]: ${entry.acChanges.length} ACs pending -> tested`);
    }
  }
  lines.push('');

  lines.push(`Phase 2 -- Feature state from code presence (${plan.phase2.length} features):`);
  if (plan.phase2.length === 0) {
    lines.push('  (no planned features with detected implementation code)');
  } else {
    for (const entry of plan.phase2) {
      const implPart = entry.implFiles.length > 0
        ? `impl: ${entry.implFiles.map(f => path.basename(f)).join(', ')}`
        : 'no impl';
      const testPart = entry.testFiles.length > 0
        ? `test: ${entry.testFiles.map(f => path.basename(f)).join(', ')}`
        : 'no test';
      lines.push(`  ${entry.featureId} ${entry.fromState} -> ${entry.toState} (${implPart}, ${testPart})`);
      if (entry.propagatedAcChanges.length > 0) {
        lines.push(`    Propagates ${entry.propagatedAcChanges.length} AC promotions to 'tested'`);
      }
    }
  }
  lines.push('');

  lines.push('Phase 3 -- Post-reconciliation drift check:');
  lines.push('  Would result in driftCount: 0 (verified after --apply)');
  lines.push('');

  lines.push(`Total proposed changes: ${plan.totalChanges} (${plan.totalAcPromotions} AC promotions + ${plan.totalStateUpdates} state updates)`);
  lines.push(`Audit log target: ${plan.auditLogPath}`);
  lines.push('');
  lines.push('Run with --apply to commit changes.');

  return lines.join('\n');
}

// @cap-api lifecyclePath(from, to) -- returns the ordered list of single-step transitions that
// take a feature from `from` to `to`, or null if no path exists. Used by executeReconciliation
// to honour updateFeatureState's strict one-hop contract.
// @cap-decision Hard-codes the canonical lifecycle (planned -> prototyped -> tested -> shipped).
// Mirroring the order in cap-feature-map.STATE_TRANSITIONS would couple the two modules through
// graph-walking; the lifecycle is short and stable, so a literal list is clearer.
/**
 * @param {string} from - Source lifecycle state
 * @param {string} to - Target lifecycle state
 * @returns {string[]|null} - Ordered transitions (excluding `from`), or null if `to` precedes `from`
 */
function lifecyclePath(from, to) {
  const order = ['planned', 'prototyped', 'tested', 'shipped'];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return null;
  if (toIdx < fromIdx) return null;
  if (toIdx === fromIdx) return [];
  return order.slice(fromIdx + 1, toIdx + 1);
}

// @cap-api executeReconciliation(projectRoot, plan) -- mutates FEATURE-MAP.md per the plan.
// Side effects: rewrites FEATURE-MAP.md, writes audit log, runs detectDrift verification.
// Returns: { success, postDriftCount, auditLogPath, error? }
// @cap-todo(ac:F-043/AC-2) Caller is responsible for confirming with the user before invoking this
// function. The function itself does NOT prompt -- that is the CLI orchestrator's job (see
// commands/cap/reconcile.md). This separation keeps the module pure and unit-testable.
// @cap-todo(ac:F-043/AC-4) Audit log emission is part of execute, not plan -- the file content
// records the actual changes that were committed (with timestamp), not a hypothetical preview.
// @cap-todo(ac:F-043/AC-5) Final detectDrift call validates that the plan brought drift to zero.
// If drift remains the function reports the failure (does NOT roll back, since FEATURE-MAP.md
// is already source-controlled and the user can revert via git).
// @cap-risk Partial-failure rollback is NOT attempted. Each setAcStatus / updateFeatureState call
// writes to disk. If the process is killed mid-execution the Feature Map will be partially
// reconciled. Mitigation: git makes recovery one `git checkout -- FEATURE-MAP.md` away, and the
// audit log records exactly what was applied before the crash.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {ReconciliationPlan} plan - Plan returned by planReconciliation
 * @param {Object} [options]
 * @param {string|null} [options.appPath=null] - Relative app path
 * @param {boolean} [options.skipAuditLog=false] - Suppress audit log emission (used by tests)
 * @param {string} [options.timestamp] - Override timestamp (used by tests for determinism)
 * @returns {{ success: boolean, postDriftCount: number, auditLogPath: string|null, error?: string }}
 */
function executeReconciliation(projectRoot, plan, options = {}) {
  const appPath = options.appPath || null;
  const skipAuditLog = Boolean(options.skipAuditLog);
  const timestamp = options.timestamp || new Date().toISOString();

  if (!plan) {
    return { success: false, postDriftCount: -1, auditLogPath: null, error: 'No plan provided' };
  }

  // Phase 1: per-AC promotions via setAcStatus.
  for (const entry of plan.phase1) {
    for (const change of entry.acChanges) {
      const ok = featureMap.setAcStatus(projectRoot, entry.featureId, change.acId, change.to, appPath);
      if (!ok) {
        return {
          success: false,
          postDriftCount: -1,
          auditLogPath: null,
          error: `setAcStatus failed for ${entry.featureId}/${change.acId}`,
        };
      }
    }
  }

  // Phase 2: feature-state transitions via updateFeatureState. Because the lifecycle only
  // permits one-step transitions (planned -> prototyped -> tested -> shipped), we step through
  // intermediate states when the target is more than one hop away. AC propagation happens
  // automatically on the 'tested' hop.
  // @cap-todo(ac:F-043/AC-3) Honour the strict one-step state transition contract enforced
  // by updateFeatureState by walking the lifecycle path explicitly.
  for (const entry of plan.phase2) {
    const path2 = lifecyclePath(entry.fromState, entry.toState);
    if (path2 === null) {
      return {
        success: false,
        postDriftCount: -1,
        auditLogPath: null,
        error: `no lifecycle path from ${entry.fromState} to ${entry.toState} for ${entry.featureId}`,
      };
    }
    for (const nextState of path2) {
      const ok = featureMap.updateFeatureState(projectRoot, entry.featureId, nextState, appPath);
      if (!ok) {
        return {
          success: false,
          postDriftCount: -1,
          auditLogPath: null,
          error: `updateFeatureState failed for ${entry.featureId} -> ${nextState}`,
        };
      }
    }
  }

  // Phase 3: verify drift is now zero.
  const postDrift = featureMap.detectDrift(projectRoot, appPath);

  // Audit log written even if verification fails — the user needs the record either way.
  let auditLogPath = null;
  if (!skipAuditLog) {
    try {
      auditLogPath = writeAuditLog(projectRoot, plan, postDrift.driftCount, timestamp);
    } catch (e) {
      return {
        success: false,
        postDriftCount: postDrift.driftCount,
        auditLogPath: null,
        error: `audit log write failed: ${e.message}`,
      };
    }
  }

  if (postDrift.driftCount > 0) {
    return {
      success: false,
      postDriftCount: postDrift.driftCount,
      auditLogPath,
      error: `Reconciliation incomplete: ${postDrift.driftCount} drift entries remain`,
    };
  }

  return {
    success: true,
    postDriftCount: 0,
    auditLogPath,
  };
}

// @cap-api writeAuditLog(projectRoot, plan, postDriftCount, timestamp) -- emits the markdown
// audit log to .cap/memory/reconciliation-2026-04.md.
// @cap-decision Audit log file name is fixed (reconciliation-2026-04.md) per the AC-4 spec.
// Re-running reconciliation will overwrite the file -- intentional, since the file is meant to
// record the *successful* run that brought drift to zero, not a per-invocation history.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {ReconciliationPlan} plan
 * @param {number} postDriftCount - Drift count after reconciliation (0 on success)
 * @param {string} timestamp - ISO timestamp string for the run
 * @returns {string} - Relative path to the audit log
 */
function writeAuditLog(projectRoot, plan, postDriftCount, timestamp) {
  const logDir = path.join(projectRoot, '.cap', 'memory');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const lines = [];
  lines.push('# Status Drift Reconciliation Audit');
  lines.push('');
  lines.push(`**Date:** ${timestamp}`);
  lines.push('**Trigger:** Manual `cap reconcile --apply`');
  lines.push(`**Total changes:** ${plan.totalChanges}`);
  lines.push('');

  lines.push('## Phase 1 -- AC Promotions');
  lines.push('');
  if (plan.phase1.length === 0) {
    lines.push('_No AC-status drift detected._');
    lines.push('');
  } else {
    for (const entry of plan.phase1) {
      lines.push(`### ${entry.featureId} (${entry.state})`);
      for (const change of entry.acChanges) {
        lines.push(`- ${change.acId}: ${change.from} -> ${change.to}`);
      }
      lines.push('');
    }
  }

  lines.push('## Phase 2 -- Feature State Updates');
  lines.push('');
  if (plan.phase2.length === 0) {
    lines.push('_No planned features required state updates._');
    lines.push('');
  } else {
    for (const entry of plan.phase2) {
      lines.push(`### ${entry.featureId} ${entry.fromState} -> ${entry.toState}`);
      for (const f of entry.implFiles) {
        lines.push(`- Reason: implementation file detected (\`${path.basename(f)}\`)`);
      }
      for (const f of entry.testFiles) {
        lines.push(`- Reason: test file detected (\`${path.basename(f)}\`)`);
      }
      if (entry.toState === 'prototyped' && entry.testFiles.length === 0) {
        lines.push('- Reason: no test file detected -- state capped at prototyped');
      }
      if (entry.propagatedAcChanges.length > 0) {
        const acIds = entry.propagatedAcChanges.map(c => c.acId).join(', ');
        lines.push(`- Propagated AC promotions: ${acIds} -> tested`);
      }
      lines.push('');
    }
  }

  lines.push('## Phase 3 -- Verification');
  lines.push('');
  lines.push(`- Pre-reconciliation drift count: ${plan.preDriftCount}`);
  lines.push(`- Post-reconciliation drift count: ${postDriftCount}`);
  if (postDriftCount === 0) {
    lines.push('- Result: All drift resolved');
  } else {
    lines.push(`- Result: ${postDriftCount} drift entries remain -- inspect FEATURE-MAP.md`);
  }
  lines.push('');

  const filePath = path.join(projectRoot, AUDIT_LOG_RELATIVE);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return AUDIT_LOG_RELATIVE;
}

module.exports = {
  AUDIT_LOG_RELATIVE,
  TEST_FILE_SUFFIXES,
  TEST_DIR_CANDIDATES,
  PHASE2_EXCLUDED_FEATURES,
  isTestFile,
  canonicalizePath,
  groupTagsByFeatureFiles,
  detectTestFileForImpl,
  lifecyclePath,
  planReconciliation,
  formatPlan,
  executeReconciliation,
  writeAuditLog,
};
