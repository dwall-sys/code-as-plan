'use strict';

// @cap-feature(feature:F-088) Pre-write safety net for writeFeatureMap (AC-7).
//   When a parse → mutate → serialize round-trip loses unstructured content (free-text
//   descriptions, **Group:** markers, --- separators), the resulting file is dramatically
//   smaller than the on-disk version. This safety net throws CAP_FEATURE_MAP_SHRINK_GUARD
//   instead of silently committing the data loss. Real-world trigger: GoetzeInvest hub
//   reconcile run shrunk apps/hub/FEATURE-MAP.md from 3303 → 1902 lines.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const fm = require('../cap/bin/lib/cap-feature-map.cjs');

function mkProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fm-safety-'));
}
function rm(root) { fs.rmSync(root, { recursive: true, force: true }); }

function buildFatMap(featureCount = 50, descLines = 5) {
  // Simulate a real-world FEATURE-MAP with lots of free-text description per feature
  // that the parser does not preserve.
  const lines = [
    '# Feature Map',
    '',
    '> Single source of truth for feature identity, state, acceptance criteria, and relationships.',
    '> Auto-enriched by `@cap-feature` tags and dependency analysis.',
    '',
    '## Features',
    '',
  ];
  for (let i = 1; i <= featureCount; i++) {
    const id = 'F-' + String(i).padStart(3, '0');
    lines.push(`### ${id}: Feature ${i} title [planned]`);
    lines.push('');
    for (let d = 0; d < descLines; d++) {
      lines.push(`Some descriptive prose line ${d + 1} that the parser does not capture.`);
    }
    lines.push('');
    lines.push('| AC | Status | Description |');
    lines.push('|----|--------|-------------|');
    lines.push('| AC-1 | planned | Acceptance criterion text |');
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

test('AC-7: writeFeatureMap throws CAP_FEATURE_MAP_SHRINK_GUARD on >50% shrink', () => {
  const root = mkProject();
  try {
    // Write a fat map that would lose its prose on round-trip
    const fatContent = buildFatMap(20, 5); // ~280 lines with prose
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), fatContent);

    // Read + write WITHOUT preserving prose → triggers shrink
    const map = fm.readFeatureMap(root);
    let threw = null;
    try {
      fm.writeFeatureMap(root, map);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'shrink-guard must throw on lossy round-trip');
    assert.equal(threw.code, 'CAP_FEATURE_MAP_SHRINK_GUARD');
    assert.ok(threw.oldLines > threw.newLines);
    assert.match(threw.message, /lossy round-trip/);
    assert.match(threw.message, /F-088/);

    // The file on disk MUST be unchanged after the throw
    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(after, fatContent, 'file must be byte-identical after aborted write');
  } finally {
    rm(root);
  }
});

test('AC-7: small honest re-formatting (<50% shrink) still allowed', () => {
  const root = mkProject();
  try {
    // Small map (10 features, no prose) — round-trip is mostly idempotent
    const slimContent = buildFatMap(10, 0);
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), slimContent);

    const map = fm.readFeatureMap(root);
    // This should NOT throw — the round-trip changes are minor whitespace
    fm.writeFeatureMap(root, map);
    // No assertion on content — just that it succeeded
  } finally {
    rm(root);
  }
});

test('AC-7: allowShrink:true bypasses the guard', () => {
  const root = mkProject();
  try {
    const fatContent = buildFatMap(20, 5);
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), fatContent);

    const map = fm.readFeatureMap(root);
    const result = fm.writeFeatureMap(root, map, undefined, { allowShrink: true });
    assert.equal(result, true);
    // File IS changed (shrunk) — that's the whole point of opt-in override
    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');
    assert.ok(after.length < fatContent.length, 'with allowShrink the write went through');
  } finally {
    rm(root);
  }
});

test('AC-7: maps under SAFETY_MIN_LINES (50) escape the guard even on >50% shrink', () => {
  const root = mkProject();
  try {
    // Tiny map (3 features, no prose) — total <50 lines. Half-shrink is allowed by floor.
    const tinyContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: A [planned]',
      '',
      '### F-002: B [planned]',
      '',
      '### F-003: C [planned]',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), tinyContent);
    const map = fm.readFeatureMap(root);
    // Even if round-trip caused 50% shrink on this file, the floor allows it
    fm.writeFeatureMap(root, map);
  } finally {
    rm(root);
  }
});

test('AC-7: first write (no on-disk content) bypasses the guard', () => {
  const root = mkProject();
  try {
    const map = { features: [{ id: 'F-001', title: 'New', state: 'planned', acs: [], files: [], dependencies: [], usesDesign: [], metadata: {} }], lastScan: null };
    // No FEATURE-MAP.md exists yet — first write must succeed
    fm.writeFeatureMap(root, map);
    assert.ok(fs.existsSync(path.join(root, 'FEATURE-MAP.md')));
  } finally {
    rm(root);
  }
});

test('AC-7: error includes oldLines + newLines for diagnosis', () => {
  const root = mkProject();
  try {
    // Use 12 prose lines per feature to guarantee >50% shrink
    const fatContent = buildFatMap(20, 12);
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), fatContent);
    const map = fm.readFeatureMap(root);
    try {
      fm.writeFeatureMap(root, map);
      assert.fail('should have thrown — guard did not fire (round-trip not lossy enough?)');
    } catch (e) {
      if (e.message && e.message.startsWith('should have thrown')) throw e;
      assert.equal(typeof e.oldLines, 'number');
      assert.equal(typeof e.newLines, 'number');
      assert.ok(e.oldLines > e.newLines);
    }
  } finally {
    rm(root);
  }
});
