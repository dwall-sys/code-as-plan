'use strict';

// @cap-feature(feature:F-080) End-to-end tests for cap-memory-bridge via spawnSync.
// Mirrors the F-082-iter2 lesson: in-process tests can't always reproduce subprocess /
// hook behaviour, so any AC that touches "what /cap:start prints to a real shell"
// needs a spawnSync gate.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BRIDGE_PATH = path.join(REPO_ROOT, 'cap', 'bin', 'lib', 'cap-memory-bridge.cjs');

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-bridge-e2e-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

/**
 * Build a sandbox with both projectRoot and a fake HOME (passed via env so the spawned
 * Node process picks it up via os.homedir(), which honors $HOME on POSIX).
 */
function makeSandbox() {
  const sandboxRoot = fs.mkdtempSync(path.join(SANDBOX, 'sandbox-'));
  const projectRoot = path.join(sandboxRoot, 'work', 'my-project');
  const fakeHome = path.join(sandboxRoot, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.cap', 'memory'), { recursive: true });
  return { projectRoot, fakeHome, sandboxRoot };
}

/**
 * Compute the slug the spawned Node process will derive (matches getProjectSlug logic).
 */
function deriveSlug(projectRoot) {
  const normalized = path.resolve(projectRoot);
  return normalized.replace(/[/\\]/g, '-');
}

/**
 * Run a small Node script via spawnSync that loads cap-memory-bridge and prints the
 * formatted surface for an active feature.
 */
function runSurface(projectRoot, fakeHome, activeFeature) {
  const code = `
    const bridge = require(${JSON.stringify(BRIDGE_PATH)});
    const surface = bridge.surfaceForFeature(${JSON.stringify(projectRoot)}, ${JSON.stringify(activeFeature)});
    const formatted = bridge.formatSurface(surface);
    if (formatted) process.stdout.write(formatted);
  `;
  return spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome },
  });
}

describe('F-080 E2E: full spawnSync of bridge surface', () => {
  it('with bridge data available, stdout contains "Claude-native erinnert:" + bullets', () => {
    const { projectRoot, fakeHome } = makeSandbox();
    const slug = deriveSlug(projectRoot);
    const claudeNativeDir = path.join(fakeHome, '.claude', 'projects', slug, 'memory');
    fs.mkdirSync(claudeNativeDir, { recursive: true });
    const memoryMd = [
      '- [F-080 Bridge](project_f080_bridge.md) — bridge to claude-native shipped',
      '- [F-079 Snapshots](project_f079_snapshots.md) — snapshot linkage',
      '- [V6 Foundation](project_v6_foundation.md) — F-076+F-077+F-078',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'), memoryMd, 'utf8');
    fs.writeFileSync(path.join(claudeNativeDir, 'project_f080_bridge.md'), '---\nname: x\ntype: project\n---\n', 'utf8');
    fs.writeFileSync(path.join(claudeNativeDir, 'project_f079_snapshots.md'), '---\nname: y\ntype: project\n---\n', 'utf8');
    fs.writeFileSync(path.join(claudeNativeDir, 'project_v6_foundation.md'), '---\nname: z\ntype: project\n---\n', 'utf8');

    const result = runSurface(projectRoot, fakeHome, 'F-080');
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stderr, '', 'no stderr');
    assert.match(result.stdout, /Claude-native erinnert:/, 'header line present');
    assert.match(result.stdout, /F-080 Bridge/, 'F-080 bullet present');
  });

  it('with no Claude-native dir, stdout is EMPTY (silent skip)', () => {
    const { projectRoot, fakeHome } = makeSandbox();
    // Do NOT create the claude-native dir.
    const result = runSurface(projectRoot, fakeHome, 'F-080');
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '', 'no stderr on silent skip');
    assert.equal(result.stdout, '', 'no stdout when bridge unavailable');
  });

  it('cache invalidation across two spawnSync calls picks up source changes', () => {
    const { projectRoot, fakeHome } = makeSandbox();
    const slug = deriveSlug(projectRoot);
    const claudeNativeDir = path.join(fakeHome, '.claude', 'projects', slug, 'memory');
    fs.mkdirSync(claudeNativeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'),
      '- [Initial F-080 entry](init.md) — initial\n', 'utf8');
    fs.writeFileSync(path.join(claudeNativeDir, 'init.md'), '---\nname: i\ntype: project\n---\n', 'utf8');

    const r1 = runSurface(projectRoot, fakeHome, 'F-080');
    assert.equal(r1.status, 0);
    assert.match(r1.stdout, /Initial F-080 entry/);
    assert.doesNotMatch(r1.stdout, /Updated F-080 entry/);

    // Modify source between runs. Bump mtime explicitly to defeat 1-second fs resolution.
    fs.writeFileSync(path.join(claudeNativeDir, 'MEMORY.md'),
      '- [Initial F-080 entry](init.md) — initial\n- [Updated F-080 entry](upd.md) — added\n', 'utf8');
    fs.writeFileSync(path.join(claudeNativeDir, 'upd.md'), '---\nname: u\ntype: project\n---\n', 'utf8');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(claudeNativeDir, 'MEMORY.md'), future, future);

    const r2 = runSurface(projectRoot, fakeHome, 'F-080');
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /Initial F-080 entry/);
    assert.match(r2.stdout, /Updated F-080 entry/, 'second run picks up new entry via cache invalidation');
  });
});
