/**
 * GSD Tools Tests - Validate Health Command
 *
 * Comprehensive tests for validate-health covering all 8 health checks
 * and the repair path.
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.6) Migrated 70 runGsdTools spawn
// callsites to direct cmdVerify*/cmdValidate* in-process calls.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers.cjs');
const verify = require('../cap/bin/lib/verify.cjs');

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Returns the same {success, output, error} shape so the
 * existing test bodies need no further changes beyond swapping the call.
 *
 * Pattern follows tests/commands.test.cjs:41-78 runCmd helper (PR #55).
 */
function runCmd(fn) {
  const origWriteSync = fs.writeSync;
  const origExit = process.exit;
  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = 0;

  fs.writeSync = (fd, data, ...rest) => {
    const str = String(data);
    if (fd === 1) { stdout += str; return Buffer.byteLength(str); }
    if (fd === 2) { stderr += str; return Buffer.byteLength(str); }
    return origWriteSync.call(fs, fd, data, ...rest);
  };
  process.exit = (code) => {
    exited = true;
    exitCode = code || 0;
    throw new Error('__CMD_EXIT__');
  };

  let thrown = null;
  try {
    fn();
  } catch (e) {
    if (e && e.message !== '__CMD_EXIT__') thrown = e;
  } finally {
    fs.writeSync = origWriteSync;
    process.exit = origExit;
  }

  if (thrown) {
    return { success: false, output: stdout.trim(), error: (stderr.trim() || thrown.message) };
  }
  if (exited && exitCode !== 0) {
    return { success: false, output: stdout.trim(), error: stderr.trim() };
  }
  return { success: true, output: stdout.trim(), error: null };
}

// ─── Helpers for setting up minimal valid projects ────────────────────────────

function writeMinimalRoadmap(tmpDir, phases = ['1']) {
  const lines = phases.map(n => `### Phase ${n}: Phase ${n} Description`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    `# Roadmap\n\n${lines}\n`
  );
}

function writeMinimalProjectMd(tmpDir, sections = ['## What This Is', '## Core Value', '## Requirements']) {
  const content = sections.map(s => `${s}\n\nContent here.\n`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    `# Project\n\n${content}`
  );
}

function writeMinimalStateMd(tmpDir, content) {
  const defaultContent = content || `# Session State\n\n## Current Position\n\nPhase: 1\n`;
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    defaultContent
  );
}

function writeValidConfigJson(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true }, null, 2)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// validate health command — all 8 checks
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Check 1: .planning/ exists ───────────────────────────────────────────

  test("returns 'broken' when .planning directory is missing", () => {
    // createTempProject creates .planning/phases — remove it entirely
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should be broken');
    assert.ok(
      output.errors.some(e => e.code === 'E001'),
      `Expected E001 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 2: PROJECT.md exists and has required sections ─────────────────

  test('warns when PROJECT.md is missing', () => {
    // No PROJECT.md in .planning
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create valid phase dir so no W007
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E002'),
      `Expected E002 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when PROJECT.md missing required sections', () => {
    // PROJECT.md missing "## Core Value" section
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Project\n\n## What This Is\n\nFoo\n\n## Requirements\n\nBar\n'
    );
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w001s = output.warnings.filter(w => w.code === 'W001');
    assert.ok(w001s.length > 0, `Expected W001 warnings: ${JSON.stringify(output.warnings)}`);
    assert.ok(
      w001s.some(w => w.message.includes('## Core Value')),
      `Expected W001 mentioning "## Core Value": ${JSON.stringify(w001s)}`
    );
  });

  test('passes when PROJECT.md has all required sections', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.errors.some(e => e.code === 'E002'),
      `Should not have E002: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W001'),
      `Should not have W001: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 3: ROADMAP.md exists ───────────────────────────────────────────

  test('errors when ROADMAP.md is missing', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // No ROADMAP.md

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E003'),
      `Expected E003 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 4: STATE.md exists and references valid phases ─────────────────

  test('errors when STATE.md is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No STATE.md

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const e004 = output.errors.find(e => e.code === 'E004');
    assert.ok(e004, `Expected E004 in errors: ${JSON.stringify(output.errors)}`);
    assert.strictEqual(e004.repairable, true, 'E004 should be repairable');
  });

  test('warns when STATE.md references nonexistent phase', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    // STATE.md mentions Phase 99 but only 01-a dir exists
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\nPhase 99 is the current phase.\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w002 = output.warnings.find(w => w.code === 'W002');
    assert.ok(w002, `Expected W002 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w002.repairable, false, 'W002 should not be auto-repairable');
  });

  // ─── Check 5: config.json valid JSON + valid schema ───────────────────────

  test('warns when config.json is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No config.json

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w003 = output.warnings.find(w => w.code === 'W003');
    assert.ok(w003, `Expected W003 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w003.repairable, true, 'W003 should be repairable');
  });

  test('errors when config.json has invalid JSON', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      '{broken json'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E005'),
      `Expected E005 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when config.json has invalid model_profile', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'invalid' })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W004'),
      `Expected W004 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('accepts inherit model_profile as valid', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        model_profile: 'inherit',
        workflow: {
          research: true,
          plan_check: true,
          verifier: true,
          nyquist_validation: true,
        },
      })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W004'),
      `Should not warn for inherit model_profile: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 6: Phase directory naming (NN-name format) ─────────────────────

  test('warns about incorrectly named phase directories', () => {
    writeMinimalProjectMd(tmpDir);
    // Roadmap with no phases to avoid W006
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases yet.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase references.\n');
    writeValidConfigJson(tmpDir);
    // Create a badly named dir
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', 'bad_name'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W005'),
      `Expected W005 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 7: Orphaned plans (PLAN without SUMMARY) ───────────────────────

  test('reports orphaned plans (PLAN without SUMMARY) as info', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create 01-test phase dir with a PLAN but no matching SUMMARY
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    // No 01-01-SUMMARY.md

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.info.some(i => i.code === 'I001'),
      `Expected I001 in info: ${JSON.stringify(output.info)}`
    );
  });

  // ─── Check 8: Consistency (roadmap/disk sync) ─────────────────────────────

  test('warns about phase in ROADMAP but not on disk', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP mentions Phase 5 but no 05-xxx dir
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 5: Future Phase\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // No phase dirs

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W006'),
      `Expected W006 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('warns about phase on disk but not in ROADMAP', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP has no phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // Orphan phase dir not in ROADMAP
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-orphan'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W007'),
      `Expected W007 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 5b: Nyquist validation key presence (W008) ─────────────────────

  test('detects W008 when workflow.nyquist_validation absent from config', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but WITHOUT nyquist_validation key
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W008'),
      `Expected W008 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W008 when nyquist_validation is explicitly set', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow.nyquist_validation explicitly set
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true, nyquist_validation: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W008'),
      `Should not have W008: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 7b: Nyquist VALIDATION.md consistency (W009) ──────────────────

  test('detects W009 when RESEARCH.md has Validation Architecture but no VALIDATION.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with RESEARCH.md containing Validation Architecture
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    // No VALIDATION.md

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W009'),
      `Expected W009 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W009 when VALIDATION.md exists alongside RESEARCH.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with both RESEARCH.md and VALIDATION.md
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-VALIDATION.md'),
      '# Validation\n\nValidation content.\n'
    );

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W009'),
      `Should not have W009: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Overall status ────────────────────────────────────────────────────────

  test("returns 'healthy' when all checks pass", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create valid phase dir matching ROADMAP
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Add PLAN+SUMMARY so no I001
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy', `Expected healthy, got ${output.status}. Errors: ${JSON.stringify(output.errors)}, Warnings: ${JSON.stringify(output.warnings)}`);
    assert.deepStrictEqual(output.errors, [], 'should have no errors');
    assert.deepStrictEqual(output.warnings, [], 'should have no warnings');
  });

  test("returns 'degraded' when only warnings exist", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    // No config.json → W003 (warning, not error)
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'degraded', `Expected degraded, got ${output.status}`);
    assert.strictEqual(output.errors.length, 0, 'should have no errors');
    assert.ok(output.warnings.length > 0, 'should have warnings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --repair command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --repair command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up base project with ROADMAP and PROJECT.md so repairs are triggered
    // (E001, E003 are not repairable so we always need .planning/ and ROADMAP.md)
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with defaults when missing', () => {
    // STATE.md present so no STATE repair; no config.json
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Ensure no config.json
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, { repair: true }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const createAction = output.repairs_performed.find(r => r.action === 'createConfig');
    assert.ok(createAction, `Expected createConfig action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(createAction.success, true, 'createConfig should succeed');

    // Verify config.json now exists on disk with valid JSON and balanced profile
    assert.ok(fs.existsSync(configPath), 'config.json should now exist on disk');
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.model_profile, 'balanced', 'default model_profile should be balanced');
    // Verify nested workflow structure matches config.cjs canonical format
    assert.ok(diskConfig.workflow, 'config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should default to true');
    assert.strictEqual(diskConfig.workflow.plan_check, true, 'workflow.plan_check should default to true');
    assert.strictEqual(diskConfig.workflow.verifier, true, 'workflow.verifier should default to true');
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'workflow.nyquist_validation should default to true');
    // Verify branch templates are present
    assert.strictEqual(diskConfig.phase_branch_template, 'gsd/phase-{phase}-{slug}');
    assert.strictEqual(diskConfig.milestone_branch_template, 'gsd/{milestone}-{slug}');
  });

  test('resets config.json when JSON is invalid', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, '{broken json');

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, { repair: true }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const resetAction = output.repairs_performed.find(r => r.action === 'resetConfig');
    assert.ok(resetAction, `Expected resetConfig action: ${JSON.stringify(output.repairs_performed)}`);

    // Verify config.json is now valid JSON with correct nested structure
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(typeof diskConfig, 'object', 'config.json should be valid JSON after repair');
    assert.notStrictEqual(diskConfig, null, 'config should not be null');
    assert.ok(diskConfig.workflow, 'reset config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should be true after reset');
  });

  test('regenerates STATE.md when missing', () => {
    writeValidConfigJson(tmpDir);
    // No STATE.md
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, { repair: true }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const regenerateAction = output.repairs_performed.find(r => r.action === 'regenerateState');
    assert.ok(regenerateAction, `Expected regenerateState action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(regenerateAction.success, true, 'regenerateState should succeed');

    // Verify STATE.md now exists and contains "# Session State"
    assert.ok(fs.existsSync(statePath), 'STATE.md should now exist on disk');
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.ok(stateContent.includes('# Session State'), 'regenerated STATE.md should contain "# Session State"');
  });

  test('does not rewrite existing STATE.md for invalid phase references', () => {
    writeValidConfigJson(tmpDir);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    const originalContent = '# Session State\n\nPhase 99 is current.\n';
    fs.writeFileSync(
      statePath,
      originalContent
    );

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, { repair: true }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !Array.isArray(output.repairs_performed) || !output.repairs_performed.some(r => r.action === 'regenerateState'),
      `Did not expect regenerateState for W002: ${JSON.stringify(output)}`
    );

    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.strictEqual(stateContent, originalContent, 'existing STATE.md should be preserved');

    const planningDir = path.join(tmpDir, '.planning');
    const planningFiles = fs.readdirSync(planningDir);
    const backupFile = planningFiles.find(f => f.startsWith('STATE.md.bak-'));
    assert.strictEqual(backupFile, undefined, `Did not expect backup file for non-destructive repair. Found: ${planningFiles.join(', ')}`);
  });

  test('adds nyquist_validation key to config.json via addNyquistKey repair', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but missing nyquist_validation
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, { repair: true }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const addKeyAction = output.repairs_performed.find(r => r.action === 'addNyquistKey');
    assert.ok(addKeyAction, `Expected addNyquistKey action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(addKeyAction.success, true, 'addNyquistKey should succeed');

    // Read config.json and verify workflow.nyquist_validation is true
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'nyquist_validation should be true');
  });

  test('reports repairable_count correctly', () => {
    // No config.json (W003, repairable=true) and no STATE.md (E004, repairable=true)
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    // Run WITHOUT --repair to just check repairable_count
    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.repairable_count >= 2,
      `Expected repairable_count >= 2, got ${output.repairable_count}. Full output: ${JSON.stringify(output)}`
    );
  });

  test('phase mismatch warnings do not count as repairable issues', () => {
    writeValidConfigJson(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\nPhase 99 is the current phase.\n'
    );

    const result = runCmd(() => verify.cmdValidateHealth(tmpDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.repairable_count, 0, `Expected no repairable issues for W002: ${JSON.stringify(output)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-plan-structure command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-plan-structure command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports errors for missing frontmatter fields', () => {
    // Create a plan file with no frontmatter
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, '# Plan\n\nSome content.\n');

    const result = runCmd(() => verify.cmdVerifyPlanStructure(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false);
    assert.ok(output.errors.length > 0, 'should have errors for missing fields');
  });

  test('returns error for nonexistent file', () => {
    const result = runCmd(() => verify.cmdVerifyPlanStructure(tmpDir, 'nonexistent.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should report file not found');
  });

  test('parses task elements and checks for required sub-elements', () => {
    const planContent = `---
phase: 1
plan: test-plan
type: implementation
wave: 1
depends_on: []
files_modified: []
autonomous: true
must_haves: {}
---

# Plan

<task>
<name>Test Task</name>
<action>Do something</action>
</task>
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyPlanStructure(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.task_count, 1);
    assert.strictEqual(output.tasks[0].name, 'Test Task');
    assert.strictEqual(output.tasks[0].hasAction, true);
  });

  test('warns about task missing name element', () => {
    const planContent = `---
phase: 1
plan: test
type: implementation
wave: 1
depends_on: []
files_modified: []
autonomous: true
must_haves: {}
---
<task>
<action>Do something</action>
</task>
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyPlanStructure(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.errors.some(e => e.includes('missing <name>')), 'should warn about missing name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-references command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-references command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error for nonexistent file', () => {
    const result = runCmd(() => verify.cmdVerifyReferences(tmpDir, 'nonexistent.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should report file not found');
  });

  test('finds backtick file references that exist', () => {
    // Create a referenced file
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), '// app\n');

    // Create doc referencing it
    const docFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(docFile, 'See `src/app.js` for details.\n');

    const result = runCmd(() => verify.cmdVerifyReferences(tmpDir, 'doc.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.found > 0 || output.total > 0, 'should find references');
  });

  test('reports missing backtick file references', () => {
    const docFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(docFile, 'See `src/nonexistent.js` for details.\n');

    const result = runCmd(() => verify.cmdVerifyReferences(tmpDir, 'doc.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.missing.length > 0, 'should report missing references');
    assert.strictEqual(output.valid, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate-agents command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate-agents command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns agent installation status', () => {
    const result = runCmd(() => verify.cmdValidateAgents(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok('agents_dir' in output, 'should have agents_dir');
    assert.ok('installed' in output, 'should have installed list');
    assert.ok('missing' in output, 'should have missing list');
    assert.ok('expected' in output, 'should have expected list');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-summary command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-summary command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns failed when summary file does not exist', () => {
    const result = runCmd(() => verify.cmdVerifySummary(tmpDir, 'nonexistent-SUMMARY.md', 2, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.ok(output.errors.some(e => e.includes('not found')));
  });

  test('passes with a valid summary containing no file references', () => {
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'), '# Summary\n\nAll work completed.\n');

    const result = runCmd(() => verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.summary_exists, true);
  });

  test('detects self-check section with pass indicators', () => {
    const content = '# Summary\n\n## Self-Check\n\nAll pass. Everything succeeded.\n';
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'), content);

    const result = runCmd(() => verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'passed');
  });

  test('detects self-check section with fail indicators', () => {
    const content = '# Summary\n\n## Self-Check\n\nSome tests fail here.\n';
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'), content);

    const result = runCmd(() => verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'failed');
    assert.strictEqual(output.passed, false);
  });

  test('detects missing referenced files', () => {
    const content = '# Summary\n\nCreated: `src/nonexistent.js`\nModified: `lib/missing.ts`\n';
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'), content);

    const result = runCmd(() => verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.checks.files_created.missing.length > 0, 'should report missing files');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify artifacts command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify artifacts command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error for nonexistent plan file', () => {
    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'nonexistent.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should report file not found');
  });

  test('returns error when no must_haves.artifacts found', () => {
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, '---\nmust_haves: {}\n---\n# Plan\n');

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('No must_haves.artifacts'), 'should report no artifacts');
  });

  test('verifies artifact existence and checks', () => {
    // Create a source file
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'module.exports = { init };\nfunction init() {}\nline3\nline4\nline5\n');

    const planContent = `---
must_haves:
  artifacts:
    - path: src/app.js
      min_lines: 3
      contains: module.exports
      exports: init
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, true);
    assert.strictEqual(output.total, 1);
  });

  test('reports artifact not found', () => {
    const planContent = `---
must_haves:
  artifacts:
    - path: src/missing.js
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false);
    assert.ok(output.artifacts[0].issues.some(i => i.includes('not found')));
  });

  test('reports min_lines violation', () => {
    fs.writeFileSync(path.join(tmpDir, 'tiny.js'), 'x\n');

    const planContent = `---
must_haves:
  artifacts:
    - path: tiny.js
      min_lines: 100
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false);
    assert.ok(output.artifacts[0].issues.some(i => i.includes('lines')));
  });

  test('reports missing contains pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'const x = 1;\n');

    const planContent = `---
must_haves:
  artifacts:
    - path: app.js
      contains: module.exports
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false);
    assert.ok(output.artifacts[0].issues.some(i => i.includes('Missing pattern')));
  });

  test('reports missing export', () => {
    fs.writeFileSync(path.join(tmpDir, 'lib.js'), 'const x = 1;\n');

    const planContent = `---
must_haves:
  artifacts:
    - path: lib.js
      exports:
        - doSomething
        - doElse
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyArtifacts(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false);
    assert.ok(output.artifacts[0].issues.some(i => i.includes('Missing export')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify key-links command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify key-links command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error for nonexistent plan file', () => {
    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'nonexistent.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should report file not found');
  });

  test('returns error when no must_haves.key_links found', () => {
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, '---\nmust_haves: {}\n---\n# Plan\n');

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('No must_haves.key_links'), 'should report no key_links');
  });

  test('verifies key link where source references target', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), 'const utils = require("./utils.js");\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), 'module.exports = {};\n');

    const planContent = `---
must_haves:
  key_links:
    - from: src/index.js
      to: src/utils.js
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.links.length > 0);
  });

  test('verifies key link with pattern match in source', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'import { something } from "./b";\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'export function something() {}\n');

    const planContent = `---
must_haves:
  key_links:
    - from: src/a.js
      to: src/b.js
      pattern: import.*something
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.links[0].verified, 'pattern should be found in source');
  });

  test('reports when source file not found', () => {
    const planContent = `---
must_haves:
  key_links:
    - from: src/missing.js
      to: src/other.js
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false);
    assert.ok(output.links[0].detail.includes('not found'));
  });

  test('reports when pattern not found in source or target', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'const y = 2;\n');

    const planContent = `---
must_haves:
  key_links:
    - from: src/a.js
      to: src/b.js
      pattern: nonexistentPattern
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false);
    assert.ok(output.links[0].detail.includes('not found'));
  });

  test('reports when target not referenced in source (no pattern)', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');

    const planContent = `---
must_haves:
  key_links:
    - from: src/a.js
      to: src/somewhere-else.js
---
# Plan
`;
    const planFile = path.join(tmpDir, 'test-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runCmd(() => verify.cmdVerifyKeyLinks(tmpDir, 'test-PLAN.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false);
    assert.ok(output.links[0].detail.includes('not referenced'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify commits command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify commits command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports invalid commit hashes', () => {
    const result = runCmd(() => verify.cmdVerifyCommits(tmpDir, ['aaaaaaa', 'bbbbbbb'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, false);
    assert.ok(output.invalid.length > 0, 'should report invalid hashes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// verify phase-completeness command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify phase-completeness command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up a project with phases directory and ROADMAP
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error when phase not found', () => {
    const result = runCmd(() => verify.cmdVerifyPhaseCompleteness(tmpDir, '99', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should report phase not found');
  });

  test('reports plans without summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');

    const result = runCmd(() => verify.cmdVerifyPhaseCompleteness(tmpDir, '1', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.incomplete_plans.length > 0, 'should report incomplete plans');
    assert.strictEqual(output.complete, false);
  });

  test('reports complete when all plans have summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runCmd(() => verify.cmdVerifyPhaseCompleteness(tmpDir, '1', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, true);
  });

  test('reports orphan summaries without plans', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'orphan-SUMMARY.md'), '# Summary\n');

    const result = runCmd(() => verify.cmdVerifyPhaseCompleteness(tmpDir, '1', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.orphan_summaries.length > 0, 'should report orphan summaries');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate consistency command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate consistency command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns failed when ROADMAP.md is missing', () => {
    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.ok(output.errors.some(e => e.includes('ROADMAP.md not found')));
  });

  test('warns about phase in ROADMAP but not on disk', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 5: Future Phase\n'
    );

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('Phase 5')), 'should warn about Phase 5 not on disk');
  });

  test('warns about phase on disk but not in ROADMAP', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-orphan'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('99')), 'should warn about orphan phase 99');
  });

  test('warns about gap in phase numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: One\n### Phase 3: Three\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-one'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-three'), { recursive: true });

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('Gap')), 'should warn about phase numbering gap');
  });

  test('warns about plan numbering gaps within a phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'setup-01-PLAN.md'), '# Plan 1\n');
    fs.writeFileSync(path.join(phaseDir, 'setup-03-PLAN.md'), '# Plan 3\n');

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('Gap in plan numbering')), 'should warn about plan numbering gap');
  });

  test('warns about orphan summaries without matching plan', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'orphan-SUMMARY.md'), '# Summary\n');

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('Summary') && w.includes('no matching')), 'should warn about orphan summary');
  });

  test('warns about missing wave in plan frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'setup-01-PLAN.md'), '---\ntype: execute\n---\n# Plan\n');

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some(w => w.includes('wave')), 'should warn about missing wave');
  });

  test('passes when everything is consistent', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'setup-01-PLAN.md'), '---\nwave: 1\n---\n# Plan\n');
    fs.writeFileSync(path.join(phaseDir, 'setup-01-SUMMARY.md'), '# Summary\n');

    const result = runCmd(() => verify.cmdValidateConsistency(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true);
  });
});

// validate health — home directory guard (E010)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — home directory guard', () => {
  test('detects when CWD is the home directory', () => {
    const homeDir = os.homedir();
    const result = runCmd(() => verify.cmdValidateHealth(homeDir, {}, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'error');
    assert.ok(output.errors.some(e => e.code === 'E010'), 'should have E010 for home directory');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct unit tests (for c8 branch coverage)
// These call verify functions directly with a capture mechanism for output()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: capture output from verify functions that call core.output().
 * core.output() calls fs.writeSync(1, data) — we intercept fd 1 writes.
 */
function captureOutput(fn) {
  const origWriteSync = fs.writeSync;
  let captured = '';
  fs.writeSync = (fd, data) => {
    if (fd === 1) { captured += data; return data.length; }
    return origWriteSync(fd, data);
  };
  try {
    fn();
  } finally {
    fs.writeSync = origWriteSync;
  }
  return captured ? JSON.parse(captured) : null;
}

describe('verify direct unit tests — cmdVerifySummary', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns failed when summary not found', () => {
    const result = captureOutput(() => {
      verify.cmdVerifySummary(tmpDir, 'nonexistent.md', 2, false);
    });
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.checks.summary_exists, false);
  });

  test('detects self-check passed section', () => {
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'),
      '# Summary\n\n## Self-Check\n\nAll pass and complete.\n');

    const result = captureOutput(() => {
      verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false);
    });
    assert.strictEqual(result.checks.self_check, 'passed');
  });

  test('detects self-check failed section', () => {
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'),
      '# Summary\n\n## Verification\n\nSome tests fail here.\n');

    const result = captureOutput(() => {
      verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false);
    });
    assert.strictEqual(result.checks.self_check, 'failed');
    assert.strictEqual(result.passed, false);
  });

  test('checks mentioned files that exist', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), '// app\n');
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'),
      '# Summary\n\nCreated: `src/app.js`\n');

    const result = captureOutput(() => {
      verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false);
    });
    assert.strictEqual(result.checks.files_created.missing.length, 0);
  });

  test('checks mentioned files that are missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'SUMMARY.md'),
      '# Summary\n\nModified: `src/missing.js`\n');

    const result = captureOutput(() => {
      verify.cmdVerifySummary(tmpDir, 'SUMMARY.md', 2, false);
    });
    assert.ok(result.checks.files_created.missing.length > 0);
  });
});

describe('verify direct unit tests — cmdVerifyPlanStructure', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports errors for missing frontmatter fields', () => {
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), '# Plan\n');

    const result = captureOutput(() => {
      verify.cmdVerifyPlanStructure(tmpDir, 'plan.md', false);
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  test('warns about wave > 1 with empty depends_on', () => {
    const content = `---
phase: 1
plan: test
type: execute
wave: 2
depends_on: []
files_modified: []
autonomous: true
must_haves: {}
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyPlanStructure(tmpDir, 'plan.md', false);
    });
    assert.ok(result.warnings.some(w => w.includes('Wave > 1')));
  });

  test('errors on checkpoint tasks with autonomous not false', () => {
    const content = `---
phase: 1
plan: test
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
must_haves: {}
---
# Plan
<task type="checkpoint">
<name>Check</name>
<action>Review</action>
</task>
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyPlanStructure(tmpDir, 'plan.md', false);
    });
    assert.ok(result.errors.some(e => e.includes('checkpoint') && e.includes('autonomous')));
  });

  test('returns file not found for nonexistent plan', () => {
    const result = captureOutput(() => {
      verify.cmdVerifyPlanStructure(tmpDir, 'nonexistent.md', false);
    });
    assert.ok(result.error);
  });
});

describe('verify direct unit tests — cmdVerifyReferences', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('finds @-references that exist', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'file.js'), '// code\n');
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), 'See @src/file.js for details.\n');

    const result = captureOutput(() => {
      verify.cmdVerifyReferences(tmpDir, 'doc.md', false);
    });
    assert.ok(result.found > 0 || result.total > 0);
  });

  test('skips http URLs and template variables in backtick refs', () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'),
      'See `https://example.com/path/file.js` and `${var}/path.js` and `{{thing}}/path.js`\n');

    const result = captureOutput(() => {
      verify.cmdVerifyReferences(tmpDir, 'doc.md', false);
    });
    assert.strictEqual(result.total, 0);
  });

  test('reports missing @-references', () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'),
      'See @src/nonexistent.js for the implementation.\n');

    const result = captureOutput(() => {
      verify.cmdVerifyReferences(tmpDir, 'doc.md', false);
    });
    assert.ok(result.missing.length > 0, 'should report missing @-reference');
    assert.strictEqual(result.valid, false);
  });

  test('finds existing @-references', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'code.js'), '// code\n');
    fs.writeFileSync(path.join(tmpDir, 'doc.md'),
      'See @src/code.js for the implementation.\n');

    const result = captureOutput(() => {
      verify.cmdVerifyReferences(tmpDir, 'doc.md', false);
    });
    assert.ok(result.found > 0, 'should find existing @-reference');
  });
});

describe('verify direct unit tests — cmdVerifyCommits', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize git repo so execGit works
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content\n');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('validates real commit hash as valid', () => {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    const result = captureOutput(() => {
      verify.cmdVerifyCommits(tmpDir, [hash], false);
    });
    assert.strictEqual(result.all_valid, true);
    assert.ok(result.valid.includes(hash));
  });

  test('reports fake hash as invalid', () => {
    const result = captureOutput(() => {
      verify.cmdVerifyCommits(tmpDir, ['aaaaaaa'], false);
    });
    assert.strictEqual(result.all_valid, false);
    assert.ok(result.invalid.includes('aaaaaaa'));
  });
});

describe('verify direct unit tests — cmdVerifyArtifacts', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('verifies artifact with all checks passing', () => {
    fs.writeFileSync(path.join(tmpDir, 'lib.js'),
      'module.exports = { doSomething };\nfunction doSomething() {}\nline 3\nline 4\nline 5\n');

    const content = `---
must_haves:
  artifacts:
    - path: lib.js
      min_lines: 3
      contains: module.exports
      exports: doSomething
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyArtifacts(tmpDir, 'plan.md', false);
    });
    assert.strictEqual(result.all_passed, true);
  });

  test('reports missing file artifact', () => {
    const content = `---
must_haves:
  artifacts:
    - path: missing.js
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyArtifacts(tmpDir, 'plan.md', false);
    });
    assert.strictEqual(result.all_passed, false);
    assert.ok(result.artifacts[0].issues.some(i => i.includes('not found')));
  });

  test('reports min_lines violation', () => {
    fs.writeFileSync(path.join(tmpDir, 'tiny.js'), 'x\n');
    const content = `---
must_haves:
  artifacts:
    - path: tiny.js
      min_lines: 100
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyArtifacts(tmpDir, 'plan.md', false);
    });
    assert.ok(result.artifacts[0].issues.some(i => i.includes('lines')));
  });

  test('reports missing contains pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'const x = 1;\n');
    const content = `---
must_haves:
  artifacts:
    - path: app.js
      contains: MISSING_PATTERN
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyArtifacts(tmpDir, 'plan.md', false);
    });
    assert.ok(result.artifacts[0].issues.some(i => i.includes('Missing pattern')));
  });

  test('reports missing exports (array form)', () => {
    fs.writeFileSync(path.join(tmpDir, 'mod.js'), 'const x = 1;\n');
    const content = `---
must_haves:
  artifacts:
    - path: mod.js
      exports:
        - funcA
        - funcB
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyArtifacts(tmpDir, 'plan.md', false);
    });
    assert.ok(result.artifacts[0].issues.some(i => i.includes('Missing export: funcA')));
    assert.ok(result.artifacts[0].issues.some(i => i.includes('Missing export: funcB')));
  });
});

describe('verify direct unit tests — cmdVerifyKeyLinks', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('verifies link with pattern found in source', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'import { foo } from "./b";\n');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), 'export const foo = 1;\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: b.js
      pattern: import.*foo
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.ok(result.links[0].verified);
    assert.ok(result.links[0].detail.includes('Pattern found in source'));
  });

  test('verifies link with pattern found in target (not source)', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), 'export const specialThing = 1;\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: b.js
      pattern: specialThing
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.ok(result.links[0].verified);
    assert.ok(result.links[0].detail.includes('Pattern found in target'));
  });

  test('reports pattern not found in either file', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), 'const y = 2;\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: b.js
      pattern: nonexistent
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.strictEqual(result.links[0].verified, false);
    assert.ok(result.links[0].detail.includes('not found'));
  });

  test('reports source file not found', () => {
    const content = `---
must_haves:
  key_links:
    - from: missing.js
      to: other.js
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.ok(result.links[0].detail.includes('Source file not found'));
  });

  test('verifies link without pattern (source references target)', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const b = require("b.js");\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: b.js
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.ok(result.links[0].verified);
    assert.ok(result.links[0].detail.includes('Target referenced in source'));
  });

  test('reports target not referenced when no pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const x = 1;\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: somewhere-else.js
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.strictEqual(result.links[0].verified, false);
    assert.ok(result.links[0].detail.includes('not referenced'));
  });

  test('handles invalid regex pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const x = 1;\n');

    const content = `---
must_haves:
  key_links:
    - from: a.js
      to: b.js
      pattern: "[invalid"
---
# Plan
`;
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), content);

    const result = captureOutput(() => {
      verify.cmdVerifyKeyLinks(tmpDir, 'plan.md', false);
    });
    assert.ok(result.links[0].detail.includes('Invalid regex'));
  });
});

describe('verify direct unit tests — cmdValidateHealth', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns E010 when cwd is home directory', () => {
    const result = captureOutput(() => {
      verify.cmdValidateHealth(os.homedir(), {}, false);
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(result.errors.some(e => e.code === 'E010'));
  });

  test('returns broken when .planning/ missing', () => {
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, {}, false);
    });
    assert.strictEqual(result.status, 'broken');
    assert.ok(result.errors.some(e => e.code === 'E001'));
  });

  test('returns degraded when only warnings exist', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    // No config.json => W003
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, {}, false);
    });
    assert.strictEqual(result.status, 'degraded');
    assert.ok(result.warnings.length > 0);
  });

  test('returns healthy when all checks pass', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, {}, false);
    });
    // May have W010 for missing agents, so check errors are empty
    assert.strictEqual(result.errors.length, 0);
  });

  test('repairs createConfig when requested', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No config.json => will be repaired

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, { repair: true }, false);
    });
    assert.ok(result.repairs_performed);
    assert.ok(result.repairs_performed.some(r => r.action === 'createConfig'));
  });

  test('repairs resetConfig when config is invalid JSON', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{broken');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, { repair: true }, false);
    });
    assert.ok(result.repairs_performed);
    assert.ok(result.repairs_performed.some(r => r.action === 'resetConfig'));
  });

  test('repairs addNyquistKey when missing from config', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, { repair: true }, false);
    });
    assert.ok(result.repairs_performed);
    assert.ok(result.repairs_performed.some(r => r.action === 'addNyquistKey'));
  });

  test('repairs regenerateState when STATE.md is missing', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No STATE.md => triggers regenerateState repair

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, { repair: true }, false);
    });
    assert.ok(result.repairs_performed);
    assert.ok(result.repairs_performed.some(r => r.action === 'regenerateState'));
    // STATE.md should now exist
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    assert.ok(fs.existsSync(statePath));
  });

  test('detects W009 when RESEARCH.md has Validation Architecture but no VALIDATION.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nContent.\n'
    );

    const result = captureOutput(() => {
      verify.cmdValidateHealth(tmpDir, {}, false);
    });
    assert.ok(result.warnings.some(w => w.code === 'W009'));
  });
});
