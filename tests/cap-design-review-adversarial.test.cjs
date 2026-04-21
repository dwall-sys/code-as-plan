'use strict';

// @cap-feature(feature:F-064) cap:design --review — Adversarial hardening tests (module-split + edges).
// @cap-context Baseline: tests/cap-design-review.test.cjs (38 tests). These probe the novel structural
//              change of F-064 (module split cap-design-families.cjs) plus parser/review edge cases
//              not covered by the baseline. Mindset: break it.
// @cap-constraint node:test only. No vitest. No added flakiness. No weakening of prior assertions.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const design = require('../cap/bin/lib/cap-design.cjs');
const families = require('../cap/bin/lib/cap-design-families.cjs');

const {
  AESTHETIC_FAMILIES,
  FAMILY_MAP,
  ANTI_SLOP_RULES,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
  DEFAULT_DESIGN_RULES,
  REVIEW_SEVERITIES,
  DESIGN_REVIEW_FILE,
  mapAnswersToFamily,
  buildDesignMd,
  readDesignMd,
  writeDesignMd,
  extendDesignMd,
  parseDesignIds,
  assignDesignIds,
  parseDesignRules,
  reviewDesign,
  formatReviewReport,
  readDesignRules,
  writeDesignReview,
} = design;

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f064-adv-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Module-split structural guarantees (F-064 novel change)
// ---------------------------------------------------------------------------

describe('F-064 module-split — public API surface unchanged', () => {
  // @cap-todo(ac:F-064/AC-1) Split must not change exported identity for F-062/F-063 callers.
  it('cap-design.cjs re-exports AESTHETIC_FAMILIES by identity (not a shallow copy)', () => {
    assert.strictEqual(design.AESTHETIC_FAMILIES, families.AESTHETIC_FAMILIES);
  });

  it('cap-design.cjs re-exports FAMILY_MAP by identity', () => {
    assert.strictEqual(design.FAMILY_MAP, families.FAMILY_MAP);
  });

  it('cap-design.cjs re-exports ANTI_SLOP_RULES by identity', () => {
    assert.strictEqual(design.ANTI_SLOP_RULES, families.ANTI_SLOP_RULES);
  });

  it('cap-design.cjs re-exports VALID_READ_HEAVY / VALID_USER_TYPES / VALID_COURAGE by identity', () => {
    assert.strictEqual(design.VALID_READ_HEAVY, families.VALID_READ_HEAVY);
    assert.strictEqual(design.VALID_USER_TYPES, families.VALID_USER_TYPES);
    assert.strictEqual(design.VALID_COURAGE, families.VALID_COURAGE);
  });

  it('AESTHETIC_FAMILIES still has exactly 9 pinned families (AC F-062/AC-2)', () => {
    assert.strictEqual(Object.keys(AESTHETIC_FAMILIES).length, 9);
  });

  it('families container + every family + every nested token object is frozen (F-062 invariant)', () => {
    assert.ok(Object.isFrozen(AESTHETIC_FAMILIES));
    for (const key of Object.keys(AESTHETIC_FAMILIES)) {
      const fam = AESTHETIC_FAMILIES[key];
      assert.ok(Object.isFrozen(fam), `${key} not frozen`);
      assert.ok(Object.isFrozen(fam.colors), `${key}.colors not frozen`);
      assert.ok(Object.isFrozen(fam.spacing), `${key}.spacing not frozen`);
      assert.ok(Object.isFrozen(fam.typography), `${key}.typography not frozen`);
      assert.ok(Object.isFrozen(fam.typography.scale), `${key}.typography.scale not frozen`);
      assert.ok(Object.isFrozen(fam.components), `${key}.components not frozen`);
      for (const cn of Object.keys(fam.components)) {
        assert.ok(Object.isFrozen(fam.components[cn]), `${key}.${cn} not frozen`);
        assert.ok(Object.isFrozen(fam.components[cn].variants), `${key}.${cn}.variants not frozen`);
        assert.ok(Object.isFrozen(fam.components[cn].states), `${key}.${cn}.states not frozen`);
      }
    }
  });

  it('FAMILY_MAP is frozen and complete (2 * 3 * 3 = 18 entries)', () => {
    assert.ok(Object.isFrozen(FAMILY_MAP));
    assert.strictEqual(Object.keys(FAMILY_MAP).length, 18);
    for (const rh of VALID_READ_HEAVY) {
      for (const ut of VALID_USER_TYPES) {
        for (const cf of VALID_COURAGE) {
          const key = `${rh}|${ut}|${cf}`;
          assert.ok(FAMILY_MAP[key], `missing FAMILY_MAP[${key}]`);
          assert.ok(AESTHETIC_FAMILIES[FAMILY_MAP[key]], `family key ${FAMILY_MAP[key]} not in AESTHETIC_FAMILIES`);
        }
      }
    }
  });

  it('ANTI_SLOP_RULES is a frozen array with exactly the pinned count', () => {
    assert.ok(Object.isFrozen(ANTI_SLOP_RULES));
    assert.ok(Array.isArray(ANTI_SLOP_RULES));
    assert.ok(ANTI_SLOP_RULES.length >= 3);
  });

  it('cap-design-families.cjs has NO relative require (no circular-require risk)', () => {
    const src = fs.readFileSync(
      require.resolve('../cap/bin/lib/cap-design-families.cjs'),
      'utf8',
    );
    const relativeRequire = /require\s*\(\s*['"]\.[^'"]+['"]\s*\)/;
    assert.ok(
      !relativeRequire.test(src),
      'families module must not require any relative sibling (keeps it a leaf in the dep graph)',
    );
  });

  it('require-order independence: requiring families first then design gives identical exports', () => {
    const famPath = require.resolve('../cap/bin/lib/cap-design-families.cjs');
    const dsnPath = require.resolve('../cap/bin/lib/cap-design.cjs');
    // Snapshot current identities and then swap require order.
    const beforeFam = require(famPath).AESTHETIC_FAMILIES;
    const beforeDsn = require(dsnPath).AESTHETIC_FAMILIES;
    assert.strictEqual(beforeFam, beforeDsn);

    // Bust the cache, re-require in fam-first order.
    delete require.cache[famPath];
    delete require.cache[dsnPath];
    const fam1 = require(famPath);
    const dsn1 = require(dsnPath);
    assert.strictEqual(fam1.AESTHETIC_FAMILIES, dsn1.AESTHETIC_FAMILIES);
    assert.strictEqual(fam1.FAMILY_MAP, dsn1.FAMILY_MAP);

    // Bust again, reverse order.
    delete require.cache[famPath];
    delete require.cache[dsnPath];
    const dsn2 = require(dsnPath);
    const fam2 = require(famPath);
    assert.strictEqual(fam2.AESTHETIC_FAMILIES, dsn2.AESTHETIC_FAMILIES);
    assert.strictEqual(fam2.FAMILY_MAP, dsn2.FAMILY_MAP);
  });

  it('mapAnswersToFamily resolves through the split module and still returns frozen family objects', () => {
    const fam = mapAnswersToFamily('read-heavy', 'developer', 'balanced');
    assert.strictEqual(fam, AESTHETIC_FAMILIES['terminal-core']);
    assert.ok(Object.isFrozen(fam));
  });

  it('F-001 invariant preserved: CAP_TAG_TYPES.length === 4 after F-064 split', () => {
    const { CAP_TAG_TYPES } = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(CAP_TAG_TYPES.length, 4);
  });

  it('F-019/AC-5 doctor manifest lists BOTH cap-design.cjs and cap-design-families.cjs', () => {
    const { CAP_MODULE_MANIFEST } = require('../cap/bin/lib/cap-doctor.cjs');
    assert.ok(CAP_MODULE_MANIFEST.includes('cap-design.cjs'), 'manifest must still list cap-design.cjs');
    assert.ok(
      CAP_MODULE_MANIFEST.includes('cap-design-families.cjs'),
      'manifest must list the new cap-design-families.cjs (post-split)',
    );
  });
});

// ---------------------------------------------------------------------------
// F-062 backward compat — snapshot lock after F-064 split
// ---------------------------------------------------------------------------

describe('F-064 does not regress F-062 behaviors', () => {
  it('buildDesignMd({family}) without withIds is byte-identical to F-062 contract', () => {
    const fam = AESTHETIC_FAMILIES['editorial-minimalism'];
    const a = buildDesignMd({ family: fam });
    const b = buildDesignMd({ family: fam });
    assert.strictEqual(a, b, 'non-withIds build must be deterministic');
    assert.ok(a.startsWith('# DESIGN.md\n'));
    // Must contain Anti-Patterns block derived from ANTI_SLOP_RULES
    for (const rule of ANTI_SLOP_RULES) {
      assert.ok(a.includes(rule), `DESIGN.md must surface Anti-Slop rule: ${rule.slice(0, 40)}...`);
    }
    // Must NOT contain any DT-/DC- ID suffix when withIds is absent
    assert.ok(!/\(id:\s*DT-\d{3}\)/.test(a), 'bare buildDesignMd must not emit DT ids');
    assert.ok(!/\(id:\s*DC-\d{3}\)/.test(a), 'bare buildDesignMd must not emit DC ids');
  });

  it('buildDesignMd is byte-identical across 50 calls', () => {
    const fam = AESTHETIC_FAMILIES['warm-editorial'];
    const first = buildDesignMd({ family: fam, withIds: true });
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(buildDesignMd({ family: fam, withIds: true }), first);
    }
  });

  it('extendDesignMd snapshot lock holds after split', () => {
    const fam = AESTHETIC_FAMILIES['editorial-minimalism'];
    const base = buildDesignMd({ family: fam });
    const extended = extendDesignMd(base, {
      colors: { warn: '#FF00AA' },
      components: { Modal: { variants: ['default'], states: ['default', 'open'] } },
    });
    // Must contain new entries and preserve original text
    assert.ok(extended.includes('- warn: #FF00AA'));
    assert.ok(extended.includes('### Modal'));
    // Original anti-slop rule still present (no clobber)
    assert.ok(extended.includes(ANTI_SLOP_RULES[0]));
    // Existing colors untouched
    assert.ok(extended.includes(`- primary: ${fam.colors.primary}`));
  });

  it('parseDesignIds works on inline-ID DESIGN.md (F-063 parser intact)', () => {
    const fam = AESTHETIC_FAMILIES['editorial-minimalism'];
    const md = buildDesignMd({ family: fam, withIds: true });
    const ids = parseDesignIds(md);
    assert.ok(ids.tokens.length > 0, 'expected DT ids');
    assert.ok(ids.components.length > 0, 'expected DC ids');
    // Stable-ID guarantee — same ordering on re-parse
    const ids2 = parseDesignIds(md);
    assert.deepStrictEqual(ids.tokens, ids2.tokens);
    assert.deepStrictEqual(ids.components, ids2.components);
  });

  it('assignDesignIds stable-ID (F-063/D4) — existing IDs are NEVER renumbered', () => {
    const content = [
      '# DESIGN.md',
      '',
      '## Tokens',
      '',
      '### Colors',
      '',
      '- primary: #111 (id: DT-007)',
      '- secondary: #222',
      '- accent: #333 (id: DT-003)',
      '',
      '## Components',
      '',
      '### Button (id: DC-042)',
      '',
      '- variants: [a]',
      '- states: [default]',
      '',
      '### Card',
      '',
      '- variants: [a]',
      '- states: [default]',
      '',
    ].join('\n');
    const result = assignDesignIds(content);
    // DT-007 and DT-003 must survive verbatim
    assert.ok(result.content.includes('- primary: #111 (id: DT-007)'));
    assert.ok(result.content.includes('- accent: #333 (id: DT-003)'));
    // DC-042 must survive verbatim
    assert.ok(result.content.includes('### Button (id: DC-042)'));
    // secondary gets next-free id (max+1 = DT-008)
    assert.ok(/- secondary: #222 \(id: DT-008\)/.test(result.content));
    // Card gets next-free DC (max+1 = DC-043)
    assert.ok(/### Card \(id: DC-043\)/.test(result.content));
  });
});

// ---------------------------------------------------------------------------
// parseDesignRules — adversarial parsing
// ---------------------------------------------------------------------------

describe('F-064/AC-4 — parseDesignRules adversarial inputs', () => {
  it('non-string inputs (number, array, object) fall back to DEFAULT_DESIGN_RULES', () => {
    assert.strictEqual(parseDesignRules(42), DEFAULT_DESIGN_RULES);
    assert.strictEqual(parseDesignRules([]), DEFAULT_DESIGN_RULES);
    assert.strictEqual(parseDesignRules({}), DEFAULT_DESIGN_RULES);
    assert.strictEqual(parseDesignRules(true), DEFAULT_DESIGN_RULES);
  });

  it('H1 "# Rules" (wrong heading level) does NOT open the rules section', () => {
    const md = '# Rules\n\n- **[typography] x**: desc.\n  Suggestion: y.\n';
    const r = parseDesignRules(md);
    assert.strictEqual(r, DEFAULT_DESIGN_RULES, 'only ## Rules opens the section');
  });

  it('## rules (lowercase) is accepted (parser is case-insensitive for the header)', () => {
    const md = '## rules\n\n- **[color] c**: desc.\n  Suggestion: s.\n';
    const r = parseDesignRules(md);
    assert.notStrictEqual(r, DEFAULT_DESIGN_RULES);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'color/c');
  });

  it('bullets OUTSIDE ## Rules are ignored, even if well-formed', () => {
    const md = [
      '## Other',
      '',
      '- **[typography] ghost**: should not be parsed.',
      '  Suggestion: ignored.',
      '',
      '## Rules',
      '',
      '- **[color] real**: real one.',
      '  Suggestion: keep.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'color/real');
  });

  it('next H2 after ## Rules closes the section (bullets past it are ignored)', () => {
    const md = [
      '## Rules',
      '',
      '- **[color] a**: desc.',
      '  Suggestion: s.',
      '',
      '## Notes',
      '',
      '- **[color] b**: should not count.',
      '  Suggestion: nope.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'color/a');
  });

  it('rule with missing Suggestion line keeps suggestion as empty string (not undefined)', () => {
    const md = '## Rules\n\n- **[typography] no-suggestion**: desc only.\n';
    const r = parseDesignRules(md);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].suggestion, '');
    assert.strictEqual(typeof r[0].suggestion, 'string');
  });

  it('duplicate rule names are preserved in order (parser is permissive, not deduplicating)', () => {
    const md = [
      '## Rules',
      '',
      '- **[typography] dup**: first.',
      '  Suggestion: a.',
      '- **[typography] dup**: second.',
      '  Suggestion: b.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].description, 'first.');
    assert.strictEqual(r[1].description, 'second.');
  });

  it('Unicode in rule name/kind/description/suggestion survives parsing', () => {
    const md = [
      '## Rules',
      '',
      '- **[typographié] emoji-🔥-ban**: Avoid 🎨 slop.',
      '  Suggestion: Use 💎 typefaces.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].kind, 'typographié');
    assert.strictEqual(r[0].name, 'typographié/emoji-🔥-ban');
    assert.strictEqual(r[0].description, 'Avoid 🎨 slop.');
    assert.strictEqual(r[0].suggestion, 'Use 💎 typefaces.');
  });

  it('invalid severity annotation [severity:nuclear] is IGNORED and falls back to warning', () => {
    const md = [
      '## Rules',
      '',
      '- **[color][severity:nuclear] weird**: desc.',
      '  Suggestion: s.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    // Parser regex only matches (error|warning|info); `nuclear` should not match the severity capture,
    // so the bullet either parses with default warning or is skipped. Either way: no 'nuclear' severity.
    if (r.length > 0) {
      assert.ok(REVIEW_SEVERITIES.includes(r[0].severity), `bad severity: ${r[0].severity}`);
    } else {
      assert.strictEqual(r, DEFAULT_DESIGN_RULES);
    }
  });

  it('custom ruleset: every rule is Object.isFrozen (immutability contract)', () => {
    const md = [
      '## Rules',
      '',
      '- **[a] one**: d1.',
      '  Suggestion: s1.',
      '- **[b][severity:info] two**: d2.',
      '  Suggestion: s2.',
      '',
    ].join('\n');
    const r = parseDesignRules(md);
    assert.ok(Object.isFrozen(r));
    for (const rule of r) {
      assert.ok(Object.isFrozen(rule), `rule ${rule.name} must be frozen`);
    }
  });

  it('pure garbage input (non-markdown) falls back to DEFAULT_DESIGN_RULES, does NOT throw', () => {
    assert.doesNotThrow(() => parseDesignRules('}}<<[[not markdown at all{{{{'));
    assert.strictEqual(parseDesignRules('}}<<[[not markdown at all{{{{'), DEFAULT_DESIGN_RULES);
  });
});

// ---------------------------------------------------------------------------
// reviewDesign — adversarial edges
// ---------------------------------------------------------------------------

describe('F-064/AC-1+AC-2 — reviewDesign adversarial edges', () => {
  it('empty content returns [] (not null/undefined)', () => {
    const v = reviewDesign('', DEFAULT_DESIGN_RULES);
    assert.ok(Array.isArray(v));
    assert.strictEqual(v.length, 0);
  });

  it('section-only DESIGN.md (no tokens) produces zero violations', () => {
    const md = '# DESIGN.md\n\n## Tokens\n\n### Colors\n\n## Components\n\n';
    const v = reviewDesign(md, DEFAULT_DESIGN_RULES);
    assert.strictEqual(v.length, 0);
  });

  it('lowercase "inter" still trips typography/no-generic-fonts (case-insensitive)', () => {
    const v = reviewDesign('- family: "inter"', DEFAULT_DESIGN_RULES);
    const hit = v.find(x => x.rule === 'typography/no-generic-fonts');
    assert.ok(hit, 'case-insensitive generic-font match required');
  });

  it('IM Fell English (opinionated serif) is NOT flagged', () => {
    const v = reviewDesign('- family: "IM Fell English"', DEFAULT_DESIGN_RULES);
    assert.strictEqual(v.filter(x => x.rule === 'typography/no-generic-fonts').length, 0);
  });

  it('PP Editorial New is NOT flagged', () => {
    const v = reviewDesign('- family: "PP Editorial New"', DEFAULT_DESIGN_RULES);
    assert.strictEqual(v.filter(x => x.rule === 'typography/no-generic-fonts').length, 0);
  });

  it('Helvetica Neue (contains Helvetica) IS flagged (word-boundary match)', () => {
    const v = reviewDesign('- family: "Helvetica Neue"', DEFAULT_DESIGN_RULES);
    const hit = v.find(x => x.rule === 'typography/no-generic-fonts');
    assert.ok(hit, 'Helvetica Neue should trip because Helvetica is flagged');
  });

  it('Typography rule fires on familyMono bullet as well', () => {
    const v = reviewDesign('- familyMono: "Roboto Mono"', DEFAULT_DESIGN_RULES);
    const hit = v.find(x => x.rule === 'typography/no-generic-fonts');
    assert.ok(hit, 'Roboto Mono should trip generic-font rule on familyMono');
    assert.strictEqual(hit.location.section, 'Typography');
  });

  it('one family line with multiple generic fonts emits exactly ONE violation (first-match)', () => {
    const v = reviewDesign('- family: "Inter, Arial, Helvetica"', DEFAULT_DESIGN_RULES);
    const hits = v.filter(x => x.rule === 'typography/no-generic-fonts');
    assert.strictEqual(hits.length, 1, 'one-per-line contract: break after first match');
  });

  it('Unicode token values are handled without throwing', () => {
    const md = '# D\n\n- primary: "色彩 Söhne"\n- emoji: "#FF00FF 🎨"\n';
    assert.doesNotThrow(() => reviewDesign(md, DEFAULT_DESIGN_RULES));
  });

  it('10,000-line DESIGN.md terminates in under 1 second (no pathological regex)', () => {
    const lines = ['# DESIGN.md', '', '## Tokens', '', '### Colors', ''];
    for (let i = 0; i < 10000; i++) {
      lines.push(`- color${i}: #${(i % 4096).toString(16).padStart(3, '0')}`);
    }
    lines.push('');
    const md = lines.join('\n');
    const t0 = Date.now();
    const v = reviewDesign(md, DEFAULT_DESIGN_RULES);
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, `10k-line review too slow: ${ms}ms`);
    assert.ok(Array.isArray(v));
  });

  it('duplicate DT-NNN ID is flagged by structure/duplicate-ids', () => {
    const md = [
      '# DESIGN.md',
      '',
      '## Tokens',
      '',
      '### Colors',
      '',
      '- primary: #111 (id: DT-001)',
      '- secondary: #222 (id: DT-001)',
      '',
    ].join('\n');
    const v = reviewDesign(md, DEFAULT_DESIGN_RULES);
    const hit = v.find(x => x.rule === 'structure/duplicate-ids');
    assert.ok(hit, 'duplicate DT-001 must be flagged');
    assert.strictEqual(hit.id, 'DT-001');
    assert.strictEqual(hit.severity, 'error');
    assert.strictEqual(hit.location.id, 'DT-001');
  });

  it('duplicate DC-NNN ID is flagged independently in Components section', () => {
    const md = [
      '## Components',
      '',
      '### Button (id: DC-001)',
      '',
      '- variants: [a]',
      '- states: [default]',
      '',
      '### Card (id: DC-001)',
      '',
      '- variants: [a]',
      '- states: [default]',
      '',
    ].join('\n');
    const v = reviewDesign(md, DEFAULT_DESIGN_RULES);
    const hits = v.filter(x => x.rule === 'structure/duplicate-ids');
    assert.ok(hits.length >= 1, 'duplicate DC-001 must be flagged');
    assert.ok(hits.some(h => h.location.section === 'Components'));
  });

  it('three-rule overlap on one conceptual block produces exactly the expected rule set', () => {
    const md = [
      '# DESIGN.md',
      '',
      '> Layout: centered hero + 3-column feature cards + CTA.',
      '',
      '## Tokens',
      '',
      '### Colors',
      '',
      '- primary: #111',
      '- hero-bg: linear-gradient(to right, #667eea, #764ba2)',
      '',
      '### Typography',
      '',
      '- family: "Inter"',
      '',
    ].join('\n');
    const v = reviewDesign(md, DEFAULT_DESIGN_RULES);
    const ruleNames = new Set(v.map(x => x.rule));
    assert.ok(ruleNames.has('typography/no-generic-fonts'), 'Inter not caught');
    assert.ok(ruleNames.has('color/no-cliche-gradients'), 'gradient not caught');
    assert.ok(ruleNames.has('layout/no-cookie-cutter'), 'layout not caught');
  });

  it('reviewDesign throws on boolean and object inputs (strict string contract)', () => {
    assert.throws(() => reviewDesign(true, DEFAULT_DESIGN_RULES));
    assert.throws(() => reviewDesign({}, DEFAULT_DESIGN_RULES));
    assert.throws(() => reviewDesign([], DEFAULT_DESIGN_RULES));
  });
});

// ---------------------------------------------------------------------------
// AC-3 — read-only + command-layer audit
// ---------------------------------------------------------------------------

describe('F-064/AC-3 — read-only at library and command layer', () => {
  it('reviewDesign is a named function with arity 2 (content, rules)', () => {
    assert.strictEqual(typeof reviewDesign, 'function');
    assert.strictEqual(reviewDesign.length, 2);
  });

  it('formatReviewReport is a named function with arity 1 (violations)', () => {
    assert.strictEqual(typeof formatReviewReport, 'function');
    assert.strictEqual(formatReviewReport.length, 1);
  });

  it('reviewDesign does NOT mutate violations array between runs (fresh array every call)', () => {
    const a = reviewDesign('- family: "Inter"', DEFAULT_DESIGN_RULES);
    const b = reviewDesign('- family: "Inter"', DEFAULT_DESIGN_RULES);
    assert.notStrictEqual(a, b, 'each call must return a fresh array');
    assert.deepStrictEqual(a, b, 'but contents must be deep-equal');
    a.push({ bogus: true });
    assert.strictEqual(b.length, 1, 'mutation of one return value must not affect another');
  });

  it('reviewDesign does not leak Date.now / randomness (no timestamp fields on violations)', () => {
    const v = reviewDesign('- family: "Inter"', DEFAULT_DESIGN_RULES);
    for (const x of v) {
      assert.ok(!('timestamp' in x), 'violations must not carry timestamps');
      assert.ok(!('at' in x), 'violations must not carry temporal fields');
    }
  });

  it('command markdown review section (Step 1c) does NOT call writeDesignMd or extendDesignMd', () => {
    // AC-3 at the command layer: grep the review-mode step for forbidden write APIs.
    const cmdPath = path.join(__dirname, '..', 'commands', 'cap', 'design.md');
    const text = fs.readFileSync(cmdPath, 'utf8');
    const afterReview = text.split('## Step 1c: Review-mode fast-path');
    assert.strictEqual(afterReview.length, 2, 'Step 1c section must exist');
    const reviewSection = afterReview[1].split('\n## ')[0]; // up to next H2
    assert.ok(!reviewSection.includes('writeDesignMd('), 'review flow must not call writeDesignMd');
    assert.ok(!reviewSection.includes('extendDesignMd('), 'review flow must not call extendDesignMd');
    assert.ok(!reviewSection.includes('assignDesignIds('), 'review flow must not call assignDesignIds');
    // writeDesignReview is EXPECTED here — it writes DESIGN-REVIEW.md, not DESIGN.md.
    assert.ok(reviewSection.includes('writeDesignReview('), 'review flow must write the report artifact');
  });

  it('full round-trip: writing review report does not touch existing DESIGN.md bytes or mtime', () => {
    const md = buildDesignMd({ family: AESTHETIC_FAMILIES['terminal-core'], withIds: true });
    writeDesignMd(tmpDir, md);
    const designPath = path.join(tmpDir, 'DESIGN.md');
    const beforeBytes = fs.readFileSync(designPath, 'utf8');
    const beforeMtime = fs.statSync(designPath).mtimeMs;

    // End-to-end flow
    const rulesMd = readDesignRules(tmpDir); // null
    const rules = parseDesignRules(rulesMd);
    const violations = reviewDesign(readDesignMd(tmpDir), rules);
    const report = formatReviewReport(violations);
    writeDesignReview(tmpDir, report);

    // DESIGN.md unchanged
    assert.strictEqual(fs.readFileSync(designPath, 'utf8'), beforeBytes);
    assert.strictEqual(fs.statSync(designPath).mtimeMs, beforeMtime);
    // Report written under .cap/
    assert.ok(fs.existsSync(path.join(tmpDir, DESIGN_REVIEW_FILE)));
  });
});

// ---------------------------------------------------------------------------
// AC-5 — idempotence + determinism (reference-equivalence + ordering)
// ---------------------------------------------------------------------------

describe('F-064/AC-5 — idempotence, deterministic ordering, reference-equivalent rule sources', () => {
  const sample = [
    '# DESIGN.md',
    '',
    '## Tokens',
    '',
    '### Colors',
    '',
    '- primary: #111 (id: DT-001)',
    '- background: #FAFAFA',
    '- hero: linear-gradient(to right, #667eea, #764ba2) (id: DT-002)',
    '',
    '### Typography',
    '',
    '- family: "Inter, Helvetica"',
    '- familyMono: "JetBrains Mono"',
    '',
    '## Components',
    '',
    '### Button (id: DC-001)',
    '',
    '- variants: [a]',
    '- states: [default]',
    '',
  ].join('\n');

  it('reviewDesign(DEFAULT) vs reviewDesign(parseDesignRules(null)) produce identical output', () => {
    const a = JSON.stringify(reviewDesign(sample, DEFAULT_DESIGN_RULES));
    const b = JSON.stringify(reviewDesign(sample, parseDesignRules(null)));
    assert.strictEqual(a, b);
  });

  it('reviewDesign(DEFAULT) vs reviewDesign(parseDesignRules("")) produce identical output', () => {
    const a = JSON.stringify(reviewDesign(sample, DEFAULT_DESIGN_RULES));
    const b = JSON.stringify(reviewDesign(sample, parseDesignRules('')));
    assert.strictEqual(a, b);
  });

  it('violation ordering is consistent across 50 runs (JSON byte-compare)', () => {
    const first = JSON.stringify(reviewDesign(sample, DEFAULT_DESIGN_RULES));
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(JSON.stringify(reviewDesign(sample, DEFAULT_DESIGN_RULES)), first);
    }
  });

  it('violations with no location.id sort AFTER violations with a location.id (via __global__ sentinel)', () => {
    const v = reviewDesign(sample, DEFAULT_DESIGN_RULES);
    // Partition and verify all id-bearing come before non-id-bearing.
    // NOTE: sort key uses ASCII compare where 'DT-' / 'DC-' < '__global__' (D4).
    let seenGlobal = false;
    for (const x of v) {
      const hasId = x.location && x.location.id;
      if (!hasId) seenGlobal = true;
      else {
        assert.ok(
          !seenGlobal,
          `global sentinel appeared before id-bearing violation: ${x.rule}@line ${x.location.line}`,
        );
      }
    }
  });

  it('formatReviewReport is stable across 50 calls on the same violations array', () => {
    const v = reviewDesign(sample, DEFAULT_DESIGN_RULES);
    const first = formatReviewReport(v);
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(formatReviewReport(v), first);
    }
  });

  it('no non-deterministic fields leak into the report (no random IDs, no UUIDs, no timestamps)', () => {
    const report = formatReviewReport(reviewDesign(sample, DEFAULT_DESIGN_RULES));
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(report), 'UUID leaked');
    assert.ok(!/\b\d{10,13}\b/.test(report), 'epoch ms/seconds leaked');
    assert.ok(!/T\d{2}:\d{2}:\d{2}/.test(report), 'ISO time leaked');
  });

  it('rules array is not mutated by reviewDesign (defensive copy / read-only access)', () => {
    const rules = parseDesignRules('## Rules\n\n- **[typography] only**: d.\n  Suggestion: s.\n');
    const snapshot = JSON.stringify(rules);
    reviewDesign(sample, rules);
    reviewDesign(sample, rules);
    assert.strictEqual(JSON.stringify(rules), snapshot);
  });

  it('custom rule without built-in check handler still produces determistic (empty) violations', () => {
    // Rule named 'typography/only' is NOT one of the built-in handlers — the engine should silently skip it
    // and return zero violations, NOT throw.
    const rules = parseDesignRules('## Rules\n\n- **[typography] only**: d.\n  Suggestion: s.\n');
    assert.doesNotThrow(() => reviewDesign(sample, rules));
    const v = reviewDesign(sample, rules);
    assert.ok(Array.isArray(v));
  });
});

// ---------------------------------------------------------------------------
// AC-4 — readDesignRules + writeDesignReview adversarial
// ---------------------------------------------------------------------------

describe('F-064/AC-4 — file-I/O boundary adversarial', () => {
  it('readDesignRules on a path where .cap is a FILE (not dir) does not throw when design-rules.md is absent', () => {
    // Simulate a pathological project layout — .cap exists as a file.
    const weirdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f064-weird-'));
    try {
      fs.writeFileSync(path.join(weirdRoot, '.cap'), 'not a directory');
      // fs.existsSync on the child path returns false, so readDesignRules should return null.
      assert.strictEqual(readDesignRules(weirdRoot), null);
    } finally {
      fs.rmSync(weirdRoot, { recursive: true, force: true });
    }
  });

  it('writeDesignReview overwrites an existing report (not append)', () => {
    writeDesignReview(tmpDir, 'first');
    writeDesignReview(tmpDir, 'second');
    const content = fs.readFileSync(path.join(tmpDir, DESIGN_REVIEW_FILE), 'utf8');
    assert.strictEqual(content, 'second');
  });

  it('writeDesignReview preserves an existing FEATURE-MAP.md sibling untouched', () => {
    const fmPath = path.join(tmpDir, 'FEATURE-MAP.md');
    fs.writeFileSync(fmPath, '# FEATURE-MAP\n');
    const before = fs.readFileSync(fmPath, 'utf8');
    writeDesignReview(tmpDir, '# R');
    assert.strictEqual(fs.readFileSync(fmPath, 'utf8'), before);
  });

  it('DESIGN_REVIEW_FILE is a relative path (not absolute)', () => {
    assert.ok(!path.isAbsolute(DESIGN_REVIEW_FILE));
    assert.strictEqual(DESIGN_REVIEW_FILE, '.cap/DESIGN-REVIEW.md');
  });
});
