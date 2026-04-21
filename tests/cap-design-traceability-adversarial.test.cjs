'use strict';

// @cap-feature(feature:F-063) Design-Feature Traceability — adversarial tests (harden baseline).
// @cap-context Complementary to tests/cap-design-traceability.test.cjs (36 baseline tests).
// Probes edges the prototyper did NOT cover: ID gaps/duplicates/high numbers, regex ReDoS + false
// positives, parser tolerance (lowercase/space-sep/annotated IDs), coexistence with **Depends on:**,
// byte-identical backward compat against F-001/F-002/F-062, and string-match regression against
// agents/cap-designer.md + commands/cap/{design,status,trace,deps}.md.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const design = require('../cap/bin/lib/cap-design.cjs');
const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
const fmap = require('../cap/bin/lib/cap-feature-map.cjs');
const deps = require('../cap/bin/lib/cap-deps.cjs');
const trace = require('../cap/bin/lib/cap-trace.cjs');

const repoRoot = path.resolve(__dirname, '..');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f063-adv-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1 / D2 / D4 — ID determinism, gaps, duplicates, high numbers
// ---------------------------------------------------------------------------

describe('F-063 adversarial AC-1 — ID edges', () => {
  // D2: gap tolerance — DT-001, DT-003 present => next is DT-004 (NOT DT-002).
  it('nextIdNumber honours gaps (does not refill DT-002 in a DT-001/DT-003 file)', () => {
    const md = [
      '# DESIGN.md', '## Tokens', '### Colors', '',
      '- primary: #111 (id: DT-001)',
      '- accent:  #222 (id: DT-003)',
      '- muted:   #333 (id: DT-007)',
      '',
      '## Components', '',
      '### Button (id: DC-001)', '', '- variants: [a]', '- states: [b]', '',
      '### Card (id: DC-005)', '', '- variants: [c]', '- states: [d]', '',
    ].join('\n');
    const ids = design.parseDesignIds(md);
    assert.deepStrictEqual(ids.tokens, ['DT-001', 'DT-003', 'DT-007']);
    assert.deepStrictEqual(ids.components, ['DC-001', 'DC-005']);
    // Next DT is 8, next DC is 6 — gap-tolerant (D4: IDs never renumbered).
    assert.strictEqual(design.getNextDesignId('token', ids.tokens), 'DT-008');
    assert.strictEqual(design.getNextDesignId('component', ids.components), 'DC-006');
  });

  // D4: 4-digit overflow — DT-999 present, next is DT-1000, still parseable.
  it('4-digit IDs (DT-1000) format, parse, and round-trip via extendDesignMd', () => {
    assert.strictEqual(design.formatDesignId('DT', 1000), 'DT-1000');
    assert.strictEqual(design.formatDesignId('DT', 9999), 'DT-9999');
    // parseDesignIds regex is \d{3,} — must accept 4-digit.
    const md = '# DESIGN.md\n## Tokens\n### Colors\n\n- primary: #111 (id: DT-999)\n\n## Components\n\n### Button (id: DC-999)\n\n- variants: [a]\n- states: [b]\n';
    const ids = design.parseDesignIds(md);
    assert.deepStrictEqual(ids.tokens, ['DT-999']);
    // Extending should produce DT-1000.
    const extended = design.extendDesignMd(
      md,
      { colors: { accent: '#FF00FF' }, components: { Modal: { variants: ['x'], states: ['y'] } } },
      { withIds: true }
    );
    const after = design.parseDesignIds(extended);
    assert.ok(after.tokens.includes('DT-1000'), 'expected DT-1000 after rollover');
    assert.ok(after.components.includes('DC-1000'), 'expected DC-1000 after rollover');
  });

  // Duplicate IDs in a corrupted file: parser records both in `tokens` array but `byToken` last-wins.
  // Characterization test — locks current behavior so future consumers know the contract.
  it('parseDesignIds on duplicate IDs keeps both in tokens[] but byToken[] is last-wins', () => {
    const md = [
      '# DESIGN.md', '## Tokens', '### Colors', '',
      '- primary: #111 (id: DT-001)',
      '- alt:     #222 (id: DT-001)',
      '',
    ].join('\n');
    const ids = design.parseDesignIds(md);
    assert.deepStrictEqual(ids.tokens, ['DT-001', 'DT-001'], 'tokens[] preserves both occurrences');
    assert.strictEqual(ids.byToken['DT-001'].key, 'alt', 'byToken is last-wins for lookups');
    // nextIdNumber with duplicates returns max+1 — so DT-001 twice still yields 2, not 3.
    assert.strictEqual(design.nextIdNumber(ids.tokens), 2);
  });

  // Malformed IDs inside (id: ...) suffix — do NOT count as valid. Regex requires DT-\d{3,}.
  it('parseDesignIds ignores malformed (id:) suffixes', () => {
    const md = [
      '# DESIGN.md', '## Tokens', '### Colors', '',
      '- primary: #111 (id: DT-1)',      // too few digits
      '- secondary: #222 (id: dt-002)',  // lowercase
      '- accent: #333 (id: DT-0042a)',   // trailing garbage
      '- real: #444 (id: DT-005)',       // valid
      '',
    ].join('\n');
    const ids = design.parseDesignIds(md);
    assert.deepStrictEqual(ids.tokens, ['DT-005'], 'only the valid 3+digit uppercase DT-NNN is parsed');
  });

  // assignDesignIds is section-aware for Colors but not for non-Colors ### subsections (Spacing/Typography).
  // Characterization: tokens outside `### Colors` stay un-IDed, per the @cap-decision in the source.
  it('assignDesignIds only tags bullets under ### Colors (Spacing/Typography stay un-IDed)', () => {
    const md = [
      '# DESIGN.md', '## Tokens', '',
      '### Colors', '', '- primary: #111', '- secondary: #222', '',
      '### Spacing', '', '- scale: [4, 8, 16]', '',
      '### Typography', '', '- family: "X"', '- familyMono: "Y"', '',
      '## Components', '',
      '### Button', '', '- variants: [a]', '- states: [b]', '',
      '## Anti-Patterns', '',
    ].join('\n');
    const { content, assigned } = design.assignDesignIds(md);
    assert.strictEqual(assigned.tokens.length, 2, 'only color bullets got IDs');
    assert.match(content, /- primary: #111 \(id: DT-001\)/);
    assert.match(content, /- secondary: #222 \(id: DT-002\)/);
    // Spacing/Typography bullets stay bare.
    assert.match(content, /^- scale: \[4, 8, 16\]$/m);
    assert.match(content, /^- family: "X"$/m);
    assert.doesNotMatch(content, /- scale.*\(id:/);
    assert.doesNotMatch(content, /- family.*\(id:/);
    assert.strictEqual(assigned.components.length, 1);
    assert.match(content, /### Button \(id: DC-001\)/);
  });

  // Empty-additions call to extendDesignMd is byte-identical — strong idempotency claim.
  it('extendDesignMd with empty additions is byte-identical (F-062 stable-ID D4 check)', () => {
    const base = design.buildDesignMd({ family: design.AESTHETIC_FAMILIES['terminal-core'], withIds: true });
    const a = design.extendDesignMd(base, {}, { withIds: true });
    const b = design.extendDesignMd(base, { colors: {}, components: {} }, { withIds: true });
    assert.strictEqual(a, base, 'empty object additions are a no-op');
    assert.strictEqual(b, base, 'empty colors + components is a no-op');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Tag-scanner regex: ReDoS safety, false positives, polylingual
// ---------------------------------------------------------------------------

describe('F-063 adversarial AC-2 — Tag-Scanner edges', () => {
  // ReDoS probe. Regex is linear-time (no nested quantifiers); must finish well under 100ms.
  it('CAP_DESIGN_TAG_RE is ReDoS-safe on 20k-char unclosed payload', () => {
    const pathological = '// @cap-design-token(id:DT-' + 'a'.repeat(20000);
    const start = Date.now();
    pathological.match(scanner.CAP_DESIGN_TAG_RE);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `regex took ${elapsed}ms (expected <100ms)`);
  });

  // Design tags only match when on a real comment line — strings are NOT picked up.
  it('design tag inside a JS string literal is NOT matched (requires comment prefix)', () => {
    const src = [
      'const s = "@cap-design-token(id:DT-001) not a comment";',
      '// @cap-design-token(id:DT-002) this one is',
    ].join('\n');
    const tags = scanner.extractTags(src, 'x.js');
    const designTags = tags.filter(t => t.type === 'design-token');
    assert.strictEqual(designTags.length, 1, 'only the real comment line matches');
    assert.strictEqual(designTags[0].metadata.id, 'DT-002');
  });

  // Polylingual: Python #, SQL --, shell # — all comment styles work.
  it('recognises design tags across JS //, Python #, SQL -- comment styles', () => {
    const src = [
      '// @cap-design-token(id:DT-001) js',
      '# @cap-design-token(id:DT-002) python/shell',
      '-- @cap-design-component(id:DC-001) sql',
      ' * @cap-design-token(id:DT-003) jsdoc',
    ].join('\n');
    const tags = scanner.extractTags(src, 'mix.txt');
    assert.strictEqual(tags.length, 4);
    assert.deepStrictEqual(
      tags.map(t => t.metadata.id).sort(),
      ['DC-001', 'DT-001', 'DT-002', 'DT-003']
    );
  });

  // When BOTH CAP_TAG_RE and CAP_DESIGN_TAG_RE could match, CAP_TAG_RE wins.
  // Specifically: a line starting with @cap-feature is NEVER classified as design-token.
  // This locks the "first regex wins" contract that downstream callers depend on.
  it('only first tag per line is captured; @cap-feature beats @cap-design-token on the same line', () => {
    const src = '// @cap-feature(feature:F-023) see also @cap-design-token(id:DT-001)';
    const tags = scanner.extractTags(src, 'x.js');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'feature');
    assert.match(tags[0].description, /@cap-design-token/); // swallowed into description
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Feature-Map parser/serializer: coexistence and tolerant parsing
// ---------------------------------------------------------------------------

describe('F-063 adversarial AC-3 — Feature-Map parser edges', () => {
  // Order preservation: DT-002, DT-001 stays in that order after roundtrip (no alphabetical sort).
  it('serializer preserves usesDesign order exactly (no implicit sort)', () => {
    const fm = {
      features: [{
        id: 'F-023', title: 'Button', state: 'planned', acs: [],
        files: [], dependencies: [],
        usesDesign: ['DT-002', 'DT-001', 'DC-003'], // reverse/mixed order
        metadata: {},
      }],
      lastScan: null,
    };
    const serialized = fmap.serializeFeatureMap(fm);
    assert.match(serialized, /\*\*Uses design:\*\* DT-002, DT-001, DC-003/);
    const reparsed = fmap.parseFeatureMapContent(serialized);
    assert.deepStrictEqual(reparsed.features[0].usesDesign, ['DT-002', 'DT-001', 'DC-003']);
  });

  // `**Uses design:**` and `**Depends on:**` coexist without interfering.
  it('parser keeps Depends-on and Uses-design independent (both preserved)', () => {
    const md = [
      '## Features', '',
      '### F-023: Button [planned]', '',
      '**Depends on:** F-001, F-002',
      '**Uses design:** DT-001, DC-001',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | renders |',
      '',
    ].join('\n');
    const { features } = fmap.parseFeatureMapContent(md);
    assert.deepStrictEqual(features[0].dependencies, ['F-001', 'F-002']);
    assert.deepStrictEqual(features[0].usesDesign, ['DT-001', 'DC-001']);
    // Roundtrip: both lines survive serialization.
    const ser = fmap.serializeFeatureMap({ features, lastScan: null });
    const rt = fmap.parseFeatureMapContent(ser);
    assert.deepStrictEqual(rt.features[0].dependencies, ['F-001', 'F-002']);
    assert.deepStrictEqual(rt.features[0].usesDesign, ['DT-001', 'DC-001']);
  });

  // Tolerant parsing: malformed/mixed inputs — characterise the contract.
  it('parser is tolerant: annotated IDs, invalid entries dropped, empty line -> []', () => {
    const cases = [
      // [input, expected usesDesign]
      ['**Uses design:** DT-001,DT-002',                   ['DT-001', 'DT-002']],
      ['**Uses design:** DT-001 primary-color, DC-001 Btn', ['DT-001', 'DC-001']],
      ['**Uses design:** invalid, DT-001',                  ['DT-001']],
      ['**Uses design:** dt-001, DC-001',                   ['DC-001']],
      ['**Uses design:** DT-001,',                          ['DT-001']],
      ['- **Uses design:** DT-001',                         ['DT-001']],
    ];
    for (const [line, expected] of cases) {
      const md = `## Features\n\n### F-023: T [planned]\n\n${line}\n\n`;
      const { features } = fmap.parseFeatureMapContent(md);
      assert.deepStrictEqual(
        features[0].usesDesign,
        expected,
        `input "${line}" -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(features[0].usesDesign)}`
      );
    }
  });

  // Space-separated (no commas) is NOT supported — contract lock.
  // This protects against a future "helpful" parser change that would silently alter behavior.
  it('space-separated IDs (no commas) captures only the first — documented contract', () => {
    const md = '## Features\n\n### F-023: T [planned]\n\n**Uses design:** DT-001 DT-002\n\n';
    const { features } = fmap.parseFeatureMapContent(md);
    assert.deepStrictEqual(features[0].usesDesign, ['DT-001']);
  });

  // Empty-after-label -> [] (serializer will then drop the line entirely on next write).
  it('empty **Uses design:** line parses to [] and serializer drops it', () => {
    const md = '## Features\n\n### F-023: T [planned]\n\n**Uses design:**\n\n';
    const { features } = fmap.parseFeatureMapContent(md);
    assert.deepStrictEqual(features[0].usesDesign, []);
    const ser = fmap.serializeFeatureMap({ features, lastScan: null });
    assert.doesNotMatch(ser, /\*\*Uses design:/, 'serializer must NOT emit an empty Uses-design line');
  });
});

// ---------------------------------------------------------------------------
// AC-4 — /cap:design --scope: setFeatureUsesDesign + doc regression
// ---------------------------------------------------------------------------

describe('F-063 adversarial AC-4 — setFeatureUsesDesign + --scope doc regression', () => {
  // setFeatureUsesDesign replaces (not merges) — calling twice with a subset must shrink the list.
  it('setFeatureUsesDesign REPLACES the list (not merges) on second call', () => {
    fmap.writeFeatureMap(tmpDir, { features: [{
      id: 'F-023', title: 'Btn', state: 'planned', acs: [], files: [], dependencies: [],
      usesDesign: [], metadata: {},
    }], lastScan: null });
    fmap.setFeatureUsesDesign(tmpDir, 'F-023', ['DT-001', 'DT-002', 'DC-001']);
    let read = fmap.readFeatureMap(tmpDir);
    assert.deepStrictEqual(read.features[0].usesDesign, ['DC-001', 'DT-001', 'DT-002']);
    // Second call with a strict subset must shrink, not merge.
    fmap.setFeatureUsesDesign(tmpDir, 'F-023', ['DT-001']);
    read = fmap.readFeatureMap(tmpDir);
    assert.deepStrictEqual(read.features[0].usesDesign, ['DT-001']);
    // Third call with [] clears the list entirely and drops the line.
    fmap.setFeatureUsesDesign(tmpDir, 'F-023', []);
    read = fmap.readFeatureMap(tmpDir);
    assert.deepStrictEqual(read.features[0].usesDesign, []);
    const raw = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.doesNotMatch(raw, /\*\*Uses design:/, 'empty list must NOT leave a residual line');
  });

  // setFeatureUsesDesign deduplicates repeated IDs in the input.
  it('setFeatureUsesDesign deduplicates and sorts', () => {
    fmap.writeFeatureMap(tmpDir, { features: [{
      id: 'F-023', title: 'Btn', state: 'planned', acs: [], files: [], dependencies: [],
      usesDesign: [], metadata: {},
    }], lastScan: null });
    fmap.setFeatureUsesDesign(tmpDir, 'F-023', ['DT-002', 'DT-001', 'DT-001', 'DC-001', 'DT-002']);
    const read = fmap.readFeatureMap(tmpDir);
    assert.deepStrictEqual(read.features[0].usesDesign, ['DC-001', 'DT-001', 'DT-002']);
  });

  // String-match regression: the --scope contract is encoded in the agent + command prompts.
  // If either drifts, the agent output will not parse at runtime. Lock the critical strings.
  it('agents/cap-designer.md and commands/cap/design.md encode the --scope SCOPE OUTPUT contract', () => {
    const agentSrc = fs.readFileSync(path.join(repoRoot, 'agents/cap-designer.md'), 'utf8');
    const cmdSrc = fs.readFileSync(path.join(repoRoot, 'commands/cap/design.md'), 'utf8');
    // Agent must describe the scope mode and emit the exact block markers.
    for (const needle of ['--scope F-NNN', '=== SCOPE OUTPUT ===', '=== END SCOPE OUTPUT ===',
                          'FEATURE_ID:', 'USES_DESIGN:', 'NEW_TOKENS:', 'NEW_COMPONENTS:']) {
      assert.ok(agentSrc.includes(needle), `agents/cap-designer.md missing "${needle}"`);
      assert.ok(cmdSrc.includes(needle), `commands/cap/design.md missing "${needle}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 / AC-6 — Design-Usage rendering + impact-analysis edges
// ---------------------------------------------------------------------------

describe('F-063 adversarial AC-5/AC-6 — rendering + impact edges', () => {
  // formatDesignUsage partial designIndex (only byToken, no byComponent) — components fall back to bare ID.
  it('formatDesignUsage handles partial designIndex (token labels only, component bare)', () => {
    const line = trace.formatDesignUsage(
      { id: 'F-023', usesDesign: ['DT-001', 'DC-001'] },
      { byToken: { 'DT-001': { key: 'primary' } } } // no byComponent
    );
    assert.match(line, /DT-001 primary/);
    assert.match(line, /DC-001(?:,|$)/, 'DC-001 must appear without a label suffix');
    assert.doesNotMatch(line, /DC-001 undefined/);
  });

  // Impact analysis is case-sensitive — lowercase id does NOT match uppercase storage.
  // Contract lock: callers must normalize input; /cap:deps --design gate enforces /^(DT|DC)-\d{3,}$/.
  it('findFeaturesUsingDesignId is strictly case-sensitive (lowercase rejected)', () => {
    const fm = {
      features: [{ id: 'F-023', title: 'Btn', usesDesign: ['DT-001'] }],
      lastScan: null,
    };
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(fm, 'dt-001'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(fm, 'DT-001').map(f => f.id), ['F-023']);
  });

  // Impact analysis with missing / malformed featureMap — never throws, returns [].
  it('findFeaturesUsingDesignId is null-safe and never throws', () => {
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(null, 'DT-001'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId(undefined, 'DT-001'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId({}, 'DT-001'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId({ features: null }, 'DT-001'), []);
    assert.deepStrictEqual(deps.findFeaturesUsingDesignId({ features: [] }, null), []);
  });

  // findFeaturesUsingDesignId returns results sorted by feature ID — deterministic output for CLI.
  it('findFeaturesUsingDesignId sorts results by feature ID (stable CLI output)', () => {
    const fm = {
      features: [
        { id: 'F-030', title: 'C', usesDesign: ['DT-001'] },
        { id: 'F-010', title: 'A', usesDesign: ['DT-001'] },
        { id: 'F-020', title: 'B', usesDesign: ['DT-001'] },
      ],
      lastScan: null,
    };
    const using = deps.findFeaturesUsingDesignId(fm, 'DT-001');
    assert.deepStrictEqual(using.map(f => f.id), ['F-010', 'F-020', 'F-030']);
  });

  // formatDesignImpactReport handles feature with null title gracefully (no em-dash spam).
  it('formatDesignImpactReport renders feature with null title without em-dash', () => {
    const report = deps.formatDesignImpactReport('DT-001', [{ id: 'F-023', title: null }]);
    assert.match(report, /F-023/);
    assert.doesNotMatch(report, /F-023 — /, 'null title must not produce a trailing em-dash');
  });

  // String-match regression: status.md, trace.md, deps.md all reference the new F-063 renderers.
  it('commands/cap/{status,trace,deps}.md encode the F-063 Design-Usage / --design hooks', () => {
    const statusMd = fs.readFileSync(path.join(repoRoot, 'commands/cap/status.md'), 'utf8');
    const traceMd = fs.readFileSync(path.join(repoRoot, 'commands/cap/trace.md'), 'utf8');
    const depsMd = fs.readFileSync(path.join(repoRoot, 'commands/cap/deps.md'), 'utf8');
    // status verbose must mention Design-Usage + formatDesignUsage.
    assert.ok(statusMd.includes('Design-Usage'), 'status.md missing "Design-Usage" section');
    assert.ok(statusMd.includes('formatDesignUsage'), 'status.md missing formatDesignUsage call');
    // trace must hook formatDesignUsage at step 2b.
    assert.ok(traceMd.includes('formatDesignUsage'), 'trace.md missing formatDesignUsage call');
    assert.ok(traceMd.includes('F-063'), 'trace.md missing F-063 section marker');
    // deps must wire up --design DT-NNN / DC-NNN fast-path with the validator regex.
    assert.ok(depsMd.includes('--design'), 'deps.md missing --design flag');
    assert.ok(depsMd.includes('findFeaturesUsingDesignId'), 'deps.md missing findFeaturesUsingDesignId');
    assert.ok(depsMd.includes('formatDesignImpactReport'), 'deps.md missing formatDesignImpactReport');
  });
});

// ---------------------------------------------------------------------------
// Backward-compat — F-001, F-002, F-062 byte-identical regression guards
// ---------------------------------------------------------------------------

describe('F-063 adversarial — backward compat against F-001 / F-002 / F-062', () => {
  // F-001 guard: scanning a file with NO design tags produces byte-identical tag shape as pre-F-063.
  // Each legacy tag retains { type, file, line, metadata, description, raw, subtype }.
  it('F-001: file without design tags scans to the legacy 4-type CapTag shape unchanged', () => {
    const src = [
      '// @cap-feature(feature:F-001) foo',
      '// @cap-todo(ac:F-001/AC-1) do things',
      '// @cap-todo risk: race condition on concurrent access',
      '// @cap-risk memory leak possible',
      '// @cap-decision use regex',
    ].join('\n');
    const tags = scanner.extractTags(src, 'x.js');
    assert.strictEqual(tags.length, 5);
    assert.deepStrictEqual(tags.map(t => t.type), ['feature', 'todo', 'todo', 'risk', 'decision']);
    // Subtype detected from the description prefix on @cap-todo lines (F-001 contract).
    assert.strictEqual(tags[2].subtype, 'risk');
    // All tags have the full legacy shape.
    for (const t of tags) {
      assert.ok('type' in t && 'file' in t && 'line' in t && 'metadata' in t, 'tag missing core keys');
      assert.ok('description' in t && 'raw' in t && 'subtype' in t, 'tag missing extended keys');
    }
    // CAP_TAG_TYPES still pinned at exactly 4 entries.
    assert.strictEqual(scanner.CAP_TAG_TYPES.length, 4, 'F-001 regression guard: CAP_TAG_TYPES length is pinned at 4');
  });

  // F-002 guard: roundtrip a FEATURE-MAP.md that has NO design entries. Must be byte-for-byte
  // symmetric through parse→serialize→parse on the structured shape.
  it('F-002: roundtrip of a design-free Feature Map preserves features structurally', () => {
    const md = [
      '# Feature Map',
      '',
      '> Single source of truth for feature identity, state, acceptance criteria, and relationships.',
      '> Auto-enriched by `@cap-feature` tags and dependency analysis.',
      '',
      '## Features',
      '',
      '### F-001: Tag Scanner [shipped]',
      '',
      '**Depends on:** F-002',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | regex works |',
      '',
      '**Files:**',
      '- `cap/bin/lib/cap-tag-scanner.cjs`',
      '',
    ].join('\n');
    const parsed = fmap.parseFeatureMapContent(md);
    assert.strictEqual(parsed.features.length, 1);
    assert.deepStrictEqual(parsed.features[0].usesDesign, [], 'F-002 regression: absent line => []');
    const ser = fmap.serializeFeatureMap(parsed);
    assert.doesNotMatch(ser, /\*\*Uses design:/, 'serializer must NOT inject an empty Uses-design');
    const reparsed = fmap.parseFeatureMapContent(ser);
    assert.strictEqual(reparsed.features[0].id, 'F-001');
    assert.strictEqual(reparsed.features[0].state, 'shipped');
    assert.deepStrictEqual(reparsed.features[0].dependencies, ['F-002']);
    assert.deepStrictEqual(reparsed.features[0].acs, parsed.features[0].acs);
    assert.deepStrictEqual(reparsed.features[0].files, ['cap/bin/lib/cap-tag-scanner.cjs']);
    assert.deepStrictEqual(reparsed.features[0].usesDesign, []);
  });

  // F-062 snapshot lock: buildDesignMd without withIds MUST remain byte-identical to the F-062 output.
  // The default behavior has zero ID suffixes anywhere in the file.
  it('F-062: buildDesignMd without withIds has zero ID suffixes in the entire output', () => {
    for (const key of Object.keys(design.AESTHETIC_FAMILIES)) {
      const md = design.buildDesignMd({ family: design.AESTHETIC_FAMILIES[key] });
      assert.doesNotMatch(md, /\(id: DT-/, `${key}: default output leaked a DT- suffix`);
      assert.doesNotMatch(md, /\(id: DC-/, `${key}: default output leaked a DC- suffix`);
    }
  });

  // F-062 extendDesignMd snapshot lock: if withIds is OMITTED, new entries are added WITHOUT ID suffixes.
  // This guards against a future "always-on" migration that would break the F-062 snapshot tests.
  it('F-062: extendDesignMd without withIds option adds new entries WITHOUT IDs', () => {
    const base = design.buildDesignMd({ family: design.AESTHETIC_FAMILIES['editorial-minimalism'] });
    const extended = design.extendDesignMd(base, {
      colors: { brandNew: '#ABCDEF' },
      components: { Modal: { variants: ['x'], states: ['y'] } },
    }); // NO options arg
    // The new line must appear WITHOUT an (id: DT-NNN) suffix.
    assert.match(extended, /^- brandNew: #ABCDEF$/m, 'new color must be suffix-free in F-062 mode');
    assert.match(extended, /^### Modal$/m, 'new component must be suffix-free in F-062 mode');
    assert.doesNotMatch(extended, /\(id: DT-/);
    assert.doesNotMatch(extended, /\(id: DC-/);
  });
});
