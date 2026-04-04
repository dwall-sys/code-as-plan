/**
 * Execute-phase wave filter tests
 *
 * Validates the /gsd:execute-phase --wave feature contract:
 * - Command frontmatter advertises --wave
 * - Workflow parses WAVE_FILTER
 * - Workflow enforces lower-wave safety
 * - Partial wave runs do not mark the phase complete
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'cap', 'workflows', 'execute-phase.md');
const COMMANDS_DOC_PATH = path.join(__dirname, '..', 'docs', 'COMMANDS.md');
const HELP_PATH = path.join(__dirname, '..', 'cap', 'workflows', 'help.md');

// NOTE: commands/gsd/execute-phase.md was removed during GSD→CAP migration.
// Command-level tests removed; workflow tests below still apply.

describe('execute-phase workflow: wave filtering', () => {
  test('workflow file exists', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'workflows/execute-phase.md should exist');
  });

  test('workflow parses WAVE_FILTER from arguments', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(content.includes('WAVE_FILTER'), 'workflow should reference WAVE_FILTER');
    assert.ok(content.includes('Optional `--wave N`'), 'workflow should parse --wave N');
  });

  test('workflow enforces lower-wave safety', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      content.includes('Wave safety check'),
      'workflow should contain a wave safety check section'
    );
    assert.ok(
      content.includes('finish earlier waves first'),
      'workflow should block later-wave execution when lower waves are incomplete'
    );
  });

  test('workflow has partial-wave completion guardrail', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      content.includes('<step name="handle_partial_wave_execution">'),
      'workflow should have a partial wave handling step'
    );
    assert.ok(
      content.includes('Do NOT run phase verification'),
      'partial wave step should skip phase verification'
    );
    assert.ok(
      content.includes('Do NOT mark the phase complete'),
      'partial wave step should skip phase completion'
    );
  });
});

describe('execute-phase docs: user-facing wave flag', () => {
  test('COMMANDS.md documents --wave usage', () => {
    const content = fs.readFileSync(COMMANDS_DOC_PATH, 'utf-8');
    assert.ok(content.includes('`--wave N`'), 'COMMANDS.md should mention --wave N');
    assert.ok(
      content.includes('/gsd:execute-phase 1 --wave 2'),
      'COMMANDS.md should include a wave-filter example'
    );
  });

  test('help workflow documents --wave behavior', () => {
    const content = fs.readFileSync(HELP_PATH, 'utf-8');
    assert.ok(
      content.includes('Optional `--wave N` flag executes only Wave `N`'),
      'help.md should describe wave-specific execution'
    );
    assert.ok(
      content.includes('Usage: `/gsd:execute-phase 5 --wave 2`'),
      'help.md should include wave-filter usage'
    );
  });
});
