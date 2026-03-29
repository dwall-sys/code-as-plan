# Phase 6: PRD-to-Prototype Pipeline - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Overhaul `/gsd:prototype` to ingest a PRD file, extract acceptance criteria, and drive autonomous prototype generation with ARC annotations. The result is a functional prototype where each AC from the PRD appears as a @gsd-todo tag in the code. Supports autonomous mode (default) and --interactive step-by-step mode.

</domain>

<decisions>
## Implementation Decisions

### PRD Input Resolution
- **D-01:** PRD input follows a priority chain: `--prd <path>` flag first, then auto-detect `.planning/PRD.md`, then prompt user to paste content into chat. All three paths produce the same internal PRD content for downstream processing.
- **D-02:** PRD ingestion happens in the command orchestrator (`commands/gsd/prototype.md`), NOT in the gsd-prototyper agent. The agent receives PRD-enriched context via the Task() prompt. This keeps gsd-prototyper reusable and format-agnostic (per research decision).

### Requirements Confirmation Gate
- **D-03:** After parsing the PRD, the command shows a numbered list of extracted acceptance criteria to the user. User must confirm before any code generation begins. This is mandatory -- no code path skips confirmation (except `--non-interactive` for CI).
- **D-04:** The confirmation output format: numbered list of ACs with brief descriptions. User responds "yes" to proceed or provides corrections.

### Autonomous Iteration Loop
- **D-05:** After initial prototype generation, the command enters an autonomous loop: extract-plan → iterate (plan+execute) → check completeness → repeat. Hard cap of 5 iterations to prevent divergence.
- **D-06:** The loop stops when: (a) all @gsd-todo tags from PRD ACs are resolved, (b) hard cap reached, or (c) an unresolvable ambiguity is encountered (triggers user question).
- **D-07:** At each iteration, the command checks CODE-INVENTORY.md for remaining @gsd-todo tags. When count reaches zero (or only non-AC todos remain), the prototype is considered complete.

### AC-to-Tag Mapping
- **D-08:** Each acceptance criterion from the PRD becomes exactly one @gsd-todo tag in the prototype code. The tag includes `ref:AC-N` metadata linking back to the criterion number.
- **D-09:** The gsd-prototyper receives the parsed AC list as structured input in its Task() prompt, alongside existing PROJECT.md/REQUIREMENTS.md context.

### --interactive Mode
- **D-10:** When `--interactive` flag is present, the autonomous loop pauses after each iteration. Shows: files changed, @gsd-todo count remaining, what was accomplished. User can continue, adjust direction, or stop.
- **D-11:** Default behavior (no flag) is fully autonomous -- only stops for unresolvable ambiguities or hard cap.

### Claude's Discretion
- Exact prompt structure for passing PRD context to gsd-prototyper
- How to handle malformed or minimal PRDs (graceful degradation)
- Whether extract-plan runs after every iteration or only at loop boundaries
- Loop termination heuristics beyond @gsd-todo count

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Command & Agent
- `commands/gsd/prototype.md` -- Current prototype command (will be modified to add PRD ingestion and iteration loop)
- `agents/gsd-prototyper.md` -- Prototyper agent (stays UNCHANGED per research decision D-02)

### ARC Standard
- `get-shit-done/references/arc-standard.md` -- Tag syntax, comment anchor rules, metadata conventions

### CLI Tools
- `get-shit-done/bin/gsd-tools.cjs` -- parseNamedArgs() for flag parsing, extract-tags subcommand for CODE-INVENTORY.md generation

### Research
- `.planning/research/ARCHITECTURE.md` -- PRD pipeline architecture, data flow, component inventory
- `.planning/research/FEATURES.md` -- Feature landscape, table stakes, differentiators, anti-features
- `.planning/research/PITFALLS.md` -- Loop divergence prevention, PRD parsing brittleness, confirmation gate requirement

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `commands/gsd/prototype.md` -- Existing command structure (frontmatter, context refs, process steps) is the template for the overhaul
- `agents/gsd-prototyper.md` -- Agent already reads PROJECT.md, REQUIREMENTS.md, ROADMAP.md, arc-standard.md and supports --phases scoping
- `gsd-tools.cjs extract-tags` -- Already produces CODE-INVENTORY.md from @gsd-tags, used in extract-plan command
- `commands/gsd/iterate.md` -- Existing iterate loop (extract → plan → approve → execute) can be reused as inner loop

### Established Patterns
- Command orchestrators pass context to agents via Task() prompt enrichment (see iterate.md, annotate command)
- parseNamedArgs() in gsd-tools.cjs handles flag parsing for all commands
- Auto-chain pattern: command runs step, checks result, chains next step (see annotate → extract-plan pattern)
- AskUserQuestion for confirmation gates (see iterate.md approval gate)

### Integration Points
- `commands/gsd/prototype.md` process section gets extended with PRD steps before spawning agent
- `gsd-tools.cjs extract-tags` runs after each prototype iteration to refresh CODE-INVENTORY.md
- `/gsd:iterate` logic (or its components) can be embedded in the loop for plan+execute cycles

</code_context>

<specifics>
## Specific Ideas

- User described the prototype command as "the starting point" -- it should feel like a complete entry point, not a partial step
- PRD should support flexible formats: formal ACs, user stories, bullet points, even prose paragraphs
- The autonomous loop should "just work" for most cases, with --interactive as the escape hatch
- End result must be a "functional prototype you can look at and basically use"

</specifics>

<deferred>
## Deferred Ideas

- PRD template scaffolding (`/gsd:prototype --init-prd`) -- deferred to v1.2+
- Remote PRD URLs (Notion, Confluence links) -- out of scope per REQUIREMENTS.md
- Review-to-iterate chain (`--fix` flag) -- deferred to v1.2+

</deferred>

---

*Phase: 06-prd-to-prototype-pipeline*
*Context gathered: 2026-03-29*
