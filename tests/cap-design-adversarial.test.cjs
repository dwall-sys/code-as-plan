'use strict';

// @cap-feature(feature:F-062) cap:design Core — adversarial tests (harden baseline)
// @cap-context Adversarial suite complementing tests/cap-design.test.cjs. Probes mutation
// resistance, malformed input, filesystem edge cases, and string-match regression against
// agents/cap-designer.md + commands/cap/design.md (F-060 pattern).

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  DESIGN_FILE,
  AESTHETIC_FAMILIES,
  ANTI_SLOP_RULES,
  FAMILY_MAP,
  VALID_READ_HEAVY,
  VALID_USER_TYPES,
  VALID_COURAGE,
  mapAnswersToFamily,
  buildDesignMd,
  readDesignMd,
  writeDesignMd,
  extendDesignMd,
} = require('../cap/bin/lib/cap-design.cjs');

const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// AC-2 / AC-7 — mutation resistance and invalid-input handling for wizard map
// ---------------------------------------------------------------------------

describe('F-062 adversarial — mapAnswersToFamily', () => {
  // @cap-todo(ac:F-062/AC-2) mutation canary: every one of the 9 families
  // MUST be reachable from at least one wizard answer combo. If a refactor
  // drops a family from FAMILY_MAP, this fires.
  it('FAMILY_MAP reaches all 9 aesthetic families (no orphaned family)', () => {
    const reached = new Set(Object.values(FAMILY_MAP));
    const declared = new Set(Object.keys(AESTHETIC_FAMILIES));
    assert.strictEqual(reached.size, 9, `expected 9 families reached, got ${reached.size}`);
    for (const key of declared) {
      assert.ok(
        reached.has(key),
        `family "${key}" is declared in AESTHETIC_FAMILIES but unreachable via the wizard`
      );
    }
  });

  // @cap-todo(ac:F-062/AC-7) Two branches (read-heavy vs scan-heavy) must pick
  // visually distinct families -- catches a copy-paste mapping bug where an
  // entire branch was duplicated.
  it('read-heavy and scan-heavy branches resolve to disjoint family sets', () => {
    const readFams = new Set();
    const scanFams = new Set();
    for (const t of VALID_USER_TYPES) {
      for (const c of VALID_COURAGE) {
        readFams.add(FAMILY_MAP[`read-heavy|${t}|${c}`]);
        scanFams.add(FAMILY_MAP[`scan-heavy|${t}|${c}`]);
      }
    }
    // They may share at most 0 families (current design separates them).
    const overlap = [...readFams].filter((f) => scanFams.has(f));
    assert.strictEqual(
      overlap.length,
      0,
      `read-heavy and scan-heavy branches must not overlap, overlap=${overlap.join(',')}`
    );
  });

  // @cap-todo(ac:F-062/AC-2) throw loudly on every known bad input shape
  it('throws on null, undefined, number, and whitespace-padded arguments', () => {
    assert.throws(() => mapAnswersToFamily(null, 'developer', 'bold'), /Invalid readHeavy/);
    assert.throws(() => mapAnswersToFamily(undefined, 'developer', 'bold'), /Invalid readHeavy/);
    assert.throws(() => mapAnswersToFamily(42, 'developer', 'bold'), /Invalid readHeavy/);
    assert.throws(() => mapAnswersToFamily('read-heavy', null, 'bold'), /Invalid userType/);
    assert.throws(() => mapAnswersToFamily('read-heavy', 'developer', null), /Invalid courageFactor/);
    // Case must be exact -- canonical lower-kebab.
    assert.throws(() => mapAnswersToFamily('READ-HEAVY', 'developer', 'bold'), /Invalid readHeavy/);
    assert.throws(() => mapAnswersToFamily(' read-heavy', 'developer', 'bold'), /Invalid readHeavy/);
    assert.throws(() => mapAnswersToFamily('read-heavy ', 'developer', 'bold'), /Invalid readHeavy/);
  });

  // @cap-todo(ac:F-062/AC-2) too-few arguments fails loudly (fail-loud vs. silent default)
  it('throws when called with fewer than 3 arguments', () => {
    assert.throws(() => mapAnswersToFamily());
    assert.throws(() => mapAnswersToFamily('read-heavy'));
    assert.throws(() => mapAnswersToFamily('read-heavy', 'developer'));
  });

  // @cap-todo(ac:F-062/AC-2) extra args are ignored (permissive on the end)
  it('ignores extra trailing arguments', () => {
    const a = mapAnswersToFamily('read-heavy', 'developer', 'balanced');
    const b = mapAnswersToFamily('read-heavy', 'developer', 'balanced', 'extra', 99);
    assert.strictEqual(a.key, b.key);
  });

  // @cap-todo(ac:F-062/AC-7) returned object identity is stable across calls
  it('returns identical (===) family reference across calls (no defensive clone drift)', () => {
    const a = mapAnswersToFamily('scan-heavy', 'professional', 'bold');
    const b = mapAnswersToFamily('scan-heavy', 'professional', 'bold');
    assert.strictEqual(a, b, 'same inputs must return the same frozen lookup object');
  });
});

// ---------------------------------------------------------------------------
// AC-7 — idempotence / determinism hardening for buildDesignMd
// ---------------------------------------------------------------------------

describe('F-062 adversarial — buildDesignMd determinism', () => {
  const fam = AESTHETIC_FAMILIES['editorial-minimalism'];

  // @cap-todo(ac:F-062/AC-7) output is independent of input object key
  // insertion order (defends against Object.keys ordering surprises).
  it('is stable across color-key insertion order permutations', () => {
    const reordered = {
      ...fam,
      colors: Object.fromEntries(Object.entries(fam.colors).reverse()),
    };
    assert.strictEqual(buildDesignMd({ family: fam }), buildDesignMd({ family: reordered }));
  });

  // @cap-todo(ac:F-062/AC-7) defensive-copy check -- mutating the table entry
  // after build must not leak into a re-run (tables are Object.frozen, so a
  // mutation should throw; this proves freeze is in effect).
  it('tables are deep-frozen so no external mutation can poison output', () => {
    assert.ok(Object.isFrozen(AESTHETIC_FAMILIES));
    assert.ok(Object.isFrozen(fam));
    assert.ok(Object.isFrozen(fam.colors));
    assert.ok(Object.isFrozen(fam.components));
    assert.ok(Object.isFrozen(fam.components.Button));
    assert.throws(() => {
      fam.colors.primary = '#EVIL';
    }, TypeError);
  });

  // @cap-todo(ac:F-062/AC-7) concurrent-ish invocation stays byte-identical
  it('byte-identical output across interleaved calls over all 9 families', () => {
    const baseline = new Map();
    for (const key of Object.keys(AESTHETIC_FAMILIES)) {
      baseline.set(key, buildDesignMd({ family: AESTHETIC_FAMILIES[key] }));
    }
    // 3 interleaved passes
    for (let i = 0; i < 3; i++) {
      for (const key of Object.keys(AESTHETIC_FAMILIES)) {
        const md = buildDesignMd({ family: AESTHETIC_FAMILIES[key] });
        assert.strictEqual(md, baseline.get(key), `family ${key} drifted on pass ${i}`);
      }
    }
  });

  // @cap-todo(ac:F-062/AC-7) no hidden non-determinism sources leak into output
  it('contains no Date/ISO/epoch/uuid-shaped strings', () => {
    const md = buildDesignMd({ family: fam });
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(md), 'ISO timestamp leaked');
    assert.ok(!/\b\d{13}\b/.test(md), 'ms-epoch leaked');
    assert.ok(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(md),
      'uuid leaked'
    );
  });

  // @cap-todo(ac:F-062/AC-3) every family renders the 4 required sections
  it('all 9 families produce output with the 4 required sections + Button + Card', () => {
    for (const [key, family] of Object.entries(AESTHETIC_FAMILIES)) {
      const md = buildDesignMd({ family });
      assert.ok(md.includes('## Aesthetic Family:'), `${key}: missing Aesthetic Family`);
      assert.ok(md.includes('## Tokens'), `${key}: missing Tokens`);
      assert.ok(md.includes('## Components'), `${key}: missing Components`);
      assert.ok(md.includes('## Anti-Patterns'), `${key}: missing Anti-Patterns`);
      assert.ok(md.includes('### Button'), `${key}: missing Button`);
      assert.ok(md.includes('### Card'), `${key}: missing Card`);
    }
  });

  // @cap-todo(ac:F-062/AC-7) ignores unknown extras on the input envelope
  it('ignores unknown "extras" keys on the input envelope', () => {
    const a = buildDesignMd({ family: fam });
    const b = buildDesignMd({ family: fam, extras: { foo: 'bar', nested: { x: 1 } } });
    assert.strictEqual(a, b, 'extras should not affect deterministic output in v1');
  });

  it('throws on null/undefined input envelope', () => {
    assert.throws(() => buildDesignMd(undefined), /requires \{ family \}/);
    assert.throws(() => buildDesignMd(null), /requires \{ family \}/);
    assert.throws(() => buildDesignMd({ family: null }), /requires \{ family \}/);
    assert.throws(() => buildDesignMd({ family: undefined }), /requires \{ family \}/);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — extendDesignMd append-only, malformed input resilience
// ---------------------------------------------------------------------------

describe('F-062 adversarial — extendDesignMd edge cases', () => {
  const fam = AESTHETIC_FAMILIES['editorial-minimalism'];

  it('treats null / undefined / array additions as no-ops', () => {
    const original = buildDesignMd({ family: fam });
    assert.strictEqual(extendDesignMd(original, null), original);
    assert.strictEqual(extendDesignMd(original, undefined), original);
    assert.strictEqual(extendDesignMd(original), original);
    // Array has no .colors/.components keys -> no-op.
    assert.strictEqual(extendDesignMd(original, ['garbage']), original);
  });

  it('throws when existing content is not a string', () => {
    assert.throws(() => extendDesignMd(42, { colors: {} }), /requires existing content string/);
    assert.throws(() => extendDesignMd(null, { colors: {} }), /requires existing content string/);
    assert.throws(
      () => extendDesignMd(undefined, { colors: {} }),
      /requires existing content string/
    );
    assert.throws(() => extendDesignMd({ not: 'a string' }, {}), /requires existing content string/);
  });

  // @cap-todo(ac:F-062/AC-5) append-only on DUPLICATE keys with different
  // values -- existing value wins, no duplicate line, no overwrite.
  it('refuses to overwrite an existing token even when a different value is supplied', () => {
    const original = buildDesignMd({ family: fam });
    const extended = extendDesignMd(original, {
      colors: {
        primary: '#DEAD00', // attacker tries to overwrite
        secondary: '#BEEF00',
        background: '#CAFE00',
      },
    });
    // Each existing key appears exactly once AND retains its original value.
    for (const key of ['primary', 'secondary', 'background']) {
      const occurrences = (extended.match(new RegExp(`^- ${key}:`, 'gm')) || []).length;
      assert.strictEqual(occurrences, 1, `${key} should appear exactly once, got ${occurrences}`);
      assert.ok(
        extended.includes(`- ${key}: ${fam.colors[key]}`),
        `${key}: original value lost`
      );
    }
    assert.ok(!extended.includes('#DEAD00'), 'attacker value leaked in');
  });

  // @cap-todo(ac:F-062/AC-5) component overwrites are refused similarly
  it('refuses to overwrite an existing component when a different shape is supplied', () => {
    const original = buildDesignMd({ family: fam });
    const extended = extendDesignMd(original, {
      components: {
        Button: { variants: ['EVIL'], states: ['HAX'] },
        Card: { variants: ['EVIL'], states: ['HAX'] },
      },
    });
    assert.ok(!extended.includes('EVIL'), 'attacker variant leaked into Button/Card');
    assert.ok(!extended.includes('HAX'), 'attacker state leaked into Button/Card');
    // Original variants still present.
    assert.ok(extended.includes('primary, secondary, ghost'));
    // Exactly one ### Button and one ### Card.
    assert.strictEqual((extended.match(/^### Button$/gm) || []).length, 1);
    assert.strictEqual((extended.match(/^### Card$/gm) || []).length, 1);
  });

  // @cap-todo(ac:F-062/AC-5) running extend twice with same additions produces
  // identical output -- confirms append-only semantics are idempotent.
  it('is idempotent when the same additions are applied twice', () => {
    const original = buildDesignMd({ family: fam });
    const once = extendDesignMd(original, {
      colors: { brand: '#FF5E5B' },
      components: { Modal: { variants: ['dialog'], states: ['open', 'closed'] } },
    });
    const twice = extendDesignMd(once, {
      colors: { brand: '#FF5E5B' },
      components: { Modal: { variants: ['dialog'], states: ['open', 'closed'] } },
    });
    assert.strictEqual(once, twice, 'second extend with same additions must be a no-op');
  });

  it('appends a component gracefully even when variants/states are missing', () => {
    const original = buildDesignMd({ family: fam });
    const extended = extendDesignMd(original, {
      components: { Toast: {} }, // no variants, no states
    });
    assert.ok(extended.includes('### Toast'));
    assert.ok(extended.includes('- variants: []'));
    assert.ok(extended.includes('- states: []'));
  });

  it('preserves unicode in token values round-trip', () => {
    const original = buildDesignMd({ family: fam });
    const extended = extendDesignMd(original, {
      colors: { 'accent-warm': 'café-☃-€' },
    });
    assert.ok(extended.includes('- accent-warm: café-☃-€'));
  });

  // @cap-risk Multi-line token values can inject markdown headers and corrupt
  // section boundaries (the line-scan merge is structural, not semantic).
  // In v1, callers are trusted (cap-designer agent validates hex+list inputs),
  // so this is documented but not blocked. If an untrusted input path is ever
  // added, extendDesignMd MUST reject multi-line values. See @cap-decision
  // "Line-scan merge instead of markdown parsing" in cap-design.cjs.
  it('documents: multi-line values are NOT escaped (v1 trust boundary)', () => {
    const original = buildDesignMd({ family: fam });
    const evil = '#AAA\n### Spacing\n- scale: [999]';
    const extended = extendDesignMd(original, { colors: { hostile: evil } });
    // Snapshot the current behavior so any future change is visible in review.
    // If this assertion ever flips, update it deliberately AND decide whether
    // the new behavior is "reject" or "escape".
    const spacingHeaders = (extended.match(/^### Spacing$/gm) || []).length;
    assert.strictEqual(
      spacingHeaders,
      2,
      'current v1 behavior: multi-line values inject structural markdown. ' +
        'If this assertion flips, extendDesignMd has been hardened -- good, ' +
        'update this test accordingly.'
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4 — writeDesignMd / readDesignMd filesystem edge cases
// ---------------------------------------------------------------------------

describe('F-062 adversarial — filesystem edge cases', () => {
  const withTmpDir = (fn) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-design-adv-'));
    try {
      fn(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  // @cap-todo(ac:F-062/AC-4) DESIGN.md shadow-as-directory fails loud
  it('fails loud (EISDIR) when DESIGN.md exists as a directory', () => {
    withTmpDir((tmp) => {
      fs.mkdirSync(path.join(tmp, DESIGN_FILE));
      assert.throws(() => readDesignMd(tmp), (err) => err.code === 'EISDIR');
      assert.throws(() => writeDesignMd(tmp, 'x'), (err) => err.code === 'EISDIR');
    });
  });

  // @cap-todo(ac:F-062/AC-4) missing projectRoot fails loud
  it('fails loud (ENOENT) when projectRoot does not exist', () => {
    withTmpDir((tmp) => {
      const ghost = path.join(tmp, 'does-not-exist');
      assert.throws(() => writeDesignMd(ghost, 'x'), (err) => err.code === 'ENOENT');
      // readDesignMd uses fs.existsSync gate -- returns null on missing parent too.
      assert.strictEqual(readDesignMd(ghost), null);
    });
  });

  it('round-trips large content (1MB) without truncation', () => {
    withTmpDir((tmp) => {
      const big = 'a'.repeat(1024 * 1024);
      writeDesignMd(tmp, big);
      assert.strictEqual(readDesignMd(tmp), big);
    });
  });

  it('round-trips unicode content (BMP + emoji + combining marks)', () => {
    withTmpDir((tmp) => {
      const uni = 'café ☃ 🎨 👨‍👩‍👧 한글 عربي';
      writeDesignMd(tmp, uni);
      assert.strictEqual(readDesignMd(tmp), uni);
    });
  });

  // @cap-risk writeDesignMd is not atomic -- a crash mid-write can corrupt
  // DESIGN.md. v1 accepts this because DESIGN.md is git-tracked. If a future
  // version adds autosave or background writers, switch to write-temp+rename.
  it('documents: writeDesignMd is non-atomic (direct fs.writeFileSync)', () => {
    // Structural check: the implementation must call writeFileSync directly
    // (no temp file). If someone switches to atomic writes, update this test.
    const source = fs.readFileSync(
      path.join(repoRoot, 'cap', 'bin', 'lib', 'cap-design.cjs'),
      'utf8'
    );
    assert.ok(
      /fs\.writeFileSync\(\s*filePath/.test(source),
      'v1 writes directly -- if this changes, document why atomic writes were added'
    );
  });
});

// ---------------------------------------------------------------------------
// AC-1 / AC-6 — string-match regression against agent + command markdown
// (mirrors F-060 cap-terse-rules.test.cjs pattern)
// ---------------------------------------------------------------------------

describe('F-062 adversarial — agent + command markdown signatures', () => {
  const readRepoFile = (relPath) =>
    fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

  // --- commands/cap/design.md ---

  describe('commands/cap/design.md', () => {
    // @cap-todo(ac:F-062/AC-1) /cap:design command exposes --new and --extend
    // and delegates to cap-designer agent.
    it('advertises both --new and --extend flags', () => {
      const md = readRepoFile('commands/cap/design.md');
      assert.ok(md.includes('--new'), 'command must document --new');
      assert.ok(md.includes('--extend'), 'command must document --extend');
    });

    it('references the cap-designer agent (agent spawn target)', () => {
      const md = readRepoFile('commands/cap/design.md');
      assert.ok(md.includes('cap-designer'), 'command must spawn cap-designer');
    });

    it('references cap-design.cjs (the deterministic core lib)', () => {
      const md = readRepoFile('commands/cap/design.md');
      assert.ok(
        md.includes('cap-design.cjs'),
        'command must call the deterministic core lib (not invent tokens in-prompt)'
      );
    });

    it('declares Task in allowed-tools so the agent can actually be spawned', () => {
      const md = readRepoFile('commands/cap/design.md');
      // Frontmatter uses YAML list form.
      assert.ok(/allowed-tools:[\s\S]*?-\s+Task/.test(md), 'Task must be in allowed-tools');
    });
  });

  // --- agents/cap-designer.md ---

  describe('agents/cap-designer.md', () => {
    // @cap-todo(ac:F-062/AC-2) all 9 family keys present in the agent prompt
    it('mentions all 9 aesthetic family keys verbatim', () => {
      const md = readRepoFile('agents/cap-designer.md');
      for (const key of Object.keys(AESTHETIC_FAMILIES)) {
        assert.ok(
          md.includes(key),
          `family key "${key}" missing from agent prompt -- agent cannot reference it`
        );
      }
    });

    // @cap-todo(ac:F-062/AC-2) every family's reference brands appear in the
    // agent prompt -- this is the anchor that keeps the prompt aligned with
    // the code lookup. Display names are intentionally NOT matched here: the
    // agent returns keys only; display names are a code-side concern rendered
    // by the /cap:design command preview.
    it('at least one reference brand per family appears in the agent prompt', () => {
      const md = readRepoFile('agents/cap-designer.md');
      for (const [key, fam] of Object.entries(AESTHETIC_FAMILIES)) {
        const anchored = fam.referenceBrands.some((brand) => md.includes(brand));
        assert.ok(
          anchored,
          `family "${key}": none of its reference brands (${fam.referenceBrands.join(
            ', '
          )}) appear in the agent prompt -- the prompt may have drifted from the code lookup`
        );
      }
    });

    // @cap-todo(ac:F-062/AC-2) the 3-question wizard has not silently lost a question
    it('contains all three wizard-answer axis keywords', () => {
      const md = readRepoFile('agents/cap-designer.md');
      // Q1: read-heavy vs scan-heavy
      assert.ok(md.includes('read-heavy'), 'Q1 axis "read-heavy" missing');
      assert.ok(md.includes('scan-heavy'), 'Q1 axis "scan-heavy" missing');
      // Q2: user type enum
      for (const t of VALID_USER_TYPES) {
        assert.ok(md.includes(t), `Q2 option "${t}" missing`);
      }
      // Q3: courage factor enum
      for (const c of VALID_COURAGE) {
        assert.ok(md.includes(c), `Q3 option "${c}" missing`);
      }
    });

    // @cap-todo(ac:F-062/AC-6) Anti-Slop constraint block present in agent prompt
    it('contains the Anti-Slop constraint block (AC-6)', () => {
      const md = readRepoFile('agents/cap-designer.md');
      assert.ok(
        /anti[_\- ]?slop/i.test(md),
        'anti-slop block title/tag missing -- enforcement vanished'
      );
      // Topic coverage (fonts / gradients / layouts) must be present verbatim.
      assert.ok(/Inter, Roboto, Arial, Helvetica, SF Pro/i.test(md), 'forbidden fonts list missing');
      assert.ok(md.includes('#667eea'), 'forbidden gradient example missing');
      assert.ok(
        /centered hero.+3-column feature cards.+CTA/i.test(md),
        'forbidden cookie-cutter layout description missing'
      );
    });

    // @cap-todo(ac:F-062/AC-1) agent explicitly documents spawn-from /cap:design
    it('documents that it is spawned by /cap:design', () => {
      const md = readRepoFile('agents/cap-designer.md');
      assert.ok(
        /\/cap:design/.test(md),
        'agent description must reference /cap:design as spawn point'
      );
    });

    // @cap-todo(ac:F-062/AC-6) agent must NOT write files -- command owns I/O
    it('declares the "agent writes no files" contract', () => {
      const md = readRepoFile('agents/cap-designer.md');
      assert.ok(
        /NO files|no files|not write/i.test(md),
        'agent prompt must state it does not write files (command layer owns I/O)'
      );
    });

    // @cap-todo(ac:F-062/AC-6) delimited output block survives refactors
    it('documents the exact === DESIGN OUTPUT === parser contract', () => {
      const md = readRepoFile('agents/cap-designer.md');
      assert.ok(md.includes('=== DESIGN OUTPUT ==='), 'opening delimiter missing');
      assert.ok(md.includes('=== END DESIGN OUTPUT ==='), 'closing delimiter missing');
      // Required keys -- if any of these drift, the command parser breaks.
      for (const key of ['MODE:', 'READ_HEAVY:', 'USER_TYPE:', 'COURAGE_FACTOR:']) {
        assert.ok(md.includes(key), `parser key "${key}" missing from contract`);
      }
    });
  });

  // --- cross-artifact consistency for AC-6 ---

  describe('AC-6 cross-artifact: ANTI_SLOP_RULES alignment', () => {
    // @cap-todo(ac:F-062/AC-6) each anti-slop RULE has an identifiable
    // counterpart in the agent prompt. We use keyword anchors rather than
    // verbatim match because the agent prompt uses a different phrasing
    // (imperative "shall NOT be proposed") than the code constant (descriptive
    // "are forbidden"). This is intentional.
    it('every ANTI_SLOP_RULES category has an anchor in cap-designer.md', () => {
      const agent = readRepoFile('agents/cap-designer.md').toLowerCase();
      // Category anchors -- one per rule.
      const anchors = [
        'inter', // font rule
        '#667eea', // gradient rule (hex is the most specific anchor)
        'centered hero', // layout rule
      ];
      assert.strictEqual(
        anchors.length,
        ANTI_SLOP_RULES.length,
        'anti-slop rule count drifted -- add/remove anchors to match'
      );
      for (const anchor of anchors) {
        assert.ok(
          agent.includes(anchor),
          `anti-slop anchor "${anchor}" missing from cap-designer.md`
        );
      }
    });
  });
});
