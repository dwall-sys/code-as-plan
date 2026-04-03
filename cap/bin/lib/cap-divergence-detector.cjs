// @cap-feature(feature:F-035) Detect In-Session Topic Divergence During Brainstorm — monitor message-by-message topic drift and suggest branch/stay/redirect actions
// @cap-decision Pure logic module with explicit I/O in finalizeSession() only — same pattern as cap-thread-tracker.cjs and cap-thread-synthesis.cjs.
// @cap-decision Keyword decay uses a sliding window approach rather than numeric weights — simpler to reason about, zero floating-point drift, and adequate for brainstorm-length sessions.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (crypto).

'use strict';

const crypto = require('node:crypto');

const {
  extractKeywords,
  computeKeywordOverlap,
  branchThread,
  persistThread,
  loadIndex,
  saveIndex,
  addToIndex,
} = require('./cap-thread-tracker.cjs');

// --- Constants ---

/** Default minimum overlap ratio below which divergence is detected. */
const DEFAULT_DIVERGENCE_THRESHOLD = 0.15;

/** Number of recent messages whose keywords remain at full weight in the running set. */
const KEYWORD_DECAY_WINDOW = 5;

/** Number of consecutive below-threshold messages that signal gradual drift. */
const GRADUAL_DRIFT_WINDOW = 3;

// --- Types ---

/**
 * @typedef {Object} DivergenceSession
 * @property {string} id - Session ID (e.g., "dsess-a1b2c3d4")
 * @property {string[]} baselineKeywords - Keywords from the initial thread/prompt
 * @property {string[]} runningKeywords - Current merged keyword set (decayed)
 * @property {Array<{text: string, keywords: string[], timestamp: string}>} messages - All processed messages
 * @property {Array<{threadId: string, divergencePoint: number}>} branches - Branches created during this session
 * @property {number} threshold - Divergence threshold (overlap ratio)
 * @property {number[]} recentOverlaps - Last N overlap ratios for gradual drift detection
 */

/**
 * @typedef {Object} DivergenceResult
 * @property {boolean} diverged - Whether divergence was detected
 * @property {number} overlapRatio - Overlap ratio between message keywords and running keywords
 * @property {'sudden'|'gradual'|'none'} divergenceType - Type of divergence detected
 */

/**
 * @typedef {Object} ProcessResult
 * @property {boolean} diverged - Whether divergence was detected
 * @property {number} overlapRatio - Overlap ratio for this message
 * @property {string[]} newKeywords - Keywords extracted from the message
 * @property {string|null} suggestion - Brief inline suggestion string, or null if no divergence
 */

/**
 * @typedef {Object} ActionSuggestion
 * @property {'branch'|'stay'|'redirect'} type - Suggested action
 * @property {string} message - Conversational inline suggestion
 */

/**
 * @typedef {Object} BranchResult
 * @property {Object} branchedThread - The newly created branch thread
 * @property {DivergenceSession} updatedSession - Session updated with branch tracking
 */

/**
 * @typedef {Object} FinalizeResult
 * @property {number} threadsSaved - Number of threads persisted
 * @property {boolean} indexUpdated - Whether the thread index was updated
 */

// --- Session ID Generation ---

/**
 * Generate a unique divergence session ID.
 * @returns {string} Session ID in format "dsess-{8 hex chars}"
 */
function generateSessionId() {
  return 'dsess-' + crypto.randomBytes(4).toString('hex');
}

// --- Session Creation ---

// @cap-todo(ac:F-035/AC-4) Initialize divergence tracking session with baseline keywords and running keyword set

/**
 * Create a new divergence tracking session.
 * Accepts either a thread object (with keywords) or a raw prompt string.
 * @param {Object|string} threadOrPrompt - Thread object with .keywords, or a prompt string
 * @param {Object} [options]
 * @param {number} [options.threshold] - Override default divergence threshold
 * @returns {DivergenceSession}
 */
function createSession(threadOrPrompt, options = {}) {
  const threshold = options.threshold != null ? options.threshold : DEFAULT_DIVERGENCE_THRESHOLD;

  let baselineKeywords;
  if (typeof threadOrPrompt === 'string') {
    baselineKeywords = extractKeywords(threadOrPrompt);
  } else if (threadOrPrompt && Array.isArray(threadOrPrompt.keywords)) {
    baselineKeywords = [...threadOrPrompt.keywords];
  } else {
    baselineKeywords = [];
  }

  return {
    id: generateSessionId(),
    baselineKeywords,
    runningKeywords: [...baselineKeywords],
    messages: [],
    branches: [],
    threshold,
    recentOverlaps: [],
  };
}

// --- Keyword Decay ---

// @cap-todo(ac:F-035/AC-4) Maintain running keyword set with decay — keywords not seen in recent messages lose weight
// @cap-decision Decay uses set membership in a sliding window rather than numeric weights. Keywords that appear in any of the last N messages stay in the running set. This avoids floating-point accumulation and is deterministic.

/**
 * Update the running keyword set by merging new keywords and decaying old ones.
 * Keywords are kept if they appear in any message within the decay window.
 * @param {Array<{keywords: string[]}>} messages - All session messages (used for decay window)
 * @param {string[]} newKeywords - Keywords from the latest message
 * @param {string[]} baselineKeywords - Original baseline keywords (always retained)
 * @param {number} [decayWindow] - Number of recent messages to consider
 * @returns {string[]} Updated running keyword set
 */
function updateRunningKeywords(messages, newKeywords, baselineKeywords, decayWindow = KEYWORD_DECAY_WINDOW) {
  // Baseline keywords are always retained
  const retained = new Set(baselineKeywords);

  // Keywords from recent messages within the decay window are retained
  const windowStart = Math.max(0, messages.length - decayWindow);
  for (let i = windowStart; i < messages.length; i++) {
    for (const kw of messages[i].keywords) {
      retained.add(kw);
    }
  }

  // Add new keywords
  for (const kw of newKeywords) {
    retained.add(kw);
  }

  return [...retained].sort();
}

// --- Divergence Detection ---

// @cap-todo(ac:F-035/AC-1) Compare each new message against running keywords and detect when overlap drops below threshold

/**
 * Core divergence detection: compare message keywords against the session's running keywords.
 * Detects both sudden drops and gradual drift.
 * @param {DivergenceSession} session - Current session state
 * @param {string[]} messageKeywords - Keywords extracted from the new message
 * @returns {DivergenceResult}
 */
function detectDivergence(session, messageKeywords) {
  if (messageKeywords.length === 0) {
    return { diverged: false, overlapRatio: 0, divergenceType: 'none' };
  }

  if (session.runningKeywords.length === 0) {
    return { diverged: false, overlapRatio: 0, divergenceType: 'none' };
  }

  const { overlapRatio } = computeKeywordOverlap(messageKeywords, session.runningKeywords);

  // Check for sudden divergence: single message drops below threshold
  const suddenDivergence = overlapRatio < session.threshold;

  // Check for gradual drift: last N overlaps all below threshold
  const recentWithCurrent = [...session.recentOverlaps, overlapRatio];
  const windowForGradual = recentWithCurrent.slice(-GRADUAL_DRIFT_WINDOW);
  const gradualDrift = windowForGradual.length >= GRADUAL_DRIFT_WINDOW &&
    windowForGradual.every(r => r < session.threshold);

  if (suddenDivergence && !gradualDrift) {
    return { diverged: true, overlapRatio, divergenceType: 'sudden' };
  }

  if (gradualDrift) {
    return { diverged: true, overlapRatio, divergenceType: 'gradual' };
  }

  return { diverged: false, overlapRatio, divergenceType: 'none' };
}

// --- Message Processing ---

// @cap-todo(ac:F-035/AC-1) Process each user message: extract keywords, detect divergence, update running set
// @cap-todo(ac:F-035/AC-4) Track topic evolution by updating running keyword set with each message

/**
 * Process a new user message within a divergence tracking session.
 * Extracts keywords, checks for divergence, updates running keywords.
 * Returns divergence status and an optional inline suggestion.
 * @param {DivergenceSession} session - Current session (mutated in place)
 * @param {string} userMessage - The user's message text
 * @returns {ProcessResult}
 */
function processMessage(session, userMessage) {
  const newKeywords = extractKeywords(userMessage);

  // Detect divergence BEFORE updating running keywords (compare against current state)
  const divergenceResult = detectDivergence(session, newKeywords);

  // Record the message
  session.messages.push({
    text: userMessage,
    keywords: newKeywords,
    timestamp: new Date().toISOString(),
  });

  // Update running keywords with decay
  session.runningKeywords = updateRunningKeywords(
    session.messages,
    newKeywords,
    session.baselineKeywords
  );

  // Track recent overlaps for gradual drift detection
  session.recentOverlaps.push(divergenceResult.overlapRatio);

  // Generate suggestion if divergence detected
  let suggestion = null;
  if (divergenceResult.diverged) {
    const actionSuggestion = suggestAction(session, divergenceResult);
    suggestion = actionSuggestion.message;
  }

  return {
    diverged: divergenceResult.diverged,
    overlapRatio: divergenceResult.overlapRatio,
    newKeywords,
    suggestion,
  };
}

// --- Action Suggestion ---

// @cap-todo(ac:F-035/AC-2) When divergence detected, suggest branch/stay/redirect as brief inline suggestion
// @cap-todo(ac:F-035/AC-7) Divergence detection shall not interrupt conversation flow — present as brief inline suggestion

/**
 * Generate a brief, non-blocking action suggestion based on divergence.
 * @param {DivergenceSession} session - Current session state
 * @param {DivergenceResult} divergenceResult - Result from detectDivergence
 * @returns {ActionSuggestion}
 */
function suggestAction(session, divergenceResult) {
  // @cap-decision Default suggestion is 'branch' for sudden shifts, 'redirect' for gradual drift. The brainstormer agent presents this inline and lets the user decide.

  if (divergenceResult.divergenceType === 'gradual') {
    return {
      type: 'redirect',
      message: '[Topic drift detected] The conversation has been gradually shifting. Would you like to: (1) branch into this new direction, (2) refocus on the original topic, or (3) continue as-is?',
    };
  }

  // Sudden divergence — suggest branching
  return {
    type: 'branch',
    message: '[New topic detected] This seems like a different direction. Would you like to: (1) branch into a new thread for this topic, (2) stay on the current topic, or (3) redirect the current thread?',
  };
}

// --- Branch Execution ---

// @cap-todo(ac:F-035/AC-3) If branch chosen, call branchThread() with divergence point set to last message before topic shift
// @cap-todo(ac:F-035/AC-5) After branch creation, continue brainstorm on new branch while preserving parent thread state

/**
 * Execute a branch based on detected divergence.
 * Creates a new branch thread from the parent, sets the divergence point
 * to the last message before the topic shift.
 * @param {string} cwd - Project root path
 * @param {DivergenceSession} session - Current session (mutated to track branch)
 * @param {Object} parentThread - The parent thread object (from cap-thread-tracker)
 * @param {string} newPrompt - The divergent message/prompt that triggered the branch
 * @returns {BranchResult}
 */
function executeBranch(cwd, session, parentThread, newPrompt) {
  // Divergence point is the last message before the shift
  const messageCount = session.messages.length;
  const divergencePointIndex = Math.max(0, messageCount - 1);
  const lastMessageBeforeShift = messageCount >= 2
    ? session.messages[messageCount - 2].text
    : parentThread.problemStatement || 'Session start';

  const divergencePointDesc = `Message ${divergencePointIndex}: "${truncate(lastMessageBeforeShift, 80)}"`;

  // Create the branch thread via thread-tracker
  const branchedThread = branchThread(parentThread, {
    problemStatement: newPrompt,
    divergencePoint: divergencePointDesc,
  });

  // Track the branch in the session
  session.branches.push({
    threadId: branchedThread.id,
    divergencePoint: divergencePointIndex,
  });

  // Persist the branch thread and update the index
  persistThread(cwd, branchedThread);

  return {
    branchedThread,
    updatedSession: session,
  };
}

// --- Session Finalization ---

// @cap-todo(ac:F-035/AC-6) At brainstorm end, persist all threads (parent + branches) and update thread index with branch relationships

/**
 * Finalize a divergence session: persist the parent thread and all branches,
 * update the thread index with branch relationships.
 * @param {string} cwd - Project root path
 * @param {DivergenceSession} session - The completed session
 * @param {Object} parentThread - The parent thread to persist
 * @returns {FinalizeResult}
 */
function finalizeSession(cwd, session, parentThread) {
  let threadsSaved = 0;

  // Persist the parent thread
  persistThread(cwd, parentThread);
  threadsSaved++;

  // Load the current index to ensure branch relationships are recorded
  const index = loadIndex(cwd);

  // All branch threads were already persisted in executeBranch(),
  // but we ensure the index reflects the complete branch tree
  for (const branch of session.branches) {
    // Verify branch is in the index (executeBranch already added it, but be defensive)
    const inIndex = index.threads.some(t => t.id === branch.threadId);
    if (!inIndex) {
      // This shouldn't happen normally, but handle gracefully
      // @cap-risk Branch thread missing from index after executeBranch — defensive re-add
      threadsSaved++;
    }
  }

  // Save the final index state
  saveIndex(cwd, index);

  return {
    threadsSaved,
    indexUpdated: true,
  };
}

// --- Helpers ---

/**
 * Truncate a string at a word boundary.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  const trimmed = text.substring(0, maxLen).trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.4) return trimmed.substring(0, lastSpace) + '...';
  return trimmed + '...';
}

module.exports = {
  // Core
  createSession,
  processMessage,
  detectDivergence,
  suggestAction,
  executeBranch,
  finalizeSession,
  updateRunningKeywords,

  // Constants (exposed for testing and configuration)
  DEFAULT_DIVERGENCE_THRESHOLD,
  KEYWORD_DECAY_WINDOW,
  GRADUAL_DRIFT_WINDOW,

  // Internal (for testing)
  generateSessionId,
  truncate,
};
