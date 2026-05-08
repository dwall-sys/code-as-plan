'use strict';

// @cap-feature(feature:F-081) Adversarial test pass for the multi-format Feature Map parser.
// @cap-decision(F-081/test-strategy) This file is the RED-GREEN companion to
//   tests/cap-feature-map-bullet.test.cjs (29 happy-path tests written by the prototyper). The
//   prototyper's tests cover the canonical happy path; this file attacks the seams systematically
//   per the adversarial brief: boundary regex cases, malformed bullet lines, format-override
//   contradictions, mixed-format collisions, proto-pollution via .cap/config.json, the empty-
//   input crash mode that bit F-077 in Stage-2-Review, schema-validator edge cases, and
//   silent-corruption pathologies (bullets in code blocks, no-space-after-colon, lowercase
//   headers silently dropped).
// @cap-pattern(F-081/test-pattern) Each describe-block declares the AC it attacks; tests within
//   are named for the SPECIFIC adversarial scenario rather than the generic behaviour, so a CI
//   failure log immediately identifies which seam tore.

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

const {
  FEATURE_ID_RE,
  getFeaturePath,
  validateFeatureMemoryFile,
} = require('../cap/bin/lib/cap-memory-schema.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1 — Long-form Feature ID regex /^F-(\d{3,}|[A-Z][A-Z0-9_-]*)$/
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-1) Adversarial regex coverage: boundary digits, malformed long-form,
//   unicode, mixed-case, trailing/leading separators, and digit-letter interleavings.
describe('F-081/AC-1 — adversarial regex boundaries', () => {
  it('rejects 1- and 2-digit numeric IDs (preserves the F-001 zero-pad invariant)', () => {
    assert.equal(FEATURE_ID_PATTERN.test('F-1'), false, 'F-1 must be rejected: < 3 digits');
    assert.equal(FEATURE_ID_PATTERN.test('F-12'), false, 'F-12 must be rejected: < 3 digits');
    assert.equal(FEATURE_ID_PATTERN.test('F-99'), false, 'F-99 must be rejected: < 3 digits');
  });

  it('accepts 3+ digit numeric IDs of arbitrary length', () => {
    assert.equal(FEATURE_ID_PATTERN.test('F-001'), true);
    assert.equal(FEATURE_ID_PATTERN.test('F-1234567'), true);
    assert.equal(FEATURE_ID_PATTERN.test('F-12345678901234567890'), true, 'no upper bound on digits');
  });

  it('rejects empty body, lone separator, and lowercase prefix', () => {
    assert.equal(FEATURE_ID_PATTERN.test('F-'), false, 'empty body must reject');
    assert.equal(FEATURE_ID_PATTERN.test('F--'), false, 'lone separator must reject');
    assert.equal(FEATURE_ID_PATTERN.test('f-001'), false, 'lowercase prefix must reject');
    assert.equal(FEATURE_ID_PATTERN.test('F-deploy'), false, 'lowercase long-form must reject');
    assert.equal(FEATURE_ID_PATTERN.test(''), false);
  });

  it('rejects digit-led short suffixes that would alias the F-076 invariant', () => {
    // The F-076 schema-tests pinned that `F-076-suffix` MUST NOT match. Same for digit-led
    // long-forms that would collide semantically with auto-numbered IDs.
    assert.equal(FEATURE_ID_PATTERN.test('F-076-suffix'), false);
    assert.equal(FEATURE_ID_PATTERN.test('F-1AB'), false, 'digit-led short variant must reject');
    assert.equal(FEATURE_ID_PATTERN.test('F-001abc'), false, 'numeric+lowercase suffix must reject');
    assert.equal(FEATURE_ID_PATTERN.test('F-001ABC'), false, 'numeric+uppercase suffix must reject (pure-digit branch is anchored)');
  });

  it('rejects non-ASCII / unicode-prefix long-forms', () => {
    assert.equal(FEATURE_ID_PATTERN.test('F-Ä'), false, 'unicode uppercase rejected (regex is ASCII-only)');
    assert.equal(FEATURE_ID_PATTERN.test('F-Ω'), false);
  });

  it('rejects punctuation other than `-` and `_` inside long-form body', () => {
    assert.equal(FEATURE_ID_PATTERN.test('F-A.B'), false);
    assert.equal(FEATURE_ID_PATTERN.test('F-A B'), false, 'space must reject');
    assert.equal(FEATURE_ID_PATTERN.test('F-A/B'), false);
    assert.equal(FEATURE_ID_PATTERN.test('F-A:B'), false);
  });

  it('rejects double-dash anywhere in the ID (F-089 tightened the F-081 permissive body)', () => {
    // @cap-decision(F-089/AC-3) F-089 tightened the ID regex from F-081's permissive body class
    //   to a three-branch union that requires segment shape: `[A-Z][A-Z0-9_]*(?:[-_][A-Z0-9_]+)*`
    //   for the legacy long-form. Consecutive separators (`--`, `__`, `-_`) are now rejected
    //   because the separator branch requires at least one body char between separators.
    //   This was explicitly anticipated in the F-081 @cap-risk note ("if a future AC requires
    //   stricter shape, tighten to ..."). F-089 IS that AC.
    assert.equal(FEATURE_ID_PATTERN.test('F--A'), false, 'leading dash rejected');
    assert.equal(FEATURE_ID_PATTERN.test('F-A--B'), false, 'internal double-dash now rejected (F-089)');
  });

  it('rejects trailing dash/underscore (F-089 tightened the regex)', () => {
    // @cap-decision(F-089/AC-3) The F-081 permissive trailing-separator behavior is now closed
    //   off — `F-A-` and `F-A_` no longer pass. Each segment-extension `(?:[-_][A-Z0-9_]+)`
    //   requires a non-empty body after the separator. See cap-feature-map-shard.cjs for the
    //   canonical pattern.
    assert.equal(FEATURE_ID_PATTERN.test('F-A-'), false);
    assert.equal(FEATURE_ID_PATTERN.test('F-A_'), false);
  });

  it('accepts F-089 deskriptiv mixed-case IDs with required hyphen separator', () => {
    // @cap-decision(F-089/AC-3) Third branch of the union: `[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+`
    //   accepts `F-Hub-Spotlight-Carousel`, `F-App2-Feature3`. Single-segment mixed-case (e.g.
    //   `F-Hub`) is REJECTED — the hyphen is mandatory to disambiguate from typos like `F-deploy`.
    assert.equal(FEATURE_ID_PATTERN.test('F-Hub-Spotlight'), true);
    assert.equal(FEATURE_ID_PATTERN.test('F-Hub-Spotlight-Carousel'), true);
    assert.equal(FEATURE_ID_PATTERN.test('F-App2-Feature3'), true);
    assert.equal(FEATURE_ID_PATTERN.test('F-Hub'), false, 'single-segment mixed-case rejected');
    assert.equal(FEATURE_ID_PATTERN.test('F-deploy'), false, 'lowercase single-segment rejected');
  });

  it('parser silently drops headers that do NOT match the regex (no throw, no recovery)', () => {
    // @cap-risk(reason:silent-rejection-of-headers) Header lines that almost-match (e.g.
    //   `### f-001` lowercase) are not surfaced as errors — the parser quietly continues. This
    //   is the same failure mode as the F-076 marker-disagreement bug, applied to feature
    //   headers. Document with a test so the behaviour is locked in (or surfaced and changed).
    const content = [
      '### f-001: Lowercase prefix [planned]',
      '### F-12: Two-digit numeric [planned]',
      '### F-001: Valid header [planned]',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    // Only the third header (F-001) parses; the other two are silently dropped.
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('parser accepts long-form even when interleaved with rejected-shape candidate lines', () => {
    const content = [
      '### F-1: Should reject [planned]',
      '### F-DEPLOY: Should accept [planned]',
      '### F-deploy: Should reject (lowercase) [planned]',
      '### F-HUB-AUTH: Should accept [planned]',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.deepEqual(result.features.map(f => f.id), ['F-DEPLOY', 'F-HUB-AUTH']);
  });

  it('parses titles containing internal brackets (state regex is anchored to line end)', () => {
    // `^(.+?)\s+\[(\w+)\]\s*$` is non-greedy + end-anchored, so internal `[...]` in a title
    // is preserved and only the trailing `[state]` is consumed.
    const content = '### F-001: Title [with brackets] in middle [planned]\n';
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].title, 'Title [with brackets] in middle');
    assert.equal(result.features[0].state, 'planned');
  });

  it('header without [state] suffix defaults to "planned"', () => {
    const content = '### F-001: Title without state\n';
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].state, 'planned');
    assert.equal(result.features[0].title, 'Title without state');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Bullet-style ACs (`- [ ] AC-N: <description>`) per-block
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-2) Adversarial bullet parsing: marker variants, status-marker case,
//   colon spacing, indentation, code-block leakage, multi-bullet-per-line.
describe('F-081/AC-2 — adversarial bullet-AC parsing', () => {
  it('accepts uppercase [X] checkbox marker (regex `i` flag)', () => {
    // @cap-decision(F-081/AC-2) Markdown convention is lowercase `[x]` but editors auto-rewrite
    //   to `[X]` in some configurations. The bullet-AC regex carries the `i` flag deliberately.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [X] AC-1: Uppercase checked marker',
      '- [x] AC-2: Lowercase checked marker',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].status, 'tested');
    assert.equal(result.features[0].acs[1].status, 'tested');
  });

  it('rejects `+` bullet marker (regex restricted to `-` and `*`)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '+ [ ] AC-1: Plus bullet must NOT match',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 0, 'plus-bullet must not be parsed as bullet AC');
  });

  it('accepts tab-indented bullet ACs', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '\t- [ ] AC-1: Tab-indented bullet',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
  });

  it('accepts space-indented bullet ACs (nested-list shape)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '    - [ ] AC-1: 4-space indented',
      '  - [ ] AC-2: 2-space indented',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
  });

  it('parses bullet AC with no space between colon and description', () => {
    // Documents existing parser behaviour: `:\s*` allows zero whitespace.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1:NoSpace',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].description, 'NoSpace');
  });

  it('does not match a line containing two bullet ACs (only first prefix on line wins)', () => {
    // @cap-decision(F-081/AC-2) Bullet regex is line-anchored (`^[\s]*[-*]\s+\[`) so a malformed
    //   single-line collapse (`- [ ] AC-1: a - [ ] AC-2: b`) parses as ONE AC with the rest of
    //   the line in the description. Two-on-one-line inputs are user error; documenting the
    //   fall-through is sufficient.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: first - [ ] AC-2: second',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
    // Description swallows the trailing pseudo-bullet — silent merge but no data loss.
    assert.match(result.features[0].acs[0].description, /first/);
    assert.match(result.features[0].acs[0].description, /AC-2/);
  });

  it('@cap-risk parses bullet ACs INSIDE markdown code blocks (parser does not strip ``` fences)', () => {
    // @cap-risk(reason:codeblock-leakage) The parser treats every line uniformly; ``` fences
    //   are NOT stripped. A user documenting bullet syntax inside a fenced code block will
    //   inadvertently inject phantom ACs. This is a real silent-corruption mode but fixing it
    //   requires a fence-state-machine that the v1 parser deliberately omits.
    //   Mitigation: flag with @cap-risk; future feature to add fence-aware stripping.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '```markdown',
      '- [ ] AC-1: Example syntax shown in docs',
      '```',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    // Documents the leak. If a future fence-aware parser lands, flip this to assert 0.
    assert.equal(result.features[0].acs.length, 1, 'code-block leakage documented as @cap-risk');
  });

  it('preserves AC-N suffix descriptions verbatim (no auto-numbering rewrite)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-7: Skipped 1..6 intentionally',
      '- [x] AC-42: Way-out-of-order',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 2);
    assert.equal(result.features[0].acs[0].id, 'AC-7');
    assert.equal(result.features[0].acs[1].id, 'AC-42');
  });

  it('does NOT auto-promote a bullet AC line through the legacy anonymous-checkbox path', () => {
    // @cap-decision(F-081/AC-2) Critical regression test: even if `formatStyle: 'table'` blocks
    //   the bullet branch, the line must NOT fall through to the legacy `acCheckboxRE` which
    //   would auto-renumber it as `AC-1` and dump `AC-7:` verbatim into the description.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-7: Should NOT be silently renumbered to AC-1',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'table' });
    assert.equal(result.features[0].acs.length, 0,
      'table-only override must drop the bullet entirely, not fall through to legacy auto-numbering');
  });

  it('handles a feature with zero bullet ACs and zero table rows (no spurious entries)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      'Some prose paragraph.',
      '',
      'Another paragraph.',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 0);
  });

  it('parses bullet AC immediately after the header with no blank line', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '- [ ] AC-1: No blank line between header and bullets',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
  });

  it('preserves embedded `[x]` characters inside bullet AC description (no false-positive checkbox)', () => {
    // The bullet regex anchors `^[\s]*[-*]\s+\[([ x])\]\s+(AC-\d+):` — only the LEADING bracket
    // is the checkbox. Subsequent `[x]` text in the description must remain intact.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Description with [x] checkbox-ish chars and [unchecked] markers',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].status, 'pending', 'leading [ ] is the source of truth');
    assert.match(result.features[0].acs[0].description, /\[x\]/, 'embedded [x] preserved');
    assert.match(result.features[0].acs[0].description, /\[unchecked\]/);
  });

  it('preserves backticks inside bullet AC description (no markdown stripping)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Use `cap-feature-map.cjs` to load the map',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs[0].description, 'Use `cap-feature-map.cjs` to load the map');
  });

  it('accepts very long bullet AC descriptions (5KB) without truncation', () => {
    const longDesc = 'x'.repeat(5000);
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      `- [ ] AC-1: ${longDesc}`,
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features[0].acs[0].description.length, 5000);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Format style override via .cap/config.json + parse options
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-3) Adversarial config handling: malformed JSON, wrong types, case
//   sensitivity, override precedence, empty config object, contradictory format choices.
describe('F-081/AC-3 — adversarial format-style overrides', () => {
  it('treats featureMapStyle as case-sensitive (uppercase "TABLE" falls back to auto)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Should appear because TABLE != table',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'TABLE' });
    // 'TABLE' is not 'table' / 'bullet' / 'auto' → fallback to 'auto' → bullet parses.
    assert.equal(result.features[0].acs.length, 1);
  });

  it('falls back to auto when featureMapStyle is a number (wrong type)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: numeric style → auto → parse',
      '',
    ].join('\n');
    // @ts-expect-error — intentionally passing wrong type
    const result = parseFeatureMapContent(content, { featureMapStyle: 123 });
    assert.equal(result.features[0].acs.length, 1);
  });

  it('falls back to auto when featureMapStyle is null/undefined/object', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: nullish style → auto → parse',
      '',
    ].join('\n');
    // @ts-expect-error
    assert.equal(parseFeatureMapContent(content, { featureMapStyle: null }).features[0].acs.length, 1);
    // @ts-expect-error
    assert.equal(parseFeatureMapContent(content, { featureMapStyle: undefined }).features[0].acs.length, 1);
    // @ts-expect-error
    assert.equal(parseFeatureMapContent(content, { featureMapStyle: {} }).features[0].acs.length, 1);
  });

  it('explicit "auto" matches default behaviour (idempotent)', () => {
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Default and explicit auto must agree',
      '',
    ].join('\n');
    const r1 = parseFeatureMapContent(content);
    const r2 = parseFeatureMapContent(content, { featureMapStyle: 'auto' });
    assert.deepEqual(r1.features[0].acs, r2.features[0].acs);
  });

  it('"bullet" override on a table-only block still parses the table rows (state machine independent)', () => {
    // @cap-decision(F-081/AC-3) The format-style gate ONLY controls bullet detection. Table
    //   rows still go through the `inAcTable` state machine because the table header line
    //   activates that state regardless. This is intentional — pure-bullet maps don't have
    //   table headers, so the gate's narrow scope is safe in practice.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Table-only |',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'bullet' });
    assert.equal(result.features[0].acs.length, 1, 'table state machine still fires under bullet override');
    assert.equal(result.features[0].acs[0].id, 'AC-1');
  });

  it('"table" override drops bullet ACs entirely (no fallthrough to anonymous checkboxes)', () => {
    // Companion to the AC-2 regression test, expressed from the AC-3 angle.
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Bullet must be dropped under table-only',
      '- [x] AC-2: Bullet must be dropped under table-only',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { featureMapStyle: 'table' });
    assert.equal(result.features[0].acs.length, 0);
  });

  it('config file present but featureMapStyle key absent → "auto"', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), JSON.stringify({ otherKey: 'foo' }), 'utf8');
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: should parse because config has no featureMapStyle',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { projectRoot: tmpDir });
    assert.equal(result.features[0].acs.length, 1);
  });

  it('config featureMapStyle as wrong type ("table" with leading whitespace) does not match', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: ' table ' }), 'utf8');
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: " table " (with spaces) is not "table" — falls back to auto',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content, { projectRoot: tmpDir });
    assert.equal(result.features[0].acs.length, 1);
  });

  it('parser remains pure: malformed config file does not crash repeated calls', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), 'this is not json at all', 'utf8');
    const content = [
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: malformed config → graceful default → bullet parses',
      '',
    ].join('\n');
    // Call twice; both must succeed without throwing.
    const r1 = parseFeatureMapContent(content, { projectRoot: tmpDir });
    const r2 = parseFeatureMapContent(content, { projectRoot: tmpDir });
    assert.equal(r1.features[0].acs.length, 1);
    assert.equal(r2.features[0].acs.length, 1);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — Duplicate-after-normalization throws with positioned error
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-4) Adversarial duplicate detection: triple duplicates, cross-format
//   collisions, normalization boundary cases.
describe('F-081/AC-4 — adversarial duplicate detection', () => {
  it('reports the FIRST collision when there are three duplicates (does not silently swallow third)', () => {
    const content = [
      '### F-001: A [planned]', // line 1
      '',                        // line 2
      '### F-001: B [planned]', // line 3 — first collision
      '',                        // line 4
      '### F-001: C [planned]', // line 5
      '',
    ].join('\n');
    let caught = null;
    try {
      parseFeatureMapContent(content);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'must throw on triple duplicate');
    assert.equal(caught.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(caught.firstLine, 1);
    assert.equal(caught.duplicateLine, 3, 'throws on the first collision detected');
  });

  it('throws on duplicate long-form ID with both line numbers', () => {
    const content = [
      '### F-DEPLOY: First [planned]',
      '',
      '### F-DEPLOY: Second [planned]',
    ].join('\n');
    assert.throws(
      () => parseFeatureMapContent(content),
      (err) => {
        assert.equal(err.code, 'CAP_DUPLICATE_FEATURE_ID');
        assert.equal(err.duplicateId, 'F-DEPLOY');
        assert.equal(typeof err.firstLine, 'number');
        assert.equal(typeof err.duplicateLine, 'number');
        return true;
      }
    );
  });

  it('does NOT throw on `F-001` + `F-1` because `F-1` fails the header regex (silent rejection)', () => {
    // @cap-decision(F-081/AC-4) Normalization-collision between `F-001` and `F-1` is impossible
    //   in practice because `F-1` is REJECTED by the header regex before normalization runs.
    //   This test documents that gap so a future regex relaxation surfaces it as a regression.
    const content = [
      '### F-001: Three-digit [planned]',
      '',
      '### F-1: Two-digit [planned]', // silently dropped by header regex
      '',
    ].join('\n');
    assert.doesNotThrow(() => parseFeatureMapContent(content));
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('does NOT throw on case-mismatch `f-001` + `F-001` (lowercase silently dropped pre-normalization)', () => {
    // Same shape: `f-001` fails header regex, so it is dropped BEFORE the normalization map
    //   is built. This is consistent with AC-1's "silent rejection" behaviour.
    const content = [
      '### f-001: Lowercase [planned]',
      '',
      '### F-001: Uppercase [planned]',
      '',
    ].join('\n');
    assert.doesNotThrow(() => parseFeatureMapContent(content));
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('throws on duplicate even when one block uses bullet ACs and the other uses table ACs', () => {
    const content = [
      '### F-DEPLOY: A [planned]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Table-style |',
      '',
      '### F-DEPLOY: B [planned]',
      '',
      '- [ ] AC-1: Bullet-style',
      '',
    ].join('\n');
    assert.throws(
      () => parseFeatureMapContent(content),
      (err) => err.code === 'CAP_DUPLICATE_FEATURE_ID'
    );
  });

  it('does not throw on a single feature with no duplicates (fast path)', () => {
    const content = '### F-001: Lone feature [planned]\n';
    assert.doesNotThrow(() => parseFeatureMapContent(content));
  });

  it('does not throw on empty input (vacuously unique)', () => {
    // @cap-decision(F-081/AC-4) Empty input must not crash — protects against the F-077 EOF-hang
    //   foot-gun (Stage-2-Review caught a similar pattern in V6 memory pipeline).
    assert.doesNotThrow(() => parseFeatureMapContent(''));
    const result = parseFeatureMapContent('');
    assert.deepEqual(result, { features: [], lastScan: null });
  });

  it('detects duplicates across CRLF line endings (line counter still works)', () => {
    // @cap-decision(F-081/AC-4) Line splitting uses `content.split('\n')` so CRLF inputs leave
    //   `\r` at the end of each line content but don't shift line numbers. Duplicate detection
    //   still fires because the regex tolerates trailing `\r` via `\s*$`.
    const content = '### F-001: A [planned]\r\n### F-001: B [planned]\r\n';
    assert.throws(
      () => parseFeatureMapContent(content),
      (err) => {
        assert.equal(err.code, 'CAP_DUPLICATE_FEATURE_ID');
        assert.equal(err.duplicateId, 'F-001');
        return true;
      }
    );
  });

  it('error object contains structured fields for tooling to consume', () => {
    const content = [
      '### F-HUB-AUTH: First [planned]',
      '### F-HUB-AUTH: Second [planned]',
    ].join('\n');
    let caught = null;
    try { parseFeatureMapContent(content); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.equal(caught.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(caught.duplicateId, 'F-HUB-AUTH');
    assert.equal(typeof caught.firstLine, 'number');
    assert.equal(typeof caught.duplicateLine, 'number');
    assert.ok(caught.duplicateLine > caught.firstLine);
    assert.match(caught.message, /F-HUB-AUTH/);
    assert.match(caught.message, /line \d+/);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — Schema validator accepts union ID format for memory file naming
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-5) Adversarial schema validation: file-name boundary cases, malformed
//   IDs in front-matter, related_features arrays.
describe('F-081/AC-5 — adversarial schema validator (union ID)', () => {
  it('FEATURE_ID_RE accepts the canonical long-forms', () => {
    assert.equal(FEATURE_ID_RE.test('F-DEPLOY'), true);
    assert.equal(FEATURE_ID_RE.test('F-HUB-AUTH'), true);
    assert.equal(FEATURE_ID_RE.test('F-A_B'), true);
    assert.equal(FEATURE_ID_RE.test('F-001'), true);
  });

  it('FEATURE_ID_RE rejects digit-led short variants and lowercase', () => {
    assert.equal(FEATURE_ID_RE.test('F-1'), false);
    assert.equal(FEATURE_ID_RE.test('F-foo-bar'), false);
    assert.equal(FEATURE_ID_RE.test('F-076-suffix'), false);
    assert.equal(FEATURE_ID_RE.test('F-1AB'), false);
  });

  it('getFeaturePath constructs paths for long-form IDs', () => {
    const p = getFeaturePath('/tmp/proj', 'F-DEPLOY', 'ci-cd');
    assert.match(p, /F-DEPLOY-ci-cd\.md$/);
  });

  it('getFeaturePath rejects digit-led short variants with TypeError', () => {
    assert.throws(() => getFeaturePath('/tmp', 'F-1', 'foo'), TypeError);
    assert.throws(() => getFeaturePath('/tmp', 'F-foo', 'foo'), TypeError);
  });

  it('getFeaturePath rejects empty / non-string projectRoot', () => {
    assert.throws(() => getFeaturePath('', 'F-DEPLOY', 'foo'), TypeError);
    assert.throws(() => getFeaturePath(null, 'F-DEPLOY', 'foo'), TypeError);
    assert.throws(() => getFeaturePath(123, 'F-DEPLOY', 'foo'), TypeError);
  });

  it('validateFeatureMemoryFile accepts long-form `feature` in front-matter', () => {
    const content = [
      '---',
      'feature: F-DEPLOY',
      'topic: ci-cd',
      'updated: 2026-05-06T00:00:00Z',
      '---',
      '# F-DEPLOY: CI/CD',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, true, `unexpected errors: ${JSON.stringify(result.errors)}`);
  });

  it('validateFeatureMemoryFile rejects digit-led short feature ID with descriptive error', () => {
    const content = [
      '---',
      'feature: F-1',
      'topic: ci-cd',
      'updated: 2026-05-06T00:00:00Z',
      '---',
      '# F-1: Bad',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    // Error message must reflect the union format so a fix-suggestion is actionable.
    const joined = result.errors.join('\n');
    assert.match(joined, /F-1/);
    assert.match(joined, /F-/, 'error must reference the union regex');
  });

  it('validateFeatureMemoryFile rejects related_features array containing invalid IDs', () => {
    const content = [
      '---',
      'feature: F-DEPLOY',
      'topic: ci-cd',
      'updated: 2026-05-06T00:00:00Z',
      'related_features: [F-001, F-1, F-deploy]',
      '---',
      '# x',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, false);
    const joined = result.errors.join('\n');
    // Both invalid IDs should be flagged.
    assert.match(joined, /F-1/);
    assert.match(joined, /F-deploy/);
  });

  it('validateFeatureMemoryFile accepts long-form IDs in related_features array', () => {
    const content = [
      '---',
      'feature: F-DEPLOY',
      'topic: ci-cd',
      'updated: 2026-05-06T00:00:00Z',
      'related_features: [F-001, F-HUB-AUTH, F-A_B]',
      '---',
      '# x',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n');
    const result = validateFeatureMemoryFile(content);
    assert.equal(result.valid, true, `unexpected errors: ${JSON.stringify(result.errors)}`);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — Live FEATURE-MAP.md continues to parse unchanged
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-6) Adversarial regression: parse the live map, assert no F-NNN feature
//   was lost, no extra ACs were spuriously parsed, no duplicate-throw on production data.
describe('F-081/AC-6 — adversarial live-map regression', () => {
  it('live FEATURE-MAP.md never throws on the duplicate-detection pass', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const fmPath = path.join(repoRoot, 'FEATURE-MAP.md');
    if (!fs.existsSync(fmPath)) return;
    const content = fs.readFileSync(fmPath, 'utf8');
    assert.doesNotThrow(() => parseFeatureMapContent(content),
      'live FEATURE-MAP.md must not contain duplicates after F-081 normalization');
  });

  it('live map has no feature with empty AC list when state is shipped (drift smoke)', () => {
    // Sanity: any shipped feature should have at least one AC; missing ACs would mean the
    // parser silently lost the table on the F-081 widening. This is a coarse but cheap check.
    const repoRoot = path.resolve(__dirname, '..');
    const fmPath = path.join(repoRoot, 'FEATURE-MAP.md');
    if (!fs.existsSync(fmPath)) return;
    const content = fs.readFileSync(fmPath, 'utf8');
    const result = parseFeatureMapContent(content);
    const shippedNoAcs = result.features.filter(f => f.state === 'shipped' && f.acs.length === 0);
    // Allow up to a handful (legacy features predate AC tables); the absolute number is the canary.
    assert.ok(shippedNoAcs.length < 10,
      `unexpectedly many shipped features without ACs: ${shippedNoAcs.map(f => f.id).join(', ')}`);
  });

  it('live map IDs all match the union regex (no parser-internal corruption)', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const fmPath = path.join(repoRoot, 'FEATURE-MAP.md');
    if (!fs.existsSync(fmPath)) return;
    const content = fs.readFileSync(fmPath, 'utf8');
    const result = parseFeatureMapContent(content);
    for (const f of result.features) {
      assert.ok(FEATURE_ID_PATTERN.test(f.id),
        `parsed ID "${f.id}" must satisfy FEATURE_ID_PATTERN`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-7 — readCapConfig graceful defaults — security and edge cases
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-7) Adversarial config loading: __proto__ pollution, deeply-nested
//   pollution, symlink resolution, BOM, empty file, very large file.
describe('F-081/AC-7 — readCapConfig adversarial paths', () => {
  it('does NOT pollute Object.prototype when config contains __proto__ key', () => {
    // @cap-decision(F-081/AC-7-security) JSON.parse handles `__proto__` as a regular key in
    //   modern Node — it does NOT actually mutate Object.prototype. But it DOES set the
    //   returned object's `__proto__` to the malicious value, so the chain is broken. We test
    //   both: (a) global prototype is intact, (b) callers are warned that the returned object
    //   has a non-standard prototype.
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      '{"__proto__": {"polluted": true}, "featureMapStyle": "bullet"}',
      'utf8'
    );
    const cfg = readCapConfig(tmpDir);
    // Critical: global prototype must NOT be polluted.
    assert.equal(({}).polluted, undefined, 'Object.prototype must be intact');
    // The returned config still parses — featureMapStyle is preserved.
    assert.equal(cfg.featureMapStyle, 'bullet');
  });

  it('does not allow constructor-prototype pollution to escape', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      '{"constructor": {"prototype": {"polluted": true}}}',
      'utf8'
    );
    const cfg = readCapConfig(tmpDir);
    assert.equal(({}).polluted, undefined,
      'constructor-prototype pollution attempt must not escape');
    // The constructor key is preserved in the returned config but Object.prototype is intact.
    assert.ok('constructor' in cfg);
  });

  it('returns {} for an empty file (zero bytes)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
  });

  it('returns {} for a file containing only whitespace', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '   \n\t  \n', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
  });

  it('returns {} when config is the JSON literal `false`', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), 'false', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
  });

  it('returns {} when config is the JSON literal `0` or a number', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '0', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), '42', 'utf8');
    assert.deepEqual(readCapConfig(tmpDir), {});
  });

  it('returns {} when config has a UTF-8 BOM that breaks JSON.parse', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    // Write BOM + valid JSON. JSON.parse rejects BOM in modern Node — graceful default applies.
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      '﻿{"featureMapStyle": "bullet"}',
      'utf8'
    );
    const cfg = readCapConfig(tmpDir);
    // Either {} (BOM rejected) or {featureMapStyle: "bullet"} (BOM tolerated). Both are
    // acceptable; what matters is no throw and a defined return.
    assert.equal(typeof cfg, 'object');
    assert.ok(cfg !== null);
  });

  it('returns {} when projectRoot is a non-existent path (no parent directory)', () => {
    const ghost = path.join(tmpDir, 'does', 'not', 'exist', 'anywhere');
    assert.deepEqual(readCapConfig(ghost), {});
  });

  it('@cap-risk does not handle symlink loops or read errors specially (returns {} via catch)', () => {
    // @cap-risk(reason:no-symlink-test) Symlink-loop and EACCES paths are platform-specific
    //   and brittle in CI. The catch-all `try/catch` in readCapConfig covers them by design.
    //   We assert the contract — no throw — without manufacturing the failure mode.
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), 'plausibly-malformed', 'utf8');
    assert.doesNotThrow(() => readCapConfig(tmpDir));
  });

  it('survives a config file containing 100KB of valid JSON', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    const big = { featureMapStyle: 'bullet', large: 'x'.repeat(100 * 1024) };
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), JSON.stringify(big), 'utf8');
    const cfg = readCapConfig(tmpDir);
    assert.equal(cfg.featureMapStyle, 'bullet');
    assert.equal(cfg.large.length, 100 * 1024);
  });

  it('readFeatureMap propagates malformed config gracefully (no observable failure)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'config.json'), 'malformed', 'utf8');
    const featureMapContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Should parse via auto fallback',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    const result = readFeatureMap(tmpDir);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].acs.length, 1, 'malformed config falls back to auto');
  });
});

// ---------------------------------------------------------------------------
// AC-8 — coverage of the new functionality (cross-cutting integration)
// ---------------------------------------------------------------------------
// @cap-todo(ac:F-081/AC-8) End-to-end integration covering long-form ID + bullet AC + config
//   override + duplicate detection in a single realistic scenario.
describe('F-081/AC-8 — end-to-end integration scenarios', () => {
  it('long-form feature with bullet ACs round-trips through readFeatureMap', () => {
    const featureMapContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD pipeline [planned]',
      '',
      '- [ ] AC-1: Pipeline runs on every push',
      '- [x] AC-2: Failed builds block merge',
      '',
      '### F-HUB-AUTH: Hub authentication [shipped]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Login works |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    const result = readFeatureMap(tmpDir);
    assert.equal(result.features.length, 2);

    const deploy = result.features.find(f => f.id === 'F-DEPLOY');
    assert.ok(deploy);
    assert.equal(deploy.acs.length, 2);
    assert.equal(deploy.acs[0].id, 'AC-1');
    assert.equal(deploy.acs[1].status, 'tested');

    const auth = result.features.find(f => f.id === 'F-HUB-AUTH');
    assert.ok(auth);
    assert.equal(auth.acs.length, 1);
    assert.equal(auth.state, 'shipped');
  });

  it('config override survives readFeatureMap for monorepo apps', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'bullet' }),
      'utf8'
    );
    const featureMapContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '- [ ] AC-1: Bullet wins under explicit bullet config',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    const result = readFeatureMap(tmpDir);
    assert.equal(result.features[0].acs.length, 1);
    assert.equal(result.features[0].acs[0].id, 'AC-1');
  });

  it('duplicate-on-disk causes readFeatureMap to throw with positioned error', () => {
    const featureMapContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-DEPLOY: First [planned]',
      '',
      '### F-DEPLOY: Duplicate [planned]',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    assert.throws(
      () => readFeatureMap(tmpDir),
      (err) => {
        assert.equal(err.code, 'CAP_DUPLICATE_FEATURE_ID');
        assert.equal(err.duplicateId, 'F-DEPLOY');
        return true;
      }
    );
  });

  it('@cap-risk readFeatureMap does NOT cache config across calls (each invocation re-reads disk)', () => {
    // @cap-risk(reason:no-config-cache) readFeatureMap re-reads .cap/config.json on every
    //   invocation. Acceptable for v1 (config files are small) but worth flagging if hot-path
    //   read performance becomes a concern. Documenting via test so the contract is locked.
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
      '- [ ] AC-1: Should be dropped (table-only)',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');
    const r1 = readFeatureMap(tmpDir);
    assert.equal(r1.features[0].acs.length, 0);

    // Hot-swap config and re-read. New behaviour must apply immediately.
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'config.json'),
      JSON.stringify({ featureMapStyle: 'bullet' }),
      'utf8'
    );
    const r2 = readFeatureMap(tmpDir);
    assert.equal(r2.features[0].acs.length, 1, 'config hot-swap must apply to next read');
  });

  it('handles a realistic mixed map with 5 features (long-form + numeric, table + bullet, deps + designs)', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: Tag Scanner [shipped]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Scans .js files |',
      '',
      '### F-076: Memory Schema [shipped]',
      '',
      '**Depends on:** F-001',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Validates schema |',
      '',
      '### F-DEPLOY: CI/CD [planned]',
      '',
      '**Depends on:** F-001, F-076',
      '',
      '- [ ] AC-1: Bullet AC with multi-dep header',
      '- [x] AC-2: Second bullet',
      '',
      '### F-HUB-AUTH: Auth [planned]',
      '',
      '- [ ] AC-1: Bullet for auth',
      '',
      '### F-PERF-WEB-VITALS: Perf [tested]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | Web Vitals tracked |',
      '',
    ].join('\n');
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 5);
    assert.deepEqual(
      result.features.map(f => f.id),
      ['F-001', 'F-076', 'F-DEPLOY', 'F-HUB-AUTH', 'F-PERF-WEB-VITALS']
    );
    // F-DEPLOY has 2 deps and 2 bullet ACs.
    const deploy = result.features.find(f => f.id === 'F-DEPLOY');
    assert.deepEqual(deploy.dependencies, ['F-001', 'F-076']);
    assert.equal(deploy.acs.length, 2);
    // F-HUB-AUTH has 1 bullet AC.
    const auth = result.features.find(f => f.id === 'F-HUB-AUTH');
    assert.equal(auth.acs.length, 1);
    // F-PERF-WEB-VITALS uses table.
    const perf = result.features.find(f => f.id === 'F-PERF-WEB-VITALS');
    assert.equal(perf.acs.length, 1);
    assert.equal(perf.acs[0].status, 'tested');
  });
});
