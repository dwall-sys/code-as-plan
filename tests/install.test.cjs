'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Load installer in test mode
process.env.CAP_TEST_MODE = '1';
const installer = require('../bin/install.js');

describe('install.js — core installer functions', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-install-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getDirName', () => {
    it('should return correct directory names for each runtime', () => {
      assert.strictEqual(installer.getDirName('claude'), '.claude');
      assert.strictEqual(installer.getDirName('opencode'), '.opencode');
      assert.strictEqual(installer.getDirName('gemini'), '.gemini');
      assert.strictEqual(installer.getDirName('codex'), '.codex');
      assert.strictEqual(installer.getDirName('copilot'), '.github');
    });

    it('should default to .claude for unknown runtimes', () => {
      assert.strictEqual(installer.getDirName('unknown'), '.claude');
      assert.strictEqual(installer.getDirName(undefined), '.claude');
    });
  });

  describe('getConfigDirFromHome', () => {
    it('should return quoted directory name for local installs', () => {
      const result = installer.getConfigDirFromHome('claude', false);
      assert.ok(result.includes('.claude'), 'Should contain .claude');
      assert.ok(result.includes("'"), 'Should be quoted');
    });

    it('should return XDG-style path for global OpenCode installs', () => {
      const result = installer.getConfigDirFromHome('opencode', true);
      assert.ok(result.includes('.config'), 'OpenCode global should use .config');
      assert.ok(result.includes('opencode'), 'Should contain opencode');
    });
  });

  describe('yamlIdentifier', () => {
    it('should pass through simple identifiers unchanged', () => {
      assert.strictEqual(installer.yamlIdentifier('Read'), 'Read');
      assert.strictEqual(installer.yamlIdentifier('cap-prototyper'), 'cap-prototyper');
    });

    it('should quote identifiers with special characters', () => {
      const result = installer.yamlIdentifier('Tool With Spaces');
      assert.ok(result.includes("'") || result.includes('"'), 'Should quote special chars');
      assert.ok(result.includes('Tool With Spaces'), 'Should preserve the value');
    });
  });

  describe('validateHookFields', () => {
    it('should return settings unchanged when hooks are valid', () => {
      const settings = {
        hooks: {
          PreToolUse: [{
            hooks: [{ type: 'command', command: 'echo test' }],
          }],
        },
      };
      const result = installer.validateHookFields(settings);
      assert.deepStrictEqual(result.hooks.PreToolUse.length, 1);
      assert.deepStrictEqual(result.hooks.PreToolUse[0].hooks[0].command, 'echo test');
    });

    it('should remove entries with missing hooks array', () => {
      const settings = {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'echo test' }] },
            { noHooksKey: true },
          ],
        },
      };
      const result = installer.validateHookFields(settings);
      assert.strictEqual(result.hooks.PreToolUse.length, 1, 'Should remove invalid entry');
      assert.ok(result.hooks.PreToolUse[0].hooks, 'Valid entry should remain');
    });

    it('should remove agent hooks without prompt field', () => {
      const settings = {
        hooks: {
          PostToolUse: [{
            hooks: [
              { type: 'agent' }, // missing prompt — invalid
              { type: 'command', command: 'echo ok' },
            ],
          }],
        },
      };
      const result = installer.validateHookFields(settings);
      assert.strictEqual(result.hooks.PostToolUse[0].hooks.length, 1, 'Should remove agent without prompt');
      assert.strictEqual(result.hooks.PostToolUse[0].hooks[0].type, 'command');
    });

    it('should remove empty event arrays after filtering', () => {
      const settings = {
        hooks: {
          PreToolUse: [{
            hooks: [{ type: 'agent' }], // all invalid — no prompt
          }],
        },
      };
      const result = installer.validateHookFields(settings);
      assert.strictEqual(result.hooks.PreToolUse, undefined, 'Should remove empty event key');
    });

    it('should handle settings without hooks key gracefully', () => {
      const settings = { version: '1.0' };
      const result = installer.validateHookFields(settings);
      assert.strictEqual(result.version, '1.0', 'Should preserve other fields');
      assert.strictEqual(result.hooks, undefined, 'Should not add hooks key');
    });
  });

  describe('neutralizeAgentReferences', () => {
    it('should replace standalone "Claude" with "the agent"', () => {
      const result = installer.neutralizeAgentReferences('Ask Claude for help.', null);
      assert.ok(result.includes('the agent'), 'Should replace Claude with the agent');
      assert.ok(!result.includes('Ask Claude'), 'Should not keep standalone Claude');
    });

    it('should preserve product names like Claude Code and Claude Opus', () => {
      const input = 'Use Claude Code. Model: Claude Opus. Ask Claude for guidance.';
      const result = installer.neutralizeAgentReferences(input, null);
      assert.ok(result.includes('Claude Code'), 'Should preserve Claude Code');
      assert.ok(result.includes('Claude Opus'), 'Should preserve Claude Opus');
    });

    it('should replace CLAUDE.md with runtime instruction file when provided', () => {
      const result = installer.neutralizeAgentReferences(
        'See CLAUDE.md for instructions.',
        'GEMINI.md'
      );
      assert.ok(result.includes('GEMINI.md'), 'Should replace CLAUDE.md with GEMINI.md');
      assert.ok(!result.includes('CLAUDE.md'), 'Should not keep CLAUDE.md');
    });
  });

  describe('claudeToCopilotTools mapping', () => {
    it('should have mappings for core Claude Code tools', () => {
      assert.strictEqual(installer.claudeToCopilotTools.Read, 'read');
      assert.strictEqual(installer.claudeToCopilotTools.Write, 'edit');
      assert.strictEqual(installer.claudeToCopilotTools.Bash, 'execute');
      assert.strictEqual(installer.claudeToCopilotTools.Grep, 'search');
      assert.strictEqual(installer.claudeToCopilotTools.Task, 'agent');
    });

    it('should map Edit to edit (same as Write)', () => {
      assert.strictEqual(installer.claudeToCopilotTools.Edit, 'edit');
      assert.strictEqual(installer.claudeToCopilotTools.Edit, installer.claudeToCopilotTools.Write);
    });
  });
});
