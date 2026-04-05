// @cap-feature(feature:F-037) Semantic Analysis Pipeline — 3-stage pipeline for computing thread similarity via TF-IDF, concept taxonomy, and graph propagation
// @cap-decision Pure logic module with zero I/O and zero dependencies. All functions accept data as input and return numeric scores.
// @cap-decision Three-stage architecture: Stage 1 (text signals) provides lexical similarity, Stage 2 (concept signals) provides semantic similarity via taxonomy, Stage 3 (graph propagation) discovers transitive connections.
// @cap-decision Weights within Stage 1 are TF-IDF=0.5, N-gram=0.2, Jaccard=0.1; Stage 2 concept vector=0.2. These sum to 1.0 and represent the full pipeline blend.

'use strict';

// --- Types ---

/**
 * @typedef {Object} Thread
 * @property {string} id - Thread ID (thr-XXXX)
 * @property {string} problemStatement - Problem being explored
 * @property {string} solutionShape - Solution direction
 * @property {string[]} boundaryDecisions - Key decisions
 * @property {string[]} featureIds - Associated feature IDs
 * @property {string[]} keywords - Problem-space keywords
 */

/**
 * @typedef {Object} MemoryGraph
 * @property {Object<string, GraphNode>} nodes
 * @property {GraphEdge[]} edges
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} type
 * @property {string} id
 * @property {string} label
 * @property {boolean} active
 * @property {Object} metadata
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} source
 * @property {string} target
 * @property {string} type
 * @property {boolean} active
 * @property {Object} metadata
 */

/**
 * @typedef {Object} Corpus
 * @property {Map<string, number>} docFrequency - term -> number of docs containing it
 * @property {number} docCount - total documents in corpus
 */

/**
 * @typedef {Object<string, number>} SparseVector
 * Map of term -> TF-IDF weight
 */

/**
 * @typedef {Object} CooccurrenceEntry
 * @property {number} count - Times this concept pair co-occurred
 * @property {string[]} threads - Thread IDs where co-occurrence was observed
 */

/**
 * @typedef {Object<string, CooccurrenceEntry>} CooccurrenceMatrix
 * Key format: "conceptA|conceptB" (alphabetically ordered)
 */

/**
 * @typedef {Object} Stage1Result
 * @property {number} tfidf - TF-IDF cosine similarity (weight 0.5)
 * @property {number} ngram - Trigram overlap (weight 0.2)
 * @property {number} jaccard - Keyword Jaccard (weight 0.1)
 * @property {number} combined - Weighted combination
 */

/**
 * @typedef {Object} Stage2Result
 * @property {number} conceptSim - Concept vector cosine similarity
 * @property {number} combined - Weighted combination (weight 0.2)
 */

/**
 * @typedef {Object} PipelineResult
 * @property {Stage1Result} stage1 - Text signal scores
 * @property {Stage2Result} stage2 - Concept signal scores
 * @property {Object<string, number>} stage3 - Propagated scores keyed by thread-pair ID
 * @property {number} finalScore - Full pipeline score (0.0-1.0)
 */

/**
 * @typedef {Object} PipelineContext
 * @property {Thread[]} allThreads - All threads for corpus building
 * @property {MemoryGraph} [graph] - Memory graph for Stage 3
 * @property {Object<string, string[]>} [taxonomy] - Optional taxonomy override
 * @property {Object} [propagationOptions] - { iterations: number, damping: number }
 */

// --- Stop Words ---

/** @type {Set<string>} */
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

// --- Stage 1 Pipeline Weights ---
// @cap-decision Stage 1 weights: TF-IDF dominates at 0.5 because term frequency is the strongest lexical signal. N-gram at 0.2 handles typos/morphology. Jaccard at 0.1 is a simple fallback. Remaining 0.2 goes to Stage 2 concept similarity.

const STAGE1_WEIGHT_TFIDF = 0.5;
const STAGE1_WEIGHT_NGRAM = 0.2;
const STAGE1_WEIGHT_JACCARD = 0.1;
const STAGE2_WEIGHT_CONCEPT = 0.2;

// ============================================================================
// Stage 1: Text Signals
// ============================================================================

// --- Tokenization ---

/**
 * Tokenize text into lowercase terms, filtering stop words and short tokens.
 * @param {string} text - Raw text input
 * @returns {string[]} Array of tokens (may contain duplicates for TF counting)
 */
// @cap-todo(ac:F-037/AC-1) Tokenizer shared by TF-IDF and Jaccard stages
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Extract the full searchable text from a thread object.
 * Concatenates problemStatement, solutionShape, and boundaryDecisions.
 * @param {Thread} thread
 * @returns {string}
 */
function getThreadText(thread) {
  const parts = [];
  if (thread.problemStatement) parts.push(thread.problemStatement);
  if (thread.solutionShape) parts.push(thread.solutionShape);
  if (Array.isArray(thread.boundaryDecisions)) {
    parts.push(thread.boundaryDecisions.join(' '));
  }
  return parts.join(' ');
}

// --- TF-IDF (AC-1) ---

/**
 * Build a corpus from an array of threads for IDF computation.
 * @param {Thread[]} threads - All threads in the system
 * @returns {Corpus} Corpus with document frequency map and document count
 */
// @cap-todo(ac:F-037/AC-1) Build corpus from all thread texts for IDF calculation
function buildCorpus(threads) {
  /** @type {Map<string, number>} */
  const docFrequency = new Map();
  let docCount = 0;

  for (const thread of threads) {
    const text = getThreadText(thread);
    const tokens = tokenize(text);
    // Deduplicate tokens per document for DF counting
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    }
    docCount++;
  }

  return { docFrequency, docCount };
}

/**
 * Compute a TF-IDF vector for a given text against a corpus.
 * TF(term, doc) = frequency / total terms in doc
 * IDF(term, corpus) = log(N / (1 + docs containing term))
 * @param {string} text - Text to vectorize
 * @param {Corpus} corpus - Pre-built corpus
 * @returns {Map<string, number>} Sparse TF-IDF vector
 */
// @cap-todo(ac:F-037/AC-1) TF-IDF vector computation: TF * IDF with +1 smoothing on IDF denominator
function computeTfIdfVector(text, corpus) {
  const tokens = tokenize(text);
  /** @type {Map<string, number>} */
  const vector = new Map();

  if (tokens.length === 0) return vector;

  // Count term frequencies
  /** @type {Map<string, number>} */
  const termCounts = new Map();
  for (const token of tokens) {
    termCounts.set(token, (termCounts.get(token) || 0) + 1);
  }

  const totalTerms = tokens.length;
  const N = corpus.docCount;

  for (const [term, count] of termCounts) {
    const tf = count / totalTerms;
    const df = corpus.docFrequency.get(term) || 0;
    // +1 in denominator avoids division by zero for unknown terms
    const idf = Math.log(N / (1 + df));
    const tfidf = tf * idf;
    if (tfidf > 0) {
      vector.set(term, tfidf);
    }
  }

  return vector;
}

/**
 * Compute cosine similarity between two sparse vectors.
 * cosine = dot(A, B) / (|A| * |B|)
 * @param {Map<string, number>} vecA - First sparse vector
 * @param {Map<string, number>} vecB - Second sparse vector
 * @returns {number} Cosine similarity (0.0-1.0)
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.size === 0 || vecB.size === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

  for (const [term, valA] of smaller) {
    const valB = larger.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }

  for (const val of vecA.values()) {
    normA += val * val;
  }
  for (const val of vecB.values()) {
    normB += val * val;
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return clamp01(dotProduct / (normA * normB));
}

/**
 * Compute TF-IDF cosine similarity between two threads.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {Corpus} corpus - Pre-built corpus from all threads
 * @returns {number} Cosine similarity (0.0-1.0)
 */
// @cap-todo(ac:F-037/AC-1) TF-IDF cosine similarity with weight 0.5 in the pipeline blend
function tfidfSimilarity(threadA, threadB, corpus) {
  const textA = getThreadText(threadA);
  const textB = getThreadText(threadB);
  const vecA = computeTfIdfVector(textA, corpus);
  const vecB = computeTfIdfVector(textB, corpus);
  return cosineSimilarity(vecA, vecB);
}

// --- Character N-Gram Overlap (AC-2) ---

/**
 * Extract character trigrams from text.
 * "session" -> Set(["ses", "ess", "ssi", "sio", "ion"])
 * @param {string} text - Input text
 * @returns {Set<string>} Set of character trigrams
 */
// @cap-todo(ac:F-037/AC-2) Trigram extraction for typo-resilient matching
function extractTrigrams(text) {
  if (!text || typeof text !== 'string') return new Set();

  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const trigrams = new Set();

  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.substring(i, i + 3));
  }

  return trigrams;
}

/**
 * Compute trigram-based Jaccard similarity between two texts.
 * Catches morphological variants and typos: "authenticate" <-> "authentication".
 * @param {string} textA
 * @param {string} textB
 * @returns {number} Similarity score (0.0-1.0)
 */
// @cap-todo(ac:F-037/AC-2) Character N-Gram overlap with weight 0.2 for typo-resilient matching
function trigramSimilarity(textA, textB) {
  const gramsA = extractTrigrams(textA);
  const gramsB = extractTrigrams(textB);

  if (gramsA.size === 0 && gramsB.size === 0) return 0;
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersectionSize = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersectionSize++;
  }

  const unionSize = new Set([...gramsA, ...gramsB]).size;
  if (unionSize === 0) return 0;

  return clamp01(intersectionSize / unionSize);
}

// --- Jaccard Keywords (AC-3) ---

/**
 * Compute Jaccard similarity over keyword sets from two threads.
 * Uses thread.keywords arrays directly.
 * @param {string[]} keywordsA - Keywords from thread A
 * @param {string[]} keywordsB - Keywords from thread B
 * @returns {number} Jaccard similarity (0.0-1.0)
 */
// @cap-todo(ac:F-037/AC-3) Jaccard keyword similarity with weight 0.1 as simple fallback signal
function jaccardKeywordSimilarity(keywordsA, keywordsB) {
  const setA = new Set((keywordsA || []).map(k => k.toLowerCase()));
  const setB = new Set((keywordsB || []).map(k => k.toLowerCase()));

  if (setA.size === 0 && setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const kw of setA) {
    if (setB.has(kw)) intersectionSize++;
  }

  const unionSize = new Set([...setA, ...setB]).size;
  if (unionSize === 0) return 0;

  return clamp01(intersectionSize / unionSize);
}

// --- Stage 1 Combined ---

/**
 * Compute all Stage 1 text signals for a thread pair.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {Corpus} corpus - Pre-built corpus
 * @returns {Stage1Result}
 */
function computeStage1(threadA, threadB, corpus) {
  const tfidf = tfidfSimilarity(threadA, threadB, corpus);

  const textA = getThreadText(threadA);
  const textB = getThreadText(threadB);
  const ngram = trigramSimilarity(textA, textB);

  const jaccard = jaccardKeywordSimilarity(threadA.keywords, threadB.keywords);

  const combined = (tfidf * STAGE1_WEIGHT_TFIDF)
    + (ngram * STAGE1_WEIGHT_NGRAM)
    + (jaccard * STAGE1_WEIGHT_JACCARD);

  return { tfidf, ngram, jaccard, combined };
}

// ============================================================================
// Stage 2: Concept Signals
// ============================================================================

// --- Seed Taxonomy (AC-4) ---
// @cap-todo(ac:F-037/AC-4) Embedded seed taxonomy of 25 universal software development concepts, no external config
// @cap-decision Taxonomy concepts chosen for breadth across typical software projects. Keywords are lowercase stems/fragments that trigger concept association.

const SEED_TAXONOMY = {
  'authentication': ['auth', 'login', 'logout', 'session', 'token', 'jwt', 'oauth', 'sso', 'password', 'credential'],
  'authorization': ['permission', 'role', 'access', 'policy', 'rbac', 'rls', 'acl', 'grant'],
  'database': ['sql', 'query', 'table', 'column', 'migration', 'schema', 'index', 'foreign', 'constraint'],
  'api': ['endpoint', 'route', 'request', 'response', 'rest', 'graphql', 'middleware', 'handler'],
  'testing': ['test', 'assert', 'mock', 'stub', 'coverage', 'vitest', 'jest', 'spec'],
  'caching': ['cache', 'redis', 'ttl', 'invalidate', 'stale', 'refresh', 'memoize'],
  'deployment': ['deploy', 'pipeline', 'docker', 'container', 'kubernetes', 'staging', 'production'],
  'ui-frontend': ['component', 'render', 'react', 'vue', 'svelte', 'tailwind', 'css', 'layout', 'responsive'],
  'state-management': ['state', 'store', 'reducer', 'context', 'redux', 'zustand', 'signal'],
  'file-io': ['file', 'read', 'write', 'stream', 'buffer', 'upload', 'download', 'storage'],
  'error-handling': ['error', 'exception', 'catch', 'throw', 'retry', 'fallback', 'timeout'],
  'configuration': ['config', 'env', 'environment', 'setting', 'option', 'flag', 'feature-flag'],
  'logging': ['log', 'debug', 'trace', 'monitor', 'observability', 'metric', 'alert'],
  'security': ['encrypt', 'hash', 'csrf', 'xss', 'injection', 'sanitize', 'vulnerability', 'secure'],
  'performance': ['optimize', 'latency', 'throughput', 'benchmark', 'profile', 'memory', 'cpu'],
  'data-validation': ['validate', 'schema', 'zod', 'type', 'check', 'constraint', 'format'],
  'messaging': ['queue', 'event', 'publish', 'subscribe', 'webhook', 'notification', 'email'],
  'search': ['search', 'index', 'filter', 'sort', 'paginate', 'fulltext'],
  'version-control': ['git', 'branch', 'commit', 'merge', 'rebase', 'diff', 'conflict'],
  'documentation': ['docs', 'readme', 'comment', 'jsdoc', 'markdown', 'changelog'],
  'build-tooling': ['build', 'bundle', 'compile', 'transpile', 'webpack', 'esbuild', 'vite'],
  'networking': ['http', 'socket', 'websocket', 'fetch', 'cors', 'proxy', 'ssl', 'tls'],
  'serialization': ['json', 'parse', 'stringify', 'serialize', 'deserialize', 'encode', 'decode'],
  'concurrency': ['async', 'await', 'promise', 'parallel', 'worker', 'thread', 'mutex', 'lock'],
  'migration': ['migrate', 'upgrade', 'backward', 'compatible', 'version', 'legacy', 'deprecate'],
};

/** Concept names in stable order for vector indexing. */
const CONCEPT_NAMES = Object.keys(SEED_TAXONOMY).sort();

// --- Co-occurrence Matrix (AC-5) ---

/**
 * Build a co-occurrence matrix from observed thread data.
 * Tracks which concept pairs appear together across threads.
 * @param {Thread[]} threads - All threads to analyze
 * @param {Object<string, string[]>} [taxonomy] - Taxonomy to use (defaults to SEED_TAXONOMY)
 * @returns {CooccurrenceMatrix} Matrix keyed by "conceptA|conceptB"
 */
// @cap-todo(ac:F-037/AC-5) Co-occurrence matrix auto-learns from observed thread data
function buildCooccurrenceMatrix(threads, taxonomy) {
  const tax = taxonomy || SEED_TAXONOMY;
  /** @type {CooccurrenceMatrix} */
  const matrix = {};

  for (const thread of threads) {
    const text = getThreadText(thread);
    const tokens = new Set(tokenize(text));

    // Identify which concepts are present in this thread
    const presentConcepts = [];
    for (const [concept, keywords] of Object.entries(tax)) {
      const hits = keywords.filter(kw => tokens.has(kw) || textContainsKeyword(text, kw));
      if (hits.length > 0) {
        presentConcepts.push(concept);
      }
    }

    // Record co-occurrences for every pair of present concepts
    for (let i = 0; i < presentConcepts.length; i++) {
      for (let j = i + 1; j < presentConcepts.length; j++) {
        const key = makeCooccurrenceKey(presentConcepts[i], presentConcepts[j]);
        if (!matrix[key]) {
          matrix[key] = { count: 0, threads: [] };
        }
        matrix[key].count++;
        matrix[key].threads.push(thread.id);
      }
    }
  }

  return matrix;
}

/**
 * Check if text contains a keyword (case-insensitive substring match).
 * Used for taxonomy keywords that might be substrings of larger words.
 * @param {string} text
 * @param {string} keyword
 * @returns {boolean}
 */
function textContainsKeyword(text, keyword) {
  return text.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
}

/**
 * Create a stable co-occurrence key from two concept names.
 * Alphabetically ordered to ensure "a|b" === "b|a".
 * @param {string} conceptA
 * @param {string} conceptB
 * @returns {string}
 */
function makeCooccurrenceKey(conceptA, conceptB) {
  return conceptA < conceptB
    ? `${conceptA}|${conceptB}`
    : `${conceptB}|${conceptA}`;
}

/**
 * Get confirmed concept pairs that have co-occurred at or above a threshold.
 * @param {CooccurrenceMatrix} matrix
 * @param {number} [threshold=5] - Minimum co-occurrence count
 * @returns {Array<{key: string, count: number, concepts: [string, string]}>}
 */
// @cap-todo(ac:F-037/AC-5) Confirmed pairs override seed weights at >= 5 co-occurrences
function getConfirmedPairs(matrix, threshold) {
  const minCount = typeof threshold === 'number' ? threshold : 5;
  const confirmed = [];

  for (const [key, entry] of Object.entries(matrix)) {
    if (entry.count >= minCount) {
      const [conceptA, conceptB] = key.split('|');
      confirmed.push({ key, count: entry.count, concepts: [conceptA, conceptB] });
    }
  }

  return confirmed.sort((a, b) => b.count - a.count);
}

// --- Concept Vector Projection (AC-6) ---

/**
 * Project thread text into concept space using the taxonomy.
 * For each concept, score = number of matching keywords found in the text,
 * normalized by the total keyword count for that concept.
 * @param {string} text - Thread text
 * @param {Object<string, string[]>} [taxonomy] - Taxonomy to use
 * @returns {Map<string, number>} Concept vector (concept name -> score)
 */
// @cap-todo(ac:F-037/AC-6) Concept vector similarity via concept space projection + cosine distance
function projectToConcepts(text, taxonomy) {
  const tax = taxonomy || SEED_TAXONOMY;
  /** @type {Map<string, number>} */
  const vector = new Map();

  if (!text || typeof text !== 'string') return vector;

  const lowerText = text.toLowerCase();

  for (const [concept, keywords] of Object.entries(tax)) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (lowerText.indexOf(kw) !== -1) {
        matchCount++;
      }
    }
    // Normalize by keyword list length to avoid bias toward concepts with more keywords
    const score = keywords.length > 0 ? matchCount / keywords.length : 0;
    if (score > 0) {
      vector.set(concept, score);
    }
  }

  return vector;
}

/**
 * Apply co-occurrence boost to concept vectors.
 * When confirmed pairs are found, boost the weaker concept in the pair
 * based on the co-occurrence strength.
 * @param {Map<string, number>} vector - Original concept vector
 * @param {CooccurrenceMatrix} matrix - Co-occurrence data
 * @param {number} [threshold=5] - Minimum co-occurrences to trigger boost
 * @returns {Map<string, number>} Boosted concept vector
 */
// @cap-decision Co-occurrence boost adds 0.1 * (count/maxCount) to the weaker concept in a confirmed pair. This is a gentle nudge, not an override, to preserve the seed taxonomy signal.
function applyCooccurrenceBoost(vector, matrix, threshold) {
  const confirmed = getConfirmedPairs(matrix, threshold);
  if (confirmed.length === 0) return vector;

  const boosted = new Map(vector);
  const maxCount = confirmed[0].count; // Already sorted descending

  for (const pair of confirmed) {
    const [conceptA, conceptB] = pair.concepts;
    const scoreA = boosted.get(conceptA) || 0;
    const scoreB = boosted.get(conceptB) || 0;

    // Only boost if at least one concept is present in the vector
    if (scoreA > 0 || scoreB > 0) {
      const boostFactor = 0.1 * (pair.count / maxCount);

      // Boost the weaker concept toward the stronger one
      if (scoreA > 0 && scoreB === 0) {
        boosted.set(conceptB, boostFactor * scoreA);
      } else if (scoreB > 0 && scoreA === 0) {
        boosted.set(conceptA, boostFactor * scoreB);
      }
      // If both present, no boost needed — they already co-occur
    }
  }

  return boosted;
}

/**
 * Compute concept vector similarity between two threads.
 * Projects both threads into concept space, applies co-occurrence boost,
 * then computes cosine similarity.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {Object<string, string[]>} [taxonomy]
 * @param {CooccurrenceMatrix} [cooccurrenceMatrix]
 * @returns {number} Concept similarity (0.0-1.0)
 */
function conceptVectorSimilarity(threadA, threadB, taxonomy, cooccurrenceMatrix) {
  const tax = taxonomy || SEED_TAXONOMY;
  const textA = getThreadText(threadA);
  const textB = getThreadText(threadB);

  let vecA = projectToConcepts(textA, tax);
  let vecB = projectToConcepts(textB, tax);

  // Apply co-occurrence boost if matrix is available
  if (cooccurrenceMatrix) {
    vecA = applyCooccurrenceBoost(vecA, cooccurrenceMatrix);
    vecB = applyCooccurrenceBoost(vecB, cooccurrenceMatrix);
  }

  return cosineSimilarity(vecA, vecB);
}

// --- Stage 2 Combined ---

/**
 * Compute all Stage 2 concept signals for a thread pair.
 * @param {Thread} threadA
 * @param {Thread} threadB
 * @param {Thread[]} allThreads - All threads for co-occurrence matrix
 * @param {Object<string, string[]>} [taxonomy]
 * @returns {Stage2Result}
 */
function computeStage2(threadA, threadB, allThreads, taxonomy) {
  const tax = taxonomy || SEED_TAXONOMY;
  const matrix = buildCooccurrenceMatrix(allThreads, tax);
  const conceptSim = conceptVectorSimilarity(threadA, threadB, tax, matrix);

  return {
    conceptSim,
    combined: conceptSim * STAGE2_WEIGHT_CONCEPT,
  };
}

// ============================================================================
// Stage 3: Graph Propagation
// ============================================================================

// @cap-todo(ac:F-037/AC-7) Iterative relaxation propagates affinity scores through memory graph edges

/**
 * Find the graph node ID for a thread by its thread ID.
 * @param {MemoryGraph} graph
 * @param {string} threadId
 * @returns {string|null}
 */
function findThreadNodeId(graph, threadId) {
  for (const [nodeId, node] of Object.entries(graph.nodes || {})) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId === threadId) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Get all active neighbor node IDs for a given node.
 * Returns map of neighborId -> edge weight (from metadata.compositeScore or 1.0).
 * @param {MemoryGraph} graph
 * @param {string} nodeId
 * @returns {Map<string, number>} neighborId -> edge weight
 */
function getWeightedNeighbors(graph, nodeId) {
  const neighbors = new Map();
  for (const edge of (graph.edges || [])) {
    if (!edge.active) continue;
    let neighborId = null;
    if (edge.source === nodeId) neighborId = edge.target;
    else if (edge.target === nodeId) neighborId = edge.source;
    if (neighborId) {
      // Use affinity score as edge weight if available, otherwise 1.0
      const weight = (edge.metadata && typeof edge.metadata.compositeScore === 'number')
        ? edge.metadata.compositeScore
        : 1.0;
      // Keep the strongest edge if multiple edges connect the same pair
      const existing = neighbors.get(neighborId) || 0;
      if (weight > existing) {
        neighbors.set(neighborId, weight);
      }
    }
  }
  return neighbors;
}

/**
 * Propagate affinity scores through the memory graph using iterative relaxation.
 *
 * Algorithm:
 * 1. Initialize scores from direct pairwise similarities (initialScores)
 * 2. For each iteration:
 *    a. For each thread node, collect neighbor scores weighted by edge strength
 *    b. New score = damping * neighborContribution + (1 - damping) * initialScore
 * 3. Return final propagated scores
 *
 * This strengthens connections between threads that share many intermediaries
 * and weakens false connections that lack graph support.
 *
 * @param {MemoryGraph} graph - The memory graph with nodes and weighted edges
 * @param {Object<string, number>} initialScores - Keyed by "threadIdA|threadIdB", values 0.0-1.0
 * @param {Object} [options]
 * @param {number} [options.iterations=5] - Number of relaxation iterations (3-5 recommended)
 * @param {number} [options.damping=0.7] - Damping factor (0.0-1.0). Higher = more propagation influence.
 * @returns {Object<string, number>} Propagated scores keyed the same as initialScores
 */
// @cap-todo(ac:F-037/AC-7) Graph propagation: 3-5 iterations, damping 0.7
function propagateScores(graph, initialScores, options) {
  const iterations = (options && typeof options.iterations === 'number') ? options.iterations : 5;
  const damping = (options && typeof options.damping === 'number') ? options.damping : 0.7;

  if (!graph || !graph.nodes || !initialScores) {
    return { ...(initialScores || {}) };
  }

  // Build a lookup of thread ID -> graph node ID
  /** @type {Map<string, string>} threadId -> nodeId */
  const threadToNode = new Map();
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type === 'thread' && node.metadata && node.metadata.threadId) {
      threadToNode.set(node.metadata.threadId, nodeId);
    }
  }

  // Build adjacency with weights for all thread nodes
  /** @type {Map<string, Map<string, number>>} nodeId -> Map(neighborNodeId -> weight) */
  const adjacency = new Map();
  for (const nodeId of threadToNode.values()) {
    adjacency.set(nodeId, getWeightedNeighbors(graph, nodeId));
  }

  // Build a nodeId -> threadId reverse lookup
  /** @type {Map<string, string>} */
  const nodeToThread = new Map();
  for (const [tid, nid] of threadToNode) {
    nodeToThread.set(nid, tid);
  }

  // Current scores — start from initial
  let currentScores = { ...initialScores };

  // Iterative relaxation
  for (let iter = 0; iter < iterations; iter++) {
    const nextScores = {};

    for (const [pairKey, initialScore] of Object.entries(initialScores)) {
      const [tidA, tidB] = pairKey.split('|');
      const nodeA = threadToNode.get(tidA);
      const nodeB = threadToNode.get(tidB);

      if (!nodeA || !nodeB) {
        nextScores[pairKey] = initialScore;
        continue;
      }

      // Compute neighbor contribution: average of scores between
      // nodeA's neighbors and nodeB, and nodeB's neighbors and nodeA
      const neighborsA = adjacency.get(nodeA) || new Map();
      const neighborsB = adjacency.get(nodeB) || new Map();

      let neighborSum = 0;
      let neighborCount = 0;

      // Contribution from A's neighbors toward B
      for (const [neighborNodeId, edgeWeight] of neighborsA) {
        const neighborThreadId = nodeToThread.get(neighborNodeId);
        if (!neighborThreadId) continue;
        // Look up score between this neighbor and threadB
        const key1 = makePairKey(neighborThreadId, tidB);
        const score = currentScores[key1];
        if (score !== undefined) {
          neighborSum += score * edgeWeight;
          neighborCount++;
        }
      }

      // Contribution from B's neighbors toward A
      for (const [neighborNodeId, edgeWeight] of neighborsB) {
        const neighborThreadId = nodeToThread.get(neighborNodeId);
        if (!neighborThreadId) continue;
        const key1 = makePairKey(neighborThreadId, tidA);
        const score = currentScores[key1];
        if (score !== undefined) {
          neighborSum += score * edgeWeight;
          neighborCount++;
        }
      }

      const neighborContribution = neighborCount > 0 ? neighborSum / neighborCount : 0;

      // Relaxation formula: blend of neighbor signal and original score
      nextScores[pairKey] = clamp01(
        damping * neighborContribution + (1 - damping) * initialScore
      );
    }

    currentScores = nextScores;
  }

  return currentScores;
}

/**
 * Create a stable pair key from two thread IDs (alphabetically ordered).
 * @param {string} tidA
 * @param {string} tidB
 * @returns {string}
 */
function makePairKey(tidA, tidB) {
  return tidA < tidB ? `${tidA}|${tidB}` : `${tidB}|${tidA}`;
}

// ============================================================================
// Full Pipeline
// ============================================================================

/**
 * Run the complete 3-stage semantic analysis pipeline for a thread pair.
 *
 * Stage 1: Text signals (TF-IDF 0.5 + N-gram 0.2 + Jaccard 0.1)
 * Stage 2: Concept signals (concept vector similarity 0.2)
 * Stage 3: Graph propagation (optional, refines scores via transitive connections)
 *
 * @param {Thread} threadA - First thread
 * @param {Thread} threadB - Second thread
 * @param {PipelineContext} context - All threads, optional graph, taxonomy overrides
 * @returns {PipelineResult}
 */
// @cap-todo(ac:F-037/AC-8) Pure logic pipeline — no I/O, all data passed as arguments
function runPipeline(threadA, threadB, context) {
  const allThreads = (context && context.allThreads) || [threadA, threadB];
  const taxonomy = (context && context.taxonomy) || SEED_TAXONOMY;
  const graph = (context && context.graph) || null;
  const propagationOptions = (context && context.propagationOptions) || { iterations: 5, damping: 0.7 };

  // Stage 1: Text signals
  const corpus = buildCorpus(allThreads);
  const stage1 = computeStage1(threadA, threadB, corpus);

  // Stage 2: Concept signals
  const stage2 = computeStage2(threadA, threadB, allThreads, taxonomy);

  // Pre-propagation score (stages 1 + 2)
  const directScore = clamp01(stage1.combined + stage2.combined);

  // Stage 3: Graph propagation (optional)
  let stage3 = {};
  let finalScore = directScore;

  if (graph && graph.nodes && Object.keys(graph.nodes).length > 0) {
    const pairKey = makePairKey(threadA.id, threadB.id);
    const initialScores = { [pairKey]: directScore };

    // Include existing affinity edges as additional initial scores
    // so propagation can leverage the full graph
    for (const edge of (graph.edges || [])) {
      if (!edge.active || edge.type !== 'affinity') continue;
      if (!edge.metadata || typeof edge.metadata.compositeScore !== 'number') continue;

      const sourceNode = graph.nodes[edge.source];
      const targetNode = graph.nodes[edge.target];
      if (!sourceNode || !targetNode) continue;
      if (sourceNode.type !== 'thread' || targetNode.type !== 'thread') continue;

      const sTid = sourceNode.metadata && sourceNode.metadata.threadId;
      const tTid = targetNode.metadata && targetNode.metadata.threadId;
      if (!sTid || !tTid) continue;

      const existingKey = makePairKey(sTid, tTid);
      if (existingKey !== pairKey && initialScores[existingKey] === undefined) {
        initialScores[existingKey] = edge.metadata.compositeScore;
      }
    }

    stage3 = propagateScores(graph, initialScores, propagationOptions);
    finalScore = clamp01(stage3[pairKey] !== undefined ? stage3[pairKey] : directScore);
  }

  return {
    stage1,
    stage2,
    stage3,
    finalScore,
  };
}

/**
 * Run the pipeline for all unique thread pairs.
 * Returns a Map keyed by "threadIdA|threadIdB" -> PipelineResult.
 * @param {Thread[]} threads - All threads
 * @param {PipelineContext} context
 * @returns {Map<string, PipelineResult>}
 */
function runPipelineBatch(threads, context) {
  const results = new Map();
  const allThreads = (context && context.allThreads) || threads;
  const corpus = buildCorpus(allThreads);
  const taxonomy = (context && context.taxonomy) || SEED_TAXONOMY;
  const matrix = buildCooccurrenceMatrix(allThreads, taxonomy);
  const graph = (context && context.graph) || null;
  const propagationOptions = (context && context.propagationOptions) || { iterations: 5, damping: 0.7 };

  // Compute direct scores for all pairs
  /** @type {Object<string, number>} */
  const directScores = {};

  for (let i = 0; i < threads.length; i++) {
    for (let j = i + 1; j < threads.length; j++) {
      const a = threads[i];
      const b = threads[j];
      const pairKey = makePairKey(a.id, b.id);

      // Stage 1
      const tfidf = tfidfSimilarity(a, b, corpus);
      const textA = getThreadText(a);
      const textB = getThreadText(b);
      const ngram = trigramSimilarity(textA, textB);
      const jaccard = jaccardKeywordSimilarity(a.keywords, b.keywords);
      const stage1Combined = (tfidf * STAGE1_WEIGHT_TFIDF)
        + (ngram * STAGE1_WEIGHT_NGRAM)
        + (jaccard * STAGE1_WEIGHT_JACCARD);

      const stage1 = { tfidf, ngram, jaccard, combined: stage1Combined };

      // Stage 2
      const conceptSim = conceptVectorSimilarity(a, b, taxonomy, matrix);
      const stage2 = { conceptSim, combined: conceptSim * STAGE2_WEIGHT_CONCEPT };

      const directScore = clamp01(stage1.combined + stage2.combined);
      directScores[pairKey] = directScore;

      results.set(pairKey, {
        stage1,
        stage2,
        stage3: {},
        finalScore: directScore,
      });
    }
  }

  // Stage 3: batch graph propagation
  if (graph && graph.nodes && Object.keys(graph.nodes).length > 0) {
    // Add existing affinity edges
    for (const edge of (graph.edges || [])) {
      if (!edge.active || edge.type !== 'affinity') continue;
      if (!edge.metadata || typeof edge.metadata.compositeScore !== 'number') continue;

      const sourceNode = graph.nodes[edge.source];
      const targetNode = graph.nodes[edge.target];
      if (!sourceNode || !targetNode) continue;
      if (sourceNode.type !== 'thread' || targetNode.type !== 'thread') continue;

      const sTid = sourceNode.metadata && sourceNode.metadata.threadId;
      const tTid = targetNode.metadata && targetNode.metadata.threadId;
      if (!sTid || !tTid) continue;

      const existingKey = makePairKey(sTid, tTid);
      if (directScores[existingKey] === undefined) {
        directScores[existingKey] = edge.metadata.compositeScore;
      }
    }

    const propagated = propagateScores(graph, directScores, propagationOptions);

    // Update results with propagated scores
    for (const [pairKey, result] of results) {
      result.stage3 = propagated;
      if (propagated[pairKey] !== undefined) {
        result.finalScore = clamp01(propagated[pairKey]);
      }
    }
  }

  return results;
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Clamp a number to [0.0, 1.0].
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// ============================================================================
// Module Exports
// ============================================================================

// @cap-decision Exporting internal helpers with _ prefix for testing, matching cap-affinity-engine.cjs convention.

module.exports = {
  // --- Full Pipeline ---
  runPipeline,
  runPipelineBatch,

  // --- Stage 1: Text Signals ---
  computeStage1,
  tfidfSimilarity,
  trigramSimilarity,
  jaccardKeywordSimilarity,

  // --- Stage 2: Concept Signals ---
  computeStage2,
  conceptVectorSimilarity,
  buildCooccurrenceMatrix,
  getConfirmedPairs,
  projectToConcepts,

  // --- Stage 3: Graph Propagation ---
  propagateScores,

  // --- Constants ---
  SEED_TAXONOMY,
  CONCEPT_NAMES,
  STAGE1_WEIGHT_TFIDF,
  STAGE1_WEIGHT_NGRAM,
  STAGE1_WEIGHT_JACCARD,
  STAGE2_WEIGHT_CONCEPT,

  // --- Internals (for testing) ---
  _tokenize: tokenize,
  _getThreadText: getThreadText,
  _buildCorpus: buildCorpus,
  _computeTfIdfVector: computeTfIdfVector,
  _cosineSimilarity: cosineSimilarity,
  _extractTrigrams: extractTrigrams,
  _makeCooccurrenceKey: makeCooccurrenceKey,
  _applyCooccurrenceBoost: applyCooccurrenceBoost,
  _findThreadNodeId: findThreadNodeId,
  _getWeightedNeighbors: getWeightedNeighbors,
  _makePairKey: makePairKey,
  _clamp01: clamp01,
  _textContainsKeyword: textContainsKeyword,
};
