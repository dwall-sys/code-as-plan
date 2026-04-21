'use strict';

// @cap-feature(feature:F-057) Tests for cap-checkpoint.cjs — breakpoint detection logic for /cap:checkpoint.

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
} = require('../cap/bin/lib/cap-checkpoint.cjs');

// -------- helpers --------

function feature(id, state, acs = []) {
  return { id, title: `${id} title`, state, acs, files: [], dependencies: [], metadata: {} };
}

function ac(id, status) {
  return { id, description: `desc ${id}`, status };
}

// -------- module surface --------

describe('module surface', () => {
  it('exports TERMINAL_STEPS as a Set containing the five terminal markers', () => {
    assert.ok(TERMINAL_STEPS instanceof Set);
    for (const step of [
      'test-complete',
      'review-complete',
      'prototype-complete',
      'brainstorm-complete',
      'iterate-complete',
    ]) {
      assert.ok(TERMINAL_STEPS.has(step), `expected ${step} in TERMINAL_STEPS`);
    }
    assert.equal(TERMINAL_STEPS.size, 5);
  });

  it('exports STATE_RANK with shipped > tested > prototyped > planned', () => {
    assert.equal(STATE_RANK.shipped, 3);
    assert.equal(STATE_RANK.tested, 2);
    assert.equal(STATE_RANK.prototyped, 1);
    assert.equal(STATE_RANK.planned, 0);
  });
});

// -------- captureFeatureSnapshot --------

describe('captureFeatureSnapshot', () => {
  it('produces empty snapshot for empty feature list', () => {
    const snap = captureFeatureSnapshot([]);
    assert.deepEqual(snap, { featureStates: {}, acStatuses: {} });
  });

  it('captures feature states and AC statuses', () => {
    const features = [
      feature('F-054', 'tested', [ac('AC-1', 'tested'), ac('AC-2', 'pending')]),
      feature('F-055', 'shipped', [ac('AC-1', 'tested')]),
    ];
    const snap = captureFeatureSnapshot(features);
    assert.equal(snap.featureStates['F-054'], 'tested');
    assert.equal(snap.featureStates['F-055'], 'shipped');
    assert.equal(snap.acStatuses['F-054/AC-1'], 'tested');
    assert.equal(snap.acStatuses['F-054/AC-2'], 'pending');
    assert.equal(snap.acStatuses['F-055/AC-1'], 'tested');
  });

  it('falls back to planned/pending when state/status missing', () => {
    const features = [
      { id: 'F-001', state: undefined, acs: [{ id: 'AC-1', status: undefined }] },
    ];
    const snap = captureFeatureSnapshot(features);
    assert.equal(snap.featureStates['F-001'], 'planned');
    assert.equal(snap.acStatuses['F-001/AC-1'], 'pending');
  });

  it('ignores malformed features without an id', () => {
    const snap = captureFeatureSnapshot([{ state: 'tested' }, feature('F-001', 'tested')]);
    assert.deepEqual(Object.keys(snap.featureStates), ['F-001']);
  });

  it('handles non-array input without throwing', () => {
    assert.deepEqual(captureFeatureSnapshot(null), { featureStates: {}, acStatuses: {} });
    assert.deepEqual(captureFeatureSnapshot(undefined), { featureStates: {}, acStatuses: {} });
  });
});

// -------- diffFeatureStates --------

describe('diffFeatureStates', () => {
  it('returns empty array when prev snapshot is null and all features are planned', () => {
    const features = [feature('F-001', 'planned'), feature('F-002', 'planned')];
    const diffs = diffFeatureStates(null, features);
    assert.deepEqual(diffs, []);
  });

  it('first-time snapshot: emits one state-transition for a tested feature', () => {
    const features = [feature('F-054', 'tested')];
    const diffs = diffFeatureStates(null, features);
    assert.equal(diffs.length, 1);
    assert.deepEqual(diffs[0], {
      featureId: 'F-054',
      type: 'state-transition',
      from: null,
      to: 'tested',
    });
  });

  it('first-time snapshot ignores planned features but catches non-pending ACs', () => {
    const features = [feature('F-001', 'planned', [ac('AC-1', 'tested')])];
    const diffs = diffFeatureStates(null, features);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].type, 'ac-status-update');
    assert.equal(diffs[0].featureId, 'F-001');
    assert.equal(diffs[0].acId, 'AC-1');
  });

  it('detects transition from prototyped to tested', () => {
    const prev = { featureStates: { 'F-054': 'prototyped' }, acStatuses: {} };
    const features = [feature('F-054', 'tested')];
    const diffs = diffFeatureStates(prev, features);
    assert.equal(diffs.length, 1);
    assert.deepEqual(diffs[0], {
      featureId: 'F-054',
      type: 'state-transition',
      from: 'prototyped',
      to: 'tested',
    });
  });

  it('returns empty array when nothing changed', () => {
    const prev = { featureStates: { 'F-054': 'tested' }, acStatuses: {} };
    const features = [feature('F-054', 'tested')];
    const diffs = diffFeatureStates(prev, features);
    assert.deepEqual(diffs, []);
  });

  it('detects shipped transition among multiple features', () => {
    const prev = {
      featureStates: { 'F-054': 'tested', 'F-055': 'tested' },
      acStatuses: {},
    };
    const features = [feature('F-054', 'tested'), feature('F-055', 'shipped')];
    const diffs = diffFeatureStates(prev, features);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].featureId, 'F-055');
    assert.equal(diffs[0].to, 'shipped');
  });

  it('detects AC-status transition without feature-state change', () => {
    const prev = {
      featureStates: { 'F-054': 'prototyped' },
      acStatuses: { 'F-054/AC-1': 'pending' },
    };
    const features = [feature('F-054', 'prototyped', [ac('AC-1', 'tested')])];
    const diffs = diffFeatureStates(prev, features);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].type, 'ac-status-update');
    assert.equal(diffs[0].featureId, 'F-054');
    assert.equal(diffs[0].acId, 'AC-1');
    assert.equal(diffs[0].from, 'pending');
    assert.equal(diffs[0].to, 'tested');
  });

  it('returns multiple simultaneous diffs', () => {
    const prev = {
      featureStates: { 'F-054': 'prototyped', 'F-055': 'planned' },
      acStatuses: { 'F-054/AC-1': 'pending' },
    };
    const features = [
      feature('F-054', 'tested', [ac('AC-1', 'tested')]),
      feature('F-055', 'prototyped'),
    ];
    const diffs = diffFeatureStates(prev, features);
    // 2 state-transitions (F-054, F-055) + 1 ac-status-update = 3 diffs
    assert.equal(diffs.length, 3);
    const stateTransitions = diffs.filter(d => d.type === 'state-transition');
    const acUpdates = diffs.filter(d => d.type === 'ac-status-update');
    assert.equal(stateTransitions.length, 2);
    assert.equal(acUpdates.length, 1);
  });

  it('counts regression (shipped -> tested) as a state-transition', () => {
    const prev = { featureStates: { 'F-054': 'shipped' }, acStatuses: {} };
    const features = [feature('F-054', 'tested')];
    const diffs = diffFeatureStates(prev, features);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].from, 'shipped');
    assert.equal(diffs[0].to, 'tested');
  });

  it('treats an empty prev snapshot object as first-time', () => {
    const features = [feature('F-054', 'tested')];
    const diffs = diffFeatureStates({ featureStates: {}, acStatuses: {} }, features);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].from, null);
    assert.equal(diffs[0].to, 'tested');
  });
});

// -------- pickBreakpoint --------

describe('pickBreakpoint', () => {
  it('returns null when no diffs and no session step', () => {
    assert.equal(pickBreakpoint([], null, []), null);
    assert.equal(pickBreakpoint([], undefined, []), null);
  });

  it('returns null for a non-terminal session step', () => {
    const bp = pickBreakpoint([], 'start', []);
    assert.equal(bp, null);
  });

  it('detects session-step breakpoint for test-complete', () => {
    const bp = pickBreakpoint([], 'test-complete', []);
    assert.ok(bp);
    assert.equal(bp.kind, 'session-step');
    assert.ok(bp.reason.length > 0);
    assert.ok(bp.reason.toLowerCase().includes('test'));
  });

  it('detects session-step breakpoint for review-complete', () => {
    const bp = pickBreakpoint([], 'review-complete', []);
    assert.equal(bp.kind, 'session-step');
    assert.ok(bp.reason.toLowerCase().includes('review'));
  });

  it('state-transition wins over ac-update', () => {
    const diffs = [
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-1', from: 'pending', to: 'tested' },
      { featureId: 'F-055', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.kind, 'feature-transition');
    assert.equal(bp.featureId, 'F-055');
  });

  it('state-transition wins over session step', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, 'test-complete', []);
    assert.equal(bp.kind, 'feature-transition');
  });

  it('ac-update wins over session step', () => {
    const diffs = [
      { featureId: 'F-054', type: 'ac-status-update', acId: 'AC-1', from: 'pending', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, 'test-complete', []);
    assert.equal(bp.kind, 'ac-update');
    assert.equal(bp.featureId, 'F-054');
  });

  it('when two state-transitions of different rank: higher rank wins', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'prototyped', to: 'tested' },
      { featureId: 'F-055', type: 'state-transition', from: 'tested', to: 'shipped' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-055');
    assert.equal(bp.reason, 'F-055 von tested → shipped');
  });

  it('when two state-transitions same rank: younger (larger number) feature wins', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'prototyped', to: 'tested' },
      { featureId: 'F-056', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.featureId, 'F-056');
  });

  it('reason text includes the from→to transition for feature-transition kind', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: 'prototyped', to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.reason, 'F-054 von prototyped → tested');
  });

  it('reason text falls back to "auf state=X" when from is null (first-time observation)', () => {
    const diffs = [
      { featureId: 'F-054', type: 'state-transition', from: null, to: 'tested' },
    ];
    const bp = pickBreakpoint(diffs, null, []);
    assert.equal(bp.reason, 'F-054 auf state=tested');
  });
});

// -------- analyze --------

describe('analyze', () => {
  it('first-time analyze on F-054 tested returns shouldSave plan with checkpoint-F-054 label', () => {
    const session = { step: null, lastCheckpointSnapshot: null };
    const featureMap = { features: [feature('F-054', 'tested')] };
    const result = analyze(session, featureMap);
    assert.ok(result.breakpoint);
    assert.equal(result.breakpoint.kind, 'feature-transition');
    assert.equal(result.plan.shouldSave, true);
    assert.equal(result.plan.saveLabel, 'checkpoint-F-054');
    assert.equal(result.plan.message, 'Jetzt /compact, weil F-054 auf state=tested.');
  });

  it('no-diff + null step returns breakpoint:null and "Kein natuerlicher ..." message', () => {
    const snap = captureFeatureSnapshot([feature('F-054', 'tested')]);
    const session = { step: null, lastCheckpointSnapshot: snap };
    const featureMap = { features: [feature('F-054', 'tested')] };
    const result = analyze(session, featureMap);
    assert.equal(result.breakpoint, null);
    assert.equal(result.plan.shouldSave, false);
    assert.equal(result.plan.saveLabel, null);
    assert.equal(result.plan.message, 'Kein natürlicher Kontextbruch erkannt.');
  });

  it('session step test-complete without state-diff yields session-step breakpoint', () => {
    const snap = captureFeatureSnapshot([feature('F-054', 'tested')]);
    const session = { step: 'test-complete', lastCheckpointSnapshot: snap };
    const featureMap = { features: [feature('F-054', 'tested')] };
    const result = analyze(session, featureMap);
    assert.ok(result.breakpoint);
    assert.equal(result.breakpoint.kind, 'session-step');
    assert.equal(result.plan.shouldSave, true);
    // No featureId on session-step-only breakpoint -> falls back to "checkpoint-session"
    assert.equal(result.plan.saveLabel, 'checkpoint-session');
  });

  it('includes currentSnapshot in the result (for applyCheckpoint handoff)', () => {
    const session = { step: null, lastCheckpointSnapshot: null };
    const featureMap = { features: [feature('F-054', 'tested', [ac('AC-1', 'tested')])] };
    const result = analyze(session, featureMap);
    assert.ok(result.currentSnapshot);
    assert.equal(result.currentSnapshot.featureStates['F-054'], 'tested');
    assert.equal(result.currentSnapshot.acStatuses['F-054/AC-1'], 'tested');
  });

  it('analyze does not mutate the session input', () => {
    const session = { step: 'test-complete', lastCheckpointSnapshot: null };
    const before = JSON.stringify(session);
    analyze(session, { features: [feature('F-054', 'tested')] });
    assert.equal(JSON.stringify(session), before, 'session must not be mutated');
  });

  it('analyze handles missing featureMap without throwing', () => {
    const result = analyze({ step: null }, null);
    assert.equal(result.breakpoint, null);
    assert.equal(result.plan.message, 'Kein natürlicher Kontextbruch erkannt.');
  });

  it('analyze handles missing session entirely', () => {
    const result = analyze(null, { features: [] });
    assert.equal(result.breakpoint, null);
  });
});

// -------- applyCheckpoint (side-effect) --------

describe('applyCheckpoint', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-apply-'));
    // initialize a minimal .cap/SESSION.json so loadSession does not return the default
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    capSession.saveSession(tmp, capSession.getDefaultSession());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes lastCheckpointAt as an ISO string and lastCheckpointSnapshot into SESSION.json', () => {
    const snapshot = {
      featureStates: { 'F-054': 'tested' },
      acStatuses: { 'F-054/AC-1': 'tested' },
    };
    const fixedNow = new Date('2026-04-20T10:00:00.000Z');
    applyCheckpoint(tmp, snapshot, fixedNow);

    const session = capSession.loadSession(tmp);
    assert.equal(session.lastCheckpointAt, '2026-04-20T10:00:00.000Z');
    assert.deepEqual(session.lastCheckpointSnapshot, snapshot);
  });

  it('defaults to current time when now argument is omitted', () => {
    applyCheckpoint(tmp, { featureStates: {}, acStatuses: {} });
    const session = capSession.loadSession(tmp);
    // Should be a valid ISO string
    assert.ok(session.lastCheckpointAt);
    assert.ok(!Number.isNaN(Date.parse(session.lastCheckpointAt)));
    // Should be within the last 10 seconds
    const ageMs = Date.now() - Date.parse(session.lastCheckpointAt);
    assert.ok(ageMs >= 0 && ageMs < 10_000, `timestamp age ${ageMs}ms out of range`);
  });

  it('second call overwrites prior values', () => {
    const snap1 = { featureStates: { 'F-054': 'prototyped' }, acStatuses: {} };
    const snap2 = { featureStates: { 'F-054': 'tested' }, acStatuses: {} };

    applyCheckpoint(tmp, snap1, new Date('2026-04-01T00:00:00.000Z'));
    applyCheckpoint(tmp, snap2, new Date('2026-04-20T12:00:00.000Z'));

    const session = capSession.loadSession(tmp);
    assert.equal(session.lastCheckpointAt, '2026-04-20T12:00:00.000Z');
    assert.deepEqual(session.lastCheckpointSnapshot, snap2);
  });

  it('is idempotent for identical (snapshot, timestamp) inputs', () => {
    const snap = { featureStates: { 'F-001': 'tested' }, acStatuses: {} };
    const fixedNow = new Date('2026-04-20T10:00:00.000Z');
    applyCheckpoint(tmp, snap, fixedNow);
    const first = fs.readFileSync(path.join(tmp, '.cap', 'SESSION.json'), 'utf8');
    applyCheckpoint(tmp, snap, fixedNow);
    const second = fs.readFileSync(path.join(tmp, '.cap', 'SESSION.json'), 'utf8');
    assert.equal(first, second, 'second write with identical inputs must be byte-identical');
  });

  it('throws on missing projectRoot', () => {
    assert.throws(() => applyCheckpoint('', { featureStates: {}, acStatuses: {} }), TypeError);
    assert.throws(() => applyCheckpoint(undefined, { featureStates: {}, acStatuses: {} }), TypeError);
  });

  it('writes an empty snapshot structure when snapshot is null', () => {
    applyCheckpoint(tmp, null, new Date('2026-04-20T10:00:00.000Z'));
    const session = capSession.loadSession(tmp);
    assert.deepEqual(session.lastCheckpointSnapshot, { featureStates: {}, acStatuses: {} });
  });
});

// -------- integration: analyze -> applyCheckpoint -> analyze --------

describe('integration: full checkpoint cycle', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-checkpoint-int-'));
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    capSession.saveSession(tmp, capSession.getDefaultSession());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('after applyCheckpoint the next analyze on the same feature map returns breakpoint:null', () => {
    const featureMap = {
      features: [
        feature('F-054', 'tested', [ac('AC-1', 'tested')]),
        feature('F-055', 'prototyped'),
      ],
    };

    // First run: detects F-054 tested transition
    const firstSession = capSession.loadSession(tmp);
    const first = analyze(firstSession, featureMap);
    assert.ok(first.breakpoint, 'first run should find a breakpoint');
    assert.equal(first.breakpoint.featureId, 'F-054');
    assert.equal(first.plan.saveLabel, 'checkpoint-F-054');

    // Persist the snapshot
    applyCheckpoint(tmp, first.currentSnapshot, new Date('2026-04-20T10:00:00.000Z'));

    // Second run with identical feature map: no breakpoint
    const secondSession = capSession.loadSession(tmp);
    assert.deepEqual(secondSession.lastCheckpointSnapshot, first.currentSnapshot);
    const second = analyze(secondSession, featureMap);
    assert.equal(second.breakpoint, null);
    assert.equal(second.plan.message, 'Kein natürlicher Kontextbruch erkannt.');
  });

  it('detects a new transition in a follow-up analyze after applyCheckpoint', () => {
    const featureMapV1 = { features: [feature('F-054', 'tested')] };
    const featureMapV2 = {
      features: [feature('F-054', 'tested'), feature('F-055', 'shipped')],
    };

    const session1 = capSession.loadSession(tmp);
    const r1 = analyze(session1, featureMapV1);
    applyCheckpoint(tmp, r1.currentSnapshot);

    const session2 = capSession.loadSession(tmp);
    const r2 = analyze(session2, featureMapV2);
    assert.ok(r2.breakpoint);
    assert.equal(r2.breakpoint.featureId, 'F-055');
    assert.equal(r2.plan.saveLabel, 'checkpoint-F-055');
    assert.equal(r2.plan.message, 'Jetzt /compact, weil F-055 auf state=shipped.');
  });
});
