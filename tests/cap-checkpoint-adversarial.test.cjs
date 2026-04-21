'use strict';

// @cap-feature(feature:F-057) Adversarial tests for cap-checkpoint.cjs — edge cases, boundary conditions,
// priority tiebreaks, schema drift, CLI integration, pure/impure separation.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const capSession = require('../cap/bin/lib/cap-session.cjs');
const {
  TERMINAL_STEPS,
  STATE_RANK,
  captureFeatureSnapshot,
  diffFeatureStates,
  pickBreakpoint,
  analyze,
  applyCheckpoint,
  sessionPath,
  hasSession,
} = require('../cap/bin/lib/cap-checkpoint.cjs');

// -------- helpers --------

function feature(id, state, acs = []) {
  return { id, title: `${id} title`, state, acs, files: [], dependencies: [], metadata: {} };
}

function ac(id, status) {
  return { id, description: `desc ${id}`, status };
}

function snapshotDirMtimes(dir) {
  // Recursively collect file paths -> mtimeMs
  const result = {};
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result[full] = fs.statSync(full).mtimeMs;
    }
  }
  walk(dir);
  return result;
}

// -------- diffFeatureStates — edge cases --------

describe('adversarial: diffFeatureStates deleted-feature behavior', () => {
  it('feature present in prev but absent from current: does NOT emit a diff (features are only ever added, not deleted, in CAP)', () => {
    // F-054 was in prev snapshot, but is no longer in currentFeatures.
    // The implementation iterates over currentFeatures only -> no diff emitted.
    // This test locks in that behavior so it cannot silently regress.
    const prev = {
      featureStates: { 'F-054': 'tested', 'F-055': 'tested' },
      acStatuses: {},
    };
    const current = [feature('F-055', 'tested')];
    const diffs = diffFeatureStates(prev, current);
    assert.equal(diffs.length, 0, 'deleted feature produces no diff');
  });

  it('all prev features deleted + empty current array: returns []', () => {
    const prev = { featureStates: { 'F-001': 'shipped', 'F-002': 'tested' }, acStatuses: {} };
    const diffs = diffFeatureStates(prev, []);
    assert.deepEqual(diffs, []);
  });

  it('both snapshots empty: returns []', () => {
    const diffs = diffFeatureStates(
      { featureStates: {}, acStatuses: {} },
      [],
    );
    assert.deepEqual(diffs, []);
  });
});

describe('adversarial: diffFeatureStates newly-added feature', () => {
  it('feature added since prev snapshot and non-planned: emits transition with from=null', () => {
    const prev = { featureStates: { 'F-054': 'tested' }, acStatuses: {} };
    const current = [feature('F-054', 'tested'), feature('F-100', 'prototyped')];
    const diffs = diffFeatureStates(prev, current);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].featureId, 'F-100');
    assert.equal(diffs[0].from, null, 'newly-added feature has from=null');
    assert.equal(diffs[0].to, 'prototyped');
  });

  it('feature added since prev snapshot but still planned: no diff', () => {
    const prev = { featureStates: { 'F-054': 'tested' }, acStatuses: {} };
    const current = [feature('F-054', 'tested'), feature('F-100', 'planned')];
    const diffs = diffFeatureStates(prev, current);
    assert.equal(diffs.length, 0);
  });
});

describe('adversarial: diffFeatureStates identifier integrity', () => {
  it('features with identical titles but distinct IDs are compared by ID, not title', () => {
    const prev = {
      featureStates: { 'F-001': 'prototyped', 'F-002': 'tested' },
      acStatuses: {},
    };
    // Both features share the same title
    const fa = { id: 'F-001', title: 'same title', state: 'tested', acs: [] };
    const fb = { id: 'F-002', title: 'same title', state: 'tested', acs: [] };
    const diffs = diffFeatureStates(prev, [fa, fb]);
    // F-001 changed from prototyped -> tested, F-002 unchanged
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].featureId, 'F-001');
    assert.equal(diffs[0].from, 'prototyped');
  });
});

describe('adversarial: diffFeatureStates AC-level edge cases', () => {
  it('AC disappears (was in prev, not in current feature.acs): no diff emitted', () => {
    // The implementation iterates feature.acs of current only -> missing ACs are silently skipped.
    // Lock that behavior in as intentional (matches "features/ACs only added" assumption).
    const prev = {
      featureStates: { 'F-054': 'tested' },
      acStatuses: { 'F-054/AC-1': 'tested', 'F-054/AC-2': 'tested' },
    };
    const current = [feature('F-054', 'tested', [ac('AC-1', 'tested')])];
    const diffs = diffFeatureStates(prev, current);
    assert.equal(diffs.length, 0, 'deleted AC should not appear as a diff');
  });

  it('AC added between checkpoints with status pending: no diff', () => {
    const prev = {
      featureStates: { 'F-054': 'prototyped' },
      acStatuses: {},
    };
    const current = [feature('F-054', 'prototyped', [ac('AC-1', 'pending')])];
    const diffs = diffFeatureStates(prev, current);
    // prevAcs is empty so isFirstTime=true; AC-1 is pending so no diff emitted
    assert.equal(diffs.length, 0);
  });

  it('AC-status regression tested -> pending is counted as a diff', () => {
    const prev = {
      featureStates: { 'F-054': 'prototyped' },
      acStatuses: { 'F-054/AC-1': 'tested' },
    };
    const current = [feature('F-054', 'prototyped', [ac('AC-1', 'pending')])];
    const diffs = diffFeatureStates(prev, current);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].type, 'ac-status-update');
    assert.equal(diffs[0].from, 'tested');
    assert.equal(diffs[0].to, 'pending');
  });

  it('non-array acs field does not crash diff', () => {
    const prev = { featureStates: { 'F-054': 'prototyped' }, acStatuses: {} };
    const current = [{ id: 'F-054', state: 'tested', acs: 'not-an-array' }];
    const diffs = diffFeatureStates(prev, current);
    // acs is not an array: the feature-state diff still fires
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].type, 'state-transition');
  });
});

describe('adversarial: diffFeatureStates isFirstTime heuristic', () => {
  it('prev has AC entries but no featureStates: NOT first-time (hybrid prev)', () => {
    // isFirstTime requires BOTH featureStates AND acStatuses empty. If only one is empty,
    // diff compares field-by-field.
    const prev = { featureStates: {}, acStatuses: { 'F-054/AC-1': 'tested' } };
    const current = [feature('F-054', 'tested', [ac('AC-1', 'tested')])];
    const diffs = diffFeatureStates(prev, current);
    // NOT first-time: F-054 unknown in prevStates -> feature-added path (non-planned, so emits transition)
    // AC-1 present in prev with same status -> no diff
    const stateTransitions = diffs.filter(d => d.type === 'state-transition');
    const acUpdates = diffs.filter(d => d.type === 'ac-status-update');
    assert.equal(stateTransitions.length, 1);
    assert.equal(acUpdates.length, 0);
  });
});

// -------- pickBreakpoint — tiebreaks + priorities --------

describe('adversarial: pickBreakpoint state-regression handling', () => {
  it('regression shipped->tested is still a feature-transition (implementation does NOT filter regressions)', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'shipped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.ok(bp, 'regression is still reported');
    assert.equal(bp.kind, 'feature-transition');
    assert.equal(bp.featureId, 'F-054');
    assert.equal(bp.reason, 'F-054 auf state=tested');
  });

  it('regression + forward transition: forward wins because its STATE_RANK is higher', () => {
    const diffs = [
      // regression: shipped(3)->planned(0), to-rank=0
      { featureId: 'F-054', type: 'state-transition', from: 'shipped', to: 'planned' },
      // forward: prototyped(1)->tested(2), to-rank=2
      { featureId: 'F-055', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-055', 'higher to-rank wins');
    assert.equal(bp.reason, 'F-055 auf state=tested');
  });
});

describe('adversarial: pickBreakpoint state-transition + session-step concurrency', () => {
  it('state-transition dominates session step even for a non-forward transition', () => {
    // Regression-only diff + terminal session step: state-transition still wins (priority rule).
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'shipped', to: 'planned' },
    ];
    const bp = pickBreakpoint(diffs, 'test-complete', []);
    assert.equal(bp.kind, 'feature-transition', 'priority: state-transition > session-step');
    assert.equal(bp.featureId, 'F-054');
  });

  it('ac-update dominates session step', () => {
    const diffs = [
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-1', from: 'pending', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, 'brainstorm-complete', []);
    assert.equal(bp.kind, 'ac-update');
  });
});

describe('adversarial: pickBreakpoint multi-AC tiebreaks', () => {
  it('multiple AC updates on same feature: largest AC id wins (by string comparison, descending)', () => {
    const diffs = [
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-1', from: 'pending', to: 'tested' },
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-9', from: 'pending', to: 'tested' },
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-3', from: 'pending', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.kind, 'ac-update');
    // localeCompare with descending sort: "AC-9" > "AC-3" > "AC-1" lexicographically
    assert.ok(bp.reason.includes('AC-9'), `expected AC-9 in reason but got: ${bp.reason}`);
  });

  it('AC updates across multiple features: younger feature wins', () => {
    const diffs = [
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-9', from: 'pending', to: 'tested' },
      { featureId: 'F-099', type: 'ac-status-update', acId: 'AC-1', from: 'pending', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-099');
    assert.ok(bp.reason.includes('F-099/AC-1'));
  });
});

describe('adversarial: pickBreakpoint unknown/invalid inputs', () => {
  it('unknown session step ("foo-complete") is ignored, returns null when no diffs', () => {
    assert.equal(pickBreakpoint([], 'foo-complete', []), null);
    assert.equal(pickBreakpoint([], 'deploy-complete', []), null);
  });

  it('session step "" / "" with no diffs returns null', () => {
    assert.equal(pickBreakpoint([], '', []), null);
  });

  it('diffs is null/undefined: defensive, returns null when session step is also empty', () => {
    assert.equal(pickBreakpoint(null, null, []), null);
    assert.equal(pickBreakpoint(undefined, null, []), null);
  });

  it('state-transition with a "to" state NOT in STATE_RANK still wins over an in-rank one if no competing higher rank', () => {
    // Unknown state: rank=-1. Compared against a valid "tested" (rank=2), tested should win.
    const diffs = [
      { featureId: 'F-099', type: 'state-transition', from: 'planned', to: 'mystery-state' },
      { featureId: 'F-054', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-054', 'known state rank wins over unknown');
  });

  it('two state-transitions both with unknown to-states: tiebreak by larger numeric id', () => {
    const diffs = [
      { featureId: 'F-001', type: 'state-transition', from: 'planned', to: 'mystery' },
      { featureId: 'F-999', type: 'state-transition', from: 'planned', to: 'other-mystery' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-999');
  });
});

// -------- captureFeatureSnapshot — schema quirks --------

describe('adversarial: captureFeatureSnapshot schema corner cases', () => {
  it('feature without an acs array: no ac entries for it', () => {
    const snap = captureFeatureSnapshot([{ id: 'F-001', state: 'tested' }]);
    assert.equal(snap.featureStates['F-001'], 'tested');
    // No ACs recorded for F-001
    const acKeys = Object.keys(snap.acStatuses).filter(k => k.startsWith('F-001/'));
    assert.equal(acKeys.length, 0);
  });

  it('unusual AC ids (e.g., AC-99, AC-101) are recorded verbatim', () => {
    const snap = captureFeatureSnapshot([
      feature('F-001', 'tested', [ac('AC-99', 'tested'), ac('AC-101', 'pending')]),
    ]);
    assert.equal(snap.acStatuses['F-001/AC-99'], 'tested');
    assert.equal(snap.acStatuses['F-001/AC-101'], 'pending');
  });

  it('features with empty-string state get the "planned" default', () => {
    // state: '' is falsy, so the || 'planned' fallback kicks in.
    const snap = captureFeatureSnapshot([{ id: 'F-001', state: '', acs: [] }]);
    assert.equal(snap.featureStates['F-001'], 'planned');
  });

  it('ac with empty-string status gets "pending" default', () => {
    const snap = captureFeatureSnapshot([
      { id: 'F-001', state: 'tested', acs: [{ id: 'AC-1', status: '' }] },
    ]);
    assert.equal(snap.acStatuses['F-001/AC-1'], 'pending');
  });

  it('feature with non-string id is skipped', () => {
    const snap = captureFeatureSnapshot([
      { id: 42, state: 'tested', acs: [] },
      { id: null, state: 'tested', acs: [] },
      feature('F-001', 'tested'),
    ]);
    assert.deepEqual(Object.keys(snap.featureStates), ['F-001']);
  });

  it('acs containing malformed entries (no id, non-string id) are skipped', () => {
    const snap = captureFeatureSnapshot([
      {
        id: 'F-001',
        state: 'tested',
        acs: [{ status: 'tested' }, { id: null, status: 'tested' }, ac('AC-1', 'tested')],
      },
    ]);
    assert.deepEqual(Object.keys(snap.acStatuses), ['F-001/AC-1']);
  });
});

// -------- analyze — plan correctness + purity --------

describe('adversarial: analyze plan correctness', () => {
  it('first-time with only a test-complete session step + no non-planned features yields session-step plan', () => {
    const session = { step: 'test-complete', lastCheckpointSnapshot: null };
    const featureMap = { features: [feature('F-001', 'planned'), feature('F-002', 'planned')] };
    const result = analyze(session, featureMap);
    assert.ok(result.breakpoint);
    assert.equal(result.breakpoint.kind, 'session-step');
    assert.equal(result.plan.saveLabel, 'checkpoint-session');
    assert.match(result.plan.message, /Test-Phase abgeschlossen/);
  });

  it('brainstorm-complete step with a newly-added planned F-060: session-step wins (planned is not a forward signal)', () => {
    // F-060 is new since last checkpoint but planned -> no state-transition diff.
    // So session-step should win.
    const prev = captureFeatureSnapshot([feature('F-054', 'tested')]);
    const session = { step: 'brainstorm-complete', lastCheckpointSnapshot: prev };
    const featureMap = {
      features: [feature('F-054', 'tested'), feature('F-060', 'planned')],
    };
    const result = analyze(session, featureMap);
    assert.equal(result.breakpoint.kind, 'session-step');
    assert.match(result.plan.message, /Brainstorm-Phase abgeschlossen/);
  });

  it('analyze does not mutate the featureMap.features array', () => {
    const features = [feature('F-054', 'tested'), feature('F-055', 'shipped')];
    const featureMap = { features };
    const before = JSON.stringify(features);
    analyze({ step: null, lastCheckpointSnapshot: null }, featureMap);
    assert.equal(JSON.stringify(features), before);
    // And the reference is untouched
    assert.equal(featureMap.features, features);
  });

  it('analyze with session={} and featureMap={}: breakpoint=null, no throw', () => {
    const result = analyze({}, {});
    assert.equal(result.breakpoint, null);
    assert.equal(result.plan.shouldSave, false);
  });

  it('analyze with featureMap.features being a non-array: treats as empty', () => {
    const result = analyze({ step: null }, { features: 'not-an-array' });
    assert.equal(result.breakpoint, null);
  });

  it('currentSnapshot is always returned, even when no breakpoint', () => {
    const result = analyze({ step: null }, { features: [feature('F-001', 'planned')] });
    assert.equal(result.breakpoint, null);
    assert.ok(result.currentSnapshot);
    assert.equal(result.currentSnapshot.featureStates['F-001'], 'planned');
  });

  it('message always ends with a period', () => {
    const r1 = analyze(
      { step: null, lastCheckpointSnapshot: null },
      { features: [feature('F-054', 'tested')] },
    );
    assert.ok(r1.plan.message.endsWith('.'), `expected period at end of: ${r1.plan.message}`);

    const r2 = analyze({ step: null }, { features: [] });
    assert.ok(r2.plan.message.endsWith('.'));
  });
});

describe('adversarial: analyze purity (no disk I/O)', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-pure-'));
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    capSession.saveSession(tmp, capSession.getDefaultSession());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('analyze() does not write to disk in tmp project dir', { skip: process.platform === 'win32' }, () => {
    const before = snapshotDirMtimes(tmp);
    const session = capSession.loadSession(tmp);
    const featureMap = { features: [feature('F-054', 'tested')] };

    analyze(session, featureMap);
    analyze(session, featureMap); // repeat to exercise stability

    const after = snapshotDirMtimes(tmp);
    assert.deepEqual(
      Object.keys(after).sort(),
      Object.keys(before).sort(),
      'no files added or removed',
    );
    for (const file of Object.keys(before)) {
      assert.equal(
        after[file],
        before[file],
        `analyze() mutated ${file}: mtime changed from ${before[file]} to ${after[file]}`,
      );
    }
  });
});

// -------- applyCheckpoint — persistence edge cases --------

describe('adversarial: applyCheckpoint persistence', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-adv-apply-'));
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    capSession.saveSession(tmp, capSession.getDefaultSession());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('applyCheckpoint persists the INPUT snapshot verbatim, not a re-captured one', () => {
    // Pass a snapshot that could not have come from any real feature map.
    const crafted = {
      featureStates: { 'F-XYZ': 'synthetic' },
      acStatuses: { 'F-XYZ/AC-999': 'synthetic-status' },
    };
    applyCheckpoint(tmp, crafted, new Date('2026-04-20T00:00:00.000Z'));
    const session = capSession.loadSession(tmp);
    assert.deepEqual(session.lastCheckpointSnapshot, crafted);
  });

  it('second applyCheckpoint REPLACES snapshot (no merge)', () => {
    const snap1 = {
      featureStates: { 'F-001': 'tested', 'F-002': 'tested' },
      acStatuses: { 'F-001/AC-1': 'tested' },
    };
    const snap2 = {
      featureStates: { 'F-003': 'shipped' },
      acStatuses: {},
    };
    applyCheckpoint(tmp, snap1, new Date('2026-04-01T00:00:00.000Z'));
    applyCheckpoint(tmp, snap2, new Date('2026-04-02T00:00:00.000Z'));
    const session = capSession.loadSession(tmp);
    // F-001 and F-002 must be GONE (replace, not merge)
    assert.deepEqual(session.lastCheckpointSnapshot, snap2);
    assert.equal(session.lastCheckpointSnapshot.featureStates['F-001'], undefined);
    assert.equal(session.lastCheckpointSnapshot.featureStates['F-002'], undefined);
  });

  it('applyCheckpoint preserves other session fields (activeFeature, step, metadata)', () => {
    // Seed the session with state
    capSession.updateSession(tmp, {
      activeFeature: 'F-057',
      step: 'test-complete',
      metadata: { custom: 'value' },
    });
    applyCheckpoint(tmp, { featureStates: { 'F-057': 'tested' }, acStatuses: {} });
    const session = capSession.loadSession(tmp);
    assert.equal(session.activeFeature, 'F-057', 'activeFeature preserved');
    assert.equal(session.step, 'test-complete', 'step preserved');
    assert.deepEqual(session.metadata, { custom: 'value' }, 'metadata preserved');
  });

  it('applyCheckpoint accepts a non-Date "now" value gracefully (falls back to new Date())', () => {
    // Non-Date is treated as "ignore, use now" by the implementation.
    const beforeTs = Date.now();
    applyCheckpoint(tmp, { featureStates: {}, acStatuses: {} }, 'not-a-date');
    const afterTs = Date.now();
    const session = capSession.loadSession(tmp);
    const written = Date.parse(session.lastCheckpointAt);
    assert.ok(
      written >= beforeTs && written <= afterTs + 5,
      `timestamp ${written} out of range [${beforeTs}, ${afterTs}]`,
    );
  });

  it('throws TypeError when projectRoot is not a string', () => {
    assert.throws(() => applyCheckpoint(null, { featureStates: {}, acStatuses: {} }), TypeError);
    assert.throws(() => applyCheckpoint(123, { featureStates: {}, acStatuses: {} }), TypeError);
  });

  it('session file is valid JSON after applyCheckpoint (byte-level)', () => {
    applyCheckpoint(tmp, { featureStates: { 'F-001': 'tested' }, acStatuses: {} });
    const raw = fs.readFileSync(path.join(tmp, '.cap', 'SESSION.json'), 'utf8');
    // Must parse
    const parsed = JSON.parse(raw);
    assert.equal(parsed.lastCheckpointSnapshot.featureStates['F-001'], 'tested');
  });
});

describe('adversarial: applyCheckpoint session-schema migration', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-migr-'));
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loadSession on pre-F-057 SESSION.json (without checkpoint fields) returns lastCheckpointAt=null and lastCheckpointSnapshot=null via defaults', () => {
    // Simulate an old SESSION.json
    const legacy = {
      version: '2.0.0',
      lastCommand: '/cap:status',
      activeFeature: 'F-001',
      step: 'prototype',
      metadata: {},
    };
    fs.writeFileSync(
      path.join(tmp, '.cap', 'SESSION.json'),
      JSON.stringify(legacy, null, 2),
      'utf8',
    );
    const session = capSession.loadSession(tmp);
    assert.equal(session.lastCheckpointAt, null, 'default lastCheckpointAt=null');
    assert.equal(session.lastCheckpointSnapshot, null, 'default lastCheckpointSnapshot=null');
    assert.equal(session.activeFeature, 'F-001', 'legacy fields preserved');
  });

  it('applyCheckpoint on a legacy session adds the two fields without destroying existing fields', () => {
    const legacy = {
      version: '2.0.0',
      activeFeature: 'F-001',
      step: 'prototype',
      metadata: { legacy: 'yes' },
    };
    fs.writeFileSync(
      path.join(tmp, '.cap', 'SESSION.json'),
      JSON.stringify(legacy, null, 2),
      'utf8',
    );
    applyCheckpoint(tmp, { featureStates: { 'F-001': 'tested' }, acStatuses: {} });
    const session = capSession.loadSession(tmp);
    assert.equal(session.activeFeature, 'F-001');
    assert.deepEqual(session.metadata, { legacy: 'yes' });
    assert.equal(session.lastCheckpointSnapshot.featureStates['F-001'], 'tested');
    assert.ok(session.lastCheckpointAt);
  });

  it('corrupt SESSION.json: loadSession falls back to defaults (documented behavior)', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'SESSION.json'),
      '{"this is": not valid json',
      'utf8',
    );
    // loadSession silently returns the default per cap-session.cjs line 98-101
    const session = capSession.loadSession(tmp);
    assert.equal(session.lastCheckpointAt, null);
    assert.equal(session.lastCheckpointSnapshot, null);
    assert.equal(session.version, '2.0.0');
  });
});

// -------- sessionPath / hasSession --------

describe('adversarial: sessionPath / hasSession helpers', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-helpers-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('sessionPath returns an absolute path ending in .cap/SESSION.json', () => {
    const p = sessionPath(tmp);
    assert.ok(path.isAbsolute(p));
    assert.ok(p.endsWith(path.join('.cap', 'SESSION.json')));
  });

  it('hasSession returns false when .cap/SESSION.json does not exist, true when it does', () => {
    assert.equal(hasSession(tmp), false);
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cap', 'SESSION.json'), '{}', 'utf8');
    assert.equal(hasSession(tmp), true);
  });
});

// -------- CLI / Command-Markdown integration --------

describe('adversarial: commands/cap/checkpoint.md structure', () => {
  const cmdPath = path.resolve(__dirname, '..', 'commands', 'cap', 'checkpoint.md');
  let body;

  beforeEach(() => {
    body = fs.readFileSync(cmdPath, 'utf8');
  });

  it('file exists and is non-empty', () => {
    assert.ok(fs.existsSync(cmdPath));
    assert.ok(body.length > 0);
  });

  it('has the required YAML frontmatter keys (name, description, argument-hint)', () => {
    // Extract frontmatter between first --- and second ---
    const match = /^---\n([\s\S]*?)\n---/.exec(body);
    assert.ok(match, 'frontmatter block must exist');
    const frontmatter = match[1];
    assert.match(frontmatter, /^name:\s*cap:checkpoint$/m, 'name: cap:checkpoint');
    assert.match(frontmatter, /^description:/m, 'description present');
    assert.match(frontmatter, /^argument-hint:/m, 'argument-hint present');
  });

  it('references the /cap:save chain in the body (AC-4)', () => {
    assert.match(body, /\/cap:save/, 'must reference /cap:save');
    // Must include the checkpoint- prefix for the label convention
    assert.match(body, /checkpoint-/, 'must reference the checkpoint-{id} label convention');
  });

  it('references the analyze() function (pure logic delegation)', () => {
    assert.match(body, /capCheckpoint\.analyze/);
    assert.match(body, /capCheckpoint\.applyCheckpoint/);
  });

  it('explicitly states the advisory boundary against auto-/compact (AC-6)', () => {
    // Some variant of "no auto compact" must be present.
    const hasAdvisory = /advisory/i.test(body);
    const hasNoAutoCompact =
      /never run.*\/compact/i.test(body) ||
      /do not invoke `?\/compact`? automatically/i.test(body) ||
      /kein auto-?\/?compact/i.test(body);
    assert.ok(hasAdvisory, 'body must describe command as advisory');
    assert.ok(hasNoAutoCompact, 'body must state it does not invoke /compact automatically');
  });

  it('references each AC (AC-1..AC-6) at least once', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const pattern = new RegExp(`F-057/AC-${n}\\b`);
      assert.match(body, pattern, `command file must reference F-057/AC-${n}`);
    }
  });

  it('references the no-breakpoint message verbatim (AC-5)', () => {
    assert.match(body, /Kein natürlicher Kontextbruch erkannt\./);
  });

  it('mentions the recommendation-message template "Jetzt /compact, weil" (AC-3)', () => {
    assert.match(body, /Jetzt \/compact, weil/);
  });
});

// -------- integration: apply + analyze interplay --------

describe('adversarial: checkpoint cycle with multiple transitions', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-cycle-'));
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    capSession.saveSession(tmp, capSession.getDefaultSession());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('three-step cycle: tested -> apply -> shipped triggers new breakpoint -> apply -> no breakpoint', () => {
    // Step 1: first analyze on F-054 tested
    const fm1 = { features: [feature('F-054', 'tested')] };
    const r1 = analyze(capSession.loadSession(tmp), fm1);
    assert.equal(r1.breakpoint.kind, 'feature-transition');
    applyCheckpoint(tmp, r1.currentSnapshot, new Date('2026-04-20T10:00:00.000Z'));

    // Step 2: F-054 shipped
    const fm2 = { features: [feature('F-054', 'shipped')] };
    const r2 = analyze(capSession.loadSession(tmp), fm2);
    assert.ok(r2.breakpoint);
    assert.equal(r2.breakpoint.featureId, 'F-054');
    assert.equal(r2.plan.message, 'Jetzt /compact, weil F-054 auf state=shipped.');
    applyCheckpoint(tmp, r2.currentSnapshot, new Date('2026-04-20T11:00:00.000Z'));

    // Step 3: unchanged feature map, no step -> no breakpoint
    const r3 = analyze(capSession.loadSession(tmp), fm2);
    assert.equal(r3.breakpoint, null);
  });

  it('after applyCheckpoint, a session.step change to test-complete triggers session-step breakpoint', () => {
    const fm = { features: [feature('F-054', 'tested')] };
    const r1 = analyze(capSession.loadSession(tmp), fm);
    applyCheckpoint(tmp, r1.currentSnapshot);

    // Now simulate the workflow moving to test-complete
    capSession.updateStep(tmp, 'test-complete');

    const r2 = analyze(capSession.loadSession(tmp), fm);
    assert.ok(r2.breakpoint);
    assert.equal(r2.breakpoint.kind, 'session-step');
    assert.equal(r2.plan.saveLabel, 'checkpoint-session');
  });

  it('transition detected correctly when an AC flips to tested AFTER an applyCheckpoint on prototyped state', () => {
    const fmV1 = { features: [feature('F-054', 'prototyped', [ac('AC-1', 'pending')])] };
    const r1 = analyze(capSession.loadSession(tmp), fmV1);
    // F-054 is prototyped (rank 1), AC-1 is pending -> state-transition fires
    assert.ok(r1.breakpoint);
    assert.equal(r1.breakpoint.kind, 'feature-transition');
    applyCheckpoint(tmp, r1.currentSnapshot);

    // Now AC-1 flips to tested, feature state stays prototyped
    const fmV2 = { features: [feature('F-054', 'prototyped', [ac('AC-1', 'tested')])] };
    const r2 = analyze(capSession.loadSession(tmp), fmV2);
    assert.ok(r2.breakpoint);
    assert.equal(r2.breakpoint.kind, 'ac-update');
    assert.equal(r2.plan.saveLabel, 'checkpoint-F-054');
    assert.match(r2.plan.message, /F-054\/AC-1 auf status=tested/);
  });
});
