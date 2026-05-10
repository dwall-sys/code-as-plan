'use strict';

// @cap-feature(feature:F-060) Terse Agent Prompts — adversarial hardening
// @cap-todo(ac:F-060/AC-3) Adversarial tests that harden the existing
// string-match regression suite in cap-terse-rules.test.cjs. These cover
// edge cases the smoke suite leaves implicit: YAML frontmatter integrity
// after rule insertion, anchor non-duplication, deviation-decision
// presence for non-testable ACs, the exact hypothesis-format signature
// in cap-debugger, and order-independence of the universal rule set.
//
// @cap-decision Deviated from F-060/AC-4: post-rollout sample review is a
// process AC, satisfied outside code — no automation attempted.
// @cap-decision Deviated from F-060/AC-5: F-044 non-contradiction check is a
// code-review activity, satisfied in review — no automation attempted.
// @cap-decision(learned:cap-pro-4) The OUT_OF_SCOPE assertion (originally
// cap-tester.md) was retired when cap-tester and cap-reviewer were merged
// into cap-validator. Every remaining hotspot agent now carries F-060
// terseness rules, so there is no clean negative case to assert.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  IN_SCOPE_FILES,
  UNIVERSAL_RULE_SIGNATURES,
} = require('./fixtures/f060-signatures.cjs');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');

function readAgent(file) {
  return fs.readFileSync(path.join(agentsDir, file), 'utf8');
}

// Extract the YAML frontmatter block between the first two "---" fences.
// Zero-dep: minimal line-based parser, sufficient for the flat k:v structure
// used by Claude Code agent files.
function extractFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return null;
  }
  const endIdx = lines.indexOf('---', 1);
  if (endIdx === -1) {
    return null;
  }
  const body = lines.slice(1, endIdx);
  const kv = {};
  for (const line of body) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      kv[match[1]] = match[2].trim();
    }
  }
  return { raw: body.join('\n'), keys: kv, endLine: endIdx };
}

describe('F-060/AC-3 — adversarial hardening of terseness regression', () => {
  describe('YAML frontmatter integrity after rule insertion', () => {
    for (const file of IN_SCOPE_FILES) {
      it(`${file} has intact YAML frontmatter with name, description, tools`, () => {
        const content = readAgent(file);
        const fm = extractFrontmatter(content);
        assert.ok(
          fm !== null,
          `${file} frontmatter is missing or malformed. The rule-insert must ` +
            `happen AFTER the closing "---" fence — inserting inside the ` +
            `frontmatter breaks Claude Code agent loading.`
        );
        const expectedName = file.replace(/\.md$/, '');
        assert.strictEqual(
          fm.keys.name,
          expectedName,
          `${file} frontmatter 'name' key must equal '${expectedName}', ` +
            `got '${fm.keys.name}'. A rule insert likely clobbered the key.`
        );
        assert.ok(
          typeof fm.keys.description === 'string' && fm.keys.description.length > 0,
          `${file} frontmatter 'description' is missing or empty.`
        );
        assert.ok(
          typeof fm.keys.tools === 'string' && fm.keys.tools.length > 0,
          `${file} frontmatter 'tools' is missing or empty.`
        );
      });

      it(`${file} terseness rule block appears AFTER frontmatter`, () => {
        const content = readAgent(file);
        const fm = extractFrontmatter(content);
        assert.ok(fm !== null, `${file} frontmatter missing`);
        const frontmatterEnd = content.split(/\r?\n/).slice(0, fm.endLine + 1).join('\n').length;
        const ruleIdx = content.indexOf('@cap-feature(feature:F-060)');
        assert.ok(
          ruleIdx > frontmatterEnd,
          `${file} has @cap-feature(feature:F-060) at offset ${ruleIdx} but ` +
            `frontmatter ends at ${frontmatterEnd}. Rule anchor must live ` +
            `outside the YAML block or Claude Code will reject the agent.`
        );
      });
    }
  });

  // @cap-decision(learned:cap-pro-4) Removed `scope exclusion` describe block
  // — cap-tester.md no longer exists, and every remaining hotspot agent now
  // carries F-060 terseness rules. The negative-case assertion is retired.

  describe('anchor uniqueness — F-060 feature tag appears exactly once per in-scope file', () => {
    for (const file of IN_SCOPE_FILES) {
      it(`${file} contains @cap-feature(feature:F-060) exactly once`, () => {
        const content = readAgent(file);
        const matches = content.match(/@cap-feature\(feature:F-060\)/g) || [];
        assert.strictEqual(
          matches.length,
          1,
          `${file} has ${matches.length} @cap-feature(feature:F-060) anchors ` +
            `but exactly 1 is required. Duplicates break Feature Map ` +
            `enrichment — the scanner will report a file twice.`
        );
      });
    }
  });

  describe('deviation decisions for non-testable ACs (AC-4, AC-5) are explicit', () => {
    const searchTargets = [
      path.join(repoRoot, 'tests', 'cap-terse-rules.test.cjs'),
      path.join(repoRoot, 'tests', 'cap-terse-rules-adversarial.test.cjs'),
      ...IN_SCOPE_FILES.map((f) => path.join(agentsDir, f)),
    ];

    it('at least one project file declares @cap-decision for F-060/AC-4', () => {
      const hits = searchTargets.filter((p) => {
        if (!fs.existsSync(p)) return false;
        return fs.readFileSync(p, 'utf8').includes('Deviated from F-060/AC-4');
      });
      assert.ok(
        hits.length > 0,
        'No file declares an @cap-decision deviation for F-060/AC-4. ' +
          'Non-testable ACs must be marked as deviations, not silently skipped.'
      );
    });

    it('at least one project file declares @cap-decision for F-060/AC-5', () => {
      const hits = searchTargets.filter((p) => {
        if (!fs.existsSync(p)) return false;
        return fs.readFileSync(p, 'utf8').includes('Deviated from F-060/AC-5');
      });
      assert.ok(
        hits.length > 0,
        'No file declares an @cap-decision deviation for F-060/AC-5. ' +
          'Non-testable ACs must be marked as deviations, not silently skipped.'
      );
    });
  });

  describe('cap-debugger hypothesis format signature is syntactically exact', () => {
    it('cap-debugger.md contains the literal H1 format token with status enum', () => {
      const content = readAgent('cap-debugger.md');
      // Accept either curly-brace `{text}` or angle-bracket `<text>` placeholder
      // variants. The status enum must list all three states to be valid.
      const curly = /- H1: \{text\} \[untested\|tested\|disproven\]/;
      const angle = /- H1: <text> \[untested\|tested\|disproven\]/;
      assert.ok(
        curly.test(content) || angle.test(content),
        'cap-debugger.md is missing the exact hypothesis format signature. ' +
          'Expected either "- H1: {text} [untested|tested|disproven]" or ' +
          '"- H1: <text> [untested|tested|disproven]". This is the ' +
          'syntactically load-bearing part of AC-2 — a paraphrase silently ' +
          'weakens the rule.'
      );
    });

    it('cap-debugger.md status enum preserves all three states in order', () => {
      const content = readAgent('cap-debugger.md');
      const idx = content.indexOf('[untested|tested|disproven]');
      assert.notStrictEqual(
        idx,
        -1,
        'cap-debugger.md status enum "[untested|tested|disproven]" missing or ' +
          'reordered. Order-change is a semantic change: the enum doubles as ' +
          'the state-transition sequence.'
      );
    });
  });

  describe('universal rules are order-independent across files', () => {
    // If the smoke suite accidentally depended on rule ordering it would pass
    // here and break when someone reorders the block. This test verifies each
    // rule is independently locatable via its distinctive fragment, with no
    // assumption about relative position.
    for (const file of IN_SCOPE_FILES) {
      it(`${file} rules are located individually without ordering assumptions`, () => {
        const content = readAgent(file);
        const offsets = UNIVERSAL_RULE_SIGNATURES.map((sig) => content.indexOf(sig));
        for (let i = 0; i < offsets.length; i++) {
          assert.notStrictEqual(
            offsets[i],
            -1,
            `${file} missing universal rule "${UNIVERSAL_RULE_SIGNATURES[i]}". ` +
              `Order-independent locator failed.`
          );
        }
        const unique = new Set(offsets);
        assert.strictEqual(
          unique.size,
          offsets.length,
          `${file} has duplicate universal rule offsets ${JSON.stringify(offsets)}. ` +
            `Two fragments resolved to the same location — one rule is missing ` +
            `and another matched its fragment spuriously.`
        );
      });
    }
  });
});
