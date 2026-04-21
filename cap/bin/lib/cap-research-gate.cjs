// @cap-feature(feature:F-059) Research-First Gate Before Prototype — pure-logic module.
// @cap-decision Pure logic + reporting only. The prototype command is responsible for prompting the user and invoking refresh-docs; this module never blocks and never reads stdin.
// @cap-decision Library extraction is a two-pass match: (1) exact token match against package.json dependency names, (2) substring match inside AC descriptions. A library must appear in package.json to be considered (zero false-positives from prose mentions like "proven pattern").
// @cap-constraint Zero external dependencies — node: built-ins only.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const stackDocs = require('./cap-stack-docs.cjs');

/** Default staleness threshold (days). ACs spec 30 days. */
const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * @typedef {Object} GateResult
 * @property {string[]} libraries - Libraries referenced by the scoped ACs + present in package.json
 * @property {string[]} missing - Libraries with no cached docs at all
 * @property {string[]} stale - Libraries with docs older than maxAgeDays
 * @property {string[]} fresh - Libraries with docs within the freshness window
 * @property {number} maxAgeDays - Staleness threshold applied
 */

/**
 * Load the direct (dependencies + devDependencies) name list from a package.json path.
 * Tolerant of missing / malformed input — returns [] on any failure.
 * @param {string} projectRoot
 * @returns {string[]}
 */
function readPackageDependencies(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
    const devDeps = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? Object.keys(pkg.devDependencies) : [];
    const seen = new Set();
    const out = [];
    for (const n of [...deps, ...devDeps]) {
      if (typeof n === 'string' && n.length > 0 && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out.sort();
  } catch {
    return [];
  }
}

/**
 * Escape a dependency name for safe embedding in a RegExp. npm scoped names
 * contain '/', '@', '.', '-' which are regex metacharacters in some positions.
 * @param {string} name
 * @returns {string}
 */
function escapeRegex(name) {
  return name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

// @cap-todo(ac:F-059/AC-1) parseLibraryMentions scans AC descriptions for any dependency listed in package.json. We deliberately use package.json as the whitelist — a mention like "proven pattern" or "stripe webhook" in prose will not count unless the dep is installed. This keeps the gate specific and actionable.
/**
 * Scan AC description strings for references to any library listed in `dependencies`.
 * Uses whole-token boundaries so `react` doesn't match `overreacted` or `reactivity`.
 *
 * @param {string[]} acDescriptions - One description per AC
 * @param {string[]} dependencies - Library names from package.json
 * @returns {string[]} Sorted unique dependency names that appeared in any description
 */
function parseLibraryMentions(acDescriptions, dependencies) {
  if (!Array.isArray(acDescriptions) || acDescriptions.length === 0) return [];
  if (!Array.isArray(dependencies) || dependencies.length === 0) return [];
  const haystack = acDescriptions.filter((s) => typeof s === 'string').join('\n').toLowerCase();
  if (haystack.length === 0) return [];

  const hits = new Set();
  for (const dep of dependencies) {
    if (typeof dep !== 'string' || dep.length === 0) continue;
    const lower = dep.toLowerCase();
    // Word-boundary matching: the name must not be embedded inside a longer identifier.
    // Scoped packages ("@org/pkg") already contain non-word characters so plain \b works.
    const re = new RegExp(`(?:^|[^a-z0-9@/_-])${escapeRegex(lower)}(?:$|[^a-z0-9@/_-])`, 'i');
    if (re.test(haystack)) hits.add(dep);
  }
  return Array.from(hits).sort();
}

// @cap-todo(ac:F-059/AC-2) checkStackDocs buckets each library into missing / stale / fresh using cap-stack-docs.checkFreshness. The spec named `.cap/stack-docs/{library}/` as a directory; F-004 stores docs as `{library}.md` files — we honour the existing on-disk convention and treat the AC wording as the *intent* (a per-library artefact, not its exact layout).
/**
 * For each library, check whether its stack doc is missing, stale, or fresh.
 * @param {string} projectRoot
 * @param {string[]} libraries
 * @param {number} [maxAgeDays=DEFAULT_MAX_AGE_DAYS]
 * @returns {{missing:string[], stale:string[], fresh:string[]}}
 */
function checkStackDocs(projectRoot, libraries, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const missing = [];
  const stale = [];
  const fresh = [];
  const maxAgeHours = maxAgeDays * 24;

  for (const lib of libraries || []) {
    if (typeof lib !== 'string' || lib.length === 0) continue;
    const freshness = stackDocs.checkFreshness(projectRoot, lib, maxAgeHours);
    if (!freshness.filePath) {
      missing.push(lib);
    } else if (!freshness.fresh) {
      stale.push(lib);
    } else {
      fresh.push(lib);
    }
  }

  return {
    missing: missing.sort(),
    stale: stale.sort(),
    fresh: fresh.sort(),
  };
}

/**
 * Run the full research-first gate against a scoped set of AC descriptions.
 * Pure function — reads filesystem (package.json, stack-docs mtimes) but never prompts or logs.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot - Absolute project root
 * @param {string[]} opts.acDescriptions - AC description strings (already scoped to the features being prototyped)
 * @param {number} [opts.maxAgeDays=DEFAULT_MAX_AGE_DAYS]
 * @param {string[]} [opts.dependencies] - Override package-json detection (for testing)
 * @returns {GateResult}
 */
function runGate(opts) {
  const projectRoot = opts && opts.projectRoot;
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('runGate: projectRoot must be a non-empty string');
  }
  const acDescriptions = Array.isArray(opts.acDescriptions) ? opts.acDescriptions : [];
  const maxAgeDays = typeof opts.maxAgeDays === 'number' && opts.maxAgeDays > 0
    ? opts.maxAgeDays
    : DEFAULT_MAX_AGE_DAYS;
  const dependencies = Array.isArray(opts.dependencies) ? opts.dependencies : readPackageDependencies(projectRoot);

  const libraries = parseLibraryMentions(acDescriptions, dependencies);
  const buckets = checkStackDocs(projectRoot, libraries, maxAgeDays);

  return {
    libraries,
    missing: buckets.missing,
    stale: buckets.stale,
    fresh: buckets.fresh,
    maxAgeDays,
  };
}

// @cap-todo(ac:F-059/AC-3) formatWarning renders the user-facing block including the /cap:refresh-docs hint. Empty when nothing is missing/stale (caller can skip printing).
/**
 * Render a human-readable warning block for the prototype orchestrator to print.
 * Returns an empty string when there is nothing to warn about.
 * @param {GateResult} result
 * @returns {string}
 */
function formatWarning(result) {
  const missing = result && Array.isArray(result.missing) ? result.missing : [];
  const stale = result && Array.isArray(result.stale) ? result.stale : [];
  if (missing.length === 0 && stale.length === 0) return '';

  const lines = ['Research-First Gate — missing or stale stack docs detected:'];
  if (missing.length > 0) {
    lines.push(`  Missing: ${missing.join(', ')}`);
  }
  if (stale.length > 0) {
    lines.push(`  Stale (> ${result.maxAgeDays} days): ${stale.join(', ')}`);
  }
  const refreshTargets = [...missing, ...stale];
  lines.push('');
  lines.push(`  Recommendation: /cap:refresh-docs ${refreshTargets.join(' ')}`);
  lines.push('  Proceed anyway? [y/N]');
  return lines.join('\n');
}

// @cap-todo(ac:F-059/AC-6) logGateCheck appends a compact session-log record so post-run diagnostics can correlate low-quality prototypes with skipped research.
/**
 * Append a JSONL record describing the gate outcome to the session log.
 * Best-effort — I/O failures are swallowed so the gate never blocks the prototype flow.
 *
 * @param {string} projectRoot
 * @param {{skipped?:boolean, libsChecked:number, missing:number, stale:number}} record
 * @param {Date} [now]
 */
function logGateCheck(projectRoot, record, now) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return;
  const logPath = path.join(projectRoot, '.cap', 'session-log.jsonl');
  const entry = {
    timestamp: (now instanceof Date ? now : new Date()).toISOString(),
    event: 'research-gate',
    skipped: !!(record && record.skipped),
    libsChecked: record && Number.isFinite(record.libsChecked) ? record.libsChecked : 0,
    missing: record && Number.isFinite(record.missing) ? record.missing : 0,
    stale: record && Number.isFinite(record.stale) ? record.stale : 0,
  };
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Best-effort — never propagate logging failure to the caller.
  }
}

module.exports = {
  DEFAULT_MAX_AGE_DAYS,
  readPackageDependencies,
  parseLibraryMentions,
  checkStackDocs,
  runGate,
  formatWarning,
  logGateCheck,
};
