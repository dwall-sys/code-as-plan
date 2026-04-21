// @cap-context CAP F-062 DESIGN.md engine -- deterministic aesthetic picker + idempotent DESIGN.md writer.
// @cap-context CAP F-063 additively attaches stable DT-NNN / DC-NNN IDs to DESIGN.md entries and exposes helpers for feature-map traceability.
// @cap-context CAP F-064 adds a pure, read-only review engine for DESIGN.md (Anti-Slop-Check).
// @cap-decision DESIGN.md is a single markdown file at project root next to FEATURE-MAP.md. Zero-deps, diffable, inspectable.
// @cap-decision(F-063/D1) ID format is an INLINE suffix — bullet form `- key: value (id: DT-NNN)`, component form `### Name (id: DC-NNN)`. Preserves F-062's line-scan merge, stays dense, diff-friendly.
// @cap-decision(F-063/D2) ID assignment is SEQUENTIAL per type (DT-001, DT-002...; DC-001, DC-002...). Computed from max existing ID + 1 — deterministic, human-readable, no gaps required but tolerated.
// @cap-decision(F-063/D4) Stable-ID guarantee — once assigned, NEVER renumbered. assignDesignIds only fills entries without ids; existing IDs are preserved byte-identical. This keeps F-068 (visual editor) edits from churning diffs.
// @cap-decision(F-064/D1) Design rules source-of-truth: DEFAULT_DESIGN_RULES is a frozen superset of ANTI_SLOP_RULES plus structural checks. Users override via `.cap/design-rules.md` (markdown-bullet format, no YAML, matches CAP convention).
// @cap-decision(F-064/D2) Review report artifact location: `.cap/DESIGN-REVIEW.md`. DESIGN.md itself is never modified by review — AC-3 is a hard read-only constraint enforced at library boundary (reviewDesign takes strings, never a path).
// @cap-decision(F-064/D3) Violation severity levels: `error` (hard rule violation), `warning` (style suggestion), `info` (informational). Default `warning`. Declared per-rule.
// @cap-decision(F-064/D4) Idempotence guarantee: violations sorted by (location.id || '__global__', rule-name, location.line || 0). No timestamps in report. Same input → byte-identical output.
// @cap-decision Idempotence guaranteed by pinning all tokens per aesthetic family in a lookup table and emitting NO timestamps, NO LLM-generated flavor text.
// @cap-constraint Zero external dependencies -- Node.js built-ins only (fs, path).

'use strict';

// @cap-feature(feature:F-062) cap:design Core — DESIGN.md + Aesthetic Picker
// @cap-feature(feature:F-063) Design-Feature Traceability — DT/DC IDs, tag recognition, and feature-map usesDesign helpers
// @cap-feature(feature:F-064) cap:design --review — Anti-Slop-Check (pure review engine, read-only)

const fs = require('node:fs');
const path = require('node:path');

// @cap-decision(F-064) Data extracted to cap-design-families.cjs once this file crossed 40KB.
//                      Re-exported below so the public API surface (AESTHETIC_FAMILIES, ANTI_SLOP_RULES, FAMILY_MAP,
//                      VALID_*) is unchanged for existing callers (F-062/F-063 tests, commands).
const {
  ANTI_SLOP_RULES,
  AESTHETIC_FAMILIES,
  FAMILY_MAP,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
} = require('./cap-design-families.cjs');

const DESIGN_FILE = 'DESIGN.md';

/**
 * @typedef {Object} ColorTokens
 * @property {string} primary
 * @property {string} secondary
 * @property {string} background
 * @property {string} surface
 * @property {string} text
 * @property {string} muted
 * @property {string} accent
 */

/**
 * @typedef {Object} TypographyTokens
 * @property {string} family
 * @property {string} familyMono
 * @property {number[]} scale
 */

/**
 * @typedef {Object} AestheticFamily
 * @property {string} key
 * @property {string} name
 * @property {string[]} referenceBrands
 * @property {ColorTokens} colors
 * @property {number[]} spacing
 * @property {TypographyTokens} typography
 * @property {Object<string, { variants: string[], states: string[] }>} components
 */

// Data moved to cap-design-families.cjs — see require() at top of file.


// @cap-api mapAnswersToFamily(readHeavy, userType, courageFactor) -- Deterministic wizard-answer lookup.
// @cap-todo(ac:F-062/AC-2) Maps the 3 wizard answers to exactly one of the 9 aesthetic families.
// @cap-todo(ac:F-062/AC-7) Must return byte-identical result on repeated calls with same input.
/**
 * @param {string} readHeavy - 'read-heavy' | 'scan-heavy'
 * @param {string} userType - 'consumer' | 'professional' | 'developer'
 * @param {string} courageFactor - 'safe' | 'balanced' | 'bold'
 * @returns {AestheticFamily} The resolved family object (from AESTHETIC_FAMILIES lookup).
 * @throws {Error} If any answer is not in the valid set.
 */
function mapAnswersToFamily(readHeavy, userType, courageFactor) {
  if (!VALID_READ_HEAVY.includes(readHeavy)) {
    throw new Error(`Invalid readHeavy: ${readHeavy}. Expected one of ${VALID_READ_HEAVY.join(', ')}`);
  }
  if (!VALID_USER_TYPES.includes(userType)) {
    throw new Error(`Invalid userType: ${userType}. Expected one of ${VALID_USER_TYPES.join(', ')}`);
  }
  if (!VALID_COURAGE.includes(courageFactor)) {
    throw new Error(`Invalid courageFactor: ${courageFactor}. Expected one of ${VALID_COURAGE.join(', ')}`);
  }

  const key = `${readHeavy}|${userType}|${courageFactor}`;
  const familyKey = FAMILY_MAP[key];
  // @cap-risk If FAMILY_MAP becomes incomplete, this throws -- fail loud rather than returning default silently.
  if (!familyKey) {
    throw new Error(`No family mapping for key: ${key}`);
  }
  return AESTHETIC_FAMILIES[familyKey];
}

// @cap-api buildDesignMd({family, extras, withIds}) -- Returns DESIGN.md content string (idempotent).
// @cap-todo(ac:F-062/AC-3) Output contains: Aesthetic Family, Tokens (colors/spacing/typography), Components (Button + Card), Anti-Patterns.
// @cap-todo(ac:F-062/AC-6) Anti-Patterns block rendered from ANTI_SLOP_RULES.
// @cap-todo(ac:F-062/AC-7) No timestamps, no randomness -- same input -> byte-identical output.
// @cap-todo(ac:F-063/AC-1) When `withIds` option is truthy, tokens and components are born with inline DT-NNN / DC-NNN suffixes. Default-off for backward-compatible F-062 test snapshots.
// @cap-decision F-063 hook: tokens/components are written in a stable ordered list form so F-063 can append `id: DT-NNN` / `id: DC-NNN` inline without breaking the v1 parser.
/**
 * @param {{ family: AestheticFamily, extras?: Object, withIds?: boolean }} input
 * @returns {string} Full DESIGN.md content.
 */
function buildDesignMd(input) {
  if (!input || !input.family) {
    throw new Error('buildDesignMd requires { family } input');
  }
  const fam = input.family;
  const withIds = Boolean(input.withIds);
  const lines = [];

  lines.push('# DESIGN.md');
  lines.push('');
  lines.push('> Single source of truth for design identity, tokens, components, and anti-patterns.');
  lines.push('> Written by /cap:design. Diff this file in git alongside FEATURE-MAP.md.');
  lines.push('');

  // Aesthetic Family
  lines.push(`## Aesthetic Family: ${fam.name}`);
  lines.push('');
  lines.push(`Key: \`${fam.key}\``);
  lines.push('');
  lines.push(`Reference brands: ${fam.referenceBrands.join(', ')}`);
  lines.push('');

  // Tokens
  lines.push('## Tokens');
  lines.push('');
  lines.push('### Colors');
  lines.push('');
  // Stable key order -- sorted alphabetically for determinism.
  const colorKeys = Object.keys(fam.colors).sort();
  // @cap-todo(ac:F-063/AC-1) Deterministic DT-NNN assignment: sequential in sorted key order.
  let dtCounter = 1;
  for (const k of colorKeys) {
    const suffix = withIds ? ` (id: ${formatDesignId('DT', dtCounter++)})` : '';
    lines.push(`- ${k}: ${fam.colors[k]}${suffix}`);
  }
  lines.push('');

  lines.push('### Spacing');
  lines.push('');
  // @cap-decision Spacing/typography scales are single-entry tokens. F-063 v1 assigns IDs only to colors (per-token) and components; scales remain unIDed until a user feature requires them. Revisit if impact-analysis demand surfaces (AC-6).
  lines.push(`- scale: [${fam.spacing.join(', ')}]`);
  lines.push('');

  lines.push('### Typography');
  lines.push('');
  lines.push(`- family: "${fam.typography.family}"`);
  lines.push(`- familyMono: "${fam.typography.familyMono}"`);
  lines.push(`- scale: [${fam.typography.scale.join(', ')}]`);
  lines.push('');

  // Components
  lines.push('## Components');
  lines.push('');
  const compKeys = Object.keys(fam.components).sort();
  // @cap-todo(ac:F-063/AC-1) Deterministic DC-NNN assignment: sequential in sorted component name order.
  let dcCounter = 1;
  for (const compName of compKeys) {
    const comp = fam.components[compName];
    const suffix = withIds ? ` (id: ${formatDesignId('DC', dcCounter++)})` : '';
    lines.push(`### ${compName}${suffix}`);
    lines.push('');
    lines.push(`- variants: [${comp.variants.join(', ')}]`);
    lines.push(`- states: [${comp.states.join(', ')}]`);
    lines.push('');
  }

  // Anti-Patterns
  lines.push('## Anti-Patterns');
  lines.push('');
  lines.push('Hard constraints enforced by cap-designer. Violating entries will be rejected during /cap:design --extend.');
  lines.push('');
  for (const rule of ANTI_SLOP_RULES) {
    lines.push(`- ${rule}`);
  }
  lines.push('');

  return lines.join('\n');
}

// @cap-api readDesignMd(projectRoot) -- Read DESIGN.md from project root.
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @returns {string|null} File contents, or null if the file does not exist.
 */
function readDesignMd(projectRoot) {
  const filePath = path.join(projectRoot, DESIGN_FILE);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// @cap-api writeDesignMd(projectRoot, content) -- Write DESIGN.md to project root.
// @cap-todo(ac:F-062/AC-4) DESIGN.md lies at project root next to FEATURE-MAP.md and is versioned via git (no gitignore).
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @param {string} content - Full DESIGN.md content.
 */
function writeDesignMd(projectRoot, content) {
  const filePath = path.join(projectRoot, DESIGN_FILE);
  fs.writeFileSync(filePath, content, 'utf8');
}

// @cap-api extendDesignMd(existing, additions, options) -- Append-only merge for /cap:design --extend.
// @cap-todo(ac:F-062/AC-5) Adds new tokens/components to existing DESIGN.md without overwriting existing entries.
// @cap-todo(ac:F-063/AC-1) When options.withIds is truthy, newly appended entries receive the next free DT-NNN / DC-NNN ID. Existing entries keep whatever IDs they already have (stable-ID guarantee, D4).
// @cap-decision Line-scan merge instead of markdown parsing -- keeps zero-deps and preserves author edits in unrelated sections.
// @cap-risk extendDesignMd multi-line injection is snapshot-locked (F-062 review note). F-063 only appends an optional trailing ` (id: DT-NNN)` suffix to NEW bullet / header lines. Existing injection tests still hold — the lines we splice in retain the same base shape.
/**
 * @param {string} existing - Current DESIGN.md content.
 * @param {{ colors?: Object<string,string>, components?: Object<string, { variants: string[], states: string[] }> }} additions
 * @param {{ withIds?: boolean }} [options]
 * @returns {string} Updated DESIGN.md content. Existing token/component entries are preserved verbatim.
 */
function extendDesignMd(existing, additions, options) {
  if (typeof existing !== 'string') {
    throw new Error('extendDesignMd requires existing content string');
  }
  const adds = additions || {};
  const opts = options || {};
  const withIds = Boolean(opts.withIds);
  const lines = existing.split('\n');

  // Pre-scan for existing IDs so new entries get the NEXT free number.
  // Stable-ID guarantee (D4): pre-existing IDs are never rewritten.
  const existingIds = parseDesignIds(existing);
  let nextDt = nextIdNumber(existingIds.tokens);
  let nextDc = nextIdNumber(existingIds.components);

  // --- Merge colors (append new keys under ### Colors, skip duplicates) ---
  if (adds.colors && Object.keys(adds.colors).length > 0) {
    const colorsIdx = lines.findIndex(l => l.trim() === '### Colors');
    if (colorsIdx !== -1) {
      // Find end of the Colors block (next blank line after the list)
      let insertAt = colorsIdx + 1;
      const existingColorKeys = new Set();
      // Skip the blank line after the header
      while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
      // Walk the bullet list
      while (insertAt < lines.length && lines[insertAt].startsWith('- ')) {
        const match = lines[insertAt].match(/^-\s+([^:]+):/);
        if (match) existingColorKeys.add(match[1].trim());
        insertAt++;
      }
      // @cap-todo(ac:F-062/AC-5) Only append keys not already present -- preserves existing entries.
      const newLines = [];
      const newColorKeys = Object.keys(adds.colors).sort();
      for (const k of newColorKeys) {
        if (!existingColorKeys.has(k)) {
          const suffix = withIds ? ` (id: ${formatDesignId('DT', nextDt++)})` : '';
          newLines.push(`- ${k}: ${adds.colors[k]}${suffix}`);
        }
      }
      if (newLines.length > 0) {
        lines.splice(insertAt, 0, ...newLines);
      }
    }
  }

  // --- Merge components (append new component sections under ## Components, skip duplicates) ---
  if (adds.components && Object.keys(adds.components).length > 0) {
    const compHdrIdx = lines.findIndex(l => l.trim() === '## Components');
    if (compHdrIdx !== -1) {
      // Find end of Components section (next "## " header or EOF)
      let sectionEnd = compHdrIdx + 1;
      while (sectionEnd < lines.length && !lines[sectionEnd].startsWith('## ')) {
        sectionEnd++;
      }
      // Collect existing component names (### Foo  or  ### Foo (id: DC-001))
      const existingCompNames = new Set();
      for (let i = compHdrIdx + 1; i < sectionEnd; i++) {
        const m = lines[i].match(/^###\s+(\S+)/);
        if (m) existingCompNames.add(m[1]);
      }
      // @cap-todo(ac:F-062/AC-5) Only append components not already present.
      const newCompNames = Object.keys(adds.components).sort();
      const insertion = [];
      for (const name of newCompNames) {
        if (existingCompNames.has(name)) continue;
        const comp = adds.components[name];
        const suffix = withIds ? ` (id: ${formatDesignId('DC', nextDc++)})` : '';
        insertion.push(`### ${name}${suffix}`);
        insertion.push('');
        insertion.push(`- variants: [${(comp.variants || []).join(', ')}]`);
        insertion.push(`- states: [${(comp.states || []).join(', ')}]`);
        insertion.push('');
      }
      if (insertion.length > 0) {
        lines.splice(sectionEnd, 0, ...insertion);
      }
    }
  }

  return lines.join('\n');
}

// @cap-feature(feature:F-063) Design-ID helpers — parser + assigner + impact-analysis.

// @cap-decision(F-063/D1) Inline ID regex:
//   - Token:    "- primary: #HEX (id: DT-001)"  — captured on bullet lines inside ### Colors
//   - Component: "### Button (id: DC-001)"      — captured on component headers inside ## Components
// @cap-risk The regex is intentionally permissive about surrounding whitespace/punctuation
//           but REQUIRES the `(id: XX-NNN)` parenthesized form. Markdown-linters that collapse
//           trailing whitespace will not break the suffix.
const DESIGN_TOKEN_ID_RE = /\(id:\s*(DT-\d{3,})\)/;
const DESIGN_COMPONENT_ID_RE = /\(id:\s*(DC-\d{3,})\)/;

// @cap-api formatDesignId(prefix, n) -- zero-padded 3-digit ID formatter.
/**
 * @param {'DT'|'DC'} prefix
 * @param {number} n - 1-based counter
 * @returns {string}
 */
function formatDesignId(prefix, n) {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// @cap-api nextIdNumber(existingIds) -- Return the next sequential number not already used.
// Gaps are tolerated — we always return max+1 to satisfy the stable-ID guarantee (D4).
/**
 * @param {string[]} existingIds - e.g. ['DT-001', 'DT-003']
 * @returns {number} - next number to use (e.g. 4)
 */
function nextIdNumber(existingIds) {
  let max = 0;
  for (const id of existingIds || []) {
    const m = String(id).match(/-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// @cap-api getNextDesignId(type, existing) -- Convenience wrapper that returns a formatted ID.
// @cap-todo(ac:F-063/AC-1) Sequential DT-NNN / DC-NNN assignment driven by max existing + 1.
/**
 * @param {'token'|'component'} type
 * @param {string[]} existing - existing IDs of the same type
 * @returns {string} - next formatted ID, e.g. "DT-004"
 */
function getNextDesignId(type, existing) {
  if (type !== 'token' && type !== 'component') {
    throw new Error(`getNextDesignId: type must be 'token' or 'component', got ${type}`);
  }
  const prefix = type === 'token' ? 'DT' : 'DC';
  return formatDesignId(prefix, nextIdNumber(existing));
}

// @cap-api parseDesignIds(content) -- Extract all DT-NNN / DC-NNN IDs from DESIGN.md content.
// @cap-todo(ac:F-063/AC-1) Parser recognises inline `(id: DT-NNN)` and `(id: DC-NNN)` suffixes so callers can see which entries are already stable-ID-tagged.
/**
 * @param {string} content - DESIGN.md content
 * @returns {{
 *   tokens: string[],        // all DT-NNN IDs in file order
 *   components: string[],    // all DC-NNN IDs in file order
 *   byToken: Object<string,{id:string,key:string,value:string,line:number}>,
 *   byComponent: Object<string,{id:string,name:string,line:number}>,
 * }}
 */
function parseDesignIds(content) {
  const result = {
    tokens: [],
    components: [],
    byToken: {},
    byComponent: {},
  };
  if (typeof content !== 'string' || content.length === 0) return result;

  const lines = content.split('\n');
  // @cap-decision Section tracking mirrors F-062's extendDesignMd approach — scan by ## / ### boundaries.
  // We do not hard-code a section-name allowlist; any bullet with `(id: DT-NNN)` counts as a token entry,
  // any `### Foo (id: DC-NNN)` header counts as a component. This tolerates user-added sections (e.g. typography
  // tokens in the future) without breaking.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Component header
    const compHeaderMatch = line.match(/^###\s+(\S[^(]*?)\s*\(id:\s*(DC-\d{3,})\)/);
    if (compHeaderMatch) {
      const name = compHeaderMatch[1].trim();
      const id = compHeaderMatch[2];
      result.components.push(id);
      result.byComponent[id] = { id, name, line: i + 1 };
      continue;
    }

    // Bullet token
    const bulletMatch = line.match(/^-\s+([^:]+):\s*(.+?)\s*\(id:\s*(DT-\d{3,})\)\s*$/);
    if (bulletMatch) {
      const key = bulletMatch[1].trim();
      const value = bulletMatch[2].trim();
      const id = bulletMatch[3];
      result.tokens.push(id);
      result.byToken[id] = { id, key, value, line: i + 1 };
    }
  }

  return result;
}

// @cap-api assignDesignIds(content) -- Walk DESIGN.md content and add DT/DC IDs to entries that lack them.
// @cap-todo(ac:F-063/AC-1) Retrofits IDs onto an F-062-era DESIGN.md. Existing IDs are preserved verbatim (stable-ID guarantee D4).
// @cap-decision Only color bullets (under `### Colors`) and component headers (under `## Components`) are IDed in v1.
//               Spacing/typography scales stay un-IDed until a user feature explicitly needs to reference them.
/**
 * @param {string} content - DESIGN.md content
 * @returns {{ content: string, assigned: { tokens: Array<{key:string,id:string}>, components: Array<{name:string,id:string}> } }}
 */
function assignDesignIds(content) {
  const out = { content, assigned: { tokens: [], components: [] } };
  if (typeof content !== 'string' || content.length === 0) return out;

  const existing = parseDesignIds(content);
  let nextDt = nextIdNumber(existing.tokens);
  let nextDc = nextIdNumber(existing.components);

  const lines = content.split('\n');
  let inColors = false;
  let inComponents = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Section tracking
    if (trimmed.startsWith('### ')) {
      // entering a subsection — decide context from the header text
      if (trimmed === '### Colors') { inColors = true; continue; }
      if (inComponents) {
        // Component header — tag with DC if it lacks one
        if (!DESIGN_COMPONENT_ID_RE.test(line)) {
          const hdrMatch = line.match(/^###\s+(.+?)\s*$/);
          if (hdrMatch) {
            const name = hdrMatch[1].trim();
            const id = formatDesignId('DC', nextDc++);
            lines[i] = `### ${name} (id: ${id})`;
            out.assigned.components.push({ name, id });
          }
        }
        continue;
      }
      // other ### subsection (Spacing, Typography) — leave alone but close Colors
      inColors = false;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      inColors = false;
      inComponents = (trimmed === '## Components');
      continue;
    }

    if (inColors && line.startsWith('- ')) {
      if (!DESIGN_TOKEN_ID_RE.test(line)) {
        // Add ID suffix — preserve existing key/value text byte-for-byte up to the trailing whitespace
        const bulletMatch = line.match(/^(-\s+([^:]+):\s*.+?)\s*$/);
        if (bulletMatch) {
          const base = bulletMatch[1];
          const key = bulletMatch[2].trim();
          const id = formatDesignId('DT', nextDt++);
          lines[i] = `${base} (id: ${id})`;
          out.assigned.tokens.push({ key, id });
        }
      }
    }
  }

  out.content = lines.join('\n');
  return out;
}

// @cap-api findFeaturesUsingDesignId(featureMap, designId) -- Impact-analysis for AC-6.
// @cap-todo(ac:F-063/AC-6) Given a DT-NNN or DC-NNN, return features whose `usesDesign` includes it.
/**
 * @param {{features: Array<{id:string,title?:string,usesDesign?:string[]}>}} featureMap
 * @param {string} designId - e.g. "DT-001"
 * @returns {Array<{id:string,title:string|null}>} - features that reference this design ID
 */
function findFeaturesUsingDesignId(featureMap, designId) {
  const out = [];
  if (!featureMap || !Array.isArray(featureMap.features) || !designId) return out;
  for (const f of featureMap.features) {
    const uses = Array.isArray(f.usesDesign) ? f.usesDesign : [];
    if (uses.includes(designId)) {
      out.push({ id: f.id, title: f.title || null });
    }
  }
  return out;
}

// @cap-feature(feature:F-064) Anti-Slop Review Engine — pure review function over DESIGN.md content.
// @cap-constraint reviewDesign is synchronous, pure (string-in / array-out). No I/O, no fs access, no mutation of inputs.

const DESIGN_REVIEW_FILE = '.cap/DESIGN-REVIEW.md';

// @cap-decision(F-064/D3) Severity levels frozen here so callers cannot introduce silent new levels.
const REVIEW_SEVERITIES = Object.freeze(['error', 'warning', 'info']);

// @cap-todo(ac:F-064/AC-2) Structured rule schema: name, severity, kind, check(content, ctx) -> violations[].
// @cap-decision(F-064/D1) Default rules are pinned here. Built-in checks cover typography, color, layout, structure.
//              Each rule returns an array of { id, kind, rule, location, suggestion, severity }.
//              Rules are PURE functions of (content, parsedContext). No network, no fs, no randomness.
const DEFAULT_DESIGN_RULES = Object.freeze([
  // Typography
  Object.freeze({
    name: 'typography/no-generic-fonts',
    severity: 'error',
    kind: 'typography',
    description: 'Reject generic fonts (Inter, Roboto, Arial, Helvetica, sans-serif) as primary typefaces.',
    suggestion: 'Use an opinionated typeface aligned with the aesthetic family (see Tokens).',
  }),
  // Color
  Object.freeze({
    name: 'color/no-cliche-gradients',
    severity: 'error',
    kind: 'color',
    description: 'Reject cliche purple-blue SaaS-template gradients (e.g. #667eea -> #764ba2).',
    suggestion: 'Derive gradients from the primary + accent tokens; purple-blue duos are SaaS-template slop.',
  }),
  // Layout
  Object.freeze({
    name: 'layout/no-cookie-cutter',
    severity: 'warning',
    kind: 'layout',
    description: 'Reject "centered hero + 3-column feature cards + CTA" template-grammar mentions.',
    suggestion: 'Break the template grammar — vary hero alignment or section grammar.',
  }),
  // Structure (F-063-aware)
  Object.freeze({
    name: 'structure/inconsistent-token-ids',
    severity: 'warning',
    kind: 'structure',
    description: 'Tokens without DT-NNN IDs when the DESIGN.md has some IDs already (inconsistent coverage).',
    suggestion: 'Run /cap:design --review or re-run /cap:design to retrofit DT-NNN IDs.',
  }),
  Object.freeze({
    name: 'structure/inconsistent-component-ids',
    severity: 'warning',
    kind: 'structure',
    description: 'Components without DC-NNN IDs when the DESIGN.md has some IDs already (inconsistent coverage).',
    suggestion: 'Retrofit DC-NNN IDs via assignDesignIds.',
  }),
  Object.freeze({
    name: 'structure/duplicate-ids',
    severity: 'error',
    kind: 'structure',
    description: 'Duplicate DT-NNN or DC-NNN ID detected — violates stable-ID guarantee (F-063/D4).',
    suggestion: 'Rename the duplicate to the next free ID; investigate which entry is the original.',
  }),
]);

// @cap-decision(F-064/D1) Generic font list is a frozen set — matched case-insensitively against the typography family value.
//              "SF Pro" is excluded here (allowed for glass-soft-futurism family per F-062) — cf. ANTI_SLOP_RULES wording.
const GENERIC_FONT_PATTERNS = Object.freeze([
  /(^|[,\s"'])inter([,\s"']|$)/i,
  /(^|[,\s"'])roboto([,\s"']|$)/i,
  /(^|[,\s"'])arial([,\s"']|$)/i,
  /(^|[,\s"'])helvetica([,\s"']|$)/i,
  /(^|[,\s"'])sans-serif([,\s"']|$)/i,
]);

// @cap-decision(F-064/D1) Purple-blue cliche gradient regex — matches the canonical #667eea/#764ba2 duo AND common near-variants.
//              We do not attempt full color-space analysis in v1 — literal string matching is adequate for template-slop detection.
const CLICHE_GRADIENT_PATTERNS = Object.freeze([
  /#667eea/i,
  /#764ba2/i,
  /linear-gradient\s*\(\s*[^)]*#66[67][a-f0-9]{3}[^)]*#76[4-5][a-f0-9]{3}/i,
]);

// @cap-decision(F-064/D1) Cookie-cutter layout markers — substring matches against DESIGN.md content.
const COOKIE_CUTTER_PHRASES = Object.freeze([
  'centered hero + 3-column feature cards',
  'hero + 3-column feature cards + cta',
  '3-column feature cards',
]);

// @cap-api parseDesignRules(ruleMarkdown) -- Parse optional `.cap/design-rules.md`; return default rules if input is empty/null.
// @cap-todo(ac:F-064/AC-4) Review-Regelbasis ist konfigurierbar via `.cap/design-rules.md` — markdown bullets under `## Rules`.
// @cap-decision(F-064/D1) Custom-rule format is MARKDOWN bullets, not YAML, matching CAP's `.md` convention.
//              Each bullet: `- **[kind] rule-name**: description. Suggestion: ...` with optional `[severity: error|warning|info]` prefix.
//              Parser is intentionally forgiving — malformed bullets are SKIPPED (not errored).
/**
 * @param {string|null|undefined} ruleMarkdown - Content of `.cap/design-rules.md` or null.
 * @returns {Array<{name:string, severity:string, kind:string, description:string, suggestion:string}>}
 *          Frozen default ruleset if input is empty; otherwise the parsed ruleset.
 */
function parseDesignRules(ruleMarkdown) {
  if (typeof ruleMarkdown !== 'string' || ruleMarkdown.trim().length === 0) {
    return DEFAULT_DESIGN_RULES;
  }

  const lines = ruleMarkdown.split('\n');
  let inRulesSection = false;
  const out = [];
  let currentRule = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^##\s+Rules\s*$/i.test(trimmed)) {
      inRulesSection = true;
      continue;
    }
    if (inRulesSection && /^##\s+\S/.test(trimmed)) {
      // Entering a different H2 closes the Rules section.
      inRulesSection = false;
      if (currentRule) { out.push(Object.freeze(currentRule)); currentRule = null; }
      continue;
    }

    if (!inRulesSection) continue;

    // Bullet start: `- **[kind] rule-name**: description`
    //             or `- **[kind][severity:error] rule-name**: description`
    const bulletMatch = line.match(/^\s*-\s+\*\*\[([^\]]+)\](?:\[severity:\s*(error|warning|info)\])?\s+([^*]+?)\*\*\s*:\s*(.*)$/i);
    if (bulletMatch) {
      if (currentRule) out.push(Object.freeze(currentRule));
      const kind = bulletMatch[1].trim();
      const severity = (bulletMatch[2] || 'warning').trim().toLowerCase();
      const name = `${kind}/${bulletMatch[3].trim()}`;
      const description = bulletMatch[4].trim();
      currentRule = { name, severity, kind, description, suggestion: '' };
      continue;
    }

    // Continuation: "  Suggestion: ..."
    const sugMatch = line.match(/^\s+Suggestion:\s*(.+)$/i);
    if (sugMatch && currentRule) {
      currentRule.suggestion = sugMatch[1].trim();
      continue;
    }
  }

  if (currentRule) out.push(Object.freeze(currentRule));

  // @cap-decision If user's file has NO valid rules, fall back to defaults (loud-quiet middle ground).
  //               A user with malformed rules should still get the baseline Anti-Slop coverage.
  if (out.length === 0) return DEFAULT_DESIGN_RULES;

  return Object.freeze(out);
}

// @cap-api reviewDesign(designMdContent, rules) -- Pure review function. Returns sorted, deterministic violations array.
// @cap-todo(ac:F-064/AC-1) Review engine applies rules to DESIGN.md content, returns structured violations.
// @cap-todo(ac:F-064/AC-2) Violation schema: { id, kind, rule, location, suggestion, severity }.
// @cap-todo(ac:F-064/AC-3) PURE function — no writes. Takes string input, returns array. Never touches fs.
// @cap-todo(ac:F-064/AC-5) Deterministic: sort order is (location.id || '__global__', rule-name, location.line || 0).
/**
 * @param {string} designMdContent - DESIGN.md content to review.
 * @param {Array<object>} [rules] - Ruleset (defaults to DEFAULT_DESIGN_RULES).
 * @returns {Array<{id:string|null, kind:string, rule:string, location:{line:number|null,id:string|null,section:string|null}, suggestion:string, severity:string}>}
 */
function reviewDesign(designMdContent, rules) {
  if (typeof designMdContent !== 'string') {
    throw new Error('reviewDesign requires a string (DESIGN.md content)');
  }
  const activeRules = Array.isArray(rules) && rules.length > 0 ? rules : DEFAULT_DESIGN_RULES;
  const ruleIndex = new Map();
  for (const r of activeRules) ruleIndex.set(r.name, r);

  const violations = [];
  const lines = designMdContent.split('\n');
  const ids = parseDesignIds(designMdContent);

  // --- Rule: typography/no-generic-fonts ---
  // @cap-todo(ac:F-064/AC-1) Check typography.family bullet value against the generic-font denylist.
  const typoRule = ruleIndex.get('typography/no-generic-fonts');
  if (typoRule) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^-\s+family(?:Mono)?:\s*"([^"]+)"/);
      if (!m) continue;
      const value = m[1];
      for (const pat of GENERIC_FONT_PATTERNS) {
        if (pat.test(value)) {
          violations.push({
            id: null,
            kind: typoRule.kind,
            rule: typoRule.name,
            location: { line: i + 1, id: null, section: 'Typography' },
            suggestion: typoRule.suggestion,
            severity: typoRule.severity,
          });
          break; // one violation per line is enough
        }
      }
    }
  }

  // --- Rule: color/no-cliche-gradients ---
  // @cap-todo(ac:F-064/AC-1) Match cliche purple-blue gradients anywhere in the document.
  const gradRule = ruleIndex.get('color/no-cliche-gradients');
  if (gradRule) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of CLICHE_GRADIENT_PATTERNS) {
        if (pat.test(line)) {
          // Attempt to attach a DT-NNN id if the bullet has one inline.
          const idMatch = line.match(DESIGN_TOKEN_ID_RE);
          violations.push({
            id: idMatch ? idMatch[1] : null,
            kind: gradRule.kind,
            rule: gradRule.name,
            location: { line: i + 1, id: idMatch ? idMatch[1] : null, section: null },
            suggestion: gradRule.suggestion,
            severity: gradRule.severity,
          });
          break;
        }
      }
    }
  }

  // --- Rule: layout/no-cookie-cutter ---
  // @cap-todo(ac:F-064/AC-1) Match cookie-cutter layout phrases (case-insensitive substring).
  const layoutRule = ruleIndex.get('layout/no-cookie-cutter');
  if (layoutRule) {
    const lcContent = designMdContent.toLowerCase();
    for (const phrase of COOKIE_CUTTER_PHRASES) {
      const idx = lcContent.indexOf(phrase);
      if (idx === -1) continue;
      // Find the line number for the first hit only — deterministic, one violation per phrase.
      let cum = 0;
      let lineNum = 1;
      for (let i = 0; i < lines.length; i++) {
        if (cum + lines[i].length >= idx) { lineNum = i + 1; break; }
        cum += lines[i].length + 1; // +1 for the \n
      }
      violations.push({
        id: null,
        kind: layoutRule.kind,
        rule: layoutRule.name,
        location: { line: lineNum, id: null, section: null },
        suggestion: layoutRule.suggestion,
        severity: layoutRule.severity,
      });
    }
  }

  // --- Rule: structure/inconsistent-token-ids ---
  // @cap-todo(ac:F-064/AC-1) Flag token bullets without DT-NNN when any DT-NNN exists in the file.
  const tokenStructRule = ruleIndex.get('structure/inconsistent-token-ids');
  if (tokenStructRule && ids.tokens.length > 0) {
    let inColors = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '### Colors') { inColors = true; continue; }
      if (trimmed.startsWith('## ') || (trimmed.startsWith('### ') && trimmed !== '### Colors')) {
        inColors = false;
        continue;
      }
      if (inColors && lines[i].startsWith('- ') && !DESIGN_TOKEN_ID_RE.test(lines[i])) {
        const keyMatch = lines[i].match(/^-\s+([^:]+):/);
        const key = keyMatch ? keyMatch[1].trim() : null;
        violations.push({
          id: null,
          kind: tokenStructRule.kind,
          rule: tokenStructRule.name,
          location: { line: i + 1, id: null, section: 'Colors' },
          suggestion: tokenStructRule.suggestion + (key ? ` (missing on: ${key})` : ''),
          severity: tokenStructRule.severity,
        });
      }
    }
  }

  // --- Rule: structure/inconsistent-component-ids ---
  // @cap-todo(ac:F-064/AC-1) Flag component headers without DC-NNN when any DC-NNN exists.
  const compStructRule = ruleIndex.get('structure/inconsistent-component-ids');
  if (compStructRule && ids.components.length > 0) {
    let inComponents = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '## Components') { inComponents = true; continue; }
      if (trimmed.startsWith('## ') && trimmed !== '## Components') { inComponents = false; continue; }
      if (inComponents && trimmed.startsWith('### ') && !DESIGN_COMPONENT_ID_RE.test(lines[i])) {
        const nameMatch = lines[i].match(/^###\s+(.+?)\s*$/);
        const name = nameMatch ? nameMatch[1].trim() : null;
        violations.push({
          id: null,
          kind: compStructRule.kind,
          rule: compStructRule.name,
          location: { line: i + 1, id: null, section: 'Components' },
          suggestion: compStructRule.suggestion + (name ? ` (missing on: ${name})` : ''),
          severity: compStructRule.severity,
        });
      }
    }
  }

  // --- Rule: structure/duplicate-ids ---
  // @cap-todo(ac:F-064/AC-1) Defensive check — duplicate IDs should never exist but we scan anyway.
  const dupRule = ruleIndex.get('structure/duplicate-ids');
  if (dupRule) {
    const seenDt = new Map();
    const seenDc = new Map();
    for (const id of ids.tokens) seenDt.set(id, (seenDt.get(id) || 0) + 1);
    for (const id of ids.components) seenDc.set(id, (seenDc.get(id) || 0) + 1);
    for (const [id, count] of seenDt.entries()) {
      if (count > 1) {
        violations.push({
          id,
          kind: dupRule.kind,
          rule: dupRule.name,
          location: { line: ids.byToken[id] ? ids.byToken[id].line : null, id, section: 'Colors' },
          suggestion: dupRule.suggestion,
          severity: dupRule.severity,
        });
      }
    }
    for (const [id, count] of seenDc.entries()) {
      if (count > 1) {
        violations.push({
          id,
          kind: dupRule.kind,
          rule: dupRule.name,
          location: { line: ids.byComponent[id] ? ids.byComponent[id].line : null, id, section: 'Components' },
          suggestion: dupRule.suggestion,
          severity: dupRule.severity,
        });
      }
    }
  }

  // @cap-todo(ac:F-064/AC-5) Deterministic sort: (location.id || '__global__', rule-name, location.line || 0).
  // @cap-decision(F-064/D4) '__global__' sentinel sorts after real IDs alphabetically because 'DT-' < 'DC-' < '__global__' in ASCII.
  //              That is acceptable — the important invariant is CONSISTENT ordering, not a specific bucket order.
  violations.sort((a, b) => {
    const aId = a.location && a.location.id ? a.location.id : '__global__';
    const bId = b.location && b.location.id ? b.location.id : '__global__';
    if (aId !== bId) return aId < bId ? -1 : 1;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    const aLine = (a.location && typeof a.location.line === 'number') ? a.location.line : 0;
    const bLine = (b.location && typeof b.location.line === 'number') ? b.location.line : 0;
    return aLine - bLine;
  });

  return violations;
}

// @cap-api formatReviewReport(violations) -- Render a deterministic markdown report.
// @cap-todo(ac:F-064/AC-2) Renders violations as structured markdown (IDs, rules, locations, suggestions).
// @cap-todo(ac:F-064/AC-5) No timestamps. Byte-identical output for byte-identical input.
/**
 * @param {Array<object>} violations - Output of reviewDesign.
 * @returns {string} Markdown report body.
 */
function formatReviewReport(violations) {
  const lines = [];
  lines.push('# DESIGN.md Review');
  lines.push('');
  lines.push('> Anti-Slop-Check report. Read-only artifact produced by /cap:design --review.');
  lines.push('> Violations listed below. DESIGN.md itself is NEVER modified by review.');
  lines.push('');

  if (!Array.isArray(violations) || violations.length === 0) {
    lines.push('## Summary');
    lines.push('');
    lines.push('No violations found. DESIGN.md passes all configured rules.');
    lines.push('');
    return lines.join('\n');
  }

  // --- Summary counts by severity ---
  const counts = { error: 0, warning: 0, info: 0 };
  for (const v of violations) {
    const sev = v.severity && counts[v.severity] !== undefined ? v.severity : 'warning';
    counts[sev]++;
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total violations: ${violations.length}`);
  lines.push(`- Errors:   ${counts.error}`);
  lines.push(`- Warnings: ${counts.warning}`);
  lines.push(`- Info:     ${counts.info}`);
  lines.push('');

  lines.push('## Violations');
  lines.push('');

  for (const v of violations) {
    const id = v.id || (v.location && v.location.id) || '(global)';
    const rule = v.rule || '(unnamed)';
    const kind = v.kind || 'unknown';
    const severity = v.severity || 'warning';
    const line = v.location && typeof v.location.line === 'number' ? `line ${v.location.line}` : 'n/a';
    const section = v.location && v.location.section ? v.location.section : null;

    lines.push(`### ${id} — ${rule} [${severity}]`);
    lines.push('');
    lines.push(`- kind: ${kind}`);
    lines.push(`- location: ${line}${section ? ` (${section})` : ''}`);
    if (v.suggestion) lines.push(`- suggestion: ${v.suggestion}`);
    lines.push('');
  }

  return lines.join('\n');
}

// @cap-api readDesignRules(projectRoot) -- Read `.cap/design-rules.md` if present.
// @cap-todo(ac:F-064/AC-4) Returns null when no file (parseDesignRules treats null as default-rules trigger).
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @returns {string|null}
 */
function readDesignRules(projectRoot) {
  const filePath = path.join(projectRoot, '.cap', 'design-rules.md');
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

// @cap-api writeDesignReview(projectRoot, content) -- Write review report to `.cap/DESIGN-REVIEW.md`.
// @cap-decision(F-064/D2) Report artifact lives under `.cap/` runtime dir, matching `.cap/REVIEW.md` pattern.
//              DESIGN.md is NEVER touched by review — AC-3 hard read-only constraint.
/**
 * @param {string} projectRoot - Absolute path to project root.
 * @param {string} content - Report content.
 */
function writeDesignReview(projectRoot, content) {
  const capDir = path.join(projectRoot, '.cap');
  if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
  const filePath = path.join(projectRoot, DESIGN_REVIEW_FILE);
  fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = {
  DESIGN_FILE,
  AESTHETIC_FAMILIES,
  ANTI_SLOP_RULES,
  FAMILY_MAP,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
  mapAnswersToFamily,
  buildDesignMd,
  readDesignMd,
  writeDesignMd,
  extendDesignMd,
  // F-063
  DESIGN_TOKEN_ID_RE,
  DESIGN_COMPONENT_ID_RE,
  formatDesignId,
  nextIdNumber,
  getNextDesignId,
  parseDesignIds,
  assignDesignIds,
  findFeaturesUsingDesignId,
  // F-064
  DESIGN_REVIEW_FILE,
  REVIEW_SEVERITIES,
  DEFAULT_DESIGN_RULES,
  parseDesignRules,
  reviewDesign,
  formatReviewReport,
  readDesignRules,
  writeDesignReview,
};
