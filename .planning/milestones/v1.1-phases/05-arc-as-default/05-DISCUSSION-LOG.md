# Phase 5: ARC as Default - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 05-arc-as-default
**Areas discussed:** Config default behavior, Agent fallback values, iterate.md routing
**Mode:** --auto (all decisions auto-selected)

---

## Config Default Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing default, fix agent fallbacks | arc.enabled: true already hardcoded in buildNewProjectConfig() | ✓ |
| Add additional enforcement layer | Belt-and-suspenders approach with runtime override | |

**User's choice:** [auto] Keep existing default, fix agent fallbacks (recommended default)
**Notes:** Codebase inspection revealed arc.enabled: true is already the default at config.cjs:141. The gap is in agent-level fallbacks.

---

## Agent Fallback Values

| Option | Description | Selected |
|--------|-------------|----------|
| Change to `\|\| echo "true"` | Aligns fallback with always-on intent | ✓ |
| Keep `\|\| echo "false"` | Conservative, but contradicts ARC-always-on | |

**User's choice:** [auto] Change to true (recommended default)
**Notes:** Two files affected: gsd-arc-executor.md:53, gsd-arc-planner.md:62

---

## iterate.md Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Keep config check with true default | Preserves opt-out for explicit false configs | ✓ |
| Remove check, always use arc-executor | Simplest but removes opt-out capability | |
| Add visible executor selection log | Makes routing transparent to user | ✓ |

**User's choice:** [auto] Keep config check with true default + add logging (recommended default)
**Notes:** Preserving the check maintains backward compatibility per ARC-02

---

## Claude's Discretion

- Test approach for upgrade path verification
- Whether to add log lines in wrapper agent startup

## Deferred Ideas

None
