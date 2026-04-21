'use strict';

// @cap-feature(feature:F-060) Terse Agent Prompts — shared signature fixtures
// Shared between tests/cap-terse-rules.test.cjs and
// tests/cap-terse-rules-adversarial.test.cjs. Drift between the two lists
// would let one file catch a rule removal the other missed.

const IN_SCOPE_FILES = [
  'cap-prototyper.md',
  'cap-reviewer.md',
  'cap-brainstormer.md',
  'cap-debugger.md',
];

const OUT_OF_SCOPE_FILE = 'cap-tester.md';

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
    file: 'cap-reviewer.md',
    signature: 'No status recaps between tool calls',
    label: 'cap-reviewer forbids status recaps',
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
  OUT_OF_SCOPE_FILE,
  UNIVERSAL_RULE_SIGNATURES,
  AGENT_SPECIFIC_SIGNATURES,
};
