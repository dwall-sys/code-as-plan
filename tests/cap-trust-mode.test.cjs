// @cap-feature(feature:F-075) Tests for Trust-Mode Configuration Slot.
// @cap-context Baseline coverage: every AC (AC-1..AC-7) has at least one dedicated test.
//              Rate-limit + shape-contract tests guard the open-closed extension point for B/C.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const trustMode = require('../cap/bin/lib/cap-trust-mode.cjs');
const session = require('../cap/bin/lib/cap-session.cjs');

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

let tmpRoot;
let stderrLines;
let originalStderrWrite;

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f075-'));
  fs.mkdirSync(path.join(root, '.cap'));
  return root;
}

function writeConfig(root, obj) {
  fs.writeFileSync(
    path.join(root, '.cap', 'config.json'),
    JSON.stringify(obj, null, 2),
    'utf8',
  );
}

function readConfig(root) {
  const raw = fs.readFileSync(path.join(root, '.cap', 'config.json'), 'utf8');
  return JSON.parse(raw);
}

// Capture console.error output so we can assert on the degradation warning.
// Patching console.error via the global stream avoids hard-coding the formatter.
function captureStderr() {
  stderrLines = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stderrLines.push(s);
    return originalStderrWrite(chunk, ...rest);
  };
}

function restoreStderr() {
  if (originalStderrWrite) {
    process.stderr.write = originalStderrWrite;
    originalStderrWrite = null;
  }
}

beforeEach(() => {
  tmpRoot = makeProject();
  trustMode._resetWarnOnceForTests();
  // Silence and capture the warning during every test; not every test asserts on it.
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// AC-1: SESSION.json carries trustMode with default 'A'
// =============================================================================

describe('F-075/AC-1 — SESSION.json trustMode field', () => {
  it('default session object includes trustMode="A"', () => {
    const def = session.getDefaultSession();
    assert.strictEqual(def.trustMode, 'A');
  });

  it('a session saved without trustMode loads back with trustMode="A"', () => {
    // Emulate an older session file that predates F-075.
    const legacy = {
      version: '2.0.0',
      lastCommand: null,
      activeFeature: null,
      step: null,
      metadata: {},
    };
    fs.writeFileSync(
      path.join(tmpRoot, '.cap', 'SESSION.json'),
      JSON.stringify(legacy, null, 2),
      'utf8',
    );
    const loaded = session.loadSession(tmpRoot);
    assert.strictEqual(loaded.trustMode, 'A', 'backfill via default-merge must yield "A"');
  });

  it('trustMode in SESSION.json survives a save/load round trip', () => {
    session.saveSession(tmpRoot, {
      ...session.getDefaultSession(),
      trustMode: 'A',
    });
    const loaded = session.loadSession(tmpRoot);
    assert.strictEqual(loaded.trustMode, 'A');
  });
});

// =============================================================================
// AC-2: .cap/config.json persists trustMode across sessions
// =============================================================================

describe('F-075/AC-2 — .cap/config.json persistence', () => {
  it('setTrustMode writes trustMode to .cap/config.json', () => {
    trustMode.setTrustMode(tmpRoot, 'A');
    const cfg = readConfig(tmpRoot);
    assert.strictEqual(cfg.trustMode, 'A');
  });

  it('setTrustMode preserves unrelated keys in config.json (coexists with telemetry block)', () => {
    writeConfig(tmpRoot, { telemetry: { enabled: true }, foo: 'bar' });
    trustMode.setTrustMode(tmpRoot, 'A');
    const cfg = readConfig(tmpRoot);
    assert.deepStrictEqual(cfg.telemetry, { enabled: true });
    assert.strictEqual(cfg.foo, 'bar');
    assert.strictEqual(cfg.trustMode, 'A');
  });

  it('config.json trustMode is read across "sessions" (two getTrustMode calls with the same root)', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    const r1 = trustMode.getTrustMode(tmpRoot);
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r1.mode, 'A');
    assert.strictEqual(r2.mode, 'A');
    assert.strictEqual(r1.source, 'config');
    assert.strictEqual(r2.source, 'config');
  });

  it('setTrustMode rejects unknown modes with a thrown Error', () => {
    assert.throws(() => trustMode.setTrustMode(tmpRoot, 'X'), /invalid mode/);
    assert.throws(() => trustMode.setTrustMode(tmpRoot, 'a'), /invalid mode/);
    assert.throws(() => trustMode.setTrustMode(tmpRoot, null), /invalid mode/);
  });
});

// =============================================================================
// AC-3: Non-A degradation with warning + rate-limit
// =============================================================================

describe('F-075/AC-3 — non-A degradation and warning', () => {
  const nonAValues = [
    ['B (valid-but-unsupported)', 'B'],
    ['C (valid-but-unsupported)', 'C'],
    ['X (invalid letter)', 'X'],
    ['a (lowercase)', 'a'],
    ['null', null],
    ['0', 0],
    ['empty array', []],
  ];

  for (const [label, raw] of nonAValues) {
    it(`degrades ${label} to 'A' with degraded:true`, () => {
      writeConfig(tmpRoot, { trustMode: raw });
      const result = trustMode.getTrustMode(tmpRoot);
      assert.strictEqual(result.mode, 'A', 'mode must always be "A" in MVP');
      assert.strictEqual(result.degraded, true, 'degraded flag must be true');
      assert.strictEqual(result.source, 'config');
    });
  }

  it('emits a stderr warning with the trust-mode-not-implemented code', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    const joined = stderrLines.join('');
    assert.ok(
      joined.includes('trust-mode-not-implemented'),
      `warning should include the code, got: ${JSON.stringify(joined)}`,
    );
    assert.ok(
      joined.includes('degrading to'),
      'warning should state that we degrade',
    );
  });

  it('warning is rate-limited to 1× per (projectRoot, rawValue) per process', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    trustMode.getTrustMode(tmpRoot);
    trustMode.getTrustMode(tmpRoot);
    const warningCount = stderrLines.filter(l =>
      l.includes('trust-mode-not-implemented'),
    ).length;
    assert.strictEqual(warningCount, 1, 'must log once, not 3×');
  });

  it('distinct raw values produce distinct warnings (same root)', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    writeConfig(tmpRoot, { trustMode: 'C' });
    trustMode.getTrustMode(tmpRoot);
    const warningCount = stderrLines.filter(l =>
      l.includes('trust-mode-not-implemented'),
    ).length;
    assert.strictEqual(warningCount, 2, 'B and C are distinct degradation triggers');
  });
});

// =============================================================================
// AC-4: Mode A forces approval (Human-in-the-Loop)
// =============================================================================

describe('F-075/AC-4 — requireApproval forces HITL in Mode A', () => {
  it('returns true on a fresh project (default mode A)', () => {
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  it('returns true when config explicitly sets trustMode="A"', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  it('returns true even when config sets B (degraded to A in MVP)', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    assert.strictEqual(
      trustMode.requireApproval(tmpRoot),
      true,
      'B is degraded to A → still approval-required',
    );
  });

  it('returns true even when config sets C (degraded to A in MVP)', () => {
    writeConfig(tmpRoot, { trustMode: 'C' });
    assert.strictEqual(
      trustMode.requireApproval(tmpRoot),
      true,
      'C is also degraded to A in MVP → approval still required',
    );
  });
});

// =============================================================================
// AC-5: Determinism — identical disk state → identical return
// =============================================================================

describe('F-075/AC-5 — determinism', () => {
  it('two calls with identical disk state return structurally identical results', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    const r1 = trustMode.getTrustMode(tmpRoot);
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(r1, r2);
  });

  it('default (empty) project returns the same result every call', () => {
    const r1 = trustMode.getTrustMode(tmpRoot);
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(r1, r2);
    assert.strictEqual(r1.source, 'default');
  });

  it('degraded reads are deterministic (same rawValue → same result)', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    const r1 = trustMode.getTrustMode(tmpRoot);
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(r1, r2);
    assert.strictEqual(r1.mode, 'A');
    assert.strictEqual(r1.degraded, true);
  });
});

// =============================================================================
// AC-6: Helper existence and signature
// =============================================================================

describe('F-075/AC-6 — helper exists and is callable', () => {
  it('exports getTrustMode as a function', () => {
    assert.strictEqual(typeof trustMode.getTrustMode, 'function');
  });

  it('exports requireApproval as a function', () => {
    assert.strictEqual(typeof trustMode.requireApproval, 'function');
  });

  it('exports setTrustMode as a function', () => {
    assert.strictEqual(typeof trustMode.setTrustMode, 'function');
  });

  it('exports isValidMode as a function', () => {
    assert.strictEqual(typeof trustMode.isValidMode, 'function');
  });

  it('isValidMode returns true only for A/B/C strings (strict equality)', () => {
    assert.strictEqual(trustMode.isValidMode('A'), true);
    assert.strictEqual(trustMode.isValidMode('B'), true);
    assert.strictEqual(trustMode.isValidMode('C'), true);
    assert.strictEqual(trustMode.isValidMode('a'), false);
    assert.strictEqual(trustMode.isValidMode('D'), false);
    assert.strictEqual(trustMode.isValidMode(''), false);
    assert.strictEqual(trustMode.isValidMode(null), false);
    assert.strictEqual(trustMode.isValidMode(undefined), false);
    assert.strictEqual(trustMode.isValidMode(0), false);
  });

  it('VALID_MODES constant is exposed and frozen', () => {
    assert.deepStrictEqual([...trustMode.VALID_MODES], ['A', 'B', 'C']);
    assert.ok(Object.isFrozen(trustMode.VALID_MODES));
  });
});

// =============================================================================
// AC-7: Open-Closed — return shape is frozen
// =============================================================================

describe('F-075/AC-7 — open-closed return shape (Breaking-Change signal)', () => {
  // @cap-decision(F-075/AC-7) Changing this test means changing the shape the Learn-Pipeline
  //                           consumers (F-071, F-073, F-074) rely on. This is a BREAKING CHANGE
  //                           across feature boundaries and should only happen in a coordinated
  //                           major-version bump. Do not "fix" this test silently.
  it('default-case shape is exactly { mode, source } — no extra keys', () => {
    const result = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(
      Object.keys(result).sort(),
      ['mode', 'source'],
      'shape drift — F-071/F-073/F-074 consumers expect only mode+source in non-degraded case',
    );
    assert.strictEqual(result.mode, 'A');
    assert.strictEqual(result.source, 'default');
  });

  it('degraded-case shape is exactly { mode, source, degraded, rawValue }', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    const result = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(
      Object.keys(result).sort(),
      ['degraded', 'mode', 'rawValue', 'source'],
      'shape drift — downstream consumers inspect degraded+rawValue to emit their own diagnostics',
    );
    assert.strictEqual(result.mode, 'A');
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.rawValue, 'B');
  });

  it('mode is always one of VALID_MODES (currently always A in MVP)', () => {
    // The whole point of the slot: consumers can rely on mode being a known symbol.
    writeConfig(tmpRoot, { trustMode: 'A' });
    assert.ok(trustMode.VALID_MODES.includes(trustMode.getTrustMode(tmpRoot).mode));
    writeConfig(tmpRoot, { trustMode: 'X' });
    assert.ok(trustMode.VALID_MODES.includes(trustMode.getTrustMode(tmpRoot).mode));
  });

  it('source is always one of: config | session | default', () => {
    // default
    assert.strictEqual(trustMode.getTrustMode(tmpRoot).source, 'default');
    // config
    writeConfig(tmpRoot, { trustMode: 'A' });
    assert.strictEqual(trustMode.getTrustMode(tmpRoot).source, 'config');
    // session — remove config, write session
    fs.unlinkSync(path.join(tmpRoot, '.cap', 'config.json'));
    session.saveSession(tmpRoot, { ...session.getDefaultSession(), trustMode: 'A' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.ok(r.source === 'session' || r.source === 'default',
      'session-sourced when key present and non-null; default when only getDefaultSession defaults apply');
  });
});

// =============================================================================
// D1 — Config precedence over SESSION.json
// =============================================================================

describe('F-075/D1 — config.json wins over SESSION.json', () => {
  it('when config.json has trustMode, SESSION is aligned to the config value', () => {
    // Pre-seed a SESSION with a stale value
    session.saveSession(tmpRoot, { ...session.getDefaultSession(), trustMode: 'A' });
    writeConfig(tmpRoot, { trustMode: 'B' });

    const result = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(result.source, 'config');
    assert.strictEqual(result.mode, 'A', 'degraded back to A');

    const sess = session.loadSession(tmpRoot);
    assert.strictEqual(sess.trustMode, 'A', 'SESSION.json must be aligned after read');
  });
});

// =============================================================================
// Atomic-write behaviour (no partial files)
// =============================================================================

describe('F-075 — atomic config write', () => {
  it('setTrustMode leaves no .tmp files behind on success', () => {
    trustMode.setTrustMode(tmpRoot, 'A');
    const entries = fs.readdirSync(path.join(tmpRoot, '.cap'));
    const tmpLeftovers = entries.filter(e => e.endsWith('.tmp'));
    assert.deepStrictEqual(tmpLeftovers, [], `no tmp leftovers expected, got: ${tmpLeftovers}`);
  });

  it('setTrustMode works when .cap/ does not yet exist', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f075-fresh-'));
    try {
      trustMode.setTrustMode(fresh, 'A');
      assert.ok(fs.existsSync(path.join(fresh, '.cap', 'config.json')));
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});
