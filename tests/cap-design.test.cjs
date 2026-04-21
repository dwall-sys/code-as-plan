'use strict';

// @cap-feature(feature:F-062) cap:design Core — RED tests for DESIGN.md + Aesthetic Picker

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  DESIGN_FILE,
  AESTHETIC_FAMILIES,
  ANTI_SLOP_RULES,
  FAMILY_MAP,
  mapAnswersToFamily,
  buildDesignMd,
  readDesignMd,
  writeDesignMd,
  extendDesignMd,
} = require('../cap/bin/lib/cap-design.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-design-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- AC-2: 9 families + 3-question wizard mapping ---

describe('AESTHETIC_FAMILIES lookup', () => {
  // @cap-todo(ac:F-062/AC-2) exactly 9 aesthetic families
  it('contains exactly 9 families', () => {
    assert.strictEqual(Object.keys(AESTHETIC_FAMILIES).length, 9);
  });

  it('every family has colors, spacing, typography, Button, Card', () => {
    for (const fam of Object.values(AESTHETIC_FAMILIES)) {
      assert.ok(fam.colors, `missing colors for ${fam.key}`);
      assert.ok(Array.isArray(fam.spacing), `missing spacing for ${fam.key}`);
      assert.ok(fam.typography, `missing typography for ${fam.key}`);
      assert.ok(fam.components.Button, `missing Button for ${fam.key}`);
      assert.ok(fam.components.Card, `missing Card for ${fam.key}`);
    }
  });
});

describe('mapAnswersToFamily', () => {
  // @cap-todo(ac:F-062/AC-2) wizard mapping exists for every answer combination
  it('maps every valid answer triplet to a known family', () => {
    const reads = ['read-heavy', 'scan-heavy'];
    const types = ['consumer', 'professional', 'developer'];
    const courage = ['safe', 'balanced', 'bold'];
    for (const r of reads) {
      for (const t of types) {
        for (const c of courage) {
          const fam = mapAnswersToFamily(r, t, c);
          assert.ok(fam, `no mapping for ${r}|${t}|${c}`);
          assert.ok(AESTHETIC_FAMILIES[fam.key], `unknown family key ${fam.key}`);
        }
      }
    }
  });

  // @cap-todo(ac:F-062/AC-7) deterministic: same input -> same output, 100x
  it('is deterministic across 100 repeated calls', () => {
    const first = mapAnswersToFamily('read-heavy', 'developer', 'balanced');
    for (let i = 0; i < 100; i++) {
      const next = mapAnswersToFamily('read-heavy', 'developer', 'balanced');
      assert.strictEqual(next.key, first.key);
    }
  });

  it('throws on invalid input', () => {
    assert.throws(() => mapAnswersToFamily('invalid', 'developer', 'bold'));
    assert.throws(() => mapAnswersToFamily('read-heavy', 'alien', 'bold'));
    assert.throws(() => mapAnswersToFamily('read-heavy', 'developer', 'spicy'));
  });
});

// --- AC-3: buildDesignMd output structure ---

describe('buildDesignMd', () => {
  const family = AESTHETIC_FAMILIES['editorial-minimalism'];

  // @cap-todo(ac:F-062/AC-3) required sections present
  it('contains all 4 required sections', () => {
    const md = buildDesignMd({ family });
    assert.ok(md.includes('## Aesthetic Family:'), 'missing Aesthetic Family');
    assert.ok(md.includes('## Tokens'), 'missing Tokens');
    assert.ok(md.includes('## Components'), 'missing Components');
    assert.ok(md.includes('## Anti-Patterns'), 'missing Anti-Patterns');
  });

  it('includes Button and Card components (AC-3 minimum)', () => {
    const md = buildDesignMd({ family });
    assert.ok(md.includes('### Button'));
    assert.ok(md.includes('### Card'));
  });

  it('includes Colors, Spacing, Typography subsections', () => {
    const md = buildDesignMd({ family });
    assert.ok(md.includes('### Colors'));
    assert.ok(md.includes('### Spacing'));
    assert.ok(md.includes('### Typography'));
  });

  // @cap-todo(ac:F-062/AC-6) Anti-Slop rules appear in the output
  it('renders all Anti-Slop rules in the output', () => {
    const md = buildDesignMd({ family });
    for (const rule of ANTI_SLOP_RULES) {
      assert.ok(md.includes(rule), `missing anti-slop rule: ${rule.slice(0, 40)}...`);
    }
  });

  // @cap-todo(ac:F-062/AC-7) idempotent: byte-identical on 100 calls
  it('is byte-identical across 100 calls with same input', () => {
    const first = buildDesignMd({ family });
    for (let i = 0; i < 100; i++) {
      const next = buildDesignMd({ family });
      assert.strictEqual(next, first);
    }
  });

  // @cap-todo(ac:F-062/AC-7) no timestamps, no randomness leak
  it('contains no timestamps (ISO dates)', () => {
    const md = buildDesignMd({ family });
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(md), 'timestamp leaked into DESIGN.md');
  });

  it('throws without family input', () => {
    assert.throws(() => buildDesignMd({}));
    assert.throws(() => buildDesignMd(null));
  });
});

// --- AC-4: DESIGN.md lives at project root ---

describe('readDesignMd / writeDesignMd', () => {
  // @cap-todo(ac:F-062/AC-4) file location is projectRoot/DESIGN.md
  it('writes DESIGN.md to project root and reads it back identically', () => {
    const md = buildDesignMd({ family: AESTHETIC_FAMILIES['terminal-core'] });
    writeDesignMd(tmpDir, md);
    const onDisk = fs.readFileSync(path.join(tmpDir, DESIGN_FILE), 'utf8');
    assert.strictEqual(onDisk, md);
    assert.strictEqual(readDesignMd(tmpDir), md);
  });

  it('readDesignMd returns null when DESIGN.md does not exist', () => {
    assert.strictEqual(readDesignMd(tmpDir), null);
  });

  it('DESIGN_FILE constant is the expected file name', () => {
    assert.strictEqual(DESIGN_FILE, 'DESIGN.md');
  });
});

// --- AC-5: extendDesignMd is append-only ---

describe('extendDesignMd', () => {
  // @cap-todo(ac:F-062/AC-5) does NOT overwrite existing tokens/components
  it('preserves existing color entries when a new color is added', () => {
    const original = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'] });
    const extended = extendDesignMd(original, { colors: { brand: '#FF00FF' } });

    // Every original color line must still appear in the output.
    const fam = AESTHETIC_FAMILIES['editorial-minimalism'];
    for (const [k, v] of Object.entries(fam.colors)) {
      assert.ok(extended.includes(`- ${k}: ${v}`), `lost existing color ${k}`);
    }
    // New color appended.
    assert.ok(extended.includes('- brand: #FF00FF'));
  });

  it('does not duplicate a color that already exists', () => {
    const original = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'] });
    const fam = AESTHETIC_FAMILIES['editorial-minimalism'];
    // Re-add `primary` with a different value -- must NOT replace or duplicate.
    const extended = extendDesignMd(original, { colors: { primary: '#DEAD00' } });
    const occurrences = (extended.match(/^- primary:/gm) || []).length;
    assert.strictEqual(occurrences, 1, 'primary should appear exactly once');
    // Original value preserved.
    assert.ok(extended.includes(`- primary: ${fam.colors.primary}`));
    assert.ok(!extended.includes('- primary: #DEAD00'));
  });

  it('preserves existing components when a new component is added', () => {
    const original = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'] });
    const extended = extendDesignMd(original, {
      components: {
        Modal: { variants: ['dialog', 'drawer'], states: ['open', 'closed'] },
      },
    });
    assert.ok(extended.includes('### Button'), 'lost Button');
    assert.ok(extended.includes('### Card'), 'lost Card');
    assert.ok(extended.includes('### Modal'), 'missing new Modal');
    assert.ok(extended.includes('- variants: [dialog, drawer]'));
  });

  it('is a no-op when additions is empty', () => {
    const original = buildDesignMd({ family: AESTHETIC_FAMILIES['editorial-minimalism'] });
    const extended = extendDesignMd(original, {});
    assert.strictEqual(extended, original);
  });
});

// --- AC-6: Anti-Slop rules exposed as a reusable export ---

describe('ANTI_SLOP_RULES export', () => {
  // @cap-todo(ac:F-062/AC-6) Anti-Slop rules available as a constant for agent prompt reuse
  it('ANTI_SLOP_RULES is a non-empty frozen array', () => {
    assert.ok(Array.isArray(ANTI_SLOP_RULES));
    assert.ok(ANTI_SLOP_RULES.length >= 3);
    assert.ok(Object.isFrozen(ANTI_SLOP_RULES));
  });

  it('covers the three required anti-patterns', () => {
    const joined = ANTI_SLOP_RULES.join(' ').toLowerCase();
    assert.ok(joined.includes('font') || joined.includes('inter'));
    assert.ok(joined.includes('gradient'));
    assert.ok(joined.includes('layout') || joined.includes('template'));
  });
});

// --- FAMILY_MAP surface check ---

describe('FAMILY_MAP', () => {
  // @cap-todo(ac:F-062/AC-2) full 2*3*3 coverage for the wizard answer space
  it('has an entry for all 18 wizard answer combinations', () => {
    assert.strictEqual(Object.keys(FAMILY_MAP).length, 18);
  });

  it('every mapped value is a valid family key', () => {
    for (const familyKey of Object.values(FAMILY_MAP)) {
      assert.ok(AESTHETIC_FAMILIES[familyKey], `unknown family key ${familyKey}`);
    }
  });
});
