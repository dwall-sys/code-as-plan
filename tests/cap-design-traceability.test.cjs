'use strict';

// @cap-feature(feature:F-063) Design-Feature Traceability — RED/GREEN baseline tests for all 6 ACs.
// Covers: ID assignment determinism, Tag-Scanner detection, Feature-Map roundtrip with usesDesign,
// /cap:design --scope writer, status/trace Design-Usage rendering, impact-analysis query.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  AESTHETIC_FAMILIES,
  buildDesignMd,
  extendDesignMd,
  parseDesignIds,
  assignDesignIds,
  getNextDesignId,
  formatDesignId,
  nextIdNumber,
  findFeaturesUsingDesignId,
} = require('../cap/bin/lib/cap-design.cjs');

const {
  CAP_DESIGN_TAG_RE,
  CAP_DESIGN_TAG_TYPES,
  extractTags,
  scanFile,
} = require('../cap/bin/lib/cap-tag-scanner.cjs');

const {
  parseFeatureMapContent,
  serializeFeatureMap,
  setFeatureUsesDesign,
  writeFeatureMap,
  readFeatureMap,
  enrichFromDesignTags,
} = require('../cap/bin/lib/cap-feature-map.cjs');

const deps = require('../cap/bin/lib/cap-deps.cjs');
const trace = require('../cap/bin/lib/cap-trace.cjs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f063-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1 — Stable DT-NNN / DC-NNN IDs in DESIGN.md
// ---------------------------------------------------------------------------

describe('F-063/AC-1 — stable DT/DC ID assignment', () => {
  // @cap-todo(ac:F-063/AC-1) zero-padded 3-digit formatter
  it('formatDesignId produces zero-padded IDs', () => {
    assert.strictEqual(formatDesignId('DT', 1), 'DT-001');
    assert.strictEqual(formatDesignId('DC', 42), 'DC-042');
    assert.strictEqual(formatDesignId('DT', 999), 'DT-999');
  });

  it('nextIdNumber returns 1 for empty input', () => {
    assert.strictEqual(nextIdNumber([]), 1);
    assert.strictEqual(nextIdNumber(undefined), 1);
  });

  it('nextIdNumber returns max+1 (gaps tolerated)', () => {
    assert.strictEqual(nextIdNumber(['DT-001', 'DT-003']), 4);
    assert.strictEqual(nextIdNumber(['DC-012']), 13);
  });

  it('getNextDesignId works for token and component', () => {
    assert.strictEqual(getNextDesignId('token', ['DT-001']), 'DT-002');
    assert.strictEqual(getNextDesignId('component', ['DC-005']), 'DC-006');
  });

  it('getNextDesignId throws on invalid type', () => {
    assert.throws(() => getNextDesignId('spacing', []));
  });

  it('buildDesignMd with withIds emits inline DT/DC suffixes', () => {
    const family = AESTHETIC_FAMILIES['editorial-minimalism'];
    const md = buildDesignMd({ family, withIds: true });
    // Color bullets carry DT-NNN
    assert.match(md, /- accent: #[0-9A-F]+ \(id: DT-001\)/);
    // Component headers carry DC-NNN
    assert.match(md, /^### Button \(id: DC-\d{3,}\)/m);
    assert.match(md, /^### Card \(id: DC-\d{3,}\)/m);
  });

  it('buildDesignMd withIds is deterministic across repeated calls', () => {
    const family = AESTHETIC_FAMILIES['terminal-core'];
    const a = buildDesignMd({ family, withIds: true });
    const b = buildDesignMd({ family, withIds: true });
    assert.strictEqual(a, b);
  });

  it('buildDesignMd without withIds preserves F-062 snapshot (no IDs)', () => {
    const family = AESTHETIC_FAMILIES['editorial-minimalism'];
    const md = buildDesignMd({ family });
    assert.doesNotMatch(md, /\(id: DT-/);
    assert.doesNotMatch(md, /\(id: DC-/);
  });

  it('parseDesignIds extracts tokens and components from DESIGN.md', () => {
    const family = AESTHETIC_FAMILIES['editorial-minimalism'];
    const md = buildDesignMd({ family, withIds: true });
    const ids = parseDesignIds(md);
    assert.ok(ids.tokens.length >= 7, 'expected >=7 DT entries');
    assert.ok(ids.components.length >= 2, 'expected >=2 DC entries');
    // Every ID string matches the contract
    for (const id of ids.tokens) assert.match(id, /^DT-\d{3,}$/);
    for (const id of ids.components) assert.match(id, /^DC-\d{3,}$/);
  });

  it('assignDesignIds retrofits IDs on an F-062-era DESIGN.md', () => {
    const family = AESTHETIC_FAMILIES['editorial-minimalism'];
    const v1 = buildDesignMd({ family }); // no IDs
    const { content: v2, assigned } = assignDesignIds(v1);
    assert.ok(assigned.tokens.length > 0, 'should assign tokens');
    assert.ok(assigned.components.length > 0, 'should assign components');
    assert.match(v2, /\(id: DT-001\)/);
    assert.match(v2, /\(id: DC-001\)/);
  });

  it('assignDesignIds is idempotent — running twice changes nothing', () => {
    const family = AESTHETIC_FAMILIES['warm-editorial'];
    const v1 = buildDesignMd({ family });
    const { content: v2 } = assignDesignIds(v1);
    const { content: v3, assigned } = assignDesignIds(v2);
    assert.strictEqual(v3, v2, 'second pass is a no-op');
    assert.strictEqual(assigned.tokens.length, 0);
    assert.strictEqual(assigned.components.length, 0);
  });

  it('extendDesignMd withIds gives next free IDs, preserves existing ones (stable-ID D4)', () => {
    const family = AESTHETIC_FAMILIES['editorial-minimalism'];
    const withIds = buildDesignMd({ family, withIds: true });
    const beforeIds = parseDesignIds(withIds);
    const maxDtBefore = beforeIds.tokens.length;

    const extended = extendDesignMd(
      withIds,
      { colors: { brand: '#ff00ff' }, components: { Modal: { variants: ['small', 'large'], states: ['open'] } } },
      { withIds: true }
    );
    const afterIds = parseDesignIds(extended);
    // Existing tokens unchanged
    for (const id of beforeIds.tokens) assert.ok(afterIds.tokens.includes(id));
    // New DT is the next sequential number
    assert.strictEqual(afterIds.tokens.length, maxDtBefore + 1);
    assert.ok(afterIds.tokens.includes(formatDesignId('DT', maxDtBefore + 1)));
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Tag scanner recognises @cap-design-token / @cap-design-component
// ---------------------------------------------------------------------------

describe('F-063/AC-2 — Tag-Scanner recognises design tags', () => {
  it('exports CAP_DESIGN_TAG_TYPES as two entries', () => {
    assert.deepStrictEqual(CAP_DESIGN_TAG_TYPES, ['design-token', 'design-component']);
  });

  it('CAP_DESIGN_TAG_RE matches @cap-design-token(id:DT-NNN)', () => {
    const line = '// @cap-design-token(id:DT-001) primary color';
    const m = line.match(CAP_DESIGN_TAG_RE);
    assert.ok(m);
    assert.strictEqual(m[1], 'design-token');
    assert.strictEqual(m[2], 'id:DT-001');
  });

  it('CAP_DESIGN_TAG_RE matches @cap-design-component(id:DC-NNN) in Python # comments', () => {
    const line = '# @cap-design-component(id:DC-042) Button variant';
    const m = line.match(CAP_DESIGN_TAG_RE);
    assert.ok(m);
    assert.strictEqual(m[1], 'design-component');
    assert.strictEqual(m[2], 'id:DC-042');
  });

  it('extractTags returns mixed feature + design tags from the same file', () => {
    const src = [
      '// @cap-feature(feature:F-023) button module',
      '// @cap-design-token(id:DT-001) primary color',
      '// @cap-design-component(id:DC-001) Button',
      '// @cap-todo(ac:F-023/AC-1) wire it up',
    ].join('\n');
    const tags = extractTags(src, 'src/button.js');
    const byType = {};
    for (const t of tags) byType[t.type] = (byType[t.type] || 0) + 1;
    assert.strictEqual(byType.feature, 1);
    assert.strictEqual(byType['design-token'], 1);
    assert.strictEqual(byType['design-component'], 1);
    assert.strictEqual(byType.todo, 1);
  });

  it('design tags carry metadata.id', () => {
    const src = '// @cap-design-token(id:DT-007) accent';
    const tags = extractTags(src, 'f.js');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].metadata.id, 'DT-007');
  });

  it('scanFile picks up design tags from disk', () => {
    const file = path.join(tmpDir, 'x.js');
    fs.writeFileSync(file, '// @cap-design-token(id:DT-003) muted\n');
    const tags = scanFile(file, tmpDir);
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'design-token');
  });

  it('does NOT break CAP_TAG_TYPES length (F-001 regression guard)', () => {
    const mod = require('../cap/bin/lib/cap-tag-scanner.cjs');
    // @cap-decision(F-063/D4) pinned at 4 by F-001's adversarial tests — design tags are additive.
    assert.strictEqual(mod.CAP_TAG_TYPES.length, 4);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Feature-Map parser/serializer roundtrip with usesDesign
// ---------------------------------------------------------------------------

describe('F-063/AC-3 — FEATURE-MAP.md usesDesign field', () => {
  it('parses **Uses design:** line into Feature.usesDesign', () => {
    const md = `# Feature Map

## Features

### F-023: Button module [planned]

**Uses design:** DT-001, DC-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | renders |
`;
    const { features } = parseFeatureMapContent(md);
    assert.strictEqual(features.length, 1);
    assert.deepStrictEqual(features[0].usesDesign, ['DT-001', 'DC-001']);
  });

  it('defaults usesDesign to [] when the line is absent', () => {
    const md = `# Feature Map

## Features

### F-024: Card module [planned]

**Depends on:** F-023

`;
    const { features } = parseFeatureMapContent(md);
    assert.deepStrictEqual(features[0].usesDesign, []);
  });

  it('serializer roundtrips usesDesign non-destructively', () => {
    const fm = {
      features: [{
        id: 'F-023',
        title: 'Button module',
        state: 'planned',
        acs: [{ id: 'AC-1', status: 'pending', description: 'renders' }],
        files: [],
        dependencies: [],
        usesDesign: ['DT-001', 'DC-001'],
        metadata: {},
      }],
      lastScan: null,
    };
    const serialized = serializeFeatureMap(fm);
    assert.match(serialized, /\*\*Uses design:\*\* DT-001, DC-001/);
    const reparsed = parseFeatureMapContent(serialized);
    assert.deepStrictEqual(reparsed.features[0].usesDesign, ['DT-001', 'DC-001']);
  });

  it('serializer omits **Uses design:** when empty (backward compat)', () => {
    const fm = {
      features: [{
        id: 'F-099',
        title: 'No design use',
        state: 'planned',
        acs: [],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    const serialized = serializeFeatureMap(fm);
    assert.doesNotMatch(serialized, /\*\*Uses design:/);
  });

  it('enrichFromDesignTags populates usesDesign from co-located design tags', () => {
    // Seed a minimal Feature Map
    const fmStart = {
      features: [{
        id: 'F-023',
        title: 'Button',
        state: 'planned',
        acs: [],
        files: ['src/button.js'],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    writeFeatureMap(tmpDir, fmStart);

    // Write a source file containing the design tags and a feature tag
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'button.js'), [
      '// @cap-feature(feature:F-023) Button module',
      '// @cap-design-token(id:DT-001) primary',
      '// @cap-design-component(id:DC-001) Button',
    ].join('\n'));

    // Scan & enrich
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const tags = scanner.scanDirectory(tmpDir);
    const updated = enrichFromDesignTags(tmpDir, tags);
    const feature = updated.features.find(f => f.id === 'F-023');
    assert.deepStrictEqual(feature.usesDesign, ['DC-001', 'DT-001']);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — /cap:design --scope writes uses-design + creates missing DT/DC
// ---------------------------------------------------------------------------

describe('F-063/AC-4 — setFeatureUsesDesign writes the line', () => {
  it('setFeatureUsesDesign updates FEATURE-MAP.md', () => {
    const fm = {
      features: [{
        id: 'F-023',
        title: 'Button',
        state: 'planned',
        acs: [],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    writeFeatureMap(tmpDir, fm);
    const ok = setFeatureUsesDesign(tmpDir, 'F-023', ['DT-001', 'DC-001']);
    assert.strictEqual(ok, true);
    const reread = readFeatureMap(tmpDir);
    assert.deepStrictEqual(reread.features[0].usesDesign, ['DC-001', 'DT-001']);
  });

  it('setFeatureUsesDesign filters invalid IDs', () => {
    const fm = {
      features: [{
        id: 'F-023',
        title: 'Button',
        state: 'planned',
        acs: [],
        files: [],
        dependencies: [],
        usesDesign: [],
        metadata: {},
      }],
      lastScan: null,
    };
    writeFeatureMap(tmpDir, fm);
    setFeatureUsesDesign(tmpDir, 'F-023', ['DT-001', 'garbage', 'F-999', 'DC-002']);
    const reread = readFeatureMap(tmpDir);
    assert.deepStrictEqual(reread.features[0].usesDesign, ['DC-002', 'DT-001']);
  });

  it('setFeatureUsesDesign returns false for unknown feature', () => {
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    const ok = setFeatureUsesDesign(tmpDir, 'F-999', ['DT-001']);
    assert.strictEqual(ok, false);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — status / trace show Design-Usage per feature
// ---------------------------------------------------------------------------

describe('F-063/AC-5 — Design-Usage rendering', () => {
  it('formatDesignUsage emits "F-NNN nutzt: DT-001 primary, DC-001 Button"', () => {
    const feature = { id: 'F-023', usesDesign: ['DT-001', 'DC-001'] };
    const designIdx = {
      byToken: { 'DT-001': { id: 'DT-001', key: 'primary', value: '#111' } },
      byComponent: { 'DC-001': { id: 'DC-001', name: 'Button' } },
    };
    const line = trace.formatDesignUsage(feature, designIdx);
    assert.match(line, /F-023 nutzt:/);
    assert.match(line, /DT-001 primary/);
    assert.match(line, /DC-001 Button/);
  });

  it('formatDesignUsage falls back to bare IDs when no designIndex', () => {
    const feature = { id: 'F-023', usesDesign: ['DT-001'] };
    const line = trace.formatDesignUsage(feature);
    assert.strictEqual(line, 'F-023 nutzt: DT-001');
  });

  it('formatDesignUsage returns empty string when usesDesign is empty', () => {
    assert.strictEqual(trace.formatDesignUsage({ id: 'F-023', usesDesign: [] }), '');
    assert.strictEqual(trace.formatDesignUsage({ id: 'F-023' }), '');
  });
});

// ---------------------------------------------------------------------------
// AC-6 — Impact analysis: /cap:deps --design DT-001
// ---------------------------------------------------------------------------

describe('F-063/AC-6 — /cap:deps --design impact analysis', () => {
  const fm = {
    features: [
      { id: 'F-020', title: 'Reader',  state: 'planned', acs: [], files: [], dependencies: [], usesDesign: [], metadata: {} },
      { id: 'F-023', title: 'Button',  state: 'planned', acs: [], files: [], dependencies: [], usesDesign: ['DT-001', 'DC-001'], metadata: {} },
      { id: 'F-024', title: 'Card',    state: 'planned', acs: [], files: [], dependencies: [], usesDesign: ['DT-001'], metadata: {} },
      { id: 'F-025', title: 'Toast',   state: 'planned', acs: [], files: [], dependencies: [], usesDesign: ['DC-002'], metadata: {} },
    ],
    lastScan: null,
  };

  it('findFeaturesUsingDesignId lists all features that reference the ID', () => {
    const using = deps.findFeaturesUsingDesignId(fm, 'DT-001');
    assert.deepStrictEqual(using.map(f => f.id), ['F-023', 'F-024']);
  });

  it('findFeaturesUsingDesignId returns [] for unreferenced ID', () => {
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(fm, 'DT-999'), []);
  });

  it('findFeaturesUsingDesignId rejects malformed IDs', () => {
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(fm, 'not-an-id'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(fm, ''), []);
  });

  it('formatDesignImpactReport renders a human-readable list', () => {
    const using = deps.findFeaturesUsingDesignId(fm, 'DT-001');
    const report = deps.formatDesignImpactReport('DT-001', using);
    assert.match(report, /Features referencing DT-001: 2/);
    assert.match(report, /F-023 — Button/);
    assert.match(report, /F-024 — Card/);
  });

  it('formatDesignImpactReport handles empty result', () => {
    const report = deps.formatDesignImpactReport('DT-999', []);
    assert.match(report, /No features reference DT-999/);
  });

  it('cap-design.findFeaturesUsingDesignId (re-export) matches cap-deps output', () => {
    const design = require('../cap/bin/lib/cap-design.cjs');
    const a = design.findFeaturesUsingDesignId(fm, 'DC-001');
    const b = deps.findFeaturesUsingDesignId(fm, 'DC-001');
    assert.deepStrictEqual(a, b);
  });
});
