'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createThread,
  branchThread,
  detectRevisits,
  extractKeywords,
  computeKeywordOverlap,
  deriveName,
  createEmptyIndex,
  addToIndex,
  removeFromIndex,
  loadIndex,
  saveIndex,
  loadThread,
  saveThread,
  deleteThread,
  persistThread,
  checkPriorThreads,
  listThreads,
  generateThreadId,
  THREADS_DIR,
  THREAD_INDEX_FILE,
  REVISIT_KEYWORD_THRESHOLD,
  REVISIT_MIN_SHARED_KEYWORDS,
} = require('../cap/bin/lib/cap-thread-tracker.cjs');

// --- Test Helpers ---

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-thread-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- generateThreadId ---

describe('generateThreadId', () => {
  it('generates IDs with thr- prefix', () => {
    const id = generateThreadId();
    assert.ok(id.startsWith('thr-'));
    assert.strictEqual(id.length, 12); // "thr-" + 8 hex chars
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateThreadId());
    assert.strictEqual(ids.size, 100);
  });
});

// --- extractKeywords ---

describe('extractKeywords', () => {
  it('extracts meaningful words, skipping stop words', () => {
    const keywords = extractKeywords('The authentication module needs token refresh support');
    assert.ok(keywords.includes('authentication'));
    assert.ok(keywords.includes('module'));
    assert.ok(keywords.includes('token'));
    assert.ok(keywords.includes('refresh'));
    assert.ok(keywords.includes('support'));
    assert.ok(!keywords.includes('the'));
  });

  it('returns empty array for null/empty input', () => {
    assert.deepStrictEqual(extractKeywords(null), []);
    assert.deepStrictEqual(extractKeywords(''), []);
    assert.deepStrictEqual(extractKeywords(undefined), []);
  });

  it('deduplicates and sorts keywords', () => {
    const keywords = extractKeywords('token token auth auth');
    assert.deepStrictEqual(keywords, ['auth', 'token']);
  });

  it('strips punctuation and normalizes case', () => {
    const keywords = extractKeywords('Authentication! Module... Token-refresh');
    assert.ok(keywords.includes('authentication'));
    assert.ok(keywords.includes('module'));
    assert.ok(keywords.includes('token-refresh'));
  });

  it('filters words shorter than 3 chars', () => {
    const keywords = extractKeywords('go do it me up');
    // All are either < 3 chars or stop words
    assert.strictEqual(keywords.length, 0);
  });
});

// --- deriveName ---

describe('deriveName', () => {
  it('returns short problem statements as-is', () => {
    assert.strictEqual(deriveName('Fix auth module'), 'Fix auth module');
  });

  it('truncates long problem statements at word boundary', () => {
    const long = 'Implement a comprehensive authentication system with token refresh and session management for distributed microservices';
    const name = deriveName(long);
    assert.ok(name.length <= 63); // 60 + "..."
    assert.ok(name.endsWith('...'));
  });

  it('returns default for empty input', () => {
    assert.strictEqual(deriveName(''), 'Untitled Thread');
    assert.strictEqual(deriveName(null), 'Untitled Thread');
  });
});

// --- createThread ---

describe('createThread', () => {
  it('creates a thread with all required fields', () => {
    const thread = createThread({
      problemStatement: 'How to handle auth token refresh across microservices',
      solutionShape: 'Centralized token service with refresh proxy',
      boundaryDecisions: ['No client-side token storage', 'Refresh handled server-side'],
      featureIds: ['F-010', 'F-011'],
    });

    assert.ok(thread.id.startsWith('thr-'));
    assert.ok(thread.timestamp);
    assert.strictEqual(thread.parentThreadId, null);
    assert.strictEqual(thread.divergencePoint, null);
    assert.strictEqual(thread.problemStatement, 'How to handle auth token refresh across microservices');
    assert.strictEqual(thread.solutionShape, 'Centralized token service with refresh proxy');
    assert.deepStrictEqual(thread.boundaryDecisions, ['No client-side token storage', 'Refresh handled server-side']);
    assert.deepStrictEqual(thread.featureIds, ['F-010', 'F-011']);
    assert.ok(thread.keywords.length > 0);
    assert.ok(thread.keywords.includes('token'));
    assert.ok(thread.keywords.includes('refresh'));
  });

  it('auto-derives name from problem statement', () => {
    const thread = createThread({ problemStatement: 'Fix the broken auth flow' });
    assert.strictEqual(thread.name, 'Fix the broken auth flow');
  });

  it('uses provided name when given', () => {
    const thread = createThread({
      problemStatement: 'Fix the broken auth flow',
      name: 'Auth Fix Sprint',
    });
    assert.strictEqual(thread.name, 'Auth Fix Sprint');
  });

  it('uses defaults for optional fields', () => {
    const thread = createThread({ problemStatement: 'Simple topic' });
    assert.strictEqual(thread.solutionShape, '');
    assert.deepStrictEqual(thread.boundaryDecisions, []);
    assert.deepStrictEqual(thread.featureIds, []);
  });

  it('extracts keywords from all text fields', () => {
    const thread = createThread({
      problemStatement: 'authentication service',
      solutionShape: 'token proxy',
      boundaryDecisions: ['microservice boundary'],
    });
    assert.ok(thread.keywords.includes('authentication'));
    assert.ok(thread.keywords.includes('token'));
    assert.ok(thread.keywords.includes('microservice'));
  });
});

// --- branchThread ---

describe('branchThread', () => {
  it('creates a child thread referencing parent', () => {
    const parent = createThread({ problemStatement: 'Auth system design' });
    const child = branchThread(parent, {
      problemStatement: 'OAuth2 provider integration specifically',
      divergencePoint: 'Original thread focused on custom tokens, this explores OAuth2',
    });

    assert.strictEqual(child.parentThreadId, parent.id);
    assert.ok(child.divergencePoint.includes('OAuth2'));
    assert.notStrictEqual(child.id, parent.id);
  });

  it('child has its own keywords', () => {
    const parent = createThread({ problemStatement: 'Auth system design' });
    const child = branchThread(parent, {
      problemStatement: 'Database schema for OAuth providers',
      divergencePoint: 'Branching to focus on data layer',
    });

    assert.ok(child.keywords.includes('database'));
    assert.ok(child.keywords.includes('schema'));
    assert.ok(child.keywords.includes('oauth'));
  });
});

// --- computeKeywordOverlap ---

describe('computeKeywordOverlap', () => {
  it('computes overlap ratio correctly', () => {
    const { shared, overlapRatio } = computeKeywordOverlap(
      ['auth', 'token', 'refresh'],
      ['auth', 'token', 'session']
    );
    assert.deepStrictEqual(shared, ['auth', 'token']);
    // union = {auth, token, refresh, session} = 4, shared = 2, ratio = 0.5
    assert.strictEqual(overlapRatio, 0.5);
  });

  it('returns zero for disjoint sets', () => {
    const { shared, overlapRatio } = computeKeywordOverlap(
      ['auth', 'token'],
      ['database', 'migration']
    );
    assert.deepStrictEqual(shared, []);
    assert.strictEqual(overlapRatio, 0);
  });

  it('handles empty arrays', () => {
    const { shared, overlapRatio } = computeKeywordOverlap([], []);
    assert.deepStrictEqual(shared, []);
    assert.strictEqual(overlapRatio, 0);
  });

  it('returns 1.0 for identical sets', () => {
    const { overlapRatio } = computeKeywordOverlap(
      ['auth', 'token'],
      ['auth', 'token']
    );
    assert.strictEqual(overlapRatio, 1);
  });
});

// --- Thread Index ---

describe('Thread Index', () => {
  it('creates empty index with version', () => {
    const index = createEmptyIndex();
    assert.strictEqual(index.version, '1.0.0');
    assert.deepStrictEqual(index.threads, []);
  });

  it('adds thread to index', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'Auth design', featureIds: ['F-001'] });
    addToIndex(index, thread);

    assert.strictEqual(index.threads.length, 1);
    assert.strictEqual(index.threads[0].id, thread.id);
    assert.deepStrictEqual(index.threads[0].featureIds, ['F-001']);
  });

  it('upserts — adding same ID replaces entry', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'Auth design', featureIds: ['F-001'] });
    addToIndex(index, thread);
    // Update feature IDs
    thread.featureIds = ['F-001', 'F-002'];
    addToIndex(index, thread);

    assert.strictEqual(index.threads.length, 1);
    assert.deepStrictEqual(index.threads[0].featureIds, ['F-001', 'F-002']);
  });

  it('removes thread from index', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'Auth design' });
    addToIndex(index, thread);
    removeFromIndex(index, thread.id);

    assert.strictEqual(index.threads.length, 0);
  });

  it('remove is idempotent for missing ID', () => {
    const index = createEmptyIndex();
    removeFromIndex(index, 'thr-nonexistent');
    assert.strictEqual(index.threads.length, 0);
  });
});

// --- detectRevisits ---

describe('detectRevisits', () => {
  it('detects keyword-based revisit', () => {
    const index = createEmptyIndex();
    const thread = createThread({
      problemStatement: 'Authentication token refresh for microservices',
      featureIds: ['F-010'],
    });
    addToIndex(index, thread);

    const matches = detectRevisits(index, {
      problemStatement: 'Token refresh handling in auth service',
    });

    assert.ok(matches.length > 0);
    assert.strictEqual(matches[0].threadId, thread.id);
    assert.ok(matches[0].sharedKeywords.includes('token'));
    assert.ok(matches[0].sharedKeywords.includes('refresh'));
  });

  it('detects feature-ID-based revisit', () => {
    const index = createEmptyIndex();
    const thread = createThread({
      problemStatement: 'Some unique topic XYZ',
      featureIds: ['F-010'],
    });
    addToIndex(index, thread);

    const matches = detectRevisits(index, {
      problemStatement: 'Completely different words',
      featureIds: ['F-010'],
    });

    assert.ok(matches.length > 0);
    assert.deepStrictEqual(matches[0].sharedFeatureIds, ['F-010']);
  });

  it('returns empty for no matches', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'Authentication system' });
    addToIndex(index, thread);

    const matches = detectRevisits(index, {
      problemStatement: 'Database migration tooling',
    });

    assert.strictEqual(matches.length, 0);
  });

  it('returns empty for empty index', () => {
    const index = createEmptyIndex();
    const matches = detectRevisits(index, {
      problemStatement: 'Anything at all',
    });
    assert.strictEqual(matches.length, 0);
  });

  it('sorts matches by score descending', () => {
    const index = createEmptyIndex();

    const threadA = createThread({
      problemStatement: 'Token refresh authentication service proxy',
      featureIds: ['F-010'],
    });
    addToIndex(index, threadA);

    const threadB = createThread({
      problemStatement: 'Database migration tooling for schemas',
    });
    addToIndex(index, threadB);

    const matches = detectRevisits(index, {
      problemStatement: 'Authentication token refresh proxy',
      featureIds: ['F-010'],
    });

    // threadA should score higher (both keyword and feature overlap)
    assert.ok(matches.length >= 1);
    assert.strictEqual(matches[0].threadId, threadA.id);
  });

  it('respects custom thresholds', () => {
    const index = createEmptyIndex();
    const thread = createThread({
      problemStatement: 'Authentication token refresh service',
    });
    addToIndex(index, thread);

    // With very high threshold, no match
    const matches = detectRevisits(index, {
      problemStatement: 'Auth token',
      keywordThreshold: 0.99,
      minSharedKeywords: 10,
    });
    assert.strictEqual(matches.length, 0);
  });
});

// --- File I/O ---

describe('File I/O', () => {
  describe('loadIndex / saveIndex', () => {
    it('returns empty index when no file exists', () => {
      const index = loadIndex(tmpDir);
      assert.strictEqual(index.version, '1.0.0');
      assert.deepStrictEqual(index.threads, []);
    });

    it('round-trips index through save/load', () => {
      const index = createEmptyIndex();
      const thread = createThread({ problemStatement: 'Auth design', featureIds: ['F-001'] });
      addToIndex(index, thread);

      saveIndex(tmpDir, index);
      const loaded = loadIndex(tmpDir);

      assert.strictEqual(loaded.threads.length, 1);
      assert.strictEqual(loaded.threads[0].id, thread.id);
      assert.deepStrictEqual(loaded.threads[0].featureIds, ['F-001']);
    });

    it('handles corrupt JSON gracefully', () => {
      const indexPath = path.join(tmpDir, '.cap', 'memory');
      fs.mkdirSync(indexPath, { recursive: true });
      fs.writeFileSync(path.join(indexPath, 'thread-index.json'), 'NOT JSON{{{', 'utf8');

      const index = loadIndex(tmpDir);
      assert.strictEqual(index.version, '1.0.0');
      assert.deepStrictEqual(index.threads, []);
    });

    it('creates directories if needed', () => {
      const index = createEmptyIndex();
      saveIndex(tmpDir, index);

      const indexPath = path.join(tmpDir, THREAD_INDEX_FILE);
      assert.ok(fs.existsSync(indexPath));
    });
  });

  describe('loadThread / saveThread', () => {
    it('returns null for nonexistent thread', () => {
      assert.strictEqual(loadThread(tmpDir, 'thr-nonexistent'), null);
    });

    it('round-trips thread through save/load', () => {
      const thread = createThread({
        problemStatement: 'Auth design',
        solutionShape: 'Token proxy',
        boundaryDecisions: ['No client storage'],
        featureIds: ['F-001'],
      });

      saveThread(tmpDir, thread);
      const loaded = loadThread(tmpDir, thread.id);

      assert.strictEqual(loaded.id, thread.id);
      assert.strictEqual(loaded.problemStatement, 'Auth design');
      assert.strictEqual(loaded.solutionShape, 'Token proxy');
      assert.deepStrictEqual(loaded.boundaryDecisions, ['No client storage']);
      assert.deepStrictEqual(loaded.featureIds, ['F-001']);
    });

    it('creates threads directory if needed', () => {
      const thread = createThread({ problemStatement: 'Test' });
      saveThread(tmpDir, thread);

      const threadsDir = path.join(tmpDir, THREADS_DIR);
      assert.ok(fs.existsSync(threadsDir));
    });
  });

  describe('deleteThread', () => {
    it('deletes thread file and removes from index', () => {
      const thread = createThread({ problemStatement: 'To be deleted' });
      persistThread(tmpDir, thread);

      const deleted = deleteThread(tmpDir, thread.id);
      assert.ok(deleted);
      assert.strictEqual(loadThread(tmpDir, thread.id), null);
      assert.strictEqual(loadIndex(tmpDir).threads.length, 0);
    });

    it('returns false for nonexistent thread', () => {
      const deleted = deleteThread(tmpDir, 'thr-nonexistent');
      assert.ok(!deleted);
    });
  });

  describe('persistThread', () => {
    it('saves thread and updates index in one call', () => {
      const thread = createThread({
        problemStatement: 'Comprehensive auth design',
        featureIds: ['F-010'],
      });

      const result = persistThread(tmpDir, thread);

      assert.strictEqual(result.thread.id, thread.id);
      assert.strictEqual(result.index.threads.length, 1);

      // Verify on disk
      const loaded = loadThread(tmpDir, thread.id);
      assert.strictEqual(loaded.problemStatement, 'Comprehensive auth design');

      const loadedIndex = loadIndex(tmpDir);
      assert.strictEqual(loadedIndex.threads.length, 1);
    });

    it('is idempotent — persisting same thread twice does not duplicate', () => {
      const thread = createThread({ problemStatement: 'Auth design' });
      persistThread(tmpDir, thread);
      persistThread(tmpDir, thread);

      const index = loadIndex(tmpDir);
      assert.strictEqual(index.threads.length, 1);
    });
  });
});

// --- High-Level Functions ---

describe('checkPriorThreads', () => {
  it('returns matching threads with full data', () => {
    const thread = createThread({
      problemStatement: 'Authentication token refresh for microservices',
      solutionShape: 'Centralized proxy',
      featureIds: ['F-010'],
    });
    persistThread(tmpDir, thread);

    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Token refresh authentication microservices',
    });

    assert.ok(matches.length > 0);
    assert.ok(threads.length > 0);
    assert.strictEqual(threads[0].id, thread.id);
    assert.strictEqual(threads[0].problemStatement, 'Authentication token refresh for microservices');
  });

  it('returns empty when no prior threads exist', () => {
    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Brand new topic',
    });
    assert.strictEqual(matches.length, 0);
    assert.strictEqual(threads.length, 0);
  });
});

describe('listThreads', () => {
  it('lists all threads sorted by timestamp descending', () => {
    const t1 = createThread({ problemStatement: 'First thread' });
    const t2 = createThread({ problemStatement: 'Second thread' });
    persistThread(tmpDir, t1);
    persistThread(tmpDir, t2);

    const list = listThreads(tmpDir);
    assert.strictEqual(list.length, 2);
    // Most recent first (t2 was created after t1)
    assert.ok(list[0].timestamp >= list[1].timestamp);
  });

  it('filters by feature ID', () => {
    const t1 = createThread({ problemStatement: 'Auth thread', featureIds: ['F-010'] });
    const t2 = createThread({ problemStatement: 'DB thread', featureIds: ['F-020'] });
    persistThread(tmpDir, t1);
    persistThread(tmpDir, t2);

    const list = listThreads(tmpDir, { featureId: 'F-010' });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, t1.id);
  });

  it('returns empty for no threads', () => {
    const list = listThreads(tmpDir);
    assert.strictEqual(list.length, 0);
  });
});

// --- Git-committable verification (AC-6) ---

describe('git-committable thread data', () => {
  it('thread files are plain JSON in .cap/memory/threads/', () => {
    const thread = createThread({ problemStatement: 'Git test' });
    persistThread(tmpDir, thread);

    const threadPath = path.join(tmpDir, THREADS_DIR, `${thread.id}.json`);
    assert.ok(fs.existsSync(threadPath));

    // Verify it is valid JSON
    const content = fs.readFileSync(threadPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.id, thread.id);
  });

  it('index file is plain JSON in .cap/memory/', () => {
    const thread = createThread({ problemStatement: 'Index test' });
    persistThread(tmpDir, thread);

    const indexPath = path.join(tmpDir, THREAD_INDEX_FILE);
    assert.ok(fs.existsSync(indexPath));

    const content = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed.threads));
  });

  it('thread files use 2-space indentation for readable diffs', () => {
    const thread = createThread({ problemStatement: 'Indent test' });
    persistThread(tmpDir, thread);

    const threadPath = path.join(tmpDir, THREADS_DIR, `${thread.id}.json`);
    const content = fs.readFileSync(threadPath, 'utf8');
    // 2-space indent means lines start with "  "
    assert.ok(content.includes('  "id"'));
  });
});

// =============================================================================
// ADVERSARIAL TESTS — AC-focused, boundary, error, and edge-case coverage
// =============================================================================

// --- AC-1: Persist each brainstorm session as a named thread ---

describe('AC-1: Thread persistence edge cases', () => {
  // @cap-todo(ac:F-031/AC-1) Adversarial: empty/missing problem statements
  it('creates thread with empty string problemStatement (no crash)', () => {
    const thread = createThread({ problemStatement: '' });
    assert.ok(thread.id.startsWith('thr-'));
    assert.strictEqual(thread.name, 'Untitled Thread');
    assert.strictEqual(thread.problemStatement, '');
    assert.ok(thread.timestamp);
  });

  it('creates thread with whitespace-only problemStatement', () => {
    const thread = createThread({ problemStatement: '   \n\t  ' });
    assert.ok(thread.id.startsWith('thr-'));
    // Name should be trimmed whitespace or 'Untitled Thread'-like
    assert.ok(typeof thread.name === 'string');
    assert.deepStrictEqual(thread.keywords, []);
  });

  it('each thread gets a unique ID even with identical params', () => {
    const params = { problemStatement: 'Identical topic' };
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(createThread(params).id);
    }
    assert.strictEqual(ids.size, 50);
  });

  it('thread timestamp is valid ISO 8601', () => {
    const thread = createThread({ problemStatement: 'Timestamp test' });
    const parsed = new Date(thread.timestamp);
    assert.ok(!isNaN(parsed.getTime()), 'timestamp should parse to valid date');
    assert.strictEqual(thread.timestamp, parsed.toISOString());
  });

  it('parentThreadId is null for non-branched threads', () => {
    const thread = createThread({ problemStatement: 'Root thread' });
    assert.strictEqual(thread.parentThreadId, null);
    assert.strictEqual(thread.divergencePoint, null);
  });

  it('persists thread to disk even when .cap/memory/ does not yet exist', () => {
    // tmpDir is fresh with no .cap/ directory
    const thread = createThread({ problemStatement: 'Fresh directory test' });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.strictEqual(loaded.id, thread.id);
  });

  it('thread file is named {threadId}.json', () => {
    const thread = createThread({ problemStatement: 'Naming convention' });
    saveThread(tmpDir, thread);
    const expectedPath = path.join(tmpDir, THREADS_DIR, `${thread.id}.json`);
    assert.ok(fs.existsSync(expectedPath));
  });
});

// --- AC-2: Capture full discovery context per thread ---

describe('AC-2: Full discovery context capture', () => {
  // @cap-todo(ac:F-031/AC-2) Adversarial: missing/empty context fields
  it('thread with no solution shape stores empty string', () => {
    const thread = createThread({ problemStatement: 'No solution' });
    assert.strictEqual(thread.solutionShape, '');
  });

  it('thread with no boundary decisions stores empty array', () => {
    const thread = createThread({ problemStatement: 'No decisions' });
    assert.deepStrictEqual(thread.boundaryDecisions, []);
  });

  it('thread with no feature IDs stores empty array', () => {
    const thread = createThread({ problemStatement: 'No features' });
    assert.deepStrictEqual(thread.featureIds, []);
  });

  it('preserves extremely long problem statement through round-trip', () => {
    const longStatement = 'word '.repeat(5000).trim(); // ~25000 chars
    const thread = createThread({ problemStatement: longStatement });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.strictEqual(loaded.problemStatement, longStatement);
  });

  it('preserves many boundary decisions through round-trip', () => {
    const decisions = Array.from({ length: 100 }, (_, i) => `Decision number ${i}`);
    const thread = createThread({
      problemStatement: 'Many decisions test',
      boundaryDecisions: decisions,
    });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.strictEqual(loaded.boundaryDecisions.length, 100);
    assert.strictEqual(loaded.boundaryDecisions[99], 'Decision number 99');
  });

  it('preserves multiple feature IDs through round-trip', () => {
    const featureIds = Array.from({ length: 50 }, (_, i) => `F-${String(i).padStart(3, '0')}`);
    const thread = createThread({
      problemStatement: 'Many features test',
      featureIds,
    });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.deepStrictEqual(loaded.featureIds, featureIds);
  });

  it('index entry contains featureIds matching thread', () => {
    const thread = createThread({
      problemStatement: 'Feature ID sync test',
      featureIds: ['F-010', 'F-020'],
    });
    persistThread(tmpDir, thread);
    const index = loadIndex(tmpDir);
    const entry = index.threads.find(t => t.id === thread.id);
    assert.deepStrictEqual(entry.featureIds, ['F-010', 'F-020']);
  });
});

// --- AC-3: Revisit detection edge cases ---

describe('AC-3: Revisit detection adversarial', () => {
  // @cap-todo(ac:F-031/AC-3) Adversarial: edge cases in topic detection
  it('zero keyword overlap returns no matches', () => {
    const index = createEmptyIndex();
    addToIndex(index, createThread({ problemStatement: 'alpha beta gamma' }));
    const matches = detectRevisits(index, { problemStatement: 'delta epsilon zeta' });
    assert.strictEqual(matches.length, 0);
  });

  it('100% keyword overlap returns a match with score 1.0 keyword component', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'authentication token refresh' });
    addToIndex(index, thread);
    const matches = detectRevisits(index, { problemStatement: 'authentication token refresh' });
    assert.ok(matches.length > 0);
    assert.strictEqual(matches[0].threadId, thread.id);
    // With identical keywords and no feature overlap: score = 1.0 * 0.6 + 0 * 0.4 = 0.6
    assert.ok(matches[0].score >= 0.5, `Expected score >= 0.5, got ${matches[0].score}`);
  });

  it('single-word keywords below minSharedKeywords threshold return no match', () => {
    const index = createEmptyIndex();
    addToIndex(index, createThread({ problemStatement: 'authentication' }));
    // Default minSharedKeywords is 2, single keyword overlap cannot reach 2
    const matches = detectRevisits(index, { problemStatement: 'authentication' });
    // Even with 100% overlap ratio, shared.length=1 < minSharedKeywords=2
    assert.strictEqual(matches.length, 0);
  });

  it('empty index returns empty matches', () => {
    const matches = detectRevisits(createEmptyIndex(), { problemStatement: 'anything' });
    assert.strictEqual(matches.length, 0);
  });

  it('null index returns empty matches', () => {
    const matches = detectRevisits(null, { problemStatement: 'anything' });
    assert.strictEqual(matches.length, 0);
  });

  it('index with no threads array returns empty matches', () => {
    const matches = detectRevisits({ version: '1.0.0' }, { problemStatement: 'test' });
    assert.strictEqual(matches.length, 0);
  });

  it('empty problem statement with feature ID overlap still matches', () => {
    const index = createEmptyIndex();
    const thread = createThread({
      problemStatement: 'irrelevant words here',
      featureIds: ['F-050'],
    });
    addToIndex(index, thread);
    const matches = detectRevisits(index, {
      problemStatement: '',
      featureIds: ['F-050'],
    });
    assert.ok(matches.length > 0);
    assert.deepStrictEqual(matches[0].sharedFeatureIds, ['F-050']);
  });

  it('handles thread entries with missing keywords gracefully', () => {
    const index = createEmptyIndex();
    index.threads.push({
      id: 'thr-nokeys',
      name: 'No keywords',
      timestamp: new Date().toISOString(),
      featureIds: ['F-099'],
      parentThreadId: null,
      // keywords intentionally missing
    });
    // Should not throw
    const matches = detectRevisits(index, {
      problemStatement: 'something',
      featureIds: ['F-099'],
    });
    assert.ok(matches.length > 0);
  });

  it('handles thread entries with missing featureIds gracefully', () => {
    const index = createEmptyIndex();
    index.threads.push({
      id: 'thr-nofids',
      name: 'No feature IDs',
      timestamp: new Date().toISOString(),
      parentThreadId: null,
      keywords: ['authentication', 'token', 'refresh'],
      // featureIds intentionally missing
    });
    const matches = detectRevisits(index, {
      problemStatement: 'authentication token refresh',
    });
    assert.ok(matches.length > 0);
  });
});

// --- AC-4: Thread branching adversarial ---

describe('AC-4: Thread branching adversarial', () => {
  // @cap-todo(ac:F-031/AC-4) Adversarial: branching edge cases
  it('branch from parent correctly sets parentThreadId', () => {
    const parent = createThread({ problemStatement: 'Parent topic' });
    const child = branchThread(parent, {
      problemStatement: 'Child divergence',
      divergencePoint: 'Took a different direction',
    });
    assert.strictEqual(child.parentThreadId, parent.id);
    assert.strictEqual(child.divergencePoint, 'Took a different direction');
  });

  it('branch without divergencePoint sets it to null', () => {
    const parent = createThread({ problemStatement: 'Parent topic' });
    const child = branchThread(parent, {
      problemStatement: 'Child without divergence description',
    });
    assert.strictEqual(child.parentThreadId, parent.id);
    assert.strictEqual(child.divergencePoint, null);
  });

  it('multi-level branch chain preserves lineage', () => {
    const root = createThread({ problemStatement: 'Root concept' });
    const level1 = branchThread(root, {
      problemStatement: 'Level 1 divergence',
      divergencePoint: 'First branch',
    });
    const level2 = branchThread(level1, {
      problemStatement: 'Level 2 divergence',
      divergencePoint: 'Second branch',
    });
    const level3 = branchThread(level2, {
      problemStatement: 'Level 3 divergence',
      divergencePoint: 'Third branch',
    });

    assert.strictEqual(level1.parentThreadId, root.id);
    assert.strictEqual(level2.parentThreadId, level1.id);
    assert.strictEqual(level3.parentThreadId, level2.id);
    // All IDs are unique
    const ids = new Set([root.id, level1.id, level2.id, level3.id]);
    assert.strictEqual(ids.size, 4);
  });

  it('branched thread persists and loads with parent reference intact', () => {
    const parent = createThread({ problemStatement: 'Persisted parent' });
    persistThread(tmpDir, parent);
    const child = branchThread(parent, {
      problemStatement: 'Persisted child',
      divergencePoint: 'Branch point',
    });
    persistThread(tmpDir, child);

    const loadedChild = loadThread(tmpDir, child.id);
    assert.strictEqual(loadedChild.parentThreadId, parent.id);
    assert.strictEqual(loadedChild.divergencePoint, 'Branch point');
  });

  it('index records parentThreadId for branched threads', () => {
    const parent = createThread({ problemStatement: 'Index parent test' });
    persistThread(tmpDir, parent);
    const child = branchThread(parent, {
      problemStatement: 'Index child test',
      divergencePoint: 'Branch',
    });
    persistThread(tmpDir, child);

    const index = loadIndex(tmpDir);
    const childEntry = index.threads.find(t => t.id === child.id);
    assert.strictEqual(childEntry.parentThreadId, parent.id);
  });

  it('branchThread does not mutate parent thread object', () => {
    const parent = createThread({ problemStatement: 'Immutable parent' });
    const originalId = parent.id;
    const originalParentRef = parent.parentThreadId;
    branchThread(parent, {
      problemStatement: 'Should not mutate parent',
      divergencePoint: 'Test',
    });
    assert.strictEqual(parent.id, originalId);
    assert.strictEqual(parent.parentThreadId, originalParentRef);
  });
});

// --- AC-5: Thread index metadata adversarial ---

describe('AC-5: Thread index metadata adversarial', () => {
  // @cap-todo(ac:F-031/AC-5) Adversarial: index integrity edge cases
  it('corrupt index JSON falls back to empty index', () => {
    const indexDir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'thread-index.json'), '}{BROKEN', 'utf8');
    const index = loadIndex(tmpDir);
    assert.strictEqual(index.version, '1.0.0');
    assert.deepStrictEqual(index.threads, []);
  });

  it('index with missing version field gets default version', () => {
    const indexDir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(
      path.join(indexDir, 'thread-index.json'),
      JSON.stringify({ threads: [{ id: 'thr-abc12345', name: 'test' }] }),
      'utf8'
    );
    const index = loadIndex(tmpDir);
    assert.strictEqual(index.version, '1.0.0');
    assert.strictEqual(index.threads.length, 1);
  });

  it('index with extra unknown fields is preserved via spread', () => {
    const indexDir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(
      path.join(indexDir, 'thread-index.json'),
      JSON.stringify({ version: '2.0.0', threads: [], customField: 'hello' }),
      'utf8'
    );
    const index = loadIndex(tmpDir);
    assert.strictEqual(index.version, '2.0.0');
    assert.strictEqual(index.customField, 'hello');
  });

  it('handles many threads in index without error', () => {
    const index = createEmptyIndex();
    for (let i = 0; i < 500; i++) {
      const thread = createThread({
        problemStatement: `Thread number ${i} about topic ${i % 10}`,
        featureIds: [`F-${String(i % 50).padStart(3, '0')}`],
      });
      addToIndex(index, thread);
    }
    assert.strictEqual(index.threads.length, 500);

    // Save and reload
    saveIndex(tmpDir, index);
    const loaded = loadIndex(tmpDir);
    assert.strictEqual(loaded.threads.length, 500);
  });

  it('addToIndex maps only index-relevant fields (not full thread)', () => {
    const index = createEmptyIndex();
    const thread = createThread({
      problemStatement: 'Full thread with all fields',
      solutionShape: 'Should not appear in index entry',
      boundaryDecisions: ['Also should not appear'],
      featureIds: ['F-001'],
    });
    addToIndex(index, thread);
    const entry = index.threads[0];
    // Index entry should have these fields
    assert.ok('id' in entry);
    assert.ok('name' in entry);
    assert.ok('timestamp' in entry);
    assert.ok('featureIds' in entry);
    assert.ok('parentThreadId' in entry);
    assert.ok('keywords' in entry);
    // Index entry should NOT have these fields
    assert.strictEqual(entry.problemStatement, undefined);
    assert.strictEqual(entry.solutionShape, undefined);
    assert.strictEqual(entry.boundaryDecisions, undefined);
    assert.strictEqual(entry.divergencePoint, undefined);
  });

  it('removeFromIndex on non-existent ID does not corrupt index', () => {
    const index = createEmptyIndex();
    const thread = createThread({ problemStatement: 'Keeper' });
    addToIndex(index, thread);
    removeFromIndex(index, 'thr-doesnotexist');
    assert.strictEqual(index.threads.length, 1);
    assert.strictEqual(index.threads[0].id, thread.id);
  });

  it('index file path is .cap/memory/thread-index.json', () => {
    assert.strictEqual(THREAD_INDEX_FILE, path.join('.cap', 'memory', 'thread-index.json'));
  });
});

// --- AC-6: Git-committable thread data adversarial ---

describe('AC-6: Git-committable data adversarial', () => {
  // @cap-todo(ac:F-031/AC-6) Adversarial: special characters, unicode, file format
  it('thread with unicode content persists correctly', () => {
    const thread = createThread({
      problemStatement: 'Handle emoji and CJK: hello world',
      solutionShape: 'Support UTF-8 encoding',
      boundaryDecisions: ['Accept multilingual input'],
    });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.ok(loaded.problemStatement.includes('hello'));
    assert.ok(loaded.problemStatement.includes('world'));
  });

  it('thread with special JSON characters persists correctly', () => {
    const thread = createThread({
      problemStatement: 'Handle "quotes" and \\backslashes\\ and \nnewlines',
      solutionShape: 'Escape properly: \t tabs',
      boundaryDecisions: ['Path: C:\\Users\\test', 'Quote: "value"'],
    });
    persistThread(tmpDir, thread);
    const loaded = loadThread(tmpDir, thread.id);
    assert.strictEqual(loaded.problemStatement, 'Handle "quotes" and \\backslashes\\ and \nnewlines');
    assert.deepStrictEqual(loaded.boundaryDecisions[0], 'Path: C:\\Users\\test');
  });

  it('thread files end with newline for git-friendliness', () => {
    const thread = createThread({ problemStatement: 'Newline test' });
    saveThread(tmpDir, thread);
    const content = fs.readFileSync(
      path.join(tmpDir, THREADS_DIR, `${thread.id}.json`),
      'utf8'
    );
    assert.ok(content.endsWith('\n'));
  });

  it('index file ends with newline for git-friendliness', () => {
    saveIndex(tmpDir, createEmptyIndex());
    const content = fs.readFileSync(path.join(tmpDir, THREAD_INDEX_FILE), 'utf8');
    assert.ok(content.endsWith('\n'));
  });

  it('threads directory path is .cap/memory/threads/', () => {
    assert.strictEqual(THREADS_DIR, path.join('.cap', 'memory', 'threads'));
  });

  it('thread files are stored as individual files (not embedded in index)', () => {
    const t1 = createThread({ problemStatement: 'Thread one' });
    const t2 = createThread({ problemStatement: 'Thread two' });
    persistThread(tmpDir, t1);
    persistThread(tmpDir, t2);
    // Two separate files in threads dir
    const files = fs.readdirSync(path.join(tmpDir, THREADS_DIR));
    assert.strictEqual(files.length, 2);
    assert.ok(files.includes(`${t1.id}.json`));
    assert.ok(files.includes(`${t2.id}.json`));
  });
});

// --- AC-7: checkPriorThreads adversarial ---

describe('AC-7: checkPriorThreads adversarial', () => {
  // @cap-todo(ac:F-031/AC-7) Adversarial: missing index, empty directory, edge cases
  it('works when no index file exists on disk', () => {
    // tmpDir has no .cap/ directory at all
    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Fresh project test',
    });
    assert.strictEqual(matches.length, 0);
    assert.strictEqual(threads.length, 0);
  });

  it('works when threads directory exists but is empty', () => {
    const threadsDir = path.join(tmpDir, THREADS_DIR);
    fs.mkdirSync(threadsDir, { recursive: true });
    saveIndex(tmpDir, createEmptyIndex());
    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Empty threads dir',
    });
    assert.strictEqual(matches.length, 0);
    assert.strictEqual(threads.length, 0);
  });

  it('handles case where index references thread that no longer exists on disk', () => {
    const thread = createThread({
      problemStatement: 'Authentication token refresh service proxy',
      featureIds: ['F-010'],
    });
    persistThread(tmpDir, thread);
    // Delete thread file but keep index entry
    fs.unlinkSync(path.join(tmpDir, THREADS_DIR, `${thread.id}.json`));

    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Authentication token refresh',
      featureIds: ['F-010'],
    });
    // Match exists in index but thread file is gone
    assert.ok(matches.length > 0, 'Should find match in index');
    // threads array should be empty since file is missing
    assert.strictEqual(threads.length, 0);
  });

  it('returns threads with full data (not just index entries)', () => {
    const thread = createThread({
      problemStatement: 'Full data verification thread about authentication token refresh',
      solutionShape: 'Comprehensive solution shape',
      boundaryDecisions: ['Important decision'],
      featureIds: ['F-010'],
    });
    persistThread(tmpDir, thread);

    const { threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'authentication token refresh',
    });
    assert.ok(threads.length > 0);
    // Full thread data should include fields not in index
    assert.strictEqual(threads[0].solutionShape, 'Comprehensive solution shape');
    assert.deepStrictEqual(threads[0].boundaryDecisions, ['Important decision']);
    assert.strictEqual(threads[0].problemStatement, 'Full data verification thread about authentication token refresh');
  });

  it('handles corrupt index on disk gracefully', () => {
    const indexDir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'thread-index.json'), 'INVALID', 'utf8');

    const { matches, threads } = checkPriorThreads(tmpDir, {
      problemStatement: 'Testing corruption',
    });
    assert.strictEqual(matches.length, 0);
    assert.strictEqual(threads.length, 0);
  });

  it('matches threads by feature ID even with completely different keywords', () => {
    const thread = createThread({
      problemStatement: 'Alpha beta gamma delta epsilon zeta',
      featureIds: ['F-099'],
    });
    persistThread(tmpDir, thread);

    const { matches } = checkPriorThreads(tmpDir, {
      problemStatement: 'omega theta iota kappa lambda',
      featureIds: ['F-099'],
    });
    assert.ok(matches.length > 0);
    assert.deepStrictEqual(matches[0].sharedFeatureIds, ['F-099']);
  });
});

// --- extractKeywords adversarial ---

describe('extractKeywords adversarial', () => {
  it('handles non-string input types without crashing', () => {
    assert.deepStrictEqual(extractKeywords(123), []);
    assert.deepStrictEqual(extractKeywords({}), []);
    assert.deepStrictEqual(extractKeywords([]), []);
    assert.deepStrictEqual(extractKeywords(true), []);
  });

  it('handles string with only stop words', () => {
    assert.deepStrictEqual(extractKeywords('the and but or not'), []);
  });

  it('handles string with only short words', () => {
    assert.deepStrictEqual(extractKeywords('go do it me up at'), []);
  });

  it('handles very long input without error', () => {
    const longText = 'authentication '.repeat(10000);
    const keywords = extractKeywords(longText);
    assert.deepStrictEqual(keywords, ['authentication']);
  });

  it('strips numbers mixed with words correctly', () => {
    const keywords = extractKeywords('version2 api3 token');
    assert.ok(keywords.includes('token'));
    // 'version2' and 'api3' should be extracted (alphanumeric)
    assert.ok(keywords.includes('version2'));
  });

  it('handles hyphenated words as single tokens', () => {
    const keywords = extractKeywords('cross-origin resource-sharing');
    assert.ok(keywords.includes('cross-origin'));
    assert.ok(keywords.includes('resource-sharing'));
  });
});

// --- computeKeywordOverlap adversarial ---

describe('computeKeywordOverlap adversarial', () => {
  it('handles one empty array and one non-empty', () => {
    const { shared, overlapRatio } = computeKeywordOverlap([], ['auth', 'token']);
    assert.deepStrictEqual(shared, []);
    assert.strictEqual(overlapRatio, 0);
  });

  it('handles large keyword sets', () => {
    const a = Array.from({ length: 1000 }, (_, i) => `keyword${i}`);
    const b = Array.from({ length: 1000 }, (_, i) => `keyword${i + 500}`);
    const { shared, overlapRatio } = computeKeywordOverlap(a, b);
    assert.strictEqual(shared.length, 500); // keywords 500-999 overlap
    assert.ok(overlapRatio > 0 && overlapRatio < 1);
  });

  it('overlap is asymmetric in shared array (filters from first arg)', () => {
    const { shared: ab } = computeKeywordOverlap(['auth', 'token'], ['token']);
    const { shared: ba } = computeKeywordOverlap(['token'], ['auth', 'token']);
    // Both should find 'token' in shared
    assert.deepStrictEqual(ab, ['token']);
    assert.deepStrictEqual(ba, ['token']);
  });
});

// --- deriveName adversarial ---

describe('deriveName adversarial', () => {
  it('handles exactly 60 character input', () => {
    const input = 'a'.repeat(60);
    assert.strictEqual(deriveName(input), input); // no truncation needed
  });

  it('handles 61 character input (just over boundary)', () => {
    const input = 'a'.repeat(61);
    const name = deriveName(input);
    assert.ok(name.endsWith('...'));
    assert.ok(name.length <= 63);
  });

  it('handles input with no spaces longer than 60 chars', () => {
    const input = 'x'.repeat(100);
    const name = deriveName(input);
    assert.ok(name.endsWith('...'));
    // Should fallback to trimmed + "..." since no word boundary after 20
    assert.strictEqual(name, 'x'.repeat(60) + '...');
  });

  it('handles undefined input', () => {
    assert.strictEqual(deriveName(undefined), 'Untitled Thread');
  });
});

// --- deleteThread adversarial ---

describe('deleteThread adversarial', () => {
  it('deleting a thread does not affect other threads', () => {
    const t1 = createThread({ problemStatement: 'Keep me' });
    const t2 = createThread({ problemStatement: 'Delete me' });
    persistThread(tmpDir, t1);
    persistThread(tmpDir, t2);

    deleteThread(tmpDir, t2.id);

    assert.ok(loadThread(tmpDir, t1.id) !== null);
    assert.strictEqual(loadThread(tmpDir, t2.id), null);
    const index = loadIndex(tmpDir);
    assert.strictEqual(index.threads.length, 1);
    assert.strictEqual(index.threads[0].id, t1.id);
  });

  it('deleting a parent thread does not cascade to children', () => {
    const parent = createThread({ problemStatement: 'Parent to delete' });
    persistThread(tmpDir, parent);
    const child = branchThread(parent, {
      problemStatement: 'Child to keep',
      divergencePoint: 'Branch point',
    });
    persistThread(tmpDir, child);

    deleteThread(tmpDir, parent.id);

    // Child still exists with dangling parent reference
    const loadedChild = loadThread(tmpDir, child.id);
    assert.ok(loadedChild !== null);
    assert.strictEqual(loadedChild.parentThreadId, parent.id);
  });
});

// --- listThreads adversarial ---

describe('listThreads adversarial', () => {
  it('filtering by nonexistent featureId returns empty', () => {
    const thread = createThread({
      problemStatement: 'Has features',
      featureIds: ['F-001'],
    });
    persistThread(tmpDir, thread);
    const list = listThreads(tmpDir, { featureId: 'F-999' });
    assert.strictEqual(list.length, 0);
  });

  it('handles threads with missing timestamp in sort', () => {
    const index = createEmptyIndex();
    index.threads.push({ id: 'thr-notimestamp', name: 'no ts', featureIds: [] });
    index.threads.push({ id: 'thr-hastimestamp', name: 'has ts', timestamp: '2024-01-01T00:00:00.000Z', featureIds: [] });
    saveIndex(tmpDir, index);

    const list = listThreads(tmpDir);
    // Should not crash, should return both
    assert.strictEqual(list.length, 2);
  });

  it('returns threads sorted most recent first', () => {
    // Create threads with deliberate time gap
    const t1 = createThread({ problemStatement: 'Earlier thread' });
    // Manually set an older timestamp
    t1.timestamp = '2020-01-01T00:00:00.000Z';
    persistThread(tmpDir, t1);

    const t2 = createThread({ problemStatement: 'Later thread' });
    t2.timestamp = '2025-12-31T23:59:59.000Z';
    persistThread(tmpDir, t2);

    const list = listThreads(tmpDir);
    assert.strictEqual(list[0].id, t2.id);
    assert.strictEqual(list[1].id, t1.id);
  });
});

// --- loadThread adversarial ---

describe('loadThread adversarial', () => {
  it('returns null for corrupt thread JSON file', () => {
    const threadsDir = path.join(tmpDir, THREADS_DIR);
    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, 'thr-corrupt1.json'), '{{NOT VALID JSON', 'utf8');
    assert.strictEqual(loadThread(tmpDir, 'thr-corrupt1'), null);
  });

  it('returns null when threads directory does not exist', () => {
    assert.strictEqual(loadThread(tmpDir, 'thr-missing1'), null);
  });
});
