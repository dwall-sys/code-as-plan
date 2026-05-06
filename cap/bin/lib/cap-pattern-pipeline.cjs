// @cap-context CAP F-071 Extract Patterns via Heuristics and LLM — pure-compute pipeline that turns
//                 raw F-070 learning signals into actionable P-NNN patterns. Stage 1 is deterministic
//                 (TF-IDF / RegEx clustering / frequency); Stage 2 is the LLM stage triggered when a
//                 candidate hits the threshold (≥ 3 similar overrides OR ≥ 1 regret). All LLM-bound
//                 payload is counts + hashes only — no raw signal records, no user text, no paths.
// @cap-decision(F-071/D1) LLM call mechanism — Host-LLM via Skill-Briefing pattern. The pipeline writes
//                 an aggregate briefing to .cap/learning/queue/P-NNN.md; the /cap:learn skill instructs
//                 the outer agent (Claude running the session) to read the briefing and write the result
//                 to .cap/learning/patterns/P-NNN.json. There is NO HTTPS client, NO API key, NO SDK
//                 dependency. This mirrors how /cap:prototype hands a task to cap-prototyper.
// @cap-decision(F-071/D2) Trigger — manual via /cap:learn skill. NOT auto on /cap:scan, NOT on Stop-Hook.
//                 Auto-triggering would burn through the user's LLM budget without consent.
// @cap-decision(F-071/D3) LLM input shape — Counts + Hashes only. No FEATURE-MAP context, no
//                 tag-description text, no raw signal records. The strict path. The briefing schema is:
//                 { candidateId, signalType, count, byFeature: [{featureId, count}], topContextHashes:
//                 [{hash, count}] }. Anything beyond this MUST go through hashContext first or be denied.
// @cap-decision(F-071/D4) TF-IDF tokens are tuples, not free text — `${signalType}|${featureId}|${
//                 targetFileHash || decisionId}`. The privacy boundary already hashed the path, so the
//                 token-string is hash-clean by construction. Documents are sessions (groupBy sessionId).
//                 TF · IDF ranks within-session; absolute count provides the AC-2 threshold path
//                 (count >= 3 override / >= 1 regret) regardless of TF-IDF rank.
// @cap-decision(F-071/D5) P-NNN allocation is compute-on-read from filenames. AC-6 demands "sequential,
//                 never renumbered" — gaps are fine; allocator returns max(existing IDs) + 1, scanning
//                 .cap/learning/patterns/P-*.json AND .cap/learning/queue/P-*.md (queue burns IDs too,
//                 because a deferred candidate retains its assigned ID across sessions). No .next-id
//                 file: that drifts when developers manually delete a pattern file or move things around.
// @cap-decision(F-071/D7) "Similar overrides" means the same (signalType, featureId, contextKey) tuple
//                 — i.e. SAME feature AND SAME target file (or decisionId for regret). 3 overrides spread
//                 across 3 different featureIds do NOT trigger Stage 2; 3 edits across 3 different files
//                 of the same feature do NOT trigger Stage 2. STRICT match.
//                 Why: early-phase self-learning needs cluster cohesion — Stage 2's LLM can only distill
//                 a meaningful L2/L3 pattern from semantically similar records. Loose (featureId-only)
//                 matching would produce heterogeneous clusters that the LLM cannot synthesise honestly,
//                 and would burn the 3-call budget on low-signal candidates. F-074 unlearn would then
//                 auto-retract them, wasting the budget round-trip. F-072 fitness scoring + F-074 will
//                 surface coverage gaps over time; if strict turns out to be too narrow, loose-mode is
//                 an additive future change (a parallel candidate class), not a refactor.
//                 Confirmed by user before ship — see PIN-2 in the F-071 test-audit report.
// @cap-constraint Zero external dependencies: node:fs, node:path only. We re-use cap-telemetry.cjs for
//                 hashContext (privacy primitive) and readBudget / getLlmUsage (budget primitive), and
//                 cap-learning-signals.cjs#getSignals as the SOLE input source. We never read JSONL
//                 files directly; the F-070 query API is the contract.
// @cap-risk(F-071/AC-3) PRIVACY BOUNDARY — every place that constructs an LLM-bound briefing payload
//                 carries this tag. The briefing must contain ONLY hex hashes and integer counts. Any
//                 future contributor adding a `description`, `summary`, `path`, or `signalRaw` field
//                 violates AC-3. Tests perform byte-level needle-search on the briefing markdown.
// @cap-risk(F-071/AC-4) BUDGET BOUNDARY — promotion to Stage 2 must be gated by readBudget +
//                 getLlmUsage. A regression that bypasses the gate would silently burn through the
//                 user's wallet. The gate is in promoteCandidates(); tests pre-load recordLlmCall
//                 entries and assert overflow lands in the queue with deferred:budget.

'use strict';

// @cap-feature(feature:F-071, primary:true) Pattern Pipeline — heuristic Stage 1 + LLM-briefing Stage 2.

const fs = require('node:fs');
const path = require('node:path');

const telemetry = require('./cap-telemetry.cjs');
const learningSignals = require('./cap-learning-signals.cjs');

// -----------------------------------------------------------------------------
// Constants — kept top-of-file so tests and downstream consumers (F-072/F-073)
//             reference exactly one place.
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const LEARNING_DIR = 'learning';
const CANDIDATES_DIR = 'candidates';
const PATTERNS_DIR = 'patterns';
const QUEUE_DIR = 'queue';

// AC-2: thresholds. Centralised so a future tuning lives in one place and the
// adversarial tests can verify exact behaviour.
const THRESHOLD_OVERRIDE_COUNT = 3;
const THRESHOLD_REGRET_COUNT = 1;

// AC-1: TF-IDF top-K within each session. K=5 covers the high-signal head;
// anything below is noise or single-occurrence.
const TFIDF_TOP_K_PER_SESSION = 5;

// Length cap for any string field that might land in a briefing or pattern record.
// Mirrors cap-telemetry.cjs#ID_MAX so a hostile caller cannot smuggle a prompt
// through e.g. a manipulated featureId or contextHash field.
const ID_MAX = 200;

// P-NNN ID format.
const PATTERN_ID_PREFIX = 'P-';
const PATTERN_ID_PAD = 3;

/**
 * @typedef {Object} HeuristicCandidate
 * @property {string} candidateId - Stable hash of the (signalType + featureId + contextKey) tuple. Used as the briefing dedup key.
 * @property {'override'|'memory-ref'|'regret'} signalType
 * @property {string|null} featureId - Most-frequent featureId across the records that produced this candidate.
 * @property {number} count - Total record count contributing to this candidate.
 * @property {number} score - Maximum TF-IDF score for this candidate's token across all sessions.
 *   Separate from `count`: F-072 (fitness) and F-073 (review) can sort by either depending on what
 *   they need. Magnitude (TF-IDF) reveals "rare-but-concentrated" patterns; count reveals "loud"
 *   patterns. The orchestrator default-sorts by count for stable strong-cluster-first ordering.
 * @property {Array<{featureId: string|null, count: number}>} byFeature - Per-feature breakdown, sorted descending by count.
 * @property {Array<{hash: string, count: number}>} topContextHashes - Top-N context hashes that produced this candidate, sorted descending by count.
 * @property {{kind:'L1', target:string, from:number, to:number, rationale:string}} suggestion - Heuristic-only L1 proposal — Stage 2 may upgrade this to L2/L3.
 */

/**
 * @typedef {Object} PatternRecord
 * @property {string} id - 'P-NNN'.
 * @property {string} createdAt - ISO timestamp.
 * @property {'L1'|'L2'|'L3'} level
 * @property {string|null} featureRef - Feature ID this pattern targets (e.g. 'F-070').
 * @property {'heuristic'|'llm'} source - Whether this was promoted via Stage 2 (llm) or persisted heuristic-only (heuristic).
 * @property {boolean} degraded - True when LLM stage was unavailable and the heuristic-only suggestion is final.
 * @property {number} confidence - 0..1.
 * @property {Object} suggestion - Shape depends on `level` (L1: parameter tweak, L2: rule, L3: prompt-template patch).
 * @property {{candidateId:string, signalType:string, count:number, topContextHashes:Array<{hash:string,count:number}>}} evidence
 */

// -----------------------------------------------------------------------------
// Internal helpers — directory + IO
// -----------------------------------------------------------------------------

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // Public boundary callers swallow errors; the next write will surface persistent IO problems.
  }
}

function learningRoot(projectRoot) {
  return path.join(projectRoot, CAP_DIR, LEARNING_DIR);
}

function candidatesDir(projectRoot) {
  return path.join(learningRoot(projectRoot), CANDIDATES_DIR);
}

function patternsDir(projectRoot) {
  return path.join(learningRoot(projectRoot), PATTERNS_DIR);
}

function queueDir(projectRoot) {
  return path.join(learningRoot(projectRoot), QUEUE_DIR);
}

// -----------------------------------------------------------------------------
// Read-side wiring for F-074 applied-state — closes the V5 self-learning loop.
//
// @cap-decision(F-071/D9) Read .cap/learning/applied-state.json directly with a tiny inline helper
//                 instead of `require('./cap-pattern-apply.cjs')`. cap-pattern-apply already requires
//                 cap-pattern-pipeline, so importing it here would create a circular dependency.
//                 Schema is owned by F-074 and documented at cap-pattern-apply#readAppliedState
//                 (F-074/D2): { version:1, l1:{ '<featureId>/<KEY>': value }, l2:[], l3:[] }.
// -----------------------------------------------------------------------------

const APPLIED_STATE_RELATIVE = path.join(CAP_DIR, LEARNING_DIR, 'applied-state.json');

/**
 * Look up the L1 override value for a given featureId+key. Returns `null` when the file is missing,
 * malformed, the key is absent, or the value fails the validator. Pure read, never throws.
 *
 * @cap-risk(F-071/D9) The applied-state file is hand-editable. A user (or a buggy pattern) could
 *                     stuff a string, NaN, or negative number into the L1 map. The validator below
 *                     is the trust boundary — anything that fails it falls back to the constant
 *                     default. The strict integer check exists so a malformed file cannot weaken
 *                     promotion gates (e.g. `to: -1` would otherwise allow every cluster through).
 *
 * @param {string} projectRoot
 * @param {string} featureId - 'F-070' style; null/non-string returns null.
 * @param {string} key - Sub-key, e.g. 'threshold'. Combined as `${featureId}/${key}` per F-074/D2.
 * @param {(v: unknown) => boolean} validator - True when the value is acceptable. Mandatory.
 * @returns {*} The validated value, or null.
 */
function readAppliedL1(projectRoot, featureId, key, validator) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  if (typeof featureId !== 'string' || featureId.length === 0) return null;
  if (typeof key !== 'string' || key.length === 0) return null;
  if (typeof validator !== 'function') return null;
  const fp = path.join(projectRoot, APPLIED_STATE_RELATIVE);
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (_e) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  const l1 = parsed && parsed.l1;
  if (!l1 || typeof l1 !== 'object' || Array.isArray(l1)) return null;
  const value = l1[`${featureId}/${key}`];
  if (value === undefined) return null;
  return validator(value) ? value : null;
}

/**
 * Strict positive-integer validator for threshold values. Rejects strings, floats, NaN, Infinity,
 * negatives, and zero. Threshold of 0 would mean "every cluster promotes immediately", which is
 * semantically broken — refuse it at the boundary.
 * @param {unknown} v
 * @returns {boolean}
 */
function isPositiveIntegerThreshold(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && Number.isFinite(v);
}

/**
 * Compute the effective threshold for a (signalType, featureId) pair, honouring any L1 override
 * applied via F-074. Falls back to the module constant when no override is applicable.
 *
 * Lookup precedence:
 *   1. applied-state.json#l1[`${featureId}/threshold`] — when projectRoot + featureId provided
 *   2. THRESHOLD_REGRET_COUNT (regret) / THRESHOLD_OVERRIDE_COUNT (override, anything else)
 *
 * memory-ref candidates never promote; callers gate them out before reaching here.
 *
 * @param {string|null|undefined} projectRoot
 * @param {string} signalType
 * @param {string|null|undefined} featureId
 * @returns {number}
 */
function getEffectiveThreshold(projectRoot, signalType, featureId) {
  const fallback = signalType === 'regret' ? THRESHOLD_REGRET_COUNT : THRESHOLD_OVERRIDE_COUNT;
  const override = readAppliedL1(projectRoot, featureId, 'threshold', isPositiveIntegerThreshold);
  return override === null ? fallback : override;
}

/**
 * Cap a string at ID_MAX, return null for non-strings or empty.
 */
function capId(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.slice(0, ID_MAX);
}

// -----------------------------------------------------------------------------
// TF-IDF tokenizer — operates on hash-tuples, NOT free text.
//
// @cap-decision(F-071/D4) Tokens are tuples like `${signalType}|${featureId}|${contextKey}`. Documents
//                 are sessions. The privacy boundary in F-070 already hashed paths and decision
//                 fields, so token-strings are hash-clean by construction. This is the unusual bit:
//                 standard TF-IDF runs on word tokens; we run it on structured hash-tuples. The same
//                 math still applies (TF · IDF ranks token rarity within a session), just over a
//                 different alphabet.
// -----------------------------------------------------------------------------

/**
 * Build a stable tuple-token from a signal record. The contextKey is the part that distinguishes
 * different "instances" of the same problem within the same featureId — for overrides we use
 * targetFileHash; for regrets we use decisionId; for memory-refs we use the contextHash.
 *
 * @param {object} record
 * @returns {string}
 */
function buildToken(record) {
  const safe = record || {};
  const signalType = capId(safe.signalType) || 'unknown';
  const featureId = capId(safe.featureId) || 'unassigned';
  let contextKey;
  if (signalType === 'override') {
    contextKey = capId(safe.targetFileHash) || capId(safe.contextHash) || capId(safe.subType) || 'unknown';
  } else if (signalType === 'regret') {
    contextKey = capId(safe.decisionId) || capId(safe.contextHash) || 'unknown';
  } else {
    // memory-ref
    contextKey = capId(safe.memoryFileHash) || capId(safe.contextHash) || 'unknown';
  }
  return `${signalType}|${featureId}|${contextKey}`;
}

/**
 * Group records by sessionId. Records without a sessionId go into the `__no-session__` bucket
 * so they still contribute to global counts — but their TF-IDF treats the bucket as a single
 * synthetic session, which is the safe default (under-counts rather than over-promotes).
 *
 * @param {Array<object>} records
 * @returns {Map<string, Array<object>>}
 */
function groupBySession(records) {
  const map = new Map();
  for (const r of records || []) {
    const sid = (r && typeof r.sessionId === 'string' && r.sessionId.length > 0)
      ? r.sessionId
      : '__no-session__';
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(r);
  }
  return map;
}

/**
 * Compute TF-IDF scores for tokens within each session. Returns a flat array of
 * { token, sessionId, tfidf, count } entries — one per (token × session) pair.
 *
 * TF = count of token in session.
 * IDF = log(totalSessions / sessionsContainingToken).
 * For a single-session corpus IDF = log(1) = 0; we floor IDF at a small epsilon
 * so TF·IDF still ranks within the lone session by raw frequency.
 *
 * @param {Array<object>} records
 * @returns {{ tokenScores: Array<{token:string, sessionId:string, tfidf:number, count:number}>, sessionsByToken: Map<string,Set<string>>, recordsByToken: Map<string, Array<object>> }}
 */
function computeTfIdf(records) {
  const sessions = groupBySession(records);
  const totalSessions = Math.max(1, sessions.size);
  const sessionsByToken = new Map();
  const recordsByToken = new Map();

  // Per-session token frequencies.
  /** @type {Map<string, Map<string, number>>} */
  const sessionTokenCounts = new Map();
  for (const [sid, sessionRecords] of sessions.entries()) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const r of sessionRecords) {
      const t = buildToken(r);
      counts.set(t, (counts.get(t) || 0) + 1);
      if (!sessionsByToken.has(t)) sessionsByToken.set(t, new Set());
      sessionsByToken.get(t).add(sid);
      if (!recordsByToken.has(t)) recordsByToken.set(t, []);
      recordsByToken.get(t).push(r);
    }
    sessionTokenCounts.set(sid, counts);
  }

  const tokenScores = [];
  for (const [sid, counts] of sessionTokenCounts.entries()) {
    for (const [token, tf] of counts.entries()) {
      const docFreq = sessionsByToken.get(token).size;
      // IDF with a small floor so single-session corpora still rank.
      const idf = Math.max(0.01, Math.log(totalSessions / Math.max(1, docFreq)));
      tokenScores.push({ token, sessionId: sid, tfidf: tf * idf, count: tf });
    }
  }

  return { tokenScores, sessionsByToken, recordsByToken };
}

/**
 * Pick the top-K tokens per session by TF-IDF, then deduplicate to a flat set
 * (a token reaching top-K in any session is selected). The result is the set of
 * "interesting" tokens; downstream code attaches global counts and applies the
 * AC-2 threshold or the absolute-count fallback.
 *
 * @param {Array<{token:string, sessionId:string, tfidf:number}>} tokenScores
 * @param {number} k
 * @returns {Set<string>}
 */
function topKTokensPerSession(tokenScores, k) {
  /** @type {Map<string, Array<{token:string, tfidf:number}>>} */
  const bySession = new Map();
  for (const s of tokenScores) {
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
    bySession.get(s.sessionId).push({ token: s.token, tfidf: s.tfidf });
  }
  const selected = new Set();
  for (const [, arr] of bySession.entries()) {
    arr.sort((a, b) => b.tfidf - a.tfidf);
    for (let i = 0; i < Math.min(k, arr.length); i++) {
      selected.add(arr[i].token);
    }
  }
  return selected;
}

// -----------------------------------------------------------------------------
// Heuristic stage — Stage 1
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-1) Stage-1 deterministic heuristic engine: TF-IDF + RegEx-Cluster + Frequency
//                          on signal records. Writes per-candidate JSON to .cap/learning/candidates/.
/**
 * Run Stage 1 — the deterministic heuristic engine — over all signals across the three F-070
 * collectors. Returns a list of HeuristicCandidate objects sorted by descending score, and writes
 * one `.cap/learning/candidates/<candidateId>.json` per candidate.
 *
 * Pure compute over the F-070 query API — never reads JSONL files directly. AC-7 budget reading is
 * NOT performed here; that's the orchestrator's job (Step 4 of /cap:learn).
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.sessionId] - Optional filter — only consider records from this session.
 * @param {number} [options.topK] - Override TFIDF_TOP_K_PER_SESSION (mostly for tests).
 * @param {boolean} [options.persist] - When false, candidates are returned but not written to disk. Default true.
 * @returns {{ candidates: HeuristicCandidate[], errors: string[] }}
 */
function runHeuristicStage(projectRoot, options) {
  const opts = options || {};
  const errors = [];
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { candidates: [], errors: ['projectRoot is required'] };
  }
  const persist = opts.persist !== false;
  const topK = typeof opts.topK === 'number' && opts.topK > 0 ? opts.topK : TFIDF_TOP_K_PER_SESSION;

  // Collect all three signal types via the F-070 query API. The range filter is honoured iff
  // sessionId is supplied — otherwise we operate on the full corpus. AC-1 doesn't restrict
  // the range; consumers wanting a window pass sessionId or a future range.
  const range = opts.sessionId ? { sessionId: opts.sessionId } : undefined;
  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try {
    overrides = learningSignals.getSignals(projectRoot, 'override', range) || [];
  } catch (e) {
    errors.push(`getSignals(override) failed: ${e && e.message ? e.message : 'unknown'}`);
  }
  try {
    memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref', range) || [];
  } catch (e) {
    errors.push(`getSignals(memory-ref) failed: ${e && e.message ? e.message : 'unknown'}`);
  }
  try {
    regrets = learningSignals.getSignals(projectRoot, 'regret', range) || [];
  } catch (e) {
    errors.push(`getSignals(regret) failed: ${e && e.message ? e.message : 'unknown'}`);
  }

  const allRecords = [...overrides, ...memoryRefs, ...regrets];
  if (allRecords.length === 0) {
    return { candidates: [], errors };
  }

  // TF-IDF on the union — but we then walk each token and inspect its records' actual signalType.
  // That keeps memory-ref counts visible alongside override / regret counts in the same ranking.
  const { tokenScores, recordsByToken } = computeTfIdf(allRecords);
  const topTokens = topKTokensPerSession(tokenScores, topK);

  // Map<token, maxTfidf> — used by candidate() to populate the persisted `score` field separately
  // from the record `count`. We keep both because F-072 (fitness) and F-073 (review) may want to
  // sort by either; pre-computing the per-token max keeps candidate() pure.
  // @cap-decision(F-071/D6) `score` (TF-IDF magnitude) and `count` (record count) are persisted as
  //                  separate fields. Splitting was a PIN-decision before ship — F-072 will pick.
  /** @type {Map<string, number>} */
  const maxTfidfByToken = new Map();
  for (const s of tokenScores) {
    const cur = maxTfidfByToken.get(s.token) || 0;
    if (s.tfidf > cur) maxTfidfByToken.set(s.token, s.tfidf);
  }

  // ALSO include any token whose absolute count meets the AC-2 threshold, even if it didn't make
  // it into the per-session top-K. This is the "frequency" arm of AC-1's heuristic engine.
  // @cap-todo(ac:F-071/AC-1) Frequency-analysis arm: tokens with count >= threshold are considered
  //                          regardless of TF-IDF rank.
  // @cap-decision(F-071/D9) Effective threshold respects per-featureId L1 overrides from F-074
  //                  applied-state.json. The token's first record carries the featureId; if a user
  //                  applied P-NNN that proposed `F-070/threshold: 4`, the F-070 cluster needs 4
  //                  records (not 3) to reach the frequency arm.
  for (const [token, recs] of recordsByToken.entries()) {
    const recsArr = recs;
    const sigType = (recsArr[0] && recsArr[0].signalType) || 'unknown';
    const featureIdForToken = recsArr[0] && capId(recsArr[0].featureId);
    const requiredCount = getEffectiveThreshold(projectRoot, sigType, featureIdForToken);
    if (recsArr.length >= requiredCount) topTokens.add(token);
  }

  /** @type {HeuristicCandidate[]} */
  const candidates = [];
  for (const token of topTokens) {
    const recs = recordsByToken.get(token) || [];
    if (recs.length === 0) continue;

    // RegEx-cluster arm: group regret tokens by decisionId family. The token already encodes
    // featureId, so a "family" is simply (signalType + featureId) — same family already shares
    // a candidate. The clustering effect is implicit in the tuple-token construction.
    // @cap-todo(ac:F-071/AC-1) RegEx-Cluster arm — the `signalType|featureId|contextKey` tuple IS
    //                          the cluster key. Tokens are members of the same cluster iff they share
    //                          the (signalType, featureId) prefix; the contextKey distinguishes
    //                          instances within the cluster.

    candidate(candidates, token, recs, maxTfidfByToken.get(token) || 0, projectRoot);
  }

  // @cap-decision(F-071/D9) Post-collection effective-threshold filter. The TF-IDF arm could still
  //                  bubble up a "rare-but-concentrated" cluster whose count is below an applied
  //                  threshold; in the V5 loop the user has explicitly said "I don't want F-X
  //                  candidates until 4 records accumulate", so we drop them here instead of
  //                  surfacing them in the review board where they'd just produce noise. Stage 2
  //                  promotion (`checkThreshold`) is also threshold-aware as defense-in-depth.
  const filtered = candidates.filter((c) => {
    if (c.signalType === 'memory-ref') return true; // memory-ref carries positive signal — never filtered.
    const required = getEffectiveThreshold(projectRoot, c.signalType, c.featureId);
    return Number(c.count) >= required;
  });

  // Sort by count descending so the orchestrator processes the loudest clusters first.
  // F-072 / F-073 may resort by score (TF-IDF magnitude) when "rare-but-concentrated" matters more
  // than "loud" — both fields are persisted on the candidate.
  filtered.sort((a, b) => b.count - a.count);
  candidates.length = 0;
  for (const c of filtered) candidates.push(c);

  if (persist && candidates.length > 0) {
    ensureDir(candidatesDir(projectRoot));
    for (const c of candidates) {
      try {
        const fp = path.join(candidatesDir(projectRoot), `${c.candidateId}.json`);
        fs.writeFileSync(fp, JSON.stringify(c, null, 2) + '\n', 'utf8');
      } catch (e) {
        errors.push(`persist candidate ${c.candidateId} failed: ${e && e.message ? e.message : 'unknown'}`);
      }
    }
  }

  return { candidates, errors };
}

/**
 * Build a HeuristicCandidate from a token and its contributing records. Pushed onto the accumulator.
 * Internal helper for runHeuristicStage.
 *
 * @param {HeuristicCandidate[]} acc
 * @param {string} token
 * @param {Array<object>} recs
 * @param {number} tfidfScore - Maximum TF-IDF score for this token across all sessions.
 * @param {string} [projectRoot] - Forwarded to buildHeuristicSuggestion so the L1 `from` reflects
 *   any applied F-074 threshold override; absent => fallback to constants. (F-071/D9)
 */
function candidate(acc, token, recs, tfidfScore, projectRoot) {
  const signalType = recs[0].signalType;

  // Per-feature breakdown, sorted descending.
  /** @type {Map<string|null, number>} */
  const featureCounts = new Map();
  for (const r of recs) {
    const fid = capId(r.featureId);
    featureCounts.set(fid, (featureCounts.get(fid) || 0) + 1);
  }
  const byFeature = [...featureCounts.entries()]
    .map(([featureId, count]) => ({ featureId, count }))
    .sort((a, b) => b.count - a.count);

  // Top context hashes — the contextHash field is the F-070 dedup key; we count occurrences.
  /** @type {Map<string, number>} */
  const hashCounts = new Map();
  for (const r of recs) {
    // @cap-risk(F-071/AC-3) Only the contextHash hex string is taken — never the targetFile,
    //                       never the decisionId, never any free-text field. The privacy gate
    //                       in F-070 already hashed those at the source.
    const h = capId(r.contextHash);
    if (!h) continue;
    hashCounts.set(h, (hashCounts.get(h) || 0) + 1);
  }
  const topContextHashes = [...hashCounts.entries()]
    .map(([hash, count]) => ({ hash, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // candidateId = stable hash of the token. Re-using telemetry.hashContext keeps the hash function
  // identical to the F-070 / F-061 privacy gate — single source of truth.
  const candidateId = telemetry.hashContext(token);

  const dominantFeature = byFeature[0] && byFeature[0].featureId;
  const score = tfidfScore; // TF-IDF magnitude — separate from `count` per @cap-decision(F-071/D6)

  // Heuristic-only L1 suggestion — a parameter tweak the user could apply WITHOUT an LLM call.
  // This is the "graceful degradation" payload (AC-5): if Stage 2 is skipped, this still ships.
  const suggestion = buildHeuristicSuggestion(signalType, recs, dominantFeature, projectRoot);

  acc.push({
    candidateId,
    signalType,
    featureId: dominantFeature,
    count: recs.length,
    score,
    byFeature,
    topContextHashes,
    suggestion,
  });
}

// @cap-risk(F-071/AC-1) L1 oscillation: each run raises threshold by `to = recs.length + 1`. Two
//                       consecutive runs on a 4-record cluster with threshold 3 propose 4, then on a
//                       4-record cluster with threshold 4 propose 5, … unbounded climb. The dampener
//                       lives in F-072 (fitness scoring): a low-fitness pattern is auto-retracted by
//                       F-074, breaking the loop. If F-072 is removed or skipped, this heuristic
//                       becomes unstable. Do not loosen `to = recs.length + 1` without F-072 in place.
/**
 * Build a heuristic-only L1 suggestion. The shape mirrors the L1 example in the F-071 brief:
 * { kind:'L1', target, from, to, rationale }.
 *
 * @param {string} signalType
 * @param {Array<object>} recs
 * @param {string|null} featureId
 * @param {string} [projectRoot] - When provided, `from` reflects the effective threshold (any
 *   applied F-074 override), not just the constant default. (F-071/D9)
 * @returns {{kind:'L1', target:string, from:number, to:number, rationale:string}}
 */
function buildHeuristicSuggestion(signalType, recs, featureId, projectRoot) {
  // Default: propose raising the AC-2 threshold so the same cluster wouldn't promote next time.
  // The "from" anchors at the current threshold; "to" proposes the next step (count + 1) so the
  // cluster has to grow further before re-triggering.
  const target = featureId ? `${featureId}/threshold` : 'F-071/threshold';
  const from = getEffectiveThreshold(projectRoot, signalType, featureId);
  const to = recs.length + 1;
  // @cap-risk(F-071/AC-3) The rationale is a pure-structural string — count + featureId.
  //                       No raw paths, no decision text. Safe to persist.
  const rationale = `Cluster of ${recs.length} ${signalType} signals${
    featureId ? ` on ${featureId}` : ''
  } would not have triggered if threshold had been ${to}.`;
  return { kind: 'L1', target, from, to, rationale };
}

// -----------------------------------------------------------------------------
// Threshold check — AC-2
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-2) Stage-2 trigger: candidate hits threshold (>=3 similar overrides OR >=1 regret).
/**
 * Decide whether a candidate qualifies for Stage 2. Memory-ref candidates never trigger Stage 2 —
 * memory-ref tells you a memory is *valuable*, not that something is *wrong*; promoting it would
 * waste the LLM budget on positive-signal data.
 *
 * Override candidates additionally must share `featureId` across all records (the candidate token
 * already encodes featureId, so this is implicit when the candidate was built from a single token).
 *
 * @cap-decision(F-071/D9) Optional `projectRoot` consults applied-state.json for a per-featureId
 *                  override. Backwards-compatible: when projectRoot is omitted, behaviour falls
 *                  through to the module constants exactly as before, so existing callers
 *                  (and the AC-2 unit tests) keep working unchanged.
 *
 * @param {HeuristicCandidate} candidate
 * @param {string} [projectRoot]
 * @returns {boolean}
 */
function checkThreshold(candidate, projectRoot) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.signalType === 'memory-ref') return false;
  if (candidate.signalType !== 'override' && candidate.signalType !== 'regret') return false;
  const required = getEffectiveThreshold(projectRoot, candidate.signalType, candidate.featureId);
  return Number(candidate.count) >= required;
}

// -----------------------------------------------------------------------------
// P-NNN allocation — compute-on-read from filenames
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-6) P-NNN allocation: sequential, never renumbered. Compute-on-read.
/**
 * Allocate the next P-NNN id by scanning .cap/learning/patterns/P-*.json AND
 * .cap/learning/queue/P-*.md filenames. Returns 'P-001' when no files exist.
 *
 * AC-6 contract: "sequential, never renumbered" — gaps are fine. We return max(existing IDs) + 1.
 * If P-005 exists in the queue and P-001/P-002 in patterns, next is P-006. Pattern files and queue
 * files share the ID namespace because a deferred candidate retains its assigned ID across sessions.
 *
 * @param {string} projectRoot
 * @returns {string} 'P-NNN'
 */
function allocatePatternId(projectRoot) {
  const ids = listExistingPatternIds(projectRoot);
  let max = 0;
  for (const id of ids) {
    const n = parsePatternId(id);
    if (n != null && n > max) max = n;
  }
  return formatPatternId(max + 1);
}

/**
 * List every P-NNN id present in patterns/ (json) or queue/ (md). De-duplicated.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
function listExistingPatternIds(projectRoot) {
  const ids = new Set();
  const scan = (dir, suffix) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_e) {
      return;
    }
    for (const f of entries) {
      if (!f.endsWith(suffix)) continue;
      const base = f.slice(0, -suffix.length);
      if (/^P-\d+$/.test(base)) ids.add(base);
    }
  };
  scan(patternsDir(projectRoot), '.json');
  scan(queueDir(projectRoot), '.md');
  return [...ids];
}

function parsePatternId(id) {
  const m = /^P-(\d+)$/.exec(id || '');
  return m ? parseInt(m[1], 10) : null;
}

function formatPatternId(n) {
  return `${PATTERN_ID_PREFIX}${String(n).padStart(PATTERN_ID_PAD, '0')}`;
}

// -----------------------------------------------------------------------------
// Briefing builder — Stage 2 input (counts + hashes only)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-3) PRIVACY-CRITICAL — LLM input is counts + hashes only. Constructs the
//                          structured aggregate { candidateId, signalType, count, byFeature,
//                          topContextHashes } and writes it to .cap/learning/queue/P-NNN.md as the
//                          briefing the outer agent will read.
// @cap-risk(F-071/AC-3) This is THE place where LLM-bound payload is constructed. Any new field
//                       added here MUST be a count or a hex hash. No paths, no decision text,
//                       no record verbatim, no targetFile string. The adversarial test injects
//                       SECRET_NEEDLE values into every input field and asserts zero needle bytes
//                       in the briefing markdown.
/**
 * Build a briefing for Stage 2 and persist it to .cap/learning/queue/P-NNN.md.
 *
 * The briefing is the ONLY artifact the outer agent (LLM) reads. It MUST contain only counts and
 * hex hashes — never raw paths, decision text, or record verbatim. The structured payload is also
 * returned for testing and for the orchestrator to forward to the agent.
 *
 * @param {HeuristicCandidate} candidate
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.id] - Pre-allocated P-NNN id (optional; allocated if omitted).
 * @param {boolean} [options.deferred] - When true, the briefing carries a `deferred: budget` marker.
 * @returns {{ id: string, briefingPath: string, payload: object }|null}
 */
function buildBriefing(candidate, projectRoot, options) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;

  const opts = options || {};
  const id = opts.id || allocatePatternId(projectRoot);
  const deferred = opts.deferred === true;

  // @cap-risk(F-071/AC-3) Build the payload from STRUCTURED COUNTS + HEX HASHES only.
  //                       Validate every hash is hex via /^[0-9a-f]+$/ — anything else is dropped
  //                       defensively. This guards against a bug upstream (e.g. a future contributor
  //                       passing the raw path through here by mistake).
  // @cap-risk(F-071/AC-3) featureId is structured metadata, but the briefing enforces strict shape
  //                       /^F-\d{3,}$/ — anything else collapses to null. A future contributor who
  //                       tries to smuggle text via a hand-crafted featureId (e.g. by writing the
  //                       record with a non-conforming string) will see the field disappear from
  //                       the briefing rather than leak. The featureId-as-smuggle-channel attack is
  //                       proven impossible in tests (cap-pattern-pipeline-adversarial.test.cjs).
  const safeFeature = (s) => {
    const v = capId(s);
    if (v == null) return null;
    return /^F-\d{3,}$/.test(v) ? v : null;
  };
  const isHexHash = (h) => typeof h === 'string' && /^[0-9a-f]+$/.test(h) && h.length <= 64;

  const byFeature = (Array.isArray(candidate.byFeature) ? candidate.byFeature : [])
    .map((row) => ({ featureId: safeFeature(row && row.featureId), count: Math.max(0, Number(row && row.count) || 0) }))
    .filter((row) => Number.isFinite(row.count));
  const topContextHashes = (Array.isArray(candidate.topContextHashes) ? candidate.topContextHashes : [])
    .filter((row) => row && isHexHash(row.hash))
    .map((row) => ({ hash: row.hash, count: Math.max(0, Number(row.count) || 0) }));

  const payload = {
    candidateId: typeof candidate.candidateId === 'string' && /^[0-9a-f]+$/.test(candidate.candidateId)
      ? candidate.candidateId
      : telemetry.hashContext(String(candidate.candidateId || 'unknown')),
    signalType: candidate.signalType === 'override' || candidate.signalType === 'regret'
      ? candidate.signalType
      : 'unknown',
    count: Math.max(0, Number(candidate.count) || 0),
    byFeature,
    topContextHashes,
  };

  ensureDir(queueDir(projectRoot));
  const briefingPath = path.join(queueDir(projectRoot), `${id}.md`);

  // Markdown body — pure counts + hashes. The frontmatter carries the deferred marker (AC-4).
  const md = renderBriefingMarkdown(id, payload, deferred);
  try {
    fs.writeFileSync(briefingPath, md, 'utf8');
  } catch (_e) {
    return null;
  }

  return { id, briefingPath, payload };
}

/**
 * Render the briefing markdown. Frontmatter + sections; the payload is the only source of content.
 *
 * @param {string} id
 * @param {object} payload
 * @param {boolean} deferred
 * @returns {string}
 */
function renderBriefingMarkdown(id, payload, deferred) {
  const lines = [];
  lines.push('---');
  lines.push(`id: ${id}`);
  lines.push(`signalType: ${payload.signalType}`);
  lines.push(`count: ${payload.count}`);
  lines.push(`candidateId: ${payload.candidateId}`);
  if (deferred) lines.push('deferred: budget');
  lines.push('---');
  lines.push('');
  lines.push(`# Pattern Briefing ${id}`);
  lines.push('');
  lines.push('Counts + hashes only. No raw signals, no user text, no file paths. (F-071/AC-3)');
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push(`- signalType: \`${payload.signalType}\``);
  lines.push(`- count: ${payload.count}`);
  lines.push(`- candidateId: \`${payload.candidateId}\``);
  lines.push('');
  lines.push('## By Feature');
  lines.push('');
  if (payload.byFeature.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const row of payload.byFeature) {
      lines.push(`- \`${row.featureId == null ? '(unassigned)' : row.featureId}\` — ${row.count}`);
    }
  }
  lines.push('');
  lines.push('## Top Context Hashes');
  lines.push('');
  if (payload.topContextHashes.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const row of payload.topContextHashes) {
      lines.push(`- \`${row.hash}\` — ${row.count}`);
    }
  }
  lines.push('');
  lines.push('## Task');
  lines.push('');
  lines.push('Choose ONE of L1 / L2 / L3 and write the result to');
  lines.push(`\`.cap/learning/patterns/${id}.json\` matching the documented schema.`);
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Pattern persistence — write/read P-NNN.json
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-5) Graceful degradation — when LLM stage cannot run, persist the heuristic
//                          L1 suggestion with degraded:true. Marked via markDegraded() helper.
// @cap-todo(ac:F-071/AC-6) PatternRecord schema persisted here: id, level, featureRef, source,
//                          degraded, confidence, suggestion, evidence.
/**
 * Persist a PatternRecord to .cap/learning/patterns/P-NNN.json. Lazy-creates the directory.
 *
 * @param {string} projectRoot
 * @param {PatternRecord} pattern
 * @returns {boolean}
 */
function recordPatternSuggestion(projectRoot, pattern) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  if (!pattern || typeof pattern !== 'object') return false;
  if (typeof pattern.id !== 'string' || !/^P-\d+$/.test(pattern.id)) return false;

  ensureDir(patternsDir(projectRoot));
  const fp = path.join(patternsDir(projectRoot), `${pattern.id}.json`);
  try {
    fs.writeFileSync(fp, JSON.stringify(pattern, null, 2) + '\n', 'utf8');
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Persist a heuristic-only PatternRecord (degraded path). Helper used by the orchestrator's
 * AC-5 fallback when an outer agent doesn't process the briefing in this session.
 *
 * @cap-decision(F-071/D8) Clobber protection: if `patterns/<id>.json` already exists with
 *   `source !== 'heuristic'` (i.e. an LLM stage actually produced a pattern for this id), the
 *   degraded fallback MUST NOT overwrite it. Returns `{ written: false, reason: 'llm-pattern-exists' }`
 *   so the orchestrator knows to log instead of silently clobbering. Without this guard, a slow
 *   Stage-2 LLM result followed by a Step-5 fallback in the same session could silently lose the
 *   higher-quality LLM pattern. Foot-gun for F-072/F-073 wirers — closed pre-ship per Stage-2 review.
 * @cap-risk(F-071/AC-5) Two heuristic-only runs over the same id WILL overwrite (latest-wins is the
 *   intended degraded contract). The guard only blocks heuristic-over-llm clobber, not heuristic-
 *   over-heuristic refresh.
 *
 * @param {string} projectRoot
 * @param {string} id - 'P-NNN'
 * @param {HeuristicCandidate} candidate
 * @returns {boolean | { written: boolean, reason?: string, prior?: { source: string, level: string } }}
 *   - `true` when the degraded record was written (back-compat with prior boolean callers).
 *   - `false` when the candidate was nullish or the write itself failed.
 *   - `{ written: false, reason: 'llm-pattern-exists', prior }` when an LLM pattern was preserved.
 */
function markDegraded(projectRoot, id, candidate) {
  if (!candidate) return false;

  // Clobber-protection: read any existing pattern at this id and refuse to overwrite an LLM record.
  try {
    const existingPath = path.join(patternsDir(projectRoot), `${id}.json`);
    if (fs.existsSync(existingPath)) {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      if (existing && existing.source && existing.source !== 'heuristic') {
        return {
          written: false,
          reason: 'llm-pattern-exists',
          prior: { source: existing.source, level: existing.level },
        };
      }
    }
  } catch (_e) {
    // Read failure → fall through to write (latest-wins for malformed prior records).
  }

  /** @type {PatternRecord} */
  const pattern = {
    id,
    createdAt: new Date().toISOString(),
    level: 'L1',
    featureRef: candidate.featureId || null,
    source: 'heuristic',
    degraded: true,
    confidence: 0.5,
    suggestion: candidate.suggestion,
    evidence: {
      candidateId: candidate.candidateId,
      signalType: candidate.signalType,
      count: candidate.count,
      topContextHashes: candidate.topContextHashes || [],
    },
  };
  return recordPatternSuggestion(projectRoot, pattern);
}

/**
 * List all persisted PatternRecords. Reads `.cap/learning/patterns/P-*.json`. Tolerant to missing
 * directory and malformed files — they're skipped.
 *
 * @param {string} projectRoot
 * @returns {Array<PatternRecord>}
 */
function listPatterns(projectRoot) {
  const dir = patternsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    if (!/^P-\d+\.json$/.test(f)) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch (_e) {
      // Skip — malformed pattern files must not crash listing.
    }
  }
  // Sort by id ascending so consumers get a stable deterministic order.
  out.sort((a, b) => {
    const na = parsePatternId(a.id) || 0;
    const nb = parsePatternId(b.id) || 0;
    return na - nb;
  });
  return out;
}

// -----------------------------------------------------------------------------
// Budget gate — AC-4 / AC-7
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-071/AC-4) Budget hard-limit: 3 LLM calls per session by default. Overflow lands in
//                          .cap/learning/queue/ with deferred:budget. Re-uses readBudget +
//                          getLlmUsage from cap-telemetry.cjs — single source of truth.
// @cap-todo(ac:F-071/AC-7) Budget override from .cap/learning/config.json#llmBudgetPerSession.
//                          Honoured automatically because we delegate to telemetry.readBudget().
// @cap-risk(F-071/AC-4) The budget gate is THE reason we can ship Stage 2. A regression that
//                       bypasses readBudget / getLlmUsage would burn through the user's wallet
//                       silently. Every promotion path in this module routes through this function.
/**
 * Compute the remaining LLM-call budget for a session. Returns 0 when the session is at or over
 * the budget cap.
 *
 * @param {string} projectRoot
 * @param {string|null} sessionId
 * @returns {{ budget: number, used: number, remaining: number, source: 'config'|'default' }}
 */
function getSessionBudgetState(projectRoot, sessionId) {
  const { budget, source } = telemetry.readBudget(projectRoot);
  let used = 0;
  if (sessionId) {
    try {
      const calls = telemetry.getLlmUsage(projectRoot, { sessionId }) || [];
      used = calls.length;
    } catch (_e) {
      used = 0;
    }
  }
  const remaining = Math.max(0, budget - used);
  return { budget, used, remaining, source };
}

// -----------------------------------------------------------------------------
// Exports — keep this list minimal. F-072 / F-073 should consume only these.
// -----------------------------------------------------------------------------

module.exports = {
  // constants — exported for tests
  CAP_DIR,
  LEARNING_DIR,
  CANDIDATES_DIR,
  PATTERNS_DIR,
  QUEUE_DIR,
  THRESHOLD_OVERRIDE_COUNT,
  THRESHOLD_REGRET_COUNT,
  TFIDF_TOP_K_PER_SESSION,
  // public API
  runHeuristicStage,
  checkThreshold,
  allocatePatternId,
  buildBriefing,
  recordPatternSuggestion,
  markDegraded,
  listPatterns,
  getSessionBudgetState,
  getEffectiveThreshold,
  // path helpers — exported for tests / consumers; kept private from public docs
  candidatesDir,
  patternsDir,
  queueDir,
};
