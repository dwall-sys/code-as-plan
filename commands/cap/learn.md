---
name: cap:learn
description: "Extract patterns from F-070 learning signals — Stage 1 deterministic heuristics + Stage 2 LLM-briefing pattern (counts + hashes only). Promotes candidates that hit the threshold (>=3 overrides OR >=1 regret) within the per-session LLM budget. Subcommands: --unlearn P-NNN reverses an applied pattern; --retract-check runs the 5-session post-apply check."
argument-hint: "[--features F-NNN] [--dry-run] [--budget N] [--session SID] [--unlearn P-NNN] [--retract-check] [review]"
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

## Step 6.5: Refresh fitness scores (F-072 courtesy pass)

<!-- @cap-decision(F-072/D7) /cap:learn auto-refreshes fitness as a courtesy. Additive step (Step 6.5) — does NOT refactor Steps 0–6/7. F-073 / F-074 will read these records, so keeping them fresh after every learn invocation reduces "stale fitness" foot-guns. Cost is bounded by the F-072 perf probe (<500ms for 100 patterns × 1000 signals). -->

Run a fitness pass over every persisted pattern AND auto-mark expired ones (no usage over 20 sessions). The pass is idempotent: re-running yields the same per-pattern record (AC-7 determinism).

```bash
node -e "
const fitness = require('./cap/bin/lib/cap-fitness-score.cjs');
const root = process.cwd();
const result = fitness.runFitnessPass(root);
console.log(JSON.stringify({
  recorded: result.recorded.length,
  expired: result.expired.length,
  expiredIds: result.expired,
  errors: result.errors,
}, null, 2));
"
```

Surface in the Step 6 final report as `Fitness: {recorded} refreshed, {expired} marked expired`. Errors here are non-fatal — log them but do not fail the run; the pattern pipeline already wrote its outputs and the user shouldn't lose the run on a fitness-side hiccup.

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

## Subcommand: `/cap:learn --unlearn P-NNN`

<!-- @cap-feature(feature:F-074) Pattern Unlearn — reverses an applied pattern, writes the unlearn audit, creates a `learn: unlearn P-NNN` commit. -->
<!-- @cap-todo(ac:F-074/AC-3) `/cap:learn unlearn <P-ID>` generates a reverse patch, applies it, and commits as `learn: unlearn P-NNN`. -->
<!-- @cap-todo(ac:F-074/AC-4) Writes the unlearn audit at .cap/learning/unlearned/P-NNN.json with reason + ts + commitHash. -->
<!-- @cap-todo(ac:F-074/AC-7) Idempotent — second invocation on already-unlearned P-NNN is a no-op. -->

When `$ARGUMENTS` contains `--unlearn P-NNN`, skip Steps 1–7 above and run this subcommand instead. The unlearn path is independent of Stage 1 / Stage 2 / fitness — it only reverses an already-applied pattern.

**Steps:**

1. Parse the P-NNN id from `--unlearn P-NNN`. Validate it matches `^P-\d+$`. If not, abort with `invalid pattern id`.
2. Call `unlearnPattern`:

```bash
node -e "
const apply = require('./cap/bin/lib/cap-pattern-apply.cjs');
const id = process.argv[1];
const result = apply.unlearnPattern(process.cwd(), id, { reason: 'manual' });
console.log(JSON.stringify(result, null, 2));
" '<P_NNN>'
```

3. Report the outcome:
   - `{ unlearned: true, commitHash, audit }` → log: `Unlearned P-NNN. Commit: <commitHash>. Audit: .cap/learning/unlearned/P-NNN.json`
   - `{ unlearned: false, reason: 'already-unlearned', priorRecord }` → log: `P-NNN was already unlearned at <priorRecord.unlearnedAt>. No action.` (Idempotent — AC-7.)
   - `{ unlearned: false, reason: 'l3-drift', commitHashToRevert }` → log: `Refusing to unlearn P-NNN — the L3 target file has drifted since apply. Resolve manually with: git revert <commitHashToRevert>`. Surface this prominently — the user must intervene.
   - `{ unlearned: false, reason: 'apply-not-found' }` → log: `P-NNN was never applied. Nothing to unlearn.`
   - `{ unlearned: false, reason: 'pending-hook-fail', error }` → log: `Pre-commit hook failed: <error>. The reverse patch is staged. Resolve and retry.`
4. Update session (same as Step 7 above), but with `lastCommand: '/cap:learn --unlearn'`.

**Privacy contract — no signal data flows through this path.** Unlearn is pure git + file ops; F-074 never reads override / memory-ref / regret JSONLs during unlearn.

## Subcommand: `/cap:learn --retract-check`

<!-- @cap-feature(feature:F-074) 5-session post-apply check — auto-flags patches whose Layer-1 override-rate worsens. -->
<!-- @cap-todo(ac:F-074/AC-5) For each applied pattern: when post-apply session count crosses 5, compare current Layer-1 to snapshot. If worse, append to retract-recommendations.jsonl. -->
<!-- @cap-todo(ac:F-074/AC-6) F-073 (review board, future) reads listRetractRecommended() and labels patterns "Rückzug empfohlen". -->

When `$ARGUMENTS` contains `--retract-check`, run the 5-session post-apply check:

```bash
node -e "
const apply = require('./cap/bin/lib/cap-pattern-apply.cjs');
const result = apply.runRetractCheck(process.cwd());
console.log(JSON.stringify({
  checked: result.checked.length,
  recommended: result.recommended,
  errors: result.errors,
}, null, 2));
"
```

Surface in a final report:
- `Retract check: {checked} applied patterns scrutinised, {recommended.length} flagged for retraction.`
- For each recommended id: `  - <P-NNN> — Layer-1 worse than snapshot (see .cap/learning/retract-recommendations.jsonl).`
- Errors are non-fatal — log them but exit 0.

## Subcommand: `/cap:learn review`

<!-- @cap-feature(feature:F-073) Pattern Review Board — gated user-facing review of pending patterns. -->
<!-- @cap-decision(F-073/D2) Briefing-pattern review UX (mirrors F-071's LLM Skill-Briefing): the skill renders board.md and INSTRUCTS the outer agent to call applyPattern / unlearnPattern / skipPattern / rejectPattern per pattern. NO interactive CLI. -->
<!-- @cap-decision(F-073/D4) Threshold gate: ≥1 high-confidence (layer2.ready=true AND value>=0.75 AND n>=5) OR ≥3 candidates of any kind. Below the gate, the skill exits 0 silently with "no review needed". -->
<!-- @cap-todo(ac:F-073/AC-1) Review board lists pending patterns (persisted ∧ ¬applied ∧ ¬unlearned ∧ ¬archived ∧ ¬skipped/rejected this session). -->
<!-- @cap-todo(ac:F-073/AC-2) Threshold gate: only show when high-confidence or any-kind threshold met. -->
<!-- @cap-todo(ac:F-073/AC-5) Stale-archive sweep before building the board: patterns un-reviewed > 7 sessions move to archive/. -->
<!-- @cap-todo(ac:F-073/AC-6) Per-pattern options: Approve / Reject / Skip [/ Unlearn when retract-recommended]. -->
<!-- @cap-todo(ac:F-073/AC-7) Approve → applyPattern; exit 0 ONLY when every approve produced applied:true. Any apply failure → non-zero exit + failure description. -->

When `$ARGUMENTS` contains `review` (and not `--unlearn` / `--retract-check`), run the review board flow. The review path is independent of Stage 1 / Stage 2 / fitness — it consumes already-persisted patterns + fitness + apply-state.

**Steps:**

1. Compute the gate first — bail early if there's nothing to review.

   ```bash
   node -e "
   const review = require('./cap/bin/lib/cap-learn-review.cjs');
   const should = review.shouldShowBoard(process.cwd());
   console.log(JSON.stringify({ shouldShow: should }));
   "
   ```

   If `shouldShow === false`: log `cap:learn review — no review needed (threshold not met).` and exit 0.

2. Sweep stale patterns to archive/ BEFORE rendering the board. This keeps the board free of patterns the user has long since drifted past.

   ```bash
   node -e "
   const review = require('./cap/bin/lib/cap-learn-review.cjs');
   const result = review.archiveStalePatterns(process.cwd());
   console.log(JSON.stringify({ archived: result.archived, errors: result.errors }, null, 2));
   "
   ```

   Surface `Archived stale patterns: {archived.length}` and forward the ids in the final report. Errors are non-fatal — log them but continue.

3. Build + render + write the board.

   ```bash
   node -e "
   const review = require('./cap/bin/lib/cap-learn-review.cjs');
   const root = process.cwd();
   const board = review.buildReviewBoard(root);
   const md = review.renderBoardMarkdown(board);
   const ok = review.writeBoardFile(root, md);
   console.log(JSON.stringify({
     written: ok,
     eligible: board.eligible.length,
     thresholdMet: board.threshold.met,
     thresholdReason: board.threshold.reason,
   }, null, 2));
   "
   ```

   Log: `Board written to .cap/learning/board.md ({eligible} patterns).`

4. **Hand off to the outer agent.** Read `.cap/learning/board.md`. For each pattern listed there, decide ONE of approve / reject / skip / unlearn:

   - **approve** → call `cap-pattern-apply.applyPattern(projectRoot, patternId)`. Capture `result.commitHash` and `result.applied`. **If `applied !== true`, the skill MUST surface the failure and exit non-zero (F-073/AC-7).** Do not retry silently. The failure reason is `result.reason` (e.g. `'pending-hook-fail'`, `'l3-target-not-allowed'`).
   - **unlearn** → call `cap-pattern-apply.unlearnPattern(projectRoot, patternId, { reason: 'manual' })`. Surface drift / refusal cases as documented in `--unlearn` above.
   - **skip** → call `cap-learn-review.skipPattern(projectRoot, patternId)`. Per-session only — a new session re-shows the pattern.
   - **reject** → call `cap-learn-review.rejectPattern(projectRoot, patternId)`.

   Example single-pattern call (the agent inlines these per pattern):

   ```bash
   node -e "
   const apply = require('./cap/bin/lib/cap-pattern-apply.cjs');
   const id = process.argv[1];
   const result = apply.applyPattern(process.cwd(), id);
   console.log(JSON.stringify(result, null, 2));
   if (result.applied !== true) process.exit(1);
   " '<P_NNN>'
   ```

   ```bash
   node -e "
   const review = require('./cap/bin/lib/cap-learn-review.cjs');
   const id = process.argv[1];
   const ok = review.skipPattern(process.cwd(), id);
   console.log(JSON.stringify({ skipped: ok }));
   " '<P_NNN>'
   ```

5. **Exit-code propagation (F-073/AC-7).** If ANY approve action returned `applied !== true`, exit non-zero with a structured report:

   ```
   cap:learn review — apply failures detected:
     - P-001: applied=false, reason=pending-hook-fail
     - P-007: applied=false, reason=l3-target-not-allowed
   ```

   Exit 0 only when every approve produced `applied:true`. Skip / reject / unlearn outcomes do NOT affect the exit code (they're not gated by AC-7).

6. After the board has been processed, clear the pending flag.

   ```bash
   node -e "
   const review = require('./cap/bin/lib/cap-learn-review.cjs');
   review.clearBoardPendingFlag(process.cwd());
   "
   ```

7. Final report:

   ```
   cap:learn review complete.

   Eligible: {eligible}
   Approved: {n} (commits: {hashes})
   Skipped: {n}
   Rejected: {n}
   Unlearned: {n}
   Archived (stale): {n}

   {If any apply failed:}
   ✗ Apply failures: {list}  (exit non-zero)
   ```

8. Update session (same as Step 7 in the main flow), but with `lastCommand: '/cap:learn review'`.

**Privacy contract.** The board contains only structured metadata — counts, hashes, ids, fitness numbers. No raw paths, no decision text, no record verbatim. The Stop-hook (`hooks/cap-learn-review-hook.js`) flags pending reviews via `.cap/learning/board-pending.flag`; it never spawns the skill itself.
