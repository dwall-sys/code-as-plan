// @cap-feature(feature:F-055) Confidence and Evidence Fields for Memory Entries — pure-logic module
// @cap-decision Bullet-list extension of the existing Entry block (not YAML frontmatter) so .cap/memory/*.md stays grep-friendly and diff-readable.
// @cap-decision Jaccard on word tokens for re-observation similarity: zero-dep, deterministic, cheap. No Levenshtein, no embeddings — we only need coarse "same gist" detection.
// @cap-constraint Zero external dependencies — only node:-prefixed built-ins (no imports needed here).

'use strict';

// --- Constants ---

/** Starting confidence for a freshly observed entry. */
const DEFAULT_CONFIDENCE = 0.5;

/** Starting evidence count for a freshly observed entry. */
const DEFAULT_EVIDENCE = 1;

/** Hard cap on confidence so re-observation never certifies an entry as "known truth". */
const CONFIDENCE_CAP = 0.95;

/** Hard floor on confidence — contradictions can drive it to zero but not below. */
const CONFIDENCE_FLOOR = 0.0;

/** Jaccard threshold at or above which two contents are treated as the same observation. */
const SIMILARITY_THRESHOLD = 0.8;

/** Confidence strictly below this renders as "low confidence" (dimmed). */
const DIM_THRESHOLD = 0.3;

/** Increment applied to confidence on re-observation. */
const REOBSERVATION_BUMP = 0.1;

/** Penalty applied to confidence on contradiction. */
const CONTRADICTION_DAMP = 0.2;

// @cap-decision Leading/trailing spaces in negation markers are deliberate — prevents 'not' from matching inside 'notation', 'nie' from matching 'niemals' boundaries wrongly, etc.
const NEGATION_MARKERS = [
  "don't",
  'do not',
  'never',
  'avoid',
  'not ',
  'no longer',
  'stop ',
  'nicht',
  'nie ',
  'kein ',
  'keinen ',
  'keine ',
];

// --- Types ---

/**
 * @typedef {Object} ConfidenceFields
 * @property {number} confidence - Float in [0.0, 1.0]
 * @property {number} evidence_count - Integer >= 1
 * @property {string} [last_seen] - ISO timestamp of the most recent observation (AC-3, F-056)
 */

/** Epoch sentinel used when no last_seen and no source exist — behaves as "very old" for decay. */
const EPOCH_ZERO = '1970-01-01T00:00:00.000Z';

/**
 * Normalize a Date-or-ISO-string to an ISO timestamp.
 * @param {Date|undefined} now
 * @returns {string}
 */
function nowIso(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString();
}

// --- Tokenization + Similarity (AC-4) ---

/**
 * Tokenize a string into a lowercase, deduped word-token array.
 * Splits on any run of non-letter/non-number (Unicode-aware) and drops empties.
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  if (!s || typeof s !== 'string') return [];
  const parts = s.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Jaccard similarity on word-token sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 for empty inputs so the threshold check is always meaningful.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function jaccardSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check whether a new observation is the "same" as an existing one
 * (similarity at or above SIMILARITY_THRESHOLD).
 * @param {string} newContent
 * @param {string} existingContent
 * @returns {boolean}
 */
function isReObservation(newContent, existingContent) {
  return jaccardSimilarity(newContent, existingContent) >= SIMILARITY_THRESHOLD;
}

// --- Contradiction Detection (AC-5) ---

/**
 * Lowercase normalize a content string and check whether any negation marker appears.
 * @param {string} content
 * @returns {boolean}
 */
function hasNegationMarker(content) {
  if (!content) return false;
  const lc = content.toLowerCase();
  return NEGATION_MARKERS.some((m) => lc.includes(m));
}

/**
 * Intersect two arrays of file paths. Tolerant of null/undefined.
 * @param {string[]|undefined|null} a
 * @param {string[]|undefined|null} b
 * @returns {boolean} true if at least one file appears in both arrays
 */
function filesOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return false;
  const sa = new Set(a);
  for (const f of b) if (sa.has(f)) return true;
  return false;
}

// @cap-risk Contradiction detection is a best-effort heuristic. It intentionally under-detects rather than over-detects, but false-positives remain possible when one entry uses negation stylistically (e.g. "don't just ..., do ..."). Unit tests cover synthetic pairs; real-world misclassification is bounded by the file-scope + category + negation-asymmetry gate.
/**
 * Heuristically detect whether two entries contradict each other.
 * Requires all of:
 *   1. Same category.
 *   2. Overlapping relatedFiles (shared file-scope).
 *   3. Negation asymmetry — exactly one of the two contents contains a negation marker.
 *   4. The non-negation content-tokens overlap by >= 50 % (they're talking about the same thing).
 * @param {{category:string, content:string, metadata?:Object}} newEntry
 * @param {{category:string, content:string, metadata?:Object}} existingEntry
 * @returns {boolean}
 */
function isContradiction(newEntry, existingEntry) {
  if (!newEntry || !existingEntry) return false;
  if (newEntry.category !== existingEntry.category) return false;

  const newFiles = newEntry.metadata?.relatedFiles || (newEntry.file ? [newEntry.file] : []);
  const existingFiles = existingEntry.metadata?.relatedFiles || (existingEntry.file ? [existingEntry.file] : []);
  if (!filesOverlap(newFiles, existingFiles)) return false;

  const newNeg = hasNegationMarker(newEntry.content);
  const existingNeg = hasNegationMarker(existingEntry.content);
  // Exactly one side must carry the negation — otherwise they either agree (both positive / both negative) or are unrelated.
  if (newNeg === existingNeg) return false;

  // Token-overlap sanity: strip negation markers then require 50 % token overlap.
  const stripNeg = (s) => {
    let out = s.toLowerCase();
    for (const m of NEGATION_MARKERS) {
      out = out.split(m).join(' ');
    }
    return out;
  };
  const ta = new Set(tokenize(stripNeg(newEntry.content)));
  const tb = new Set(tokenize(stripNeg(existingEntry.content)));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const smaller = Math.min(ta.size, tb.size);
  return inter / smaller >= 0.5;
}

// --- Field Operations ---

/**
 * @cap-todo(ac:F-056/AC-3) last_seen seeded on first observation so decay has a reference point.
 * @param {Date} [now]
 * @returns {ConfidenceFields}
 */
function initFields(now) {
  return {
    confidence: DEFAULT_CONFIDENCE,
    evidence_count: DEFAULT_EVIDENCE,
    last_seen: nowIso(now),
  };
}

/**
 * Round to 2 decimal places to avoid 0.30000000000000004 floating-point noise in markdown.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Apply a re-observation: +1 evidence, +0.1 confidence, capped at CONFIDENCE_CAP.
 * @cap-todo(ac:F-056/AC-3) last_seen refreshed so the decay clock resets on reaffirmation.
 * @param {ConfidenceFields} fields
 * @param {Date} [now]
 * @returns {ConfidenceFields}
 */
function bumpOnReObservation(fields, now) {
  const f = ensureFields(fields);
  return {
    ...f,
    confidence: round2(Math.min(CONFIDENCE_CAP, f.confidence + REOBSERVATION_BUMP)),
    evidence_count: f.evidence_count + 1,
    last_seen: nowIso(now),
  };
}

// @cap-decision Contradiction does NOT refresh last_seen — a rebuttal is not a reaffirmation, and resetting the decay clock on disagreement would reward stale-but-contested entries.
/**
 * Apply a contradiction: -0.2 confidence, floored at CONFIDENCE_FLOOR.
 * Evidence count is NOT incremented — a contradiction is not a confirmation.
 * @param {ConfidenceFields} fields
 * @param {Date} [_now] - accepted for signature parity; not used (see decision above).
 * @returns {ConfidenceFields}
 */
function dampOnContradiction(fields, _now) {
  const f = ensureFields(fields);
  return {
    ...f,
    confidence: round2(Math.max(CONFIDENCE_FLOOR, f.confidence - CONTRADICTION_DAMP)),
    evidence_count: f.evidence_count,
  };
}

/**
 * Return a shallow clone of `metadata` with `confidence`, `evidence_count`, and `last_seen`
 * defaulted if missing. Does not mutate the input.
 * Used for AC-3 lazy migration — reading an old file without the fields
 * yields entries that look fully-formed downstream.
 * @cap-todo(ac:F-056/AC-3) last_seen lazy-migration: fall back to metadata.source, else epoch-0.
 * @param {Object} metadata
 * @param {Date} [_now] - accepted for signature parity; last_seen default does not depend on "now".
 * @returns {Object}
 */
function ensureFields(metadata, _now) {
  const src = metadata || {};
  const out = { ...src };
  if (typeof out.confidence !== 'number' || Number.isNaN(out.confidence)) {
    out.confidence = DEFAULT_CONFIDENCE;
  }
  if (typeof out.evidence_count !== 'number' || !Number.isFinite(out.evidence_count) || out.evidence_count < 1) {
    out.evidence_count = DEFAULT_EVIDENCE;
  }
  if (typeof out.last_seen !== 'string' || out.last_seen.length === 0) {
    out.last_seen = typeof out.source === 'string' && out.source.length > 0 ? out.source : EPOCH_ZERO;
  }
  return out;
}

/**
 * @param {Object} metadata
 * @returns {boolean}
 */
function isLowConfidence(metadata) {
  const f = ensureFields(metadata);
  return f.confidence < DIM_THRESHOLD;
}

// --- Orchestration ---

/**
 * Compare a new entry against a list of existing entries and decide the learning signal.
 *
 * Priority when both could apply (rare in practice): re-observation wins. Rationale —
 * if content is already >= 80 % similar, treating it as contradictory would be
 * semantically wrong (it's the same observation, not a rebuttal).
 *
 * @param {{category:string, content:string, file?:string, metadata:Object}} newEntry
 * @param {Array<{category:string, content:string, file?:string, metadata:Object}>} existingEntries
 * @returns {{
 *   mergedEntry: Object,
 *   touchedExistingIndex: number|null,
 *   action: 'new'|'reobserved'|'contradicted'
 * }}
 */
function applyLearningSignals(newEntry, existingEntries) {
  const list = Array.isArray(existingEntries) ? existingEntries : [];

  // Pass 1: re-observation (same category + >= threshold similarity).
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.category !== newEntry.category) continue;
    if (isReObservation(newEntry.content, e.content)) {
      const bumped = bumpOnReObservation(e.metadata);
      const mergedEntry = {
        ...e,
        metadata: { ...e.metadata, ...bumped },
      };
      return { mergedEntry, touchedExistingIndex: i, action: 'reobserved' };
    }
  }

  // Pass 2: contradiction.
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    if (isContradiction(newEntry, e)) {
      const damped = dampOnContradiction(e.metadata);
      // The new entry is tracked separately (not merged) — only the existing entry's confidence drops.
      // Callers receive the new entry with fresh init-fields AND the touched index so they can rewrite the existing entry.
      const mergedEntry = {
        ...newEntry,
        metadata: { ...(newEntry.metadata || {}), ...initFields() },
        _contradictedExistingUpdate: {
          index: i,
          updatedMetadata: { ...e.metadata, ...damped },
        },
      };
      return { mergedEntry, touchedExistingIndex: i, action: 'contradicted' };
    }
  }

  // Fallback: brand-new observation.
  return {
    mergedEntry: {
      ...newEntry,
      metadata: { ...(newEntry.metadata || {}), ...initFields() },
    },
    touchedExistingIndex: null,
    action: 'new',
  };
}

module.exports = {
  // Constants
  DEFAULT_CONFIDENCE,
  DEFAULT_EVIDENCE,
  CONFIDENCE_CAP,
  CONFIDENCE_FLOOR,
  SIMILARITY_THRESHOLD,
  DIM_THRESHOLD,
  REOBSERVATION_BUMP,
  CONTRADICTION_DAMP,
  NEGATION_MARKERS,
  EPOCH_ZERO,

  // Tokenization + similarity
  tokenize,
  jaccardSimilarity,
  isReObservation,

  // Contradiction
  hasNegationMarker,
  filesOverlap,
  isContradiction,

  // Fields
  initFields,
  bumpOnReObservation,
  dampOnContradiction,
  ensureFields,
  isLowConfidence,

  // Orchestration
  applyLearningSignals,
};
