// @cap-feature(feature:F-083, primary:true) Monorepo aggregation module — extracted from
//   cap-feature-map.cjs in F-083. Hosts the Rescoped-Table reader, the directory-walk discoverer,
//   the cross-sub-app aggregator, the auto-redirect helper, and the per-scope batch-enrichment
//   helpers. Public API is re-exported from cap-feature-map.cjs (zero call-site change).
// @cap-decision(F-083/cycle) Lazy-require both directions: this module's _core() and
//   cap-feature-map.cjs's _monorepo() are mirror accessors invoked INSIDE function bodies
//   (never at module top-level). AC-6 static-analysis test pins the no-cycle contract.
// @cap-constraint Zero external dependencies — Node.js built-ins only (fs, path).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// @cap-decision(F-083/followup) F-083-FIX-A: shared constants moved to cap-feature-map-internals.cjs
//   to eliminate the duplicated `FEATURE_MAP_FILE` declaration with cap-feature-map.cjs.
//   Single source of truth — future-drift impossible by construction.
const { FEATURE_MAP_FILE } = require('./cap-feature-map-internals.cjs');

// @cap-todo(ac:F-083/AC-6) Lazy accessor for cap-feature-map.cjs — required INSIDE function
//   bodies, NEVER at module top-level. Memoized so cached-require cost is paid once per process.
let _coreCache = null;
function _core() {
  if (!_coreCache) _coreCache = require('./cap-feature-map.cjs');
  return _coreCache;
}

// @cap-feature(feature:F-082) parseRescopedTable — read-side counterpart to rescopeFeatures
//   writer. Detects the "Rescoped Feature Maps" section in root FEATURE-MAP.md and extracts
//   the listed sub-app paths.
// @cap-decision(F-082/AC-1) The header is matched case-insensitively but anchored on a markdown
//   header line (## or ###) followed by literal "Rescoped Feature Maps". This avoids false
//   positives when an AC description happens to mention the phrase in prose.
// @cap-decision(F-082/AC-1) Each table row's first column may be either a backtick-quoted path
//   ("`apps/web/`") or a plain-text path. Trailing slash is tolerated and stripped. Markdown
//   link syntax `[apps/web](apps/web/FEATURE-MAP.md)` is also accepted — that's the form the
//   /cap:rescope writer is expected to emit when writing the table back.
// @cap-todo(ac:F-083/AC-1) Exported from this module as part of the F-083 split surface.
/**
 * @param {string} content - Raw FEATURE-MAP.md content
 * @returns {Array<{appPath: string, line: number}>} - Sub-app paths in declaration order
 */
function parseRescopedTable(content) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const lines = content.split('\n');
  const headerRE = /^#{2,4}\s+Rescoped\s+Feature\s+Maps\s*$/i;
  let inSection = false;
  let inTable = false;
  /** @type {Array<{appPath: string, line: number}>} */
  const entries = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (headerRE.test(line)) {
      inSection = true;
      inTable = false;
      continue;
    }
    if (!inSection) continue;
    // Exit the section on the next markdown header.
    if (/^#{1,6}\s+/.test(line)) {
      if (inSection && !headerRE.test(line)) {
        inSection = false;
        inTable = false;
      }
      continue;
    }
    // Recognise table header / separator.
    if (/^\|.*\|$/.test(line)) {
      // table separator line "|---|---|"
      if (/^\|[\s:-]+\|/.test(line)) {
        inTable = true;
        continue;
      }
      // table header line — typically "| App | Features | …"
      if (!inTable && /^\|\s*App\b/i.test(line)) {
        continue;
      }
      // table data row
      if (inTable) {
        const cells = line.slice(1, -1).split('|').map(c => c.trim());
        if (cells.length === 0) continue;
        // @cap-decision(F-082/AC-1) Prefer the cell that looks most path-like (contains "/"
        //   or starts with "apps/"/"packages/"). The Rescoped Table writer (rescopeFeatures)
        //   emits the path in column 2 ("| App | Path | Features |"), but legacy hand-written
        //   tables sometimes put the path in column 1. Walking the row and picking the most
        //   path-like cell keeps both shapes working.
        let extracted = null;
        for (const c of cells) {
          const candidate = _extractAppPath(c);
          if (!candidate) continue;
          if (candidate.includes('/') || /^(apps|packages)$/i.test(candidate.split('/')[0])) {
            extracted = candidate;
            break;
          }
          if (!extracted) extracted = candidate;
        }
        if (!extracted) continue;
        if (seen.has(extracted)) continue;
        seen.add(extracted);
        entries.push({ appPath: extracted, line: i + 1 });
        continue;
      }
    }
    // Bullet form fallback: "- `apps/web/`" or "- apps/web/FEATURE-MAP.md".
    const bullet = line.match(/^[\s]*[-*]\s+(.+?)\s*$/);
    if (bullet) {
      const extracted = _extractAppPath(bullet[1]);
      if (extracted && !seen.has(extracted)) {
        seen.add(extracted);
        entries.push({ appPath: extracted, line: i + 1 });
      }
    }
  }
  return entries;
}

/**
 * Extract a normalized app path from one cell of the Rescoped table or a bullet line.
 * Tolerates: backtick-quoted, markdown link, trailing slash, "FEATURE-MAP.md" suffix.
 * @param {string} raw
 * @returns {string|null}
 */
function _extractAppPath(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  // Markdown link: [label](apps/web/FEATURE-MAP.md) -> use the URL.
  const linkMatch = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (linkMatch) s = linkMatch[1].trim();
  // Backtick-quoted.
  const tickMatch = s.match(/^`([^`]+)`$/);
  if (tickMatch) s = tickMatch[1].trim();
  // Strip "/FEATURE-MAP.md" suffix.
  s = s.replace(/\/?FEATURE-MAP\.md$/i, '');
  // Strip trailing slash.
  s = s.replace(/\/+$/, '');
  if (!s) return null;
  // @cap-risk(F-082) Reject absolute paths and parent-dir traversal — only relative paths
  //   anchored within the project root make sense here. Defense in depth; the caller will
  //   re-validate when resolving against projectRoot.
  if (path.isAbsolute(s)) return null;
  if (s.split('/').some(seg => seg === '..' || seg === '')) return null;
  return s;
}

// @cap-feature(feature:F-082) discoverSubAppFeatureMaps — opt-in directory walk for
//   `apps/*/FEATURE-MAP.md` and `packages/*/FEATURE-MAP.md` when
//   `cap.config.json:featureMaps.discover === "auto"`.
// @cap-decision(F-082/AC-3) Walk only the standard monorepo conventions (`apps/*`, `packages/*`)
//   one level deep. Deeper walks invite directory traversal pathologies and the "table-only"
//   default already covers the explicit-opt-in case. Users with non-standard layouts are
//   expected to maintain a Rescoped Table.
// @cap-risk(F-082/path-traversal) We never accept user-supplied sub-app paths from config —
//   only paths discovered via fs.readdirSync inside `projectRoot` are returned. Defense in depth
//   against a poisoned `cap.config.json` — even if `featureMaps.discover` becomes a string like
//   "../../etc", we read it solely to gate the walk; we do NOT treat it as a path.
// @cap-todo(ac:F-083/AC-1) Exported from this module as part of the F-083 split surface.
/**
 * @param {string} projectRoot
 * @returns {Array<{appPath: string}>}
 */
function discoverSubAppFeatureMaps(projectRoot) {
  const targets = [];
  for (const top of ['apps', 'packages']) {
    const topDir = path.join(projectRoot, top);
    if (!fs.existsSync(topDir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(topDir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const sub = path.join(topDir, e.name);
      const fmPath = path.join(sub, FEATURE_MAP_FILE);
      if (!fs.existsSync(fmPath)) continue;
      // Defense-in-depth: ensure the resolved path stays inside projectRoot.
      const resolved = path.resolve(sub);
      const root = path.resolve(projectRoot);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) continue;
      targets.push({ appPath: path.relative(projectRoot, sub).replace(/\\/g, '/') });
    }
  }
  return targets;
}

// @cap-feature(feature:F-082) aggregateSubAppFeatureMaps — merge per-sub-app feature lists
//   into a single map view. Each aggregated feature is a SHALLOW CLONE with `metadata.subApp`
//   set to the last path segment of the sub-app (e.g. `apps/web` -> `"web"`).
// @cap-decision(F-082/AC-2) Clone before annotating: the cached read result of any internal
//   call to readFeatureMap(subAppPath) must not be mutated. Mutation would leak runtime-only
//   `subApp` markers across separate read calls and silently change downstream behavior.
// @cap-decision(F-082/AC-7) Cross-sub-app duplicate detection runs AFTER each per-sub-app
//   parser has accepted its own map. The aggregated parseError keeps the same `code` as the
//   single-map case ('CAP_DUPLICATE_FEATURE_ID') so downstream handlers don't need a new
//   branch — the new fields (`firstSubApp`, `duplicateSubApp`, `firstFile`, `duplicateFile`)
//   are additive and safe to ignore.
// @cap-todo(ac:F-083/AC-1) Exported from this module as part of the F-083 split surface.
/**
 * @param {string} projectRoot
 * @param {import('./cap-feature-map.cjs').FeatureMap} rootResult - The parse result of the root FEATURE-MAP.md
 * @param {Array<{appPath: string}>} targets - Sub-app paths to aggregate
 * @param {{ safe?: boolean }} aggOptions
 * @returns {import('./cap-feature-map.cjs').FeatureMap}
 */
function aggregateSubAppFeatureMaps(projectRoot, rootResult, targets, aggOptions) {
  // @cap-todo(ac:F-083/AC-6) Lazy require — see _core() above.
  const { parseFeatureMapContent } = _core();
  const safe = Boolean(aggOptions && aggOptions.safe === true);
  /** @type {import('./cap-feature-map.cjs').Feature[]} */
  const merged = [];
  /** @type {Map<string, {subApp: string|null, file: string}>} */
  const seenIds = new Map();
  /** @type {import('./cap-feature-map.cjs').ParseError|undefined} */
  let aggParseError = rootResult && rootResult.parseError ? rootResult.parseError : undefined;
  let lastScan = rootResult ? rootResult.lastScan : null;
  // @cap-todo(ac:F-082/iter1 fix:2) Build a runtime-only sub-app prefix index (slug -> appPath).
  //   Used by mutation functions (updateFeatureState/setAcStatus/etc.) to auto-redirect a
  //   write that targets a sub-app feature when the caller did NOT supply appPath.
  // @cap-decision(F-082/iter1 fix:2) Underscore-prefixed (`_subAppPrefixes`) signals runtime-only,
  //   never persisted, mirroring `_inputFormat` and `metadata.subApp` runtime fields. Filtered
  //   away by the serializer (it never reads any underscore-prefixed key on the FeatureMap).
  // @cap-risk(F-082/iter1) Multiple sub-apps with the same trailing slug (e.g. `apps/web` and
  //   `vendor/web`) would collide in this map. Mitigation: first-wins semantics matches the
  //   classifier-side prefix map in cap-memory-migrate.cjs. The Rescoped Table is expected to
  //   use unique slugs in practice; collision is a config-smell that surfaces at write-time.
  /** @type {Map<string, string>} subApp slug -> sub-app relative prefix */
  const subAppPrefixes = new Map();

  // 1. Root-level features come first; they keep `metadata.subApp` undefined (root scope).
  for (const f of rootResult && Array.isArray(rootResult.features) ? rootResult.features : []) {
    const norm = String(f.id).toUpperCase().trim();
    seenIds.set(norm, { subApp: null, file: 'FEATURE-MAP.md' });
    merged.push(f);
  }

  // 2. For each sub-app, parse its FEATURE-MAP.md and merge its features.
  for (const target of targets) {
    const subAppRel = target.appPath;
    const subAppName = subAppRel.split('/').pop() || subAppRel;
    // @cap-todo(ac:F-082/iter1 fix:2) Index slug→appPath up-front so the prefix map is populated
    //   even for sub-apps with zero features (auto-redirect on a feature that exists in the
    //   sub-app but was added to the aggregated cache after this index was built — defensive).
    if (!subAppPrefixes.has(subAppName)) subAppPrefixes.set(subAppName, subAppRel);
    const subFmPath = path.join(projectRoot, subAppRel, FEATURE_MAP_FILE);
    if (!fs.existsSync(subFmPath)) {
      // @cap-todo(ac:F-082/AC-3) Missing sub-app file is warn-and-continue. The Rescoped
      //   Table may have been hand-edited or the sub-app deleted before the table was updated.
      continue;
    }
    let subContent;
    try {
      subContent = fs.readFileSync(subFmPath, 'utf8');
    } catch (_e) {
      continue;
    }
    if (!subContent || subContent.trim() === '') {
      // Empty sub-app file — treat as zero features, no error.
      continue;
    }
    /** @type {import('./cap-feature-map.cjs').FeatureMap} */
    let subResult;
    try {
      // @cap-decision(F-082/iter1 warn:5) Recursion guard is EXPLICIT-by-design: we call
      //   `parseFeatureMapContent` (raw-content parser, no I/O, no aggregation) — NOT
      //   `readFeatureMap`. The naming difference is the gate. If a future refactor renames
      //   or merges these two functions, the recursion-protection contract MUST be re-stated
      //   (e.g. via an explicit `_depth` argument or a "no-aggregation" parser flag).
      // @cap-risk(F-082/iter1) Pre-iter1 the gate was implicit (relied on knowing the two
      //   functions were different); this comment makes the contract testable at PR review.
      subResult = parseFeatureMapContent(subContent, { projectRoot, safe });
    } catch (e) {
      // strict-mode parser threw — propagate (matches single-map throw contract).
      throw e;
    }
    if (subResult.parseError && !aggParseError) {
      // First sub-app parseError wins; tag with the sub-app file location.
      aggParseError = {
        ...subResult.parseError,
        subApp: subAppRel,
      };
    }
    if (subResult.lastScan && !lastScan) lastScan = subResult.lastScan;

    const subRel = path.posix.join(subAppRel, FEATURE_MAP_FILE);
    for (const f of subResult.features || []) {
      const norm = String(f.id).toUpperCase().trim();
      if (seenIds.has(norm)) {
        // @cap-todo(ac:F-082/AC-7) Duplicate IDs across aggregated sub-app maps emit a loud,
        //   positioned error. No silent dedup — we surface BOTH origins so the user can
        //   navigate.
        const first = seenIds.get(norm);
        const message =
          `Duplicate feature ID across aggregated sub-app maps: ${f.id} ` +
          `(in ${subRel}) collides with ${f.id} (in ${first.file})`;
        const dupErr = {
          code: 'CAP_DUPLICATE_FEATURE_ID',
          message,
          duplicateId: norm,
          firstLine: 0,
          duplicateLine: 0,
          firstSubApp: first.subApp,
          duplicateSubApp: subAppName,
          firstFile: first.file,
          duplicateFile: subRel,
        };
        if (safe) {
          if (!aggParseError) aggParseError = dupErr;
          // do NOT push the duplicate; the first-write-wins rule keeps the merged map sane
          //   for downstream read-only consumers while parseError signals the conflict.
          continue;
        }
        const err = new Error(message);
        err.code = 'CAP_DUPLICATE_FEATURE_ID';
        err.duplicateId = norm;
        err.firstSubApp = first.subApp;
        err.duplicateSubApp = subAppName;
        err.firstFile = first.file;
        err.duplicateFile = subRel;
        throw err;
      }
      seenIds.set(norm, { subApp: subAppName, file: subRel });
      // @cap-todo(ac:F-082/AC-2) Shallow-clone + add runtime-only `metadata.subApp`. Source
      //   feature object is never mutated.
      // @cap-decision(F-082/AC-2 + F-081/_inputFormat) Use `metadata.subApp` (not a top-level
      //   `_subApp`) for parity with the brainstorm contract. The serializer-side filter strips
      //   it before write-back, mirroring the `_inputFormat` runtime-only pattern.
      // @cap-todo(ac:F-082/iter1 fix:3) Deep-clone all array fields. Stage-2 #3 found that the
      //   previous spread-only clone left `acs[]`, `files[]`, `dependencies[]`, `usesDesign[]`
      //   shared between the aggregated feature and the underlying parsed sub-app feature.
      //   Today the writer-filter masks the leak (sub-app features are stripped before serializing
      //   the root), but any future code path that exposes the aggregated map without the filter
      //   would silently mutate the source sub-app data on push/sort/splice.
      // @cap-decision(F-082/iter1 fix:3) Defense-in-depth at the trust boundary, applied F-076's
      //   "do not trust contained-by-convention" lesson. Cost: O(N+ACs) shallow-clones on read,
      //   negligible vs. file I/O — N≤200 features for a typical monorepo.
      // @cap-risk(F-082/iter1) AC entries themselves are deep-cloned via `{...a}`. Their fields
      //   (id, description, status) are primitives, so shallow object spread is sufficient.
      //   If AC schema gains nested objects later, this clone must be widened.
      const cloned = {
        ...f,
        acs: Array.isArray(f.acs) ? f.acs.map(a => ({ ...a })) : [],
        files: Array.isArray(f.files) ? [...f.files] : [],
        dependencies: Array.isArray(f.dependencies) ? [...f.dependencies] : [],
        usesDesign: Array.isArray(f.usesDesign) ? [...f.usesDesign] : [],
        metadata: { ...(f.metadata || {}), subApp: subAppName },
      };
      merged.push(cloned);
    }
  }

  /** @type {import('./cap-feature-map.cjs').FeatureMap} */
  const out = { features: merged, lastScan: lastScan || null };
  if (aggParseError) out.parseError = aggParseError;
  // @cap-todo(ac:F-082/iter1 fix:2) Expose the prefix index. Runtime-only, never persisted —
  //   the serializer never iterates underscore-prefixed top-level keys.
  // @cap-todo(ac:F-083/AC-5) `Object.defineProperty` non-enumerable contract preserved verbatim
  //   on the F-083 split: the property descriptor is identical to the pre-split definition
  //   (enumerable:false, writable:false, configurable:true). Pinned by AC-5 regression test.
  if (subAppPrefixes.size > 0) {
    Object.defineProperty(out, '_subAppPrefixes', {
      value: subAppPrefixes,
      enumerable: false, // Stage-2 lesson — keep enumeration clean for downstream consumers.
      writable: false,
      configurable: true,
    });
  }
  return out;
}

// @cap-feature(feature:F-082) extractRescopedBlock — pull the "## Rescoped Feature Maps"
//   section verbatim from existing FEATURE-MAP.md content.
/**
 * @param {string} content
 * @returns {string|null} - The block text (header line through the line BEFORE the next
 *   markdown header) or null if no Rescoped Feature Maps section exists.
 */
function extractRescopedBlock(content) {
  if (typeof content !== 'string' || content.length === 0) return null;
  const lines = content.split('\n');
  const headerRE = /^#{2,4}\s+Rescoped\s+Feature\s+Maps\s*$/i;
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRE.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  // Walk forward to the next markdown header at the same or higher level.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  // Trim trailing blank lines from the block.
  while (endIdx > startIdx + 1 && lines[endIdx - 1].trim() === '') endIdx--;
  return lines.slice(startIdx, endIdx).join('\n');
}

// @cap-feature(feature:F-082) injectRescopedBlock — re-insert the Rescoped Table block into
//   newly-serialized content immediately before the "## Legend" section (or before the
//   trailing footer if Legend is absent).
/**
 * @param {string} serialized
 * @param {string} block
 * @returns {string}
 */
function injectRescopedBlock(serialized, block) {
  const lines = serialized.split('\n');
  // Find the "## Legend" line; insertion point is immediately before it.
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Legend\s*$/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  if (insertAt === -1) {
    // No legend — append before the final footer "---" line if present.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === '---') {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt === -1) insertAt = lines.length;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  // Ensure a blank line separates the block from neighbours.
  if (before.length > 0 && before[before.length - 1].trim() !== '') before.push('');
  const blockLines = block.split('\n');
  return [...before, ...blockLines, '', ...after].join('\n');
}

// @cap-feature(feature:F-082) _maybeRedirectToSubApp — internal helper used by all
//   state-mutation functions (updateFeatureState, setAcStatus, setFeatureUsesDesign,
//   transitionWithReason via updateFeatureState). When the looked-up feature lives in a
//   sub-app (`metadata.subApp` set) and the caller did NOT pass appPath, we recurse with
//   the resolved sub-app appPath so the write lands in the correct file. Without this fix,
//   the writer-filter in writeFeatureMap silently drops the feature and the
//   mutation is a no-op.
// @cap-decision(F-082/iter1 fix:2) Sentinel-based control flow (`_NO_REDIRECT`) keeps the
//   helper composable: callers can compare the return against the sentinel to know whether
//   the redirect ran (use the result directly) or did not (fall through to the legacy code
//   path). Returning `null`/`undefined` would conflict with legitimate boolean return values
//   from the original mutation functions.
// @cap-risk(F-082/iter1) Recursion-loop guard: only triggers when `appPath` is null/undefined,
//   AND the recursion always passes a resolved appPath, so the recursive call cannot re-enter
//   this branch. F-077 lesson on infinite-loop guards applied.
// @cap-decision(F-083/cycle) `_NO_REDIRECT` symbol lives HERE, not in cap-feature-map.cjs.
//   Reason: it's only meaningful in the redirect protocol owned by this module. Core re-exports
//   it for backward compat (callers in updateFeatureState/setAcStatus/setFeatureUsesDesign
//   compare against it via the lazy-loaded reference).
const _NO_REDIRECT = Symbol('cap-feature-map._NO_REDIRECT');

/**
 * @param {string} projectRoot
 * @param {import('./cap-feature-map.cjs').FeatureMap} featureMap - aggregated map (carries `_subAppPrefixes`)
 * @param {import('./cap-feature-map.cjs').Feature} feature - looked-up feature
 * @param {string|null|undefined} appPath - caller-supplied app path
 * @param {string} fnName - calling function name for warn message
 * @param {(resolvedAppPath: string) => any} recurse - bound recursion into the same fn
 * @returns {any} - either the recursed result or the `_NO_REDIRECT` sentinel
 */
function _maybeRedirectToSubApp(projectRoot, featureMap, feature, appPath, fnName, recurse) {
  // @cap-todo(ac:F-083/AC-6) Lazy require for _safeForError — keeps the cycle dormant.
  const { _safeForError } = _core();
  // Caller already supplied appPath — never redirect (would loop or override caller intent).
  if (appPath) return _NO_REDIRECT;
  // Feature is root-direct — legacy path is correct.
  if (!(feature && feature.metadata && feature.metadata.subApp)) return _NO_REDIRECT;

  const subApp = feature.metadata.subApp;
  const prefixes = featureMap && featureMap._subAppPrefixes;
  const resolvedAppPath = prefixes && typeof prefixes.get === 'function' ? prefixes.get(subApp) : null;
  if (resolvedAppPath) {
    // @cap-todo(ac:F-082/iter1 fix:2) Auto-redirect via the prefix map populated by the aggregator.
    return recurse(resolvedAppPath);
  }
  // No prefix resolution available → loud structured rejection (defense-in-depth path).
  // @cap-decision(F-082/followup) ANSI-defense: subApp is a path-derived slug from
  //   metadata.subApp; while the parser's slug-regex rejects controls today, we still wrap
  //   in _safeForError as defense-in-depth (mirrors F-076/F-081 doctrine).
  console.warn(
    'cap: ' + _safeForError(fnName) + '("' + _safeForError(feature.id) +
    '") skipped — feature lives in sub-app "' + _safeForError(subApp) +
    '" but no sub-app path could be resolved; pass appPath explicitly to persist.'
  );
  return false;
}

// @cap-feature(feature:F-082) _enrichFromTagsAcrossSubApps — internal monorepo split.
//   Groups features by `metadata.subApp` and runs enrichment per scope (root + each sub-app),
//   re-reading + re-writing each scope's FEATURE-MAP.md independently. Stage-2 #1 fix.
// @cap-decision(F-082/iter1 fix:1) Re-read each sub-app via `readFeatureMap(root, appPath)` so
//   the per-scope mutation operates on a single-map view (no aggregation, no writer-filter
//   surprises). The aggregated map is used only as the index of which features live where.
// @cap-todo(ac:F-083/AC-1) Exported from this module as part of the F-083 split surface.
/**
 * @param {string} projectRoot
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults
 * @param {import('./cap-feature-map.cjs').FeatureMap} aggregatedMap - aggregated map carrying `_subAppPrefixes` and
 *   `metadata.subApp` per feature
 * @returns {import('./cap-feature-map.cjs').FeatureMap} - the aggregated map (re-read post-write so callers see fresh state)
 */
function _enrichFromTagsAcrossSubApps(projectRoot, scanResults, aggregatedMap) {
  // @cap-todo(ac:F-083/AC-6) Lazy require — see _core() above.
  const { readFeatureMap, writeFeatureMap, _safeForError } = _core();
  // Group features by subApp slug (null = root-direct).
  /** @type {Map<string|null, Set<string>>} */
  const featureIdsByScope = new Map();
  featureIdsByScope.set(null, new Set());
  for (const f of aggregatedMap.features || []) {
    const scope = (f.metadata && f.metadata.subApp) || null;
    if (!featureIdsByScope.has(scope)) featureIdsByScope.set(scope, new Set());
    featureIdsByScope.get(scope).add(f.id);
  }

  const prefixes = aggregatedMap._subAppPrefixes;

  // @cap-decision(F-082/followup) Best-effort batch-write logging. Per-scope writes are NOT
  //   atomic across the N sub-app maps (true 2-phase commit across N files is out of scope).
  //   We track which scopes wrote successfully and which failed, then emit a single summary
  //   warn after the loop so partial-write is never silent. The per-scope try/catch keeps a
  //   late EROFS / EACCES from aborting writes for healthy sibling scopes.
  /** @type {string[]} */ const written = [];
  /** @type {{scope: string, error: string}[]} */ const failed = [];

  // For each scope, perform a single-map enrichment + write.
  for (const [scope, idsInScope] of featureIdsByScope) {
    if (idsInScope.size === 0) continue;
    const scopedAppPath = scope ? (prefixes ? prefixes.get(scope) : null) : null;
    if (scope && !scopedAppPath) {
      // Sub-app slug present but prefix could not be resolved — defensive skip.
      // @cap-decision(F-082/followup) ANSI-defense via _safeForError on user-controlled scope slug.
      console.warn('cap: enrichFromTags — sub-app "' + _safeForError(scope) + '" prefix unresolved; tags for that scope skipped.');
      continue;
    }
    const scopedMap = readFeatureMap(projectRoot, scopedAppPath || undefined, { safe: true });
    if (scopedMap.parseError) {
      // @cap-decision(F-082/followup) ANSI-defense via _safeForError on scope + parseError.message.
      console.warn('cap: enrichFromTags — skipping scope "' + _safeForError(scope || 'root') + '": ' + _safeForError(scopedMap.parseError.message));
      continue;
    }
    let mutated = false;
    for (const tag of scanResults) {
      if (tag.type !== 'feature') continue;
      const featureId = tag.metadata.feature;
      if (!featureId) continue;
      if (!idsInScope.has(featureId)) continue; // feature lives in a different scope
      const feature = scopedMap.features.find(f => f.id === featureId);
      if (!feature) continue;
      if (!feature.files.includes(tag.file)) {
        feature.files.push(tag.file);
        mutated = true;
      }
    }
    if (mutated) {
      const scopeLabel = scope || 'root';
      try {
        writeFeatureMap(projectRoot, scopedMap, scopedAppPath || undefined);
        written.push(scopeLabel);
      } catch (e) {
        failed.push({ scope: scopeLabel, error: (e && e.message) ? e.message : String(e) });
      }
    }
  }

  // @cap-decision(F-082/followup) Summary warn fires only when at least one scope FAILED;
  //   keeps the happy-path silent. Includes both the failed and the (still-)written scopes
  //   so the user has actionable diagnostics — they know exactly which FEATURE-MAP files
  //   did and did not get the new file refs.
  if (failed.length > 0) {
    const failedSummary = failed.map(f => '"' + _safeForError(f.scope) + '" (' + _safeForError(f.error) + ')').join(', ');
    const writtenSummary = written.length > 0 ? written.map(s => '"' + _safeForError(s) + '"').join(', ') : '(none)';
    console.warn(
      'cap: enrichFromTags — partial write: ' + failed.length + ' scope(s) failed: ' + failedSummary +
      '; ' + written.length + ' scope(s) written: ' + writtenSummary
    );
  }

  // Return a fresh aggregated read so callers see the post-write state.
  return readFeatureMap(projectRoot, undefined, { safe: true });
}

// @cap-feature(feature:F-082) _enrichFromDesignTagsAcrossSubApps — monorepo split for design tags.
//   Same lesson + structure as _enrichFromTagsAcrossSubApps. The file→featureId index is built
//   once from the aggregated map, then per-scope writes apply only the design IDs whose owning
//   feature lives in that scope.
// @cap-todo(ac:F-083/AC-1) Exported from this module as part of the F-083 split surface.
/**
 * @param {string} projectRoot
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults
 * @param {import('./cap-feature-map.cjs').FeatureMap} aggregatedMap
 * @returns {import('./cap-feature-map.cjs').FeatureMap}
 */
function _enrichFromDesignTagsAcrossSubApps(projectRoot, scanResults, aggregatedMap) {
  // @cap-todo(ac:F-083/AC-6) Lazy require — see _core() above.
  const { readFeatureMap, writeFeatureMap, _safeForError } = _core();
  /** @type {Map<string|null, Set<string>>} */
  const featureIdsByScope = new Map();
  featureIdsByScope.set(null, new Set());
  for (const f of aggregatedMap.features || []) {
    const scope = (f.metadata && f.metadata.subApp) || null;
    if (!featureIdsByScope.has(scope)) featureIdsByScope.set(scope, new Set());
    featureIdsByScope.get(scope).add(f.id);
  }

  // file→featureId index (matches the legacy single-scope behavior).
  const fileToFeature = new Map();
  for (const tag of scanResults) {
    if (tag.type !== 'feature') continue;
    const fid = tag.metadata && tag.metadata.feature;
    if (!fid) continue;
    if (!fileToFeature.has(tag.file)) fileToFeature.set(tag.file, fid);
  }

  const prefixes = aggregatedMap._subAppPrefixes;

  // @cap-decision(F-082/followup) Best-effort batch-write logging — see
  //   _enrichFromTagsAcrossSubApps for the full reasoning.
  /** @type {string[]} */ const written = [];
  /** @type {{scope: string, error: string}[]} */ const failed = [];

  for (const [scope, idsInScope] of featureIdsByScope) {
    if (idsInScope.size === 0) continue;
    const scopedAppPath = scope ? (prefixes ? prefixes.get(scope) : null) : null;
    if (scope && !scopedAppPath) {
      // @cap-decision(F-082/followup) ANSI-defense via _safeForError on user-controlled scope slug.
      console.warn('cap: enrichFromDesignTags — sub-app "' + _safeForError(scope) + '" prefix unresolved; design tags for that scope skipped.');
      continue;
    }
    const scopedMap = readFeatureMap(projectRoot, scopedAppPath || undefined, { safe: true });
    if (scopedMap.parseError) {
      // @cap-decision(F-082/followup) ANSI-defense via _safeForError on scope + parseError.message.
      console.warn('cap: enrichFromDesignTags — skipping scope "' + _safeForError(scope || 'root') + '": ' + _safeForError(scopedMap.parseError.message));
      continue;
    }
    let mutated = false;
    for (const tag of scanResults) {
      if (tag.type !== 'design-token' && tag.type !== 'design-component') continue;
      const designId = tag.metadata && tag.metadata.id;
      if (!designId) continue;
      const featureId = fileToFeature.get(tag.file);
      if (!featureId) continue;
      if (!idsInScope.has(featureId)) continue;
      const feature = scopedMap.features.find(f => f.id === featureId);
      if (!feature) continue;
      if (!Array.isArray(feature.usesDesign)) feature.usesDesign = [];
      if (!feature.usesDesign.includes(designId)) {
        feature.usesDesign.push(designId);
        mutated = true;
      }
    }
    if (mutated) {
      for (const f of scopedMap.features) {
        if (Array.isArray(f.usesDesign)) f.usesDesign.sort();
      }
      const scopeLabel = scope || 'root';
      try {
        writeFeatureMap(projectRoot, scopedMap, scopedAppPath || undefined);
        written.push(scopeLabel);
      } catch (e) {
        failed.push({ scope: scopeLabel, error: (e && e.message) ? e.message : String(e) });
      }
    }
  }

  // @cap-decision(F-082/followup) Partial-write summary mirrors _enrichFromTagsAcrossSubApps.
  if (failed.length > 0) {
    const failedSummary = failed.map(f => '"' + _safeForError(f.scope) + '" (' + _safeForError(f.error) + ')').join(', ');
    const writtenSummary = written.length > 0 ? written.map(s => '"' + _safeForError(s) + '"').join(', ') : '(none)';
    console.warn(
      'cap: enrichFromDesignTags — partial write: ' + failed.length + ' scope(s) failed: ' + failedSummary +
      '; ' + written.length + ' scope(s) written: ' + writtenSummary
    );
  }

  return readFeatureMap(projectRoot, undefined, { safe: true });
}

// @cap-api initAppFeatureMap(projectRoot, appPath) -- Create FEATURE-MAP.md for a specific app in a monorepo.
// Idempotent: does not overwrite existing FEATURE-MAP.md.
// @cap-decision(F-083/balance) Moved to monorepo module — sub-app FEATURE-MAP creation is a
//   monorepo-only concern; nothing in single-scope mode triggers it.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} appPath - Relative app path (e.g., "apps/flow")
 * @returns {boolean} - True if created, false if already existed
 */
function initAppFeatureMap(projectRoot, appPath) {
  // @cap-todo(ac:F-083/AC-6) Lazy require — see _core() above.
  const { generateTemplate } = _core();
  const baseDir = path.join(projectRoot, appPath);
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  if (fs.existsSync(filePath)) return false;
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(filePath, generateTemplate(), 'utf8');
  return true;
}

// @cap-api listAppFeatureMaps(projectRoot) -- Find all FEATURE-MAP.md files in a monorepo.
// Returns array of relative paths to directories containing FEATURE-MAP.md.
// @cap-decision(F-083/balance) Moved to monorepo module — pure monorepo discovery utility.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string[]} - Relative directory paths that contain FEATURE-MAP.md (e.g., [".", "apps/flow", "packages/ui"])
 */
function listAppFeatureMaps(projectRoot) {
  const results = [];
  if (fs.existsSync(path.join(projectRoot, FEATURE_MAP_FILE))) results.push('.');
  const excludeDirs = new Set(['node_modules', '.git', '.cap', 'dist', 'build', 'coverage', '.planning']);

  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (excludeDirs.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const fmPath = path.join(fullPath, FEATURE_MAP_FILE);
      if (fs.existsSync(fmPath)) results.push(path.relative(projectRoot, fullPath));
      walk(fullPath, depth + 1);
    }
  }
  walk(projectRoot, 0);
  return results;
}

// @cap-feature(feature:F-082) rescopeFeatures — write-side counterpart to parseRescopedTable.
// @cap-decision(F-083/balance) Moved to monorepo module — distributing root features into
//   per-app FEATURE-MAP.md files is by-definition a monorepo operation. The function uses
//   readFeatureMap and writeFeatureMap, both lazy-required from core.
/**
 * Rescope a root FEATURE-MAP.md into per-app Feature Maps in a monorepo.
 * Distributes features to apps based on file references (feature.files paths).
 * Features with no file refs or cross-app refs stay at root.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string[]} appPaths - List of app relative paths (e.g., ["apps/flow", "apps/hub"])
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, report changes without writing
 * @returns {{ appsCreated: number, featuresDistributed: number, featuresKeptAtRoot: number, distribution: Object }}
 */
function rescopeFeatures(projectRoot, appPaths, options = {}) {
  // @cap-todo(ac:F-083/AC-6) Lazy require — see _core() above.
  const { readFeatureMap, writeFeatureMap } = _core();
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const rootMap = readFeatureMap(projectRoot, undefined, { safe: true });
  if (rootMap.parseError) {
    console.warn('cap: rescopeFeatures aborted — duplicate feature ID detected: ' + String(rootMap.parseError.message).trim());
    return { appsCreated: 0, featuresDistributed: 0, featuresKeptAtRoot: 0, distribution: {}, parseError: rootMap.parseError };
  }
  if (!rootMap.features || rootMap.features.length === 0) {
    return { appsCreated: 0, featuresDistributed: 0, featuresKeptAtRoot: 0, distribution: {} };
  }

  // Build distribution: which features belong to which app
  const distribution = {}; // appPath -> features[]
  const rootFeatures = []; // features that stay at root (no refs or cross-app)

  for (const feature of rootMap.features) {
    if (!feature.files || feature.files.length === 0) {
      rootFeatures.push(feature);
      continue;
    }
    // Determine which app this feature belongs to based on file paths
    const appCounts = {}; // appPath -> count of matching files
    for (const file of feature.files) {
      for (const appPath of appPaths) {
        if (file.startsWith(appPath + '/') || file.startsWith(appPath + path.sep)) {
          appCounts[appPath] = (appCounts[appPath] || 0) + 1;
        }
      }
    }
    const entries = Object.entries(appCounts);
    if (entries.length === 0) {
      rootFeatures.push(feature);
    } else if (entries.length === 1) {
      const [appPath] = entries[0];
      if (!distribution[appPath]) distribution[appPath] = [];
      distribution[appPath].push(feature);
    } else {
      entries.sort((a, b) => b[1] - a[1]);
      const primaryApp = entries[0][0];
      if (!distribution[primaryApp]) distribution[primaryApp] = [];
      distribution[primaryApp].push(feature);
    }
  }

  if (options.dryRun) {
    let totalDistributed = 0;
    for (const features of Object.values(distribution)) totalDistributed += features.length;
    return {
      appsCreated: Object.keys(distribution).length,
      featuresDistributed: totalDistributed,
      featuresKeptAtRoot: rootFeatures.length,
      distribution: Object.fromEntries(
        Object.entries(distribution).map(([app, features]) => [app, features.map(f => f.id)])
      ),
    };
  }

  // Write per-app Feature Maps
  let appsCreated = 0;
  let featuresDistributed = 0;

  for (const [appPath, features] of Object.entries(distribution)) {
    const appDir = path.join(projectRoot, appPath);
    if (!fs.existsSync(appDir)) continue;

    // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
    const existingMap = readFeatureMap(projectRoot, appPath, { safe: true });
    if (existingMap.parseError) {
      console.warn('cap: rescopeFeatures skipping app "' + appPath + '" — duplicate feature ID detected: ' + String(existingMap.parseError.message).trim());
      continue;
    }
    const existingIds = new Set(existingMap.features.map(f => f.id));

    // Re-number features for the app (F-001, F-002, ...)
    let nextId = existingMap.features.length + 1;
    for (const feature of features) {
      if (existingIds.has(feature.id)) continue;
      const appRelativeFiles = feature.files
        .filter(f => f.startsWith(appPath + '/'))
        .map(f => f.slice(appPath.length + 1));
      const otherFiles = feature.files.filter(f => !f.startsWith(appPath + '/'));
      const appFeature = {
        ...feature,
        id: `F-${String(nextId).padStart(3, '0')}`,
        files: [...appRelativeFiles, ...otherFiles],
        metadata: { ...feature.metadata, originalId: feature.id },
      };
      existingMap.features.push(appFeature);
      nextId++;
      featuresDistributed++;
    }

    writeFeatureMap(projectRoot, existingMap, appPath);
    appsCreated++;
  }

  // Rewrite root Feature Map with only root features
  const newRootMap = { features: rootFeatures, lastScan: rootMap.lastScan };
  writeFeatureMap(projectRoot, newRootMap);

  return {
    appsCreated,
    featuresDistributed,
    featuresKeptAtRoot: rootFeatures.length,
    distribution: Object.fromEntries(
      Object.entries(distribution).map(([app, features]) => [app, features.map(f => f.id)])
    ),
  };
}

module.exports = {
  // F-083/AC-1 — exact six-name surface called out in the AC plus their helpers.
  parseRescopedTable,
  discoverSubAppFeatureMaps,
  aggregateSubAppFeatureMaps,
  _enrichFromTagsAcrossSubApps,
  _enrichFromDesignTagsAcrossSubApps,
  _maybeRedirectToSubApp,
  // F-082 helpers used by writeFeatureMap (lazy-loaded from cap-feature-map.cjs).
  extractRescopedBlock,
  injectRescopedBlock,
  // F-082 sentinel — owned by the redirect protocol; re-exported by core for back-compat.
  _NO_REDIRECT,
  // F-083/balance — additional monorepo helpers moved out of core to land core under 1500 LOC.
  initAppFeatureMap,
  listAppFeatureMaps,
  rescopeFeatures,
};
