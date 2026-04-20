# F-044 — Agent Behavior Audit (Opus 4.7)

<!-- @cap-feature(feature:F-044) Audit and Right-Size Agent Behaviors for Opus 4.7 -->
<!-- @cap-todo(ac:F-044/AC-1) Audit document enumerating every Context7 fetch and convention-detection step -->

**Audit date:** 2026-04-20
**Audited revision:** `feature/F-044-agent-audit` branch of `code-as-plan`
**Model target:** Claude Opus 4.7 (1M context)
**Depends on findings from:** F-024 (pitfall research, shipped)
**Companion artifact:** `docs/F-044-token-benchmark.md`

---

## Methodology

1. Read each agent definition file under `agents/*.md`.
2. Enumerate explicit Context7 fetches (`npx ctx7@latest ...`), convention-detection file reads, and reference-document loads.
3. Enumerate the same from the orchestrating command files (`commands/cap/*.md`) — commands often front-load context before spawning the agent, so steps bleed across files.
4. Score each step along two axes:
   - **Type** — `convention` (reads a config to match project style), `pitfall-research` (external Context7/web), `reference` (built-in template doc), `feature-map` (reads artifacts the agent owns).
   - **Necessity** — `NECESSARY` (structural guarantee), `LIKELY-REDUNDANT` (Opus 4.7 handles without it), `EXPENSIVE` (high token cost, low value).
5. Recommend **KEEP** | **RIGHT-SIZE** | **REMOVE** per item with a one-sentence rationale.

The scoring bias of this audit: Opus 4.7 has robust training coverage of the mainstream JS / TS / Python ecosystem through January 2026. Where a step exists only to re-teach the model something it already knows, it is flagged LIKELY-REDUNDANT. Where a step establishes a deterministic invariant the model cannot otherwise enforce (e.g. reading CLAUDE.md for this project's custom conventions), it is flagged NECESSARY.

---

## cap-prototyper

**Agent file:** `agents/cap-prototyper.md` — 8,118 bytes (~2,030 tokens).
**Orchestrating command:** `commands/cap/prototype.md` — before the agent is spawned, the command executes Steps 1 through 3 which include convention detection and pitfall research.

| Step | Where | Type | Score | Recommendation | Reasoning |
|------|-------|------|-------|----------------|-----------|
| Read `CLAUDE.md` | agent step 1 + command step 3 | convention | NECESSARY | **KEEP** | Project intent doc; the canonical anchor for conventions specific to this repo. Opus 4.7 cannot infer CAP-specific rules. |
| Read `FEATURE-MAP.md` | agent step 1 + command step 1 | feature-map | NECESSARY | **KEEP** | Primary input; agent cannot produce @cap-todo tags without the AC list. |
| Read `.cap/SESSION.json` | agent step 1 + command step 1 | feature-map | NECESSARY | **KEEP** | Session continuity for active-feature routing. Small (<1 KB). |
| Read `package.json` | command step 3 | convention | NECESSARY | **KEEP** | Deterministic anchor for module type, scripts, dependencies. |
| Detect `.eslintrc`, `.prettierrc`, `tsconfig.json` via `fs.existsSync` | command step 3 | convention | LIKELY-REDUNDANT | **RIGHT-SIZE** | Opus 4.7 can infer lint/format from package.json devDependencies and from sample source files it already reads as part of the task. Three `existsSync` calls are cheap in isolation but the downstream agent prompt bloats to enumerate them. |
| Call `readProjectConventions()` (naming / test / build / linter) | `cap/bin/lib/convention-reader.cjs` | convention | LIKELY-REDUNDANT | **RIGHT-SIZE** | Reads up to 6 files (package.json, tsconfig OR jsconfig, .eslintrc family, directory walk of depth 3, biome config). Most fields are hints Opus 4.7 can derive from package.json + two sample source files. See F-044/AC-3. |
| `ls .cap/stack-docs/*.md` | agent step 1 + command step 3 | reference | NECESSARY | **KEEP** | Cheap single directory listing. Presence is load-bearing when it exists. |
| Pitfall research via `ctx7 docs ...` (F-024) | command step 2b | pitfall-research | EXPENSIVE | **RIGHT-SIZE** (opt-in) | Context7 fetch of ~200 lines per detected tech per feature. Previously always-on with `--skip-research` opt-out. Opus 4.7 already knows most major libraries well. Flipped to opt-in `--research` by this PR (AC-2). |
| Pitfall research cache read `.cap/pitfalls/*.md` | command step 2c (debug mirror) | reference | NECESSARY | **KEEP** | Reads pre-fetched briefings that the user explicitly opted into earlier. No new cost. |

**Top 5 findings for cap-prototyper:**

1. The command runs up-front convention detection that the agent then re-runs internally — duplicated I/O with overlap.
2. The `readProjectConventions()` probe eagerly reads 6-7 files whose combined signal for Opus 4.7 is lower than CLAUDE.md + package.json alone.
3. Pitfall research was gated by `--skip-research` (opt-out) which meant every common invocation paid the Context7 tax.
4. Mode dispatch (PROTOTYPE / ITERATE / ARCHITECTURE / ANNOTATE) is sound. See `## 4-Mode Architecture Evaluation` below.
5. The agent correctly re-reads artifacts the command already read. This is not wasteful in 1M-context — reading the same small file twice costs two short reads. But the AGENT PROMPT bloats to enumerate both surfaces.

---

## cap-tester

**Agent file:** `agents/cap-tester.md` — 7,969 bytes (~1,990 tokens).

| Step | Where | Type | Score | Recommendation | Reasoning |
|------|-------|------|-------|----------------|-----------|
| Read `CLAUDE.md` | agent step 1 | convention | NECESSARY | **KEEP** | Same justification as cap-prototyper. |
| Read `FEATURE-MAP.md` | agent step 1 | feature-map | NECESSARY | **KEEP** | ACs ARE the test specs. |
| Detect test framework via `ls tests/*.test.cjs` + `ls sdk/src/**/*.test.ts` | agent step 1 | convention | NECESSARY | **KEEP** | The agent must pick between `node:test` and `vitest` — wrong pick means broken test files. `test-detector.cjs` also does this deterministically. |
| Read implementation files (feature's file references) | agent step 1 | feature-map | NECESSARY | **KEEP** | Cannot write meaningful assertions without reading the SUT. |
| Read existing test files for patterns | agent step 1 | convention | NECESSARY | **KEEP** | Matches project test style — crucial in a repo with both `node:test` (CJS) and `vitest` (TS). |
| Conditional: read `cap/references/security-test-templates.md` (10,927 bytes) | agent role | reference | NECESSARY (when applicable) | **KEEP** | Only read if testing auth/security — gated correctly. RLS / JWT pitfalls are specialized enough that the template adds real structural signal. |
| Conditional: read `cap/references/contract-test-templates.md` (10,329 bytes) | agent role | reference | NECESSARY (when applicable) | **KEEP** | Same rationale — inter-service contract test generation benefits from template. |
| Conditional: read `cap/references/property-test-templates.md` (9,907 bytes) | agent role | reference | LIKELY-REDUNDANT | **RIGHT-SIZE** | Opus 4.7 is fluent in fast-check. The template is nice-to-have but the model produces correct `fc.property(...)` assertions without it. |
| Scan `@cap-feature` tags via `cap-tag-scanner.cjs` | agent step 5 | feature-map | NECESSARY | **KEEP** | Core to @cap-risk annotation of untested paths — cannot be replaced by model inference. |
| No Context7 calls | — | — | — | — | cap-tester does NOT invoke Context7. Good. |

**Top 5 findings for cap-tester:**

1. Zero Context7 surface — already right-sized on the pitfall-research axis.
2. Three template reads are conditionally gated by keyword in the Task() prompt — correct pattern.
3. The property-test template read is the weakest justification; Opus 4.7 writes fast-check assertions natively.
4. Double-read of CLAUDE.md is unavoidable since cap-tester runs in a fresh subagent from cap-reviewer's context.
5. RED-GREEN discipline is agent-authored (prompt-driven), not code-enforced. That is correct — it is a mindset, not an invariant.

---

## cap-reviewer

**Agent file:** `agents/cap-reviewer.md` — 7,879 bytes (~1,970 tokens).

| Step | Where | Type | Score | Recommendation | Reasoning |
|------|-------|------|-------|----------------|-----------|
| Read `CLAUDE.md` | agent step 1 | convention | NECESSARY | **KEEP** | Project-specific constraints drive the review. |
| Read `FEATURE-MAP.md` | agent step 1 | feature-map | NECESSARY | **KEEP** | Stage 1 verdicts reference AC IDs; must read full AC text. |
| Read all implementation files | agent step 1 | feature-map | NECESSARY | **KEEP** | Cannot review without reading the SUT. |
| Read all test files | agent step 1 | feature-map | NECESSARY | **KEEP** | Stage 1 test-pass verification. |
| Tag scan via `cap-tag-scanner.cjs` | agent step 1 | feature-map | NECESSARY | **KEEP** | Annotation-completeness check in Stage 1. |
| No Context7 calls | — | — | — | — | cap-reviewer does NOT invoke Context7. |
| No `readProjectConventions()` call | — | — | — | — | Reviewer reads CLAUDE.md directly rather than via the probe — already right-sized. |

**Top 5 findings for cap-reviewer:**

1. Leanest agent on the audit axis — no pitfall research, no convention probe, only feature-map I/O.
2. The two-stage gate (Stage 2 only if Stage 1 passes) is a necessary control-flow invariant, not prompt sugar.
3. Review output goes to `.cap/REVIEW.md`; file I/O is bounded and structurally required.
4. Does not need `--research`. No change proposed.
5. Consideration: reviewer could optionally use the two-anchor probe (CLAUDE.md + package.json) instead of reading CLAUDE.md raw — marginal gain, not worth a change.

---

## cap-debugger

**Agent file:** `agents/cap-debugger.md` — 12,120 bytes (~3,030 tokens). Largest agent.

| Step | Where | Type | Score | Recommendation | Reasoning |
|------|-------|------|-------|----------------|-----------|
| Read `CLAUDE.md` | agent step 1 + command step 0 | convention | NECESSARY | **KEEP** | Project conventions guide fix proposals. |
| Read `FEATURE-MAP.md` | agent step 1 | feature-map | NECESSARY | **KEEP** | Feature context for affected file references. |
| Read `.cap/SESSION.json` | agent step 1 + command step 0 | feature-map | NECESSARY | **KEEP** | Active debug session lookup. |
| Read `.cap/debug/SESSION-{id}.md` (persistent debug state) | agent step 1 + command step 1 | feature-map | NECESSARY | **KEEP** | Core value prop of cap-debugger — survives context resets. |
| Read `.cap/debug/DEPLOY-LOG-{id}.md` if present | agent step 1 + command step 1 | feature-map | NECESSARY | **KEEP** | Avoids re-testing disproven hypotheses. |
| Read files listed in `<files_to_read>` | agent step 1 | feature-map | NECESSARY | **KEEP** | Agent is explicitly instructed to read these first. |
| Pitfall research via `ctx7 docs ... "common pitfalls problems debugging issues"` | command step 2c | pitfall-research | EXPENSIVE | **RIGHT-SIZE** (opt-in) | Same rationale as prototype. Debugging a Supabase cookie issue benefits from pitfall research. Debugging a generic null-pointer does not. Flipped to opt-in `--research` by this PR (AC-2). |
| `.cap/pitfalls/*.md` cache scan | command step 2c | reference | NECESSARY | **KEEP** | Cheap listing; only reads if user opted in earlier. |

**Top 5 findings for cap-debugger:**

1. Largest agent file — much of the size is the deploy-aware protocol (F-022), which is load-bearing behavior.
2. Persistent debug state via `.cap/debug/` is unique to this agent and cannot be compressed without losing cross-session resume.
3. Pitfall research for debug context was always-on — flipped to opt-in by this PR. Reasoning: most bugs are local logic errors, not framework pitfalls.
4. The DEPLOY-LOG protocol (don't repeat disproven hypotheses) is the most structurally valuable sub-system. Keep as is.
5. No redundant convention detection beyond CLAUDE.md — already right-sized.

---

## cap-brainstormer

**Agent file:** `agents/cap-brainstormer.md` — 8,731 bytes (~2,180 tokens).

| Step | Where | Type | Score | Recommendation | Reasoning |
|------|-------|------|-------|----------------|-----------|
| Read `CLAUDE.md` | agent step 1 | convention | NECESSARY | **KEEP** | Avoids proposing features that conflict with project constraints. |
| Read `FEATURE-MAP.md` | agent step 1 | feature-map | NECESSARY | **KEEP** | Avoids duplicate features; enables integration-point references. |
| Read `package.json` | agent step 1 | convention | NECESSARY | **KEEP** | Tech stack grounds the AC imperative form. |
| `ls .cap/stack-docs/*.md` | agent step 1 | reference | NECESSARY | **KEEP** | Cheap listing, directly relevant for stack-aware brainstorming. |
| No Context7 calls | — | — | — | — | Brainstormer does not fetch Context7. |
| No `readProjectConventions()` call | — | — | — | — | Already right-sized — reads the two anchors directly. |

**Top 5 findings for cap-brainstormer:**

1. Already implements the two-anchor probe shape we are standardizing on (AC-3). Good reference pattern for other agents.
2. `AskUserQuestion` tool usage is core to the value prop — keep.
3. No file writes (by design) — all persistence via the command layer.
4. Adaptive question count (1-4 per phase) is prompt-driven; not bloat.
5. Divergence-awareness step (2b) is a short conversational-awareness guideline; no file cost.

---

## Cross-Agent Findings

1. **Pitfall research (F-024) was always-on across two commands** (`/cap:prototype` and `/cap:debug`). Each invocation runs one `ctx7 library` + one `ctx7 docs` call PER detected technology, returning ~200 lines of markdown. For a typical Next.js + Supabase + Stripe feature that's ~3 techs × ~250 tokens of input + ~2,000 tokens of output = ~8,000 tokens per invocation, with uncertain real-world hit rate. **Hit rate estimate (from looking at ~10 past sessions in `.cap/pitfalls/`):** maybe 15% of invocations surface a pitfall that actually influences the generated code. **Recommendation:** opt-in via `--research` — implemented by this PR.
2. **Convention detection is spread across three surfaces:** the command layer (inline `node -e` block), `convention-reader.cjs` (6-7 files), and the agent prompt (enumerates config files to read). Consolidation target: a single two-anchor probe (CLAUDE.md + package.json) implemented by `probeProjectAnchors()`. Implemented in this PR.
3. **CLAUDE.md is read by every agent.** It is the highest-signal anchor for this project. All agents already reference it.
4. **Reference templates (security / contract / property)** are correctly gated by keyword in the Task() prompt. Only the property-test template is LIKELY-REDUNDANT because Opus 4.7 writes fast-check natively.
5. **No agent performs convention detection that the model cannot reproduce** from CLAUDE.md + package.json + 1-2 sample source files. The convention-reader is overkill for Opus 4.7.

---

## 4-Mode Architecture Evaluation (AC-5)

The cap-prototyper agent operates in four modes dispatched via a Task() prompt prefix: `**MODE: PROTOTYPE**`, `**MODE: ITERATE**`, `**MODE: ARCHITECTURE**`, `**MODE: ANNOTATE**`. Each mode changes the behavior materially, not just the prompt.

### PROTOTYPE

- **Unique behavior:** Creates new files from scratch. Tag obligations: every new file gets `@cap-feature` + per-AC `@cap-todo` tags. Feature Map state transitions `planned → prototyped` on success.
- **Could a single-agent-with-explicit-prompt approach work?** Yes, with a significantly longer prompt. The mode prefix saves ~1,500 tokens of per-invocation prompt.
- **Evidence for keeping:** The mode maps 1-to-1 with a Feature Map state transition (`planned → prototyped`). That is a structural guarantee, not prompt sugar.
- **Recommendation:** **KEEP.**

### ITERATE

- **Unique behavior:** Refines EXISTING code. Reads all listed implementation files first. Does NOT create new files unless strictly needed. Preserves existing tests.
- **Could a single-agent approach work?** Yes, with careful prompt framing. But the "do not break existing tests" invariant is critical and is reinforced by the mode-specific step in the agent definition.
- **Evidence for keeping:** The differential between PROTOTYPE and ITERATE is load-bearing — without it, the agent may recreate scaffolding over existing code. Observed in GSD v1.1 retrospectives.
- **Recommendation:** **KEEP.**

### ARCHITECTURE

- **Unique behavior:** ZERO feature implementation code. Only structure (folders, interfaces, config, module boundaries). Adds `@cap-decision` at every module boundary.
- **Could a single-agent approach work?** Yes — this mode is the most prompt-like. It's basically "do the PROTOTYPE thing but without any business logic."
- **Evidence on the fence:** The "ZERO implementation code" constraint is a prompt-enforced rule, not a code-enforced one. If mode fidelity drifts, feature code leaks in.
- **Recommendation:** **KEEP** for now. Worth revisiting in a follow-up: if ARCHITECTURE produces the same output shape as PROTOTYPE with an explicit `no-implementation` prompt addendum, collapse is viable. Currently the mode has value as a mental model for the user ("I want skeleton only").

### ANNOTATE

- **Unique behavior:** Uses `Edit` (not `Write`) exclusively. No new files. Adds `@cap-feature` and `@cap-todo` tags to existing unannotated code.
- **Could a single-agent approach work?** Yes, with a clear "do not write new files" instruction.
- **Evidence for keeping:** The Edit-only constraint is operationally important — accidental overwrites of unannotated production code would be catastrophic. The mode gives us a safe narrow surface.
- **Recommendation:** **KEEP.**

### Overall 4-mode verdict

**KEEP all four modes.** Each one maps to a distinct workflow invariant that the prompt layer alone cannot guarantee without meaningful risk:

- PROTOTYPE owns `planned → prototyped` state transition.
- ITERATE owns the "preserve existing tests" invariant.
- ARCHITECTURE owns the "no implementation code" invariant (soft — prompt-enforced).
- ANNOTATE owns the "Edit only, no new files" invariant.

A collapse to a single agent with mode-as-prompt-parameter would work for a highly-capable model in normal cases, but the failure mode (e.g., PROTOTYPE logic leaking into ANNOTATE run) is asymmetric — silent corruption of existing annotated code is hard to detect after the fact. The 4-mode split is a cheap structural control.

**Follow-up worth considering (not in this PR):** Extract a shared "load_context" step used by all four modes to reduce the per-mode prompt duplication. Current estimate: ~300 tokens of shared boilerplate across modes.

---

## Summary of Recommended Actions

| # | Recommendation | AC | Status |
|---|----------------|----|----|
| 1 | Flip `--skip-research` to opt-in `--research` in `/cap:prototype` and `/cap:debug` | AC-2 | **DONE in this PR** |
| 2 | Add two-anchor probe `probeProjectAnchors()` returning `{ rawClaudeMd, rawPackageJson, parsedPackageJson, filesProbed }` alongside existing `readProjectConventions()` | AC-3 | **DONE in this PR** |
| 3 | Static token benchmark across 5 representative micro-tasks | AC-4 | **DONE in `docs/F-044-token-benchmark.md`** |
| 4 | 4-mode architecture evaluation → KEEP | AC-5 | **DONE (this document)** |
| 5 | Preserve public command surface — `/cap:prototype`, `/cap:debug` etc. still parseable | AC-6 | **DONE (frontmatter unchanged, argument-hint extended additively)** |
| 6 | Future: remove property-test template read when Opus 4.7 usage is confirmed | — | Out of scope for this PR |
| 7 | Future: consider collapsing ARCHITECTURE into PROTOTYPE-with-prompt-addendum | — | Out of scope; evaluated negative above |
| 8 | Future: migrate commands to use `probeProjectAnchors()` in place of the inline `fs.existsSync` block | — | Out of scope (no downstream consumers updated; `readProjectConventions()` still supported) |

---

## Deviations

No ACs were deviated. All six ACs have implementation tags (`@cap-todo(ac:F-044/AC-N)`) either in code or in this document.
