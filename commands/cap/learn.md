---
name: cap:learn
description: "Extract patterns from F-070 learning signals — Stage 1 deterministic heuristics + Stage 2 LLM-briefing pattern (counts + hashes only). Promotes candidates that hit the threshold (>=3 overrides OR >=1 regret) within the per-session LLM budget."
argument-hint: "[--features F-NNN] [--dry-run] [--budget N] [--session SID]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-context CAP F-071 — Pattern Pipeline orchestrator. Manual trigger only (D2). -->
<!-- @cap-decision(F-071/D1) Host-LLM via Skill-Briefing pattern: this skill writes briefings to .cap/learning/queue/P-NNN.md, instructs the outer agent to read each briefing and write the result to .cap/learning/patterns/P-NNN.json. No HTTPS client, no SDK dep. -->
<!-- @cap-decision(F-071/D2) Trigger is MANUAL via /cap:learn. NOT auto on /cap:scan, NOT on Stop-Hook. Auto-triggering would burn through the user's LLM budget without consent. -->
<!-- @cap-decision(F-071/D3) LLM input shape — Counts + Hashes only. The strict path. The briefing schema is { candidateId, signalType, count, byFeature, topContextHashes }. Anything beyond this MUST go through hashContext first. -->

<objective>
<!-- @cap-todo(ac:F-071/AC-1) Stage 1 — TF-IDF + RegEx-Cluster + Frequency on signal records. -->
<!-- @cap-todo(ac:F-071/AC-2) Stage 2 trigger when count >= 3 overrides OR >= 1 regret. -->
<!-- @cap-todo(ac:F-071/AC-3) PRIVACY-CRITICAL — LLM input is counts + hashes only. -->
<!-- @cap-todo(ac:F-071/AC-4) Budget hard-limit — 3 LLM calls per session by default; overflow → queue/ with deferred:budget. -->
<!-- @cap-todo(ac:F-071/AC-5) Graceful degradation — heuristic-only L1 pattern persisted with degraded:true when Stage 2 doesn't run. -->
<!-- @cap-todo(ac:F-071/AC-6) Every pattern gets a P-NNN ID — sequential, never renumbered. -->
<!-- @cap-todo(ac:F-071/AC-7) Budget override — .cap/learning/config.json#llmBudgetPerSession replaces the default 3. -->

Extract actionable patterns (P-NNN) from the F-070 learning-signal corpus. Stage 1 runs a deterministic heuristic engine (TF-IDF on hash-tuples + frequency thresholding); Stage 2 conditionally hands off candidates to the host LLM via a Counts+Hashes-only briefing markdown — never raw signals, never user text, never file paths.

**Arguments:**
- `--features F-NNN` -- restrict the input signal set to one or more featureIds (comma-separated)
- `--dry-run` -- run Stage 1 + threshold check + budget read but do NOT write briefings or pattern files
- `--budget N` -- override the per-session LLM call budget (otherwise read from `.cap/learning/config.json` or default 3)
- `--session SID` -- override the active session id (mostly for tests / replay)
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--features NAME` -- store comma-separated values as `feature_filter`
- `--dry-run` -- set `dry_run = true`
- `--budget N` -- store `budget_override` (integer)
- `--session SID` -- store `session_override`

## Step 1: Load session context + budget state

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const pipeline = require('./cap/bin/lib/cap-pattern-pipeline.cjs');
const telemetry = require('./cap/bin/lib/cap-telemetry.cjs');

const root = process.cwd();
const s = session.loadSession(root) || {};
const sessionId = process.argv[1] || s.sessionId || null;

const budgetState = pipeline.getSessionBudgetState(root, sessionId);
console.log(JSON.stringify({
  sessionId,
  activeFeature: s.activeFeature || null,
  budget: budgetState.budget,
  used: budgetState.used,
  remaining: budgetState.remaining,
  budgetSource: budgetState.source,
}, null, 2));
" '<SESSION_OVERRIDE_OR_EMPTY>'
```

Store as `ctx`. If `budget_override` is set, treat `ctx.budget` as `budget_override` and recompute `ctx.remaining = max(0, budget_override - ctx.used)`.

Log: `Session: {ctx.sessionId} · Budget: {ctx.budget} ({ctx.budgetSource}) · Used: {ctx.used} · Remaining: {ctx.remaining}`

## Step 2: Run Stage 1 — heuristic engine

<!-- @cap-todo(ac:F-071/AC-1) Heuristic engine — TF-IDF + Frequency-arm + RegEx-Cluster (cluster key is the (signalType, featureId) prefix of the tuple-token). -->

```bash
node -e "
const pipeline = require('./cap/bin/lib/cap-pattern-pipeline.cjs');
const root = process.cwd();
const sessionFilter = process.argv[1] || undefined;
const opts = sessionFilter ? { sessionId: sessionFilter } : {};
const result = pipeline.runHeuristicStage(root, opts);
console.log(JSON.stringify({
  candidates: result.candidates.length,
  errors: result.errors,
}, null, 2));
" '<SESSION_OVERRIDE_OR_EMPTY>'
```

Store as `stage1`. Log: `Stage 1: {stage1.candidates} candidates persisted to .cap/learning/candidates/`.

**If `stage1.errors.length > 0`, ABORT promotion.** Stage 1 ran on a partial corpus (one or more `getSignals` collectors failed — overrides, memory-refs, or regrets). Promoting candidates against an incomplete signal set would burn the LLM budget on data we know is missing. Surface the error list to the user and stop:

```
Stage 1 produced errors — refusing to promote candidates to Stage 2.
Errors: {stage1.errors}
Re-run /cap:learn after fixing the underlying signal-collector failures, or
inspect .cap/learning/signals/ to confirm the JSONL files are readable.
```

Skip Steps 3-7 in this case; the user resolves the I/O issue and re-runs.

If `feature_filter` is set, the orchestrator filters the candidate set in Step 3 by intersecting `candidate.featureId` with the filter.

## Step 3: Determine Stage-2 promotions

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const pipeline = require('./cap/bin/lib/cap-pattern-pipeline.cjs');

const root = process.cwd();
const candidatesDir = pipeline.candidatesDir(root);
const filterRaw = process.argv[1] || '';
const featureFilter = filterRaw ? new Set(filterRaw.split(',').map(s => s.trim())) : null;

const candidates = [];
if (fs.existsSync(candidatesDir)) {
  for (const f of fs.readdirSync(candidatesDir)) {
    if (!f.endsWith('.json')) continue;
    try { candidates.push(JSON.parse(fs.readFileSync(path.join(candidatesDir, f), 'utf8'))); } catch (_e) {}
  }
}

// AC-2 threshold check + optional feature filter.
const promotable = candidates.filter(c => {
  if (!pipeline.checkThreshold(c)) return false;
  if (featureFilter && c.featureId && !featureFilter.has(c.featureId)) return false;
  return true;
});
console.log(JSON.stringify({
  total: candidates.length,
  promotable: promotable.length,
  ids: promotable.map(c => c.candidateId),
}));
" '<FEATURE_FILTER_OR_EMPTY>'
```

Store as `gate`. Log: `Stage 2 candidates: {gate.promotable} of {gate.total} cleared the threshold.`

If `dry_run`: stop here, print the gate summary, do NOT write briefings or pattern files.

## Step 4: Promote within budget; overflow → deferred queue

<!-- @cap-todo(ac:F-071/AC-4) Budget hard-limit — promote at most `ctx.remaining` candidates this session. Overflow lands in queue/ with deferred:budget. -->
<!-- @cap-risk(F-071/AC-4) Every promotion path goes through this step. A regression that bypasses ctx.remaining would silently burn through the user's wallet. -->

For each promotable candidate (sorted by score descending):

- If `promoted < ctx.remaining`:
  1. Allocate `P-NNN` via `pipeline.allocatePatternId(root)`.
  2. Build briefing: `pipeline.buildBriefing(candidate, root, { id })` — writes `.cap/learning/queue/P-NNN.md`.
  3. **Hand off to the outer agent**: read the briefing markdown, generate ONE of L1 / L2 / L3 (your choice based on the briefing), and write the result to `.cap/learning/patterns/P-NNN.json` with the documented schema:

   ```json
   {
     "id": "P-NNN",
     "createdAt": "<ISO timestamp>",
     "level": "L1" | "L2" | "L3",
     "featureRef": "F-NNN" | null,
     "source": "llm",
     "degraded": false,
     "confidence": 0.0-1.0,
     "suggestion": { /* L1 / L2 / L3 shape */ },
     "evidence": { "candidateId": "<hex>", "signalType": "...", "count": <int>, "topContextHashes": [...] }
   }
   ```

  4. After the result is written, increment session usage so the budget is consumed:

   ```bash
   node -e "
   const t = require('./cap/bin/lib/cap-telemetry.cjs');
   t.recordLlmCall(process.cwd(), {
     model: 'claude-opus-4-7',
     promptTokens: 0, completionTokens: 0, durationMs: 0,
     sessionId: '<SESSION_ID>',
     commandContext: { command: '/cap:learn', feature: 'F-071' },
   });
   "
   ```

- Else (budget exhausted):
  1. Allocate `P-NNN`.
  2. Build a deferred briefing: `pipeline.buildBriefing(candidate, root, { id, deferred: true })` — the markdown carries `deferred: budget` in frontmatter.
  3. The candidate keeps its allocated ID across sessions; next `/cap:learn` invocation will see the queued briefing and pick up where this session left off.

**Privacy contract — the briefing markdown contains ONLY counts and hex hashes.** AC-3 forbids any other content. The orchestrator must never inject raw paths, decision text, or signal records into the briefing or the pattern result. (F-071/AC-3)

## Step 5: Persist degraded-path patterns (AC-5)

<!-- @cap-todo(ac:F-071/AC-5) When Stage 2 didn't run for a candidate this session (LLM unavailable, network errors, outer agent didn't process the briefing), persist the heuristic-only L1 suggestion with degraded:true. -->

For each promotable candidate that **did not** receive a Stage 2 result during this session (i.e. no `.cap/learning/patterns/P-NNN.json` was written by the outer agent), call:

```bash
node -e "
const pipeline = require('./cap/bin/lib/cap-pattern-pipeline.cjs');
const fs = require('node:fs');
const candidate = JSON.parse(process.argv[1]);
const id = process.argv[2];
pipeline.markDegraded(process.cwd(), id, candidate);
" '<CANDIDATE_JSON>' '<P_NNN>'
```

Skip degraded persistence for candidates that are deferred to a future session — they're already represented by their queue entry.

## Step 6: Final report

```
cap:learn complete.

Session: {sessionId}
Budget: {budget} ({budgetSource}) · Used: {used} · Remaining (post-run): {remaining_post}

Stage 1: {stage1.candidates} candidates
Stage 2: {promoted} promoted via LLM, {degraded} persisted heuristic-only (degraded:true), {deferred} deferred to .cap/learning/queue/ (deferred:budget)

Patterns this run:
  P-NNN: level={L1|L2|L3} source={llm|heuristic} confidence={0.0-1.0} feature={F-NNN}
  ...

{If deferred > 0:}
Deferred briefings will be processed on the next /cap:learn invocation when budget is available.

{If errors:}
Errors:
  - {error}
```

## Step 7: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:learn',
  lastCommandTimestamp: new Date().toISOString(),
});
"
```

</process>
