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
