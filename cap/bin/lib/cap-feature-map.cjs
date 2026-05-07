// @cap-context CAP v2.0 Feature Map reader/writer -- FEATURE-MAP.md is the single source of truth for all features, ACs, status, and dependencies.
// @cap-decision Markdown format for Feature Map (not JSON/YAML) -- human-readable, diffable in git, editable in any text editor. Machine-readable via regex parsing of structured table rows.
// @cap-decision Read and write are separate operations -- no in-memory mutation API. Read returns structured data, write takes structured data and serializes to markdown.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @cap-pattern Feature Map is the bridge between all CAP workflows. Brainstorm writes entries, scan updates status, status reads for dashboard.

'use strict';

// @cap-feature(feature:F-002) Feature Map Management — read/write/enrich FEATURE-MAP.md as single source of truth
// @cap-feature(feature:F-081) Multi-Format Feature Map Parser — Union ID regex (F-NNN | F-LONGFORM), bullet-style ACs, config-driven format selection
// @cap-feature(feature:F-082) Aggregate Feature Maps Across Monorepo Sub-Apps — readFeatureMap transparently merges sub-app maps via Rescoped Table or opt-in directory walk

// @cap-history(sessions:3, edits:5, since:2026-04-20, learned:2026-05-06) Frequently modified — 3 sessions, 5 edits
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
  // @cap-todo(ac:F-081/AC-7) Forward projectRoot for config-driven format style.
  // @cap-decision(F-081/iter1+iter2) Safe-mode opt-in: default strict (throw on duplicate) preserves
  //   pinned adversarial test; `{safe: true}` returns parseError for tooling. Write-back paths bail on
  //   parseError; read-only consumers warn-and-continue. F-076/F-077 lesson on user-controlled IDs in
  //   warn messages: parseError.message is wrapped in String(...).trim() at every call site.
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
  // @cap-todo(ac:F-083/AC-6) Lazy-require monorepo module — see _monorepo() definition.
  const _mr = _monorepo();
  const rescopedEntries = _mr.parseRescopedTable(content);

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
      aggregationTargets = _mr.discoverSubAppFeatureMaps(projectRoot);
    }
  }

  if (aggregationTargets.length === 0) return rootResult;

  return _mr.aggregateSubAppFeatureMaps(projectRoot, rootResult, aggregationTargets, { safe });
}

// @cap-feature(feature:F-083) parseRescopedTable / discoverSubAppFeatureMaps /
//   aggregateSubAppFeatureMaps extracted to cap-feature-map-monorepo.cjs; re-exported below.

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

  // @cap-todo(ac:F-082/AC-8) Round-trip idempotency: preserve the on-disk Rescoped Table on root writes.
  // @cap-decision(F-082/AC-8 strategy-a) Filter feature list to ROOT-only (no metadata.subApp) before
  //   serializing; re-inject the Rescoped Table verbatim after serialize. Sub-app mutations require
  //   explicit appPath. Without this, aggregated read → write would flatten sub-apps into root.
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
      // @cap-todo(ac:F-083/AC-6) Lazy-require — see _monorepo() definition.
      preservedRescopedBlock = _monorepo().extractRescopedBlock(existing);
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
    // @cap-decision(F-082/iter1 warn:6) Symmetric filter for sub-app writes: drop foreign-subApp and
    //   root-direct features. Only warn when filter changed input AND features remain (distinguishes
    //   misuse from the legitimate single-map case where features have NO metadata.subApp). Legacy
    //   contract preserved: readFeatureMap(root, appPath) returning a no-metadata single-map still works.
    const ownSubApp = path.basename(appPath);
    const featuresInScope = [];
    let droppedForeign = 0;
    for (const f of featuresForRoot) {
      const subApp = f && f.metadata && f.metadata.subApp;
      if (!subApp) { droppedForeign++; continue; }
      if (subApp !== ownSubApp) { droppedForeign++; continue; }
      featuresInScope.push(f);
    }
    if (droppedForeign > 0 && featuresInScope.length > 0) {
      console.warn(
        'cap: writeFeatureMap (appPath=' + appPath + ') dropped ' + droppedForeign +
        ' feature(s) that did not belong to this sub-app.'
      );
      featuresForRoot = featuresInScope;
    }
  }

  const filteredMap = { ...featureMap, features: featuresForRoot };
  let content = serializeFeatureMap(filteredMap, options);

  if (preservedRescopedBlock) {
    // @cap-todo(ac:F-083/AC-6) Lazy-require — see _monorepo() definition.
    content = _monorepo().injectRescopedBlock(content, preservedRescopedBlock);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

// @cap-feature(feature:F-082) _safeForError — sanitize a user-controlled value before
//   interpolating it into console.warn/error. Strips non-printable bytes (incl. ANSI CSI, BEL,
//   BS, NUL) and caps length at 256. F-076/F-077/F-081 doctrine.
// @cap-decision(F-083/balance) Stays in core: used by writeFeatureMap (TOCTOU warn) AND by the
//   monorepo enrichment helpers via lazy-require — hosting it in core keeps the cycle accessor
//   list shorter and avoids an inverse import edge.
/**
 * @param {*} value - any user-controlled value to be interpolated into a warn message
 * @param {number} [maxLen=256] - max output length before truncation
 * @returns {string}
 */
function _safeForError(value, maxLen = 256) {
  let s;
  try {
    s = String(value);
  } catch (_e) {
    s = '<unprintable>';
  }
  // Strip any non-printable byte (incl. ESC, BEL, BS, NUL). Keep printable ASCII + multibyte UTF-8
  // (codepoints >= 0x20). This neutralizes ANSI CSI sequences regardless of how they're wrapped.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '');
  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}

// @cap-feature(feature:F-083) Lazy accessor for cap-feature-map-monorepo.cjs. Used INSIDE
//   function bodies (never at top-level) to break the cycle between core and monorepo.
//   The monorepo module's mirror is `_core()` in cap-feature-map-monorepo.cjs.
// @cap-decision(F-083/cycle) Lazy-require both directions; AC-6 static-analysis test pins
//   the no-cycle contract.
let _monorepoCache = null;
function _monorepo() {
  if (!_monorepoCache) _monorepoCache = require('./cap-feature-map-monorepo.cjs');
  return _monorepoCache;
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
// @cap-decision(F-082/asymmetry) addFeature does NOT auto-redirect to a sub-app via
//   _maybeRedirectToSubApp, unlike updateFeatureState/setAcStatus/setFeatureUsesDesign.
//   Reasoning: a NEW feature has no metadata.subApp yet, so there is nothing to redirect
//   FROM. Sub-app placement is determined at write-time by the caller passing `appPath`
//   explicitly. This asymmetry is INTENTIONAL — do not "fix" it without first considering
//   where new features should land in a monorepo (currently always the scope named by
//   `appPath`, defaulting to root; opt-in to a sub-app via explicit `appPath`).
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
  // @cap-todo(ac:F-083/AC-6) Lazy-require monorepo helpers — see _monorepo() definition.
  const _mr = _monorepo();
  const redirectResult = _mr._maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'updateFeatureState',
    (resolvedAppPath) => updateFeatureState(projectRoot, featureId, newState, resolvedAppPath)
  );
  if (redirectResult !== _mr._NO_REDIRECT) return redirectResult;

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
  // @cap-todo(ac:F-083/AC-6) Lazy-require monorepo helpers — see _monorepo() definition.
  const _mrSetAc = _monorepo();
  const redirectResult = _mrSetAc._maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'setAcStatus',
    (resolvedAppPath) => setAcStatus(projectRoot, featureId, acId, newStatus, resolvedAppPath)
  );
  if (redirectResult !== _mrSetAc._NO_REDIRECT) return redirectResult;

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
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });

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
  // @cap-decision(F-082/followup) Cross-sub-app blast radius fix: parseError gate is now
  //   evaluated AFTER the aggregation-detection branch. An aggregated parseError (a duplicate
  //   in ONE sub-app) must NOT block enrichment for healthy sibling sub-apps — the aggregator
  //   `_enrichFromTagsAcrossSubApps` already skips bad scopes individually at L1671-1675. The
  //   gate below applies ONLY to legacy single-scope reads (no _subAppPrefixes).
  if (!appPath && featureMap._subAppPrefixes && featureMap._subAppPrefixes.size > 0) {
    // @cap-todo(ac:F-083/AC-6) Lazy-require — see _monorepo() definition.
    return _monorepo()._enrichFromTagsAcrossSubApps(projectRoot, scanResults, featureMap);
  }

  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  //   Single-scope only; aggregated reads handle parseError per-scope (see above).
  if (featureMap.parseError) {
    console.warn('cap: skipping enrichFromTags — duplicate feature ID detected: ' + _safeForError(featureMap.parseError.message));
    return featureMap;
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
  const featureMap = readFeatureMap(projectRoot, appPath, { safe: true });

  // @cap-todo(ac:F-082/iter1 fix:1) Monorepo-aware design enrichment — same lesson as enrichFromTags.
  // @cap-decision(F-082/followup) Cross-sub-app blast radius fix: parseError gate moved BELOW
  //   the aggregation branch so a duplicate in one sub-app does not block healthy siblings.
  //   See enrichFromTags for the full reasoning.
  if (!appPath && featureMap._subAppPrefixes && featureMap._subAppPrefixes.size > 0) {
    // @cap-todo(ac:F-083/AC-6) Lazy-require — see _monorepo() definition.
    return _monorepo()._enrichFromDesignTagsAcrossSubApps(projectRoot, scanResults, featureMap);
  }

  // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
  //   Single-scope only; aggregated reads handle parseError per-scope.
  if (featureMap.parseError) {
    console.warn('cap: skipping enrichFromDesignTags — duplicate feature ID detected: ' + _safeForError(featureMap.parseError.message));
    return featureMap;
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
  // @cap-todo(ac:F-083/AC-6) Lazy-require monorepo helpers — see _monorepo() definition.
  const _mrSetUd = _monorepo();
  const redirectResult = _mrSetUd._maybeRedirectToSubApp(
    projectRoot, featureMap, feature, appPath, 'setFeatureUsesDesign',
    (resolvedAppPath) => setFeatureUsesDesign(projectRoot, featureId, designIds, resolvedAppPath)
  );
  if (redirectResult !== _mrSetUd._NO_REDIRECT) return redirectResult;

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

// @cap-feature(feature:F-083) Module exports assigned in TWO STAGES — Stage 1 attaches the
//   locally-defined exports; Stage 2 (the trailing block) attaches identity-preserving
//   references to the monorepo module's exports. AC-2 pins the identity-preservation contract.
// @cap-decision(F-083/backward-compat) Re-exports preserve zero call-site change contract.
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
  // @cap-todo(ac:F-083/AC-1) Internal helper exposed for the monorepo module's lazy-require.
  //   Not part of the documented public surface, but the monorepo module destructures it.
  _safeForError,
};

// @cap-todo(ac:F-083/AC-2) Stage-2 re-export attachment — identity-preserving wiring of the
//   monorepo module's exports onto this module's surface. Runs AFTER Stage 1 above.
{
  const _mr = _monorepo();
  for (const k of [
    'parseRescopedTable', 'discoverSubAppFeatureMaps', 'aggregateSubAppFeatureMaps',
    'extractRescopedBlock', 'injectRescopedBlock',
    '_enrichFromTagsAcrossSubApps', '_enrichFromDesignTagsAcrossSubApps',
    '_maybeRedirectToSubApp', '_NO_REDIRECT',
    'initAppFeatureMap', 'listAppFeatureMaps', 'rescopeFeatures',
  ]) module.exports[k] = _mr[k];
}
