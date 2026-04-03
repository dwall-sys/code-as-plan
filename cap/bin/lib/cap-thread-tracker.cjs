// @cap-feature(feature:F-031) Conversation Thread Tracking — persist brainstorm sessions as named threads with branching and topic detection
// @cap-decision Pure logic module with explicit I/O functions — same pattern as cap-memory-engine.cjs. No side effects in analysis functions.
// @cap-decision Thread storage uses individual JSON files per thread plus a central index — enables git-friendly diffs and parallel team access.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path, crypto).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// --- Constants ---

/** Directory for thread storage relative to project root. */
const THREADS_DIR = path.join('.cap', 'memory', 'threads');

/** Thread index file relative to project root. */
const THREAD_INDEX_FILE = path.join('.cap', 'memory', 'thread-index.json');

/** Minimum keyword overlap ratio (0-1) to consider threads as revisiting the same topic. */
const REVISIT_KEYWORD_THRESHOLD = 0.25;

/** Minimum number of shared keywords required for a revisit match. */
const REVISIT_MIN_SHARED_KEYWORDS = 2;

/** Stop words excluded from keyword extraction. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
  'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you',
  'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it',
  'its', 'they', 'them', 'their', 'theirs', 'also', 'into', 'if',
]);

// --- Types ---

/**
 * @typedef {Object} Thread
 * @property {string} id - Unique thread ID (e.g., "thr-a1b2c3d4")
 * @property {string} name - Human-readable thread name (derived from problem statement)
 * @property {string} timestamp - ISO timestamp when thread was created
 * @property {string|null} parentThreadId - Parent thread ID if branched, null otherwise
 * @property {string|null} divergencePoint - Description of where this thread diverged from parent
 * @property {string} problemStatement - The problem or topic being explored
 * @property {string} solutionShape - High-level solution direction discovered
 * @property {string[]} boundaryDecisions - Key boundary/scope decisions made during brainstorm
 * @property {string[]} featureIds - Feature Map entries (F-IDs) that resulted from this thread
 * @property {string[]} keywords - Extracted problem-space keywords for topic matching
 */

/**
 * @typedef {Object} ThreadIndexEntry
 * @property {string} id - Thread ID
 * @property {string} name - Thread name
 * @property {string} timestamp - ISO timestamp
 * @property {string[]} featureIds - Associated feature IDs
 * @property {string|null} parentThreadId - Parent thread ID if branched
 * @property {string[]} keywords - Problem-space keywords
 */

/**
 * @typedef {Object} ThreadIndex
 * @property {string} version - Index schema version
 * @property {ThreadIndexEntry[]} threads - All thread index entries
 */

/**
 * @typedef {Object} RevisitMatch
 * @property {string} threadId - Matching thread ID
 * @property {string} threadName - Matching thread name
 * @property {number} keywordOverlap - Number of shared keywords
 * @property {string[]} sharedKeywords - The overlapping keywords
 * @property {string[]} sharedFeatureIds - Overlapping feature IDs
 * @property {number} score - Combined relevance score (0-1)
 */

// --- Thread ID Generation ---

// @cap-decision Thread IDs use crypto.randomBytes for uniqueness — deterministic IDs (content hash) would collide when two threads start from the same problem statement.

/**
 * Generate a unique thread ID.
 * @returns {string} Thread ID in format "thr-{8 hex chars}"
 */
function generateThreadId() {
  const bytes = crypto.randomBytes(4);
  return 'thr-' + bytes.toString('hex');
}

// --- Keyword Extraction ---

// @cap-todo(ac:F-031/AC-3) Keyword extraction for topic revisit detection

/**
 * Extract problem-space keywords from text.
 * Filters stop words, short words, and normalizes to lowercase.
 * @param {string} text - Input text (problem statement, solution shape, etc.)
 * @returns {string[]} Deduplicated sorted keywords
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  return [...new Set(words)].sort();
}

// --- Thread Creation ---

// @cap-todo(ac:F-031/AC-1) Persist each brainstorm session as a named thread with unique ID, timestamp, and parent reference
// @cap-todo(ac:F-031/AC-2) Capture full discovery context: problem statement, solution shape, boundary decisions, feature IDs

/**
 * Create a new thread object from brainstorm session data.
 * @param {Object} params
 * @param {string} params.problemStatement - The problem or topic being explored
 * @param {string} [params.solutionShape] - High-level solution direction
 * @param {string[]} [params.boundaryDecisions] - Key boundary/scope decisions
 * @param {string[]} [params.featureIds] - Resulting Feature Map entry IDs
 * @param {string|null} [params.parentThreadId] - Parent thread ID if branching
 * @param {string|null} [params.divergencePoint] - Where this diverges from parent
 * @param {string} [params.name] - Optional human-readable name (auto-derived if omitted)
 * @returns {Thread}
 */
function createThread(params) {
  const {
    problemStatement,
    solutionShape = '',
    boundaryDecisions = [],
    featureIds = [],
    parentThreadId = null,
    divergencePoint = null,
    name = null,
  } = params;

  const id = generateThreadId();
  const timestamp = new Date().toISOString();

  // Auto-derive name from problem statement: first 60 chars, trimmed at word boundary
  const derivedName = name || deriveName(problemStatement);

  // Extract keywords from all textual content
  const allText = [problemStatement, solutionShape, ...boundaryDecisions].join(' ');
  const keywords = extractKeywords(allText);

  return {
    id,
    name: derivedName,
    timestamp,
    parentThreadId,
    divergencePoint,
    problemStatement,
    solutionShape,
    boundaryDecisions,
    featureIds,
    keywords,
  };
}

/**
 * Derive a human-readable name from a problem statement.
 * @param {string} problemStatement
 * @returns {string}
 */
function deriveName(problemStatement) {
  if (!problemStatement) return 'Untitled Thread';
  const trimmed = problemStatement.substring(0, 60).trim();
  // Trim at last word boundary if we truncated
  if (problemStatement.length > 60) {
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace > 20) return trimmed.substring(0, lastSpace) + '...';
    return trimmed + '...';
  }
  return trimmed;
}

// --- Thread Branching ---

// @cap-todo(ac:F-031/AC-4) Support thread branching with parent thread ID and divergence point

/**
 * Create a branched thread from an existing parent thread.
 * @param {Thread} parentThread - The thread to branch from
 * @param {Object} params - Same as createThread params (minus parentThreadId/divergencePoint)
 * @param {string} params.problemStatement - The divergent problem statement
 * @param {string} params.divergencePoint - Description of where/why the branch diverged
 * @param {string} [params.solutionShape]
 * @param {string[]} [params.boundaryDecisions]
 * @param {string[]} [params.featureIds]
 * @param {string} [params.name]
 * @returns {Thread}
 */
function branchThread(parentThread, params) {
  return createThread({
    ...params,
    parentThreadId: parentThread.id,
    divergencePoint: params.divergencePoint || null,
  });
}

// --- Topic Revisit Detection ---

// @cap-todo(ac:F-031/AC-3) Detect when a brainstorm session revisits a topic covered by an existing thread

/**
 * Compute keyword overlap between two keyword sets.
 * @param {string[]} keywordsA
 * @param {string[]} keywordsB
 * @returns {{ shared: string[], overlapRatio: number }}
 */
function computeKeywordOverlap(keywordsA, keywordsB) {
  const setB = new Set(keywordsB);
  const shared = keywordsA.filter(k => setB.has(k));
  const unionSize = new Set([...keywordsA, ...keywordsB]).size;
  const overlapRatio = unionSize > 0 ? shared.length / unionSize : 0;
  return { shared, overlapRatio };
}

/**
 * Detect threads that revisit a given topic.
 * Compares problem-space keywords and feature IDs against existing thread index.
 * @param {ThreadIndex} index - Current thread index
 * @param {Object} params
 * @param {string} params.problemStatement - New session's problem statement
 * @param {string[]} [params.featureIds] - Feature IDs referenced in new session
 * @param {string} [params.solutionShape] - Solution direction text
 * @param {number} [params.keywordThreshold] - Override keyword overlap threshold
 * @param {number} [params.minSharedKeywords] - Override minimum shared keywords
 * @returns {RevisitMatch[]} Matching threads sorted by relevance score descending
 */
function detectRevisits(index, params) {
  const {
    problemStatement,
    featureIds = [],
    solutionShape = '',
    keywordThreshold = REVISIT_KEYWORD_THRESHOLD,
    minSharedKeywords = REVISIT_MIN_SHARED_KEYWORDS,
  } = params;

  if (!index || !index.threads || index.threads.length === 0) return [];

  const newKeywords = extractKeywords([problemStatement, solutionShape].join(' '));
  if (newKeywords.length === 0 && featureIds.length === 0) return [];

  const newFeatureSet = new Set(featureIds);
  const matches = [];

  for (const entry of index.threads) {
    const { shared, overlapRatio } = computeKeywordOverlap(newKeywords, entry.keywords || []);
    const sharedFeatureIds = (entry.featureIds || []).filter(f => newFeatureSet.has(f));

    // Score: weighted combination of keyword overlap and feature ID overlap
    const keywordScore = overlapRatio;
    const featureScore = sharedFeatureIds.length > 0 ? 0.5 : 0;
    const score = keywordScore * 0.6 + featureScore * 0.4;

    const meetsKeywordThreshold = overlapRatio >= keywordThreshold && shared.length >= minSharedKeywords;
    const hasFeatureOverlap = sharedFeatureIds.length > 0;

    if (meetsKeywordThreshold || hasFeatureOverlap) {
      matches.push({
        threadId: entry.id,
        threadName: entry.name,
        keywordOverlap: shared.length,
        sharedKeywords: shared,
        sharedFeatureIds,
        score,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

// --- Thread Index Management ---

// @cap-todo(ac:F-031/AC-5) Store thread metadata in .cap/memory/thread-index.json

/**
 * Create an empty thread index.
 * @returns {ThreadIndex}
 */
function createEmptyIndex() {
  return {
    version: '1.0.0',
    threads: [],
  };
}

/**
 * Add a thread to the index.
 * @param {ThreadIndex} index - Current index (mutated in place)
 * @param {Thread} thread - Thread to add
 * @returns {ThreadIndex} The updated index
 */
function addToIndex(index, thread) {
  // Remove existing entry with same ID (idempotent upsert)
  index.threads = index.threads.filter(t => t.id !== thread.id);

  index.threads.push({
    id: thread.id,
    name: thread.name,
    timestamp: thread.timestamp,
    featureIds: thread.featureIds,
    parentThreadId: thread.parentThreadId,
    keywords: thread.keywords,
  });

  return index;
}

/**
 * Remove a thread from the index by ID.
 * @param {ThreadIndex} index
 * @param {string} threadId
 * @returns {ThreadIndex}
 */
function removeFromIndex(index, threadId) {
  index.threads = index.threads.filter(t => t.id !== threadId);
  return index;
}

// --- File I/O ---

// @cap-todo(ac:F-031/AC-6) Thread data shall be git-committable (not gitignored)
// @cap-decision Threads stored as individual JSON files — each thread is a single atomic file, enabling clean git diffs and minimal merge conflicts.

/**
 * Load the thread index from disk.
 * @param {string} projectRoot - Absolute path to project root
 * @returns {ThreadIndex}
 */
function loadIndex(projectRoot) {
  const indexPath = path.join(projectRoot, THREAD_INDEX_FILE);
  try {
    if (!fs.existsSync(indexPath)) return createEmptyIndex();
    const content = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(content);
    // Merge with defaults for forward compatibility
    return { ...createEmptyIndex(), ...parsed };
  } catch (_e) {
    return createEmptyIndex();
  }
}

/**
 * Save the thread index to disk.
 * @param {string} projectRoot - Absolute path to project root
 * @param {ThreadIndex} index
 */
function saveIndex(projectRoot, index) {
  const indexPath = path.join(projectRoot, THREAD_INDEX_FILE);
  const dir = path.dirname(indexPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // @cap-decision Sorted keys and 2-space indent for git-friendly diffs
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

/**
 * Load a single thread from disk.
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} threadId - Thread ID
 * @returns {Thread|null} Thread object or null if not found
 */
function loadThread(projectRoot, threadId) {
  const threadPath = path.join(projectRoot, THREADS_DIR, `${threadId}.json`);
  try {
    if (!fs.existsSync(threadPath)) return null;
    const content = fs.readFileSync(threadPath, 'utf8');
    return JSON.parse(content);
  } catch (_e) {
    return null;
  }
}

/**
 * Save a single thread to disk.
 * @param {string} projectRoot - Absolute path to project root
 * @param {Thread} thread
 */
function saveThread(projectRoot, thread) {
  const threadsDir = path.join(projectRoot, THREADS_DIR);
  if (!fs.existsSync(threadsDir)) fs.mkdirSync(threadsDir, { recursive: true });
  const threadPath = path.join(threadsDir, `${thread.id}.json`);
  fs.writeFileSync(threadPath, JSON.stringify(thread, null, 2) + '\n', 'utf8');
}

/**
 * Delete a thread from disk and remove from index.
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} threadId - Thread ID to delete
 * @returns {boolean} True if thread was deleted
 */
function deleteThread(projectRoot, threadId) {
  const threadPath = path.join(projectRoot, THREADS_DIR, `${threadId}.json`);
  const existed = fs.existsSync(threadPath);
  if (existed) fs.unlinkSync(threadPath);

  const index = loadIndex(projectRoot);
  removeFromIndex(index, threadId);
  saveIndex(projectRoot, index);

  return existed;
}

// --- High-Level Convenience Functions ---

/**
 * Persist a brainstorm thread: save thread file + update index.
 * Single call for the common case.
 * @param {string} projectRoot - Absolute path to project root
 * @param {Thread} thread - Thread to persist
 * @returns {{ thread: Thread, index: ThreadIndex }}
 */
function persistThread(projectRoot, thread) {
  saveThread(projectRoot, thread);
  const index = loadIndex(projectRoot);
  addToIndex(index, thread);
  saveIndex(projectRoot, index);
  return { thread, index };
}

// @cap-todo(ac:F-031/AC-7) cap-brainstormer shall check thread index at session start and surface relevant prior threads

/**
 * Check for relevant prior threads before starting a new brainstorm session.
 * Returns matching threads and their full data for the brainstormer agent to surface.
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} params
 * @param {string} params.problemStatement - The new session's problem statement
 * @param {string[]} [params.featureIds] - Feature IDs referenced
 * @param {string} [params.solutionShape] - Solution direction text
 * @returns {{ matches: RevisitMatch[], threads: Thread[] }} Matches with full thread data
 */
function checkPriorThreads(projectRoot, params) {
  const index = loadIndex(projectRoot);
  const matches = detectRevisits(index, params);

  // Load full thread data for each match
  const threads = [];
  for (const match of matches) {
    const thread = loadThread(projectRoot, match.threadId);
    if (thread) threads.push(thread);
  }

  return { matches, threads };
}

/**
 * List all threads, optionally filtered by feature ID.
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {string} [options.featureId] - Filter by feature ID
 * @returns {ThreadIndexEntry[]}
 */
function listThreads(projectRoot, options = {}) {
  const index = loadIndex(projectRoot);
  let threads = index.threads;

  if (options.featureId) {
    threads = threads.filter(t => t.featureIds && t.featureIds.includes(options.featureId));
  }

  // Sort by timestamp descending (most recent first)
  return [...threads].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

module.exports = {
  // Core
  createThread,
  branchThread,
  detectRevisits,
  extractKeywords,
  computeKeywordOverlap,
  deriveName,

  // Index management
  createEmptyIndex,
  addToIndex,
  removeFromIndex,

  // File I/O
  loadIndex,
  saveIndex,
  loadThread,
  saveThread,
  deleteThread,
  persistThread,

  // High-level
  checkPriorThreads,
  listThreads,

  // Constants (exposed for testing and configuration)
  THREADS_DIR,
  THREAD_INDEX_FILE,
  REVISIT_KEYWORD_THRESHOLD,
  REVISIT_MIN_SHARED_KEYWORDS,
  STOP_WORDS,

  // Internal (for testing)
  generateThreadId,
};
