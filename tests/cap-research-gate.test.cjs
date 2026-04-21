'use strict';

// @cap-feature(feature:F-059) Research-First Gate Before Prototype — happy-path tests.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const gate = require('../cap/bin/lib/cap-research-gate.cjs');

function makeWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cap-research-gate-${label}-`));
  const docsDir = path.join(root, '.cap', 'stack-docs');
  fs.mkdirSync(docsDir, { recursive: true });
  return { root, docsDir };
}

function writePackageJson(root, deps = {}, devDeps = {}) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: deps, devDependencies: devDeps }),
    'utf8',
  );
}

function writeDocAtAge(docsDir, libName, ageHours) {
  const p = path.join(docsDir, `${libName}.md`);
  fs.writeFileSync(p, `# ${libName} docs\n\n<!-- Fetched: ${new Date().toISOString()} -->\n`, 'utf8');
  const mtime = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  fs.utimesSync(p, mtime, mtime);
  return p;
}

describe('readPackageDependencies', () => {
  it('returns sorted unique names from both dependencies and devDependencies', () => {
    const ws = makeWorkspace('deps-basic');
    writePackageJson(ws.root, { react: '^18', next: '^14' }, { vitest: '^1', react: '^18' });
    assert.deepEqual(gate.readPackageDependencies(ws.root), ['next', 'react', 'vitest']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('returns [] when package.json is missing', () => {
    const ws = makeWorkspace('deps-missing');
    assert.deepEqual(gate.readPackageDependencies(ws.root), []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('returns [] when package.json is malformed', () => {
    const ws = makeWorkspace('deps-malformed');
    fs.writeFileSync(path.join(ws.root, 'package.json'), '{ not valid json', 'utf8');
    assert.deepEqual(gate.readPackageDependencies(ws.root), []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
});

describe('parseLibraryMentions (AC-1)', () => {
  it('extracts a dependency name mentioned in any AC description', () => {
    const descs = [
      'Use react hooks to manage component state',
      'Database layer uses prisma as the ORM',
    ];
    const deps = ['react', 'prisma', 'unused-lib'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['prisma', 'react']);
  });

  it('does not match a dependency name embedded inside a longer identifier', () => {
    // "react" must not match inside "overreacted" or "reactivity"
    const descs = ['The overreacted blog post on reactivity patterns'];
    const deps = ['react'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), []);
  });

  it('matches case-insensitively', () => {
    const descs = ['Integrate React SSR into the Next.js page'];
    const deps = ['react', 'next'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['next', 'react']);
  });

  it('handles scoped package names', () => {
    const descs = ['@anthropic-ai/sdk client with prompt caching enabled'];
    const deps = ['@anthropic-ai/sdk', 'react'];
    assert.deepEqual(gate.parseLibraryMentions(descs, deps), ['@anthropic-ai/sdk']);
  });

  it('returns [] when no AC mentions any dep', () => {
    assert.deepEqual(gate.parseLibraryMentions(['prose only'], ['react']), []);
  });

  it('returns [] on empty inputs', () => {
    assert.deepEqual(gate.parseLibraryMentions([], ['react']), []);
    assert.deepEqual(gate.parseLibraryMentions(['x'], []), []);
    assert.deepEqual(gate.parseLibraryMentions(null, null), []);
  });

  it('deduplicates multiple mentions of the same dep', () => {
    const descs = ['react hook 1', 'react hook 2', 'react ssr'];
    assert.deepEqual(gate.parseLibraryMentions(descs, ['react']), ['react']);
  });
});

describe('checkStackDocs (AC-2)', () => {
  it('buckets libraries into missing / stale / fresh by mtime', () => {
    const ws = makeWorkspace('check-buckets');
    writeDocAtAge(ws.docsDir, 'fresh-lib', 24);           // 1 day old
    writeDocAtAge(ws.docsDir, 'stale-lib', 24 * 45);      // 45 days old
    // "missing-lib" has no file
    const result = gate.checkStackDocs(ws.root, ['fresh-lib', 'stale-lib', 'missing-lib'], 30);
    assert.deepEqual(result.fresh, ['fresh-lib']);
    assert.deepEqual(result.stale, ['stale-lib']);
    assert.deepEqual(result.missing, ['missing-lib']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('uses the default 30-day threshold when maxAgeDays is omitted', () => {
    const ws = makeWorkspace('check-default');
    writeDocAtAge(ws.docsDir, 'boundary', 24 * 25); // 25 days — within 30
    const result = gate.checkStackDocs(ws.root, ['boundary']);
    assert.deepEqual(result.fresh, ['boundary']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('returns empty buckets for an empty library list', () => {
    const ws = makeWorkspace('check-empty');
    const result = gate.checkStackDocs(ws.root, []);
    assert.deepEqual(result, { missing: [], stale: [], fresh: [] });
    fs.rmSync(ws.root, { recursive: true, force: true });
  });
});

describe('runGate (AC-1 + AC-2 integration)', () => {
  it('returns fresh docs when package.json + stack-docs both aligned', () => {
    const ws = makeWorkspace('rungate-fresh');
    writePackageJson(ws.root, { react: '^18' });
    writeDocAtAge(ws.docsDir, 'react', 24);
    const result = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['Use react to render the UI'],
    });
    assert.deepEqual(result.libraries, ['react']);
    assert.deepEqual(result.fresh, ['react']);
    assert.equal(result.missing.length, 0);
    assert.equal(result.stale.length, 0);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('reports missing + stale in one pass', () => {
    const ws = makeWorkspace('rungate-mixed');
    writePackageJson(ws.root, { react: '^18', prisma: '^5', zod: '^3' });
    writeDocAtAge(ws.docsDir, 'react', 24 * 60);        // stale
    // prisma missing
    writeDocAtAge(ws.docsDir, 'zod', 24);                // fresh
    const result = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: [
        'Use react hooks to bind the form',
        'Validate with zod before writing via prisma',
      ],
    });
    assert.deepEqual(result.libraries.sort(), ['prisma', 'react', 'zod']);
    assert.deepEqual(result.stale, ['react']);
    assert.deepEqual(result.missing, ['prisma']);
    assert.deepEqual(result.fresh, ['zod']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('honours a custom maxAgeDays override', () => {
    const ws = makeWorkspace('rungate-custom');
    writePackageJson(ws.root, { react: '^18' });
    writeDocAtAge(ws.docsDir, 'react', 24 * 14); // 14 days old
    const strict = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['react setup'],
      maxAgeDays: 7,
    });
    assert.deepEqual(strict.stale, ['react']);
    const lax = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['react setup'],
      maxAgeDays: 30,
    });
    assert.deepEqual(lax.fresh, ['react']);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('ignores prose-only mentions for libraries not in package.json (no false positives)', () => {
    const ws = makeWorkspace('rungate-prose');
    writePackageJson(ws.root, { react: '^18' });
    const result = gate.runGate({
      projectRoot: ws.root,
      acDescriptions: ['Remember the lessons from stripe webhook bugs and oauth callbacks'],
    });
    // stripe / oauth are NOT in package.json → no references at all
    assert.deepEqual(result.libraries, []);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('throws on missing projectRoot (AC-5: never blocks, but caller mistakes must surface)', () => {
    assert.throws(() => gate.runGate({ acDescriptions: [] }), /projectRoot/);
  });
});

describe('formatWarning (AC-3)', () => {
  it('returns empty string when nothing is missing or stale', () => {
    const result = { libraries: ['react'], missing: [], stale: [], fresh: ['react'], maxAgeDays: 30 };
    assert.equal(gate.formatWarning(result), '');
  });

  it('renders the refresh-docs recommendation for missing libs', () => {
    const result = { libraries: ['react'], missing: ['react'], stale: [], fresh: [], maxAgeDays: 30 };
    const out = gate.formatWarning(result);
    assert.match(out, /Missing: react/);
    assert.match(out, /\/cap:refresh-docs react/);
    assert.match(out, /Proceed anyway\? \[y\/N\]/);
  });

  it('renders both missing and stale sections when both are present', () => {
    const result = {
      libraries: ['react', 'prisma'],
      missing: ['prisma'],
      stale: ['react'],
      fresh: [],
      maxAgeDays: 30,
    };
    const out = gate.formatWarning(result);
    assert.match(out, /Missing: prisma/);
    assert.match(out, /Stale \(> 30 days\): react/);
    // refresh-docs command includes both
    assert.match(out, /\/cap:refresh-docs prisma react/);
  });
});

describe('logGateCheck (AC-6)', () => {
  it('appends a JSONL event with libsChecked + missing counts', () => {
    const ws = makeWorkspace('log');
    gate.logGateCheck(ws.root, { libsChecked: 3, missing: 1, stale: 1 });
    gate.logGateCheck(ws.root, { skipped: true, libsChecked: 2, missing: 0, stale: 0 });
    const logPath = path.join(ws.root, '.cap', 'session-log.jsonl');
    assert.ok(fs.existsSync(logPath));
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const a = JSON.parse(lines[0]);
    assert.equal(a.event, 'research-gate');
    assert.equal(a.skipped, false);
    assert.equal(a.libsChecked, 3);
    assert.equal(a.missing, 1);
    const b = JSON.parse(lines[1]);
    assert.equal(b.skipped, true);
    fs.rmSync(ws.root, { recursive: true, force: true });
  });

  it('is best-effort — a logging failure must not throw', () => {
    // Passing an empty string as root triggers the early return; passing a path
    // whose parent cannot be mkdir'd would surface the best-effort swallow.
    assert.doesNotThrow(() => gate.logGateCheck('', { libsChecked: 0, missing: 0, stale: 0 }));
  });
});
