'use strict';

// @cap-feature(feature:F-085, primary:true) Scope filter shared by cap-tag-scanner and cap-migrate-tags.
//
// @cap-decision(F-085/AC-1) One module, two consumers. Scanner and migrator both walk the same
//   tree with the same exclusion semantics. Duplicating the rules in both modules drifts —
//   centralising them here keeps DEFAULT_DIR_EXCLUDES, DEFAULT_PATH_EXCLUDES and gitignore
//   handling consistent.
//
// @cap-decision(F-085/AC-2) Gitignore is honoured at scan-projectRoot only (not nested .gitignore
//   files). 99% of the noise on real repos is in top-level ignored dirs (.claude, node_modules,
//   coverage). Recursive .gitignore parsing would multiply complexity for marginal coverage.
//
// @cap-decision(F-085/AC-3) Path-pattern excludes are PREFIX-matched on relative paths (not full
//   glob). Patterns starting with `**/` are treated as suffix-anywhere. Real-world need is
//   covered by these two shapes; full glob would require a glob compiler we don't have.

const fs = require('node:fs');
const path = require('node:path');

// @cap-decision(F-085/AC-3) DEFAULT_DIR_EXCLUDES preserves the legacy basename-matched list from
//   cap-tag-scanner.cjs so the scanner's behaviour is byte-identical when no extra config is set.
const DEFAULT_DIR_EXCLUDES = Object.freeze([
  '.git', '.cap', '.planning',
  'node_modules', 'dist', 'build', 'coverage', 'out',
  '.next', '.turbo', '.nx', '.cache', '.parcel-cache', '.vercel', '.svelte-kit',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'venv', '.venv',
  'target', '.gradle', 'Pods', '.expo',
]);

// @cap-decision(F-085/AC-3, F-085/AC-4) DEFAULT_PATH_EXCLUDES catches three classes that
//   basename-matching alone misses:
//   - .claude/worktrees: agent worktrees, gitignored on most projects but defensive here too
//   - .claude/cap: plugin-self-mirror, would let migrate-tags rewrite the user-global install
//   - tests/fixtures (and **/fixtures/polyglot): scanner test inputs are intentionally raw-tagged
const DEFAULT_PATH_EXCLUDES = Object.freeze([
  '.claude/worktrees',
  '.claude/cap',
  'tests/fixtures',
  '**/fixtures/polyglot',
  '.cap/snapshots',
]);

// @cap-decision(F-085/AC-7) LARGE_DIFF_THRESHOLD is the count above which a destructive batch
//   operation (cap:migrate-tags --apply) requires an extra confirm gate. 500 was chosen by
//   inspecting the realistic worst-case in this repo (~89 legitimate files) and adding a 5x
//   margin. Apply against >500 files is almost always a scope-filter bug, never an intent.
const LARGE_DIFF_THRESHOLD = 500;

// ---------------------------------------------------------------------------
// Gitignore handling

// @cap-todo(ac:F-085/AC-2) parseGitignore returns an array of compiled matchers from the
//   project's top-level .gitignore. Negations (`!pattern`) are dropped with a quiet ignore;
//   gitignore precedence rules across multiple files are out of scope for the MVP.
/**
 * Parse a top-level `.gitignore` file into a list of matcher functions.
 *
 * Each matcher takes (relativePath, isDir) and returns true when the path is ignored.
 *
 * @param {string} projectRoot
 * @returns {Array<(relPath: string, isDir: boolean) => boolean>}
 */
function parseGitignore(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return [];
  const giPath = path.join(projectRoot, '.gitignore');
  let raw;
  try {
    raw = fs.readFileSync(giPath, 'utf8');
  } catch (_e) {
    return [];
  }
  const matchers = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('!')) continue; // negations not supported in MVP
    matchers.push(_compileGitignorePattern(line));
  }
  return matchers.filter((m) => m !== null);
}

// @cap-todo(ac:F-085/AC-2) _compileGitignorePattern handles the four common shapes seen in real
//   .gitignore files: `dir/`, `/anchored`, `*.ext`, `path/segment`. Anything more exotic falls
//   back to the literal-substring matcher rather than failing closed.
function _compileGitignorePattern(pattern) {
  let p = pattern;
  // Trailing slash → directory-only match
  let dirOnly = false;
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  // Leading slash → anchored at repo root
  let anchored = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }
  // No-glob fast path: literal segment (the dominant case: `node_modules`, `.claude`, `dist`)
  if (!p.includes('*') && !p.includes('?')) {
    return (relPath, isDir) => {
      if (dirOnly && !isDir) return false;
      if (anchored) {
        return relPath === p || relPath.startsWith(p + '/');
      }
      // Match anywhere: as a path component or a path prefix.
      const segments = relPath.split('/');
      if (segments.includes(p)) return true;
      return relPath === p || relPath.startsWith(p + '/');
    };
  }
  // Glob path: compile to regex. ** = any segments, * = within segment, ? = single char.
  const re = _globToRegex(p, { anchored });
  return (relPath, isDir) => {
    if (dirOnly && !isDir) return false;
    if (anchored) return re.test(relPath);
    // Unanchored glob: try against the full path AND any suffix that starts at a segment boundary.
    if (re.test(relPath)) return true;
    const segments = relPath.split('/');
    for (let i = 1; i < segments.length; i++) {
      if (re.test(segments.slice(i).join('/'))) return true;
    }
    return false;
  };
}

function _globToRegex(glob, opts) {
  let out = opts && opts.anchored ? '^' : '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 2;
      if (glob[i] === '/') i += 1;
    } else if (c === '*') {
      out += '[^/]*';
      i += 1;
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if ('.+()[]{}^$|\\'.includes(c)) {
      out += '\\' + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  out += '(?:/.*)?$';
  return new RegExp(out);
}

// ---------------------------------------------------------------------------
// Path-pattern matching for DEFAULT_PATH_EXCLUDES + user includes/excludes

function _matchPathPattern(relPath, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  // **/foo  →  match suffix anywhere in the tree
  if (pattern.startsWith('**/')) {
    const tail = pattern.slice(3);
    return relPath === tail || relPath.endsWith('/' + tail) || relPath.startsWith(tail + '/') || relPath.includes('/' + tail + '/');
  }
  // Plain prefix match against project-relative path
  return relPath === pattern || relPath.startsWith(pattern + '/');
}

// ---------------------------------------------------------------------------
// Plugin-self-mirror detection (F-085/AC-4)

// @cap-todo(ac:F-085/AC-4) Plugin-self-mirror = a directory under cwd that exact-mirrors
//   $HOME/.claude/cap/. Detected by walking up from the scanner's installed location and
//   checking whether projectRoot has the same nested layout. This protects users running CAP
//   from inside a clone of the CAP repo itself, where the mirror is real and writeable.
function detectPluginMirror(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  const candidate = path.join(projectRoot, '.claude', 'cap');
  try {
    const st = fs.statSync(candidate);
    if (!st.isDirectory()) return null;
  } catch (_e) {
    return null;
  }
  // Heuristic: if `.claude/cap/bin/` and `.claude/cap/commands/` both exist, this is the
  // plugin-self-mirror layout. (One of those alone could be a coincidence.)
  const binExists = fs.existsSync(path.join(candidate, 'bin'));
  const cmdExists = fs.existsSync(path.join(candidate, 'commands'));
  if (binExists && cmdExists) return path.relative(projectRoot, candidate).split(path.sep).join('/');
  return null;
}

// ---------------------------------------------------------------------------
// Public: buildScopeFilter

/**
 * @typedef {Object} ScopeFilterOptions
 * @property {string[]} [dirExcludes]      - Directory basenames to exclude. Defaults to DEFAULT_DIR_EXCLUDES.
 * @property {string[]} [pathExcludes]     - Project-relative path patterns to exclude. Defaults to DEFAULT_PATH_EXCLUDES.
 * @property {string[]} [includes]         - When non-empty, ONLY paths matching at least one include pattern pass.
 * @property {string[]} [excludes]         - User-supplied additional excludes (additive on top of pathExcludes).
 * @property {boolean}  [respectGitignore] - Default true. Set false for tests / sandbox runs.
 */

/**
 * @typedef {Object} ScopeFilter
 * @property {(absPath: string, isDir: boolean) => boolean} isExcluded
 * @property {(items: Array<string|{file:string}>) => Array<[string, number]>} bucketize
 * @property {string[]} pathExcludes
 * @property {string[]} dirExcludes
 * @property {string|null} pluginMirror
 */

/**
 * Build a scope filter for the given project root.
 *
 * The returned `isExcluded(absPath, isDir)` returns true when the path should be skipped by
 * downstream walkers. It is the single decision point used by both cap-tag-scanner and
 * cap-migrate-tags so their scope semantics never drift apart.
 *
 * @param {string} projectRoot
 * @param {ScopeFilterOptions} [options]
 * @returns {ScopeFilter}
 */
function buildScopeFilter(projectRoot, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const opts = options || {};
  const dirExcludes = new Set(opts.dirExcludes || DEFAULT_DIR_EXCLUDES);
  const userExcludes = Array.isArray(opts.excludes) ? opts.excludes : [];
  const pathExcludes = [...(opts.pathExcludes || DEFAULT_PATH_EXCLUDES), ...userExcludes];
  const includes = Array.isArray(opts.includes) ? opts.includes : [];
  const respectGitignore = opts.respectGitignore !== false;
  const gitignoreMatchers = respectGitignore ? parseGitignore(projectRoot) : [];

  const pluginMirror = detectPluginMirror(projectRoot);
  // If we detected a plugin mirror, ensure it's in pathExcludes (defense in depth — the
  // gitignore + DEFAULT_PATH_EXCLUDES already cover this, but a user could override both).
  if (pluginMirror && !pathExcludes.includes(pluginMirror)) {
    pathExcludes.push(pluginMirror);
  }

  function isExcluded(absPath, isDir) {
    const rel = path.relative(projectRoot, absPath).split(path.sep).join('/');
    // A path that's outside projectRoot is, by definition, not in scope.
    if (rel === '' || rel.startsWith('..')) return false;
    const baseName = path.basename(absPath);

    // 1. Directory-basename fast path (preserves legacy behaviour)
    if (isDir && dirExcludes.has(baseName)) return true;

    // 2. Path-pattern excludes (project-relative)
    for (const p of pathExcludes) {
      if (_matchPathPattern(rel, p)) return true;
    }

    // 3. Gitignore matchers
    for (const m of gitignoreMatchers) {
      if (m(rel, !!isDir)) return true;
    }

    // 4. Includes are a positive filter: when set, only matches pass
    if (includes.length > 0) {
      let matched = false;
      for (const p of includes) {
        if (_matchPathPattern(rel, p)) { matched = true; break; }
      }
      if (!matched) return true;
    }

    return false;
  }

  function bucketize(items) {
    const buckets = new Map();
    for (const it of items) {
      const p = typeof it === 'string' ? it : (it && typeof it.file === 'string' ? it.file : '');
      if (p === '') continue;
      const top = p.split('/').slice(0, 2).join('/');
      buckets.set(top, (buckets.get(top) || 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  }

  return {
    isExcluded,
    bucketize,
    pathExcludes,
    dirExcludes: [...dirExcludes],
    pluginMirror,
  };
}

module.exports = {
  buildScopeFilter,
  parseGitignore,
  detectPluginMirror,
  DEFAULT_DIR_EXCLUDES,
  DEFAULT_PATH_EXCLUDES,
  LARGE_DIFF_THRESHOLD,
  // Internal helpers exported for unit tests.
  _matchPathPattern,
  _compileGitignorePattern,
  _globToRegex,
};
