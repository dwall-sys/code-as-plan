/**
 * GSD Agent Frontmatter Tests
 *
 * Validates that all agent .md files have correct frontmatter fields:
 * - Anti-heredoc instruction present in file-writing agents
 * - skills: field absent from all agents (breaks Gemini CLI)
 * - Commented hooks: pattern in file-writing agents
 * - Spawn type consistency across workflows
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const WORKFLOWS_DIR = path.join(__dirname, '..', 'cap', 'workflows');
const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'cap');

const ALL_AGENTS = fs.readdirSync(AGENTS_DIR)
  .filter(f => f.startsWith('cap-') && f.endsWith('.md'))
  .map(f => f.replace('.md', ''));

const FILE_WRITING_AGENTS = ALL_AGENTS.filter(name => {
  const content = fs.readFileSync(path.join(AGENTS_DIR, name + '.md'), 'utf-8');
  const toolsMatch = content.match(/^tools:\s*(.+)$/m);
  return toolsMatch && toolsMatch[1].includes('Write');
});

const READ_ONLY_AGENTS = ALL_AGENTS.filter(name => !FILE_WRITING_AGENTS.includes(name));

// ─── Anti-Heredoc Instruction ────────────────────────────────────────────────

describe('HDOC: no active heredoc patterns', () => {
  test('no active heredoc patterns in any agent file', () => {
    for (const agent of ALL_AGENTS) {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('never use') || line.includes('NEVER') || line.trim().startsWith('```')) continue;
        if (/^cat\s+<<\s*'?EOF'?\s*>/.test(line.trim())) {
          assert.fail(`${agent}:${i + 1} has active heredoc pattern: ${line.trim()}`);
        }
      }
    }
  });
});

// ─── Skills Frontmatter ──────────────────────────────────────────────────────

describe('SKILL: skills frontmatter absent', () => {
  for (const agent of ALL_AGENTS) {
    test(`${agent} does not have skills: in frontmatter`, () => {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
      const frontmatter = content.split('---')[1] || '';
      assert.ok(
        !frontmatter.includes('skills:'),
        `${agent} has skills: in frontmatter — skills: breaks Gemini CLI and must be removed`
      );
    });
  }
});

// ─── Hooks Frontmatter ───────────────────────────────────────────────────────

describe('HOOK: agents have valid frontmatter', () => {
  // CAP agents don't require commented hooks: pattern (GSD legacy convention).
  // Just verify they have valid frontmatter with name field.
  for (const agent of ALL_AGENTS) {
    test(`${agent} has valid frontmatter`, () => {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
      const frontmatter = content.split('---')[1] || '';
      assert.ok(frontmatter.includes('name:'), `${agent} has valid frontmatter with name:`);
    });
  }
});

// ─── Spawn Type Consistency ──────────────────────────────────────────────────

describe('SPAWN: spawn type consistency', () => {
  test('no "First, read agent .md" workaround pattern remains', () => {
    const dirs = [WORKFLOWS_DIR, COMMANDS_DIR];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const hasWorkaround = content.includes('First, read ~/.claude/agents/gsd-');
        assert.ok(
          !hasWorkaround,
          `${file} still has "First, read agent .md" workaround — use named subagent_type instead`
        );
      }
    }
  });

  test('named agent spawns use correct agent names', () => {
    // Legacy GSD agent names still referenced in workflows that haven't been migrated yet.
    // These are allowed until full workflow migration is complete.
    const LEGACY_GSD_AGENTS = [
      'gsd-planner', 'gsd-roadmapper', 'gsd-executor', 'gsd-phase-researcher',
      'gsd-project-researcher', 'gsd-research-synthesizer', 'gsd-debugger',
      'gsd-codebase-mapper', 'gsd-verifier', 'gsd-plan-checker',
      'gsd-integration-checker', 'gsd-nyquist-auditor', 'gsd-ui-researcher',
      'gsd-ui-checker', 'gsd-ui-auditor', 'gsd-assumptions-analyzer',
    ];
    const validAgentTypes = new Set([
      ...ALL_AGENTS,
      ...LEGACY_GSD_AGENTS,
      'general-purpose',  // Allowed for orchestrator spawns
    ]);

    const dirs = [WORKFLOWS_DIR, COMMANDS_DIR];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const matches = content.matchAll(/subagent_type="([^"]+)"/g);
        for (const match of matches) {
          const agentType = match[1];
          assert.ok(
            validAgentTypes.has(agentType),
            `${file} references unknown agent type: ${agentType}`
          );
        }
      }
    }
  });

  test('diagnose-issues uses cap-debugger (not general-purpose)', () => {
    const content = fs.readFileSync(
      path.join(WORKFLOWS_DIR, 'diagnose-issues.md'), 'utf-8'
    );
    assert.ok(
      content.includes('subagent_type="cap-debugger"'),
      'diagnose-issues should spawn cap-debugger, not general-purpose'
    );
  });

  test('workflows spawning named agents have <available_agent_types> listing (#1357)', () => {
    // After /clear, Claude Code re-reads workflow instructions but loses agent
    // context. Without an <available_agent_types> section, the orchestrator may
    // fall back to general-purpose, silently breaking agent capabilities.
    // PR #1139 added this to plan-phase and execute-phase but missed all other
    // workflows that spawn named GSD agents.
    const dirs = [WORKFLOWS_DIR, COMMANDS_DIR];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        // Find all named subagent_type references (excluding general-purpose)
        const matches = [...content.matchAll(/subagent_type="([^"]+)"/g)];
        const namedAgents = matches
          .map(m => m[1])
          .filter(t => t !== 'general-purpose');

        if (namedAgents.length === 0) continue;

        // Workflow spawns named agents — must have <available_agent_types>
        assert.ok(
          content.includes('<available_agent_types>'),
          `${file} spawns named agents (${[...new Set(namedAgents)].join(', ')}) ` +
          `but has no <available_agent_types> section — after /clear, the ` +
          `orchestrator may fall back to general-purpose (#1357)`
        );

        // Every spawned agent type must appear in the listing
        for (const agent of new Set(namedAgents)) {
          const agentTypesMatch = content.match(
            /<available_agent_types>([\s\S]*?)<\/available_agent_types>/
          );
          assert.ok(
            agentTypesMatch,
            `${file} has malformed <available_agent_types> section`
          );
          assert.ok(
            agentTypesMatch[1].includes(agent),
            `${file} spawns ${agent} but does not list it in <available_agent_types>`
          );
        }
      }
    }
  });

  test('execute-phase has Copilot sequential fallback in runtime_compatibility', () => {
    const content = fs.readFileSync(
      path.join(WORKFLOWS_DIR, 'execute-phase.md'), 'utf-8'
    );
    assert.ok(
      content.includes('sequential inline execution'),
      'execute-phase must document sequential inline execution as Copilot fallback'
    );
    assert.ok(
      content.includes('spot-check'),
      'execute-phase must have spot-check fallback for completion detection'
    );
  });
});

// ─── Required Frontmatter Fields ─────────────────────────────────────────────

describe('AGENT: required frontmatter fields', () => {
  for (const agent of ALL_AGENTS) {
    test(`${agent} has name, description, tools, color`, () => {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
      const frontmatter = content.split('---')[1] || '';
      assert.ok(frontmatter.includes('name:'), `${agent} missing name:`);
      assert.ok(frontmatter.includes('description:'), `${agent} missing description:`);
      assert.ok(frontmatter.includes('tools:'), `${agent} missing tools:`);
      assert.ok(frontmatter.includes('color:'), `${agent} missing color:`);
    });
  }
});

// ─── CLAUDE.md Compliance ───────────────────────────────────────────────────
// NOTE: gsd-plan-checker, gsd-phase-researcher, gsd-executor, and gsd-verifier
// were removed during the GSD→CAP migration. These agents no longer exist.
// CLAUDEMD and VERIFY test sections removed — no CAP equivalent agents.

// ─── Discussion Log ──────────────────────────────────────────────────────────

describe('DISCUSS: discussion log generation', () => {
  test('discuss-phase workflow references DISCUSSION-LOG.md generation', () => {
    const content = fs.readFileSync(
      path.join(WORKFLOWS_DIR, 'discuss-phase.md'), 'utf-8'
    );
    assert.ok(
      content.includes('DISCUSSION-LOG.md'),
      'discuss-phase must reference DISCUSSION-LOG.md generation'
    );
    assert.ok(
      content.includes('Audit trail only'),
      'discuss-phase must mark discussion log as audit-only'
    );
  });

  test('discussion-log template exists', () => {
    const templatePath = path.join(__dirname, '..', 'cap', 'templates', 'discussion-log.md');
    assert.ok(
      fs.existsSync(templatePath),
      'discussion-log.md template must exist'
    );
    const content = fs.readFileSync(templatePath, 'utf-8');
    assert.ok(
      content.includes('Do not use as input to planning'),
      'template must contain audit-only notice'
    );
  });
});

// ─── Worktree Permission Mode (#1334) ───────────────────────────────────────

describe('PERM: worktree agents have permissionMode: acceptEdits', () => {
  // Agents spawned with isolation="worktree" need permissionMode: acceptEdits
  // to avoid per-directory edit permission prompts in the worktree path.
  // See: anthropics/claude-code#29110, anthropics/claude-code#28041
  const CAP_WORKTREE_AGENTS = ['cap-prototyper', 'cap-debugger'];
  // Legacy GSD agents still referenced in un-migrated workflows
  const LEGACY_WORKTREE_AGENTS = ['gsd-executor', 'gsd-debugger'];
  const ALL_WORKTREE_AGENTS = [...CAP_WORKTREE_AGENTS, ...LEGACY_WORKTREE_AGENTS];

  for (const agent of CAP_WORKTREE_AGENTS) {
    test(`${agent} has permissionMode: acceptEdits`, () => {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agent + '.md'), 'utf-8');
      const frontmatter = content.split('---')[1] || '';
      assert.ok(
        frontmatter.includes('permissionMode: acceptEdits'),
        `${agent} must have permissionMode: acceptEdits — worktree agents need this to avoid ` +
        `per-directory edit permission prompts (see #1334)`
      );
    });
  }

  test('worktree-spawned agents are covered', () => {
    const dirs = [WORKFLOWS_DIR, COMMANDS_DIR];
    const worktreeAgentTypes = new Set();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const taskBlocks = content.match(/Task\([^)]*isolation="worktree"[^)]*\)/gs) || [];
        for (const block of taskBlocks) {
          const typeMatch = block.match(/subagent_type="([^"]+)"/);
          if (typeMatch) {
            worktreeAgentTypes.add(typeMatch[1]);
          }
        }
      }
    }

    for (const agentType of worktreeAgentTypes) {
      assert.ok(
        ALL_WORKTREE_AGENTS.includes(agentType),
        `${agentType} is spawned with isolation="worktree" but not in WORKTREE_AGENTS list — ` +
        `add permissionMode: acceptEdits to its frontmatter and update this test`
      );
    }
  });
});
