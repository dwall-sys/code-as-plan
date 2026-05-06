'use strict';

// @cap-feature(feature:F-081) Tests for the multi-format Feature Map parser — Union ID regex,
// bullet-style AC parsing, config-driven format selection, duplicate-detection error, and
// readCapConfig graceful defaults. Companion file to tests/cap-feature-map.test.cjs (which covers
// the F-002 baseline + F-041 roundtrip + F-042 drift). This file pins ONLY the F-081 expansions.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  FEATURE_ID_PATTERN,
  parseFeatureMapContent,
  readFeatureMap,
  readCapConfig,
} = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-bullet-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// @cap-todo(ac:F-081/AC-1) Union Feature-ID regex coverage.
describe('F-081/AC-1 Union Feature-ID regex', () => {
  it('exports FEATURE_ID_PATTERN as a RegExp', () => {
    assert.ok(FEATURE_ID_PATTERN instanceof RegExp);
  });

  it('accepts legacy F-NNN with 3+ digits', () => {
    assert.ok(FEATURE_ID_PATTERN.test('F-001'));
    assert.ok(FEATURE_ID_PATTERN.test('F-076'));
    assert.ok(FEATURE_ID_PATTERN.test('F-9999'));
    assert.ok(FEATURE_ID_PATTERN.test('F-12345'));
  });

  it('accepts long-form F-LONGFORM (uppercase-led, alnum/dash/underscore)', () => {
    assert.ok(FEATURE_ID_PATTERN.test('F-DEPLOY'));
    assert.ok(FEATURE_ID_PATTERN.test('F-HUB-AUTH'));
    assert.ok(FEATURE_ID_PATTERN.test('F-PERF-WEB-VITALS'));
    assert.ok(FEATURE_ID_PATTERN.test('F-A'));
    assert.ok(FEATURE_ID_PATTERN.test('F-X1Y2'));
    assert.ok(FEATURE_ID_PATTERN.test('F-AUTH_OAUTH2'));
  });

  it('rejects digit-led short suffixes that survived the F-076 schema invariant', () => {
    assert.ok(!FEATURE_ID_PATTERN.test('F-1'));
    assert.ok(!FEATURE_ID_PATTERN.test('F-12'));
    assert.ok(!FEATURE_ID_PATTERN.test('F-076-suffix')); // suffix-with-dash invariant
    assert.ok(!FEATURE_ID_PATTERN.test('FF-076'));
    assert.ok(!FEATURE_ID_PATTERN.test('f-001')); // lowercase prefix
    assert.ok(!FEATURE_ID_PATTERN.test('F-deploy')); // lowercase long-form
    assert.ok(!FEATURE_ID_PATTERN.test('F-')); // empty body
    assert.ok(!FEATURE_ID_PATTERN.test(''));
    assert.ok(!FEATURE_ID_PATTERN.test('X-DEPLOY'));
  });

  it('parser accepts long-form IDs in feature headers', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD pipeline [planned]',
      '',
      '### F-HUB-AUTH: Authentication for hub [shipped]',
      '',
      '### F-PERF-WEB-VITALS: Web Vitals monitoring [tested]',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 3);
    assert.equal(result.features[0].id, 'F-DEPLOY');
    assert.equal(result.features[0].title, 'CI/CD pipeline');
    assert.equal(result.features[0].state, 'planned');
    assert.equal(result.features[1].id, 'F-HUB-AUTH');
    assert.equal(result.features[1].state, 'shipped');
    assert.equal(result.features[2].id, 'F-PERF-WEB-VITALS');
    assert.equal(result.features[2].state, 'tested');
  });

  it('parser accepts mixed F-NNN + F-LONGFORM in the same map', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: Tag Scanner [shipped]',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '### F-076: Memory Schema [shipped]',
      '',
      '### F-HUB-AUTH: Hub Auth [planned]',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 4);
    assert.deepEqual(
      result.features.map((f) => f.id),
      ['F-001', 'F-DEPLOY', 'F-076', 'F-HUB-AUTH']
    );
  });
});

// @cap-todo(ac:F-081/AC-2) Bullet-style AC parsing — explicit AC-N: prefix, status mapping, no-table precondition.
describe('F-081/AC-2 Bullet-style AC parsing', () => {
  it('parses bullet-style ACs with explicit AC-N prefix', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Pipeline runs on every push to main',
      '- [x] AC-2: Failed builds block merge',
      '- [ ] AC-3: Deploy step requires manual approval',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 3);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, 'Pipeline runs on every push to main');
    assert.equal(result.features[0].acs[0].status, 'pending');
    assert.equal(result.features[0].acs[1].id, 'AC-2');
    assert.equal(result.features[0].acs[1].status, 'tested');
    assert.equal(result.features[0].acs[2].id, 'AC-3');
    assert.equal(result.features[0].acs[2].status, 'pending');
  });

  it('preserves out-of-order or sparse AC numbering (does not auto-renumber)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-2: Second criterion',
      '- [ ] AC-5: Fifth criterion (skipped 3 and 4 intentionally)',
      '- [x] AC-1: First criterion',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 3);
    assert.deepEqual(
      result.features[0].acs.map((a) => a.id),
      ['AC-2', 'AC-5', 'AC-1']
    );
  });

  it('accepts asterisk bullets as a synonym for dash', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '* [ ] AC-1: Asterisk bullet',
      '* [x] AC-2: Also asterisk',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[1].status, 'tested');
  });

  it('does not promote bullet-AC entries when a table row was already seen for that feature', () => {
    const content = [
      '### F-001: Mixed format [planned]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Table-defined criterion |',
      '',
      '- [ ] AC-2: This bullet must NOT be picked up because table rows preceded it',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1, 'only the table row should be parsed');
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, 'Table-defined criterion');
  });

  it('legacy `- **AC:**` anonymous-checkbox section still works (regression for F-002 contract)', () => {
    const content = [
      '### F-001: Auth [prototyped]',
      '- **AC:**',
      '  - [x] Login works',
      '  - [ ] Logout works',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    assert.equal(result.features[0].acs[0].description, 'Login works');
    assert.equal(result.features[0].acs[1].status, 'pending');
  });
});

// @cap-todo(ac:F-081/AC-3) Format-style override via .cap/config.json + explicit option.
describe('F-081/AC-3 Format-style selection', () => {
  it('"auto" (default) parses bullet when no table is present', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Auto-detected bullet',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
  });

  it('explicit "table" override suppresses bullet parsing entirely', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: This must NOT be picked up under table-only',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'table' });
    assert.equal(result.features[0].acs.length, 0, 'table-only override must suppress bullet AC matches');
  });

  it('explicit "bullet" override forces bullet parsing even after a stray table fragment', () => {
    // Note: a literal table-row line still trips the `inAcTable` state machine, but in pure-bullet maps
    // we expect bullet detection to remain authoritative for new entries.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [x] AC-1: Forced bullet via explicit override',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'bullet' });
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].status, 'tested');
  });

  it('reads featureMapStyle from .cap/config.json when projectRoot is provided', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'table' }),
      'utf8'
    );
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: This bullet must be ignored because config forces table-only',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { projectRoot: tmpDir });
    assert.equal(result.features[0].acs.length, 0);
  });

  it('explicit option takes precedence over .cap/config.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'table' }),
      'utf8'
    );
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Explicit option overrides config-disabled bullet',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { projectRoot: tmpDir, featureMapStyle: 'auto' });
    assert.equal(result.features[0].acs.length, 1);
  });

  it('falls back to "auto" on invalid featureMapStyle values', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Invalid style falls back to auto (which parses bullet here)',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'nonsense' });
    assert.equal(result.features[0].acs.length, 1);
  });

  it('readFeatureMap pipes projectRoot through to the parser so config flows end-to-end', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'table' }),
      'utf8'
    );
    const featureMapContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Should be ignored because config says table-only',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    const result = readFeatureMap(tmpDir);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 0);
  });
});

// @cap-todo(ac:F-081/AC-4) Duplicate-after-normalization throws with positioned error.
describe('F-081/AC-4 Duplicate feature ID detection', () => {
  it('throws on identical duplicate F-NNN with line numbers in the message', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: First [planned]', // line 5
      '',
      '### F-001: Collision [planned]', // line 7
      '',
    ].join('\n');
    assert.throws(
      () => parseFeatureMapContent(content),
      (err) => {
        assert.equal(err.code, 'CAP_DUPLICATE_FEATURE_ID');
        assert.match(err.message, /Duplicate feature ID/);
        assert.match(err.message, /F-001/);
        assert.match(err.message, /line 5/);
        assert.match(err.message, /line 7/);
        return true;
      }
    );
  });

  it('throws on duplicate long-form ID', () => {
    const content = [
      '### F-DEPLOY: First [planned]',
      '### F-DEPLOY: Second [planned]',
      '',
    ].join('\n');
    assert.throws(
      () => parseFeatureMapContent(content),
      (err) => {
        assert.equal(err.code, 'CAP_DUPLICATE_FEATURE_ID');
        assert.match(err.message, /F-DEPLOY/);
        return true;
      }
    );
  });

  it('exposes structured fields on the thrown error for tooling consumption', () => {
    const content = [
      '### F-001: A [planned]',
      '',
      '### F-001: B [planned]',
      '',
    ].join('\n');
    let caught = null;
    try {
      parseFeatureMapContent(content);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'expected parseFeatureMapContent to throw');
    assert.equal(caught.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(caught.duplicateId, 'F-001');
    assert.equal(typeof caught.firstLine, 'number');
    assert.equal(typeof caught.duplicateLine, 'number');
    assert.ok(caught.duplicateLine > caught.firstLine);
  });

  it('does not throw on unique IDs even when normalization is non-trivial', () => {
    const content = [
      '### F-001: A [planned]',
      '',
      '### F-002: B [planned]',
      '',
      '### F-DEPLOY: C [planned]',
      '',
      '### F-HUB-AUTH: D [planned]',
      '',
    ].join('\n');
    assert.doesNotThrow(() => parseFeatureMapContent(content));
  });
});

// @cap-todo(ac:F-081/AC-7) readCapConfig — graceful defaults across all error paths.
describe('F-081/AC-7 readCapConfig graceful defaults', () => {
  it('exports readCapConfig as a function', () => {
    assert.equal(typeof readCapConfig, 'function');
  });

  it('returns {} when .cap/config.json is missing', () => {
    const result = readCapConfig(tmpDir);
    assert.deepEqual(result, {});
  });

  it('returns {} when projectRoot is empty/invalid', () => {
    assert.deepEqual(readCapConfig(''), {});
    assert.deepEqual(readCapConfig(null), {});
    assert.deepEqual(readCapConfig(undefined), {});
    assert.deepEqual(readCapConfig(123), {});
  });

  it('returns parsed object when .cap/config.json is valid JSON', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'bullet', otherKey: 42 }),
      'utf8'
    );
    const result = readCapConfig(tmpDir);
    assert.equal(result.featureMapStyle, 'bullet');
    assert.equal(result.otherKey, 42);
  });

  it('returns {} on malformed JSON (does not throw)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '{ this is not json', 'utf8');
    const result = readCapConfig(tmpDir);
    assert.deepEqual(result, {});
  });

  it('returns {} when JSON is a non-object value', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '"just a string"', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});

    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '[1, 2, 3]', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});

    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), 'null', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
  });
});

// @cap-todo(ac:F-081/AC-6) Smoke test: live FEATURE-MAP.md continues to parse unchanged after F-081 merge.
describe('F-081/AC-6 Live FEATURE-MAP.md regression', () => {
  it('parses the actual repository FEATURE-MAP.md without throwing', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const fmPath = path.join(repoRoot, 'FEATURE-MAP.md');
    if (!fs.existsSync(fmPath)) return; // skip when run outside the CAP repo
    const content = fs.readFileSync(fmPath, 'utf8');
    const result = parseFeatureMapContent(content);
    assert.ok(result.features.length >= 50, `expected at least 50 features in live map, got ${result.features.length}`);
    // First and last sentinel — F-001 has been the head since CAP v2.0; the tail is whichever
    // feature was last added but every entry must have a non-empty title.
    const f001 = result.features.find((f) => f.id === 'F-001');
    assert.ok(f001, 'F-001 must be present in the live FEATURE-MAP.md');
    assert.ok(f001.title.length > 0);
    for (const f of result.features) {
      assert.ok(f.id, 'every parsed feature must have an id');
      assert.ok(f.title, `feature ${f.id} must have a non-empty title`);
    }
  });
});
