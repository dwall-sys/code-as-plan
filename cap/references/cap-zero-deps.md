# CAP Zero Runtime Dependencies Reference

<!-- @gsd-context Reference document defining the zero-dependency constraint for CAP v2.0. All developers and agents must follow these rules when adding code to the distributed package. -->
<!-- @gsd-decision Zero runtime dependencies is a HARD constraint, not a guideline. The distributed package must have exactly 0 entries in package.json dependencies. -->
<!-- @gsd-constraint The entire runtime surface uses only Node.js built-in modules. No npm packages at runtime. -->

<!-- @gsd-todo(ref:AC-93) The distributed package shall have zero runtime dependencies -->
<!-- @gsd-todo(ref:AC-94) The tag scanner shall use native RegExp -- no comment-parser or AST parser -->
<!-- @gsd-todo(ref:AC-95) File discovery shall use fs.readdirSync with recursive walk -- no glob library -->
<!-- @gsd-todo(ref:AC-96) CLI argument parsing shall use the existing parseNamedArgs() pattern -->

---

## Core Rule

**The distributed CAP package shall have zero runtime dependencies.**

This means:
- `package.json` `dependencies` field must be empty or absent
- No `require()` or `import` of any npm package in runtime code
- Only Node.js built-in modules (prefixed with `node:` or not) are allowed

---

## Allowed Node.js Built-ins

These are the ONLY modules that may be imported in CJS runtime code:

| Module | Usage in CAP |
|--------|-------------|
| `node:fs` | File system operations -- reading source files, writing Feature Map, Session |
| `node:path` | Path resolution -- cross-platform file path handling |
| `node:child_process` | Context7 invocation -- `execSync` to call `npx ctx7@latest` |
| `node:os` | Temporary directory paths for tests |
| `node:crypto` | Hashing for deduplication if needed |
| `node:test` | Test runner (test-time only, not runtime) |
| `node:assert` | Test assertions (test-time only, not runtime) |

---

## Specific Constraints

### Tag Scanner (AC-94)

The tag scanner SHALL use native `RegExp` for all tag extraction:

```javascript
// ALLOWED: native RegExp
const CAP_TAG_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(feature|todo|risk|decision)(?:\(([^)]*)\))?[ \t]*(.*)/;

// FORBIDDEN: comment-parser npm package
const { parse } = require('comment-parser'); // DO NOT USE

// FORBIDDEN: AST parsers
const acorn = require('acorn'); // DO NOT USE
const { parse } = require('@babel/parser'); // DO NOT USE
```

**Rationale:** The `@cap-` prefix makes tags structurally simple. They live in comment lines only. Regex is sufficient and language-agnostic.

### File Discovery (AC-95)

File discovery SHALL use `fs.readdirSync` with recursive walk:

```javascript
// ALLOWED: native recursive walk
function walk(dir, exclude) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !exclude.includes(entry.name)) {
      walk(path.join(dir, entry.name), exclude);
    }
  }
}

// FORBIDDEN: glob npm package
const glob = require('glob'); // DO NOT USE

// FORBIDDEN: fast-glob
const fg = require('fast-glob'); // DO NOT USE
```

**Note:** Node.js 22+ has `fs.glob()` built-in, but we target Node.js >=20.0.0 so cannot rely on it.

### CLI Argument Parsing (AC-96)

CLI arguments SHALL use the existing `parseNamedArgs()` pattern from `gsd-tools.cjs`:

```javascript
// ALLOWED: existing parseNamedArgs() pattern
const args = parseNamedArgs(process.argv.slice(2));

// FORBIDDEN: commander
const { program } = require('commander'); // DO NOT USE

// FORBIDDEN: yargs
const yargs = require('yargs'); // DO NOT USE

// FORBIDDEN: oclif
const { Command } = require('@oclif/core'); // DO NOT USE
```

---

## Dev Dependencies (Allowed)

These are allowed as `devDependencies` because they do NOT ship with the package:

| Package | Purpose |
|---------|---------|
| `esbuild` | Build tool -- bundles hooks for distribution |
| `c8` | Code coverage reporting |
| `vitest` | SDK TypeScript tests only (scoped to `sdk/`) |

---

## Context7 Exception

Context7 (`ctx7`) is invoked via `npx ctx7@latest` through `child_process.execSync`. This is NOT a runtime dependency -- it is an external CLI tool that the user may or may not have installed. The code handles its absence gracefully:

```javascript
try {
  const output = execSync('npx ctx7@latest docs ...', { timeout: 60000 });
} catch (_e) {
  // ctx7 not available -- return graceful failure
  return { success: false, error: 'Context7 unreachable' };
}
```

---

## Verification

To verify zero runtime dependencies:

```bash
# Check package.json has no dependencies
node -e "const pkg = require('./package.json'); console.log(Object.keys(pkg.dependencies || {}).length === 0 ? 'PASS' : 'FAIL')"

# Check no external requires in lib files
grep -rn "require(" cap/bin/lib/cap-*.cjs | grep -v "node:" | grep -v "require('./cap-" | grep -v "require('../"
# Should return empty (no external requires)
```

---

## Testing Infrastructure (AC-100, AC-101, AC-102)

<!-- @gsd-todo(ref:AC-100) All CJS code tested with node:test and node:assert -->
<!-- @gsd-todo(ref:AC-101) SDK TypeScript code tested with vitest -- scoped via vitest.config.ts -->
<!-- @gsd-todo(ref:AC-102) Coverage measured with c8 with minimum 70% line coverage threshold -->

| Layer | Test Framework | Coverage Tool | Threshold |
|-------|---------------|---------------|-----------|
| CJS (`cap/bin/lib/*.cjs`) | `node:test` + `node:assert` | `c8` | 70% lines |
| SDK (`sdk/src/**/*.ts`) | `vitest` | vitest built-in | 70% lines |

**NEVER use vitest for CJS tests. NEVER use node:test for SDK TypeScript tests.**
