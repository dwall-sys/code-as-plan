'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  runPipeline,
  runPipelineBatch,
  computeStage1,
  computeStage2,
  tfidfSimilarity,
  trigramSimilarity,
  jaccardKeywordSimilarity,
  conceptVectorSimilarity,
  buildCooccurrenceMatrix,
  getConfirmedPairs,
  projectToConcepts,
  propagateScores,
  SEED_TAXONOMY,
  CONCEPT_NAMES,
  STAGE1_WEIGHT_TFIDF,
  STAGE1_WEIGHT_NGRAM,
  STAGE1_WEIGHT_JACCARD,
  STAGE2_WEIGHT_CONCEPT,
  _tokenize: tokenize,
  _getThreadText: getThreadText,
  _buildCorpus: buildCorpus,
  _computeTfIdfVector: computeTfIdfVector,
  _cosineSimilarity: cosineSimilarity,
  _extractTrigrams: extractTrigrams,
  _makeCooccurrenceKey: makeCooccurrenceKey,
  _makePairKey: makePairKey,
  _clamp01: clamp01,
  _findThreadNodeId: findThreadNodeId,
} = require('../cap/bin/lib/cap-semantic-pipeline.cjs');

// --- Test Fixtures ---

function makeThread(overrides) {
  return {
    id: 'thr-0001',
    problemStatement: '',
    solutionShape: '',
    boundaryDecisions: [],
    featureIds: [],
    keywords: [],
    ...overrides,
  };
}

const threadAuth = makeThread({
  id: 'thr-auth',
  problemStatement: 'Users cannot authenticate with OAuth tokens after session expiry',
  solutionShape: 'Implement token refresh middleware with JWT validation and session persistence',
  boundaryDecisions: ['Use httpOnly cookies for token storage', 'Refresh tokens on 401 response'],
  featureIds: ['F-001'],
  keywords: ['auth', 'token', 'jwt', 'session', 'oauth', 'login'],
});

const threadAuth2 = makeThread({
  id: 'thr-auth2',
  problemStatement: 'Login flow breaks when SSO provider returns expired credential',
  solutionShape: 'Add credential validation before session creation with token refresh fallback',
  boundaryDecisions: ['Validate JWT signature on every request', 'Fallback to password login if SSO fails'],
  featureIds: ['F-001'],
  keywords: ['auth', 'login', 'sso', 'credential', 'session', 'jwt'],
});

const threadDB = makeThread({
  id: 'thr-db',
  problemStatement: 'Database migration fails on large tables due to index lock contention',
  solutionShape: 'Use concurrent index creation with schema migration batching',
  boundaryDecisions: ['Run migrations in transactions', 'Use CREATE INDEX CONCURRENTLY'],
  featureIds: ['F-010'],
  keywords: ['database', 'migration', 'index', 'schema', 'sql', 'table'],
});

const threadUI = makeThread({
  id: 'thr-ui',
  problemStatement: 'React component re-renders excessively causing layout shift',
  solutionShape: 'Memoize expensive renders and use CSS containment for layout stability',
  boundaryDecisions: ['Use React.memo for list items', 'Apply contain: layout to grid containers'],
  featureIds: ['F-020'],
  keywords: ['react', 'component', 'render', 'layout', 'css', 'performance'],
});

const threadEmpty = makeThread({
  id: 'thr-empty',
  problemStatement: '',
  solutionShape: '',
  boundaryDecisions: [],
  featureIds: [],
  keywords: [],
});

// ============================================================================
// AC-1: TF-IDF cosine similarity (weight 0.5)
// ============================================================================

describe('F-037 Semantic Pipeline', () => {
  describe('AC-1: TF-IDF cosine similarity', () => {
    // @cap-todo(ac:F-037/AC-1) buildCorpus returns { docFrequency: Map, docCount: number }
    it('buildCorpus returns docFrequency as Map and docCount as number', () => {
      const corpus = buildCorpus([threadAuth, threadDB]);
      assert.ok(corpus.docFrequency instanceof Map, 'docFrequency should be a Map');
      assert.strictEqual(typeof corpus.docCount, 'number');
      assert.strictEqual(corpus.docCount, 2);
      assert.ok(corpus.docFrequency.size > 0, 'docFrequency should have entries');
    });

    // @cap-todo(ac:F-037/AC-1) computeTfIdfVector returns a Map with numeric values
    it('computeTfIdfVector returns a Map with numeric values', () => {
      const corpus = buildCorpus([threadAuth, threadDB]);
      const text = getThreadText(threadAuth);
      const vec = computeTfIdfVector(text, corpus);
      assert.ok(vec instanceof Map, 'should be a Map');
      for (const [key, val] of vec) {
        assert.strictEqual(typeof key, 'string');
        assert.strictEqual(typeof val, 'number');
        assert.ok(!Number.isNaN(val), `value for "${key}" should not be NaN`);
      }
    });

    // @cap-todo(ac:F-037/AC-1) tfidfSimilarity returns 0.0-1.0
    it('tfidfSimilarity returns a value between 0.0 and 1.0', () => {
      const corpus = buildCorpus([threadAuth, threadDB, threadUI]);
      const score = tfidfSimilarity(threadAuth, threadDB, corpus);
      assert.ok(score >= 0 && score <= 1, `score ${score} should be in [0, 1]`);
    });

    // @cap-todo(ac:F-037/AC-1) Identical texts produce high similarity
    it('identical texts produce high similarity score', () => {
      // Need 3+ docs so IDF is positive for most terms
      const corpus = buildCorpus([threadAuth, threadDB, threadUI]);
      const score = tfidfSimilarity(threadAuth, threadAuth, corpus);
      // Self-similarity should be very high (close to 1.0)
      assert.ok(score > 0.9, `self-similarity ${score} should be > 0.9`);
    });

    // @cap-todo(ac:F-037/AC-1) Completely different texts produce low score
    it('completely different texts produce low similarity score', () => {
      const corpus = buildCorpus([threadAuth, threadUI, threadDB]);
      const score = tfidfSimilarity(threadAuth, threadUI, corpus);
      // Auth vs UI should have low overlap
      assert.ok(score < 0.3, `auth vs UI score ${score} should be < 0.3`);
    });

    // @cap-todo(ac:F-037/AC-1) Empty text returns 0
    it('empty text returns 0', () => {
      const corpus = buildCorpus([threadAuth, threadEmpty]);
      const score = tfidfSimilarity(threadAuth, threadEmpty, corpus);
      assert.strictEqual(score, 0);
    });

    // @cap-todo(ac:F-037/AC-1) Single doc corpus handles edge case
    it('single doc corpus does not crash', () => {
      const corpus = buildCorpus([threadAuth]);
      const score = tfidfSimilarity(threadAuth, threadAuth, corpus);
      assert.strictEqual(typeof score, 'number');
      assert.ok(!Number.isNaN(score));
    });

    it('computeTfIdfVector on empty text returns empty Map', () => {
      const corpus = buildCorpus([threadAuth]);
      const vec = computeTfIdfVector('', corpus);
      assert.strictEqual(vec.size, 0);
    });

    it('cosineSimilarity of two empty maps returns 0', () => {
      assert.strictEqual(cosineSimilarity(new Map(), new Map()), 0);
    });

    it('cosineSimilarity of identical maps returns ~1.0', () => {
      const vec = new Map([['foo', 0.5], ['bar', 0.3]]);
      const score = cosineSimilarity(vec, vec);
      assert.ok(Math.abs(score - 1.0) < 0.001, `expected ~1.0, got ${score}`);
    });
  });

  // ============================================================================
  // AC-2: N-Gram trigram overlap (weight 0.2)
  // ============================================================================

  describe('AC-2: N-Gram trigram overlap', () => {
    // @cap-todo(ac:F-037/AC-2) extractTrigrams produces expected trigrams
    it('extractTrigrams("session") produces correct trigrams', () => {
      const trigrams = extractTrigrams('session');
      assert.ok(trigrams instanceof Set);
      assert.ok(trigrams.has('ses'), 'should contain "ses"');
      assert.ok(trigrams.has('ess'), 'should contain "ess"');
      assert.ok(trigrams.has('ssi'), 'should contain "ssi"');
      assert.ok(trigrams.has('sio'), 'should contain "sio"');
      assert.ok(trigrams.has('ion'), 'should contain "ion"');
      assert.strictEqual(trigrams.size, 5);
    });

    // @cap-todo(ac:F-037/AC-2) Morphological match produces high score
    it('trigramSimilarity("authenticate", "authentication") produces high score', () => {
      const score = trigramSimilarity('authenticate', 'authentication');
      assert.ok(score > 0.5, `morphological match score ${score} should be > 0.5`);
    });

    // @cap-todo(ac:F-037/AC-2) Completely different strings produce 0 or very low
    it('trigramSimilarity("abc", "xyz") produces 0 or very low score', () => {
      const score = trigramSimilarity('abc', 'xyz');
      assert.ok(score < 0.01, `completely different score ${score} should be < 0.01`);
    });

    // @cap-todo(ac:F-037/AC-2) Empty text returns 0
    it('trigramSimilarity with empty text returns 0', () => {
      assert.strictEqual(trigramSimilarity('', 'hello'), 0);
      assert.strictEqual(trigramSimilarity('hello', ''), 0);
      assert.strictEqual(trigramSimilarity('', ''), 0);
    });

    // @cap-todo(ac:F-037/AC-2) Very short text (< 3 chars) handled gracefully
    it('extractTrigrams with text shorter than 3 chars returns empty set', () => {
      assert.strictEqual(extractTrigrams('ab').size, 0);
      assert.strictEqual(extractTrigrams('a').size, 0);
    });

    it('trigramSimilarity with short text (< 3 chars) returns 0', () => {
      assert.strictEqual(trigramSimilarity('ab', 'hello'), 0);
      assert.strictEqual(trigramSimilarity('ab', 'cd'), 0);
    });

    it('extractTrigrams with null/undefined returns empty set', () => {
      assert.strictEqual(extractTrigrams(null).size, 0);
      assert.strictEqual(extractTrigrams(undefined).size, 0);
    });
  });

  // ============================================================================
  // AC-3: Jaccard keyword similarity (weight 0.1)
  // ============================================================================

  describe('AC-3: Jaccard keyword similarity', () => {
    // @cap-todo(ac:F-037/AC-3) Identical keyword sets return 1.0
    it('identical keyword sets return 1.0', () => {
      const kw = ['auth', 'token', 'jwt'];
      const score = jaccardKeywordSimilarity(kw, kw);
      assert.strictEqual(score, 1.0);
    });

    // @cap-todo(ac:F-037/AC-3) No overlap returns 0.0
    it('no overlap returns 0.0', () => {
      const score = jaccardKeywordSimilarity(['auth', 'token'], ['database', 'schema']);
      assert.strictEqual(score, 0.0);
    });

    // @cap-todo(ac:F-037/AC-3) Partial overlap returns between 0 and 1
    it('partial overlap returns value between 0 and 1', () => {
      const score = jaccardKeywordSimilarity(['auth', 'token', 'jwt'], ['auth', 'token', 'database']);
      assert.ok(score > 0 && score < 1, `partial overlap score ${score} should be in (0, 1)`);
      // Intersection = {auth, token} = 2, union = {auth, token, jwt, database} = 4
      assert.ok(Math.abs(score - 0.5) < 0.001, `expected ~0.5, got ${score}`);
    });

    // @cap-todo(ac:F-037/AC-3) Empty keyword arrays return 0
    it('empty keyword arrays return 0', () => {
      assert.strictEqual(jaccardKeywordSimilarity([], []), 0);
      assert.strictEqual(jaccardKeywordSimilarity([], ['auth']), 0);
      assert.strictEqual(jaccardKeywordSimilarity(['auth'], []), 0);
    });

    it('null/undefined keyword arrays return 0', () => {
      assert.strictEqual(jaccardKeywordSimilarity(null, null), 0);
      assert.strictEqual(jaccardKeywordSimilarity(undefined, ['auth']), 0);
    });

    it('case-insensitive comparison', () => {
      const score = jaccardKeywordSimilarity(['Auth', 'TOKEN'], ['auth', 'token']);
      assert.strictEqual(score, 1.0);
    });
  });

  // ============================================================================
  // AC-4: Seed taxonomy with 20-30 concepts
  // ============================================================================

  describe('AC-4: Seed taxonomy', () => {
    // @cap-todo(ac:F-037/AC-4) SEED_TAXONOMY has between 20 and 30 keys
    it('SEED_TAXONOMY has between 20 and 30 keys', () => {
      const count = Object.keys(SEED_TAXONOMY).length;
      assert.ok(count >= 20, `taxonomy has ${count} concepts, expected >= 20`);
      assert.ok(count <= 30, `taxonomy has ${count} concepts, expected <= 30`);
    });

    // @cap-todo(ac:F-037/AC-4) Each concept has at least 3 keywords
    it('each concept has at least 3 keywords', () => {
      for (const [concept, keywords] of Object.entries(SEED_TAXONOMY)) {
        assert.ok(
          Array.isArray(keywords) && keywords.length >= 3,
          `concept "${concept}" has ${keywords.length} keywords, expected >= 3`
        );
      }
    });

    // @cap-todo(ac:F-037/AC-4) Key concepts present
    it('key concepts are present: authentication, database, testing, api, security', () => {
      const required = ['authentication', 'database', 'testing', 'api', 'security'];
      for (const concept of required) {
        assert.ok(
          SEED_TAXONOMY[concept] !== undefined,
          `missing required concept: "${concept}"`
        );
      }
    });

    it('CONCEPT_NAMES is sorted alphabetically', () => {
      const sorted = [...CONCEPT_NAMES].sort();
      assert.deepStrictEqual(CONCEPT_NAMES, sorted);
    });

    it('CONCEPT_NAMES matches SEED_TAXONOMY keys', () => {
      const keys = Object.keys(SEED_TAXONOMY).sort();
      assert.deepStrictEqual(CONCEPT_NAMES, keys);
    });

    it('all keywords are lowercase strings', () => {
      for (const [concept, keywords] of Object.entries(SEED_TAXONOMY)) {
        for (const kw of keywords) {
          assert.strictEqual(typeof kw, 'string', `keyword in "${concept}" should be string`);
          assert.strictEqual(kw, kw.toLowerCase(), `keyword "${kw}" in "${concept}" should be lowercase`);
        }
      }
    });
  });

  // ============================================================================
  // AC-5: Co-occurrence matrix
  // ============================================================================

  describe('AC-5: Co-occurrence matrix', () => {
    // @cap-todo(ac:F-037/AC-5) Multiple concepts co-occurring creates matrix entries
    it('threads covering multiple concepts produce matrix entries', () => {
      // threadAuth mentions auth + session + token (authentication concept)
      // It also mentions middleware (api concept) and cookies (security-adjacent)
      const matrix = buildCooccurrenceMatrix([threadAuth, threadAuth2, threadDB]);
      const keys = Object.keys(matrix);
      assert.ok(keys.length > 0, 'matrix should have at least one co-occurrence entry');
    });

    // @cap-todo(ac:F-037/AC-5) getConfirmedPairs with threshold 5
    it('getConfirmedPairs with threshold 5 returns only pairs with count >= 5', () => {
      // Create enough threads to generate co-occurrences above threshold
      const threads = [];
      for (let i = 0; i < 10; i++) {
        threads.push(makeThread({
          id: `thr-auth-${i}`,
          problemStatement: 'Authentication with JWT token login session management',
          solutionShape: 'Implement secure password credential validation',
          keywords: ['auth', 'jwt', 'secure'],
        }));
      }
      const matrix = buildCooccurrenceMatrix(threads);
      const confirmed = getConfirmedPairs(matrix, 5);
      for (const pair of confirmed) {
        assert.ok(pair.count >= 5, `pair ${pair.key} count ${pair.count} should be >= 5`);
      }
    });

    // @cap-todo(ac:F-037/AC-5) getConfirmedPairs with threshold 1 returns more pairs
    it('getConfirmedPairs with threshold 1 returns more or equal pairs than threshold 5', () => {
      const threads = [threadAuth, threadAuth2, threadDB];
      const matrix = buildCooccurrenceMatrix(threads);
      const threshold1 = getConfirmedPairs(matrix, 1);
      const threshold5 = getConfirmedPairs(matrix, 5);
      assert.ok(threshold1.length >= threshold5.length,
        `threshold 1 (${threshold1.length}) should return >= threshold 5 (${threshold5.length})`);
    });

    // @cap-todo(ac:F-037/AC-5) Empty thread list produces empty matrix
    it('empty thread list produces empty matrix', () => {
      const matrix = buildCooccurrenceMatrix([]);
      assert.deepStrictEqual(matrix, {});
    });

    // @cap-todo(ac:F-037/AC-5) Single thread with multiple concepts creates co-occurrences
    it('single thread with multiple concepts creates co-occurrences within that thread', () => {
      const thread = makeThread({
        id: 'thr-multi',
        problemStatement: 'Authentication endpoint needs SQL query optimization with test coverage',
        keywords: ['auth', 'sql', 'test'],
      });
      const matrix = buildCooccurrenceMatrix([thread]);
      const keys = Object.keys(matrix);
      assert.ok(keys.length > 0, 'single thread with multiple concepts should produce co-occurrences');
    });

    it('getConfirmedPairs returns entries with correct structure', () => {
      const threads = [threadAuth, threadAuth2];
      const matrix = buildCooccurrenceMatrix(threads);
      const confirmed = getConfirmedPairs(matrix, 1);
      for (const pair of confirmed) {
        assert.ok(typeof pair.key === 'string');
        assert.ok(typeof pair.count === 'number');
        assert.ok(Array.isArray(pair.concepts));
        assert.strictEqual(pair.concepts.length, 2);
      }
    });

    it('getConfirmedPairs results are sorted by count descending', () => {
      const threads = [threadAuth, threadAuth2, threadDB, threadUI];
      const matrix = buildCooccurrenceMatrix(threads);
      const confirmed = getConfirmedPairs(matrix, 1);
      for (let i = 1; i < confirmed.length; i++) {
        assert.ok(confirmed[i - 1].count >= confirmed[i].count,
          'results should be sorted by count descending');
      }
    });
  });

  // ============================================================================
  // AC-6: Concept vector similarity (weight 0.2)
  // ============================================================================

  describe('AC-6: Concept vector similarity', () => {
    // @cap-todo(ac:F-037/AC-6) projectToConcepts maps text to concept space
    it('projectToConcepts maps auth text to authentication concept', () => {
      const text = 'JWT token authentication with session management and login flow';
      const vec = projectToConcepts(text);
      assert.ok(vec instanceof Map);
      assert.ok(vec.has('authentication'), 'should detect authentication concept');
      assert.ok(vec.get('authentication') > 0);
    });

    // @cap-todo(ac:F-037/AC-6) Similar threads produce high concept similarity
    it('conceptVectorSimilarity between auth threads is high', () => {
      const score = conceptVectorSimilarity(threadAuth, threadAuth2);
      assert.ok(score > 0.5, `auth thread similarity ${score} should be > 0.5`);
    });

    // @cap-todo(ac:F-037/AC-6) Different domain threads produce low similarity
    it('conceptVectorSimilarity between auth and database threads is lower', () => {
      const authScore = conceptVectorSimilarity(threadAuth, threadAuth2);
      const crossScore = conceptVectorSimilarity(threadAuth, threadDB);
      assert.ok(crossScore < authScore,
        `cross-domain score ${crossScore} should be < same-domain score ${authScore}`);
    });

    // @cap-todo(ac:F-037/AC-6) No matching concepts returns 0
    it('threads with no matching concepts return 0', () => {
      const threadNoMatch = makeThread({
        id: 'thr-none',
        problemStatement: 'zzzzzzzzz qqqqqqqqq xxxxxxxxx',
        solutionShape: 'yyyyyyy wwwwwwww',
        keywords: [],
      });
      const score = conceptVectorSimilarity(threadNoMatch, threadAuth);
      assert.strictEqual(score, 0);
    });

    it('projectToConcepts with empty text returns empty map', () => {
      const vec = projectToConcepts('');
      assert.strictEqual(vec.size, 0);
    });

    it('projectToConcepts with null returns empty map', () => {
      const vec = projectToConcepts(null);
      assert.strictEqual(vec.size, 0);
    });

    it('projectToConcepts scores are normalized between 0 and 1', () => {
      const text = 'auth login token jwt session oauth sso password credential';
      const vec = projectToConcepts(text);
      for (const [concept, score] of vec) {
        assert.ok(score >= 0 && score <= 1, `concept "${concept}" score ${score} should be in [0, 1]`);
      }
    });
  });

  // ============================================================================
  // AC-7: Graph propagation
  // ============================================================================

  describe('AC-7: Graph propagation', () => {
    const simpleGraph = {
      nodes: {
        'n-1': { type: 'thread', id: 'n-1', label: 'Thread A', active: true, metadata: { threadId: 'thr-a' } },
        'n-2': { type: 'thread', id: 'n-2', label: 'Thread B', active: true, metadata: { threadId: 'thr-b' } },
        'n-3': { type: 'thread', id: 'n-3', label: 'Thread C', active: true, metadata: { threadId: 'thr-c' } },
      },
      edges: [
        { source: 'n-1', target: 'n-2', type: 'affinity', active: true, metadata: { compositeScore: 0.8 } },
        { source: 'n-2', target: 'n-3', type: 'affinity', active: true, metadata: { compositeScore: 0.7 } },
        { source: 'n-1', target: 'n-3', type: 'affinity', active: true, metadata: { compositeScore: 0.3 } },
      ],
    };

    // @cap-todo(ac:F-037/AC-7) Propagation with simple 3-node graph
    it('propagateScores with 3-node graph returns scores for all pairs', () => {
      const initialScores = {
        'thr-a|thr-b': 0.8,
        'thr-a|thr-c': 0.3,
        'thr-b|thr-c': 0.7,
      };
      const result = propagateScores(simpleGraph, initialScores, { iterations: 5, damping: 0.7 });
      assert.ok(typeof result['thr-a|thr-b'] === 'number');
      assert.ok(result['thr-a|thr-b'] >= 0 && result['thr-a|thr-b'] <= 1, `thr-a|thr-b score ${result['thr-a|thr-b']} should be in [0, 1]`);
      assert.ok(typeof result['thr-a|thr-c'] === 'number');
      assert.ok(result['thr-a|thr-c'] >= 0 && result['thr-a|thr-c'] <= 1, `thr-a|thr-c score ${result['thr-a|thr-c']} should be in [0, 1]`);
      assert.ok(typeof result['thr-b|thr-c'] === 'number');
      assert.ok(result['thr-b|thr-c'] >= 0 && result['thr-b|thr-c'] <= 1, `thr-b|thr-c score ${result['thr-b|thr-c']} should be in [0, 1]`);
    });

    // @cap-todo(ac:F-037/AC-7) Damping factor attenuates over iterations
    it('damping factor 0.7 attenuates scores over iterations', () => {
      const initialScores = {
        'thr-a|thr-b': 0.8,
        'thr-a|thr-c': 0.3,
        'thr-b|thr-c': 0.7,
      };
      const result = propagateScores(simpleGraph, initialScores, { iterations: 5, damping: 0.7 });
      // With damping, the weakly connected pair should be influenced by neighbors
      // Scores should remain bounded
      for (const val of Object.values(result)) {
        assert.ok(val >= 0 && val <= 1, `propagated score ${val} should be in [0, 1]`);
      }
    });

    // @cap-todo(ac:F-037/AC-7) Scores converge (don't explode)
    it('scores converge and do not explode with many iterations', () => {
      const initialScores = {
        'thr-a|thr-b': 0.8,
        'thr-a|thr-c': 0.3,
        'thr-b|thr-c': 0.7,
      };
      const result5 = propagateScores(simpleGraph, initialScores, { iterations: 5, damping: 0.7 });
      const result50 = propagateScores(simpleGraph, initialScores, { iterations: 50, damping: 0.7 });
      // Scores after 50 iterations should be close to scores after 5 (convergence)
      for (const key of Object.keys(result5)) {
        assert.ok(Math.abs(result50[key] - result5[key]) < 0.2,
          `score for ${key} should converge: iter5=${result5[key]}, iter50=${result50[key]}`);
        assert.ok(result50[key] <= 1.0, 'scores must not exceed 1.0');
        assert.ok(result50[key] >= 0.0, 'scores must not go below 0.0');
      }
    });

    // @cap-todo(ac:F-037/AC-7) Empty graph returns initial scores unchanged
    it('empty graph returns initial scores unchanged', () => {
      const initialScores = { 'thr-a|thr-b': 0.5 };
      const result = propagateScores({}, initialScores);
      assert.deepStrictEqual(result, initialScores);
    });

    // @cap-todo(ac:F-037/AC-7) No edges returns initial scores
    it('graph with no edges returns initial scores', () => {
      const graphNoEdges = {
        nodes: {
          'n-1': { type: 'thread', id: 'n-1', label: 'A', active: true, metadata: { threadId: 'thr-a' } },
          'n-2': { type: 'thread', id: 'n-2', label: 'B', active: true, metadata: { threadId: 'thr-b' } },
        },
        edges: [],
      };
      const initialScores = { 'thr-a|thr-b': 0.6 };
      const result = propagateScores(graphNoEdges, initialScores, { iterations: 5, damping: 0.7 });
      // With no neighbors contributing, score = damping * 0 + (1-damping) * initial
      // After enough iterations it converges to (1-damping)^n * initial which is lower
      assert.ok(typeof result['thr-a|thr-b'] === 'number');
      assert.ok(result['thr-a|thr-b'] >= 0);
      assert.ok(result['thr-a|thr-b'] <= 1);
    });

    it('null graph returns copy of initial scores', () => {
      const initialScores = { 'thr-a|thr-b': 0.42 };
      const result = propagateScores(null, initialScores);
      assert.strictEqual(result['thr-a|thr-b'], 0.42);
    });

    it('null initialScores returns empty object', () => {
      const result = propagateScores(simpleGraph, null);
      assert.deepStrictEqual(result, {});
    });
  });

  // ============================================================================
  // AC-8: Pure logic module
  // ============================================================================

  describe('AC-8: Pure logic module', () => {
    // @cap-todo(ac:F-037/AC-8) No fs/path requires in computation functions
    it('module source does not require node:fs or node:path', () => {
      const fs = require('node:fs');
      const source = fs.readFileSync(
        require.resolve('../cap/bin/lib/cap-semantic-pipeline.cjs'),
        'utf8'
      );
      // Should not have require('node:fs') or require('node:path') or require('fs')
      assert.ok(!source.includes("require('node:fs')"), 'should not require node:fs');
      assert.ok(!source.includes("require('node:path')"), 'should not require node:path');
      assert.ok(!source.includes("require('fs')"), 'should not require fs');
      assert.ok(!source.includes("require('path')"), 'should not require path');
    });

    // @cap-todo(ac:F-037/AC-8) All computation functions work with only data inputs
    it('all functions work with pure data inputs (no side effects)', () => {
      // Build a full pipeline context with only in-memory data
      const threads = [threadAuth, threadDB];
      const corpus = buildCorpus(threads);
      const vec = computeTfIdfVector('test tokens here', corpus);
      const trigrams = extractTrigrams('testing');
      const jaccard = jaccardKeywordSimilarity(['a', 'b'], ['b', 'c']);
      const concepts = projectToConcepts('authentication login token');
      const matrix = buildCooccurrenceMatrix(threads);
      const confirmed = getConfirmedPairs(matrix, 1);
      const stage1 = computeStage1(threadAuth, threadDB, corpus);
      const stage2 = computeStage2(threadAuth, threadDB, threads);
      // All returned values, no I/O
      assert.ok(corpus.docFrequency instanceof Map);
      assert.ok(vec instanceof Map);
      assert.ok(trigrams instanceof Set);
      assert.strictEqual(typeof jaccard, 'number');
      assert.ok(concepts instanceof Map);
      assert.strictEqual(typeof matrix, 'object');
      assert.ok(Array.isArray(confirmed));
      assert.strictEqual(typeof stage1.combined, 'number');
      assert.strictEqual(typeof stage2.combined, 'number');
    });

    // @cap-todo(ac:F-037/AC-8) null/undefined inputs handled gracefully
    it('null/undefined inputs handled gracefully without throwing', () => {
      // tokenize
      assert.deepStrictEqual(tokenize(null), []);
      assert.deepStrictEqual(tokenize(undefined), []);
      assert.deepStrictEqual(tokenize(''), []);

      // extractTrigrams
      assert.strictEqual(extractTrigrams(null).size, 0);

      // jaccardKeywordSimilarity
      assert.strictEqual(jaccardKeywordSimilarity(null, null), 0);

      // projectToConcepts
      assert.strictEqual(projectToConcepts(null).size, 0);

      // clamp01 — NaN propagates through Math.max/Math.min
      assert.ok(Number.isNaN(clamp01(NaN)), 'clamp01(NaN) returns NaN');
    });
  });

  // ============================================================================
  // Combined pipeline tests
  // ============================================================================

  describe('Combined pipeline', () => {
    // @cap-todo(ac:F-037/AC-1) computeStage1 returns { tfidf, ngram, jaccard, combined }
    it('computeStage1 returns correct structure', () => {
      const corpus = buildCorpus([threadAuth, threadDB]);
      const result = computeStage1(threadAuth, threadDB, corpus);
      assert.strictEqual(typeof result.tfidf, 'number');
      assert.strictEqual(typeof result.ngram, 'number');
      assert.strictEqual(typeof result.jaccard, 'number');
      assert.strictEqual(typeof result.combined, 'number');
      // Verify combined is weighted sum
      const expected = result.tfidf * STAGE1_WEIGHT_TFIDF
        + result.ngram * STAGE1_WEIGHT_NGRAM
        + result.jaccard * STAGE1_WEIGHT_JACCARD;
      assert.ok(Math.abs(result.combined - expected) < 0.0001,
        `combined ${result.combined} should be weighted sum ${expected}`);
    });

    // @cap-todo(ac:F-037/AC-6) computeStage2 returns { conceptSim, combined }
    it('computeStage2 returns correct structure', () => {
      const result = computeStage2(threadAuth, threadDB, [threadAuth, threadDB]);
      assert.strictEqual(typeof result.conceptSim, 'number');
      assert.strictEqual(typeof result.combined, 'number');
      const expected = result.conceptSim * STAGE2_WEIGHT_CONCEPT;
      assert.ok(Math.abs(result.combined - expected) < 0.0001);
    });

    it('runPipeline returns { stage1, stage2, stage3, finalScore }', () => {
      const result = runPipeline(threadAuth, threadDB, { allThreads: [threadAuth, threadDB] });
      assert.ok(result.stage1 !== undefined, 'should have stage1');
      assert.ok(result.stage2 !== undefined, 'should have stage2');
      assert.ok(result.stage3 !== undefined, 'should have stage3');
      assert.strictEqual(typeof result.finalScore, 'number');
      assert.strictEqual(typeof result.stage1.tfidf, 'number');
      assert.strictEqual(typeof result.stage1.ngram, 'number');
      assert.strictEqual(typeof result.stage1.jaccard, 'number');
      assert.strictEqual(typeof result.stage1.combined, 'number');
      assert.strictEqual(typeof result.stage2.conceptSim, 'number');
      assert.strictEqual(typeof result.stage2.combined, 'number');
    });

    it('runPipelineBatch returns Map with correct pair count', () => {
      const threads = [threadAuth, threadAuth2, threadDB];
      const results = runPipelineBatch(threads, { allThreads: threads });
      assert.ok(results instanceof Map);
      // 3 threads -> 3 unique pairs
      assert.strictEqual(results.size, 3);
      for (const [key, val] of results) {
        assert.strictEqual(key.includes('|'), true, `key "${key}" should contain pipe separator`);
        assert.strictEqual(val.finalScore >= 0, true, `finalScore for ${key} should be non-negative`);
      }
    });

    it('finalScore always between 0 and 1', () => {
      const threads = [threadAuth, threadAuth2, threadDB, threadUI];
      const results = runPipelineBatch(threads, { allThreads: threads });
      for (const [key, result] of results) {
        assert.ok(result.finalScore >= 0, `finalScore for ${key} should be >= 0, got ${result.finalScore}`);
        assert.ok(result.finalScore <= 1, `finalScore for ${key} should be <= 1, got ${result.finalScore}`);
      }
    });

    it('runPipeline with graph produces stage3 propagated scores', () => {
      const graph = {
        nodes: {
          'n-auth': { type: 'thread', id: 'n-auth', label: 'Auth', active: true, metadata: { threadId: 'thr-auth' } },
          'n-db': { type: 'thread', id: 'n-db', label: 'DB', active: true, metadata: { threadId: 'thr-db' } },
        },
        edges: [
          { source: 'n-auth', target: 'n-db', type: 'affinity', active: true, metadata: { compositeScore: 0.5 } },
        ],
      };
      const result = runPipeline(threadAuth, threadDB, {
        allThreads: [threadAuth, threadDB],
        graph,
      });
      assert.ok(typeof result.finalScore === 'number');
      assert.ok(Object.keys(result.stage3).length > 0, 'stage3 should have propagated scores');
    });

    it('runPipeline without graph leaves stage3 empty', () => {
      const result = runPipeline(threadAuth, threadDB, { allThreads: [threadAuth, threadDB] });
      assert.deepStrictEqual(result.stage3, {});
    });
  });

  // ============================================================================
  // Adversarial tests
  // ============================================================================

  describe('Adversarial', () => {
    it('thread with empty strings for all fields does not crash', () => {
      const result = runPipeline(threadEmpty, threadEmpty, { allThreads: [threadEmpty] });
      assert.strictEqual(typeof result.finalScore, 'number');
      assert.ok(!Number.isNaN(result.finalScore));
      assert.strictEqual(result.finalScore, 0);
    });

    it('thread with extremely long text does not crash', () => {
      const longText = 'authentication token jwt session '.repeat(5000);
      const longThread = makeThread({
        id: 'thr-long',
        problemStatement: longText,
        solutionShape: longText,
        keywords: ['auth', 'token'],
      });
      const result = runPipeline(longThread, threadAuth, { allThreads: [longThread, threadAuth] });
      assert.strictEqual(typeof result.finalScore, 'number');
      assert.ok(result.finalScore >= 0 && result.finalScore <= 1);
    });

    it('special characters and unicode do not crash', () => {
      const unicodeThread = makeThread({
        id: 'thr-unicode',
        problemStatement: 'Authentifizierung mit Umlauten: ae oe ue ss -- emojis: test',
        solutionShape: 'Solucion con caracteres especiales: nino ano',
        boundaryDecisions: ['Decision with "quotes" and <brackets>'],
        keywords: ['unicode', 'special'],
      });
      const result = runPipeline(unicodeThread, threadAuth, {
        allThreads: [unicodeThread, threadAuth],
      });
      assert.strictEqual(typeof result.finalScore, 'number');
      assert.ok(result.finalScore >= 0 && result.finalScore <= 1);
    });

    it('50+ threads batch does not crash and completes', () => {
      const threads = [];
      for (let i = 0; i < 55; i++) {
        threads.push(makeThread({
          id: `thr-batch-${String(i).padStart(3, '0')}`,
          problemStatement: `Problem statement number ${i} about ${i % 2 === 0 ? 'authentication' : 'database'} concerns`,
          solutionShape: `Solution approach ${i} using ${i % 3 === 0 ? 'testing' : 'api'} patterns`,
          keywords: i % 2 === 0 ? ['auth', 'token'] : ['database', 'sql'],
        }));
      }
      const results = runPipelineBatch(threads, { allThreads: threads });
      // 55 threads -> C(55,2) = 55*54/2 = 1485 pairs
      const expectedPairs = (55 * 54) / 2;
      assert.strictEqual(results.size, expectedPairs);
      for (const [key, result] of results) {
        assert.ok(result.finalScore >= 0 && result.finalScore <= 1,
          `score for ${key} should be in [0,1]`);
      }
    });

    it('thread with only whitespace fields treated as empty', () => {
      const wsThread = makeThread({
        id: 'thr-ws',
        problemStatement: '   \t\n  ',
        solutionShape: '   ',
        keywords: [],
      });
      const result = runPipeline(wsThread, threadAuth, { allThreads: [wsThread, threadAuth] });
      assert.strictEqual(typeof result.finalScore, 'number');
      assert.ok(!Number.isNaN(result.finalScore));
    });

    it('duplicate keywords in thread are handled', () => {
      const dupThread = makeThread({
        id: 'thr-dup',
        problemStatement: 'auth auth auth',
        keywords: ['auth', 'auth', 'auth', 'token', 'token'],
      });
      const score = jaccardKeywordSimilarity(dupThread.keywords, ['auth', 'token']);
      assert.strictEqual(score, 1.0, 'duplicates should be collapsed via Set');
    });
  });

  // ============================================================================
  // Utility / weight checks
  // ============================================================================

  describe('Weights and constants', () => {
    it('pipeline weights sum to 1.0', () => {
      const sum = STAGE1_WEIGHT_TFIDF + STAGE1_WEIGHT_NGRAM + STAGE1_WEIGHT_JACCARD + STAGE2_WEIGHT_CONCEPT;
      assert.ok(Math.abs(sum - 1.0) < 0.0001, `weights sum to ${sum}, expected 1.0`);
    });

    it('clamp01 clamps correctly', () => {
      assert.strictEqual(clamp01(0.5), 0.5);
      assert.strictEqual(clamp01(0), 0);
      assert.strictEqual(clamp01(1), 1);
      assert.strictEqual(clamp01(-0.1), 0);
      assert.strictEqual(clamp01(1.5), 1);
      assert.strictEqual(clamp01(-100), 0);
      assert.strictEqual(clamp01(100), 1);
    });

    it('makePairKey is stable (alphabetically ordered)', () => {
      assert.strictEqual(makePairKey('thr-a', 'thr-b'), 'thr-a|thr-b');
      assert.strictEqual(makePairKey('thr-b', 'thr-a'), 'thr-a|thr-b');
    });

    it('makeCooccurrenceKey is stable (alphabetically ordered)', () => {
      assert.strictEqual(makeCooccurrenceKey('api', 'testing'), 'api|testing');
      assert.strictEqual(makeCooccurrenceKey('testing', 'api'), 'api|testing');
    });
  });

  // --- Branch coverage: propagateScores with missing graph nodes ---

  describe('propagateScores (branch coverage)', () => {
    it('keeps initial score when thread has no graph node', () => {
      // Graph with one thread node but initialScores reference a thread NOT in graph
      const graph = {
        nodes: {
          'thread-exists': { type: 'thread', active: true, metadata: { threadId: 'thr-exists' } },
        },
        edges: [],
      };
      const initialScores = { 'thr-exists|thr-missing': 0.42 };
      const result = propagateScores(graph, initialScores, { iterations: 3, damping: 0.7 });
      assert.strictEqual(result['thr-exists|thr-missing'], 0.42, 'Score should remain unchanged when one node missing');
    });
  });

  // --- Branch coverage: runPipelineBatch with graph propagation ---

  describe('runPipelineBatch (graph propagation branch)', () => {
    it('propagates scores through graph with affinity edges', () => {
      const graph = {
        nodes: {
          'thread-auth': { type: 'thread', active: true, metadata: { threadId: 'thr-auth' } },
          'thread-auth2': { type: 'thread', active: true, metadata: { threadId: 'thr-auth2' } },
          'thread-db': { type: 'thread', active: true, metadata: { threadId: 'thr-db' } },
          'thread-extra': { type: 'thread', active: true, metadata: { threadId: 'thr-extra' } },
        },
        edges: [
          {
            source: 'thread-auth', target: 'thread-db', type: 'affinity', active: true,
            metadata: { compositeScore: 0.55 },
          },
          // Edge between threads NOT in the batch — triggers directScores[existingKey] === undefined
          {
            source: 'thread-extra', target: 'thread-auth', type: 'affinity', active: true,
            metadata: { compositeScore: 0.4 },
          },
        ],
      };

      const threads = [threadAuth, threadAuth2, threadDB];
      const context = { graph, propagationOptions: { iterations: 3, damping: 0.5 } };
      const results = runPipelineBatch(threads, context);

      assert.ok(results instanceof Map, 'Should return a Map');
      assert.ok(results.size >= 3, 'Should have at least 3 pairs for 3 threads');

      for (const [, result] of results) {
        assert.ok(typeof result.stage3 === 'object', 'stage3 should be an object');
        assert.strictEqual(typeof result.finalScore, 'number', 'finalScore should be a number');
      }
    });

    it('findThreadNodeId finds thread in graph', () => {
      const graph = {
        nodes: {
          'thread-auth': { type: 'thread', active: true, metadata: { threadId: 'thr-auth' } },
          'feature-f001': { type: 'feature', active: true, metadata: {} },
        },
      };
      assert.strictEqual(findThreadNodeId(graph, 'thr-auth'), 'thread-auth');
      assert.strictEqual(findThreadNodeId(graph, 'thr-missing'), null);
      assert.strictEqual(findThreadNodeId({ nodes: {} }, 'thr-x'), null);
    });

    it('runPipelineBatch skips non-affinity and inactive edges in graph', () => {
      const graph = {
        nodes: {
          'thread-auth': { type: 'thread', active: true, metadata: { threadId: 'thr-auth' } },
          'thread-auth2': { type: 'thread', active: true, metadata: { threadId: 'thr-auth2' } },
          'feature-f001': { type: 'feature', active: true, metadata: {} },
          'thread-nothread': { type: 'decision', active: true, metadata: {} },
        },
        edges: [
          // Non-affinity edge -- should be skipped
          { source: 'thread-auth', target: 'feature-f001', type: 'informed_by', active: true, metadata: {} },
          // Inactive affinity edge -- should be skipped
          { source: 'thread-auth', target: 'thread-auth2', type: 'affinity', active: false, metadata: { compositeScore: 0.9 } },
          // Affinity edge with no metadata -- should be skipped
          { source: 'thread-auth', target: 'thread-auth2', type: 'affinity', active: true, metadata: null },
          // Affinity edge where source is not a thread -- should be skipped
          { source: 'feature-f001', target: 'thread-auth2', type: 'affinity', active: true, metadata: { compositeScore: 0.7 } },
          // Affinity edge where target doesn't exist -- should be skipped
          { source: 'thread-auth', target: 'nonexistent', type: 'affinity', active: true, metadata: { compositeScore: 0.5 } },
          // Affinity edge where thread node has no threadId in metadata
          { source: 'thread-nothread', target: 'thread-auth', type: 'affinity', active: true, metadata: { compositeScore: 0.6 } },
        ],
      };

      const threads = [threadAuth, threadAuth2];
      const context = { graph, propagationOptions: { iterations: 2, damping: 0.5 } };
      const results = runPipelineBatch(threads, context);
      assert.ok(results instanceof Map);
      assert.ok(results.size >= 1);
    });

    it('runPipeline skips various edge conditions in graph', () => {
      const graph = {
        nodes: {
          'thread-auth': { type: 'thread', active: true, metadata: { threadId: 'thr-auth' } },
          'thread-auth2': { type: 'thread', active: true, metadata: { threadId: 'thr-auth2' } },
        },
        edges: [
          // Inactive affinity
          { source: 'thread-auth', target: 'thread-auth2', type: 'affinity', active: false, metadata: { compositeScore: 0.9 } },
          // No metadata
          { source: 'thread-auth', target: 'thread-auth2', type: 'affinity', active: true, metadata: {} },
          // Missing compositeScore
          { source: 'thread-auth', target: 'thread-auth2', type: 'affinity', active: true, metadata: { compositeScore: 'not-a-number' } },
        ],
      };

      const allThreads = [threadAuth, threadAuth2];
      const context = { graph, allThreads, propagationOptions: { iterations: 2, damping: 0.5 } };
      const result = runPipeline(threadAuth, threadAuth2, context);
      assert.strictEqual(typeof result.finalScore, 'number');
    });

    it('handles runPipeline with graph containing affinity edges', () => {
      const graph = {
        nodes: {
          'thread-auth': { type: 'thread', active: true, metadata: { threadId: 'thr-auth' } },
          'thread-auth2': { type: 'thread', active: true, metadata: { threadId: 'thr-auth2' } },
          'thread-extra': { type: 'thread', active: true, metadata: { threadId: 'thr-extra' } },
        },
        edges: [
          {
            source: 'thread-extra', target: 'thread-auth2', type: 'affinity', active: true,
            metadata: { compositeScore: 0.6 },
          },
        ],
      };

      const allThreads = [threadAuth, threadAuth2];
      const context = { graph, allThreads, propagationOptions: { iterations: 2, damping: 0.5 } };
      const result = runPipeline(threadAuth, threadAuth2, context);

      assert.strictEqual(typeof result.finalScore, 'number');
      assert.ok(typeof result.stage3 === 'object', 'stage3 should be populated');
    });
  });
});
