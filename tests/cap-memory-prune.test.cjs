'use strict';

// @cap-feature(feature:F-056) Unit + integration tests for memory prune.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const prune = require('../cap/bin/lib/cap-memory-prune.cjs');
const {
  daysBetween,
  computeDecay,
  shouldArchive,
  classifyEntries,
  selectStaleRawLogs,
  formatReport,
  formatPruneLogEntry,
  DECAY_START_DAYS,
  DECAY_STEP_DAYS,
  DECAY_AMOUNT,
  ARCHIVE_CONFIDENCE_THRESHOLD,
  ARCHIVE_AGE_DAYS,
  RAW_LOG_RETENTION_DAYS,
} = prune;

const { readMemoryFile, writeMemoryDirectory, MEMORY_DIR } = require('../cap/bin/lib/cap-memory-dir.cjs');

// --- Helpers ---

function daysAgo(now, d) {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
}

function makeEntry(overrides = {}) {
  return {
    category: 'decision',
    file: '/src/a.js',
    content: overrides.content || 'A decision about some architectural concern',
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prune-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Constants ---

describe('constants (AC-3/4/5 tuning)', () => {
  it('exposes documented thresholds', () => {
    assert.equal(DECAY_START_DAYS, 90);
    assert.equal(DECAY_STEP_DAYS, 30);
    assert.equal(DECAY_AMOUNT, 0.05);
    assert.equal(ARCHIVE_CONFIDENCE_THRESHOLD, 0.2);
    assert.equal(ARCHIVE_AGE_DAYS, 180);
    assert.equal(RAW_LOG_RETENTION_DAYS, 30);
  });
});

// --- daysBetween ---

describe('daysBetween', () => {
  it('returns 0 for same instant', () => {
    const t = new Date('2026-04-15T00:00:00Z');
    assert.equal(daysBetween(t, t), 0);
  });

  it('returns 1 for exactly 24 hours difference', () => {
    const a = new Date('2026-04-14T00:00:00Z');
    const b = new Date('2026-04-15T00:00:00Z');
    assert.equal(daysBetween(a, b), 1);
  });

  it('floors fractional days', () => {
    const a = new Date('2026-04-14T00:00:00Z');
    const b = new Date('2026-04-15T23:30:00Z');
    assert.equal(daysBetween(a, b), 1);
  });

  it('is order-independent (absolute diff)', () => {
    const a = new Date('2026-04-14T00:00:00Z');
    const b = new Date('2026-04-15T00:00:00Z');
    assert.equal(daysBetween(a, b), daysBetween(b, a));
  });

  it('spans decades (epoch-0 vs today) in the ~20k-day range', () => {
    const d = daysBetween('1970-01-01T00:00:00.000Z', new Date('2026-04-15T00:00:00Z'));
    assert.ok(d > 20000 && d < 22000, `expected ~20k, got ${d}`);
  });

  it('returns Infinity for invalid inputs', () => {
    assert.equal(daysBetween('not a date', new Date()), Infinity);
    assert.equal(daysBetween(null, new Date()), Infinity);
    assert.equal(daysBetween(undefined, new Date()), Infinity);
  });

  it('accepts ISO strings alongside Dates', () => {
    assert.equal(daysBetween('2026-04-14T00:00:00Z', '2026-04-20T00:00:00Z'), 6);
  });
});

// --- computeDecay (AC-3) ---

describe('computeDecay (AC-3)', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('age 0 days: zero steps, confidence unchanged', () => {
    const r = computeDecay(0.7, now, now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 0.7);
  });

  it('age 89 days: zero steps (still inside grace period)', () => {
    const r = computeDecay(0.7, daysAgo(now, 89), now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 0.7);
  });

  it('age exactly 90 days: zero steps (boundary, inclusive)', () => {
    const r = computeDecay(0.7, daysAgo(now, 90), now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 0.7);
  });

  it('age 91 days: zero steps (1 day past grace, under first 30-day step)', () => {
    const r = computeDecay(0.7, daysAgo(now, 91), now);
    assert.equal(r.steps, 0);
    assert.equal(r.newConfidence, 0.7);
  });

  it('age 119 days: zero steps (still under first full 30-day block)', () => {
    const r = computeDecay(0.7, daysAgo(now, 119), now);
    assert.equal(r.steps, 0);
  });

  it('age 120 days: 1 step, -0.05', () => {
    const r = computeDecay(0.7, daysAgo(now, 120), now);
    assert.equal(r.steps, 1);
    assert.equal(r.newConfidence, 0.65);
  });

  it('age 150 days: 2 steps, -0.10', () => {
    const r = computeDecay(0.7, daysAgo(now, 150), now);
    assert.equal(r.steps, 2);
    assert.equal(r.newConfidence, 0.6);
  });

  it('age 300 days from confidence 0.95: 7 steps, clamped above floor', () => {
    const r = computeDecay(0.95, daysAgo(now, 300), now);
    assert.equal(r.steps, 7);
    assert.equal(r.newConfidence, 0.6);
  });

  it('age 500 days: many steps, floored at 0.0 (not negative)', () => {
    const r = computeDecay(0.5, daysAgo(now, 500), now);
    assert.ok(r.steps > 10);
    assert.equal(r.newConfidence, 0);
  });

  it('invalid last_seen: treated as very old, confidence floored', () => {
    const r = computeDecay(0.5, 'invalid', now);
    assert.equal(r.newConfidence, 0);
    assert.ok(r.steps > 0);
  });

  it('rounding: produces clean two-decimal floats (no 0.30000000000000004)', () => {
    const r = computeDecay(0.35, daysAgo(now, 120), now);
    assert.equal(r.newConfidence, 0.3);
  });
});

// --- shouldArchive (AC-4) ---

describe('shouldArchive (AC-4)', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('confidence 0.25, age 200d → false (not low enough)', () => {
    assert.equal(shouldArchive(0.25, daysAgo(now, 200), now), false);
  });

  it('confidence 0.15, age 150d → false (not old enough)', () => {
    assert.equal(shouldArchive(0.15, daysAgo(now, 150), now), false);
  });

  it('confidence 0.15, age 200d → true', () => {
    assert.equal(shouldArchive(0.15, daysAgo(now, 200), now), true);
  });

  it('confidence 0.0, age 181d → true (boundary just over)', () => {
    assert.equal(shouldArchive(0.0, daysAgo(now, 181), now), true);
  });

  it('confidence 0.2 (equal to threshold), age 200d → false (strict <)', () => {
    assert.equal(shouldArchive(0.2, daysAgo(now, 200), now), false);
  });

  it('confidence 0.15, age exactly 180d → false (strict >)', () => {
    assert.equal(shouldArchive(0.15, daysAgo(now, 180), now), false);
  });

  it('NaN confidence → false', () => {
    assert.equal(shouldArchive(NaN, daysAgo(now, 200), now), false);
  });
});

// --- classifyEntries ---

describe('classifyEntries', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  it('splits a mixed list into kept / decayed / archived buckets', () => {
    const entries = [
      makeEntry({ content: 'fresh high-confidence', metadata: { confidence: 0.9, last_seen: daysAgo(now, 10).toISOString() } }),
      makeEntry({ content: 'stale mid-confidence needs decay', metadata: { confidence: 0.7, last_seen: daysAgo(now, 150).toISOString() } }),
      makeEntry({ content: 'very old low-confidence goes to archive', metadata: { confidence: 0.15, last_seen: daysAgo(now, 365).toISOString() } }),
      makeEntry({ content: 'fresh low-confidence stays', metadata: { confidence: 0.1, last_seen: daysAgo(now, 5).toISOString() } }),
      makeEntry({ content: 'old but decent confidence', metadata: { confidence: 0.8, last_seen: daysAgo(now, 200).toISOString() } }),
    ];
    const res = classifyEntries(entries, now);

    // kept: fresh high, fresh low, and decayed-but-surviving entries
    assert.ok(res.kept.some((e) => e.content === 'fresh high-confidence'));
    assert.ok(res.kept.some((e) => e.content === 'fresh low-confidence stays'));
    // decayed list contains any entry whose confidence changed
    assert.ok(res.decayed.some((d) => d.entry.content === 'stale mid-confidence needs decay'));
    assert.ok(res.archived.some((e) => e.content === 'very old low-confidence goes to archive'));
  });

  it('decay-then-archive: entry crosses the 0.2 threshold via decay and is archived in the same run', () => {
    // age 500 days => steps = (500-90)/30 = 13. 0.25 - 13*0.05 clamps to 0.0
    // 0.0 < 0.2 AND 500 > 180 → archived.
    const entries = [
      makeEntry({ content: 'decay-pushed to archive', metadata: { confidence: 0.25, last_seen: daysAgo(now, 500).toISOString() } }),
    ];
    const res = classifyEntries(entries, now);
    assert.equal(res.archived.length, 1);
    assert.equal(res.archived[0].content, 'decay-pushed to archive');
    assert.equal(res.archived[0].metadata.confidence, 0);
    assert.equal(res.decayed.length, 0, 'archived entries are not double-counted in decayed list');
  });

  it('pinned entries are never decayed nor archived', () => {
    const entries = [
      makeEntry({
        content: 'pinned ancient low-confidence stays put',
        metadata: { confidence: 0.05, pinned: true, last_seen: daysAgo(now, 900).toISOString() },
      }),
    ];
    const res = classifyEntries(entries, now);
    assert.equal(res.kept.length, 1);
    assert.equal(res.decayed.length, 0);
    assert.equal(res.archived.length, 0);
    assert.equal(res.kept[0].metadata.confidence, 0.05);
  });

  it('lazy-migrates entries without last_seen via ensureFields (fallback to source, else epoch)', () => {
    const entries = [
      { category: 'decision', content: 'legacy without last_seen but source date is fresh',
        metadata: { confidence: 0.7, evidence_count: 2, source: daysAgo(now, 10).toISOString(), relatedFiles: [], features: [], pinned: false } },
      { category: 'decision', content: 'legacy with neither last_seen nor source',
        metadata: { confidence: 0.7, evidence_count: 2, relatedFiles: [], features: [], pinned: false } },
    ];
    const res = classifyEntries(entries, now);
    // First: last_seen defaulted to source (10 days ago) → kept, no decay
    assert.ok(res.kept.some((e) => e.content.startsWith('legacy without last_seen but source')));
    // Second: defaults to epoch → "very old" → decays to 0 → archived
    assert.ok(res.archived.some((e) => e.content.startsWith('legacy with neither')));
  });

  it('handles empty list', () => {
    const res = classifyEntries([], now);
    assert.deepEqual(res.kept, []);
    assert.deepEqual(res.decayed, []);
    assert.deepEqual(res.archived, []);
  });
});

// --- selectStaleRawLogs (AC-5) ---

describe('selectStaleRawLogs (AC-5)', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  function makeRawDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-raw-'));
    for (const [name, content] of Object.entries(files)) {
      if (typeof content === 'object' && content._dir) {
        fs.mkdirSync(path.join(dir, name), { recursive: true });
      } else {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
      }
    }
    return dir;
  }

  it('returns only files older than 30 days', () => {
    const today = 'tag-events-2026-04-15.jsonl';
    const twenty = `tag-events-${daysAgo(now, 20).toISOString().substring(0, 10)}.jsonl`;
    const forty = `tag-events-${daysAgo(now, 40).toISOString().substring(0, 10)}.jsonl`;
    const dir = makeRawDir({ [today]: '', [twenty]: '', [forty]: '' });

    const stale = selectStaleRawLogs(dir, now);
    assert.equal(stale.length, 1);
    assert.ok(stale[0].endsWith(forty));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores files without the tag-events- prefix', () => {
    const dir = makeRawDir({
      'errors.log': 'some errors',
      'other-2020-01-01.jsonl': 'not ours',
      'random.txt': '',
    });
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores files with invalid date component', () => {
    const dir = makeRawDir({
      'tag-events-not-a-date.jsonl': '',
      'tag-events-2026-13-45.jsonl': '', // rejected by the filename regex (month 13 is still matched by \d{2}, but Date.parse will reject)
    });
    // Filenames like '2026-13-45' do match the regex (digits only); Date.parse returns NaN → skipped.
    const stale = selectStaleRawLogs(dir, now);
    assert.deepEqual(stale, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores subdirectories even if names match', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-raw-sub-'));
    fs.mkdirSync(path.join(dir, 'tag-events-2020-01-01.jsonl'), { recursive: true });
    assert.deepEqual(selectStaleRawLogs(dir, now), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty for nonexistent directory', () => {
    assert.deepEqual(selectStaleRawLogs(path.join(tmpDir, 'does-not-exist'), now), []);
  });

  it('respects maxAgeDays override', () => {
    const twoDaysOld = `tag-events-${daysAgo(now, 2).toISOString().substring(0, 10)}.jsonl`;
    const dir = makeRawDir({ [twoDaysOld]: '' });
    assert.equal(selectStaleRawLogs(dir, now, 1).length, 1);
    assert.equal(selectStaleRawLogs(dir, now, 5).length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// --- formatReport / formatPruneLogEntry (AC-6) ---

describe('formatReport / formatPruneLogEntry (AC-6)', () => {
  it('formatReport renders DRY-RUN banner and counts', () => {
    const out = formatReport({ dryRun: true, decayed: 3, archived: 2, purged: 1, rawLogFiles: ['/tmp/x/tag-events-2026-01-01.jsonl'] });
    assert.ok(out.includes('DRY-RUN'));
    assert.ok(out.includes('Decayed:  3'));
    assert.ok(out.includes('Archived: 2'));
    assert.ok(out.includes('Purged:   1'));
    assert.ok(out.includes('Rerun with --apply'));
    assert.ok(out.includes('tag-events-2026-01-01.jsonl'));
  });

  it('formatReport renders APPLIED banner and omits the rerun hint', () => {
    const out = formatReport({ dryRun: false, decayed: 0, archived: 0, purged: 0, rawLogFiles: [] });
    assert.ok(out.includes('APPLIED'));
    assert.ok(!out.includes('Rerun with --apply'));
  });

  it('formatPruneLogEntry emits single-line JSON with the required fields', () => {
    const now = new Date('2026-04-15T10:00:00Z');
    const line = formatPruneLogEntry({ dryRun: false, decayed: 5, archived: 2, purged: 3 }, now);
    assert.ok(line.endsWith('\n'));
    const parsed = JSON.parse(line);
    assert.equal(parsed.timestamp, '2026-04-15T10:00:00.000Z');
    assert.equal(parsed.dryRun, false);
    assert.equal(parsed.decayed, 5);
    assert.equal(parsed.archived, 2);
    assert.equal(parsed.purged, 3);
  });
});

// --- End-to-end prune() ---

describe('prune() end-to-end (AC-1, AC-2, AC-6)', () => {
  const now = new Date('2026-04-15T00:00:00Z');

  function seedMemoryDir(entries) {
    writeMemoryDirectory(tmpDir, entries);
  }

  function seedRawLog(ageDays, name) {
    const rawDir = path.join(tmpDir, '.cap', 'memory', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const filename = name || `tag-events-${daysAgo(now, ageDays).toISOString().substring(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(rawDir, filename), '{"t":"x"}\n', 'utf8');
    return path.join(rawDir, filename);
  }

  it('empty memory dir → zero everything, no files written, no crash', () => {
    const res = prune.prune(tmpDir, { now });
    assert.equal(res.dryRun, true);
    assert.equal(res.decayed, 0);
    assert.equal(res.archived, 0);
    assert.equal(res.purged, 0);
    assert.equal(res.errors.length, 0);
    // No prune-log written in dry-run
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl')), false);
  });

  it('dry-run default: computes counts without mutating disk', () => {
    seedMemoryDir([
      makeEntry({ content: 'ancient low-conf entry destined for archive', metadata: { confidence: 0.15, last_seen: daysAgo(now, 400).toISOString() } }),
      makeEntry({ content: 'stale mid-conf entry for decay only', metadata: { confidence: 0.7, last_seen: daysAgo(now, 150).toISOString() } }),
      makeEntry({ content: 'fresh entry kept as-is', metadata: { confidence: 0.9, last_seen: daysAgo(now, 5).toISOString() } }),
    ]);
    seedRawLog(40);
    seedRawLog(5);

    const res = prune.prune(tmpDir, { now });
    assert.equal(res.dryRun, true);
    assert.equal(res.decayed, 1);
    assert.equal(res.archived, 1);
    assert.equal(res.purged, 1);

    // Disk state unchanged
    const decisionsBefore = fs.readFileSync(path.join(tmpDir, MEMORY_DIR, 'decisions.md'), 'utf8');
    assert.ok(decisionsBefore.includes('ancient low-conf entry destined for archive'));
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl')), false);
    // Raw log still there
    const rawDir = path.join(tmpDir, '.cap', 'memory', 'raw');
    assert.equal(fs.readdirSync(rawDir).length, 2);
  });

  it('--apply: decay persists, archive file gets the archived entry, raw-log is deleted, prune-log appended', () => {
    seedMemoryDir([
      makeEntry({ content: 'ancient low-conf entry destined for archive', metadata: { confidence: 0.15, last_seen: daysAgo(now, 400).toISOString() } }),
      makeEntry({ content: 'stale mid-conf entry for decay only', metadata: { confidence: 0.7, last_seen: daysAgo(now, 150).toISOString() } }),
      makeEntry({ content: 'fresh entry kept as-is', metadata: { confidence: 0.9, last_seen: daysAgo(now, 5).toISOString() } }),
    ]);
    const staleLog = seedRawLog(40);
    const freshLog = seedRawLog(5);

    const res = prune.prune(tmpDir, { now, apply: true });
    assert.equal(res.dryRun, false);
    assert.equal(res.decayed, 1);
    assert.equal(res.archived, 1);
    assert.equal(res.purged, 1);
    assert.equal(res.errors.length, 0, `unexpected errors: ${JSON.stringify(res.errors)}`);

    // Decisions.md has the fresh + decayed but NOT the archived entry
    const decisionsAfter = fs.readFileSync(path.join(tmpDir, MEMORY_DIR, 'decisions.md'), 'utf8');
    assert.ok(!decisionsAfter.includes('ancient low-conf entry destined for archive'));
    assert.ok(decisionsAfter.includes('stale mid-conf entry for decay only'));
    assert.ok(decisionsAfter.includes('fresh entry kept as-is'));

    // Decayed entry has its new confidence on disk: 0.7 -> (150-90)/30 = 2 steps -> 0.60
    const { entries } = readMemoryFile(path.join(tmpDir, MEMORY_DIR, 'decisions.md'));
    const decayedOnDisk = entries.find((e) => e.content.startsWith('stale mid-conf entry for decay only'));
    assert.ok(decayedOnDisk, 'decayed entry must roundtrip back from disk');
    assert.equal(decayedOnDisk.metadata.confidence, 0.6);

    // Archive file named after archival month ('now' is 2026-04)
    const archivePath = path.join(tmpDir, '.cap', 'memory', 'archive', '2026-04.md');
    assert.ok(fs.existsSync(archivePath));
    const archiveContent = fs.readFileSync(archivePath, 'utf8');
    assert.ok(archiveContent.includes('ancient low-conf entry destined for archive'));
    assert.ok(archiveContent.includes('**Category:** decision'));
    assert.ok(archiveContent.includes('**Archived At:**'));

    // Raw logs: stale one gone, fresh one stays
    assert.equal(fs.existsSync(staleLog), false);
    assert.equal(fs.existsSync(freshLog), true);

    // prune-log.jsonl contains a single JSON line with our counts
    const pruneLog = fs.readFileSync(path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl'), 'utf8');
    const logLines = pruneLog.trim().split('\n').filter(Boolean);
    assert.equal(logLines.length, 1);
    const entry = JSON.parse(logLines[0]);
    assert.equal(entry.dryRun, false);
    assert.equal(entry.decayed, 1);
    assert.equal(entry.archived, 1);
    assert.equal(entry.purged, 1);
    assert.ok(typeof entry.timestamp === 'string' && entry.timestamp.length > 0);
  });

  it('multiple --apply runs in the same month append to the same archive file (idempotent/incremental)', () => {
    seedMemoryDir([
      makeEntry({ content: 'first archive target', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now, apply: true });

    const archivePath = path.join(tmpDir, '.cap', 'memory', 'archive', '2026-04.md');
    const firstLen = fs.readFileSync(archivePath, 'utf8').length;

    // Second run with a new archive target (writeMemoryDirectory overwrote decisions.md — feed a fresh one)
    seedMemoryDir([
      makeEntry({ content: 'second archive target later in the month', metadata: { confidence: 0.1, last_seen: daysAgo(now, 400).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now, apply: true });

    const after = fs.readFileSync(archivePath, 'utf8');
    assert.ok(after.length > firstLen, 'archive file should grow, not be overwritten');
    assert.ok(after.includes('first archive target'));
    assert.ok(after.includes('second archive target later in the month'));

    // prune-log should now have TWO lines
    const logLines = fs.readFileSync(path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(logLines.length, 2);
  });

  it('no-op --apply on empty memory dir does not create stray files', () => {
    const res = prune.prune(tmpDir, { now, apply: true });
    assert.equal(res.decayed, 0);
    assert.equal(res.archived, 0);
    assert.equal(res.purged, 0);
    assert.equal(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'archive')), false);
    // prune-log is always appended on apply — documents "we ran, found nothing"
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap', 'memory', 'prune-log.jsonl')));
  });

  it('pinned entries survive both dry-run and apply', () => {
    seedMemoryDir([
      makeEntry({
        content: 'pinned ancient truth never to be archived',
        metadata: { pinned: true, confidence: 0.05, last_seen: daysAgo(now, 900).toISOString() },
      }),
    ]);
    const res = prune.prune(tmpDir, { now, apply: true });
    assert.equal(res.archived, 0);
    assert.equal(res.decayed, 0);
    const decisionsAfter = fs.readFileSync(path.join(tmpDir, MEMORY_DIR, 'decisions.md'), 'utf8');
    assert.ok(decisionsAfter.includes('pinned ancient truth never to be archived'));
    assert.ok(decisionsAfter.includes('[pinned]'));
  });

  it('roundtrip with F-055 readMemoryFile: decayed confidence persists across a read', () => {
    seedMemoryDir([
      makeEntry({ content: 'roundtrip decay survives serialization', metadata: { confidence: 0.8, last_seen: daysAgo(now, 180).toISOString() } }),
    ]);
    prune.prune(tmpDir, { now, apply: true });
    const { entries } = readMemoryFile(path.join(tmpDir, MEMORY_DIR, 'decisions.md'));
    assert.equal(entries.length, 1);
    // 180 days age → (180-90)/30 = 3 steps → 0.8 - 0.15 = 0.65
    assert.equal(entries[0].metadata.confidence, 0.65);
    // last_seen was rewritten as the original ISO
    assert.ok(typeof entries[0].metadata.last_seen === 'string');
  });
});
