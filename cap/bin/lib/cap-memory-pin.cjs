'use strict';

// @cap-feature(feature:F-030, primary:true) Pin/unpin management for @cap-pitfall annotations.
// Provides the write side of /cap:memory pin / /cap:memory unpin so users can flag a pitfall
// as "pinned" (exempt from F-027 aging) or clear that flag.
//
// @cap-decision Pure string manipulation — finds the matching @cap-pitfall line by content
// prefix and rewrites its metadata block in place. No whole-file parsing, no AST, no
// re-annotation pass. This keeps the blast radius of a pin operation to a single line edit
// and preserves all surrounding context and comments.
// @cap-decision Match policy: the first @cap-pitfall line whose description STARTS with the
// user-supplied prefix (trimmed, case-sensitive) wins. Ambiguous prefixes return a
// multi-match result so the caller can disambiguate rather than guess.

const fs = require('node:fs');

// Matches a line carrying a @cap-pitfall annotation. Captures:
//   [1] leading comment prefix + whitespace (e.g. '// ', '# ')
//   [2] metadata block INCLUDING the surrounding parentheses, or '' if none
//   [3] inner metadata content (without parens), or '' if no parens
//   [4] description (trailing text after the annotation)
const PITFALL_LINE_RE = /^(\s*(?:\/\/|#|--|;|%)\s*)@cap-pitfall(\(([^)]*)\))?\s*(.*)$/;

/**
 * @typedef {Object} PinResult
 * @property {boolean} changed       - True when the file was rewritten
 * @property {('pinned'|'unpinned'|'already-pinned'|'not-pinned'|'not-found'|'ambiguous'|'read-error')} status
 * @property {string|null} file      - Absolute file path that was acted on (null on read-error)
 * @property {number|null} line      - 1-based line number of the modified annotation (null when not-found/ambiguous)
 * @property {string|null} description - The full description line of the matched pitfall (for display)
 * @property {string[]} candidates   - When ambiguous: list of candidate descriptions to help the user pick
 */

/**
 * Toggle the `pinned:true` flag on the first @cap-pitfall annotation whose description
 * starts with `contentPrefix` (trimmed, case-sensitive).
 *
 * @param {string} filePath - Absolute path to the source file
 * @param {string} contentPrefix - User-supplied prefix of the pitfall description to match
 * @param {{ pin: boolean, dryRun?: boolean }} opts
 * @returns {PinResult}
 */
function pinAnnotation(filePath, contentPrefix, opts) {
  const shouldPin = !!(opts && opts.pin);
  const dryRun = !!(opts && opts.dryRun);

  /** @type {PinResult} */
  const result = {
    changed: false,
    status: 'not-found',
    file: filePath,
    line: null,
    description: null,
    candidates: [],
  };

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    result.status = 'read-error';
    result.file = null;
    return result;
  }

  const lines = content.split('\n');
  const prefix = String(contentPrefix || '').trim();

  // Find all pitfall candidates whose description starts with prefix.
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PITFALL_LINE_RE);
    if (!m) continue;
    const description = (m[4] || '').trim();
    if (description.startsWith(prefix)) {
      matches.push({ lineIndex: i, match: m, description });
    }
  }

  if (matches.length === 0) return result;

  if (matches.length > 1) {
    result.status = 'ambiguous';
    result.candidates = matches.map((m) => m.description);
    return result;
  }

  const { lineIndex, match, description } = matches[0];
  const leading = match[1];
  const metaInner = (match[3] || '').trim();

  // Parse the existing metadata tokens. Tokens are comma-separated key:value pairs.
  const tokens = metaInner.length === 0
    ? []
    : metaInner.split(',').map((s) => s.trim()).filter(Boolean);
  const hasPinned = tokens.some((t) => /^pinned\s*:\s*true$/.test(t));

  if (shouldPin && hasPinned) {
    result.status = 'already-pinned';
    result.line = lineIndex + 1;
    result.description = description;
    return result;
  }
  if (!shouldPin && !hasPinned) {
    result.status = 'not-pinned';
    result.line = lineIndex + 1;
    result.description = description;
    return result;
  }

  const newTokens = shouldPin
    ? [...tokens, 'pinned:true']
    : tokens.filter((t) => !/^pinned\s*:\s*true$/.test(t));

  const newMeta = newTokens.length === 0 ? '' : `(${newTokens.join(', ')})`;
  const trailing = description.length === 0 ? '' : ` ${description}`;
  const rewritten = `${leading}@cap-pitfall${newMeta}${trailing}`;

  lines[lineIndex] = rewritten;
  if (!dryRun) fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  result.changed = true;
  result.status = shouldPin ? 'pinned' : 'unpinned';
  result.line = lineIndex + 1;
  result.description = description;
  return result;
}

/**
 * Convenience wrapper for pinning.
 * @param {string} filePath
 * @param {string} contentPrefix
 * @param {{dryRun?: boolean}} [opts]
 * @returns {PinResult}
 */
function pin(filePath, contentPrefix, opts) {
  return pinAnnotation(filePath, contentPrefix, { ...(opts || {}), pin: true });
}

/**
 * Convenience wrapper for unpinning.
 * @param {string} filePath
 * @param {string} contentPrefix
 * @param {{dryRun?: boolean}} [opts]
 * @returns {PinResult}
 */
function unpin(filePath, contentPrefix, opts) {
  return pinAnnotation(filePath, contentPrefix, { ...(opts || {}), pin: false });
}

/**
 * Format a PinResult as a single-line status string for the CLI surface.
 * @param {PinResult} result
 * @returns {string}
 */
function formatResult(result) {
  switch (result.status) {
    case 'pinned':
      return `pinned ${result.file}:${result.line} — "${result.description}"`;
    case 'unpinned':
      return `unpinned ${result.file}:${result.line} — "${result.description}"`;
    case 'already-pinned':
      return `no change: already pinned at ${result.file}:${result.line}`;
    case 'not-pinned':
      return `no change: annotation was not pinned at ${result.file}:${result.line}`;
    case 'not-found':
      return `no @cap-pitfall annotation matching prefix found in ${result.file}`;
    case 'ambiguous':
      return `ambiguous prefix — multiple pitfall annotations matched:\n  ${result.candidates.join('\n  ')}`;
    case 'read-error':
      return `could not read file`;
    default:
      return `unknown status: ${result.status}`;
  }
}

module.exports = {
  pinAnnotation,
  pin,
  unpin,
  formatResult,
  PITFALL_LINE_RE,
};
