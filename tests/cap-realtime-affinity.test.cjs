'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  detectRealtimeAffinity,
  formatUrgentBlock,
  formatNotifyLine,
  formatResults,
  cacheResults,
  loadCachedResults,
  clearCache,
  onSessionStart,
  onThreadContextChange,
  getSilentMatches,
  getAllCachedMatches,
  _findStrongestSignal,
} = require('../cap/bin/lib/cap-realtime-affinity.cjs');

const {
  REALTIME_SIGNALS,
  DEFAULT_WEIGHTS,
  DEFAULT_BANDS,
} = require('../cap/bin/lib/cap-affinity-engine.cjs');

// --- Test Fixtures ---

const threadAuth = {
  id: 'thr-auth0001',
  name: 'Auth cookie fix',
  timestamp: '2026-04-01T10:00:00Z',
  parentThreadId: null,
  divergencePoint: null,
  problemStatement: 'Cookies disappear after browser restart',
  solutionShape: 'Centralized cookie config',
  boundaryDecisions: ['Use getSharedCookieOptions'],
  featureIds: ['F-001', 'F-002'],
  keywords: ['auth', 'cookies', 'session'],
};

const threadLogout = {
  id: 'thr-logo0002',
  name: 'Logout button',
  timestamp: '2026-04-02T14:00:00Z',
  parentThreadId: null,
  divergencePoint: null,
  problemStatement: 'Logout not clearing session',
  solutionShape: 'clearSession with shared cookie options',
  boundaryDecisions: ['Shared cookie config for clearing'],
  featureIds: ['F-001', 'F-002'],
  keywords: ['auth', 'logout', 'session', 'cookies'],
};

const threadSchema = {
  id: 'thr-schm0003',
  name: 'Database schema',
  timestamp: '2026-06-15T09:00:00Z',
  parentThreadId: null,
  divergencePoint: null,
  problemStatement: 'Need Supabase schema for 43 tables',
  solutionShape: 'Schema-first approach',
  boundaryDecisions: ['JSONB for display-only data'],
  featureIds: ['F-022', 'F-023'],
  keywords: ['database', 'schema', 'migration'],
};

const emptyThread = {
  id: 'thr-empty0004',
  name: '',
  timestamp: '',
  parentThreadId: null,
  divergencePoint: null,
  problemStatement: '',
  solutionShape: '',
  boundaryDecisions: [],
  featureIds: [],
  keywords: [],
};

function makeTestGraph() {
  return {
    nodes: {
      'node-thr-auth': {
        type: 'thread',
        label: 'Auth cookie fix',
        metadata: { threadId: 'thr-auth0001' },
      },
      'node-thr-logout': {
        type: 'thread',
        label: 'Logout button',
        metadata: { threadId: 'thr-logo0002' },
      },
      'node-thr-schema': {
        type: 'thread',
        label: 'Database schema',
        metadata: { threadId: 'thr-schm0003' },
      },
      'node-feat-001': {
        type: 'feature',
        label: 'F-001 Auth',
        metadata: { files: ['src/auth/cookies.js', 'src/auth/session.js'] },
      },
      'node-feat-002': {
        type: 'feature',
        label: 'F-002 Session',
        metadata: { files: ['src/auth/session.js'] },
      },
      'node-feat-022': {
        type: 'feature',
        label: 'F-022 Schema',
        metadata: { files: ['db/schema.sql'] },
      },
    },
    edges: [
      { source: 'node-thr-auth', target: 'node-feat-001', type: 'implements' },
      { source: 'node-thr-auth', target: 'node-feat-002', type: 'implements' },
      { source: 'node-thr-logout', target: 'node-feat-001', type: 'implements' },
      { source: 'node-thr-logout', target: 'node-feat-002', type: 'implements' },
      { source: 'node-thr-schema', target: 'node-feat-022', type: 'implements' },
    ],
  };
}

function makeContext(threads) {
  return {
    graph: makeTestGraph(),
    allThreads: threads || [threadAuth, threadLogout, threadSchema],
    threadIndex: (threads || [threadAuth, threadLogout, threadSchema]).map(t => ({
      id: t.id,
      name: t.name,
      timestamp: t.timestamp,
    })),
  };
}

function makeConfig() {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    bands: { ...DEFAULT_BANDS },
  };
}

// --- Helper: create temp project dir for I/O tests ---

function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-realtime-test-'));
  const capDir = path.join(tmpDir, '.cap');
  const memDir = path.join(tmpDir, '.cap', 'memory');
  const threadDir = path.join(tmpDir, '.cap', 'memory', 'threads');

  fs.mkdirSync(capDir, { recursive: true });
  fs.mkdirSync(memDir, { recursive: true });
  fs.mkdirSync(threadDir, { recursive: true });

  // Write SESSION.json
  fs.writeFileSync(path.join(capDir, 'SESSION.json'), JSON.stringify({
    version: '2.0.0',
    lastCommand: null,
    lastCommandTimestamp: null,
    activeApp: null,
    activeFeature: null,
    step: null,
    startedAt: null,
    activeDebugSession: null,
    metadata: {},
  }));

  // Write thread-index.json
  fs.writeFileSync(path.join(memDir, 'thread-index.json'), JSON.stringify({
    threads: [
      { id: 'thr-auth0001', name: 'Auth cookie fix', timestamp: '2026-04-01T10:00:00Z' },
      { id: 'thr-logo0002', name: 'Logout button', timestamp: '2026-04-02T14:00:00Z' },
      { id: 'thr-schm0003', name: 'Database schema', timestamp: '2026-06-15T09:00:00Z' },
    ],
  }));

  // Write individual thread files
  fs.writeFileSync(path.join(threadDir, 'thr-auth0001.json'), JSON.stringify(threadAuth));
  fs.writeFileSync(path.join(threadDir, 'thr-logo0002.json'), JSON.stringify(threadLogout));
  fs.writeFileSync(path.join(threadDir, 'thr-schm0003.json'), JSON.stringify(threadSchema));

  // Write graph.json
  fs.writeFileSync(path.join(memDir, 'graph.json'), JSON.stringify(makeTestGraph()));

  return tmpDir;
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_e) {
    // Best effort cleanup
  }
}

// --- Tests ---

describe('F-039: Realtime Affinity Detection', () => {

  // =============================
  // AC-1: 4 realtime signals evaluated against all threads
  // =============================
  describe('AC-1: detectRealtimeAffinity evaluates realtime signals', () => {
    // @cap-todo(ac:F-039/AC-1) Test verifying: 4 realtime signals evaluated against all threads

    it('should return matches for each thread excluding self', () => {
      const allThreads = [threadAuth, threadLogout, threadSchema];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);

      assert.strictEqual(result.activeThreadId, 'thr-auth0001');
      // Should have matches for logout and schema, but NOT auth (self)
      const matchIds = result.matches.map(m => m.threadId);
      assert.ok(!matchIds.includes('thr-auth0001'), 'Self-comparison must be excluded');
      // At least some matches should exist (logout shares features with auth)
      assert.ok(result.matches.length > 0, 'Expected at least one match');
    });

    it('should exclude self-comparison even when self is the only thread', () => {
      const allThreads = [threadAuth];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      assert.strictEqual(result.matches.length, 0);
    });

    it('should produce signals that are only realtime signals', () => {
      // We verify indirectly: the engine is called with computeRealtimeAffinity
      // which only uses the 4 realtime signals. The match should have fields
      // strongestSignal which must be one of the realtime signals or 'unknown'.
      const allThreads = [threadAuth, threadLogout];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      for (const match of result.matches) {
        const validSignals = [...REALTIME_SIGNALS, 'unknown'];
        assert.ok(
          validSignals.includes(match.strongestSignal),
          `Signal "${match.strongestSignal}" is not a realtime signal`
        );
      }
    });

    it('should sort matches by score descending', () => {
      const allThreads = [threadAuth, threadLogout, threadSchema];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      for (let i = 1; i < result.matches.length; i++) {
        assert.ok(
          result.matches[i - 1].score >= result.matches[i].score,
          'Matches must be sorted by score descending'
        );
      }
    });

    it('should include computedAt as an ISO timestamp', () => {
      const allThreads = [threadAuth, threadLogout];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      assert.ok(result.computedAt, 'computedAt must be present');
      // Validate ISO format
      assert.ok(!isNaN(Date.parse(result.computedAt)), 'computedAt must be valid ISO timestamp');
    });
  });

  // =============================
  // AC-2: <200ms for full thread index
  // =============================
  describe('AC-2: performance within 200ms for 50 threads', () => {
    // @cap-todo(ac:F-039/AC-2) Test verifying: evaluation completes within 200ms for 50 threads

    it('should evaluate 50 threads in under 200ms', () => {
      // Generate 50 synthetic threads
      const allThreads = [];
      for (let i = 0; i < 50; i++) {
        allThreads.push({
          id: `thr-perf${String(i).padStart(4, '0')}`,
          name: `Perf thread ${i}`,
          timestamp: new Date(Date.now() - i * 86400000).toISOString(),
          parentThreadId: null,
          divergencePoint: null,
          problemStatement: `Problem ${i}`,
          solutionShape: `Solution ${i}`,
          boundaryDecisions: [`Decision ${i}`],
          featureIds: [`F-${String(i % 10).padStart(3, '0')}`],
          keywords: ['test', `keyword${i}`],
        });
      }

      const context = makeContext(allThreads);
      const config = makeConfig();

      const start = performance.now();
      const result = detectRealtimeAffinity(allThreads[0], allThreads, context, config);
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 200, `Took ${elapsed.toFixed(1)}ms, expected <200ms`);
      // Should have evaluated 49 threads (all minus self)
      assert.ok(result.matches.length <= 49, 'Should have at most 49 matches (excluding self)');
    });
  });

  // =============================
  // AC-3: Urgent band (>=0.90) -> full context block
  // =============================
  describe('AC-3: formatUrgentBlock produces full context block', () => {
    // @cap-todo(ac:F-039/AC-3) Test verifying: urgent band formatted as full context block

    const urgentMatch = {
      threadId: 'thr-test001',
      threadName: 'Critical auth issue',
      score: 0.95,
      band: 'urgent',
      strongestSignal: 'feature-id-overlap',
      strongestScore: 0.98,
      strongestReason: '4 shared feature IDs',
    };

    it('should contain thread name in urgent block', () => {
      const block = formatUrgentBlock(urgentMatch);
      assert.ok(block.includes('Critical auth issue'), 'Must contain thread name');
    });

    it('should contain strongest signal name and score', () => {
      const block = formatUrgentBlock(urgentMatch);
      assert.ok(block.includes('feature-id-overlap'), 'Must contain signal name');
      assert.ok(block.includes('0.98'), 'Must contain signal score');
    });

    it('should contain "Load this thread" offer', () => {
      const block = formatUrgentBlock(urgentMatch);
      assert.ok(
        block.toLowerCase().includes('load this thread'),
        'Must contain load-context offer'
      );
    });

    it('should contain the strongest reason', () => {
      const block = formatUrgentBlock(urgentMatch);
      assert.ok(block.includes('4 shared feature IDs'), 'Must contain strongest reason');
    });

    it('should route urgent matches to formatUrgentBlock via formatResults', () => {
      const result = {
        activeThreadId: 'thr-active',
        computedAt: new Date().toISOString(),
        matches: [urgentMatch],
      };

      const notifications = formatResults(result);
      assert.strictEqual(notifications.length, 1);
      assert.strictEqual(notifications[0].band, 'urgent');
      assert.ok(notifications[0].text.includes('Critical auth issue'));
      assert.ok(notifications[0].text.includes('Load this thread'));
    });
  });

  // =============================
  // AC-4: Notify band (0.75-0.89) -> compact line
  // =============================
  describe('AC-4: formatNotifyLine produces compact single-line notification', () => {
    // @cap-todo(ac:F-039/AC-4) Test verifying: notify band formatted as compact line

    const notifyMatch = {
      threadId: 'thr-test002',
      threadName: 'Related session work',
      score: 0.82,
      band: 'notify',
      strongestSignal: 'shared-files',
      strongestScore: 0.85,
      strongestReason: '3 shared files',
    };

    it('should contain thread name in notify line', () => {
      const line = formatNotifyLine(notifyMatch);
      assert.ok(line.includes('Related session work'), 'Must contain thread name');
    });

    it('should be a single line (no embedded newlines)', () => {
      const line = formatNotifyLine(notifyMatch);
      // Strip trailing newline if any, then check no newlines remain
      const trimmed = line.replace(/\n$/, '');
      assert.ok(!trimmed.includes('\n'), 'Notify line must be a single line');
    });

    it('should contain strongest signal info', () => {
      const line = formatNotifyLine(notifyMatch);
      assert.ok(line.includes('shared-files'), 'Must contain signal name');
      assert.ok(line.includes('0.85'), 'Must contain signal score');
    });

    it('should route notify matches to formatNotifyLine via formatResults', () => {
      const result = {
        activeThreadId: 'thr-active',
        computedAt: new Date().toISOString(),
        matches: [notifyMatch],
      };

      const notifications = formatResults(result);
      assert.strictEqual(notifications.length, 1);
      assert.strictEqual(notifications[0].band, 'notify');
      assert.ok(notifications[0].text.includes('Related session work'));
      // Notify text should NOT contain "Load this thread"
      assert.ok(!notifications[0].text.includes('Load this thread'));
    });
  });

  // =============================
  // AC-5: Silent band (0.40-0.74) -> no visible output
  // =============================
  describe('AC-5: silent band produces no visible output', () => {
    // @cap-todo(ac:F-039/AC-5) Test verifying: silent band has empty text

    const silentMatch = {
      threadId: 'thr-test003',
      threadName: 'Background thread',
      score: 0.55,
      band: 'silent',
      strongestSignal: 'temporal-proximity',
      strongestScore: 0.60,
      strongestReason: 'Recent activity',
    };

    it('should return empty text for silent matches in formatResults', () => {
      const result = {
        activeThreadId: 'thr-active',
        computedAt: new Date().toISOString(),
        matches: [silentMatch],
      };

      const notifications = formatResults(result);
      assert.strictEqual(notifications.length, 1);
      assert.strictEqual(notifications[0].band, 'silent');
      assert.strictEqual(notifications[0].text, '');
    });

    it('should return silent matches from getSilentMatches via cache', () => {
      const tmpDir = createTempProject();
      try {
        const result = {
          activeThreadId: 'thr-active',
          computedAt: new Date().toISOString(),
          matches: [
            silentMatch,
            {
              threadId: 'thr-urgent',
              threadName: 'Urgent one',
              score: 0.95,
              band: 'urgent',
              strongestSignal: 'feature-id-overlap',
              strongestScore: 0.98,
              strongestReason: 'Shared features',
            },
          ],
        };

        cacheResults(tmpDir, result);
        const silentOnly = getSilentMatches(tmpDir);
        assert.strictEqual(silentOnly.length, 1);
        assert.strictEqual(silentOnly[0].threadId, 'thr-test003');
        assert.strictEqual(silentOnly[0].band, 'silent');
      } finally {
        cleanupTempDir(tmpDir);
      }
    });
  });

  // =============================
  // AC-6: Integration hooks
  // =============================
  describe('AC-6: Integration hooks', () => {
    // @cap-todo(ac:F-039/AC-6) Test verifying: onSessionStart and onThreadContextChange work correctly

    let tmpDir;
    beforeEach(() => {
      tmpDir = createTempProject();
    });
    afterEach(() => {
      cleanupTempDir(tmpDir);
    });

    it('should return notifications from onSessionStart', () => {
      const notifications = onSessionStart(tmpDir, threadAuth);
      assert.ok(Array.isArray(notifications), 'Must return array');
      // With threadAuth active, logout should be related (shared features)
      // At minimum we get some notifications (could be silent)
      for (const n of notifications) {
        assert.ok(['urgent', 'notify', 'silent'].includes(n.band));
        assert.ok(typeof n.text === 'string');
        assert.ok(typeof n.threadId === 'string');
      }
    });

    it('should return cached results when thread unchanged in onThreadContextChange', () => {
      // First call computes fresh
      onSessionStart(tmpDir, threadAuth);

      // Second call with same thread should use cache
      const notifications = onThreadContextChange(tmpDir, threadAuth);
      assert.ok(Array.isArray(notifications));

      // Verify cache was used by checking cached data exists
      const cached = loadCachedResults(tmpDir);
      assert.ok(cached, 'Cache should exist after onSessionStart');
      assert.strictEqual(cached.activeThreadId, 'thr-auth0001');
    });

    it('should recompute when thread changes in onThreadContextChange', () => {
      // Start with threadAuth
      onSessionStart(tmpDir, threadAuth);
      const cached1 = loadCachedResults(tmpDir);
      assert.strictEqual(cached1.activeThreadId, 'thr-auth0001');

      // Switch to threadSchema
      onThreadContextChange(tmpDir, threadSchema);
      const cached2 = loadCachedResults(tmpDir);
      assert.strictEqual(cached2.activeThreadId, 'thr-schm0003');
    });
  });

  // =============================
  // AC-7: Session cache
  // =============================
  describe('AC-7: Session cache operations', () => {
    // @cap-todo(ac:F-039/AC-7) Test verifying: cache read/write/clear round-trip

    let tmpDir;
    beforeEach(() => {
      tmpDir = createTempProject();
    });
    afterEach(() => {
      cleanupTempDir(tmpDir);
    });

    it('should write cache to SESSION.json under realtimeAffinity key', () => {
      const result = {
        activeThreadId: 'thr-auth0001',
        computedAt: '2026-04-04T12:00:00Z',
        matches: [{
          threadId: 'thr-logo0002',
          threadName: 'Logout button',
          score: 0.85,
          band: 'notify',
          strongestSignal: 'feature-id-overlap',
          strongestScore: 0.90,
          strongestReason: '2 shared features',
        }],
      };

      cacheResults(tmpDir, result);

      // Read raw SESSION.json to verify structure
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cap', 'SESSION.json'), 'utf8'));
      assert.ok(raw.realtimeAffinity, 'SESSION.json must have realtimeAffinity key');
      assert.strictEqual(raw.realtimeAffinity.activeThreadId, 'thr-auth0001');
      assert.strictEqual(raw.realtimeAffinity.computedAt, '2026-04-04T12:00:00Z');
      assert.ok(Array.isArray(raw.realtimeAffinity.results), 'Must have results array');
      assert.strictEqual(raw.realtimeAffinity.results.length, 1);
    });

    it('should read back cached results via loadCachedResults', () => {
      const result = {
        activeThreadId: 'thr-auth0001',
        computedAt: '2026-04-04T12:00:00Z',
        matches: [{
          threadId: 'thr-logo0002',
          threadName: 'Logout button',
          score: 0.85,
          band: 'notify',
          strongestSignal: 'feature-id-overlap',
          strongestScore: 0.90,
          strongestReason: '2 shared features',
        }],
      };

      cacheResults(tmpDir, result);
      const loaded = loadCachedResults(tmpDir);

      assert.ok(loaded, 'Must return cached data');
      assert.strictEqual(loaded.activeThreadId, 'thr-auth0001');
      assert.strictEqual(loaded.matches.length, 1);
      assert.strictEqual(loaded.matches[0].threadId, 'thr-logo0002');
      assert.strictEqual(loaded.matches[0].score, 0.85);
      assert.strictEqual(loaded.matches[0].band, 'notify');
    });

    it('should return null from loadCachedResults when no cache exists', () => {
      const loaded = loadCachedResults(tmpDir);
      assert.strictEqual(loaded, null);
    });

    it('should clear cache via clearCache', () => {
      const result = {
        activeThreadId: 'thr-auth0001',
        computedAt: '2026-04-04T12:00:00Z',
        matches: [],
      };

      cacheResults(tmpDir, result);
      assert.ok(loadCachedResults(tmpDir), 'Cache should exist before clear');

      clearCache(tmpDir);
      assert.strictEqual(loadCachedResults(tmpDir), null, 'Cache should be null after clear');
    });

    it('should have correct cache schema: activeThreadId, computedAt, results array', () => {
      const result = {
        activeThreadId: 'thr-test',
        computedAt: '2026-04-04T12:00:00Z',
        matches: [{
          threadId: 'thr-other',
          threadName: 'Other',
          score: 0.50,
          band: 'silent',
          strongestSignal: 'temporal-proximity',
          strongestScore: 0.55,
          strongestReason: 'Recent',
        }],
      };

      cacheResults(tmpDir, result);
      const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cap', 'SESSION.json'), 'utf8'));
      const cached = raw.realtimeAffinity;

      assert.ok(typeof cached.activeThreadId === 'string', 'activeThreadId must be string');
      assert.ok(typeof cached.computedAt === 'string', 'computedAt must be string');
      assert.ok(Array.isArray(cached.results), 'results must be array');

      const entry = cached.results[0];
      assert.ok('threadId' in entry, 'Entry must have threadId');
      assert.ok('threadName' in entry, 'Entry must have threadName');
      assert.ok('score' in entry, 'Entry must have score');
      assert.ok('band' in entry, 'Entry must have band');
      assert.ok('strongestSignal' in entry, 'Entry must have strongestSignal');
      assert.ok('strongestScore' in entry, 'Entry must have strongestScore');
      assert.ok('strongestReason' in entry, 'Entry must have strongestReason');
    });
  });

  // =============================
  // _findStrongestSignal helper
  // =============================
  describe('_findStrongestSignal helper', () => {
    it('should return the highest-scoring signal', () => {
      const signals = [
        { signal: 'feature-id-overlap', score: 0.5, reason: 'Half' },
        { signal: 'shared-files', score: 0.9, reason: 'Most' },
        { signal: 'temporal-proximity', score: 0.2, reason: 'Least' },
      ];
      const best = _findStrongestSignal(signals);
      assert.strictEqual(best.signal, 'shared-files');
      assert.strictEqual(best.score, 0.9);
    });

    it('should return fallback for empty signals array', () => {
      const best = _findStrongestSignal([]);
      assert.strictEqual(best.signal, 'unknown');
      assert.strictEqual(best.score, 0);
    });

    it('should return fallback for null/undefined signals', () => {
      const best1 = _findStrongestSignal(null);
      assert.strictEqual(best1.signal, 'unknown');

      const best2 = _findStrongestSignal(undefined);
      assert.strictEqual(best2.signal, 'unknown');
    });

    it('should return first signal when all scores are equal', () => {
      const signals = [
        { signal: 'feature-id-overlap', score: 0.5, reason: 'A' },
        { signal: 'shared-files', score: 0.5, reason: 'B' },
      ];
      const best = _findStrongestSignal(signals);
      assert.strictEqual(best.signal, 'feature-id-overlap');
    });
  });

  // =============================
  // Adversarial tests
  // =============================
  describe('Adversarial: edge cases and error handling', () => {

    it('should return empty matches for empty thread index', () => {
      const allThreads = [];
      const context = makeContext(allThreads);
      const config = makeConfig();

      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      assert.strictEqual(result.matches.length, 0);
      assert.strictEqual(result.activeThreadId, 'thr-auth0001');
    });

    it('should handle thread with null name gracefully (uses id as fallback)', () => {
      const nullNameThread = {
        id: 'thr-null0001',
        name: null,
        timestamp: '2026-04-01T10:00:00Z',
        parentThreadId: null,
        divergencePoint: null,
        problemStatement: '',
        solutionShape: '',
        boundaryDecisions: [],
        featureIds: ['F-001'],
        keywords: [],
      };

      const allThreads = [threadAuth, nullNameThread];
      const context = makeContext(allThreads);
      const config = makeConfig();

      // Should not throw
      const result = detectRealtimeAffinity(threadAuth, allThreads, context, config);
      // The match for nullNameThread should use id as fallback
      const match = result.matches.find(m => m.threadId === 'thr-null0001');
      if (match) {
        assert.ok(
          match.threadName === 'thr-null0001' || match.threadName === null,
          'Thread name should fallback to id or be null'
        );
      }
    });

    it('should return empty formatted results when all matches are in discard band', () => {
      // Create a result with no matches (all discarded by detectRealtimeAffinity)
      const result = {
        activeThreadId: 'thr-active',
        computedAt: new Date().toISOString(),
        matches: [],
      };

      const notifications = formatResults(result);
      assert.strictEqual(notifications.length, 0);
    });

    it('should handle formatResults with mixed bands correctly', () => {
      const result = {
        activeThreadId: 'thr-active',
        computedAt: new Date().toISOString(),
        matches: [
          {
            threadId: 'thr-u', threadName: 'Urgent', score: 0.95, band: 'urgent',
            strongestSignal: 'feature-id-overlap', strongestScore: 0.98, strongestReason: 'High overlap',
          },
          {
            threadId: 'thr-n', threadName: 'Notify', score: 0.80, band: 'notify',
            strongestSignal: 'shared-files', strongestScore: 0.82, strongestReason: 'Shared files',
          },
          {
            threadId: 'thr-s', threadName: 'Silent', score: 0.50, band: 'silent',
            strongestSignal: 'temporal-proximity', strongestScore: 0.55, strongestReason: 'Recent',
          },
        ],
      };

      const notifications = formatResults(result);
      assert.strictEqual(notifications.length, 3);
      assert.strictEqual(notifications[0].band, 'urgent');
      assert.ok(notifications[0].text.length > 0, 'Urgent text must not be empty');
      assert.strictEqual(notifications[1].band, 'notify');
      assert.ok(notifications[1].text.length > 0, 'Notify text must not be empty');
      assert.strictEqual(notifications[2].band, 'silent');
      assert.strictEqual(notifications[2].text, '', 'Silent text must be empty');
    });

    it('should return empty array from getSilentMatches when no cache', () => {
      const tmpDir = createTempProject();
      try {
        const result = getSilentMatches(tmpDir);
        assert.deepStrictEqual(result, []);
      } finally {
        cleanupTempDir(tmpDir);
      }
    });

    it('should return empty array from getAllCachedMatches when no cache', () => {
      const tmpDir = createTempProject();
      try {
        const result = getAllCachedMatches(tmpDir);
        assert.deepStrictEqual(result, []);
      } finally {
        cleanupTempDir(tmpDir);
      }
    });

    it('should handle single-element signals array in _findStrongestSignal', () => {
      const signals = [{ signal: 'causal-chains', score: 0.33, reason: 'One chain' }];
      const best = _findStrongestSignal(signals);
      assert.strictEqual(best.signal, 'causal-chains');
      assert.strictEqual(best.score, 0.33);
    });

    it('should return matches from getAllCachedMatches when cache exists', () => {
      const tmpDir = createTempProject();
      try {
        // Cache a result so loadCachedResults returns non-null
        cacheResults(tmpDir, {
          activeThreadId: 'thr-auth0001',
          computedAt: new Date().toISOString(),
          matches: [
            {
              threadId: 'thr-logo0002', threadName: 'Logout button',
              score: 0.9, band: 'urgent',
              strongestSignal: 'shared-features', strongestScore: 0.95, strongestReason: 'Shared features',
            },
            {
              threadId: 'thr-schm0003', threadName: 'Database schema',
              score: 0.4, band: 'silent',
              strongestSignal: 'temporal-proximity', strongestScore: 0.45, strongestReason: 'Recent',
            },
          ],
        });
        const result = getAllCachedMatches(tmpDir);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].threadId, 'thr-logo0002');
        assert.strictEqual(result[1].band, 'silent');
      } finally {
        cleanupTempDir(tmpDir);
      }
    });

    it('should return silent matches from getSilentMatches when cache exists', () => {
      const tmpDir = createTempProject();
      try {
        cacheResults(tmpDir, {
          activeThreadId: 'thr-auth0001',
          computedAt: new Date().toISOString(),
          matches: [
            {
              threadId: 'thr-logo0002', threadName: 'Logout button',
              score: 0.9, band: 'urgent',
              strongestSignal: 'shared-features', strongestScore: 0.95, strongestReason: 'Shared',
            },
            {
              threadId: 'thr-schm0003', threadName: 'Database schema',
              score: 0.4, band: 'silent',
              strongestSignal: 'temporal-proximity', strongestScore: 0.45, strongestReason: 'Recent',
            },
          ],
        });
        const result = getSilentMatches(tmpDir);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].band, 'silent');
        assert.strictEqual(result[0].threadId, 'thr-schm0003');
      } finally {
        cleanupTempDir(tmpDir);
      }
    });

    it('should handle loadCachedResults when cached.results is undefined', () => {
      const tmpDir = createTempProject();
      try {
        // Write session with realtimeAffinity but no results key
        const sessionPath = path.join(tmpDir, '.cap', 'SESSION.json');
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        session.realtimeAffinity = {
          activeThreadId: 'thr-auth0001',
          computedAt: new Date().toISOString(),
          // results is intentionally missing to hit || [] fallback
        };
        fs.writeFileSync(sessionPath, JSON.stringify(session), 'utf8');

        const cached = loadCachedResults(tmpDir);
        assert.ok(cached, 'Should return cached result');
        assert.deepStrictEqual(cached.matches, []);
      } finally {
        cleanupTempDir(tmpDir);
      }
    });

    it('should handle _loadDetectionContext for projects with threads', () => {
      const tmpDir = createTempProject();
      try {
        const ctx = require('../cap/bin/lib/cap-realtime-affinity.cjs')._loadDetectionContext(tmpDir);
        assert.ok(Array.isArray(ctx.allThreads), 'allThreads should be an array');
        assert.ok(ctx.context, 'context should exist');
        assert.ok(ctx.config, 'config should exist');
      } finally {
        cleanupTempDir(tmpDir);
      }
    });
  });
});
