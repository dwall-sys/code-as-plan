'use strict';

// @cap-feature(feature:F-079) End-to-end tests for cap-snapshot-linkage via spawnSync.
//
// @cap-decision(F-079/iter1) Stage-2 #5 fix: spawnSync E2E for stderr soft-warn — synthetic
//   in-process tests cannot verify the AC-3 stderr emission contract because the library
//   only RETURNS the warning string; the command-layer (commands/cap/save.md) is what writes
//   it to stderr. F-082-iter2 lesson: synthetic-only tests miss real-world pipeline behavior.
//   These tests spawn `node -e ...` against the actual library with the same wiring used by
//   commands/cap/save.md, capture stderr, and assert the soft-warn message lands there.
//
// @cap-decision(F-079/iter1) Stage-2 #1 fix: AC-4 pipeline-integration E2E — invokes
//   processSnapshots() via spawnSync against a real sandbox (3 snapshots: feature-linked,
//   platform-linked, orphan), then re-runs and verifies byte-identical output across the
//   entire .cap/memory/ tree. This is the contract the cap-memory hook honors after the
//   FIX-1 wiring.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..');
const LINKAGE_LIB = path.join(REPO_ROOT, 'cap', 'bin', 'lib', 'cap-snapshot-linkage.cjs');

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f079-e2e-'));
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

function walkMemoryTree(memDir) {
  /** @type {Map<string,string>} */
  const m = new Map();
  if (!fs.existsSync(memDir)) return m;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.md')) m.set(path.relative(memDir, fp), fs.readFileSync(fp, 'utf8'));
    }
  }
  walk(memDir);
  return m;
}

// -------- Stage-2 #5 fix: stderr soft-warn capture --------

describe('Stage-2 #5 fix: stderr soft-warn via spawnSync (AC-3 end-to-end)', () => {
  it('--unassigned soft-warn lands on stderr (mirrors commands/cap/save.md wiring)', () => {
    const root = makeRoot();
    // Mirror the inline node -e snippet from commands/cap/save.md Step 4 — exactly the
    // wiring users see in production. If the library stops returning a warning, OR the
    // wrapper stops writing to stderr, this E2E goes red.
    const code = [
      `const linkage = require(${JSON.stringify(LINKAGE_LIB)});`,
      `const r = linkage.resolveLinkageOptions(${JSON.stringify(root)}, { unassigned: true });`,
      `if (r.warning) process.stderr.write('warn: ' + r.warning + '\\n');`,
      `process.stdout.write(JSON.stringify({ kind: r.kind, featureId: r.featureId }));`,
    ].join(' ');
    const result = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    assert.equal(result.status, 0, `exit code: stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /^warn: /m, 'soft-warn must reach stderr');
    assert.match(result.stderr, /unassigned/i, 'warning identifies the unassigned cause');
    const out = JSON.parse(result.stdout);
    assert.equal(out.kind, 'unassigned');
    assert.equal(out.featureId, null);
  });

  it('missing activeFeature in SESSION.json soft-warns to stderr (no exit-1)', () => {
    const root = makeRoot();
    // No SESSION.json written — loadSession falls back to default (activeFeature: null).
    const code = [
      `const linkage = require(${JSON.stringify(LINKAGE_LIB)});`,
      `const r = linkage.resolveLinkageOptions(${JSON.stringify(root)}, {});`,
      `if (r.warning) process.stderr.write('warn: ' + r.warning + '\\n');`,
      `process.stdout.write(r.kind);`,
    ].join(' ');
    const result = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    assert.equal(result.status, 0, 'soft-warn must NOT fail the save');
    assert.match(result.stderr, /^warn: /m, 'soft-warn lands on stderr');
    assert.match(result.stderr, /no activeFeature/i);
    assert.equal(result.stdout, 'unassigned');
  });
});

// -------- Stage-2 #1 fix: pipeline integration E2E (AC-4) --------

describe('Stage-2 #1 fix: processSnapshots E2E via spawnSync (AC-4 pipeline integration)', () => {
  it('processSnapshots populates linked_snapshots and re-run is byte-identical', () => {
    const root = makeRoot();
    // 3 snapshots: feature-linked, platform-linked, orphan (--unassigned style frontmatter).
    writeSnapshot(root, 'a-feature', { feature: 'F-079', date: '2026-05-06T00:00:00Z', branch: 'main' });
    writeSnapshot(root, 'b-platform', { platform: 'observability', date: '2026-05-06T00:00:00Z', branch: 'main' });
    writeSnapshot(root, 'c-orphan', { date: '2026-05-06T00:00:00Z', branch: 'main' });

    const code = [
      `const linkage = require(${JSON.stringify(LINKAGE_LIB)});`,
      `const r = linkage.processSnapshots(${JSON.stringify(root)}, {});`,
      `process.stdout.write(JSON.stringify({ processed: r.processed.length, writes: r.writes.length, noops: r.noops.length, skipped: r.skipped.length }));`,
    ].join(' ');

    // First run: writes 3 target files.
    const r1 = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    assert.equal(r1.status, 0, `first run exit: stdout=${r1.stdout} stderr=${r1.stderr}`);
    const r1Out = JSON.parse(r1.stdout);
    assert.equal(r1Out.processed, 3);
    assert.equal(r1Out.writes, 3);
    assert.equal(r1Out.skipped, 0);

    // Verify the per-feature file's linked_snapshots auto-block is populated.
    const memDir = path.join(root, '.cap', 'memory');
    const featureFiles = fs.readdirSync(path.join(memDir, 'features'));
    const featurePath = path.join(memDir, 'features', featureFiles.find((f) => f.startsWith('F-079-')));
    const featureContent = fs.readFileSync(featurePath, 'utf8');
    assert.match(featureContent, /<!-- @auto-block linked_snapshots -->/);
    assert.match(featureContent, /a-feature/, 'feature-linked snapshot is referenced');

    // Verify platform topic file.
    const platformContent = fs.readFileSync(path.join(memDir, 'platform', 'observability.md'), 'utf8');
    assert.match(platformContent, /b-platform/, 'platform-linked snapshot is referenced');

    // Verify orphan landed in snapshots-unassigned.md.
    const unassignedContent = fs.readFileSync(path.join(memDir, 'platform', 'snapshots-unassigned.md'), 'utf8');
    assert.match(unassignedContent, /c-orphan/, 'orphan snapshot is referenced in snapshots-unassigned.md');

    // Snapshot the entire .cap/memory/ tree before the second run.
    const before = walkMemoryTree(memDir);
    assert.ok(before.size >= 3, `expected at least 3 .md files; got ${before.size}`);

    // Second run: byte-identical no-ops.
    const r2 = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_V8_COVERAGE: '' },
    });
    assert.equal(r2.status, 0, `second run exit: stdout=${r2.stdout} stderr=${r2.stderr}`);
    const r2Out = JSON.parse(r2.stdout);
    assert.equal(r2Out.writes, 0, 'second run must write nothing');
    assert.equal(r2Out.noops, 3, 'second run must report 3 byte-identical no-ops');

    // Byte-identical contract: every file content matches.
    const after = walkMemoryTree(memDir);
    assert.equal(after.size, before.size, 'no new files appeared on re-run');
    for (const [rel, content] of before.entries()) {
      assert.equal(after.get(rel), content, `byte-identical re-run for ${rel}`);
    }
  });
});

// -------- FIX-1 source-shape pin --------

describe('Stage-2 #1 fix: hooks/cap-memory.js wires processSnapshots into the pipeline', () => {
  it('the source of hooks/cap-memory.js references cap-snapshot-linkage and processSnapshots', () => {
    // Source-shape pin (mirrors the existing hotspot regression test in cap-memory-hook.test.cjs).
    // Without this, a future refactor could silently drop the FIX-1 wiring and the integration
    // would regress to the pre-iter1 "library exists but pipeline doesn't call it" state that
    // Stage-2 #1 originally flagged.
    const hookSrc = fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'cap-memory.js'), 'utf8');
    assert.match(hookSrc, /cap-snapshot-linkage/, 'hook must require cap-snapshot-linkage');
    assert.match(hookSrc, /processSnapshots/, 'hook must invoke processSnapshots');
    assert.match(hookSrc, /F-079\/iter1/, 'wiring must be tagged with the iter1 decision marker');
  });
});
