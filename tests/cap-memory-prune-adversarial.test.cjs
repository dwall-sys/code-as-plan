'use strict';

// @cap-feature(feature:F-056) Adversarial edge-case tests for memory prune.
// Not replacements for the main suite — these pin behaviour at the edges
// (invalid inputs, boundary values, filesystem anomalies, atomicity).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const prune = require('../cap/bin/lib/cap-memory-prune.cjs');
const {
  daysBetween,
  computeDecay,
  shouldArchive,
  classifyEntries,
  selectStaleRawLogs,
  formatReport,
  formatPruneLogEntry,
  formatArchivedEntry,
  writeArchive,
} = prune;

const confidence = require('../cap/bin/lib/cap-memory-confidence.cjs');
const {
  readMemoryFile,
  writeMemoryDirectory,
  MEMORY_DIR,
} = require('../cap/bin/lib/cap-memory-dir.cjs');

// --- Helpers ---

function daysAgo(now, d) {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
}

function daysAhead(now, d) {
  return new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
}

function makeEntry(overrides = {}) {
  return {
    category: 'decision',
    file: '/src/a.js',
    content: overrides.content || 'Adversarial decision',
    metadata: {
      source: '2026-04-01T10:00:00Z',
      relatedFiles: ['/src/a.js'],
      features: [],
      pinned: false,
      confidence: 0.7,
      evidence_count: 2,
      last_seen: '2026-04-01T10:00:00Z',
      ...(overrides.metadata || {}),
    },
  };
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prune-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- daysBetween: bizarre inputs ----------

describe('daysBetween: weird inputs', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('returns Infinity for empty string', () => {
    assert.equal(daysBetween('', now), Infinity);
    assert.equal(daysBetween(now, ''), Infinity);
  });

  it('returns Infinity for an object that is not a Date', () => {
    assert.equal(daysBetween({}, now), Infinity);
    assert.equal(daysBetween(now, {}), Infinity);
  });

  it('returns Infinity for a Date constructed from NaN', () => {
    const bad = new Date(NaN);
    assert.equal(daysBetween(bad, now), Infinity);
  });

  it('returns Infinity when the ISO string is syntactically well-formed but semantically invalid', () => {
    // "2026-02-30" — February 30th does not exist. Node 20+ rejects strict ISO.
    assert.equal(daysBetween('2026-02-30T00:00:00.000Z', now), Infinity);
  });

  it('returns Infinity for an ISO string with an impossible month (13)', () => {
    assert.equal(daysBetween('2026-13-01T00:00:00.000Z', now), Infinity);
  });

  it('accepts future timestamps and returns a positive absolute number of days', () => {
    // Math.abs() makes future input equivalent to past input of the same magnitude.
    // Pin this so callers know: future last_seen does NOT signal "negative age".
    const future = daysAhead(now, 10);
    assert.equal(daysBetween(future, now), 10);
  });

  it('treats numeric inputs (non-Date, non-string) as invalid', () => {
    assert.equal(daysBetween(0, now), Infinity);
    assert.equal(daysBetween(Date.now(), now), Infinity);
  });
});

// ---------- computeDecay: boundary and invalid-state inputs ----------

describe('computeDecay: invalid-state confidence inputs', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('NaN confidence with fresh age: returns 0 (round2 guard) and 0 steps', () => {
    const r = computeDecay(NaN, daysAgo(now, 10), now);
    assert.equal(r.steps, 0);
    // round2(NaN) returns 0 per the defensive guard in the module.
    assert.equal(r.newConfidence, 0);
  });

  it('NaN confidence with stale age: newConfidence is 0 (max(0, NaN-x) → NaN → round2 → 0)', () => {
    const r = computeDecay(NaN, daysAgo(now, 300), now);
    assert.equal(r.newConfidence, 0);
    assert.ok(r.steps > 0);
  });

  it('negative confidence (invalid state): clamps to floor 0.0', () => {
    const r = computeDecay(-0.5, daysAgo(now, 200), now);
    assert.equal(r.newConfidence, 0);
  });

  it('confidence 1.5 (invalid state > 1.0): decay passes through unchanged when age<=90', () => {
    // Decay does NOT cap — cap is an init/bump concern, not a decay one.
    const r = computeDecay(1.5, daysAgo(now, 60), now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 1.5);
  });

  it('confidence 1.5 with 120d age: one decay step subtracts 0.05 → 1.45', () => {
    const r = computeDecay(1.5, daysAgo(now, 120), now);
    assert.equal(r.steps, 1);
    assert.equal(r.newConfidence, 1.45);
  });

  it('future last_seen (clock skew) decays as if the gap were positive', () => {
    // daysBetween uses Math.abs, so last_seen 200 days in the FUTURE
    // produces a positive age of 200. Entries marked with a future timestamp
    // are therefore NOT protected from decay — documenting this as a known edge.
    const r = computeDecay(0.7, daysAhead(now, 200), now);
    assert.ok(r.steps > 0, 'future last_seen still triggers decay via abs()');
    assert.ok(r.newConfidence < 0.7);
  });

  it('age = DECAY_START_DAYS exactly: inclusive — 0 steps', () => {
    const r = computeDecay(0.7, daysAgo(now, 90), now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 0.7);
  });

  it('age = DECAY_START_DAYS + 1: still 0 steps (partial step does not count)', () => {
    const r = computeDecay(0.7, daysAgo(now, 91), now);
    assert.equal(r.steps, 0);
  });

  it('age = DECAY_START_DAYS + 30 exactly: first step fires (floor((30)/30) = 1)', () => {
    const r = computeDecay(0.7, daysAgo(now, 120), now);
    assert.equal(r.steps, 1);
    assert.equal(r.newConfidence, 0.65);
  });

  it('age = DECAY_START_DAYS + 31: still only 1 step', () => {
    const r = computeDecay(0.7, daysAgo(now, 121), now);
    assert.equal(r.steps, 1);
  });

  it('rounding avoids 0.30000000000000004-style float drift at every step', () => {
    // 0.6 - 6*0.05 = 0.3 naively, but 0.1 in binary drifts. Test after 6 steps.
    // age = 90 + 6*30 = 270.
    const r = computeDecay(0.6, daysAgo(now, 270), now);
    assert.equal(r.steps, 6);
    assert.equal(r.newConfidence, 0.3, 'step boundary must produce clean 0.3');
  });
});

// ---------- shouldArchive: boundary fences ----------

describe('shouldArchive: boundary fences', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('confidence = 0.1999 (just below threshold), age = 200 → true', () => {
    assert.equal(shouldArchive(0.1999, daysAgo(now, 200), now), true);
  });

  it('confidence = 0.2 (exactly threshold), age = 200 → false (strict <)', () => {
    assert.equal(shouldArchive(0.2, daysAgo(now, 200), now), false);
  });

  it('confidence = 0.1, age = 180 (exactly) → false (strict >)', () => {
    assert.equal(shouldArchive(0.1, daysAgo(now, 180), now), false);
  });

  it('confidence = 0.1, age = 181 → true (just past)', () => {
    assert.equal(shouldArchive(0.1, daysAgo(now, 181), now), true);
  });

  it('confidence = 0.0 (floor), age = 1000 → true', () => {
    assert.equal(shouldArchive(0.0, daysAgo(now, 1000), now), true);
  });

  it('invalid lastSeen yields Infinity age → shouldArchive true only when confidence is low', () => {
    // Infinity > 180 is true; low-confidence entries with unreadable timestamps DO get archived.
    // This is defensible (invalid ~ very old) but pin the semantics here so a future change is conscious.
    assert.equal(shouldArchive(0.1, 'not-a-date', now), true);
    assert.equal(shouldArchive(0.25, 'not-a-date', now), false);
  });

  it('non-numeric confidence (undefined/null/string) → false', () => {
    assert.equal(shouldArchive(undefined, daysAgo(now, 300), now), false);
    assert.equal(shouldArchive(null, daysAgo(now, 300), now), false);
    assert.equal(shouldArchive('0.1', daysAgo(now, 300), now), false);
  });
});

// ---------- classifyEntries: robustness ----------

describe('classifyEntries: defensive inputs', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('entry without metadata is kept as-is (not crashed)', () => {
    const res = classifyEntries([{ category: 'decision', content: 'x' }], now);
    assert.equal(res.kept.length, 1);
    assert.equal(res.decayed.length, 0);
    assert.equal(res.archived.length, 0);
  });

  it('null / undefined entries are kept as-is (pass-through)', () => {
    const res = classifyEntries([null, undefined, makeEntry()], now);
    assert.ok(res.kept.length >= 1);
    // No throw, no archive from the null entries.
    assert.equal(res.archived.length, 0);
  });

  it('pinned entry with confidence 0.01 and 1000-day age is still kept, not archived', () => {
    const entries = [
      makeEntry({
        content: 'pinned-even-at-rock-bottom',
        metadata: { pinned: true, confidence: 0.01, last_seen: daysAgo(now, 1000).toISOString() },
      }),
    ];
    const res = classifyEntries(entries, now);
    assert.equal(res.archived.length, 0);
    assert.equal(res.decayed.length, 0);
    assert.equal(res.kept.length, 1);
    assert.equal(res.kept[0].metadata.confidence, 0.01, 'pinned confidence must not be mutated by decay');
  });

  it('entry with last_seen=invalid string gets ensureFields-migrated; if confidence low, archived', () => {
    const entries = [
      makeEntry({
        metadata: { confidence: 0.1, last_seen: 'totally-not-an-iso' },
      }),
    ];
    const res = classifyEntries(entries, now);
    // ensureFields keeps the bad string as last_seen (non-empty string passes the guard);
    // daysBetween then returns Infinity; shouldArchive yields true because 0.1<0.2 and Infinity>180.
    assert.equal(res.archived.length, 1, 'invalid last_seen + low confidence → archived');
  });

  it('entry with evidence_count=0 (invalid) gets defaulted to 1 and does not crash', () => {
    const entries = [
      makeEntry({ metadata: { evidence_count: 0, confidence: 0.9, last_seen: daysAgo(now, 5).toISOString() } }),
    ];
    const res = classifyEntries(entries, now);
    assert.equal(res.kept.length, 1);
    assert.equal(res.kept[0].metadata.evidence_count, 1);
  });
});

// ---------- selectStaleRawLogs: filesystem edges ----------

describe('selectStaleRawLogs: filesystem edges', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  function makeRawDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-raw-adv-'));
  }

  it('filename with exact 31-day age: stale (>30)', () => {
    const dir = makeRawDir();
    const name = `tag-events-${daysAgo(now, 31).toISOString().substring(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(dir, name), '', 'utf8');
    const stale = selectStaleRawLogs(dir, now);
    assert.equal(stale.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('filename with exact 30-day age: NOT stale (strict >)', () => {
    const dir = makeRawDir();
    const name = `tag-events-${daysAgo(now, 30).toISOString().substring(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(dir, name), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uppercase filename TAG-EVENTS-... is NOT matched (regex is case-sensitive)', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'TAG-EVENTS-2025-01-01.jsonl'), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('backup suffix .jsonl.bak is ignored (regex anchored at $)', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'tag-events-2025-01-01.jsonl.bak'), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('compressed variant .jsonl.gz is ignored', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'tag-events-2025-01-01.jsonl.gz'), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('invalid calendar date (Feb 30) is ignored', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'tag-events-2025-02-30.jsonl'), '', 'utf8');
    const stale = selectStaleRawLogs(dir, now);
    // Node's Date.parse may normalize; if it does, the file would be treated as stale.
    // Current module contract: invalid component → skip. Pin it.
    assert.deepEqual(stale, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('invalid month (13) is ignored', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'tag-events-2025-13-01.jsonl'), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('invalid day (00) is ignored', () => {
    const dir = makeRawDir();
    fs.writeFileSync(path.join(dir, 'tag-events-2025-01-00.jsonl'), '', 'utf8');
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('empty directory returns []', () => {
    const dir = makeRawDir();
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rawDir passed as undefined / empty string returns [] (defensive)', () => {
    assert.deepEqual(selectStaleRawLogs(undefined, now), []);
    assert.deepEqual(selectStaleRawLogs('', now), []);
  });

  it('symlink pointing at a stale file is ignored (isFile() is false)', { skip: process.platform === 'win32' }, () => {
    const dir = makeRawDir();
    const realFile = path.join(dir, 'real.jsonl');
    fs.writeFileSync(realFile, '', 'utf8');
    const linkName = `tag-events-${daysAgo(now, 40).toISOString().substring(0, 10)}.jsonl`;
    fs.symlinkSync(realFile, path.join(dir, linkName));
    // Symlink: dirent.isFile() is false, dirent.isSymbolicLink() is true → skipped.
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('respects custom maxAgeDays=0: everything older than 0 days is stale', () => {
    const dir = makeRawDir();
    const name = `tag-events-${daysAgo(now, 1).toISOString().substring(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(dir, name), '', 'utf8');
    assert.equal(selectStaleRawLogs(dir, now, 0).length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------- formatReport / formatPruneLogEntry edge cases ----------

describe('formatReport: edge content', () => {
  it('zero-everything report is human-readable and says "DRY-RUN"', () => {
    const out = formatReport({ dryRun: true, decayed: 0, archived: 0, purged: 0, rawLogFiles: [] });
    assert.ok(out.includes('DRY-RUN'));
    assert.ok(out.includes('Decayed:  0'));
    assert.ok(out.includes('Archived: 0'));
    assert.ok(out.includes('Purged:   0'));
  });

  it('large counts render without broken newlines', () => {
    const out = formatReport({ dryRun: false, decayed: 9999, archived: 5000, purged: 3000, rawLogFiles: [] });
    // No line is empty that shouldn't be; no undefined-interpolation.
    for (const line of out.split('\n')) {
      assert.ok(!line.includes('undefined'), `line leaked undefined: ${line}`);
      assert.ok(!line.includes('NaN'), `line leaked NaN: ${line}`);
    }
    assert.ok(out.includes('9999'));
  });

  it('rawLogFiles undefined does not crash', () => {
    const out = formatReport({ dryRun: true, decayed: 0, archived: 0, purged: 0 });
    assert.ok(out.includes('DRY-RUN'));
  });

  it('formatReport does not leak entry content (archived payloads are not serialized into the report)', () => {
    // Only counts, not contents, should appear. This is a privacy / usefulness pin.
    const out = formatReport({ dryRun: true, decayed: 1, archived: 1, purged: 0, rawLogFiles: [] });
    assert.ok(!out.includes('confidence'));
  });
});

describe('formatPruneLogEntry: strictness', () => {
  it('is strictly single-line JSON followed by \\n (JSONL)', () => {
    const line = formatPruneLogEntry({ dryRun: true, decayed: 1, archived: 2, purged: 3 }, new Date('2026-04-15T00:00:00Z'));
    const trimmed = line.replace(/\n$/, '');
    assert.equal(line.endsWith('\n'), true);
    assert.ok(!trimmed.includes('\n'), 'must not contain embedded newlines');
    const parsed = JSON.parse(trimmed);
    assert.equal(parsed.dryRun, true);
  });

  it('coerces non-integer counts to integer via |0', () => {
    const line = formatPruneLogEntry({ dryRun: false, decayed: 1.9, archived: 2.1, purged: 3.999 }, new Date('2026-04-15T00:00:00Z'));
    const parsed = JSON.parse(line);
    // | 0 truncates toward zero — documents the coercion.
    assert.equal(parsed.decayed, 1);
    assert.equal(parsed.archived, 2);
    assert.equal(parsed.purged, 3);
  });

  it('missing counts default to 0 via |0 (undefined|0 === 0)', () => {
    const line = formatPruneLogEntry({ dryRun: false }, new Date('2026-04-15T00:00:00Z'));
    const parsed = JSON.parse(line);
    assert.equal(parsed.decayed, 0);
    assert.equal(parsed.archived, 0);
    assert.equal(parsed.purged, 0);
  });

  it('now=undefined falls back to Date.now() — timestamp is still ISO-formatted', () => {
    const line = formatPruneLogEntry({ dryRun: true, decayed: 0, archived: 0, purged: 0 });
    const parsed = JSON.parse(line);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(parsed.timestamp), `expected ISO timestamp, got ${parsed.timestamp}`);
  });
});

// ---------- prune() end-to-end edges ----------

describe('prune() end-to-end: edge conditions', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('projectRoot without .cap/memory/ directory: dry-run returns cleanly, no files created', () => {
    // No seeding at all.
    const res = prune.prune(tmpDir, { now });
    assert.equal(res.dryRun, true);
    assert.equal(res.decayed, 0);
    assert.equal(res.archived, 0);
    assert.equal(res.purged, 0);
    assert.equal(res.errors.length, 0);
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap')), false, '.cap must not be created during dry-run');
  });

  it('dry-run does not touch raw-log files (mtime unchanged)', () => {
    const rawDir = path.join(tmpDir, '.cap', 'memory', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const name = `tag-events-${daysAgo(now, 50).toISOString().substring(0, 10)}.jsonl`;
    const fp = path.join(rawDir, name);
    fs.writeFileSync(fp, '{"x":1}\n', 'utf8');
    const mtimeBefore = fs.statSync(fp).mtimeMs;

    prune.prune(tmpDir, { now });

    assert.equal(fs.existsSync(fp), true);
    const mtimeAfter = fs.statSync(fp).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, 'dry-run must not rewrite raw logs');
  });

  it('month-boundary archiving: UTC 23:00 on Dec 31 writes to 2025-12.md; UTC 01:00 on Jan 1 writes to 2026-01.md', () => {
    // First run, end of December.
    const dec = new Date('2025-12-31T23:00:00.000Z');
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'dec archive', metadata: { confidence: 0.1, last_seen: daysAgo(dec, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now: dec, apply: true });
    const decPath = path.join(tmpDir, '.cap', 'memory', 'archive', '2025-12.md');
    assert.ok(fs.existsSync(decPath), 'December archive file should exist');

    // Second run, next hour UTC, which is January.
    const jan = new Date('2026-01-01T01:00:00.000Z');
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'jan archive', metadata: { confidence: 0.1, last_seen: daysAgo(jan, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now: jan, apply: true });
    const janPath = path.join(tmpDir, '.cap', 'memory', 'archive', '2026-01.md');
    assert.ok(fs.existsSync(janPath), 'January archive file should exist separately');

    // Each file contains only its own entry.
    const decBody = fs.readFileSync(decPath, 'utf8');
    const janBody = fs.readFileSync(janPath, 'utf8');
    assert.ok(decBody.includes('dec archive'));
    assert.ok(!decBody.includes('jan archive'));
    assert.ok(janBody.includes('jan archive'));
    assert.ok(!janBody.includes('dec archive'));
  });

  it('UTC month boundary: local-timezone drift does NOT change the archive filename', () => {
    // 2026-04-30T23:30:00.000Z is April in UTC. Archive filename uses getUTCMonth.
    // (Pinning this so a refactor to local-time doesn't silently break it.)
    const late = new Date('2026-04-30T23:30:00.000Z');
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'utc boundary', metadata: { confidence: 0.1, last_seen: daysAgo(late, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now: late, apply: true });
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive', '2026-04.md')));
  });

  it('existing prune-log.jsonl with corrupt lines is still appended to (JSONL tolerance)', () => {
    // Pre-seed a log file with non-JSON noise. Prune should not refuse to append.
    const logPath = path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, 'this is not json\nneither is this\n', 'utf8');

    prune.prune(tmpDir, { now, apply: true });

    const body = fs.readFileSync(logPath, 'utf8');
    assert.ok(body.startsWith('this is not json'), 'pre-existing bytes must be preserved');
    // Last line must be a JSON record.
    const lines = body.trim().split('\n');
    const last = lines[lines.length - 1];
    const parsed = JSON.parse(last);
    assert.equal(parsed.dryRun, false);
  });

  it('archive file pre-exists as a bare file (no header): header is NOT re-prepended, entries still appended', () => {
    // Spec: mkdir+append-or-create. If the file already exists, we skip the header block.
    // Pre-create an archive file with some content.
    const archiveDir = path.join(tmpDir, '.cap', 'memory', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, '2026-04.md');
    fs.writeFileSync(archivePath, '# Existing header\n\npre-existing entry\n', 'utf8');

    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'new archive target', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now, apply: true });

    const body = fs.readFileSync(archivePath, 'utf8');
    assert.ok(body.startsWith('# Existing header'));
    assert.ok(body.includes('pre-existing entry'));
    assert.ok(body.includes('new archive target'));
    // No duplicated "# Memory Archive:" header added to a pre-existing file.
    const autoHeaderCount = (body.match(/^# Memory Archive:/gm) || []).length;
    assert.equal(autoHeaderCount, 0, 'auto-header must not be prepended when file exists');
  });

  it('multiple archives in one run all land in the same monthly file', () => {
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'one', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
      makeEntry({ content: 'two', metadata: { confidence: 0.1, last_seen: daysAgo(now, 500).toISOString() } }),
      makeEntry({ content: 'three', metadata: { confidence: 0.1, last_seen: daysAgo(now, 600).toISOString() } }),
    ]);
    const res = prune.prune(tmpDir, { now, apply: true });
    assert.equal(res.archived, 3);
    const archivePath = path.join(tmpDir, '.cap', 'memory', 'archive', '2026-04.md');
    const body = fs.readFileSync(archivePath, 'utf8');
    assert.ok(body.includes('one'));
    assert.ok(body.includes('two'));
    assert.ok(body.includes('three'));
    // Exactly one header for the month.
    const headerCount = (body.match(/^# Memory Archive:/gm) || []).length;
    assert.equal(headerCount, 1);
  });

  it('apply=true with ONLY stale raw-logs (no decay/archive) still writes a prune-log entry', () => {
    const rawDir = path.join(tmpDir, '.cap', 'memory', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const staleName = `tag-events-${daysAgo(now, 40).toISOString().substring(0, 10)}.jsonl`;
    const stalePath = path.join(rawDir, staleName);
    fs.writeFileSync(stalePath, '', 'utf8');

    const res = prune.prune(tmpDir, { apply: true, now });
    assert.equal(res.purged, 1);
    assert.equal(res.decayed, 0);
    assert.equal(res.archived, 0);
    assert.equal(fs.existsSync(stalePath), false);

    const logPath = path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl');
    assert.ok(fs.existsSync(logPath));
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).purged, 1);
  });

  it('no archive entries → no archive directory created (dry-run or apply)', () => {
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'healthy', metadata: { confidence: 0.9, last_seen: daysAgo(now, 5).toISOString() } }),
    ]);
    prune.prune(tmpDir, { apply: true, now });
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive')), false,
      'archive dir should not be created when no entries are archived');
  });

  it('writeMemoryDirectory throwing (simulated via unwritable memory dir) short-circuits archive+purge+log', { skip: process.platform === 'win32' }, () => {
    // Seed some data, then chmod the category file to be unwritable.
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'will archive', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);
    const rawDir = path.join(tmpDir, '.cap', 'memory', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const staleName = `tag-events-${daysAgo(now, 40).toISOString().substring(0, 10)}.jsonl`;
    const staleFp = path.join(rawDir, staleName);
    fs.writeFileSync(staleFp, '', 'utf8');

    // Make the memory directory itself read-only so writeMemoryDirectory fails partway.
    const memDir = path.join(tmpDir, '.cap', 'memory');
    // Remove write perm from the memDir on the category files themselves.
    const decisionsFp = path.join(memDir, 'decisions.md');
    // The simplest way to force writeFileSync to throw: replace decisions.md with a directory.
    fs.rmSync(decisionsFp);
    fs.mkdirSync(decisionsFp);

    const res = prune.prune(tmpDir, { apply: true, now });
    // writeMemoryDirectory should fail, bail out — archive NOT written, raw log NOT purged, prune-log NOT appended.
    assert.ok(res.errors.length > 0, 'at least one error expected');
    assert.ok(res.errors.some((e) => e.stage === 'write-memory'), `expected write-memory error, got ${JSON.stringify(res.errors)}`);
    assert.equal(fs.existsSync(path.join(memDir, 'archive')), false,
      'atomicity: archive dir must NOT be created after memory-write failure');
    assert.equal(fs.existsSync(staleFp), true,
      'atomicity: stale raw log must NOT be deleted after memory-write failure');
    assert.equal(fs.existsSync(path.join(memDir, 'prune-log.jsonl')), false,
      'atomicity: prune-log must NOT be appended after memory-write failure');
  });
});

// ---------- formatArchivedEntry: defensive ----------

describe('formatArchivedEntry: defensive rendering', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('collapses embedded newlines in content (no heading fracturing on re-read)', () => {
    const entry = {
      category: 'decision',
      content: 'multi\nline\r\nmalicious ### <a id="fake"></a>injected',
      metadata: { confidence: 0.1, evidence_count: 1, last_seen: '2025-01-01T00:00:00Z', relatedFiles: [], features: [] },
    };
    const out = formatArchivedEntry(entry, now);
    const firstLine = out.split('\n')[0];
    assert.ok(firstLine.startsWith('### '));
    assert.ok(!firstLine.includes('\n'));
    assert.ok(!firstLine.includes('\r'));
  });

  it('missing relatedFiles renders as "cross-cutting"', () => {
    const entry = { category: 'decision', content: 'x', metadata: {} };
    const out = formatArchivedEntry(entry, now);
    assert.ok(out.includes('cross-cutting'));
  });

  it('missing source renders Date as "unknown"', () => {
    const entry = { category: 'decision', content: 'x', metadata: {} };
    const out = formatArchivedEntry(entry, now);
    assert.ok(out.includes('**Date:** unknown'));
  });

  it('includes "Archived At:" with the provided now timestamp', () => {
    const entry = { category: 'decision', content: 'x', metadata: {} };
    const out = formatArchivedEntry(entry, now);
    assert.ok(out.includes('**Archived At:** 2026-04-15T00:00:00.000Z'));
  });
});

// ---------- Roundtrip: last_seen survives write → prune → read ----------

describe('last_seen roundtrip via disk', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('fresh entry: write → read preserves last_seen exactly', () => {
    const ls = daysAgo(now, 10).toISOString();
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'roundtrip', metadata: { confidence: 0.9, last_seen: ls } }),
    ]);
    const { entries } = readMemoryFile(path.join(tmpDir, MEMORY_DIR, 'decisions.md'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].metadata.last_seen, ls);
  });

  it('decayed entry: write → prune(apply) → read reflects the decayed confidence AND the same last_seen', () => {
    const ls = daysAgo(now, 150).toISOString();
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'decayed-roundtrip', metadata: { confidence: 0.8, last_seen: ls } }),
    ]);
    prune.prune(tmpDir, { apply: true, now });
    const { entries } = readMemoryFile(path.join(tmpDir, MEMORY_DIR, 'decisions.md'));
    assert.equal(entries.length, 1);
    // 150-90 = 60, floor(60/30) = 2, 0.8 - 0.10 = 0.70
    assert.equal(entries[0].metadata.confidence, 0.7);
    assert.equal(entries[0].metadata.last_seen, ls, 'decay does NOT refresh last_seen');
  });

  it('dampOnContradiction does NOT refresh last_seen (documented decision)', () => {
    const original = '2026-01-01T00:00:00.000Z';
    const fields = { confidence: 0.8, evidence_count: 3, last_seen: original };
    const after = confidence.dampOnContradiction(fields, new Date('2026-04-15T00:00:00Z'));
    assert.equal(after.last_seen, original, 'contradiction must not act as reaffirmation');
  });

  it('bumpOnReObservation DOES refresh last_seen', () => {
    const original = '2026-01-01T00:00:00.000Z';
    const fields = { confidence: 0.4, evidence_count: 1, last_seen: original };
    const then = new Date('2026-04-15T00:00:00.000Z');
    const after = confidence.bumpOnReObservation(fields, then);
    assert.equal(after.last_seen, then.toISOString());
  });

  it('ensureFields lazy-migrates entries without last_seen to EPOCH_ZERO when source is also missing', () => {
    const migrated = confidence.ensureFields({ confidence: 0.5, evidence_count: 1 });
    assert.equal(migrated.last_seen, confidence.EPOCH_ZERO);
  });

  it('ensureFields preserves a non-empty last_seen string even if malformed', () => {
    // Documents current contract: we do not validate last_seen format on read.
    const migrated = confidence.ensureFields({ confidence: 0.5, last_seen: 'garbage' });
    assert.equal(migrated.last_seen, 'garbage');
  });
});

// ---------- Subcommand integration (AC-1): /cap:memory prune via child node process ----------

describe('/cap:memory prune subcommand integration (AC-1)', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('commands/cap/memory.md documents the prune subcommand and --apply flag', () => {
    const md = fs.readFileSync(
      path.join(__dirname, '..', 'commands', 'cap', 'memory.md'),
      'utf8',
    );
    assert.ok(md.includes('## Subcommand: prune'), 'prune section missing');
    assert.ok(/argument-hint:.*prune/.test(md), 'prune missing from argument-hint');
    assert.ok(md.includes('cap-memory-prune.cjs'), 'prune module not referenced');
    assert.ok(md.includes('--apply'), '--apply flag not documented');
  });

  // Inline script for spawnSync. Reads --now=<ISO> and --apply from argv so the
  // subprocess uses the test's frozen `now` instead of the wall clock — otherwise
  // the archive filename drifts with the calendar month and the test goes red on
  // the first of each month.
  const PRUNE_SCRIPT = `
    const prune = require('${path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-memory-prune.cjs').replace(/\\/g, '\\\\')}');
    const args = process.argv.slice(1);
    const applyFlag = args.includes('--apply');
    const nowArg = args.find(a => a.startsWith('--now='));
    const now = nowArg ? new Date(nowArg.slice('--now='.length)) : new Date();
    const result = prune.prune(process.cwd(), { apply: applyFlag, now });
    console.log(prune.formatReport(result));
    process.exit(result.errors && result.errors.length > 0 ? 1 : 0);
  `;

  it('spawned node -e with the prune script (no --apply): dry-run report, no files written, exit 0', () => {
    // Seed memory so dry-run has something to count.
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'cli-dry-run-target', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);

    const r = spawnSync(process.execPath, ['-e', PRUNE_SCRIPT, '--', `--now=${now.toISOString()}`], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('DRY-RUN'));
    assert.ok(r.stdout.includes('Archived: 1'));
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive')), false);
  });

  it('spawned with --apply: mutations commit and exit 0', () => {
    writeMemoryDirectory(tmpDir, [
      makeEntry({ content: 'cli-apply-target', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);
    const r = spawnSync(process.execPath, ['-e', PRUNE_SCRIPT, '--', '--apply', `--now=${now.toISOString()}`], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('APPLIED'));
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive', '2026-04.md')));
  });
});

// ---------- writeArchive direct unit tests ----------

describe('writeArchive: direct unit behaviour', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('returns null for an empty list and does not create the archive directory', () => {
    const archiveDir = path.join(tmpDir, 'archive-empty');
    const ret = writeArchive(archiveDir, [], now);
    assert.equal(ret, null);
    assert.equal(fs.existsSync(archiveDir), false);
  });

  it('creates the directory on first write and adds a header block', () => {
    const archiveDir = path.join(tmpDir, 'archive-first');
    const entry = makeEntry({ content: 'first-ever' });
    const fp = writeArchive(archiveDir, [entry], now);
    assert.ok(fs.existsSync(fp));
    const body = fs.readFileSync(fp, 'utf8');
    assert.ok(body.startsWith('# Memory Archive: 2026-04'));
    assert.ok(body.includes('first-ever'));
  });

  it('second write in the same month appends without a second header', () => {
    const archiveDir = path.join(tmpDir, 'archive-append');
    writeArchive(archiveDir, [makeEntry({ content: 'a' })], now);
    writeArchive(archiveDir, [makeEntry({ content: 'b' })], now);
    const fp = path.join(archiveDir, '2026-04.md');
    const body = fs.readFileSync(fp, 'utf8');
    const headerCount = (body.match(/^# Memory Archive:/gm) || []).length;
    assert.equal(headerCount, 1);
    assert.ok(body.includes('a'));
    assert.ok(body.includes('b'));
  });
});
