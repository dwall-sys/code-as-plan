# Phase 7: Test Agent - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 07-test-agent
**Areas discussed:** Agent design, Test output location, Test framework detection, RED-GREEN discipline, @gsd-risk annotation, Test execution, Command integration
**Mode:** --auto (all decisions auto-selected)

---

## Agent Design

| Option | Description | Selected |
|--------|-------------|----------|
| New standalone agent | gsd-tester.md as new file, not wrapping existing | ✓ |
| Wrapper around add-tests workflow | Reuse existing workflow via wrapper | |
| Extend gsd-verifier | Add test generation to verifier | |

**User's choice:** [auto] New standalone agent (recommended default)
**Notes:** Research explicitly states: "NOT a wrapper around existing agent. Different purpose."

---

## Test Framework Detection

| Option | Description | Selected |
|--------|-------------|----------|
| CJS module reading package.json | Zero-dep, 15-line function | ✓ |
| Shell script | Less portable | |
| Agent reads package.json directly | Duplicated per invocation | |

**User's choice:** [auto] CJS module (recommended default)
**Notes:** Stack research confirmed this approach. Supports jest, vitest, mocha, ava, node:test.

---

## RED-GREEN Discipline

| Option | Description | Selected |
|--------|-------------|----------|
| Mandatory RED then GREEN | Tests must fail on stubs, pass on implementation | ✓ |
| GREEN only | Just verify tests pass | |

**User's choice:** [auto] Mandatory RED-GREEN (recommended default)
**Notes:** User explicitly required this. Research confirms it prevents false confidence.

---

## @gsd-risk Annotation

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-annotate untestable paths | Agent marks what it can't test with @gsd-risk | ✓ |
| Skip annotation | Just write tests, no risk tagging | |

**User's choice:** [auto] Auto-annotate (recommended default)
**Notes:** Feeds into CODE-INVENTORY.md and Phase 8 review agent.

---

## Claude's Discretion

- Agent prompt structure, test file count, naming conventions, fixture generation

## Deferred Ideas

- @gsd-coverage tag type (v1.2+)
- Multi-language test runners (v1.2+)
