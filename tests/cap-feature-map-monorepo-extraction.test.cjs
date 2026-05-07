'use strict';

// @cap-feature(feature:F-083) F-083 extraction-contract regression suite — pins the public-API
//   surface, identity-preserving re-exports, _subAppPrefixes non-enumerable contract, and the
//   no-cycle invariant between cap-feature-map.cjs and cap-feature-map-monorepo.cjs.
// @cap-decision(F-083/AC-4) Discrete test file rather than appending to cap-feature-map-monorepo.test.cjs
//   so a single grep for `monorepo-extraction` surfaces the F-083 contract specifically. Keeps
//   the existing scope-based test files focused on their own ACs.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const MONOREPO_PATH = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-feature-map-monorepo.cjs');
const CORE_PATH = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-feature-map.cjs');

const monorepoModule = require(MONOREPO_PATH);
const coreModule = require(CORE_PATH);

// AC-1 — the six named exports the AC calls out PLUS the helpers that move with them.
test('F-083/AC-1: cap-feature-map-monorepo.cjs exports the F-083 surface', () => {
  const required = [
    'parseRescopedTable',
    'discoverSubAppFeatureMaps',
    'aggregateSubAppFeatureMaps',
    '_enrichFromTagsAcrossSubApps',
    '_enrichFromDesignTagsAcrossSubApps',
    '_maybeRedirectToSubApp',
  ];
  for (const name of required) {
    assert.equal(typeof monorepoModule[name], 'function', `monorepo module missing function: ${name}`);
  }
  // Symbol used by the redirect protocol.
  assert.equal(typeof monorepoModule._NO_REDIRECT, 'symbol');
});

// AC-2 — re-export surface on cap-feature-map.cjs preserves zero call-site change contract.
test('F-083/AC-2: cap-feature-map.cjs re-exports the same names', () => {
  const required = [
    'parseRescopedTable',
    'discoverSubAppFeatureMaps',
    'aggregateSubAppFeatureMaps',
    '_enrichFromTagsAcrossSubApps',
    '_enrichFromDesignTagsAcrossSubApps',
    '_maybeRedirectToSubApp',
    'extractRescopedBlock',
    'injectRescopedBlock',
    // monorepo APIs moved out of core for LOC budget — still re-exported.
    'initAppFeatureMap',
    'listAppFeatureMaps',
    'rescopeFeatures',
  ];
  for (const name of required) {
    assert.equal(typeof coreModule[name], 'function', `core module missing function: ${name}`);
  }
  assert.equal(typeof coreModule._NO_REDIRECT, 'symbol', 'core module missing _NO_REDIRECT symbol');
});

// AC-2 — IDENTITY check: the function references are the SAME object across both modules.
test('F-083/AC-2: re-exports are identity-preserving (===, not just same shape)', () => {
  const identityCheck = [
    'parseRescopedTable',
    'discoverSubAppFeatureMaps',
    'aggregateSubAppFeatureMaps',
    'extractRescopedBlock',
    'injectRescopedBlock',
    '_enrichFromTagsAcrossSubApps',
    '_enrichFromDesignTagsAcrossSubApps',
    '_maybeRedirectToSubApp',
    'initAppFeatureMap',
    'listAppFeatureMaps',
    'rescopeFeatures',
  ];
  for (const name of identityCheck) {
    assert.equal(
      coreModule[name],
      monorepoModule[name],
      `Re-export ${name} is not identity-preserving — wrapper or proxy detected`
    );
  }
  // Symbol identity is critical for the redirect protocol — different symbols would
  //   silently break callers comparing against _NO_REDIRECT.
  assert.equal(coreModule._NO_REDIRECT, monorepoModule._NO_REDIRECT, '_NO_REDIRECT symbol identity broken');
});

// AC-3 — line count budget pinned. If this fails, the split has drifted from the agreed budget.
// @cap-decision(F-088) Bumped core budget 1500 → 1750 to accommodate the F-088 safety-net
//   (~35 lines) AND the surgical-patch helpers (~140 lines: 3 functions + JSDoc + comments).
//   The lossless round-trip (AC-1..4) is deferred; revisit if it lands.
test('F-083/AC-3: line-count budget — core ≤1750, monorepo ≤900', () => {
  const coreLines = fs.readFileSync(CORE_PATH, 'utf8').split('\n').length;
  const monorepoLines = fs.readFileSync(MONOREPO_PATH, 'utf8').split('\n').length;
  assert.ok(
    coreLines <= 1750,
    `cap-feature-map.cjs has ${coreLines} lines — must be ≤1750. Move more into the monorepo module.`
  );
  assert.ok(
    monorepoLines <= 900,
    `cap-feature-map-monorepo.cjs has ${monorepoLines} lines — must be ≤900. Move some back into core or trim comments.`
  );
});

// AC-5 — _subAppPrefixes non-enumerable contract preserved.
// @cap-decision(F-083/AC-5) Build a real aggregated map (Rescoped Table → 2 sub-apps with features)
//   rather than a stub featureMap object — exercises the actual Object.defineProperty code path.
test('F-083/AC-5: aggregated map preserves _subAppPrefixes non-enumerable property descriptor', () => {
  // Stand up a tiny project with a Rescoped Table + two sub-app FEATURE-MAPs.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f083-'));
  try {
    const rootContent = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: root feature [planned]',
      '',
      '## Rescoped Feature Maps',
      '',
      '| App | Path |',
      '|-----|------|',
      '| web | apps/web |',
      '| api | apps/api |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpRoot, 'FEATURE-MAP.md'), rootContent);
    fs.mkdirSync(path.join(tmpRoot, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'apps', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'apps', 'web', 'FEATURE-MAP.md'),
      '# Feature Map\n\n## Features\n\n### F-100: web feature [planned]\n'
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'apps', 'api', 'FEATURE-MAP.md'),
      '# Feature Map\n\n## Features\n\n### F-200: api feature [planned]\n'
    );

    const fm = coreModule.readFeatureMap(tmpRoot);

    // Property is present.
    assert.ok(fm._subAppPrefixes, '_subAppPrefixes missing on aggregated map');
    // ...and is a Map.
    assert.equal(fm._subAppPrefixes instanceof Map, true);
    // ...with the expected slug→appPath entries.
    assert.equal(fm._subAppPrefixes.get('web'), 'apps/web');
    assert.equal(fm._subAppPrefixes.get('api'), 'apps/api');

    // The CRITICAL contract: enumerable:false. Object.keys must NOT contain it.
    assert.equal(
      Object.keys(fm).includes('_subAppPrefixes'),
      false,
      '_subAppPrefixes leaked into Object.keys() — enumerable:false contract broken'
    );
    // for...in must NOT visit it either.
    const visited = [];
    for (const k in fm) visited.push(k);
    assert.equal(
      visited.includes('_subAppPrefixes'),
      false,
      '_subAppPrefixes visited by for...in — enumerable:false contract broken'
    );
    // JSON.stringify must NOT serialize it.
    const json = JSON.stringify(fm);
    assert.equal(
      json.includes('_subAppPrefixes'),
      false,
      '_subAppPrefixes appears in JSON output — enumerable:false contract broken'
    );

    // Property descriptor matches the F-082 specification verbatim.
    const desc = Object.getOwnPropertyDescriptor(fm, '_subAppPrefixes');
    assert.ok(desc, 'descriptor not retrievable');
    assert.equal(desc.enumerable, false, 'enumerable should be false');
    assert.equal(desc.writable, false, 'writable should be false');
    assert.equal(desc.configurable, true, 'configurable should be true');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// AC-6 — no circular require warning, modules can be loaded in either order.
// @cap-decision(F-083/AC-6) Spawn a fresh node process so we get a clean require cache.
//   Asserting against the parent process's cache would be misleading because anything
//   we required in earlier tests already short-circuits Node's cycle detection.
test('F-083/AC-6: no circular require — both modules load in either order', () => {
  // Order 1: core then monorepo.
  const r1 = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(CORE_PATH)}); require(${JSON.stringify(MONOREPO_PATH)}); console.log('ok');`],
    { encoding: 'utf8' }
  );
  assert.equal(r1.status, 0, `core-then-monorepo load failed: ${r1.stderr}`);
  assert.match(r1.stdout, /ok/);
  assert.equal(
    /Warning|circular|partial-load/i.test(r1.stderr),
    false,
    `core-then-monorepo emitted a warning: ${r1.stderr}`
  );

  // Order 2: monorepo then core (the reverse order — the more interesting cycle case).
  const r2 = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(MONOREPO_PATH)}); require(${JSON.stringify(CORE_PATH)}); console.log('ok');`],
    { encoding: 'utf8' }
  );
  assert.equal(r2.status, 0, `monorepo-then-core load failed: ${r2.stderr}`);
  assert.match(r2.stdout, /ok/);
  assert.equal(
    /Warning|circular|partial-load/i.test(r2.stderr),
    false,
    `monorepo-then-core emitted a warning: ${r2.stderr}`
  );

  // Cycle smoke — the monorepo module's _core() and the core module's _monorepo() both
  //   resolve to the same Node-cached references (any other outcome implies a cycle bug).
  const r3 = spawnSync(
    process.execPath,
    [
      '-e',
      `const c = require(${JSON.stringify(CORE_PATH)});
       const m = require(${JSON.stringify(MONOREPO_PATH)});
       if (typeof c.parseRescopedTable !== 'function') process.exit(2);
       if (typeof m.parseRescopedTable !== 'function') process.exit(3);
       if (c.parseRescopedTable !== m.parseRescopedTable) process.exit(4);
       console.log('ok');`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r3.status, 0, `cycle-resolution smoke failed (status ${r3.status}): ${r3.stderr}`);
  assert.match(r3.stdout, /ok/);
});

// @cap-decision(F-083/followup) F-083-FIX-B: require.cache eviction regression test pinned.
//   The lazy-require accessors (`_core()` in monorepo, `_monorepo()` in core) memoize their
//   imports. If a future refactor removes that memoization, OR if a downstream caller deletes
//   require.cache entries asymmetrically, the symbol-identity contract for `_NO_REDIRECT` could
//   silently flip. Pinning the contract here so the test goes red if anyone breaks it.
test('F-083/followup: require.cache eviction preserves identity-after-reload', () => {
  // Load both modules fresh in a subprocess so this test does not pollute the parent
  // process's require.cache (we want a clean slate for the eviction probes).
  const probeCode = `
    const path = require('node:path');
    const CORE = ${JSON.stringify(CORE_PATH)};
    const MONO = ${JSON.stringify(MONOREPO_PATH)};

    // Initial load.
    const c1 = require(CORE);
    const m1 = require(MONO);

    // Identity contract must hold on initial load.
    if (c1.parseRescopedTable !== m1.parseRescopedTable) {
      console.error('initial: parseRescopedTable identity broken');
      process.exit(10);
    }
    if (c1._NO_REDIRECT !== m1._NO_REDIRECT) {
      console.error('initial: _NO_REDIRECT symbol identity broken');
      process.exit(11);
    }

    // Evict ONLY core from require.cache.
    delete require.cache[CORE];
    const c2 = require(CORE);
    // After core eviction, the freshly-loaded core has a NEW symbol (different module
    // instance), but its own internal references are still self-consistent.
    if (typeof c2.parseRescopedTable !== 'function') {
      console.error('after-core-eviction: core function missing');
      process.exit(12);
    }
    if (typeof c2._NO_REDIRECT !== 'symbol') {
      console.error('after-core-eviction: core symbol missing');
      process.exit(13);
    }
    // c2 (fresh core) re-loads the still-cached monorepo and re-attaches re-exports —
    // so c2.parseRescopedTable === m1.parseRescopedTable (the cached monorepo's function).
    if (c2.parseRescopedTable !== m1.parseRescopedTable) {
      console.error('after-core-eviction: re-load identity not preserved across re-require');
      process.exit(14);
    }

    // Evict BOTH together — the canonical "fresh start" case.
    delete require.cache[CORE];
    delete require.cache[MONO];
    const c3 = require(CORE);
    const m3 = require(MONO);
    if (c3.parseRescopedTable !== m3.parseRescopedTable) {
      console.error('after-both-evicted: identity not restored on full reload');
      process.exit(15);
    }
    if (c3._NO_REDIRECT !== m3._NO_REDIRECT) {
      console.error('after-both-evicted: symbol identity not restored on full reload');
      process.exit(16);
    }

    console.log('ok');
  `;

  const r = spawnSync(process.execPath, ['-e', probeCode], { encoding: 'utf8' });
  // No circular-require warning emitted during any of the re-requires.
  assert.equal(
    /Warning|circular|partial-load/i.test(r.stderr),
    false,
    `require.cache eviction probe emitted a warning: ${r.stderr}`
  );
  assert.equal(r.status, 0, `require.cache eviction probe failed (status ${r.status}): ${r.stderr}`);
  assert.match(r.stdout, /ok/);
});

