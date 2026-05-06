// @cap-context CAP V6 Memory-Format-Pivot — per-feature memory files at .cap/memory/features/F-NNN-<topic>.md.
// Replaces the V5 monolithic decisions.md (which scaled poorly: 296 KB / 1219 entries / 28% noise on real audits).
// V6 augments Claude-native auto-memory rather than duplicating it; FEATURE-MAP.md remains the single source of
// truth for lifecycle (state, ACs, title), while these per-feature memory files capture the *narrative* —
// decisions and pitfalls extracted from tags (auto-block) plus human lessons / snapshot links (manual-block).

'use strict';

// @cap-feature(feature:F-076, primary:true) V6 Per-Feature Memory Format — schema, validator, round-trip-safe parser/serializer

const fs = require('node:fs');
const path = require('node:path');

// -------- Constants --------

// @cap-decision(F-076/D1) Marker comments are HTML-style (`<!-- ... -->`) so they render as invisible whitespace in
// any Markdown viewer (GitHub, VS Code preview, Obsidian) — humans see clean section content, machines see anchors.
// Alternatives considered: ATX headings (`## __auto_start__`) leak into TOCs; horizontal rules (`---`) collide with
// front-matter delimiters; YAML stanzas inline are not Markdown-friendly.
const AUTO_BLOCK_START_MARKER = '<!-- cap:auto:start -->';
const AUTO_BLOCK_END_MARKER = '<!-- cap:auto:end -->';

// @cap-decision(F-076/D2) Memory features live under a fixed relative path so all consumers (F-077 migration,
// F-078 platform bucket, F-079 snapshot linkage, F-080 Claude-native bridge) share the same directory contract
// without each re-deriving it. Exported as a constant rather than computed per call.
const MEMORY_FEATURES_DIR = '.cap/memory/features';

// @cap-decision(F-076/D3) Feature ID regex enforces F-NNN with at least 3 digits (matches FEATURE-MAP.md zero-pad
// convention and is forward-compat with F-1000+ when the project crosses 1000 features). Anchored on both sides to
// reject substring matches like "FF-076x" or "F-076-suffix".
const FEATURE_ID_RE = /^F-\d{3,}$/;

// @cap-decision(F-076/D4) Topic slug enforces kebab-case alphanumerics-and-dashes only — same shape as filenames in
// `cap/bin/lib/cap-*.cjs`. Excludes leading/trailing dashes and consecutive dashes to keep filenames clean.
const TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// @cap-decision(F-076/D5) The `extends` field, when present, must follow `platform/<topic>` shape. This is the
// hook F-078 uses to mount platform-bucket links (e.g., `platform/atomic-writes`). Validated here rather than in
// F-078 so the contract is locked from the foundation outward.
const EXTENDS_RE = /^platform\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ISO 8601 instant or date-time with timezone (Z or ±HH:MM). Permissive enough for `new Date().toISOString()`
// which is what the pipeline emits, strict enough to reject "yesterday".
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// -------- Typedefs --------

/**
 * @typedef {Object} FrontMatter
 * @property {string} feature - Feature ID (e.g., "F-076"), matches /^F-\d{3,}$/
 * @property {string} topic - kebab-case topic slug (e.g., "v6-memory-format")
 * @property {string} updated - ISO 8601 timestamp
 * @property {string[]=} related_features - array of F-NNN ids
 * @property {string[]=} key_files - array of repo-relative paths
 * @property {string=} extends - "platform/<topic>" reference (F-078 forward-compat)
 */

/**
 * @typedef {Object} AutoBlock
 * @property {Array<{text: string, location: string}>} decisions - decision entries (text + `file:line` location)
 * @property {Array<{text: string, location: string}>} pitfalls - pitfall entries
 */

/**
 * @typedef {Object} ManualBlock
 * @property {string} raw - the entire manual content as a literal string slice (preserved byte-identical for round-trip)
 */

/**
 * @typedef {Object} FeatureMemoryFile
 * @property {FrontMatter} frontmatter
 * @property {AutoBlock} autoBlock
 * @property {ManualBlock} manualBlock
 * @property {string=} title - the H1 heading text (e.g., "F-076: Define V6 Memory Format Schema"); preserved as part of manualBlock for round-trip but exposed separately for convenience
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {string[]} warnings
 */

// -------- Front-matter parsing (minimal, scoped to this schema only) --------

// @cap-risk Using a custom YAML mini-parser instead of `frontmatter.cjs` keeps this module zero-coupled to legacy
// GSD code. The trade-off: we only support the small subset this schema needs (scalars + inline arrays). If a future
// AC requires nested objects in front-matter, switch to extractFrontmatter() from frontmatter.cjs.

/**
 * Find the front-matter block at the start of `content` and return [yamlBody, endIndex].
 * Returns [null, 0] if none present. The endIndex is the offset *after* the closing `---` line including its
 * trailing newline (or end-of-file if the file ends without one).
 * @param {string} content
 * @returns {[string|null, number]}
 */
function locateFrontMatter(content) {
  // Allow optional UTF-8 BOM, then `---` on its own line, then body, then `---` on its own line.
  const startMatch = content.match(/^\uFEFF?---\r?\n/);
  if (!startMatch) return [null, 0];
  const bodyStart = startMatch[0].length;
  // Find the closing `---` on its own line. Use a regex anchored to a newline boundary so we don't match `---`
  // inside the body (e.g., a horizontal rule).
  const closeRe = /\r?\n---(?:\r?\n|$)/g;
  closeRe.lastIndex = bodyStart;
  const closeMatch = closeRe.exec(content);
  if (!closeMatch) return [null, 0];
  const yaml = content.slice(bodyStart, closeMatch.index);
  const endIndex = closeMatch.index + closeMatch[0].length;
  return [yaml, endIndex];
}

/**
 * Parse the limited YAML subset we accept in V6 memory front-matter.
 * Supported forms:
 *   key: value
 *   key: [a, b, c]
 *   key: ["a", "b"]
 * Lines starting with `#` are comments.
 * @param {string} yaml
 * @returns {Object<string, string|string[]>}
 */
function parseSimpleYaml(yaml) {
  /** @type {Object<string, any>} */
  const out = {};
  const lines = yaml.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue; // unknown shape — silently skip; validator will catch missing required keys
    const key = m[1];
    const rawValue = m[2];
    if (rawValue === '') {
      out[key] = '';
      continue;
    }
    // Inline array
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (inner === '') {
        out[key] = [];
      } else {
        out[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s) => s.length > 0);
      }
      continue;
    }
    // Scalar (strip surrounding quotes if any)
    out[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Serialize the front-matter object back to YAML body (without the `---` fences).
 * Mirrors parseSimpleYaml's accepted shapes and produces stable, ordered output.
 * @param {FrontMatter} fm
 * @returns {string}
 */
function serializeFrontMatter(fm) {
  const lines = [];
  // Stable key order matches the schema doc — required first, optional after.
  const ordered = ['feature', 'topic', 'updated', 'related_features', 'key_files', 'extends'];
  for (const key of ordered) {
    if (!Object.prototype.hasOwnProperty.call(fm, key)) continue;
    const val = fm[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.join(', ')}]`);
    } else {
      lines.push(`${key}: ${String(val)}`);
    }
  }
  // Preserve any unknown keys verbatim at the tail (round-trip-safe).
  for (const key of Object.keys(fm)) {
    if (ordered.includes(key)) continue;
    const val = fm[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}: [${val.join(', ')}]`);
    } else {
      lines.push(`${key}: ${String(val)}`);
    }
  }
  return lines.join('\n');
}

// -------- Auto-block parsing / serialization --------

// @cap-todo(ac:F-076/AC-2) parseAutoBlock recognizes the marker pair and extracts decisions/pitfalls between them.
/**
 * Locate the auto-block in `content` and return its bounds + parsed entries.
 * @param {string} content
 * @returns {{ startIdx: number, endIdx: number, body: string } | null}
 */
function locateAutoBlock(content) {
  const startIdx = content.indexOf(AUTO_BLOCK_START_MARKER);
  if (startIdx === -1) return null;
  const endIdx = content.indexOf(AUTO_BLOCK_END_MARKER, startIdx + AUTO_BLOCK_START_MARKER.length);
  if (endIdx === -1) return null;
  // The body lives between the two markers (exclusive of the markers themselves).
  const body = content.slice(startIdx + AUTO_BLOCK_START_MARKER.length, endIdx);
  return { startIdx, endIdx: endIdx + AUTO_BLOCK_END_MARKER.length, body };
}

/**
 * Parse the body of the auto-block (between markers) into a structured AutoBlock.
 * Recognized sections:
 *   ## Decisions (from tags)
 *   - <text> — `<file>:<line>`
 *   ## Pitfalls (from tags)
 *   - <text> — `<file>:<line>`
 * Sections may be omitted entirely when empty (AC-3).
 * @param {string} body
 * @returns {AutoBlock}
 */
function parseAutoBlockBody(body) {
  /** @type {AutoBlock} */
  const out = { decisions: [], pitfalls: [] };
  const sectionRe = /^##\s+(Decisions|Pitfalls)\s*\(from tags\)\s*$/i;
  const lines = body.split(/\r?\n/);
  /** @type {'decisions'|'pitfalls'|null} */
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');
    const headerMatch = line.match(sectionRe);
    if (headerMatch) {
      current = headerMatch[1].toLowerCase() === 'decisions' ? 'decisions' : 'pitfalls';
      continue;
    }
    if (!current) continue;
    if (line.startsWith('- ')) {
      const item = line.slice(2);
      // Split on em-dash + backtick boundary: "<text> — `<file>:<line>`"
      const m = item.match(/^(.*?)\s+—\s+`([^`]+)`\s*$/);
      if (m) {
        out[current].push({ text: m[1].trim(), location: m[2].trim() });
      } else {
        // Fallback: text-only entry without location
        out[current].push({ text: item.trim(), location: '' });
      }
    }
  }
  return out;
}

// @cap-todo(ac:F-076/AC-3) renderAutoBlockBody omits empty optional sections — no `(none)` or `TODO` placeholders.
/**
 * Render an AutoBlock to its body string (between markers, exclusive of markers).
 * @param {AutoBlock} block
 * @param {{ eol?: string }=} opts
 * @returns {string}
 */
function renderAutoBlockBody(block, opts) {
  const eol = (opts && opts.eol) || '\n';
  const parts = [];
  const renderSection = (label, items) => {
    if (!items || items.length === 0) return; // AC-3: omit empty sections
    parts.push(`## ${label} (from tags)`);
    for (const item of items) {
      const loc = item.location ? ` — \`${item.location}\`` : '';
      parts.push(`- ${item.text}${loc}`);
    }
  };
  renderSection('Decisions', block.decisions);
  if (parts.length > 0 && block.pitfalls && block.pitfalls.length > 0) {
    parts.push(''); // blank line between sections
  }
  renderSection('Pitfalls', block.pitfalls);
  if (parts.length === 0) {
    // Both sections empty: produce a single blank line so the markers don't sit on the same row.
    return `${eol}${eol}`;
  }
  // Surround with leading/trailing newlines so markers are on their own lines.
  return `${eol}${parts.join(eol)}${eol}`;
}

// -------- Top-level parser --------

// @cap-todo(ac:F-076/AC-7) parseFeatureMemoryFile preserves the manual block as a literal string slice so a
// subsequent serializeFeatureMemoryFile() round-trips byte-identical when only the auto-block was mutated.
/**
 * Parse a feature memory file's content into structured form.
 * Pure function — does NO file IO.
 * @param {string} content
 * @returns {FeatureMemoryFile}
 */
function parseFeatureMemoryFile(content) {
  if (typeof content !== 'string') {
    throw new TypeError('parseFeatureMemoryFile: content must be a string');
  }
  // 1. Strip optional BOM, but remember it so serialization can restore it.
  let bom = '';
  let body = content;
  if (body.charCodeAt(0) === 0xfeff) {
    bom = '\uFEFF';
    body = body.slice(1);
  }
  // 2. Locate front-matter.
  const [yamlBody, fmEndIndex] = locateFrontMatter(bom + body);
  let frontmatter = /** @type {FrontMatter} */ ({});
  let afterFm;
  let fmLiteral;
  if (yamlBody !== null) {
    frontmatter = /** @type {FrontMatter} */ (parseSimpleYaml(yamlBody));
    fmLiteral = (bom + body).slice(0, fmEndIndex);
    afterFm = (bom + body).slice(fmEndIndex);
  } else {
    fmLiteral = bom; // no front-matter at all
    afterFm = body;
  }
  // 3. Locate auto-block within the post-front-matter region.
  const autoLoc = locateAutoBlock(afterFm);
  /** @type {AutoBlock} */
  let autoBlock = { decisions: [], pitfalls: [] };
  /** @type {string} */
  let preAuto = afterFm;
  /** @type {string} */
  let postAuto = '';
  /** @type {string|null} */
  let autoLiteral = null;
  if (autoLoc) {
    autoBlock = parseAutoBlockBody(autoLoc.body);
    preAuto = afterFm.slice(0, autoLoc.startIdx);
    autoLiteral = afterFm.slice(autoLoc.startIdx, autoLoc.endIdx);
    postAuto = afterFm.slice(autoLoc.endIdx);
  }
  // 4. Manual block = everything except the auto-block (preAuto + postAuto). Captured as a literal slice for AC-7.
  /** @type {ManualBlock} */
  const manualBlock = { raw: preAuto + postAuto };

  // 5. Extract title (H1) for convenience, scanning the pre-auto manual region.
  let title;
  const h1Match = preAuto.match(/^#\s+(.+?)\s*$/m);
  if (h1Match) title = h1Match[1];

  // Internal: stash the literal slices on the result so serialize can round-trip exactly.
  const out = /** @type {FeatureMemoryFile} */ ({
    frontmatter,
    autoBlock,
    manualBlock,
    title,
  });
  // Hidden round-trip metadata (non-enumerable so it doesn't pollute deepEqual checks unexpectedly,
  // but reachable for serialize()).
  Object.defineProperty(out, '__roundTrip', {
    value: { fmLiteral, preAuto, autoLiteral, postAuto, hadAutoBlock: !!autoLoc, hadFrontMatter: yamlBody !== null, bom },
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return out;
}

// -------- Top-level serializer --------

// @cap-todo(ac:F-076/AC-7) serializeFeatureMemoryFile is the inverse of parse: round-trip-safe when round-trip
// metadata is present; otherwise it produces a canonical rendering.
/**
 * Serialize a parsed FeatureMemoryFile back to text.
 *
 * If `file` was produced by parseFeatureMemoryFile() and only the autoBlock has changed, the manual block
 * is restored byte-identical (round-trip invariant, AC-7). Modifying frontmatter or manualBlock.raw will
 * produce a fresh canonical rendering for those parts but still preserve the unchanged sections verbatim.
 *
 * @param {FeatureMemoryFile & { __roundTrip?: any }} file
 * @returns {string}
 */
function serializeFeatureMemoryFile(file) {
  if (!file || typeof file !== 'object') {
    throw new TypeError('serializeFeatureMemoryFile: file must be an object');
  }
  const rt = file.__roundTrip || null;
  // Detect line-ending convention from round-trip metadata, default to \n.
  const eol = rt && rt.fmLiteral && rt.fmLiteral.includes('\r\n') ? '\r\n' : (rt && rt.preAuto && rt.preAuto.includes('\r\n') ? '\r\n' : '\n');

  // 1. Front-matter.
  let fmText;
  if (rt && rt.hadFrontMatter && _frontMatterUnchanged(file.frontmatter, rt.fmLiteral)) {
    fmText = rt.fmLiteral; // preserve original byte-for-byte (including BOM if any)
  } else if (Object.keys(file.frontmatter || {}).length > 0) {
    const yaml = serializeFrontMatter(file.frontmatter);
    const bom = rt && rt.bom ? rt.bom : '';
    fmText = `${bom}---${eol}${yaml}${eol}---${eol}`;
  } else {
    fmText = rt && rt.bom ? rt.bom : '';
  }

  // 2. Manual + auto. If round-trip metadata exists, splice exactly.
  if (rt) {
    const autoText = _autoBlockUnchangedLiteral(file, rt) ?? renderAutoBlock(file.autoBlock, eol);
    const preAuto = (file.manualBlock && _manualUnchanged(file, rt))
      ? rt.preAuto
      : _splitManualPre(file.manualBlock.raw, rt);
    const postAuto = (file.manualBlock && _manualUnchanged(file, rt))
      ? rt.postAuto
      : _splitManualPost(file.manualBlock.raw, rt);
    if (rt.hadAutoBlock || file.autoBlock) {
      return fmText + preAuto + autoText + postAuto;
    }
    return fmText + (file.manualBlock ? file.manualBlock.raw : '');
  }
  // 3. No round-trip metadata: canonical render.
  const manual = file.manualBlock ? file.manualBlock.raw : '';
  const autoText = renderAutoBlock(file.autoBlock || { decisions: [], pitfalls: [] }, eol);
  // Insert auto block after H1 if present, else at the start of the manual region.
  const h1Idx = manual.search(/^#\s+/m);
  if (h1Idx !== -1) {
    const afterH1 = manual.indexOf('\n', h1Idx);
    const insertAt = afterH1 === -1 ? manual.length : afterH1 + 1;
    return fmText + manual.slice(0, insertAt) + eol + autoText + manual.slice(insertAt);
  }
  return fmText + autoText + manual;
}

/**
 * @param {AutoBlock} block
 * @param {string} eol
 * @returns {string}
 */
function renderAutoBlock(block, eol) {
  const body = renderAutoBlockBody(block, { eol });
  return `${AUTO_BLOCK_START_MARKER}${body}${AUTO_BLOCK_END_MARKER}`;
}

/**
 * Heuristic: is the parsed front-matter object structurally equal to what would be parsed from the
 * literal slice? If yes, we can preserve the literal byte-for-byte.
 * @param {FrontMatter} fm
 * @param {string} literal
 */
function _frontMatterUnchanged(fm, literal) {
  if (!literal) return false;
  const [yaml] = locateFrontMatter(literal);
  if (yaml === null) return false;
  const reparsed = parseSimpleYaml(yaml);
  return _shallowEqual(fm, reparsed);
}

/** @param {AutoBlock} a @param {AutoBlock} b */
function _autoBlockEqual(a, b) {
  if (!a || !b) return a === b;
  if ((a.decisions || []).length !== (b.decisions || []).length) return false;
  if ((a.pitfalls || []).length !== (b.pitfalls || []).length) return false;
  for (let i = 0; i < a.decisions.length; i++) {
    if (a.decisions[i].text !== b.decisions[i].text || a.decisions[i].location !== b.decisions[i].location) return false;
  }
  for (let i = 0; i < a.pitfalls.length; i++) {
    if (a.pitfalls[i].text !== b.pitfalls[i].text || a.pitfalls[i].location !== b.pitfalls[i].location) return false;
  }
  return true;
}

/**
 * If the auto-block is unchanged from the parsed original, return the literal slice; otherwise null.
 */
function _autoBlockUnchangedLiteral(file, rt) {
  if (!rt.hadAutoBlock || !rt.autoLiteral) return null;
  const reparsedLoc = locateAutoBlock(rt.autoLiteral);
  if (!reparsedLoc) return null;
  const reparsed = parseAutoBlockBody(reparsedLoc.body);
  return _autoBlockEqual(file.autoBlock, reparsed) ? rt.autoLiteral : null;
}

function _manualUnchanged(file, rt) {
  return file.manualBlock && file.manualBlock.raw === (rt.preAuto + rt.postAuto);
}

function _splitManualPre(raw, rt) {
  // Prefer the original split point if the prefix matches.
  if (rt.preAuto && raw.startsWith(rt.preAuto)) return rt.preAuto;
  return raw; // degraded: dump everything as pre, post will be empty
}
function _splitManualPost(raw, rt) {
  if (rt.preAuto && raw.startsWith(rt.preAuto)) return raw.slice(rt.preAuto.length);
  return '';
}

function _shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
    } else if (va !== vb) {
      return false;
    }
  }
  return true;
}

// -------- Validation --------

// @cap-todo(ac:F-076/AC-5) validateFeatureMemoryFile accepts either a path or a content string and returns
// a ValidationResult shape (valid + errors[] + warnings[]).
/**
 * Validate a feature memory file. Accepts either a filesystem path (read via fs) or a content string directly.
 *
 * Heuristic: if the input contains a newline OR begins with `---` / `<!--` / `#`, treat as content; otherwise
 * treat as a filesystem path. This is unambiguous in practice (paths don't contain newlines or markdown sigils).
 *
 * @param {string} pathOrContent
 * @returns {ValidationResult}
 */
function validateFeatureMemoryFile(pathOrContent) {
  /** @type {ValidationResult} */
  const result = { valid: true, errors: [], warnings: [] };
  if (typeof pathOrContent !== 'string') {
    result.valid = false;
    result.errors.push('input must be a string (path or content)');
    return result;
  }
  let content;
  if (_looksLikeContent(pathOrContent)) {
    content = pathOrContent;
  } else {
    try {
      content = fs.readFileSync(pathOrContent, 'utf8');
    } catch (err) {
      result.valid = false;
      result.errors.push(`failed to read file: ${err && err.message ? err.message : String(err)}`);
      return result;
    }
  }
  return _validateContent(content, result);
}

/**
 * @param {string} s
 */
function _looksLikeContent(s) {
  if (s.length === 0) return true; // empty string -> treat as content (will fail validation cleanly)
  if (s.includes('\n')) return true;
  if (s.startsWith('\uFEFF---')) return true;
  if (s.startsWith('---')) return true;
  if (s.startsWith('<!--')) return true;
  if (s.startsWith('#')) return true;
  return false;
}

/**
 * @param {string} content
 * @param {ValidationResult} result
 * @returns {ValidationResult}
 */
function _validateContent(content, result) {
  // 1. Front-matter required.
  const [yamlBody] = locateFrontMatter(content);
  if (yamlBody === null) {
    result.valid = false;
    result.errors.push('missing front-matter block (must start with `---` ... `---`)');
    return result;
  }
  const fm = parseSimpleYaml(yamlBody);

  // 2. Required fields.
  if (!fm.feature || typeof fm.feature !== 'string') {
    result.valid = false;
    result.errors.push('front-matter: `feature` is required');
  } else if (!FEATURE_ID_RE.test(fm.feature)) {
    result.valid = false;
    result.errors.push(`front-matter: \`feature\` must match /^F-\\d{3,}$/ (got "${fm.feature}")`);
  }
  if (!fm.topic || typeof fm.topic !== 'string') {
    result.valid = false;
    result.errors.push('front-matter: `topic` is required');
  } else if (!TOPIC_RE.test(fm.topic)) {
    result.valid = false;
    result.errors.push(`front-matter: \`topic\` must be kebab-case (got "${fm.topic}")`);
  }
  if (!fm.updated || typeof fm.updated !== 'string') {
    result.valid = false;
    result.errors.push('front-matter: `updated` is required');
  } else if (!ISO8601_RE.test(fm.updated)) {
    result.valid = false;
    result.errors.push(`front-matter: \`updated\` must be ISO 8601 (got "${fm.updated}")`);
  } else {
    const updatedAt = new Date(fm.updated).getTime();
    if (!Number.isNaN(updatedAt)) {
      const ageDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) {
        result.warnings.push(`front-matter: \`updated\` is ${Math.round(ageDays)} days old (> 30 day staleness threshold)`);
      }
    }
  }

  // 3. Optional fields.
  if (fm.related_features !== undefined) {
    if (!Array.isArray(fm.related_features)) {
      result.valid = false;
      result.errors.push('front-matter: `related_features` must be an array');
    } else {
      for (const id of fm.related_features) {
        if (!FEATURE_ID_RE.test(id)) {
          result.valid = false;
          result.errors.push(`front-matter: \`related_features\` contains invalid id "${id}"`);
        }
      }
    }
  }
  if (fm.key_files !== undefined) {
    if (!Array.isArray(fm.key_files)) {
      result.valid = false;
      result.errors.push('front-matter: `key_files` must be an array');
    } else {
      for (const f of fm.key_files) {
        if (typeof f !== 'string' || f.length === 0) {
          result.valid = false;
          result.errors.push(`front-matter: \`key_files\` contains non-string entry`);
        }
      }
    }
  }
  if (fm.extends !== undefined && fm.extends !== '') {
    if (typeof fm.extends !== 'string' || !EXTENDS_RE.test(fm.extends)) {
      result.valid = false;
      result.errors.push(`front-matter: \`extends\` must match "platform/<topic>" (got "${fm.extends}")`);
    }
  }

  // 4. Auto-block markers.
  // @cap-risk Marker uniqueness is critical: a duplicated start marker would let a parser silently nest
  // garbage in the wrong block. We count occurrences explicitly and require exactly one of each.
  const startCount = _countOccurrences(content, AUTO_BLOCK_START_MARKER);
  const endCount = _countOccurrences(content, AUTO_BLOCK_END_MARKER);
  if (startCount === 0 && endCount === 0) {
    result.valid = false;
    result.errors.push(`auto-block markers missing (expected exactly one ${AUTO_BLOCK_START_MARKER} and one ${AUTO_BLOCK_END_MARKER})`);
  } else {
    if (startCount !== 1) {
      result.valid = false;
      result.errors.push(`auto-block: expected exactly one ${AUTO_BLOCK_START_MARKER}, found ${startCount}`);
    }
    if (endCount !== 1) {
      result.valid = false;
      result.errors.push(`auto-block: expected exactly one ${AUTO_BLOCK_END_MARKER}, found ${endCount}`);
    }
    if (startCount === 1 && endCount === 1) {
      const startIdx = content.indexOf(AUTO_BLOCK_START_MARKER);
      const endIdx = content.indexOf(AUTO_BLOCK_END_MARKER);
      if (endIdx < startIdx) {
        result.valid = false;
        result.errors.push('auto-block: end marker appears before start marker');
      }
      // Ensure markers are on their own lines (no other non-whitespace content on the marker line).
      _validateMarkerLine(content, startIdx, AUTO_BLOCK_START_MARKER, result);
      _validateMarkerLine(content, endIdx, AUTO_BLOCK_END_MARKER, result);
    }
  }

  return result;
}

/**
 * @param {string} content
 * @param {number} idx - byte index of the marker
 * @param {string} marker
 * @param {ValidationResult} result
 */
function _validateMarkerLine(content, idx, marker, result) {
  // Find the start of the line containing idx.
  let lineStart = content.lastIndexOf('\n', idx - 1) + 1;
  let lineEnd = content.indexOf('\n', idx);
  if (lineEnd === -1) lineEnd = content.length;
  const line = content.slice(lineStart, lineEnd).replace(/\r$/, '');
  const trimmed = line.replace(/^\s+|\s+$/g, '');
  if (trimmed !== marker) {
    result.valid = false;
    result.errors.push(`auto-block: marker line must contain only the marker (got "${trimmed}")`);
  }
}

/**
 * @param {string} haystack
 * @param {string} needle
 */
function _countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// -------- Path helper --------

// @cap-todo(ac:F-076/AC-1) getFeaturePath returns the canonical .cap/memory/features/F-NNN-<topic>.md path.
/**
 * @param {string} projectRoot
 * @param {string} featureId
 * @param {string} topic
 * @returns {string}
 */
function getFeaturePath(projectRoot, featureId, topic) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('getFeaturePath: projectRoot must be a non-empty string');
  }
  if (!FEATURE_ID_RE.test(featureId)) {
    throw new TypeError(`getFeaturePath: featureId must match /^F-\\d{3,}$/ (got "${featureId}")`);
  }
  if (!TOPIC_RE.test(topic)) {
    throw new TypeError(`getFeaturePath: topic must be kebab-case (got "${topic}")`);
  }
  return path.join(projectRoot, MEMORY_FEATURES_DIR, `${featureId}-${topic}.md`);
}

// -------- Exports --------

module.exports = {
  // public API
  parseFeatureMemoryFile,
  serializeFeatureMemoryFile,
  validateFeatureMemoryFile,
  getFeaturePath,
  // constants
  AUTO_BLOCK_START_MARKER,
  AUTO_BLOCK_END_MARKER,
  MEMORY_FEATURES_DIR,
  FEATURE_ID_RE,
  TOPIC_RE,
  EXTENDS_RE,
  ISO8601_RE,
};
