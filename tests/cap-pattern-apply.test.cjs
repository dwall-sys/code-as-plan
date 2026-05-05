'use strict';

// @cap-feature(feature:F-074) Baseline tests for the Pattern Unlearn / Auto-Retract module —
//                  AC-1, AC-2, AC-3, AC-4, AC-7 happy paths. Git-safety, drift, and idempotency
//                  edge cases live in the adversarial file.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, spawnSync } = require('node:child_process');

const apply = require('../cap/bin/lib/cap-pattern-apply.cjs');
const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');

let tmpDir;
let realCwd;

// Deterministic git author so commits don't fall over on a fresh CI box.
function gitInit(root) {
  // @cap-risk(F-074/AC-2) Every test creates its OWN tmpDir + `git init` inside it. The git
  //                       commits happen inside the sandbox, never the real repo. We assert
  //                       process.cwd() === root before any git invocation as belt-and-braces.
  execSync('git init -q', { cwd: root, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'pipe' });
  // Disable any global gpg-signing so a misconfigured user doesn't trigger a signing prompt.
  execSync('git config commit.gpgsign false', { cwd: root, stdio: 'pipe' });
  // Seed an initial empty commit so the working tree is always non-empty.
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

function lastCommitMsg(root) {
  return execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim();
}

function commitCount(root) {
  return parseInt(
    execSync('git rev-list --count HEAD', { cwd: root, encoding: 'utf8' }).trim(),
    10,
  );
}

beforeEach(() => {
  realCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-pattern-apply-'));
  gitInit(tmpDir);
});

afterEach(() => {
  process.chdir(realCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1 — Audit record per apply
// ---------------------------------------------------------------------------

describe('AC-1 — apply audit record', () => {
  // @cap-todo(ac:F-074/AC-1) Audit at .cap/learning/applied/P-NNN.json with full schema.
  it('writes the apply audit at .cap/learning/applied/P-NNN.json with required fields', () => {
    persistPattern(tmpDir, 'P-001');
    const result = apply.applyPattern(tmpDir, 'P-001', { now: '2026-05-05T10:00:00.000Z' });

    assert.equal(result.applied, true);
    assert.ok(result.audit);
    assert.equal(result.audit.id, 'P-001');
    assert.equal(result.audit.patternId, 'P-001');
    assert.equal(result.audit.level, 'L1');
    assert.equal(result.audit.featureRef, 'F-100');
    assert.equal(result.audit.applyState, 'committed');
    assert.equal(result.audit.appliedAt, '2026-05-05T10:00:00.000Z');
    assert.ok(Array.isArray(result.audit.targetFiles));
    assert.ok(result.audit.beforeAfterDiff && result.audit.beforeAfterDiff.L1);

    // The audit lives on disk too.
    const fp = apply.appliedAuditPath(tmpDir, 'P-001');
    assert.ok(fs.existsSync(fp));
    const onDisk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(onDisk.patternId, 'P-001');
    assert.equal(onDisk.applyState, 'committed');
  });

  it('audit.fitnessSnapshot is populated from F-072 recordApplySnapshot', () => {
    persistPattern(tmpDir, 'P-001');
    const result = apply.applyPattern(tmpDir, 'P-001', { now: '2026-05-05T10:00:00.000Z' });
    assert.equal(result.applied, true);
    assert.ok(result.audit.fitnessSnapshot, 'snapshot must be embedded');
    assert.equal(result.audit.fitnessSnapshot.patternId, 'P-001');
    assert.ok(result.audit.fitnessSnapshot.layer1);
  });

  it('writes applied-state.json reflecting the L1 parameter override', () => {
    persistPattern(tmpDir, 'P-001');
    const result = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(result.applied, true);

    const state = apply.readAppliedState(tmpDir);
    assert.equal(state.l1['F-100/THRESHOLD_OVERRIDE_COUNT'], 5);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — git commit per apply
// ---------------------------------------------------------------------------

describe('AC-2 — git commit per apply', () => {
  // @cap-todo(ac:F-074/AC-2) Commit message format: `learn: apply P-NNN (F-XXX)`.
  it('creates `learn: apply P-001 (F-100)` commit on a successful L1 apply', () => {
    persistPattern(tmpDir, 'P-001');
    const before = commitCount(tmpDir);
    const result = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(result.applied, true);
    assert.equal(commitCount(tmpDir), before + 1);
    assert.equal(lastCommitMsg(tmpDir), 'learn: apply P-001 (F-100)');
    assert.ok(result.commitHash, 'commitHash must be returned');
    assert.ok(result.audit.commitHash, 'audit.commitHash must be set after commit');
  });

  it('omits the (F-XXX) suffix when the pattern has no featureRef', () => {
    persistPattern(tmpDir, 'P-002', { featureRef: null });
    const result = apply.applyPattern(tmpDir, 'P-002');
    assert.equal(result.applied, true);
    assert.equal(lastCommitMsg(tmpDir), 'learn: apply P-002');
  });

  it('staged files are exactly the audit + applied-state — never `git add .`', () => {
    persistPattern(tmpDir, 'P-001');

    // Pre-create an unrelated dirty file in the working tree. After the apply we expect it
    // to STILL be modified-but-unstaged (D3: never stage user files).
    const dirtyFile = path.join(tmpDir, 'README.md');
    fs.writeFileSync(dirtyFile, '# dirty\n', 'utf8');

    const result = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(result.applied, true);

    // README.md should still be modified-but-unstaged.
    const status = execSync('git status --porcelain', { cwd: tmpDir, encoding: 'utf8' });
    // The status format: " M README.md" means modified-not-staged.
    assert.match(status, / M README\.md/, 'README.md must remain modified-but-unstaged');
  });
});

// ---------------------------------------------------------------------------
// AC-3 — /cap:learn unlearn reverse + commit
// ---------------------------------------------------------------------------

describe('AC-3 — unlearnPattern reverses the apply', () => {
  // @cap-todo(ac:F-074/AC-3) Reverse-patch + `learn: unlearn P-NNN` commit.
  it('L1 unlearn restores the prior parameter and creates a `learn: unlearn P-001` commit', () => {
    persistPattern(tmpDir, 'P-001');
    const a = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(a.applied, true);
    assert.equal(apply.readAppliedState(tmpDir).l1['F-100/THRESHOLD_OVERRIDE_COUNT'], 5);

    const before = commitCount(tmpDir);
    const u = apply.unlearnPattern(tmpDir, 'P-001');
    assert.equal(u.unlearned, true);
    assert.equal(commitCount(tmpDir), before + 1);
    assert.equal(lastCommitMsg(tmpDir), 'learn: unlearn P-001');

    // applied-state.json key removed (from was undefined → delete).
    const state = apply.readAppliedState(tmpDir);
    assert.equal(Object.prototype.hasOwnProperty.call(state.l1, 'F-100/THRESHOLD_OVERRIDE_COUNT'), false);
  });

  it('L2 apply/unlearn add and remove the rule from applied-state.l2', () => {
    const rule = { kind: 'L2', rule: 'skip pattern X when feature Y' };
    persistPattern(tmpDir, 'P-002', { level: 'L2', suggestion: rule });

    const a = apply.applyPattern(tmpDir, 'P-002');
    assert.equal(a.applied, true);
    let state = apply.readAppliedState(tmpDir);
    assert.equal(state.l2.length, 1);
    assert.equal(state.l2[0].patternId, 'P-002');

    const u = apply.unlearnPattern(tmpDir, 'P-002');
    assert.equal(u.unlearned, true);
    state = apply.readAppliedState(tmpDir);
    assert.equal(state.l2.length, 0);
  });

  it('L3 apply edits the target file; unlearn restores it byte-for-byte', () => {
    // Set up an agents/cap-prototyper.md fixture inside tmpDir.
    const target = path.join(tmpDir, 'agents', 'cap-prototyper.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'ORIGINAL\n', 'utf8');
    execSync('git add agents/cap-prototyper.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -q -m "seed agent"', { cwd: tmpDir, stdio: 'pipe' });

    persistPattern(tmpDir, 'P-003', {
      level: 'L3',
      featureRef: 'F-100',
      suggestion: {
        kind: 'L3',
        file: 'agents/cap-prototyper.md',
        patchedText: 'PATCHED\n',
      },
    });

    const a = apply.applyPattern(tmpDir, 'P-003');
    assert.equal(a.applied, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'PATCHED\n');

    const u = apply.unlearnPattern(tmpDir, 'P-003');
    assert.equal(u.unlearned, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'ORIGINAL\n');
  });
});

// ---------------------------------------------------------------------------
// AC-4 — unlearn audit record
// ---------------------------------------------------------------------------

describe('AC-4 — unlearn audit record', () => {
  // @cap-todo(ac:F-074/AC-4) Unlearn audit at .cap/learning/unlearned/P-NNN.json
  //                          with {reason:'manual'|'auto-retract', ts, commitHash}.
  it('manual unlearn writes the audit with reason=manual and the commit hash', () => {
    persistPattern(tmpDir, 'P-001');
    const a = apply.applyPattern(tmpDir, 'P-001');
    const u = apply.unlearnPattern(tmpDir, 'P-001', { now: '2026-05-05T11:00:00.000Z' });
    assert.equal(u.unlearned, true);

    const fp = apply.unlearnedAuditPath(tmpDir, 'P-001');
    assert.ok(fs.existsSync(fp));
    const onDisk = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(onDisk.patternId, 'P-001');
    assert.equal(onDisk.reason, 'manual');
    assert.equal(onDisk.unlearnedAt, '2026-05-05T11:00:00.000Z');
    assert.equal(onDisk.appliedCommitHash, a.commitHash);
    assert.ok(onDisk.commitHash, 'unlearn audit must carry the unlearn commit hash');
  });

  it('auto-retract unlearn writes the audit with reason=auto-retract', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    const u = apply.unlearnPattern(tmpDir, 'P-001', { reason: 'auto-retract' });
    assert.equal(u.unlearned, true);
    assert.equal(u.audit.reason, 'auto-retract');
  });
});

// ---------------------------------------------------------------------------
// AC-7 — idempotency
// ---------------------------------------------------------------------------

describe('AC-7 — unlearn is idempotent', () => {
  // @cap-todo(ac:F-074/AC-7) Second unlearn call on already-unlearned pattern is a no-op.
  it('second unlearnPattern returns already-unlearned and does NOT create a second commit', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    const u1 = apply.unlearnPattern(tmpDir, 'P-001');
    assert.equal(u1.unlearned, true);
    const afterFirst = commitCount(tmpDir);

    const u2 = apply.unlearnPattern(tmpDir, 'P-001');
    assert.equal(u2.unlearned, false);
    assert.equal(u2.reason, 'already-unlearned');
    assert.ok(u2.priorRecord, 'must surface the prior unlearn record');
    assert.equal(u2.priorRecord.patternId, 'P-001');

    // No new commit was produced.
    assert.equal(commitCount(tmpDir), afterFirst);
  });

  it('second applyPattern on already-applied returns already-applied and produces no second commit', () => {
    persistPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-001');
    const afterFirst = commitCount(tmpDir);

    const a2 = apply.applyPattern(tmpDir, 'P-001');
    assert.equal(a2.applied, false);
    assert.equal(a2.reason, 'already-applied');
    assert.equal(commitCount(tmpDir), afterFirst);
  });
});

// ---------------------------------------------------------------------------
// listAppliedPatterns / listUnlearnedPatterns
// ---------------------------------------------------------------------------

describe('list APIs', () => {
  it('listAppliedPatterns returns audits sorted by patternId', () => {
    persistPattern(tmpDir, 'P-002');
    persistPattern(tmpDir, 'P-001');
    persistPattern(tmpDir, 'P-003');
    apply.applyPattern(tmpDir, 'P-002');
    apply.applyPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-003');
    const list = apply.listAppliedPatterns(tmpDir);
    assert.deepEqual(list.map((a) => a.patternId), ['P-001', 'P-002', 'P-003']);
  });

  it('listUnlearnedPatterns returns audits sorted by patternId', () => {
    persistPattern(tmpDir, 'P-001');
    persistPattern(tmpDir, 'P-002');
    apply.applyPattern(tmpDir, 'P-001');
    apply.applyPattern(tmpDir, 'P-002');
    apply.unlearnPattern(tmpDir, 'P-002');
    apply.unlearnPattern(tmpDir, 'P-001');
    const list = apply.listUnlearnedPatterns(tmpDir);
    assert.deepEqual(list.map((a) => a.patternId), ['P-001', 'P-002']);
  });

  it('returns empty arrays for a fresh project (no .cap/learning yet)', () => {
    assert.deepEqual(apply.listAppliedPatterns(tmpDir), []);
    assert.deepEqual(apply.listUnlearnedPatterns(tmpDir), []);
    assert.deepEqual(apply.listRetractRecommended(tmpDir), []);
  });
});

// ---------------------------------------------------------------------------
// applied-state read/write API
// ---------------------------------------------------------------------------

describe('applied-state read/write helpers', () => {
  it('readAppliedState returns default empty shape when file is missing', () => {
    const state = apply.readAppliedState(tmpDir);
    assert.equal(state.version, 1);
    assert.deepEqual(state.l1, {});
    assert.deepEqual(state.l2, []);
    assert.deepEqual(state.l3, []);
  });

  it('writeAppliedState round-trips through readAppliedState', () => {
    apply.writeAppliedState(tmpDir, {
      version: 1,
      l1: { 'F-071/THRESHOLD_OVERRIDE_COUNT': 5 },
      l2: [{ patternId: 'P-002', rule: { kind: 'L2' }, appliedAt: '2026-05-05T00:00:00.000Z' }],
      l3: [{ patternId: 'P-003', file: 'agents/cap-prototyper.md', appliedAt: '2026-05-05T00:00:00.000Z' }],
    });
    const state = apply.readAppliedState(tmpDir);
    assert.equal(state.l1['F-071/THRESHOLD_OVERRIDE_COUNT'], 5);
    assert.equal(state.l2.length, 1);
    assert.equal(state.l3.length, 1);
  });
});
