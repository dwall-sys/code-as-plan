/**
 * Discuss Mode Config Tests
 *
 * Validates workflow.discuss_mode config, routing, and assumptions workflow integration.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('workflow.discuss_mode config', () => {
  test('config template includes discuss_mode default', () => {
    const template = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'cap', 'templates', 'config.json'), 'utf8')
    );
    assert.strictEqual(template.workflow.discuss_mode, 'discuss');
  });

  // NOTE: commands/gsd/discuss-phase.md was removed during GSD→CAP migration.
  // These tests are skipped — the discuss-phase command does not exist in commands/cap/.

  test('assumptions workflow file exists and has required steps', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'discuss-phase-assumptions.md'), 'utf8'
    );
    const requiredSteps = [
      'initialize', 'check_existing', 'load_prior_context',
      'deep_codebase_analysis', 'present_assumptions', 'correct_assumptions',
      'write_context', 'write_discussion_log', 'auto_advance'
    ];
    for (const step of requiredSteps) {
      assert.ok(workflow.includes(`<step name="${step}"`), `missing step: ${step}`);
    }
  });

  test('assumptions workflow produces same CONTEXT.md sections', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'discuss-phase-assumptions.md'), 'utf8'
    );
    const sections = ['<domain>', '<decisions>', '<canonical_refs>', '<code_context>', '<specifics>', '<deferred>'];
    for (const section of sections) {
      assert.ok(workflow.includes(section), `missing CONTEXT.md section: ${section}`);
    }
  });

  test('plan-phase gate references discuss_mode config', () => {
    const planPhase = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'plan-phase.md'), 'utf8'
    );
    assert.ok(planPhase.includes('workflow.discuss_mode'), 'should reference config key');
    assert.ok(planPhase.includes('assumptions mode'), 'should mention assumptions mode');
  });

  test('assumptions workflow handles --auto flag', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'discuss-phase-assumptions.md'), 'utf8'
    );
    assert.ok(workflow.includes('--auto'), 'should handle --auto');
    assert.ok(workflow.includes('auto-select'), 'should auto-select in --auto mode');
    assert.ok(workflow.includes('auto_advance'), 'should support auto_advance');
  });

  test('assumptions workflow handles --text flag', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'discuss-phase-assumptions.md'), 'utf8'
    );
    assert.ok(workflow.includes('text_mode'), 'should reference text_mode config');
    assert.ok(workflow.includes('--text'), 'should handle --text flag');
  });

  test('plan-phase workflow references text_mode', () => {
    const planPhase = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'plan-phase.md'), 'utf8'
    );
    assert.ok(planPhase.includes('text_mode'), 'plan-phase workflow should reference text_mode');
    assert.ok(planPhase.includes('TEXT_MODE'), 'plan-phase workflow should use TEXT_MODE variable');
    assert.ok(planPhase.includes('--text'), 'plan-phase workflow should handle --text flag');
  });

  // NOTE: commands/gsd/plan-phase.md was removed during GSD→CAP migration.
  // plan-phase command test skipped.

  test('plan-phase init exposes text_mode in workflow flags', () => {
    const initSrc = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'bin', 'lib', 'init.cjs'), 'utf8'
    );
    // The cmdInitPlanPhase result object must include text_mode
    const planPhaseBlock = initSrc.slice(initSrc.indexOf('function cmdInitPlanPhase'));
    assert.ok(planPhaseBlock.includes('text_mode: config.text_mode'), 'init plan-phase must expose text_mode');
  });

  test('progress workflow references discuss_mode', () => {
    const progress = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'workflows', 'progress.md'), 'utf8'
    );
    assert.ok(progress.includes('workflow.discuss_mode'), 'should read discuss_mode config');
    assert.ok(progress.includes('Discuss mode'), 'should display discuss mode');
  });

  test('documentation file exists', () => {
    const docPath = path.join(__dirname, '..', 'docs', 'workflow-discuss-mode.md');
    assert.ok(fs.existsSync(docPath), 'docs/workflow-discuss-mode.md should exist');
    const doc = fs.readFileSync(docPath, 'utf8');
    assert.ok(doc.includes('assumptions'), 'doc should mention assumptions');
    assert.ok(doc.includes('discuss'), 'doc should mention discuss');
    assert.ok(doc.includes('config-set'), 'doc should show how to configure');
  });
});
