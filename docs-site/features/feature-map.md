# The Feature Map

`FEATURE-MAP.md` is the **single source of truth** in a CAP Pro project. It replaces the conventional pile of `ROADMAP.md` + `REQUIREMENTS.md` + `STATE.md` + `MILESTONES.md` + `VERIFICATION.md` with one file (or a sharded folder, see below).

## What's in it

Each entry is a **feature** with:

- A **stable ID** (`F-NNN` for single-app projects, `F-<App>-<Slug>` for monorepos)
- A **title** and short description
- A **state** in the lifecycle: `planned → prototyped → tested → shipped`
- A list of **acceptance criteria (ACs)**, each individually addressable (`F-001/AC-3`)
- Optional **risks**, **decisions**, **non-goals**

Example entry:

```markdown
## F-Hub-Spotlight-Carousel — Spotlight banner with rotating slides

**State:** prototyped

**Description:** Hero banner on the marketing homepage with auto-advancing
slides, manual navigation, and reduced-motion fallback.

**Acceptance criteria:**

- AC-1: Renders an array of slides as a horizontally laid-out carousel
- AC-2: Auto-advances every 5 s; pauses on hover
- AC-3: Respects `prefers-reduced-motion: reduce` and disables auto-advance
- AC-4: Manual navigation via arrow buttons + keyboard arrows
- AC-5: ARIA-compliant — slide changes announce to screen readers

**Risks:**
- AC-3 fallback needs separate test (jsdom doesn't support media queries by default)
```

## How it's maintained

You don't maintain it manually. It is **generated**:

1. `/cap:brainstorm` populates new feature entries from conversation
2. `/cap:prototype` updates the state to `prototyped` once code is written
3. `/cap:scan` extracts `@cap-feature` and `@cap-todo` tags from the code and refreshes the entries
4. `/cap:test` updates the state to `tested` once all ACs have green tests
5. `/cap:review` updates the state to `shipped` once both review stages pass

You only edit it directly when you want to add or rephrase ACs.

## Two layouts: monolithic and sharded

CAP Pro supports two layouts for `FEATURE-MAP.md`:

### Monolithic (default)

A single file containing all feature blocks. Simple, readable, works fine up to ~80 features.

```
FEATURE-MAP.md
```

### Sharded (recommended at scale)

`FEATURE-MAP.md` becomes a thin **index** (one line per feature: `id | state | title`). Each feature lives in its own file under `features/<ID>.md`.

```
FEATURE-MAP.md          # thin index, ~5 KB
features/
  F-Hub-Spotlight.md    # ~10–30 KB per feature
  F-Hub-Pricing.md
  F-Auth-Login.md
  ...
```

**Why shard?** Agent reads consume just the index plus the *active* feature, typically a **10–50× token reduction**. For a project with 100 features, sharded layout means agents read ~30 KB (index + active feature) instead of ~3 MB.

### Migrating to sharded

```
/cap:migrate-feature-map --apply
```

Dry-run by default. Byte-lossless extraction. Automatic backup. All CAP Pro read/write APIs detect the layout transparently — no other code changes needed.

## Feature IDs

Two forms coexist (a project may mix them):

- **`F-NNN`** — zero-padded number, e.g. `F-001`, `F-042`. Good for small / single-app projects. The CAP Pro repo itself uses this form.
- **`F-<App>-<Slug>`** — descriptive ID, e.g. `F-Hub-Spotlight-Carousel`, `F-Auth-OAuth-Github`. Recommended for new features in monorepo apps. Gives context without loading the feature block.

The ID is the only shared key between the Feature Map and `.cap/SESSION.json` — loose coupling.

## State transitions

```
[planned] ──prototype──▶ [prototyped] ──test──▶ [tested] ──review──▶ [shipped]
                              │  ▲
                              │  │
                              └──┘
                            iterate
```

Re-entry is allowed. A `shipped` feature with a new bug drops back to `prototyped` until it's re-tested.

## What's NOT in the Feature Map

Things that live elsewhere:

- **Code** — lives in your codebase, tagged with `@cap-feature` / `@cap-todo`
- **Tests** — live next to the code
- **Decisions about the architecture** — `.cap/memory/decisions.md`
- **Pitfalls / gotchas** — `.cap/memory/pitfalls.md`
- **Session state** — `.cap/SESSION.json` (gitignored)
- **Snapshots** — `.cap/snapshots/<id>.md` + `index.jsonl`

The Feature Map is the **product spec**, not the engineering log.
