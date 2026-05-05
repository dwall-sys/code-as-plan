// @cap-context CAP F-061 Token Telemetry — observability foundation for LLM usage.
//                 Persists per-call metrics and per-session aggregates without ever touching raw prompts/completions.
//                 Consumed by F-070 (signal collectors) and F-071 (pattern pipeline LLM budget enforcement).
// @cap-decision(F-061/D1) JSONL format (not JSON array) — append-only, deterministic, no rewrite on add.
//                 One call per line. Reading is O(n) streaming, writing is O(1) append.
// @cap-decision(F-061/D2) Per-session aggregate lives under .cap/telemetry/sessions/<session-id>.json — stable path
//                 keyed by sessionId so F-070 / F-071 can look up by session or walk the directory for ranges.
// @cap-decision(F-061/D3) Enablement is read per call from .cap/config.json on disk (no in-process cache) — keeps
//                 no-op semantics honest when config flips at runtime (e.g. a test or a manual toggle).
// @cap-constraint Zero external dependencies: node:fs, node:path, node:crypto (hashing) only.
// @cap-risk(F-061/AC-5) PRIVACY BOUNDARY — this module must never accept, log, or persist raw prompt or completion
//                 text. Any future contributor adding a `prompt` or `completion` field violates AC-5.
//                 `commandContext` is structured metadata only (command name, feature ID). Free-text must be hashed.

'use strict';

// @cap-feature(feature:F-061, primary:true) Token Telemetry — LLM-call metrics without raw prompt persistence.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CAP_DIR = '.cap';
const CONFIG_FILE = 'config.json';
const TELEMETRY_DIR = 'telemetry';
const CALLS_FILE = 'llm-calls.jsonl';
const SESSIONS_DIR = 'sessions';
const LEARNING_DIR = 'learning';
const LEARNING_CONFIG_FILE = 'config.json';
const DEFAULT_LLM_BUDGET_PER_SESSION = 3;

/**
 * @typedef {Object} CommandContext
 * @property {string} [command] - CAP command name, e.g. "/cap:prototype".
 * @property {string} [feature] - Feature ID, e.g. "F-061".
 * @property {string} [agent] - Agent name, e.g. "cap-prototyper".
 * @property {string} [note] - Short structured note (no free-text prompts).
 */

/**
 * @typedef {Object} LlmCallRecord
 * @property {string} id - ULID-ish unique id derived from timestamp + random.
 * @property {string} ts - ISO timestamp of the call.
 * @property {string} model - Model identifier (e.g. "claude-opus-4-7").
 * @property {number} promptTokens
 * @property {number} completionTokens
 * @property {number} totalTokens
 * @property {number} durationMs
 * @property {string|null} sessionId
 * @property {string|null} featureId
 * @property {CommandContext} commandContext - Structured context only; never raw prompt text.
 * @property {string} [contextHash] - Optional sha256[:16] hash of derived context (not prompts).
 */

/**
 * @typedef {Object} SessionAggregate
 * @property {string} sessionId
 * @property {string|null} featureId - Last known active feature for this session (may change).
 * @property {number} callCount
 * @property {number} totalPromptTokens
 * @property {number} totalCompletionTokens
 * @property {number} totalTokens
 * @property {string} firstSeenAt - ISO timestamp of first call seen in this session.
 * @property {string} lastSeenAt - ISO timestamp of last call seen in this session.
 * @property {number} budget - Effective LLM budget per session (calls).
 * @property {number} budgetRemaining - budget - callCount (floored at 0).
 * @property {Object<string,number>} byModel - callCount per model.
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-061/AC-6) readConfig returns an empty object when .cap/config.json is missing or malformed,
//                          so every caller falls through to the "default behaviour" branch without exceptions.
/**
 * Read .cap/config.json. Returns `{}` when missing or malformed (no throw, ever).
 * @param {string} projectRoot
 * @returns {object}
 */
function readConfig(projectRoot) {
  const configPath = path.join(projectRoot, CAP_DIR, CONFIG_FILE);
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    // @cap-decision(F-061/D5) Normalise non-object roots (strings, arrays, null, numbers)
    //                         to {} — downstream code always expects a plain object.
    //                         Without this guard, `JSON.parse('"hi"')` leaks a string,
    //                         and later `cfg.telemetry` throws or silently becomes undefined
    //                         on primitive autoboxing.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_e) {
    return {};
  }
}

// @cap-todo(ac:F-061/AC-6) isEnabled returns false iff config explicitly sets telemetry.enabled = false.
//                          Missing config OR missing telemetry key means "enabled" — matches the user's
//                          explicit opt-in when the project ships without a config file.
/**
 * Check whether telemetry writes are enabled for this project.
 * Default when config/key missing: true (opt-out, not opt-in).
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isEnabled(projectRoot) {
  const cfg = readConfig(projectRoot);
  if (cfg && cfg.telemetry && cfg.telemetry.enabled === false) return false;
  return true;
}

/**
 * Read the effective LLM budget per session from .cap/learning/config.json.
 * Missing or malformed config → DEFAULT_LLM_BUDGET_PER_SESSION (3).
 * @param {string} projectRoot
 * @returns {{ budget: number, source: 'config' | 'default' }}
 */
function readBudget(projectRoot) {
  const learningConfigPath = path.join(projectRoot, CAP_DIR, LEARNING_DIR, LEARNING_CONFIG_FILE);
  try {
    if (!fs.existsSync(learningConfigPath)) {
      return { budget: DEFAULT_LLM_BUDGET_PER_SESSION, source: 'default' };
    }
    const raw = fs.readFileSync(learningConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.llmBudgetPerSession === 'number' && parsed.llmBudgetPerSession >= 0) {
      return { budget: parsed.llmBudgetPerSession, source: 'config' };
    }
    return { budget: DEFAULT_LLM_BUDGET_PER_SESSION, source: 'default' };
  } catch (_e) {
    return { budget: DEFAULT_LLM_BUDGET_PER_SESSION, source: 'default' };
  }
}

// -----------------------------------------------------------------------------
// Hashing helper — privacy-preserving fingerprint for optional dedup keys
// -----------------------------------------------------------------------------

// @cap-risk(F-061/AC-5) This helper is the ONLY way free-text should ever enter the telemetry pipeline,
//                       and even then only its first-16-char sha256 hex digest, never the text itself.
/**
 * Compute a short sha256 hex digest of an arbitrary string. Used e.g. to fingerprint a prompt template
 * id without storing the template's rendered contents. NEVER store the input `text` anywhere.
 * @param {string} text
 * @returns {string} 16-char hex
 */
function hashContext(text) {
  const input = typeof text === 'string' ? text : String(text == null ? '' : text);
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// -----------------------------------------------------------------------------
// Directory + atomic-write primitives
// -----------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// @cap-decision(F-061/D4) JSONL append uses O_APPEND with an atomic single-line write. On Linux/macOS
//                         writes <= PIPE_BUF (4 KiB) to an O_APPEND fd are atomic w.r.t. other writers,
//                         which is enough for our short metric records. No temp+rename is needed for
//                         append-only lines; temp+rename IS used for the JSON aggregate file below.
/**
 * Append one JSON record as a single line to the given file. Record + newline must fit in one write.
 * @param {string} filePath
 * @param {object} record
 */
function writeJsonlLine(filePath, record) {
  ensureDir(path.dirname(filePath));
  const line = JSON.stringify(record) + '\n';
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomically write a JSON file via temp + rename. Prevents partial-file readers.
 * @param {string} filePath
 * @param {object} data
 */
function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Generate a short unique ID for a single call record. Not cryptographically secure,
 * but unique enough to distinguish concurrent writes inside one process.
 */
function generateCallId() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(4).toString('hex');
  return `${ts}-${rnd}`;
}

/**
 * Sanitize a structured CommandContext — drop keys we do NOT want in telemetry, keep only
 * the whitelisted structured fields. This is the privacy gate for AC-5.
 * @param {any} raw
 * @returns {CommandContext}
 */
function sanitizeCommandContext(raw) {
  // @cap-risk(F-061/AC-5) Any new key added here MUST be structured metadata — never free-text.
  const allowed = ['command', 'feature', 'agent', 'note'];
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of allowed) {
      if (typeof raw[k] === 'string' && raw[k].length > 0) {
        // Cap the value length so an accidental paste of a prompt never lands whole.
        out[k] = raw[k].slice(0, 200);
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-061/AC-1) Per-call JSONL record persisted to .cap/telemetry/llm-calls.jsonl.
// @cap-todo(ac:F-061/AC-7) Zero deps — only node:fs, node:path, node:crypto.
/**
 * Record a single LLM call. No-op when telemetry is disabled.
 *
 * The function never accepts raw prompt or completion text — only token counts and structured context.
 * See @cap-risk(F-061/AC-5): anyone adding `prompt` or `completion` to this signature breaks privacy.
 *
 * @param {string} projectRoot - Absolute path to project root.
 * @param {Object} input
 * @param {string} input.model
 * @param {number} input.promptTokens
 * @param {number} input.completionTokens
 * @param {number} [input.totalTokens] - Derived from prompt+completion when omitted.
 * @param {number} input.durationMs
 * @param {string|null} [input.sessionId]
 * @param {string|null} [input.featureId]
 * @param {CommandContext} [input.commandContext]
 * @param {string} [input.contextHash] - Optional pre-computed hash. Never derive from raw prompt text here.
 * @param {string} [input.ts] - Override timestamp (mostly for tests); defaults to new Date().toISOString().
 * @returns {LlmCallRecord|null} The persisted record, or null when telemetry is disabled.
 */
function recordLlmCall(projectRoot, input) {
  // @cap-todo(ac:F-061/AC-6) Disabled telemetry is a silent no-op — no directories created, no exceptions.
  if (!isEnabled(projectRoot)) return null;

  const safeInput = input || {};
  // @cap-decision(F-061/D6) Every numeric field must be a FINITE non-negative number.
  //                         `Number(Infinity)` is finite-checked; `NaN` / Infinity / -Infinity / negatives
  //                         all collapse to 0. Without this, totalTokens can become Infinity and
  //                         `JSON.stringify` serialises it as `null`, breaking downstream integer math.
  const toFiniteNonNeg = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  };
  const promptTokens = toFiniteNonNeg(safeInput.promptTokens);
  const completionTokens = toFiniteNonNeg(safeInput.completionTokens);
  const totalTokens = Number.isFinite(Number(safeInput.totalTokens)) && Number(safeInput.totalTokens) >= 0
    ? Number(safeInput.totalTokens)
    : promptTokens + completionTokens;

  // @cap-risk(F-061/AC-5) Length-cap the model string so an attacker cannot use it
  //                       as a prompt-smuggle channel. 200 chars matches the commandContext cap.
  const ID_MAX = 200;
  const rawModel = typeof safeInput.model === 'string' ? safeInput.model : 'unknown';
  const model = rawModel.slice(0, ID_MAX);
  // @cap-risk(F-061/AC-5) sessionId and featureId become part of the trust boundary in F-070
  //                       (external user events). Apply the same type-check + length-cap as `model`
  //                       so a non-string or huge payload cannot reach disk via these fields.
  const capId = (v) => (typeof v === 'string' && v.length > 0 ? v.slice(0, ID_MAX) : null);
  const sessionId = capId(safeInput.sessionId);
  const featureId = capId(safeInput.featureId);

  /** @type {LlmCallRecord} */
  const record = {
    id: generateCallId(),
    ts: safeInput.ts || new Date().toISOString(),
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs: toFiniteNonNeg(safeInput.durationMs),
    sessionId,
    featureId,
    commandContext: sanitizeCommandContext(safeInput.commandContext),
  };
  if (typeof safeInput.contextHash === 'string' && safeInput.contextHash.length > 0) {
    record.contextHash = safeInput.contextHash.slice(0, 64);
  }

  const callsPath = path.join(projectRoot, CAP_DIR, TELEMETRY_DIR, CALLS_FILE);
  writeJsonlLine(callsPath, record);
  return record;
}

/**
 * Read all per-call records. Tolerant to missing file and malformed lines (they're skipped).
 * @param {string} projectRoot
 * @returns {LlmCallRecord[]}
 */
function readAllCalls(projectRoot) {
  const callsPath = path.join(projectRoot, CAP_DIR, TELEMETRY_DIR, CALLS_FILE);
  if (!fs.existsSync(callsPath)) return [];
  const raw = fs.readFileSync(callsPath, 'utf8');
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (_e) {
      // Skip malformed lines — telemetry must never crash a command.
    }
  }
  return records;
}

// @cap-todo(ac:F-061/AC-4) Query API consumed by F-070 (signal collectors) and F-071 (pattern pipeline).
/**
 * Query LLM usage. At least one of { sessionId, featureId, range } must be provided.
 * Returns a flat list of matching call records.
 *
 * @param {string} projectRoot
 * @param {Object} filter
 * @param {string} [filter.sessionId]
 * @param {string} [filter.featureId]
 * @param {{from?: string|Date, to?: string|Date}} [filter.range]
 * @returns {LlmCallRecord[]}
 */
function getLlmUsage(projectRoot, filter) {
  const f = filter || {};
  const all = readAllCalls(projectRoot);
  const fromTs = f.range && f.range.from ? new Date(f.range.from).getTime() : null;
  const toTs = f.range && f.range.to ? new Date(f.range.to).getTime() : null;

  return all.filter((r) => {
    if (f.sessionId && r.sessionId !== f.sessionId) return false;
    if (f.featureId && r.featureId !== f.featureId) return false;
    if (fromTs !== null || toTs !== null) {
      const recordTs = new Date(r.ts).getTime();
      if (Number.isNaN(recordTs)) return false;
      if (fromTs !== null && recordTs < fromTs) return false;
      if (toTs !== null && recordTs > toTs) return false;
    }
    return true;
  });
}

// @cap-todo(ac:F-061/AC-2) Per-session aggregate: { callCount, totalTokens, budget, budgetRemaining },
//                          findable by sessionId and carrying the active featureId for cross-linking.
/**
 * Compute and persist the aggregate for a given session. No-op when telemetry is disabled.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {SessionAggregate|null}
 */
function recordSessionAggregate(projectRoot, sessionId) {
  if (!isEnabled(projectRoot)) return null;
  if (!sessionId) return null;

  const aggregate = computeSessionAggregate(projectRoot, sessionId);
  const aggregatePath = path.join(
    projectRoot, CAP_DIR, TELEMETRY_DIR, SESSIONS_DIR, `${sessionId}.json`
  );
  writeJsonAtomic(aggregatePath, aggregate);
  return aggregate;
}

/**
 * Compute (but do NOT persist) the aggregate view of a session. Pure function over persisted calls.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {SessionAggregate}
 */
function computeSessionAggregate(projectRoot, sessionId) {
  const calls = getLlmUsage(projectRoot, { sessionId });
  const { budget } = readBudget(projectRoot);

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let firstSeenAt = null;
  let lastSeenAt = null;
  let featureId = null;
  const byModel = {};

  for (const c of calls) {
    totalPromptTokens += Number(c.promptTokens) || 0;
    totalCompletionTokens += Number(c.completionTokens) || 0;
    totalTokens += Number(c.totalTokens) || 0;
    if (!firstSeenAt || c.ts < firstSeenAt) firstSeenAt = c.ts;
    if (!lastSeenAt || c.ts > lastSeenAt) lastSeenAt = c.ts;
    if (c.featureId) featureId = c.featureId;
    if (c.model) byModel[c.model] = (byModel[c.model] || 0) + 1;
  }

  const callCount = calls.length;
  const budgetRemaining = Math.max(0, budget - callCount);

  return {
    sessionId,
    featureId,
    callCount,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    firstSeenAt,
    lastSeenAt,
    budget,
    budgetRemaining,
    byModel,
  };
}

// @cap-todo(ac:F-061/AC-3) Human-readable summary consumed by /cap:status. Budget source: .cap/learning/config.json.
/**
 * Format a one-liner status summary for a session. Safe to call even when telemetry is disabled
 * (returns a neutral message). Budget source is surfaced so the user can tell default vs configured.
 *
 * @param {string} projectRoot
 * @param {string|null} sessionId
 * @returns {string}
 */
function formatSessionStatusLine(projectRoot, sessionId) {
  if (!isEnabled(projectRoot)) {
    return 'Telemetry: disabled (.cap/config.json telemetry.enabled=false)';
  }
  const { budget, source } = readBudget(projectRoot);
  if (!sessionId) {
    return `Telemetry: enabled · Budget: ${budget} (${source}) · no active session`;
  }
  const agg = computeSessionAggregate(projectRoot, sessionId);
  const sourceLabel = source === 'default' ? 'default' : 'configured';
  return `Token usage: ${agg.totalTokens} tokens across ${agg.callCount} calls · ` +
    `Budget: ${agg.budget} (${sourceLabel}) · Used: ${agg.callCount} · Remaining: ${agg.budgetRemaining}`;
}

module.exports = {
  // constants
  CAP_DIR,
  TELEMETRY_DIR,
  CALLS_FILE,
  SESSIONS_DIR,
  DEFAULT_LLM_BUDGET_PER_SESSION,
  // config
  readConfig,
  isEnabled,
  readBudget,
  // privacy helper
  hashContext,
  // public API
  recordLlmCall,
  readAllCalls,
  getLlmUsage,
  recordSessionAggregate,
  computeSessionAggregate,
  formatSessionStatusLine,
};
