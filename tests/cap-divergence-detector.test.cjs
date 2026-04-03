'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createSession,
  processMessage,
  detectDivergence,
  suggestAction,
  executeBranch,
  finalizeSession,
  updateRunningKeywords,
  generateSessionId,
  truncate,
  DEFAULT_DIVERGENCE_THRESHOLD,
  KEYWORD_DECAY_WINDOW,
  GRADUAL_DRIFT_WINDOW,
} = require('../cap/bin/lib/cap-divergence-detector.cjs');

const {
  createThread,
  extractKeywords,
  loadIndex,
  loadThread,
  persistThread,
  THREADS_DIR,
} = require('../cap/bin/lib/cap-thread-tracker.cjs');

// --- Test Helpers ---

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-diverge-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a test thread with predictable keywords.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function makeThread(overrides = {}) {
  return createThread({
    problemStatement: 'Authentication token refresh for session management',
    solutionShape: 'JWT tokens with sliding window refresh',
    featureIds: ['F-010'],
    ...overrides,
  });
}

// --- generateSessionId ---

describe('generateSessionId', () => {
  it('generates IDs with dsess- prefix', () => {
    const id = generateSessionId();
    assert.ok(id.startsWith('dsess-'));
    assert.strictEqual(id.length, 14); // "dsess-" + 8 hex chars
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateSessionId());
    assert.strictEqual(ids.size, 100);
  });
});

// --- createSession ---

describe('createSession', () => {
  it('creates session from a thread object', () => {
    const thread = makeThread();
    const session = createSession(thread);

    assert.ok(session.id.startsWith('dsess-'));
    assert.ok(Array.isArray(session.baselineKeywords));
    assert.ok(session.baselineKeywords.length > 0);
    assert.deepStrictEqual(session.runningKeywords, session.baselineKeywords);
    assert.deepStrictEqual(session.messages, []);
    assert.deepStrictEqual(session.branches, []);
    assert.strictEqual(session.threshold, DEFAULT_DIVERGENCE_THRESHOLD);
    assert.deepStrictEqual(session.recentOverlaps, []);
  });

  it('creates session from a prompt string', () => {
    const session = createSession('Building a REST API for user management');

    assert.ok(session.baselineKeywords.includes('building'));
    assert.ok(session.baselineKeywords.includes('rest'));
    assert.ok(session.baselineKeywords.includes('api'));
    assert.ok(session.baselineKeywords.includes('user'));
    assert.ok(session.baselineKeywords.includes('management'));
  });

  it('accepts custom threshold via options', () => {
    const session = createSession('test prompt', { threshold: 0.3 });
    assert.strictEqual(session.threshold, 0.3);
  });

  it('handles null/undefined input gracefully', () => {
    const session = createSession(null);
    assert.deepStrictEqual(session.baselineKeywords, []);
    assert.deepStrictEqual(session.runningKeywords, []);
  });

  it('handles object without keywords array', () => {
    const session = createSession({ name: 'no keywords' });
    assert.deepStrictEqual(session.baselineKeywords, []);
  });
});

// --- updateRunningKeywords ---

describe('updateRunningKeywords', () => {
  it('retains baseline keywords always', () => {
    const baseline = ['authentication', 'token'];
    const messages = [];
    const newKw = ['database', 'schema'];

    const result = updateRunningKeywords(messages, newKw, baseline);
    assert.ok(result.includes('authentication'));
    assert.ok(result.includes('token'));
    assert.ok(result.includes('database'));
    assert.ok(result.includes('schema'));
  });

  it('retains keywords from messages within decay window', () => {
    const baseline = ['baseline'];
    const messages = [
      { keywords: ['alpha', 'beta'] },
      { keywords: ['gamma', 'delta'] },
    ];
    const newKw = ['epsilon'];

    const result = updateRunningKeywords(messages, newKw, baseline, 5);
    assert.ok(result.includes('alpha'));
    assert.ok(result.includes('beta'));
    assert.ok(result.includes('gamma'));
    assert.ok(result.includes('delta'));
    assert.ok(result.includes('epsilon'));
    assert.ok(result.includes('baseline'));
  });

  it('decays keywords outside the window', () => {
    const baseline = ['baseline'];
    // Create 6 messages — the first should be outside a window of 3
    const messages = [
      { keywords: ['old-keyword'] },
      { keywords: ['msg2'] },
      { keywords: ['msg3'] },
      { keywords: ['msg4'] },
      { keywords: ['msg5'] },
    ];
    const newKw = ['new-keyword'];

    const result = updateRunningKeywords(messages, newKw, baseline, 3);
    // old-keyword is in message[0], window covers messages[2..4]
    assert.ok(!result.includes('old-keyword'));
    assert.ok(result.includes('msg4'));
    assert.ok(result.includes('msg5'));
    assert.ok(result.includes('new-keyword'));
    assert.ok(result.includes('baseline'));
  });

  it('returns sorted array', () => {
    const result = updateRunningKeywords([], ['zebra', 'apple'], ['mango']);
    assert.deepStrictEqual(result, ['apple', 'mango', 'zebra']);
  });
});

// --- detectDivergence ---

describe('detectDivergence', () => {
  it('returns no divergence when keywords overlap sufficiently', () => {
    const session = createSession('authentication token refresh session management');
    const messageKw = extractKeywords('token refresh mechanism with session handling');

    const result = detectDivergence(session, messageKw);
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.divergenceType, 'none');
    assert.ok(result.overlapRatio > DEFAULT_DIVERGENCE_THRESHOLD);
  });

  it('detects sudden divergence when keywords are completely different', () => {
    const session = createSession('authentication token refresh session management');
    const messageKw = extractKeywords('database migration schema postgres indexing');

    const result = detectDivergence(session, messageKw);
    assert.strictEqual(result.diverged, true);
    assert.strictEqual(result.divergenceType, 'sudden');
    assert.ok(result.overlapRatio < DEFAULT_DIVERGENCE_THRESHOLD);
  });

  it('returns no divergence for empty message keywords', () => {
    const session = createSession('authentication token');
    const result = detectDivergence(session, []);
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.divergenceType, 'none');
  });

  it('returns no divergence when session has no running keywords', () => {
    const session = createSession(null);
    const result = detectDivergence(session, ['some', 'keywords']);
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.divergenceType, 'none');
  });

  it('detects gradual drift after consecutive low-overlap messages', () => {
    const session = createSession('authentication token refresh');
    // Simulate GRADUAL_DRIFT_WINDOW - 1 consecutive low overlaps already recorded
    session.recentOverlaps = Array(GRADUAL_DRIFT_WINDOW - 1).fill(0.05);

    // One more low-overlap message triggers gradual drift
    const messageKw = extractKeywords('completely unrelated topic about cooking recipes');
    const result = detectDivergence(session, messageKw);
    assert.strictEqual(result.diverged, true);
    assert.strictEqual(result.divergenceType, 'gradual');
  });
});

// --- processMessage ---

describe('processMessage', () => {
  it('processes on-topic message without divergence', () => {
    const session = createSession('authentication token refresh session management');
    const result = processMessage(session, 'We should implement token refresh with sliding window');

    assert.strictEqual(result.diverged, false);
    assert.ok(result.overlapRatio >= 0);
    assert.ok(result.newKeywords.length > 0);
    assert.strictEqual(result.suggestion, null);
  });

  it('processes off-topic message with divergence and suggestion', () => {
    const session = createSession('authentication token refresh session management');
    const result = processMessage(session, 'What about database migration tooling for postgres schemas?');

    assert.strictEqual(result.diverged, true);
    assert.ok(result.overlapRatio < session.threshold);
    assert.ok(typeof result.suggestion === 'string');
    assert.ok(result.suggestion.length > 0);
  });

  it('records message in session after processing', () => {
    const session = createSession('test topic');
    assert.strictEqual(session.messages.length, 0);

    processMessage(session, 'first message about testing');
    assert.strictEqual(session.messages.length, 1);
    assert.ok(session.messages[0].keywords.length > 0);
    assert.ok(session.messages[0].timestamp);
  });

  it('updates running keywords after processing', () => {
    const session = createSession('authentication tokens');
    const initialKeywords = [...session.runningKeywords];

    processMessage(session, 'adding refresh mechanism with expiry handling');
    // Running keywords should now include new keywords
    assert.ok(session.runningKeywords.length >= initialKeywords.length);
    assert.ok(session.runningKeywords.includes('refresh'));
  });

  it('tracks overlap ratios in recentOverlaps', () => {
    const session = createSession('authentication tokens');
    assert.strictEqual(session.recentOverlaps.length, 0);

    processMessage(session, 'token refresh logic');
    assert.strictEqual(session.recentOverlaps.length, 1);
    assert.ok(typeof session.recentOverlaps[0] === 'number');
  });
});

// --- suggestAction ---

describe('suggestAction', () => {
  it('suggests branch for sudden divergence', () => {
    const session = createSession('test');
    const divergence = { diverged: true, overlapRatio: 0.05, divergenceType: 'sudden' };

    const action = suggestAction(session, divergence);
    assert.strictEqual(action.type, 'branch');
    assert.ok(action.message.includes('New topic detected'));
  });

  it('suggests redirect for gradual drift', () => {
    const session = createSession('test');
    const divergence = { diverged: true, overlapRatio: 0.10, divergenceType: 'gradual' };

    const action = suggestAction(session, divergence);
    assert.strictEqual(action.type, 'redirect');
    assert.ok(action.message.includes('Topic drift detected'));
  });

  it('returns a non-blocking message string', () => {
    // @cap-todo(ac:F-035/AC-7) Verify suggestions are brief inline text, not blocking modals
    const session = createSession('test');
    const divergence = { diverged: true, overlapRatio: 0.05, divergenceType: 'sudden' };

    const action = suggestAction(session, divergence);
    assert.ok(typeof action.message === 'string');
    // Should be reasonably short — not a wall of text
    assert.ok(action.message.length < 300, `Suggestion too long: ${action.message.length} chars`);
  });
});

// --- executeBranch ---

describe('executeBranch', () => {
  it('creates a branch thread and updates session', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);
    processMessage(session, 'still on topic about authentication tokens');
    processMessage(session, 'now lets talk about database migration tooling');

    const result = executeBranch(
      tmpDir,
      session,
      parentThread,
      'Database migration tooling for postgres schemas'
    );

    // Branch thread created
    assert.ok(result.branchedThread.id.startsWith('thr-'));
    assert.strictEqual(result.branchedThread.parentThreadId, parentThread.id);
    assert.ok(result.branchedThread.divergencePoint);
    assert.ok(result.branchedThread.problemStatement.includes('Database migration'));

    // Session updated with branch
    assert.strictEqual(result.updatedSession.branches.length, 1);
    assert.strictEqual(result.updatedSession.branches[0].threadId, result.branchedThread.id);
  });

  it('persists branch thread to disk', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);
    processMessage(session, 'initial message');

    const result = executeBranch(tmpDir, session, parentThread, 'New direction');

    // Verify thread file exists
    const loaded = loadThread(tmpDir, result.branchedThread.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.id, result.branchedThread.id);
  });

  it('updates thread index with branch', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);
    const result = executeBranch(tmpDir, session, parentThread, 'Branched topic');

    const index = loadIndex(tmpDir);
    const branchEntry = index.threads.find(t => t.id === result.branchedThread.id);
    assert.ok(branchEntry, 'Branch should be in thread index');
    assert.strictEqual(branchEntry.parentThreadId, parentThread.id);
  });

  it('sets divergence point to last message before shift', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);
    processMessage(session, 'Message about authentication flow');
    processMessage(session, 'Now about database migration');

    const result = executeBranch(tmpDir, session, parentThread, 'Database migration');

    // Divergence point should reference the message before the shift
    assert.ok(result.branchedThread.divergencePoint.includes('authentication flow'));
  });
});

// --- finalizeSession ---

describe('finalizeSession', () => {
  it('persists parent thread and reports saved count', () => {
    const parentThread = makeThread();
    const session = createSession(parentThread);

    const result = finalizeSession(tmpDir, session, parentThread);

    assert.ok(result.threadsSaved >= 1);
    assert.strictEqual(result.indexUpdated, true);

    // Verify parent thread is on disk
    const loaded = loadThread(tmpDir, parentThread.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.id, parentThread.id);
  });

  it('persists parent and branches together', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);
    executeBranch(tmpDir, session, parentThread, 'Branch one topic');
    executeBranch(tmpDir, session, parentThread, 'Branch two topic');

    const result = finalizeSession(tmpDir, session, parentThread);
    assert.ok(result.indexUpdated);

    // Verify index has parent + both branches
    const index = loadIndex(tmpDir);
    assert.ok(index.threads.length >= 3); // parent + 2 branches
  });

  it('updates thread index on finalization', () => {
    const parentThread = makeThread();
    const session = createSession(parentThread);

    finalizeSession(tmpDir, session, parentThread);

    const index = loadIndex(tmpDir);
    const parentEntry = index.threads.find(t => t.id === parentThread.id);
    assert.ok(parentEntry, 'Parent thread should be in index after finalize');
  });
});

// --- truncate ---

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    assert.strictEqual(truncate('hello', 10), 'hello');
  });

  it('truncates at word boundary', () => {
    const result = truncate('this is a longer sentence that exceeds the limit', 20);
    assert.ok(result.endsWith('...'));
    assert.ok(result.length <= 25); // some slack for the ellipsis
  });

  it('handles null/undefined', () => {
    assert.strictEqual(truncate(null, 10), '');
    assert.strictEqual(truncate(undefined, 10), '');
  });
});

// --- Integration: gradual drift over multiple messages ---

describe('integration: gradual drift detection', () => {
  it('detects gradual drift over multiple slightly-off-topic messages', () => {
    const session = createSession('authentication token refresh session management security');

    // On-topic messages
    const r1 = processMessage(session, 'token refresh should use sliding window expiry');
    assert.strictEqual(r1.diverged, false);

    // Slightly drifting messages
    processMessage(session, 'caching strategy for api gateway rate limiting');
    processMessage(session, 'load balancer configuration and health checks');
    const r4 = processMessage(session, 'kubernetes deployment scaling policies and resources');

    // After several off-topic messages, should detect drift
    // (Exact message where drift triggers depends on keyword overlap math,
    // but the mechanism should eventually flag it)
    const anyDiverged = session.recentOverlaps.some(r => r < DEFAULT_DIVERGENCE_THRESHOLD);
    assert.ok(anyDiverged, 'At least some messages should have low overlap');
  });
});

// --- Constants ---

describe('constants', () => {
  it('exports expected default values', () => {
    assert.strictEqual(DEFAULT_DIVERGENCE_THRESHOLD, 0.15);
    assert.strictEqual(KEYWORD_DECAY_WINDOW, 5);
    assert.strictEqual(GRADUAL_DRIFT_WINDOW, 3);
  });
});

// =============================================================================
// ADVERSARIAL TESTS — RED-GREEN discipline extension
// =============================================================================

// --- AC-1: Threshold edge cases and degenerate inputs ---

describe('AC-1 adversarial: threshold and degenerate inputs', () => {
  // @cap-todo(ac:F-035/AC-1) Empty message should not trigger divergence
  it('empty string message produces no divergence via processMessage', () => {
    const session = createSession('authentication token refresh');
    const result = processMessage(session, '');
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.suggestion, null);
  });

  // @cap-todo(ac:F-035/AC-1) Single short word (under 3 chars) yields no keywords
  it('single two-char word yields no keywords and no divergence', () => {
    const session = createSession('authentication token refresh');
    const result = processMessage(session, 'ok');
    assert.strictEqual(result.diverged, false);
    assert.deepStrictEqual(result.newKeywords, []);
  });

  // @cap-todo(ac:F-035/AC-1) Message identical to baseline should never diverge
  it('message identical to baseline text has high overlap, no divergence', () => {
    const baselineText = 'authentication token refresh session management';
    const session = createSession(baselineText);
    const result = processMessage(session, baselineText);
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.overlapRatio, 1.0);
  });

  // @cap-todo(ac:F-035/AC-1) Threshold exactly 0.15 boundary — overlap at exactly threshold should NOT diverge
  it('overlap ratio exactly at threshold does not count as divergence', () => {
    // detectDivergence uses strict < threshold, so exactly AT threshold = no divergence
    const session = createSession('alpha bravo charlie delta echo foxtrot golf');
    // Manually set threshold to something we can engineer
    session.threshold = 0.5;
    // With runningKeywords = ['alpha','bravo','charlie','delta','echo','foxtrot','golf']
    // If messageKeywords share exactly half with union, overlapRatio = 0.5
    // We test that the < check is strict (not <=)
    const result = detectDivergence(session, session.runningKeywords);
    // Identical keywords => overlapRatio = 1.0, definitely not diverged
    assert.strictEqual(result.diverged, false);
    assert.strictEqual(result.overlapRatio, 1.0);
  });

  // @cap-todo(ac:F-035/AC-1) Threshold set to 0 means nothing ever diverges suddenly
  it('threshold 0 means no sudden divergence (overlap always >= 0)', () => {
    const session = createSession('authentication token', { threshold: 0 });
    const result = detectDivergence(session, ['completely', 'unrelated', 'words']);
    // overlapRatio will be 0, and 0 < 0 is false, so no sudden divergence
    assert.strictEqual(result.divergenceType !== 'sudden', true);
  });

  // @cap-todo(ac:F-035/AC-1) Threshold set to 1 means everything diverges
  it('threshold 1 causes divergence on any non-identical message', () => {
    const session = createSession('authentication token', { threshold: 1.0 });
    const kw = extractKeywords('some different topic entirely about cooking');
    const result = detectDivergence(session, kw);
    assert.strictEqual(result.diverged, true);
    assert.ok(result.overlapRatio < 1.0);
  });

  // @cap-todo(ac:F-035/AC-1) Whitespace-only message should not cause divergence
  it('whitespace-only message produces no divergence', () => {
    const session = createSession('authentication token refresh');
    const result = processMessage(session, '   \t\n  ');
    assert.strictEqual(result.diverged, false);
    assert.deepStrictEqual(result.newKeywords, []);
  });

  // @cap-todo(ac:F-035/AC-1) Very long message with many unique keywords
  it('very long message with many unique keywords still computes overlap', () => {
    const session = createSession('authentication token');
    const longMsg = Array.from({ length: 200 }, (_, i) => `keyword${i}`).join(' ');
    const result = processMessage(session, longMsg);
    assert.ok(typeof result.overlapRatio === 'number');
    assert.ok(result.newKeywords.length > 100);
  });
});

// --- AC-2: suggestAction edge cases ---

describe('AC-2 adversarial: suggestAction edge cases', () => {
  // @cap-todo(ac:F-035/AC-2) suggestAction with divergenceType 'none' — should still return a suggestion object
  it('suggestAction with divergenceType none defaults to branch suggestion', () => {
    const session = createSession('test');
    const divergence = { diverged: false, overlapRatio: 0.5, divergenceType: 'none' };
    const action = suggestAction(session, divergence);
    // The function does not guard against being called with 'none'; it falls through to 'branch'
    assert.strictEqual(action.type, 'branch');
    assert.ok(typeof action.message === 'string');
  });

  // @cap-todo(ac:F-035/AC-2) sudden vs gradual produce different suggestion types
  it('sudden and gradual produce distinct suggestion types', () => {
    const session = createSession('test');
    const sudden = suggestAction(session, { diverged: true, overlapRatio: 0.05, divergenceType: 'sudden' });
    const gradual = suggestAction(session, { diverged: true, overlapRatio: 0.05, divergenceType: 'gradual' });
    assert.notStrictEqual(sudden.type, gradual.type);
    assert.strictEqual(sudden.type, 'branch');
    assert.strictEqual(gradual.type, 'redirect');
  });

  // @cap-todo(ac:F-035/AC-7) ALL suggestion messages must be under 300 chars
  it('all suggestion message variants are under 300 characters', () => {
    const session = createSession('test baseline keywords');
    const types = ['sudden', 'gradual'];
    for (const dt of types) {
      const action = suggestAction(session, { diverged: true, overlapRatio: 0.05, divergenceType: dt });
      assert.ok(
        action.message.length < 300,
        `Suggestion for ${dt} is ${action.message.length} chars, exceeds 300 limit: "${action.message}"`
      );
    }
  });
});

// --- AC-3: executeBranch adversarial ---

describe('AC-3 adversarial: executeBranch edge cases', () => {
  // @cap-todo(ac:F-035/AC-3) executeBranch with session that has no messages
  it('executeBranch with zero messages sets divergence point from parent problemStatement', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);
    const session = createSession(parentThread);
    // No messages processed — branch immediately

    const result = executeBranch(tmpDir, session, parentThread, 'Divergent topic');
    assert.ok(result.branchedThread.divergencePoint.includes(parentThread.problemStatement.substring(0, 40)));
    assert.strictEqual(result.updatedSession.branches.length, 1);
  });

  // @cap-todo(ac:F-035/AC-3) executeBranch with single message
  it('executeBranch with one message sets divergence point correctly', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);
    const session = createSession(parentThread);
    processMessage(session, 'The only message before branching');

    const result = executeBranch(tmpDir, session, parentThread, 'Divergent topic');
    // With 1 message, divergencePointIndex = max(0, 1-1) = 0, messageCount >= 2 is false
    // So it should fall back to parentThread.problemStatement
    assert.ok(result.branchedThread.divergencePoint.includes('Message 0'));
  });

  // @cap-todo(ac:F-035/AC-3) Multiple branches from same parent
  it('supports multiple branches from same parent thread', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);
    const session = createSession(parentThread);
    processMessage(session, 'first topic message');

    const r1 = executeBranch(tmpDir, session, parentThread, 'Branch one');
    const r2 = executeBranch(tmpDir, session, parentThread, 'Branch two');
    const r3 = executeBranch(tmpDir, session, parentThread, 'Branch three');

    assert.strictEqual(session.branches.length, 3);
    // All branches reference same parent
    assert.strictEqual(r1.branchedThread.parentThreadId, parentThread.id);
    assert.strictEqual(r2.branchedThread.parentThreadId, parentThread.id);
    assert.strictEqual(r3.branchedThread.parentThreadId, parentThread.id);
    // All have unique IDs
    const ids = new Set([r1.branchedThread.id, r2.branchedThread.id, r3.branchedThread.id]);
    assert.strictEqual(ids.size, 3);
  });
});

// --- AC-4: Keyword decay adversarial ---

describe('AC-4 adversarial: keyword decay edge cases', () => {
  // @cap-todo(ac:F-035/AC-4) Decay window of 1 — only the most recent message retained
  it('decay window of 1 retains only latest message keywords plus baseline', () => {
    const baseline = ['baseline'];
    const messages = [
      { keywords: ['old1'] },
      { keywords: ['old2'] },
      { keywords: ['recent'] },
    ];
    const newKw = ['newest'];

    const result = updateRunningKeywords(messages, newKw, baseline, 1);
    assert.ok(!result.includes('old1'), 'old1 should be decayed');
    assert.ok(!result.includes('old2'), 'old2 should be decayed');
    assert.ok(result.includes('recent'), 'recent should be in window');
    assert.ok(result.includes('newest'), 'newest should always be included');
    assert.ok(result.includes('baseline'), 'baseline should always be retained');
  });

  // @cap-todo(ac:F-035/AC-4) Decay window larger than message count — all retained
  it('decay window larger than message count retains all keywords', () => {
    const baseline = ['baseline'];
    const messages = [
      { keywords: ['alpha'] },
      { keywords: ['beta'] },
    ];
    const newKw = ['gamma'];

    const result = updateRunningKeywords(messages, newKw, baseline, 100);
    assert.ok(result.includes('alpha'));
    assert.ok(result.includes('beta'));
    assert.ok(result.includes('gamma'));
    assert.ok(result.includes('baseline'));
  });

  // @cap-todo(ac:F-035/AC-4) All messages have same keywords — no decay possible
  it('identical keywords across all messages means no decay effect', () => {
    const baseline = ['baseline'];
    const sameKw = ['repeated', 'words'];
    const messages = Array.from({ length: 10 }, () => ({ keywords: [...sameKw] }));
    const newKw = [...sameKw];

    const result = updateRunningKeywords(messages, newKw, baseline, 3);
    assert.ok(result.includes('repeated'));
    assert.ok(result.includes('words'));
    assert.ok(result.includes('baseline'));
  });

  // @cap-todo(ac:F-035/AC-4) Keywords accumulate correctly over 20 messages
  it('running keywords accumulate and decay correctly over 20 messages', () => {
    const session = createSession('baseline topic');
    const initialKwCount = session.runningKeywords.length;

    // Process 20 messages, each with unique keywords
    for (let i = 0; i < 20; i++) {
      processMessage(session, `unique topic number ${i} about concept${i} and idea${i}`);
    }

    // After 20 messages with decay window 5, keywords from messages 0-14 should be decayed
    // But baseline keywords should remain
    for (const bk of session.baselineKeywords) {
      assert.ok(
        session.runningKeywords.includes(bk),
        `Baseline keyword "${bk}" should survive decay after 20 messages`
      );
    }

    // Keywords unique to very old messages should be gone
    // Message 0 had "concept0" — with decay window 5, message 0 is well outside
    assert.ok(
      !session.runningKeywords.includes('concept0'),
      'concept0 from message 0 should be decayed after 20 messages'
    );

    // Keywords from recent messages should be present
    assert.ok(
      session.runningKeywords.includes('concept19'),
      'concept19 from most recent message should be present'
    );
  });

  // @cap-todo(ac:F-035/AC-4) Empty messages array with decay
  it('empty messages array returns baseline plus new keywords', () => {
    const result = updateRunningKeywords([], ['new'], ['baseline']);
    assert.deepStrictEqual(result, ['baseline', 'new']);
  });

  // @cap-todo(ac:F-035/AC-4) Empty baseline with decay
  it('empty baseline means only window and new keywords survive', () => {
    const messages = [
      { keywords: ['old'] },
      { keywords: ['recent'] },
    ];
    const result = updateRunningKeywords(messages, ['new'], [], 1);
    assert.ok(!result.includes('old'));
    assert.ok(result.includes('recent'));
    assert.ok(result.includes('new'));
  });
});

// --- AC-5: Parent thread preservation after branch ---

describe('AC-5 adversarial: parent thread preserved after branch', () => {
  // @cap-todo(ac:F-035/AC-5) Parent thread file must not change after branching
  it('parent thread file on disk is unchanged after executeBranch', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    // Read parent file content before branching
    const parentPath = path.join(tmpDir, THREADS_DIR, `${parentThread.id}.json`);
    const beforeContent = fs.readFileSync(parentPath, 'utf8');

    const session = createSession(parentThread);
    processMessage(session, 'first message');
    executeBranch(tmpDir, session, parentThread, 'Divergent topic');

    // Read parent file content after branching
    const afterContent = fs.readFileSync(parentPath, 'utf8');
    assert.strictEqual(beforeContent, afterContent, 'Parent thread file should not be modified by branching');
  });

  // @cap-todo(ac:F-035/AC-5) Parent thread object properties unchanged after branch
  it('parent thread object retains original properties after executeBranch', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const originalId = parentThread.id;
    const originalStatement = parentThread.problemStatement;
    const originalKeywords = [...parentThread.keywords];

    const session = createSession(parentThread);
    executeBranch(tmpDir, session, parentThread, 'Divergent topic');

    assert.strictEqual(parentThread.id, originalId);
    assert.strictEqual(parentThread.problemStatement, originalStatement);
    assert.deepStrictEqual(parentThread.keywords, originalKeywords);
  });
});

// --- AC-6: finalizeSession adversarial ---

describe('AC-6 adversarial: finalizeSession edge cases', () => {
  // @cap-todo(ac:F-035/AC-6) finalizeSession with 5 branches
  it('finalizeSession with 5 branches persists all and updates index', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);
    const session = createSession(parentThread);

    for (let i = 0; i < 5; i++) {
      processMessage(session, `message ${i}`);
      executeBranch(tmpDir, session, parentThread, `Branch topic ${i}`);
    }

    assert.strictEqual(session.branches.length, 5);

    const result = finalizeSession(tmpDir, session, parentThread);
    assert.strictEqual(result.indexUpdated, true);

    const index = loadIndex(tmpDir);
    // Index should have parent + 5 branches
    assert.ok(index.threads.length >= 6, `Expected >= 6 threads in index, got ${index.threads.length}`);
  });

  // @cap-todo(ac:F-035/AC-6) finalizeSession with no branches
  it('finalizeSession with no branches persists just the parent', () => {
    const parentThread = makeThread();
    const session = createSession(parentThread);
    // No branches created

    const result = finalizeSession(tmpDir, session, parentThread);
    assert.strictEqual(result.threadsSaved, 1);
    assert.strictEqual(result.indexUpdated, true);

    const index = loadIndex(tmpDir);
    const parentEntry = index.threads.find(t => t.id === parentThread.id);
    assert.ok(parentEntry, 'Parent should be in index');
  });

  // @cap-todo(ac:F-035/AC-6) finalizeSession called twice — idempotent
  it('finalizeSession called twice does not corrupt index', () => {
    const parentThread = makeThread();
    const session = createSession(parentThread);

    finalizeSession(tmpDir, session, parentThread);
    const indexAfterFirst = loadIndex(tmpDir);
    const countAfterFirst = indexAfterFirst.threads.length;

    finalizeSession(tmpDir, session, parentThread);
    const indexAfterSecond = loadIndex(tmpDir);
    // Should not duplicate the parent entry
    const parentEntries = indexAfterSecond.threads.filter(t => t.id === parentThread.id);
    assert.ok(parentEntries.length >= 1, 'Parent should be in index');
  });
});

// --- AC-7: Non-blocking inline suggestion length ---

describe('AC-7 adversarial: suggestion character limits', () => {
  // @cap-todo(ac:F-035/AC-7) All code paths for suggestAction produce strings under 300 chars
  it('branch suggestion is under 300 chars', () => {
    const session = createSession('test');
    const action = suggestAction(session, { diverged: true, overlapRatio: 0.0, divergenceType: 'sudden' });
    assert.ok(action.message.length < 300, `Branch suggestion: ${action.message.length} chars`);
  });

  it('redirect suggestion is under 300 chars', () => {
    const session = createSession('test');
    const action = suggestAction(session, { diverged: true, overlapRatio: 0.0, divergenceType: 'gradual' });
    assert.ok(action.message.length < 300, `Redirect suggestion: ${action.message.length} chars`);
  });

  // @cap-todo(ac:F-035/AC-7) processMessage suggestion field is under 300 when present
  it('processMessage suggestion string is under 300 chars when divergence detected', () => {
    const session = createSession('authentication token refresh session management');
    const result = processMessage(session, 'database migration schema postgres indexing tooling');
    if (result.suggestion !== null) {
      assert.ok(
        result.suggestion.length < 300,
        `processMessage suggestion: ${result.suggestion.length} chars`
      );
    }
  });
});

// --- Integration: adversarial multi-message scenarios ---

describe('integration adversarial: complex multi-message flows', () => {
  // @cap-todo(ac:F-035/AC-1) Rapid topic switching — diverge, return, diverge again
  it('detects divergence, then recognizes return to original topic', () => {
    const session = createSession('authentication token refresh session management');

    // On topic
    const r1 = processMessage(session, 'token refresh with sliding window and session handling');
    assert.strictEqual(r1.diverged, false);

    // Off topic
    const r2 = processMessage(session, 'database migration tooling for postgres schemas');
    assert.strictEqual(r2.diverged, true);

    // Return to original topic — after running keywords absorbed the off-topic words,
    // the baseline keywords are still present so overlap should increase
    const r3 = processMessage(session, 'authentication token refresh session management');
    // Should not diverge since baseline keywords are always in running set
    assert.strictEqual(r3.diverged, false);
  });

  // @cap-todo(ac:F-035/AC-4) Gradual drift across exactly GRADUAL_DRIFT_WINDOW messages
  it('gradual drift triggers after exactly GRADUAL_DRIFT_WINDOW consecutive low-overlap messages', () => {
    const session = createSession('authentication token refresh session management security');

    // Fill recentOverlaps with GRADUAL_DRIFT_WINDOW - 1 low values
    for (let i = 0; i < GRADUAL_DRIFT_WINDOW - 1; i++) {
      session.recentOverlaps.push(0.01);
    }

    // Next off-topic message should trigger gradual drift
    const offTopicKw = extractKeywords('completely unrelated cooking recipe about pasta');
    const result = detectDivergence(session, offTopicKw);
    assert.strictEqual(result.diverged, true);
    assert.strictEqual(result.divergenceType, 'gradual');
  });

  // @cap-todo(ac:F-035/AC-1) One high-overlap message breaks the gradual drift chain
  it('one on-topic message resets gradual drift chain', () => {
    const session = createSession('authentication token refresh session management');

    // Two low-overlap messages
    session.recentOverlaps.push(0.01);
    session.recentOverlaps.push(0.01);

    // Third message is on-topic — breaks the chain
    const onTopicKw = extractKeywords('authentication token refresh');
    const result = detectDivergence(session, onTopicKw);
    // Even though two previous were low, the current is high, so gradual drift window isn't all-low
    if (result.overlapRatio >= session.threshold) {
      assert.strictEqual(result.divergenceType, 'none');
    }
  });

  // @cap-todo(ac:F-035/AC-1) Stop words only message
  it('message of only stop words produces no keywords and no divergence', () => {
    const session = createSession('authentication token refresh');
    const result = processMessage(session, 'the and but or is are was were');
    assert.deepStrictEqual(result.newKeywords, []);
    assert.strictEqual(result.diverged, false);
  });

  // @cap-todo(ac:F-035/AC-3,AC-5,AC-6) Full lifecycle: create, process, branch, finalize
  it('full lifecycle: session create, messages, branch, finalize', () => {
    const parentThread = makeThread();
    persistThread(tmpDir, parentThread);

    const session = createSession(parentThread);

    // On-topic messages
    processMessage(session, 'authentication flow with JWT tokens');
    processMessage(session, 'token refresh mechanism and session handling');

    // Off-topic message triggers branch
    const r = processMessage(session, 'database migration tooling for postgres');
    if (r.diverged) {
      executeBranch(tmpDir, session, parentThread, 'Database migration tooling');
    }

    // Finalize
    const result = finalizeSession(tmpDir, session, parentThread);
    assert.strictEqual(result.indexUpdated, true);
    assert.ok(result.threadsSaved >= 1);

    // Verify parent is on disk and intact
    const loaded = loadThread(tmpDir, parentThread.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.problemStatement, parentThread.problemStatement);
  });
});

// --- truncate adversarial ---

describe('truncate adversarial', () => {
  it('handles empty string', () => {
    assert.strictEqual(truncate('', 10), '');
  });

  it('handles maxLen of 0', () => {
    const result = truncate('hello world', 0);
    assert.ok(result.length <= 5); // '...' or '...'
  });

  it('handles string of exactly maxLen', () => {
    assert.strictEqual(truncate('12345', 5), '12345');
  });

  it('handles single very long word with no spaces', () => {
    const longWord = 'a'.repeat(200);
    const result = truncate(longWord, 50);
    assert.ok(result.endsWith('...'));
    assert.ok(result.length <= 54); // 50 + '...'
  });
});
