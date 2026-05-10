// @cap-feature(feature:F-058) Claude-Code Plugin Manifest — adversarial corner-case regression suite.
// @cap-context Complements tests/cap-plugin-manifest.test.cjs. Tests here target manifest-schema
//              edges, doctor detection boundaries, install-mode coexistence quirks, and filesystem
//              edge cases that the happy-path suite does not cover.

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
const INSTALL_JS = path.join(ROOT, 'bin', 'install.js');

// Full reserved / impersonation list from Claude Code marketplace spec.
// @cap-decision Duplicated here (vs importing) so any future code drift is detected by the test rather
//               than silently propagated from the implementation.
const RESERVED_MARKETPLACE_NAMES = [
  'claude-code-marketplace',
  'claude-code-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
  'anthropic-plugins',
  'agent-skills',
  'knowledge-work-plugins',
  'life-sciences',
];

const IMPERSONATION_NAMES = [
  'official-claude-plugins',
  'anthropic-tools-v2',
  'claude-official',
  'anthropic-official',
];

// ---------------------------------------------------------------------------
// plugin.json — strict schema edges (AC-1, AC-3)
// ---------------------------------------------------------------------------
describe('plugin.json schema edges (AC-1, AC-3)', () => {
  it('is a plain object, not an array', () => {
    const raw = fs.readFileSync(PLUGIN_MANIFEST, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(Array.isArray(parsed), false, 'plugin.json top-level must be an object');
    assert.equal(typeof parsed, 'object');
    assert.notEqual(parsed, null, 'top-level must not be null');
  });

  it('name does not contain whitespace, uppercase, or special chars', () => {
    const m = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(/\s/.test(m.name), false, 'name must not contain whitespace');
    assert.equal(m.name, m.name.toLowerCase(), 'name must be all-lowercase');
    assert.equal(/[^a-z0-9-]/.test(m.name), false, 'name must be [a-z0-9-] only');
    // must not start or end with hyphen
    assert.equal(m.name.startsWith('-'), false);
    assert.equal(m.name.endsWith('-'), false);
  });

  it('version is strict semver MAJOR.MINOR.PATCH (no leading v, no single-digit shorthand)', () => {
    const m = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(m.version.startsWith('v'), false, 'version must not have leading "v"');
    // Reject "4" or "4.0" — require at least 3 segments.
    const parts = m.version.split('.');
    assert.ok(parts.length >= 3, `version "${m.version}" must have 3 segments`);
    // Each semver segment must be all digits (optionally followed by pre-release suffix on last).
    assert.match(parts[0], /^\d+$/);
    assert.match(parts[1], /^\d+$/);
  });

  it('does NOT contain forbidden top-level fields (hooks, agents, commands-inline)', () => {
    const m = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    // AC-3: no hooks (auto-discovery)
    assert.equal(Object.prototype.hasOwnProperty.call(m, 'hooks'), false);
    // no inline agents
    assert.equal(Object.prototype.hasOwnProperty.call(m, 'agents'), false);
    // no skills inline
    assert.equal(Object.prototype.hasOwnProperty.call(m, 'skills'), false);
  });

  it('commands field, if present, is a path override string (not an array/object)', () => {
    const m = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    if (Object.prototype.hasOwnProperty.call(m, 'commands')) {
      assert.equal(typeof m.commands, 'string', 'commands must be a string path override');
      // relative path into repo
      assert.ok(m.commands.startsWith('./') || !path.isAbsolute(m.commands),
        'commands path should be relative (./commands/cap/)');
      // the referenced directory must exist
      const commandsDir = path.join(ROOT, m.commands);
      assert.ok(fs.existsSync(commandsDir), `commands path ${m.commands} must resolve to an existing dir`);
      assert.ok(fs.statSync(commandsDir).isDirectory(), 'commands path must be a directory');
    }
  });

  it('author object, if used, has a string name field', () => {
    const m = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    if (typeof m.author === 'object' && m.author !== null) {
      assert.ok(Object.prototype.hasOwnProperty.call(m.author, 'name'),
        'author object must carry a name field');
      assert.equal(typeof m.author.name, 'string');
      assert.ok(m.author.name.length > 0, 'author.name must not be empty');
    }
  });

  it('plugin name matches marketplace plugin entry name (cross-reference)', () => {
    const plug = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    const entry = mp.plugins.find(p => p.name === plug.name);
    assert.ok(entry, `marketplace must list plugin with name "${plug.name}"`);
  });

  it('raw file has no BOM, no trailing comma, parses byte-identically after round-trip', () => {
    const raw = fs.readFileSync(PLUGIN_MANIFEST, 'utf8');
    // BOM check
    assert.notEqual(raw.charCodeAt(0), 0xFEFF, 'plugin.json must not start with BOM');
    // JSON.parse is strict — explicit assertion that raw is pure JSON (no // comments)
    assert.equal(/^\s*\/\//.test(raw), false, 'plugin.json must not start with // comment');
    assert.equal(/,\s*[}\]]/.test(raw), false, 'plugin.json must not contain trailing commas');
  });
});

// ---------------------------------------------------------------------------
// marketplace.json — strict schema edges (AC-2)
// ---------------------------------------------------------------------------
describe('marketplace.json schema edges (AC-2)', () => {
  it('name is not in reserved list AND not in impersonation list', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    for (const reserved of RESERVED_MARKETPLACE_NAMES) {
      assert.notEqual(mp.name, reserved, `name must not be reserved "${reserved}"`);
    }
    for (const imp of IMPERSONATION_NAMES) {
      assert.notEqual(mp.name, imp, `name must not impersonate "${imp}"`);
    }
  });

  it('name is kebab-case and does not contain anthropic/claude brand tokens', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    assert.match(mp.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'marketplace name must be kebab-case');
    // Discourage impersonation substrings
    assert.equal(/anthropic/i.test(mp.name), false, 'marketplace name must not impersonate anthropic');
  });

  it('owner.name is a non-empty string', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    assert.equal(typeof mp.owner, 'object');
    assert.notEqual(mp.owner, null);
    assert.equal(typeof mp.owner.name, 'string');
    assert.ok(mp.owner.name.trim().length > 0, 'owner.name must be non-empty');
  });

  it('plugins array is non-empty and each entry has required fields', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    assert.ok(Array.isArray(mp.plugins));
    assert.ok(mp.plugins.length >= 1, 'plugins must be non-empty');
    for (const p of mp.plugins) {
      assert.equal(typeof p.name, 'string', 'each plugin needs a name');
      assert.ok(p.name.length > 0);
      assert.equal(typeof p.source, 'string', 'each plugin needs a source');
    }
  });

  it('plugins[].name values are unique (no duplicates)', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    const names = mp.plugins.map(p => p.name);
    const uniq = new Set(names);
    assert.equal(names.length, uniq.size, `plugin names must be unique (got ${JSON.stringify(names)})`);
  });

  it('plugins[].source does not contain ".." path traversal', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    for (const p of mp.plugins) {
      assert.equal(p.source.includes('..'), false,
        `plugin "${p.name}" source "${p.source}" must not contain ".." path traversal`);
    }
  });

  it('plugins[].source is a relative path, not absolute', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    for (const p of mp.plugins) {
      assert.equal(path.isAbsolute(p.source), false,
        `plugin "${p.name}" source must be relative, got absolute "${p.source}"`);
    }
  });

  it('cap-pro plugin entry source "./" resolves to the directory that contains .claude-plugin/plugin.json', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    const cap = mp.plugins.find(p => p.name === 'cap-pro');
    assert.ok(cap, 'marketplace must list cap-pro entry');
    // source is relative to the marketplace.json file. marketplace.json lives at .claude-plugin/marketplace.json,
    // so source "./" resolves to .claude-plugin/ — and plugin.json must live there.
    const resolved = path.resolve(path.dirname(MARKETPLACE_MANIFEST), cap.source);
    assert.ok(fs.existsSync(path.join(resolved, 'plugin.json')),
      `plugin.json must exist in resolved source dir ${resolved}`);
  });

  it('plugin entry does not set version (plugin.json is single source of truth)', () => {
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));
    for (const p of mp.plugins) {
      assert.equal(Object.prototype.hasOwnProperty.call(p, 'version'), false,
        `plugin "${p.name}" must not carry own version — plugin.json wins`);
    }
  });

  it('has no trailing commas or comments (strict JSON)', () => {
    const raw = fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8');
    assert.notEqual(raw.charCodeAt(0), 0xFEFF, 'marketplace.json must not have BOM');
    assert.equal(/,\s*[}\]]/.test(raw), false, 'marketplace.json must not contain trailing commas');
  });
});

// ---------------------------------------------------------------------------
// hooks/hooks.json — schema quirks (AC-3 plugin-mode hook registration)
// ---------------------------------------------------------------------------
describe('hooks/hooks.json schema edges', () => {
  it('top-level wrapper is { "hooks": {...} } (not bare event names)', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    assert.equal(typeof h.hooks, 'object', 'must have top-level "hooks" wrapper');
    assert.notEqual(h.hooks, null);
    // Bare event names at top-level would indicate malformed config
    assert.equal(Object.prototype.hasOwnProperty.call(h, 'Stop'), false,
      '"Stop" must be nested under "hooks", not top-level');
    assert.equal(Object.prototype.hasOwnProperty.call(h, 'PostToolUse'), false,
      '"PostToolUse" must be nested under "hooks", not top-level');
  });

  it('event names use exact case (Stop, PostToolUse) — case-sensitive', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    // Positive: the expected PascalCase keys must exist
    assert.ok(Object.prototype.hasOwnProperty.call(h.hooks, 'Stop'), 'Stop must be PascalCase');
    assert.ok(Object.prototype.hasOwnProperty.call(h.hooks, 'PostToolUse'), 'PostToolUse must be PascalCase');
    // Negative: lowercase variants would be silently ignored by Claude — assert they are NOT used
    assert.equal(Object.prototype.hasOwnProperty.call(h.hooks, 'stop'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(h.hooks, 'posttooluse'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(h.hooks, 'post_tool_use'), false);
  });

  it('Stop hook entry has NO matcher field (Stop has no matcher per Claude spec)', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    for (const entry of h.hooks.Stop) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'matcher'), false,
        'Stop event entries must not carry a matcher (matcher is only valid for tool events)');
    }
  });

  it('PostToolUse entries carry a matcher string', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    for (const entry of h.hooks.PostToolUse) {
      assert.equal(typeof entry.matcher, 'string', 'PostToolUse needs a matcher');
      assert.ok(entry.matcher.length > 0);
    }
  });

  it('every hook command uses ${CLAUDE_PLUGIN_ROOT} (never hard-coded paths)', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    const allCmds = [];
    for (const [, entries] of Object.entries(h.hooks)) {
      for (const entry of entries) {
        for (const hk of entry.hooks) allCmds.push(hk.command);
      }
    }
    assert.ok(allCmds.length > 0);
    for (const cmd of allCmds) {
      assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/,
        `command "${cmd}" must use \${CLAUDE_PLUGIN_ROOT} — no hard-coded paths`);
      assert.equal(cmd.startsWith('/'), false, `command must not be absolute: ${cmd}`);
      assert.equal(cmd.includes('~'), false, `command must not use ~: ${cmd}`);
    }
  });

  it('every referenced dist file exists after build:hooks', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    const distRefs = [];
    for (const [, entries] of Object.entries(h.hooks)) {
      for (const entry of entries) {
        for (const hk of entry.hooks) {
          const rel = hk.command.replace('${CLAUDE_PLUGIN_ROOT}/', '');
          distRefs.push(rel);
        }
      }
    }
    assert.ok(distRefs.length >= 2);
    for (const rel of distRefs) {
      const abs = path.join(ROOT, rel);
      assert.ok(fs.existsSync(abs), `hooks dist artifact missing: ${abs}`);
      // And the file must not be empty (an empty hook would silently no-op)
      assert.ok(fs.statSync(abs).size > 0, `hook artifact ${rel} must not be empty`);
    }
  });

  it('each hook entry declares type:"command" (no unrecognised types)', () => {
    const h = JSON.parse(fs.readFileSync(HOOKS_MANIFEST, 'utf8'));
    for (const [, entries] of Object.entries(h.hooks)) {
      for (const entry of entries) {
        for (const hk of entry.hooks) {
          assert.equal(hk.type, 'command', 'only type:"command" is supported by Claude hooks');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// detectInstallMode — filesystem edges (AC-5)
// ---------------------------------------------------------------------------
describe('detectInstallMode — filesystem edges (AC-5)', () => {
  function tmp(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  it('empty plugin cache directory (exists but has no cap@* entries) → plugin:false', () => {
    const home = tmp('cap-empty-cache-');
    const cwd = tmp('cap-cwd-');
    try {
      fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache'), { recursive: true });
      // Note: no cap@* subdir
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, false, 'empty cache dir must not count as plugin install');
      assert.equal(r.pluginPaths.length, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('plugin cache has unrelated entries (no cap@*) → plugin:false', () => {
    const home = tmp('cap-other-plugins-');
    const cwd = tmp('cap-cwd-');
    try {
      const cache = path.join(home, '.claude', 'plugins', 'cache');
      fs.mkdirSync(path.join(cache, 'other-plugin@source'), { recursive: true });
      fs.mkdirSync(path.join(cache, 'foo@bar'), { recursive: true });
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, false, 'unrelated plugins must not match "cap"');
      assert.equal(r.pluginPaths.length, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('multiple cap@* entries in cache → all pluginPaths are collected', () => {
    const home = tmp('cap-multi-cache-');
    const cwd = tmp('cap-cwd-');
    try {
      const cache = path.join(home, '.claude', 'plugins', 'cache');
      fs.mkdirSync(path.join(cache, 'cap@marketplace-a'), { recursive: true });
      fs.mkdirSync(path.join(cache, 'cap@marketplace-b'), { recursive: true });
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, true);
      assert.equal(r.pluginPaths.length, 2, 'both cap@* entries must be reported');
      assert.ok(r.pluginPaths.some(p => p.endsWith('cap@marketplace-a')));
      assert.ok(r.pluginPaths.some(p => p.endsWith('cap@marketplace-b')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('bare "cap" entry (no @source suffix) is also treated as plugin footprint', () => {
    const home = tmp('cap-bare-');
    const cwd = tmp('cap-cwd-');
    try {
      const cache = path.join(home, '.claude', 'plugins', 'cache', 'cap');
      fs.mkdirSync(cache, { recursive: true });
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, true);
      assert.equal(r.pluginPaths.length, 1);
      assert.ok(r.pluginPaths[0].endsWith(path.join('cache', 'cap')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('cache entry with unrelated prefix "capricorn@..." is NOT matched (prefix test is exact)', () => {
    const home = tmp('cap-prefix-');
    const cwd = tmp('cap-cwd-');
    try {
      const cache = path.join(home, '.claude', 'plugins', 'cache');
      // capricorn starts with "cap" but NOT "cap@"
      fs.mkdirSync(path.join(cache, 'capricorn@foo'), { recursive: true });
      fs.mkdirSync(path.join(cache, 'caplet'), { recursive: true });
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, false,
        'only "cap" or "cap@*" must match — "capricorn@*" and "caplet" must NOT be reported as CAP install');
      assert.equal(r.pluginPaths.length, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('local .claude-plugin/plugin.json with invalid JSON does NOT crash and does NOT register as CAP footprint', () => {
    const home = tmp('cap-local-bad-json-');
    const cwd = tmp('cap-cwd-bad-');
    try {
      fs.mkdirSync(path.join(cwd, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'), '{not valid json');
      let r;
      assert.doesNotThrow(() => {
        r = detectInstallMode({ homeDir: home, cwd });
      }, 'malformed plugin.json must not crash detectInstallMode');
      assert.equal(r.plugin, false, 'unparseable manifest is not a CAP install');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('local .claude-plugin/plugin.json with name "not-cap" is NOT a CAP footprint', () => {
    const home = tmp('cap-local-wrongname-');
    const cwd = tmp('cap-cwd-wn-');
    try {
      fs.mkdirSync(path.join(cwd, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'not-cap', version: '1.0.0' }));
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, false, 'foreign plugin manifests do not register as CAP');
      assert.equal(r.pluginPaths.length, 0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('local .claude-plugin/plugin.json with name "cap-pro" IS a CAP footprint', () => {
    const home = tmp('cap-local-rightname-');
    const cwd = tmp('cap-cwd-rn-');
    try {
      fs.mkdirSync(path.join(cwd, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'cap-pro', version: '1.0.0' }));
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, true);
      assert.ok(r.pluginPaths.some(p => p.endsWith(path.join('.claude-plugin', 'plugin.json'))));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('local .claude-plugin/plugin.json with legacy name "cap" is also a CAP footprint (backward compat)', () => {
    const home = tmp('cap-local-legacy-');
    const cwd = tmp('cap-cwd-legacy-');
    try {
      fs.mkdirSync(path.join(cwd, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'cap', version: '7.0.0' }));
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.plugin, true, 'legacy plugin name "cap" still counts as a CAP footprint');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('npx footprint dir exists but is empty → still counts as npx (existence-based)', () => {
    // The installer populates $HOME/.claude/cap/ but even a bare dir is evidence of prior install
    const home = tmp('cap-empty-npx-');
    const cwd = tmp('cap-cwd-');
    try {
      fs.mkdirSync(path.join(home, '.claude', 'cap'), { recursive: true });
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.npx, true);
      assert.equal(r.active, 'npx');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('symlinked $HOME/.claude/cap dir is detected the same as a regular dir', () => {
    const home = tmp('cap-symlink-home-');
    const target = tmp('cap-symlink-target-');
    const cwd = tmp('cap-cwd-');
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      // Link $HOME/.claude/cap → target
      try {
        fs.symlinkSync(target, path.join(home, '.claude', 'cap'), 'dir');
      } catch (e) {
        // Some CI / Windows runs disallow symlinks — skip assertion gracefully
        if (e.code === 'EPERM' || e.code === 'EACCES') {
          return;
        }
        throw e;
      }
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.npx, true, 'symlinked npx dir must still count as npx');
      assert.equal(r.active, 'npx');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('never throws when HOME dir itself does not exist', () => {
    // Edge: homeDir points to a path that simply does not exist.
    const nonexistent = path.join(os.tmpdir(), 'cap-no-such-home-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const cwd = tmp('cap-cwd-');
    try {
      assert.equal(fs.existsSync(nonexistent), false, 'precondition: path must not exist');
      let r;
      assert.doesNotThrow(() => {
        r = detectInstallMode({ homeDir: nonexistent, cwd });
      }, 'missing home must not crash');
      assert.equal(r.npx, false);
      assert.equal(r.plugin, false);
      assert.equal(r.active, 'none');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('coexist flag is strictly (npx AND plugin), never just one of them', () => {
    // Pin this invariant: coexist implies both booleans are true
    const cwd = tmp('cap-cwd-');
    const npxOnlyHome = tmp('cap-npx-only-');
    const pluginOnlyHome = tmp('cap-plugin-only-');
    try {
      fs.mkdirSync(path.join(npxOnlyHome, '.claude', 'cap'), { recursive: true });
      fs.mkdirSync(path.join(pluginOnlyHome, '.claude', 'plugins', 'cache', 'cap@x'), { recursive: true });

      const rNpx = detectInstallMode({ homeDir: npxOnlyHome, cwd });
      assert.equal(rNpx.coexist, false);
      assert.equal(rNpx.active, 'npx');

      const rPlug = detectInstallMode({ homeDir: pluginOnlyHome, cwd });
      assert.equal(rPlug.coexist, false);
      assert.equal(rPlug.active, 'plugin');
    } finally {
      fs.rmSync(npxOnlyHome, { recursive: true, force: true });
      fs.rmSync(pluginOnlyHome, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('npxPath is absent in returned report when npx footprint is not present', () => {
    const home = tmp('cap-no-npx-');
    const cwd = tmp('cap-cwd-');
    try {
      const r = detectInstallMode({ homeDir: home, cwd });
      assert.equal(r.npx, false);
      // npxPath should be undefined (not an empty string) when absent
      assert.equal(r.npxPath, undefined,
        'npxPath must be undefined when npx footprint is absent');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('works with zero opts — reads from process.env.HOME / os.homedir() without crashing', () => {
    // Pin the default-path code branch — must not throw even on untouched call.
    let r;
    assert.doesNotThrow(() => {
      r = detectInstallMode();
    });
    assert.equal(typeof r.npx, 'boolean');
    assert.equal(typeof r.plugin, 'boolean');
    assert.equal(typeof r.active, 'string');
    assert.ok(Array.isArray(r.warnings));
  });
});

// ---------------------------------------------------------------------------
// Coexistence formatReport edges (AC-6)
// ---------------------------------------------------------------------------
describe('formatReport coexistence edges (AC-6)', () => {
  function baseReport() {
    return {
      tools: [{ name: 'Node.js', ok: true, version: '20', required: true, purpose: '', installHint: '' }],
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
    };
  }

  it('npx-only report renders "npx (primary)" with NO coexistence warning', () => {
    const rep = baseReport();
    rep.installMode = { npx: true, plugin: false, coexist: false, active: 'npx', pluginPaths: [], npxPath: '/npx', warnings: [] };
    const out = formatReport(rep);
    assert.match(out, /Install mode:/);
    assert.match(out, /npx \(primary\)/);
    assert.equal(/coexistence/i.test(out), false,
      'npx-only must NOT render a coexistence warning');
  });

  it('plugin-only report renders "plugin" with NO coexistence warning', () => {
    const rep = baseReport();
    rep.installMode = { npx: false, plugin: true, coexist: false, active: 'plugin', pluginPaths: ['/p'], warnings: [] };
    const out = formatReport(rep);
    assert.match(out, /plugin/);
    assert.equal(/coexistence/i.test(out), false);
    assert.equal(/npx \(primary\)/.test(out), false);
  });

  it('active:"none" renders "none detected" and no install-mode warning', () => {
    const rep = baseReport();
    rep.installMode = { npx: false, plugin: false, coexist: false, active: 'none', pluginPaths: [], warnings: [] };
    const out = formatReport(rep);
    assert.match(out, /none detected/);
    assert.equal(/coexistence/i.test(out), false);
  });

  it('coexistence warning text surfaces verbatim in the rendered report', () => {
    const rep = baseReport();
    const warning = 'Both npx and plugin install modes are active. A B C.';
    rep.installMode = { npx: true, plugin: true, coexist: true, active: 'both', pluginPaths: ['/p'], npxPath: '/n', warnings: [warning] };
    const out = formatReport(rep);
    // Must include both the mode line and the full warning
    assert.match(out, /npx \(primary\) \+ plugin/);
    assert.ok(out.includes(warning), 'full warning text must be rendered');
  });

  it('coexistence does NOT flip healthy to false even with many warnings', () => {
    const rep = baseReport();
    rep.installMode = {
      npx: true, plugin: true, coexist: true, active: 'both', pluginPaths: ['/p'], npxPath: '/n',
      warnings: ['w1', 'w2', 'w3'],
    };
    rep.healthy = true;
    const out = formatReport(rep);
    assert.equal(out.includes('UNHEALTHY'), false,
      'coexistence (even with multiple warnings) must not cause UNHEALTHY status');
  });

  it('runDoctor() always returns installMode with required shape', () => {
    const r = runDoctor();
    assert.ok(r.installMode);
    assert.equal(typeof r.installMode.npx, 'boolean');
    assert.equal(typeof r.installMode.plugin, 'boolean');
    assert.equal(typeof r.installMode.coexist, 'boolean');
    assert.equal(typeof r.installMode.active, 'string');
    assert.ok(['npx', 'plugin', 'both', 'none'].includes(r.installMode.active),
      `active value "${r.installMode.active}" must be one of the allowed enum`);
    assert.ok(Array.isArray(r.installMode.pluginPaths));
    assert.ok(Array.isArray(r.installMode.warnings));
  });
});

// ---------------------------------------------------------------------------
// Npx path intact (AC-4) — deeper invariants
// ---------------------------------------------------------------------------
describe('npx install path — deeper invariants (AC-4)', () => {
  it('files[] still contains all historic entries (bin, commands, cap, agents, hooks/dist, scripts)', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    for (const required of ['bin', 'commands', 'cap', 'agents', 'hooks/dist', 'scripts']) {
      assert.ok(pkg.files.includes(required),
        `package.json files[] must still include "${required}" — removal would break npx install`);
    }
  });

  it('files[] contains the new plugin entries (.claude-plugin, hooks/hooks.json)', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.ok(pkg.files.includes('.claude-plugin'),
      'plugin mode requires .claude-plugin/ to be shipped');
    assert.ok(pkg.files.includes('hooks/hooks.json'),
      'plugin mode requires hooks/hooks.json to be shipped');
  });

  it('bin.cap points at an existing executable file (bin/install.js)', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    const binRel = pkg.bin.cap;
    const binAbs = path.join(ROOT, binRel);
    assert.ok(fs.existsSync(binAbs), `bin.cap "${binRel}" must exist on disk`);
    assert.ok(fs.statSync(binAbs).isFile(), 'bin.cap must resolve to a regular file');
  });

  it('bin/install.js passes Node syntax check', () => {
    // Parse via vm.Script to validate syntax without executing side effects.
    const src = fs.readFileSync(INSTALL_JS, 'utf8');
    assert.ok(src.length > 0, 'install.js must not be empty');
    const vm = require('node:vm');
    assert.doesNotThrow(() => {
      new vm.Script(src, { filename: 'bin/install.js' });
    }, 'bin/install.js must parse as valid JavaScript');
  });

  it('package.json has no "deprecated" or breaking top-level changes', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(pkg.deprecated, undefined);
    assert.equal(pkg.private, undefined, 'package must publish (no private:true)');
    assert.equal(typeof pkg.name, 'string');
    assert.equal(typeof pkg.version, 'string');
  });

  it('package.json version agrees with plugin.json version (no drift)', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    const plug = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.equal(pkg.version, plug.version,
      `package.json version (${pkg.version}) must match plugin.json version (${plug.version})`);
  });
});

// ---------------------------------------------------------------------------
// Cross-manifest consistency
// ---------------------------------------------------------------------------
describe('Cross-manifest consistency', () => {
  it('plugin.json name, package.json name, and marketplace plugin entry name align (CAP Pro 1.0)', () => {
    const plug = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    const mp = JSON.parse(fs.readFileSync(MARKETPLACE_MANIFEST, 'utf8'));

    // CAP Pro 1.0: all three names are unified to "cap-pro".
    assert.equal(plug.name, 'cap-pro');
    assert.equal(pkg.name, 'cap-pro');
    assert.equal(mp.name, pkg.name,
      'marketplace.name should equal the npm package name for a consistent published surface');
    // marketplace entry name aligns with plugin.json name
    const entry = mp.plugins.find(p => p.name === plug.name);
    assert.ok(entry, 'marketplace must list an entry matching plugin.json name');
  });

  it('plugin.json homepage and repository point to the same github org/repo', () => {
    const plug = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    assert.match(plug.homepage, /github\.com\/[^/]+\/[^/]+/);
    assert.match(plug.repository, /github\.com\/[^/]+\/[^/]+/);
    // Extract "org/repo" tokens and compare
    const homeMatch = plug.homepage.match(/github\.com\/([^/]+\/[^/]+)/);
    const repoMatch = plug.repository.match(/github\.com\/([^/]+\/[^/]+)/);
    assert.ok(homeMatch && repoMatch);
    assert.equal(homeMatch[1].replace(/\.git$/, ''), repoMatch[1].replace(/\.git$/, ''),
      'homepage and repository must reference the same org/repo');
  });

  it('plugin.json license matches package.json license', () => {
    const plug = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.equal(plug.license, pkg.license,
      'license must be identical across manifests');
  });
});
