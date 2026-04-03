// @cap-feature(feature:F-027) Memory Accumulation Engine — detect decisions, pitfalls, patterns, hotspots from session data
// @cap-decision Pure logic module with no I/O — takes parsed session data as input, outputs structured memory entries. Enables dry-run and unit testing.
// @cap-decision Relevance-based aging with pinned escape hatch — annotations expire after N sessions without edits, but pinned:true exempts from aging.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

// @cap-history(sessions:2, edits:22, since:2026-04-03, learned:2026-04-03) Frequently modified — 2 sessions, 22 edits
const fs = require('node:fs');
const path = require('node:path');

// --- Constants ---

/** Default number of sessions without edits before annotation is marked stale. */
const DEFAULT_STALE_THRESHOLD = 5;

/** Minimum sessions with edits for a file to qualify as a hotspot. */
const MIN_HOTSPOT_SESSIONS = 2;

/** Minimum successful applications for a pattern to be recorded. */
const MIN_PATTERN_CONFIRMATIONS = 2;

/** Regex patterns for detecting decision-related content in assistant messages.
 * Tightened: require verb+noun combinations, not just isolated keywords. */
const DECISION_PATTERNS = [
  /(?:(?:I|we) (?:decided|chose|picked|selected|went with)\b)/i,
  /(?:decision(?:\s+(?:was|is|to))\b)/i,
  /(?:trade-?off(?:\s+(?:between|is|was))\b)/i,
  /(?:root cause(?:\s+(?:is|was|:))\b)/i,
  /(?:the fix(?:\s+(?:is|was|needs|requires))\b)/i,
];

/** Regex patterns for detecting pitfall/failure content.
 * Tightened: require action context, not just isolated words. */
const PITFALL_PATTERNS = [
  /(?:(?:don't|do not|never|avoid)\s+\w{3,})/i,
  /(?:(?:watch out|careful|gotcha|pitfall|trap)\s+(?:for|with|when|:))/i,
  /(?:hours?\s+(?:of\s+)?debugging)/i,
  /(?:regression\s+(?:in|from|caused|when))/i,
  /(?:(?:this|the)\s+(?:bug|crash|failure)\s+(?:is|was|happens|occurs|caused))/i,
];

/** Regex patterns for detecting successful patterns.
 * Tightened: require specific recommendation language. */
const PATTERN_PATTERNS = [
  /(?:this (?:approach|pattern|method) (?:works?|solved|is better))/i,
  /(?:(?:proven|reliable)\s+(?:approach|pattern|method|strategy))/i,
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

/** Patterns that indicate conversational noise rather than real knowledge. */
const NOISE_PATTERNS = [
  // Conversational openers/fillers
  /^(Let me |Let's |I'll |I will |Now |OK|Sure|Got it|Done|Great|Perfect|Absolutely|Here's|Here is|Alright)/i,
  // Imperative prompts from agent
  /^(Please |Provide |Check |Run |Show |Read |Write |Create |Update |Delete |Review |Look |Schauen|Lass)/i,
  // Markdown formatting: tables, headers, bold-prefixed lines, quotes, HR, code blocks
  /^\||^```|^#+\s|^\*\*[A-Z]|^>\s|^---|^- \*\*/,
  // Code/command references
  /^`\//,
  // Numbered lists, bullet points
  /^\d+[\.\)]\s|^- [a-z]/,
  // GSD/CAP command references
  /^`?(\/gsd:|\/cap:|cap:|gsd:)/,
  // Status/log messages
  /^(Last scan|Shell cwd|Exit code|Session|Commit|What was generated)/i,
  // German filler / conversational
  /^(Aendere|Weiter mit|Dann |Jetzt |Genau|Besser|Gut |Ich baue|Soll ich|Oder )/i,
  // Agent workflow noise
  /^(Starting|Spawning|Loading|Checking|Analyzing|Processing|Running|Scanning)/i,
  // Contains only markdown bold + colon (structured output, not prose)
  /^\*\*.*:\*\*$/,
  // Lines starting with bold (structured output headers, not decisions)
  /^\*\*\d+-\d+/,
  // Bullet lists that start with "- Discovers", "- Analyzes", etc. (agent workflow descriptions)
  /^- (Discovers|Analyzes|Creates|Produces|Reads|Writes|Returns|Generates|Validates|Checks)/i,
  // Progress reports (e.g., "Von 235 → 146 Decisions")
  /(?:Von|From)\s+\d+\s*[→\-]\s*\d+/i,
  // Lines containing @cap-* or @gsd-* tags (meta-discussion about the system itself)
  /@(?:cap|gsd)-(?:feature|todo|decision|pitfall|history|pattern|risk|constraint|context|ref|api)\b/,
  // Code identifiers / function call references (not prose)
  /^[a-zA-Z_]\w*\.\w+\(|^[a-zA-Z_]\w*\(\)/,
  // Ergebnis/Result summary lines
  /^(Ergebnis|Result|Output|Nächste Schritte|Next steps):/i,
  // Lines that are mostly special characters (ASCII art, box drawing)
  /[─│┌┐└┘┬┴├┤╔╗╚╝]{3,}/,
  // AC table fragments
  /^\|\s*AC-\d/,
  // Lines starting with file paths
  /^`?(?:cap\/|hooks\/|bin\/|commands\/|tests\/|scripts\/|src\/)/,
  // Sentences with trailing markdown code block markers
  /```\s*$/,
  // Meta-discussion about regex patterns or test data
  /(?:Pattern|Regex|regex)\s+`/,
  // Sentences referencing test fixtures or test sentences
  /(?:test sentence|test data|Testfall|Test-Satz)/i,
  // Lines ending with orphaned numbering (e.g., "...visible errors\n4.")
  /^\d+\.$/,
];

/**
 * Check if a sentence is conversational noise rather than real knowledge.
 * @param {string} text
 * @returns {boolean}
 */
function isNoise(text) {
  return NOISE_PATTERNS.some(p => p.test(text));
}

/**
 * Normalize a file path for cross-session matching.
 * Strips worktree paths and resolves to monorepo-relative path.
 * @param {string} fp - Absolute file path
 * @param {string|null} projectRoot - Project root to make paths relative
 * @returns {string} Normalized path
 */
function normalizeFilePath(fp, projectRoot) {
  if (!fp) return fp;
  let normalized = fp;
  // Strip worktree prefix: .claude/worktrees/<name>/ → ""
  normalized = normalized.replace(/\.claude\/worktrees\/[^/]+\//, '');
  // Strip /private/var/folders temp paths for worktrees
  const worktreeMatch = normalized.match(/\/private\/var\/.*?\/([^/]+)\/(.*)/);
  if (worktreeMatch) {
    // Try to find the project name in the path
    normalized = worktreeMatch[2] || normalized;
  }
  // Make relative to project root if provided
  if (projectRoot && normalized.startsWith(projectRoot)) {
    normalized = normalized.substring(projectRoot.length).replace(/^\//, '');
  }
  return normalized;
}

/**
 * Analyze a single parsed session for memory-worthy content.
 * @param {Object} parsed - { meta, messages } from parseSession
 * @param {Object} [options]
 * @param {boolean} [options.isDebugSession] - Whether this session was a debug session
 * @param {string} [options.projectRoot] - Project root for path normalization
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
    if (msg.type !== 'assistant') continue;

    // File edits: collect from ALL messages including subagents
    for (const tool of extractTools(msg)) {
      if (tool.tool === 'Write' || tool.tool === 'Edit' || tool.tool === 'MultiEdit') {
        const rawFp = tool.input?.file_path || tool.input?.filePath || null;
        if (rawFp) {
          // Skip planning/memory/config artifacts — not real source code hotspots
          if (/\.(planning|cap)\/|memory\/|\.claude\/|SESSION\.json|MEMORY\.md|STATE\.md/.test(rawFp)) continue;
          const fp = normalizeFilePath(rawFp, options.projectRoot || null);
          editedFiles[fp] = (editedFiles[fp] || 0) + 1;
        }
      }
    }

    // Text analysis: include subagent messages (they contain decisions/pitfalls too)
    const text = stripTags(extractText(msg));
    if (!text) continue;

    // Collect feature references
    const featureMatches = text.match(FEATURE_RE);
    if (featureMatches) featureMatches.forEach(f => features.add(f));

    // Extract sentences — skip markdown formatting artifacts
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const sentence of sentences) {
      if (sentence.length < 40 || sentence.length > 300) continue;
      const clean = sentence.trim();
      if (isNoise(clean)) continue;

      if (DECISION_PATTERNS.some(p => p.test(clean))) {
        decisions.push(clean);
      }
      if (PITFALL_PATTERNS.some(p => p.test(clean))) {
        pitfalls.push(clean);
      }
      if (PATTERN_PATTERNS.some(p => p.test(clean))) {
        patterns.push(clean);
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

// --- Code-Based Memory (primary source — code is the single source of truth) ---

/**
 * Extract memory entries from code tags (via tag scanner).
 * Code tags are high-signal, zero-noise — they are explicit developer annotations.
 * @param {Array<{type: string, file: string, line: number, metadata: Object, description: string, subtype: string|null}>} tags - Tags from cap-tag-scanner
 * @returns {MemoryEntry[]}
 */
function accumulateFromCode(tags) {
  const entries = [];
  const seen = new Set();

  for (const tag of tags) {
    // @cap-decision tags → decision entries
    if (tag.type === 'decision') {
      if (!tag.description || tag.description.length < 10) continue;
      const key = tag.description.substring(0, 80).toLowerCase();
      if (seen.has('d:' + key)) continue;
      seen.add('d:' + key);

      entries.push({
        category: 'decision',
        file: tag.file,
        content: tag.description,
        metadata: {
          source: 'code',
          branch: null,
          relatedFiles: [tag.file],
          features: tag.metadata?.feature ? [tag.metadata.feature] : [],
          pinned: false,
          line: tag.line,
        },
      });
    }

    // Extract pitfalls from @cap-todo with risk: subtype
    if (tag.type === 'todo' && tag.subtype === 'risk') {
      const desc = tag.description.replace(/^risk:\s*/i, '');
      if (!desc || desc.length < 10) continue;
      const key = desc.substring(0, 80).toLowerCase();
      if (seen.has('p:' + key)) continue;
      seen.add('p:' + key);

      entries.push({
        category: 'pitfall',
        file: tag.file,
        content: desc,
        metadata: {
          source: 'code',
          branch: null,
          relatedFiles: [tag.file],
          features: tag.metadata?.feature ? [tag.metadata.feature] : [],
          pinned: false,
          line: tag.line,
        },
      });
    }

    // Extract pitfalls from standalone @cap-risk tags
    if (tag.type === 'risk') {
      if (!tag.description || tag.description.length < 10) continue;
      const key = tag.description.substring(0, 80).toLowerCase();
      if (seen.has('p:' + key)) continue;
      seen.add('p:' + key);

      entries.push({
        category: 'pitfall',
        file: tag.file,
        content: tag.description,
        metadata: {
          source: 'code',
          branch: null,
          relatedFiles: [tag.file],
          features: tag.metadata?.feature ? [tag.metadata.feature] : [],
          pinned: false,
          line: tag.line,
        },
      });
    }
  }

  return entries;
}

// --- Convenience: Full Pipeline Input ---

/**
 * Parse raw JSONL session files and accumulate memory.
 * Sessions provide HOTSPOTS ONLY (edit frequency). Decisions/pitfalls come from code tags.
 * @param {Array<{path: string, isDebugSession?: boolean}>} sessionFiles - Session file descriptors
 * @param {Object} [options] - Options passed to accumulate()
 * @param {string} [options.projectRoot] - Project root for file path normalization (monorepo-aware)
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
        { isDebugSession: sf.isDebugSession || false, projectRoot: options.projectRoot || null }
      );
      // Sessions contribute only hotspots — clear noisy text-based extractions
      analysis.decisions = [];
      analysis.pitfalls = [];
      analysis.patterns = [];
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
  accumulateFromCode,
  accumulateFromFiles,
  formatAnnotation,

  // Helpers (for testing)
  extractText,
  extractTools,
  stripTags,
  isNoise,
  normalizeFilePath,

  // Constants (configurable via options, exposed for transparency)
  DEFAULT_STALE_THRESHOLD,
  MIN_HOTSPOT_SESSIONS,
  MIN_PATTERN_CONFIRMATIONS,
  DECISION_PATTERNS,
  PITFALL_PATTERNS,
  PATTERN_PATTERNS,
};
