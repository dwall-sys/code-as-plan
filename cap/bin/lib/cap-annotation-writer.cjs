// @cap-feature(feature:F-028) Code Annotation Writer — write @cap-history, @cap-pitfall, @cap-pattern annotations into source files
// @cap-decision Annotations placed at file-top block, after shebang/'use strict', alongside existing @cap-feature tags.
// @cap-decision Comment syntax detected per file extension — language-agnostic, same approach as tag scanner.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

// @cap-history(sessions:2, edits:7, since:2026-04-03, learned:2026-04-03) Frequently modified — 2 sessions, 7 edits
const fs = require('node:fs');
const path = require('node:path');

// --- Comment Syntax Detection (AC-2) ---

/** @type {Object<string, string>} Extension to single-line comment prefix mapping */
const COMMENT_PREFIX_MAP = {
  // // style
  '.js': '//', '.cjs': '//', '.mjs': '//', '.ts': '//', '.tsx': '//', '.jsx': '//',
  '.go': '//', '.rs': '//', '.c': '//', '.cpp': '//', '.h': '//', '.java': '//',
  '.swift': '//', '.kt': '//', '.scala': '//', '.cs': '//', '.dart': '//', '.zig': '//',
  // # style
  '.py': '#', '.rb': '#', '.sh': '#', '.bash': '#', '.zsh': '#', '.fish': '#',
  '.yml': '#', '.yaml': '#', '.toml': '#', '.pl': '#', '.pm': '#', '.r': '#',
  '.tf': '#', '.hcl': '#', '.dockerfile': '#', '.conf': '#', '.ini': '#',
  // -- style
  '.sql': '--', '.lua': '--', '.hs': '--', '.elm': '--',
  // ; style
  '.lisp': ';', '.clj': ';', '.el': ';', '.scm': ';',
  // % style
  '.erl': '%', '.tex': '%', '.m': '%',
};

// @cap-todo(ref:F-028:AC-2) Detect correct comment syntax for target file based on extension

/** File extensions that must never receive annotations (no valid comment syntax or structured format). */
const ANNOTATION_BLOCKLIST = new Set([
  '.md', '.markdown', '.json', '.jsonl', '.lock', '.svg', '.xml', '.html', '.htm',
  '.css', '.scss', '.less', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.map', '.min.js', '.min.css', '.patch', '.diff',
]);

/**
 * Check if a file can receive annotations.
 * @param {string} filePath
 * @returns {boolean}
 */
function canAnnotate(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (ANNOTATION_BLOCKLIST.has(ext)) return false;
  if (basename === 'package-lock.json' || basename === 'yarn.lock' || basename === 'pnpm-lock.yaml') return false;
  if (basename.endsWith('.md')) return false;
  return true;
}

/**
 * Get the single-line comment prefix for a file.
 * @param {string} filePath
 * @returns {string} Comment prefix (defaults to '//')
 */
function getCommentPrefix(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  // Dockerfile has no extension but starts with FROM
  if (path.basename(filePath).toLowerCase() === 'dockerfile') return '#';
  return COMMENT_PREFIX_MAP[ext] || '//';
}

// --- Annotation Parsing ---

/** Regex to match existing memory annotations in a line */
const MEMORY_TAG_RE = /^(\s*(?:\/\/|#|--|;|%)\s*)@(cap-history|cap-pitfall|cap-pattern|cap-decision)\b/;

/**
 * @typedef {Object} ParsedAnnotation
 * @property {number} lineIndex - 0-based line index in file
 * @property {string} tag - Tag name (e.g., 'cap-history')
 * @property {string} fullLine - Complete line text
 * @property {string} prefix - Comment prefix with whitespace
 */

/**
 * Parse existing memory annotations from file lines.
 * @param {string[]} lines
 * @returns {ParsedAnnotation[]}
 */
function parseExistingAnnotations(lines) {
  const annotations = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(MEMORY_TAG_RE);
    if (match) {
      annotations.push({
        lineIndex: i,
        tag: match[2],
        fullLine: lines[i],
        prefix: match[1],
      });
    }
  }
  return annotations;
}

// --- Insertion Point Detection ---

// @cap-todo(ref:F-028:AC-1) Insert annotations at file-top block alongside existing @cap-feature tags

/**
 * Find the line index where memory annotations should be inserted.
 * After shebang, 'use strict', and existing @cap-* annotation block.
 * @param {string[]} lines
 * @returns {number} Line index for insertion
 */
function findInsertionPoint(lines) {
  let insertAt = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip shebang
    if (i === 0 && line.startsWith('#!')) {
      insertAt = i + 1;
      continue;
    }

    // Skip 'use strict'
    if (line === "'use strict';" || line === '"use strict";') {
      insertAt = i + 1;
      continue;
    }

    // Skip empty lines at top
    if (line === '' && i <= insertAt) {
      insertAt = i + 1;
      continue;
    }

    // Skip existing @cap-* annotation lines
    if (/^\s*(?:\/\/|#|--|;|%)\s*@cap-/.test(line)) {
      insertAt = i + 1;
      continue;
    }

    // Stop at first non-annotation, non-header line
    break;
  }

  return insertAt;
}

// --- Write Operations ---

// @cap-todo(ref:F-028:AC-3) Update existing annotations in-place without creating duplicates
// @cap-todo(ref:F-028:AC-4) Remove annotations marked as stale
// @cap-todo(ref:F-028:AC-7) Support dry-run mode

/**
 * @typedef {Object} AnnotationChange
 * @property {'add'|'update'|'remove'} action
 * @property {string} file
 * @property {string} annotation - Formatted annotation text
 * @property {number} [lineIndex] - For update/remove: existing line
 */

/**
 * Plan annotation changes for a single file.
 * @param {string} filePath
 * @param {string} fileContent - Current file content
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries - New entries for this file
 * @param {string[]} [staleContentPrefixes] - Content prefixes of stale entries to remove
 * @returns {AnnotationChange[]}
 */
function planFileChanges(filePath, fileContent, entries, staleContentPrefixes = []) {
  const commentPrefix = getCommentPrefix(filePath);
  const lines = fileContent.split('\n');
  const existing = parseExistingAnnotations(lines);
  const changes = [];

  const { formatAnnotation } = require('./cap-memory-engine.cjs');

  // Plan removals for stale entries (AC-4)
  for (const ann of existing) {
    const lineContent = ann.fullLine.replace(ann.prefix, '').trim();
    if (staleContentPrefixes.some(prefix => lineContent.startsWith(prefix))) {
      changes.push({ action: 'remove', file: filePath, annotation: ann.fullLine, lineIndex: ann.lineIndex });
    }
  }

  // Plan adds/updates for new entries
  for (const entry of entries) {
    const formatted = formatAnnotation(entry);
    // Check if a similar annotation already exists (match by tag + first 60 chars of content)
    const tagName = formatted.split('(')[0].split(' ')[0]; // e.g., @cap-history
    const contentKey = entry.content.substring(0, 60).toLowerCase();

    const existingMatch = existing.find(ann => {
      const annContent = ann.fullLine.replace(ann.prefix, '').trim();
      return annContent.startsWith(tagName) && annContent.toLowerCase().includes(contentKey);
    });

    if (existingMatch) {
      // Update in-place (AC-3)
      const newLine = `${commentPrefix} ${formatted}`;
      if (existingMatch.fullLine.trim() !== newLine.trim()) {
        changes.push({ action: 'update', file: filePath, annotation: newLine, lineIndex: existingMatch.lineIndex });
      }
    } else {
      // Add new
      changes.push({ action: 'add', file: filePath, annotation: `${commentPrefix} ${formatted}` });
    }
  }

  return changes;
}

/**
 * Apply planned changes to a file's content.
 * @param {string} fileContent
 * @param {AnnotationChange[]} changes
 * @returns {string} Updated file content
 */
function applyChanges(fileContent, changes) {
  const lines = fileContent.split('\n');

  // Apply removals and updates (by line index, process from bottom to preserve indices)
  const lineChanges = changes
    .filter(c => c.action === 'remove' || c.action === 'update')
    .sort((a, b) => b.lineIndex - a.lineIndex);

  for (const change of lineChanges) {
    if (change.action === 'remove') {
      lines.splice(change.lineIndex, 1);
    } else if (change.action === 'update') {
      lines[change.lineIndex] = change.annotation;
    }
  }

  // Apply additions at insertion point
  const additions = changes.filter(c => c.action === 'add');
  if (additions.length > 0) {
    const insertAt = findInsertionPoint(lines);
    const newLines = additions.map(a => a.annotation);
    lines.splice(insertAt, 0, ...newLines);
  }

  return lines.join('\n');
}

// @cap-todo(ref:F-028:AC-5) Format annotations with parenthesized metadata matching existing tag conventions
// @cap-todo(ref:F-028:AC-6) Be parseable by existing tag scanner without modifications

/**
 * Write memory annotations to files.
 * @param {Object<string, import('./cap-memory-engine.cjs').MemoryEntry[]>} fileEntries - Map of filePath -> entries
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, return changes without writing
 * @param {Object<string, string[]>} [options.staleByFile] - Map of filePath -> stale content prefixes to remove
 * @returns {{changes: AnnotationChange[], filesModified: number}}
 */
function writeAnnotations(fileEntries, options = {}) {
  const allChanges = [];
  let filesModified = 0;

  for (const [filePath, entries] of Object.entries(fileEntries)) {
    if (!fs.existsSync(filePath)) continue;
    if (!canAnnotate(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const stale = options.staleByFile?.[filePath] || [];
    const changes = planFileChanges(filePath, content, entries, stale);

    if (changes.length === 0) continue;

    allChanges.push(...changes);

    if (!options.dryRun) {
      const updated = applyChanges(content, changes);
      fs.writeFileSync(filePath, updated, 'utf8');
    }
    filesModified++;
  }

  return { changes: allChanges, filesModified };
}

/**
 * Remove stale annotations from files.
 * @param {Array<{file: string, content: string}>} staleEntries
 * @param {Object} [options]
 * @param {boolean} [options.dryRun]
 * @returns {{removed: number, filesModified: number}}
 */
function removeStaleAnnotations(staleEntries, options = {}) {
  const byFile = {};
  for (const entry of staleEntries) {
    if (!byFile[entry.file]) byFile[entry.file] = [];
    byFile[entry.file].push(entry.content.substring(0, 60));
  }

  let removed = 0;
  let filesModified = 0;

  for (const [filePath, prefixes] of Object.entries(byFile)) {
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const changes = planFileChanges(filePath, content, [], prefixes);
    const removals = changes.filter(c => c.action === 'remove');

    if (removals.length === 0) continue;

    if (!options.dryRun) {
      const updated = applyChanges(content, removals);
      fs.writeFileSync(filePath, updated, 'utf8');
    }
    removed += removals.length;
    filesModified++;
  }

  return { removed, filesModified };
}

module.exports = {
  canAnnotate,
  getCommentPrefix,
  parseExistingAnnotations,
  findInsertionPoint,
  planFileChanges,
  applyChanges,
  writeAnnotations,
  removeStaleAnnotations,
  COMMENT_PREFIX_MAP,
  ANNOTATION_BLOCKLIST,
  MEMORY_TAG_RE,
};
