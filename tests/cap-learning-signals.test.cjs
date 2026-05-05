'use strict';

// @cap-feature(feature:F-070) Baseline tests for Collect Learning Signals — AC-1..AC-7 coverage.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const learning = require('../cap/bin/lib/cap-learning-signals.cjs');
const telemetry = require('../cap/bin/lib/cap-telemetry.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-learning-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readJsonl(root, file) {
  const p = path.join(root, '.cap', 'learning', 'signals', file);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => JSON.parse(l));
}

// -----------------------------------------------------------------------------
// AC-1: Override collector — editAfterWrite + rejectApproval
// -----------------------------------------------------------------------------

describe('AC-1 — recordOverride persists override events', () => {
  // @cap-todo(ac:F-070/AC-1) editAfterWrite subType writes to overrides.jsonl
  it('persists an editAfterWrite record to overrides.jsonl', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-070',
      targetFile: '/abs/path/to/file.cjs',
    });
    assert.ok(rec, 'record should not be null');
    assert.equal(rec.signalType, 'override');
    assert.equal(rec.subType, 'editAfterWrite');
    assert.equal(rec.sessionId, 's-1');
    assert.equal(rec.featureId, 'F-070');

    const recs = readJsonl(tmpDir, 'overrides.jsonl');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].subType, 'editAfterWrite');
  });

  // @cap-todo(ac:F-070/AC-1) rejectApproval subType writes to overrides.jsonl
  it('persists a rejectApproval record to overrides.jsonl', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'rejectApproval',
      sessionId: 's-1',
      featureId: 'F-070',
    });
    assert.ok(rec);
    assert.equal(rec.subType, 'rejectApproval');
    const recs = readJsonl(tmpDir, 'overrides.jsonl');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].subType, 'rejectApproval');
  });

  it('rejects unknown subType (returns null, writes nothing)', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'somethingElse',
      sessionId: 's',
    });
    assert.equal(rec, null);
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'learning', 'signals', 'overrides.jsonl')), false);
  });

  it('appends additional records without overwriting', () => {
    for (let i = 0; i < 3; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: 's-append',
        targetFile: `/path/${i}`,
      });
    }
    const recs = readJsonl(tmpDir, 'overrides.jsonl');
    assert.equal(recs.length, 3);
  });
});

// -----------------------------------------------------------------------------
// AC-2: Memory-Reference collector
// -----------------------------------------------------------------------------

describe('AC-2 — recordMemoryRef persists memory-reference events', () => {
  // @cap-todo(ac:F-070/AC-2) Each Read of .cap/memory/*.md emits one record to memory-refs.jsonl
  it('persists a memory-ref record', () => {
    const rec = learning.recordMemoryRef({
      projectRoot: tmpDir,
      sessionId: 's-mem',
      featureId: 'F-070',
      memoryFile: '.cap/memory/decisions.md',
    });
    assert.ok(rec);
    assert.equal(rec.signalType, 'memory-ref');
    assert.equal(rec.sessionId, 's-mem');
    const recs = readJsonl(tmpDir, 'memory-refs.jsonl');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].signalType, 'memory-ref');
  });

  it('emits one record per call (per-session count is reconstructed at query time)', () => {
    for (let i = 0; i < 5; i++) {
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: 's-count',
        memoryFile: `.cap/memory/file-${i % 2}.md`,
      });
    }
    const recs = readJsonl(tmpDir, 'memory-refs.jsonl');
    assert.equal(recs.length, 5);
    const inSession = recs.filter((r) => r.sessionId === 's-count');
    assert.equal(inSession.length, 5, 'per-session count derives from filtered query');
  });

  it('rejects empty / non-string memoryFile', () => {
    assert.equal(learning.recordMemoryRef({ projectRoot: tmpDir, memoryFile: '' }), null);
    assert.equal(learning.recordMemoryRef({ projectRoot: tmpDir, memoryFile: null }), null);
    assert.equal(learning.recordMemoryRef({ projectRoot: tmpDir, memoryFile: 42 }), null);
  });
});

// -----------------------------------------------------------------------------
// AC-3: Decision-Regret collector — recordRegret + recordRegretsFromScan
// -----------------------------------------------------------------------------

describe('AC-3 — recordRegret and recordRegretsFromScan persist regret events', () => {
  // @cap-todo(ac:F-070/AC-3) recordRegret emits one record per call
  it('recordRegret persists a single record to regrets.jsonl', () => {
    const rec = learning.recordRegret({
      projectRoot: tmpDir,
      sessionId: 's-reg',
      featureId: 'F-061',
      decisionId: 'F-061/D1',
    });
    assert.ok(rec);
    assert.equal(rec.signalType, 'regret');
    assert.equal(rec.decisionId, 'F-061/D1');

    const recs = readJsonl(tmpDir, 'regrets.jsonl');
    assert.equal(recs.length, 1);
  });

  // @cap-todo(ac:F-070/AC-3) recordRegretsFromScan walks @cap-decision regret:true tags and emits per tag
  it('recordRegretsFromScan emits one record per regret-tagged decision', () => {
    const tags = [
      // Regret (true) — should be recorded
      {
        type: 'decision',
        file: 'src/a.js',
        line: 5,
        metadata: { feature: 'F-001', regret: 'true', id: 'F-001/D1' },
        description: 'D1: chose JSON over YAML',
      },
      // Regret (boolean true) — should be recorded
      {
        type: 'decision',
        file: 'src/b.js',
        line: 10,
        metadata: { feature: 'F-002', regret: true, decision: 'F-002/D3' },
        description: 'D3: chose synchronous IO',
      },
      // Decision tag without regret — should NOT be recorded
      {
        type: 'decision',
        file: 'src/c.js',
        line: 1,
        metadata: { feature: 'F-003' },
        description: 'D1: zero deps',
      },
      // Different tag type — should NOT be recorded
      {
        type: 'todo',
        file: 'src/d.js',
        line: 7,
        metadata: { ac: 'F-070/AC-3', regret: 'true' },
        description: 'todo with regret in metadata is not a decision tag',
      },
    ];
    const result = learning.recordRegretsFromScan(tmpDir, tags, { sessionId: 's-scan' });
    assert.equal(result.recorded, 2);
    assert.equal(result.skipped, 0);
    const recs = readJsonl(tmpDir, 'regrets.jsonl');
    assert.equal(recs.length, 2);
    const ids = recs.map((r) => r.decisionId).sort();
    assert.deepEqual(ids, ['F-001/D1', 'F-002/D3']);
  });

  it('recordRegretsFromScan dedups across runs (decisionId-keyed)', () => {
    const tags = [{
      type: 'decision', file: 'src/a.js', line: 5,
      metadata: { feature: 'F-001', regret: 'true', id: 'F-001/D1' },
      description: 'd',
    }];
    const r1 = learning.recordRegretsFromScan(tmpDir, tags, { sessionId: 's' });
    const r2 = learning.recordRegretsFromScan(tmpDir, tags, { sessionId: 's' });
    assert.equal(r1.recorded, 1);
    assert.equal(r2.recorded, 0);
    assert.equal(r2.skipped, 1);
    assert.equal(readJsonl(tmpDir, 'regrets.jsonl').length, 1);
  });

  it('recordRegretsFromScan synthesises decisionId from file:line when none in metadata', () => {
    const tags = [{
      type: 'decision', file: 'src/anon.js', line: 17,
      metadata: { feature: 'F-001', regret: 'true' },
      description: 'd',
    }];
    const result = learning.recordRegretsFromScan(tmpDir, tags);
    assert.equal(result.recorded, 1);
    const recs = readJsonl(tmpDir, 'regrets.jsonl');
    assert.equal(recs[0].decisionId, 'src/anon.js:17');
  });

  it('recordRegretsFromScan tolerates malformed tags without crashing', () => {
    const tags = [
      null,
      undefined,
      { type: 'decision' }, // missing metadata
      { type: 'decision', metadata: null },
      { type: 'decision', file: 'x.js', line: 1, metadata: { regret: 'true' } }, // valid
    ];
    const result = learning.recordRegretsFromScan(tmpDir, tags);
    assert.equal(result.recorded, 1);
  });

  it('recordRegretsFromScan handles non-array tags', () => {
    assert.deepEqual(learning.recordRegretsFromScan(tmpDir, null), { recorded: 0, skipped: 0 });
    assert.deepEqual(learning.recordRegretsFromScan(tmpDir, undefined), { recorded: 0, skipped: 0 });
    assert.deepEqual(learning.recordRegretsFromScan(tmpDir, []), { recorded: 0, skipped: 0 });
  });
});

// -----------------------------------------------------------------------------
// AC-4: Record schema — fixed shape, no raw text
// -----------------------------------------------------------------------------

describe('AC-4 — every record has the fixed schema shape', () => {
  // @cap-todo(ac:F-070/AC-4) Record fields: id, ts, sessionId, featureId, signalType, subType?, contextHash, ...typeSpecific
  it('OverrideRecord has id, ts, sessionId, featureId, signalType, subType, contextHash', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: 's', featureId: 'F-070', targetFile: '/abs/path',
    });
    assert.ok(rec.id);
    assert.match(rec.id, /^[a-z0-9]+-[a-f0-9]{8}$/);
    assert.ok(rec.ts);
    assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(rec.signalType, 'override');
    assert.equal(rec.subType, 'editAfterWrite');
    assert.match(rec.contextHash, /^[0-9a-f]{16}$/);
    assert.match(rec.targetFileHash, /^[0-9a-f]{16}$/);
  });

  it('MemoryRefRecord has id, ts, sessionId, featureId, signalType, contextHash', () => {
    const rec = learning.recordMemoryRef({
      projectRoot: tmpDir, sessionId: 's', featureId: 'F-070',
      memoryFile: '.cap/memory/decisions.md',
    });
    assert.ok(rec.id);
    assert.ok(rec.ts);
    assert.equal(rec.signalType, 'memory-ref');
    assert.match(rec.contextHash, /^[0-9a-f]{16}$/);
    assert.match(rec.memoryFileHash, /^[0-9a-f]{16}$/);
  });

  it('RegretRecord has id, ts, sessionId, featureId, signalType, decisionId, contextHash', () => {
    const rec = learning.recordRegret({
      projectRoot: tmpDir, sessionId: 's', featureId: 'F-001', decisionId: 'F-001/D1',
    });
    assert.ok(rec.id);
    assert.ok(rec.ts);
    assert.equal(rec.signalType, 'regret');
    assert.equal(rec.decisionId, 'F-001/D1');
    assert.match(rec.contextHash, /^[0-9a-f]{16}$/);
  });

  it('contextHash is the sha256[:16] of the structured input (matches cap-telemetry.hashContext)', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite', targetFile: '/abs/path/foo',
    });
    assert.equal(rec.contextHash, telemetry.hashContext('/abs/path/foo'));
  });

  it('long sessionId / featureId are length-capped (200 chars)', () => {
    const huge = 'x'.repeat(2000);
    const rec = learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: huge, featureId: huge, targetFile: '/p',
    });
    assert.ok(rec.sessionId.length <= 200);
    assert.ok(rec.featureId.length <= 200);
  });

  it('non-string sessionId / featureId collapse to null', () => {
    const rec = learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: { toString: () => 'evil' }, featureId: ['F-070'],
      targetFile: '/p',
    });
    assert.equal(rec.sessionId, null);
    assert.equal(rec.featureId, null);
  });
});

// -----------------------------------------------------------------------------
// AC-5: Hook overhead — collectors are sync and never read JSONL
// -----------------------------------------------------------------------------

describe('AC-5 — collectors are sync, no read in hot path', () => {
  // @cap-todo(ac:F-070/AC-5) recordOverride must complete well under 50ms even with 1k existing records
  it('recordOverride is fast (<50ms p99) even with 1000 existing records', () => {
    // Pre-seed 1000 records so the hot path is exercised against a non-trivial JSONL.
    for (let i = 0; i < 1000; i++) {
      learning.recordOverride({
        projectRoot: tmpDir, subType: 'editAfterWrite',
        sessionId: 's-pre', targetFile: `/path/${i}`,
      });
    }
    // Now measure 100 fresh appends.
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const t0 = process.hrtime.bigint();
      learning.recordOverride({
        projectRoot: tmpDir, subType: 'editAfterWrite',
        sessionId: 's-hot', targetFile: `/hot/${i}`,
      });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    assert.ok(p99 < 50, `recordOverride p99=${p99.toFixed(2)}ms exceeds 50ms budget`);
  });

  it('recordMemoryRef is fast (<50ms p99)', () => {
    for (let i = 0; i < 500; i++) {
      learning.recordMemoryRef({
        projectRoot: tmpDir, sessionId: 's', memoryFile: `.cap/memory/f-${i}.md`,
      });
    }
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const t0 = process.hrtime.bigint();
      learning.recordMemoryRef({
        projectRoot: tmpDir, sessionId: 's-hot', memoryFile: `.cap/memory/hot-${i}.md`,
      });
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    assert.ok(p99 < 50, `recordMemoryRef p99=${p99.toFixed(2)}ms exceeds 50ms budget`);
  });
});

// -----------------------------------------------------------------------------
// AC-6: getSignals query API
// -----------------------------------------------------------------------------

describe('AC-6 — getSignals(type, range) query API', () => {
  // @cap-todo(ac:F-070/AC-6) getSignals consumed by F-071/F-072
  beforeEach(() => {
    // Seed three overrides across two sessions.
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite', sessionId: 's-A',
      featureId: 'F-070', targetFile: '/a', ts: '2026-04-22T10:00:00Z',
    });
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'rejectApproval', sessionId: 's-A',
      featureId: 'F-070', targetFile: '/b', ts: '2026-04-22T11:00:00Z',
    });
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite', sessionId: 's-B',
      featureId: 'F-061', targetFile: '/c', ts: '2026-04-22T12:00:00Z',
    });
    learning.recordMemoryRef({
      projectRoot: tmpDir, sessionId: 's-A', memoryFile: '.cap/memory/d.md',
      ts: '2026-04-22T10:30:00Z',
    });
  });

  it('returns all records of a type when no range is given', () => {
    const overrides = learning.getSignals(tmpDir, 'override');
    assert.equal(overrides.length, 3);
    const refs = learning.getSignals(tmpDir, 'memory-ref');
    assert.equal(refs.length, 1);
  });

  it('filters by sessionId', () => {
    const hits = learning.getSignals(tmpDir, 'override', { sessionId: 's-A' });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.sessionId === 's-A'));
  });

  it('filters by ISO time range (inclusive)', () => {
    const hits = learning.getSignals(tmpDir, 'override', {
      from: '2026-04-22T10:30:00Z', to: '2026-04-22T11:30:00Z',
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].subType, 'rejectApproval');
  });

  it('combined sessionId + range intersects', () => {
    const hits = learning.getSignals(tmpDir, 'override', {
      sessionId: 's-A', from: '2026-04-22T11:00:00Z', to: '2026-04-22T12:00:00Z',
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sessionId, 's-A');
    assert.equal(hits[0].subType, 'rejectApproval');
  });

  it('accepts Date instances in range', () => {
    const hits = learning.getSignals(tmpDir, 'override', {
      from: new Date('2026-04-22T11:30:00Z'),
      to: new Date('2026-04-22T12:30:00Z'),
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sessionId, 's-B');
  });

  it('returns [] for unknown type', () => {
    assert.deepEqual(learning.getSignals(tmpDir, 'not-a-type'), []);
    assert.deepEqual(learning.getSignals(tmpDir, 'not-a-type', { sessionId: 's' }), []);
  });

  it('returns [] when no signal file exists', () => {
    const blank = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-learning-blank-'));
    try {
      assert.deepEqual(learning.getSignals(blank, 'override'), []);
      assert.deepEqual(learning.getSignals(blank, 'regret', { sessionId: 'x' }), []);
    } finally {
      fs.rmSync(blank, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// AC-7: Lazy-create on first append; no exceptions ever escape
// -----------------------------------------------------------------------------

describe('AC-7 — lazy-create and never-throw contract', () => {
  // @cap-todo(ac:F-070/AC-7) Collectors create directories + files on first append
  it('first recordOverride creates .cap/learning/signals/ on demand', () => {
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'learning', 'signals')), false);
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite', targetFile: '/p',
    });
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'learning', 'signals', 'overrides.jsonl')), true);
  });

  it('first recordMemoryRef creates .cap/learning/signals/ on demand', () => {
    learning.recordMemoryRef({
      projectRoot: tmpDir, memoryFile: '.cap/memory/x.md',
    });
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'learning', 'signals', 'memory-refs.jsonl')), true);
  });

  it('first recordRegret creates .cap/learning/signals/ on demand', () => {
    learning.recordRegret({
      projectRoot: tmpDir, decisionId: 'F-001/D1',
    });
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'learning', 'signals', 'regrets.jsonl')), true);
  });

  it('collector returns null on invalid input, never throws', () => {
    assert.doesNotThrow(() => learning.recordOverride(null));
    assert.doesNotThrow(() => learning.recordOverride(undefined));
    assert.doesNotThrow(() => learning.recordOverride({}));
    assert.doesNotThrow(() => learning.recordMemoryRef(null));
    assert.doesNotThrow(() => learning.recordRegret(null));

    assert.equal(learning.recordOverride(null), null);
    assert.equal(learning.recordMemoryRef(null), null);
    assert.equal(learning.recordRegret(null), null);
  });

  it('collector tolerates missing projectRoot gracefully', () => {
    assert.equal(learning.recordOverride({ subType: 'editAfterWrite' }), null);
    assert.equal(learning.recordMemoryRef({ memoryFile: 'x' }), null);
    assert.equal(learning.recordRegret({ decisionId: 'd' }), null);
  });
});

// -----------------------------------------------------------------------------
// AC-1 ledger: cross-subprocess editAfterWrite bridge
// -----------------------------------------------------------------------------

describe('AC-1 ledger — recordWriteIntoLedger / wasWrittenInSession', () => {
  // @cap-todo(ac:F-070/AC-1) Persistent ledger lazy-creates the state directory and persists one
  //                          {sessionId, targetFile, ts} per Write/Edit event.
  it('first recordWriteIntoLedger lazy-creates .cap/learning/state/ and writes one line', () => {
    const rec = learning.recordWriteIntoLedger(tmpDir, 'sess-1', '/abs/path/to/file.cjs');
    assert.ok(rec, 'returned record');
    assert.equal(rec.sessionId, 'sess-1');
    assert.equal(rec.targetFile, '/abs/path/to/file.cjs');
    assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T/);

    const fp = learning.writtenFilesLedgerPath(tmpDir);
    assert.equal(fs.existsSync(fp), true, 'ledger file created');
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).targetFile, '/abs/path/to/file.cjs');
  });

  // @cap-todo(ac:F-070/AC-1) wasWrittenInSession matches by exact (sessionId, targetFile) tuple.
  it('wasWrittenInSession returns true for a previously recorded (sessionId, targetFile) pair', () => {
    learning.recordWriteIntoLedger(tmpDir, 'sess-A', '/abs/path/foo.cjs');
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess-A', '/abs/path/foo.cjs'), true);
  });

  // @cap-todo(ac:F-070/AC-1) Different sessionId → no match (per-session isolation).
  it('wasWrittenInSession returns false when sessionId differs', () => {
    learning.recordWriteIntoLedger(tmpDir, 'sess-A', '/abs/path/foo.cjs');
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess-B', '/abs/path/foo.cjs'), false);
  });

  // @cap-todo(ac:F-070/AC-1) Different targetFile → no match.
  it('wasWrittenInSession returns false when targetFile differs', () => {
    learning.recordWriteIntoLedger(tmpDir, 'sess-A', '/abs/path/foo.cjs');
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess-A', '/abs/path/bar.cjs'), false);
  });

  // @cap-todo(ac:F-070/AC-1) Missing ledger file → false (not an error).
  it('wasWrittenInSession returns false when ledger file does not exist', () => {
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess-A', '/abs/path/foo.cjs'), false);
  });

  // @cap-todo(ac:F-070/AC-7) Both ledger functions never throw on bad inputs.
  it('ledger helpers tolerate missing / non-string inputs gracefully', () => {
    assert.equal(learning.recordWriteIntoLedger(null, 'sess', '/p'), null);
    assert.equal(learning.recordWriteIntoLedger(tmpDir, null, '/p'), null);
    assert.equal(learning.recordWriteIntoLedger(tmpDir, 'sess', null), null);
    assert.equal(learning.recordWriteIntoLedger(tmpDir, 'sess', ''), null);

    assert.equal(learning.wasWrittenInSession(null, 'sess', '/p'), false);
    assert.equal(learning.wasWrittenInSession(tmpDir, null, '/p'), false);
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess', null), false);
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess', ''), false);

    assert.doesNotThrow(() => learning.recordWriteIntoLedger(tmpDir, 'sess', '/p'));
    assert.doesNotThrow(() => learning.wasWrittenInSession(tmpDir, 'sess', '/p'));
  });

  // @cap-todo(ac:F-070/AC-1) Multiple writes in the same session append, do not overwrite.
  it('multiple recordWriteIntoLedger calls append (no overwrite)', () => {
    learning.recordWriteIntoLedger(tmpDir, 'sess', '/p/a.cjs');
    learning.recordWriteIntoLedger(tmpDir, 'sess', '/p/b.cjs');
    learning.recordWriteIntoLedger(tmpDir, 'sess', '/p/c.cjs');

    const fp = learning.writtenFilesLedgerPath(tmpDir);
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 3);

    // All three are findable by wasWrittenInSession.
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess', '/p/a.cjs'), true);
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess', '/p/b.cjs'), true);
    assert.equal(learning.wasWrittenInSession(tmpDir, 'sess', '/p/c.cjs'), true);
  });

  // @cap-todo(ac:F-070/AC-1) sessionId / targetFile are length-capped before persistence.
  it('ledger applies ID_MAX cap to sessionId and PATH_MAX cap to targetFile', () => {
    const longSession = 'X'.repeat(500);
    const longPath = '/p/' + 'Y'.repeat(2000);
    const rec = learning.recordWriteIntoLedger(tmpDir, longSession, longPath);
    assert.equal(rec.sessionId.length, 200, 'sessionId capped to ID_MAX (200)');
    assert.ok(rec.targetFile.length <= 1024, 'targetFile capped to PATH_MAX (1024)');
  });
});
