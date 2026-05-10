'use strict';

// @cap-feature(feature:F-060) Terse Agent Prompts — shared signature fixtures
// Shared between tests/cap-terse-rules.test.cjs and
// tests/cap-terse-rules-adversarial.test.cjs. Drift between the two lists
// would let one file catch a rule removal the other missed.
//
// @cap-history(learned:cap-pro-4) cap-tester and cap-reviewer were removed.
// Their universal + agent-specific terseness rules now live in cap-validator
// (which absorbed both agents' responsibilities). The OUT_OF_SCOPE_FILE
// concept was retired — every remaining hotspot agent now carries the F-060
// terseness block, so there is no longer a clean negative case to assert.

const IN_SCOPE_FILES = [
  'cap-prototyper.md',
  'cap-validator.md',
  'cap-brainstormer.md',
  'cap-debugger.md',
];

const UNIVERSAL_RULE_SIGNATURES = [
  'No procedural narration before tool calls',
  'defensive self-correcting negation',
  'End-of-turn summaries only for multi-step',
  'Terseness shall never override risk',
];

const AGENT_SPECIFIC_SIGNATURES = [
  {
    file: 'cap-prototyper.md',
    signature: 'No markdown tables with fewer than 3 rows',
    label: 'cap-prototyper forbids markdown tables under 3 rows',
  },
  {
    file: 'cap-validator.md',
    signature: 'No status recaps between tool calls',
    label: 'cap-validator forbids status recaps (inherited from cap-reviewer)',
  },
  {
    file: 'cap-brainstormer.md',
    signature: 'No preambles before questions',
    label: 'cap-brainstormer forbids preambles before questions',
  },
  {
    file: 'cap-debugger.md',
    signature: 'Hypothesis entries are one line',
    label: 'cap-debugger requires one-line hypothesis entries',
  },
];

module.exports = {
  IN_SCOPE_FILES,
  UNIVERSAL_RULE_SIGNATURES,
  AGENT_SPECIFIC_SIGNATURES,
};
