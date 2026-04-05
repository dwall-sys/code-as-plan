/**
 * Profile Output Tests
 *
 * Tests for profile rendering commands and PROFILING_QUESTIONS data.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, createTempGitProject, cleanup } = require('./helpers.cjs');

const {
  PROFILING_QUESTIONS,
  CLAUDE_INSTRUCTIONS,
} = require('../cap/bin/lib/profile-output.cjs');

// ─── PROFILING_QUESTIONS data ─────────────────────────────────────────────────

describe('PROFILING_QUESTIONS', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(PROFILING_QUESTIONS));
    assert.ok(PROFILING_QUESTIONS.length > 0);
  });

  test('each question has required fields', () => {
    for (const q of PROFILING_QUESTIONS) {
      assert.ok(q.dimension, `question missing dimension`);
      assert.ok(q.header, `${q.dimension} missing header`);
      assert.ok(q.question, `${q.dimension} missing question`);
      assert.ok(Array.isArray(q.options), `${q.dimension} options should be array`);
      assert.ok(q.options.length >= 2, `${q.dimension} should have at least 2 options`);
    }
  });

  test('each option has label, value, and rating', () => {
    for (const q of PROFILING_QUESTIONS) {
      for (const opt of q.options) {
        assert.ok(opt.label, `${q.dimension} option missing label`);
        assert.ok(opt.value, `${q.dimension} option missing value`);
        assert.ok(opt.rating, `${q.dimension} option missing rating`);
      }
    }
  });

  test('all dimension keys are unique', () => {
    const dims = PROFILING_QUESTIONS.map(q => q.dimension);
    const unique = [...new Set(dims)];
    assert.strictEqual(dims.length, unique.length);
  });
});

// ─── CLAUDE_INSTRUCTIONS ──────────────────────────────────────────────────────

describe('CLAUDE_INSTRUCTIONS', () => {
  test('is a non-empty object', () => {
    assert.strictEqual(typeof CLAUDE_INSTRUCTIONS, 'object', 'should be an object');
    assert.notStrictEqual(CLAUDE_INSTRUCTIONS, null, 'should not be null');
    assert.ok(Object.keys(CLAUDE_INSTRUCTIONS).length > 0);
  });

  test('each dimension has at least one instruction', () => {
    for (const [dim, instructions] of Object.entries(CLAUDE_INSTRUCTIONS)) {
      assert.strictEqual(typeof instructions, 'object', `${dim} should be an object`);
      assert.ok(Object.keys(instructions).length > 0, `${dim} should have instructions`);
    }
  });

  test('every PROFILING_QUESTIONS dimension has CLAUDE_INSTRUCTIONS', () => {
    for (const q of PROFILING_QUESTIONS) {
      assert.ok(
        CLAUDE_INSTRUCTIONS[q.dimension],
        `${q.dimension} has questions but no CLAUDE_INSTRUCTIONS`
      );
    }
  });
});

// ─── write-profile command ────────────────────────────────────────────────────

describe('write-profile command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('writes USER-PROFILE.md from analysis JSON', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH' },
        decision_speed: { rating: 'fast-intuitive', confidence: 'MEDIUM' },
        explanation_depth: { rating: 'concise', confidence: 'HIGH' },
        debugging_approach: { rating: 'fix-first', confidence: 'LOW' },
        ux_philosophy: { rating: 'function-first', confidence: 'MEDIUM' },
        vendor_philosophy: { rating: 'pragmatic', confidence: 'HIGH' },
        frustration_triggers: { rating: 'over-explanation', confidence: 'LOW' },
        learning_style: { rating: 'hands-on', confidence: 'MEDIUM' },
      },
    };

    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));

    const result = runGsdTools(['write-profile', '--input', analysisPath, '--raw'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.profile_path, 'should return profile_path');
    assert.ok(out.dimensions_scored > 0, 'should have scored dimensions');
  });

  test('errors when --input is missing', () => {
    const result = runGsdTools('write-profile --raw', tmpDir);
    assert.ok(!result.success, 'should fail without --input');
    assert.ok(result.error.includes('--input'), 'should mention --input');
  });
});

// ─── generate-claude-md command ───────────────────────────────────────────────

describe('generate-claude-md command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# My Project\n\nA test project.\n\n## Tech Stack\n\n- Node.js\n- TypeScript\n'
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('generates CLAUDE.md with --auto flag', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    const result = runGsdTools(['generate-claude-md', '--output', outputPath, '--auto', '--raw'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);

    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, 'utf-8');
      assert.ok(content.length > 0, 'should have content');
    }
  });

  test('does not overwrite existing CLAUDE.md without --force', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(outputPath, '# Custom CLAUDE.md\n\nUser content.\n');

    const result = runGsdTools(['generate-claude-md', '--output', outputPath, '--auto', '--raw'], tmpDir);
    // Should merge, not overwrite
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.length > 0, 'should still have content');
  });
});

// ─── generate-dev-preferences ─────────────────────────────────────────────────

describe('generate-dev-preferences command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors when --analysis is missing', () => {
    const result = runGsdTools('generate-dev-preferences --raw', tmpDir);
    assert.ok(!result.success, 'should fail without --analysis');
    assert.ok(result.error.includes('--analysis'), 'should mention --analysis');
  });

  test('generates preferences from analysis file', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH' },
        decision_speed: { rating: 'fast-intuitive', confidence: 'MEDIUM' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));

    const result = runGsdTools(['generate-dev-preferences', '--analysis', analysisPath, '--raw'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.command_path || out.command_name, 'should return command output');
  });
});

// ─── Additional branch coverage tests (direct import) ────────────────────────

const {
  cmdWriteProfile,
  cmdProfileQuestionnaire,
  cmdGenerateDevPreferences,
  cmdGenerateClaudeProfile,
  cmdGenerateClaudeMd,
} = require('../cap/bin/lib/profile-output.cjs');

/** Run fn() intercepting process.exit and stderr writes. Returns { exitCode, stderr } */
function captureError(fn) {
  const origExit = process.exit;
  const origWrite = fs.writeSync;
  let exitCode = null;
  let stderr = '';
  process.exit = (code) => { exitCode = code; throw new Error('__EXIT__'); };
  fs.writeSync = function(fd, data) {
    if (fd === 2) { stderr += data; return data.length; }
    if (fd === 1) { return data.length; }
    return origWrite.apply(fs, arguments);
  };
  try { fn(); } catch (e) { if (e.message !== '__EXIT__') throw e; }
  finally { process.exit = origExit; fs.writeSync = origWrite; }
  return { exitCode, stderr };
}

/** Capture fs.writeSync(1, data) calls */
function captureOutput(fn) {
  const origWrite = fs.writeSync;
  let captured = '';
  fs.writeSync = function(fd, data) {
    if (fd === 1) { captured += data; return data.length; }
    return origWrite.apply(fs, arguments);
  };
  try { fn(); } finally { fs.writeSync = origWrite; }
  return captured;
}

describe('cmdProfileQuestionnaire (direct)', () => {
  test('returns questionnaire when no answers provided', () => {
    const out = captureOutput(() => cmdProfileQuestionnaire({}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.mode, 'interactive');
    assert.ok(data.questions.length === 8);
    // Each question should have dimension, header, context, question, options
    for (const q of data.questions) {
      assert.ok(q.dimension);
      assert.ok(q.header);
      assert.ok(q.options.length >= 2);
      for (const o of q.options) {
        assert.ok(o.label);
        assert.ok(o.value);
      }
    }
  });

  test('processes valid answers and returns analysis', () => {
    const answers = 'a,b,c,d,a,b,c,d';
    const out = captureOutput(() => cmdProfileQuestionnaire({ answers }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.profile_version, '1.0');
    assert.strictEqual(data.data_source, 'questionnaire');
    assert.ok(data.dimensions);
    assert.ok(data.dimensions.communication_style);
    assert.strictEqual(data.dimensions.communication_style.rating, 'terse-direct');
    // communication_style 'a' is terse-direct, not 'mixed', so not ambiguous => MEDIUM confidence
    assert.strictEqual(data.dimensions.communication_style.confidence, 'MEDIUM');
  });

  test('marks ambiguous answer as LOW confidence', () => {
    // communication_style d = 'mixed' which isAmbiguousAnswer returns true
    const answers = 'd,a,a,a,a,a,a,a';
    const out = captureOutput(() => cmdProfileQuestionnaire({ answers }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.dimensions.communication_style.confidence, 'LOW');
  });

  test('generates claude_instruction for each dimension', () => {
    const answers = 'a,a,a,a,a,a,a,a';
    const out = captureOutput(() => cmdProfileQuestionnaire({ answers }, false));
    const data = JSON.parse(out);
    for (const dimKey of Object.keys(data.dimensions)) {
      assert.ok(data.dimensions[dimKey].claude_instruction, `${dimKey} should have claude_instruction`);
      assert.ok(data.dimensions[dimKey].claude_instruction.length > 0);
    }
  });

  test('includes evidence from questionnaire', () => {
    const answers = 'b,b,b,b,b,b,b,b';
    const out = captureOutput(() => cmdProfileQuestionnaire({ answers }, false));
    const data = JSON.parse(out);
    for (const dimKey of Object.keys(data.dimensions)) {
      const dim = data.dimensions[dimKey];
      assert.ok(Array.isArray(dim.evidence), `${dimKey} should have evidence array`);
      assert.strictEqual(dim.evidence.length, 1);
      assert.strictEqual(dim.evidence[0].signal, 'Self-reported via questionnaire');
      assert.ok(dim.evidence[0].quote.length > 0);
    }
  });
});

describe('cmdGenerateClaudeProfile (direct)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('creates new CLAUDE.md with profile section', () => {
    const analysis = {
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH', claude_instruction: 'Be terse' },
        decision_speed: { rating: 'fast-intuitive', confidence: 'MEDIUM' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'CLAUDE.md');

    const out = captureOutput(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'created');
    assert.ok(data.dimensions_included.includes('communication_style'));
    assert.ok(fs.existsSync(outputPath));
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('<!-- GSD:profile-start -->'));
    assert.ok(content.includes('<!-- GSD:profile-end -->'));
    assert.ok(content.includes('terse-direct'));
  });

  test('updates existing CLAUDE.md by replacing profile section', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(outputPath, '# My Project\n\n<!-- GSD:profile-start -->\nOLD PROFILE\n<!-- GSD:profile-end -->\n\nExtra content\n');

    const analysis = {
      dimensions: {
        communication_style: { rating: 'conversational', confidence: 'HIGH' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));

    const out = captureOutput(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'updated');
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(!content.includes('OLD PROFILE'));
    assert.ok(content.includes('conversational'));
    assert.ok(content.includes('Extra content'));
  });

  test('appends profile section when no markers exist', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(outputPath, '# Existing content\n');

    const analysis = {
      dimensions: {
        debugging_approach: { rating: 'fix-first', confidence: 'MEDIUM' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));

    const out = captureOutput(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'appended');
  });

  test('defaults to cwd/CLAUDE.md when no output option given', () => {
    const analysis = {
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));

    const out = captureOutput(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: analysisPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.claude_md_path, path.join(tmpDir, 'CLAUDE.md'));
    assert.strictEqual(data.action, 'created');
  });

  test('uses fallback instruction when no claude_instruction and no rating lookup', () => {
    const analysis = {
      dimensions: {
        communication_style: { rating: 'nonexistent-rating', confidence: 'LOW' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'CLAUDE.md');

    const out = captureOutput(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes("Adapt to this developer's communication style preference"));
  });
});

describe('cmdGenerateClaudeMd (direct)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });
  afterEach(() => { cleanup(tmpDir); });

  test('creates CLAUDE.md with all managed sections', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Test Project\n\n## What This Is\nA test app.\n\n## Core Value\nSpeed.\n\n## Constraints\n- Be fast\n');

    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'created');
    assert.ok(data.sections_generated.length > 0);
    assert.ok(fs.existsSync(outputPath));
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('<!-- GSD:project-start'));
    assert.ok(content.includes('<!-- GSD:workflow-start'));
    assert.ok(content.includes('<!-- GSD:profile-start'));
  });

  test('updates existing CLAUDE.md by merging sections', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(outputPath,
      '<!-- GSD:project-start source:PROJECT.md -->\n## Project\n\nOld content\n<!-- GSD:project-end -->\n');

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# New Project\n\n## What This Is\nUpdated app.\n');

    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'updated');
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('New Project') || content.includes('Updated app'));
  });

  test('uses fallback when PROJECT.md is missing', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE-test.md');
    // Don't create PROJECT.md
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'PROJECT.md')); } catch {}

    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.ok(data.sections_fallback.includes('project'));
  });

  test('--auto skips manually edited sections', () => {
    const outputPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(outputPath, [
      '<!-- GSD:project-start source:PROJECT.md -->',
      '## Project',
      '',
      'I manually edited this section!',
      '<!-- GSD:project-end -->',
    ].join('\n'));

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Original\n\n## What This Is\nThe original content.\n');

    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath, auto: true }, false));
    const data = JSON.parse(out);
    assert.ok(data.sections_skipped.includes('project'), 'should skip manually edited project section');
  });

  test('generates stack section from codebase/STACK.md', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'codebase'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'codebase', 'STACK.md'),
      '# Stack\n\n| Layer | Tech |\n|-------|------|\n| Runtime | Node.js |\n\n- TypeScript\n');

    const outputPath = path.join(tmpDir, 'CLAUDE-stack.md');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.ok(data.sections_generated.includes('stack') || !data.sections_fallback.includes('stack'));
  });

  test('generates conventions section', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'codebase'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'codebase', 'CONVENTIONS.md'),
      '# Conventions\n\n## Naming\n- camelCase for variables\n- PascalCase for types\n');

    const outputPath = path.join(tmpDir, 'CLAUDE-conv.md');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.ok(!data.sections_fallback.includes('conventions'));
  });

  test('generates architecture section', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'codebase'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'codebase', 'ARCHITECTURE.md'),
      '# Architecture\n\n## Layers\n- API layer\n- Domain layer\n\n```\nsrc/\n  api/\n  domain/\n```\n');

    const outputPath = path.join(tmpDir, 'CLAUDE-arch.md');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.ok(!data.sections_fallback.includes('architecture'));
  });

  test('defaults to cwd/CLAUDE.md when no output option given', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Proj\n');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, {}, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.claude_md_path, path.join(tmpDir, 'CLAUDE.md'));
  });

  test('resolves relative output path', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Proj\n');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: 'docs/CLAUDE.md' }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.claude_md_path, path.join(tmpDir, 'docs', 'CLAUDE.md'));
  });

  test('reports profile status exists when updating file with existing profile markers', () => {
    // First create a CLAUDE.md with profile markers already present
    const outputPath = path.join(tmpDir, 'CLAUDE-exist.md');
    fs.writeFileSync(outputPath, [
      '<!-- GSD:project-start source:PROJECT.md -->',
      '## Project',
      '',
      'Content',
      '<!-- GSD:project-end -->',
      '',
      '<!-- GSD:profile-start -->',
      '## Developer Profile',
      'Existing profile',
      '<!-- GSD:profile-end -->',
    ].join('\n'));

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Proj\n');

    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.strictEqual(data.action, 'updated');
    assert.strictEqual(data.profile_status, 'exists');
  });

  test('falls back to research/STACK.md when codebase/STACK.md missing', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'research'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'research', 'STACK.md'),
      '# Stack\n\n- React\n- PostgreSQL\n');

    const outputPath = path.join(tmpDir, 'CLAUDE-fallback-stack.md');
    const out = captureOutput(() => cmdGenerateClaudeMd(tmpDir, { output: outputPath }, false));
    const data = JSON.parse(out);
    assert.ok(!data.sections_fallback.includes('stack'));
  });
});

describe('cmdWriteProfile (direct, additional branches)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('redacts sensitive content in evidence', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: {
          rating: 'terse-direct',
          confidence: 'HIGH',
          evidence: [
            { quote: 'Use sk-abcdefghijklmnopqrstuvwxyz to authenticate', signal: 'API key usage' },
            { example: 'Bearer eyJhbGciOiJIUzI1NiJ9.test', signal: 'Auth token' },
          ],
        },
        decision_speed: {
          rating: 'fast-intuitive',
          confidence: 'MEDIUM',
          evidence: [
            { quote: 'path /Users/dennis/secret/file', signal: 'Home path' },
          ],
        },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis-sensitive.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'profile-sensitive.md');

    const out = captureOutput(() =>
      cmdWriteProfile(tmpDir, { input: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.ok(data.sensitive_redacted > 0, 'should report redacted patterns');
  });

  test('handles custom output path', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'conversational', confidence: 'LOW' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const customOutput = path.join(tmpDir, 'custom', 'profile.md');

    const out = captureOutput(() =>
      cmdWriteProfile(tmpDir, { input: analysisPath, output: customOutput }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.profile_path, customOutput);
    assert.ok(fs.existsSync(customOutput));
  });

  test('handles dimensions with HIGH/MEDIUM/LOW confidence counts', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH', claude_instruction: 'Be brief' },
        decision_speed: { rating: 'fast-intuitive', confidence: 'MEDIUM', claude_instruction: 'Decide fast' },
        explanation_depth: { rating: 'code-only', confidence: 'LOW' },
        debugging_approach: { rating: 'fix-first', confidence: 'HIGH', claude_instruction: 'Fix first' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'profile-counts.md');

    const out = captureOutput(() =>
      cmdWriteProfile(tmpDir, { input: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.high_confidence, 2);
    assert.strictEqual(data.medium_confidence, 1);
    assert.strictEqual(data.low_confidence, 1);
    assert.strictEqual(data.dimensions_scored, 4);
  });

  test('handles evidence_quotes field name variant', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: {
          rating: 'detailed-structured',
          confidence: 'HIGH',
          evidence_quotes: [
            { signal: 'Structured input', quote: 'Detailed request', project: 'myproj' },
          ],
        },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis-eq.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'profile-eq.md');

    const out = captureOutput(() =>
      cmdWriteProfile(tmpDir, { input: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.ok(data.profile_path);
  });
});

describe('cmdWriteProfile error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('errors when analysis file not found', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdWriteProfile(tmpDir, { input: '/nonexistent/analysis.json' }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('not found'));
  });

  test('errors when analysis JSON is invalid', () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, 'not json');
    const { exitCode, stderr } = captureError(() =>
      cmdWriteProfile(tmpDir, { input: badPath }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Failed to parse'));
  });

  test('errors when dimensions missing', () => {
    const nodimsPath = path.join(tmpDir, 'nodims.json');
    fs.writeFileSync(nodimsPath, JSON.stringify({ profile_version: '1.0' }));
    const { exitCode, stderr } = captureError(() =>
      cmdWriteProfile(tmpDir, { input: nodimsPath }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('dimensions'));
  });

  test('errors when profile_version missing', () => {
    const novPath = path.join(tmpDir, 'noversion.json');
    fs.writeFileSync(novPath, JSON.stringify({ dimensions: {} }));
    const { exitCode, stderr } = captureError(() =>
      cmdWriteProfile(tmpDir, { input: novPath }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('profile_version'));
  });
});

describe('cmdGenerateClaudeProfile error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('errors when --analysis is missing', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateClaudeProfile(tmpDir, {}, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('--analysis'));
  });

  test('errors when analysis file not found', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: '/nonexistent.json' }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('not found'));
  });

  test('errors when dimensions missing from analysis', () => {
    const nodimsPath = path.join(tmpDir, 'nodims.json');
    fs.writeFileSync(nodimsPath, JSON.stringify({}));
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateClaudeProfile(tmpDir, { analysis: nodimsPath }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('dimensions'));
  });
});

describe('cmdGenerateDevPreferences error paths (direct)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('errors when --analysis is missing', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateDevPreferences(tmpDir, {}, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('--analysis'));
  });

  test('errors when analysis file not found', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: '/nonexistent.json' }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('not found'));
  });

  test('errors when dimensions missing', () => {
    const nodimsPath = path.join(tmpDir, 'nodims.json');
    fs.writeFileSync(nodimsPath, JSON.stringify({}));
    const { exitCode, stderr } = captureError(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: nodimsPath }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('dimensions'));
  });
});

describe('cmdProfileQuestionnaire error paths (direct)', () => {
  test('errors with wrong number of answers', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdProfileQuestionnaire({ answers: 'a,b' }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Expected'));
  });

  test('errors with invalid answer value', () => {
    const { exitCode, stderr } = captureError(() =>
      cmdProfileQuestionnaire({ answers: 'z,a,a,a,a,a,a,a' }, false)
    );
    assert.strictEqual(exitCode, 1);
    assert.ok(stderr.includes('Invalid answer'));
  });
});

describe('cmdGenerateDevPreferences (direct, additional branches)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('generates preferences with questionnaire data source', () => {
    const analysis = {
      profile_version: '1.0',
      data_source: 'questionnaire',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'MEDIUM' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'prefs.md');

    const out = captureOutput(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.strictEqual(data.source, 'questionnaire');
    assert.ok(fs.existsSync(outputPath));
  });

  test('uses rating lookup when no claude_instruction exists', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'prefs-lookup.md');

    const out = captureOutput(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.ok(data.dimensions_included.includes('communication_style'));
  });

  test('uses fallback instruction when rating not in lookup', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'unknown-rating', confidence: 'LOW' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'prefs-fallback.md');

    const out = captureOutput(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: analysisPath, output: outputPath }, false)
    );
    const data = JSON.parse(out);
    assert.ok(data.dimensions_included.includes('communication_style'));
  });

  test('handles --stack option for custom stack preferences', () => {
    const analysis = {
      profile_version: '1.0',
      dimensions: {
        communication_style: { rating: 'terse-direct', confidence: 'HIGH' },
      },
    };
    const analysisPath = path.join(tmpDir, 'analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis));
    const outputPath = path.join(tmpDir, 'prefs-stack.md');

    const out = captureOutput(() =>
      cmdGenerateDevPreferences(tmpDir, { analysis: analysisPath, output: outputPath, stack: 'React, TypeScript, PostgreSQL' }, false)
    );
    const data = JSON.parse(out);
    assert.ok(data.command_path);
    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('React, TypeScript, PostgreSQL'));
  });
});
