'use strict';

// @cap-feature(feature:F-047) Migration tool: fragmented @cap-* tags -> unified anchor block.
//
// v1 strategy is ADDITIVE: a unified anchor block is inserted near the top of each file
// that carries fragmented AC-level tags, but the legacy tags themselves are NOT removed.
// Both formats coexist during the deprecation window (AC-2). A future `--remove-legacy`
// mode can delete the fragmented tags once the ecosystem has fully switched.
//
// @cap-decision Additive migration keeps the blast radius tiny: no line deletes, no regex-
// based source rewrites of tag annotations, no risk of destroying surrounding code. The
// tradeoff is dual-tag files until the cleanup pass runs. Documented as an explicit choice.

const fs = require('node:fs');
const path = require('node:path');
const anchor = require('./cap-anchor.cjs');
const scanner = require('./cap-tag-scanner.cjs');
// @cap-feature(feature:F-085) Scope filter — same module as the scanner uses, ensures both
//   tools share gitignore + path-pattern + plugin-mirror exclusions.
const scopeModule = require('./cap-scope-filter.cjs');

// @cap-todo(ac:F-047/AC-3) Per-file summary of what the migration would / did change.
/**
 * @typedef {Object} FileMigrationResult
 * @property {string} file                 - Relative path
 * @property {boolean} changed             - True when an anchor would be inserted
 * @property {string|null} newContent      - Proposed content (dry-run) or written content
 * @property {string|null} anchorBlock     - The anchor line that would be inserted (or null)
 * @property {string[]} consolidatedFeatures - Feature IDs consolidated into the anchor
 * @property {string[]} consolidatedAcs    - AC IDs consolidated (e.g. 'F-001/AC-1')
 * @property {string} reason               - 'inserted', 'already-has-anchor', 'no-feature-tags'
 */

/**
 * Decide the comment delimiter style appropriate for this file extension.
 * Mirrors cap-anchor.emitAnchorBlock() styles: block (slash-star), line (hash), html.
 *
 * @param {string} filePath
 * @returns {'block'|'line'|'html'}
 */
function commentStyleForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm' || ext === '.xml' || ext === '.vue' || ext === '.md') {
    return 'html';
  }
  if (
    ext === '.py' || ext === '.rb' || ext === '.sh' || ext === '.bash' || ext === '.zsh' ||
    ext === '.yml' || ext === '.yaml' || ext === '.toml'
  ) {
    return 'line';
  }
  // Default: block comment works in JS/TS/Go/Rust/C/C++/Java/SQL/CSS.
  return 'block';
}

/**
 * Build the anchor structure for a single feature group (the file may tag multiple features —
 * in which case we emit one anchor per feature). Returns null when the group has no AC coverage
 * AND no primary role (nothing worth consolidating).
 *
 * @param {string} featureId
 * @param {CapTag[]} tags - Tags for this feature on this file (feature + todo subset)
 * @returns {{feature:string, acs:string[], role:('primary'|'secondary'|null)}|null}
 */
function consolidateGroup(featureId, tags) {
  const acs = new Set();
  let role = null;
  for (const t of tags) {
    if (t.type === 'feature') {
      if (t.metadata && t.metadata.primary === true) role = 'primary';
    } else if (t.type === 'todo' && t.metadata && typeof t.metadata.ac === 'string') {
      // ac format: 'F-XXX/AC-N' or 'AC-N' (resolved against feature). Anchor both ends
      // so a stray 'notAC-12-ish' cannot accidentally match.
      const m = t.metadata.ac.match(/^(?:F-\d{3,}\/)?(AC-\d+)$/);
      if (m) acs.add(m[1]);
    }
  }
  if (acs.size === 0 && role === null) return null;
  return { feature: featureId, acs: [...acs].sort(compareAcIds), role };
}

function compareAcIds(a, b) {
  const na = parseInt(a.slice(3), 10);
  const nb = parseInt(b.slice(3), 10);
  return na - nb;
}

/**
 * Find the line index where an anchor block should be inserted: after the shebang (if any)
 * and after any 'use strict' directive, but before the first code line.
 *
 * @param {string[]} lines
 * @returns {number} Zero-based index of the insertion point
 */
function findInsertionIndex(lines) {
  let i = 0;
  if (lines.length === 0) return 0;
  if (lines[0].startsWith('#!')) i++;
  // Skip blank + 'use strict' line
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || /^['"]use strict['"];?$/.test(t)) { i++; continue; }
    break;
  }
  return i;
}

/**
 * Compute the migration for a single file WITHOUT writing. The caller decides whether to
 * persist `newContent`. Scanner tags are required for the file; callers pass them in so this
 * module stays decoupled from disk except for the actual read/write operations in helpers.
 *
 * @param {string} filePath   - Absolute path
 * @param {string} projectRoot - Absolute project root (for relative-path reporting)
 * @param {CapTag[]} tags     - Scanner output for this file (legacy tags only)
 * @returns {FileMigrationResult}
 */
function planFileMigration(filePath, projectRoot, tags) {
  const rel = path.relative(projectRoot, filePath);
  /** @type {FileMigrationResult} */
  const result = {
    file: rel,
    changed: false,
    newContent: null,
    anchorBlock: null,
    consolidatedFeatures: [],
    consolidatedAcs: [],
    reason: 'no-feature-tags',
  };

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    result.reason = 'read-error';
    return result;
  }

  // Short-circuit: if the file already contains a unified anchor, leave it alone.
  const anchorTags = anchor.scanAnchorsInContent(content, rel);
  if (anchorTags.length > 0) {
    result.reason = 'already-has-anchor';
    return result;
  }

  // Group tags by feature. Non-feature-bound tags (@cap-risk, @cap-decision with no `feature`)
  // are intentionally ignored for consolidation.
  const byFeature = new Map();
  for (const t of tags) {
    const fid = t.metadata && t.metadata.feature;
    if (fid) {
      if (!byFeature.has(fid)) byFeature.set(fid, []);
      byFeature.get(fid).push(t);
      continue;
    }
    // @cap-todo with ac:F-XXX/AC-N (no feature key) — infer feature from ac prefix.
    if (t.type === 'todo' && t.metadata && typeof t.metadata.ac === 'string') {
      const m = t.metadata.ac.match(/^(F-\d{3,})\//);
      if (m) {
        const inferred = m[1];
        if (!byFeature.has(inferred)) byFeature.set(inferred, []);
        byFeature.get(inferred).push(t);
      }
    }
  }

  if (byFeature.size === 0) return result;

  // Build anchor lines per feature group. Stable order: features sorted alphanumerically.
  const featureIds = [...byFeature.keys()].sort();
  const style = commentStyleForFile(filePath);
  const anchorLines = [];
  for (const fid of featureIds) {
    const consolidated = consolidateGroup(fid, byFeature.get(fid));
    if (!consolidated) continue;
    anchorLines.push(anchor.emitAnchorBlock(consolidated, style));
    result.consolidatedFeatures.push(fid);
    for (const ac of consolidated.acs) {
      result.consolidatedAcs.push(`${fid}/${ac}`);
    }
  }

  if (anchorLines.length === 0) return result;

  const lines = content.split('\n');
  const insertAt = findInsertionIndex(lines);
  const newLines = [...lines];
  // Insert anchor lines + one trailing blank separator if the next line isn't already blank
  const needsSpacer = newLines[insertAt] !== undefined && newLines[insertAt].trim() !== '';
  const toInsert = needsSpacer ? [...anchorLines, ''] : [...anchorLines];
  newLines.splice(insertAt, 0, ...toInsert);

  result.changed = true;
  result.anchorBlock = anchorLines.join('\n');
  result.newContent = newLines.join('\n');
  result.reason = 'inserted';
  return result;
}

/**
 * Compute migrations for every file under the project. Does NOT write.
 *
 * @param {string} projectRoot
 * @param {{ extensions?: string[], exclude?: string[] }} [options]
 * @returns {FileMigrationResult[]}
 */
function planProjectMigration(projectRoot, options = {}) {
  // @cap-todo(ac:F-085/AC-1) The migrator builds (or accepts) the same scope filter as the
  //   scanner so both tools agree on which files are in scope. Passing it explicitly into
  //   scanDirectory short-circuits the scanner's default-build path.
  const scope = options.scope || scopeModule.buildScopeFilter(projectRoot, {
    dirExcludes: options.exclude,
    pathExcludes: options.pathExcludes,
    excludes: options.excludes,
    includes: options.includes,
    respectGitignore: options.respectGitignore,
  });
  // We want legacy tags only — force unifiedAnchors:false so the scan baseline is clean.
  const allTags = scanner.scanDirectory(projectRoot, { ...options, scope, unifiedAnchors: false });

  // Group tags by file
  const byFile = new Map();
  for (const t of allTags) {
    const abs = path.resolve(projectRoot, t.file);
    if (!byFile.has(abs)) byFile.set(abs, []);
    byFile.get(abs).push(t);
  }

  const results = [];
  for (const [abs, tags] of byFile.entries()) {
    results.push(planFileMigration(abs, projectRoot, tags));
  }
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Write planned migrations to disk. Only files flagged changed=true are touched.
 *
 * @param {FileMigrationResult[]} results
 * @param {string} projectRoot
 * @param {{ allowLargeDiff?: boolean }} [options]
 * @returns {{ written: string[], skipped: string[] }}
 */
function applyMigrations(results, projectRoot, options = {}) {
  // @cap-todo(ac:F-085/AC-7) Large-diff guard: bare --apply against >500 candidate files
  //   is almost always a scope-filter bug, not user intent. We throw with an actionable
  //   error so the caller can re-run with allowLargeDiff:true once the scope is verified.
  const changed = results.filter((r) => r.changed && r.newContent != null);
  if (changed.length > scopeModule.LARGE_DIFF_THRESHOLD && !options.allowLargeDiff) {
    const err = new Error(
      `cap-migrate-tags: refusing to apply migration to ${changed.length} files ` +
      `(threshold ${scopeModule.LARGE_DIFF_THRESHOLD}). This usually indicates a ` +
      `scope-filter problem — verify the dry-run report is what you intended, then ` +
      `re-run with allowLargeDiff:true to override.`
    );
    err.code = 'CAP_MIGRATE_LARGE_DIFF';
    err.changedCount = changed.length;
    err.threshold = scopeModule.LARGE_DIFF_THRESHOLD;
    throw err;
  }
  const written = [];
  const skipped = [];
  for (const r of results) {
    if (!r.changed || r.newContent == null) {
      skipped.push(r.file);
      continue;
    }
    const abs = path.resolve(projectRoot, r.file);
    fs.writeFileSync(abs, r.newContent, 'utf8');
    written.push(r.file);
  }
  return { written, skipped };
}

/**
 * Produce a human-readable dry-run report.
 *
 * @param {FileMigrationResult[]} results
 * @returns {string}
 */
function formatMigrationReport(results) {
  const changed = results.filter((r) => r.changed);
  const alreadyHas = results.filter((r) => r.reason === 'already-has-anchor');
  const noTags = results.filter((r) => r.reason === 'no-feature-tags');

  const lines = [];
  lines.push(`Migration plan — ${changed.length} file(s) would be updated:`);
  lines.push('');
  for (const r of changed) {
    lines.push(`  ${r.file}`);
    lines.push(`    anchor: ${r.anchorBlock}`);
    lines.push(`    consolidates: ${r.consolidatedAcs.join(', ') || '(feature-only, no ACs)'}`);
    lines.push('');
  }
  lines.push(`${alreadyHas.length} file(s) already use unified anchors; skipped.`);
  lines.push(`${noTags.length} file(s) had no feature-bound tags; skipped.`);
  return lines.join('\n').trimEnd();
}

module.exports = {
  commentStyleForFile,
  consolidateGroup,
  findInsertionIndex,
  planFileMigration,
  planProjectMigration,
  applyMigrations,
  formatMigrationReport,
};
