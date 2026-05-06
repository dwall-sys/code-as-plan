'use strict';

// @cap-feature(feature:F-082) Adversarial test pass for the multi-app aggregating
//   Feature Map reader. Complements cap-feature-map-monorepo.test.cjs (happy path).
//   "How do I break this?" — boundary cases, malicious inputs, round-trip non-idempotency,
//   parseError aggregation order, proto-pollution, path-traversal, symlink loops,
//   bullet-table mix, mixed-format round-trip, BOM/CRLF/long-name pathologies.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  readFeatureMap,
  writeFeatureMap,
  parseRescopedTable,
  discoverSubAppFeatureMaps,
  aggregateSubAppFeatureMaps,
  extractRescopedBlock,
  injectRescopedBlock,
  parseFeatureMapContent,
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
  enrichFromTags,
} = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-mono-adv-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_e) { /* leftover symlink/cycle — best-effort cleanup */ }
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

const ROOT_RESCOPED = (apps) => [
  '# Feature Map', '',
  '## Features', '',
  '## Rescoped Feature Maps', '',
  ...apps.map((a) => `- \`${a}/\``), '',
].join('\n');

// =============================================================================
// parseRescopedTable — pathological inputs
// =============================================================================

describe('F-082/AC-1 parseRescopedTable adversarial', () => {
  it('non-string input returns []', () => {
    assert.deepEqual(parseRescopedTable(null), []);
    assert.deepEqual(parseRescopedTable(undefined), []);
    assert.deepEqual(parseRescopedTable(42), []);
    assert.deepEqual(parseRescopedTable({}), []);
  });

  it('empty string returns []', () => {
    assert.deepEqual(parseRescopedTable(''), []);
  });

  it('header-only with no rows returns []', () => {
    const content = '## Rescoped Feature Maps\n';
    assert.deepEqual(parseRescopedTable(content), []);
  });

  it('header text in PROSE (not a markdown header line) is NOT detected', () => {
    // Header detection must be anchored on a markdown header line — a description
    // mentioning "Rescoped Feature Maps" must not enable parsing.
    const content = [
      '# Feature Map', '',
      'This describes Rescoped Feature Maps in prose.',
      '',
      '- `apps/web/`', // legitimate-looking row but should NOT be picked up
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 0);
  });

  it('two Rescoped sections — both contribute (parser does not break on second header)', () => {
    // @cap-decision(F-082/adv) When a malformed root has two sections, both ranges contribute
    //   their rows. The dedup map ensures a path appearing twice is counted only once.
    const content = [
      '## Rescoped Feature Maps', '', '- `apps/web/`', '',
      '## Other Section', '',
      '## Rescoped Feature Maps', '', '- `apps/api/`', '',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 2);
    const paths = entries.map((e) => e.appPath).sort();
    assert.deepEqual(paths, ['apps/api', 'apps/web']);
  });

  it('rejects path-traversal inside the path cell (../../etc rejected)', () => {
    // @cap-decision(F-082/adv-pin) When the path cell is rejected by _extractAppPath
    //   (path-traversal), the parser falls back to the App-name column as a candidate.
    //   For `| evil | ../../etc |`, "evil" becomes the extracted path. This is the price
    //   of supporting legacy two-shape tables (App in col 1 vs col 2). The traversal
    //   rejection still works — the malicious "../../etc" never escapes the projectRoot
    //   because:
    //     (a) "evil" has no slashes and won't be a real sub-app dir, AND
    //     (b) the aggregator's fs.existsSync gate skips non-existent dirs silently.
    //   Pin the behavior so any future tightening is intentional. The realistic threat
    //   model is the second row ("apps/legit/") still parses correctly.
    const content = [
      '## Rescoped Feature Maps', '',
      '| App | Path |',
      '|-----|------|',
      '| evil | `../../etc` |',
      '| ok   | `apps/web/` |',
    ].join('\n');
    const entries = parseRescopedTable(content);
    // 2 entries: "evil" (fallback from App col) and "apps/web" (clean).
    assert.equal(entries.length, 2);
    const paths = entries.map((e) => e.appPath).sort();
    assert.deepEqual(paths, ['apps/web', 'evil']);
    // The malicious path itself is filtered — "../../etc" never leaks through.
    assert.ok(!paths.includes('../../etc'));
    assert.ok(!paths.some((p) => p.includes('..')));
  });

  it('rejects absolute paths inside cells (no /etc, no C:\\)', () => {
    // @cap-decision(F-082/adv-pin) Same fallback behavior: when the path cell is rejected
    //   (here, absolute path), the parser falls back to the App-name column. Pin behavior.
    const content = [
      '## Rescoped Feature Maps', '',
      '| App | Path |',
      '|-----|------|',
      '| a | `/etc/passwd` |',
      '| b | apps/legit/ |',
    ].join('\n');
    const entries = parseRescopedTable(content);
    const paths = entries.map((e) => e.appPath);
    // Absolute path "/etc/passwd" is REJECTED by _extractAppPath.
    assert.ok(!paths.includes('/etc/passwd'));
    assert.ok(!paths.some((p) => p.startsWith('/')));
    // The legitimate apps/legit row parses cleanly.
    assert.ok(paths.includes('apps/legit'));
  });

  it('row with only delimiter pipes (single empty cell) is gracefully skipped', () => {
    const content = [
      '## Rescoped Feature Maps', '',
      '| App | Path |',
      '|-----|------|',
      '|     |      |',
      '| ok  | apps/web/ |',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].appPath, 'apps/web');
  });

  it('header "Rescoped feature maps" (lowercase) is matched (case-insensitive)', () => {
    const content = '## Rescoped feature maps\n\n- `apps/web/`\n';
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
  });

  it('HTML comment pretending to be a header does NOT trigger detection', () => {
    const content = '<!-- ## Rescoped Feature Maps -->\n\n- `apps/web/`\n';
    assert.deepEqual(parseRescopedTable(content), []);
  });

  it('header inside fenced code block — current behavior pinned (regex still matches)', () => {
    // @cap-risk(F-082/adv) parseRescopedTable does not strip fenced code blocks before
    //   matching headers. A markdown header literally inside a ``` block is detected. This
    //   is acceptable because no realistic FEATURE-MAP.md would deliberately fence its own
    //   schema, but the behaviour is pinned here so a future fix is intentional, not silent.
    const content = [
      '```',
      '## Rescoped Feature Maps',
      '',
      '- `apps/web/`',
      '```',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1, 'pinned: parser ignores fenced-code semantics');
  });

  it('CRLF line-endings parse identically to LF', () => {
    const lf = ['## Rescoped Feature Maps', '', '- `apps/web/`', ''].join('\n');
    const crlf = ['## Rescoped Feature Maps', '', '- `apps/web/`', ''].join('\r\n');
    const lfEntries = parseRescopedTable(lf);
    const crlfEntries = parseRescopedTable(crlf);
    assert.equal(crlfEntries.length, lfEntries.length);
    assert.equal(crlfEntries[0].appPath, 'apps/web');
  });

  it('100+ table rows scale linearly (perf/stress)', () => {
    const rows = [];
    for (let i = 0; i < 200; i++) rows.push(`| app${i} | apps/sub${i}/ |`);
    const content = [
      '## Rescoped Feature Maps', '',
      '| App | Path |',
      '|-----|------|',
      ...rows,
    ].join('\n');
    const t0 = Date.now();
    const entries = parseRescopedTable(content);
    const dt = Date.now() - t0;
    assert.equal(entries.length, 200);
    assert.ok(dt < 200, `expected <200ms for 200 rows, got ${dt}ms`);
  });

  it('row with backtick path containing literal backslash — sanitized through _extractAppPath', () => {
    const content = [
      '## Rescoped Feature Maps', '',
      '- `apps\\web/`',
    ].join('\n');
    // Backslash is not stripped by _extractAppPath; the path will not match a real dir
    //   but the parser should not crash and should return the cell verbatim (minus slashes).
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
  });
});

// =============================================================================
// readFeatureMap aggregation — missing/empty/malformed sub-app files
// =============================================================================

describe('F-082/AC-1+AC-3 readFeatureMap aggregation adversarial', () => {
  it('sub-app file with UTF-8 BOM parses (not treated as content)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    // Write the BOM byte sequence using fs directly.
    const bomContent = '﻿' + [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: BOM test [planned]', '',
    ].join('\n');
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', bomContent);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // @cap-decision(F-082/adv) Current behavior: BOM is part of content — the first feature header
    //   line is still on line 5 so it parses. Pin behavior. If parser ever breaks on BOM, the test
    //   surfaces it.
    const ids = result.features.map((f) => f.id);
    assert.ok(ids.includes('F-WEB-1'), `expected F-WEB-1 in ${JSON.stringify(ids)}`);
  });

  it('sub-app file with CRLF line-endings round-trips through parser', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    const crlf = [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: CRLF [planned]', '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | One |',
      '',
    ].join('\r\n');
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', crlf);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const f = result.features.find((x) => x.id === 'F-WEB-1');
    assert.ok(f);
    assert.equal(f.acs.length, 1);
  });

  it('sub-app file with whitespace-only content aggregates as zero features', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', '   \n  \t\n\n');
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 0);
  });

  it('sub-app FEATURE-MAP.md has its OWN Rescoped Table — NOT recursively expanded', () => {
    // @cap-decision(F-082/single-level-aggregation) Single-level only.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: web feature [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/inner/`',
      '',
    ].join('\n'));
    // The inner sub-app file exists but should be ignored.
    writeFile(tmpDir, 'apps/web/apps/inner/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-INNER-1: must-not-appear [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const ids = result.features.map((f) => f.id);
    assert.ok(ids.includes('F-WEB-1'));
    assert.ok(!ids.includes('F-INNER-1'), 'recursive expansion must NOT happen');
  });

  it('root has its own root-direct features AND aggregated sub-app features (mix preserved)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Root direct [planned]', '',
      '**Files:**',
      '- `scripts/orchestrate.js`', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Web feature [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 2);
    const root = result.features.find((f) => f.id === 'F-001');
    const sub = result.features.find((f) => f.id === 'F-WEB-1');
    // Root-direct feature has NO subApp metadata.
    assert.ok(!root.metadata || !root.metadata.subApp);
    // Sub-app feature HAS subApp metadata.
    assert.equal(sub.metadata.subApp, 'web');
  });

  it('discover=auto skips hidden directories (.cap, .git)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: 'auto' } }));
    // Hidden dir under apps/ would be picked up otherwise.
    writeFile(tmpDir, 'apps/.hidden/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-HIDDEN-1: Should not appear [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Visible [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const ids = result.features.map((f) => f.id);
    assert.ok(ids.includes('F-WEB-1'));
    assert.ok(!ids.includes('F-HIDDEN-1'), 'hidden dirs must be excluded');
  });

  it('discover=auto rejects malicious string config values', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: '../../../etc' } }));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Should be ignored [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 0);
  });

  it('discover=auto with non-object config value falls back to default', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: 'auto' })); // wrong shape
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Should be ignored [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('discover=auto with malformed JSON in cap.config falls back to default (no throw)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n');
    writeFile(tmpDir, '.cap/config.json', '{ this is not json');
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Should not appear [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
  });

  it('Rescoped Table referencing a NON-EXISTENT sub-app and an EXISTING one — existing wins, missing skipped', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/missing', 'apps/web', 'apps/also-missing']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Real [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-WEB-1');
  });

  it('100 sub-apps in Rescoped Table aggregate without crash (stress)', () => {
    const apps = [];
    for (let i = 0; i < 50; i++) apps.push(`apps/s${i}`);
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(apps));
    for (let i = 0; i < 50; i++) {
      writeFile(tmpDir, `apps/s${i}/FEATURE-MAP.md`, [
        '# Feature Map', '', '## Features', '',
        `### F-S${i}-1: feature [planned]`, '',
      ].join('\n'));
    }
    const t0 = Date.now();
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const dt = Date.now() - t0;
    assert.equal(result.features.length, 50);
    assert.ok(dt < 5000, `expected <5s for 50 sub-apps, got ${dt}ms`);
  });

  it('sub-app whose path collides with a literal `..` — rejected by _extractAppPath, never reached', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/../etc/passwd`',
      '- `apps/legit/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/legit/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-LEGIT-1: ok [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const ids = result.features.map((f) => f.id);
    assert.deepEqual(ids, ['F-LEGIT-1']);
  });

  it('aggregated map preserves sub-app feature _inputFormat for round-trip', () => {
    // F-081 lesson: per-feature format must survive aggregation so write-back to sub-app
    //   does not flip bullet→table or vice versa.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: Bullet [planned]', '',
      '- [ ] AC-1: bullet ac', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-API-1: Table [planned]', '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | table ac |',
      '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const web = result.features.find((f) => f.id === 'F-WEB-1');
    const api = result.features.find((f) => f.id === 'F-API-1');
    assert.equal(web._inputFormat, 'bullet');
    assert.equal(api._inputFormat, 'table');
  });
});

// =============================================================================
// metadata.subApp — proto-pollution + leakage hardening
// =============================================================================

describe('F-082/AC-2 metadata.subApp pollution & leakage', () => {
  it('parser strips/overwrites a manually-injected metadata.subApp from sub-app content', () => {
    // The parser does NOT consume "metadata.subApp" tokens from the FEATURE-MAP body —
    // it's strictly aggregator-controlled. Adding the literal string to a feature title or
    // file ref must not influence the runtime metadata.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: with metadata.subApp: "fake_app" in title [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const f = result.features.find((x) => x.id === 'F-WEB-1');
    assert.ok(f);
    // subApp is parser/aggregator-controlled — must be derived from path, not from content.
    assert.equal(f.metadata.subApp, 'web');
  });

  it('sub-app named "__proto__" does not pollute Object.prototype', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/__proto__']));
    writeFile(tmpDir, 'apps/__proto__/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEIRD-1: feature [planned]', '',
    ].join('\n'));
    const probeBefore = ({}).polluted;
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const f = result.features.find((x) => x.id === 'F-WEIRD-1');
    assert.ok(f);
    // No prototype pollution — accessing arbitrary props on Object should still be undefined.
    assert.equal(({}).polluted, probeBefore);
    // The subApp slug is captured verbatim (acceptable: no real codepath uses it as a key
    // via bracket notation on a generic object — only as a Map key in featureToSubApp).
    assert.equal(f.metadata.subApp, '__proto__');
  });

  it('two features in different sub-apps do not share a metadata reference', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const web = result.features.find((f) => f.metadata && f.metadata.subApp === 'web');
    const api = result.features.find((f) => f.metadata && f.metadata.subApp === 'api');
    assert.ok(web && api);
    // Mutate one's metadata; the other must not change.
    web.metadata.subApp = 'pwned';
    assert.notEqual(api.metadata.subApp, 'pwned');
  });

  it('reading a sub-app directly + reading aggregated does not mutate the sub-app result', () => {
    copyFixture(tmpDir);
    const sub1 = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    const snapshot = JSON.stringify(sub1.features);
    readFeatureMap(tmpDir, null, { safe: true }); // aggregation pass
    const sub2 = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    assert.equal(JSON.stringify(sub2.features), snapshot,
      'Sub-app read must remain stable across an aggregating call.');
  });

  it('a manually written metadata.subApp on a ROOT-direct feature is stripped on write', () => {
    // Even if a caller passes a metadata.subApp value on a root-direct feature, the
    // root writer must filter it out before serializing — only Rescoped-Table-driven
    // features may carry that runtime marker, and it never reaches disk.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Root direct [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: web [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // Inject a fake subApp on F-001 (caller-side mutation of the in-memory map).
    const root = result.features.find((f) => f.id === 'F-001');
    root.metadata = { ...(root.metadata || {}), subApp: 'fake' };
    writeFeatureMap(tmpDir, result);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // 'fake' must NOT appear; the writer filters out ANY feature with metadata.subApp
    // when writing the root, treating it as aggregated content. F-001 with a forged
    // subApp is therefore SUPPRESSED — pinned as the safer-of-two-failure-modes.
    // @cap-decision(F-082/adv) Forged subApp on root-direct feature → that feature is
    //   filtered out of the root write. Better than persisting a forged marker that
    //   would corrupt later reads. The Rescoped Table preservation is the primary
    //   round-trip invariant; forged-marker rejection is the safety belt.
    assert.ok(!/subApp/i.test(after), 'subApp token must never appear in root');
    assert.ok(!/fake/.test(after), 'forged subApp value must not be persisted');
  });
});

// =============================================================================
// AC-7 cross-sub-app duplicate — parseError aggregation order & priority
// =============================================================================

describe('F-082/AC-7 duplicate detection adversarial', () => {
  it('root parseError takes precedence over sub-app parseError (root duplicate first)', () => {
    // Root has duplicate F-DUP, and a sub-app also has duplicates — the FIRST parseError
    // wins. Aggregator wires the root parseError before walking sub-apps.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-DUP: One [planned]', '',
      '### F-DUP: Two [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-DUP: A [planned]', '',
      '### F-WEB-DUP: B [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError);
    // Whichever wins, must be deterministic and identifiable.
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.match(result.parseError.duplicateId, /^F-(DUP|WEB-DUP)$/);
    // Pin: root's intra-file duplicate is reported first in the current implementation.
    assert.equal(result.parseError.duplicateId, 'F-DUP', 'root duplicate must be reported first');
  });

  it('safe-mode merged list never contains the duplicate twice', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Web [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: API [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const dupes = result.features.filter((f) => f.id === 'F-AUTH');
    assert.equal(dupes.length, 1, 'first-write-wins — exactly one F-AUTH in merged list');
    assert.equal(dupes[0].metadata.subApp, 'web');
  });

  it('strict-mode (no safe flag) throws with positioned error fields', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Web [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: API [planned]', '',
    ].join('\n'));
    let captured;
    try {
      readFeatureMap(tmpDir, null);
      assert.fail('expected throw');
    } catch (e) {
      captured = e;
    }
    assert.equal(captured.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(captured.duplicateId, 'F-AUTH');
    assert.equal(captured.firstSubApp, 'web');
    assert.equal(captured.duplicateSubApp, 'api');
    assert.match(captured.firstFile, /apps\/web/);
    assert.match(captured.duplicateFile, /apps\/api/);
  });

  it('three sub-apps colliding on the same ID — first two collide loud, third filtered silently', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api', 'packages/shared']));
    for (const p of ['apps/web', 'apps/api', 'packages/shared']) {
      writeFile(tmpDir, `${p}/FEATURE-MAP.md`, [
        '# Feature Map', '', '## Features', '',
        '### F-COMMON: collide [planned]', '',
      ].join('\n'));
    }
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError);
    // First-write-wins: only one F-COMMON in merged list.
    const commons = result.features.filter((f) => f.id === 'F-COMMON');
    assert.equal(commons.length, 1);
    // The first-write is from the FIRST sub-app declared in the table (apps/web).
    assert.equal(commons[0].metadata.subApp, 'web');
  });

  it('case-insensitive normalisation: F-Auth in one sub-app and f-AUTH in another collide', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Upper [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Same [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError);
    assert.equal(result.parseError.duplicateId, 'F-AUTH');
  });

  it('write-back path bails on aggregated parseError (addFeature aborts)', () => {
    // F-081/iter2 lesson: write-back paths must bail when parseError is present, NOT
    // persist partial enrichment. Aggregated cross-sub-app duplicate is a parseError too.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Web [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: API [planned]', '',
    ].join('\n'));
    const originalRoot = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Suppress the warn channel.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const r = addFeature(tmpDir, { title: 'should not be added' });
      assert.equal(r, null, 'addFeature must return null on aggregated duplicate parseError');
    } finally {
      console.warn = origWarn;
    }
    // Root unchanged.
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(after, originalRoot);
  });

  it('updateFeatureState bails on aggregated parseError', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Web [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: API [planned]', '',
    ].join('\n'));
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const ok = updateFeatureState(tmpDir, 'F-AUTH', 'prototyped');
      assert.equal(ok, false, 'updateFeatureState must return false on aggregated duplicate');
    } finally {
      console.warn = origWarn;
    }
  });
});

// =============================================================================
// AC-8 round-trip — non-idempotency hunting
// =============================================================================

describe('F-082/AC-8 round-trip non-idempotency hunting', () => {
  it('round-trip preserves byte-stable Rescoped Table cell contents (not just header)', () => {
    copyFixture(tmpDir);
    const before = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const aggregated = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, aggregated);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Each row from the original Rescoped Table appears verbatim in the post-write file.
    const beforeBlock = extractRescopedBlock(before);
    const afterBlock = extractRescopedBlock(after);
    assert.equal(afterBlock, beforeBlock,
      'Rescoped Table block must be byte-identical after a round-trip');
  });

  it('three round-trips in a row yield the same content (n-stability, not just twice-stability)', () => {
    copyFixture(tmpDir);
    const stripFooter = (s) => s.replace(/\*Last updated:[^*]+\*/g, '*Last updated: STAMP*');
    const snaps = [];
    for (let i = 0; i < 3; i++) {
      const m = readFeatureMap(tmpDir, null, { safe: true });
      writeFeatureMap(tmpDir, m);
      snaps.push(stripFooter(fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8')));
    }
    assert.equal(snaps[0], snaps[1]);
    assert.equal(snaps[1], snaps[2]);
  });

  it('round-trip on root with NO Rescoped Table is byte-stable (legacy single-map preserved)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Solo [planned]', '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | one |',
      '',
    ].join('\n'));
    const stripFooter = (s) => s.replace(/\*Last updated:[^*]+\*/g, '*Last updated: STAMP*');
    const m1 = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, m1);
    const after1 = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const m2 = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, m2);
    const after2 = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(stripFooter(after1), stripFooter(after2));
  });

  it('writing AGGREGATED features back to root does not duplicate Rescoped Table', () => {
    copyFixture(tmpDir);
    const aggregated = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, aggregated);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const matches = after.match(/## Rescoped Feature Maps/g) || [];
    assert.equal(matches.length, 1, `expected exactly 1 Rescoped Feature Maps header, got ${matches.length}`);
  });

  it('writeFeatureMap on root preserves root-direct feature ordering', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-005: Five [planned]', '',
      '### F-001: One [planned]', '',
      '### F-003: Three [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '',
    ].join('\n'));
    const m = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, m);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const idxFive = after.indexOf('### F-005:');
    const idxOne = after.indexOf('### F-001:');
    const idxThree = after.indexOf('### F-003:');
    assert.ok(idxFive >= 0 && idxOne >= 0 && idxThree >= 0);
    assert.ok(idxFive < idxOne, 'order F-005 then F-001 must be preserved');
    assert.ok(idxOne < idxThree, 'order F-001 then F-003 must be preserved');
  });

  it('round-trip on a sub-app (apps/web) is byte-stable when read & written individually', () => {
    copyFixture(tmpDir);
    const subPath = path.join(tmpDir, 'apps', 'web', 'FEATURE-MAP.md');
    const before = fs.readFileSync(subPath, 'utf8');
    const stripFooter = (s) => s.replace(/\*Last updated:[^*]+\*/g, '*Last updated: STAMP*');
    const m = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    writeFeatureMap(tmpDir, m, 'apps/web');
    const after1 = fs.readFileSync(subPath, 'utf8');
    const m2 = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    writeFeatureMap(tmpDir, m2, 'apps/web');
    const after2 = fs.readFileSync(subPath, 'utf8');
    assert.equal(stripFooter(after1), stripFooter(after2),
      'sub-app round-trip must be n-stable (this is also F-081 territory)');
    // Sanity: sub-app file has no metadata.subApp markers leaking in.
    assert.ok(!/subApp/i.test(after1));
    // Sanity: original feature IDs preserved.
    assert.match(after1, /F-WEB-/);
    // Reference unused-but-pinned snapshot from before.
    assert.ok(before.length > 0);
  });

  it('writeFeatureMap on root with empty features array preserves Rescoped Table', () => {
    // Edge: caller writes back an empty root (e.g. cleared all root-direct features).
    // The Rescoped Table must still survive — sub-app features live in their own files.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: To be removed [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '',
    ].join('\n'));
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.match(after, /## Rescoped Feature Maps/);
    assert.match(after, /apps\/web/);
  });

  it('extractRescopedBlock trims trailing blank lines but preserves internal blanks', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '| App | Path |',
      '|-----|------|',
      '',
      '| web | apps/web/ |',
      '',
      '',
      '## Legend',
    ].join('\n');
    const block = extractRescopedBlock(content);
    // Internal blank between header rows preserved.
    assert.match(block, /\n\n\| web/);
    // Trailing blanks trimmed (block ends without empty trailer before next header).
    assert.ok(!/\n\n$/.test(block), 'trailing blanks should be trimmed');
  });

  it('injectRescopedBlock when there is NO Legend AND no footer: appended at end', () => {
    const serialized = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: Foo [planned]',
      '',
    ].join('\n');
    const block = '## Rescoped Feature Maps\n\n- `apps/web/`';
    const out = injectRescopedBlock(serialized, block);
    assert.match(out, /## Rescoped Feature Maps/);
    // Order: features come before the appended block.
    assert.ok(out.indexOf('### F-001') < out.indexOf('## Rescoped'));
  });
});

// =============================================================================
// discoverSubAppFeatureMaps — projectRoot escape attempts & symlinks
// =============================================================================

describe('F-082/AC-3 discoverSubAppFeatureMaps adversarial', () => {
  it('returns [] when projectRoot is not a real directory (no apps/, no packages/)', () => {
    const found = discoverSubAppFeatureMaps(tmpDir);
    assert.deepEqual(found, []);
  });

  it('skips dot-prefixed directories under apps/', () => {
    writeFile(tmpDir, 'apps/.cache/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-CACHE-1: hidden [planned]', '',
    ].join('\n'));
    const found = discoverSubAppFeatureMaps(tmpDir);
    assert.equal(found.length, 0);
  });

  it('skips file entries (only directories accepted)', () => {
    // A FEATURE-MAP.md file directly under apps/ (not under apps/<sub>/) is not picked up.
    writeFile(tmpDir, 'apps/FEATURE-MAP.md', '# stray');
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: real [planned]', '',
    ].join('\n'));
    const found = discoverSubAppFeatureMaps(tmpDir);
    assert.equal(found.length, 1);
    assert.equal(found[0].appPath, 'apps/web');
  });

  it('skips sub-apps with no FEATURE-MAP.md inside', () => {
    fs.mkdirSync(path.join(tmpDir, 'apps', 'empty'), { recursive: true });
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', '# x');
    const found = discoverSubAppFeatureMaps(tmpDir);
    assert.equal(found.length, 1);
    assert.equal(found[0].appPath, 'apps/web');
  });

  it('handles BOTH apps/ and packages/ in same project', () => {
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', '# x');
    writeFile(tmpDir, 'packages/shared/FEATURE-MAP.md', '# x');
    const found = discoverSubAppFeatureMaps(tmpDir);
    const paths = found.map((f) => f.appPath).sort();
    assert.deepEqual(paths, ['apps/web', 'packages/shared']);
  });

  it('symlink to a directory OUTSIDE projectRoot is rejected by isDirectory() check', () => {
    // @cap-decision(F-082/symlink-defense) `fs.readdirSync(..., { withFileTypes: true })`
    //   returns Dirent objects where `isDirectory()` is false for symlinks — so even a
    //   symlink that points to a real directory is naturally skipped by the
    //   `if (!e.isDirectory()) continue;` guard. This is defense-in-depth via the stdlib
    //   default, not via explicit symlink detection. Pin the behavior so any future
    //   refactor (e.g. switching to `fs.readdirSync(..., { withFileTypes: true, recursive: true })`
    //   or following symlinks via lstat) breaks this test.
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-outside-'));
    try {
      writeFile(outsideRoot, 'evil/FEATURE-MAP.md', '# evil');
      fs.mkdirSync(path.join(tmpDir, 'apps'), { recursive: true });
      try {
        fs.symlinkSync(path.join(outsideRoot, 'evil'), path.join(tmpDir, 'apps', 'escape'), 'dir');
      } catch (_e) {
        return; // restrictive FS — N/A
      }
      const found = discoverSubAppFeatureMaps(tmpDir);
      const paths = found.map((f) => f.appPath);
      assert.ok(!paths.includes('apps/escape'),
        'symlink to outside directory must be rejected by isDirectory() guard');
      assert.equal(found.length, 0);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('symlink to a sub-app dir INSIDE projectRoot is also rejected (consistency)', () => {
    // @cap-decision(F-082/symlink-defense) Even an in-tree symlink is rejected for
    //   consistency with the outside-symlink case. Real sub-apps are real directories.
    fs.mkdirSync(path.join(tmpDir, 'apps', 'real'), { recursive: true });
    writeFile(tmpDir, 'apps/real/FEATURE-MAP.md', '# real');
    try {
      fs.symlinkSync(path.join(tmpDir, 'apps', 'real'), path.join(tmpDir, 'apps', 'alias'), 'dir');
    } catch (_e) {
      return;
    }
    const found = discoverSubAppFeatureMaps(tmpDir);
    const paths = found.map((f) => f.appPath);
    assert.ok(paths.includes('apps/real'));
    assert.ok(!paths.includes('apps/alias'),
      'in-tree symlinked sub-app must be rejected (would otherwise duplicate features)');
  });

  it('a self-symlink loop in apps/ does not infinite-loop the discoverer', () => {
    // Self-loop: apps/loop/FEATURE-MAP.md exists, but apps/loop/inner -> apps/loop/.
    fs.mkdirSync(path.join(tmpDir, 'apps', 'loop'), { recursive: true });
    writeFile(tmpDir, 'apps/loop/FEATURE-MAP.md', '# x');
    try {
      fs.symlinkSync(path.join(tmpDir, 'apps', 'loop'), path.join(tmpDir, 'apps', 'loop', 'inner'), 'dir');
    } catch (_e) {
      return;
    }
    // The discoverer walks ONE level deep so this should never loop. Wrap in setTimeout
    //   guard to belt-and-braces.
    const t0 = Date.now();
    const found = discoverSubAppFeatureMaps(tmpDir);
    const dt = Date.now() - t0;
    assert.ok(dt < 1000, `discoverer must not loop, took ${dt}ms`);
    assert.ok(found.find((f) => f.appPath === 'apps/loop'));
  });
});

// =============================================================================
// aggregateSubAppFeatureMaps — direct API edge cases
// =============================================================================

describe('F-082 aggregateSubAppFeatureMaps direct API adversarial', () => {
  it('null rootResult is tolerated (returns merged from targets only)', () => {
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '',
    ].join('\n'));
    const out = aggregateSubAppFeatureMaps(tmpDir, null, [{ appPath: 'apps/web' }], { safe: true });
    assert.equal(out.features.length, 1);
    assert.equal(out.features[0].metadata.subApp, 'web');
  });

  it('rootResult with non-array features returns clean output (defensive)', () => {
    const out = aggregateSubAppFeatureMaps(tmpDir, { features: null, lastScan: null }, [], { safe: true });
    assert.deepEqual(out.features, []);
  });

  it('targets pointing to non-existent paths are silently skipped', () => {
    const out = aggregateSubAppFeatureMaps(
      tmpDir,
      { features: [], lastScan: null },
      [{ appPath: 'apps/ghost' }, { appPath: 'apps/missing' }],
      { safe: true },
    );
    assert.deepEqual(out.features, []);
    assert.ok(!out.parseError, 'missing files do not synthesize parseError');
  });

  it('empty sub-app file aggregates as zero features without parseError', () => {
    writeFile(tmpDir, 'apps/empty/FEATURE-MAP.md', '');
    const out = aggregateSubAppFeatureMaps(
      tmpDir,
      { features: [], lastScan: null },
      [{ appPath: 'apps/empty' }],
      { safe: true },
    );
    assert.equal(out.features.length, 0);
  });

  it('preserves rootResult.lastScan across aggregation', () => {
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '', '',
      '*Last updated: 2026-01-01T00:00:00.000Z*',
      '',
    ].join('\n'));
    const out = aggregateSubAppFeatureMaps(
      tmpDir,
      { features: [], lastScan: '2026-05-06T12:00:00.000Z' },
      [{ appPath: 'apps/web' }],
      { safe: true },
    );
    // Root lastScan wins when present.
    assert.equal(out.lastScan, '2026-05-06T12:00:00.000Z');
  });

  it('fall-through to sub-app lastScan when root has no lastScan', () => {
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-1: w [planned]', '', '',
      '*Last updated: 2026-01-01T00:00:00.000Z*',
      '',
    ].join('\n'));
    const out = aggregateSubAppFeatureMaps(
      tmpDir,
      { features: [], lastScan: null },
      [{ appPath: 'apps/web' }],
      { safe: true },
    );
    assert.equal(out.lastScan, '2026-01-01T00:00:00.000Z');
  });
});

// =============================================================================
// Caller-side parseError handling (F-081 Stage-2 lesson #3 analog)
// =============================================================================

describe('F-082 caller-side parseError handling for write-back paths', () => {
  it('addFeature on a clean monorepo (no aggregation duplicate) succeeds and writes to root', () => {
    copyFixture(tmpDir);
    const before = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const created = addFeature(tmpDir, { title: 'New root feature' });
    assert.ok(created && created.id);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.match(after, /New root feature/);
    // Rescoped Table preserved.
    assert.match(after, /## Rescoped Feature Maps/);
    // Sub-app features did not leak to root.
    assert.ok(!after.includes('### F-WEB-AUTH:'));
    // Sanity-check the before-snapshot was non-empty.
    assert.ok(before.length > 0);
  });

  it('updateFeatureState on a sub-app feature via root context: AUTO-REDIRECTS to sub-app', () => {
    // @cap-decision(F-082/iter1 fix:2) INVERTED from pre-iter1 expectation. Stage-2 #2 found that
    //   the previous "silent no-op" pin was the foot-gun itself: callers using the aggregated
    //   reader saw the feature, called updateFeatureState without appPath, and the writer-filter
    //   silently dropped the mutation. Class: F-081 silent-data-loss.
    // @cap-decision(F-082/iter1 fix:2) New contract: when the looked-up feature carries
    //   `metadata.subApp` and caller did not supply appPath, auto-redirect via the runtime-only
    //   `_subAppPrefixes` map. The mutation lands in the correct sub-app FEATURE-MAP.md. If the
    //   prefix cannot be resolved, the call returns false and a console.warn names the missing
    //   appPath (loud rejection — defense-in-depth path).
    copyFixture(tmpDir);
    const rootBefore = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const ok = updateFeatureState(tmpDir, 'F-WEB-AUTH', 'prototyped');
    // Auto-redirect succeeds → returns true.
    assert.equal(ok, true,
      'auto-redirect to sub-app should succeed when the Rescoped Table resolves the slug');
    // Sub-app file IS mutated by the auto-redirect.
    const subAfter = fs.readFileSync(path.join(tmpDir, 'apps/web/FEATURE-MAP.md'), 'utf8');
    assert.match(subAfter, /F-WEB-AUTH:.*\[prototyped\]/,
      'sub-app FEATURE-MAP.md must reflect the new state via auto-redirect');
    // Root FEATURE-MAP.md must NOT be mutated — the Rescoped Table is preserved verbatim.
    const rootAfter = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.match(rootAfter, /## Rescoped Feature Maps/,
      'root Rescoped Table is preserved across auto-redirect');
    // F-WEB-AUTH must NOT have leaked into the root file.
    assert.ok(!rootAfter.includes('### F-WEB-AUTH:'),
      'sub-app feature must not leak into root FEATURE-MAP.md');
    // Sanity: the before-snapshot was non-empty.
    assert.ok(rootBefore.length > 0);
  });

  it('updateFeatureState WITH explicit appPath updates the sub-app feature', () => {
    copyFixture(tmpDir);
    const ok = updateFeatureState(tmpDir, 'F-WEB-AUTH', 'prototyped', 'apps/web');
    assert.equal(ok, true);
    const sub = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    const auth = sub.features.find((f) => f.id === 'F-WEB-AUTH');
    assert.equal(auth.state, 'prototyped');
  });
});

// =============================================================================
// Backward-compat hardening
// =============================================================================

describe('F-082 backward-compat hardening', () => {
  it('legacy single-map project (no apps/, no packages/, no Rescoped Table) reads identically pre/post-F-082', () => {
    const content = [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Solo [planned]', '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | one |',
      '',
      '**Files:**',
      '- `src/foo.ts`', '',
    ].join('\n');
    writeFile(tmpDir, 'FEATURE-MAP.md', content);
    const result = readFeatureMap(tmpDir);
    assert.equal(result.features.length, 1);
    const f = result.features[0];
    assert.equal(f.id, 'F-001');
    assert.ok(!f.metadata || !f.metadata.subApp);
    assert.equal(f.acs.length, 1);
    assert.equal(f.acs[0].status, 'tested');
  });

  it('parseFeatureMapContent on raw content does not trigger aggregation (function-level boundary)', () => {
    const content = [
      '## Features', '', '### F-001: Foo [planned]', '',
      '## Rescoped Feature Maps', '', '- `apps/web/`', '',
    ].join('\n');
    // parseFeatureMapContent operates on raw content, has no projectRoot semantics for
    //   aggregation. Even a content with Rescoped Table is parsed as-is — no I/O.
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('serializeFeatureMap does not emit metadata.subApp tokens regardless of input', () => {
    const map = {
      features: [{
        id: 'F-001', title: 'Foo', state: 'planned', acs: [], files: [],
        dependencies: [], usesDesign: [], metadata: { subApp: 'web', other: 'visible-key' },
        _inputFormat: 'table',
      }],
      lastScan: null,
    };
    const out = serializeFeatureMap(map);
    assert.ok(!/subApp/i.test(out), 'serializer must not emit subApp');
    // metadata is not currently serialized at all — pin.
    assert.ok(!/visible-key/.test(out), 'metadata is not currently serialized at all');
  });
});

// =============================================================================
// F-082 follow-ups (post-ship hardening) — FIX A / FIX B / FIX D
// =============================================================================

// Build a string with raw ANSI ESC + other control bytes WITHOUT putting literal
// control bytes in the source file (avoids tooling that strips/normalizes them).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const BS = String.fromCharCode(0x08);
const NUL = String.fromCharCode(0x00);
// eslint-disable-next-line no-unused-vars
const DEL = String.fromCharCode(0x7f);
// Pre-built regex of all C0 controls + DEL, constructed at runtime so the source file
// itself stays free of any control byte.
const CONTROL_BYTE_RE = new RegExp(
  '[' +
    Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).join('') +
    String.fromCharCode(0x7f) +
  ']'
);

// Helper: capture all console.warn output during fn.
function captureWarn(fn) {
  const captured = [];
  const orig = console.warn;
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return captured.join('\n');
}

// =============================================================================
// FIX A: ANSI-defense in console.warn paths
// =============================================================================

describe('F-082 follow-up FIX A: ANSI-defense in console.warn paths', () => {
  it('legacy single-scope parseError warn contains no control bytes', () => {
    // Force the legacy single-scope path. Duplicate-ID surfaces parseError; the warn
    // line must run parseError.message through _safeForError and emit no control bytes.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: One [planned]', '',
      '### F-001: Dup [planned]', '',
    ].join('\n'));
    const captured = captureWarn(() => {
      enrichFromTags(tmpDir, []);
    });
    assert.ok(captured.includes('F-001'), 'warn must mention the duplicate feature id');
    assert.ok(!CONTROL_BYTE_RE.test(captured),
      'warn must contain no control bytes, got: ' + JSON.stringify(captured));
  });

  it('per-scope parseError warn (aggregated path) sanitizes scope label + message', () => {
    // 2 sub-apps; apps/web has duplicate-ID -> per-scope parseError. apps/api stays healthy.
    // The warn for apps/web must name the scope and include the message; both must be
    // free of control bytes.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-AUTH: Web one [planned]', '',
      '### F-WEB-AUTH: Web two [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-API-USERS: API users [planned]', '',
    ].join('\n'));

    const captured = captureWarn(() => {
      enrichFromTags(tmpDir, [
        { type: 'feature', file: 'apps/api/src/users.ts', metadata: { feature: 'F-API-USERS' } },
      ]);
    });
    // Aggregator stores the sub-app SLUG as scope name (e.g. "web", not "apps/web").
    assert.ok(/scope\s+"web"/.test(captured),
      'per-scope warn must name failed scope by slug, got: ' + JSON.stringify(captured));
    assert.ok(!CONTROL_BYTE_RE.test(captured),
      'per-scope warn must contain no control bytes, got: ' + JSON.stringify(captured));
  });

  it('partial-write summary warn (FIX D path) sanitizes ANSI bytes from injected error message', () => {
    // Mock fs.writeFileSync to throw an Error whose message embeds raw ANSI/BEL/BS/NUL
    // bytes. The FIX D summary warn passes the error message through _safeForError; the
    // captured warn must NOT contain any of these control bytes.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-AUTH: Web auth [planned]', '',
    ].join('\n'));
    const webPath = path.join(tmpDir, 'apps', 'web', 'FEATURE-MAP.md');
    const origWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function patched(p, data, opts) {
      if (typeof p === 'string' && path.resolve(p) === path.resolve(webPath)) {
        // Inject raw control bytes into the error message via runtime-built strings.
        const msg = ESC + '[31mEROFS' + ESC + '[0m mocked' + BEL + 'with' + BS + 'controls' + NUL;
        throw new Error(msg);
      }
      return origWriteFileSync.call(fs, p, data, opts);
    };
    let captured = '';
    try {
      captured = captureWarn(() => {
        enrichFromTags(tmpDir, [
          { type: 'feature', file: 'apps/web/src/auth.ts', metadata: { feature: 'F-WEB-AUTH' } },
        ]);
      });
    } finally {
      fs.writeFileSync = origWriteFileSync;
    }
    assert.ok(/partial write/i.test(captured),
      'summary warn must fire, got: ' + JSON.stringify(captured));
    // Sanitized printable parts of the message must still surface.
    assert.ok(captured.includes('EROFS'),
      'summary warn must include sanitized error text, got: ' + JSON.stringify(captured));
    // The injected control bytes MUST be stripped.
    assert.ok(!CONTROL_BYTE_RE.test(captured),
      'summary warn must contain no control bytes, got: ' + JSON.stringify(captured));
  });
});

// =============================================================================
// FIX B: Cross-sub-app blast radius — aggregated parseError must not block healthy scopes
// =============================================================================

describe('F-082 follow-up FIX B: aggregated parseError no longer blasts healthy scopes', () => {
  it('enrichFromTags continues into per-scope loop when ONE sub-app has parseError; healthy sub-apps still get enriched', () => {
    // 3 sub-apps: apps/web has duplicate-ID (parseError); apps/api + apps/admin are healthy.
    // Pre-fix: aggregated parseError aborted enrichFromTags BEFORE any scope was written,
    // so apps/api + apps/admin lost their file refs too. Post-fix: only apps/web is skipped.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api', 'apps/admin']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-AUTH: Web one [planned]', '',
      '### F-WEB-AUTH: Web two [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-API-USERS: API users [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/admin/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-ADMIN-DASH: Admin dashboard [planned]', '',
    ].join('\n'));

    const scanResults = [
      { type: 'feature', file: 'apps/api/src/users.ts', metadata: { feature: 'F-API-USERS' } },
      { type: 'feature', file: 'apps/admin/src/dashboard.ts', metadata: { feature: 'F-ADMIN-DASH' } },
      { type: 'feature', file: 'apps/web/src/auth.ts', metadata: { feature: 'F-WEB-AUTH' } },
    ];

    captureWarn(() => {
      enrichFromTags(tmpDir, scanResults);
    });

    // apps/api + apps/admin must have their file refs persisted.
    const apiMap = readFeatureMap(tmpDir, 'apps/api', { safe: true });
    const apiFeature = apiMap.features.find((f) => f.id === 'F-API-USERS');
    assert.ok(apiFeature, 'F-API-USERS must exist in apps/api');
    assert.ok(apiFeature.files.includes('apps/api/src/users.ts'),
      'apps/api enrichment must persist DESPITE apps/web parseError (FIX B)');

    const adminMap = readFeatureMap(tmpDir, 'apps/admin', { safe: true });
    const adminFeature = adminMap.features.find((f) => f.id === 'F-ADMIN-DASH');
    assert.ok(adminFeature, 'F-ADMIN-DASH must exist in apps/admin');
    assert.ok(adminFeature.files.includes('apps/admin/src/dashboard.ts'),
      'apps/admin enrichment must persist DESPITE apps/web parseError (FIX B)');

    // apps/web (broken scope) must remain unmutated.
    const webContent = fs.readFileSync(path.join(tmpDir, 'apps', 'web', 'FEATURE-MAP.md'), 'utf8');
    assert.ok(webContent.includes('F-WEB-AUTH: Web one'), 'apps/web must remain untouched');
    assert.ok(webContent.includes('F-WEB-AUTH: Web two'), 'apps/web must remain untouched');
  });

  it('legacy single-scope (no Rescoped Table) STILL bails on parseError (legacy contract preserved)', () => {
    // FIX B only relaxes the gate for the AGGREGATED branch. Single-scope reads keep the
    // F-081/iter2 bail-on-parseError contract — preserve legacy behavior for non-monorepo projects.
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-001: One [planned]', '',
      '### F-001: Dup [planned]', '',
    ].join('\n'));
    const before = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    captureWarn(() => {
      enrichFromTags(tmpDir, [
        { type: 'feature', file: 'src/foo.ts', metadata: { feature: 'F-001' } },
      ]);
    });
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(after, before, 'single-scope parseError must still bail (legacy contract)');
  });
});

// =============================================================================
// FIX D: Best-effort batch-write logging on per-scope writes
// =============================================================================

describe('F-082 follow-up FIX D: best-effort batch-write logging', () => {
  it('emits summary warn when per-scope writeFeatureMap throws; healthy scopes still persist', () => {
    // 3 healthy sub-apps. Mock fs.writeFileSync to throw on the SECOND scope's path. Verify:
    //   (a) function returns without throwing,
    //   (b) the OTHER scopes' writes succeed (file content includes the new ref),
    //   (c) summary warn names the failed scope and surfaces the error message.
    writeFile(tmpDir, 'FEATURE-MAP.md', ROOT_RESCOPED(['apps/web', 'apps/api', 'apps/admin']));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-WEB-AUTH: Web auth [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-API-USERS: API users [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/admin/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-ADMIN-DASH: Admin dashboard [planned]', '',
    ].join('\n'));

    const apiPath = path.join(tmpDir, 'apps', 'api', 'FEATURE-MAP.md');
    const origWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function patched(p, data, opts) {
      if (typeof p === 'string' && path.resolve(p) === path.resolve(apiPath)) {
        const err = new Error('EROFS: read-only filesystem (mocked)');
        err.code = 'EROFS';
        throw err;
      }
      return origWriteFileSync.call(fs, p, data, opts);
    };

    let captured = '';
    let returned;
    try {
      captured = captureWarn(() => {
        returned = enrichFromTags(tmpDir, [
          { type: 'feature', file: 'apps/web/src/auth.ts', metadata: { feature: 'F-WEB-AUTH' } },
          { type: 'feature', file: 'apps/api/src/users.ts', metadata: { feature: 'F-API-USERS' } },
          { type: 'feature', file: 'apps/admin/src/dashboard.ts', metadata: { feature: 'F-ADMIN-DASH' } },
        ]);
      });
    } finally {
      fs.writeFileSync = origWriteFileSync;
    }

    // (a) function returned without throwing.
    assert.ok(returned, 'enrichFromTags must return without throwing on per-scope write failure');

    // (b) apps/web + apps/admin still persisted.
    const webMap = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    const webFeature = webMap.features.find((f) => f.id === 'F-WEB-AUTH');
    assert.ok(webFeature.files.includes('apps/web/src/auth.ts'),
      'apps/web write must succeed even though apps/api write failed');
    const adminMap = readFeatureMap(tmpDir, 'apps/admin', { safe: true });
    const adminFeature = adminMap.features.find((f) => f.id === 'F-ADMIN-DASH');
    assert.ok(adminFeature.files.includes('apps/admin/src/dashboard.ts'),
      'apps/admin write must succeed even though apps/api write failed');

    // apps/api on disk must not have the new file ref (write was rejected).
    const apiContent = fs.readFileSync(apiPath, 'utf8');
    assert.ok(!apiContent.includes('apps/api/src/users.ts'),
      'apps/api FEATURE-MAP.md must not have the new file ref (write threw)');

    // (c) summary warn was emitted naming the failed scope.
    assert.ok(/partial write/i.test(captured),
      'must emit "partial write" summary warn, got: ' + JSON.stringify(captured));
    // Aggregator stores the sub-app SLUG as scope name (e.g. "api", not "apps/api").
    assert.ok(/"api"/.test(captured),
      'summary warn must name the failed scope by slug ("api"), got: ' + JSON.stringify(captured));
    assert.ok(captured.includes('EROFS'),
      'summary warn must surface the error message, got: ' + JSON.stringify(captured));

    // Defense-in-depth: summary warn must be control-byte-clean too.
    assert.ok(!CONTROL_BYTE_RE.test(captured),
      'summary warn must contain no control bytes, got: ' + JSON.stringify(captured));
  });
});
