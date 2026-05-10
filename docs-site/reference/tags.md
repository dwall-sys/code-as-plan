# Tag Reference

All tags recognised by CAP Pro's tag scanner. Two are mandatory; the rest are auto-generated.

## Mandatory primary tags

### `@cap-feature`

```
@cap-feature(feature:<id>, ac:<n>) <one-line description>
```

| Field | Required | Format |
|---|---|---|
| `feature:` | yes | Feature Map ID, e.g. `F-001`, `F-Hub-Spotlight` |
| `ac:` | yes | AC number this code satisfies, e.g. `1`, `2`, `3` |
| description | yes | One-line description |

Multiple `@cap-feature` tags on the same code block are allowed.

### `@cap-todo`

```
@cap-todo(ac:<feature>/<ac>) <one-line description>
@cap-todo(ac:<feature>/<ac>, risk:<low|medium|high>) <one-line description>
@cap-todo(decision:<topic>) <one-line description>
```

| Field | Required | Values |
|---|---|---|
| `ac:` | one of `ac:` or `decision:` | `<feature>/<ac>`, e.g. `F-001/AC-3` |
| `decision:` | one of `ac:` or `decision:` | Free-form topic, e.g. `cache-invalidation` |
| `risk:` | optional | `low`, `medium`, `high` |
| description | yes | One-line description |

## Auto-generated tags

These appear from `/cap:scan`, `cap-historian`, and the memory pipeline. You don't usually write them by hand, but they're valid in source code.

### `@cap-history`

```
@cap-history(sessions:<N>, edits:<M>, since:<DATE>, learned:<DATE>) <description>
```

Hotspot marker — added by `cap-curator` for files changed in N or more sessions over the last 30 days.

### `@cap-decision`

```
@cap-decision(learned:<DATE>) <one-line decision>
```

An architectural decision recorded from a session. Surfaced in `.cap/memory/decisions.md`.

### `@cap-pitfall`

```
@cap-pitfall(learned:<DATE>) <one-line pitfall description>
```

A gotcha learned from a session. Surfaced in `.cap/memory/pitfalls.md`. `cap-architect MODE: REFACTOR` is **required** to consult these before suggesting splits.

### `@cap-risk`

```
@cap-risk(level:<low|medium|high>) <one-line risk description>
```

Risk callout, often auto-promoted from a `@cap-todo risk:high` that has been open for >7 days.

## Comment syntax

The scanner uses regex (with `dotAll` flag), not an AST. It works in any language with one of these comment syntaxes:

| Style | Languages |
|---|---|
| `// @cap-feature(…) description` | TS, JS, Go, Rust, C, C++, Java, C#, Swift, Kotlin |
| `# @cap-feature(…) description` | Python, Ruby, shell, YAML, TOML |
| `/* @cap-feature(…) description */` | TS, JS, Go, Rust, C, C++, Java, C#, CSS |
| `<!-- @cap-feature(…) description -->` | HTML, Markdown, XML |

Multi-line tags work — the regex uses `dotAll`. So this is valid:

```ts
/* @cap-feature(feature:F-001, ac:1)
   This implementation handles the happy path; the error path is tagged
   below as @cap-todo. */
```

## Rules of thumb

- **One tag, one purpose.** Don't try to cram multiple ACs into one tag — write multiple tags.
- **Tags travel with code.** When you cut-paste code from one file to another, the tags come with it. The Feature Map auto-updates on next `/cap:scan`.
- **Don't reference the task that made the change** in tags. ("Added for ticket #123" rots; the code itself doesn't.)
- **Don't decorate.** `@cap-feature(...) calculates the cart total` is fine if `calculateCartTotal()` is the function name *and* the AC happens to be "cart total is correct" — but in that case the tag adds traceability, not redundancy. The test is "does this tag link to a Feature Map AC?". If yes, it earns its keep.

## Detecting orphaned tags

`/cap:scan` flags:

- **Orphaned tags** — `@cap-feature(feature:F-999, …)` where `F-999` doesn't exist in the Feature Map
- **Un-implemented ACs** — Feature Map ACs with no `@cap-feature` tag pointing to them
- **Stale `@cap-todo`** — open todos older than 30 days surface as risk

`/cap:reconcile` interactively walks through these and either fixes them, deletes them, or asks you what to do.
