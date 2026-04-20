'use strict';

// @cap-feature(feature:F-047, primary:true) Unified Feature Anchor Block parser.
// Parses the new single-block syntax introduced by CAP v3:
//
//   /* @cap feature:F-001 acs:[AC-1,AC-3] role:primary */
//   # @cap feature:F-001 acs:[AC-1,AC-3] role:primary
//   <!-- @cap feature:F-001 acs:[AC-1,AC-3] role:primary -->
//
// The parser is language-agnostic — it is called by cap-tag-scanner AFTER comment
// delimiter stripping, so this module only sees the inner `@cap key:value ...` content.
//
// @cap-decision Pure logic, zero side effects. Scanner owns the "is this a comment?" layer
// (F-046 polylingual detection) and feeds stripped lines into parseAnchorLine(). This keeps
// the scanner single-source-of-truth for comment detection and avoids duplicating the
// polyglot rules here.
// @cap-decision expandAnchorToTags() emits tags in the SAME shape as scanner.extractTags()
// so all downstream code (buildAcFileMap, cap-deps, cap-completeness, cap-reconcile) works
// unchanged. Legacy fragmented tags and unified anchors are indistinguishable at the tag
// consumer layer — only the scanner layer sees the new syntax.

// @cap-risk Regex-based. Does not parse nested brackets or quoted key:value pairs.
// Limitations:
//   - values with `[`, `]`, `,`, or whitespace must not appear unquoted (documented)
//   - no support for multi-line anchor bodies (block must be single line inside its comment)
// These are intentional for v1 to keep parsing unambiguous.

// Matches `@cap <rest>` — called on an already-decommented line or the inner content of a
// block comment. Captures `rest` which is then tokenised into key:value pairs.
const ANCHOR_RE = /@cap\s+([^\n]+)/;

// Matches `key:value` where value is either `[list,of,items]` or a bare token (no whitespace,
// no commas, no brackets). The anchor body is split into key:value pairs by whitespace.
const KV_TOKEN_RE = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(\[[^\]]*\]|[^\s\[\]]+)$/;

/**
 * @typedef {Object} ParsedAnchor
 * @property {string} feature - Feature ID (e.g. 'F-001'); required
 * @property {string[]} acs    - AC IDs (e.g. ['AC-1','AC-3']); empty when not specified
 * @property {('primary'|'secondary'|null)} role - 'primary', 'secondary', or null (unspecified)
 * @property {string} raw      - The original `@cap …` text for error reporting
 * @property {string[]} warnings - Soft warnings (unknown keys, malformed AC ids, …)
 */

/**
 * Parse a single `@cap key:value …` body (the content inside the comment, already
 * stripped of delimiters like `/*`, `*` /, `#`, `<!--`, `-->`).
 *
 * Returns null when no `@cap` token is present or the line is completely malformed.
 * When the token is present but some keys are unrecognised or values are malformed,
 * still returns a ParsedAnchor with the recognised subset plus a `warnings` array so
 * callers can surface soft failures without losing usable information.
 *
 * @param {string} line
 * @returns {ParsedAnchor|null}
 */
function parseAnchorLine(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(ANCHOR_RE);
  if (!m) return null;

  const body = m[1].trim();
  // Strip trailing comment delimiters that may have leaked through (e.g. `-->` or `*/`)
  const cleaned = body
    .replace(/\s*-->\s*$/, '')
    .replace(/\s*\*\/\s*$/, '')
    .trim();

  /** @type {ParsedAnchor} */
  const out = { feature: '', acs: [], role: null, raw: m[0], warnings: [] };
  if (cleaned.length === 0) {
    out.warnings.push('empty anchor body');
    return out;
  }

  // Tokenise by whitespace; each token must match key:value.
  const tokens = cleaned.split(/\s+/);
  for (const tok of tokens) {
    const km = tok.match(KV_TOKEN_RE);
    if (!km) {
      out.warnings.push(`unparseable token: ${tok}`);
      continue;
    }
    const key = km[1];
    const value = km[2];
    switch (key) {
      case 'feature':
        if (!/^F-\d{3,}$/.test(value)) {
          out.warnings.push(`feature value must match /^F-\\d{3,}$/ (got ${value})`);
        }
        out.feature = value;
        break;
      case 'acs': {
        if (!value.startsWith('[') || !value.endsWith(']')) {
          out.warnings.push(`acs must be [bracketed,list] (got ${value})`);
          break;
        }
        const inner = value.slice(1, -1).trim();
        const items = inner.length === 0 ? [] : inner.split(',').map((s) => s.trim()).filter(Boolean);
        for (const ac of items) {
          if (!/^AC-\d+$/.test(ac)) {
            out.warnings.push(`acs item must match /^AC-\\d+$/ (got ${ac})`);
          }
        }
        out.acs = items;
        break;
      }
      case 'role':
        if (value !== 'primary' && value !== 'secondary') {
          out.warnings.push(`role must be 'primary' or 'secondary' (got ${value})`);
        }
        out.role = value;
        break;
      default:
        out.warnings.push(`unknown key: ${key}`);
        break;
    }
  }

  return out;
}

/**
 * Expand a parsed anchor into the CapTag[] shape used elsewhere in CAP.
 * Emits:
 *   - one @cap-feature tag (primary:true flag when role === 'primary')
 *   - one @cap-todo tag per AC listed in `anchor.acs`, with `ac: F-XXX/AC-N`
 *
 * When anchor.feature is empty (parse error), returns [] — the caller can still
 * inspect anchor.warnings for diagnostics.
 *
 * @param {ParsedAnchor} anchor
 * @param {string} filePath - Relative file path (for tag.file)
 * @param {number} lineNumber - 1-based line number of the anchor in the source
 * @returns {CapTag[]}
 */
function expandAnchorToTags(anchor, filePath, lineNumber) {
  if (!anchor || !anchor.feature) return [];
  /** @type {CapTag[]} */
  const tags = [];
  const metadata = { feature: anchor.feature };
  if (anchor.role === 'primary') metadata.primary = true;
  tags.push({
    type: 'feature',
    file: filePath,
    line: lineNumber,
    metadata,
    description: `unified anchor for ${anchor.feature}`,
    raw: anchor.raw,
  });
  for (const ac of anchor.acs || []) {
    tags.push({
      type: 'todo',
      file: filePath,
      line: lineNumber,
      metadata: { ac: `${anchor.feature}/${ac}` },
      description: `AC reference expanded from unified anchor`,
      raw: anchor.raw,
    });
  }
  return tags;
}

/**
 * Serialize a structured anchor into the canonical block string, using the
 * requested comment style. Used by the migration tool to write the unified
 * block back to source.
 *
 * @param {{feature:string, acs?:string[], role?:string}} anchor
 * @param {('block'|'line'|'html')} [style='block'] - comment family
 * @returns {string} Single-line block, no trailing newline
 */
function emitAnchorBlock(anchor, style = 'block') {
  const parts = [];
  parts.push(`feature:${anchor.feature}`);
  if (Array.isArray(anchor.acs) && anchor.acs.length > 0) {
    parts.push(`acs:[${anchor.acs.join(',')}]`);
  }
  if (anchor.role === 'primary' || anchor.role === 'secondary') {
    parts.push(`role:${anchor.role}`);
  }
  const body = `@cap ${parts.join(' ')}`;
  if (style === 'line') return `# ${body}`;
  if (style === 'html') return `<!-- ${body} -->`;
  // default: block comment
  return `/* ${body} */`;
}

/**
 * Convenience: scan a full file content for unified anchor blocks and expand each.
 * Internal use by cap-tag-scanner when unifiedAnchors.enabled is true.
 *
 * @param {string} content - Full file content
 * @param {string} filePath - Relative path for tag.file
 * @returns {CapTag[]} All tags expanded from every anchor in the file
 */
function scanAnchorsInContent(content, filePath) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const tags = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('@cap ')) continue; // fast-path filter; space distinguishes from `@cap-feature`
    const parsed = parseAnchorLine(line);
    if (!parsed || !parsed.feature) continue;
    tags.push(...expandAnchorToTags(parsed, filePath, i + 1));
  }
  return tags;
}

module.exports = {
  parseAnchorLine,
  expandAnchorToTags,
  emitAnchorBlock,
  scanAnchorsInContent,
  // constants (exported for tests)
  ANCHOR_RE,
  KV_TOKEN_RE,
};
