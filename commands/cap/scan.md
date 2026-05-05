---
name: cap:scan
description: "Scan codebase for @cap-feature and @cap-todo tags with monorepo support. Traverses all workspace packages, updates Feature Map, reports coverage gaps."
argument-hint: "[--features NAME] [--json] [--monorepo] [--strict]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-context CAP v2.0 scan command (final pass) -- adds monorepo workspace traversal and cross-package file references to the base scan flow. -->
<!-- @cap-decision Monorepo detection is automatic -- checks package.json workspaces field and lerna.json. No --monorepo flag required (AC-80). -->
<!-- @cap-decision Cross-package file references use full relative paths from project root (e.g., packages/core/src/auth.ts) to avoid ambiguity (AC-79). -->
<!-- @cap-constraint Works seamlessly with normal single-repo projects -- monorepo features are additive, not blocking (AC-80). -->

<!-- @cap-todo(ref:AC-78) /cap:scan shall traverse all packages in a monorepo -->
<!-- @cap-todo(ref:AC-79) Feature Map entries shall support cross-package file references -->
<!-- @cap-todo(ref:AC-80) CAP shall work seamlessly with normal single-repo projects with no monorepo-specific configuration required -->
<!-- @cap-feature(feature:F-046) Polylingual tag context detection: --strict flag fails the scan if any @cap-* token is found outside a recognized comment context. -->
<!-- @cap-todo(ac:F-046/AC-4) /cap:scan --strict invokes scanner.scanDirectoryWithContext with strict:true for CI enforcement. -->

<objective>
Scans the codebase for @cap-feature and @cap-todo tags. In monorepo projects, automatically detects and traverses all workspace packages. Cross-references against FEATURE-MAP.md, flags orphan tags, and auto-enriches Feature Map with discovered file references.

**Monorepo support:**
- Automatically detects npm/yarn/pnpm workspaces from package.json `workspaces` field
- Detects Lerna monorepos from lerna.json
- Traverses all workspace packages independently
- File references use full paths from project root (e.g., `packages/core/src/auth.ts`)

**Polylingual context detection (F-046):**
- The scanner now classifies each `@cap-*` match against the file's comment syntax (per extension).
- Tokens found outside any recognized comment (e.g. inside a string literal) are NOT parsed as tags but are reported as warnings.
- Supported comment styles: `//`, `/* */` (JS/TS/Go/Rust/C/Java/CSS/SCSS), `#` (Python/Ruby/Shell/YAML/TOML), `"""`/`'''` (Python triple-quote), `=begin`/`=end` (Ruby), `///` (Rust doc), `<!-- -->` (HTML/Markdown), `--` (SQL).

**Arguments:**
- `--features NAME` -- scope scan to specific Feature Map entries (comma-separated)
- `--json` -- output raw scan results as JSON instead of formatted report
- `--strict` -- (F-046/AC-4) fail the scan with a non-zero exit code if ANY `@cap-*` token is found outside a recognized comment. Intended for CI enforcement.
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--features NAME` -- if present, store as `feature_filter`
- `--json` -- if present, set `json_output = true`
- `--strict` -- if present, set `strict_mode = true` (F-046/AC-4)

## Step 0b: Check active app scoping

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(JSON.stringify({ activeApp: s.activeApp }));
"
```

Store as `app_scope`. If `app_scope.activeApp` is set, this scan will be scoped to the active app directory and its shared packages. The results will be written to the app's FEATURE-MAP.md (not root).

## Step 1: Detect monorepo configuration

<!-- @cap-decision Monorepo detection reads package.json workspaces and lerna.json. Supports npm, yarn, pnpm workspace patterns. Glob expansion uses Bash for simplicity. -->

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const pkgPath = path.join(process.cwd(), 'package.json');
const lernaPath = path.join(process.cwd(), 'lerna.json');
const result = { isMonorepo: false, workspaces: [], packages: [] };

// Check package.json workspaces
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.workspaces) {
      result.isMonorepo = true;
      result.workspaces = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces.packages || []);
    }
  } catch (_e) {}
}

// Check pnpm-workspace.yaml
const pnpmPath = path.join(process.cwd(), 'pnpm-workspace.yaml');
if (!result.isMonorepo && fs.existsSync(pnpmPath)) {
  try {
    const content = fs.readFileSync(pnpmPath, 'utf8');
    const packagesMatch = content.match(/packages:\\s*\\n((?:\\s+-\\s*.+\\n?)*)/);
    if (packagesMatch) {
      result.isMonorepo = true;
      result.workspaces = packagesMatch[1]
        .split('\\n')
        .map(line => line.replace(/^\\s*-\\s*['\"]?/, '').replace(/['\"]?\\s*$/, ''))
        .filter(Boolean);
    }
  } catch (_e) {}
}

// Check nx.json
const nxPath = path.join(process.cwd(), 'nx.json');
if (!result.isMonorepo && fs.existsSync(nxPath)) {
  try {
    const nx = JSON.parse(fs.readFileSync(nxPath, 'utf8'));
    result.isMonorepo = true;
    const layout = nx.workspaceLayout || {};
    const patterns = [];
    if (layout.appsDir) patterns.push(layout.appsDir + '/*');
    if (layout.libsDir) patterns.push(layout.libsDir + '/*');
    if (patterns.length === 0) {
      for (const dir of ['apps', 'packages', 'libs']) {
        if (fs.existsSync(path.join(process.cwd(), dir))) {
          patterns.push(dir + '/*');
        }
      }
    }
    result.workspaces = patterns;
  } catch (_e) {}
}

// Check lerna.json
if (!result.isMonorepo && fs.existsSync(lernaPath)) {
  try {
    const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf8'));
    result.isMonorepo = true;
    result.workspaces = lerna.packages || ['packages/*'];
  } catch (_e) {}
}

// Resolve workspace globs to actual package directories
if (result.isMonorepo) {
  for (const ws of result.workspaces) {
    const wsBase = ws.replace('/*', '').replace('/**', '');
    const wsDir = path.join(process.cwd(), wsBase);
    if (fs.existsSync(wsDir) && fs.statSync(wsDir).isDirectory()) {
      const entries = fs.readdirSync(wsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pkgJsonPath = path.join(wsDir, entry.name, 'package.json');
          if (fs.existsSync(pkgJsonPath)) {
            result.packages.push(path.join(wsBase, entry.name));
          }
        }
      }
    }
  }
}

console.log(JSON.stringify(result, null, 2));
"
```

Store as `monorepo_info`. Log project type:
- Monorepo: "Detected monorepo with {N} workspace packages: {list}"
- Single repo: "Single repository project detected."

## Step 2: Run tag scanner (with monorepo and app-scoping awareness)

**If `app_scope.activeApp` is set (app-scoped scan):**

Scan only the active app directory and its referenced shared packages:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const projectRoot = process.cwd();
const appPath = process.argv[1];
const result = scanner.scanApp(projectRoot, appPath);
console.log(JSON.stringify({ tags: result.tags, scannedDirs: result.scannedDirs }, null, 2));
" '<ACTIVE_APP_PATH>'
```

Log: "App-scoped scan: {activeApp} (+ {N} shared packages)"

**Else if monorepo detected (full monorepo scan):**

Scan each workspace package independently AND the root:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fs = require('node:fs');
const path = require('node:path');

const monorepoInfo = JSON.parse(process.argv[1]);
const projectRoot = process.cwd();

if (monorepoInfo.isMonorepo) {
  // Scan root first
  const rootTags = scanner.scanDirectory(projectRoot, { projectRoot });
  const allTags = [...rootTags];

  // Scan each workspace package
  for (const pkg of monorepoInfo.packages) {
    const pkgDir = path.join(projectRoot, pkg);
    if (fs.existsSync(pkgDir)) {
      const pkgTags = scanner.scanDirectory(pkgDir, { projectRoot });
      allTags.push(...pkgTags);
    }
  }

  // Deduplicate by file+line
  const seen = new Set();
  const deduped = allTags.filter(t => {
    const key = t.file + ':' + t.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(JSON.stringify(deduped, null, 2));
} else {
  const tags = scanner.scanDirectory(projectRoot);
  console.log(JSON.stringify(tags, null, 2));
}
" '<MONOREPO_INFO_JSON>'
```

**Else (single repo):**

Standard scan as before.

Store as `all_tags`.

## Step 2b: Polylingual context check (only when `--strict` is set)

<!-- @cap-decision When --strict is set, run the polylingual scanner in strict mode. It throws on any @cap-* token outside a recognized comment (string literal, code reference). Intended for CI enforcement (F-046/AC-4). -->

If `strict_mode === true`:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
try {
  const result = scanner.scanDirectoryWithContext(process.cwd(), { strict: true });
  console.log(JSON.stringify({ ok: true, tags: result.tags.length, warnings: result.warnings.length }));
} catch (e) {
  if (e.code === 'CAP_STRICT_TAG_VIOLATION') {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
"
```

If the command exits non-zero, surface the violation list to the user and abort the scan (do NOT proceed to enrichment). Otherwise continue to Step 3.

When `strict_mode === false` (default), the polylingual scan still runs but warnings are silently collected (available in `--json` output) and do not block the scan.

## Step 3: Group tags by feature and by package

```bash
node -e "
const tags = JSON.parse(process.argv[1]);
const groups = {};
const packageGroups = {};

for (const tag of tags) {
  // Group by feature
  const fid = (tag.metadata && tag.metadata.feature) || '(unassigned)';
  if (!groups[fid]) groups[fid] = [];
  groups[fid].push(tag);

  // Group by package (first path segment if monorepo)
  const parts = tag.file.split('/');
  const pkg = parts.length > 2 && parts[0] === 'packages' ? parts[0] + '/' + parts[1] : '(root)';
  if (!packageGroups[pkg]) packageGroups[pkg] = [];
  packageGroups[pkg].push(tag);
}

console.log(JSON.stringify({ byFeature: groups, byPackage: packageGroups }, null, 2));
" '<ALL_TAGS_JSON>'
```

## Step 4: Cross-reference and detect orphans

Same as base scan -- run orphan detection against FEATURE-MAP.md.

## Step 5: Auto-enrich Feature Map with cross-package file references

<!-- @cap-decision Cross-package file refs are stored as full relative paths from project root. This means packages/core/src/auth.ts, not just src/auth.ts. Feature Map readers can identify the package from the path prefix. -->

**If app-scoped (activeApp set):** Enrich the app's FEATURE-MAP.md, not root.

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const activeApp = process.argv[1] === 'null' ? null : process.argv[1];
const tags = JSON.parse(process.argv[2]);
const updated = fm.enrichFromTags(process.cwd(), tags, activeApp);
console.log(JSON.stringify({
  features_enriched: updated.features.filter(f => f.files.length > 0).length,
  total_file_refs: updated.features.reduce((sum, f) => sum + f.files.length, 0),
  cross_package_refs: updated.features.reduce((sum, f) =>
    sum + f.files.filter(fp => fp.startsWith('packages/')).length, 0)
}));
" '<ACTIVE_APP_OR_NULL>' '<ALL_TAGS_JSON>'
```

**If not app-scoped (full scan):**

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const tags = scanner.scanDirectory(process.cwd());
const updated = fm.enrichFromTags(process.cwd(), tags);
console.log(JSON.stringify({
  features_enriched: updated.features.filter(f => f.files.length > 0).length,
  total_file_refs: updated.features.reduce((sum, f) => sum + f.files.length, 0),
  cross_package_refs: updated.features.reduce((sum, f) =>
    sum + f.files.filter(fp => fp.startsWith('packages/')).length, 0)
}));
"
```

## Step 5b: Record regret signals from @cap-decision regret:true tags (F-070/AC-3)

<!-- @cap-todo(ac:F-070/AC-3) Decision-Regret collector runs from /cap:scan, not from a hook (regret detection is retrospective and would blow F-070/AC-5's hook-overhead budget if scanned per Stop). -->
<!-- @cap-decision(F-070/D4) Trigger split — hooks fire override / memory-ref; tag-scanner enrichment fires regret. -->

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const learning = require('./cap/bin/lib/cap-learning-signals.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const tags = scanner.scanDirectory(process.cwd(), { projectRoot: process.cwd() });
let sessionId = null;
try { const s = session.loadSession(process.cwd()); sessionId = s && s.sessionId || null; } catch(_e){}
const result = learning.recordRegretsFromScan(process.cwd(), tags, { sessionId });
console.log(JSON.stringify(result));
"
```

## Step 6: Output results

**Formatted report (default):**

```
cap:scan complete.

{If monorepo:}
Monorepo: {workspace_count} packages scanned
  {For each package:}
  - {package_name}: {tag_count} tags

Tags found: {total_tags}
  @cap-feature: {count}
  @cap-todo:    {count}
  @cap-risk:    {count}
  @cap-decision:{count}

Coverage: {files_with_tags} of {total_source_files} source files ({percentage}%)

Feature Map enrichment:
  Features with file refs: {N}
  Total file references:   {N}
  {If monorepo:} Cross-package refs: {N}

{Orphan section same as base scan}

Feature breakdown:
{For each feature group:}
  {feature_id}: {count} tags ({type breakdown})
```

## Step 7: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:scan',
  lastCommandTimestamp: new Date().toISOString()
});
"
```

</process>
