// @cap-context CAP F-072 Compute Two-Layer Fitness Score — drives F-074 Pattern Unlearn. Pure-compute,
//                 deterministic, zero external deps. Reads only via cap-pattern-pipeline.listPatterns and
//                 cap-learning-signals.getSignals; writes per-pattern fitness records and append-only
//                 apply-snapshot JSONL under .cap/learning/fitness/. Layer 1 is a short-term Override
//                 *count* over the most-recently-observed sessionId; Layer 2 is a long-term per-session
//                 weighted average that activates at n >= 5 active sessions.
// @cap-decision(F-072/D1) AC-1 metric is a COUNT, not a rate. The number of override records in the most
//                 recent session whose evidence.candidateId matches the pattern's evidence.candidateId.
//                 Fallback path (defensive): when the pattern's evidence carries no candidateId, fall back
//                 to featureRef matching against the override record's featureId. Locked by user direction.
// @cap-decision(F-072/D2) AC-2 norm = active-session count (per-session average). Layer 2 activates at
//                 n >= 5; below that, the value is still computed (AC-5 requires the data exists from day
//                 one) and ready=false signals "do not display yet". Locked by user direction.
// @cap-decision(F-072/D3) "Pattern was active in session" = at least one signal in that session matches
//                 ONE of: evidence.candidateId on an override; OR evidence.candidateId on a regret; OR a
//                 memoryFileHash that the pattern references (memory-ref signals). Pinned definition;
//                 used by both Layer-2 norm and the AC-4 expired-after-20-sessions check.
// @cap-decision(F-072/D4) "Last session" for AC-1 = the most-recent sessionId observed in the override
//                 JSONL — NOT a wall-clock cut-off. Determinism (AC-7) requires no time-based gates.
//                 "Most-recent" is computed deterministically: the override record with the maximum
//                 ts string (lexicographic ISO-8601 sort) wins; ties resolved by the record's id field.
// @cap-decision(F-072/D5) Apply-snapshots are APPEND-ONLY (.snapshots.jsonl). Each call to
//                 recordApplySnapshot appends a fresh line — multiple applies in the same session
//                 produce multiple lines. F-074 reads the tail to compare pre-apply vs post-apply.
//                 AC-3 "Rolling-30-Sessions AND Lifetime aggregates simultaneously" is satisfied by
//                 splitting the two responsibilities: the canonical .json record IS the lifetime
//                 aggregate (cumulative across all sessions); the .snapshots.jsonl IS the rolling
//                 sequence (one line per apply event). F-074 / F-073 read both. User-confirmed
//                 before ship; an alternative (compute a 30-session rolling window inside the
//                 canonical record) was considered and rejected because it would double the formula
//                 surface and require a deterministic "last 30" cut-off without a clear use case yet.
// @cap-decision(F-072/D6) AC-7 zero-deps + deterministic. Wherever Sets/Maps drive iteration we sort
//                 the keys before consuming them. randomBytes / Date.now / Math.random are forbidden
//                 inside the score formulas (the persisted ts is the ONLY allowed time source, and it
//                 enters via options.now → never the formula).
// @cap-constraint Zero external dependencies: node:fs + node:path only. We never read overrides.jsonl /
//                 memory-refs.jsonl / regrets.jsonl directly — always via cap-learning-signals.getSignals.
//                 We never read pattern files directly — always via cap-pattern-pipeline.listPatterns.
//                 Single source of truth for both queries. cap-telemetry.hashContext is available if a
//                 hash is ever needed, but this module currently doesn't need one.
// @cap-risk(F-072/AC-7) DETERMINISM BOUNDARY — every code path that uses Set/Map for iteration MUST
//                       sort keys before iterating. Every code path that touches time MUST route through
//                       options.now and never let the timestamp affect the formula. The adversarial test
//                       runs computeFitness 10x and shuffles signal-record ordering to assert byte-level
//                       equality of the resulting FitnessRecord.

'use strict';

// @cap-feature(feature:F-072, primary:true) Compute Two-Layer Fitness Score — short-term override-count
//                                            + long-term weighted memory-ref/regret average per pattern.

const fs = require('node:fs');
const path = require('node:path');

const learningSignals = require('./cap-learning-signals.cjs');
const patternPipeline = require('./cap-pattern-pipeline.cjs');

// -----------------------------------------------------------------------------
// Constants — top-of-file so consumers (F-073, F-074, /cap:learn) and tests
//             reference exactly one place. Mirrors cap-pattern-pipeline.cjs layout.
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const LEARNING_DIR = 'learning';
const FITNESS_DIR = 'fitness';

// AC-2: Layer 2 activates at n >= 5 active sessions. Below that, ready=false but the
// value is still computed and persisted (AC-5).
const LAYER2_READY_THRESHOLD = 5;

// AC-2 weights. memory-ref signals (positive — "this pattern's territory was useful")
// count as 1; regret signals (negative — "we now wish we'd done differently") count as 2.
// Locked top-of-file so a future tuning lives in one place and the adversarial tests can
// verify exact behaviour.
const WEIGHT_MEMORY_REF = 1;
const WEIGHT_REGRET = 2;

// AC-4: a pattern that has been observed in zero sessions over the last EXPIRY_SESSIONS
// sessions worth of signals is auto-marked expired. The "last 20 sessions" window is
// computed from the union of session ids across the three signal types — NOT from a
// wall-clock window (D6 forbids time-based gates inside the formulas).
const EXPIRY_SESSIONS = 20;

// File-name shapes.
const FITNESS_JSON_SUFFIX = '.json';
const FITNESS_SNAPSHOTS_SUFFIX = '.snapshots.jsonl';

// Pattern-id format mirror — duplicated here only for the regex; the canonical
// allocator lives in cap-pattern-pipeline.cjs.
const PATTERN_ID_RE = /^P-\d+$/;

/**
 * @typedef {Object} FitnessLayer1
 * @property {'override-count'} kind
 * @property {number} value - Number of overrides in the most-recent session whose evidence.candidateId matches the pattern.
 * @property {string|null} lastSessionId - Most-recent sessionId observed in the override corpus (D4).
 */

/**
 * @typedef {Object} FitnessLayer2
 * @property {'weighted-average'} kind
 * @property {number} value - (memoryRefs * WEIGHT_MEMORY_REF + regrets * WEIGHT_REGRET) / activeSessions, or 0 when n=0.
 * @property {number} n - Active-session count for this pattern (across all signal types — see D3).
 * @property {boolean} ready - True iff n >= LAYER2_READY_THRESHOLD.
 */

/**
 * @typedef {Object} FitnessRecord
 * @property {string} id - Mirrors patternId for back-compat with the F-071 PatternRecord shape.
 * @property {string} patternId - 'P-NNN'.
 * @property {string} ts - ISO timestamp at which this record was persisted (NOT used in any formula).
 * @property {FitnessLayer1} layer1
 * @property {FitnessLayer2} layer2
 * @property {number} activeSessions - Same as layer2.n; surfaced top-level for convenience.
 * @property {string|null} lastSeenSessionId - Most-recent sessionId in which this pattern was active.
 * @property {string|null} lastSeenAt - ISO timestamp of the most-recent matching signal.
 * @property {boolean} expired - AC-4 marker; set by markExpired or runFitnessPass.
 * @property {{candidateId: string|null, featureRef: string|null}} evidence - Pinned identity used to match signals (D1).
 */

/**
 * @typedef {Object} SnapshotRecord
 * @property {string} ts - ISO timestamp at apply-time (D5).
 * @property {string} patternId
 * @property {FitnessLayer1} layer1
 * @property {FitnessLayer2} layer2
 * @property {number} n
 * @property {string[]} activeSessionsList - SORTED list of sessionIds in which the pattern was active. Sorted lock matches D6.
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

function fitnessDir(projectRoot) {
  return path.join(learningRoot(projectRoot), FITNESS_DIR);
}

function fitnessFilePath(projectRoot, patternId) {
  return path.join(fitnessDir(projectRoot), `${patternId}${FITNESS_JSON_SUFFIX}`);
}

function snapshotsFilePath(projectRoot, patternId) {
  return path.join(fitnessDir(projectRoot), `${patternId}${FITNESS_SNAPSHOTS_SUFFIX}`);
}

/**
 * Validate a P-NNN id. Rejects anything else defensively — every public function
 * routes through this gate so a hostile or malformed id can never become a path.
 *
 * @param {any} id
 * @returns {boolean}
 */
function isValidPatternId(id) {
  return typeof id === 'string' && PATTERN_ID_RE.test(id);
}

/**
 * Look up the persisted PatternRecord with the given id. Returns null when the
 * pattern is not found (or the patterns directory is missing). Never throws —
 * F-074 will call this on potentially-deleted ids and must get a clean null.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @returns {object|null}
 */
function findPattern(projectRoot, patternId) {
  try {
    const all = patternPipeline.listPatterns(projectRoot);
    if (!Array.isArray(all)) return null;
    for (const p of all) {
      if (p && p.id === patternId) return p;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Signal matching — turns a PatternRecord + a signal record into a boolean.
// D1, D3 live here.
// -----------------------------------------------------------------------------

/**
 * Extract the candidateId the pattern is anchored to, if any. F-071's PatternRecord
 * stores it under evidence.candidateId. Anything else (legacy or hand-written
 * patterns) falls back to null and we use featureRef as the matcher (D1).
 *
 * @param {object} pattern
 * @returns {string|null}
 */
function patternCandidateId(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  const ev = pattern.evidence;
  if (ev && typeof ev === 'object' && typeof ev.candidateId === 'string' && ev.candidateId.length > 0) {
    return ev.candidateId;
  }
  return null;
}

/**
 * Extract the featureRef the pattern targets. Used as the fallback matcher when
 * the pattern has no candidateId (D1). Defensive: only accept exact F-NNN shape.
 *
 * @param {object} pattern
 * @returns {string|null}
 */
function patternFeatureRef(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  if (typeof pattern.featureRef === 'string' && /^F-\d+$/.test(pattern.featureRef)) {
    return pattern.featureRef;
  }
  return null;
}

/**
 * Memory-file-hash anchors the pattern carries — a future LLM-stage pattern may
 * reference one or more memory files via evidence.memoryFileHashes[]. We accept
 * either a single string or an array; missing → empty array. D3.
 *
 * @param {object} pattern
 * @returns {string[]}
 */
function patternMemoryFileHashes(pattern) {
  if (!pattern || typeof pattern !== 'object') return [];
  const ev = pattern.evidence;
  if (!ev || typeof ev !== 'object') return [];
  const raw = ev.memoryFileHashes != null ? ev.memoryFileHashes : ev.memoryFileHash;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const h of arr) {
    if (typeof h === 'string' && h.length > 0) out.push(h);
  }
  return out;
}

/**
 * Decision-id anchors for regrets (D3). F-070 regrets carry decisionId; a future
 * LLM-stage pattern may reference specific decisionIds via evidence.decisionIds[].
 *
 * @param {object} pattern
 * @returns {string[]}
 */
function patternDecisionIds(pattern) {
  if (!pattern || typeof pattern !== 'object') return [];
  const ev = pattern.evidence;
  if (!ev || typeof ev !== 'object') return [];
  const raw = ev.decisionIds != null ? ev.decisionIds : ev.decisionId;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const d of arr) {
    if (typeof d === 'string' && d.length > 0) out.push(d);
  }
  return out;
}

/**
 * Does an OVERRIDE record match this pattern? D1 primary path: candidateId match.
 * Defensive fallback: when the pattern carries no candidateId we accept featureRef
 * matches. AC-7 demands this be deterministic — no time considerations.
 *
 * The override record's `evidence` field doesn't exist in F-070's record schema; the
 * pattern's evidence.candidateId is matched against an override-derived candidate
 * key. Since F-071 builds candidateId via telemetry.hashContext(token) where token
 * encodes (signalType, featureId, contextKey), and the override record carries the
 * same fields, we reconstruct the same key here and compare. Re-using F-071's
 * exact hashing primitive is over-engineering for the test surface — instead we
 * match on the structured fields directly: {signalType=override, featureId, targetFileHash}.
 * This stays robust if F-071's hashing changes.
 *
 * @param {object} record
 * @param {string|null} candidateId - Pattern's candidateId, if any.
 * @param {string|null} featureRef - Pattern's featureRef, if any.
 * @param {string|null} candidateFeatureId - Pattern's evidence-derived featureId (mirrors how F-071
 *   built the candidate). When the pattern has a candidateId we still need its featureId to match
 *   the override; we get it from pattern.evidence.featureId or fall back to featureRef.
 * @param {string|null} candidateContextHash - Pattern's evidence contextHash (the "topContextHashes[0].hash"
 *   F-071 persists). When present, prefer matching override.contextHash exactly — that's the strict identity.
 *
 * **Silent-zero edge case (debugging hint):** when `candidateId` is set BUT both
 * `candidateFeatureId` AND `featureRef` are null, this matcher returns false for every
 * override — there is no anchor to compare against. The result looks like "no overrides
 * match this pattern" without an obvious cause. The condition is unreachable in normal
 * flows (F-071 always populates either evidence.featureId or featureRef on a promoted
 * pattern), but a malformed legacy / hand-edited pattern record can land in this branch.
 * If you ever see Layer 1 stuck at 0 for a pattern that obviously has signals, check
 * `pattern.evidence.featureId` and `pattern.featureRef` first.
 * @returns {boolean}
 */
function overrideMatchesPattern(record, candidateId, featureRef, candidateFeatureId, candidateContextHash) {
  if (!record || record.signalType !== 'override') return false;
  // Primary path (D1): candidateId exists → the pattern was promoted by F-071. F-071 builds
  // candidateId via hashContext("override|<featureId>|<contextKey>") — i.e. featureId is BAKED
  // into the candidate identity. A faithful "candidateId match" therefore requires:
  //   (a) record.featureId === pattern's candidate-featureId, AND
  //   (b) when the pattern carries a contextHash anchor, record.contextHash matches it.
  // Without (b), all overrides on the same feature match — which is the right behaviour when
  // the pattern doesn't (yet) anchor to a specific contextHash. With (b), the match is strict.
  if (candidateId) {
    if (!candidateFeatureId) return false;
    if (record.featureId !== candidateFeatureId) return false;
    if (candidateContextHash) {
      // Strict identity: same feature AND same contextHash. Without the contextHash match,
      // an override on a different file under the same feature is NOT on the candidate territory.
      return typeof record.contextHash === 'string' && record.contextHash === candidateContextHash;
    }
    return true;
  }
  // Defensive fallback (D1): no candidateId → match on featureRef alone.
  if (featureRef && record.featureId === featureRef) return true;
  return false;
}

/**
 * Does a MEMORY-REF record match this pattern? D3 — memoryFileHash matches one of the
 * pattern's memory-file anchors, OR (defensive fallback) featureRef matches.
 *
 * @param {object} record
 * @param {string[]} memoryHashes
 * @param {string|null} featureRef
 * @returns {boolean}
 */
function memoryRefMatchesPattern(record, memoryHashes, featureRef) {
  if (!record || record.signalType !== 'memory-ref') return false;
  if (memoryHashes.length > 0 && typeof record.memoryFileHash === 'string') {
    for (const h of memoryHashes) {
      if (record.memoryFileHash === h) return true;
    }
  }
  // Fallback: feature-scoped memory reference.
  if (featureRef && record.featureId === featureRef) return true;
  return false;
}

/**
 * Does a REGRET record match this pattern? D3 — decisionId matches one of the
 * pattern's anchors, OR (defensive fallback) featureRef matches.
 *
 * @param {object} record
 * @param {string[]} decisionIds
 * @param {string|null} featureRef
 * @returns {boolean}
 */
function regretMatchesPattern(record, decisionIds, featureRef) {
  if (!record || record.signalType !== 'regret') return false;
  if (decisionIds.length > 0 && typeof record.decisionId === 'string') {
    for (const d of decisionIds) {
      if (record.decisionId === d) return true;
    }
  }
  if (featureRef && record.featureId === featureRef) return true;
  return false;
}

// -----------------------------------------------------------------------------
// Internal helpers — deterministic session bookkeeping
// -----------------------------------------------------------------------------

/**
 * Determine the most-recent sessionId across an override corpus. D4: lexicographic
 * max of the ts string with id as tiebreaker. Returns null when the corpus is empty
 * or all records are session-less.
 *
 * AC-7: this is the only place "latest" is computed. No Date.now, no wall clock —
 * we sort by the record's persisted timestamp, which is fully deterministic w.r.t.
 * the input corpus.
 *
 * @param {Array<object>} overrideRecords
 * @returns {string|null}
 */
function latestSessionId(overrideRecords) {
  if (!Array.isArray(overrideRecords) || overrideRecords.length === 0) return null;
  let bestTs = null;
  let bestId = null;
  let bestSession = null;
  for (const r of overrideRecords) {
    if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
    const ts = typeof r.ts === 'string' ? r.ts : '';
    const id = typeof r.id === 'string' ? r.id : '';
    // Deterministic ordering: ts desc, then id desc as tiebreaker.
    if (
      bestTs == null
      || ts > bestTs
      || (ts === bestTs && id > bestId)
    ) {
      bestTs = ts;
      bestId = id;
      bestSession = r.sessionId;
    }
  }
  return bestSession;
}

/**
 * Compute the set of sessionIds in which the pattern was active across all three
 * signal types. D3 + D6: returned as a SORTED array so any downstream iteration is
 * deterministic regardless of Set/Map insertion order.
 *
 * @param {object} pattern
 * @param {Array<object>} overrides
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @returns {string[]} Sorted list of sessionIds.
 */
function computeActiveSessions(pattern, overrides, memoryRefs, regrets) {
  const candidateId = patternCandidateId(pattern);
  const featureRef = patternFeatureRef(pattern);
  const memoryHashes = patternMemoryFileHashes(pattern);
  const decisionIds = patternDecisionIds(pattern);
  // Pattern-side featureId for override matching (see overrideMatchesPattern doc).
  const candidateFeatureId = (pattern && pattern.evidence && typeof pattern.evidence.featureId === 'string')
    ? pattern.evidence.featureId
    : featureRef;
  const candidateContextHash = pickPrimaryContextHash(pattern);

  // Use a plain object as a string-keyed set to avoid Set iteration-order surprises.
  // We sort the final array before returning (D6).
  /** @type {Object<string, true>} */
  const sessions = Object.create(null);

  for (const r of overrides || []) {
    if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
    if (overrideMatchesPattern(r, candidateId, featureRef, candidateFeatureId, candidateContextHash)) {
      sessions[r.sessionId] = true;
    }
  }
  for (const r of memoryRefs || []) {
    if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
    if (memoryRefMatchesPattern(r, memoryHashes, featureRef)) {
      sessions[r.sessionId] = true;
    }
  }
  for (const r of regrets || []) {
    if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
    if (regretMatchesPattern(r, decisionIds, featureRef)) {
      sessions[r.sessionId] = true;
    }
  }

  // @cap-risk(F-072/AC-7) Sort lock: Object.keys()'s order isn't guaranteed across V8
  //                       versions for non-numeric strings; an explicit .sort() seals it.
  return Object.keys(sessions).sort();
}

/**
 * Pull the primary contextHash anchor off a pattern's evidence, if any. F-071 persists
 * topContextHashes[]; we treat the FIRST entry as the canonical anchor for matching
 * overrides (D1 strictest path). When evidence carries an explicit `contextHash` field
 * (a future LLM-stage pattern shape), that wins.
 *
 * @param {object} pattern
 * @returns {string|null}
 */
function pickPrimaryContextHash(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  const ev = pattern.evidence;
  if (!ev || typeof ev !== 'object') return null;
  if (typeof ev.contextHash === 'string' && ev.contextHash.length > 0) return ev.contextHash;
  if (Array.isArray(ev.topContextHashes) && ev.topContextHashes.length > 0) {
    const first = ev.topContextHashes[0];
    if (first && typeof first.hash === 'string' && first.hash.length > 0) return first.hash;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Layer 1 + Layer 2 compute
// -----------------------------------------------------------------------------

/**
 * Layer 1: short-term Override-COUNT (D1) over the most-recent session.
 *
 * @param {object} pattern
 * @param {Array<object>} overrides - Already filtered to signalType=override.
 * @returns {FitnessLayer1}
 */
function computeLayer1(pattern, overrides) {
  const lastSession = latestSessionId(overrides);
  const candidateId = patternCandidateId(pattern);
  const featureRef = patternFeatureRef(pattern);
  const candidateFeatureId = (pattern && pattern.evidence && typeof pattern.evidence.featureId === 'string')
    ? pattern.evidence.featureId
    : featureRef;
  const candidateContextHash = pickPrimaryContextHash(pattern);

  let count = 0;
  if (lastSession) {
    for (const r of overrides || []) {
      if (!r || r.sessionId !== lastSession) continue;
      if (overrideMatchesPattern(r, candidateId, featureRef, candidateFeatureId, candidateContextHash)) {
        count += 1;
      }
    }
  }

  return {
    kind: 'override-count',
    value: count,
    lastSessionId: lastSession,
  };
}

/**
 * Layer 2: long-term per-session weighted average (D2). value = (memoryRefs * 1 + regrets * 2) / n,
 * where n = activeSessions.length. ready = (n >= LAYER2_READY_THRESHOLD).
 *
 * AC-5: value is computed even when n < threshold so the data exists from day 1; the consumer
 * (display layer / F-074) gates on ready.
 *
 * @param {object} pattern
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @param {string[]} activeSessions - Sorted list from computeActiveSessions.
 * @returns {FitnessLayer2}
 */
function computeLayer2(pattern, memoryRefs, regrets, activeSessions) {
  const featureRef = patternFeatureRef(pattern);
  const memoryHashes = patternMemoryFileHashes(pattern);
  const decisionIds = patternDecisionIds(pattern);

  let memoryHits = 0;
  for (const r of memoryRefs || []) {
    if (memoryRefMatchesPattern(r, memoryHashes, featureRef)) memoryHits += 1;
  }
  let regretHits = 0;
  for (const r of regrets || []) {
    if (regretMatchesPattern(r, decisionIds, featureRef)) regretHits += 1;
  }

  const n = activeSessions.length;
  // @cap-risk(F-072/AC-7) Divide-by-zero guard: when n=0, value=0. The adversarial test pins this.
  const value = n > 0
    ? (memoryHits * WEIGHT_MEMORY_REF + regretHits * WEIGHT_REGRET) / n
    : 0;

  return {
    kind: 'weighted-average',
    value,
    n,
    ready: n >= LAYER2_READY_THRESHOLD,
  };
}

/**
 * Find the most-recent matching signal across all types — used to populate
 * lastSeenSessionId / lastSeenAt on the FitnessRecord. D6: deterministic sort by ts.
 *
 * @param {object} pattern
 * @param {Array<object>} overrides
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @returns {{sessionId: string|null, ts: string|null}}
 */
function lastSeen(pattern, overrides, memoryRefs, regrets) {
  const candidateId = patternCandidateId(pattern);
  const featureRef = patternFeatureRef(pattern);
  const memoryHashes = patternMemoryFileHashes(pattern);
  const decisionIds = patternDecisionIds(pattern);
  const candidateFeatureId = (pattern && pattern.evidence && typeof pattern.evidence.featureId === 'string')
    ? pattern.evidence.featureId
    : featureRef;
  const candidateContextHash = pickPrimaryContextHash(pattern);

  let bestTs = null;
  let bestId = null;
  let bestSession = null;

  const consider = (r, isMatch) => {
    if (!r || !isMatch) return;
    const ts = typeof r.ts === 'string' ? r.ts : '';
    const id = typeof r.id === 'string' ? r.id : '';
    if (
      bestTs == null
      || ts > bestTs
      || (ts === bestTs && id > bestId)
    ) {
      bestTs = ts;
      bestId = id;
      bestSession = (typeof r.sessionId === 'string' && r.sessionId.length > 0) ? r.sessionId : null;
    }
  };

  for (const r of overrides || []) {
    consider(r, overrideMatchesPattern(r, candidateId, featureRef, candidateFeatureId, candidateContextHash));
  }
  for (const r of memoryRefs || []) {
    consider(r, memoryRefMatchesPattern(r, memoryHashes, featureRef));
  }
  for (const r of regrets || []) {
    consider(r, regretMatchesPattern(r, decisionIds, featureRef));
  }

  return { sessionId: bestSession, ts: bestTs };
}

/**
 * Compute every union session id across the three corpora (signal-source sessions —
 * NOT pattern-active sessions). Used by the AC-4 expiry check: a pattern with no
 * activity in the last EXPIRY_SESSIONS *signal-corpus* sessions is expired.
 *
 * Sessions are ordered by their max-ts (most-recent ts seen with that sessionId);
 * D6 demands a deterministic order, so ties on max-ts fall back to lexicographic
 * sessionId order. The returned array is most-recent-first.
 *
 * @param {Array<object>} overrides
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @returns {string[]} Sessions in most-recent-first order.
 */
function unionSessionsByRecency(overrides, memoryRefs, regrets) {
  /** @type {Object<string, string>} */
  const sessionMaxTs = Object.create(null);
  const collect = (arr) => {
    for (const r of arr || []) {
      if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
      const ts = typeof r.ts === 'string' ? r.ts : '';
      const prev = sessionMaxTs[r.sessionId];
      if (prev == null || ts > prev) sessionMaxTs[r.sessionId] = ts;
    }
  };
  collect(overrides);
  collect(memoryRefs);
  collect(regrets);

  // @cap-risk(F-072/AC-7) Sort by (max-ts desc, sessionId desc) for full determinism.
  const sessions = Object.keys(sessionMaxTs);
  sessions.sort((a, b) => {
    const ta = sessionMaxTs[a];
    const tb = sessionMaxTs[b];
    if (ta < tb) return 1;
    if (ta > tb) return -1;
    if (a < b) return 1;
    if (a > b) return -1;
    return 0;
  });
  return sessions;
}

// -----------------------------------------------------------------------------
// Public API — computeFitness
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-072/AC-1) Layer 1 short-term override-count over the last session.
// @cap-todo(ac:F-072/AC-2) Layer 2 long-term weighted per-session average; ready at n>=5.
// @cap-todo(ac:F-072/AC-5) Layer 2 value is computed and persisted from day 1, ready=false below threshold.
// @cap-todo(ac:F-072/AC-7) Pure compute, deterministic — no random / no Date.now in the formulas.
/**
 * Compute the FitnessRecord for `patternId` from the current signal corpus. Pure compute,
 * no IO except reading via cap-learning-signals.getSignals + cap-pattern-pipeline.listPatterns.
 *
 * @param {string} projectRoot
 * @param {string} patternId - 'P-NNN'
 * @param {Object} [options]
 * @param {Date|string} [options.now] - Override the persisted ts (mostly for tests). NEVER affects the formulas.
 * @returns {FitnessRecord|null} null when projectRoot/patternId invalid or pattern not found.
 */
function computeFitness(projectRoot, patternId, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  if (!isValidPatternId(patternId)) return null;
  const opts = options || {};

  const pattern = findPattern(projectRoot, patternId);
  if (!pattern) return null;

  // Pull all three corpora via the F-070 query API. We never read JSONL directly.
  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try { overrides = learningSignals.getSignals(projectRoot, 'override') || []; } catch (_e) { overrides = []; }
  try { memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref') || []; } catch (_e) { memoryRefs = []; }
  try { regrets = learningSignals.getSignals(projectRoot, 'regret') || []; } catch (_e) { regrets = []; }

  return computeFitnessFromCorpus(pattern, overrides, memoryRefs, regrets, opts.now);
}

/**
 * Internal worker — computes a FitnessRecord from a pre-loaded signal corpus. Used by
 * computeFitness (one-shot) and runFitnessPass (batch optimisation: read corpus once).
 *
 * @param {object} pattern
 * @param {Array<object>} overrides
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @param {Date|string} [now]
 * @returns {FitnessRecord}
 */
function computeFitnessFromCorpus(pattern, overrides, memoryRefs, regrets, now) {
  const activeSessions = computeActiveSessions(pattern, overrides, memoryRefs, regrets);
  const layer1 = computeLayer1(pattern, overrides);
  const layer2 = computeLayer2(pattern, memoryRefs, regrets, activeSessions);
  const seen = lastSeen(pattern, overrides, memoryRefs, regrets);

  const ts = now ? new Date(now).toISOString() : new Date().toISOString();

  /** @type {FitnessRecord} */
  return {
    id: pattern.id,
    patternId: pattern.id,
    ts,
    layer1,
    layer2,
    activeSessions: activeSessions.length,
    lastSeenSessionId: seen.sessionId,
    lastSeenAt: seen.ts,
    expired: false,
    evidence: {
      candidateId: patternCandidateId(pattern),
      featureRef: patternFeatureRef(pattern),
    },
  };
}

// -----------------------------------------------------------------------------
// Public API — recordFitness / getFitness
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-072/AC-3) Persistence layer — getFitness round-trips computeFitness.
//                          Rolling-30 / Lifetime aggregates: the persisted record IS the
//                          lifetime aggregate (every signal across all sessions); rolling-30
//                          is reconstructible per-call by restricting the corpus, but the
//                          MVP persists the lifetime view and surfaces it as the canonical
//                          fitness record. Snapshot history (recordApplySnapshot) handles
//                          the rolling-history view F-074 needs.
/**
 * Compute + persist a FitnessRecord to .cap/learning/fitness/<P-NNN>.json. Idempotent within
 * a session — re-computes from scratch and overwrites the prior write.
 *
 * @param {string} projectRoot
 * @param {string} patternId - 'P-NNN'
 * @param {Object} [options]
 * @param {Date|string} [options.now]
 * @returns {boolean} true on successful write; false on invalid input or IO error.
 */
function recordFitness(projectRoot, patternId, options) {
  const record = computeFitness(projectRoot, patternId, options);
  if (!record) return false;
  ensureDir(fitnessDir(projectRoot));
  try {
    fs.writeFileSync(fitnessFilePath(projectRoot, patternId), JSON.stringify(record, null, 2) + '\n', 'utf8');
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Read the persisted FitnessRecord for `patternId`. Returns null when the file
 * is missing or malformed. Never throws.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @returns {FitnessRecord|null}
 */
function getFitness(projectRoot, patternId) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  if (!isValidPatternId(patternId)) return null;
  const fp = fitnessFilePath(projectRoot, patternId);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Public API — recordApplySnapshot (AC-6, F-073 hook point)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-072/AC-6) Apply-time snapshot — F-073 calls recordApplySnapshot when the user
//                          applies a pattern; F-074 reads .snapshots.jsonl tails to compare
//                          pre-apply vs post-apply fitness.
/**
 * Compute current fitness AND append a SnapshotRecord to .cap/learning/fitness/<P-NNN>.snapshots.jsonl.
 * The append-only log (D5) means multiple applies in the same session produce multiple lines.
 *
 * F-073 calls this when the user applies a pattern (we expose the API; F-073 wires the call).
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @param {Object} [options]
 * @param {Date|string} [options.now]
 * @returns {SnapshotRecord|null} null when projectRoot/patternId invalid, pattern missing, or write failed.
 */
function recordApplySnapshot(projectRoot, patternId, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  if (!isValidPatternId(patternId)) return null;
  const opts = options || {};

  const pattern = findPattern(projectRoot, patternId);
  if (!pattern) return null;

  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try { overrides = learningSignals.getSignals(projectRoot, 'override') || []; } catch (_e) { overrides = []; }
  try { memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref') || []; } catch (_e) { memoryRefs = []; }
  try { regrets = learningSignals.getSignals(projectRoot, 'regret') || []; } catch (_e) { regrets = []; }

  const activeSessions = computeActiveSessions(pattern, overrides, memoryRefs, regrets);
  const layer1 = computeLayer1(pattern, overrides);
  const layer2 = computeLayer2(pattern, memoryRefs, regrets, activeSessions);
  const ts = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  /** @type {SnapshotRecord} */
  const snapshot = {
    ts,
    patternId,
    layer1,
    layer2,
    n: layer2.n,
    activeSessionsList: activeSessions, // already sorted by computeActiveSessions
  };

  ensureDir(fitnessDir(projectRoot));
  try {
    const line = JSON.stringify(snapshot) + '\n';
    const fd = fs.openSync(snapshotsFilePath(projectRoot, patternId), 'a');
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
    return snapshot;
  } catch (_e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Public API — listFitnessExpired / markExpired (AC-4)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-072/AC-4) Patterns with no usage over EXPIRY_SESSIONS sessions auto-marked expired.
/**
 * Return the list of pattern ids that have had no activity in the last EXPIRY_SESSIONS
 * signal-corpus sessions. The window is computed from the union of all three signal
 * types' sessionIds, ordered by most-recent ts (D6 deterministic sort); a pattern is
 * "expired" iff intersect(activeSessions, last20) === emptySet.
 *
 * Edge case: when the corpus has fewer than EXPIRY_SESSIONS distinct sessions, no
 * pattern is considered expired (we don't have enough data yet).
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {number} [options.window] - Override EXPIRY_SESSIONS (mostly for tests).
 * @returns {string[]} Pattern ids — sorted ascending for deterministic output.
 */
/**
 * Pure-compute helper: given an in-memory corpus and pattern list, return ids of patterns
 * that have not been active in any of the most-recent `window` sessions. Both
 * listFitnessExpired (which loads the corpus from disk) and runFitnessPass (which already
 * has it in hand) call this — single source of truth for the expiry rule.
 *
 * @cap-risk(F-072/AC-7) Sorted output for deterministic behaviour. The sort lock is here,
 *                       not at every call site, so the next contributor cannot accidentally
 *                       remove it from one path while leaving it in the other.
 *
 * @param {Array<object>} patterns
 * @param {Array<object>} overrides
 * @param {Array<object>} memoryRefs
 * @param {Array<object>} regrets
 * @param {number} window - Number of most-recent sessions defining the activity window.
 * @returns {string[]} Pattern ids — sorted ascending.
 */
function expiredIdsFromCorpus(patterns, overrides, memoryRefs, regrets, window) {
  const recencyOrdered = unionSessionsByRecency(overrides, memoryRefs, regrets);
  if (recencyOrdered.length < window) return [];
  const last = new Set(recencyOrdered.slice(0, window));

  const expired = [];
  for (const p of patterns) {
    if (!p || !isValidPatternId(p.id)) continue;
    const active = computeActiveSessions(p, overrides, memoryRefs, regrets);
    let intersects = false;
    for (const sid of active) {
      if (last.has(sid)) { intersects = true; break; }
    }
    if (!intersects) expired.push(p.id);
  }
  expired.sort();
  return expired;
}

function listFitnessExpired(projectRoot, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return [];
  const opts = options || {};
  const window = typeof opts.window === 'number' && opts.window > 0 ? opts.window : EXPIRY_SESSIONS;

  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try { overrides = learningSignals.getSignals(projectRoot, 'override') || []; } catch (_e) { overrides = []; }
  try { memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref') || []; } catch (_e) { memoryRefs = []; }
  try { regrets = learningSignals.getSignals(projectRoot, 'regret') || []; } catch (_e) { regrets = []; }

  const patterns = patternPipeline.listPatterns(projectRoot) || [];
  return expiredIdsFromCorpus(patterns, overrides, memoryRefs, regrets, window);
}

/**
 * Mark a persisted FitnessRecord as expired. Reads the existing record (if any) and
 * sets expired=true. When the record doesn't yet exist, computes a fresh one and
 * persists it with expired=true so getFitness reflects the change. Returns true on
 * successful write.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @returns {boolean}
 */
function markExpired(projectRoot, patternId) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  if (!isValidPatternId(patternId)) return false;

  let record = getFitness(projectRoot, patternId);
  if (!record) {
    record = computeFitness(projectRoot, patternId);
    if (!record) return false;
  }
  record.expired = true;
  ensureDir(fitnessDir(projectRoot));
  try {
    fs.writeFileSync(fitnessFilePath(projectRoot, patternId), JSON.stringify(record, null, 2) + '\n', 'utf8');
    return true;
  } catch (_e) {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Public API — runFitnessPass (batch helper for /cap:learn Step 6.5)
// -----------------------------------------------------------------------------

// @cap-decision(F-072/D7) /cap:learn Step 6.5 calls runFitnessPass(projectRoot) as a courtesy refresh
//                 — every learn invocation re-computes fitness for all patterns. Cost is bounded by
//                 the performance probe (<500ms for 100 patterns × 1000 signals); the additive step
//                 doesn't refactor the existing 7 steps in commands/cap/learn.md.
/**
 * Refresh fitness for every persisted pattern AND auto-mark expired ones. Used by
 * /cap:learn Step 6.5 (additive) and any future /cap:fitness skill.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {Date|string} [options.now]
 * @param {number} [options.window] - Override EXPIRY_SESSIONS.
 * @returns {{recorded: string[], expired: string[], errors: string[]}}
 */
function runFitnessPass(projectRoot, options) {
  const opts = options || {};
  const recorded = [];
  const expired = [];
  const errors = [];

  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { recorded, expired, errors: ['projectRoot is required'] };
  }

  let patterns = [];
  try {
    patterns = patternPipeline.listPatterns(projectRoot) || [];
  } catch (e) {
    errors.push(`listPatterns failed: ${e && e.message ? e.message : 'unknown'}`);
    return { recorded, expired, errors };
  }

  // @cap-risk(F-072/AC-7) Sort patterns by id ascending so iteration order is stable
  //                       regardless of fs.readdir's filesystem-dependent ordering.
  patterns = [...patterns].sort((a, b) => {
    const ai = (a && a.id) || '';
    const bi = (b && b.id) || '';
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });

  // @cap-risk(F-072/AC-7) Performance: read the three signal corpora ONCE, then run the
  //                       per-pattern compute against the in-memory arrays. Without this batch
  //                       optimisation, each recordFitness call re-reads the corpora — O(P²)
  //                       in pattern count vs the O(P) we want for runFitnessPass. The numerical
  //                       result is identical (we still call the same compute helpers), but the
  //                       perf probe (100 patterns × 1000 signals) hits the 500ms budget.
  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try { overrides = learningSignals.getSignals(projectRoot, 'override') || []; } catch (e) {
    errors.push(`getSignals(override) failed: ${e && e.message ? e.message : 'unknown'}`);
  }
  try { memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref') || []; } catch (e) {
    errors.push(`getSignals(memory-ref) failed: ${e && e.message ? e.message : 'unknown'}`);
  }
  try { regrets = learningSignals.getSignals(projectRoot, 'regret') || []; } catch (e) {
    errors.push(`getSignals(regret) failed: ${e && e.message ? e.message : 'unknown'}`);
  }

  ensureDir(fitnessDir(projectRoot));

  for (const p of patterns) {
    if (!p || !isValidPatternId(p.id)) continue;
    try {
      const record = computeFitnessFromCorpus(p, overrides, memoryRefs, regrets, opts.now);
      try {
        fs.writeFileSync(fitnessFilePath(projectRoot, p.id), JSON.stringify(record, null, 2) + '\n', 'utf8');
        recorded.push(p.id);
      } catch (we) {
        errors.push(`recordFitness write failed for ${p.id}: ${we && we.message ? we.message : 'unknown'}`);
      }
    } catch (e) {
      errors.push(`recordFitness threw for ${p.id}: ${e && e.message ? e.message : 'unknown'}`);
    }
  }

  // Expiry check reuses the in-memory corpus to avoid a second disk read.
  // expiredIdsFromCorpus is the single source of truth — listFitnessExpired calls it too.
  let expiredIds = [];
  try {
    const window = typeof opts.window === 'number' && opts.window > 0 ? opts.window : EXPIRY_SESSIONS;
    expiredIds = expiredIdsFromCorpus(patterns, overrides, memoryRefs, regrets, window);
  } catch (e) {
    errors.push(`expired check failed: ${e && e.message ? e.message : 'unknown'}`);
  }
  for (const id of expiredIds) {
    try {
      if (markExpired(projectRoot, id)) expired.push(id);
    } catch (e) {
      errors.push(`markExpired failed for ${id}: ${e && e.message ? e.message : 'unknown'}`);
    }
  }

  return { recorded, expired, errors };
}

// -----------------------------------------------------------------------------
// Exports — keep this list minimal. F-073 / F-074 should consume only these.
// -----------------------------------------------------------------------------

module.exports = {
  // Constants — exported for tests + downstream consumers.
  CAP_DIR,
  LEARNING_DIR,
  FITNESS_DIR,
  LAYER2_READY_THRESHOLD,
  WEIGHT_MEMORY_REF,
  WEIGHT_REGRET,
  EXPIRY_SESSIONS,
  // Public API.
  computeFitness,
  recordFitness,
  getFitness,
  recordApplySnapshot,
  listFitnessExpired,
  markExpired,
  runFitnessPass,
  // Path helpers — exported for tests.
  fitnessDir,
  fitnessFilePath,
  snapshotsFilePath,
};
