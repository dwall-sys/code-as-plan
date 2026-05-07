'use strict';

// @cap-feature(feature:F-088) Surgical-patch tests (AC-5). Verifies that setAcStatus and
//   updateFeatureState mutate ONLY the targeted state/status bits and preserve the rest of
//   the file byte-for-byte — including free-text descriptions, group headers, separators,
//   and header-format variations that the parser/serializer would lose.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const fm = require('../cap/bin/lib/cap-feature-map.cjs');

function mkProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-surgical-')); }
function rm(root) { fs.rmSync(root, { recursive: true, force: true }); }

const FAT_MAP = `# Feature Map

> Single source of truth for feature identity, state, acceptance criteria, and relationships.
> Auto-enriched by \`@cap-feature\` tags and dependency analysis.

## Features

### F-001: Configure Supabase Storage [shipped]

Storage-Grundlage: drei Supabase Storage Buckets mit RLS Policies, shared Upload/Download Helpers und Migration-File.

**Group:** Storage

**Depends on:** F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | RLS policy on bucket |
| AC-2 | pending | Upload helper |

---

### F-002: Image Upload Display [planned]

Projektbilder hochladen, anzeigen und verwalten — incl. thumbnail generation.

**Group:** Storage

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | File-picker UI |
| AC-2 | pending | Server-side resize |

---
`;

// ---------------------------------------------------------------------------
// _surgicalUpdateFeatureState (unit)

test('AC-5: _surgicalUpdateFeatureState flips just the [state] bracket', () => {
  const result = fm._surgicalUpdateFeatureState(FAT_MAP, 'F-002', 'prototyped');
  assert.equal(result.hit, true);
  assert.match(result.content, /### F-002: Image Upload Display \[prototyped\]/);
  // F-001 must be untouched
  assert.match(result.content, /### F-001: Configure Supabase Storage \[shipped\]/);
  // Prose must be preserved
  assert.match(result.content, /Storage-Grundlage: drei Supabase Storage Buckets/);
  assert.match(result.content, /Projektbilder hochladen, anzeigen/);
});

test('AC-5: _surgicalUpdateFeatureState returns hit=false for unknown feature', () => {
  const result = fm._surgicalUpdateFeatureState(FAT_MAP, 'F-999', 'shipped');
  assert.equal(result.hit, false);
  assert.equal(result.content, FAT_MAP);
});

test('AC-5: _surgicalUpdateFeatureState supports em-dash header form', () => {
  const map = '### F-001 — Title here [planned]\n';
  const result = fm._surgicalUpdateFeatureState(map, 'F-001', 'tested');
  assert.equal(result.hit, true);
  assert.match(result.content, /### F-001 — Title here \[tested\]/);
});

// ---------------------------------------------------------------------------
// _surgicalSetAcStatus (unit)

test('AC-5: _surgicalSetAcStatus flips one AC status, scoped to its feature', () => {
  const result = fm._surgicalSetAcStatus(FAT_MAP, 'F-002', 'AC-1', 'tested');
  assert.equal(result.hit, true);
  // F-002/AC-1 changed
  assert.match(result.content, /\| AC-1 \| tested \| File-picker UI \|/);
  // F-001/AC-1 (which is also "AC-1") MUST NOT be touched — was already tested, stay tested
  assert.match(result.content, /\| AC-1 \| tested \| RLS policy on bucket \|/);
  // F-001/AC-2 must remain pending
  assert.match(result.content, /\| AC-2 \| pending \| Upload helper \|/);
});

test('AC-5: _surgicalSetAcStatus returns hit=false for missing AC', () => {
  const result = fm._surgicalSetAcStatus(FAT_MAP, 'F-001', 'AC-99', 'tested');
  assert.equal(result.hit, false);
  assert.equal(result.content, FAT_MAP);
});

test('AC-5: _surgicalSetAcStatus does not match across features', () => {
  // F-001 has AC-1=tested; F-002 has AC-1=pending. Patching F-002/AC-1 must NOT touch F-001/AC-1.
  const result = fm._surgicalSetAcStatus(FAT_MAP, 'F-002', 'AC-1', 'tested');
  // Count occurrences of "AC-1 | tested" — there should be exactly 2 now (F-001 was already, F-002 became)
  const matches = (result.content.match(/\| AC-1 \| tested \|/g) || []).length;
  assert.equal(matches, 2);
});

// ---------------------------------------------------------------------------
// End-to-end: setAcStatus / updateFeatureState preserve prose

test('AC-5 e2e: setAcStatus preserves description prose, group headers, separators', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), FAT_MAP);
    const lineCountBefore = FAT_MAP.split('\n').length;
    const ok = fm.setAcStatus(root, 'F-002', 'AC-1', 'tested');
    assert.equal(ok, true);
    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');

    // Status bit DID flip
    assert.match(after, /\| AC-1 \| tested \| File-picker UI \|/);
    // Prose preserved
    assert.match(after, /Storage-Grundlage: drei Supabase Storage Buckets/);
    assert.match(after, /Projektbilder hochladen, anzeigen/);
    // Group markers preserved
    assert.match(after, /\*\*Group:\*\* Storage/);
    // Separators preserved
    assert.match(after, /\n---\n/);

    // Line count exactly the same (surgical = no shrink)
    const lineCountAfter = after.split('\n').length;
    assert.equal(lineCountAfter, lineCountBefore, 'surgical patch must keep line count constant');
  } finally {
    rm(root);
  }
});

test('AC-5 e2e: updateFeatureState preserves prose + flips state', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), FAT_MAP);
    const lineCountBefore = FAT_MAP.split('\n').length;
    const ok = fm.updateFeatureState(root, 'F-002', 'prototyped');
    assert.equal(ok, true);
    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');

    assert.match(after, /### F-002: Image Upload Display \[prototyped\]/);
    // F-001 untouched
    assert.match(after, /### F-001: Configure Supabase Storage \[shipped\]/);
    // Prose preserved
    assert.match(after, /Projektbilder hochladen/);
    // Same number of lines
    assert.equal(after.split('\n').length, lineCountBefore);
  } finally {
    rm(root);
  }
});

test('AC-5 e2e: 50 status updates on a fat map preserve line count exactly', () => {
  const root = mkProject();
  try {
    // Build a 50-feature fat map. We then flip every feature's AC-1 to tested.
    const features = [];
    for (let i = 1; i <= 50; i++) {
      const id = 'F-' + String(i).padStart(3, '0');
      features.push(`### ${id}: Feature ${i} [planned]

Description prose for feature ${i} that the parser does not capture but matters
for human readers reviewing the FEATURE-MAP.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | First criterion |

---
`);
    }
    const fatMap = `# Feature Map\n\n## Features\n\n${features.join('\n')}`;
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), fatMap);
    const linesBefore = fatMap.split('\n').length;

    for (let i = 1; i <= 50; i++) {
      const id = 'F-' + String(i).padStart(3, '0');
      assert.equal(fm.setAcStatus(root, id, 'AC-1', 'tested'), true);
    }

    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');
    const linesAfter = after.split('\n').length;
    assert.equal(linesAfter, linesBefore, `50 surgical updates must preserve line count (got ${linesAfter}, expected ${linesBefore})`);

    // All 50 ACs are tested
    const testedCount = (after.match(/\| AC-1 \| tested \|/g) || []).length;
    assert.equal(testedCount, 50);

    // All 50 prose lines still present
    for (let i = 1; i <= 50; i++) {
      assert.match(after, new RegExp(`Description prose for feature ${i}`));
    }
  } finally {
    rm(root);
  }
});

// ---------------------------------------------------------------------------
// applySurgicalPatches direct API

test('AC-5: applySurgicalPatches applies multiple patches atomically', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), FAT_MAP);
    const result = fm.applySurgicalPatches(root, null, [
      { kind: 'state', featureId: 'F-002', newState: 'prototyped' },
      { kind: 'ac', featureId: 'F-002', acId: 'AC-1', newStatus: 'tested' },
      { kind: 'ac', featureId: 'F-002', acId: 'AC-2', newStatus: 'tested' },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.hits, 3);
    assert.equal(result.misses.length, 0);
  } finally {
    rm(root);
  }
});

test('AC-5: applySurgicalPatches reports misses without writing partial', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, 'FEATURE-MAP.md'), FAT_MAP);
    const before = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');
    const result = fm.applySurgicalPatches(root, null, [
      { kind: 'ac', featureId: 'F-001', acId: 'AC-99', newStatus: 'tested' },
      { kind: 'state', featureId: 'F-DOESNOTEXIST', newState: 'shipped' },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.hits, 0);
    assert.equal(result.misses.length, 2);
    // File on disk must be unchanged when nothing hit
    const after = fs.readFileSync(path.join(root, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(after, before);
  } finally {
    rm(root);
  }
});
