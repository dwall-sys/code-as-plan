// @cap-feature(feature:F-092) Two-phase workflow — quickMode session state + changed-files compute

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const session = require('../cap/bin/lib/cap-session.cjs');

function setupGitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f092-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email test@example.com', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  // Initial commit so we have a HEAD to snapshot against
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Test\n');
  execSync('git add README.md', { cwd: tmp });
  execSync('git commit -q -m "initial"', { cwd: tmp });
  // Initialize CAP
  session.initCapDirectory(tmp);
  return tmp;
}

function teardown(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

describe('F-092 quickMode default state', () => {
  it('default session has quickMode { active: false, ... }', () => {
    const def = session.getDefaultSession();
    assert.equal(def.quickMode.active, false);
    assert.equal(def.quickMode.feature, null);
    assert.equal(def.quickMode.startedAt, null);
    assert.equal(def.quickMode.startCommit, null);
  });

  it('isQuickModeActive returns false on a fresh project', () => {
    const tmp = setupGitRepo();
    try {
      assert.equal(session.isQuickModeActive(tmp), false);
    } finally {
      teardown(tmp);
    }
  });
});

describe('F-092 startQuickMode', () => {
  it('sets quickMode.active and captures the current git HEAD as startCommit', () => {
    const tmp = setupGitRepo();
    try {
      const headSha = execSync('git rev-parse HEAD', { cwd: tmp }).toString().trim();
      const updated = session.startQuickMode(tmp, 'F-Hub-Spotlight-Carousel');
      assert.equal(updated.quickMode.active, true);
      assert.equal(updated.quickMode.feature, 'F-Hub-Spotlight-Carousel');
      assert.equal(updated.quickMode.startCommit, headSha);
      assert.ok(updated.quickMode.startedAt, 'startedAt should be set');
      assert.equal(updated.activeFeature, 'F-Hub-Spotlight-Carousel');
    } finally {
      teardown(tmp);
    }
  });

  it('non-git directory: startCommit is null but quickMode still activates', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f092-nogit-'));
    try {
      session.initCapDirectory(tmp);
      const updated = session.startQuickMode(tmp, 'F-001');
      assert.equal(updated.quickMode.active, true);
      assert.equal(updated.quickMode.startCommit, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('isQuickModeActive returns true after startQuickMode', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');
      assert.equal(session.isQuickModeActive(tmp), true);
    } finally {
      teardown(tmp);
    }
  });
});

describe('F-092 endQuickMode', () => {
  it('clears quickMode state', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');
      const updated = session.endQuickMode(tmp);
      assert.equal(updated.quickMode.active, false);
      assert.equal(updated.quickMode.feature, null);
      assert.equal(updated.quickMode.startCommit, null);
    } finally {
      teardown(tmp);
    }
  });

  it('does NOT clear activeFeature (that\'s the user\'s explicit selection)', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-Hub-Spotlight');
      const updated = session.endQuickMode(tmp);
      assert.equal(updated.activeFeature, 'F-Hub-Spotlight');
    } finally {
      teardown(tmp);
    }
  });
});

describe('F-092 getChangedFilesSinceQuickStart', () => {
  it('returns committed + unstaged + untracked files since quick-start', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');

      // Committed change (mid-quick)
      fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;\n');
      execSync('git add a.ts', { cwd: tmp });
      execSync('git commit -q -m "add a"', { cwd: tmp });

      // Unstaged modification
      fs.writeFileSync(path.join(tmp, 'README.md'), '# Test (modified)\n');

      // Untracked file
      fs.writeFileSync(path.join(tmp, 'c.ts'), 'export const c = 3;\n');

      const result = session.getChangedFilesSinceQuickStart(tmp);
      assert.ok(result.files.includes('a.ts'), 'committed change');
      assert.ok(result.files.includes('README.md'), 'unstaged change');
      assert.ok(result.files.includes('c.ts'), 'untracked new file');
      assert.equal(result.error, undefined);
    } finally {
      teardown(tmp);
    }
  });

  it('excludes generated artifacts (.cap/, node_modules/, dist/, build/, .git/)', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');
      fs.mkdirSync(path.join(tmp, 'dist'));
      fs.writeFileSync(path.join(tmp, 'dist', 'bundle.js'), 'compiled\n');
      fs.writeFileSync(path.join(tmp, 'src.ts'), 'source\n');
      const result = session.getChangedFilesSinceQuickStart(tmp);
      assert.ok(result.files.includes('src.ts'));
      assert.ok(!result.files.some(f => f.startsWith('dist/')), 'dist/ should be excluded');
    } finally {
      teardown(tmp);
    }
  });

  it('deduplicates files modified across multiple cycles (committed + then re-edited)', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');
      fs.writeFileSync(path.join(tmp, 'a.ts'), 'v1\n');
      execSync('git add a.ts', { cwd: tmp });
      execSync('git commit -q -m "v1"', { cwd: tmp });
      // Re-edit same file (now unstaged)
      fs.writeFileSync(path.join(tmp, 'a.ts'), 'v2\n');
      const result = session.getChangedFilesSinceQuickStart(tmp);
      assert.equal(result.files.filter(f => f === 'a.ts').length, 1, 'a.ts should appear exactly once');
    } finally {
      teardown(tmp);
    }
  });

  it('startCommit null (non-git or skipped) → returns only unstaged + untracked', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f092-noinit-'));
    try {
      session.initCapDirectory(tmp);
      // No git init
      session.startQuickMode(tmp, 'F-001');
      // Will fail to read git, returns error in result
      const result = session.getChangedFilesSinceQuickStart(tmp);
      // startCommit is null since not a git repo
      assert.equal(result.startCommit, null);
      // Either error is set or files is empty
      assert.ok(result.error !== undefined || result.files.length === 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns sorted file list for deterministic output', () => {
    const tmp = setupGitRepo();
    try {
      session.startQuickMode(tmp, 'F-001');
      fs.writeFileSync(path.join(tmp, 'zzz.ts'), 'z\n');
      fs.writeFileSync(path.join(tmp, 'aaa.ts'), 'a\n');
      fs.writeFileSync(path.join(tmp, 'mmm.ts'), 'm\n');
      const result = session.getChangedFilesSinceQuickStart(tmp);
      const sorted = [...result.files].sort();
      assert.deepEqual(result.files, sorted);
    } finally {
      teardown(tmp);
    }
  });
});

describe('F-092 backwards compat — pre-F-092 SESSION.json without quickMode', () => {
  it('loadSession on legacy SESSION.json fills in quickMode default', () => {
    const tmp = setupGitRepo();
    try {
      // Write a legacy session manually (no quickMode field)
      const legacy = {
        version: '2.0.0',
        activeFeature: 'F-001',
        step: null,
        startedAt: null,
        activeApp: null,
        activeDebugSession: null,
        trustMode: 'A',
        metadata: {},
      };
      fs.writeFileSync(path.join(tmp, '.cap', 'SESSION.json'), JSON.stringify(legacy, null, 2));
      const loaded = session.loadSession(tmp);
      assert.equal(loaded.quickMode.active, false);
      assert.equal(loaded.quickMode.feature, null);
      assert.equal(loaded.activeFeature, 'F-001'); // existing field preserved
    } finally {
      teardown(tmp);
    }
  });
});
