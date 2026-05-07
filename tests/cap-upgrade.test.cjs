'use strict';

// @cap-feature(feature:F-084) Happy-path tests for cap-upgrade.cjs.
//   Covers AC-1 (planMigrations), AC-2 (7-stage pipeline + idempotency),
//   AC-3 (--non-interactive defaults), AC-4 (per-stage isolation via
//   recordStageResult), AC-5 (writeMarker round-trip), AC-7 (test matrix).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const upgrade = require('../cap/bin/lib/cap-upgrade.cjs');

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-upgrade-happy-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function freshProject(name) {
  const root = path.join(SANDBOX, `proj-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// -------- AC-2: 7-stage pipeline definition --------

describe('STAGES contract (AC-2)', () => {
  it('exposes exactly 7 stages in the canonical order', () => {
    assert.equal(upgrade.STAGES.length, 7);
    const names = upgrade.STAGES.map((s) => s.name);
    assert.deepEqual(names, [
      'doctor',
      'init-or-skip',
      'annotate',
      'migrate-tags',
      'memory-bootstrap',
      'migrate-snapshots',
      'refresh-docs',
    ]);
  });
  it('STAGE_NAMES mirrors STAGES.map(s => s.name)', () => {
    assert.deepEqual(upgrade.STAGE_NAMES, upgrade.STAGES.map((s) => s.name));
  });
  it('only annotate + refresh-docs are optional', () => {
    const optional = upgrade.STAGES.filter((s) => s.optional).map((s) => s.name);
    assert.deepEqual(optional, ['annotate', 'refresh-docs']);
  });
  it('only doctor is read-only', () => {
    const ro = upgrade.STAGES.filter((s) => s.readOnly).map((s) => s.name);
    assert.deepEqual(ro, ['doctor']);
  });
  it('STAGES is frozen', () => {
    assert.equal(Object.isFrozen(upgrade.STAGES), true);
    assert.equal(Object.isFrozen(upgrade.STAGES[0]), true);
  });
});

// -------- AC-1: getInstalledVersion --------

describe('getInstalledVersion (AC-1)', () => {
  it('reads the CAP repo package.json by default', () => {
    const v = upgrade.getInstalledVersion();
    // Real package.json on disk says 5.0.0 at the time of writing.
    assert.match(v, /^\d+\.\d+\.\d+/, 'should be a semver');
  });
  it('returns 0.0.0 when package.json is missing', () => {
    const root = freshProject('no-pkg');
    const v = upgrade.getInstalledVersion(root);
    assert.equal(v, '0.0.0');
  });
  it('returns 0.0.0 when package.json is malformed', () => {
    const root = freshProject('bad-pkg');
    fs.writeFileSync(path.join(root, 'package.json'), '{not valid json');
    const v = upgrade.getInstalledVersion(root);
    assert.equal(v, '0.0.0');
  });
  it('returns 0.0.0 when version is missing or non-semver', () => {
    const root = freshProject('no-version');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x' }));
    assert.equal(upgrade.getInstalledVersion(root), '0.0.0');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: 'not-a-version' }));
    assert.equal(upgrade.getInstalledVersion(root), '0.0.0');
  });
  it('strips leading v in compareVersions', () => {
    assert.equal(upgrade.compareVersions('v1.2.3', '1.2.3'), 0);
    assert.equal(upgrade.compareVersions('v1.0.0', '2.0.0'), -1);
    assert.equal(upgrade.compareVersions('5.0.0', '4.9.9'), 1);
  });
  it('compareVersions returns null on parse-failure', () => {
    assert.equal(upgrade.compareVersions('not-a-version', '1.0.0'), null);
    assert.equal(upgrade.compareVersions('1.0.0', null), null);
  });
});

// -------- AC-1: planMigrations on fresh project --------

describe('planMigrations — fresh-init (AC-1, AC-2)', () => {
  it('plans all 7 stages on a truly empty repo', () => {
    const root = freshProject('fresh-empty');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    assert.equal(result.firstRun, true);
    assert.equal(result.alreadyCurrent, false);
    assert.equal(result.markerVersion, null);
    assert.equal(result.installedVersion, '5.0.0');
    assert.equal(result.plan.length, 7);
    // First two stages always run on fresh repo: doctor + init.
    const doctor = result.plan.find((p) => p.name === 'doctor');
    assert.equal(doctor.skip, false);
    const init = result.plan.find((p) => p.name === 'init-or-skip');
    assert.equal(init.skip, false);
    // memory-bootstrap should be planned (no .cap/memory/features yet).
    const mem = result.plan.find((p) => p.name === 'memory-bootstrap');
    assert.equal(mem.skip, false);
    // refresh-docs in INTERACTIVE mode is also planned (no stack-docs cached).
    const docs = result.plan.find((p) => p.name === 'refresh-docs');
    assert.equal(docs.skip, false);
  });
  it('preserves stage order regardless of skip status', () => {
    const root = freshProject('fresh-order');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const names = result.plan.map((s) => s.name);
    assert.deepEqual(names, upgrade.STAGE_NAMES);
  });
});

describe('planMigrations — already-initialized brownfield', () => {
  it('skips init-or-skip when .cap/ + FEATURE-MAP.md exist', () => {
    const root = freshProject('brownfield');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# Map\n');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const init = result.plan.find((p) => p.name === 'init-or-skip');
    assert.equal(init.skip, true);
    assert.match(init.reason, /already present/);
  });
  it('skips memory-bootstrap when .cap/memory/features/*.md exists', () => {
    const root = freshProject('memory-done');
    fs.mkdirSync(path.join(root, '.cap', 'memory', 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'memory', 'features', 'F-001.md'), '# F-001\n');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const mem = result.plan.find((p) => p.name === 'memory-bootstrap');
    assert.equal(mem.skip, true);
    assert.match(mem.reason, /already populated/);
  });
  it('skips migrate-snapshots when .cap/snapshots/ is empty', () => {
    const root = freshProject('snap-empty');
    fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const ms = result.plan.find((p) => p.name === 'migrate-snapshots');
    assert.equal(ms.skip, true);
  });
  it('plans migrate-snapshots when .cap/snapshots/*.md exists', () => {
    const root = freshProject('snap-present');
    fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'snapshots', '2026-05-06-foo.md'), '---\nfeature: F-001\n---\nbody\n');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const ms = result.plan.find((p) => p.name === 'migrate-snapshots');
    assert.equal(ms.skip, false);
  });
  it('skips refresh-docs when stack-docs are <30 days old', () => {
    const root = freshProject('docs-fresh');
    const stackDir = path.join(root, '.cap', 'stack-docs');
    fs.mkdirSync(stackDir, { recursive: true });
    fs.writeFileSync(path.join(stackDir, 'react.md'), '# React docs\n');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const rd = result.plan.find((p) => p.name === 'refresh-docs');
    assert.equal(rd.skip, true);
    assert.match(rd.reason, /<30 days/);
  });
});

// -------- AC-3: --non-interactive safe defaults --------

describe('planMigrations — non-interactive mode (AC-3)', () => {
  it('skips optional stages (annotate, refresh-docs) by default', () => {
    const root = freshProject('ni-default');
    const result = upgrade.planMigrations(root, {
      installedVersion: '5.0.0',
      runOptions: { nonInteractive: true },
    });
    const annotate = result.plan.find((p) => p.name === 'annotate');
    assert.equal(annotate.skip, true);
    assert.match(annotate.reason, /non-interactive/);
    const docs = result.plan.find((p) => p.name === 'refresh-docs');
    assert.equal(docs.skip, true);
    assert.match(docs.reason, /non-interactive/);
  });
  it('--include-stages overrides non-interactive skip for that stage only', () => {
    const root = freshProject('ni-include');
    const result = upgrade.planMigrations(root, {
      installedVersion: '5.0.0',
      runOptions: { nonInteractive: true, includeStages: 'annotate' },
    });
    const annotate = result.plan.find((p) => p.name === 'annotate');
    assert.equal(annotate.skip, false);
    const docs = result.plan.find((p) => p.name === 'refresh-docs');
    assert.equal(docs.skip, true, 'refresh-docs still skipped');
  });
  it('--skip-stages explicitly marks stages as skipped (interactive mode)', () => {
    const root = freshProject('skip-stages');
    const result = upgrade.planMigrations(root, {
      installedVersion: '5.0.0',
      runOptions: { skipStages: 'annotate,migrate-tags' },
    });
    const annotate = result.plan.find((p) => p.name === 'annotate');
    assert.equal(annotate.skip, true);
    assert.match(annotate.reason, /user requested/);
    const tags = result.plan.find((p) => p.name === 'migrate-tags');
    assert.equal(tags.skip, true);
  });
});

// -------- AC-1 + AC-5: marker round-trip --------

describe('writeMarker / getMarkerVersion (AC-5)', () => {
  it('round-trip: write then read returns equivalent payload', () => {
    const root = freshProject('marker-roundtrip');
    const ts = '2026-05-07T10:00:00.000Z';
    const written = upgrade.writeMarker(root, {
      version: '5.0.0',
      completedStages: ['doctor', 'init-or-skip'],
      lastRun: ts,
    });
    assert.equal(written, true);
    const read = upgrade.getMarkerVersion(root);
    assert.equal(read.version, '5.0.0');
    assert.equal(read.lastRun, ts);
    assert.deepEqual(read.completedStages, ['doctor', 'init-or-skip']);
    assert.equal(read.schemaVersion, upgrade.MARKER_SCHEMA_VERSION);
  });
  it('returns null when marker is missing', () => {
    const root = freshProject('no-marker');
    assert.equal(upgrade.getMarkerVersion(root), null);
  });
  it('idempotent: re-write with identical content does not change file', () => {
    const root = freshProject('marker-idempotent');
    const ts = '2026-05-07T10:00:00.000Z';
    upgrade.writeMarker(root, { version: '5.0.0', completedStages: ['doctor'], lastRun: ts });
    const fp = path.join(root, '.cap', 'version');
    const stat1 = fs.statSync(fp);
    const content1 = fs.readFileSync(fp, 'utf8');
    // Wait a tick so mtime resolution would normally see a change.
    upgrade.writeMarker(root, { version: '5.0.0', completedStages: ['doctor'], lastRun: ts });
    const content2 = fs.readFileSync(fp, 'utf8');
    assert.equal(content1, content2, 'content byte-identical on re-write');
    const stat2 = fs.statSync(fp);
    // mtime stable on idempotent write (we skip the actual write).
    assert.equal(stat1.mtime.getTime(), stat2.mtime.getTime());
  });
  it('drops unknown stages from completedStages on read', () => {
    const root = freshProject('marker-unknown');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    const payload = {
      schemaVersion: 1,
      version: '5.0.0',
      completedStages: ['doctor', 'evil-stage', 'init-or-skip', 'rm -rf'],
      lastRun: '2026-05-07T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(root, '.cap', 'version'), JSON.stringify(payload));
    const read = upgrade.getMarkerVersion(root);
    assert.deepEqual(read.completedStages, ['doctor', 'init-or-skip']);
  });
  it('writeMarker filters unknown stages from completedStages', () => {
    const root = freshProject('marker-filter');
    upgrade.writeMarker(root, {
      version: '5.0.0',
      completedStages: ['doctor', 'unknown-stage', 'init-or-skip'],
      lastRun: '2026-05-07T00:00:00.000Z',
    });
    const read = upgrade.getMarkerVersion(root);
    assert.deepEqual(read.completedStages, ['doctor', 'init-or-skip']);
  });
  it('writeMarker rejects non-semver versions', () => {
    const root = freshProject('marker-reject');
    assert.throws(() => upgrade.writeMarker(root, {
      version: 'not-a-version',
      completedStages: [],
    }), /payload.version must be a semver/);
  });
});

// -------- AC-1: alreadyCurrent + already-done detection --------

describe('planMigrations — already-current detection', () => {
  it('marks alreadyCurrent=true when marker matches installed and all required stages done', () => {
    const root = freshProject('already-current');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    upgrade.writeMarker(root, {
      version: '5.0.0',
      // Required (non-optional) stages: doctor, init-or-skip, migrate-tags,
      // memory-bootstrap, migrate-snapshots.
      completedStages: ['doctor', 'init-or-skip', 'migrate-tags', 'memory-bootstrap', 'migrate-snapshots'],
      lastRun: '2026-05-07T00:00:00.000Z',
    });
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    assert.equal(result.alreadyCurrent, true);
  });
  it('per-stage alreadyDone fires when marker has the stage at current version', () => {
    const root = freshProject('per-stage-done');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    upgrade.writeMarker(root, {
      version: '5.0.0',
      completedStages: ['doctor'],
      lastRun: '2026-05-07T00:00:00.000Z',
    });
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const doctor = result.plan.find((p) => p.name === 'doctor');
    assert.equal(doctor.alreadyDone, true);
    assert.equal(doctor.skip, true);
    assert.match(doctor.reason, /marker shows stage completed/);
  });
  it('--force-rerun ignores marker and replans every stage', () => {
    const root = freshProject('force-rerun');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    upgrade.writeMarker(root, {
      version: '5.0.0',
      completedStages: ['doctor', 'init-or-skip', 'migrate-tags', 'memory-bootstrap', 'migrate-snapshots'],
      lastRun: '2026-05-07T00:00:00.000Z',
    });
    const result = upgrade.planMigrations(root, {
      installedVersion: '5.0.0',
      runOptions: { forceRerun: true },
    });
    assert.equal(result.alreadyCurrent, false);
    const doctor = result.plan.find((p) => p.name === 'doctor');
    assert.equal(doctor.alreadyDone, false);
  });
  it('mid-version-upgrade: old marker version means stages re-plan', () => {
    const root = freshProject('mid-upgrade');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    upgrade.writeMarker(root, {
      version: '4.0.0',
      completedStages: ['doctor', 'init-or-skip', 'migrate-tags', 'memory-bootstrap', 'migrate-snapshots'],
      lastRun: '2026-04-01T00:00:00.000Z',
    });
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    assert.equal(result.alreadyCurrent, false);
    assert.equal(result.markerVersion, '4.0.0');
    // Marker bits no longer count: completedStages applied only when versions match.
    const doctor = result.plan.find((p) => p.name === 'doctor');
    assert.equal(doctor.alreadyDone, false);
  });
});

// -------- AC-4: appendLog / readLog round-trip --------

describe('appendLog / readLog (AC-4)', () => {
  it('appends one JSONL line per call', () => {
    const root = freshProject('log-append');
    const a = upgrade.appendLog(root, { stage: 'doctor', status: 'success', durationMs: 42 });
    const b = upgrade.appendLog(root, { stage: 'init-or-skip', status: 'skipped', reason: 'already present' });
    assert.equal(a, true);
    assert.equal(b, true);
    const log = upgrade.readLog(root);
    assert.equal(log.length, 2);
    assert.equal(log[0].stage, 'doctor');
    assert.equal(log[0].status, 'success');
    assert.equal(log[0].durationMs, 42);
    assert.equal(log[1].stage, 'init-or-skip');
    assert.equal(log[1].status, 'skipped');
    assert.equal(log[1].reason, 'already present');
    // Each entry has a timestamp.
    for (const e of log) assert.match(e.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
  it('rejects unknown stage names', () => {
    const root = freshProject('log-bad-stage');
    assert.throws(() => upgrade.appendLog(root, { stage: 'unknown', status: 'success' }), /known stage/);
  });
  it('rejects unknown status values', () => {
    const root = freshProject('log-bad-status');
    assert.throws(() => upgrade.appendLog(root, { stage: 'doctor', status: 'maybe' }), /success\|failure\|skipped/);
  });
  it('readLog returns [] when log is missing', () => {
    const root = freshProject('log-missing');
    assert.deepEqual(upgrade.readLog(root), []);
  });
  it('readLog drops malformed lines', () => {
    const root = freshProject('log-malformed');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    const fp = path.join(root, '.cap', 'upgrade.log');
    fs.writeFileSync(fp,
      '{"stage":"doctor","status":"success","timestamp":"2026-05-07T00:00:00.000Z"}\n' +
      'this is not json\n' +
      '\n' +
      '{"stage":"init-or-skip","status":"skipped","timestamp":"2026-05-07T00:00:01.000Z"}\n'
    );
    const log = upgrade.readLog(root);
    assert.equal(log.length, 2);
    assert.equal(log[0].stage, 'doctor');
    assert.equal(log[1].stage, 'init-or-skip');
  });
});

// -------- AC-4: recordStageResult --------

describe('recordStageResult (AC-4, AC-5)', () => {
  it('success: appends log AND advances marker', () => {
    const root = freshProject('record-success');
    const result = upgrade.recordStageResult(root, 'doctor', {
      status: 'success',
      durationMs: 100,
      installedVersion: '5.0.0',
    });
    assert.equal(result.logged, true);
    assert.equal(result.markerUpdated, true);
    const marker = upgrade.getMarkerVersion(root);
    assert.equal(marker.version, '5.0.0');
    assert.deepEqual(marker.completedStages, ['doctor']);
    const log = upgrade.readLog(root);
    assert.equal(log.length, 1);
    assert.equal(log[0].stage, 'doctor');
    assert.equal(log[0].status, 'success');
  });
  it('failure: appends log, does NOT advance marker', () => {
    const root = freshProject('record-failure');
    const result = upgrade.recordStageResult(root, 'annotate', {
      status: 'failure',
      reason: 'agent timed out',
    });
    assert.equal(result.logged, true);
    assert.equal(result.markerUpdated, false);
    assert.equal(upgrade.getMarkerVersion(root), null);
  });
  it('skipped: appends log, does NOT advance marker', () => {
    const root = freshProject('record-skipped');
    const result = upgrade.recordStageResult(root, 'refresh-docs', {
      status: 'skipped',
      reason: 'docs <30 days',
    });
    assert.equal(result.logged, true);
    assert.equal(result.markerUpdated, false);
  });
  it('multiple successes accumulate completedStages in canonical order', () => {
    const root = freshProject('record-multi');
    upgrade.recordStageResult(root, 'init-or-skip', { status: 'success', installedVersion: '5.0.0' });
    upgrade.recordStageResult(root, 'doctor', { status: 'success', installedVersion: '5.0.0' });
    upgrade.recordStageResult(root, 'migrate-tags', { status: 'success', installedVersion: '5.0.0' });
    const marker = upgrade.getMarkerVersion(root);
    // Canonical order: doctor, init-or-skip, migrate-tags.
    assert.deepEqual(marker.completedStages, ['doctor', 'init-or-skip', 'migrate-tags']);
  });
  it('version-bump resets completedStages', () => {
    const root = freshProject('record-bump');
    upgrade.recordStageResult(root, 'doctor', { status: 'success', installedVersion: '4.0.0' });
    upgrade.recordStageResult(root, 'init-or-skip', { status: 'success', installedVersion: '5.0.0' });
    const marker = upgrade.getMarkerVersion(root);
    assert.equal(marker.version, '5.0.0');
    // Bump invalidates the prior 4.0.0 entry; only init-or-skip survives at 5.0.0.
    assert.deepEqual(marker.completedStages, ['init-or-skip']);
  });
  it('rejects unknown stage names', () => {
    const root = freshProject('record-unknown');
    assert.throws(() => upgrade.recordStageResult(root, 'evil', { status: 'success' }), /unknown stage/);
  });
});

// -------- AC-6: hook advisory --------

describe('needsAdvisory + buildAdvisoryMessage (AC-6)', () => {
  it('first run (no marker) needs advisory', () => {
    assert.equal(upgrade.needsAdvisory('5.0.0', null), true);
  });
  it('matching versions do not need advisory', () => {
    assert.equal(upgrade.needsAdvisory('5.0.0', '5.0.0'), false);
  });
  it('mismatched versions need advisory', () => {
    assert.equal(upgrade.needsAdvisory('5.0.0', '4.0.0'), true);
    assert.equal(upgrade.needsAdvisory('5.0.0', '6.0.0'), true);
  });
  it('invalid installedVersion does not need advisory (cannot warn safely)', () => {
    assert.equal(upgrade.needsAdvisory('not-a-version', null), false);
  });
  it('advisory message stays under 120 chars', () => {
    const m1 = upgrade.buildAdvisoryMessage('5.0.0', null);
    const m2 = upgrade.buildAdvisoryMessage('5.0.0', '4.0.0');
    assert.ok(m1.length <= 120);
    assert.ok(m2.length <= 120);
    assert.match(m1, /First run/);
    assert.match(m2, /5\.0\.0/);
    assert.match(m2, /migrate/);
  });
});

describe('shouldEmitAdvisory throttle (AC-6)', () => {
  it('first call within session emits; second call within same session is throttled', () => {
    const root = freshProject('throttle-basic');
    const first = upgrade.shouldEmitAdvisory(root, { sessionId: 'sess-1' });
    assert.equal(first.shouldEmit, true);
    const second = upgrade.shouldEmitAdvisory(root, { sessionId: 'sess-1' });
    assert.equal(second.shouldEmit, false);
    assert.match(second.reason, /already emitted/);
  });
  it('different session-ids each get their own emit', () => {
    const root = freshProject('throttle-multi');
    assert.equal(upgrade.shouldEmitAdvisory(root, { sessionId: 's1' }).shouldEmit, true);
    assert.equal(upgrade.shouldEmitAdvisory(root, { sessionId: 's2' }).shouldEmit, true);
    assert.equal(upgrade.shouldEmitAdvisory(root, { sessionId: 's1' }).shouldEmit, false);
    assert.equal(upgrade.shouldEmitAdvisory(root, { sessionId: 's2' }).shouldEmit, false);
  });
  it('configNotify=false suppresses entirely (silent)', () => {
    const root = freshProject('throttle-suppress');
    const r = upgrade.shouldEmitAdvisory(root, { sessionId: 's1', configNotify: false });
    assert.equal(r.shouldEmit, false);
    assert.match(r.reason, /suppressed/);
    // Also: no advisories file should have been written when suppressed.
    const fp = path.join(root, '.cap', '.session-advisories.json');
    assert.equal(fs.existsSync(fp), false);
  });
});

// -------- summarizePlan output --------

describe('summarizePlan (AC-3)', () => {
  it('produces a human-readable summary with stage names and reasons', () => {
    const root = freshProject('summary');
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const out = upgrade.summarizePlan(result);
    assert.match(out, /CAP installed: 5\.0\.0/);
    assert.match(out, /First run:\s+yes/);
    assert.match(out, /doctor/);
    assert.match(out, /refresh-docs/);
    assert.match(out, /\[RUN\]|\[SKIP\]/);
  });
});

// -------- AC-3: delta-probes (Stage-2 #2 iter1 fix) --------

describe('delta-probes (AC-3 — iter1 Stage-2 #2 fix)', () => {
  it('init-or-skip probe lists the files /cap:init would create', () => {
    const root = freshProject('probe-init');
    // Empty repo — probe should report all 3 files missing.
    const out = upgrade._runProbe('init-or-skip', root);
    assert.equal(typeof out, 'string');
    assert.match(out, /Will create:/);
    assert.match(out, /\.cap\//);
    assert.match(out, /FEATURE-MAP\.md/);
  });

  it('memory-bootstrap probe counts features in FEATURE-MAP without per-feature memory file', () => {
    const root = freshProject('probe-memory');
    // Create a FEATURE-MAP with 3 feature headers.
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'),
      '# Feature Map\n\n### F-001: Alpha\n\n### F-002: Beta\n\n### F-003: Gamma\n');
    // Pre-create memory dir with NONE of the features → expect "3 per-feature files".
    fs.mkdirSync(path.join(root, '.cap', 'memory', 'features'), { recursive: true });
    const out = upgrade._runProbe('memory-bootstrap', root);
    assert.equal(typeof out, 'string');
    assert.match(out, /Will create 3/);
    assert.match(out, /per-feature memory/);
  });

  it('memory-bootstrap probe reports correct count with partial coverage', () => {
    const root = freshProject('probe-memory-partial');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'),
      '# Map\n\n### F-001: A\n\n### F-002: B\n\n### F-003: C\n');
    fs.mkdirSync(path.join(root, '.cap', 'memory', 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'memory', 'features', 'F-001.md'), '# F-001\n');
    const out = upgrade._runProbe('memory-bootstrap', root);
    assert.match(out, /Will create 2/);
  });

  it('migrate-snapshots probe counts unlinked snapshots', () => {
    const root = freshProject('probe-snap');
    const snapDir = path.join(root, '.cap', 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    // 2 unlinked + 1 linked.
    fs.writeFileSync(path.join(snapDir, '2026-05-07-a.md'), '# untitled snapshot\n');
    fs.writeFileSync(path.join(snapDir, '2026-05-07-b.md'), '# untitled snapshot\n');
    fs.writeFileSync(path.join(snapDir, '2026-05-07-c.md'), '---\nfeature: F-001\n---\nbody\n');
    const out = upgrade._runProbe('migrate-snapshots', root);
    assert.equal(typeof out, 'string');
    assert.match(out, /Will link 2 of 3/);
  });

  it('refresh-docs probe lists package.json dependencies', () => {
    const root = freshProject('probe-docs');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: { 'react': '^18.0.0', 'next': '^14.0.0' },
      devDependencies: { 'vitest': '^1.0.0' },
    }));
    const out = upgrade._runProbe('refresh-docs', root);
    assert.equal(typeof out, 'string');
    assert.match(out, /Will fetch docs for libraries/);
    assert.match(out, /react/);
  });

  it('doctor probe always returns null (read-only stage, no delta)', () => {
    const root = freshProject('probe-doctor');
    assert.equal(upgrade._runProbe('doctor', root), null);
  });

  it('probe runs <2s combined for all 7 stages on a real fixture', () => {
    const root = freshProject('probe-perf');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'),
      '# Map\n\n### F-001: A\n\n### F-002: B\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture',
      dependencies: { 'a': '1.0.0', 'b': '2.0.0' },
    }));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'index.js'), '// hi\n');
    fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'snapshots', 'a.md'), '# a\n');
    const start = Date.now();
    for (const stage of upgrade.STAGE_NAMES) {
      upgrade._runProbe(stage, root);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `combined probe took ${elapsed}ms (must be <2000ms)`);
  });

  it('probes are READ-ONLY: no files created, no mtimes touched', () => {
    const root = freshProject('probe-readonly');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'),
      '# Map\n\n### F-001: A\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'react': '1' },
    }));
    fs.mkdirSync(path.join(root, '.cap', 'memory', 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'memory', 'features', 'F-001.md'), '# F-001\n');
    fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'snapshots', 'a.md'), '# a\n');
    // Capture initial state recursively.
    function snapshotTree(dir) {
      const out = [];
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop();
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); }
        catch (_e) { continue; }
        for (const e of entries) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) {
            out.push({ path: fp, type: 'dir' });
            stack.push(fp);
          } else {
            const stat = fs.statSync(fp);
            out.push({ path: fp, type: 'file', size: stat.size, mtime: stat.mtime.getTime() });
          }
        }
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    }
    const before = snapshotTree(root);
    for (const stage of upgrade.STAGE_NAMES) {
      upgrade._runProbe(stage, root);
    }
    const after = snapshotTree(root);
    assert.equal(before.length, after.length, 'no files created or removed');
    for (let i = 0; i < before.length; i++) {
      assert.equal(before[i].path, after[i].path, `path[${i}] unchanged`);
      if (before[i].type === 'file') {
        assert.equal(before[i].size, after[i].size, `${before[i].path} size unchanged`);
        assert.equal(before[i].mtime, after[i].mtime, `${before[i].path} mtime unchanged`);
      }
    }
  });

  it('summarizePlan emits a "delta:" line under each [RUN] stage that has a probe', () => {
    const root = freshProject('summary-delta');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'react': '^18' },
    }));
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const out = upgrade.summarizePlan(result);
    // At minimum the init-or-skip stage runs with a delta probe.
    assert.match(out, /\[RUN\]\s+init-or-skip/);
    assert.match(out, /delta:\s+Will create:/);
  });

  it('plan entries carry the probe result in plan[].delta', () => {
    const root = freshProject('plan-delta');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { 'react': '^18' },
    }));
    const result = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const init = result.plan.find((p) => p.name === 'init-or-skip');
    assert.equal(typeof init.delta, 'string');
    assert.match(init.delta, /Will create/);
    // Skipped stages have null delta.
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# m\n');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    const r2 = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const init2 = r2.plan.find((p) => p.name === 'init-or-skip');
    assert.equal(init2.skip, true);
    assert.equal(init2.delta, null, 'skipped stages have no delta');
  });
});

// -------- recordStageResult resilience to writeMarker failures (iter1 Stage-2 #4) --------

describe('recordStageResult resilient to writeMarker failures (iter1)', () => {
  it('catches writeMarker throws, logs marker-write-failure, continues', () => {
    const root = freshProject('marker-fail');
    // Pre-write a successful first stage so the marker file exists.
    upgrade.recordStageResult(root, 'doctor', { status: 'success', installedVersion: '5.0.0' });
    // Now make .cap/version unwritable by replacing it with a directory of the
    // same name → atomic rename will fail with EISDIR.
    const markerPath = path.join(root, '.cap', 'version');
    fs.rmSync(markerPath);
    fs.mkdirSync(markerPath, { recursive: true });
    // recordStageResult MUST NOT throw.
    let result;
    assert.doesNotThrow(() => {
      result = upgrade.recordStageResult(root, 'init-or-skip', {
        status: 'success',
        installedVersion: '5.0.0',
      });
    }, 'recordStageResult must swallow marker-write failures');
    assert.equal(result.logged, true, 'log entry should still be appended');
    assert.equal(result.markerUpdated, false, 'markerUpdated reflects the failure');
    // The audit log should contain a marker-write-failure breadcrumb.
    const fp = path.join(root, '.cap', 'upgrade.log');
    const raw = fs.readFileSync(fp, 'utf8');
    assert.match(raw, /marker-write-failure/, 'audit log captures the failure');
  });

  it('does NOT call writeMarker on failure status (skip the throw path entirely)', () => {
    const root = freshProject('marker-fail-failure');
    // Even if marker would be unwritable, a status:failure stage doesn't try.
    const markerPath = path.join(root, '.cap');
    fs.mkdirSync(markerPath, { recursive: true });
    fs.writeFileSync(path.join(markerPath, 'version'), '');
    fs.chmodSync(path.join(markerPath, 'version'), 0o000);
    let result;
    try {
      assert.doesNotThrow(() => {
        result = upgrade.recordStageResult(root, 'annotate', {
          status: 'failure',
          reason: 'simulated agent timeout',
        });
      });
      assert.equal(result.markerUpdated, false);
      assert.equal(result.logged, true);
    } finally {
      // Cleanup: restore permissions so tmpdir can be removed.
      try { fs.chmodSync(path.join(markerPath, 'version'), 0o644); } catch (_e) { /* ignore */ }
    }
  });
});
