'use strict';

// @cap-feature(feature:F-047) Tests for cap-anchor.cjs — unified anchor block parser.

const { describe, it } = require('node:test');
const assert = require('node:assert');

const anchor = require('../cap/bin/lib/cap-anchor.cjs');

// ---------------------------------------------------------------------------
// parseAnchorLine
// ---------------------------------------------------------------------------

describe('parseAnchorLine', () => {
  it('returns null on non-string / missing @cap', () => {
    assert.strictEqual(anchor.parseAnchorLine(null), null);
    assert.strictEqual(anchor.parseAnchorLine(''), null);
    assert.strictEqual(anchor.parseAnchorLine(42), null);
    assert.strictEqual(anchor.parseAnchorLine('plain line, no anchor'), null);
  });

  it('parses minimal feature-only anchor', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 */');
    assert.strictEqual(r.feature, 'F-001');
    assert.deepStrictEqual(r.acs, []);
    assert.strictEqual(r.role, null);
    assert.deepStrictEqual(r.warnings, []);
  });

  it('parses acs list', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 acs:[AC-1,AC-3] */');
    assert.deepStrictEqual(r.acs, ['AC-1', 'AC-3']);
  });

  it('parses role=primary', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 role:primary */');
    assert.strictEqual(r.role, 'primary');
  });

  it('handles line-style comment (Python/shell)', () => {
    const r = anchor.parseAnchorLine('# @cap feature:F-002 acs:[AC-1]');
    assert.strictEqual(r.feature, 'F-002');
    assert.deepStrictEqual(r.acs, ['AC-1']);
  });

  it('handles HTML-style comment', () => {
    const r = anchor.parseAnchorLine('<!-- @cap feature:F-003 -->');
    assert.strictEqual(r.feature, 'F-003');
    // -->  must be stripped from raw body
    assert.ok(!r.raw.includes('-->') || r.raw.indexOf('-->') > r.raw.indexOf('@cap'));
  });

  it('strips trailing */ and --> from body', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-010 role:primary */');
    assert.strictEqual(r.feature, 'F-010');
    assert.strictEqual(r.role, 'primary');
  });

  it('warns on malformed feature id', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:bogus */');
    assert.strictEqual(r.feature, 'bogus');
    assert.ok(r.warnings.some((w) => w.includes('feature value')));
  });

  it('warns on malformed acs list (missing brackets)', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 acs:AC-1,AC-2 */');
    assert.ok(r.warnings.some((w) => w.includes('acs must be')));
  });

  it('warns on unknown role', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 role:sidekick */');
    assert.ok(r.warnings.some((w) => w.includes('role must be')));
  });

  it('warns on unparseable tokens', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 not-a-kv-pair */');
    assert.ok(r.warnings.some((w) => w.includes('unparseable token')));
  });

  it('warns on unknown key', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 color:red */');
    assert.ok(r.warnings.some((w) => w.includes('unknown key')));
  });

  it('accepts empty acs list []', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-001 acs:[] */');
    assert.deepStrictEqual(r.acs, []);
  });

  it('accepts padded feature ids (F-1000)', () => {
    const r = anchor.parseAnchorLine('/* @cap feature:F-1000 */');
    assert.strictEqual(r.feature, 'F-1000');
    assert.deepStrictEqual(r.warnings, []);
  });

  it('returns ParsedAnchor even when body is empty (warning only)', () => {
    const r = anchor.parseAnchorLine('/* @cap    */');
    assert.ok(r);
    assert.ok(r.warnings.some((w) => w.includes('empty anchor body')));
  });
});

// ---------------------------------------------------------------------------
// expandAnchorToTags
// ---------------------------------------------------------------------------

describe('expandAnchorToTags', () => {
  it('returns [] when feature is missing', () => {
    const t = anchor.expandAnchorToTags({ feature: '', acs: [], role: null, warnings: [] }, 'x.js', 1);
    assert.deepStrictEqual(t, []);
  });

  it('emits a @cap-feature tag with metadata.feature', () => {
    const t = anchor.expandAnchorToTags(
      { feature: 'F-001', acs: [], role: null, raw: '@cap feature:F-001', warnings: [] },
      'src/a.js',
      5
    );
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].type, 'feature');
    assert.strictEqual(t[0].metadata.feature, 'F-001');
    assert.strictEqual(t[0].metadata.primary, undefined);
    assert.strictEqual(t[0].file, 'src/a.js');
    assert.strictEqual(t[0].line, 5);
  });

  it('flags primary:true when role is primary', () => {
    const t = anchor.expandAnchorToTags(
      { feature: 'F-001', acs: [], role: 'primary', raw: '', warnings: [] },
      'x',
      1
    );
    assert.strictEqual(t[0].metadata.primary, true);
  });

  it('emits one @cap-todo per AC with fully-qualified ac key', () => {
    const t = anchor.expandAnchorToTags(
      { feature: 'F-002', acs: ['AC-1', 'AC-3'], role: null, raw: '', warnings: [] },
      'x.js',
      10
    );
    const todos = t.filter((x) => x.type === 'todo');
    assert.strictEqual(todos.length, 2);
    assert.strictEqual(todos[0].metadata.ac, 'F-002/AC-1');
    assert.strictEqual(todos[1].metadata.ac, 'F-002/AC-3');
  });
});

// ---------------------------------------------------------------------------
// emitAnchorBlock
// ---------------------------------------------------------------------------

describe('emitAnchorBlock', () => {
  it('emits block style by default', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001' });
    assert.strictEqual(s, '/* @cap feature:F-001 */');
  });

  it('emits line style', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001', role: 'primary' }, 'line');
    assert.strictEqual(s, '# @cap feature:F-001 role:primary');
  });

  it('emits html style', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001' }, 'html');
    assert.strictEqual(s, '<!-- @cap feature:F-001 -->');
  });

  it('includes acs when non-empty', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001', acs: ['AC-1', 'AC-2'] });
    assert.ok(s.includes('acs:[AC-1,AC-2]'));
  });

  it('omits acs when empty', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001', acs: [] });
    assert.ok(!s.includes('acs:'));
  });

  it('omits role when neither primary nor secondary', () => {
    const s = anchor.emitAnchorBlock({ feature: 'F-001', role: 'something-else' });
    assert.ok(!s.includes('role:'));
  });
});

// ---------------------------------------------------------------------------
// scanAnchorsInContent + round-trip via parse
// ---------------------------------------------------------------------------

describe('scanAnchorsInContent', () => {
  it('returns [] on empty content', () => {
    assert.deepStrictEqual(anchor.scanAnchorsInContent('', 'x.js'), []);
    assert.deepStrictEqual(anchor.scanAnchorsInContent(null, 'x.js'), []);
  });

  it('finds one anchor and expands to 3 tags (feature + 2 ACs)', () => {
    const content = [
      '// top comment',
      '/* @cap feature:F-001 acs:[AC-1,AC-2] role:primary */',
      "const x = 1;",
    ].join('\n');
    const t = anchor.scanAnchorsInContent(content, 'x.js');
    assert.strictEqual(t.length, 3);
    assert.strictEqual(t[0].type, 'feature');
    assert.strictEqual(t[0].metadata.primary, true);
    assert.strictEqual(t[1].type, 'todo');
    assert.strictEqual(t[1].metadata.ac, 'F-001/AC-1');
    assert.strictEqual(t[2].metadata.ac, 'F-001/AC-2');
    // line number is 1-based and anchor is on line 2
    assert.strictEqual(t[0].line, 2);
  });

  it('finds multiple anchor blocks in one file', () => {
    const content = [
      '/* @cap feature:F-001 acs:[AC-1] */',
      'function foo() {}',
      '/* @cap feature:F-002 */',
      'function bar() {}',
    ].join('\n');
    const t = anchor.scanAnchorsInContent(content, 'x.js');
    const features = t.filter((x) => x.type === 'feature').map((x) => x.metadata.feature);
    assert.deepStrictEqual(features.sort(), ['F-001', 'F-002']);
  });

  it('does NOT match @cap-feature (legacy tag) — space separator matters', () => {
    const content = '// @cap-feature(feature:F-001)';
    const t = anchor.scanAnchorsInContent(content, 'x.js');
    assert.strictEqual(t.length, 0, 'legacy @cap-feature must not be expanded as a unified anchor');
  });

  it('round-trip: emitAnchorBlock -> parseAnchorLine returns same structure', () => {
    const input = { feature: 'F-099', acs: ['AC-1', 'AC-4'], role: 'primary' };
    const emitted = anchor.emitAnchorBlock(input, 'block');
    const parsed = anchor.parseAnchorLine(emitted);
    assert.strictEqual(parsed.feature, input.feature);
    assert.deepStrictEqual(parsed.acs, input.acs);
    assert.strictEqual(parsed.role, input.role);
  });
});
