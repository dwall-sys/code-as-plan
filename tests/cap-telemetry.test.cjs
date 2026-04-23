'use strict';

// @cap-feature(feature:F-061) Baseline tests for Token Telemetry — AC-1..AC-7 coverage.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const telemetry = require('../cap/bin/lib/cap-telemetry.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-telemetry-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper: seed .cap/config.json with a given telemetry.enabled value. */
function seedConfig(root, enabled) {
  const capDir = path.join(root, '.cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(
    path.join(capDir, 'config.json'),
    JSON.stringify({ telemetry: { enabled } }, null, 2),
    'utf8'
  );
}

/** Helper: seed .cap/learning/config.json with a custom budget. */
function seedBudget(root, budget) {
  const learningDir = path.join(root, '.cap', 'learning');
  fs.mkdirSync(learningDir, { recursive: true });
  fs.writeFileSync(
    path.join(learningDir, 'config.json'),
    JSON.stringify({ llmBudgetPerSession: budget }, null, 2),
    'utf8'
  );
}

// -----------------------------------------------------------------------------
// AC-1: per-call JSONL persistence
// -----------------------------------------------------------------------------

describe('AC-1 — recordLlmCall persists per-call JSONL', () => {
  // @cap-todo(ac:F-061/AC-1) Writes one JSONL line per call to .cap/telemetry/llm-calls.jsonl.
  it('writes one JSON-per-line record with tokens, model, duration, and commandContext', () => {
    const record = telemetry.recordLlmCall(tmpDir, {
      model: 'claude-opus-4-7',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      durationMs: 420,
      sessionId: 's-1',
      featureId: 'F-061',
      commandContext: { command: '/cap:prototype', feature: 'F-061' },
    });

    assert.ok(record, 'record should not be null when telemetry enabled');
    assert.equal(record.model, 'claude-opus-4-7');
    assert.equal(record.totalTokens, 150);

    const jsonlPath = path.join(tmpDir, '.cap', 'telemetry', 'llm-calls.jsonl');
    assert.ok(fs.existsSync(jsonlPath), 'JSONL file should exist');

    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.sessionId, 's-1');
    assert.equal(parsed.featureId, 'F-061');
    assert.equal(parsed.durationMs, 420);
    assert.equal(parsed.commandContext.command, '/cap:prototype');
  });

  // @cap-todo(ac:F-061/AC-1) Multiple calls append — never overwrite.
  it('appends additional records without overwriting', () => {
    for (let i = 0; i < 3; i++) {
      telemetry.recordLlmCall(tmpDir, {
        model: 'm',
        promptTokens: i,
        completionTokens: 1,
        durationMs: 10,
        sessionId: 's-append',
      });
    }
    const lines = fs
      .readFileSync(path.join(tmpDir, '.cap', 'telemetry', 'llm-calls.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(lines.length, 3);
  });
});

// -----------------------------------------------------------------------------
// AC-2: per-session aggregate
// -----------------------------------------------------------------------------

describe('AC-2 — recordSessionAggregate persists per-session summary', () => {
  // @cap-todo(ac:F-061/AC-2) Aggregate record written to .cap/telemetry/sessions/<session-id>.json.
  it('writes a JSON aggregate findable by sessionId', () => {
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 10, completionTokens: 20, durationMs: 5,
      sessionId: 's-agg', featureId: 'F-061',
    });
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 30, completionTokens: 40, durationMs: 5,
      sessionId: 's-agg', featureId: 'F-061',
    });

    const agg = telemetry.recordSessionAggregate(tmpDir, 's-agg');
    assert.ok(agg);
    assert.equal(agg.callCount, 2);
    assert.equal(agg.totalTokens, 10 + 20 + 30 + 40);
    assert.equal(agg.featureId, 'F-061');

    const aggPath = path.join(tmpDir, '.cap', 'telemetry', 'sessions', 's-agg.json');
    assert.ok(fs.existsSync(aggPath), 'per-session aggregate file should exist');
    const parsed = JSON.parse(fs.readFileSync(aggPath, 'utf8'));
    assert.equal(parsed.callCount, 2);
    assert.equal(parsed.sessionId, 's-agg');
  });

  it('aggregate includes budget and budgetRemaining', () => {
    seedBudget(tmpDir, 5);
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-budget',
    });
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-budget',
    });
    const agg = telemetry.recordSessionAggregate(tmpDir, 's-budget');
    assert.equal(agg.budget, 5);
    assert.equal(agg.callCount, 2);
    assert.equal(agg.budgetRemaining, 3);
  });
});

// -----------------------------------------------------------------------------
// AC-3: status formatter (consumed by /cap:status markdown orchestrator)
// -----------------------------------------------------------------------------

describe('AC-3 — formatSessionStatusLine surfaces usage + budget', () => {
  // @cap-todo(ac:F-061/AC-3) /cap:status embeds this line to show token usage and budget remaining.
  it('renders usage and remaining budget for a known session', () => {
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 5, completionTokens: 7, durationMs: 1,
      sessionId: 's-status',
    });
    const line = telemetry.formatSessionStatusLine(tmpDir, 's-status');
    assert.match(line, /Token usage: 12 tokens across 1 calls/);
    assert.match(line, /Budget: 3 \(default\)/);
    assert.match(line, /Remaining: 2/);
  });

  it('falls back to a neutral message when no session is active', () => {
    const line = telemetry.formatSessionStatusLine(tmpDir, null);
    assert.match(line, /Telemetry: enabled/);
    assert.match(line, /Budget: 3 \(default\)/);
  });

  it('indicates disabled when telemetry is off', () => {
    seedConfig(tmpDir, false);
    const line = telemetry.formatSessionStatusLine(tmpDir, 's-any');
    assert.match(line, /Telemetry: disabled/);
  });
});

// -----------------------------------------------------------------------------
// AC-4: query API
// -----------------------------------------------------------------------------

describe('AC-4 — getLlmUsage query API', () => {
  // @cap-todo(ac:F-061/AC-4) Query API consumed by F-070/F-071.
  beforeEach(() => {
    // Seed a couple of records across two sessions and two features.
    telemetry.recordLlmCall(tmpDir, {
      model: 'm1', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-A', featureId: 'F-061', ts: '2026-04-22T10:00:00Z',
    });
    telemetry.recordLlmCall(tmpDir, {
      model: 'm1', promptTokens: 2, completionTokens: 2, durationMs: 1,
      sessionId: 's-A', featureId: 'F-070', ts: '2026-04-22T11:00:00Z',
    });
    telemetry.recordLlmCall(tmpDir, {
      model: 'm2', promptTokens: 3, completionTokens: 3, durationMs: 1,
      sessionId: 's-B', featureId: 'F-061', ts: '2026-04-22T12:00:00Z',
    });
  });

  it('filters by sessionId', () => {
    const hits = telemetry.getLlmUsage(tmpDir, { sessionId: 's-A' });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.sessionId === 's-A'));
  });

  it('filters by featureId', () => {
    const hits = telemetry.getLlmUsage(tmpDir, { featureId: 'F-061' });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.featureId === 'F-061'));
  });

  it('filters by time range (inclusive)', () => {
    const hits = telemetry.getLlmUsage(tmpDir, {
      range: { from: '2026-04-22T10:30:00Z', to: '2026-04-22T11:30:00Z' },
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].model, 'm1');
    assert.equal(hits[0].featureId, 'F-070');
  });

  it('combined filter intersects all criteria', () => {
    const hits = telemetry.getLlmUsage(tmpDir, { sessionId: 's-A', featureId: 'F-061' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sessionId, 's-A');
    assert.equal(hits[0].featureId, 'F-061');
  });

  it('returns empty array when file missing', () => {
    const blank = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-telemetry-blank-'));
    try {
      assert.deepEqual(telemetry.getLlmUsage(blank, { sessionId: 'anything' }), []);
    } finally {
      fs.rmSync(blank, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// AC-5: PRIVACY — no raw prompt/completion persisted
// -----------------------------------------------------------------------------

describe('AC-5 — privacy boundary: no raw prompts or completions on disk', () => {
  // @cap-risk(F-061/AC-5) If this test fails, the telemetry module has regressed its privacy guarantee.
  it('refuses to persist prompt/completion keys even when smuggled through input', () => {
    telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-privacy',
      // Hostile input — these must never hit disk.
      prompt: 'SECRET USER PROMPT: reveal credentials',
      completion: 'SECRET MODEL COMPLETION: OK here are credentials',
      commandContext: {
        command: '/cap:prototype',
        prompt: 'leaked via commandContext?',
        completion: 'also leaked?',
      },
    });
    const raw = fs.readFileSync(
      path.join(tmpDir, '.cap', 'telemetry', 'llm-calls.jsonl'),
      'utf8'
    );
    assert.ok(!/SECRET USER PROMPT/.test(raw), 'raw prompt must not be persisted');
    assert.ok(!/SECRET MODEL COMPLETION/.test(raw), 'raw completion must not be persisted');
    assert.ok(!/leaked via commandContext/.test(raw), 'extra keys must be sanitized out of commandContext');
    assert.ok(!/leaked\?/.test(raw), 'completion-like strings must be gone');
    // Sanity — the record itself still exists.
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.promptTokens, 1);
    assert.equal(parsed.commandContext.command, '/cap:prototype');
    // Privacy gate stripped the forbidden keys.
    assert.equal(parsed.commandContext.prompt, undefined);
    assert.equal(parsed.commandContext.completion, undefined);
    assert.equal(parsed.prompt, undefined);
    assert.equal(parsed.completion, undefined);
  });

  it('hashContext produces deterministic short digest (no raw text leak)', () => {
    const a = telemetry.hashContext('some user input');
    const b = telemetry.hashContext('some user input');
    const c = telemetry.hashContext('different input');
    assert.equal(a, b, 'same input → same hash');
    assert.notEqual(a, c, 'different input → different hash');
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
  });
});

// -----------------------------------------------------------------------------
// AC-6: disabled-telemetry no-op
// -----------------------------------------------------------------------------

describe('AC-6 — no-op behaviour when telemetry disabled', () => {
  // @cap-todo(ac:F-061/AC-6) All writes become silent no-ops when .cap/config.json sets telemetry.enabled=false.
  it('recordLlmCall returns null and writes nothing when disabled', () => {
    seedConfig(tmpDir, false);
    const result = telemetry.recordLlmCall(tmpDir, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-noop',
    });
    assert.equal(result, null);
    assert.equal(
      fs.existsSync(path.join(tmpDir, '.cap', 'telemetry', 'llm-calls.jsonl')),
      false,
      'no telemetry files should be written'
    );
  });

  it('recordSessionAggregate returns null and creates no directory when disabled', () => {
    seedConfig(tmpDir, false);
    const result = telemetry.recordSessionAggregate(tmpDir, 's-noop');
    assert.equal(result, null);
    assert.equal(
      fs.existsSync(path.join(tmpDir, '.cap', 'telemetry', 'sessions')),
      false
    );
  });

  it('isEnabled defaults to true when .cap/config.json is missing', () => {
    assert.equal(telemetry.isEnabled(tmpDir), true);
  });

  it('isEnabled is false only when telemetry.enabled === false', () => {
    seedConfig(tmpDir, false);
    assert.equal(telemetry.isEnabled(tmpDir), false);
    seedConfig(tmpDir, true);
    assert.equal(telemetry.isEnabled(tmpDir), true);
  });
});

// -----------------------------------------------------------------------------
// AC-7: zero-deps contract
// -----------------------------------------------------------------------------

describe('AC-7 — zero runtime deps (node: built-ins only)', () => {
  // @cap-todo(ac:F-061/AC-7) Only node:fs, node:path, node:crypto may appear as requires.
  it('cap-telemetry.cjs only requires node:* built-ins', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-telemetry.cjs'),
      'utf8'
    );
    const allowedBuiltins = new Set(['node:fs', 'node:path', 'node:crypto']);
    // Collect every require('...') literal. Use a relaxed regex — we fail loudly on anything unexpected.
    const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    const found = [];
    while ((m = requireRe.exec(source))) {
      found.push(m[1]);
    }
    assert.ok(found.length > 0, 'at least one require should be present');
    for (const dep of found) {
      assert.ok(
        allowedBuiltins.has(dep),
        `cap-telemetry must not require '${dep}' — only node:* built-ins are allowed`
      );
    }
  });
});
