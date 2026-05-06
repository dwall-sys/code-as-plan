# Feature Map — packages/shared

> Mixed-format (some bullet, some table) + mixed long-form/numeric IDs.

## Features

### F-PERF-WEB-VITALS: Web Vitals collector [planned]

- [ ] AC-1: Capture LCP/CLS/INP
- [ ] AC-2: Buffered batch upload

**Files:**
- `src/perf/vitals.ts`

### F-LOGGING: Structured logger [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | JSON-line output |
| AC-2 | pending | Per-call context fields |

**Files:**
- `src/logging/logger.ts`

### F-SHARED-TYPES: Cross-package types [planned]

- [ ] AC-1: Branded ID types

### F-SHARED-RESULT: Result type [planned]

- [ ] AC-1: ok/err discriminated union

### F-SHARED-VALIDATE: Validation schemas [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Zod re-export with helpers |

### F-SHARED-DATE: Date helpers [planned]

- [ ] AC-1: ISO parse/format

### F-SHARED-MONEY: Money helpers [planned]

- [ ] AC-1: Decimal-safe arithmetic

### F-SHARED-CRYPTO: Crypto helpers [planned]

- [ ] AC-1: HMAC + AES wrappers

### F-SHARED-FETCH: Fetch wrapper [planned]

- [ ] AC-1: Retry policy + abort

### F-SHARED-CACHE: In-memory cache [planned]

- [ ] AC-1: LRU eviction

### F-SHARED-EVENTBUS: Event bus [planned]

- [ ] AC-1: Pub/sub interface

### F-SHARED-RNG: Deterministic RNG [planned]

- [ ] AC-1: Seedable mulberry32

### F-SHARED-FORMAT: Number/text format [planned]

- [ ] AC-1: Locale-aware shortener

### F-SHARED-RETRY: Retry helpers [planned]

- [ ] AC-1: Exponential backoff

### F-SHARED-TIMEOUT: Timeout helper [planned]

- [ ] AC-1: AbortController wrap

### F-PERF-LOG: Perf logger [planned]

- [ ] AC-1: Mark/measure helper

### F-301: Shared eslint config [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Base ruleset export |

### F-302: Shared tsconfig [planned]

- [ ] AC-1: Strict-mode preset

### F-303: Shared prettier [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Format config export |

### F-304: Shared assert [planned]

- [ ] AC-1: never-throw mode

### F-305: Shared queue [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | FIFO with caps |

### F-306: Shared deque [planned]

- [ ] AC-1: O(1) push/pop both ends

### F-307: Shared semaphore [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Async permit grant |

### F-308: Shared timer [planned]

- [ ] AC-1: Cancellable setTimeout

### F-309: Shared deepclone [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Cycle-safe clone |

### F-310: Shared diff [planned]

- [ ] AC-1: Object key-set diff

### F-311: Shared base64 [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | URL-safe variant |

### F-312: Shared hex [planned]

- [ ] AC-1: Buffer↔hex conversion

### F-313: Shared chunk [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Array chunking helper |

### F-314: Shared zip [planned]

- [ ] AC-1: parallel array zip

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: 2026-05-06T15:00:00.000Z*
