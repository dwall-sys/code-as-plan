// @cap-feature(feature:F-058) Claude-Code Plugin Manifest — tests for plugin.json, marketplace.json, hooks.json, and detectInstallMode()

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  detectInstallMode,
  runDoctor,
  formatReport,
} = require('../cap/bin/lib/cap-doctor.cjs');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_MANIFEST = path.join(ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const HOOKS_MANIFEST = path.join(ROOT, 'hooks', 'hooks.json');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

// Reserved names that MUST NOT be used as marketplace name per Claude Code plugin spec.
// Imported from cap-plugin-manifest so the list has a single source of truth;
// the test's role is to verify our chosen name does NOT collide with the list.
const { RESERVED_MARKETPLACE_NAMES } = require('../cap/bin/lib/cap-plugin-manifest.cjs');

// ---------------------------------------------------------------------------
// AC-1 — .claude-plugin/plugin.json exists with full metadata
// ---------------------------------------------------------------------------
describe('plugin.json (AC-1)', () => {
  // @cap-todo(ac:F-058/AC-1) Verify plugin.json exists and has required metadata fields.
  it('exists on disk', () => {
    assert.ok(fs.existsSync(PLUGIN_MANIFEST), '.claude-plugin/plugin.json must exist');
  });

  it('parses as strict JSON (no comments, no trailing commas)', () => {
    const raw = fs.readFileSync(PLUGIN_MANIFEST, 'utf8');
    // JSON.parse is strict — will throw on comments or trailing commas
    assert.doesNotThrow(() => JSON.parse(raw), 'plugin.json must be strict JSON');
  });

  it('has all required metadata fields with correct types', () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));

    assert.equal(typeof manifest.name, 'string');
    assert.ok(manifest.name.length > 0, 'name must be non-empty');
    // kebab-case, no spaces
    assert.match(manifest.name, /^[a-z0-9][a-z0-9-]*$/, 'name must be kebab-case, no spaces');

    assert.equal(typeof manifest.version, 'string');
    assert.match(manifest.version, /^\d+\.\d+\.\d+/, 'version must be semver');

    assert.equal(typeof manifest.description, 'string');
    assert.ok(manifest.description.length > 0);

    // author may be a string or object {name: ...}
    if (typeof manifest.author === 'object') {
      assert.equal(typeof manifest.author.name, 'string');
      assert.ok(manifest.author.name.length > 0);
    } else {
      assert.equal(typeof manifest.author, 'string');
    }

    assert.equal(typeof manifest.homepage, 'string');
    assert.match(manifest.homepage, /^https?:\/\//);

    assert.equal(typeof manifest.repository, 'string');
    assert.match(manifest.repository, /github\.com/);

    assert.equal(manifest.license, 'MIT');

    assert.ok(Array.isArray(manifest.keywords), 'keywords must be an array');
    assert.ok(manifest.keywords.length > 0, 'keywords should not be empty');
    for (const kw of manifest.keywords) {
      assert.equal(typeof kw, 'string', 'each keyword must be a string');
    }
  });

  it('version agrees with package.json version', () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(manifest.version, pkg.version, 'plugin.json version must match package.json version');
  });

  it('plugin name "cap" matches the slash-command namespace /cap:*', () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(manifest.name, 'cap', 'plugin name must be "cap" to preserve /cap: slash-command namespace');
  });
});

// ---------------------------------------------------------------------------
// AC-3 — plugin.json MUST NOT carry "hooks" / "agents" fields
// ---------------------------------------------------------------------------
describe('plugin.json auto-discovery fields (AC-3)', () => {
  // @cap-todo(ac:F-058/AC-3) Plugin manifest must NOT list "hooks" — auto-discovery from hooks/hooks.json is used.
  it('has NO "hooks" field (Claude Code auto-discovers hooks/hooks.json)', () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(
      Object.prototype.hasOwnProperty.call(manifest, 'hooks'),
      false,
      'plugin.json MUST NOT contain a "hooks" field'
    );
  });

  // @cap-decision We DO set "commands" to "./commands/cap/" because CAP's command files live at
  // commands/cap/*.md (not commands/*.md). Without this override Claude would not find them. This is
  // a deviation from the brainstorm brief ("idealerweise ohne commands-Feld") documented as a trade-off
  // driven by the existing repository layout which the npx installer depends on.
  it('has NO "agents" field (auto-discovered from agents/)', () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(
      Object.prototype.hasOwnProperty.call(manifest, 'agents'),
      false,
      'plugin.json MUST NOT contain an "agents" field (auto-discovery wins)'
    );
  });
});

// ---------------------------------------------------------------------------
// AC-2 — marketplace.json exists with Marketplace metadata
// ---------------------------------------------------------------------------
describe('marketplace.json (AC-2)', () => {
  // @cap-todo(ac:F-058/AC-2) Verify marketplace.json exists with metadata for /plugin install code-as-plan.
  it('exists on disk', () => {
    assert.ok(fs.existsSync(MARKETPLACE_MANIFEST), '.claude-plugin/marketplace.json must exist');
  });

  it('parses as strict JSON', () => {
    const raw = fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('has required top-level fields', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    assert.equal(typeof mp.name, 'string');
    assert.ok(mp.name.length > 0);
    assert.match(mp.name, /^[a-z0-9][a-z0-9-]*$/, 'marketplace name must be kebab-case');

    assert.equal(typeof mp.owner, 'object');
    assert.equal(typeof mp.owner.name, 'string');

    assert.equal(typeof mp.metadata, 'object');
    assert.equal(typeof mp.metadata.description, 'string');
    assert.equal(typeof mp.metadata.version, 'string');

    assert.ok(Array.isArray(mp.plugins), 'plugins must be an array');
    assert.ok(mp.plugins.length >= 1, 'marketplace must list at least one plugin');
  });

  it('marketplace name "code-as-plan" is NOT in the Claude reserved list', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    assert.equal(
      RESERVED_MARKETPLACE_NAMES.includes(mp.name),
      false,
      `marketplace name "${mp.name}" must not be a reserved name`
    );
  });

  it('contains a "cap" plugin entry with source "./"', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    const capEntry = mp.plugins.find(p => p.name === 'cap');
    assert.ok(capEntry, 'marketplace.plugins must list a "cap" entry');
    assert.equal(capEntry.source, './', 'cap plugin source must be "./" (self-hosted from repo root)');
    assert.equal(typeof capEntry.description, 'string');
    assert.ok(capEntry.description.length > 0);
  });

  it('plugin entry in marketplace does NOT set its own version (manifest wins)', () => {
    // @cap-decision Claude docs: "plugin manifest always wins silently, so set in only one place".
    // Set version in plugin.json only; marketplace entries stay versionless.
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    const capEntry = mp.plugins.find(p => p.name === 'cap');
    assert.equal(
      Object.prototype.hasOwnProperty.call(capEntry, 'version'),
      false,
      'marketplace plugin entry must not carry its own version field'
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4 — npx install path remains primary and functional
// ---------------------------------------------------------------------------
describe('npx install path intact (AC-4)', () => {
  // @cap-todo(ac:F-058/AC-4) Npx install path remains primary — package.json bin.cap entry must be intact.
  it('package.json keeps bin.cap entry', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(typeof pkg.bin, 'object');
    assert.equal(typeof pkg.bin.cap, 'string');
    assert.ok(pkg.bin.cap.length > 0, 'bin.cap must point to the installer');
  });

  it('package.json keeps the code-as-plan npm name', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(pkg.name, 'code-as-plan');
  });

  it('package.json is not marked deprecated', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(pkg.deprecated, undefined, 'package must not carry a deprecation notice');
  });

  it('package.json files[] includes .claude-plugin and hooks.json for publish', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.ok(Array.isArray(pkg.files));
    assert.ok(pkg.files.includes('.claude-plugin'), 'files[] must include .claude-plugin so plugin mode ships');
    assert.ok(pkg.files.includes('hooks/hooks.json'), 'files[] must include hooks/hooks.json');
  });
});

// ---------------------------------------------------------------------------
// AC-5 — detectInstallMode() recognizes npx / plugin / both / neither
// ---------------------------------------------------------------------------
describe('detectInstallMode (AC-5)', () => {
  // @cap-todo(ac:F-058/AC-5) Unit tests for all four combinations.

  function makeFakeHome(which) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mode-'));
    if (which === 'npx' || which === 'both') {
      fs.mkdirSync(path.join(tmp, '.claude', 'cap'), { recursive: true });
    }
    if (which === 'plugin' || which === 'both') {
      const pluginCache = path.join(tmp, '.claude', 'plugins', 'cache', 'cap@code-as-plan');
      fs.mkdirSync(pluginCache, { recursive: true });
      fs.writeFileSync(path.join(pluginCache, 'plugin.json'), '{}');
    }
    return tmp;
  }

  function makeEmptyCwd() {
    // A cwd that does NOT contain a .claude-plugin/plugin.json — used to isolate npx-only / none cases.
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-cwd-'));
  }

  it('detects npx-only mode', () => {
    const fakeHome = makeFakeHome('npx');
    const emptyCwd = makeEmptyCwd();
    try {
      const r = detectInstallMode({ homeDir: fakeHome, cwd: emptyCwd });
      assert.equal(r.npx, true);
      assert.equal(r.plugin, false);
      assert.equal(r.coexist, false);
      assert.equal(r.active, 'npx');
      assert.equal(r.pluginPaths.length, 0);
      assert.equal(r.warnings.length, 0);
      assert.equal(r.npxPath, path.join(fakeHome, '.claude', 'cap'));
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('detects plugin-only mode via Claude plugin cache', () => {
    const fakeHome = makeFakeHome('plugin');
    const emptyCwd = makeEmptyCwd();
    try {
      const r = detectInstallMode({ homeDir: fakeHome, cwd: emptyCwd });
      assert.equal(r.npx, false);
      assert.equal(r.plugin, true);
      assert.equal(r.coexist, false);
      assert.equal(r.active, 'plugin');
      assert.ok(r.pluginPaths.length >= 1);
      assert.equal(r.warnings.length, 0);
      assert.equal(r.npxPath, undefined);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('detects coexistence when both modes active', () => {
    const fakeHome = makeFakeHome('both');
    const emptyCwd = makeEmptyCwd();
    try {
      const r = detectInstallMode({ homeDir: fakeHome, cwd: emptyCwd });
      assert.equal(r.npx, true);
      assert.equal(r.plugin, true);
      assert.equal(r.coexist, true);
      assert.equal(r.active, 'both');
      assert.ok(r.warnings.length >= 1, 'coexistence must produce a warning');
      const combined = r.warnings.join(' ');
      assert.match(combined, /coexistence|both|duplicate/i);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('returns active:"none" when neither mode is present', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-none-'));
    const emptyCwd = makeEmptyCwd();
    try {
      const r = detectInstallMode({ homeDir: fakeHome, cwd: emptyCwd });
      assert.equal(r.npx, false);
      assert.equal(r.plugin, false);
      assert.equal(r.coexist, false);
      assert.equal(r.active, 'none');
      assert.equal(r.pluginPaths.length, 0);
      assert.equal(r.warnings.length, 0);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('detects local-dev plugin footprint via .claude-plugin/plugin.json in cwd', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-local-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-cwd-local-'));
    try {
      fs.mkdirSync(path.join(cwd, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'), '{"name":"cap"}');
      const r = detectInstallMode({ homeDir: fakeHome, cwd });
      assert.equal(r.plugin, true, 'local manifest must count as plugin footprint');
      assert.equal(r.active, 'plugin');
      assert.ok(r.pluginPaths.some(p => p.includes('.claude-plugin')));
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns an InstallModeReport with all expected keys', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-shape-'));
    const emptyCwd = makeEmptyCwd();
    try {
      const r = detectInstallMode({ homeDir: fakeHome, cwd: emptyCwd });
      assert.equal(typeof r.npx, 'boolean');
      assert.equal(typeof r.plugin, 'boolean');
      assert.equal(typeof r.coexist, 'boolean');
      assert.equal(typeof r.active, 'string');
      assert.ok(Array.isArray(r.pluginPaths));
      assert.ok(Array.isArray(r.warnings));
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6 — coexistence produces a warning in the doctor report
// ---------------------------------------------------------------------------
describe('doctor report coexistence warning (AC-6)', () => {
  // @cap-todo(ac:F-058/AC-6) runDoctor() output contains the coexistence warning when both modes are active.
  it('runDoctor attaches installMode to the report', () => {
    const report = runDoctor();
    assert.ok(report.installMode, 'report should carry installMode');
    assert.equal(typeof report.installMode.active, 'string');
    assert.ok(Array.isArray(report.installMode.warnings));
  });

  it('formatReport renders "Install mode:" section', () => {
    const report = runDoctor();
    const out = formatReport(report);
    assert.ok(out.includes('Install mode:'), 'output must contain Install mode: heading');
  });

  it('formatReport renders coexistence warning for a fake both-active report', () => {
    const fakeReport = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
      modules: [],
      modulesOk: 0,
      modulesTotal: 0,
      platformPaths: { envHome: '/h', osHomedir: '/h', homeMatch: true, installDir: '/h', isSymlink: false, ok: true, warnings: [] },
      installMode: {
        npx: true,
        plugin: true,
        coexist: true,
        active: 'both',
        pluginPaths: ['/fake/plugin'],
        npxPath: '/fake/npx',
        warnings: ['Both npx and plugin install modes are active.'],
      },
    };
    const out = formatReport(fakeReport);
    assert.match(out, /coexistence detected|npx \(primary\) \+ plugin/i);
    assert.ok(out.includes('Both npx and plugin install modes are active.'));
  });

  it('coexistence does NOT flip healthy to false (warning only)', () => {
    // Synthesize a report with coexistence but everything else OK.
    const report = {
      tools: [{ name: 'x', ok: true, version: '1', required: true, purpose: '', installHint: '' }],
      requiredOk: 1,
      requiredTotal: 1,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
      modules: [],
      modulesOk: 0,
      modulesTotal: 0,
      platformPaths: { envHome: '/h', osHomedir: '/h', homeMatch: true, installDir: '/h', isSymlink: false, ok: true, warnings: [] },
      installMode: {
        npx: true, plugin: true, coexist: true, active: 'both',
        pluginPaths: ['/p'], npxPath: '/n',
        warnings: ['coexistence detected'],
      },
    };
    const out = formatReport(report);
    // The output should not claim UNHEALTHY just because of coexistence.
    assert.equal(out.includes('UNHEALTHY'), false, 'coexistence must not cause UNHEALTHY');
  });
});

// ---------------------------------------------------------------------------
// hooks/hooks.json — minimal plugin-mode hook registration
// ---------------------------------------------------------------------------
describe('hooks/hooks.json (plugin-mode hook registration)', () => {
  // @cap-todo(ac:F-058/AC-3) hooks.json registers plugin-mode hooks without declaring them in plugin.json.
  it('exists on disk', () => {
    assert.ok(fs.existsSync(HOOKS_MANIFEST), 'hooks/hooks.json must exist for plugin auto-discovery');
  });

  it('parses as strict JSON', () => {
    const raw = fs.readFileSync(HOOKS_MANIFEST, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('registers Stop and PostToolUse events using ${CLAUDE_PLUGIN_ROOT}', () => {
    const hooks = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    assert.equal(typeof hooks.hooks, 'object');
    assert.ok(Array.isArray(hooks.hooks.Stop), 'Stop handler must be an array');
    assert.ok(Array.isArray(hooks.hooks.PostToolUse), 'PostToolUse handler must be an array');

    // Stop -> cap-memory
    const stopCmd = hooks.hooks.Stop[0].hooks[0].command;
    assert.match(stopCmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'Stop command must use ${CLAUDE_PLUGIN_ROOT}');
    assert.match(stopCmd, /cap-memory\.js$/);

    // PostToolUse -> cap-tag-observer
    const postEntry = hooks.hooks.PostToolUse[0];
    assert.match(postEntry.matcher, /Edit/);
    assert.match(postEntry.matcher, /Write/);
    const postCmd = postEntry.hooks[0].command;
    assert.match(postCmd, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.match(postCmd, /cap-tag-observer\.js$/);
  });

  it('references dist artifacts that exist on disk', () => {
    // Plugin mode shares built hook artifacts with npx. If dist files are missing, both installs break.
    assert.ok(fs.existsSync(path.join(ROOT, 'hooks', 'dist', 'cap-memory.js')), 'hooks/dist/cap-memory.js must exist');
    assert.ok(fs.existsSync(path.join(ROOT, 'hooks', 'dist', 'cap-tag-observer.js')), 'hooks/dist/cap-tag-observer.js must exist');
  });

  // @cap-feature(feature:F-084) Stage-2 #1 fix — SessionStart hook registration.
  // @cap-decision(F-084/iter1) Stage-2 #1 fix: SessionStart hook registered in plugin manifest + dist build + manifest-test.
  //   "lesson-13" pin: any feature that ships a hook MUST include a manifest-test
  //   asserting (a) SessionStart entry exists, (b) it points at the right dist
  //   path, (c) the dist file actually exists on disk. Without all three, the
  //   hook is unreachable for npx-installed users.
  it('registers SessionStart for cap-version-check.js (F-084 lesson-13)', () => {
    const hooks = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    assert.ok(Array.isArray(hooks.hooks.SessionStart),
      'hooks.SessionStart must be an array (F-084 advisory hook)');
    assert.ok(hooks.hooks.SessionStart.length > 0,
      'hooks.SessionStart must contain at least one entry');
    // Find an entry that references cap-version-check.js.
    let found = null;
    for (const group of hooks.hooks.SessionStart) {
      const inner = Array.isArray(group.hooks) ? group.hooks : [];
      for (const h of inner) {
        if (typeof h.command === 'string' && /cap-version-check\.js$/.test(h.command)) {
          found = h;
          break;
        }
      }
      if (found) break;
    }
    assert.ok(found, 'SessionStart must register cap-version-check.js');
    assert.match(found.command, /\$\{CLAUDE_PLUGIN_ROOT\}/,
      'SessionStart cap-version-check command must use ${CLAUDE_PLUGIN_ROOT}');
    assert.match(found.command, /\/hooks\/dist\/cap-version-check\.js$/,
      'SessionStart cap-version-check command must point at hooks/dist/');
    // Timeout is recommended for SessionStart (non-blocking <2s budget).
    if ('timeout' in found) {
      assert.equal(typeof found.timeout, 'number');
      assert.ok(found.timeout > 0 && found.timeout <= 5,
        `SessionStart timeout should be 1-5s (got ${found.timeout})`);
    }
  });

  it('SessionStart cap-version-check.js dist artifact exists (F-084)', () => {
    const distFile = path.join(ROOT, 'hooks', 'dist', 'cap-version-check.js');
    assert.ok(fs.existsSync(distFile),
      'hooks/dist/cap-version-check.js must exist after build (lesson-13: dist-build must include any hook registered in hooks.json)');
  });
});
