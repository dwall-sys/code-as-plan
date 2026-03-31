# ARC Annotation Standard

**Version:** 1.0
**Stability:** Stable — tag names and parenthesized keys will not change in v1.x. New optional metadata keys may be added in future versions. Tag types will not be renamed.
**Purpose:** @gsd-tags embedded in source code comments are machine-readable planning metadata. They allow the tag scanner to extract CODE-INVENTORY.md and allow agents to understand code structure and intent without reading every file.

---

## Tag Syntax

Tags use a single-line structured format:

```
@gsd-<type>[(key:value, key:value)] Description text
```

The metadata block (parenthesized key-value pairs) is optional. All three of these are valid:

```
// @gsd-context JWT validation module — stateless, RS256 only
// @gsd-todo(phase:2) Add refresh token rotation
// @gsd-todo(phase:2, priority:high) Add refresh token rotation
```

Rules:
- Tags are single-line only — no multi-line tag bodies
- The `@gsd-` prefix is lowercase and case-sensitive
- Tag type names are lowercase (e.g., `context`, not `Context`)
- Description text runs to end of line after the optional metadata block
- Whitespace between the comment token and `@gsd-` is permitted

---

## Comment Anchor Rule

A tag is ONLY valid when it appears on a line where the first non-whitespace content is a comment-opening token.

Valid comment-opening tokens:
- `//` — C-style single-line comment (JavaScript, TypeScript, Go, Rust, Java, C, C++)
- `//+` — Variant single-line comment
- `/*` — C-style block comment opener
- `*` — Block comment continuation line (inside `/* ... */`)
- `#` — Hash comment (Python, Ruby, Shell, YAML)
- `--` — SQL single-line comment
- `"""` — Python docstring opener (triple double-quote)
- `'''` — Python docstring opener (triple single-quote)

**@gsd- appearing inside a string literal, URL path, or template literal is NOT a tag and the scanner will skip it.**

Side-by-side examples:

```
// @gsd-context Valid tag — anchored to comment token     (VALID)
const x = "// @gsd-todo this is NOT a tag";               (INVALID — inside string)
```

More examples:

```
# @gsd-constraint No external HTTP calls allowed          (VALID — hash comment)
url := "http://pkg.go.dev/@gsd-pattern/something"        (INVALID — inside string)
-- @gsd-context Partitioned by tenant_id                  (VALID — SQL comment)
const tmpl = `@gsd-todo fix this`                        (INVALID — template literal)
```

The scanner regex anchors to `^[ \t]*` (optional leading whitespace only) followed by the comment token, then optional whitespace, then `@gsd-`. Any line where non-whitespace content precedes the comment token does not match.

---

## Tag Types

| Tag | Purpose |
|-----|---------|
| @gsd-context | Explain WHY this code exists, what problem it solves, architectural context |
| @gsd-decision | Record a design/implementation choice and its rationale |
| @gsd-todo | Planned future work, optionally scoped to a phase |
| @gsd-constraint | Hard boundaries the code must respect (performance, security, compatibility) |
| @gsd-pattern | Document a reusable pattern established here that should be followed elsewhere |
| @gsd-ref | Cross-reference to another file, doc, issue, or external resource |
| @gsd-risk | Flag known risks, edge cases, or fragile areas |
| @gsd-api | Document a public API surface: contract, parameters, return shape |

---

### @gsd-context

Use `@gsd-context` to explain why a module, function, or block of code exists — what problem it solves and where it fits in the architecture. This is the most important tag type. Future maintainers and agents reading CODE-INVENTORY.md will use context tags to understand the codebase without reading every file. Place it near the top of a file or at the start of a significant function.

```
// @gsd-context(phase:1) Auth middleware — validates JWT on every protected route. Stateless, RS256 only.
```

---

### @gsd-decision

Use `@gsd-decision` to record a design or implementation choice and the reasoning behind it. Decisions are the "why we did it this way" that gets lost over time. Tag the exact location where the decision manifests in code so the rationale travels with the implementation. Include the alternatives considered when space permits.

```
// @gsd-decision Using jose over jsonwebtoken: jose is ESM-compatible and actively maintained. jsonwebtoken has no ESM export.
```

---

### @gsd-todo

Use `@gsd-todo` for planned future work, bug fixes not yet addressed, or features deferred to a later phase. The optional `phase:N` metadata ties the todo to a specific project phase so `extract-plan` can group planned work by phase. Use `priority:high` for items that block other work.

```
// @gsd-todo(phase:2, priority:high) Add refresh token rotation — currently tokens never expire
```

---

### @gsd-constraint

Use `@gsd-constraint` to document hard boundaries the code must respect: performance budgets, security requirements, compatibility limits, or regulatory rules. Constraints differ from decisions — a constraint is a non-negotiable boundary, not a choice. Annotate the code that enforces or depends on the constraint.

```
// @gsd-constraint Max response time 200ms — SLA requirement. Do not add synchronous I/O in this path.
```

---

### @gsd-pattern

Use `@gsd-pattern` to document a reusable pattern established at this location that should be followed elsewhere in the codebase. Patterns are standards-in-waiting: they describe a recurring structure, idiom, or convention that agents and developers should replicate rather than reinvent. Place the tag where the canonical implementation lives.

```
// @gsd-pattern Use sync.Once for all singleton initializations in this package — see Init() as the reference implementation
```

---

### @gsd-ref

Use `@gsd-ref` to create a cross-reference from code to another file, documentation page, issue tracker entry, pull request, or external resource. Refs preserve traceability: they connect an implementation decision to its origin. Use the `ref:` metadata key for machine-readable IDs.

```
// @gsd-ref(ref:ISSUE-142) Rate limiting logic — see docs/rate-limiting.md for the algorithm specification
```

---

### @gsd-risk

Use `@gsd-risk` to flag known risks, edge cases, fragile areas, or technical debt that could cause future failures. Risks are not todos (they may never need fixing) and not constraints (they describe potential problems, not rules). Tag the exact code location where the risk lives so it surfaces in CODE-INVENTORY.md risk reports.

```
// @gsd-risk(ref:ISSUE-142) Race condition possible if Init() called before DB connection pool is ready
```

---

### @gsd-api

Use `@gsd-api` to document a public API surface: its contract, parameter types, return shape, and any side effects. This tag is for the API boundary itself — exported functions, HTTP endpoints, public class methods, CLI interfaces. It gives agents reading CODE-INVENTORY.md a compact API reference without reading implementation code.

```
// @gsd-api POST /auth/token — body: {email, password} — returns: {token, expiresAt} or 401 on invalid credentials
```

---

## Metadata Keys

Metadata is a parenthesized comma-separated list of `key:value` pairs. Any key is valid. Conventional standard keys:

- `phase:<N>` — project phase this tag applies to (e.g., `phase:2`)
- `priority:<value>` — urgency level (`priority:high`, `priority:medium`, `priority:low`)
- `ref:<id>` — external reference (issue number, requirement ID, PR number, e.g., `ref:ISSUE-142`, `ref:REQ-AUTH-01`)

Examples:

```
// @gsd-todo(phase:2) Single key
// @gsd-todo(phase:2, priority:high) Two keys
// @gsd-risk(ref:ISSUE-142, priority:high) Two keys with external reference
// @gsd-context(phase:1) Single phase scoping
```

The scanner stores all metadata as a flat key-value object. Agents interpret keys by convention, not by schema enforcement. Future versions of the ARC standard may add new conventional keys — existing keys will not be renamed.

---

## Language Examples

### JavaScript / TypeScript

```typescript
// @gsd-context(phase:1) Auth middleware — validates JWT on every protected route
// @gsd-decision Using jose over jsonwebtoken: jose is ESM-compatible, no CommonJS issues
export async function authMiddleware(req, res, next) { ... }
```

```typescript
// @gsd-api POST /users — body: {email, password, name} — returns: {id, email, createdAt} or 400/409
// @gsd-constraint No plaintext passwords stored — bcrypt hash only, cost factor 12
export async function createUser(body: CreateUserBody): Promise<User> { ... }
```

### Python

```python
# @gsd-constraint No external HTTP calls from this module — must be pure compute
# @gsd-todo(phase:2, priority:high) Add caching layer for repeated signature verifications
def verify_token(token: str) -> dict:
    """
    @gsd-api Parameters: token (str) — raw JWT. Returns: decoded payload dict or raises AuthError.
    """
    ...
```

```python
# @gsd-decision Using bcrypt not argon2 — bcrypt is available on all target deployment platforms without custom compile
# @gsd-risk Memory: bcrypt is CPU-bound; under load this blocks the event loop in sync contexts
def hash_password(password: str) -> str:
    ...
```

### Go

```go
// @gsd-pattern Use sync.Once for all singleton initializations in this package
// @gsd-risk(ref:ISSUE-142) Race condition possible if Init() called before DB is ready
func Init() *DB { ... }
```

```go
// @gsd-context Connection pool — shared across all handlers, initialized once at startup
// @gsd-constraint Max 25 connections — production database limit. Do not increase without DBA approval.
var pool *sql.DB
```

### Rust

```rust
// @gsd-context FFI boundary to the C crypto library — unsafe block intentional
// @gsd-risk Memory safety: caller must ensure buf lives longer than the returned slice
unsafe fn decrypt_raw(buf: *const u8, len: usize) -> &'static [u8] { ... }
```

```rust
// @gsd-decision Chose ring over openssl: ring has a smaller attack surface and is pure Rust
// @gsd-constraint FIPS compliance required — ring is FIPS 140-2 validated for production use
fn init_crypto() -> CryptoContext { ... }
```

### SQL

```sql
-- @gsd-context Partitioned by tenant_id for query isolation — max 50K rows per partition
-- @gsd-constraint No cross-tenant JOINs allowed in this view
CREATE VIEW tenant_events AS ...
```

```sql
-- @gsd-decision Storing UTC timestamps as BIGINT (epoch ms) not TIMESTAMPTZ — avoids timezone conversion bugs in legacy importers
-- @gsd-todo(phase:3) Migrate to TIMESTAMPTZ once legacy importers are decommissioned
CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY,
    occurred_at BIGINT NOT NULL
);
```

### Shell

```sh
# @gsd-context Bootstraps the dev environment — must be idempotent
# @gsd-todo(phase:3) Add --dry-run flag for CI validation without side effects
set -euo pipefail
```

```sh
# @gsd-constraint Requires bash >=4.0 — uses associative arrays. macOS ships bash 3.2; install via Homebrew.
# @gsd-risk If HOME is unset this script silently writes to //.config — add guard before production use
main() {
    ...
}
```

---

## What the Scanner Extracts

For each @gsd-tag found in source code, the scanner produces one JSON object:

```json
{
  "type": "context",
  "file": "src/auth/jwt.js",
  "line": 12,
  "metadata": { "phase": "1" },
  "description": "JWT validation module — stateless, RS256 only",
  "raw": "// @gsd-context(phase:1) JWT validation module — stateless, RS256 only"
}
```

Field notes:
- `type` — the tag name without the `@gsd-` prefix (always lowercase)
- `file` — path relative to project root
- `line` — 1-based line number in the source file
- `metadata` — key-value object parsed from the parenthesized block; `{}` when no parenthesized keys are present; all values are strings
- `description` — text after the optional metadata block, trimmed of leading and trailing whitespace
- `raw` — the complete original line including the comment token, for reference and debugging

The scanner outputs an array of these objects. When writing CODE-INVENTORY.md, the scanner groups tags by type, then by file, within each type group.

---

## GSD Commands

`extract-plan` scans the project for all @gsd-tags and writes `.planning/prototype/CODE-INVENTORY.md` grouped by tag type and file, with a summary statistics table and a phase reference index. Run it after annotating code or after a significant annotation session to update the inventory.

`annotate` spawns gsd-annotator — an agent that reads existing source code alongside PROJECT.md and REQUIREMENTS.md to determine appropriate @gsd-tags and adds them inline as comments. On completion, `annotate` automatically runs `extract-plan` to produce an updated CODE-INVENTORY.md. Use `annotate` to retroactively add ARC annotations to an existing codebase.
