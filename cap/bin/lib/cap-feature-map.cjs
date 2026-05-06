// @cap-context CAP v2.0 Feature Map reader/writer -- FEATURE-MAP.md is the single source of truth for all features, ACs, status, and dependencies.
// @cap-decision Markdown format for Feature Map (not JSON/YAML) -- human-readable, diffable in git, editable in any text editor. Machine-readable via regex parsing of structured table rows.
// @cap-decision Read and write are separate operations -- no in-memory mutation API. Read returns structured data, write takes structured data and serializes to markdown.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @cap-pattern Feature Map is the bridge between all CAP workflows. Brainstorm writes entries, scan updates status, status reads for dashboard.

'use strict';

// @cap-feature(feature:F-002) Feature Map Management — read/write/enrich FEATURE-MAP.md as single source of truth
// @cap-feature(feature:F-081) Multi-Format Feature Map Parser — Union ID regex (F-NNN | F-LONGFORM), bullet-style ACs, config-driven format selection
// @cap-feature(feature:F-082) Aggregate Feature Maps Across Monorepo Sub-Apps — readFeatureMap transparently merges sub-app maps via Rescoped Table or opt-in directory walk

const fs = require('node:fs');
const path = require('node:path');

const FEATURE_MAP_FILE = 'FEATURE-MAP.md';

// @cap-feature(feature:F-081) Union Feature-ID pattern: legacy F-NNN (3+ digits) OR long-form F-UPPERCASE
// @cap-decision(F-081/AC-1) The pattern is intentionally anchored on both ends; the second branch
//   `[A-Z][A-Z0-9_-]*` requires uppercase first char so digit-leading slugs like `F-076-suffix`
//   continue to be REJECTED — preserves the F-076 schema invariant proven by cap-memory-schema tests.
// @cap-risk(reason:regex-asymmetry) The narrow header regex `featureHeaderRE` historically used `\d{3}`;
//   widening it to the union must NOT also widen `getNextFeatureId`'s sequence detection (which only
//   considers numeric IDs for next-id allocation). Long-form IDs are user-named and never auto-generated.
const FEATURE_ID_PATTERN = /^F-(?:\d{3,}|[A-Z][A-Z0-9_-]*)$/;

// @cap-todo(ref:AC-9) Feature state lifecycle: planned -> prototyped -> tested -> shipped
const VALID_STATES = ['planned', 'prototyped', 'tested', 'shipped'];
const STATE_TRANSITIONS = {
  planned: ['prototyped'],
  prototyped: ['tested'],
  tested: ['shipped'],
  shipped: [],
};

/**
 * @typedef {Object} AcceptanceCriterion
 * @property {string} id - AC identifier (e.g., "AC-1")
 * @property {string} description - Imperative description text
 * @property {'pending'|'implemented'|'tested'|'reviewed'} status - Current status
 */

/**
 * @typedef {Object} Feature
 * @property {string} id - Feature ID (e.g., "F-001")
 * @property {string} title - Feature title (verb+object format)
 * @property {'planned'|'prototyped'|'tested'|'shipped'} state - Feature lifecycle state
 * @property {AcceptanceCriterion[]} acs - Acceptance criteria
 * @property {string[]} files - File references linked to this feature
 * @property {string[]} dependencies - Feature IDs this depends on
 * @property {string[]} usesDesign - F-063: DT-NNN / DC-NNN IDs that this feature references (default [])
 * @property {Object<string,string>} metadata - Additional key-value metadata
 */

/**
 * @typedef {Object} FeatureMap
 * @property {Feature[]} features - All features
 * @property {string} lastScan - ISO timestamp of last scan
 */

// @cap-todo(ref:AC-7) Feature Map is a single Markdown file at the project root named FEATURE-MAP.md

// @cap-todo(ref:AC-1) Generate empty FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries
/**
 * Generate the empty FEATURE-MAP.md template for /cap:init.
 * @returns {string}
 */
function generateTemplate() {
  return `# Feature Map

> Single source of truth for feature identity, state, acceptance criteria, and relationships.
> Auto-enriched by \`@cap-feature\` tags and dependency analysis.

## Features

<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: ${new Date().toISOString()}*
`;
}

// @cap-api readFeatureMap(projectRoot, appPath) -- Reads and parses FEATURE-MAP.md from project root or app subdirectory.
// Returns: FeatureMap object with features and lastScan timestamp.
// @cap-todo(ref:AC-10) Feature Map is the single source of truth for feature identity, state, ACs, and relationships
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string|null} [appPath=null] - Relative app path (e.g., "apps/flow"). If null, reads from projectRoot.
 * @param {{ safe?: boolean }} [options] - F-081/iter1: when `safe:true`, duplicate-id detection
 *   returns `{features, lastScan, parseError}` instead of throwing. Default false (legacy throw
 *   preserved — pinned by adversarial regression test "duplicate-on-disk causes readFeatureMap
 *   to throw with positioned error").
 * @returns {FeatureMap}
 */
function readFeatureMap(projectRoot, appPath, options) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  if (!fs.existsSync(filePath)) {
    return { features: [], lastScan: null };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  // @cap-todo(ac:F-081/AC-7) Forward projectRoot so parseFeatureMapContent can pick up
  //   .cap/config.json:featureMapStyle without each call site having to pre-load config.
  // @cap-todo(ac:F-081/iter1 fix:3) Forward `safe` opt-in. Default-strict preserves the existing
  //   adversarial test contract that `readFeatureMap` throws on duplicate; tooling that wants
  //   non-throwing semantics calls `readFeatureMap(root, app, { safe: true })`.
  // @cap-decision(F-081/iter1) Stage-2 #3 PARTIAL: API surface for safe-mode added; default
  //   remains strict (throw) so the pinned adversarial regression test continues to assert the
  //   original throw contract. Iter-2 (below) migrates the bare call sites to opt-in.
  // @cap-decision(F-081/iter2) Stage-2 #3 COMPLETE: All 17 internal library call sites and 21
  //   command-script call sites migrated to `{safe: true}` with parseError handling. Write-back
  //   functions (addFeature, updateFeatureState, setAcStatus, enrichFromTags, enrichFromDesignTags,
  //   setFeatureUsesDesign, rescopeFeatures, cap-migrate, cap-memory-migrate) bail on parseError
  //   to prevent persisting partial enrichment. Read-only consumers (detectDrift, cap-checkpoint,
  //   cap-completeness, cap-reconcile, cap-impact-analysis, cap-memory-graph, cap-thread-synthesis,
  //   commands/cap/*.md) warn-and-continue with the partial map.
  // @cap-risk(reason:user-controlled-id-in-warn-message) parseError.message includes the duplicate
  //   feature ID. The ID regex `[A-Z0-9_-]*` rejects ANSI escape characters, but each console.warn
  //   call still wraps the message in `String(...).trim()` as defense in depth. F-076/F-077 lesson.
  const safe = Boolean(options && options.safe === true);
  const rootResult = parseFeatureMapContent(content, { projectRoot, safe });

  // @cap-todo(ac:F-082/AC-1) Aggregation only triggers on ROOT-level reads (appPath null/undef).
  //   Sub-app reads (caller passed appPath explicitly) get the single map verbatim — the caller
  //   is targeting one sub-app deliberately and aggregation would be surprising.
  // @cap-decision(F-082/single-level-aggregation) Single-level only: root → sub-apps → features.
  //   A sub-app FEATURE-MAP.md with its own Rescoped Table is NOT recursively expanded — that
  //   would create cycles, bloat parser surface, and confuse the round-trip writer (which sub-app
  //   does a write-back belong to?). If a project legitimately needs nested workspaces, the user
  //   reads each sub-app explicitly via appPath.
  if (appPath) return rootResult;

  // @cap-todo(ac:F-082/AC-1) Detect "Rescoped Feature Maps" header in the root content; if found,
  //   parse the table to discover sub-app paths and aggregate transparently.
  const rescopedEntries = parseRescopedTable(content);

  // @cap-todo(ac:F-082/AC-3) Opt-in directory-walk fallback: when no Rescoped Table is present
  //   AND `.cap/config.json:featureMaps.discover === "auto"`, glob `apps/*/FEATURE-MAP.md`
  //   and `packages/*/FEATURE-MAP.md`. Default `"table-only"` preserves legacy single-map behavior.
  /** @type {Array<{appPath: string}>} */
  let aggregationTargets = rescopedEntries;
  if (aggregationTargets.length === 0) {
    const cfg = readCapConfig(projectRoot);
    const discoverMode =
      cfg && cfg.featureMaps && typeof cfg.featureMaps.discover === 'string'
        ? cfg.featureMaps.discover
        : 'table-only';
    if (discoverMode === 'auto') {
      aggregationTargets = discoverSubAppFeatureMaps(projectRoot);
    }
  }

  if (aggregationTargets.length === 0) return rootResult;

  return aggregateSubAppFeatureMaps(projectRoot, rootResult, aggregationTargets, { safe });
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
/**
 * @param {string} projectRoot
 * @param {FeatureMap} rootResult - The parse result of the root FEATURE-MAP.md
 * @param {Array<{appPath: string}>} targets - Sub-app paths to aggregate
 * @param {{ safe?: boolean }} aggOptions
 * @returns {FeatureMap}
 */
function aggregateSubAppFeatureMaps(projectRoot, rootResult, targets, aggOptions) {
  const safe = Boolean(aggOptions && aggOptions.safe === true);
  /** @type {Feature[]} */
  const merged = [];
  /** @type {Map<string, {subApp: string|null, file: string}>} */
  const seenIds = new Map();
  /** @type {ParseError|undefined} */
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
    /** @type {FeatureMap} */
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

  /** @type {FeatureMap} */
  const out = { features: merged, lastScan: lastScan || null };
  if (aggParseError) out.parseError = aggParseError;
  // @cap-todo(ac:F-082/iter1 fix:2) Expose the prefix index. Runtime-only, never persisted —
  //   the serializer never iterates underscore-prefixed top-level keys.
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

// @cap-todo(ref:AC-8) Each feature entry contains: feature ID, title, state, ACs, and file references
// @cap-todo(ref:AC-14) Feature Map scales to 80-120 features in a single file
// @cap-feature(feature:F-041) Fix Feature Map Parser Roundtrip Symmetry — parser is the read half of a
// symmetric pair with serializeFeatureMap. Parser must accept every format the serializer can write,
// without dropping ACs or transforming status case beyond what the serializer can re-emit.

/**
 * @typedef {Object} CapConfig
 * @property {('table'|'bullet'|'auto')=} featureMapStyle - explicit AC format selection (default "auto")
 */

/**
 * @typedef {Object} ParseOptions
 * @property {string=} projectRoot - Absolute path to project root for config loading
 * @property {('table'|'bullet'|'auto')=} featureMapStyle - explicit override (takes precedence over config)
 * @property {boolean=} safe - F-081/iter1: when true, return `{features, lastScan, parseError}`
 *   on duplicate-feature-id detection instead of throwing. Default false (legacy throw behavior
 *   preserved for direct parseFeatureMapContent callers and existing tests). readFeatureMap
 *   passes safe:true by default so the 24 bare CLI/library call sites no longer crash on a
 *   hand-edited duplicate.
 */

/**
 * @typedef {Object} ParseError
 * @property {string} code - Stable error code (currently only 'CAP_DUPLICATE_FEATURE_ID')
 * @property {string} message - Human-readable error message
 * @property {string} duplicateId - Normalized feature ID that collided
 * @property {number} firstLine - Line number of the first occurrence (1-based)
 * @property {number} duplicateLine - Line number of the duplicate occurrence (1-based)
 */

// @cap-feature(feature:F-081) readCapConfig — graceful loader for .cap/config.json
// @cap-todo(ac:F-081/AC-7) Config-loader infrastructure available in cap-feature-map.cjs for F-082 reuse.
// @cap-decision(F-081/AC-7) Returns {} on every error path (missing file, malformed JSON, read errors).
//   Rationale: parser must remain robust — config is an enhancement, never a hard dependency. Throwing
//   here would make a malformed config file silently break every Feature-Map read across all CAP commands.
/**
 * Read .cap/config.json from a project root with graceful defaults on every error path.
 * @param {string} projectRoot - Absolute path to project root
 * @returns {CapConfig} - Parsed config, or empty object on missing/malformed/read-error
 */
function readCapConfig(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return {};
  const configPath = path.join(projectRoot, '.cap', 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_e) {
    return {};
  }
}

/**
 * Parse FEATURE-MAP.md content into structured data.
 * @param {string} content - Raw markdown content
 * @param {ParseOptions=} options - Optional parser options (projectRoot for config, featureMapStyle override)
 * @returns {FeatureMap}
 */
function parseFeatureMapContent(content, options) {
  const features = [];
  const lines = content.split('\n');

  // @cap-todo(ac:F-081/AC-3) Resolve format style: explicit option > config > "auto" default.
  let formatStyle = 'auto';
  if (options && typeof options.featureMapStyle === 'string') {
    formatStyle = options.featureMapStyle;
  } else if (options && options.projectRoot) {
    const cfg = readCapConfig(options.projectRoot);
    if (cfg && typeof cfg.featureMapStyle === 'string') {
      formatStyle = cfg.featureMapStyle;
    }
  }
  if (formatStyle !== 'table' && formatStyle !== 'bullet' && formatStyle !== 'auto') {
    formatStyle = 'auto';
  }

  // Match feature headers: ### F-001: Title text [state]
  // Also accepts:          ### F-001: Title text          (no [state] — state comes from separate line)
  // Also accepts em-dash / en-dash / hyphen separator with surrounding spaces:
  //   ### F-001 — Title    ### F-001 – Title    ### F-001 - Title
  // @cap-todo(ac:F-081/AC-1) Union Feature-ID regex accepts F-NNN AND F-LONGFORM (uppercase-led).
  // @cap-decision(F-082/iter2) Header separator tolerance: GoetzeInvest real-world dry-run uses ` — ` (em-dash)
  //   throughout root + sub-app maps. Accepting `:` plus dash forms (with required surrounding whitespace
  //   to disambiguate from hyphen-in-ID) makes CAP tolerant of the legacy CAP-init-template em-dash style
  //   without forcing migration. Tested in cap-feature-map-emdash.test.cjs.
  const featureHeaderRE = /^###\s+(F-(?:\d{3,}|[A-Z][A-Z0-9_-]*))(?::\s+|\s+[—–-]\s+)(.+?)\s*$/;
  // Match AC rows: | AC-N | status | description |
  // End-anchor (\s*$) forces the non-greedy description group to expand up to the
  // trailing pipe of the row, not the first internal pipe. Without the anchor an AC
  // description containing a literal "|" character (e.g. "parse foo | bar from stdin")
  // was silently truncated at the first pipe — which e.g. dropped F-057/AC-2 during
  // the 2026-04-21 ECC feature batch and required a manual restore workaround.
  const acRowRE = /^\|\s*(AC-\d+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|\s*$/;
  // @cap-todo(ac:F-041/AC-4) Strict header detector: only match the literal table header
  // "| AC | Status | Description |" so AC-N rows whose description contains the word "Status"
  // (e.g. F-041/AC-6) are not misclassified as table headers, which previously truncated the
  // table and silently dropped subsequent AC rows.
  const acTableHeaderRE = /^\|\s*AC\s*\|\s*Status\s*\|\s*Description\s*\|/i;
  // Match AC checkboxes: - [x] description  or  - [ ] description
  const acCheckboxRE = /^[\s]*-\s+\[(x| )\]\s+(.+)/;
  // @cap-todo(ac:F-081/AC-2) Bullet-style AC with EXPLICIT AC-N prefix.
  // @cap-decision(F-081/AC-2) Prefix-bearing format `- [ ] AC-N: description` is the canonical bullet
  //   shape; this differs from the legacy `- **AC:**`-section anonymous checkboxes which auto-number.
  //   Explicit AC-IDs let bullet-style maps survive AC reordering / partial AC additions without
  //   silently re-numbering downstream entries — a pitfall observed in early CAP brainstorms.
  // @cap-risk(reason:asterisk-bullet-marker) Markdown allows `*` and `-` as bullet markers; we accept
  //   both for parser robustness (some editors auto-rewrite). The serializer always emits `-` to keep
  //   roundtrip output stable.
  // @cap-todo(ac:F-081/AC-2 iter:1) Description capture widened from `(.+?)` to `(.*?)` so an
  //   empty-description bullet (`- [ ] AC-1:` with EOL) is recognized as a legitimate AC instead
  //   of falling through to the legacy anonymous-checkbox branch (which would silently swallow
  //   the AC-N: prefix as the description and block all subsequent bullets via inAcCheckboxes=true).
  // @cap-decision(F-081/iter1) Stage-2 #1 fix: empty-desc bullet is a legitimate parse outcome —
  //   downstream code should treat `description: ''` as missing-text, never as missing-AC.
  const bulletAcRE = /^[\s]*[-*]\s+\[([ x])\]\s+(AC-\d+):\s*(.*?)\s*$/i;
  // @cap-decision(F-081/iter1) Shape-only detector is SEPARATE from the value-extraction regex.
  //   The shape detector matches the prefix `- [ ] AC-N:` regardless of description content (empty
  //   or non-empty) so `isExplicitBulletShape` (below) gates the legacy branch correctly even when
  //   the value-extraction regex would have matched anyway. Keeping the two regexes separate also
  //   means future loosening of the value regex (e.g. multi-line continuation) cannot accidentally
  //   re-introduce the silent-swallow bug fixed here.
  const bulletAcShapeRE = /^[\s]*[-*]\s+\[[ xX]\]\s+AC-\d+:/;
  // Match file refs: - `path/to/file`
  const fileRefRE = /^-\s+`(.+?)`/;
  // Match dependencies: **Depends on:** F-001, F-002  or  - **Dependencies:** F-001
  const depsRE = /^-?\s*\*\*Depend(?:s on|encies):\*\*\s*(.+)/;
  // @cap-todo(ac:F-063/AC-3) Match design usage: **Uses design:** DT-001, DC-001
  // @cap-decision(F-063/D3) Line format mirrors **Depends on:** — same shape, same delimiter, same position.
  const usesDesignRE = /^-?\s*\*\*Uses design:\*\*\s*(.+)/i;
  // Match status line: - **Status:** shipped  or  **Status:** shipped
  const statusLineRE = /^-?\s*\*\*Status:\*\*\s*(\w+)/;
  // File refs detected inline via regex test (not a stored RE)
  // Match AC section header: - **AC:**
  const acSectionRE = /^-?\s*\*\*AC:\*\*/;
  // Match lastScan in footer
  const lastScanRE = /^\*Last updated:\s*(.+?)\*$/;

  let currentFeature = null;
  let inAcTable = false;
  let inAcCheckboxes = false;
  let inFileRefs = false;
  let acCounter = 0;
  let lastScan = null;
  // @cap-todo(ac:F-081/AC-4) Track per-feature header line for positioned duplicate-error messages.
  /** @type {Array<{id: string, line: number}>} */
  const featureLineOrigins = [];
  // @cap-todo(ac:F-081/AC-2) Track table-row presence per feature; "auto" only enables bullet-AC
  //   detection when zero table rows have been seen — matches the AC-2 contract and keeps the
  //   table fast-path for AC-6 unchanged.
  let sawTableRow = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const headerMatch = line.match(featureHeaderRE);
    if (headerMatch) {
      if (currentFeature) features.push(currentFeature);
      // Extract [state] from end of title if present, otherwise state is null (set from status line)
      let title = headerMatch[2];
      let state = null;
      const stateInTitle = title.match(/^(.+?)\s+\[(\w+)\]\s*$/);
      if (stateInTitle) {
        title = stateInTitle[1];
        state = stateInTitle[2];
      }
      currentFeature = {
        id: headerMatch[1],
        title,
        state: state || 'planned',
        acs: [],
        files: [],
        dependencies: [],
        usesDesign: [], // @cap-todo(ac:F-063/AC-3) F-063: default-empty DT/DC IDs list.
        metadata: {},
      };
      featureLineOrigins.push({ id: headerMatch[1], line: lineIdx + 1 });
      inAcTable = false;
      inAcCheckboxes = false;
      inFileRefs = false;
      acCounter = 0;
      sawTableRow = false;
      continue;
    }

    if (!currentFeature) {
      const scanMatch = line.match(lastScanRE);
      if (scanMatch) lastScan = scanMatch[1].trim();
      continue;
    }

    // Status line: - **Status:** shipped
    // @cap-todo(ac:F-041/AC-3) Preserve case of status as written so a roundtrip
    // (parse -> serialize -> parse) does not transform the value. Canonical
    // lifecycle values are lowercase; this only matters for non-canonical inputs.
    const statusMatch = line.match(statusLineRE);
    if (statusMatch) {
      currentFeature.state = statusMatch[1];
      continue;
    }

    // Detect AC table start using the strict header detector (see acTableHeaderRE above).
    // @cap-todo(ac:F-041/AC-4) Use strict header regex instead of substring "Status" check
    // so AC-N data rows whose description contains the word "Status" do not falsely trigger
    // a "new table" reset that drops subsequent AC entries.
    if (acTableHeaderRE.test(line)) {
      inAcTable = true;
      inAcCheckboxes = false;
      inFileRefs = false;
      continue;
    }
    // Skip table separator
    if (line.match(/^\|[\s-]+\|/)) continue;

    const acMatch = line.match(acRowRE);
    if (acMatch && inAcTable) {
      // @cap-todo(ac:F-041/AC-3) Preserve case of AC status so roundtrip is lossless.
      currentFeature.acs.push({
        id: acMatch[1],
        description: acMatch[3].trim(),
        status: acMatch[2],
      });
      sawTableRow = true; // @cap-todo(ac:F-081/AC-2) Block bullet detection once any table row exists.
      // @cap-todo(ac:F-081/iter1) Mark this feature's AC origin format as 'table' so the
      //   serializer can preserve it on round-trip. Once any table row is seen, the feature
      //   sticks to 'table' even if a stray bullet appears later (matches sawTableRow gate).
      currentFeature._inputFormat = 'table';
      continue;
    }

    // AC section header: - **AC:**
    if (line.match(acSectionRE)) {
      inAcCheckboxes = true;
      inAcTable = false;
      inFileRefs = false;
      continue;
    }

    // @cap-todo(ac:F-081/AC-2) Bullet-style AC detection — must precede the legacy anonymous-checkbox
    //   branch because the legacy branch's regex is broader and would swallow `AC-N:` prefixes verbatim
    //   into the description, breaking AC-ID round-trips.
    // @cap-decision(F-081/AC-3) Format-style gate:
    //   - "table"  : never run bullet branch (caller declared table-only)
    //   - "bullet" : always run bullet branch when no `- **AC:**` section is active
    //   - "auto"   : only run bullet branch when no table rows have been seen for this feature yet
    const bulletAcMatch = line.match(bulletAcRE);
    if (
      bulletAcMatch &&
      formatStyle !== 'table' &&
      !inAcCheckboxes &&
      !inFileRefs &&
      (formatStyle === 'bullet' || (formatStyle === 'auto' && !sawTableRow))
    ) {
      const checked = bulletAcMatch[1].toLowerCase() === 'x';
      currentFeature.acs.push({
        id: bulletAcMatch[2],
        description: bulletAcMatch[3].trim(),
        status: checked ? 'tested' : 'pending',
      });
      inAcTable = false;
      inFileRefs = false;
      // @cap-todo(ac:F-081/iter1) Mark this feature's AC origin format as 'bullet' so the
      //   serializer preserves bullet format on the next write — fixes Stage-2 #2 (round-trip
      //   asymmetry) where every writeFeatureMap call after readFeatureMap silently rewrote
      //   bullet input to table form.
      // @cap-decision(F-081/iter1) `_inputFormat` is in-memory metadata (underscore prefix
      //   marks it as runtime-only, never persisted as a separate front-matter field).
      //   Source-of-truth on subsequent reads is the AC line shape itself; this field is a
      //   hint for the serializer between read and write within the same process. Mirrors
      //   the F-082 `metadata.subApp` runtime-hint pattern.
      // @cap-risk(reason:proto-pollution) `_inputFormat` is set from parser branch detection,
      //   never from raw user input. A malicious FEATURE-MAP cannot inject this field through
      //   parsed content (no attacker-controlled key path reaches here).
      currentFeature._inputFormat = 'bullet';
      continue;
    }

    // AC checkboxes: - [x] description  or  - [ ] description
    // @cap-decision(F-081/AC-2) Lines that match the explicit `AC-N:` bullet shape are NEVER routed
    //   through the legacy anonymous-checkbox branch — even if the bullet branch above declined them
    //   (e.g. format="table" or table rows already seen). Anonymous auto-numbering of `AC-N:`-prefixed
    //   text would silently rewrite the AC ID to a counter and dump the prefix into the description,
    //   which is exactly the silent-corruption mode AC-2/AC-4 are written to prevent.
    // @cap-todo(ac:F-081/AC-2 iter:1) Use shape-only detector here (independent of the value
    //   regex's description capture) so empty-description bullets `- [ ] AC-1:` are also gated
    //   away from the legacy branch. Without this, the legacy branch would set inAcCheckboxes=true
    //   and block all subsequent bullets in the same feature.
    const isExplicitBulletShape = bulletAcShapeRE.test(line);
    const checkboxMatch = isExplicitBulletShape ? null : line.match(acCheckboxRE);
    if (checkboxMatch && (inAcCheckboxes || !inFileRefs)) {
      acCounter++;
      const checked = checkboxMatch[1] === 'x';
      currentFeature.acs.push({
        id: `AC-${acCounter}`,
        description: checkboxMatch[2].trim(),
        status: checked ? 'tested' : 'pending',
      });
      inAcCheckboxes = true;
      inAcTable = false;
      inFileRefs = false;
      continue;
    }

    // File references — inline on **Files:** line or as separate section
    // Matches: **Files:**  or  - **Files:** `path`, `path2`
    if (/^-?\s*\*\*Files:\*\*/.test(line)) {
      // Extract any backtick-quoted paths on this same line
      const pathMatches = line.matchAll(/`([^`]+)`/g);
      for (const m of pathMatches) {
        currentFeature.files.push(m[1]);
      }
      inFileRefs = true;
      inAcTable = false;
      inAcCheckboxes = false;
      continue;
    }

    if (inFileRefs) {
      const refMatch = line.match(fileRefRE);
      if (refMatch) {
        currentFeature.files.push(refMatch[1]);
        continue;
      } else if (line.trim() === '') {
        inFileRefs = false;
      }
    }

    // Dependencies
    const depsMatch = line.match(depsRE);
    if (depsMatch) {
      currentFeature.dependencies = depsMatch[1].split(',').map(d => d.trim()).filter(Boolean);
      continue;
    }

    // @cap-todo(ac:F-063/AC-3) Parse **Uses design:** line — DT/DC IDs comma-separated.
    // Tolerant parser: accepts "DT-001", "DT-001 primary-color" (takes the ID prefix only).
    const usesMatch = line.match(usesDesignRE);
    if (usesMatch) {
      currentFeature.usesDesign = usesMatch[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          // Accept "DT-001" or "DT-001 primary-color" — keep only the ID token.
          const m = s.match(/^(DT-\d{3,}|DC-\d{3,})\b/);
          return m ? m[1] : s;
        })
        .filter(s => /^(DT-\d{3,}|DC-\d{3,})$/.test(s));
      continue;
    }

    const scanMatch = line.match(lastScanRE);
    if (scanMatch) lastScan = scanMatch[1].trim();
  }

  if (currentFeature) features.push(currentFeature);

  // @cap-todo(ac:F-081/AC-4) Duplicate-after-normalization detection — HARD error, no silent dedup.
  // @cap-decision(F-081/AC-4) Throws synchronously rather than returning a soft result. Rationale:
  //   silent dedup is exactly the failure mode the AC was written to prevent — a user who rename-collides
  //   two features (e.g. typoed `F-DEPLOY` vs `F-deploy`) would have one half their map disappear with
  //   no signal. Throwing forces visibility. The error message includes both line numbers so the user
  //   can navigate directly to the conflict in their editor.
  // @cap-decision(F-081/iter1) Stage-2 #3 fix: opt-in safe mode. When `options.safe === true`, attach
  //   the structured error to `result.parseError` and return the partial map (features parsed up to
  //   the first duplicate). Default behavior (no `safe` flag, or explicit `safe:false`) preserves
  //   the throw — required by 18 existing duplicate-detection regression tests in cap-feature-map-bullet
  //   and cap-feature-map-adversarial, and by tooling that wants hard-fail semantics.
  // @cap-risk(reason:partial-map-on-error) In safe mode the caller receives the features parsed up
  //   to (but not including) the duplicate header. This matches the "fail-fast at first collision"
  //   semantics of the throw path and gives downstream tooling a useful (if incomplete) view. CLI
  //   surfaces should always check `result.parseError` and surface a warning when present.
  const safe = Boolean(options && options.safe === true);
  const seenIds = new Map();
  let parseError;
  for (const origin of featureLineOrigins) {
    const normalized = String(origin.id).toUpperCase().trim();
    if (seenIds.has(normalized)) {
      const firstLine = seenIds.get(normalized);
      const message = `Duplicate feature ID after normalization: ${origin.id} (line ${origin.line}) collides with ${origin.id} (line ${firstLine})`;
      if (safe) {
        parseError = {
          code: 'CAP_DUPLICATE_FEATURE_ID',
          message,
          duplicateId: normalized,
          firstLine,
          duplicateLine: origin.line,
        };
        break;
      }
      const err = new Error(message);
      err.code = 'CAP_DUPLICATE_FEATURE_ID';
      err.duplicateId = normalized;
      err.firstLine = firstLine;
      err.duplicateLine = origin.line;
      throw err;
    }
    seenIds.set(normalized, origin.line);
  }

  // @cap-todo(ac:F-081/iter1) parseError is only present when set — keeps the result shape minimal
  //   for the happy path (zero new property on the 99.9% case).
  if (parseError) {
    return { features, lastScan, parseError };
  }
  return { features, lastScan };
}

// @cap-api writeFeatureMap(projectRoot, featureMap, appPath, options) -- Serializes FeatureMap to FEATURE-MAP.md.
// Side effect: overwrites FEATURE-MAP.md at project root or app subdirectory.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {FeatureMap} featureMap - Structured feature map data
 * @param {string|null} [appPath=null] - Relative app path (e.g., "apps/flow"). If null, writes to projectRoot.
 * @param {{ legacyStatusLine?: boolean }} [options] - Serialization options forwarded to serializeFeatureMap.
 */
function writeFeatureMap(projectRoot, featureMap, appPath, options) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);

  // @cap-todo(ac:F-082/AC-8) Round-trip idempotency: when writing the ROOT FEATURE-MAP.md and
  //   the on-disk content contains a Rescoped Table, preserve it. Without this, a read of an
  //   aggregated map followed by a write would flatten all sub-app features into root and
  //   destroy the Rescoped Table — the exact silent-rewrite failure mode flagged in the F-081
  //   round-trip-asymmetry lesson.
  // @cap-decision(F-082/AC-8 strategy-a) Preserve-Rescoped-Table-on-write strategy. Filter the
  //   in-memory feature list to ROOT-only features (those without `metadata.subApp`) before
  //   serializing. The Rescoped Table block is read from the existing on-disk content and
  //   appended verbatim. Sub-app feature mutations require an explicit `appPath` argument.
  let preservedRescopedBlock = null;
  /** @type {Feature[]} */
  let featuresForRoot = featureMap && Array.isArray(featureMap.features) ? featureMap.features : [];
  // @cap-todo(ac:F-082/iter1 warn:7) Warning #7 fix: when the on-disk file vanishes between
  //   existsSync and readFileSync (TOCTOU race), abort the write rather than silently flattening.
  //   Returning false signals the caller. Pre-iter1 silently fell through and clobbered the
  //   Rescoped Table on disk if the file briefly disappeared.
  // @cap-decision(F-082/iter1 warn:7) Hard abort over best-effort write — the alternative is to
  //   write a flattened map that destroys the Rescoped Table mid-race. Aborting preserves data
  //   integrity at the cost of a single retry.
  let toctouAbort = false;
  if (!appPath && fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, 'utf8');
      preservedRescopedBlock = extractRescopedBlock(existing);
    } catch (e) {
      // File existed at existsSync but disappeared / unreadable on read → abort.
      console.warn('cap: writeFeatureMap aborted — Rescoped Table preservation failed (TOCTOU): ' + String(e && e.message ? e.message : e).trim());
      toctouAbort = true;
    }
    if (toctouAbort) return false;
    if (preservedRescopedBlock) {
      // Filter out aggregated sub-app features from the root write — they belong to their
      //   own FEATURE-MAP.md files and were merged in only at read-time.
      // @cap-todo(ac:F-082/iter1 fix:1) Safety-net: if any sub-app features survived to here,
      //   warn loudly. With Fix #1 (monorepo-aware enrichFromTags) this branch should ideally
      //   never trigger — but it's a defense-in-depth signal for code paths that bypass the
      //   monorepo-aware enrichment helpers.
      const droppedSubApps = new Set();
      let droppedCount = 0;
      for (const f of featuresForRoot) {
        if (f && f.metadata && f.metadata.subApp) {
          droppedSubApps.add(f.metadata.subApp);
          droppedCount++;
        }
      }
      if (droppedCount > 0) {
        console.warn(
          'cap: writeFeatureMap dropped ' + droppedCount + ' sub-app feature(s) (subApps: ' +
          [...droppedSubApps].sort().join(', ') + '). ' +
          'Use writeFeatureMap(root, ..., appPath) or call mutation functions per sub-app to persist sub-app changes.'
        );
      }
      featuresForRoot = featuresForRoot.filter(f => !(f && f.metadata && f.metadata.subApp));
    }
  } else if (appPath) {
    // @cap-todo(ac:F-082/iter1 warn:6) Warning #6 fix: defense-in-depth at sub-app branch too.
    //   When writing to a sub-app FEATURE-MAP.md, drop any feature whose `metadata.subApp` is
    //   set to a DIFFERENT slug than this appPath's basename. Root-direct features (no subApp
    //   metadata) are also stripped — they don't belong in a sub-app file.
    // @cap-decision(F-082/iter1 warn:6) Symmetric filter pattern. Pre-iter1, the sub-app branch
    //   trusted the caller blindly; with the auto-redirect in updateFeatureState et al., a
    //   misuse case (caller hands an aggregated map to writeFeatureMap with appPath set) could
    //   silently leak features into the wrong sub-app file. This filter prevents that.
    const ownSubApp = path.basename(appPath);
    const featuresInScope = [];
    let droppedForeign = 0;
    for (const f of featuresForRoot) {
      const subApp = f && f.metadata && f.metadata.subApp;
      if (!subApp) {
        // root-direct feature — don't write to sub-app
        droppedForeign++;
        continue;
      }
      if (subApp !== ownSubApp) {
        droppedForeign++;
        continue;
      }
      featuresInScope.push(f);
    }
    if (droppedForeign > 0 && featuresInScope.length > 0) {
      // Only warn when filter actually changed the input AND some features remain — this
      // distinguishes "caller passed aggregated map by mistake" from the legitimate single-map
      // case where featuresForRoot already contains only sub-app-local features (no metadata).
      console.warn(
        'cap: writeFeatureMap (appPath=' + appPath + ') dropped ' + droppedForeign +
        ' feature(s) that did not belong to this sub-app.'
      );
      featuresForRoot = featuresInScope;
    }
    // If `droppedForeign > 0 && featuresInScope.length === 0` it likely means the caller
    // passed an unaggregated single-map (no metadata.subApp on any feature) — leave it alone.
    //
    // The legacy contract: a sub-app caller passes a single-map result of
    // `readFeatureMap(root, appPath)` whose features have NO metadata.subApp set. That case
    // continues to work unchanged.
  }

  const filteredMap = { ...featureMap, features: featuresForRoot };
  let content = serializeFeatureMap(filteredMap, options);

  if (preservedRescopedBlock) {
    content = injectRescopedBlock(content, preservedRescopedBlock);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

// @cap-feature(feature:F-082) _maybeRedirectToSubApp — internal helper used by all
//   state-mutation functions (updateFeatureState, setAcStatus, setFeatureUsesDesign,
//   transitionWithReason via updateFeatureState). When the looked-up feature lives in a
//   sub-app (`metadata.subApp` set) and the caller did NOT pass appPath, we recurse with
//   the resolved sub-app appPath so the write lands in the correct file. Without this fix,
//   the writer-filter in writeFeatureMap (L894+) silently drops the feature and the
//   mutation is a no-op.
// @cap-decision(F-082/iter1 fix:2) Sentinel-based control flow (`_NO_REDIRECT`) keeps the
//   helper composable: callers can compare the return against the sentinel to know whether
//   the redirect ran (use the result directly) or did not (fall through to the legacy code
//   path). Returning `null`/`undefined` would conflict with legitimate boolean return values
//   from the original mutation functions.
// @cap-risk(F-082/iter1) Recursion-loop guard: only triggers when `appPath` is null/undefined,
//   AND the recursion always passes a resolved appPath, so the recursive call cannot re-enter
//   this branch. F-077 lesson on infinite-loop guards applied.
const _NO_REDIRECT = Symbol('cap-feature-map._NO_REDIRECT');

/**
 * @param {string} projectRoot
 * @param {FeatureMap} featureMap - aggregated map (carries `_subAppPrefixes`)
 * @param {Feature} feature - looked-up feature
 * @param {string|null|undefined} appPath - caller-supplied app path
 * @param {string} fnName - calling function name for warn message
 * @param {(resolvedAppPath: string) => any} recurse - bound recursion into the same fn
 * @returns {any} - either the recursed result or the `_NO_REDIRECT` sentinel
 */
function _maybeRedirectToSubApp(projectRoot, featureMap, feature, appPath, fnName, recurse) {
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
  console.warn(
    'cap: ' + fnName + '("' + feature.id + '") skipped — feature lives in sub-app "' +
    subApp + '" but no sub-app path could be resolved; pass appPath explicitly to persist.'
  );
  return false;
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

// @cap-feature(feature:F-041) Serializer is the write half of the symmetric pair.
// It must preserve every status value the parser accepted (AC-1) and offer a legacy
// **Status:** line emission mode (AC-6) so the legacy non-table input format is not
// forcibly upgraded to bracketed-header format on the first roundtrip.
// @cap-feature(feature:F-081) Bullet/table-aware serializer — preserves the AC format
// the parser saw on the way in (Stage-2 #2 fix).
/**
 * Serialize FeatureMap to markdown string.
 * @param {FeatureMap} featureMap
 * @param {{ legacyStatusLine?: boolean, featureMapStyle?: ('table'|'bullet') }} [options]
 *   - legacyStatusLine: when true, emit `### F-NNN: Title` followed by `- **Status:** state`
 *     instead of `### F-NNN: Title [state]`. Default false (canonical bracket-header form).
 *   - featureMapStyle: F-081/iter1 — global override for AC format. Resolution order:
 *     per-feature `_inputFormat` (set by parser) > options.featureMapStyle > 'table' default.
 * @returns {string}
 */
function serializeFeatureMap(featureMap, options = {}) {
  // @cap-todo(ac:F-041/AC-6) Optional legacy emission keeps non-table input shape stable.
  const legacyStatusLine = Boolean(options && options.legacyStatusLine);
  // @cap-todo(ac:F-081/iter1) Resolve global format style from options. Default 'table' preserves
  //   pre-iter1 behavior — features without _inputFormat (e.g. created via addFeature on a fresh
  //   project) keep emitting tables unless the project explicitly opts into bullets via the option.
  const globalStyle =
    options && (options.featureMapStyle === 'bullet' || options.featureMapStyle === 'table')
      ? options.featureMapStyle
      : null;
  const lines = [
    '# Feature Map',
    '',
    '> Single source of truth for feature identity, state, acceptance criteria, and relationships.',
    '> Auto-enriched by `@cap-feature` tags and dependency analysis.',
    '',
    '## Features',
    '',
  ];

  for (const feature of featureMap.features) {
    // @cap-todo(ac:F-041/AC-1) feature.state is emitted verbatim — no case mutation,
    // so any value the parser accepted survives the roundtrip unchanged.
    if (legacyStatusLine) {
      lines.push(`### ${feature.id}: ${feature.title}`);
      lines.push('');
      lines.push(`- **Status:** ${feature.state}`);
    } else {
      lines.push(`### ${feature.id}: ${feature.title} [${feature.state}]`);
    }
    lines.push('');

    if (feature.dependencies.length > 0) {
      lines.push(`**Depends on:** ${feature.dependencies.join(', ')}`);
      lines.push('');
    }

    // @cap-todo(ac:F-063/AC-3) Serialize **Uses design:** only when non-empty — additive, backward-compatible.
    // Unset / empty arrays emit nothing so existing F-062-era FEATURE-MAP.md files roundtrip byte-identical.
    if (Array.isArray(feature.usesDesign) && feature.usesDesign.length > 0) {
      lines.push(`**Uses design:** ${feature.usesDesign.join(', ')}`);
      lines.push('');
    }

    if (feature.acs.length > 0) {
      // @cap-todo(ac:F-081/iter1) Per-feature format resolution: feature._inputFormat (from parser)
      //   > options.featureMapStyle (caller override) > 'table' (legacy default).
      // @cap-decision(F-081/iter1) Per-feature wins over global option: if a single mixed-format
      //   FEATURE-MAP.md has some bullet features and some table features (e.g. mid-migration),
      //   round-tripping must preserve each one independently.
      const featureStyle =
        feature && feature._inputFormat === 'bullet'
          ? 'bullet'
          : feature && feature._inputFormat === 'table'
            ? 'table'
            : globalStyle || 'table';

      if (featureStyle === 'bullet') {
        // @cap-todo(ac:F-081/iter1) Bullet emission: `- [x] AC-N: description` for tested,
        //   `- [ ] AC-N: description` otherwise. Mirrors the canonical bullet shape the parser
        //   accepts at line ~217 (bulletAcRE).
        // @cap-risk(reason:status-bullet-mapping) Bullet form has only two checkbox states
        //   ([ ] / [x]) but the AC schema has 4 statuses (pending/prototyped/tested/implemented).
        //   We map: tested -> [x]; everything else -> [ ]. This is lossy: a 'prototyped' or
        //   'implemented' AC round-trips as 'pending' through bullet-only storage. The intermediate
        //   states are runtime/transitional in canonical CAP usage, so the loss is acceptable for
        //   now. If this becomes user-visible, switch the bullet emitter to honor a `[?]` token
        //   for 'prototyped' or fall back to table form on mixed-status features.
        // @cap-todo(ref:future-feature) Stage-2 #8 follow-up: enrichFromScan writes 'implemented'
        //   status which has no faithful bullet representation. Defer to a follow-up feature that
        //   defines a richer bullet token set or a hybrid emission policy.
        for (const ac of feature.acs) {
          const checked = ac.status === 'tested' ? 'x' : ' ';
          // Empty descriptions emit no trailing space — matches the parser's empty-desc shape.
          const desc = ac.description ? ` ${ac.description}` : '';
          lines.push(`- [${checked}] ${ac.id}:${desc}`);
        }
        lines.push('');
      } else {
        lines.push('| AC | Status | Description |');
        lines.push('|----|--------|-------------|');
        for (const ac of feature.acs) {
          // @cap-todo(ac:F-041/AC-1) ac.status emitted verbatim for lossless roundtrip.
          lines.push(`| ${ac.id} | ${ac.status} | ${ac.description} |`);
        }
        lines.push('');
      }
    }

    if (feature.files.length > 0) {
      lines.push('**Files:**');
      for (const file of feature.files) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
  }

  if (featureMap.features.length === 0) {
    lines.push('<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->');
    lines.push('');
  }

  lines.push('## Legend');
  lines.push('');
  lines.push('| State | Meaning |');
  lines.push('|-------|---------|');
  lines.push('| planned | Feature identified, not yet implemented |');
  lines.push('| prototyped | Initial implementation exists |');
  lines.push('| tested | Tests written and passing |');
  lines.push('| shipped | Deployed / merged to main |');
  lines.push('');
  lines.push('---');
  lines.push(`*Last updated: ${new Date().toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}

// @cap-api addFeature(projectRoot, feature, appPath) -- Add a new feature entry to FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {{ title: string, acs?: AcceptanceCriterion[], dependencies?: string[], metadata?: Object }} feature - Feature data (ID auto-generated)
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {Feature} - The added feature with generated ID
 */
function addFeature(projectRoot, feature, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: addFeature aborted — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return null;
  }
  const id = getNextFeatureId(featureMap.features);
  // @cap-todo(ac:F-081/iter1) Inherit dominant AC format from existing features so a bullet-style
  //   FEATURE-MAP.md does not get a stray table-style entry on addFeature. If existing features
  //   are mostly bullets, new feature defaults to bullets. Pure-table or empty maps keep table.
  // @cap-decision(F-081/iter1) Use simple majority on existing features. Ties break toward
  //   'table' (the legacy default). Empty maps return 'table' (no signal to flip the default).
  let inheritedFormat = 'table';
  let bulletCount = 0;
  let tableCount = 0;
  for (const f of featureMap.features) {
    if (f._inputFormat === 'bullet') bulletCount++;
    else if (f._inputFormat === 'table') tableCount++;
  }
  if (bulletCount > tableCount) inheritedFormat = 'bullet';
  const newFeature = {
    id,
    title: feature.title,
    state: 'planned',
    acs: feature.acs || [],
    files: [],
    dependencies: feature.dependencies || [],
    usesDesign: feature.usesDesign || [], // F-063: default-empty DT/DC IDs list.
    metadata: feature.metadata || {},
    _inputFormat: inheritedFormat,
  };
  featureMap.features.push(newFeature);
  writeFeatureMap(projectRoot, featureMap, appPath);
  return newFeature;
}

// @cap-feature(feature:F-042) Propagate Feature State Transitions to Acceptance Criteria —
// extends updateFeatureState with AC propagation and a shipped-gate so feature/AC status cannot drift.
// @cap-decision(feature:F-042) Canonical AC status set for setAcStatus / propagation is
// pending | prototyped | tested. Legacy 'implemented' / 'reviewed' values that the parser may have
// read from older Feature Maps are tolerated on read but never written by this module.
const AC_VALID_STATUSES = ['pending', 'prototyped', 'tested'];

// @cap-api updateFeatureState(projectRoot, featureId, newState, appPath) -- Transition feature state.
// @cap-todo(ref:AC-9) Enforce valid state transitions: planned->prototyped->tested->shipped
// @cap-todo(ac:F-042/AC-1) Propagate transitions to ACs: tested promotes pending/prototyped ACs to tested.
// @cap-todo(ac:F-042/AC-2) Propagation rule: prototyped does not change AC status; tested promotes
// pending/prototyped ACs to tested; shipped requires all ACs already tested and rejects otherwise.
// @cap-decision(feature:F-042) The shipped-gate REJECTS the transition by returning false (no throw).
// Rationale: the existing updateFeatureState contract already returns false for any invalid transition
// (unknown feature, illegal state hop, unknown state name). Throwing on the new gate would break every
// caller that today relies on a boolean signal. The drift report (detectDrift) is the structured
// diagnostic surface; updateFeatureState stays a simple predicate.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} featureId - Feature ID (e.g., "F-001")
 * @param {string} newState - Target state
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {boolean} - True if transition was valid and applied
 */
function updateFeatureState(projectRoot, featureId, newState, appPath) {
  if (!VALID_STATES.includes(newState)) return false;

  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: updateFeatureState aborted — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return false;
  }
  const feature = featureMap.features.find(f => f.id === featureId);
  if (!feature) return false;

  // @cap-todo(ac:F-082/iter1 fix:2) Auto-redirect: if the looked-up feature lives in a sub-app
  //   (metadata.subApp set) and the caller did not supply appPath, recurse with the sub-app
  //   appPath so the mutation lands in the correct file. This eliminates the silent no-op
  //   reported by Stage-2 #2 — root-scope writes against a sub-app feature USED to filter
  //   the feature out and write nothing; now they explicitly route to the sub-app file.
  // @cap-decision(F-082/iter1 fix:2) Auto-redirect over loud rejection: more helpful UX, mirrors
  //   the F-081 round-trip-asymmetry fix (silent loss → loud success). Recursion guard via the
  //   `appPath` argument — when the recursion runs, appPath is set, so this branch can never
  //   re-trigger.
  // @cap-risk(F-082/iter1) When `_subAppPrefixes` cannot resolve the slug (shouldn't happen
  //   for an aggregated map, but might for a hand-built map fed through unsupported paths),
  //   we fall back to a loud structured rejection. The console.warn names the sub-app slug so
  //   the user knows which appPath to pass.
  const redirectResult = _maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'updateFeatureState',
    (resolvedAppPath) => updateFeatureState(projectRoot, featureId, newState, resolvedAppPath)
  );
  if (redirectResult !== _NO_REDIRECT) return redirectResult;

  const allowed = STATE_TRANSITIONS[feature.state];
  if (!allowed || !allowed.includes(newState)) return false;

  // @cap-todo(ac:F-042/AC-2) shipped-gate: reject if any AC is not yet 'tested'.
  // Empty AC list is treated as "no obligations" and is allowed through — matches the
  // pre-F-042 behaviour where features without ACs could still be shipped.
  if (newState === 'shipped') {
    const blocking = feature.acs.filter(a => a.status !== 'tested');
    if (blocking.length > 0) return false;

    // @cap-todo(ac:F-048/AC-3) Completeness-score gate — only enforces when config is opted in.
    // @cap-decision Silent failure (return false) preserves updateFeatureState's boolean contract.
    // Callers wanting the reason string can use transitionWithReason() instead.
    try {
      const { checkShipGate } = require('./cap-completeness.cjs');
      const gate = checkShipGate(featureId, newState, projectRoot);
      if (!gate.allowed) return false;
    } catch (_e) {
      // Completeness module unavailable — allow through for backwards compat.
    }
  }

  feature.state = newState;

  // @cap-todo(ac:F-042/AC-1) Promote ACs on transition to tested.
  if (newState === 'tested') {
    for (const ac of feature.acs) {
      if (ac.status === 'pending' || ac.status === 'prototyped') {
        ac.status = 'tested';
      }
    }
  }
  // 'planned' and 'prototyped' transitions intentionally leave ACs untouched.

  writeFeatureMap(projectRoot, featureMap, appPath);
  return true;
}

// @cap-feature(feature:F-048) Transition a feature state and return a structured reason on rejection.
// @cap-decision Additive API. updateFeatureState's boolean contract is preserved so existing callers
// do not break; transitionWithReason exposes the completeness-score gate's reason text for UIs that
// want to explain why a shipped transition was blocked.
/**
 * Same as updateFeatureState but returns a structured result including a rejection reason.
 * Used by /cap:completeness-report and CLI surfaces that want to surface the gate reason.
 * @param {string} projectRoot
 * @param {string} featureId
 * @param {string} newState
 * @param {string|null} [appPath=null]
 * @returns {{ ok: boolean, reason: string|null, score: number|null }}
 */
function transitionWithReason(projectRoot, featureId, newState, appPath) {
  // Pre-check the completeness gate so we can provide a reason. updateFeatureState
  // re-checks it internally for consistency (defense in depth against stale config loads).
  if (newState === 'shipped') {
    try {
      const { checkShipGate } = require('./cap-completeness.cjs');
      const gate = checkShipGate(featureId, newState, projectRoot);
      if (!gate.allowed) {
        return { ok: false, reason: gate.reason, score: gate.score };
      }
    } catch (_e) { /* completeness module unavailable — proceed */ }
  }
  const ok = updateFeatureState(projectRoot, featureId, newState, appPath);
  return { ok, reason: ok ? null : 'State transition rejected by feature-map validation (wrong source state, missing AC tested status, or invalid target).', score: null };
}

// @cap-feature(feature:F-042) setAcStatus — explicit per-AC mutation (AC-3).
// @cap-todo(ac:F-042/AC-3) New function setAcStatus(projectRoot, featureId, acId, newStatus, appPath)
// for finer-grained per-AC state changes. Does NOT propagate upward to feature state.
/**
 * Explicitly set the status of a single AC. Does not modify feature state.
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} featureId - Feature ID (e.g., "F-001")
 * @param {string} acId - AC ID (e.g., "AC-1")
 * @param {string} newStatus - One of AC_VALID_STATUSES (pending | prototyped | tested)
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {boolean} - True if the AC was found and updated, false otherwise
 */
function setAcStatus(projectRoot, featureId, acId, newStatus, appPath) {
  if (!AC_VALID_STATUSES.includes(newStatus)) return false;

  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: setAcStatus aborted — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return false;
  }
  const feature = featureMap.features.find(f => f.id === featureId);
  if (!feature) return false;

  // @cap-todo(ac:F-082/iter1 fix:2) Auto-redirect to sub-app when feature lives there. See
  //   updateFeatureState for the full lesson.
  const redirectResult = _maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'setAcStatus',
    (resolvedAppPath) => setAcStatus(projectRoot, featureId, acId, newStatus, resolvedAppPath)
  );
  if (redirectResult !== _NO_REDIRECT) return redirectResult;

  const ac = feature.acs.find(a => a.id === acId);
  if (!ac) return false;

  ac.status = newStatus;
  writeFeatureMap(projectRoot, featureMap, appPath);
  return true;
}

/**
 * @typedef {Object} DriftEntry
 * @property {string} id - Feature ID
 * @property {string} title - Feature title
 * @property {string} state - Feature state (always 'tested' or 'shipped' in a drift entry)
 * @property {{id: string, description: string}[]} pendingAcs - ACs still in 'pending' status
 * @property {number} totalAcs - Total AC count for this feature
 */

/**
 * @typedef {Object} DriftReport
 * @property {boolean} hasDrift - True if any features show drift
 * @property {number} driftCount - Number of features with drift
 * @property {DriftEntry[]} features - Per-feature drift details
 */

// @cap-feature(feature:F-042) detectDrift — pure diagnostic over the parsed Feature Map (AC-4).
// @cap-todo(ac:F-042/AC-4) Status drift detection: flag features where state is shipped/tested but
// one or more ACs are still pending. Returns a structured DriftReport. No console output, no writes.
/**
 * Detect features whose feature state is 'shipped' or 'tested' but where ACs remain 'pending'.
 * @param {string} projectRoot - Absolute path to project root
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {DriftReport}
 */
function detectDrift(projectRoot, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: detectDrift — duplicate feature ID detected, drift report uses partial map: ' + String(featureMap.parseError.message).trim());
  }
  const driftFeatures = [];

  for (const f of featureMap.features) {
    if (f.state !== 'shipped' && f.state !== 'tested') continue;
    const pendingAcs = f.acs.filter(a => a.status === 'pending');
    if (pendingAcs.length === 0) continue;

    driftFeatures.push({
      id: f.id,
      title: f.title,
      state: f.state,
      pendingAcs: pendingAcs.map(a => ({ id: a.id, description: a.description })),
      totalAcs: f.acs.length,
    });
  }

  return {
    hasDrift: driftFeatures.length > 0,
    driftCount: driftFeatures.length,
    features: driftFeatures,
  };
}

// @cap-feature(feature:F-042) formatDriftReport — markdown-friendly renderer used by the
// /cap:status --drift CLI (AC-6). Pure function: input report, output string. No I/O.
/**
 * Render a DriftReport as a markdown table for CLI display.
 * @param {DriftReport} report
 * @returns {string}
 */
function formatDriftReport(report) {
  // @cap-todo(ac:F-042/AC-6) Defensive: nullish report is treated as the no-drift case so
  // downstream CLI shells never explode when the upstream pipeline hands back a missing
  // value (e.g. F-043 reconciliation tooling that may short-circuit before producing a report).
  if (!report || !report.hasDrift) {
    return 'Status Drift: none — Feature Map is consistent.';
  }

  const lines = [];
  lines.push(`Status Drift Detected: ${report.driftCount} features`);
  lines.push('');
  lines.push('| Feature | State    | Pending ACs |');
  lines.push('|---------|----------|-------------|');
  for (const f of report.features) {
    // pad state column to roughly the width of "shipped" + 1
    const statePadded = f.state.padEnd(8, ' ');
    const ratio = `${f.pendingAcs.length}/${f.totalAcs}`;
    lines.push(`| ${f.id}   | ${statePadded} | ${ratio.padEnd(11, ' ')} |`);
  }
  return lines.join('\n');
}

// @cap-api enrichFromTags(projectRoot, scanResults, appPath) -- Update file references from tag scan.
// @cap-todo(ref:AC-12) Feature Map auto-enriched from @cap-feature tags found in source code
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults - Tags from cap-tag-scanner
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {FeatureMap}
 */
function enrichFromTags(projectRoot, scanResults, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: skipping enrichFromTags — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return featureMap;
  }

  // @cap-todo(ac:F-082/iter1 fix:1) Monorepo-aware enrichment. Stage-2 #1 found that on a
  //   monorepo project (Rescoped Table present), the legacy bare `enrichFromTags(root, tags)`
  //   call read the AGGREGATED map (sub-app features included), mutated their `files[]` in
  //   memory, then wrote to root — where the writer-filter at writeFeatureMap (L894+) silently
  //   stripped them out. Net effect: every sub-app `@cap-feature(...)` tag was dropped on every
  //   `/cap:scan`. Production-bite class.
  // @cap-decision(F-082/iter1 fix:1) Internal-split strategy. Detect the aggregated map via
  //   the runtime-only `_subAppPrefixes`. If present and caller did not specify appPath,
  //   group features by `metadata.subApp` and write each group back via the appropriate appPath.
  //   API surface unchanged — callers in commands/cap/{scan,prototype,iterate,annotate}.md
  //   continue to call `enrichFromTags(process.cwd(), tags)` and now Just Work for monorepos.
  // @cap-risk(F-082/iter1 fix:1) The same scanResults are applied to every per-scope write —
  //   each enrichment loop re-filters tags against the features it owns (find returns null for
  //   a foreign feature, so the file ref is not persisted to a wrong sub-app file).
  if (!appPath && featureMap._subAppPrefixes && featureMap._subAppPrefixes.size > 0) {
    return _enrichFromTagsAcrossSubApps(projectRoot, scanResults, featureMap);
  }

  for (const tag of scanResults) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference if not already present
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }
  }

  writeFeatureMap(projectRoot, featureMap, appPath);
  return featureMap;
}

// @cap-feature(feature:F-082) _enrichFromTagsAcrossSubApps — internal monorepo split.
//   Groups features by `metadata.subApp` and runs enrichment per scope (root + each sub-app),
//   re-reading + re-writing each scope's FEATURE-MAP.md independently. Stage-2 #1 fix.
// @cap-decision(F-082/iter1 fix:1) Re-read each sub-app via `readFeatureMap(root, appPath)` so
//   the per-scope mutation operates on a single-map view (no aggregation, no writer-filter
//   surprises). The aggregated map is used only as the index of which features live where.
/**
 * @param {string} projectRoot
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults
 * @param {FeatureMap} aggregatedMap - aggregated map carrying `_subAppPrefixes` and
 *   `metadata.subApp` per feature
 * @returns {FeatureMap} - the aggregated map (re-read post-write so callers see fresh state)
 */
function _enrichFromTagsAcrossSubApps(projectRoot, scanResults, aggregatedMap) {
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

  // For each scope, perform a single-map enrichment + write.
  for (const [scope, idsInScope] of featureIdsByScope) {
    if (idsInScope.size === 0) continue;
    const scopedAppPath = scope ? (prefixes ? prefixes.get(scope) : null) : null;
    if (scope && !scopedAppPath) {
      // Sub-app slug present but prefix could not be resolved — defensive skip.
      console.warn('cap: enrichFromTags — sub-app "' + scope + '" prefix unresolved; tags for that scope skipped.');
      continue;
    }
    const scopedMap = readFeatureMap(projectRoot, scopedAppPath || undefined, { safe: true });
    if (scopedMap.parseError) {
      console.warn('cap: enrichFromTags — skipping scope "' + (scope || 'root') + '": ' + String(scopedMap.parseError.message).trim());
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
      writeFeatureMap(projectRoot, scopedMap, scopedAppPath || undefined);
    }
  }

  // Return a fresh aggregated read so callers see the post-write state.
  return readFeatureMap(projectRoot, undefined, { safe: true });
}

// @cap-feature(feature:F-063) enrichFromDesignTags — populate Feature.usesDesign from design-token/design-component tags.
// @cap-api enrichFromDesignTags(projectRoot, scanResults, appPath) -- Add DT/DC IDs to each feature's usesDesign
//   based on where design-token / design-component tags co-locate with a feature's files.
// @cap-todo(ac:F-063/AC-3) Design-usage enrichment: when a file tagged @cap-feature(feature:F-NNN) also
//   carries @cap-design-token(id:DT-NNN) or @cap-design-component(id:DC-NNN), the ID is appended to F-NNN.usesDesign.
// @cap-decision Co-location (same file) is the heuristic. Cross-file usage would require import resolution,
//   which /cap:design --scope handles explicitly (user-curated). This keeps the scanner pure and the UX predictable.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults - Tags from cap-tag-scanner (must include design-token/design-component entries)
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {FeatureMap}
 */
function enrichFromDesignTags(projectRoot, scanResults, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: skipping enrichFromDesignTags — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return featureMap;
  }

  // @cap-todo(ac:F-082/iter1 fix:1) Monorepo-aware design enrichment — same lesson as enrichFromTags.
  if (!appPath && featureMap._subAppPrefixes && featureMap._subAppPrefixes.size > 0) {
    return _enrichFromDesignTagsAcrossSubApps(projectRoot, scanResults, featureMap);
  }

  // Build file -> featureId map (first @cap-feature wins, matches F-049 convention).
  const fileToFeature = new Map();
  for (const tag of scanResults) {
    if (tag.type !== 'feature') continue;
    const fid = tag.metadata && tag.metadata.feature;
    if (!fid) continue;
    if (!fileToFeature.has(tag.file)) fileToFeature.set(tag.file, fid);
  }

  // For each design tag, find its file's feature and append the design ID.
  for (const tag of scanResults) {
    if (tag.type !== 'design-token' && tag.type !== 'design-component') continue;
    const designId = tag.metadata && tag.metadata.id;
    if (!designId) continue;
    const featureId = fileToFeature.get(tag.file);
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;
    if (!Array.isArray(feature.usesDesign)) feature.usesDesign = [];
    if (!feature.usesDesign.includes(designId)) feature.usesDesign.push(designId);
  }

  // Stable sort for deterministic output.
  for (const f of featureMap.features) {
    if (Array.isArray(f.usesDesign)) f.usesDesign.sort();
  }

  writeFeatureMap(projectRoot, featureMap, appPath);
  return featureMap;
}

// @cap-feature(feature:F-082) _enrichFromDesignTagsAcrossSubApps — monorepo split for design tags.
//   Same lesson + structure as _enrichFromTagsAcrossSubApps. The file→featureId index is built
//   once from the aggregated map, then per-scope writes apply only the design IDs whose owning
//   feature lives in that scope.
/**
 * @param {string} projectRoot
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults
 * @param {FeatureMap} aggregatedMap
 * @returns {FeatureMap}
 */
function _enrichFromDesignTagsAcrossSubApps(projectRoot, scanResults, aggregatedMap) {
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

  for (const [scope, idsInScope] of featureIdsByScope) {
    if (idsInScope.size === 0) continue;
    const scopedAppPath = scope ? (prefixes ? prefixes.get(scope) : null) : null;
    if (scope && !scopedAppPath) {
      console.warn('cap: enrichFromDesignTags — sub-app "' + scope + '" prefix unresolved; design tags for that scope skipped.');
      continue;
    }
    const scopedMap = readFeatureMap(projectRoot, scopedAppPath || undefined, { safe: true });
    if (scopedMap.parseError) {
      console.warn('cap: enrichFromDesignTags — skipping scope "' + (scope || 'root') + '": ' + String(scopedMap.parseError.message).trim());
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
      writeFeatureMap(projectRoot, scopedMap, scopedAppPath || undefined);
    }
  }

  return readFeatureMap(projectRoot, undefined, { safe: true });
}

// @cap-api setFeatureUsesDesign(projectRoot, featureId, designIds, appPath) -- Replace a feature's usesDesign list.
// @cap-todo(ac:F-063/AC-4) Called by /cap:design --scope after the user confirms which DT/DC IDs the feature uses.
/**
 * @param {string} projectRoot
 * @param {string} featureId - e.g. "F-023"
 * @param {string[]} designIds - list of DT-NNN / DC-NNN IDs (replaces existing value)
 * @param {string|null} [appPath=null]
 * @returns {boolean} - true if the feature existed and was updated
 */
function setFeatureUsesDesign(projectRoot, featureId, designIds, appPath) {
  // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });
  if (featureMap.parseError) {
    console.warn('cap: setFeatureUsesDesign aborted — duplicate feature ID detected: ' + String(featureMap.parseError.message).trim());
    return false;
  }
  const feature = featureMap.features.find(f => f.id === featureId);
  if (!feature) return false;

  // @cap-todo(ac:F-082/iter1 fix:2) Auto-redirect to sub-app when feature lives there. See
  //   updateFeatureState for the full lesson.
  const redirectResult = _maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'setFeatureUsesDesign',
    (resolvedAppPath) => setFeatureUsesDesign(projectRoot, featureId, designIds, resolvedAppPath)
  );
  if (redirectResult !== _NO_REDIRECT) return redirectResult;

  const cleaned = (Array.isArray(designIds) ? designIds : [])
    .map(s => String(s).trim())
    .filter(s => /^(DT-\d{3,}|DC-\d{3,})$/.test(s));
  // Stable, deterministic order.
  feature.usesDesign = [...new Set(cleaned)].sort();
  writeFeatureMap(projectRoot, featureMap, appPath);
  return true;
}

// @cap-api enrichFromDeps(projectRoot) -- Read package.json, detect imports, add dependency info to features.
// @cap-todo(ref:AC-13) Feature Map auto-enriched from dependency graph analysis, env vars, package.json
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ dependencies: string[], devDependencies: string[], envVars: string[] }}
 */
function enrichFromDeps(projectRoot) {
  const result = { dependencies: [], devDependencies: [], envVars: [] };

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dependencies) result.dependencies = Object.keys(pkg.dependencies);
      if (pkg.devDependencies) result.devDependencies = Object.keys(pkg.devDependencies);
    } catch (_e) {
      // Malformed package.json
    }
  }

  // Scan for .env file to detect environment variables
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envRE = /^([A-Z_][A-Z0-9_]*)=/gm;
      let match;
      while ((match = envRE.exec(envContent)) !== null) {
        result.envVars.push(match[1]);
      }
    } catch (_e) {
      // Ignore
    }
  }

  return result;
}

// @cap-api getNextFeatureId(features) -- Generate next F-NNN ID.
/**
 * @param {Feature[]} features - Existing features
 * @returns {string} - Next feature ID (e.g., "F-001")
 */
function getNextFeatureId(features) {
  if (!features || features.length === 0) return 'F-001';

  let maxNum = 0;
  for (const f of features) {
    const match = f.id.match(/^F-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `F-${String(maxNum + 1).padStart(3, '0')}`;
}

// @cap-api enrichFromScan(featureMap, tags) -- Updates Feature Map status from tag scan results.
// Returns: updated FeatureMap with AC statuses reflecting code annotations.
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} tags - Tags from cap-tag-scanner
 * @returns {FeatureMap}
 */
function enrichFromScan(featureMap, tags) {
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }

    // If AC reference in metadata, mark it as implemented
    const acRef = tag.metadata.ac;
    if (acRef) {
      const ac = feature.acs.find(a => a.id === acRef);
      if (ac && ac.status === 'pending') {
        ac.status = 'implemented';
      }
    }
  }

  return featureMap;
}

// @cap-api addFeatures(featureMap, newFeatures) -- Adds new features to an existing Feature Map (from brainstorm).
// @cap-todo(ref:AC-11) Feature Map supports auto-derivation from brainstorm output
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {Feature[]} newFeatures - Features to add
 * @returns {FeatureMap}
 */
function addFeatures(featureMap, newFeatures) {
  const existingIds = new Set(featureMap.features.map(f => f.id));
  const existingTitles = new Set(featureMap.features.map(f => f.title.toLowerCase()));

  for (const nf of newFeatures) {
    // Skip duplicates by ID or title
    if (existingIds.has(nf.id)) continue;
    if (existingTitles.has(nf.title.toLowerCase())) continue;

    featureMap.features.push(nf);
    existingIds.add(nf.id);
    existingTitles.add(nf.title.toLowerCase());
  }

  return featureMap;
}

// @cap-api getStatus(featureMap) -- Computes aggregate project status from Feature Map.
/**
 * @param {FeatureMap} featureMap
 * @returns {{ totalFeatures: number, completedFeatures: number, totalACs: number, implementedACs: number, testedACs: number, reviewedACs: number }}
 */
function getStatus(featureMap) {
  let totalFeatures = featureMap.features.length;
  let completedFeatures = featureMap.features.filter(f => f.state === 'shipped').length;
  let totalACs = 0;
  let implementedACs = 0;
  let testedACs = 0;
  let reviewedACs = 0;

  for (const f of featureMap.features) {
    totalACs += f.acs.length;
    for (const ac of f.acs) {
      if (ac.status === 'implemented') implementedACs++;
      if (ac.status === 'tested') testedACs++;
      if (ac.status === 'reviewed') reviewedACs++;
    }
  }

  return { totalFeatures, completedFeatures, totalACs, implementedACs, testedACs, reviewedACs };
}

// @cap-api initAppFeatureMap(projectRoot, appPath) -- Create FEATURE-MAP.md for a specific app in a monorepo.
// Idempotent: does not overwrite existing FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} appPath - Relative app path (e.g., "apps/flow")
 * @returns {boolean} - True if created, false if already existed
 */
function initAppFeatureMap(projectRoot, appPath) {
  const baseDir = path.join(projectRoot, appPath);
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  if (fs.existsSync(filePath)) return false;
  // Ensure directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  fs.writeFileSync(filePath, generateTemplate(), 'utf8');
  return true;
}

// @cap-api listAppFeatureMaps(projectRoot) -- Find all FEATURE-MAP.md files in a monorepo.
// Returns array of relative paths to directories containing FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string[]} - Relative directory paths that contain FEATURE-MAP.md (e.g., [".", "apps/flow", "packages/ui"])
 */
function listAppFeatureMaps(projectRoot) {
  const results = [];

  // Check root
  if (fs.existsSync(path.join(projectRoot, FEATURE_MAP_FILE))) {
    results.push('.');
  }

  // Walk subdirectories (max depth 3, skip excluded dirs)
  const excludeDirs = new Set(['node_modules', '.git', '.cap', 'dist', 'build', 'coverage', '.planning']);

  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (excludeDirs.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const fmPath = path.join(fullPath, FEATURE_MAP_FILE);
      if (fs.existsSync(fmPath)) {
        results.push(path.relative(projectRoot, fullPath));
      }
      walk(fullPath, depth + 1);
    }
  }

  walk(projectRoot, 0);
  return results;
}

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
      // Files don't match any app — keep at root
      rootFeatures.push(feature);
    } else if (entries.length === 1) {
      // All files in one app — distribute there
      const [appPath] = entries[0];
      if (!distribution[appPath]) distribution[appPath] = [];
      distribution[appPath].push(feature);
    } else {
      // Files across multiple apps — assign to the app with most refs
      entries.sort((a, b) => b[1] - a[1]);
      const primaryApp = entries[0][0];
      if (!distribution[primaryApp]) distribution[primaryApp] = [];
      distribution[primaryApp].push(feature);
    }
  }

  if (options.dryRun) {
    let totalDistributed = 0;
    for (const features of Object.values(distribution)) {
      totalDistributed += features.length;
    }
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

    // Read existing app Feature Map (or create new)
    // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
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
      if (existingIds.has(feature.id)) continue; // skip duplicates

      // Rewrite file paths to be relative to app
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
  FEATURE_MAP_FILE,
  FEATURE_ID_PATTERN, // F-081
  VALID_STATES,
  STATE_TRANSITIONS,
  AC_VALID_STATUSES,
  generateTemplate,
  readFeatureMap,
  readCapConfig, // F-081
  writeFeatureMap,
  parseFeatureMapContent,
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
  transitionWithReason,
  setAcStatus,
  detectDrift,
  formatDriftReport,
  enrichFromTags,
  enrichFromDesignTags, // F-063
  setFeatureUsesDesign, // F-063
  enrichFromDeps,
  getNextFeatureId,
  enrichFromScan,
  addFeatures,
  getStatus,
  initAppFeatureMap,
  listAppFeatureMaps,
  rescopeFeatures,
  // F-082 — exported for tests and downstream tooling
  parseRescopedTable,
  discoverSubAppFeatureMaps,
  aggregateSubAppFeatureMaps,
  extractRescopedBlock,
  injectRescopedBlock,
};
