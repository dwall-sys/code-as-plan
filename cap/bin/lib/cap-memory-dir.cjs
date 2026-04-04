// @cap-feature(feature:F-029) Cross-File Memory Directory — write aggregated memory to .cap/memory/ markdown files
// @cap-decision .cap/memory/ is git-tracked (not gitignored) — project memory persists across clones and team members.
// @cap-decision Stable anchor IDs derived from content hash — cross-reference links survive regeneration.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

// @cap-history(sessions:2, edits:4, since:2026-04-03, learned:2026-04-03) Frequently modified — 2 sessions, 4 edits
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// --- Constants ---

const MEMORY_DIR = path.join('.cap', 'memory');

const CATEGORY_FILES = {
  decision: 'decisions.md',
  hotspot: 'hotspots.md',
  pitfall: 'pitfalls.md',
  pattern: 'patterns.md',
};

// --- Anchor Generation (AC-6) ---

// @cap-todo(ref:F-029:AC-6) Generate stable anchor IDs so cross-reference links remain valid across regenerations

/**
 * Generate a stable anchor ID from entry content.
 * Uses first 8 chars of SHA-256 hash of normalized content.
 * @param {string} content
 * @returns {string} Anchor ID (e.g., "a3f2b1c0")
 */
function generateAnchorId(content) {
  const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 8);
}

// --- Markdown Generation ---

// @cap-todo(ref:F-029:AC-1) Write to .cap/memory/ as four markdown files
// @cap-todo(ref:F-029:AC-3) Each entry includes source session date, related files, summary

/**
 * Generate markdown content for a memory category file.
 * @param {string} category
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries
 * @returns {string}
 */
function generateCategoryMarkdown(category, entries) {
  const title = category.charAt(0).toUpperCase() + category.slice(1) + 's';
  const out = [];
  out.push(`# Project Memory: ${title}`);
  out.push('');
  out.push(`> Auto-generated from code tags and session data. Pinned entries are preserved; others may be updated on regeneration.`);
  out.push(`> Last updated: ${new Date().toISOString().substring(0, 10)}`);
  out.push('');

  if (entries.length === 0) {
    out.push(`_No ${category}s recorded yet._`);
    return out.join('\n');
  }

  if (category === 'hotspot') {
    return generateHotspotsMarkdown(out, entries);
  }

  // Default: list format for decisions, pitfalls, patterns
  for (const entry of entries) {
    const anchor = generateAnchorId(entry.content);
    const pinTag = entry.metadata.pinned ? ' **[pinned]**' : '';
    const date = entry.metadata.source ? entry.metadata.source.substring(0, 10) : 'unknown';
    const files = entry.metadata.relatedFiles?.length > 0
      ? entry.metadata.relatedFiles.map(f => `\`${f}\``).join(', ')
      : 'cross-cutting';
    const features = entry.metadata.features?.length > 0
      ? ` (${entry.metadata.features.join(', ')})`
      : '';

    out.push(`### <a id="${anchor}"></a>${entry.content}${pinTag}`);
    out.push('');
    out.push(`- **Date:** ${date}${features}`);
    out.push(`- **Files:** ${files}`);
    if (entry.metadata.confirmations) {
      out.push(`- **Confirmed:** ${entry.metadata.confirmations} times`);
    }
    out.push('');
  }

  out.push(`---`);
  out.push(`*${entries.length} ${category}s total*`);
  return out.join('\n');
}

// @cap-todo(ref:F-029:AC-4) hotspots.md ranks files by cross-session edit frequency

/**
 * Generate hotspots markdown with ranking table.
 * @param {string[]} out - Output lines (header already added)
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries
 * @returns {string}
 */
function generateHotspotsMarkdown(out, entries) {
  // Sort by sessions desc, then edits desc
  const sorted = [...entries].sort((a, b) => {
    const sDiff = (b.metadata.sessions || 0) - (a.metadata.sessions || 0);
    if (sDiff !== 0) return sDiff;
    return (b.metadata.edits || 0) - (a.metadata.edits || 0);
  });

  out.push('| Rank | File | Sessions | Edits | Since |');
  out.push('|------|------|----------|-------|-------|');

  sorted.forEach((entry, i) => {
    const anchor = generateAnchorId(entry.content + entry.file);
    out.push(`| <a id="${anchor}"></a>${i + 1} | \`${entry.file}\` | ${entry.metadata.sessions || '?'} | ${entry.metadata.edits || '?'} | ${entry.metadata.since || '?'} |`);
  });

  out.push('');
  out.push(`---`);
  out.push(`*${entries.length} hotspots total*`);
  return out.join('\n');
}

// --- File I/O ---

// @cap-todo(ref:F-029:AC-2) Auto-generated — manual edits outside pinned entries overwritten
// @cap-todo(ref:F-029:AC-7) .cap/memory/ is git-committable (not gitignored)

/**
 * Parse existing memory entries from a markdown file to support merging.
 * Extracts anchor IDs to detect already-known entries.
 * @param {string} content - Markdown file content
 * @returns {Set<string>} Set of anchor IDs already present
 */
function parseExistingAnchors(content) {
  const anchors = new Set();
  const re = /<a id="([a-f0-9]+)"><\/a>/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    anchors.add(match[1]);
  }
  return anchors;
}

/**
 * Write all memory category files to .cap/memory/.
 * Supports merge mode: new entries are added to existing files, duplicates skipped by anchor ID.
 * @param {string} projectRoot - Project root directory
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries - All memory entries
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, return content without writing
 * @param {boolean} [options.merge] - If true, merge with existing entries instead of overwriting
 * @returns {{files: Object<string, string>, written: number}}
 */
function writeMemoryDirectory(projectRoot, entries, options = {}) {
  const memDir = path.join(projectRoot, MEMORY_DIR);
  const files = {};
  let written = 0;

  // Group entries by category
  const grouped = { decision: [], hotspot: [], pitfall: [], pattern: [] };
  for (const entry of entries) {
    const cat = entry.category;
    if (grouped[cat]) grouped[cat].push(entry);
  }

  // In merge mode, read existing files and skip entries with matching anchor IDs
  const existingFiles = options.merge ? readMemoryDirectory(projectRoot) : {};

  for (const [category, categoryEntries] of Object.entries(grouped)) {
    const filename = CATEGORY_FILES[category];

    // If merging: filter out entries whose anchor already exists
    let entriesToWrite = categoryEntries;
    if (options.merge && existingFiles[filename]) {
      const existingAnchors = parseExistingAnchors(existingFiles[filename]);
      entriesToWrite = categoryEntries.filter(entry => {
        const anchor = category === 'hotspot'
          ? generateAnchorId(entry.content + entry.file)
          : generateAnchorId(entry.content);
        return !existingAnchors.has(anchor);
      });

      // For hotspots: always regenerate fully (session counts change)
      if (category === 'hotspot') {
        entriesToWrite = categoryEntries;
      }
    }

    const content = generateCategoryMarkdown(category,
      category === 'hotspot' ? entriesToWrite : categoryEntries);
    files[filename] = content;

    if (!options.dryRun) {
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, filename), content, 'utf8');
      written++;
    }
  }

  return { files, written };
}

/**
 * Read existing memory directory entries (for merging with pinned entries).
 * @param {string} projectRoot
 * @returns {Object<string, string>} filename -> content
 */
function readMemoryDirectory(projectRoot) {
  const memDir = path.join(projectRoot, MEMORY_DIR);
  const result = {};

  if (!fs.existsSync(memDir)) return result;

  for (const [, filename] of Object.entries(CATEGORY_FILES)) {
    const fp = path.join(memDir, filename);
    if (fs.existsSync(fp)) {
      result[filename] = fs.readFileSync(fp, 'utf8');
    }
  }

  return result;
}

// @cap-todo(ref:F-029:AC-5) Code annotations include cross-reference link to memory file section

/**
 * Generate a cross-reference string for an annotation pointing to the memory directory.
 * @param {import('./cap-memory-engine.cjs').MemoryEntry} entry
 * @returns {string} e.g., "see .cap/memory/decisions.md#a3f2b1c0"
 */
function getCrossReference(entry) {
  const filename = CATEGORY_FILES[entry.category];
  if (!filename) return '';
  const anchor = entry.category === 'hotspot'
    ? generateAnchorId(entry.content + entry.file)
    : generateAnchorId(entry.content);
  return `see .cap/memory/${filename}#${anchor}`;
}

module.exports = {
  generateAnchorId,
  generateCategoryMarkdown,
  parseExistingAnchors,
  writeMemoryDirectory,
  readMemoryDirectory,
  getCrossReference,
  MEMORY_DIR,
  CATEGORY_FILES,
};
