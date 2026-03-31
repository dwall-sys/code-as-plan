<!-- @gsd-context Architecture mode behavioral extension for gsd-prototyper agent. This file demonstrates the additions to agents/gsd-prototyper.md for skeleton-only output mode. -->
<!-- @gsd-decision One agent (gsd-prototyper) with two modes rather than a separate gsd-architect agent -- avoids agent sprawl and duplicated context-loading logic -->
<!-- @gsd-ref(ref:ARCH-02) Architecture mode produces @gsd-decision and @gsd-context tags explaining structural choices -->

# Architecture Mode Behavior Patch for gsd-prototyper.md

This file documents the exact additions needed in `agents/gsd-prototyper.md` to support architecture mode behavior.

## Patch 1: Role section addition

Add to the `<role>` section after the existing paragraph:

```markdown
**Architecture mode:** When the Task() prompt contains `**MODE: ARCHITECTURE**`, you switch to skeleton-only output. You generate folder structure, config files, typed interfaces, and module boundary stubs -- with zero feature implementation code. Every module boundary gets `@gsd-decision` and `@gsd-context` tags. You read existing project conventions before generating anything.
```

<!-- @gsd-decision Role section gets a single paragraph addition rather than a conditional block -- keeps the agent prompt compact and avoids confusing the LLM with branching logic in the role definition -->

## Patch 2: New step between load_context and plan_prototype

<!-- @gsd-ref(ref:ARCH-03) gsd-prototyper reads existing project conventions before generating skeleton -->
<!-- @gsd-constraint Architecture mode MUST read conventions before generating -- convention discovery is not optional -->

Add a new step 1.5 (renumber subsequent steps):

```markdown
<step name="read_conventions" number="1.5">
**Read project conventions (architecture mode only):**

If the Task() prompt contains `**MODE: ARCHITECTURE**`, read the following files to discover existing project conventions. Skip files that do not exist.

1. **package.json** — extract:
   - `type` field (module vs commonjs)
   - `name` field (naming convention: kebab-case, camelCase, etc.)
   - `scripts` keys (test runner, build tool, linter)
   - `main` / `module` / `exports` fields (entry point patterns)
   - `dependencies` / `devDependencies` (framework choices: express, fastify, next, etc.)

2. **tsconfig.json or jsconfig.json** — extract:
   - `compilerOptions.paths` (path aliases like `@/src/*`)
   - `compilerOptions.module` (ESM vs CJS)
   - `compilerOptions.outDir` (build output location)
   - `include` / `exclude` (source directory structure)

3. **Existing directory structure** — run:
   ```bash
   find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' -maxdepth 3
   ```
   Extract naming patterns: are directories kebab-case, camelCase, PascalCase, or snake_case?

4. **Linter/formatter config** — check for `.eslintrc*`, `.prettierrc*`, `biome.json`
   Extract: indent style, quote style, semicolons, trailing commas

5. **Test structure** — check for `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`
   Extract: test file co-location vs separate directory

Store discovered conventions as `project_conventions` for use in skeleton generation.

**If no conventions are found** (brand new project): use sensible defaults and document each default as a `@gsd-decision` tag in the generated files.
</step>
```

<!-- @gsd-todo(ref:AC-3) Implement convention-reading step in gsd-prototyper that discovers naming patterns, module type, path aliases, and test structure from existing project files -->

## Patch 3: plan_prototype step — architecture mode variant

<!-- @gsd-ref(ref:ARCH-04) User sees proposed skeleton before files are written -->

Add architecture mode branch to the plan_prototype step:

```markdown
**If architecture mode:**

Plan the skeleton structure instead of feature files. The plan must include:

1. **Directory tree** — every directory to create, with purpose annotations
2. **Config files** — matching discovered conventions from step 1.5
3. **Interface/type files** — one per module boundary, defining the public API surface
4. **Entry point stubs** — index files that re-export from module boundaries
5. **No feature files** — no route handlers, no service implementations, no database models

Format the plan as a tree:

```
project-root/
  src/
    index.ts          — entry point, re-exports public API
    types/
      index.ts        — shared type definitions
    [module-a]/
      index.ts        — module boundary (barrel export)
      types.ts        — module-specific interfaces
    [module-b]/
      index.ts        — module boundary (barrel export)
      types.ts        — module-specific interfaces
  config/
    [config files matching project conventions]
  tests/
    [test structure matching project conventions]
```

Display this tree to the user via the Task() response. The command layer (prototype.md) will present it for confirmation before proceeding to file creation.
```

<!-- @gsd-todo(ref:AC-4) Implement skeleton preview in plan_prototype step that generates a directory tree for user confirmation before any files are written -->

## Patch 4: build_prototype step — architecture mode constraints

<!-- @gsd-ref(ref:ARCH-01) Architecture mode produces skeleton with folder structure, config, typed interfaces -->
<!-- @gsd-ref(ref:ARCH-04) Zero feature implementation -->
<!-- @gsd-constraint Architecture mode files must contain zero feature implementation -- only structure, interfaces, config, and annotated stubs -->

Add architecture mode constraints to the build_prototype step:

```markdown
**If architecture mode, apply these additional rules:**

1. **Every file gets a `@gsd-context` tag** at the top explaining its role in the architecture
2. **Every module boundary (index/barrel file) gets a `@gsd-decision` tag** explaining why this module exists as a separate boundary
3. **Interface files get `@gsd-api` tags** for each exported interface/type
4. **Config files get `@gsd-decision` tags** for non-obvious configuration choices
5. **Stub functions throw `new Error('Not implemented — architecture skeleton only')` or return type-safe placeholder values**
6. **No business logic, no route handlers, no database queries, no API calls**
7. **Match naming conventions from `project_conventions`** — if the project uses kebab-case directories, use kebab-case; if camelCase, use camelCase
8. **Match module system from `project_conventions`** — if ESM, use import/export; if CJS, use require/module.exports

Example architecture mode output for a module boundary:

```typescript
// @gsd-context(phase:11) User authentication module boundary -- handles all auth-related concerns
// @gsd-decision Separate auth module because authentication crosscuts multiple features and has distinct security constraints
// @gsd-ref(ref:ARCH-02) Architecture mode structural annotation

export { authenticateUser } from './authenticate.js';
export { validateToken } from './validate.js';
export type { AuthConfig, AuthResult, TokenPayload } from './types.js';
```

Example interface file:

```typescript
// @gsd-context(phase:11) Auth module type definitions -- public API surface for the auth boundary
// @gsd-api AuthConfig: configuration for the auth module; AuthResult: return type for authenticate operations

export interface AuthConfig {
  // @gsd-decision JWT chosen over session-based auth for stateless scaling
  tokenSecret: string;
  tokenExpiry: number;
  refreshEnabled: boolean;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  error?: string;
}

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}
```
```

<!-- @gsd-todo(ref:AC-2) Implement @gsd-decision and @gsd-context tag requirements at every module boundary in architecture mode build step -->

## Patch 5: Constraints section addition

Add to the `<constraints>` section:

```markdown
9. **In architecture mode, ZERO feature implementation code** — only structure, interfaces, config, and annotated module boundaries. If you find yourself writing business logic, STOP and replace with a stub.
10. **In architecture mode, every module boundary MUST have @gsd-decision and @gsd-context tags** — this is the primary value of architecture mode, not the file creation itself.
11. **In architecture mode, match project conventions** — discovered conventions from step 1.5 override agent defaults. When conventions exist, follow them. When they don't, document the default chosen as a @gsd-decision.
```

<!-- @gsd-constraint Architecture mode must produce zero feature implementation code -- the entire value proposition is structural decisions, not code -->
<!-- @gsd-pattern Convention-matching rule: discovered project conventions always override agent defaults in architecture mode -->
<!-- @gsd-risk If project has no conventions (greenfield), the agent must make and document default choices -- risk of opinionated defaults that don't match developer preferences, mitigated by the confirmation gate -->
