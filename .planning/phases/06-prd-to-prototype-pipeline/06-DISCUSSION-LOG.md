# Phase 6: PRD-to-Prototype Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 06-prd-to-prototype-pipeline
**Areas discussed:** PRD input resolution, Autonomous iteration loop, Requirements confirmation gate, --interactive mode behavior
**Mode:** --auto (all decisions auto-selected)

---

## PRD Input Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Priority chain: --prd flag, .planning/PRD.md, prompt to paste | Standard three-fallback approach | ✓ |
| Always require explicit --prd flag | Simpler but less convenient | |
| Only support file path, no paste | Limits flexibility | |

**User's choice:** [auto] Priority chain (recommended default)
**Notes:** Research confirmed PRD ingestion belongs in command orchestrator, not agent.

---

## Autonomous Iteration Loop

| Option | Description | Selected |
|--------|-------------|----------|
| Prototype → extract → iterate → repeat, hard cap 5 | Autonomous with safety limit | ✓ |
| Single-pass prototype only | No iteration, just scaffold | |
| Unlimited iterations until complete | Risk of divergence | |

**User's choice:** [auto] Hard cap 5 iterations (recommended default)
**Notes:** Research flagged loop divergence as highest-risk pitfall. Hard cap is mandatory prevention.

---

## Requirements Confirmation Gate

| Option | Description | Selected |
|--------|-------------|----------|
| Show ACs, require confirmation before code | Mandatory gate | ✓ |
| Auto-proceed after showing ACs | Less friction but risky | |

**User's choice:** [auto] Mandatory confirmation (recommended default)
**Notes:** Research: "Silent discards when PRD format varies are never acceptable."

---

## --interactive Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Pause after each iteration, show progress | Step-by-step with user control | ✓ |
| Pause after each file created | Too granular | |

**User's choice:** [auto] Pause after each iteration (recommended default)
**Notes:** User specified: "standardmassig durchlaufen, nur bei echten Unklarheiten stoppen"

---

## Claude's Discretion

- Exact prompt structure for PRD context injection
- Malformed PRD handling
- Extract-plan frequency in loop
- Loop termination heuristics

## Deferred Ideas

- PRD template scaffolding (v1.2+)
- Remote PRD URLs (out of scope)
