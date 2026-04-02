/**
 * arc-scanner — Regex-based ARC annotation tag scanner
 *
 * Extracts @gsd-tags from source files anchored to comment tokens,
 * preventing false positives from strings, URLs, and template literals.
 *
 * Requirements: SCAN-01, SCAN-02, SCAN-03, SCAN-04
 */

'use strict';

// @cap-feature(feature:F-015) Legacy ARC Scanner — regex-based @gsd-* tag extraction (predecessor to F-001)
// @cap-todo risk: This module uses the old @gsd-* tag prefix; consider deprecating once F-006 migration is complete

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');

// COPY THIS REGEX VERBATIM — do not modify
// Anchors to: leading whitespace + comment token + optional space + @gsd-<type>[(metadata)] description
const TAG_LINE_RE = /^[ \t]*(?:\/\/+|\/\*+|\*+|#+|--+|"{3}|'{3})[ \t]*@gsd-(\w+)(?:\(([^)]*)\))?[ \t]*(.*?)[ \t]*$/gm;

const DEFAULT_EXCLUDES = ['node_modules', 'dist', 'build', '.planning', '.git'];

const VALID_TAG_TYPES = new Set([
  'context', 'decision', 'todo', 'constraint', 'pattern', 'ref', 'risk', 'api'
]);

/**
 * Parse the parenthesized metadata block.
 * e.g. "phase:2, priority:high" → { phase: '2', priority: 'high' }
 *
 * @param {string|undefined} raw - Captured metadata string or undefined
 * @returns {Object} Key-value pairs, all values as strings
 */
function parseMetadata(raw) {
  if (!raw || !raw.trim()) return {};
  const result = {};
  const parts = raw.split(/,\s*/);
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Scan a single file for @gsd-tags anchored to comment tokens.
 *
 * @param {string} filePath - Absolute or relative path to the file
 * @returns {Array<Object>} Array of tag objects
 */
function scanFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return [];
  }

  // Create a fresh regex instance per call to avoid lastIndex state issues with /gm flag
  const re = new RegExp(TAG_LINE_RE.source, 'gm');
  const tags = [];

  for (const match of content.matchAll(re)) {
    const type = match[1];

    // Only include known ARC tag types
    if (!VALID_TAG_TYPES.has(type)) continue;

    // Compute 1-based line number by counting newlines before match position
    const line = (content.slice(0, match.index).match(/\n/g) || []).length + 1;

    tags.push({
      type,
      file: filePath,
      line,
      metadata: parseMetadata(match[2]),
      description: (match[3] || '').trim(),
      raw: match[0].trim(),
    });
  }

  return tags;
}

/**
 * Recursively walk a directory, scanning all files for @gsd-tags.
 * Respects DEFAULT_EXCLUDES and optional .gsdignore at dirPath root.
 *
 * @param {string} dirPath - Root directory to scan
 * @param {Object} [options] - Optional filters
 * @param {string} [options.phaseFilter] - Only return tags where metadata.phase === phaseFilter
 * @param {string} [options.typeFilter] - Only return tags where type === typeFilter
 * @param {string[]} [options.excludes] - Additional directory/file names to skip
 * @returns {Array<Object>} All matching tags across all files
 */
function scanDirectory(dirPath, options) {
  options = options || {};

  // Load .gsdignore patterns from project root (simple line matching)
  const gsdIgnorePath = path.join(dirPath, '.gsdignore');
  const gsdIgnorePatterns = [];
  try {
    if (fs.existsSync(gsdIgnorePath)) {
      const lines = fs.readFileSync(gsdIgnorePath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          gsdIgnorePatterns.push(trimmed);
        }
      }
    }
  } catch {
    // Ignore errors reading .gsdignore
  }

  /**
   * Internal recursive walker.
   *
   * @param {string} dir - Current directory being walked
   * @returns {Array<Object>} Tags found under dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const allTags = [];
    for (const entry of entries) {
      const name = entry.name;

      // Skip DEFAULT_EXCLUDES directories
      if (DEFAULT_EXCLUDES.includes(name)) continue;

      // Skip user-provided excludes
      if (options.excludes && options.excludes.includes(name)) continue;

      // Skip .gsdignore patterns
      if (gsdIgnorePatterns.some(pat => name === pat || name.startsWith(pat))) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        allTags.push(...walk(fullPath));
      } else if (entry.isFile()) {
        allTags.push(...scanFile(fullPath));
      }
    }

    return allTags;
  }

  let tags = walk(dirPath);

  // Apply phase filter
  if (options.phaseFilter !== undefined && options.phaseFilter !== null) {
    const phaseStr = String(options.phaseFilter);
    tags = tags.filter(tag => tag.metadata.phase === phaseStr);
  }

  // Apply type filter
  if (options.typeFilter) {
    tags = tags.filter(tag => tag.type === options.typeFilter);
  }

  return tags;
}

/**
 * Format tags as a JSON string.
 *
 * @param {Array<Object>} tags - Array of tag objects
 * @returns {string} Pretty-printed JSON string
 */
function formatAsJson(tags) {
  return JSON.stringify(tags, null, 2);
}

/**
 * Format tags as a CODE-INVENTORY.md Markdown document.
 *
 * Structure:
 * - Header with metadata
 * - ## Summary Statistics (table of tag type counts)
 * - ## Tags by Type (H3 per type, H4 per file, table of line/metadata/description)
 * - ## Phase Reference Index (table of phase/count/files)
 *
 * @param {Array<Object>} tags - Array of tag objects
 * @param {string} [projectName] - Project name for the header
 * @returns {string} CODE-INVENTORY.md Markdown string
 */
function formatAsMarkdown(tags, projectName) {
  const now = new Date().toISOString();
  const name = projectName || 'Unknown Project';

  // Gather unique files
  const fileSet = new Set(tags.map(t => t.file));
  const totalFiles = fileSet.size;
  const totalTags = tags.length;

  // Build type → tags map (preserve ARC order)
  const TYPE_ORDER = ['context', 'decision', 'todo', 'constraint', 'pattern', 'ref', 'risk', 'api'];
  const byType = {};
  for (const type of TYPE_ORDER) {
    byType[type] = [];
  }
  for (const tag of tags) {
    if (byType[tag.type]) {
      byType[tag.type].push(tag);
    } else {
      byType[tag.type] = [tag];
    }
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const lines = [
    `# CODE-INVENTORY.md`,
    ``,
    `**Generated:** ${now}`,
    `**Project:** ${name}`,
    `**Schema version:** 1.0`,
    `**Tags found:** ${totalTags} across ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`,
    ``,
  ];

  // ── Summary Statistics ────────────────────────────────────────────────────
  lines.push(`## Summary Statistics`, ``);
  lines.push(`| Tag Type | Count |`);
  lines.push(`|----------|-------|`);
  for (const type of TYPE_ORDER) {
    const count = byType[type] ? byType[type].length : 0;
    if (count > 0) {
      lines.push(`| @gsd-${type} | ${count} |`);
    }
  }
  lines.push(``);

  // ── Tags by Type ──────────────────────────────────────────────────────────
  lines.push(`## Tags by Type`, ``);

  for (const type of TYPE_ORDER) {
    const typeTags = byType[type];
    if (!typeTags || typeTags.length === 0) continue;

    lines.push(`### @gsd-${type}`, ``);

    // Group by file
    const byFile = {};
    for (const tag of typeTags) {
      if (!byFile[tag.file]) byFile[tag.file] = [];
      byFile[tag.file].push(tag);
    }

    for (const [filePath, fileTags] of Object.entries(byFile)) {
      lines.push(`#### ${filePath}`, ``);
      lines.push(`| Line | Metadata | Description |`);
      lines.push(`|------|----------|-------------|`);
      for (const tag of fileTags) {
        const metaStr = Object.keys(tag.metadata).length > 0
          ? Object.entries(tag.metadata).map(([k, v]) => `${k}:${v}`).join(', ')
          : '—';
        lines.push(`| ${tag.line} | ${metaStr} | ${tag.description || '—'} |`);
      }
      lines.push(``);
    }
  }

  // ── Phase Reference Index ─────────────────────────────────────────────────
  lines.push(`## Phase Reference Index`, ``);
  lines.push(`| Phase | Tag Count | Files |`);
  lines.push(`|-------|-----------|-------|`);

  // Group by phase value
  const byPhase = {};
  for (const tag of tags) {
    const phase = tag.metadata.phase || '(untagged)';
    if (!byPhase[phase]) byPhase[phase] = { count: 0, files: new Set() };
    byPhase[phase].count++;
    byPhase[phase].files.add(tag.file);
  }

  // Sort: numbered phases first, then (untagged)
  const phases = Object.keys(byPhase).sort((a, b) => {
    if (a === '(untagged)') return 1;
    if (b === '(untagged)') return -1;
    return Number(a) - Number(b);
  });

  for (const phase of phases) {
    const { count, files } = byPhase[phase];
    lines.push(`| ${phase} | ${count} | ${[...files].join(', ')} |`);
  }

  lines.push(``);

  return lines.join('\n');
}

/**
 * CLI entry point: scan a target path, format, and write output.
 * Called by gsd-tools.cjs case 'extract-tags'.
 *
 * @param {string} cwd - Current working directory
 * @param {string} targetPath - Path to scan (file or directory)
 * @param {Object} [opts] - Options
 * @param {string} [opts.phaseFilter] - Phase filter
 * @param {string} [opts.typeFilter] - Type filter
 * @param {string} [opts.format] - 'json' (default) or 'md'
 * @param {string} [opts.outputFile] - Write to file instead of stdout
 */
function cmdExtractTags(cwd, targetPath, opts) {
  opts = opts || {};
  const format = opts.format || 'json';
  const resolvedPath = path.resolve(cwd, targetPath || cwd);

  const tags = scanDirectory(resolvedPath, {
    phaseFilter: opts.phaseFilter,
    typeFilter: opts.typeFilter,
  });

  let result;
  if (format === 'md') {
    result = formatAsMarkdown(tags, opts.projectName);
  } else {
    result = formatAsJson(tags);
  }

  if (opts.outputFile) {
    const outDir = path.dirname(opts.outputFile);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(opts.outputFile, result, 'utf-8');
  } else {
    process.stdout.write(result + '\n');
  }
}

module.exports = { scanFile, scanDirectory, formatAsJson, formatAsMarkdown, cmdExtractTags };
