// @cap-feature(feature:F-027) Memory Accumulation Engine — detect decisions, pitfalls, patterns, hotspots from session data
// @cap-decision Pure logic module with no I/O — takes parsed session data as input, outputs structured memory entries. Enables dry-run and unit testing.
// @cap-decision Relevance-based aging with pinned escape hatch — annotations expire after N sessions without edits, but pinned:true exempts from aging.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// --- Constants ---

/** Default number of sessions without edits before annotation is marked stale. */
const DEFAULT_STALE_THRESHOLD = 5;

/** Minimum sessions with edits for a file to qualify as a hotspot. */
const MIN_HOTSPOT_SESSIONS = 2;

/** Minimum successful applications for a pattern to be recorded. */
const MIN_PATTERN_CONFIRMATIONS = 2;

/** Regex patterns for detecting decision-related content in assistant messages. */
const DECISION_PATTERNS = [
  /(?:decided|decision|chose|choice|approach|strategy|trade-?off|rationale|conclusion)/i,
  /(?:the problem|the issue|root cause|the fix|solution|workaround)/i,
];

/** Regex patterns for detecting pitfall/failure content. */
const PITFALL_PATTERNS = [
  /(?:bug|failure|crash|broke|broken|breaking|regression|workaround)/i,
  /(?:don't|do not|avoid|never|careful|watch out|gotcha|trap|pitfall)/i,
  /(?:hours? (?:of )?debugging|wasted|painful|tricky|subtle)/i,
];

/** Regex patterns for detecting successful patterns. */
const PATTERN_PATTERNS = [
  /(?:works? well|good approach|better to|prefer|recommend|proven|reliable)/i,
  /(?:this (?:approach|pattern|strategy|method) (?:works?|is better|solved))/i,
];

/** Feature ID regex */
const FEATURE_RE = /F-\d{3}/g;

// --- Types ---

/**
 * @typedef {'decision'|'pitfall'|'pattern'|'hotspot'} MemoryCategory
 */

/**
 * @typedef {Object} MemoryEntry
 * @property {MemoryCategory} category
 * @property {string|null} file - Target file path (null for cross-cutting entries)
 * @property {string} content - Human-readable description
 * @property {Object} metadata
 * @property {string} metadata.source - Source session date
 * @property {string|null} metadata.branch - Git branch
 * @property {string[]} metadata.relatedFiles - Other files involved
 * @property {string[]} metadata.features - Feature IDs referenced
 * @property {boolean} metadata.pinned - Whether exempt from aging
 * @property {number} [metadata.sessions] - Number of sessions (hotspots)
 * @property {number} [metadata.edits] - Total edit count (hotspots)
 * @property {string} [metadata.since] - Earliest session date (hotspots)
 * @property {number} [metadata.confirmations] - Times confirmed (patterns)
 */

/**
 * @typedef {Object} ExistingAnnotation
 * @property {MemoryCategory} category
 * @property {string} file
 * @property {string} content
 * @property {boolean} pinned
 * @property {number} lastEditSession - Session index when file was last edited (0 = current)
 */

/**
 * @typedef {Object} AccumulationResult
 * @property {MemoryEntry[]} newEntries - New memory entries to write
 * @property {ExistingAnnotation[]} staleEntries - Existing annotations to remove
 * @property {MemoryEntry[]} updatedEntries - Existing annotations to update (e.g., increment counts)
 * @property {Object} stats - Accumulation statistics
 */

// --- Session Analysis ---

/**
 * Extract text content from a message (mirrors F-025 helper).
 * @param {Object} msg
 * @returns {string}
 */
function extractText(msg) {
  const content = msg.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join('\n');
  }
  return '';
}

/**
 * Extract tool uses from a message.
 * @param {Object} msg
 * @returns {Array<{tool: string, input: Object}>}
 */
function extractTools(msg) {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(c => c.type === 'tool_use').map(c => ({ tool: c.name, input: c.input }));
}

/**
 * Strip system tags from text.
 * @param {string} text
 * @returns {string}
 */
function stripTags(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * Analyze a single parsed session for memory-worthy content.
 * @param {Object} parsed - { meta, messages } from parseSession
 * @param {Object} [options]
 * @param {boolean} [options.isDebugSession] - Whether this session was a debug session
 * @returns {{decisions: string[], pitfalls: string[], patterns: string[], editedFiles: Object<string, number>, features: Set<string>}}
 */
function analyzeSession(parsed, options = {}) {
  const { meta, messages } = parsed;
  const decisions = [];
  const pitfalls = [];
  const patterns = [];
  const editedFiles = {}; // path -> edit count
  const features = new Set();

  for (const msg of messages) {
    if (msg.isSidechain) continue;

    if (msg.type === 'assistant') {
      const text = stripTags(extractText(msg));
      if (!text) continue;

      // Collect file edits
      for (const tool of extractTools(msg)) {
        if (tool.tool === 'Write' || tool.tool === 'Edit' || tool.tool === 'MultiEdit') {
          const fp = tool.input?.file_path || tool.input?.filePath || null;
          if (fp) editedFiles[fp] = (editedFiles[fp] || 0) + 1;
        }
      }

      // Collect feature references
      const featureMatches = text.match(FEATURE_RE);
      if (featureMatches) featureMatches.forEach(f => features.add(f));

      // Extract sentences — skip markdown formatting artifacts
      const sentences = text.split(/(?<=[.!?\n])\s+/);
      for (const sentence of sentences) {
        if (sentence.length < 20 || sentence.length > 500) continue;
        const clean = sentence.trim();
        // Skip markdown tables, headers, bullet-lists, and code blocks
        if (/^\||\*\*[A-Z].*:\*\*|^#+\s|^```|^- \*\*|^>\s/.test(clean)) continue;

        if (DECISION_PATTERNS.some(p => p.test(clean))) {
          decisions.push(clean);
        }
        if ((options.isDebugSession || PITFALL_PATTERNS.some(p => p.test(clean))) && PITFALL_PATTERNS.some(p => p.test(clean))) {
          pitfalls.push(clean);
        }
        if (PATTERN_PATTERNS.some(p => p.test(clean))) {
          patterns.push(clean);
        }
      }
    }
  }

  return {
    decisions: [...new Set(decisions)],
    pitfalls: [...new Set(pitfalls)],
    patterns: [...new Set(patterns)],
    editedFiles,
    features,
    date: meta?.timestamp || null,
    branch: meta?.branch || null,
  };
}

// --- Cross-Session Accumulation ---

// @cap-todo(ref:F-027:AC-2) Detect four memory categories: decisions, pitfalls, patterns, hotspots

/**
 * Accumulate memory from multiple analyzed sessions.
 * @param {Array<ReturnType<typeof analyzeSession>>} sessionAnalyses - Results from analyzeSession for each session
 * @param {Object} [options]
 * @param {number} [options.staleThreshold] - Sessions without edits before stale (default: 5)
 * @param {number} [options.minHotspotSessions] - Min sessions for hotspot (default: 2)
 * @param {number} [options.minPatternConfirmations] - Min confirmations for pattern (default: 2)
 * @param {ExistingAnnotation[]} [options.existingAnnotations] - Current annotations in code
 * @returns {AccumulationResult}
 */
function accumulate(sessionAnalyses, options = {}) {
  const staleThreshold = options.staleThreshold || DEFAULT_STALE_THRESHOLD;
  const minHotspot = options.minHotspotSessions || MIN_HOTSPOT_SESSIONS;
  const minPattern = options.minPatternConfirmations || MIN_PATTERN_CONFIRMATIONS;
  const existing = options.existingAnnotations || [];

  const newEntries = [];
  const updatedEntries = [];
  const staleEntries = [];

  // --- Hotspots (AC-3): files edited across multiple sessions ---
  const fileSessionMap = {}; // path -> { sessions: Set, totalEdits: number, earliestDate: string }
  for (const analysis of sessionAnalyses) {
    for (const [fp, editCount] of Object.entries(analysis.editedFiles)) {
      if (!fileSessionMap[fp]) {
        fileSessionMap[fp] = { sessions: new Set(), totalEdits: 0, earliestDate: analysis.date };
      }
      fileSessionMap[fp].sessions.add(analysis.date || 'unknown');
      fileSessionMap[fp].totalEdits += editCount;
      if (analysis.date && (!fileSessionMap[fp].earliestDate || analysis.date < fileSessionMap[fp].earliestDate)) {
        fileSessionMap[fp].earliestDate = analysis.date;
      }
    }
  }

  for (const [fp, data] of Object.entries(fileSessionMap)) {
    if (data.sessions.size >= minHotspot) {
      newEntries.push({
        category: 'hotspot',
        file: fp,
        content: `Frequently modified — ${data.sessions.size} sessions, ${data.totalEdits} edits`,
        metadata: {
          source: [...data.sessions].sort().pop(),
          branch: null,
          relatedFiles: [],
          features: [],
          pinned: false,
          sessions: data.sessions.size,
          edits: data.totalEdits,
          since: data.earliestDate ? data.earliestDate.substring(0, 10) : null,
        },
      });
    }
  }

  // --- Decisions (AC-2): collect unique decisions across sessions ---
  const seenDecisions = new Set();
  for (const analysis of sessionAnalyses) {
    for (const decision of analysis.decisions) {
      const key = decision.substring(0, 80).toLowerCase();
      if (seenDecisions.has(key)) continue;
      seenDecisions.add(key);

      // Find which files were edited in the same session
      const relatedFiles = Object.keys(analysis.editedFiles).slice(0, 5);

      newEntries.push({
        category: 'decision',
        file: relatedFiles[0] || null, // primary file, or cross-cutting
        content: decision,
        metadata: {
          source: analysis.date,
          branch: analysis.branch,
          relatedFiles,
          features: [...analysis.features],
          pinned: false,
        },
      });
    }
  }

  // --- Pitfalls (AC-4): only from debug sessions or explicit failure context ---
  const seenPitfalls = new Set();
  for (const analysis of sessionAnalyses) {
    for (const pitfall of analysis.pitfalls) {
      const key = pitfall.substring(0, 80).toLowerCase();
      if (seenPitfalls.has(key)) continue;
      seenPitfalls.add(key);

      const relatedFiles = Object.keys(analysis.editedFiles).slice(0, 5);

      newEntries.push({
        category: 'pitfall',
        file: relatedFiles[0] || null,
        content: pitfall,
        metadata: {
          source: analysis.date,
          branch: analysis.branch,
          relatedFiles,
          features: [...analysis.features],
          pinned: false,
        },
      });
    }
  }

  // --- Patterns (AC-5): only when confirmed across multiple sessions ---
  const patternCounts = {}; // normalized key -> { content, count, sessions }
  for (const analysis of sessionAnalyses) {
    for (const pattern of analysis.patterns) {
      const key = pattern.substring(0, 80).toLowerCase();
      if (!patternCounts[key]) {
        patternCounts[key] = { content: pattern, count: 0, sessions: [], relatedFiles: new Set(), features: new Set() };
      }
      patternCounts[key].count++;
      if (analysis.date) patternCounts[key].sessions.push(analysis.date);
      Object.keys(analysis.editedFiles).forEach(f => patternCounts[key].relatedFiles.add(f));
      analysis.features.forEach(f => patternCounts[key].features.add(f));
    }
  }

  for (const [, data] of Object.entries(patternCounts)) {
    if (data.count >= minPattern) {
      newEntries.push({
        category: 'pattern',
        file: [...data.relatedFiles][0] || null,
        content: data.content,
        metadata: {
          source: data.sessions.sort().pop(),
          branch: null,
          relatedFiles: [...data.relatedFiles].slice(0, 5),
          features: [...data.features],
          pinned: false,
          confirmations: data.count,
        },
      });
    }
  }

  // --- Aging (AC-6, AC-7): check existing annotations for staleness ---
  const currentlyEditedFiles = new Set();
  for (const analysis of sessionAnalyses) {
    for (const fp of Object.keys(analysis.editedFiles)) {
      currentlyEditedFiles.add(fp);
    }
  }

  for (const annotation of existing) {
    // AC-7: pinned annotations never go stale
    if (annotation.pinned) continue;

    if (annotation.lastEditSession >= staleThreshold && !currentlyEditedFiles.has(annotation.file)) {
      staleEntries.push(annotation);
    }
  }

  // --- Stats ---
  const stats = {
    sessionsAnalyzed: sessionAnalyses.length,
    hotspots: newEntries.filter(e => e.category === 'hotspot').length,
    decisions: newEntries.filter(e => e.category === 'decision').length,
    pitfalls: newEntries.filter(e => e.category === 'pitfall').length,
    patterns: newEntries.filter(e => e.category === 'pattern').length,
    stale: staleEntries.length,
    total: newEntries.length,
  };

  return { newEntries, staleEntries, updatedEntries, stats };
}

// --- Convenience: Full Pipeline Input ---

// @cap-todo(ref:F-027:AC-1) Read session data from F-025/F-026 as sole input source
// @cap-todo(ref:F-027:AC-8) Output structured memory entries consumable by F-028 and F-029

/**
 * Parse raw JSONL session files and accumulate memory.
 * This is the main entry point — reads session files, analyzes them, and accumulates.
 * @param {Array<{path: string, isDebugSession?: boolean}>} sessionFiles - Session file descriptors
 * @param {Object} [options] - Options passed to accumulate()
 * @returns {AccumulationResult}
 */
function accumulateFromFiles(sessionFiles, options = {}) {
  const analyses = [];

  for (const sf of sessionFiles) {
    try {
      const lines = fs.readFileSync(sf.path, 'utf8').trim().split('\n');
      const messages = [];
      let meta = null;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.sessionId && !meta) {
            meta = { id: obj.sessionId, timestamp: obj.timestamp || null, branch: obj.gitBranch || null };
          }
          if (!meta?.timestamp && obj.timestamp) meta.timestamp = obj.timestamp;
          if (obj.type === 'user' || obj.type === 'assistant') messages.push(obj);
        } catch { /* skip malformed */ }
      }

      const analysis = analyzeSession(
        { meta: meta || { id: 'unknown', timestamp: null, branch: null }, messages },
        { isDebugSession: sf.isDebugSession || false }
      );
      analyses.push(analysis);
    } catch { /* skip unreadable files */ }
  }

  return accumulate(analyses, options);
}

/**
 * Format a memory entry as an annotation string (without comment prefix).
 * @param {MemoryEntry} entry
 * @returns {string}
 */
function formatAnnotation(entry) {
  const tag = entry.category === 'hotspot' ? 'cap-history'
    : entry.category === 'decision' ? 'cap-decision'
    : entry.category === 'pitfall' ? 'cap-pitfall'
    : 'cap-pattern';

  const meta = [];
  if (entry.metadata.sessions) meta.push(`sessions:${entry.metadata.sessions}`);
  if (entry.metadata.edits) meta.push(`edits:${entry.metadata.edits}`);
  if (entry.metadata.since) meta.push(`since:${entry.metadata.since}`);
  if (entry.metadata.confirmations) meta.push(`confirmed:${entry.metadata.confirmations}`);
  if (entry.metadata.pinned) meta.push('pinned:true');
  if (entry.metadata.source) meta.push(`learned:${entry.metadata.source.substring(0, 10)}`);

  const metaStr = meta.length > 0 ? `(${meta.join(', ')})` : '';
  return `@${tag}${metaStr} ${entry.content}`;
}

module.exports = {
  // Core
  analyzeSession,
  accumulate,
  accumulateFromFiles,
  formatAnnotation,

  // Helpers (for testing)
  extractText,
  extractTools,
  stripTags,

  // Constants (configurable via options, exposed for transparency)
  DEFAULT_STALE_THRESHOLD,
  MIN_HOTSPOT_SESSIONS,
  MIN_PATTERN_CONFIRMATIONS,
  DECISION_PATTERNS,
  PITFALL_PATTERNS,
  PATTERN_PATTERNS,
};
