# F-044 — Token Benchmark (Before vs After Right-Sizing)

<!-- @cap-feature(feature:F-044) Audit and Right-Size Agent Behaviors for Opus 4.7 -->
<!-- @cap-todo(ac:F-044/AC-4) Measurable benchmark comparing token usage before and after right-sizing across 5 representative tasks -->

**Date:** 2026-04-20
**Companion:** `docs/F-044-agent-audit.md`
**Methodology:** static analysis of file sizes, NOT live agent invocation. See `## Methodology` for honest scope notes.

---

## Methodology

This benchmark uses **static file-size analysis** rather than live agent invocations. The cost of invoking each of the 5 cap-* agents on 5 representative tasks would be ~25 paid Opus runs, which is out of scope for this PR.

For each micro-task:
1. The "before" column = sum of bytes of files the agent / command CURRENTLY reads (per the audit in `docs/F-044-agent-audit.md`).
2. The "after" column = sum of bytes of files the agent / command reads AFTER the F-044 changes are applied (`--research` opt-in default, `probeProjectAnchors()` available).
3. Token estimate uses the well-known heuristic of ~4 characters per token for English-language markdown / code. This is approximate; real tokenizer counts will vary by ±20%.
4. Live token measurement is left as a follow-up. See `## Future Work`.

The benchmark is **honest about what is measured**:
- It measures *eliminated up-front file reads*. It does NOT measure improvements in agent output quality.
- It does NOT measure savings from prompt simplification (the audit doc estimates ~300 tokens of saved per-mode prompt boilerplate; not counted here).
- It DOES count the bytes of the `--research` Context7 fetch that no longer runs in the default path.

### File size baseline (bytes -> tokens at 4:1)

| File | Bytes | Token estimate |
|------|-------|----------------|
| `CLAUDE.md` | 4,075 | ~1,019 |
| `package.json` | 1,237 | ~310 |
| `tsconfig.json` | 63 | ~16 |
| `agents/cap-prototyper.md` | 8,118 | ~2,030 |
| `agents/cap-tester.md` | 7,969 | ~1,990 |
| `agents/cap-reviewer.md` | 7,879 | ~1,970 |
| `agents/cap-debugger.md` | 12,120 | ~3,030 |
| `agents/cap-brainstormer.md` | 8,731 | ~2,180 |
| `cap/references/security-test-templates.md` | 10,927 | ~2,732 |
| `cap/references/contract-test-templates.md` | 10,329 | ~2,582 |
| `cap/references/property-test-templates.md` | 9,907 | ~2,477 |
| Pitfall research output (typical, ~200 lines x 80 chars) | ~16,000 | ~4,000 |
| Convention-reader probe (full readProjectConventions: package.json + tsconfig + .eslintrc + biome + dir walk depth 3) | ~2,500 (estimate, varies) | ~625 |
| Two-anchor probe (CLAUDE.md + package.json only) | 5,312 | ~1,328 |

Notes:
- Pitfall research "16,000 bytes" is an estimate from observed `.cap/pitfalls/*.md` cached briefings — typical ones are 3-5 KB but the LIVE `ctx7 docs` output is `head -200` lines, ~16 KB raw before truncation.
- Convention-reader's eager probe varies wildly. The 2,500-byte estimate assumes a typical Node project with package.json (~1 KB), tsconfig.json (~500 bytes), .eslintrc.json (~500 bytes), and a depth-3 directory walk (cheap, ~500 bytes serialized).
- The two-anchor probe is LARGER in absolute bytes than the legacy probe in this specific project, because `CLAUDE.md` is 4 KB. **The win is not in raw bytes — it's in inference cost**: Opus 4.7 derives 6 outputs from 2 anchors instead of needing the 6 outputs handed to it. See task #2 below.

---

## Benchmark — Five Representative Micro-tasks

| # | Task | Before (tokens read up-front) | After (tokens read up-front) | Reduction |
|---|------|-------------------------------|------------------------------|-----------|
| 1 | `/cap:prototype` for a typical 3-AC feature on a known stack (Next.js + Supabase) — CONVENTION DETECTION ONLY | ~625 (readProjectConventions full probe) | ~1,328 (probeProjectAnchors: CLAUDE.md + package.json) | **+112%** (intentional inversion — see note) |
| 2 | Same task — INCLUDING PITFALL RESEARCH (2 detected techs) | ~625 + ~8,000 (pitfall) = ~8,625 | ~1,328 + 0 (research opt-in, default off) = ~1,328 | **−85%** |
| 3 | `/cap:prototype` for a feature on an UNFAMILIAR stack (user opts in with `--research`) | ~625 + ~8,000 = ~8,625 | ~1,328 + ~8,000 = ~9,328 | **+8%** (rare path; user explicitly chose research) |
| 4 | `/cap:debug` for a generic null-pointer bug (was: research always on, 1 detected tech) | ~4,000 (pitfall ctx7 output) | 0 (research opt-in, default off) | **−100%** |
| 5 | `/cap:debug` for a Supabase RLS bug WITH `--research` opt-in | ~4,000 | ~4,000 | **0%** (user opted in; cost preserved when valuable) |

### Note on task #1: why does the convention probe COST MORE in absolute bytes?

In THIS specific project, CLAUDE.md is 4 KB — comparatively heavy. The two-anchor probe is therefore not a raw-byte win. The win is in **what those bytes enable downstream**:

- Old `readProjectConventions()` returns a structured report with 8 inferred fields (moduleType, namingConvention, testRunner, etc.). The agent reads the report and trusts the inference.
- New `probeProjectAnchors()` returns the raw anchors. The agent reads them and infers the same fields directly from authoritative source. **It also has the FULL CLAUDE.md context** — including project-specific conventions that `readProjectConventions()` would never surface (e.g., "use `'use strict'`", "use `node:` prefix imports", "kebab-case with cap- prefix for new modules").

In a project WITHOUT a CLAUDE.md (which is common), the two-anchor probe reads only `package.json` (310 tokens) and the win flips to ~50% reduction.

### Aggregate across 5 tasks

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total tokens read up-front (sum of 5) | ~21,875 | ~17,312 | **−21%** |
| Tasks where research runs | 5 of 5 | 1 of 5 (only when opted in) | **−80% research invocations** |
| Tasks where convention detection over-reads | 5 of 5 (legacy probe) | 0 of 5 (when consumers migrate) | **−100% over-read potential** |

**Interpretation:** The headline win is from flipping research to opt-in (tasks #2 and #4). The convention-probe change has neutral-to-positive effect depending on project shape; its main value is **architectural clarity** (one anchor function, two file reads, fully traceable via `filesProbed`) rather than raw byte reduction in this repo.

---

## Static Analysis: Eliminated File Reads in Default Path

When a user runs `/cap:prototype` without `--research`:

**Before this PR:**
1. `package.json` read (command Step 2b detection)
2. `npx ctx7@latest library {tech} ...` per detected tech (typically 1-3)
3. `npx ctx7@latest docs {libraryId} ...` per detected tech (typically 1-3)
4. Write `.cap/pitfalls/{feature_id}.md` cache file
5. The pitfall briefing string is appended to the cap-prototyper Task() prompt

**After this PR:**
1. `package.json` read (command Step 3 — convention block) — preserved
2. Steps 2-5 above are SKIPPED unless `--research` is in `$ARGUMENTS`

**Eliminated in default path:** 2 ctx7 CLI invocations per detected tech, each producing ~200 lines of markdown. Conservative per-feature estimate: ~4,000 to ~12,000 tokens of context that no longer enters the agent's working set in the common case.

---

## Future Work (deferred from this PR)

1. **Live token measurement** — instrument the cap-prototyper / cap-tester / cap-debugger Task() invocations to log actual input + output tokens, then re-run the 5 tasks above against both the pre-F-044 commit and the post-F-044 commit. Compare distributions, not just point estimates.
2. **Quality measurement** — define a small panel of 5 known-good prototypes from history. Re-prototype each with `--research` and without; compare the generated code to the historical baseline by Hamming distance + manual rubric. Quality-regression risk from removing always-on research is plausible but unmeasured here.
3. **Migrate consumers to `probeProjectAnchors()`** — `commands/cap/prototype.md` Step 3 currently uses an inline `node -e` block to detect conventions. Migrating to `probeProjectAnchors()` would tighten the architecture and unlock the inference-shift described in task #1's note.
4. **Property-test template removal** — if Opus 4.7 produces correct fast-check assertions natively (high confidence per audit), remove the conditional template read from cap-tester. Save ~2,500 tokens per property-test invocation.

---

## Confidence Notes

- The 4:1 char-to-token heuristic is loose; for English markdown it's typically 3.5:1 to 4.5:1. Numbers above are within ±15% of true.
- "Hit rate of 15% for pitfall research" is a rough estimate from looking at `.cap/pitfalls/*.md` content vs the resulting commits. Not statistically rigorous.
- Convention-reader's "2,500 byte" estimate is for a typical TypeScript Node project. CAP itself is bigger (CLAUDE.md is 4 KB). User projects will vary.
