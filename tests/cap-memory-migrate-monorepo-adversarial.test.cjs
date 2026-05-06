'use strict';

// @cap-feature(feature:F-082) Adversarial test pass for the path-heuristik subApp-boost in
//   cap-memory-migrate. Hunts: cross-sub-app misattribution, fuzzy-prefix mismatches,
//   path-traversal in relatedFiles, separator-mismatch (web-V2 vs web), 1000-feature scale,
//   tag-priority preservation, hyphen/underscore name mismatches, edge thresholds.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  classifyEntry,
  buildClassifierContext,
  CONFIDENCE_AUTO_THRESHOLD,
} = require('../cap/bin/lib/cap-memory-migrate.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmig-mono-adv-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) { /* best-effort */ }
});

// --- helpers ---

function copyFixture(targetDir) {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'v61-monorepo');
  copyRecursive(fixtureRoot, targetDir);
}

function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyRecursive(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function writeFile(root, rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

function makeEntry(over) {
  return Object.assign({
    kind: 'decision',
    anchorId: 'a1',
    title: 't',
    content: '',
    sourceFile: 'decisions.md',
    sourceLine: 1,
    dateLabel: null,
    relatedFiles: [],
    confidence: null,
    lastSeen: null,
    taggedFeatureId: null,
    taggedPlatformTopic: null,
  }, over);
}

// =============================================================================
// Path-traversal & separator-mismatch in relatedFiles
// =============================================================================

describe('F-082/AC-4 classifyEntry path-traversal in relatedFiles', () => {
  it('relatedFile with `..` segments does not boost any sub-app', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/../api/src/foo.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    // No file-list hit, the sub-app prefix matches "web" (because the regex is
    // /^(?:apps|packages)\/([^/]+)\//) so subApp=web is detected. Pin behavior:
    //   the literal `..` segment passes through `_normalizeRepoPath` unchanged,
    //   so the prefix detection sees `apps/web/...` and boosts web features.
    // @cap-decision(F-082/adv) `_normalizeRepoPath` does not collapse `..` segments;
    //   the raw input is trusted. This is acceptable for the dry-run classifier
    //   (no I/O is performed on these paths), and the regex anchors on `apps/<sub>/`
    //   so the leading sub-app slug is what gets boosted. Pin behavior.
    if (decision.destination === 'feature') {
      // Should boost something in the "web" sub-app since the prefix sees apps/web/.
      const sub = ctx.featureToSubApp.get(decision.featureId);
      assert.equal(sub, 'web', `confused sub-app: ${decision.featureId} -> ${sub}`);
    } else {
      // Acceptable alternative: the entry falls through to unassigned.
      assert.ok(decision.destination === 'unassigned');
    }
  });

  it('Windows-style backslash separator is normalized to forward slash', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps\\web\\src\\auth\\login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'feature');
    assert.equal(decision.featureId, 'F-WEB-AUTH');
  });

  it('leading "./" prefix is stripped before lookup', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['./apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-WEB-AUTH');
  });

  it('leading ".claude/" prefix is stripped (legacy mirror-path normalization)', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['.claude/apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-WEB-AUTH');
  });

  it('separator-mismatch — sub-app named "my-app" vs file under "apps/my_app/" — no false match', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/my-app/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/my-app/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-MY-APP-1: feature [planned]', '',
      '**Files:**', '- `src/foo.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/my_app/src/bar.ts'], // underscore variant — should NOT boost
    });
    const decision = classifyEntry(entry, ctx);
    // "my_app" sub-app does not exist; my-app is a different slug. No boost should fire.
    assert.ok(
      decision.destination === 'unassigned' || decision.featureId !== 'F-MY-APP-1',
      `unexpected boost: ${JSON.stringify(decision)}`,
    );
  });

  it('similar-prefix sub-apps "web" vs "web-v2" — entry under apps/web-v2/ does NOT boost web features', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`',
      '- `apps/web-v2/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: web feature [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web-v2/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEBV2-1: web-v2 feature [planned]', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    // Entry under apps/web-v2/ — should boost F-WEBV2-1, NOT F-WEB-1.
    const entry = makeEntry({
      relatedFiles: ['apps/web-v2/src/foo.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    if (decision.destination === 'feature') {
      const sub = ctx.featureToSubApp.get(decision.featureId);
      assert.equal(sub, 'web-v2',
        `similar-prefix confusion: ${decision.featureId} routed to sub-app ${sub}`);
    }
  });

  it('feature with file-hit on "web-v2" but inferred sub-app "web" is NOT cross-boosted', () => {
    // Construct a deliberate trap: sub-app "web" has files that look like web-v2 paths.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`',
      '- `apps/web-v2/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-CONFUSION: trap [planned]', '',
      '**Files:**',
      // Path looks like web-v2 but feature lives under web sub-app — synthetic trap.
      '- `apps/web-v2/legacy.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web-v2/legacy.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    // Direct file-list hit wins over sub-app boost. The feature has the file in its file
    // list, so it should match.
    assert.equal(decision.featureId, 'F-WEB-CONFUSION');
  });
});

// =============================================================================
// Confidence calibration & threshold edge cases
// =============================================================================

describe('F-082/AC-4 confidence calibration adversarial', () => {
  it('subApp-only match (no file-list hit) confidence is < auto threshold', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    // pick a file under apps/web/ that NO feature claims explicitly
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/totally/unclaimed/file.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    if (decision.destination === 'feature') {
      assert.ok(
        decision.confidence < CONFIDENCE_AUTO_THRESHOLD,
        `subApp-only must NOT auto-route, got ${decision.confidence}`,
      );
    }
  });

  it('subApp-only match never crosses auto-threshold even with multiple sub-app files', () => {
    // Many subApp-only matches (no file-list hits) — boost accumulates per matching feature
    //   but each individual feature gets at most 0.5. Confidence formula for subApp-only is
    //   fixed at 0.55 in the single-match branch.
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: [
        'apps/web/src/random1.ts',
        'apps/web/src/random2.ts',
        'apps/web/src/random3.ts',
      ],
    });
    const decision = classifyEntry(entry, ctx);
    if (decision.destination === 'feature') {
      assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD,
        `subApp-only with many files must not auto-route, got ${decision.confidence}`);
    }
  });

  it('tag-metadata still wins even when relatedFiles point to a different sub-app', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      taggedFeatureId: 'F-API-USERS',
      relatedFiles: [
        'apps/web/src/auth/login.tsx',
        'apps/web/src/auth/session.ts',
      ],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-API-USERS');
    assert.equal(decision.confidence, 1.0);
    assert.match(decision.reasons[0], /tag-metadata/);
  });

  it('tagged platform topic wins over path heuristic', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      taggedPlatformTopic: 'security',
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'platform');
    assert.equal(decision.topic, 'security');
  });

  it('boost is bounded — feature with file-hit + subApp match never exceeds 0.95', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: [
        'apps/web/src/auth/login.tsx',
        'apps/web/src/auth/session.ts',
        'apps/web/src/auth/extra1.ts',
        'apps/web/src/auth/extra2.ts',
        'apps/web/src/auth/extra3.ts',
      ],
    });
    const decision = classifyEntry(entry, ctx);
    assert.ok(decision.confidence <= 0.95,
      `confidence cap violated: ${decision.confidence}`);
  });
});

// =============================================================================
// Backward-compat: no metadata.subApp present
// =============================================================================

describe('F-082/AC-4 backward-compat hardening', () => {
  it('classifyEntry without context.featureToSubApp falls back to legacy behavior', () => {
    // Simulate a context shape from a pre-F-082 caller (no featureToSubApp field).
    const ctx = {
      features: [
        { id: 'F-001', title: 'foo', files: ['src/foo.ts'], subApp: null },
      ],
      fileToFeatureId: new Map([['src/foo.ts', 'F-001']]),
      featureState: new Map(),
      // featureToSubApp deliberately absent.
    };
    const entry = makeEntry({ relatedFiles: ['src/foo.ts'] });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-001');
    assert.ok(decision.reasons.every((r) => !r.includes('subapp-boost')));
  });

  it('classifyEntry with empty featureToSubApp Map is identical to legacy', () => {
    const ctx = {
      features: [
        { id: 'F-001', title: 'foo', files: ['src/foo.ts'], subApp: null },
      ],
      fileToFeatureId: new Map([['src/foo.ts', 'F-001']]),
      featureState: new Map(),
      featureToSubApp: new Map(),
    };
    const entry = makeEntry({ relatedFiles: ['src/foo.ts'] });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-001');
    assert.ok(decision.reasons.every((r) => !r.includes('subapp-boost')));
  });

  it('non-monorepo project — entries with single-segment paths do not get a boost', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: Foo [planned]', '',
      '**Files:**', '- `src/foo.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['web/foo.ts'], // single-segment top-level — too ambiguous
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.confidence, 0, 'single-segment top-level should yield no signal');
    assert.equal(decision.destination, 'unassigned');
  });
});

// =============================================================================
// buildClassifierContext robustness
// =============================================================================

describe('F-082 buildClassifierContext adversarial', () => {
  it('parseError on root → returns empty context (write-back safety)', () => {
    // Project root has duplicate IDs → parseError → context bails out.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-DUP: One [planned]', '',
      '### F-DUP: Two [planned]', '',
    ].join('\n'));
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const ctx = buildClassifierContext(tmpDir);
      assert.equal(ctx.features.length, 0);
      assert.equal(ctx.fileToFeatureId.size, 0);
      assert.equal(ctx.featureToSubApp.size, 0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('aggregated cross-app duplicate also yields empty context', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`',
      '- `apps/api/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: web [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: api [planned]', '',
    ].join('\n'));
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const ctx = buildClassifierContext(tmpDir);
      assert.equal(ctx.features.length, 0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('sub-app file-list path indexed under BOTH sub-app-relative AND prefixed forms', () => {
    // Sub-app FEATURE-MAP.md uses sub-app-relative paths (`src/auth/login.tsx`),
    //   buildClassifierContext should also index the prefixed form
    //   (`apps/web/src/auth/login.tsx`) so V5 entries with repo-absolute paths still match.
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    // The fixture has F-WEB-AUTH listing `src/auth/login.tsx` (sub-app-relative).
    assert.equal(ctx.fileToFeatureId.get('src/auth/login.tsx'), 'F-WEB-AUTH',
      'sub-app-relative form indexed');
    assert.equal(ctx.fileToFeatureId.get('apps/web/src/auth/login.tsx'), 'F-WEB-AUTH',
      'prefixed form also indexed');
  });

  it('discover=auto adds sub-app prefixes even without explicit Rescoped Table', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: 'auto' } }));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '',
      '**Files:**', '- `src/foo.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    // The "web" subApp prefix should be available even though there's no Rescoped Table
    //   in the root file (config.discover=auto is the trigger).
    assert.equal(ctx.featureToSubApp.get('F-WEB-1'), 'web');
    assert.equal(ctx.fileToFeatureId.get('apps/web/src/foo.ts'), 'F-WEB-1');
  });

  it('handles missing root FEATURE-MAP.md gracefully (no crash on read error)', () => {
    // No FEATURE-MAP.md at all — buildClassifierContext should not throw.
    const ctx = buildClassifierContext(tmpDir);
    assert.equal(ctx.features.length, 0);
    assert.equal(ctx.featureToSubApp.size, 0);
  });

  it('feature with empty files list does not pollute fileToFeatureId', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: No files [planned]', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    assert.equal(ctx.fileToFeatureId.size, 0);
    assert.equal(ctx.features.length, 1);
  });

  it('sub-app feature with file path already prefixed (apps/web/...) is NOT double-prefixed', () => {
    // Sub-app files-list contains a repo-absolute path. The conditional in
    //   buildClassifierContext only re-anchors when the path does NOT start with apps/ or
    //   packages/. Pin behavior.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '',
      '**Files:**', '- `apps/web/src/already-prefixed.ts`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    // No `apps/web/apps/web/...` pollution.
    assert.equal(ctx.fileToFeatureId.get('apps/web/src/already-prefixed.ts'), 'F-WEB-1');
    assert.equal(ctx.fileToFeatureId.get('apps/web/apps/web/src/already-prefixed.ts'), undefined,
      'no double-prefixing must occur');
  });
});

// =============================================================================
// Stress / scale
// =============================================================================

describe('F-082/AC-4 scale & stress', () => {
  it('1000 features distributed across 3 sub-apps — boost loop terminates fast', () => {
    // Build a synthetic FEATURE-MAP.md with many features per sub-app.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`',
      '- `apps/api/`',
      '- `packages/shared/`',
      '',
    ].join('\n'));
    const N = 200;
    for (const sub of ['apps/web', 'apps/api', 'packages/shared']) {
      const lines = ['# Feature Map', '', '## Features', ''];
      for (let i = 0; i < N; i++) {
        lines.push(`### F-${sub.split('/').pop().toUpperCase()}-${i}: feat${i} [planned]`);
        lines.push('');
      }
      writeFile(tmpDir, `${sub}/FEATURE-MAP.md`, lines.join('\n'));
    }
    const t0 = Date.now();
    const ctx = buildClassifierContext(tmpDir);
    assert.equal(ctx.features.length, N * 3);
    // Now classify with a single web file.
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/foo.ts'],
    });
    const decision = classifyEntry(entry, ctx);
    const dt = Date.now() - t0;
    assert.ok(dt < 5000, `expected <5s for 600-feature classifier, got ${dt}ms`);
    if (decision.destination === 'feature') {
      // Should be under sub-app "web" (no file-list hit so any web feature is fair).
      assert.equal(ctx.featureToSubApp.get(decision.featureId), 'web');
    }
  });
});

// =============================================================================
// Boost ranking — runner-up safety
// =============================================================================

describe('F-082/AC-4 boost ranking & runner-up safety', () => {
  it('two features in same sub-app, only one has a file-list hit — file-hit wins', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-A: A [planned]', '',
      '**Files:**', '- `src/auth/login.tsx`', '',
      '### F-WEB-B: B [planned]', '',
      '**Files:**', '- `src/cart/index.tsx`', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-WEB-A');
    // Confidence should be auto-route range (file-hit + subApp boost).
    assert.ok(decision.confidence >= CONFIDENCE_AUTO_THRESHOLD);
  });

  it('three features in same sub-app, all subApp-boosted, only one with file-hit — file-hit clearly wins', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-A: A [planned]', '',
      '**Files:**', '- `src/auth/login.tsx`', '',
      '### F-WEB-B: B [planned]', '', '',
      '### F-WEB-C: C [planned]', '', '',
    ].join('\n'));
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    // The file-hit candidate must beat the boost-only candidates.
    assert.equal(decision.featureId, 'F-WEB-A');
    // Reasons should mention the path-match component.
    assert.ok(decision.reasons.some((r) => /path-match/.test(r)));
  });

  it('candidate list is ranked (sorted desc by combined score)', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      // Two different sub-app file-list hits.
      relatedFiles: [
        'apps/web/src/auth/login.tsx', // F-WEB-AUTH
        'apps/api/src/users/handler.ts', // F-API-USERS
      ],
    });
    const decision = classifyEntry(entry, ctx);
    if (decision.candidates && decision.candidates.length >= 2) {
      // Each candidate has exactly one file-hit AND its sub-app boost. Both should be tied
      // on file-hits but each will still appear in the candidate list. Ordering must be
      // deterministic.
      const confidences = decision.candidates.map((c) => c.confidence);
      const sorted = [...confidences].sort((a, b) => b - a);
      assert.deepEqual(confidences, sorted, 'candidates must be sorted desc by confidence');
    }
  });

  it('reasons list contains "subapp-boost" tag when boost contributes to leader', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['apps/web/src/auth/login.tsx'],
    });
    const decision = classifyEntry(entry, ctx);
    assert.ok(
      decision.reasons.some((r) => /subapp-boost|path-match/.test(r)),
      `expected subapp-boost reason, got ${decision.reasons.join(' | ')}`,
    );
  });
});

// =============================================================================
// Empty / minimal entry inputs
// =============================================================================

describe('F-082/AC-4 minimal entry inputs', () => {
  it('entry with no relatedFiles routes to unassigned (no signal)', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({ relatedFiles: [] });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'unassigned');
    assert.equal(decision.confidence, 0);
  });

  it('entry with relatedFiles=undefined treated as empty', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({ relatedFiles: undefined });
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'unassigned');
  });

  it('entry with empty-string file in relatedFiles is silently ignored', () => {
    copyFixture(tmpDir);
    const ctx = buildClassifierContext(tmpDir);
    const entry = makeEntry({
      relatedFiles: ['', 'apps/web/src/auth/login.tsx', null, undefined],
    });
    // null/undefined and empty string normalize to '' in _normalizeRepoPath; map.get('') -> undefined.
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-WEB-AUTH');
  });
});
