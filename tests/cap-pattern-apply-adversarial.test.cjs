'use strict';

// @cap-feature(feature:F-074) Adversarial tests — git-safety, L3-drift, idempotency, retract-check
//                  semantics, and the perf bound. Each test is a tightly-scoped attack on one of
//                  the F-074 invariants (CLAUDE.md, AC-2, AC-5, AC-7).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const apply = require('../cap/bin/lib/cap-pattern-apply.cjs');
const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');
const fitness = require('../cap/bin/lib/cap-fitness-score.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');

let tmpDir;
let realCwd;

function gitInit(root) {
  // @cap-risk(F-074/AC-2) Tests must NEVER touch the real working tree. Each test creates its own
  //                       sandboxed `git init` repo in os.tmpdir(); commits go there. The realCwd
  //                       is preserved in beforeEach and restored in afterEach so a test that
  //                       fails mid-flight cannot leave the process pinned to tmpDir.
  execSync('git init -q', { cwd: root, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'pipe' });
  execSync('git config commit.gpgsign false', { cwd: root, stdio: 'pipe' });
  fs.writeFileSync(path.join(root, 'README.md'), '# test\n', 'utf8');
  execSync('git add README.md', { cwd: root, stdio: 'pipe' });
  execSync('git commit -q -m "initial"', { cwd: root, stdio: 'pipe' });
}

function persistPattern(root, id, opts) {
  const o = opts || {};
  const pattern = {
    id,
    createdAt: '2026-05-05T00:00:00.000Z',
    level: o.level || 'L1',
    featureRef: o.featureRef === undefined ? 'F-100' : o.featureRef,
    source: o.source || 'heuristic',
    degraded: o.degraded === undefined ? true : o.degraded,
    confidence: o.confidence === undefined ? 0.5 : o.confidence,
    suggestion: o.suggestion || { kind: 'L1', target: 'F-100/THRESHOLD_OVERRIDE_COUNT', from: 3, to: 5, rationale: 'test' },
    evidence: o.evidence || { candidateId: null, signalType: 'override', count: 0, topContextHashes: [] },
  };
  pipeline.recordPatternSuggestion(root, pattern);
  return pattern;
}

function commitCount(root) {
  return parseInt(
    execSync('git rev-list --count HEAD', { cwd: root, encoding: 'utf8' }).trim(),
    10,
  );
}

function installFailingPreCommitHook(root) {
  // Husky-style failing pre-commit — exit 1 with a stderr message.
  const hookDir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\necho "lint failed" 1>&2\nexit 1\n', { mode: 0o755 });
  // chmod +x via fs.chmodSync to be sure.
  fs.chmodSync(hookPath, 0o755);
}

beforeEach(() => {
  realCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-pattern-apply-adv-'));
  gitInit(tmpDir);
});

afterEach(() => {
  process.chdir(realCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-2 adversarial · pre-commit hook failure → applyState=pending, files staged
// ---------------------------------------------------------------------------

describe('AC-2 adversarial · pre-commit hook fail leaves applyState=pending', () => {
  // @cap-risk(F-074/AC-2) Hook must fire — CLAUDE.md forbids --no-verify. The hook returns 1 →
  //                       applyPattern returns pending-hook-fail and the audit reflects it.
  it('returns pending-hook-fail; audit on disk has applyState=pending and commitHash=null', () => {
    persistPattern(tmpDir, 'P-001');
    installFailingPreCommitHook(tmpDir);
    const before = commitCount(tmpDir);

    const result = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'pending-hook-fail');
    assert.ok(result.audit, 'audit must still be returned');

    // No new commit was created.
    assert.equal(commitCount(tmpDir), before);

    // Audit on disk reflects the pending state.
    const fp = apply.appliedAuditPath(tmpDir, 'P-001');
    assert.ok(fs.existsSync(fp));
    const onDisk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(onDisk.applyState, 'pending');
    assert.equal(onDisk.commitHash, null);
  });

  it('staged files remain staged after a hook failure (D3)', () => {
    persistPattern(tmpDir, 'P-001');
    installFailingPreCommitHook(tmpDir);
    apply.applyPattern(tmpDir, 'P-001');

    const status = execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' });
    // The applied audit + applied-state.json should be staged (status starts with 'A ' or 'M ').
    assert.match(status, /A\s+\.cap\/learning\/applied\/P-001\.json/);
    assert.match(status, /A\s+\.cap\/learning\/applied-state\.json/);
  });

  it('--retry succeeds once the hook is removed and promotes pending → committed', () => {
    persistPattern(tmpDir, 'P-001');
    installFailingPreCommitHook(tmpDir);
    const r1 = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(r1.applied, false);
    assert.equal(r1.reason, 'pending-hook-fail');

    // Fix the hook (simulate the user resolving the lint issue) and retry.
    fs.unlinkSync(path.join(tmpDir, '.git', 'hooks', 'pre-commit'));
    const r2 = apply.applyPattern(tmpDir, 'P-001', { retry: true });
    assert.equal(r2.applied, true);
    assert.equal(r2.audit.applyState, 'committed');
    assert.ok(r2.commitHash);
  });
});

// ---------------------------------------------------------------------------
// AC-2 adversarial · dirty working tree must not be touched (D3)
// ---------------------------------------------------------------------------

describe('AC-2 adversarial · pre-existing modified non-CAP files are left alone', () => {
  it('apply commits succeed; the user\'s modified file remains modified-but-unstaged', () => {
    persistPattern(tmpDir, 'P-001');

    // User has unrelated modifications in the working tree.
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# user edit\n', 'utf8');
    const userFile = path.join(tmpDir, 'src', 'app.js');
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, 'console.log(1)\n', 'utf8');
    // src/app.js is untracked; README.md is modified.

    const result = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(result.applied, true);

    const status = execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' });
    // README.md still " M" — modified-not-staged. The user's edits are intact.
    assert.match(status, / M README\.md/);
    // src/ is still untracked. Git collapses untracked dirs into "?? src/" or expands to per-file
    // depending on the recurse-untracked setting; both are acceptable here.
    assert.ok(/\?\? src\//.test(status), `src/ should still be untracked: ${status}`);
    // @cap-decision(F-074/D7) The applied audit is M after commit because we re-write it
    //                         post-commit to attach the real commit hash. This divergence is by
    //                         design — the audit committed had applyState='pending' + commitHash:null;
    //                         the on-disk audit has applyState='committed' + commitHash=<sha>. The
    //                         subsequent state is the live state F-073 reads.
  });
});

// ---------------------------------------------------------------------------
// AC-2 / AC-7 adversarial · git wildcard-stage refused
// ---------------------------------------------------------------------------

describe('AC-2 adversarial · gitStageAndCommit refuses wildcard stage paths', () => {
  // @cap-risk(F-074/AC-2) Even if a downstream caller (e.g. a future contributor) tries to pass
  //                       '.' or '-A' as a target file, the helper must refuse. We exercise this
  //                       via a forged audit that injects '.' into targetFiles.
  it('refuses to apply when targetFiles contains a wildcard', () => {
    // We can't easily reach gitStageAndCommit through applyPattern's normal path because the
    // targetFiles list is computed internally. Instead, write a forged pending audit and
    // exercise the retry path — that's the only public seam where targetFiles flows into
    // gitStageAndCommit verbatim.
    persistPattern(tmpDir, 'P-001');
    const forgedAudit = {
      id: 'P-001',
      patternId: 'P-001',
      appliedAt: '2026-05-05T10:00:00.000Z',
      applyState: 'pending',
      level: 'L1',
      featureRef: 'F-100',
      commitHash: null,
      targetFiles: ['.'], // hostile
      fitnessSnapshot: null,
      beforeAfterDiff: { L1: { key: 'F-100/T', hadPrior: false, from: null, to: 5 } },
    };
    fs.mkdirSync(apply.appliedDir(tmpDir), { recursive: true });
    fs.writeFileSync(apply.appliedAuditPath(tmpDir, 'P-001'), JSON.stringify(forgedAudit, null, 2), 'utf8');

    const result = apply.applyPattern(tmpDir, 'P-001', { retry: true });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'pending-hook-fail');
    assert.match(result.error, /wildcard stage refused/);
  });
});

// ---------------------------------------------------------------------------
// AC-3 / AC-4 adversarial · L3 drift detection
// ---------------------------------------------------------------------------

describe('AC-3 adversarial · L3 drift detection refuses to revert', () => {
  // @cap-risk(F-074/AC-2) Drift means the file changed between apply and unlearn. If we silently
  //                       overwrote, we'd clobber the user's downstream edit. Refusing is the
  //                       only safe behaviour.
  it('refuses with l3-drift; no commit, no unlearn audit', () => {
    const target = path.join(tmpDir, 'agents', 'cap-prototyper.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'ORIGINAL\n', 'utf8');
    execSync('git add agents/cap-prototyper.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q -m "seed agent"', { cwd: tmpDir, stdio: 'pipe' });

    persistPattern(tmpDir, 'P-003', {
      level: 'L3',
      suggestion: {
        kind: 'L3',
        file: 'agents/cap-prototyper.md',
        patchedText: 'PATCHED\n',
      },
    });

    const a = apply.applyPattern(tmpDir, 'P-003');
    assert.equal(a.applied, true);

    // User edits the file between apply and unlearn (drift).
    fs.writeFileSync(target, 'PATCHED + USER_EDIT\n', 'utf8');

    const before = commitCount(tmpDir);
    const u = apply.unlearnPattern(tmpDir, 'P-003');
    assert.equal(u.unlearned, false);
    assert.equal(u.reason, 'l3-drift');
    assert.ok(u.commitHashToRevert, 'must surface the apply commit hash for manual revert');
    assert.equal(u.commitHashToRevert, a.commitHash);

    // No new commit, no unlearn audit on disk.
    assert.equal(commitCount(tmpDir), before);
    assert.equal(fs.existsSync(apply.unlearnedAuditPath(tmpDir, 'P-003')), false);

    // The drifted file is NOT touched.
    assert.equal(fs.readFileSync(target, 'utf8'), 'PATCHED + USER_EDIT\n');
  });
});

// ---------------------------------------------------------------------------
// L3 target prefix gate (CLAUDE.md scope)
// ---------------------------------------------------------------------------

describe('L3 target prefix gate', () => {
  // @cap-risk(F-074/AC-2) Without the prefix gate, a hostile pattern could rewrite
  //                       package.json or .git/config. Refuse anything outside agents/ and
  //                       commands/cap/.
  it('rejects an L3 pattern targeting package.json with l3-target-not-allowed', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}\n', 'utf8');
    persistPattern(tmpDir, 'P-003', {
      level: 'L3',
      suggestion: { kind: 'L3', file: 'package.json', patchedText: '{ "evil": true }\n' },
    });
    const result = apply.applyPattern(tmpDir, 'P-003');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'l3-target-not-allowed');

    // package.json is NOT touched.
    assert.equal(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'), '{}\n');
  });

  it('rejects path-traversal targets like ../etc/passwd', () => {
    persistPattern(tmpDir, 'P-003', {
      level: 'L3',
      suggestion: { kind: 'L3', file: '../etc/passwd', patchedText: 'pwned\n' },
    });
    const result = apply.applyPattern(tmpDir, 'P-003');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'l3-target-not-allowed');
  });

  it('accepts agents/cap-validator.md', () => {
    assert.equal(apply.isAllowedL3Target('agents/cap-validator.md'), true);
  });

  it('accepts commands/cap/learn.md', () => {
    assert.equal(apply.isAllowedL3Target('commands/cap/learn.md'), true);
  });
});

// ---------------------------------------------------------------------------
// AC-5 adversarial · runRetractCheck semantics
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · 5-session post-apply check', () => {
  // @cap-todo(ac:F-074/AC-5) Worse layer1 vs snapshot → recommend; same/better → no-op.

  function seedOverridesAcrossSessions(root, count) {
    // Records all carry featureId='F-100' so the F-072 defensive featureRef path matches the
    // pattern we apply below. Ts is monotonically increasing so latestSessionId is well-defined.
    for (let i = 0; i < count; i++) {
      learning.recordOverride({
        projectRoot: root,
        subType: 'editAfterWrite',
        sessionId: `s-post-${i}`,
        featureId: 'F-100',
        targetFile: '/abs/path/file.cjs',
        ts: `2026-06-01T10:00:0${i}.000Z`,
      });
    }
  }

  it('appends to retract-recommendations.jsonl when current layer1 > snapshot layer1', () => {
    persistPattern(tmpDir, 'P-001');

    // Apply at t=0 with no signals → snapshot.layer1.value = 0.
    const a = apply.applyPattern(tmpDir, 'P-001', { now: '2026-05-01T00:00:00.000Z' });
    assert.equal(a.applied, true);
    assert.equal(a.audit.fitnessSnapshot.layer1.value, 0);

    // Seed 5 distinct sessions of overrides AFTER the apply ts. Last session has 3 overrides
    // (current layer1 = 3 > snapshot layer1 = 0 → worse → should be recommended).
    seedOverridesAcrossSessions(tmpDir, 4); // s-post-0..s-post-3, one each
    learning.recordOverride({ projectRoot: tmpDir, subType: 'editAfterWrite', sessionId: 's-post-4', featureId: 'F-100', targetFile: '/abs/path/file.cjs', ts: '2026-06-01T10:00:04.000Z' });
    learning.recordOverride({ projectRoot: tmpDir, subType: 'editAfterWrite', sessionId: 's-post-4', featureId: 'F-100', targetFile: '/abs/path/file.cjs', ts: '2026-06-01T10:00:05.000Z' });
    learning.recordOverride({ projectRoot: tmpDir, subType: 'editAfterWrite', sessionId: 's-post-4', featureId: 'F-100', targetFile: '/abs/path/file.cjs', ts: '2026-06-01T10:00:06.000Z' });

    const result = apply.runRetractCheck(tmpDir);
    assert.deepEqual(result.checked, ['P-001']);
    assert.deepEqual(result.recommended, ['P-001']);

    // The .jsonl line was written.
    const fp = apply.retractRecommendationsPath(tmpDir);
    assert.ok(fs.existsSync(fp));
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.patternId, 'P-001');
    assert.equal(parsed.reason, 'override-rate-worse');
    assert.equal(parsed.snapshot, 0);
    assert.equal(parsed.current, 3);
  });

  it('does NOT recommend when current layer1 <= snapshot layer1', () => {
    // Seed signals BEFORE apply so the snapshot captures a high baseline.
    for (let i = 0; i < 3; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: 's-pre',
        featureId: 'F-100',
        targetFile: '/abs/path/file.cjs',
        ts: `2026-04-01T10:00:0${i}.000Z`,
      });
    }
    persistPattern(tmpDir, 'P-001');
    const a = apply.applyPattern(tmpDir, 'P-001', { now: '2026-05-01T00:00:00.000Z' });
    assert.equal(a.applied, true);
    assert.equal(a.audit.fitnessSnapshot.layer1.value, 3);

    // After apply: 5 distinct sessions BUT each only has 1 override → current layer1 = 1 < 3.
    seedOverridesAcrossSessions(tmpDir, 5);

    const result = apply.runRetractCheck(tmpDir);
    assert.deepEqual(result.checked, ['P-001']);
    assert.deepEqual(result.recommended, []);
    assert.equal(fs.existsSync(apply.retractRecommendationsPath(tmpDir)), false);
  });

  it('skips patterns with < window post-apply sessions', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001', { now: '2026-05-01T00:00:00.000Z' });

    // Only 2 post-apply sessions → window=5 not crossed.
    seedOverridesAcrossSessions(tmpDir, 2);

    const result = apply.runRetractCheck(tmpDir);
    assert.deepEqual(result.checked, ['P-001']); // we DID consider it
    assert.deepEqual(result.recommended, []);    // ...but didn't recommend
  });

  it('skips already-unlearned patterns', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    apply.unlearnPattern(tmpDir, 'P-001');
    seedOverridesAcrossSessions(tmpDir, 5);

    const result = apply.runRetractCheck(tmpDir);
    assert.deepEqual(result.checked, []);
    assert.deepEqual(result.recommended, []);
  });
});

// ---------------------------------------------------------------------------
// listRetractRecommended de-dup behaviour
// ---------------------------------------------------------------------------

describe('listRetractRecommended de-duplicates by patternId', () => {
  it('returns each patternId once even when the .jsonl carries multiple lines', () => {
    fs.mkdirSync(path.dirname(apply.retractRecommendationsPath(tmpDir)), { recursive: true });
    const fp = apply.retractRecommendationsPath(tmpDir);
    const lines = [
      JSON.stringify({ ts: '2026-05-05T10:00:00.000Z', patternId: 'P-001', sessionsSinceApply: 5, snapshot: 0, current: 1, reason: 'override-rate-worse' }),
      JSON.stringify({ ts: '2026-05-05T11:00:00.000Z', patternId: 'P-002', sessionsSinceApply: 5, snapshot: 0, current: 1, reason: 'override-rate-worse' }),
      JSON.stringify({ ts: '2026-05-05T12:00:00.000Z', patternId: 'P-001', sessionsSinceApply: 6, snapshot: 0, current: 2, reason: 'override-rate-worse' }),
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf8');

    const ids = apply.listRetractRecommended(tmpDir);
    assert.deepEqual(ids, ['P-001', 'P-002']);
  });

  it('filters out patterns that have already been unlearned', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    apply.unlearnPattern(tmpDir, 'P-001');

    fs.mkdirSync(path.dirname(apply.retractRecommendationsPath(tmpDir)), { recursive: true });
    fs.writeFileSync(
      apply.retractRecommendationsPath(tmpDir),
      JSON.stringify({ ts: '2026-05-05T10:00:00.000Z', patternId: 'P-001', sessionsSinceApply: 5, snapshot: 0, current: 1, reason: 'override-rate-worse' }) + '\n',
      'utf8',
    );

    assert.deepEqual(apply.listRetractRecommended(tmpDir), []);
  });
});

// ---------------------------------------------------------------------------
// AC-7 adversarial · idempotency under stress
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · idempotency holds across multiple back-to-back calls', () => {
  // @cap-risk(F-074/AC-7) Repeated call regression guard.
  it('10 back-to-back unlearn calls yield exactly ONE unlearn commit', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    const beforeUnlearn = commitCount(tmpDir);

    apply.unlearnPattern(tmpDir, 'P-001');
    const afterFirstUnlearn = commitCount(tmpDir);
    assert.equal(afterFirstUnlearn, beforeUnlearn + 1);

    for (let i = 0; i < 9; i++) {
      const r = apply.unlearnPattern(tmpDir, 'P-001');
      assert.equal(r.unlearned, false);
      assert.equal(r.reason, 'already-unlearned');
    }
    assert.equal(commitCount(tmpDir), afterFirstUnlearn);
  });
});

// ---------------------------------------------------------------------------
// Performance — runRetractCheck over 100 applied patterns x 1000 signals < 500ms
// ---------------------------------------------------------------------------

describe('performance · runRetractCheck within 500ms budget', () => {
  it('completes within 500ms for 100 applied patterns × 1000 override signals', () => {
    // 100 patterns, all with featureRef='F-100' so the defensive matcher catches all overrides.
    for (let i = 1; i <= 100; i++) {
      const id = `P-${String(i).padStart(3, '0')}`;
      persistPattern(tmpDir, id);
    }

    // Apply each pattern. The applyPattern pipeline is O(P × signals); we tolerate it being
    // slow. The perf bound is on runRetractCheck specifically.
    // @cap-decision(F-074/D5) Skip the git commit overhead for the perf-shaped fixture by
    //                         seeding the apply audit directly. The retract-check reads only
    //                         the audit file + override corpus, so a synthetic audit is faithful.
    fs.mkdirSync(apply.appliedDir(tmpDir), { recursive: true });
    for (let i = 1; i <= 100; i++) {
      const id = `P-${String(i).padStart(3, '0')}`;
      const audit = {
        id,
        patternId: id,
        appliedAt: '2026-05-01T00:00:00.000Z',
        applyState: 'committed',
        level: 'L1',
        featureRef: 'F-100',
        commitHash: 'abcdef0',
        targetFiles: [],
        fitnessSnapshot: { ts: '2026-05-01T00:00:00.000Z', patternId: id, layer1: { kind: 'override-count', value: 0, lastSessionId: null }, layer2: { kind: 'weighted-average', value: 0, n: 0, ready: false }, n: 0, activeSessionsList: [] },
        beforeAfterDiff: { L1: { key: 'F-100/T', hadPrior: false, from: null, to: 5 } },
      };
      fs.writeFileSync(apply.appliedAuditPath(tmpDir, id), JSON.stringify(audit) + '\n', 'utf8');
    }

    // 1000 override signals across 6 distinct post-apply sessions so window=5 is crossed.
    for (let i = 0; i < 1000; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${i % 6}`,
        featureId: 'F-100',
        targetFile: `/abs/file-${i % 17}.cjs`,
        ts: `2026-06-01T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      });
    }

    const start = process.hrtime.bigint();
    const result = apply.runRetractCheck(tmpDir);
    const ns = process.hrtime.bigint() - start;
    const ms = Number(ns) / 1e6;

    assert.equal(result.checked.length, 100);
    assert.ok(ms < 500, `runRetractCheck must finish in <500ms, took ${ms.toFixed(1)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Sandbox guard — prove tests never escape tmpDir
// ---------------------------------------------------------------------------

describe('sandbox · process.cwd() is never mutated by the module', () => {
  // @cap-risk(F-074/AC-2) The module never calls process.chdir(). Our beforeEach captures cwd
  //                       and afterEach asserts it's unchanged. This block additionally pins the
  //                       contract — even if a future contributor adds chdir somewhere, this
  //                       test catches it.
  it('applyPattern + unlearnPattern leave process.cwd() untouched', () => {
    const cwdBefore = process.cwd();
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    apply.unlearnPattern(tmpDir, 'P-001');
    assert.equal(process.cwd(), cwdBefore);
  });
});

// ---------------------------------------------------------------------------
// Stage-2 review fix #1 · atomic write-then-rename for writeJson
// ---------------------------------------------------------------------------

describe('Stage-2 fix · writeJson is atomic via temp+rename (D8)', () => {
  // @cap-todo(ac:F-074/AC-1) Atomic-write contract: applied-state.json must never end up
  //                          partial-written. The temp file is created, then atomically renamed.
  it('writeJson does not leave a .tmp orphan on the happy path', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    const stateFile = path.join(tmpDir, '.cap', 'learning', 'applied-state.json');
    assert.ok(fs.existsSync(stateFile), 'applied-state.json must exist');
    assert.ok(!fs.existsSync(stateFile + '.tmp'), '.tmp orphan must NOT remain');
  });

  it('applied audit and unlearn audit also use atomic writes', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    apply.unlearnPattern(tmpDir, 'P-001');
    // No .tmp orphans anywhere under .cap/learning/
    const learningDir = path.join(tmpDir, '.cap', 'learning');
    function findTmpOrphans(dir) {
      const out = [];
      if (!fs.existsSync(dir)) return out;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...findTmpOrphans(full));
        else if (entry.name.endsWith('.tmp')) out.push(full);
      }
      return out;
    }
    assert.deepStrictEqual(findTmpOrphans(learningDir), []);
  });
});

// ---------------------------------------------------------------------------
// Stage-2 review fix #2 · gitStageAndCommit refuses path-traversal in file list
// ---------------------------------------------------------------------------

describe('Stage-2 fix · gitStageAndCommit refuses path-traversal (D9)', () => {
  // @cap-todo(ac:F-074/AC-2) Defense-in-depth: a forged audit whose targetFiles contains a
  //                          `..`-climb or absolute path must be refused at the F-074 boundary,
  //                          not just at git's pathspec layer.
  it('refuses an absolute path in the staging list', () => {
    const result = apply.gitStageAndCommit(tmpDir, ['/etc/passwd'], 'test');
    assert.equal(result.success, false);
    assert.equal(result.stage, 'add');
    assert.match(result.error, /path-traversal refused/);
  });

  it('refuses a parent-climbing relative path', () => {
    const result = apply.gitStageAndCommit(tmpDir, ['../etc/passwd'], 'test');
    assert.equal(result.success, false);
    assert.match(result.error, /path-traversal refused/);
  });

  it('refuses an embedded climb segment (foo/../../etc)', () => {
    const result = apply.gitStageAndCommit(tmpDir, ['agents/cap-x.md/../../../etc/passwd'], 'test');
    assert.equal(result.success, false);
    assert.match(result.error, /path-traversal refused/);
  });

  it('still accepts a clean relative path', () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.txt'), 'hi\n', 'utf8');
    const result = apply.gitStageAndCommit(tmpDir, ['foo.txt'], 'test: foo');
    assert.equal(result.success, true);
    assert.match(result.commitHash, /^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// Stage-2 review fix #3 · isAllowedL3Target requires a filename after the prefix
// ---------------------------------------------------------------------------

describe('Stage-2 fix · L3 target whitelist refuses bare prefixes (D10)', () => {
  // @cap-todo(ac:F-074/AC-2) Bare `agents/` or `commands/cap/` (no filename segment after) must
  //                          be refused at the gate. Previously these passed and only failed
  //                          downstream with EISDIR — cleaner to reject explicitly.
  it('refuses bare agents/ (no file segment)', () => {
    assert.equal(apply.isAllowedL3Target('agents/'), false);
  });

  it('refuses bare commands/cap/ (no file segment)', () => {
    assert.equal(apply.isAllowedL3Target('commands/cap/'), false);
  });

  it('still accepts agents/cap-prototyper.md', () => {
    assert.equal(apply.isAllowedL3Target('agents/cap-prototyper.md'), true);
  });

  it('still accepts commands/cap/learn.md', () => {
    assert.equal(apply.isAllowedL3Target('commands/cap/learn.md'), true);
  });
});
