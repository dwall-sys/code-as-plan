'use strict';

// @cap-feature(feature:F-048, primary:true) Implementation Completeness Score — 4-point per-AC audit.
// Computes four independent signals per acceptance criterion:
//   (a) tag exists in code         — @cap-todo/@cap-feature tag references this AC
//   (b) test exists referencing it — tagged test file (tests/** or *.test.*) also references this AC
//   (c) test invokes tagged code   — test's static imports reach the primary implementation file
//   (d) reachable from public      — primary file is reachable via imports from bin/install.js or hooks/
//
// Each signal is 0 or 1. The sum is the completeness score (0..4). A feature's
// average is the mean of its AC scores.
//
// @cap-decision Pure computation. scoreAc() takes a pre-computed context and returns
// a structured result. The only I/O surface is buildContext() (scans the project once)
// and loadCompletenessConfig() (reads .cap/config.json). Performance-critical code paths
// reuse the context across all ACs — expected wall-clock <5s for 100 features.
// @cap-decision Reachability uses static CJS/ESM imports only. Dynamic requires, runtime
// plugin loading, and command-markdown references are NOT followed — these are documented
// limitations consistent with F-049's constraints.

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join('.cap', 'config.json');

const DEFAULT_CONFIG = {
  enabled: false,
  shipThreshold: 3.5,
};

const TEST_FILE_PATTERNS = [
  /\.test\.[cm]?js$/i,
  /\.test\.tsx?$/i,
  /\.spec\.[cm]?js$/i,
  /\.spec\.tsx?$/i,
  /^tests?\//, // path starts with tests/ or test/
  /\/tests?\//,
];

/**
 * @typedef {Object} CompletenessConfig
 * @property {boolean} enabled
 * @property {number} shipThreshold
 */

/**
 * @typedef {Object} CompletenessContext
 * @property {Object} featureMap - Output of readFeatureMap()
 * @property {Array} tags - Output of scanner.scanDirectory()
 * @property {Object} acFileMap - Output of scanner.buildAcFileMap()
 * @property {Map<string,string>} fileToFeature - from cap-deps
 * @property {Set<string>} publicReachable - absolute paths reachable from public surface
 * @property {Map<string,Array>} importsByFile - absolute path -> ImportSpec[] (cached)
 * @property {string} projectRoot
 */

/**
 * @typedef {Object} AcScore
 * @property {string} acRef            - 'F-XXX/AC-N'
 * @property {Object} signals
 * @property {boolean} signals.tag
 * @property {boolean} signals.test
 * @property {boolean} signals.testInvokesCode
 * @property {boolean} signals.reachable
 * @property {number} score            - 0..4
 * @property {string[]} reasons        - short strings explaining each signal's outcome
 */

/**
 * @typedef {Object} FeatureScore
 * @property {string} featureId
 * @property {string} state           - lifecycle state from FEATURE-MAP
 * @property {AcScore[]} acs
 * @property {number} averageScore    - arithmetic mean, 0..4, or NaN when feature has no ACs
 * @property {number} acCount
 * @property {number} scoreSum
 */

/**
 * Check whether a file path looks like a test file.
 * @param {string} filePath - Relative or absolute
 * @returns {boolean}
 */
function isTestFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Score a single AC against a pre-computed context.
 * @param {string} acRef - 'F-XXX/AC-N'
 * @param {CompletenessContext} ctx
 * @returns {AcScore}
 */
function scoreAc(acRef, ctx) {
  const entry = ctx.acFileMap[acRef];
  const files = (entry && entry.files) || [];
  const primary = (entry && entry.primary) || null;

  const reasons = [];

  // -------- Signal (a): tag exists in (non-test) code --------
  const codeFiles = files.filter((f) => !isTestFile(f));
  const tagSignal = codeFiles.length > 0;
  reasons.push(
    tagSignal
      ? `tag: ${codeFiles.length} file(s) tagged`
      : 'tag: no @cap-* tag references this AC in source files'
  );

  // -------- Signal (b): test exists referencing the AC --------
  const testFiles = files.filter((f) => isTestFile(f));
  const testSignal = testFiles.length > 0;
  reasons.push(
    testSignal
      ? `test: ${testFiles.length} test file(s) tag this AC`
      : 'test: no test file has a @cap-* tag referencing this AC'
  );

  // -------- Signal (c): test invokes the tagged code --------
  let testInvokesCode = false;
  if (testSignal && primary) {
    const primaryAbs = path.isAbsolute(primary)
      ? primary
      : path.resolve(ctx.projectRoot, primary);
    for (const tf of testFiles) {
      const testAbs = path.isAbsolute(tf) ? tf : path.resolve(ctx.projectRoot, tf);
      if (testReachesFile(testAbs, primaryAbs, ctx, /* maxDepth */ 3)) {
        testInvokesCode = true;
        break;
      }
    }
  }
  reasons.push(
    testInvokesCode
      ? 'invokes: at least one test imports the primary file (static graph)'
      : testSignal
        ? 'invokes: test does not import the primary file within 3 hops'
        : 'invokes: skipped (no test present)'
  );

  // -------- Signal (d): tagged code reachable from public surface --------
  let reachable = false;
  if (primary) {
    const primaryAbs = path.isAbsolute(primary)
      ? primary
      : path.resolve(ctx.projectRoot, primary);
    reachable = ctx.publicReachable.has(primaryAbs);
  }
  reasons.push(
    reachable
      ? 'reachable: primary file is imported from public surface (bin/install.js, hooks/)'
      : 'reachable: primary file not reachable from bin/install.js or hooks/'
  );

  const score =
    (tagSignal ? 1 : 0) +
    (testSignal ? 1 : 0) +
    (testInvokesCode ? 1 : 0) +
    (reachable ? 1 : 0);

  return {
    acRef,
    signals: {
      tag: tagSignal,
      test: testSignal,
      testInvokesCode,
      reachable,
    },
    score,
    reasons,
  };
}

/**
 * BFS over static imports from `startFile` looking for `targetFile`.
 * Caches import lists per-file via ctx.importsByFile.
 *
 * @param {string} startFile - absolute
 * @param {string} targetFile - absolute
 * @param {CompletenessContext} ctx
 * @param {number} maxDepth
 * @returns {boolean}
 */
function testReachesFile(startFile, targetFile, ctx, maxDepth) {
  if (startFile === targetFile) return true;
  const deps = require('./cap-deps.cjs');
  const queue = [{ file: startFile, depth: 0 }];
  const seen = new Set([startFile]);
  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    let imports = ctx.importsByFile.get(file);
    if (imports === undefined) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        imports = deps.parseImports(content);
      } catch (_e) {
        imports = [];
      }
      ctx.importsByFile.set(file, imports);
    }
    for (const imp of imports) {
      const resolved = deps.resolveImportToFile(imp.source, file);
      if (!resolved) continue;
      if (resolved === targetFile) return true;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push({ file: resolved, depth: depth + 1 });
      }
    }
  }
  return false;
}

/**
 * Compute reachability set from public surface files (bin/install.js + hooks/*.js)
 * outward via static imports. Returns absolute paths of all reachable files.
 *
 * @param {string} projectRoot
 * @returns {Set<string>}
 */
function computePublicReachable(projectRoot) {
  const deps = require('./cap-deps.cjs');
  const roots = collectPublicSurfaceFiles(projectRoot);
  const reachable = new Set();
  const queue = [];
  for (const r of roots) {
    reachable.add(r);
    queue.push(r);
  }
  while (queue.length > 0) {
    const file = queue.shift();
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_e) {
      continue;
    }
    const imports = deps.parseImports(content);
    for (const imp of imports) {
      const resolved = deps.resolveImportToFile(imp.source, file);
      if (!resolved) continue;
      if (!reachable.has(resolved)) {
        reachable.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return reachable;
}

/**
 * Collect the public-surface entry points. Conservative set: package.json "bin"
 * entries plus any *.js files under hooks/. Returns absolute paths.
 * @param {string} projectRoot
 * @returns {string[]}
 */
function collectPublicSurfaceFiles(projectRoot) {
  const entries = [];
  // package.json bin entries
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const bin = pkg.bin;
    if (typeof bin === 'string') {
      entries.push(path.resolve(projectRoot, bin));
    } else if (bin && typeof bin === 'object') {
      for (const v of Object.values(bin)) {
        entries.push(path.resolve(projectRoot, v));
      }
    }
  } catch (_e) { /* no package.json */ }

  // hooks/*.js
  const hooksDir = path.join(projectRoot, 'hooks');
  try {
    const files = fs.readdirSync(hooksDir);
    for (const f of files) {
      if (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs')) {
        const full = path.join(hooksDir, f);
        const st = fs.statSync(full);
        if (st.isFile()) entries.push(full);
      }
    }
  } catch (_e) { /* no hooks dir */ }

  return entries;
}

/**
 * Build the CompletenessContext used by all scoring functions.
 * @param {string} projectRoot
 * @param {{ scanner?: any, featureMap?: any }} [injected] - Optional pre-computed inputs (for tests)
 * @returns {CompletenessContext}
 */
function buildContext(projectRoot, injected) {
  const scanner = (injected && injected.scanner) || require('./cap-tag-scanner.cjs');
  const fm = (injected && injected.featureMapModule) || require('./cap-feature-map.cjs');
  const deps = require('./cap-deps.cjs');

  const featureMap = (injected && injected.featureMap) || fm.readFeatureMap(projectRoot);
  const tags = (injected && injected.tags) || scanner.scanDirectory(projectRoot);
  const acFileMap = scanner.buildAcFileMap(tags);
  const fileToFeature = deps.buildFileToFeatureMap(tags, projectRoot);
  const publicReachable =
    (injected && injected.publicReachable) || computePublicReachable(projectRoot);

  return {
    featureMap,
    tags,
    acFileMap,
    fileToFeature,
    publicReachable,
    importsByFile: new Map(),
    projectRoot,
  };
}

/**
 * Score every AC in every feature of the Feature Map.
 * @param {CompletenessContext} ctx
 * @returns {FeatureScore[]}
 */
function scoreAllFeatures(ctx) {
  const out = [];
  const features = (ctx.featureMap && ctx.featureMap.features) || [];
  for (const f of features) {
    out.push(scoreFeature(f, ctx));
  }
  return out;
}

/**
 * Score a single feature.
 * @param {Object} feature - A feature entry from readFeatureMap()
 * @param {CompletenessContext} ctx
 * @returns {FeatureScore}
 */
function scoreFeature(feature, ctx) {
  const acs = (feature.acs || []).map((ac) => {
    const acRef = `${feature.id}/${ac.id}`;
    return scoreAc(acRef, ctx);
  });
  const scoreSum = acs.reduce((sum, a) => sum + a.score, 0);
  const averageScore = acs.length > 0 ? scoreSum / acs.length : NaN;
  return {
    featureId: feature.id,
    state: feature.state || null,
    acs,
    averageScore,
    acCount: acs.length,
    scoreSum,
  };
}

/**
 * Format a terse per-feature breakdown suitable for `/cap:status --completeness`.
 * @param {FeatureScore[]} scores
 * @returns {string}
 */
function formatFeatureBreakdown(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return 'No features to score.';
  }
  const lines = ['Completeness Score (per feature — avg of 4-point AC signals)'];
  lines.push('');
  for (const s of scores) {
    const avg = Number.isFinite(s.averageScore) ? s.averageScore.toFixed(2) : '—';
    lines.push(`${s.featureId} [${s.state || '?'}]  avg=${avg}/4  (${s.acCount} AC)`);
    for (const ac of s.acs) {
      const flags = [
        ac.signals.tag ? 'T' : '·',
        ac.signals.test ? 'S' : '·',
        ac.signals.testInvokesCode ? 'I' : '·',
        ac.signals.reachable ? 'R' : '·',
      ].join('');
      lines.push(`  ${ac.acRef.padEnd(14)} ${flags}  score=${ac.score}/4`);
    }
    lines.push('');
  }
  lines.push('Legend: T=tagged S=tested I=test-invokes-code R=reachable-from-public');
  return lines.join('\n');
}

/**
 * Format a full markdown audit report suitable for PR attachment.
 * @param {FeatureScore[]} scores
 * @returns {string}
 */
function formatCompletenessReport(scores) {
  const lines = [];
  lines.push('# Completeness Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Signal legend:');
  lines.push('- **T** = `@cap-*` tag in source code references the AC');
  lines.push('- **S** = a test file carries a `@cap-*` tag for the AC');
  lines.push('- **I** = at least one test file statically imports the primary implementation');
  lines.push('- **R** = primary file is reachable from public surface (`bin/install.js`, `hooks/*.js`)');
  lines.push('');

  const scoreboard = scores.map((s) => {
    const avg = Number.isFinite(s.averageScore) ? s.averageScore.toFixed(2) : '—';
    return `| ${s.featureId} | ${s.state || '?'} | ${s.acCount} | ${avg} |`;
  });
  lines.push('## Summary');
  lines.push('');
  lines.push('| Feature | State | ACs | Avg Score |');
  lines.push('|---------|-------|-----|-----------|');
  lines.push(...scoreboard);
  lines.push('');

  for (const s of scores) {
    lines.push(`## ${s.featureId}`);
    lines.push('');
    lines.push(`State: ${s.state || '?'} — Avg: ${Number.isFinite(s.averageScore) ? s.averageScore.toFixed(2) : '—'}/4`);
    lines.push('');
    lines.push('| AC | T | S | I | R | Score | Reasons |');
    lines.push('|----|---|---|---|---|-------|---------|');
    for (const ac of s.acs) {
      const mark = (b) => (b ? '✓' : '·');
      const reasons = ac.reasons.join('; ').replace(/\|/g, '\\|');
      lines.push(
        `| ${ac.acRef} | ${mark(ac.signals.tag)} | ${mark(ac.signals.test)} | ${mark(ac.signals.testInvokesCode)} | ${mark(ac.signals.reachable)} | ${ac.score}/4 | ${reasons} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Load F-048 config from .cap/config.json with safe defaults.
 * @param {string} cwd
 * @returns {CompletenessConfig}
 */
function loadCompletenessConfig(cwd) {
  const configPath = path.join(cwd, CONFIG_FILE);
  const cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const section = parsed && parsed.completenessScore;
    if (section && typeof section === 'object') {
      if (typeof section.enabled === 'boolean') cfg.enabled = section.enabled;
      if (typeof section.shipThreshold === 'number' && Number.isFinite(section.shipThreshold)) {
        cfg.shipThreshold = section.shipThreshold;
      }
    }
  } catch (_e) {
    // No config or malformed — defaults
  }
  return cfg;
}

/**
 * Gate for `updateFeatureState(..., 'shipped')`. Returns { allowed, reason }.
 * Only enforces when config.enabled is true. When disabled, always allows.
 *
 * @param {string} featureId
 * @param {string} targetState
 * @param {string} cwd
 * @param {CompletenessContext} [ctx] - Optional pre-built context (for tests / perf)
 * @returns {{ allowed: boolean, reason: string|null, score: number|null }}
 */
function checkShipGate(featureId, targetState, cwd, ctx) {
  if (targetState !== 'shipped') return { allowed: true, reason: null, score: null };
  const cfg = loadCompletenessConfig(cwd);
  if (!cfg.enabled) return { allowed: true, reason: null, score: null };

  const context = ctx || buildContext(cwd);
  const feature = (context.featureMap.features || []).find((f) => f.id === featureId);
  if (!feature) {
    return { allowed: true, reason: null, score: null };
  }
  const score = scoreFeature(feature, context);
  if (!Number.isFinite(score.averageScore)) {
    // No ACs — cannot compute. Allow (treat as out-of-scope for the gate).
    return { allowed: true, reason: null, score: null };
  }
  if (score.averageScore < cfg.shipThreshold) {
    return {
      allowed: false,
      reason:
        `Completeness score for ${featureId} is ${score.averageScore.toFixed(2)}/4 — ` +
        `below the configured shipThreshold=${cfg.shipThreshold}. ` +
        `Run /cap:completeness-report for per-AC details.`,
      score: score.averageScore,
    };
  }
  return { allowed: true, reason: null, score: score.averageScore };
}

module.exports = {
  // constants
  DEFAULT_CONFIG,
  // pure helpers
  isTestFile,
  scoreAc,
  scoreFeature,
  scoreAllFeatures,
  formatFeatureBreakdown,
  formatCompletenessReport,
  // reachability
  collectPublicSurfaceFiles,
  computePublicReachable,
  // context
  buildContext,
  // config + gate
  loadCompletenessConfig,
  checkShipGate,
};
