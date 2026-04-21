'use strict';

// @cap-feature(feature:F-060) Terse Agent Prompts — Caveman-Inspired
// @cap-todo(ac:F-060/AC-3) Regression test verifying universal + agent-specific
// terseness rules are present in each of the four target agent files. Failure
// of any signature match blocks CI and signals that a terseness rule has been
// silently removed or weakened.
//
// @cap-decision Deviated from F-060/AC-4: post-rollout sample review is a
// process AC, satisfied outside code — no automation attempted.
// @cap-decision Deviated from F-060/AC-5: F-044 non-contradiction check is a
// code-review activity, satisfied in review — no automation attempted.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  UNIVERSAL_RULE_SIGNATURES,
  AGENT_SPECIFIC_SIGNATURES,
} = require('./fixtures/f060-signatures.cjs');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'agents');

const TARGET_FILES = AGENT_SPECIFIC_SIGNATURES.map((entry) => entry.file);

function readAgent(file) {
  const full = path.join(agentsDir, file);
  return fs.readFileSync(full, 'utf8');
}

describe('F-060/AC-3 — terseness rules regression', () => {
  describe('universal rules present in every target agent file', () => {
    for (const file of TARGET_FILES) {
      for (const signature of UNIVERSAL_RULE_SIGNATURES) {
        it(`${file} contains universal rule signature: "${signature}"`, () => {
          const content = readAgent(file);
          assert.ok(
            content.includes(signature),
            `${file} is missing universal terseness rule signature: "${signature}". ` +
              `The F-060 rule block may have been removed or rewritten. ` +
              `Restore it or update the test signature list intentionally.`
          );
        });
      }
    }
  });

  describe('agent-specific rules present in their respective files', () => {
    for (const entry of AGENT_SPECIFIC_SIGNATURES) {
      it(`${entry.file} contains agent-specific rule: ${entry.label}`, () => {
        const content = readAgent(entry.file);
        assert.ok(
          content.includes(entry.signature),
          `${entry.file} is missing agent-specific terseness rule signature: "${entry.signature}". ` +
            `Expected rule: ${entry.label}. ` +
            `The F-060 agent-specific block may have been removed or rewritten.`
        );
      });
    }
  });

  describe('F-060 feature tag anchor is present for traceability', () => {
    for (const file of TARGET_FILES) {
      it(`${file} contains @cap-feature(feature:F-060) anchor`, () => {
        const content = readAgent(file);
        assert.ok(
          content.includes('@cap-feature(feature:F-060)'),
          `${file} is missing the @cap-feature(feature:F-060) anchor that links ` +
            `the terseness rules block back to the Feature Map entry.`
        );
      });
    }
  });
});
