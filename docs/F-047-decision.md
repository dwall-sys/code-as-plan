# F-047: Unified Feature Anchor Block — Decision Record

**Date:** 2026-04-20
**Status:** shipped (opt-in)

## Context

CAP v1–v2 uses a fragmented tag model:

```js
// @cap-feature(feature:F-001, primary:true)
// @cap-todo(ac:F-001/AC-1) Parse tags from source files
// @cap-todo(ac:F-001/AC-2) Support monorepos
function scanDirectory() { … }
```

Three tags, three separate parse sites, zero explicit grouping. The scanner reconstructs
feature-to-file-to-AC relationships by inference (matching `feature` keys, resolving bare
`AC-N` references against the nearest `@cap-feature` above). This works but produces
known failure modes:

1. **Metadata drift.** An `AC-N` reference loses its `feature:` context when surrounding
   code moves — the scanner falls back to "the nearest `@cap-feature` in the file",
   which silently reassigns ownership.
2. **Parser ambiguity.** `@cap-feature(feature:F-001)` and `@cap-feature(feature:F-001, primary:true)`
   on two different files both claim the feature; primary detection is heuristic
   (tag-density-weighted) rather than explicit. F-045 already added `primary:true` as an
   opt-in disambiguator, but the convention is easy to miss.
3. **Reader load.** Humans (and AI agents) scanning a 500-line module encounter three
   separate tag annotations across different line ranges; they must mentally correlate
   them. The unified block places all feature-level metadata in one adjacent token.
4. **Migration impossibility.** A v3 change that renamed `@cap-todo(ac:…)` to
   `@cap-ac(…)` would require rewriting every tag across every file. A unified anchor
   makes format evolution a block-level change with one write per file.

## Decision

Introduce a new unified anchor syntax:

```js
/* @cap feature:F-001 acs:[AC-1,AC-2] role:primary */
```

Equivalent across languages via the comment delimiter change:

```py
# @cap feature:F-001 acs:[AC-1,AC-2] role:primary
```

```html
<!-- @cap feature:F-001 acs:[AC-1,AC-2] role:primary -->
```

The anchor is parsed by `cap-anchor.parseAnchorLine()` and expanded by
`expandAnchorToTags()` into the SAME `CapTag[]` shape the legacy scanner produces. Every
downstream consumer — `buildAcFileMap`, `cap-deps`, `cap-completeness`, `cap-reconcile` —
works unchanged.

## Key constraints

- **Opt-in.** `.cap/config.json → unifiedAnchors.enabled=true` is required. When the flag
  is false (default), scanner ignores unified blocks entirely. Projects that never flip
  the flag see zero behaviour change.
- **Additive migration.** The migration tool (`/cap:migrate-tags`) inserts unified blocks
  near the top of each file but does **not** delete legacy fragmented tags. Both formats
  coexist during the deprecation window. A separate cleanup pass (future F-0XX) can
  remove the legacy tags once the unified block is proven stable in the consumer
  project.
- **Language-agnostic body.** The content inside the comment is always
  `@cap key:value key:value …`. Only the comment delimiters vary by language. This
  allows one parser to serve every supported language without special cases.

## Consequences

**Positive**

- **Single source of truth per feature per file.** The anchor block collapses
  feature-level metadata into one location. Moving the block moves all related tags
  atomically.
- **Explicit AC ownership.** `acs:[AC-1,AC-3]` is a declaration, not an inference. The
  scanner can now warn cleanly when an AC is referenced in a file but is not listed in
  that file's anchor.
- **Cleaner primary designation.** `role:primary` replaces the separate `primary:true`
  flag on `@cap-feature`. One attribute, one canonical name.
- **Migration tooling.** `/cap:migrate-tags` demonstrates the conversion is mechanical
  and reversible — the inverse operation (expand anchor → fragmented tags) is trivial.

**Negative**

- **Dual parsing surface.** Scanner now has two code paths (legacy regex + anchor parser)
  plus a config-flag dispatch. Mitigated by sharing the `CapTag[]` output shape and
  co-locating both paths behind one `scanner.scanDirectory()` call.
- **Deprecation window ambiguity.** Until the full ecosystem migrates, the same file may
  carry both the unified block and the legacy tags — a consumer must treat them as
  equivalent and deduplicate by (feature, ac). Mitigated by the tag expansion emitting
  identical `CapTag` objects regardless of source.
- **Format evolution debt.** If CAP v4 introduces yet another tag format, the migration
  pattern repeats. Accepted: the value of one canonical syntax per CAP major is higher
  than the recurring cost of migration tools.

## Measurable benefit

1. **Parser ambiguity surface area**: 2 legacy regexes (`CAP_TAG_RE`,
   `LEGACY_TAG_RE`) vs. 1 anchor regex. Incremental cost: one file, ~150 lines.
2. **Tag-to-file ratio for F-049 evidence**: the real repo has ~250 `@cap-*` tags across
   ~50 features; consolidating AC-bound tags would reduce this to ~50 anchor blocks plus
   some residual `@cap-risk`/`@cap-decision` notes.
3. **Human reading cost**: unified anchor sits adjacent to `@cap-feature` top comment,
   eliminating mid-file scroll-hunting for bound ACs.

Benefits (1) and (3) are structural. Benefit (2) is measurable: scan the same repo
before/after migration and count tag lines.

## Rollback

Migration is additive — legacy tags remain in place — so a rollback simply means:

1. Flip `.cap/config.json → unifiedAnchors.enabled` back to `false`.
2. Scanner ignores unified blocks.
3. (Optional) Delete the inserted anchor blocks manually or with a sed one-liner
   targeting `^\s*(//|#|\*|<!--)?\s*/\* @cap` and its comment variants.

No feature-map state is touched by the migration. No tests need to be rewritten. No
downstream consumer knows the difference.
