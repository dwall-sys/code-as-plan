# Multi-File Tagging Convention (F-045)

> Tag convention for acceptance criteria that span multiple source files, plus the `/cap:trace` command for navigating them.

## Problem

A single acceptance criterion ("AC") often touches more than one file. For example:

- A REST endpoint AC may touch the route handler, the validation schema, and the database query module.
- A parser AC may touch the lexer, the grammar definition, and the AST builder.

The existing `@cap-feature` / `@cap-todo` tag system can record _which AC each file participates in_, but it does not record _which file is the canonical implementation_ — the one a reader should open first to understand the AC end-to-end.

`/cap:trace` answers "where does AC F-045/AC-4 actually live?" by:

1. Reading every tag that mentions the AC.
2. Picking a **primary file** — explicitly designated, or inferred via tag density.
3. Walking the static call graph (require/import) outward from the primary file.

## Convention

### Single-file ACs (no extra annotation needed)

When an AC is implemented entirely in one file, just tag it normally:

```js
// @cap-todo(ac:F-010/AC-2) Validate session token before issuing JWT
function issueJwt(session) { /* ... */ }
```

`buildAcFileMap` will see exactly one file contributing to `F-010/AC-2` and treat it as primary trivially. No warning is emitted.

### Multi-file ACs — designate a primary

When an AC spans multiple files, mark **one** as primary using `primary:true` on the file's `@cap-feature` tag:

```js
// @cap-feature(feature:F-010, primary:true) JWT issuance — primary entry point.
// @cap-todo(ac:F-010/AC-2) Validate session token before issuing JWT
function issueJwt(session) { /* ... */ }
```

In another file that also contributes to AC-2:

```js
// @cap-feature(feature:F-010) Token validation helpers (collaborator).
// @cap-todo(ac:F-010/AC-2) Constant-time comparison to defeat timing attacks
function validateToken(t) { /* ... */ }
```

`/cap:trace F-010/AC-2` will report the first file as the primary (`designated`).

### Tag-syntax rules

`primary:true` follows the existing comma-separated key:value metadata convention used by every `@cap-*` tag. The metadata block is parsed by `parseMetadata()` in `cap-tag-scanner.cjs`, which splits on commas — **the comma between `feature:` and `primary:true` is mandatory**:

| Form | Parsed correctly? |
|------|-------------------|
| `@cap-feature(feature:F-010, primary:true)` | yes |
| `@cap-feature(feature:F-010,primary:true)` | yes (whitespace trimmed) |
| `@cap-feature(feature:F-010 primary:true)` | **no** — parsed as one key `feature` with value `F-010 primary:true` |

`primary:true` is meaningful only on `@cap-feature`. Putting it on `@cap-todo`, `@cap-risk`, or `@cap-decision` is silently ignored — those tags describe AC-level concerns, not file-level role.

### What if no `primary:true` is set?

When a multi-file AC has no designated primary, `buildAcFileMap` falls back to a heuristic:

1. Count the number of contributing tags per file (`tagDensity`).
2. Pick the file with the highest count as the inferred primary.
3. Emit a warning naming the AC and the inferred file.

The heuristic is deterministic but coarse. It works well when one file is clearly the "main" implementation and the others are helpers. It works poorly when files have similar tag counts — designate a primary explicitly in those cases.

## Worked example 1 — JavaScript (CommonJS)

A JavaScript implementation of an authentication flow with three files:

`src/auth/index.js` — primary entry point:

```js
'use strict';

// @cap-feature(feature:F-100, primary:true) Authentication flow — primary entry: login() and refresh().
// @cap-todo(ac:F-100/AC-1) Validate email + password against bcrypt hash.
// @cap-todo(ac:F-100/AC-2) Issue access + refresh JWT pair on success.

const { hashCompare } = require('./hash');
const { signTokens } = require('./jwt');

async function login(email, password) {
  const user = await loadUser(email);
  if (!user || !(await hashCompare(password, user.hash))) {
    throw new Error('Invalid credentials');
  }
  return signTokens(user);
}

module.exports = { login };
```

`src/auth/hash.js` — collaborator:

```js
'use strict';

// @cap-feature(feature:F-100) Password hashing helpers (collaborator for auth flow).
// @cap-todo(ac:F-100/AC-1) Constant-time bcrypt comparison.

const bcrypt = require('bcrypt');

async function hashCompare(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = { hashCompare };
```

`src/auth/jwt.js` — collaborator:

```js
'use strict';

// @cap-feature(feature:F-100) JWT signing helpers (collaborator for auth flow).
// @cap-todo(ac:F-100/AC-2) Sign access (15m) and refresh (7d) tokens.

const jwt = require('jsonwebtoken');

function signTokens(user) {
  const access = jwt.sign({ sub: user.id }, process.env.SECRET, { expiresIn: '15m' });
  const refresh = jwt.sign({ sub: user.id }, process.env.SECRET, { expiresIn: '7d' });
  return { access, refresh };
}

module.exports = { signTokens };
```

Running `/cap:trace F-100/AC-1` would print:

```
Trace: F-100/AC-1

Primary: src/auth/index.js (designated)

Call graph:
  src/auth/index.js
    require src/auth/hash.js [line 6]
    require src/auth/jwt.js [line 7]
  src/auth/hash.js
    require bcrypt [line 5] (external)
  src/auth/jwt.js
    require jsonwebtoken [line 5] (external)

All files contributing to AC:
  - src/auth/index.js
  - src/auth/hash.js

Depth limit: 3
```

Note that AC-1 is implemented in two files (`index.js` and `hash.js`), but the call graph also shows `jwt.js` because it is reachable from the primary — that is intentional, the trace shows the AC's _surrounding context_, not just the AC's tagged files.

## Worked example 2 — TypeScript

A TypeScript service for rate limiting, split across the public service and a Redis-backed store:

`src/ratelimit/RateLimitService.ts` — primary:

```ts
// @cap-feature(feature:F-200, primary:true) Rate limiting service — primary public surface.
// @cap-todo(ac:F-200/AC-1) Reject requests exceeding N per window.
// @cap-todo(ac:F-200/AC-3) Return Retry-After header value on rejection.

import { TokenBucketStore } from './TokenBucketStore';
import type { RateLimitConfig, RateLimitResult } from './types';

export class RateLimitService {
  constructor(private store: TokenBucketStore, private config: RateLimitConfig) {}

  async check(key: string): Promise<RateLimitResult> {
    const remaining = await this.store.consume(key, this.config.tokensPerWindow);
    if (remaining < 0) {
      return { allowed: false, retryAfterMs: this.config.windowMs };
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}
```

`src/ratelimit/TokenBucketStore.ts` — collaborator:

```ts
// @cap-feature(feature:F-200) Token bucket store (collaborator for RateLimitService).
// @cap-todo(ac:F-200/AC-2) Atomic decrement against Redis to avoid race conditions.

import { Redis } from 'ioredis';

export class TokenBucketStore {
  constructor(private redis: Redis) {}

  async consume(key: string, max: number): Promise<number> {
    // INCR returns the post-increment value; subtracting from max gives "remaining".
    const used = await this.redis.incr(`rl:${key}`);
    return max - used;
  }
}
```

`src/ratelimit/types.ts` — pure type definitions, intentionally untagged (no behavior, no AC).

Running `/cap:trace F-200/AC-2` would print:

```
Trace: F-200/AC-2

Primary: src/ratelimit/TokenBucketStore.ts (inferred)

Call graph:
  src/ratelimit/TokenBucketStore.ts
    import ioredis [line 4] (external)

All files contributing to AC:
  - src/ratelimit/TokenBucketStore.ts

Depth limit: 3
```

AC-2 is single-file (only `TokenBucketStore.ts` tagged it), so the heuristic trivially picks it as primary with no warning.

Running `/cap:trace F-200/AC-1` would print:

```
Trace: F-200/AC-1

Primary: src/ratelimit/RateLimitService.ts (designated)

Call graph:
  src/ratelimit/RateLimitService.ts
    import src/ratelimit/TokenBucketStore.ts [line 5]
  src/ratelimit/TokenBucketStore.ts
    import ioredis [line 4] (external)

All files contributing to AC:
  - src/ratelimit/RateLimitService.ts

Depth limit: 3
```

AC-1 is also single-file but the call graph still expands into the collaborator because the primary file `import`s it.

## When to designate vs rely on the heuristic

**Designate `primary:true` when:**
- Multiple files contribute roughly equal numbers of tags to the AC.
- The primary is a thin orchestrator and helpers carry more annotations.
- You want the trace output to be deterministic across refactors that change tag counts.

**Rely on the heuristic when:**
- Exactly one file implements the AC (no warning will fire — single-file is trivially primary).
- One file is clearly dominant in tag count and the convention reads as obvious to the team.

## Related commands

- `/cap:scan` — populates Feature Map `**Files:**` lists from raw tag scans.
- `/cap:trace` — uses the same tag data to render per-AC call graphs.
- `/cap:status --drift` — reports Feature Map / code mismatches.

## Limitations

- **Static analysis only.** `require(variable)`, `import(expr)`, and conditional requires inside functions are invisible to the call-graph walker.
- **No path-alias resolution.** TypeScript `paths` (e.g. `@/utils`) and webpack `resolve.alias` are not consulted; aliased imports are reported as external.
- **Project-relative only.** Anything outside `projectRoot` (including `node_modules` and parent directories) is reported as `(external)` with no recursion.

These limitations are documented in `cap-trace.cjs` as `@cap-risk` annotations.
