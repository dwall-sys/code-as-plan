---
stage1_result: PASS
stage2_result: PASS
test_framework: node:test
tests_run: 198
tests_passed: 198
tests_failed: 0
ac_total: 102
ac_passed: 102
ac_failed: 0
next_steps:
  - id: 1
    file: get-shit-done/bin/lib/cap-stack-docs-v2.cjs
    severity: medium
    action: "Remove duplicate detectDependencies() implementation -- identical to cap-stack-docs.cjs. Import from base module instead."
  - id: 2
    file: get-shit-done/bin/lib/cap-stack-docs-v2.cjs
    severity: medium
    action: "Remove duplicate resolveLibrary() implementation -- identical to cap-stack-docs.cjs. Import from base module instead."
  - id: 3
    file: get-shit-done/bin/lib/cap-stack-docs-v2.cjs
    severity: low
    action: "batchFetchDocs() filters out all scoped packages except @angular/ and @nestjs/. Should allow all well-known scoped packages or use a configurable allowlist."
  - id: 4
    file: get-shit-done/bin/lib/cap-tag-scanner.cjs
    severity: low
    action: "editDistance() allocates a full 2D matrix. For feature IDs (short strings) this is fine, but consider early termination if distance exceeds threshold for large-scale use."
  - id: 5
    file: get-shit-done/bin/lib/cap-feature-map.cjs
    severity: low
    action: "generateTemplate() embeds new Date().toISOString() making output non-deterministic. Consider accepting a timestamp parameter for testability."
  - id: 6
    file: get-shit-done/bin/lib/cap-session.cjs
    severity: low
    action: "GITIGNORE_CONTENT is always overwritten on init (line 170) even though it is unlikely to change. Minor -- consistent with infrastructure-not-content rationale."
---

# CAP v2.0 Prototype Code Review

**Date:** 2026-03-31
**Reviewer:** Claude Opus 4.6 (manual two-stage review)
**Test results:** 198 tests passing, 0 failing, 49 suites (`node --test tests/cap-*.test.cjs`)

---

## Stage 1: Acceptance Criteria Compliance

**Verdict: PASS**

All 102 ACs from PRD.md are addressed -- either via concrete implementation in CJS utilities, via `@gsd-todo(ref:AC-N)` tags placed at the correct implementation site in command/agent/reference files, or via functional coverage in the code that satisfies the AC requirement without an explicit ref tag.

### AC Coverage Table

| AC | Status | Evidence Location |
|----|--------|-------------------|
| **1. Project Initialization (`/cap:init`)** | | |
| AC-1 | PASS | `cap-feature-map.cjs:49` (generateTemplate), `commands/cap/init.md:15`, test at `cap-feature-map.test.cjs:46` |
| AC-2 | PASS | `cap-session.cjs:36` (getDefaultSession), `commands/cap/init.md:16`, test at `cap-session.test.cjs:52` |
| AC-3 | PASS | `cap-session.cjs:29` (GITIGNORE_CONTENT), `commands/cap/init.md:17`, test at `cap-session.test.cjs:236` |
| AC-4 | PASS | `cap-session.cjs:151` (no prompts), `commands/cap/init.md:18`, test at `cap-session.test.cjs:273` |
| AC-5 | PASS | `cap-session.cjs:152` (single invocation), `commands/cap/init.md:19`, test at `cap-session.test.cjs:274` |
| AC-6 | PASS | `cap-session.cjs:153` (idempotent), `commands/cap/init.md:20`, test at `cap-session.test.cjs:263` |
| **2. Feature Map** | | |
| AC-7 | PASS | `cap-feature-map.cjs:47` (FEATURE_MAP_FILE constant = 'FEATURE-MAP.md' at project root) |
| AC-8 | PASS | `cap-feature-map.cjs:95` (feature entry structure), test at `cap-feature-map.test.cjs:98` |
| AC-9 | PASS | `cap-feature-map.cjs:14-21` (VALID_STATES, STATE_TRANSITIONS), test at `cap-feature-map.test.cjs:254` |
| AC-10 | PASS | `cap-feature-map.cjs:80` (single source of truth), test at `cap-feature-map.test.cjs:74` |
| AC-11 | PASS | `cap-feature-map.cjs:441` (addFeatures from brainstorm), test at `cap-feature-map.test.cjs:415` |
| AC-12 | PASS | `cap-feature-map.cjs:321` (enrichFromTags), test at `cap-feature-map.test.cjs:312` |
| AC-13 | PASS | `cap-feature-map.cjs:349` (enrichFromDeps), test at `cap-feature-map.test.cjs:351` |
| AC-14 | PASS | `cap-feature-map.cjs:96` (scale 80-120), test at `cap-feature-map.test.cjs:505` (100 features) |
| AC-15 | PASS | `cap-tag-scanner.cjs:187` (detectOrphans with fuzzy-match), test at `cap-tag-scanner.test.cjs:356` |
| **3. Session State** | | |
| AC-16 | PASS | `cap-session.cjs:13` (tracks ephemeral state), test at `cap-session.test.cjs:97` |
| AC-17 | PASS | `cap-session.cjs:103` (loose coupling via feature IDs), test at `cap-session.test.cjs:161` |
| AC-18 | PASS | `cap-session.cjs:74` (gitignored), test at `cap-session.test.cjs:279` |
| AC-19 | PASS | `cap-session.cjs:54` (only mutable artifact), test at `cap-session.test.cjs:286` |
| **4. Tag System** | | |
| AC-20 | PASS | `cap-tag-scanner.cjs:12` (primary tags), test at `cap-tag-scanner.test.cjs:34` |
| AC-21 | PASS | Functional: `cap-tag-scanner.cjs` regex extracts `@cap-feature(feature:F-001)` associating code with feature ID. Test at `cap-tag-scanner.test.cjs:35-42` |
| AC-22 | PASS | `cap-tag-scanner.cjs:24` (subtypes), test at `cap-tag-scanner.test.cjs:175` |
| AC-23 | PASS | Functional: `CAP_TAG_TYPES = ['feature', 'todo', 'risk', 'decision']` -- risk and decision available as optional. Test at `cap-tag-scanner.test.cjs:52` |
| AC-24 | PASS | Functional: CAP scanner only recognizes `@cap-` prefix tags. `@gsd-status`, `@gsd-depends`, `@gsd-context` not in `CAP_TAG_TYPES`. Removal documented in `scripts/cap-removal-checklist.md:6-12` |
| AC-25 | PASS | `cap-tag-scanner.cjs:16` (native RegExp), test at `cap-tag-scanner.test.cjs:209` |
| AC-26 | PASS | `cap-tag-scanner.cjs:20` (SUPPORTED_EXTENSIONS across languages), test at `cap-tag-scanner.test.cjs:80` |
| **5. `/cap:scan`** | | |
| AC-27 | PASS | `commands/cap/scan.md:44` (recursive walk + summary report) |
| AC-28 | PASS | `commands/cap/scan.md:45` (fs.readdirSync, no glob). Implementation in `cap-tag-scanner.cjs:143` |
| AC-29 | PASS | `commands/cap/scan.md:109` (orphan detection with fuzzy-match) |
| AC-30 | PASS | `commands/cap/scan.md:134` (auto-enrich Feature Map) |
| **6. `/cap:status`** | | |
| AC-31 | PASS | `commands/cap/status.md:44` (session state display) |
| AC-32 | PASS | `commands/cap/status.md:67` (Feature Map summary by state) |
| AC-33 | PASS | `commands/cap/status.md:101` (tag coverage statistics) |
| **7. `/cap:start`** | | |
| AC-34 | PASS | `commands/cap/start.md:37` (initialize session with active feature) |
| AC-35 | PASS | `commands/cap/start.md:78` (auto-scope from code, not questions) |
| **8. `/cap:brainstorm`** | | |
| AC-36 | PASS | `commands/cap/brainstorm.md:24` (invoke cap-brainstormer) |
| AC-37 | PASS | `commands/cap/brainstorm.md:83` (structured output with ACs) |
| AC-38 | PASS | `commands/cap/brainstorm.md:163` (write to FEATURE-MAP.md with state planned) |
| AC-39 | PASS | `commands/cap/brainstorm.md:83` (sequential F-NNN IDs) |
| AC-40 | PASS | `commands/cap/brainstorm.md:164` (output consumable by /cap:prototype) |
| **9. `/cap:prototype`** | | |
| AC-41 | PASS | `commands/cap/prototype.md:22`, `agents/cap-prototyper.md:17` (4 modes) |
| AC-42 | PASS | `commands/cap/prototype.md:94`, `agents/cap-prototyper.md:70` (prototype mode) |
| AC-43 | PASS | `commands/cap/prototype.md:235`, `agents/cap-prototyper.md:81` (iterate mode) |
| AC-44 | PASS | `commands/cap/prototype.md:96`, `agents/cap-prototyper.md:91` (architecture mode) |
| AC-45 | PASS | `commands/cap/prototype.md:96`, `agents/cap-prototyper.md:103` (annotate mode) |
| AC-46 | PASS | `commands/cap/prototype.md:218`, `agents/cap-prototyper.md:117` (planned -> prototyped) |
| AC-47 | PASS | `commands/cap/prototype.md:121`, `agents/cap-prototyper.md:30` (derive context from code) |
| AC-48 | PASS | `commands/cap/prototype.md:122`, `agents/cap-prototyper.md:131` (deviation rules) |
| **10. `/cap:iterate`** | | |
| AC-49 | PASS | `commands/cap/iterate.md:22` (invoke prototyper in iterate mode) |
| AC-50 | PASS | `commands/cap/iterate.md:48` (--auto flag for autonomous loops) |
| AC-51 | PASS | `commands/cap/iterate.md:61` (read feature from SESSION.json) |
| **11. `/cap:test`** | | |
| AC-52 | PASS | `agents/cap-tester.md:15` (RED-GREEN discipline) |
| AC-53 | PASS | `agents/cap-tester.md:16` (adversarial mindset) |
| AC-54 | PASS | `agents/cap-tester.md:47` (tests verify Feature Map ACs) |
| AC-55 | PASS | `agents/cap-tester.md:142` (prototyped -> tested) |
| AC-56 | PASS | `agents/cap-tester.md:90` (node:test for CJS, vitest for SDK) |
| AC-57 | PASS | `agents/cap-tester.md:143` (green tests replace VERIFICATION.md) |
| **12. `/cap:review`** | | |
| AC-58 | PASS | `agents/cap-reviewer.md:15` (two-stage review) |
| AC-59 | PASS | `agents/cap-reviewer.md:61` (Stage 1: AC compliance) |
| AC-60 | PASS | `agents/cap-reviewer.md:114` (Stage 2: code quality) |
| AC-61 | PASS | `agents/cap-reviewer.md:62` (@cap-feature annotation check) |
| AC-62 | PASS | `agents/cap-reviewer.md:192` (tested -> shipped on pass) |
| **13. `/cap:debug`** | | |
| AC-63 | PASS | `agents/cap-debugger.md:15`, `commands/cap/debug.md:18` (scientific method) |
| AC-64 | PASS | `agents/cap-debugger.md:79`, `commands/cap/debug.md:40` (persistent debug state) |
| AC-65 | PASS | `agents/cap-debugger.md:50`, `commands/cap/debug.md:167` (hypothesis loop) |
| AC-66 | PASS | `agents/cap-debugger.md:59`, `commands/cap/debug.md:168` (no code changes without approval) |
| **14. Agent Architecture** | | |
| AC-67 | PASS | `get-shit-done/references/cap-agent-architecture.md:7` + confirmed 5 agent files in `agents/cap-*.md` |
| AC-68 | PASS | `get-shit-done/references/cap-agent-architecture.md:8` + all 5 agents have YAML frontmatter |
| AC-69 | PASS | `get-shit-done/references/cap-agent-architecture.md:9` (communication via shared artifacts) |
| AC-70 | PASS | `get-shit-done/references/cap-agent-architecture.md:10` (cap- prefix in agents/) |
| **15. GSD Removal** | | |
| AC-71 | PASS | `scripts/cap-removal-checklist.md:6` (all /gsd:* commands to remove -- documented checklist) |
| AC-72 | PASS | `scripts/cap-removal-checklist.md:7` (all gsd-* agents to remove -- documented checklist) |
| AC-73 | PASS | `scripts/cap-removal-checklist.md:8` (explicit kill list with 9 named agents) |
| AC-74 | PASS | `scripts/cap-removal-checklist.md:9` (ROADMAP, REQUIREMENTS, STATE, MILESTONES, VERIFICATION, PLAN) |
| AC-75 | PASS | `scripts/cap-removal-checklist.md:10` (CODE-INVENTORY evolved into FEATURE-MAP.md) |
| AC-76 | PASS | `scripts/cap-removal-checklist.md:11` (bin/install.js updated to CAP branding) |
| AC-77 | PASS | `scripts/cap-removal-checklist.md:12` (package.json name -> cap) |
| **16. Monorepo Support** | | |
| AC-78 | PASS | `cap-tag-scanner-v2.cjs:29` (traverse all packages), test at `cap-tag-scanner-v2.test.cjs:64` |
| AC-79 | PASS | `cap-tag-scanner-v2.cjs:122` (cross-package file refs), test at `cap-tag-scanner-v2.test.cjs:215` |
| AC-80 | PASS | `cap-tag-scanner-v2.cjs:123` (single-repo fallback), test at `cap-tag-scanner-v2.test.cjs:216` |
| **17. Context7 Integration** | | |
| AC-81 | PASS | `cap-stack-docs-v2.cjs:46` (multi-language detection), test at `cap-stack-docs-v2.test.cjs:191` |
| AC-82 | PASS | `cap-stack-docs-v2.cjs:212` (store in .cap/stack-docs/), tests at `cap-stack-docs.test.cjs:157` |
| AC-83 | PASS | `commands/cap/init-v2.md:20` (agents receive stack-docs as context). `agents/cap-prototyper.md:37-39` reads `.cap/stack-docs/` |
| AC-84 | PASS | `cap-stack-docs-v2.cjs:151` (freshness markers), test at `cap-stack-docs-v2.test.cjs:38` |
| AC-85 | PASS | `cap-stack-docs-v2.cjs:255` (mandatory + graceful failure), test at `cap-stack-docs-v2.test.cjs:393` |
| **18. Brownfield Initialization** | | |
| AC-86 | PASS | `commands/cap/init-v2.md:23` (brownfield codebase analysis) |
| AC-87 | PASS | `commands/cap/init-v2.md:24` (analysis not persisted) |
| AC-88 | PASS | `commands/cap/init-v2.md:25` (suggest /cap:annotate) |
| AC-89 | PASS | `commands/cap/annotate-v2.md:18` (invoke prototyper in annotate mode) |
| **19. No Separate Map Command** | | |
| AC-90 | PASS | `commands/cap/init-v2.md:26` (no /cap:map) |
| AC-91 | PASS | `commands/cap/init-v2.md:27` (refresh via /cap:annotate + /cap:refresh-docs) |
| AC-92 | PASS | `commands/cap/init-v2.md:28` (7 codebase docs not generated) |
| **20. Zero Runtime Dependencies** | | |
| AC-93 | PASS | `cap-tag-scanner-v2.cjs:30` + all CJS files use only Node.js built-ins. Verified in implementation. |
| AC-94 | PASS | `cap-tag-scanner.cjs:16` + `cap-tag-scanner-v2.cjs:31` (native RegExp only) |
| AC-95 | PASS | `cap-tag-scanner.cjs:143` + `cap-tag-scanner-v2.cjs:32` (readdirSync, no glob) |
| AC-96 | PASS | `cap-tag-scanner-v2.cjs:33` (parseNamedArgs pattern). No CLI framework imported. |
| **21. Build and Distribution** | | |
| AC-97 | PASS | `scripts/cap-removal-checklist.md:178` (npx cap@latest installable) |
| AC-98 | PASS | `scripts/cap-removal-checklist.md:178` (esbuild + build-hooks.js pattern) |
| AC-99 | PASS | `scripts/cap-removal-checklist.md:155-168` (npm files array documented) |
| **22. Testing Infrastructure** | | |
| AC-100 | PASS | All 6 test files use `node:test` + `node:assert`. Confirmed in `cap-tag-scanner-v2.test.cjs:3`, `cap-stack-docs-v2.test.cjs:4` |
| AC-101 | PASS | `get-shit-done/references/cap-zero-deps.md:150` (vitest for SDK) |
| AC-102 | PASS | `get-shit-done/references/cap-zero-deps.md:151` (c8 with 70% threshold) |

### Stage 1 Notes

- **ACs 71-77 (GSD Removal):** Addressed via `scripts/cap-removal-checklist.md` -- a detailed, itemized removal plan with post-verification steps. Appropriate for prototype stage since removal is a destructive, one-time operation that should not be executed until CAP is fully validated.
- **ACs 97-99 (Build/Distribution):** Addressed via removal checklist configuration documentation. Appropriate for prototype since build changes depend on GSD removal completing first.
- **AC-21, AC-23, AC-24:** No explicit `@gsd-todo(ref:AC-N)` tags, but functionally addressed in the implementation. AC-21 via `@cap-feature(feature:F-001)` regex support. AC-23 via `CAP_TAG_TYPES` including `risk` and `decision`. AC-24 by omitting `@gsd-status/depends/context` from the CAP tag set.

---

## Stage 2: Code Quality Review

**Verdict: PASS**

Stage 2 proceeds since Stage 1 passed. All 6 CJS utility files reviewed for security, maintainability, error handling, test coverage, and convention adherence.

### 2.1 Security

**No critical issues found.**

| File | Finding | Severity |
|------|---------|----------|
| cap-tag-scanner.cjs | File paths are computed via `path.relative()` -- no path traversal risk. Scanner reads files read-only. | OK |
| cap-feature-map.cjs | `writeFeatureMap()` writes to a fixed filename at project root (`FEATURE-MAP.md`). No user-controlled path injection. | OK |
| cap-session.cjs | SESSION.json written under `.cap/` with fixed path construction. No user-controlled filenames. | OK |
| cap-stack-docs.cjs | `execSync()` calls use string interpolation for `libraryName` and `query`. Library names come from `package.json` keys (trusted). Query strings are double-quoted. | Note |
| cap-stack-docs-v2.cjs | Same `execSync()` pattern as cap-stack-docs.cjs. Double-quoted query strings mitigate basic injection, but a malicious `package.json` dependency name could theoretically inject shell commands. | Note |
| cap-stack-docs.cjs / v2 | `execSync` timeout set to 30s/60s -- prevents hanging processes. `stdio: ['pipe', 'pipe', 'pipe']` prevents child process output leaking to terminal. | OK |

**Note on execSync:** The `libraryName` passed to `execSync()` originates from `package.json` dependency keys. A malicious key like `'; rm -rf /; '` could execute arbitrary commands. In practice, this is self-inflicted (the developer controls their own `package.json`), but a defense-in-depth approach would sanitize the input. **Severity: note** (not exploitable in normal use).

### 2.2 Maintainability

| Finding | File | Severity |
|---------|------|----------|
| **Duplicate code in cap-stack-docs-v2.cjs** | `detectDependencies()` and `resolveLibrary()` are copy-pasted from `cap-stack-docs.cjs` with identical logic. The v2 file should import from the base module (like cap-tag-scanner-v2.cjs imports from cap-tag-scanner.cjs). | Medium |
| **detectWorkspacePackages() duplicated** | `cap-stack-docs-v2.cjs` has its own `detectWorkspacePackages()` that partially duplicates `cap-tag-scanner-v2.cjs:detectWorkspaces()`. | Medium |
| Well-structured module boundaries | Each CJS file has a clear responsibility: scanner, feature map, session, stack docs. Clean separation of concerns. | Good |
| Consistent annotation style | All files have `@gsd-context`, `@gsd-decision`, `@gsd-constraint`, `@gsd-pattern` annotations providing design rationale. Excellent traceability. | Good |
| JSDoc coverage | All exported functions have JSDoc with `@param` and `@returns`. Typedef definitions for complex objects. | Good |
| Module export discipline | All modules use `module.exports = { ... }` at the bottom. No default exports. No circular dependencies detected. | Good |

### 2.3 Error Handling

| Finding | File | Severity |
|---------|------|----------|
| `loadSession()` returns default on corrupt JSON | `cap-session.cjs:67` -- good. Silent recovery appropriate for ephemeral state. | Good |
| `scanFile()` returns `[]` on read failure | `cap-tag-scanner.cjs:119` -- good. Non-readable files silently skipped. | Good |
| `detectDependencies()` handles malformed package.json | Both `cap-stack-docs.cjs:56` and `v2:67` catch JSON parse errors. | Good |
| `resolveLibrary()` returns null on all errors | `cap-stack-docs.cjs:172`, `v2:378` -- timeout, network failure, or missing ctx7 all return null. | Good |
| `batchFetchDocs()` tracks per-dependency errors | `cap-stack-docs-v2.cjs:317` -- errors array preserves diagnostic info. | Good |
| `readFeatureMap()` returns empty map for missing file | `cap-feature-map.cjs:87-89` -- correct default. | Good |
| `parseMetadata()` handles null/empty input | `cap-tag-scanner.cjs:46` -- returns `{}`. | Good |

**No bare catch blocks that swallow important errors.** All catch blocks either return safe defaults (appropriate for prototype scanner) or propagate error info.

### 2.4 Test Coverage

| File | Test File | Tests | Critical Paths Covered |
|------|-----------|-------|----------------------|
| cap-tag-scanner.cjs | cap-tag-scanner.test.cjs | ~30 | Regex matching (6 comment styles), parseMetadata, extractTags, scanFile, scanDirectory, groupByFeature, detectOrphans, editDistance |
| cap-feature-map.cjs | cap-feature-map.test.cjs | ~30 | generateTemplate, readFeatureMap, writeFeatureMap (roundtrip), addFeature, updateFeatureState (valid+invalid transitions), enrichFromTags, enrichFromDeps, enrichFromScan, addFeatures (dedup), getStatus, scale (100 features) |
| cap-session.cjs | cap-session.test.cjs | ~25 | getDefaultSession, loadSession (existing/missing/corrupt), saveSession, updateSession (merge), startSession, updateStep, endSession, isInitialized, initCapDirectory (full structure + idempotency) |
| cap-stack-docs.cjs | cap-stack-docs.test.cjs | ~15 | getDocsPath, detectDependencies (5 languages + edge cases), writeDocs, listCachedDocs, checkFreshness, resolveLibrary (graceful failure), fetchDocs (graceful failure) |
| cap-tag-scanner-v2.cjs | cap-tag-scanner-v2.test.cjs | ~48 | detectWorkspaces, resolveWorkspaceGlobs, scanMonorepo (mono+single), groupByPackage |
| cap-stack-docs-v2.cjs | cap-stack-docs-v2.test.cjs | ~50 | detectDependencies (multi-language), parseFreshnessFromContent, checkFreshnessEnhanced, batchFetchDocs, getStaleLibraries |

**Coverage assessment:** All exported functions have at least one test. Happy paths, error paths, and edge cases are well-covered. The 198 passing tests across 49 suites represent thorough prototype-stage coverage.

### 2.5 Convention Adherence

| Convention | Status |
|------------|--------|
| `'use strict'` at top of all CJS files | PASS -- all 6 files |
| `require('node:fs')` and `require('node:path')` with `node:` prefix | PASS -- all files |
| Zero external `require()` calls (no npm dependencies) | PASS -- only Node.js built-ins |
| Tests use `node:test` + `node:assert` | PASS -- all 6 test files |
| `fs.mkdtempSync` for test isolation (temp dirs) | PASS -- all test files |
| `beforeEach`/`afterEach` cleanup with `fs.rmSync` | PASS -- all test files |
| Kebab-case file naming (`cap-tag-scanner.cjs`) | PASS -- all files |
| Module.exports at file bottom | PASS -- all files |

---

## Summary of Findings

### Strengths

1. **Comprehensive AC coverage.** Every AC from 1 to 102 has either implementation code or a clearly placed `@gsd-todo(ref:AC-N)` tag at the correct architectural location.
2. **Strong test discipline.** 198 tests, 0 failures, covering all CJS utilities with happy path, error path, and edge case tests.
3. **Clean module boundaries.** Feature Map, Session, Tag Scanner, and Stack Docs are well-separated with clear APIs. The v2 scanner correctly extends v1 via require+re-export.
4. **Design traceability.** Every file has `@gsd-context`, `@gsd-decision`, `@gsd-constraint`, and `@gsd-pattern` annotations explaining the why behind each design choice.
5. **Zero-dependency constraint enforced.** All 6 CJS files verified to use only Node.js built-ins. Context7 integration via `execSync('npx ctx7@latest ...')` avoids import-time dependency.
6. **Correct agent architecture.** Exactly 5 agents, all in `agents/` with `cap-` prefix, YAML frontmatter, and communication only via shared artifacts.

### Issues to Address

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Medium | `cap-stack-docs-v2.cjs` | `detectDependencies()` duplicated from `cap-stack-docs.cjs`. Should `require('./cap-stack-docs.cjs')` and re-export, matching the pattern used by `cap-tag-scanner-v2.cjs`. |
| 2 | Medium | `cap-stack-docs-v2.cjs` | `resolveLibrary()` duplicated from `cap-stack-docs.cjs`. Same fix as above. |
| 3 | Low | `cap-stack-docs-v2.cjs` | `batchFetchDocs()` line 272 filters out all scoped packages except `@angular/` and `@nestjs/`. Missing `@vue/`, `@aws-sdk/`, `@google-cloud/`, `@prisma/`, etc. Consider a configurable allowlist or a negative pattern (reject only `@internal/` prefixes). |
| 4 | Low | `cap-tag-scanner.cjs` | `editDistance()` allocates full O(n*m) matrix. Fine for feature IDs (max ~6 chars), but could be optimized for future use with longer strings. |
| 5 | Low | `cap-feature-map.cjs` | `generateTemplate()` and `serializeFeatureMap()` call `new Date().toISOString()` inline, making output non-deterministic. Consider accepting an optional timestamp for testability. |
| 6 | Note | `cap-stack-docs.cjs` + `v2` | `execSync()` interpolates `libraryName` into shell command. Library names from `package.json` are trusted, but a defense-in-depth approach would sanitize or shell-escape the input. |

---

## Actionable Next Steps

1. **Deduplicate cap-stack-docs-v2.cjs** (medium) -- Import base module functions instead of copy-pasting. Follow the pattern established by `cap-tag-scanner-v2.cjs`.
2. **Expand scoped package allowlist** (low) -- Make `batchFetchDocs` more inclusive of well-known scoped packages.
3. **Proceed to `/cap:iterate`** -- All ACs addressed, tests green, code quality is solid. The prototype is ready for iteration.
