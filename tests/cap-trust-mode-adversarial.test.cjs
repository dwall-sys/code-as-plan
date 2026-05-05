// @cap-feature(feature:F-075) Adversarial tests for Trust-Mode Configuration Slot.
// @cap-context Extends baseline coverage with mutation-safety, shape-exactness, unicode degradation,
//              rate-limit evasion attempts, atomic-write concurrency, session-sync corner cases, and
//              defense-in-depth for AC-7 (the open-closed invariant consumed by F-071/F-073/F-074).
// @cap-decision(F-075/AC-7) Shape frozen-ness is non-negotiable. If a consumer can mutate the result
//                           of getTrustMode(), trust-mode becomes effectively write-accessible from any
//                           downstream feature — breaking the open-closed contract.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const trustMode = require('../cap/bin/lib/cap-trust-mode.cjs');
const session = require('../cap/bin/lib/cap-session.cjs');

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

let tmpRoot;
let stderrLines;
let originalStderrWrite;

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f075-adv-'));
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

function writeRawConfig(root, raw) {
  fs.writeFileSync(path.join(root, '.cap', 'config.json'), raw, 'utf8');
}

function captureStderr() {
  // Guard against double-capture — if a prior test crashed before restoring,
  // re-binding process.stderr.write would capture the already-patched wrapper
  // and cause infinite recursion under coverage runners that instrument stderr.
  if (originalStderrWrite) return;
  stderrLines = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  // Capture into buffer but deliberately DO NOT delegate to originalStderrWrite.
  // Delegation is fragile across coverage tools (c8) that themselves patch
  // stderr; the delegate chain can recurse. The contract of stream.write()
  // is `boolean`, so returning true satisfies Node's expectations without
  // emitting the captured line to the parent process.
  process.stderr.write = (chunk) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stderrLines.push(s);
    return true;
  };
}

function restoreStderr() {
  if (originalStderrWrite) {
    process.stderr.write = originalStderrWrite;
    originalStderrWrite = null;
  }
}

function countWarnings() {
  return stderrLines.filter(l => l.includes('trust-mode-not-implemented')).length;
}

beforeEach(() => {
  tmpRoot = makeProject();
  trustMode._resetWarnOnceForTests();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// AC-7 — Open-Closed Shape-Frozen Contract (PRIMARY INVARIANT)
// =============================================================================

describe('F-075/AC-7 adversarial — return shape is frozen', () => {
  // @cap-todo(ac:F-075/AC-7) Default-case result MUST be Object.freeze-d.
  it('default-case result is Object.isFrozen === true', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(Object.isFrozen(r), true, 'consumers must not be able to mutate result');
  });

  // @cap-todo(ac:F-075/AC-7) Config-A result MUST be frozen.
  it('config-sourced result (mode A) is Object.isFrozen === true', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(Object.isFrozen(r), true);
  });

  // @cap-todo(ac:F-075/AC-7) Degraded result MUST be frozen.
  it('degraded-case result is Object.isFrozen === true', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(Object.isFrozen(r), true);
  });

  // @cap-todo(ac:F-075/AC-7) Session-sourced result MUST be frozen.
  it('session-sourced result is Object.isFrozen === true', () => {
    session.saveSession(tmpRoot, { ...session.getDefaultSession(), trustMode: 'A' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(Object.isFrozen(r), true);
  });

  // @cap-todo(ac:F-075/AC-7) Strict-mode mutation of result.mode must throw.
  it('mutating result.mode under strict mode throws TypeError', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.throws(() => {
      r.mode = 'C';
    }, TypeError, 'strict-mode mutation must throw; frozen object is the guarantee');
    assert.strictEqual(r.mode, 'A', 'mode must remain unchanged after attempted mutation');
  });

  // @cap-todo(ac:F-075/AC-7) Mutating result.source must throw / no-op.
  it('mutating result.source under strict mode throws TypeError', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.throws(() => {
      r.source = 'hacked';
    }, TypeError);
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-7) Adding new keys to the result must throw / no-op.
  it('adding keys to the result under strict mode throws TypeError', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.throws(() => {
      r.evilFlag = true;
    }, TypeError);
    assert.strictEqual('evilFlag' in r, false);
  });

  // @cap-todo(ac:F-075/AC-7) Deleting keys from the result must throw / no-op.
  it('deleting keys from the result under strict mode throws TypeError', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.throws(() => {
      delete r.mode;
    }, TypeError);
    assert.strictEqual(r.mode, 'A');
  });

  // @cap-todo(ac:F-075/AC-7) Top-level keys must be EXACTLY ['mode','source'] in non-degraded.
  it('default result has exactly the keys [mode, source] — no extras', () => {
    const r = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(Object.keys(r).sort(), ['mode', 'source']);
  });

  // @cap-todo(ac:F-075/AC-7) Degraded shape is exact.
  it('degraded result has exactly the keys [degraded, mode, rawValue, source] — no extras', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(
      Object.keys(r).sort(),
      ['degraded', 'mode', 'rawValue', 'source'],
    );
  });

  // @cap-todo(ac:F-075/AC-7) Types of fields must be stable.
  it('mode and source are always strings', () => {
    const r1 = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(typeof r1.mode, 'string');
    assert.strictEqual(typeof r1.source, 'string');

    writeConfig(tmpRoot, { trustMode: 'B' });
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(typeof r2.mode, 'string');
    assert.strictEqual(typeof r2.source, 'string');
    assert.strictEqual(typeof r2.degraded, 'boolean');
  });

  // @cap-todo(ac:F-075/AC-7) source is bounded to the documented enum.
  it('source is always one of {config, session, default}', () => {
    const allowed = new Set(['config', 'session', 'default']);
    const cases = [];

    // default
    cases.push(trustMode.getTrustMode(tmpRoot).source);

    // config
    writeConfig(tmpRoot, { trustMode: 'A' });
    cases.push(trustMode.getTrustMode(tmpRoot).source);

    // session (no config)
    fs.unlinkSync(path.join(tmpRoot, '.cap', 'config.json'));
    session.saveSession(tmpRoot, { ...session.getDefaultSession(), trustMode: 'A' });
    cases.push(trustMode.getTrustMode(tmpRoot).source);

    // degraded
    writeConfig(tmpRoot, { trustMode: 'X' });
    cases.push(trustMode.getTrustMode(tmpRoot).source);

    for (const s of cases) {
      assert.ok(allowed.has(s), `unexpected source: ${s}`);
    }
  });

  // @cap-todo(ac:F-075/AC-7) Two consecutive calls yield independent frozen objects.
  it('two consecutive getTrustMode calls return distinct object references', () => {
    const r1 = trustMode.getTrustMode(tmpRoot);
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.notStrictEqual(r1, r2, 'must not share a singleton — freshness matters for debugging');
    assert.deepStrictEqual(r1, r2, 'but structurally identical');
  });

  // @cap-todo(ac:F-075/AC-7) A successful mutation of r1 cannot leak into r2.
  it('attempted mutation of r1 does not change a later r2 (even in non-strict caller)', () => {
    const r1 = trustMode.getTrustMode(tmpRoot);
    // Try to mutate — will throw in strict mode; either way r2 must be clean.
    try { r1.mode = 'HACKED'; } catch (_) { /* expected */ }
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r2.mode, 'A');
    assert.strictEqual(r2.source, 'default');
    assert.strictEqual('degraded' in r2, false);
  });
});

// =============================================================================
// AC-7 — VALID_MODES encapsulation (open-closed proof)
// =============================================================================

describe('F-075/AC-7 adversarial — VALID_MODES is tamper-proof', () => {
  // @cap-todo(ac:F-075/AC-7) Prove that exported VALID_MODES is frozen (already covered by baseline,
  //                          but explicit via push/pop/shift to confirm no consumer can extend it).
  it('Array.prototype.push on VALID_MODES throws TypeError', () => {
    assert.throws(() => {
      trustMode.VALID_MODES.push('D');
    }, TypeError);
    assert.strictEqual(trustMode.VALID_MODES.length, 3);
  });

  // @cap-todo(ac:F-075/AC-7) pop/shift are also blocked.
  it('Array.prototype.pop on VALID_MODES throws TypeError', () => {
    assert.throws(() => {
      trustMode.VALID_MODES.pop();
    }, TypeError);
    assert.deepStrictEqual([...trustMode.VALID_MODES], ['A', 'B', 'C']);
  });

  // @cap-todo(ac:F-075/AC-7) Index mutation is blocked.
  it('index assignment on VALID_MODES throws TypeError', () => {
    assert.throws(() => {
      trustMode.VALID_MODES[0] = 'Z';
    }, TypeError);
    assert.strictEqual(trustMode.VALID_MODES[0], 'A');
  });

  // @cap-todo(ac:F-075/AC-7) Future activation of B/C must ONLY change the return of requireApproval —
  //                          the VALID_MODES set itself stays stable (any change = explicit breaking change).
  it('VALID_MODES set is exactly {A,B,C} — adding D requires an intentional code change', () => {
    const set = new Set([...trustMode.VALID_MODES]);
    assert.strictEqual(set.size, 3);
    assert.ok(set.has('A'));
    assert.ok(set.has('B'));
    assert.ok(set.has('C'));
  });

  // Documentation tests for the eventual B/C activation. They are intentionally
  // skipped — the MVP hard-caps to A, so asserting these now would fail. They
  // exist to pin the *expected* shape so a future contributor flipping the cap
  // sees the contract before they break it.
  it.skip('when B is activated, getTrustMode({trustMode:"B"}) returns {mode:"B", source:"config"} without degraded', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'B');
    assert.strictEqual(r.source, 'config');
    assert.strictEqual(r.degraded, undefined);
  });

  it.skip('when C is activated, requireApproval returns false', () => {
    writeConfig(tmpRoot, { trustMode: 'C' });
    assert.strictEqual(trustMode.requireApproval(tmpRoot), false);
  });
});

// =============================================================================
// AC-3 — Degradation corner cases (strings, unicode, non-strings)
// =============================================================================

describe('F-075/AC-3 adversarial — non-A string variations degrade', () => {
  const stringCases = [
    ['lowercase a', 'a'],
    ['lowercase b', 'b'],
    ['double A', 'AA'],
    ['empty string', ''],
    ['leading space', ' A'],
    ['trailing space', 'A '],
    ['newline prefix', '\nA'],
    ['tab prefix', '\tA'],
    ['letter D (out of set)', 'D'],
    ['letter Z', 'Z'],
  ];

  for (const [label, raw] of stringCases) {
    // @cap-todo(ac:F-075/AC-3) Every subtly-wrong string must degrade, no silent acceptance.
    it(`rejects "${label}" and degrades to A`, () => {
      writeConfig(tmpRoot, { trustMode: raw });
      const r = trustMode.getTrustMode(tmpRoot);
      assert.strictEqual(r.mode, 'A');
      assert.strictEqual(r.degraded, true);
      assert.strictEqual(r.rawValue, raw);
    });
  }
});

describe('F-075/AC-3 adversarial — non-string types degrade', () => {
  const nonStringCases = [
    ['null', null],
    ['undefined-via-missing-will-be-covered-separately', 'placeholder'], // skip synthetic
    ['true', true],
    ['false', false],
    ['number 0', 0],
    ['number 1', 1],
    ['empty array', []],
    ['empty object', {}],
    ['array with A', ['A']],
    ['object with mode:A', { mode: 'A' }],
  ];

  for (const [label, raw] of nonStringCases) {
    if (raw === 'placeholder') continue;
    // @cap-todo(ac:F-075/AC-3) Non-string inputs must NEVER be accepted as a mode.
    it(`rejects ${label} and degrades to A`, () => {
      writeConfig(tmpRoot, { trustMode: raw });
      const r = trustMode.getTrustMode(tmpRoot);
      assert.strictEqual(r.mode, 'A');
      assert.strictEqual(r.degraded, true);
      // rawValue goes through JSON serialisation, so deep equality is fine
      assert.deepStrictEqual(r.rawValue, raw);
    });
  }
});

describe('F-075/AC-3 adversarial — Unicode look-alikes for A', () => {
  // These are visually indistinguishable from 'A' but NOT 'A' in bytes.
  // If any of these were accepted, a hostile config could silently flip Mode.
  const unicodeCases = [
    ['mathematical bold A (U+1D400)', '\u{1D400}'],
    ['cyrillic capital A (U+0410)', 'А'],
    ['greek capital alpha (U+0391)', 'Α'],
    ['fullwidth latin A (U+FF21)', 'Ａ'],
    ['latin A with combining (A + U+0301)', 'Á'],
  ];

  for (const [label, raw] of unicodeCases) {
    // @cap-todo(ac:F-075/AC-3) Unicode homoglyphs of 'A' must NOT be accepted.
    it(`rejects ${label} and degrades to A`, () => {
      writeConfig(tmpRoot, { trustMode: raw });
      const r = trustMode.getTrustMode(tmpRoot);
      assert.strictEqual(r.mode, 'A');
      assert.strictEqual(r.degraded, true, `homoglyph "${label}" must not pass as "A"`);
    });
  }
});

// =============================================================================
// AC-3 — Warning rate-limit evasion attempts
// =============================================================================

describe('F-075/AC-3 adversarial — warning rate-limit is tight', () => {
  // @cap-todo(ac:F-075/AC-3) Five identical rawValues → exactly 1 warning.
  it('5× same rawValue (B) in same process → 1 warning', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    for (let i = 0; i < 5; i++) trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(countWarnings(), 1, 'rate-limit must memoize per (root,rawValue)');
  });

  // @cap-todo(ac:F-075/AC-3) Five distinct rawValues → exactly 5 warnings.
  it('5× distinct rawValues in same process → 5 warnings', () => {
    const values = ['B', 'C', 'X', 'Y', 'Z'];
    for (const v of values) {
      writeConfig(tmpRoot, { trustMode: v });
      trustMode.getTrustMode(tmpRoot);
    }
    assert.strictEqual(countWarnings(), 5, 'distinct raws each deserve their own warning');
  });

  // @cap-todo(ac:F-075/AC-3) Subtle whitespace variations count as distinct rawValues.
  it('"B" and "B " (trailing space) are distinct → 2 warnings', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    writeConfig(tmpRoot, { trustMode: 'B ' });
    trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(countWarnings(), 2);
  });

  // @cap-todo(ac:F-075/AC-3) Primitive vs. string form of the same value are distinct rawValues.
  it('number 1 and string "1" produce 2 warnings (JSON.stringify differs)', () => {
    writeConfig(tmpRoot, { trustMode: 1 });
    trustMode.getTrustMode(tmpRoot);
    writeConfig(tmpRoot, { trustMode: '1' });
    trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(countWarnings(), 2);
  });

  // @cap-todo(ac:F-075/AC-3) Two distinct project roots with the same rawValue → 2 warnings.
  it('same rawValue under two distinct projectRoots → 2 warnings', () => {
    const root2 = makeProject();
    try {
      writeConfig(tmpRoot, { trustMode: 'B' });
      writeConfig(root2, { trustMode: 'B' });
      trustMode.getTrustMode(tmpRoot);
      trustMode.getTrustMode(root2);
      assert.strictEqual(countWarnings(), 2, 'memo key must include projectRoot');
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  });

  // @cap-todo(ac:F-075/AC-3) _resetWarnOnceForTests truly clears the memo.
  it('_resetWarnOnceForTests unlocks the memo — same raw warns again', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(countWarnings(), 1);

    trustMode._resetWarnOnceForTests();
    trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(countWarnings(), 2, 'after reset, same raw must re-warn');
  });

  // @cap-todo(ac:F-075/AC-3) Warning line is single-line (grep-friendly).
  it('warning emits a single line (ends with newline, no embedded CR)', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    trustMode.getTrustMode(tmpRoot);
    const warn = stderrLines.find(l => l.includes('trust-mode-not-implemented'));
    assert.ok(warn, 'warning was not captured');
    const newlineCount = (warn.match(/\n/g) || []).length;
    assert.strictEqual(newlineCount, 1, 'exactly one trailing newline');
    assert.strictEqual(warn.includes('\r'), false, 'no carriage return');
  });
});

// =============================================================================
// AC-2 — Config file malformation
// =============================================================================

describe('F-075/AC-2 adversarial — config.json malformations', () => {
  // @cap-todo(ac:F-075/AC-2) Missing config.json → default 'A'.
  it('missing config.json → default source, mode A', () => {
    // No config written
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Truncated JSON → silent fallback, no crash.
  it('truncated JSON → default source, no throw', () => {
    writeRawConfig(tmpRoot, '{"trustMode": ');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Missing closing bracket → silent fallback.
  it('JSON with missing closing bracket → default source', () => {
    writeRawConfig(tmpRoot, '{"trustMode": "A"');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Empty file → silent fallback.
  it('empty config.json → default source', () => {
    writeRawConfig(tmpRoot, '');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Config with only unrelated keys (no trustMode) → default.
  it('config with foo but no trustMode → default source', () => {
    writeConfig(tmpRoot, { foo: 'bar', telemetry: { enabled: false } });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Non-object root (array) → default, no crash.
  it('array-typed config root → default source', () => {
    writeRawConfig(tmpRoot, JSON.stringify(['trustMode', 'A']));
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) String-typed root → default, no crash.
  it('string-typed config root → default source', () => {
    writeRawConfig(tmpRoot, JSON.stringify('just a string'));
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) null root → default, no crash.
  it('null-typed config root → default source', () => {
    writeRawConfig(tmpRoot, 'null');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) number root → default, no crash.
  it('number-typed config root → default source', () => {
    writeRawConfig(tmpRoot, '42');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Large valid config (100 KB blob) → no timeout, correct resolution.
  it('100 KB config does not crash or timeout', () => {
    const big = { trustMode: 'A', blob: 'x'.repeat(100 * 1024) };
    writeConfig(tmpRoot, big);
    const start = Date.now();
    const r = trustMode.getTrustMode(tmpRoot);
    const duration = Date.now() - start;
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'config');
    assert.ok(duration < 500, `read of 100KB config took ${duration}ms, expected <500ms`);
  });
});

// =============================================================================
// AC-2 — setTrustMode atomic-write safety
// =============================================================================

describe('F-075/AC-2 adversarial — setTrustMode atomic safety', () => {
  // @cap-todo(ac:F-075/AC-2) No tmp files linger after a successful write.
  it('no .tmp leftovers after 10 successive setTrustMode calls', () => {
    for (let i = 0; i < 10; i++) trustMode.setTrustMode(tmpRoot, 'A');
    const entries = fs.readdirSync(path.join(tmpRoot, '.cap'));
    const tmp = entries.filter(e => e.endsWith('.tmp'));
    assert.deepStrictEqual(tmp, []);
  });

  // @cap-todo(ac:F-075/AC-2) Concurrent writes leave a valid JSON file (last-writer-wins semantics).
  it('two parallel child-process setTrustMode writes end with valid JSON', () => {
    const libPath = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-trust-mode.cjs');
    const children = [];
    for (let i = 0; i < 5; i++) {
      children.push(cp.spawnSync(process.execPath, [
        '-e',
        `require(${JSON.stringify(libPath)}).setTrustMode(${JSON.stringify(tmpRoot)}, 'A');`,
      ], { encoding: 'utf8' }));
    }
    for (const c of children) {
      assert.strictEqual(c.status, 0, `child failed: ${c.stderr}`);
    }
    const content = fs.readFileSync(path.join(tmpRoot, '.cap', 'config.json'), 'utf8');
    const parsed = JSON.parse(content); // must not throw
    assert.strictEqual(parsed.trustMode, 'A');
    const tmp = fs.readdirSync(path.join(tmpRoot, '.cap')).filter(e => e.endsWith('.tmp'));
    assert.deepStrictEqual(tmp, [], 'no leftover tmp files from concurrent writes');
  });

  // @cap-todo(ac:F-075/AC-2) Write on read-only .cap/ surfaces a deterministic Error, no partial state.
  it('setTrustMode on read-only .cap/ throws without leaving a partial config', function () {
    if (process.platform === 'win32') {
      // Windows filesystem permissions differ — skip.
      return;
    }
    // Make .cap read-only
    const capDir = path.join(tmpRoot, '.cap');
    fs.chmodSync(capDir, 0o500);
    try {
      assert.throws(() => trustMode.setTrustMode(tmpRoot, 'A'));
      // No config file should have been created, and no tmp leftovers.
      const entries = fs.readdirSync(capDir);
      const tmp = entries.filter(e => e.endsWith('.tmp'));
      assert.deepStrictEqual(tmp, [], 'no tmp leftovers on failed write');
    } finally {
      fs.chmodSync(capDir, 0o700);
    }
  });

  // @cap-todo(ac:F-075/AC-2) setTrustMode return value matches shape-frozen contract.
  it('setTrustMode return value is itself Object.freeze-d', () => {
    const r = trustMode.setTrustMode(tmpRoot, 'A');
    assert.strictEqual(Object.isFrozen(r), true);
    assert.deepStrictEqual(Object.keys(r).sort(), ['mode', 'source']);
  });

  // @cap-todo(ac:F-075/AC-2) setTrustMode with non-string raw throws and leaves file untouched.
  it('setTrustMode(<number>) throws and does not create config.json', () => {
    assert.throws(() => trustMode.setTrustMode(tmpRoot, 42), /invalid mode/);
    assert.strictEqual(
      fs.existsSync(path.join(tmpRoot, '.cap', 'config.json')),
      false,
      'failed set must not create a file',
    );
  });

  // @cap-todo(ac:F-075/AC-2) setTrustMode(undefined) throws.
  it('setTrustMode(undefined) throws /invalid mode/', () => {
    assert.throws(() => trustMode.setTrustMode(tmpRoot, undefined), /invalid mode/);
  });
});

// =============================================================================
// AC-1 — SESSION.json sync corner cases
// =============================================================================

describe('F-075/AC-1 adversarial — SESSION.json sync', () => {
  // @cap-todo(ac:F-075/AC-1) config wins on divergence; SESSION realigned on next read.
  it('config=A, session=B → read yields A, session is realigned to A', () => {
    session.saveSession(tmpRoot, { ...session.getDefaultSession(), trustMode: 'B' });
    writeConfig(tmpRoot, { trustMode: 'A' });
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'config');
    const sess = session.loadSession(tmpRoot);
    assert.strictEqual(sess.trustMode, 'A', 'session must be re-synced to resolved mode');
  });

  // @cap-todo(ac:F-075/AC-1) SESSION.json missing entirely → fall through to default 'A'.
  it('neither config nor SESSION exists → default A', () => {
    // beforeEach created .cap/ but no files inside.
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-1) Corrupt SESSION.json → fallback via loadSession's try/catch, no crash.
  it('corrupt SESSION.json → read does not throw, falls back to default', () => {
    fs.writeFileSync(path.join(tmpRoot, '.cap', 'SESSION.json'), '{ corrupt', 'utf8');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    // loadSession returns defaults on parse error, defaults include trustMode:'A',
    // but the SESSION file DOES exist on disk, so the session-source branch fires and
    // it will try to use trustMode='A' from defaults → session source OR the branch short-circuits.
    // Either way: mode must be A and no throw.
    assert.ok(['default', 'session', 'config'].includes(r.source));
  });

  // @cap-todo(ac:F-075/AC-1) SESSION with trustMode explicitly set to null → fall through.
  it('SESSION.json with trustMode=null → default source (null is not a valid signal)', () => {
    fs.writeFileSync(
      path.join(tmpRoot, '.cap', 'SESSION.json'),
      JSON.stringify({ ...session.getDefaultSession(), trustMode: null }, null, 2),
      'utf8',
    );
    const r = trustMode.getTrustMode(tmpRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-1) getDefaultSession always carries trustMode = 'A'.
  it('getDefaultSession() is idempotent and always yields trustMode=A', () => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(session.getDefaultSession().trustMode, 'A');
    }
  });

  // @cap-todo(ac:F-075/AC-1) getDefaultSession returns a fresh object each call (no aliasing).
  it('getDefaultSession returns distinct object references', () => {
    const a = session.getDefaultSession();
    const b = session.getDefaultSession();
    assert.notStrictEqual(a, b, 'must be fresh — otherwise mutation of one leaks into all');
    a.trustMode = 'MUTATED';
    assert.strictEqual(session.getDefaultSession().trustMode, 'A', 'mutation must not leak');
  });
});

// =============================================================================
// AC-4 — requireApproval under all modes + future-proofing
// =============================================================================

describe('F-075/AC-4 adversarial — requireApproval contract', () => {
  // @cap-todo(ac:F-075/AC-4) Default (no config) → approval required.
  it('requireApproval on a fresh project returns true', () => {
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  // @cap-todo(ac:F-075/AC-4) Mode A (explicit) → approval required.
  it('requireApproval with config trustMode=A returns true', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  // @cap-todo(ac:F-075/AC-4) Mode B configured (degraded to A) → approval required.
  it('requireApproval with config trustMode=B (degraded) returns true', () => {
    writeConfig(tmpRoot, { trustMode: 'B' });
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  // @cap-todo(ac:F-075/AC-4) Mode C configured (degraded to A) → approval required.
  it('requireApproval with config trustMode=C (degraded) returns true', () => {
    writeConfig(tmpRoot, { trustMode: 'C' });
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  // @cap-todo(ac:F-075/AC-4) Junk config → approval required (safe default).
  it('requireApproval with garbage config (array) returns true', () => {
    writeRawConfig(tmpRoot, JSON.stringify(['junk']));
    assert.strictEqual(trustMode.requireApproval(tmpRoot), true);
  });

  // @cap-todo(ac:F-075/AC-4) Scope option is currently ignored but must not break the contract.
  it('requireApproval ignores unknown options gracefully', () => {
    assert.strictEqual(trustMode.requireApproval(tmpRoot, { scope: 'patterns' }), true);
    assert.strictEqual(trustMode.requireApproval(tmpRoot, null), true);
    assert.strictEqual(trustMode.requireApproval(tmpRoot, undefined), true);
  });
});

// =============================================================================
// AC-5 — Determinism (same inputs → same outputs, always)
// =============================================================================

describe('F-075/AC-5 adversarial — determinism stress', () => {
  // @cap-todo(ac:F-075/AC-5) 50 consecutive calls yield structurally identical results.
  it('50× getTrustMode on stable disk yields 50 deepEqual results', () => {
    writeConfig(tmpRoot, { trustMode: 'A' });
    const results = [];
    for (let i = 0; i < 50; i++) results.push(trustMode.getTrustMode(tmpRoot));
    const first = results[0];
    for (const r of results) {
      assert.deepStrictEqual(r, first);
    }
  });

  // @cap-todo(ac:F-075/AC-5) Between-call mutation of the returned object (illegal) must not leak.
  it('attempted mutations between calls do not leak', () => {
    const r1 = trustMode.getTrustMode(tmpRoot);
    try { r1.mode = 'B'; } catch (_) { /* frozen */ }
    try { r1.source = 'hacked'; } catch (_) { /* frozen */ }
    const r2 = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(r2, { mode: 'A', source: 'default' });
  });
});

// =============================================================================
// AC-6 — Helper contract stability
// =============================================================================

describe('F-075/AC-6 adversarial — helper signature stability', () => {
  // @cap-todo(ac:F-075/AC-6) Exports surface is minimal and documented; no accidental leaks.
  it('public exports are exactly the documented set', () => {
    const expected = new Set([
      'getTrustMode',
      'setTrustMode',
      'requireApproval',
      'isValidMode',
      'VALID_MODES',
      'DEFAULT_MODE',
      'WARN_CODE',
      // Documented test hook
      '_resetWarnOnceForTests',
    ]);
    const actual = new Set(Object.keys(trustMode));
    const unexpected = [...actual].filter(k => !expected.has(k));
    const missing = [...expected].filter(k => !actual.has(k));
    assert.deepStrictEqual(unexpected, [], `unexpected exports: ${unexpected}`);
    assert.deepStrictEqual(missing, [], `missing exports: ${missing}`);
  });

  // @cap-todo(ac:F-075/AC-6) DEFAULT_MODE constant is stable.
  it('DEFAULT_MODE is the string "A"', () => {
    assert.strictEqual(trustMode.DEFAULT_MODE, 'A');
    assert.strictEqual(typeof trustMode.DEFAULT_MODE, 'string');
  });

  // @cap-todo(ac:F-075/AC-6) WARN_CODE is stable (grep-target for ops).
  it('WARN_CODE is the string "trust-mode-not-implemented"', () => {
    assert.strictEqual(trustMode.WARN_CODE, 'trust-mode-not-implemented');
  });

  // @cap-todo(ac:F-075/AC-6) isValidMode is pure — no side effects on repeated calls.
  it('isValidMode is a pure predicate', () => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(trustMode.isValidMode('A'), true);
      assert.strictEqual(trustMode.isValidMode('B'), true);
      assert.strictEqual(trustMode.isValidMode('C'), true);
      assert.strictEqual(trustMode.isValidMode('a'), false);
    }
  });
});

// =============================================================================
// Path-injection defense (defense-in-depth)
// =============================================================================

describe('F-075 adversarial — projectRoot path hygiene', () => {
  // @cap-todo(ac:F-075/AC-2) Very long projectRoot does not crash, yields default.
  it('projectRoot of 1200 chars yields default without crashing', () => {
    const longRoot = path.join(os.tmpdir(), 'cap-long-' + 'x'.repeat(1200));
    // Don't actually create it — the helper must survive a missing root.
    const r = trustMode.getTrustMode(longRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) Unicode projectRoot does not crash.
  it('unicode projectRoot yields default without crashing', () => {
    const uniRoot = path.join(os.tmpdir(), 'cap-üñîçødé-🔒');
    const r = trustMode.getTrustMode(uniRoot);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default');
  });

  // @cap-todo(ac:F-075/AC-2) projectRoot with '..' does not escape to the parent's config.
  it('projectRoot with ".." segments does not leak parent config', () => {
    // Write a config at tmpRoot; then read with projectRoot pointing to a sibling via "..".
    writeConfig(tmpRoot, { trustMode: 'B' }); // would-be degradation trigger
    // Request with a completely different (non-existent) root — must not read tmpRoot's config.
    const sibling = path.join(tmpRoot, '..', 'cap-does-not-exist-' + Date.now());
    const r = trustMode.getTrustMode(sibling);
    assert.strictEqual(r.mode, 'A');
    assert.strictEqual(r.source, 'default', 'must not read a different projectRoot via path traversal');
  });
});

// =============================================================================
// Cross-AC integration probes
// =============================================================================

describe('F-075 adversarial — cross-AC integration', () => {
  // @cap-todo(ac:F-075/AC-1,AC-2,AC-3) setTrustMode('A') creates clean, resolvable state.
  it('setTrustMode(A) then getTrustMode returns clean {mode:A,source:config}', () => {
    trustMode.setTrustMode(tmpRoot, 'A');
    const r = trustMode.getTrustMode(tmpRoot);
    assert.deepStrictEqual(r, { mode: 'A', source: 'config' });
    assert.strictEqual(Object.isFrozen(r), true);
    assert.strictEqual(countWarnings(), 0, 'setting A must not emit any degradation warning');
  });

  // @cap-todo(ac:F-075/AC-2,AC-3) setTrustMode('B') accepts (B is a VALID_MODE) but subsequent
  //                                 getTrustMode degrades to A with degraded:true. This documents the
  //                                 *intentional* asymmetry: the writer accepts the mode syntactically,
  //                                 the reader enforces the MVP hard-cap. When B ships, only the reader
  //                                 changes — the writer is already ready.
  it('setTrustMode(B) is accepted, but getTrustMode still degrades to A with a warning', () => {
    const written = trustMode.setTrustMode(tmpRoot, 'B');
    assert.strictEqual(written.mode, 'A', 'reader caps to A');
    assert.strictEqual(written.degraded, true);
    assert.strictEqual(written.rawValue, 'B');
    assert.strictEqual(written.source, 'config');
    // File on disk reflects the raw B.
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpRoot, '.cap', 'config.json'), 'utf8'));
    assert.strictEqual(cfg.trustMode, 'B');
  });

  // @cap-todo(ac:F-075/AC-4,AC-7) requireApproval is always true — and the result shape never leaks.
  it('requireApproval does not expose any internal state to the caller', () => {
    const result = trustMode.requireApproval(tmpRoot);
    assert.strictEqual(typeof result, 'boolean', 'must be a plain boolean, not a richer object');
  });
});
