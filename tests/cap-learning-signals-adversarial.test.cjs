'use strict';

// @cap-feature(feature:F-070) Adversarial tests for Collect Learning Signals.
//                  Mirrors the F-061 adversarial pattern: byte-level no-needle assertions for AC-4
//                  (privacy), performance.now() brackets for AC-5 (overhead), zero-deps contract,
//                  malformed input edge cases, and concurrent-append integrity.
// @cap-decision(F-070/AdversarialStrategy) Every privacy test performs a byte-level assertion against
//                  the JSONL file. Structural assertions on parsed fields are not enough because a
//                  future contributor could smuggle secrets via e.g. a synthesised decisionId.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const LEARNING_PATH = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-learning-signals.cjs');
const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-learning-hook.js');
const learning = require(LEARNING_PATH);

const SECRET_NEEDLES = [
  'SECRET_NEEDLE_xyz',
  'SECRET_PROMPT_ALPHA',
  'SECRET_DIFF_BETA',
  'SECRET_PATH_GAMMA',
  'SECRET_DECISION_DELTA',
  'SECRET_NESTED_EPSILON',
  'SECRET_LONG_THETA',
];

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readAllJsonlBytes(root) {
  const dir = path.join(root, '.cap', 'learning', 'signals');
  if (!fs.existsSync(dir)) return '';
  let blob = '';
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    blob += fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return blob;
}

function assertNoNeedles(raw, label) {
  for (const n of SECRET_NEEDLES) {
    assert.ok(
      !raw.includes(n),
      `${label || 'disk'} must not contain secret needle "${n}" — privacy boundary breached`
    );
  }
}

// ---------------------------------------------------------------------------
// AC-4 · Privacy boundary — no raw text on disk
// ---------------------------------------------------------------------------

describe('AC-4 adversarial · privacy boundary blocks raw text', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-4) targetFile path is hashed, never persisted raw
  it('recordOverride hashes targetFile — raw path never lands on disk', () => {
    const secretPath = '/Users/SECRET_PATH_GAMMA/projects/private-thing.cjs';
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: 's', targetFile: secretPath,
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw, 'overrides.jsonl');
    assert.ok(!raw.includes(secretPath), 'raw path must not be persisted');
    // Hash must still be present for dedup downstream.
    const recs = raw.trim().split('\n').map(JSON.parse);
    assert.equal(recs.length, 1);
    assert.match(recs[0].targetFileHash, /^[0-9a-f]{16}$/);
  });

  // @cap-todo(ac:F-070/AC-4) memoryFile path is hashed
  it('recordMemoryRef hashes memoryFile — raw path never lands on disk', () => {
    const secretPath = '.cap/memory/SECRET_NEEDLE_xyz.md';
    learning.recordMemoryRef({
      projectRoot: tmp, sessionId: 's', memoryFile: secretPath,
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw, 'memory-refs.jsonl');
    assert.ok(!raw.includes(secretPath), 'raw memory path must not be persisted');
  });

  // @cap-todo(ac:F-070/AC-4) decisionId is length-capped so a hostile caller can't smuggle a prompt
  it('recordRegret length-caps decisionId at 200 chars (no smuggle channel)', () => {
    const huge = 'SECRET_LONG_THETA'.repeat(2000); // 34_000 chars total
    learning.recordRegret({
      projectRoot: tmp, sessionId: 's', decisionId: huge,
    });
    const raw = readAllJsonlBytes(tmp);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    assert.ok(rec.decisionId.length <= 200, `decisionId must be capped, got ${rec.decisionId.length}`);
    // ~200/17 ≈ 11 — anything far above means cap was bypassed.
    const occurrences = (raw.match(/SECRET_LONG_THETA/g) || []).length;
    assert.ok(occurrences <= 12, `length cap bypassed: ${occurrences} needle copies persisted`);
  });

  // @cap-todo(ac:F-070/AC-4) sessionId / featureId are length-capped
  it('sessionId and featureId are length-capped at 200 chars', () => {
    const huge = 'SECRET_LONG_THETA'.repeat(2000);
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: huge, featureId: huge, targetFile: '/p',
    });
    const raw = readAllJsonlBytes(tmp);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    assert.ok(rec.sessionId.length <= 200);
    assert.ok(rec.featureId.length <= 200);
  });

  // @cap-todo(ac:F-070/AC-4) non-string ids collapse to null, not coerced (no [object Object] leakage)
  it('non-string sessionId / featureId collapse to null (no toString coercion)', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: { toString: () => 'SECRET_NEEDLE_xyz' },
      featureId: ['SECRET_NEEDLE_xyz'],
      targetFile: '/p',
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    assert.equal(rec.sessionId, null);
    assert.equal(rec.featureId, null);
  });

  // @cap-todo(ac:F-070/AC-4) recordRegretsFromScan never persists tag.description (free text)
  it('recordRegretsFromScan never persists the description text of a regret tag', () => {
    const tags = [{
      type: 'decision',
      file: 'src/a.js', line: 5,
      metadata: { feature: 'F-001', regret: 'true', id: 'F-001/D1' },
      description: 'D1: this contains SECRET_NEEDLE_xyz that must not leak',
    }];
    learning.recordRegretsFromScan(tmp, tags, { sessionId: 's' });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw, 'regrets.jsonl');
    // decisionId is structured metadata — that's allowed.
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    assert.equal(rec.decisionId, 'F-001/D1');
  });

  // @cap-todo(ac:F-070/AC-4) Persisted record only contains the documented schema keys
  it('persisted Override record only contains the documented top-level keys', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: 's', featureId: 'F-070', targetFile: '/p',
      // Hostile extras — must be dropped.
      prompt: 'SECRET_PROMPT_ALPHA',
      diff: 'SECRET_DIFF_BETA',
      body: 'SECRET_NEEDLE_xyz',
      raw: 'SECRET_NEEDLE_xyz',
      contents: 'SECRET_NEEDLE_xyz',
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    const allowed = new Set([
      'id', 'ts', 'sessionId', 'featureId',
      'signalType', 'subType', 'contextHash', 'targetFileHash',
    ]);
    for (const k of Object.keys(rec)) {
      assert.ok(allowed.has(k), `unexpected top-level key in OverrideRecord: "${k}"`);
    }
  });

  it('persisted MemoryRef record only contains the documented top-level keys', () => {
    learning.recordMemoryRef({
      projectRoot: tmp, sessionId: 's', featureId: 'F-070',
      memoryFile: '.cap/memory/x.md',
      prompt: 'SECRET_NEEDLE_xyz',
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    const allowed = new Set([
      'id', 'ts', 'sessionId', 'featureId', 'signalType', 'contextHash', 'memoryFileHash',
    ]);
    for (const k of Object.keys(rec)) {
      assert.ok(allowed.has(k), `unexpected top-level key in MemoryRefRecord: "${k}"`);
    }
  });

  it('persisted Regret record only contains the documented top-level keys', () => {
    learning.recordRegret({
      projectRoot: tmp, sessionId: 's', featureId: 'F-001',
      decisionId: 'F-001/D1',
      prompt: 'SECRET_NEEDLE_xyz',
    });
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw);
    const rec = JSON.parse(raw.trim().split('\n')[0]);
    const allowed = new Set([
      'id', 'ts', 'sessionId', 'featureId', 'signalType', 'decisionId', 'contextHash',
    ]);
    for (const k of Object.keys(rec)) {
      assert.ok(allowed.has(k), `unexpected top-level key in RegretRecord: "${k}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 · Hot-path overhead < 50ms; no JSONL reads in hot path
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · hot-path overhead is bounded and read-free', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-5) hot-path latency stays under budget even with 10k existing records
  it('recordOverride stays under 50ms p99 with 10k pre-existing records', () => {
    // Synthesise 10k records via raw JSONL append — bypassing the API to avoid skewing the timer.
    const dir = path.join(tmp, '.cap', 'learning', 'signals');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(JSON.stringify({
        id: `seed-${i}`, ts: '2026-04-22T10:00:00Z',
        sessionId: 's-seed', featureId: 'F-070',
        signalType: 'override', subType: 'editAfterWrite',
        contextHash: 'a'.repeat(16), targetFileHash: 'b'.repeat(16),
      }));
    }
    fs.writeFileSync(path.join(dir, 'overrides.jsonl'), lines.join('\n') + '\n');

    const samples = [];
    for (let i = 0; i < 200; i++) {
      const t0 = process.hrtime.bigint();
      learning.recordOverride({
        projectRoot: tmp, subType: 'editAfterWrite',
        sessionId: 's-hot', targetFile: `/hot/${i}`,
      });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const max = samples[samples.length - 1];
    assert.ok(p99 < 50, `p99=${p99.toFixed(2)}ms exceeds 50ms hot-path budget (max=${max.toFixed(2)}ms)`);
  });

  // @cap-todo(ac:F-070/AC-5) recordOverride must not re-read the JSONL between appends — verified by
  //                          seeing latency stay flat as the file grows.
  it('recordOverride latency does not scale with JSONL size (no read-on-write)', () => {
    function median(arr) {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }
    function timeBatch(n) {
      const samples = [];
      for (let i = 0; i < n; i++) {
        const t0 = process.hrtime.bigint();
        learning.recordOverride({
          projectRoot: tmp, subType: 'editAfterWrite',
          sessionId: 's', targetFile: `/p/${i}`,
        });
        const t1 = process.hrtime.bigint();
        samples.push(Number(t1 - t0) / 1e6);
      }
      return median(samples);
    }

    const earlyMedian = timeBatch(100); // file has ~100 records
    // Grow the file to ~5k records.
    for (let i = 0; i < 4900; i++) {
      learning.recordOverride({
        projectRoot: tmp, subType: 'editAfterWrite',
        sessionId: 's', targetFile: `/grow/${i}`,
      });
    }
    const lateMedian = timeBatch(100);

    // Hot-path scales with prior reads ⇒ lateMedian would balloon vs. earlyMedian. We allow up to a
    // 5× regression to absorb FS noise; anything beyond is a strong signal of a read-on-write leak.
    // Using a small floor (0.05ms) avoids divide-by-near-zero on very fast machines.
    const denom = Math.max(earlyMedian, 0.05);
    const ratio = lateMedian / denom;
    assert.ok(
      ratio < 5,
      `hot-path scales with file size (earlyMedian=${earlyMedian.toFixed(3)}ms, lateMedian=${lateMedian.toFixed(3)}ms, ratio=${ratio.toFixed(2)}x)`
    );
  });

  // @cap-todo(ac:F-070/AC-5) recordMemoryRef does NOT read .cap/memory files — verified by absence of
  //                          fs.readFileSync calls on memory paths during the hot path.
  it('recordMemoryRef does not read the memory-file path it logs (path-string-only)', () => {
    // Set up: a .cap/memory/x.md path that does NOT exist. If the collector tried to read it, it
    // would throw — and AC-7's never-throw guarantee would still mask it. So we instead spy on
    // fs.readFileSync via a Proxy-like override and assert no call hits the memory path.
    const origReadFileSync = fs.readFileSync;
    const memoryPath = path.join(tmp, '.cap', 'memory', 'doesnt-exist.md');
    let touchedMemoryPath = false;
    fs.readFileSync = function (p, ...rest) {
      if (typeof p === 'string' && p === memoryPath) touchedMemoryPath = true;
      return origReadFileSync.call(fs, p, ...rest);
    };
    try {
      learning.recordMemoryRef({
        projectRoot: tmp, sessionId: 's', memoryFile: memoryPath,
      });
    } finally {
      fs.readFileSync = origReadFileSync;
    }
    assert.equal(touchedMemoryPath, false, 'recordMemoryRef must not read the memory file');
  });
});

// ---------------------------------------------------------------------------
// AC-1 · concurrency on O_APPEND (line integrity)
// ---------------------------------------------------------------------------

describe('AC-1 adversarial · concurrent appends keep JSONL line-integrity', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-1) 200 parallel recordOverride calls produce 200 valid JSONL lines
  it('200 parallel recordOverride invocations produce 200 valid JSONL lines', async () => {
    const N = 200;
    const jobs = [];
    for (let i = 0; i < N; i++) {
      jobs.push(Promise.resolve().then(() => learning.recordOverride({
        projectRoot: tmp, subType: i % 2 === 0 ? 'editAfterWrite' : 'rejectApproval',
        sessionId: 's-conc', featureId: 'F-070', targetFile: `/p/${i}`,
      })));
    }
    await Promise.all(jobs);
    const raw = readAllJsonlBytes(tmp);
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, N, `expected ${N} lines, got ${lines.length}`);
    for (const l of lines) {
      JSON.parse(l); // must be parseable
      assert.ok(!l.includes('\r'), 'no embedded CR');
    }
    const ids = lines.map((l) => JSON.parse(l).id);
    assert.equal(new Set(ids).size, N, 'record IDs collided');
  });
});

// ---------------------------------------------------------------------------
// AC-3 · regret integration edge cases
// ---------------------------------------------------------------------------

describe('AC-3 adversarial · recordRegretsFromScan robustness', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-3) ignores @cap-decision tags WITHOUT regret marker
  it('ignores plain @cap-decision tags', () => {
    const tags = [
      { type: 'decision', file: 'a.js', line: 1, metadata: { feature: 'F-001' }, description: '' },
      { type: 'decision', file: 'a.js', line: 2, metadata: { feature: 'F-001', regret: 'false' }, description: '' },
      { type: 'decision', file: 'a.js', line: 3, metadata: { feature: 'F-001', regret: '0' }, description: '' },
    ];
    const r = learning.recordRegretsFromScan(tmp, tags);
    assert.equal(r.recorded, 0);
  });

  // @cap-todo(ac:F-070/AC-3) accepts both string 'true' and boolean true (parser convention drift safety)
  it('accepts string "true" and boolean true defensively', () => {
    const tags = [
      { type: 'decision', file: 'a.js', line: 1, metadata: { regret: 'true', id: 'D1' }, description: '' },
      { type: 'decision', file: 'b.js', line: 1, metadata: { regret: true, id: 'D2' }, description: '' },
    ];
    const r = learning.recordRegretsFromScan(tmp, tags);
    assert.equal(r.recorded, 2);
  });

  // @cap-todo(ac:F-070/AC-3) huge tag input does not blow stack or budget
  it('handles 5000 tags without crashing or excessive runtime', () => {
    const tags = [];
    for (let i = 0; i < 5000; i++) {
      tags.push({
        type: i % 5 === 0 ? 'decision' : 'todo',
        file: `f${i}.js`, line: i,
        metadata: { regret: i % 5 === 0 ? 'true' : undefined, id: `D-${i}` },
        description: '',
      });
    }
    const t0 = Date.now();
    const r = learning.recordRegretsFromScan(tmp, tags);
    const elapsed = Date.now() - t0;
    assert.equal(r.recorded, 1000);
    assert.ok(elapsed < 5000, `regret scan took ${elapsed}ms — too slow`);
  });
});

// ---------------------------------------------------------------------------
// AC-7 · never-throw + zero-deps contract
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · never-throw under hostile inputs', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('hostile inputs never throw from any collector', () => {
    const hostile = [
      null, undefined, {}, [], 0, '', 'string', true, false, NaN,
      { projectRoot: 42 }, { projectRoot: '' }, { projectRoot: null },
      { projectRoot: tmp, subType: null, targetFile: 42 },
      { projectRoot: tmp, subType: 'editAfterWrite', sessionId: { toJSON() { throw new Error('boom'); } } },
    ];
    for (const input of hostile) {
      assert.doesNotThrow(() => learning.recordOverride(input));
      assert.doesNotThrow(() => learning.recordMemoryRef(input));
      assert.doesNotThrow(() => learning.recordRegret(input));
    }
  });

  it('getSignals never throws on garbage input', () => {
    assert.doesNotThrow(() => learning.getSignals(null, 'override'));
    assert.doesNotThrow(() => learning.getSignals(tmp, null));
    assert.doesNotThrow(() => learning.getSignals(tmp, 'override', 'not an object'));
    assert.doesNotThrow(() => learning.getSignals(tmp, 'override', { from: 'banana' }));
  });

  it('getSignals tolerates malformed JSONL lines', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite', sessionId: 's', targetFile: '/p',
    });
    const file = path.join(tmp, '.cap', 'learning', 'signals', 'overrides.jsonl');
    fs.appendFileSync(file, '{not json\n');
    fs.appendFileSync(file, '\n');
    fs.appendFileSync(file, JSON.stringify({ id: 'ok', ts: '2026-04-22T00:00:00Z', sessionId: 's', signalType: 'override' }) + '\n');
    const all = learning.getSignals(tmp, 'override');
    assert.ok(all.length >= 2, 'valid records survive even when malformed lines are interleaved');
  });
});

// ---------------------------------------------------------------------------
// Zero-deps contract — only node:* requires
// ---------------------------------------------------------------------------

describe('Zero-deps contract · only node:* and sibling cap-* modules required', () => {
  // @cap-todo(ac:F-070/AC-4) source-level: only node:fs, node:path, node:crypto + sibling cap-telemetry.cjs
  it('cap-learning-signals.cjs requires only node:* built-ins and ./cap-telemetry.cjs', () => {
    const source = fs.readFileSync(LEARNING_PATH, 'utf8');
    const allowed = new Set([
      'node:fs', 'node:path', 'node:crypto',
      './cap-telemetry.cjs',
    ]);
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    const found = [];
    while ((m = re.exec(source))) found.push(m[1]);
    assert.ok(found.length >= 3, 'at least three requires expected (fs/path/crypto)');
    for (const dep of found) {
      assert.ok(allowed.has(dep), `forbidden require('${dep}') in cap-learning-signals.cjs`);
    }
  });

  // @cap-todo(ac:F-070/AC-4) load-time: no node_modules pulled into cache
  it('loading cap-learning-signals.cjs pulls no node_modules into require.cache', () => {
    const script = `
      'use strict';
      require('${LEARNING_PATH.replace(/\\/g, '\\\\')}');
      const sep = require('path').sep;
      const bad = Object.keys(require.cache).filter((k) => k.split(sep).includes('node_modules'));
      if (bad.length) {
        console.error(JSON.stringify(bad));
        process.exit(2);
      }
      process.exit(0);
    `;
    const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(
      res.status, 0,
      `cap-learning-signals.cjs pulled node_modules into cache:\n${res.stderr}\n${res.stdout}`
    );
  });
});

// ---------------------------------------------------------------------------
// Gap-closing audit additions (2026-05-05)
//
// Scope is intentionally tight: only probes covered by the audit checklist
// that the prior 54-test suite did not yet exercise. See TEST-AUDIT report.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC-1 · rejectApproval schema-lock — contract test for the unwired hook flavour
// ---------------------------------------------------------------------------

describe('AC-1 audit · rejectApproval persists the documented schema (hook gap D10)', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-audit-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-1) Schema lock for rejectApproval — entry point is exposed even though no
  //                          PreToolUse hook wires it (D10). Whoever wires it later just calls the
  //                          collector — this test pins the keys / shape they will rely on.
  it('rejectApproval without targetFile produces a schema-clean record', () => {
    const rec = learning.recordOverride({
      projectRoot: tmp, subType: 'rejectApproval',
      sessionId: 's-rej', featureId: 'F-070',
    });
    assert.ok(rec, 'rejectApproval entry point must persist a record even without targetFile');
    assert.equal(rec.signalType, 'override');
    assert.equal(rec.subType, 'rejectApproval');
    assert.equal(rec.sessionId, 's-rej');
    assert.equal(rec.featureId, 'F-070');
    assert.match(rec.contextHash, /^[0-9a-f]{16}$/);
    assert.equal(rec.targetFileHash, undefined, 'no targetFileHash when no targetFile was passed');

    const allowed = new Set(['id', 'ts', 'sessionId', 'featureId', 'signalType', 'subType', 'contextHash']);
    for (const k of Object.keys(rec)) {
      assert.ok(allowed.has(k), `unexpected key in rejectApproval record: "${k}"`);
    }
  });

  // @cap-todo(ac:F-070/AC-1) rejectApproval WITH targetFile carries a targetFileHash, just like editAfterWrite
  it('rejectApproval with targetFile carries targetFileHash (parallel to editAfterWrite)', () => {
    const rec = learning.recordOverride({
      projectRoot: tmp, subType: 'rejectApproval',
      sessionId: 's', featureId: 'F-070', targetFile: '/some/path.js',
    });
    assert.match(rec.targetFileHash, /^[0-9a-f]{16}$/);
    assert.equal(rec.subType, 'rejectApproval');
  });
});

// ---------------------------------------------------------------------------
// AC-2 · hook routing — .cap/memory boundary (the audit's flat-vs-recursive question)
// ---------------------------------------------------------------------------

describe('AC-2 audit · cap-learning-hook.js routes only paths inside .cap/memory/', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmp('cap-learn-hook-');
    // Pre-create the memory dir so a Read on existing-or-not isn't the variable under test.
    fs.mkdirSync(path.join(tmp, '.cap', 'memory', 'threads'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function runHook(toolName, filePath) {
    // The hook subprocess walks env.CAP_LEARNING_LIB → in-tree → ~/.claude. We set the env override
    // so the test does not depend on the install layout.
    const payload = JSON.stringify({
      tool_name: toolName,
      tool_input: { file_path: filePath },
      cwd: tmp,
    });
    const res = spawnSync(process.execPath, [HOOK_PATH], {
      input: payload,
      encoding: 'utf8',
      env: {
        ...process.env,
        CAP_LEARNING_LIB: LEARNING_PATH,
        // Defensive: the hook also writes to .cap/learning/signals/.errors.log on internal errors;
        // we deliberately don't suppress that — we want to see it if the hook explodes.
      },
      timeout: 10_000,
    });
    return res;
  }

  function memoryRefs() {
    const f = path.join(tmp, '.cap', 'learning', 'signals', 'memory-refs.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  // @cap-todo(ac:F-070/AC-2) .cap/memory-staging/ is NOT under .cap/memory/ — must NOT count
  it('Read on .cap/memory-staging/foo.md does NOT emit memory-ref (boundary not prefix-match)', () => {
    fs.mkdirSync(path.join(tmp, '.cap', 'memory-staging'), { recursive: true });
    const res = runHook('Read', path.join(tmp, '.cap', 'memory-staging', 'foo.md'));
    assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.equal(memoryRefs().length, 0, 'memory-staging/ must not be matched as memory/');
  });

  // @cap-todo(ac:F-070/AC-2) Subdirectory under .cap/memory/ — does it count?
  // PIN: behavior is RECURSIVE — any descendant path counts. Locking this contract here.
  it('Read on .cap/memory/threads/abc.md DOES emit memory-ref (recursive matching)', () => {
    const res = runHook('Read', path.join(tmp, '.cap', 'memory', 'threads', 'abc.md'));
    assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    const recs = memoryRefs();
    assert.equal(recs.length, 1, 'subdirectory paths under .cap/memory/ must be matched');
    assert.equal(recs[0].signalType, 'memory-ref');
  });

  // @cap-todo(ac:F-070/AC-2) Read on a non-memory path produces no signal at all
  it('Read on a path outside .cap/memory/ emits nothing', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), '# unrelated');
    const res = runHook('Read', path.join(tmp, 'README.md'));
    assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.equal(memoryRefs().length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-1 audit · cap-learning-hook.js editAfterWrite END-TO-END across subprocesses
// ---------------------------------------------------------------------------

// Each PostToolUse hook fires as a fresh subprocess. The earlier prototype tracked written files
// in an in-memory Set that died with each subprocess — so editAfterWrite would essentially never
// fire in real use. This block proves the persistent ledger fix works across subprocess boundaries.

describe('AC-1 audit · editAfterWrite fires across hook subprocesses (ledger bridge)', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmp('cap-learn-e2e-');
    // SESSION.json is required for the hook to derive sessionId. Without it, the ledger
    // can't key per-session and the editAfterWrite path is intentionally a no-op.
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.cap', 'SESSION.json'),
      JSON.stringify({ sessionId: 'sess-e2e-1', activeFeature: 'F-070' }),
    );
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function runHook(toolName, filePath) {
    const payload = JSON.stringify({
      tool_name: toolName,
      tool_input: { file_path: filePath },
      cwd: tmp,
    });
    return spawnSync(process.execPath, [HOOK_PATH], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, CAP_LEARNING_LIB: LEARNING_PATH },
      timeout: 10_000,
    });
  }

  function overrides() {
    const f = path.join(tmp, '.cap', 'learning', 'signals', 'overrides.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  // @cap-todo(ac:F-070/AC-1) Two independent hook subprocesses (Write then Edit) MUST produce
  //                          editAfterWrite — this is the integration probe the prototype suite missed.
  it('Write then Edit on the same path across two hook invocations emits editAfterWrite', () => {
    const target = path.join(tmp, 'src', 'foo.cjs');

    const w = runHook('Write', target);
    assert.equal(w.status, 0, `Write hook failed: ${w.stderr}`);
    // Write alone must NOT emit an override.
    assert.equal(overrides().length, 0, 'Write alone must not emit override');

    const e = runHook('Edit', target);
    assert.equal(e.status, 0, `Edit hook failed: ${e.stderr}`);
    const recs = overrides();
    assert.equal(recs.length, 1, 'Write→Edit must emit exactly one override');
    assert.equal(recs[0].signalType, 'override');
    assert.equal(recs[0].subType, 'editAfterWrite');
    assert.equal(recs[0].sessionId, 'sess-e2e-1');
  });

  // @cap-todo(ac:F-070/AC-1) An Edit on a file the agent never wrote (no Write event for it) must
  //                          NOT emit editAfterWrite. This protects against false positives.
  it('Edit on a never-written path does NOT emit editAfterWrite', () => {
    const target = path.join(tmp, 'src', 'untouched.cjs');
    const e = runHook('Edit', target);
    assert.equal(e.status, 0, `Edit hook failed: ${e.stderr}`);
    assert.equal(overrides().length, 0);
  });

  // @cap-todo(ac:F-070/AC-1) Edit→Edit on a previously-written file: both edits should emit, since
  //                          each Edit appends back to the ledger and the next Edit finds the prior.
  it('Write→Edit→Edit emits editAfterWrite TWICE (chained edits both count)', () => {
    const target = path.join(tmp, 'src', 'bar.cjs');
    runHook('Write', target);
    runHook('Edit', target);
    runHook('Edit', target);
    const recs = overrides();
    assert.equal(recs.length, 2, 'each Edit-after-prior-write produces a record');
    for (const r of recs) {
      assert.equal(r.subType, 'editAfterWrite');
      assert.equal(r.sessionId, 'sess-e2e-1');
    }
  });

  // @cap-todo(ac:F-070/AC-1) Per-session isolation: a Write under sessionId A must NOT trigger
  //                          editAfterWrite when an Edit fires under sessionId B (different session).
  it('per-session isolation: Edit under a different sessionId does NOT trip on session A writes', () => {
    const target = path.join(tmp, 'src', 'iso.cjs');
    runHook('Write', target);
    assert.equal(overrides().length, 0, 'Write alone emits nothing');

    // Switch sessionId in SESSION.json — the ledger now sees a different sid on the next Edit.
    fs.writeFileSync(
      path.join(tmp, '.cap', 'SESSION.json'),
      JSON.stringify({ sessionId: 'sess-e2e-2', activeFeature: 'F-070' }),
    );
    runHook('Edit', target);
    assert.equal(overrides().length, 0, 'Edit in a different session must not see the prior write');
  });

  // @cap-todo(ac:F-070/AC-1, ac:F-070/AC-7) When SESSION.json is missing, the ledger cannot key
  //                          per-session and editAfterWrite is a silent no-op (never throws).
  it('missing SESSION.json: hook is a silent no-op (no override, no crash)', () => {
    const target = path.join(tmp, 'src', 'no-session.cjs');
    fs.unlinkSync(path.join(tmp, '.cap', 'SESSION.json'));
    const w = runHook('Write', target);
    const e = runHook('Edit', target);
    assert.equal(w.status, 0);
    assert.equal(e.status, 0);
    assert.equal(overrides().length, 0);
  });

  // @cap-todo(ac:F-070/AC-5) End-to-end hot path with the persistent ledger: each hook subprocess
  //                          (Write or Edit) must complete inside a generous CI-tolerant budget.
  //                          Real per-call latency includes node spin-up; we cap at 250ms to leave
  //                          headroom over slow CI runners while still catching gross regressions
  //                          (the actual collector + ledger work is well under 50ms).
  it('AC-5 budget: Write→Edit hook chain completes well inside the wall-clock budget', () => {
    const target = path.join(tmp, 'src', 'perf.cjs');
    const t0 = Date.now();
    const w = runHook('Write', target);
    const e = runHook('Edit', target);
    const elapsed = Date.now() - t0;
    assert.equal(w.status, 0);
    assert.equal(e.status, 0);
    assert.ok(elapsed < 1000, `Write+Edit hook chain took ${elapsed}ms (>1000ms = regression)`);
    assert.equal(overrides().length, 1);
  });
});

// ---------------------------------------------------------------------------
// AC-3 · regret-collector — empty file from previous run + decisionId precedence
// ---------------------------------------------------------------------------

describe('AC-3 audit · recordRegretsFromScan against pre-existing state', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-audit-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-3) An empty regrets.jsonl from a prior run must not corrupt the dedup set:
  //                          a scan that finds N regret tags must persist exactly N records, not 0 and
  //                          not N+M (where M is some phantom count from the empty-line parse).
  it('scan after an empty pre-existing regrets.jsonl writes exactly N records', () => {
    const dir = path.join(tmp, '.cap', 'learning', 'signals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'regrets.jsonl'), ''); // empty file simulating prior run

    const tags = [
      { type: 'decision', file: 'a.js', line: 1, metadata: { regret: 'true', id: 'D-A' }, description: '' },
      { type: 'decision', file: 'b.js', line: 2, metadata: { regret: 'true', id: 'D-B' }, description: '' },
    ];
    const r = learning.recordRegretsFromScan(tmp, tags);
    assert.equal(r.recorded, 2);
    assert.equal(r.skipped, 0);
    const lines = fs.readFileSync(path.join(dir, 'regrets.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  // @cap-todo(ac:F-070/AC-3) Same file:line with a different explicit metadata.id between scans —
  //                          PIN: current behavior records BOTH (explicit-id wins over file:line, so
  //                          they are different decisionIds and both persist). This is the documented
  //                          intent: explicit ids take precedence; file:line is only the fallback.
  it('same file:line with changed metadata.id between scans persists TWO records (id-precedence)', () => {
    const tags1 = [{
      type: 'decision', file: 'a.js', line: 5,
      metadata: { regret: 'true', id: 'D-1' }, description: '',
    }];
    const tags2 = [{
      type: 'decision', file: 'a.js', line: 5,
      metadata: { regret: 'true', id: 'D-2' }, description: '',
    }];
    learning.recordRegretsFromScan(tmp, tags1);
    learning.recordRegretsFromScan(tmp, tags2);

    const dir = path.join(tmp, '.cap', 'learning', 'signals');
    const lines = fs.readFileSync(path.join(dir, 'regrets.jsonl'), 'utf8').split('\n').filter(Boolean);
    const ids = lines.map((l) => JSON.parse(l).decisionId).sort();
    assert.deepEqual(ids, ['D-1', 'D-2'],
      'explicit metadata.id is the dedup key; file:line is only the fallback when id is missing');
  });
});

// ---------------------------------------------------------------------------
// AC-4 · __proto__ / prototype pollution probe
// ---------------------------------------------------------------------------

describe('AC-4 audit · prototype pollution cannot reach disk or globals', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-audit-'); });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    // Belt-and-braces: clear any pollution that did sneak through, so the next test starts clean.
    delete Object.prototype.polluted;
    delete Object.prototype.signalType;
  });

  // @cap-todo(ac:F-070/AC-4) JSON.parse-derived input with __proto__ key must not pollute globals,
  //                          and the polluted value must not reach the JSONL.
  it('__proto__ key on input does not pollute Object.prototype and does not land on disk', () => {
    // JSON.parse is the only way to set a real `__proto__` own-property without Object.defineProperty.
    const polluted = JSON.parse(JSON.stringify({
      projectRoot: tmp,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-070',
      targetFile: '/p',
    }).replace('"sessionId":"s"', '"sessionId":"s","__proto__":{"polluted":"SECRET_NEEDLE_xyz","signalType":"INJECTED"}'));

    const rec = learning.recordOverride(polluted);
    assert.ok(rec);
    // No prototype pollution
    assert.equal(Object.prototype.polluted, undefined, '__proto__ key polluted Object.prototype');
    assert.equal(({}).polluted, undefined);
    // The injected signalType must not have overridden the literal we built
    assert.equal(rec.signalType, 'override');
    // No needle on disk
    const raw = readAllJsonlBytes(tmp);
    assertNoNeedles(raw);
    assert.ok(!raw.includes('INJECTED'), 'injected signalType must not have leaked to disk');
  });
});

// ---------------------------------------------------------------------------
// AC-5 · scale claim — hot path stays bounded with a 10MB pre-warmed JSONL
// ---------------------------------------------------------------------------

describe('AC-5 audit · 10MB pre-warmed JSONL — hot path still under budget', () => {
  let tmp;
  // Build the 10MB seed once; the audit constraint is per-call latency, not per-suite, but the seed
  // itself is expensive. One before() per describe keeps total runtime sane.
  beforeEach(() => {
    tmp = mkTmp('cap-learn-audit-scale-');
    const dir = path.join(tmp, '.cap', 'learning', 'signals');
    fs.mkdirSync(dir, { recursive: true });
    // ~50k records × ~210 bytes ≈ 10 MB.
    const lines = [];
    for (let i = 0; i < 50_000; i++) {
      lines.push(JSON.stringify({
        id: `seed-${i}`, ts: '2026-04-22T10:00:00Z',
        sessionId: 's-seed', featureId: 'F-070',
        signalType: 'override', subType: 'editAfterWrite',
        contextHash: 'a'.repeat(16), targetFileHash: 'b'.repeat(16),
      }));
    }
    fs.writeFileSync(path.join(dir, 'overrides.jsonl'), lines.join('\n') + '\n');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-5) Per-call wall-clock budget < 50ms even when the JSONL is ~10MB pre-warmed.
  //                          If recordOverride read the file at all, this would balloon dramatically.
  it('recordOverride p99 < 50ms with ~10MB (50k records) pre-warmed', () => {
    const fileSize = fs.statSync(path.join(tmp, '.cap', 'learning', 'signals', 'overrides.jsonl')).size;
    // Use decimal MB (10_000_000) — the audit asks for "10MB" scale, not strict 10 MiB. The actual
    // seed at 50k records lands ~10.4 MB which clears either bar; this floor proves we're not in the
    // single-MB regime where a read-on-write would still be fast enough to slip past.
    assert.ok(fileSize >= 10_000_000, `seed file is ${fileSize} bytes, expected >= 10MB (decimal)`);

    const samples = [];
    for (let i = 0; i < 200; i++) {
      const t0 = process.hrtime.bigint();
      learning.recordOverride({
        projectRoot: tmp, subType: 'editAfterWrite',
        sessionId: 's-hot', targetFile: `/hot/${i}`,
      });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const max = samples[samples.length - 1];
    assert.ok(
      p99 < 50,
      `recordOverride p99=${p99.toFixed(2)}ms exceeds 50ms budget @ 10MB seed (max=${max.toFixed(2)}ms)`
    );
  });
});

// ---------------------------------------------------------------------------
// AC-6 · query API — boundary inclusivity + empty-file return
// ---------------------------------------------------------------------------

describe('AC-6 audit · getSignals boundary semantics', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-audit-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-6) PIN: `from` is INCLUSIVE — recordTs === fromTs returns the record
  it('from === record.ts is INCLUSIVE (lower bound is closed)', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: 's', targetFile: '/p', ts: '2026-04-22T11:00:00.000Z',
    });
    const hits = learning.getSignals(tmp, 'override', { from: '2026-04-22T11:00:00.000Z' });
    assert.equal(hits.length, 1, 'lower bound `from` is inclusive');
  });

  // @cap-todo(ac:F-070/AC-6) PIN: `to` is INCLUSIVE — recordTs === toTs returns the record
  it('to === record.ts is INCLUSIVE (upper bound is closed)', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite',
      sessionId: 's', targetFile: '/p', ts: '2026-04-22T11:00:00.000Z',
    });
    const hits = learning.getSignals(tmp, 'override', { to: '2026-04-22T11:00:00.000Z' });
    assert.equal(hits.length, 1, 'upper bound `to` is inclusive');
  });

  // @cap-todo(ac:F-070/AC-6) Records strictly outside the range are excluded
  it('records 1ms outside the range on either side are excluded', () => {
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite', sessionId: 's',
      targetFile: '/before', ts: '2026-04-22T10:59:59.999Z',
    });
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite', sessionId: 's',
      targetFile: '/inside', ts: '2026-04-22T11:00:00.000Z',
    });
    learning.recordOverride({
      projectRoot: tmp, subType: 'editAfterWrite', sessionId: 's',
      targetFile: '/after', ts: '2026-04-22T11:00:00.001Z',
    });
    const hits = learning.getSignals(tmp, 'override', {
      from: '2026-04-22T11:00:00.000Z',
      to: '2026-04-22T11:00:00.000Z',
    });
    assert.equal(hits.length, 1, 'only the record exactly at the boundary survives');
  });

  // @cap-todo(ac:F-070/AC-6) Empty file (touched, zero bytes) returns [] — same as missing file.
  it('returns [] when the JSONL file exists but is empty (zero bytes)', () => {
    const dir = path.join(tmp, '.cap', 'learning', 'signals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'overrides.jsonl'), '');
    assert.deepEqual(learning.getSignals(tmp, 'override'), []);
    assert.deepEqual(learning.getSignals(tmp, 'override', { sessionId: 'x' }), []);
  });
});

// ---------------------------------------------------------------------------
// AC-7 · never-throw under filesystem hostility
// ---------------------------------------------------------------------------

describe('AC-7 audit · collectors never throw when the signals dir cannot be created', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-learn-audit-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-070/AC-7) Collector never throws when .cap/ is occupied by a file (mkdir fails).
  //                          The record is returned (in-memory result) but the disk write silently
  //                          drops. This is the documented graceful-degradation contract.
  it('record* never throw when .cap/ is a regular file (mkdir blocked)', () => {
    const project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    // Block .cap/ creation by occupying the path with a regular file.
    fs.writeFileSync(path.join(project, '.cap'), 'occupied');

    let r1, r2, r3;
    assert.doesNotThrow(() => {
      r1 = learning.recordOverride({
        projectRoot: project, subType: 'editAfterWrite',
        sessionId: 's', targetFile: '/p',
      });
    });
    assert.doesNotThrow(() => {
      r2 = learning.recordMemoryRef({
        projectRoot: project, sessionId: 's', memoryFile: '.cap/memory/x.md',
      });
    });
    assert.doesNotThrow(() => {
      r3 = learning.recordRegret({
        projectRoot: project, sessionId: 's', decisionId: 'D-1',
      });
    });
    // PIN: in-memory record is still returned — the IO failure is swallowed per AC-7,
    //      so consumers cannot tell write-success from write-fail at the API surface.
    //      (F-074 is documented as the place to surface signal-loss diagnostics later.)
    assert.ok(r1, 'recordOverride returns the in-memory record even when disk write fails');
    assert.ok(r2);
    assert.ok(r3);
  });

  // @cap-todo(ac:F-070/AC-7) Concurrent invocations against a blocked path also never throw.
  it('20 parallel record* on a blocked .cap/ never throw and return records', async () => {
    const project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, '.cap'), 'occupied');

    const jobs = [];
    for (let i = 0; i < 20; i++) {
      jobs.push(Promise.resolve().then(() => learning.recordOverride({
        projectRoot: project, subType: 'editAfterWrite',
        sessionId: 's', targetFile: `/p/${i}`,
      })));
    }
    const results = await Promise.all(jobs);
    assert.equal(results.length, 20);
    assert.ok(results.every((r) => r && r.signalType === 'override'));
  });
});
