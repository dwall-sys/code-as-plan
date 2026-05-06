// @cap-feature(feature:F-033) Implement Feature Impact Analysis — detect overlap between proposed features and existing Feature Map entries, trace dependency chains, detect circular deps, propose resolutions
// @cap-decision AC-2 (auto-run during brainstorm) is enforced at the COMMAND layer (brainstorm.md), not in this module. This module exposes analyzeImpact() which the command calls before proposing new Feature Map entries.
// @cap-decision AC-6 (advisory only) — this module NEVER calls writeFeatureMap(). All proposals are returned as structured data for the caller to present. No Feature Map modifications, dependency reordering, or AC adjustments happen without explicit user approval.
// @cap-decision Pure logic module with explicit I/O for persistence — analysis functions are side-effect-free; only persistReport() writes to disk.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  readFeatureMap,
} = require('./cap-feature-map.cjs');

const {
  extractKeywords,
  computeKeywordOverlap,
} = require('./cap-thread-tracker.cjs');

// --- Constants ---

/** Directory for impact analysis reports relative to project root. */
const IMPACT_DIR = path.join('.cap', 'memory', 'impact');

/** Minimum Jaccard similarity (0-1) for two ACs to be considered overlapping. */
const AC_SIMILARITY_THRESHOLD = 0.25;

/** Minimum number of shared keywords for AC overlap to count. */
const AC_MIN_SHARED_KEYWORDS = 2;

/** Minimum file path overlap ratio (0-1) for a file conflict to be reported. */
const FILE_OVERLAP_THRESHOLD = 0.1;

// --- Types ---

/**
 * @typedef {Object} ACOverlap
 * @property {string} existingFeatureId - ID of the existing feature
 * @property {string} existingFeatureTitle - Title of the existing feature
 * @property {string} existingACId - ID of the existing AC
 * @property {string} existingACDescription - Description of the existing AC
 * @property {string} proposedACId - ID of the proposed AC
 * @property {string} proposedACDescription - Description of the proposed AC
 * @property {number} similarity - Jaccard similarity score (0-1)
 * @property {string[]} sharedKeywords - Keywords shared between the two ACs
 * @property {string} reason - Human-readable explanation of the overlap
 */

/**
 * @typedef {Object} DependencyChain
 * @property {string[]} upstream - Feature IDs that the target depends on (transitively)
 * @property {string[]} downstream - Feature IDs that depend on the target (transitively)
 * @property {number} depth - Maximum traversal depth reached
 */

/**
 * @typedef {Object} CircularDepResult
 * @property {boolean} hasCycle - Whether a cycle was detected
 * @property {string[]} cycle - The cycle path as feature IDs (e.g., ["F-001", "F-003", "F-001"])
 */

/**
 * @typedef {Object} FileConflict
 * @property {string} filePath - The conflicting file path
 * @property {string[]} existingFeatureIds - Features already referencing this file
 */

/**
 * @typedef {Object} Resolution
 * @property {'merge'|'split'|'adjust'|'flag'} type - Resolution type
 * @property {string} description - Human-readable description of the proposed resolution
 * @property {string[]} affectedFeatures - Feature IDs involved in this resolution
 */

/**
 * @typedef {Object} ImpactReport
 * @property {string} proposedFeatureTitle - Title of the proposed feature
 * @property {string} timestamp - ISO timestamp when the report was generated
 * @property {ACOverlap[]} overlappingACs - AC-level overlaps found
 * @property {DependencyChain} affectedChains - Dependency chain analysis
 * @property {FileConflict[]} fileConflicts - File path conflicts
 * @property {CircularDepResult} circularRisks - Circular dependency analysis
 * @property {Resolution[]} resolutions - Proposed resolutions
 */

// --- AC Overlap Detection ---

// @cap-todo(ac:F-033/AC-1) Detect overlap between proposed feature and existing Feature Map entries by comparing AC descriptions, dependency chains, and referenced file paths

/**
 * Detect overlapping ACs between a proposed feature and existing features.
 * Uses keyword extraction + Jaccard similarity for AC description matching
 * and file path overlap detection.
 *
 * @param {import('./cap-feature-map.cjs').Feature} proposedFeature - The proposed feature
 * @param {import('./cap-feature-map.cjs').Feature[]} existingFeatures - All existing features
 * @param {Object} [options]
 * @param {number} [options.similarityThreshold] - Override AC similarity threshold
 * @param {number} [options.minSharedKeywords] - Override minimum shared keywords
 * @returns {{ overlaps: ACOverlap[], fileConflicts: FileConflict[] }}
 */
function detectOverlap(proposedFeature, existingFeatures, options = {}) {
  const {
    similarityThreshold = AC_SIMILARITY_THRESHOLD,
    minSharedKeywords = AC_MIN_SHARED_KEYWORDS,
  } = options;

  const overlaps = [];
  const fileConflicts = [];

  // --- AC description overlap ---
  const proposedACs = proposedFeature.acs || [];

  for (const proposedAC of proposedACs) {
    const proposedKeywords = extractKeywords(proposedAC.description);
    if (proposedKeywords.length === 0) continue;

    for (const existing of existingFeatures) {
      // Skip self-comparison
      if (existing.id === proposedFeature.id) continue;

      for (const existingAC of existing.acs || []) {
        const existingKeywords = extractKeywords(existingAC.description);
        if (existingKeywords.length === 0) continue;

        const { shared, overlapRatio } = computeKeywordOverlap(proposedKeywords, existingKeywords);

        if (overlapRatio >= similarityThreshold && shared.length >= minSharedKeywords) {
          overlaps.push({
            existingFeatureId: existing.id,
            existingFeatureTitle: existing.title,
            existingACId: existingAC.id,
            existingACDescription: existingAC.description,
            proposedACId: proposedAC.id,
            proposedACDescription: proposedAC.description,
            similarity: Math.round(overlapRatio * 1000) / 1000,
            sharedKeywords: shared,
            reason: `Shared keywords: ${shared.join(', ')} (Jaccard: ${(overlapRatio * 100).toFixed(1)}%)`,
          });
        }
      }
    }
  }

  // --- File path overlap ---
  const proposedFiles = new Set(proposedFeature.files || []);
  if (proposedFiles.size > 0) {
    /** @type {Map<string, string[]>} filePath -> featureIds */
    const fileOwners = new Map();
    for (const existing of existingFeatures) {
      if (existing.id === proposedFeature.id) continue;
      for (const file of existing.files || []) {
        if (!fileOwners.has(file)) fileOwners.set(file, []);
        fileOwners.get(file).push(existing.id);
      }
    }

    for (const file of proposedFiles) {
      const owners = fileOwners.get(file);
      if (owners && owners.length > 0) {
        fileConflicts.push({
          filePath: file,
          existingFeatureIds: [...owners],
        });
      }
    }
  }

  return { overlaps, fileConflicts };
}

// --- Dependency Chain Tracing ---

// @cap-todo(ac:F-033/AC-4) Trace full dependency chains — if A depends on B depends on C, changing B ACs shall surface impact on both A and C

/**
 * Trace full dependency chain for a feature in both directions.
 * Given a feature, finds all upstream dependencies (things it depends on)
 * and downstream dependents (things that depend on it), with cycle detection.
 *
 * @param {string} featureId - The feature to trace from
 * @param {import('./cap-feature-map.cjs').Feature[]} features - All features
 * @param {'both'|'upstream'|'downstream'} [direction='both'] - Which direction to trace
 * @returns {DependencyChain}
 */
function traceDependencyChain(featureId, features, direction = 'both') {
  const upstream = [];
  const downstream = [];

  // Build lookup maps
  /** @type {Map<string, string[]>} featureId -> dependencies (what it depends on) */
  const depsMap = new Map();
  /** @type {Map<string, string[]>} featureId -> dependents (what depends on it) */
  const dependentsMap = new Map();

  for (const f of features) {
    depsMap.set(f.id, f.dependencies || []);
    for (const dep of f.dependencies || []) {
      if (!dependentsMap.has(dep)) dependentsMap.set(dep, []);
      dependentsMap.get(dep).push(f.id);
    }
  }

  let maxDepth = 0;

  // Trace upstream (things this feature depends on, recursively)
  if (direction === 'both' || direction === 'upstream') {
    const visited = new Set();
    const queue = [{ id: featureId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      const deps = depsMap.get(id) || [];
      for (const dep of deps) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        upstream.push(dep);
        if (depth + 1 > maxDepth) maxDepth = depth + 1;
        queue.push({ id: dep, depth: depth + 1 });
      }
    }
  }

  // Trace downstream (things that depend on this feature, recursively)
  if (direction === 'both' || direction === 'downstream') {
    const visited = new Set();
    const queue = [{ id: featureId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      const deps = dependentsMap.get(id) || [];
      for (const dep of deps) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        downstream.push(dep);
        if (depth + 1 > maxDepth) maxDepth = depth + 1;
        queue.push({ id: dep, depth: depth + 1 });
      }
    }
  }

  return { upstream, downstream, depth: maxDepth };
}

// --- Circular Dependency Detection ---

// @cap-todo(ac:F-033/AC-8) Detect circular dependency risks when new features are proposed and warn before Feature Map entries are written

/**
 * Detect if adding proposed dependencies would create a circular dependency.
 * Uses DFS cycle detection on the dependency graph augmented with proposed edges.
 *
 * @param {string} proposedFeatureId - The feature ID being proposed
 * @param {string[]} proposedDeps - Proposed dependency list for the new feature
 * @param {import('./cap-feature-map.cjs').Feature[]} existingFeatures - All existing features
 * @returns {CircularDepResult}
 */
function detectCircularDeps(proposedFeatureId, proposedDeps, existingFeatures) {
  // Build adjacency list: featureId -> [dependencies]
  /** @type {Map<string, string[]>} */
  const graph = new Map();

  for (const f of existingFeatures) {
    graph.set(f.id, [...(f.dependencies || [])]);
  }

  // Add proposed feature and its dependencies
  graph.set(proposedFeatureId, [...proposedDeps]);

  // DFS cycle detection
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed

  /** @type {Map<string, number>} */
  const color = new Map();
  /** @type {Map<string, string|null>} */
  const parent = new Map();

  for (const id of graph.keys()) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  /**
   * DFS from node, returns cycle path if found.
   * @param {string} node
   * @returns {string[]|null}
   */
  function dfs(node) {
    color.set(node, GRAY);

    for (const neighbor of graph.get(node) || []) {
      // Neighbor might not be in graph (e.g., references non-existent feature)
      if (!graph.has(neighbor)) continue;

      if (color.get(neighbor) === GRAY) {
        // Found cycle — reconstruct path
        const cycle = [neighbor, node];
        let current = node;
        while (current !== neighbor) {
          current = parent.get(current);
          if (current === null || current === neighbor) break;
          cycle.push(current);
        }
        cycle.push(neighbor);
        cycle.reverse();
        return cycle;
      }

      if (color.get(neighbor) === WHITE) {
        parent.set(neighbor, node);
        const result = dfs(neighbor);
        if (result) return result;
      }
    }

    color.set(node, BLACK);
    return null;
  }

  // Start DFS from proposed feature to find cycles involving it
  const cycle = dfs(proposedFeatureId);
  if (cycle) {
    return { hasCycle: true, cycle };
  }

  // Also check all other unvisited nodes (in case proposed deps create a cycle elsewhere)
  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      const result = dfs(id);
      if (result) {
        return { hasCycle: true, cycle: result };
      }
    }
  }

  return { hasCycle: false, cycle: [] };
}

// --- Impact Report Generation ---

// @cap-todo(ac:F-033/AC-3) Present structured impact report: overlapping ACs with similarity reasoning, affected dependency chains, implementation file conflicts

/**
 * Generate a full impact report for a proposed feature.
 * Orchestrates overlap detection, dependency tracing, and circular dep checks.
 *
 * @param {import('./cap-feature-map.cjs').Feature} proposedFeature - The proposed feature (must have id, title, acs, files, dependencies)
 * @param {import('./cap-feature-map.cjs').Feature[]} existingFeatures - All existing features from Feature Map
 * @param {Object} [options]
 * @param {number} [options.similarityThreshold] - Override AC similarity threshold
 * @param {number} [options.minSharedKeywords] - Override minimum shared keywords
 * @returns {ImpactReport}
 */
function generateImpactReport(proposedFeature, existingFeatures, options = {}) {
  // AC overlap and file conflicts
  const { overlaps, fileConflicts } = detectOverlap(proposedFeature, existingFeatures, options);

  // Dependency chain analysis
  // Merge existing features with proposed feature for full graph
  const allFeatures = [...existingFeatures.filter(f => f.id !== proposedFeature.id), proposedFeature];
  const affectedChains = traceDependencyChain(proposedFeature.id, allFeatures);

  // Circular dependency check
  const circularRisks = detectCircularDeps(
    proposedFeature.id,
    proposedFeature.dependencies || [],
    existingFeatures
  );

  // Generate resolutions
  const report = {
    proposedFeatureTitle: proposedFeature.title || '',
    timestamp: new Date().toISOString(),
    overlappingACs: overlaps,
    affectedChains,
    fileConflicts,
    circularRisks,
    resolutions: [],
  };

  report.resolutions = proposeResolutions(report);

  return report;
}

// --- Resolution Proposals ---

// @cap-todo(ac:F-033/AC-5) Propose concrete resolutions: merge ACs into existing feature, split into separate features, adjust dependency ordering, or flag as intentional duplication

/**
 * Propose concrete resolutions for issues found in the impact report.
 * For each overlap/conflict, suggests merge, split, adjust, or flag.
 *
 * @param {ImpactReport} report - The impact report to generate resolutions for
 * @returns {Resolution[]}
 */
function proposeResolutions(report) {
  const resolutions = [];

  // --- Circular dependency resolution ---
  if (report.circularRisks.hasCycle) {
    resolutions.push({
      type: 'adjust',
      description: `Circular dependency detected: ${report.circularRisks.cycle.join(' -> ')}. Reorder dependencies or break the cycle by extracting shared concerns into a separate feature.`,
      affectedFeatures: [...new Set(report.circularRisks.cycle)],
    });
  }

  // --- Group AC overlaps by existing feature ---
  /** @type {Map<string, ACOverlap[]>} existingFeatureId -> overlaps */
  const overlapsByFeature = new Map();
  for (const overlap of report.overlappingACs) {
    if (!overlapsByFeature.has(overlap.existingFeatureId)) {
      overlapsByFeature.set(overlap.existingFeatureId, []);
    }
    overlapsByFeature.get(overlap.existingFeatureId).push(overlap);
  }

  for (const [featureId, overlaps] of overlapsByFeature) {
    const featureTitle = overlaps[0].existingFeatureTitle;
    const avgSimilarity = overlaps.reduce((sum, o) => sum + o.similarity, 0) / overlaps.length;

    if (avgSimilarity >= 0.5) {
      // High overlap — suggest merge
      resolutions.push({
        type: 'merge',
        description: `High AC overlap (avg ${(avgSimilarity * 100).toFixed(0)}%) with ${featureId} (${featureTitle}). Consider merging ${overlaps.length} overlapping AC(s) into the existing feature.`,
        affectedFeatures: [featureId],
      });
    } else if (overlaps.length >= 3) {
      // Many partial overlaps — suggest split
      resolutions.push({
        type: 'split',
        description: `Multiple partial overlaps (${overlaps.length} ACs) with ${featureId} (${featureTitle}). Consider extracting shared concerns into a separate shared feature.`,
        affectedFeatures: [featureId],
      });
    } else {
      // Low overlap — flag for awareness
      resolutions.push({
        type: 'flag',
        description: `Minor AC overlap with ${featureId} (${featureTitle}): ${overlaps.map(o => `${o.proposedACId} ~ ${o.existingACId}`).join(', ')}. May be intentional duplication.`,
        affectedFeatures: [featureId],
      });
    }
  }

  // --- File conflict resolutions ---
  if (report.fileConflicts.length > 0) {
    const affectedFiles = report.fileConflicts.map(c => c.filePath);
    const affectedFeatures = [...new Set(report.fileConflicts.flatMap(c => c.existingFeatureIds))];

    resolutions.push({
      type: 'adjust',
      description: `File ownership conflicts on ${affectedFiles.length} file(s): ${affectedFiles.join(', ')}. Verify intended scope or split responsibilities.`,
      affectedFeatures,
    });
  }

  return resolutions;
}

// --- Report Persistence ---

// @cap-todo(ac:F-033/AC-7) Persist impact analysis results in .cap/memory/impact/{feature-id}.md for audit trail and future reference

/**
 * Persist an impact report to .cap/memory/impact/{feature-id}.md.
 * Creates the directory if it does not exist.
 *
 * @param {string} cwd - Absolute path to project root
 * @param {string} featureId - Feature ID for the report filename
 * @param {ImpactReport} report - The impact report to persist
 */
function persistReport(cwd, featureId, report) {
  const impactDir = path.join(cwd, IMPACT_DIR);
  if (!fs.existsSync(impactDir)) {
    fs.mkdirSync(impactDir, { recursive: true });
  }

  const filePath = path.join(impactDir, `${featureId}.md`);
  const content = serializeReport(featureId, report);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Serialize an impact report to markdown format.
 *
 * @param {string} featureId - Feature ID
 * @param {ImpactReport} report - The impact report
 * @returns {string} Markdown content
 */
function serializeReport(featureId, report) {
  const lines = [
    `# Impact Analysis: ${featureId}`,
    '',
    `**Feature:** ${report.proposedFeatureTitle}`,
    `**Generated:** ${report.timestamp}`,
    '',
  ];

  // --- Overlapping ACs ---
  lines.push('## Overlapping ACs');
  lines.push('');
  if (report.overlappingACs.length === 0) {
    lines.push('No AC overlaps detected.');
  } else {
    lines.push('| Proposed AC | Existing Feature | Existing AC | Similarity | Shared Keywords |');
    lines.push('|-------------|-----------------|-------------|------------|-----------------|');
    for (const o of report.overlappingACs) {
      lines.push(`| ${o.proposedACId} | ${o.existingFeatureId} | ${o.existingACId} | ${(o.similarity * 100).toFixed(1)}% | ${o.sharedKeywords.join(', ')} |`);
    }
  }
  lines.push('');

  // --- Dependency Chains ---
  lines.push('## Dependency Chains');
  lines.push('');
  lines.push(`**Upstream (depends on):** ${report.affectedChains.upstream.length > 0 ? report.affectedChains.upstream.join(', ') : 'none'}`);
  lines.push(`**Downstream (depended on by):** ${report.affectedChains.downstream.length > 0 ? report.affectedChains.downstream.join(', ') : 'none'}`);
  lines.push(`**Max depth:** ${report.affectedChains.depth}`);
  lines.push('');

  // --- File Conflicts ---
  lines.push('## File Conflicts');
  lines.push('');
  if (report.fileConflicts.length === 0) {
    lines.push('No file conflicts detected.');
  } else {
    for (const c of report.fileConflicts) {
      lines.push(`- \`${c.filePath}\` — also referenced by: ${c.existingFeatureIds.join(', ')}`);
    }
  }
  lines.push('');

  // --- Circular Dependency Risks ---
  lines.push('## Circular Dependency Risks');
  lines.push('');
  if (report.circularRisks.hasCycle) {
    lines.push(`**WARNING:** Circular dependency detected: ${report.circularRisks.cycle.join(' -> ')}`);
  } else {
    lines.push('No circular dependencies detected.');
  }
  lines.push('');

  // --- Proposed Resolutions ---
  lines.push('## Proposed Resolutions');
  lines.push('');
  if (report.resolutions.length === 0) {
    lines.push('No resolutions needed — clean integration.');
  } else {
    for (let i = 0; i < report.resolutions.length; i++) {
      const r = report.resolutions[i];
      lines.push(`${i + 1}. **[${r.type.toUpperCase()}]** ${r.description}`);
      lines.push(`   Affects: ${r.affectedFeatures.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('*This report is advisory only. No Feature Map modifications were made.*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Load a previously persisted impact report from disk.
 *
 * @param {string} cwd - Absolute path to project root
 * @param {string} featureId - Feature ID to load report for
 * @returns {string|null} Raw markdown content, or null if not found
 */
function loadReport(cwd, featureId) {
  const filePath = path.join(cwd, IMPACT_DIR, `${featureId}.md`);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
}

// --- Main Entry Point ---

// @cap-todo(ac:F-033/AC-6) All proposals shall be advisory only — no Feature Map modifications without explicit user approval
// @cap-decision analyzeImpact reads Feature Map but NEVER writes to it. All returned data is advisory for caller to present.

/**
 * Main entry point: analyze the impact of a proposed feature against the existing Feature Map.
 * Reads Feature Map, runs all analysis, returns full report.
 * Does NOT modify Feature Map.
 *
 * @param {string} cwd - Absolute path to project root
 * @param {import('./cap-feature-map.cjs').Feature} proposedFeature - The proposed feature
 * @param {Object} [options]
 * @param {boolean} [options.persist] - If true, persist report to disk (default: false)
 * @param {string|null} [options.appPath] - Relative app path for monorepo scoping
 * @param {number} [options.similarityThreshold] - Override AC similarity threshold
 * @param {number} [options.minSharedKeywords] - Override minimum shared keywords
 * @returns {ImpactReport}
 */
function analyzeImpact(cwd, proposedFeature, options = {}) {
  const {
    persist = false,
    appPath = null,
    similarityThreshold,
    minSharedKeywords,
  } = options;

  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
  const featureMap = readFeatureMap(cwd, appPath, { safe: true });
  if (featureMap && featureMap.parseError) {
    console.warn('cap: impact-analysis — duplicate feature ID detected, report uses partial map: ' + String(featureMap.parseError.message).trim());
  }
  const existingFeatures = featureMap.features || [];

  const report = generateImpactReport(proposedFeature, existingFeatures, {
    similarityThreshold,
    minSharedKeywords,
  });

  if (persist && proposedFeature.id) {
    persistReport(cwd, proposedFeature.id, report);
  }

  return report;
}

module.exports = {
  // Core analysis
  detectOverlap,
  traceDependencyChain,
  detectCircularDeps,
  generateImpactReport,
  proposeResolutions,

  // Persistence
  persistReport,
  serializeReport,
  loadReport,

  // Main entry point
  analyzeImpact,

  // Constants (exposed for testing and configuration)
  IMPACT_DIR,
  AC_SIMILARITY_THRESHOLD,
  AC_MIN_SHARED_KEYWORDS,
  FILE_OVERLAP_THRESHOLD,
};
