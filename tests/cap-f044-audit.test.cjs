'use strict';

// @cap-feature(feature:F-044) Audit and Right-Size Agent Behaviors for Opus 4.7
// @cap-todo(ac:F-044/AC-2) Tests verify --research flag (not --skip-research) and Step 2b gating
// @cap-todo(ac:F-044/AC-3) Tests verify probeProjectAnchors returns new structured shape with rawClaudeMd + rawPackageJson
// @cap-todo(ac:F-044/AC-6) Tests verify command frontmatter intact (public command surface preserved)

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..');
const { probeProjectAnchors } = require(path.join(repoRoot, 'cap/bin/lib/convention-reader.cjs'));

// ─── AC-2 — pitfall research is opt-in via --research ───────────────────────

describe('F-044/AC-2 — pitfall research opt-in', () => {
  it('commands/cap/prototype.md exposes --research in argument-hint', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/prototype.md'), 'utf8');
    assert.match(md, /argument-hint:[^\n]*--research/, 'prototype.md argument-hint must include --research');
  });

  it('commands/cap/prototype.md DOES NOT mention --skip-research as the gating flag', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/prototype.md'), 'utf8');
    // Step 2b must NOT say "Skip this step if --skip-research"
    assert.doesNotMatch(
      md,
      /Skip this step if `--skip-research` is in the arguments/,
      'prototype.md must no longer use --skip-research as the gating phrase'
    );
  });

  it('commands/cap/prototype.md sets research_mode from --research (default false)', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/prototype.md'), 'utf8');
    assert.match(
      md,
      /`--research`[^\n]*research_mode\s*=\s*true/,
      'prototype.md Step 0 must parse --research into research_mode = true'
    );
    // The opt-in default should be documented
    assert.match(md, /research_mode\s*=\s*false[^\n]*opt-in|opt-in[^\n]*F-044/i, 'prototype.md must document opt-in default');
  });

  it('commands/cap/prototype.md Step 2b is gated on research_mode', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/prototype.md'), 'utf8');
    // The Step 2b heading should mention "only when --research"
    assert.match(
      md,
      /## Step 2b: Pitfall Research \(only when --research is set\)/,
      'Step 2b heading must indicate opt-in semantics'
    );
    // Body should reference research_mode being false as the skip condition
    assert.match(md, /Skip this step if `research_mode` is false/, 'Step 2b body must gate on research_mode');
  });

  it('commands/cap/debug.md gates Step 2c on --research opt-in', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/debug.md'), 'utf8');
    assert.match(
      md,
      /## Step 2c: Pitfall Research for Debug Context \(only when --research is set\)/,
      'debug.md Step 2c heading must indicate opt-in semantics'
    );
    assert.match(
      md,
      /Skip this step if `--research` is NOT in `\$ARGUMENTS`/,
      'debug.md Step 2c body must gate on --research presence in arguments'
    );
  });

  it('.claude mirror of prototype.md uses --research opt-in', () => {
    const md = fs.readFileSync(path.join(repoRoot, '.claude/commands/cap/prototype.md'), 'utf8');
    assert.match(md, /argument-hint:[^\n]*--research/);
    assert.match(md, /## Step 2b: Pitfall Research \(only when --research is set\)/);
    assert.doesNotMatch(md, /Skip this step if `--skip-research` is in the arguments/);
  });

  it('.claude mirror of debug.md uses --research opt-in', () => {
    const md = fs.readFileSync(path.join(repoRoot, '.claude/commands/cap/debug.md'), 'utf8');
    assert.match(md, /## Step 2c: Pitfall Research for Debug Context \(only when --research is set\)/);
    assert.match(md, /Skip this step if `--research` is NOT in `\$ARGUMENTS`/);
  });
});

// ─── AC-3 — two-anchor probe (probeProjectAnchors) ──────────────────────────

describe('F-044/AC-3 — probeProjectAnchors two-anchor probe', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f044-probe-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports probeProjectAnchors as a function', () => {
    assert.strictEqual(typeof probeProjectAnchors, 'function');
  });

  it('returns the documented shape with rawClaudeMd, rawPackageJson, parsedPackageJson, projectRoot, filesProbed', () => {
    const anchors = probeProjectAnchors(tmpDir);
    assert.ok('rawClaudeMd' in anchors, 'must include rawClaudeMd field');
    assert.ok('rawPackageJson' in anchors, 'must include rawPackageJson field');
    assert.ok('parsedPackageJson' in anchors, 'must include parsedPackageJson field');
    assert.ok('projectRoot' in anchors, 'must include projectRoot field');
    assert.ok('filesProbed' in anchors, 'must include filesProbed field');
    assert.strictEqual(anchors.projectRoot, tmpDir);
    assert.ok(Array.isArray(anchors.filesProbed));
  });

  it('returns null anchors and empty filesProbed for empty directory', () => {
    const anchors = probeProjectAnchors(tmpDir);
    assert.strictEqual(anchors.rawClaudeMd, null);
    assert.strictEqual(anchors.rawPackageJson, null);
    assert.strictEqual(anchors.parsedPackageJson, null);
    assert.deepStrictEqual(anchors.filesProbed, []);
  });

  it('reads CLAUDE.md when present and records it in filesProbed', () => {
    const claude = '# Project rules\nUse strict mode.\n';
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), claude);
    const anchors = probeProjectAnchors(tmpDir);
    assert.strictEqual(anchors.rawClaudeMd, claude);
    assert.ok(anchors.filesProbed.includes('CLAUDE.md'));
  });

  it('reads package.json raw + parsed when present and records it in filesProbed', () => {
    const pkg = { name: 'demo', type: 'module', dependencies: { foo: '^1.0.0' } };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
    const anchors = probeProjectAnchors(tmpDir);
    assert.strictEqual(anchors.rawPackageJson, JSON.stringify(pkg));
    assert.deepStrictEqual(anchors.parsedPackageJson, pkg);
    assert.ok(anchors.filesProbed.includes('package.json'));
  });

  it('keeps raw package.json but parsedPackageJson stays null on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json {');
    const anchors = probeProjectAnchors(tmpDir);
    assert.strictEqual(anchors.rawPackageJson, 'not valid json {');
    assert.strictEqual(anchors.parsedPackageJson, null);
    assert.ok(anchors.filesProbed.includes('package.json'));
  });

  it('reads ONLY the two anchor files (filesProbed.length <= 2)', () => {
    // Set up a project that the legacy probe would inspect 6+ files of
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# rules\n');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.prettierrc'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'biome.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.mkdirSync(path.join(tmpDir, 'tests'));

    const anchors = probeProjectAnchors(tmpDir);
    // The probe MUST have read at most the two anchor files
    assert.strictEqual(anchors.filesProbed.length, 2, 'probe must read exactly 2 files when both present');
    assert.deepStrictEqual(anchors.filesProbed.sort(), ['CLAUDE.md', 'package.json']);
    // tsconfig / eslint / prettier / biome must NOT have leaked into the result
    assert.ok(!('tsconfig' in anchors));
    assert.ok(!('eslint' in anchors));
    assert.ok(!('prettier' in anchors));
  });

  it('reads only the present anchor when the other is missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'rules');
    const anchors = probeProjectAnchors(tmpDir);
    assert.strictEqual(anchors.rawClaudeMd, 'rules');
    assert.strictEqual(anchors.rawPackageJson, null);
    assert.deepStrictEqual(anchors.filesProbed, ['CLAUDE.md']);
  });

  it('preserves backwards compatibility: readProjectConventions still exported and functional', () => {
    // This guards against accidentally removing the legacy probe
    const { readProjectConventions } = require(path.join(repoRoot, 'cap/bin/lib/convention-reader.cjs'));
    assert.strictEqual(typeof readProjectConventions, 'function');
    const report = readProjectConventions(tmpDir);
    assert.ok(report);
    assert.ok('moduleType' in report);
  });
});

// ─── AC-3 mirror parity ─────────────────────────────────────────────────────

describe('F-044/AC-3 — .claude mirror of convention-reader is byte-identical', () => {
  it('cap/bin/lib/convention-reader.cjs and .claude/cap/bin/lib/convention-reader.cjs are identical', () => {
    const a = fs.readFileSync(path.join(repoRoot, 'cap/bin/lib/convention-reader.cjs'), 'utf8');
    const b = fs.readFileSync(path.join(repoRoot, '.claude/cap/bin/lib/convention-reader.cjs'), 'utf8');
    assert.strictEqual(a, b, 'convention-reader.cjs and its .claude mirror must be byte-identical');
  });
});

// ─── AC-6 — public command surface intact (frontmatter parses) ──────────────

describe('F-044/AC-6 — public command surface intact', () => {
  it('commands/cap/prototype.md frontmatter is well-formed YAML with required keys', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/prototype.md'), 'utf8');
    const fmMatch = md.match(/^---\n([\s\S]+?)\n---/);
    assert.ok(fmMatch, 'must have YAML frontmatter delimited by ---');
    const fm = fmMatch[1];
    assert.match(fm, /^name: cap:prototype$/m, 'frontmatter must have name: cap:prototype');
    assert.match(fm, /^description: /m, 'frontmatter must have description');
    assert.match(fm, /^argument-hint: /m, 'frontmatter must have argument-hint');
    assert.match(fm, /^allowed-tools:/m, 'frontmatter must have allowed-tools');
  });

  it('commands/cap/debug.md frontmatter is well-formed YAML with required keys', () => {
    const md = fs.readFileSync(path.join(repoRoot, 'commands/cap/debug.md'), 'utf8');
    const fmMatch = md.match(/^---\n([\s\S]+?)\n---/);
    assert.ok(fmMatch, 'must have YAML frontmatter delimited by ---');
    const fm = fmMatch[1];
    assert.match(fm, /^name: cap:debug$/m, 'frontmatter must have name: cap:debug');
    assert.match(fm, /^description: /m, 'frontmatter must have description');
    assert.match(fm, /^argument-hint: /m, 'frontmatter must have argument-hint');
    assert.match(fm, /^allowed-tools:/m, 'frontmatter must have allowed-tools');
  });

  it('.claude mirror of prototype.md frontmatter is intact', () => {
    const md = fs.readFileSync(path.join(repoRoot, '.claude/commands/cap/prototype.md'), 'utf8');
    const fmMatch = md.match(/^---\n([\s\S]+?)\n---/);
    assert.ok(fmMatch);
    assert.match(fmMatch[1], /^name: cap:prototype$/m);
  });

  it('.claude mirror of debug.md frontmatter is intact', () => {
    const md = fs.readFileSync(path.join(repoRoot, '.claude/commands/cap/debug.md'), 'utf8');
    const fmMatch = md.match(/^---\n([\s\S]+?)\n---/);
    assert.ok(fmMatch);
    assert.match(fmMatch[1], /^name: cap:debug$/m);
  });

  it('audit document exists at docs/F-044-agent-audit.md with required sections', () => {
    const docPath = path.join(repoRoot, 'docs/F-044-agent-audit.md');
    assert.ok(fs.existsSync(docPath), 'audit document must exist');
    const md = fs.readFileSync(docPath, 'utf8');
    // All five agent sections required
    assert.match(md, /^## cap-prototyper$/m);
    assert.match(md, /^## cap-tester$/m);
    assert.match(md, /^## cap-reviewer$/m);
    assert.match(md, /^## cap-debugger$/m);
    assert.match(md, /^## cap-brainstormer$/m);
    // 4-mode evaluation section required
    assert.match(md, /^## 4-Mode Architecture Evaluation/m);
  });

  it('token benchmark document exists at docs/F-044-token-benchmark.md with at least 5 task rows', () => {
    const docPath = path.join(repoRoot, 'docs/F-044-token-benchmark.md');
    assert.ok(fs.existsSync(docPath), 'token benchmark must exist');
    const md = fs.readFileSync(docPath, 'utf8');
    // Count rows in the main 5-task table
    const taskRows = md.match(/^\|\s*[1-9]\s*\|/gm) || [];
    assert.ok(taskRows.length >= 5, `must have at least 5 numbered task rows, got ${taskRows.length}`);
  });
});
