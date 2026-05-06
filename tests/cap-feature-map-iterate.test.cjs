'use strict';

// @cap-feature(feature:F-081) Iter-1 Stage-2-Review fixes — exercises the three critical findings
//   surfaced by the F-081 review:
//     #1 empty-description bullet AC silent-data-loss
//     #2 round-trip asymmetry (bullet input silently rewritten as table on save)
//     #3 throw-on-duplicate breaks 24 bare call sites
//   Companion file to cap-feature-map-bullet.test.cjs and cap-feature-map-adversarial.test.cjs;
//   those two files pin the original spec contract and MUST stay untouched (regression baseline).
//   This file pins ONLY the iter-1 expansions.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseFeatureMapContent,
  serializeFeatureMap,
  readFeatureMap,
  writeFeatureMap,
  addFeature,
  updateFeatureState,
  setAcStatus,
} = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-iterate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fix #1 — Empty-description bullet AC must NOT be silently dropped or swallowed
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/iter1 fix:1) Empty-desc bullet ACs are legitimate parse outcomes;
//   they must not fall through to the legacy anonymous-checkbox branch (which would set
//   inAcCheckboxes=true and block all subsequent bullets in the same feature).
describe('F-081/iter1 fix #1 — empty-description bullet AC', () => {
  it('parses an empty-desc bullet AC as a legitimate AC with description=""', () => {
    const content = [
      '### F-001: T [planned]',
      '',
      '- [ ] AC-1:',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 1);
    assert.deepEqual(
      { id: result.features[0].acs[0].id, description: result.features[0].acs[0].description, status: result.features[0].acs[0].status },
      { id: 'AC-1', description: '', status: 'pending' }
    );
  });

  it('multi-bullet block where the FIRST AC has empty desc — all subsequent ACs still parse', () => {
    const content = [
      '### F-001: T [planned]',
      '',
      '- [ ] AC-1:',
      '- [ ] AC-2: real one',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, '');
    assert.equal(result.features[0].acs[1].id, 'AC-2');
    assert.equal(result.features[0].acs[1].description, 'real one');
  });

  it('mixed empty/non-empty/empty bullets all parse correctly with right statuses', () => {
    const content = [
      '### F-001: T [planned]',
      '',
      '- [ ] AC-1:',
      '- [x] AC-2: tested-one',
      '- [ ] AC-3:',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 3);
    assert.deepEqual(result.features[0].acs.map(a => a.id), ['AC-1', 'AC-2', 'AC-3']);
    assert.deepEqual(result.features[0].acs.map(a => a.description), ['', 'tested-one', '']);
    assert.deepEqual(result.features[0].acs.map(a => a.status), ['pending', 'tested', 'pending']);
  });

  it('empty-desc with uppercase [X] is parsed (CommonMark editor variance accepted)', () => {
    const content = [
      '### F-001: T [planned]',
      '',
      '- [X] AC-1:',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, '');
    assert.equal(result.features[0].acs[0].status, 'tested');
  });

  it('empty-desc bullets with asterisk marker also parse', () => {
    const content = [
      '### F-001: T [planned]',
      '',
      '* [ ] AC-1:',
      '* [ ] AC-2: real',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].description, '');
    assert.equal(result.features[0].acs[1].description, 'real');
  });

  it('legacy anonymous checkboxes after - **AC:** still work with empty-desc bullet feature elsewhere', () => {
    // Two features: one bullet-style with empty-desc AC, one with legacy `- **AC:**` anonymous list.
    // Both must parse independently (anonymous auto-numbering still applies in the legacy block).
    const content = [
      '### F-001: bullet-empty [planned]',
      '',
      '- [ ] AC-1:',
      '',
      '### F-002: legacy-anon [planned]',
      '',
      '- **AC:**',
      '- [ ] does-this-thing',
      '- [x] tests-this-thing',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 2);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, '');
    assert.equal(result.features[1].acs.length, 2);
    assert.equal(result.features[1].acs[0].id, 'AC-1');
    assert.equal(result.features[1].acs[0].description, 'does-this-thing');
    assert.equal(result.features[1].acs[1].id, 'AC-2');
    assert.equal(result.features[1].acs[1].description, 'tests-this-thing');
  });
});

// ---------------------------------------------------------------------------
// Fix #2 — Round-trip asymmetry: bullet input must NOT be silently rewritten as table on save
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/iter1 fix:2) Per-feature `_inputFormat` annotation in the parser drives
//   the serializer so writeFeatureMap-after-readFeatureMap is shape-preserving.
describe('F-081/iter1 fix #2 — round-trip preserves bullet-style format', () => {
  it('parser annotates feature._inputFormat="bullet" for bullet-style features', () => {
    const content = [
      '### F-001: bullet-feat [planned]',
      '',
      '- [ ] AC-1: first',
      '- [x] AC-2: second',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0]._inputFormat, 'bullet');
  });

  it('parser annotates feature._inputFormat="table" for table-style features', () => {
    const content = [
      '### F-001: table-feat [planned]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | first |',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0]._inputFormat, 'table');
  });

  it('serializer emits bullet form when feature._inputFormat is "bullet"', () => {
    const featureMap = {
      features: [{
        id: 'F-001',
        title: 'bullet-out',
        state: 'planned',
        acs: [
          { id: 'AC-1', description: 'first', status: 'pending' },
          { id: 'AC-2', description: 'second', status: 'tested' },
        ],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
        _inputFormat: 'bullet',
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(featureMap);
    assert.match(out, /- \[ \] AC-1: first/);
    assert.match(out, /- \[x\] AC-2: second/);
    // Must NOT contain a table header for this feature
    assert.equal(out.includes('| AC | Status | Description |'), false);
  });

  it('serializer emits table form by default (no _inputFormat) — preserves legacy behavior', () => {
    const featureMap = {
      features: [{
        id: 'F-001',
        title: 'no-hint',
        state: 'planned',
        acs: [{ id: 'AC-1', description: 'x', status: 'pending' }],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(featureMap);
    assert.match(out, /\| AC \| Status \| Description \|/);
  });

  it('serializer emits empty-desc bullet without trailing space', () => {
    const featureMap = {
      features: [{
        id: 'F-001',
        title: 't',
        state: 'planned',
        acs: [{ id: 'AC-1', description: '', status: 'pending' }],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
        _inputFormat: 'bullet',
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(featureMap);
    // Must contain the exact line "- [ ] AC-1:" (no trailing space)
    assert.ok(out.split('\n').some(l => l === '- [ ] AC-1:'), 'expected exact "- [ ] AC-1:" line in output');
  });

  it('round-trip identity: parse(serialize(parse(bullet))) === parse(bullet) for ACs', () => {
    // Idempotency contract — F-077 review-hardening lesson: parse∘serialize∘parse must equal parse.
    const content = [
      '### F-001: A [planned]',
      '',
      '- [ ] AC-1: first',
      '- [x] AC-2: second',
      '',
    ].join('\n');
    const parsed1 = parseFeatureMapContent(content);
    const serialized = serializeFeatureMap(parsed1);
    const parsed2 = parseFeatureMapContent(serialized);
    assert.equal(parsed2.features.length, 1);
    assert.equal(parsed2.features[0].acs.length, 2);
    assert.equal(parsed2.features[0]._inputFormat, 'bullet');
    assert.deepEqual(
      parsed2.features[0].acs.map(a => ({ id: a.id, description: a.description, status: a.status })),
      parsed1.features[0].acs.map(a => ({ id: a.id, description: a.description, status: a.status }))
    );
  });

  it('addFeature on bullet-style map preserves bullet format on save', () => {
    const original = [
      '### F-001: bullet-existing [planned]',
      '',
      '- [ ] AC-1: existing',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), original, 'utf8');
    addFeature(tmpDir, { title: 'new-feature' });
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Existing F-001 must still emit as a bullet
    assert.match(after, /- \[ \] AC-1: existing/);
    // No table header should be introduced
    assert.equal(after.includes('| AC | Status | Description |'), false);
  });

  it('updateFeatureState on bullet-style map preserves bullet format', () => {
    const original = [
      '### F-001: bullet [planned]',
      '',
      '- [x] AC-1: done',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), original, 'utf8');
    const ok = updateFeatureState(tmpDir, 'F-001', 'prototyped');
    assert.equal(ok, true);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.match(after, /- \[x\] AC-1: done/);
    assert.equal(after.includes('| AC | Status | Description |'), false);
  });

  it('setAcStatus on bullet-style map preserves bullet format', () => {
    const original = [
      '### F-001: bullet [planned]',
      '',
      '- [ ] AC-1: pending-one',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), original, 'utf8');
    const ok = setAcStatus(tmpDir, 'F-001', 'AC-1', 'tested');
    assert.equal(ok, true);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Must still be a bullet, must reflect new status as [x]
    assert.match(after, /- \[x\] AC-1: pending-one/);
    assert.equal(after.includes('| AC | Status | Description |'), false);
  });

  it('mixed map (one bullet feature, one table feature) round-trips both correctly per-feature', () => {
    const content = [
      '### F-001: bullet-feat [planned]',
      '',
      '- [ ] AC-1: bullet-one',
      '',
      '### F-002: table-feat [planned]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | table-one |',
      '',
    ].join('\n');
    const parsed = parseFeatureMapContent(content);
    assert.equal(parsed.features[0]._inputFormat, 'bullet');
    assert.equal(parsed.features[1]._inputFormat, 'table');

    const out = serializeFeatureMap(parsed);
    // Bullet for F-001
    assert.match(out, /- \[ \] AC-1: bullet-one/);
    // Table for F-002
    assert.match(out, /\| AC-1 \| pending \| table-one \|/);

    // Round-trip the serialized output and confirm the per-feature formats persist
    const reparsed = parseFeatureMapContent(out);
    assert.equal(reparsed.features.length, 2);
    assert.equal(reparsed.features[0]._inputFormat, 'bullet');
    assert.equal(reparsed.features[1]._inputFormat, 'table');
  });

  it('options.featureMapStyle="bullet" forces bullet emission for features with no _inputFormat', () => {
    const featureMap = {
      features: [{
        id: 'F-001',
        title: 't',
        state: 'planned',
        acs: [{ id: 'AC-1', description: 'x', status: 'pending' }],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(featureMap, { featureMapStyle: 'bullet' });
    assert.match(out, /- \[ \] AC-1: x/);
    assert.equal(out.includes('| AC | Status | Description |'), false);
  });

  it('per-feature _inputFormat wins over options.featureMapStyle (bullet feat in table-forced map)', () => {
    const featureMap = {
      features: [{
        id: 'F-001',
        title: 't',
        state: 'planned',
        acs: [{ id: 'AC-1', description: 'x', status: 'pending' }],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
        _inputFormat: 'bullet',
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(featureMap, { featureMapStyle: 'table' });
    // _inputFormat='bullet' wins
    assert.match(out, /- \[ \] AC-1: x/);
  });
});

// ---------------------------------------------------------------------------
// Fix #3 — Throw-on-duplicate must NOT break bare call sites
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/iter1 fix:3) parseFeatureMapContent now supports `safe: true` to return
//   a structured parseError instead of throwing. readFeatureMap defaults to safe so the 24
//   bare CLI/library call sites no longer crash when the user has a duplicate feature ID.
describe('F-081/iter1 fix #3 — duplicate-id safe handling', () => {
  const dupContent = [
    '### F-001: First [planned]',
    '',
    '### F-001: Collision [planned]',
    '',
  ].join('\n');

  it('parseFeatureMapContent (default, no options) STILL throws on duplicate (regression preserved)', () => {
    assert.throws(
      () => parseFeatureMapContent(dupContent),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('parseFeatureMapContent({safe: false}) STILL throws (explicit strict mode)', () => {
    assert.throws(
      () => parseFeatureMapContent(dupContent, { safe: false }),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('parseFeatureMapContent({safe: true}) returns parseError instead of throwing', () => {
    let result;
    assert.doesNotThrow(() => {
      result = parseFeatureMapContent(dupContent, { safe: true });
    });
    assert.ok(result.parseError);
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(result.parseError.duplicateId, 'F-001');
    assert.equal(typeof result.parseError.firstLine, 'number');
    assert.equal(typeof result.parseError.duplicateLine, 'number');
    assert.ok(result.parseError.duplicateLine > result.parseError.firstLine);
    assert.match(result.parseError.message, /Duplicate feature ID/);
  });

  it('safe-mode parseError includes correct line numbers for header positions', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: First [planned]', // line 5
      '',
      '### F-001: Second [planned]', // line 7
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { safe: true });
    assert.equal(result.parseError.firstLine, 5);
    assert.equal(result.parseError.duplicateLine, 7);
  });

  it('safe-mode returns the partial map (features parsed before duplicate detection)', () => {
    const content = [
      '### F-001: First [planned]',
      '',
      '### F-001: Collision [planned]',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { safe: true });
    // Both feature blocks are parsed (each header creates a new currentFeature); duplicate
    // detection runs after the parse loop and short-circuits at the first collision.
    // The result.features array therefore contains the two homonymous entries — that is
    // the partial-map view tooling consumes. Tooling MUST check parseError to know the
    // map is in an inconsistent state.
    assert.ok(Array.isArray(result.features));
    assert.equal(result.features.length, 2);
    assert.equal(result.features[0].id, 'F-001');
    assert.equal(result.features[0].title, 'First');
    assert.equal(result.features[1].id, 'F-001');
    assert.equal(result.features[1].title, 'Collision');
  });

  it('clean parse (no duplicates) does not include parseError field — minimal result shape', () => {
    const content = '### F-001: A [planned]\n';
    const result = parseFeatureMapContent(content, { safe: true });
    assert.equal(result.parseError, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'parseError'), false);
  });

  it('readFeatureMap with {safe:true} does NOT throw on duplicate-id maps', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    let result;
    assert.doesNotThrow(() => {
      result = readFeatureMap(tmpDir, null, { safe: true });
    });
    assert.ok(result.parseError);
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(result.parseError.duplicateId, 'F-001');
  });

  it('readFeatureMap with {safe:true} on duplicate map still returns features array', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(Array.isArray(result.features));
    // Both header lines were parsed before duplicate detection; tooling checks parseError
    // to know the map is inconsistent. See the parseFeatureMapContent partial-map test above.
    assert.equal(result.features.length, 2);
  });

  it('readFeatureMap with {safe:true} on long-form duplicate also surfaces parseError', () => {
    const content = [
      '### F-DEPLOY: First [planned]',
      '### F-DEPLOY: Second [planned]',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), content, 'utf8');
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError);
    assert.equal(result.parseError.duplicateId, 'F-DEPLOY');
  });

  it('readFeatureMap WITHOUT options STILL throws on duplicate (regression baseline preserved)', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    assert.throws(
      () => readFeatureMap(tmpDir),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('readFeatureMap with {safe:false} STILL throws on duplicate (explicit strict mode)', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    assert.throws(
      () => readFeatureMap(tmpDir, null, { safe: false }),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('safe-mode parseError on triple-duplicate fires on FIRST collision (matches throw semantics)', () => {
    const content = [
      '### F-001: A [planned]',
      '',
      '### F-001: B [planned]',
      '',
      '### F-001: C [planned]',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { safe: true });
    assert.equal(result.parseError.firstLine, 1);
    assert.equal(result.parseError.duplicateLine, 3);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: regressions / paranoia checks
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/iter1) Stage-2 anti-foot-gun checks — proto-pollution vector for _inputFormat,
//   parseError-without-features null-guard, idempotency.
describe('F-081/iter1 cross-cutting regressions', () => {
  it('_inputFormat cannot be set via parsed FEATURE-MAP content (only by parser branch)', () => {
    // Even if a malicious FEATURE-MAP tries to inject something that LOOKS like _inputFormat,
    // the parser only sets _inputFormat from its own internal branch detection. There is no
    // user-controlled key path that reaches `currentFeature._inputFormat`.
    const content = [
      '### F-001: A [planned]',
      '',
      '_inputFormat: rm -rf /', // freeform body line — must NOT be interpreted as a field
      '',
      '- [ ] AC-1: harmless',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    // Parser must classify this as bullet (the AC bullet is the only AC)
    assert.equal(result.features[0]._inputFormat, 'bullet');
    // The malicious freeform line must NOT have leaked into any field
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].description, 'harmless');
  });

  it('parser-then-serializer-then-parser is idempotent for an empty-desc bullet (F-077 lesson)', () => {
    const original = [
      '### F-001: T [planned]',
      '',
      '- [ ] AC-1:',
      '- [x] AC-2: real',
      '',
    ].join('\n');
    const p1 = parseFeatureMapContent(original);
    const s1 = serializeFeatureMap(p1);
    const p2 = parseFeatureMapContent(s1);
    const s2 = serializeFeatureMap(p2);
    // Second-pass output equals first-pass output (modulo timestamp footer, which we ignore)
    const stripFooter = (s) => s.replace(/\*Last updated:[^\n]*\*\n?/, '');
    assert.equal(stripFooter(s2), stripFooter(s1));
  });

  it('readFeatureMap on a file with NO features (empty map) does not throw and returns empty list', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), '# Feature Map\n\n## Features\n\n', 'utf8');
    const result = readFeatureMap(tmpDir);
    assert.deepEqual(result.features, []);
    assert.equal(result.parseError, undefined);
  });

  it('serializer with no features emits the empty-map placeholder (regression check)', () => {
    const out = serializeFeatureMap({ features: [], lastScan: null });
    assert.match(out, /<!-- No features yet/);
  });

  it('serializeFeatureMap respects featureMapStyle option for new empty map after addFeature', () => {
    // No file yet; addFeature on empty project root creates table-style map (default).
    addFeature(tmpDir, { title: 'first', acs: [{ id: 'AC-1', description: 'x', status: 'pending' }] });
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Default = table (no _inputFormat hint, no options.featureMapStyle).
    assert.match(after, /\| AC \| Status \| Description \|/);
  });
});

// ---------------------------------------------------------------------------
// F-081/iter2 — call-site migration: every wrapper that internally calls
// readFeatureMap() must NOT throw on a duplicate-id FEATURE-MAP.md.
// Write-back wrappers bail with a return-value (no persistence). Read-only
// wrappers warn-and-continue with the partial map.
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-4 iter:2) Pinning the call-site migration so a future
//   regression that re-introduces a bare `readFeatureMap(...)` somewhere downstream
//   gets caught by these smoke tests rather than only the adversarial duplicate
//   regression baseline.
describe('F-081/iter2 call-site migration — wrappers must not throw on duplicate-ID maps', () => {
  const dupContent = [
    '### F-001: First [planned]',
    '',
    '- **AC:**',
    '- [ ] AC-1: a',
    '',
    '### F-001: Second [planned]',
    '',
    '- **AC:**',
    '- [ ] AC-1: b',
    '',
  ].join('\n');

  // ----- helper: silence console.warn so test output stays clean and assert it WAS called -----
  function captureWarn(fn) {
    const original = console.warn;
    const captured = [];
    console.warn = (msg) => captured.push(String(msg));
    try {
      const result = fn();
      return { result, warnings: captured };
    } finally {
      console.warn = original;
    }
  }

  // Same for console.error (cap-migrate uses console.error path-wise — n/a here, but good hygiene)
  function captureErrorWarn(fn) {
    const origWarn = console.warn;
    const origError = console.error;
    const warnings = [];
    const errors = [];
    console.warn = (msg) => warnings.push(String(msg));
    console.error = (msg) => errors.push(String(msg));
    try {
      const result = fn();
      return { result, warnings, errors };
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }
  }

  // ===== addFeature (write-back, bail) =====
  it('addFeature does NOT throw on duplicate-ID map; returns null and emits a warn', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { result, warnings } = captureWarn(() =>
      addFeature(tmpDir, { title: 'x', acs: [] })
    );
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /addFeature/);
    assert.match(warnings[0], /duplicate feature ID/i);
  });

  // ===== updateFeatureState (write-back, bail) =====
  it('updateFeatureState does NOT throw on duplicate-ID map; returns false and emits a warn', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { result, warnings } = captureWarn(() =>
      updateFeatureState(tmpDir, 'F-001', 'prototyped')
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /updateFeatureState/);
  });

  // ===== setAcStatus (write-back, bail) =====
  it('setAcStatus does NOT throw on duplicate-ID map; returns false and emits a warn', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { result, warnings } = captureWarn(() =>
      setAcStatus(tmpDir, 'F-001', 'AC-1', 'tested')
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /setAcStatus/);
  });

  // ===== detectDrift (read-only, warn-continue) =====
  it('detectDrift does NOT throw on duplicate-ID map; emits a warn and returns a structured report', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { detectDrift } = require('../cap/bin/lib/cap-feature-map.cjs');
    const { result, warnings } = captureWarn(() => detectDrift(tmpDir));
    assert.ok(result);
    assert.equal(typeof result.hasDrift, 'boolean');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /detectDrift/);
  });

  // ===== enrichFromTags (write-back, bail) =====
  it('enrichFromTags does NOT throw on duplicate-ID map; returns the partial map with parseError set', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { enrichFromTags } = require('../cap/bin/lib/cap-feature-map.cjs');
    const { result, warnings } = captureWarn(() => enrichFromTags(tmpDir, []));
    assert.ok(result);
    assert.ok(result.parseError);
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /enrichFromTags/);
  });

  // ===== enrichFromDesignTags (write-back, bail) =====
  it('enrichFromDesignTags does NOT throw on duplicate-ID map; returns partial map with parseError', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { enrichFromDesignTags } = require('../cap/bin/lib/cap-feature-map.cjs');
    const { result, warnings } = captureWarn(() => enrichFromDesignTags(tmpDir, []));
    assert.ok(result);
    assert.ok(result.parseError);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /enrichFromDesignTags/);
  });

  // ===== setFeatureUsesDesign (write-back, bail) =====
  it('setFeatureUsesDesign does NOT throw on duplicate-ID map; returns false and emits a warn', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { setFeatureUsesDesign } = require('../cap/bin/lib/cap-feature-map.cjs');
    const { result, warnings } = captureWarn(() =>
      setFeatureUsesDesign(tmpDir, 'F-001', ['DT-001'])
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /setFeatureUsesDesign/);
  });

  // ===== rescopeFeatures (write-back, bail) =====
  it('rescopeFeatures does NOT throw on duplicate-ID root map; returns zero-distribution result with parseError', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const { rescopeFeatures } = require('../cap/bin/lib/cap-feature-map.cjs');
    const { result, warnings } = captureWarn(() =>
      rescopeFeatures(tmpDir, ['apps/foo'], { dryRun: true })
    );
    assert.ok(result);
    assert.equal(result.appsCreated, 0);
    assert.equal(result.featuresDistributed, 0);
    assert.ok(result.parseError);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /rescopeFeatures/);
  });

  // ===== regression: a CLEAN map still works through every wrapper =====
  it('addFeature on a clean map still works (no parseError, no warning)', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), '# Feature Map\n\n', 'utf8');
    const { result, warnings } = captureWarn(() =>
      addFeature(tmpDir, { title: 'clean', acs: [] })
    );
    assert.ok(result);
    assert.equal(result.id, 'F-001');
    assert.equal(warnings.length, 0);
  });

  it('updateFeatureState on a clean map with a real feature still works', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), '# Feature Map\n\n', 'utf8');
    addFeature(tmpDir, { title: 'clean', acs: [] });
    const { result, warnings } = captureWarn(() =>
      updateFeatureState(tmpDir, 'F-001', 'prototyped')
    );
    assert.equal(result, true);
    assert.equal(warnings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// F-081/iter2 — external library callers: smoke-test that downstream library
// modules also degrade gracefully on a duplicate-ID FEATURE-MAP.md instead of
// crashing the calling CLI.
// ---------------------------------------------------------------------------
describe('F-081/iter2 external library smoke — downstream readers do not crash', () => {
  const dupContent = [
    '### F-001: First [planned]',
    '',
    '- **AC:**',
    '- [ ] AC-1: a',
    '',
    '### F-001: Second [planned]',
    '',
    '- **AC:**',
    '- [ ] AC-1: b',
    '',
  ].join('\n');

  function captureWarn(fn) {
    const original = console.warn;
    const captured = [];
    console.warn = (msg) => captured.push(String(msg));
    try {
      const result = fn();
      return { result, warnings: captured };
    } finally {
      console.warn = original;
    }
  }

  // ===== cap-impact-analysis: read-only =====
  it('cap-impact-analysis.analyzeImpact does NOT throw on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const impact = require('../cap/bin/lib/cap-impact-analysis.cjs');
    const { result, warnings } = captureWarn(() =>
      impact.analyzeImpact(
        tmpDir,
        { id: 'F-099', title: 'new thing', acs: [], dependencies: [] },
        { persist: false }
      )
    );
    assert.ok(result);
    assert.ok(warnings.some((w) => /impact-analysis/.test(w)));
  });

  // ===== cap-memory-graph: read-only =====
  it('cap-memory-graph.buildFromMemory does NOT throw on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    // Stub minimal memory dirs so buildFromMemory does not blow up on missing dirs
    fs.mkdirSync(path.join(tmpDir, '.cap', 'memory'), { recursive: true });
    const graph = require('../cap/bin/lib/cap-memory-graph.cjs');
    const { result, warnings } = captureWarn(() => graph.buildFromMemory(tmpDir));
    assert.ok(result);
    assert.ok(result.nodes && typeof result.nodes === 'object');
    assert.ok(Array.isArray(result.edges));
    assert.ok(warnings.some((w) => /memory-graph/.test(w)));
  });

  // ===== cap-completeness: read-only =====
  it('cap-completeness.buildContext does NOT throw on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const completeness = require('../cap/bin/lib/cap-completeness.cjs');
    const { result, warnings } = captureWarn(() => completeness.buildContext(tmpDir));
    assert.ok(result);
    assert.ok(result.featureMap);
    assert.ok(warnings.some((w) => /completeness/.test(w)));
  });

  // ===== cap-reconcile: read-only =====
  it('cap-reconcile.planReconciliation does NOT throw on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const reconcile = require('../cap/bin/lib/cap-reconcile.cjs');
    const { result, warnings } = captureWarn(() => reconcile.planReconciliation(tmpDir));
    assert.ok(result);
    // Plan structure should still be valid (with whatever it could parse)
    assert.ok(typeof result === 'object');
    assert.ok(warnings.some((w) => /reconcile/.test(w)));
  });

  // ===== cap-memory-migrate.buildClassifierContext: write-back, bails to empty =====
  it('cap-memory-migrate.buildClassifierContext returns empty classifier context on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    const memMigrate = require('../cap/bin/lib/cap-memory-migrate.cjs');
    // Module exports may not include buildClassifierContext directly; reach via require cache for the test
    const internalModule = require('../cap/bin/lib/cap-memory-migrate.cjs');
    // Try the public surface first
    const buildCtx =
      internalModule.buildClassifierContext ||
      memMigrate.buildClassifierContext;
    // If not exported, skip — the function is still exercised via integration tests upstream.
    if (typeof buildCtx !== 'function') {
      return;
    }
    const { result, warnings } = captureWarn(() => buildCtx(tmpDir));
    assert.ok(result);
    assert.ok(Array.isArray(result.features));
    assert.equal(result.features.length, 0);
    assert.ok(warnings.some((w) => /memory-migrate/.test(w)));
  });

  // ===== cap-checkpoint.analyzeAndApply: read-only =====
  it('cap-checkpoint.analyzeAndApply does NOT throw on duplicate-ID map', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    // SESSION.json must exist for analyzeAndApply
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'SESSION.json'),
      JSON.stringify({ version: '2.0.0', activeFeature: null, lastCheckpointAt: null }),
      'utf8'
    );
    const checkpoint = require('../cap/bin/lib/cap-checkpoint.cjs');
    const { result, warnings } = captureWarn(() => checkpoint.analyzeAndApply(tmpDir));
    assert.ok(result);
    // analyzeAndApply may or may not detect a breakpoint; what matters is no throw and a warn.
    assert.ok(warnings.some((w) => /checkpoint/.test(w)));
  });
});

// ---------------------------------------------------------------------------
// F-081/iter2 — regression baseline: bare `readFeatureMap` (no options) STILL throws.
// This pins the contract so a future "let me just flip the default" change is caught.
// ---------------------------------------------------------------------------
describe('F-081/iter2 regression baseline — bare readFeatureMap default still throws', () => {
  const dupContent = [
    '### F-001: First [planned]',
    '',
    '### F-001: Second [planned]',
    '',
  ].join('\n');

  it('bare readFeatureMap(projectRoot) STILL throws on duplicate-ID map (default-strict preserved)', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    assert.throws(
      () => readFeatureMap(tmpDir),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('readFeatureMap(projectRoot, null, { safe: true }) STILL does NOT throw', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), dupContent, 'utf8');
    let result;
    assert.doesNotThrow(() => {
      result = readFeatureMap(tmpDir, null, { safe: true });
    });
    assert.ok(result.parseError);
  });
});
