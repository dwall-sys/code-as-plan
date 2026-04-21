# CAP Usage Guide — v4.1

> Build first. Plan from code. Let the framework do the bookkeeping.

This guide is the "second read" after the README. The README tells you what CAP is; this tells you how to get maximum value out of the v4.1 feature set without tripping over the edges.

---

## TL;DR — the tight daily loop

```
/cap:start               → restore context, surface related threads
/cap:brainstorm          → discover features, write to FEATURE-MAP.md
/cap:prototype           → build annotated code (research-gate fires automatically)
/cap:test                → RED-GREEN against the ACs
/cap:review              → two-stage: AC compliance, then code quality
/cap:checkpoint          → strategic /compact at natural breakpoints
```

Everything else is support scaffolding. If you only internalise six commands, these are the six.

---

## What's new in v4.1

Six features landed in the 2026-04-21 batch. Each one is additive — none require you to change existing workflows, all can be adopted incrementally.

| Feature | What it does | When you'll notice it |
|---------|--------------|-----------------------|
| **F-054** Hook tag observation | PostToolUse hook diffs `@cap-*` tag sets per file, appends JSONL events | Next `/cap:memory` run picks up tag changes automatically; no manual capture step |
| **F-055** Confidence + evidence | Memory entries carry `confidence` (0–1) and `evidence_count` (≥1) | `decisions.md` / `pitfalls.md` show confidence per entry; low-confidence entries render dimmed |
| **F-056** Memory prune | `/cap:memory prune` decays stale entries, archives very-stale + low-confidence, purges old raw logs | Run monthly in large projects to keep memory from drifting |
| **F-057** Checkpoint command | `/cap:checkpoint` detects natural workflow breakpoints, nudges `/compact`, chains `/cap:save` | Reach a feature state transition or terminal session step; run once per meaningful milestone |
| **F-058** Plugin manifest | CAP is now installable via `/plugin install code-as-plan` alongside npx | First-time install on a fresh machine; doctor warns but doesn't fail on dual install |
| **F-059** Research-first gate | `/cap:prototype` preflight parses AC descriptions for library mentions, checks stack-doc freshness | Prototyping against a library whose docs are missing or >30 days old |

Plus a load-bearing bugfix: **F-040** — the feature-map parser used to truncate AC descriptions at the first internal pipe character. Fixed. F-041/AC-6 and F-042/AC-3/AC-4 restored (had been manually worked around).

---

## Memory: how good is it now, and when should you trust it?

The honest answer: **memory is good for mechanical observations, imperfect for semantic judgment.** Here is what that means concretely.

### What memory reliably captures

- **Every `@cap-decision` tag you write.** 100 % hit rate — tags are extracted deterministically, no LLM in the path.
- **Every `@cap-todo risk:` and `@cap-risk` tag** — same story, regex extraction.
- **File edit frequency** across sessions — session JSONL parsing, again deterministic.
- **Tag deltas per edit** (F-054) — hook snapshot+diff, emits one JSONL event per non-empty change.

Anything that lives in code tags or in explicit session hook events is **100 % reliable for firing** — what actually runs, runs.

### What memory does probabilistically

- **Re-observation detection** (F-055) uses Jaccard similarity on word tokens with a 0.8 threshold. Two entries that express the same idea in very different words will not cluster. This is conservative on purpose — false-positive merges are worse than false-negative duplicates.
- **Contradiction detection** (F-055) triggers only on same category + shared files + asymmetric negation. It **under-detects**: a contradiction phrased without NEGATION_MARKER tokens (e.g. "prefer X over Y" vs "prefer Y over X") will slip through. It also **over-detects** occasionally when one entry uses stylistic negation ("don't just X, do Y").
- **Confidence bumps** (F-055) are mechanical — exactly +0.1 per re-observation. The bumps are truthful about count, not about correctness.

### What to do about it

1. **Read `decisions.md` periodically.** Low-confidence entries (dimmed blockquotes) are the framework saying "I'm not sure yet." Pin the ones that are obviously correct with `/cap:memory pin`; delete the ones that are wrong; trust nothing else blindly.
2. **Use `--confidence` as a reading aid, not a gate.** High confidence means "observed repeatedly." It does not mean "true." The framework cannot tell the difference between consistent correctness and consistent mistakes.
3. **Prune deliberately.** Run `/cap:memory prune` as a dry-run monthly, inspect the archive candidates, then `--apply` if you agree. Never automate this — the framework has no idea which stale decision is still load-bearing.
4. **Pin what matters.** A decision about data-model shape, a pitfall you hit in production, a pattern that works — pin these. They then bypass both decay and archive.

### Does it always work?

- **Tag extraction**: yes, deterministic.
- **Hook observation**: yes, with an exit: `CAP_SKIP_TAG_OBSERVER=1` disables it for a specific run if you need to.
- **Confidence math**: yes, round-to-2-decimals eliminates float drift around the 0.3 dim threshold.
- **Prune**: yes with `--apply`, defaults to dry-run. Pre-F-055 files without `last_seen` trigger a migration warning on first prune — heed it, review archive candidates before committing.
- **Clustering**: requires ≥2 threads to produce output. No threads → `/cap:cluster` prints "No clusters detected" and that is correct behaviour, not a bug.

---

## The research-first gate (F-059)

New default behaviour on `/cap:prototype`: before spawning the prototyper, CAP parses the AC descriptions of the target feature(s), extracts library mentions that match names in your `package.json`, and checks each one against `.cap/stack-docs/{lib}.md` mtime.

### The flow

```
/cap:prototype --features F-042
  ├─ Step 1c (NEW): research-first gate
  │   ├─ parseLibraryMentions(acDescs, package.json deps)
  │   ├─ checkStackDocs for each hit (missing / stale / fresh)
  │   └─ if missing ∪ stale > 0:
  │        ├─ print warning block
  │        ├─ suggest `/cap:refresh-docs {libs}`
  │        └─ prompt "Proceed anyway? [y/N]"
  └─ Step 2+: prototyper proceeds or exits based on user answer
```

### When it fires

- A library from `package.json` is mentioned by name in an AC description (word-boundary match, case-insensitive, no substring false positives like "react" inside "overreacted")
- That library has **no** cached doc at `.cap/stack-docs/{lib}.md`, **or** its doc is older than 30 days
- The flow is interactive (`--non-interactive` and `--annotate` skip the gate entirely)
- You didn't pass `--skip-docs`

### What to do with the warning

**Scaffolding-only feature** (no external library surface): pass `--skip-docs`. The gate skip and the outcome are recorded in `.cap/session-log.jsonl` — next week you can tell which prototypes skipped research and whether the ones that ran into bugs were the ones that skipped.

**Unfamiliar SDK** (Supabase auth, Stripe webhooks, a freshly-bumped framework version): answer `y` with intent, and plan to run `/cap:refresh-docs {libs}` right after. Even better: refresh *before* answering so the prototyper has fresh docs to work with.

**Well-known library** (React, Lodash, Zod): the gate firing is low-signal. Opus 4.7 already knows these. Proceed.

---

## Strategic compact (F-057)

`/cap:checkpoint` is the command I wish I had during every long session. It is **purely advisory** — it never runs `/compact` itself, never takes a `--force` flag.

### What it does

1. Reads SESSION.json + FEATURE-MAP.md
2. Diffs current state against the last checkpoint snapshot
3. Identifies the single most significant breakpoint:
   - **Feature state transitions** (highest priority, tie-break by STATE_RANK then younger F-NNN)
   - **AC status updates** (tie-break by younger F-NNN then AC id)
   - **Terminal session steps** (`test-complete`, `review-complete`, `prototype-complete`, `brainstorm-complete`, `iterate-complete`)
4. If a breakpoint is found:
   - Chains `/cap:save checkpoint-{feature_id}` to snapshot the session
   - Prints `Jetzt /compact, weil F-054 von prototyped → tested.`
   - Persists `lastCheckpointAt` + `lastCheckpointSnapshot` to SESSION.json (with an FS-post-condition check)
5. If no breakpoint: prints `Kein natürlicher Kontextbruch erkannt.` and stops.

### When to run it

- **After every meaningful state change.** Feature moved to tested, AC landed, review passed. Run it. Don't batch — the checkpoint snapshot is cheap, the compaction decision is yours.
- **Before a planned break.** Lunch, end of day, context switch. Checkpoint first so the next session starts fresh with a saved snapshot to restore from.
- **Never on autopilot.** The command is advisory by design. You decide whether to `/compact`.

---

## Getting the most out of the full stack

Here is the maximum-leverage daily playbook. This is what v4.1 is built for:

### Morning — session start (30 s)

```bash
/cap:start                    # restore previous session + surface related threads
/cap:status                   # see what shipped, what drifted, what's next
```

If `/cap:status` flags drift (e.g. shipped feature with pending ACs), run `/cap:reconcile` before doing anything else. Drift compounds silently.

### Active work — the tight loop

```bash
/cap:brainstorm               # when you have a new feature idea
/cap:prototype --features F-XXX   # research-gate fires if stack docs are stale
/cap:test                     # RED first, GREEN only via feature code
/cap:review                   # two-stage, ship-on-green
/cap:checkpoint               # every meaningful transition
```

Between the prototype→test→review passes, the hook observer (F-054) is capturing every tag change in the background. You don't have to think about it.

### Periodic — weekly (10 min)

```bash
/cap:memory                   # incremental aggregation (hooks + new tags)
/cap:memory status            # quick health check: entries, last run, sources
/cap:memory prune             # DRY-RUN: see what would decay/archive/purge
# review the dry-run output, then:
/cap:memory prune --apply
```

### Periodic — before releases

```bash
/cap:reconcile                # propose AC promotions + state corrections
/cap:deps                     # diff source-import DAG vs FEATURE-MAP DEPENDS_ON
/cap:test-audit               # assertion density + mutation score
/cap:completeness             # 4-signal implementation completeness per AC
/cap:doctor                   # health of all required + optional tools
```

---

## Things to watch

### The .claude/ directory is gitignored

`.claude/` is a local installer artefact — it does not ship in git. If your CI fails with `ENOENT: .claude/commands/...`, the test is reading the mirror without guarding for its existence. v4.1's CI fix added a `hasClaudeMirror` guard to the F-044 audit tests; if you add new mirror-dependent tests, do the same.

### Pipes in AC descriptions used to truncate

Pre-v4.1 the feature-map parser used a non-greedy description group without an end anchor, so `| AC-2 | pending | flag --foo=a|b description |` was silently truncated to `"flag --foo=a"`. Fixed in F-040. If you have older FEATURE-MAP.md files with truncated ACs from the pre-v4.1 era, check the git history — the original descriptions may still live in a brainstorm commit.

### CI matrix and Node version flag drift

`--test-isolation=none` was stabilised in Node 23. On Node 22 it is a "bad option" and crashes the runner before a single test executes. v4.1 uses `--experimental-test-isolation=none` which works on both. If you bump the CI matrix to Node 24+ only, you can drop the `experimental-` prefix.

### Windows CI is still flaky

CRLF line endings break the frontmatter regex, and a self-repair loop in `install.js` triggers in CI. Linux + macOS CI is green; Windows is a known pre-existing issue independent of v4.1. Track upstream.

### Memory is per-project, threads are root-level

In a monorepo, each app has its own `FEATURE-MAP.md` — but threads in `.cap/memory/threads/` are shared across apps. This is intentional: a brainstorm about auth in `apps/booking` can cluster with a brainstorm about SSO in `apps/hub`. It also means: don't commit app-specific secrets into thread content.

### Confidence is not correctness

`confidence: 0.95` means "observed ≥5 times." It does not mean "true." The framework has no semantic evaluation — it counts occurrences. Pin what is actually correct; review what the framework is certain about.

---

## Migration from v4.0

Entirely additive. No breaking changes.

- **Existing `decisions.md` / `pitfalls.md`**: on first read after upgrade, entries without `confidence` / `evidence_count` / `last_seen` get defaulted (0.5 / 1 / epoch) silently. Run `/cap:memory prune` as dry-run — if you see "archive count dwarfs decay count — likely a first-run migration of pre-F-055 files", that's the migration warning working as intended.
- **Existing hooks configuration**: F-054's PostToolUse observer is registered via `hooks/hooks.json`. Auto-discovery picks it up on next install; nothing to configure.
- **Existing `/cap:prototype` invocations**: the research-first gate runs by default. If it fires and you don't want it, pass `--skip-docs`. Pre-existing `--non-interactive` and `--annotate` invocations are unaffected (gate auto-skips).

---

## Where to go deeper

- `FEATURE-MAP.md` — authoritative feature list, each entry links to its ACs and files
- `.cap/memory/` — decisions, pitfalls, patterns, hotspots, memory graph
- `.cap/snapshots/` — saved context snapshots from `/cap:save`
- `.cap/stack-docs/` — Context7-generated library documentation
- `docs/` — decision documents and per-feature design notes

If you want to understand *why* a feature exists, read the corresponding `feat(F-NNN)` commit — the body is the decision log.
