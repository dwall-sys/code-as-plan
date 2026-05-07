'use strict';

// @cap-feature(feature:F-079) Tests for cap-snapshot-linkage.cjs — happy-path coverage for
//   AC-1 (activeFeature default), AC-2 (--unassigned, --platform), AC-3 (soft-warn paths),
//   AC-4 (linked_snapshots block + idempotent pipeline), AC-5 (date heuristic),
//   AC-6 (snapshots-unassigned fallback).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const linkage = require('../cap/bin/lib/cap-snapshot-linkage.cjs');
const session = require('../cap/bin/lib/cap-session.cjs');
const platformLib = require('../cap/bin/lib/cap-memory-platform.cjs');
const schema = require('../cap/bin/lib/cap-memory-schema.cjs');

// -------- Test sandbox --------

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-snapshot-linkage-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'root-'));
  fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
  fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
  return root;
}

function writeSnapshot(root, name, frontmatter, body) {
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(frontmatter || {})) {
    fmLines.push(`${k}: ${v}`);
  }
  fmLines.push('---');
  const content = `${fmLines.join('\n')}\n\n# ${body || name}\n\nbody.\n`;
  fs.writeFileSync(path.join(root, '.cap', 'snapshots', `${name}.md`), content, 'utf8');
}

// -------- AC-1: activeFeature default --------

describe('AC-1: cap:save defaults to activeFeature from SESSION.json', () => {
  it('resolveLinkageOptions returns the activeFeature from SESSION.json', () => {
    const root = makeRoot();
    session.saveSession(root, { ...session.getDefaultSession(), activeFeature: 'F-079' });
    const r = linkage.resolveLinkageOptions(root, {});
    assert.equal(r.kind, 'feature');
    assert.equal(r.featureId, 'F-079');
    assert.equal(r.warning, null);
    assert.deepEqual(r.frontmatterPatch, { feature: 'F-079' });
  });

  it('injectLinkageFrontmatter adds feature: line into existing frontmatter', () => {
    const body = `---\nsession: abc\ndate: 2026-05-07T00:00:00Z\nbranch: main\nsource: cap:save\n---\n\n# Snap\n\nbody.\n`;
    const out = linkage.injectLinkageFrontmatter(body, { feature: 'F-079' });
    assert.match(out, /^---\n/);
    assert.match(out, /^feature: F-079$/m);
    assert.match(out, /^session: abc$/m);
    assert.match(out, /# Snap/);
  });
});

// -------- AC-2: --unassigned and --platform=<topic> --------

describe('AC-2: --unassigned and --platform=<topic>', () => {
  it('--unassigned returns kind:unassigned with empty frontmatterPatch', () => {
    const root = makeRoot();
    session.saveSession(root, { ...session.getDefaultSession(), activeFeature: 'F-079' });
    const r = linkage.resolveLinkageOptions(root, { unassigned: true });
    assert.equal(r.kind, 'unassigned');
    assert.equal(r.featureId, null);
    assert.deepEqual(r.frontmatterPatch, {});
    assert.match(r.warning, /unassigned/);
  });

  it('--platform=<topic> returns kind:platform with platform frontmatterPatch', () => {
    const root = makeRoot();
    const r = linkage.resolveLinkageOptions(root, { platform: 'observability' });
    assert.equal(r.kind, 'platform');
    assert.equal(r.topic, 'observability');
    assert.equal(r.warning, null);
    assert.deepEqual(r.frontmatterPatch, { platform: 'observability' });
  });

  it('injectLinkageFrontmatter writes platform: when patch.platform is set', () => {
    const body = `---\nsession: x\n---\n\n# Snap\n`;
    const out = linkage.injectLinkageFrontmatter(body, { platform: 'observability' });
    assert.match(out, /^platform: observability$/m);
    assert.doesNotMatch(out, /^feature:/m);
  });
});

// -------- AC-4: linked_snapshots block --------

describe('AC-4: linked_snapshots block (parse/render/upsert)', () => {
  it('renderLinkedSnapshotsBlock sorts by date asc then name asc', () => {
    const out = linkage.renderLinkedSnapshotsBlock([
      { name: 'b-snap', date: '2026-05-06', branch: 'main' },
      { name: 'a-snap', date: '2026-05-07', branch: 'main' },
      { name: 'c-snap', date: '2026-05-06', branch: 'feature/x' },
    ]);
    const lines = out.split('\n');
    const idxB = lines.findIndex((l) => l.includes('b-snap'));
    const idxC = lines.findIndex((l) => l.includes('c-snap'));
    const idxA = lines.findIndex((l) => l.includes('a-snap'));
    assert.ok(idxB < idxC, 'b-snap (2026-05-06) before c-snap (2026-05-06) by name asc');
    assert.ok(idxC < idxA, 'c-snap (2026-05-06) before a-snap (2026-05-07) by date asc');
  });

  it('renderLinkedSnapshotsBlock is byte-identical on re-render', () => {
    const entries = [
      { name: 'snap1', date: '2026-05-06', branch: 'main' },
      { name: 'snap2', date: '2026-05-07', branch: 'main' },
    ];
    const a = linkage.renderLinkedSnapshotsBlock(entries);
    const b = linkage.renderLinkedSnapshotsBlock(entries.slice().reverse());
    assert.equal(a, b, 'sort order makes the result independent of input order');
  });

  it('upsertLinkedSnapshotsBlock inserts after F-076 auto-block when present', () => {
    const original = [
      '---',
      'feature: F-079',
      'topic: foo',
      'updated: 2026-05-07T00:00:00Z',
      '---',
      '',
      '# F-079: Foo',
      '',
      schema.AUTO_BLOCK_START_MARKER,
      schema.AUTO_BLOCK_END_MARKER,
      '',
      '## Lessons',
      '',
      'manual content.',
      '',
    ].join('\n');
    const out = linkage.upsertLinkedSnapshotsBlock(original, [
      { name: 'snap1', date: '2026-05-06', branch: 'main' },
    ]);
    const block = linkage.parseLinkedSnapshotsBlock(out);
    assert.ok(block);
    assert.equal(block.entries.length, 1);
    assert.equal(block.entries[0].name, 'snap1');
    // Auto-block markers untouched.
    assert.match(out, new RegExp(schema.AUTO_BLOCK_START_MARKER));
    assert.match(out, new RegExp(schema.AUTO_BLOCK_END_MARKER));
    // Manual content preserved.
    assert.match(out, /manual content\./);
  });

  it('upsertLinkedSnapshotsBlock is idempotent on re-run (byte-identical)', () => {
    const original = [
      '---',
      'feature: F-079',
      'topic: foo',
      'updated: 2026-05-07T00:00:00Z',
      '---',
      '',
      schema.AUTO_BLOCK_START_MARKER,
      schema.AUTO_BLOCK_END_MARKER,
      '',
    ].join('\n');
    const entries = [{ name: 'snap1', date: '2026-05-06', branch: 'main' }];
    const first = linkage.upsertLinkedSnapshotsBlock(original, entries);
    const second = linkage.upsertLinkedSnapshotsBlock(first, entries);
    assert.equal(first, second, 'second upsert is byte-identical');
  });
});

// -------- AC-4: linkSnapshotsToFeature / linkSnapshotsToPlatform --------

describe('AC-4: linkSnapshotsToFeature/Platform', () => {
  it('linkSnapshotsToFeature creates stub when no per-feature file exists', () => {
    const root = makeRoot();
    const r = linkage.linkSnapshotsToFeature(root, 'F-079', 'foo', [
      { name: 'snap1', date: '2026-05-06', branch: 'main' },
    ]);
    assert.equal(r.updated, true);
    assert.equal(r.reason, 'target-missing-stub-created');
    const written = fs.readFileSync(r.path, 'utf8');
    assert.match(written, /^feature: F-079$/m);
    assert.match(written, /^topic: foo$/m);
    assert.match(written, /snap1/);
  });

  it('linkSnapshotsToFeature is idempotent (no-op on second call)', () => {
    const root = makeRoot();
    const entries = [{ name: 'snap1', date: '2026-05-06', branch: 'main' }];
    const first = linkage.linkSnapshotsToFeature(root, 'F-079', 'foo', entries);
    const second = linkage.linkSnapshotsToFeature(root, 'F-079', 'foo', entries);
    assert.equal(first.updated, true);
    assert.equal(second.updated, false);
    assert.equal(second.reason, 'byte-identical-noop');
  });

  it('linkSnapshotsToPlatform creates platform topic file when missing', () => {
    const root = makeRoot();
    const r = linkage.linkSnapshotsToPlatform(root, 'observability', [
      { name: 'snap1', date: '2026-05-06', branch: 'main' },
    ]);
    assert.equal(r.updated, true);
    const written = fs.readFileSync(r.path, 'utf8');
    assert.match(written, /^topic: observability$/m);
    assert.match(written, /snap1/);
  });
});

// -------- AC-1 + AC-2 + AC-4: end-to-end via processSnapshots --------

describe('processSnapshots pipeline (AC-4 idempotency)', () => {
  it('routes snapshots by frontmatter feature: + platform: + falls back to unassigned', () => {
    const root = makeRoot();
    writeSnapshot(root, 'a-feature-snap', { feature: 'F-079', date: '2026-05-06T00:00:00Z', branch: 'main' });
    writeSnapshot(root, 'b-platform-snap', { platform: 'observability', date: '2026-05-06T00:00:00Z', branch: 'main' });
    writeSnapshot(root, 'c-orphan-snap', { date: '2026-05-06T00:00:00Z', branch: 'main' });

    const r = linkage.processSnapshots(root, {});
    assert.equal(r.processed.length, 3);
    assert.equal(r.skipped.length, 0);
    const kinds = new Set(r.routes.map((x) => x.kind));
    assert.deepEqual([...kinds].sort(), ['feature', 'platform', 'unassigned']);
    // Three distinct target files were written.
    assert.equal(r.writes.length, 3);

    // Second run is byte-identical no-op.
    const r2 = linkage.processSnapshots(root, {});
    assert.equal(r2.writes.length, 0);
    assert.equal(r2.noops.length, 3);
  });
});

// -------- AC-5: F-077's classifySnapshot is the single source of truth --------
//
// @cap-decision(F-079/iter1) Stage-2 #2 fix: AC-5 acceptance flows through F-077's
//   classifySnapshot (cap-memory-migrate.cjs). F-079 no longer ships a duplicate pure helper.
//   The date-proximity-window contract is verified at the F-077 test file:
//   tests/cap-memory-migrate.test.cjs ("AC-5: classifier" describe block + new
//   "boundary-determinism" + "outside-window-returns-null" cases).

// -------- AC-6: snapshots-unassigned.md fallback --------

describe('AC-6: orphan snapshots land in snapshots-unassigned.md', () => {
  it('orphan snapshot is referenced from .cap/memory/platform/snapshots-unassigned.md', () => {
    const root = makeRoot();
    writeSnapshot(root, 'orphan-snap', { date: '2026-05-06T00:00:00Z', branch: 'main' });
    linkage.processSnapshots(root, {});
    const fp = path.join(root, '.cap', 'memory', 'platform', 'snapshots-unassigned.md');
    assert.ok(fs.existsSync(fp), 'snapshots-unassigned.md was created');
    const content = fs.readFileSync(fp, 'utf8');
    assert.match(content, /orphan-snap/);
    assert.match(content, /^topic: snapshots-unassigned$/m);
  });
});
