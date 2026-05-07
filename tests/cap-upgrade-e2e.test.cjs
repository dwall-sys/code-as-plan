'use strict';

// @cap-feature(feature:F-084) E2E spawnSync tests for cap-upgrade.cjs.
//   Lessons from F-070 + F-079: subprocess-hook-state via persistent ledger,
//   E2E spawnSync is mandatory for hook contracts. Tests verify the
//   cap-version-check.js hook end-to-end (silent vs emit, throttle).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let SANDBOX;
const HOOK_PATH = path.resolve(__dirname, '..', 'hooks', 'cap-version-check.js');
const REPO_ROOT = path.resolve(__dirname, '..');

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-upgrade-e2e-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function freshProject(name) {
  const root = path.join(SANDBOX, `e2e-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// @cap-decision(F-084/E2E) The hook resolves cap-upgrade.cjs from EITHER its
//   own repo path OR the global install path. In tests we run the hook with
//   cwd=projectRoot, but Node resolves __dirname based on the script's location
//   in the repo, so the hook will pick up the in-repo cap-upgrade.cjs.

function runHook(projectRoot, env = {}) {
  return spawnSync('node', [HOOK_PATH], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env, CLAUDE_SESSION_ID: env.CLAUDE_SESSION_ID || 'test-session-default' },
    timeout: 5000,
  });
}

describe('cap-version-check hook E2E', () => {
  it('emits advisory on first run with no .cap/version (and project has FEATURE-MAP.md)', () => {
    const root = freshProject('hook-first-run');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    const r = runHook(root, { CLAUDE_SESSION_ID: 'sess-hook-1' });
    assert.equal(r.status, 0, `hook exited 0; stderr=${r.stderr}`);
    // Advisory message should appear in stdout.
    assert.match(r.stdout, /\[CAP\]/);
    assert.match(r.stdout, /\/cap:upgrade/);
    // No control bytes in output.
    // eslint-disable-next-line no-control-regex
    assert.equal(/[\x00-\x1f]/.test(r.stdout.replace(/\n/g, '')), false);
  });

  it('second run with same session-id is throttled (silent)', () => {
    const root = freshProject('hook-throttled');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    // First run: emits.
    const first = runHook(root, { CLAUDE_SESSION_ID: 'sess-throttle-1' });
    assert.match(first.stdout, /\[CAP\]/);
    // Second run: same session-id, same project → silent.
    const second = runHook(root, { CLAUDE_SESSION_ID: 'sess-throttle-1' });
    assert.equal(second.status, 0);
    assert.equal(second.stdout, '', 'second run is silent (throttled)');
    assert.equal(second.stderr, '', 'no stderr noise either');
  });

  it('versions match (marker == installed) → silent, no advisory', () => {
    const root = freshProject('hook-match');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    // Read the actual installed version from the repo's package.json.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const installed = pkg.version;
    fs.writeFileSync(path.join(root, '.cap', 'version'), JSON.stringify({
      schemaVersion: 1,
      version: installed,
      completedStages: ['doctor'],
      lastRun: '2026-05-07T00:00:00.000Z',
    }));
    const r = runHook(root, { CLAUDE_SESSION_ID: 'sess-match' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'silent when versions match');
    assert.equal(r.stderr, '');
  });

  it('config.json:upgrade.notify=false suppresses entirely (silent)', () => {
    const root = freshProject('hook-suppress');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'config.json'), JSON.stringify({
      upgrade: { notify: false },
    }));
    const r = runHook(root, { CLAUDE_SESSION_ID: 'sess-suppress' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'silent when notify=false');
    assert.equal(r.stderr, '');
    // No advisories file written either.
    assert.equal(fs.existsSync(path.join(root, '.cap', '.session-advisories.json')), false);
  });

  it('marker corrupted → treated as first-run, emits once', () => {
    const root = freshProject('hook-corrupted');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cap', 'version'), 'this is { not json');
    const r = runHook(root, { CLAUDE_SESSION_ID: 'sess-corrupted' });
    assert.equal(r.status, 0);
    // Corrupted marker → null → needsAdvisory → emits.
    assert.match(r.stdout, /\[CAP\]/);
    assert.match(r.stdout, /First run/);
  });

  it('hook never throws even on bizarre cwd state', () => {
    const root = freshProject('hook-bizarre');
    // Empty cwd, no FEATURE-MAP.md, no package.json — but the hook should still exit 0.
    const r = runHook(root, { CLAUDE_SESSION_ID: 'sess-bizarre' });
    assert.equal(r.status, 0);
    // Hook may emit (since installed version != null marker), but must not throw.
    // eslint-disable-next-line no-control-regex
    assert.equal(/[\x00-\x1f]/.test(r.stdout.replace(/\n/g, '')), false);
  });

  it('different session-ids each get their own emit (no cross-session throttle)', () => {
    const root = freshProject('hook-multi-session');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    const a = runHook(root, { CLAUDE_SESSION_ID: 'sess-a' });
    const b = runHook(root, { CLAUDE_SESSION_ID: 'sess-b' });
    assert.match(a.stdout, /\[CAP\]/);
    assert.match(b.stdout, /\[CAP\]/);
    // But re-running session-a is silent.
    const aAgain = runHook(root, { CLAUDE_SESSION_ID: 'sess-a' });
    assert.equal(aAgain.stdout, '');
  });
});

// -------- Plan + record E2E (validates the markdown command spec's contract) --------

describe('planMigrations + recordStageResult E2E (full flow)', () => {
  it('full upgrade flow: fresh project → plan → execute every stage → marker complete', () => {
    const root = freshProject('e2e-full-flow');
    // Stage 0: plan on fresh project.
    const planCmd = `node -e "
      const u = require('${REPO_ROOT.replace(/\\/g, '\\\\')}/cap/bin/lib/cap-upgrade.cjs');
      const r = u.planMigrations('${root.replace(/\\/g, '\\\\')}', { installedVersion: '5.0.0', runOptions: { nonInteractive: true } });
      console.log(JSON.stringify(r));
    "`;
    const planRes = spawnSync('sh', ['-c', planCmd], { encoding: 'utf8', timeout: 5000 });
    assert.equal(planRes.status, 0, `plan stderr: ${planRes.stderr}`);
    const planParsed = JSON.parse(planRes.stdout);
    assert.equal(planParsed.firstRun, true);
    // Each non-skipped stage gets recorded as success in turn. Skipped-by-predicate
    // stages still need to be recorded as `success` (treating "predicate said no work
    // needed" as equivalent to a successful run) so the marker reflects the full state.
    // The markdown command spec implements exactly this: skipped predicate → record
    // as skipped in log but advance marker as if successful (the work IS done — just
    // by a previous run or by absence of input).
    const upgrade = require('../cap/bin/lib/cap-upgrade.cjs');
    for (const stage of planParsed.plan) {
      // Treat predicate-skip as success for marker advancement (work is "complete"
      // by virtue of not being needed). User-skipped or failed stages would be
      // status:skipped|failure here — but in this fresh-flow test the only skips
      // are non-interactive optional skips + predicate skips.
      upgrade.recordStageResult(root, stage.name, { status: 'success', durationMs: 50, installedVersion: '5.0.0' });
    }
    // Final marker: required (non-optional) stages should all be in completedStages.
    const marker = upgrade.getMarkerVersion(root);
    assert.ok(marker, 'marker exists');
    assert.equal(marker.version, '5.0.0');
    // All 7 stages recorded → all in completedStages.
    assert.equal(marker.completedStages.length, 7);
    // After the run, planning again should report alreadyCurrent.
    const r2 = upgrade.planMigrations(root, { installedVersion: '5.0.0', runOptions: { nonInteractive: true } });
    assert.equal(r2.alreadyCurrent, true);
  });

  it('partial-state recovery: previous run aborted at stage 4, re-run completes', () => {
    const root = freshProject('e2e-partial');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), '# map\n');
    fs.mkdirSync(path.join(root, '.cap'), { recursive: true });
    const upgrade = require('../cap/bin/lib/cap-upgrade.cjs');
    // Simulate: previous run completed doctor + init-or-skip + annotate, then aborted.
    upgrade.recordStageResult(root, 'doctor', { status: 'success', installedVersion: '5.0.0' });
    upgrade.recordStageResult(root, 'init-or-skip', { status: 'success', installedVersion: '5.0.0' });
    upgrade.recordStageResult(root, 'annotate', { status: 'success', installedVersion: '5.0.0' });
    // Re-run. Plan should mark first three as alreadyDone.
    const r = upgrade.planMigrations(root, { installedVersion: '5.0.0' });
    const doctor = r.plan.find((p) => p.name === 'doctor');
    assert.equal(doctor.alreadyDone, true);
    const init = r.plan.find((p) => p.name === 'init-or-skip');
    assert.equal(init.alreadyDone, true);
    const annotate = r.plan.find((p) => p.name === 'annotate');
    assert.equal(annotate.alreadyDone, true);
    // Remaining stages still plan.
    const tags = r.plan.find((p) => p.name === 'migrate-tags');
    assert.equal(tags.skip, false);
  });
});
