---
name: cap:scan
description: "Scan codebase for @cap-feature and @cap-todo tags with monorepo support. Traverses all workspace packages, updates Feature Map, reports coverage gaps."
argument-hint: "[--features NAME] [--json] [--monorepo]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @gsd-context CAP v2.0 scan command (final pass) -- adds monorepo workspace traversal and cross-package file references to the base scan flow. -->
<!-- @gsd-decision Monorepo detection is automatic -- checks package.json workspaces field and lerna.json. No --monorepo flag required (AC-80). -->
<!-- @gsd-decision Cross-package file references use full relative paths from project root (e.g., packages/core/src/auth.ts) to avoid ambiguity (AC-79). -->
<!-- @gsd-constraint Works seamlessly with normal single-repo projects -- monorepo features are additive, not blocking (AC-80). -->

<!-- @gsd-todo(ref:AC-78) /cap:scan shall traverse all packages in a monorepo -->
<!-- @gsd-todo(ref:AC-79) Feature Map entries shall support cross-package file references -->
<!-- @gsd-todo(ref:AC-80) CAP shall work seamlessly with normal single-repo projects with no monorepo-specific configuration required -->

<objective>
Scans the codebase for @cap-feature and @cap-todo tags. In monorepo projects, automatically detects and traverses all workspace packages. Cross-references against FEATURE-MAP.md, flags orphan tags, and auto-enriches Feature Map with discovered file references.

**Monorepo support:**
- Automatically detects npm/yarn/pnpm workspaces from package.json `workspaces` field
- Detects Lerna monorepos from lerna.json
- Traverses all workspace packages independently
- File references use full paths from project root (e.g., `packages/core/src/auth.ts`)

**Arguments:**
- `--features NAME` -- scope scan to specific Feature Map entries (comma-separated)
- `--json` -- output raw scan results as JSON instead of formatted report
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

## Step 1: Detect monorepo configuration

<!-- @gsd-decision Monorepo detection reads package.json workspaces and lerna.json. Supports npm, yarn, pnpm workspace patterns. Glob expansion uses Bash for simplicity. -->

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

## Step 2: Run tag scanner (with monorepo awareness)

If monorepo detected, scan each workspace package independently AND the root:

```bash
node -e "
const scanner = require('./get-shit-done/bin/lib/cap-tag-scanner.cjs');
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

Store as `all_tags`.

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

<!-- @gsd-decision Cross-package file refs are stored as full relative paths from project root. This means packages/core/src/auth.ts, not just src/auth.ts. Feature Map readers can identify the package from the path prefix. -->

```bash
node -e "
const scanner = require('./get-shit-done/bin/lib/cap-tag-scanner.cjs');
const fm = require('./get-shit-done/bin/lib/cap-feature-map.cjs');
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
const session = require('./get-shit-done/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:scan',
  lastCommandTimestamp: new Date().toISOString()
});
"
```

</process>
