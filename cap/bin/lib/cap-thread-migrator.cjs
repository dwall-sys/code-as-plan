// @cap-feature(feature:F-031) Thread migration — extract brainstorm sessions from past JSONL logs and persist as conversation threads
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Patterns that indicate a decision or conclusion in assistant text. */
const DECISION_PATTERNS = [
  /(?:entscheid|decided|decision|chose|approach|fazit|ergebnis)/i,
  /(?:empfehl|recommend|suggestion|vorschlag)/i,
  /(?:conclusion|zusammenfassung|summary|erkenntnis)/i,
  /(?:pros?\s*(?:&|und|and)\s*cons?|vorteile.*nachteile)/i,
  /(?:the (?:problem|issue|root cause|fix|solution|workaround))/i,
  /(?:wir (?:haben|sollten|werden|nutzen|verwenden))/i,
  /(?:best(?:er)?\s*(?:approach|ansatz|weg|practice))/i,
];

/** Patterns that indicate a brainstorm-relevant session (not just any session). */
const BRAINSTORM_MARKERS = [
  '/cap:brainstorm', '/gsd:brainstorm',
  'BRAINSTORM OUTPUT', '=== FEATURE:',
  'Feature Map', 'FEATURE-MAP',
  'acceptance criteria', 'Akzeptanzkriterien',
];

/** Max characters for extracted fields to keep threads compact. */
const MAX_PROBLEM = 300;
const MAX_SOLUTION = 500;
const MAX_DECISION = 200;
const MAX_DECISIONS = 8;

/**
 * Migrate past brainstorm sessions to conversation threads.
 * Extracts problem statements, solution approaches, and key decisions
 * from JSONL session logs. Idempotent — skips if threads already exist.
 *
 * @param {string} cwd - Project root
 * @returns {{ migrated: number, totalSessions: number, reason?: string }}
 */
function migrateBrainstormSessions(cwd) {
  const tracker = require('./cap-thread-tracker.cjs');
  const extract = require('./cap-session-extract.cjs');

  // Skip if threads already exist
  const index = tracker.loadIndex(cwd);
  if (index.threads.length > 0) {
    return { migrated: 0, totalSessions: 0, reason: 'threads already exist' };
  }

  const projectDir = extract.getProjectDir(cwd);
  if (!projectDir) {
    return { migrated: 0, totalSessions: 0, reason: 'no session directory' };
  }

  const sessionFiles = extract.getSessionFiles(projectDir);
  if (sessionFiles.length === 0) {
    return { migrated: 0, totalSessions: 0, reason: 'no sessions' };
  }

  let migrated = 0;
  for (const sf of sessionFiles) {
    try {
      const result = _extractSessionContext(sf.path);
      if (!result) continue;

      const thread = tracker.createThread({
        problemStatement: result.problemStatement,
        solutionShape: result.solutionShape,
        boundaryDecisions: result.boundaryDecisions,
        featureIds: result.featureIds,
      });
      if (sf.date) thread.timestamp = sf.date;
      tracker.persistThread(cwd, thread);
      migrated++;
    } catch { /* skip unparseable sessions */ }
  }

  return { migrated, totalSessions: sessionFiles.length };
}

/**
 * Extract meaningful context from a single session JSONL file.
 * Returns null if the session doesn't contain brainstorm-relevant content.
 *
 * @param {string} filePath - Absolute path to JSONL file
 * @returns {{ problemStatement: string, solutionShape: string, boundaryDecisions: string[], featureIds: string[] } | null}
 */
function _extractSessionContext(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  // Check if this session has brainstorm-relevant content
  let isBrainstorm = false;
  const messages = [];

  for (const l of lines) {
    try {
      const msg = JSON.parse(l);
      const text = _extractText(msg);
      if (!text || text.length < 10) continue;

      if (!isBrainstorm) {
        isBrainstorm = BRAINSTORM_MARKERS.some(m => text.includes(m));
      }

      messages.push({ type: msg.type, text });
    } catch { /* skip */ }
  }

  if (!isBrainstorm || messages.length < 3) return null;

  // Require at least 2 substantive user messages (not just command invocations)
  const substantiveUserMsgs = messages.filter(m =>
    m.type === 'user' && m.text.length > 15 &&
    !m.text.startsWith('/') && !/^<command-message>/.test(m.text.trim())
  );
  if (substantiveUserMsgs.length < 2) return null;

  // Extract problem statement from first substantive user messages
  const problemStatement = _extractProblemStatement(messages);

  // Extract feature IDs from all messages
  const featureIds = _extractFeatureIds(messages);

  // Extract solution shape from assistant conclusions/recommendations
  const solutionShape = _extractSolutionShape(messages);

  // Extract boundary decisions
  const boundaryDecisions = _extractDecisions(messages);

  // Skip sessions with no meaningful content
  if (!problemStatement && featureIds.length === 0 && !solutionShape) return null;

  return {
    problemStatement: problemStatement || 'Brainstorm session',
    solutionShape,
    boundaryDecisions,
    featureIds,
  };
}

/**
 * Extract the core problem statement from early user messages.
 * Skips command invocations and short confirmations.
 */
function _extractProblemStatement(messages) {
  const userMessages = messages.filter(m => m.type === 'user');
  const parts = [];

  for (const msg of userMessages) {
    const trimmed = msg.text.trim();
    // Skip commands, short confirmations, interruptions, XML wrappers, and internal Claude context
    if (trimmed.startsWith('/') || trimmed.length < 15) continue;
    if (/^<(?:command-message|command-name|local-command-caveat|context|objective|system-reminder)>/.test(trimmed)) continue;
    if (/^<!--/.test(trimmed)) continue;
    if (/^#\s*\/(?:cap|gsd):/.test(trimmed)) continue;
    if (/^Unknown skill:/.test(trimmed)) continue;
    if (/^(ja|yes|ok|nein|no|weiter|continue|gut|perfect|danke|mach|schau)\b/i.test(trimmed)) continue;
    if (trimmed.includes('[Request interrupted')) continue;

    parts.push(msg.text.trim());
    // Take first 2-3 substantive user messages to capture the problem
    if (parts.length >= 3) break;
  }

  if (parts.length === 0) return '';

  const combined = parts.join(' | ');
  return combined.length > MAX_PROBLEM ? combined.substring(0, MAX_PROBLEM).replace(/\s\S*$/, '...') : combined;
}

/**
 * Extract solution shape from assistant messages containing decisions/recommendations.
 * Looks for the most informative assistant message that summarizes the approach.
 */
function _extractSolutionShape(messages) {
  const candidates = [];

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    if (msg.text.length < 80) continue;

    const hasDecision = DECISION_PATTERNS.some(p => p.test(msg.text));
    if (!hasDecision) continue;

    // Score by relevance: longer + more decision patterns = better
    const patternCount = DECISION_PATTERNS.filter(p => p.test(msg.text)).length;
    candidates.push({
      text: msg.text,
      score: patternCount * 10 + Math.min(msg.text.length / 100, 5),
    });
  }

  if (candidates.length === 0) return '';

  // Take the highest-scoring candidate
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0].text;

  // Extract the most relevant paragraph (first one with a decision pattern)
  const paragraphs = best.split(/\n\n+/);
  for (const p of paragraphs) {
    if (p.length > 40 && DECISION_PATTERNS.some(pat => pat.test(p))) {
      const trimmed = p.replace(/^#+\s*/, '').trim();
      return trimmed.length > MAX_SOLUTION ? trimmed.substring(0, MAX_SOLUTION).replace(/\s\S*$/, '...') : trimmed;
    }
  }

  // Fallback: first 500 chars of best candidate
  return best.length > MAX_SOLUTION ? best.substring(0, MAX_SOLUTION).replace(/\s\S*$/, '...') : best;
}

/**
 * Extract key decisions/conclusions from assistant messages.
 * Returns compact one-line summaries.
 */
function _extractDecisions(messages) {
  const decisions = [];
  const seen = new Set();

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    if (msg.text.length < 50) continue;

    // Look for bullet points or numbered lists that state decisions
    const bulletMatches = msg.text.match(/^[\s]*[-*]\s+\*\*[^*]+\*\*[^*\n]*/gm) || [];
    for (const bullet of bulletMatches) {
      const clean = bullet.replace(/^[\s]*[-*]\s+/, '').replace(/\*\*/g, '').trim();
      if (clean.length > 20 && clean.length < MAX_DECISION && !seen.has(clean)) {
        seen.add(clean);
        decisions.push(clean);
      }
      if (decisions.length >= MAX_DECISIONS) break;
    }

    // Also look for "Fazit:", "Empfehlung:", "Decision:" lines
    const labelMatches = msg.text.match(/^(?:Fazit|Ergebnis|Empfehlung|Decision|Conclusion|Approach|Ansatz)\s*:\s*.+/gim) || [];
    for (const label of labelMatches) {
      const clean = label.trim();
      if (clean.length > 15 && clean.length < MAX_DECISION && !seen.has(clean)) {
        seen.add(clean);
        decisions.push(clean);
      }
      if (decisions.length >= MAX_DECISIONS) break;
    }

    if (decisions.length >= MAX_DECISIONS) break;
  }

  return decisions;
}

/**
 * Extract unique feature IDs from all messages.
 */
function _extractFeatureIds(messages) {
  const ids = new Set();
  for (const msg of messages) {
    const matches = msg.text.match(/F-\d{3}/g);
    if (matches) matches.forEach(id => ids.add(id));
  }
  return [...ids];
}

/**
 * Extract text content from a JSONL message object.
 * @param {Object} msg
 * @returns {string}
 */
function _extractText(msg) {
  const content = msg.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
  }
  return '';
}

module.exports = {
  migrateBrainstormSessions,
  // Exposed for testing
  _extractSessionContext,
  _extractProblemStatement,
  _extractSolutionShape,
  _extractDecisions,
  _extractFeatureIds,
  _extractText,
};
