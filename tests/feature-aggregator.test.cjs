/**
 * Tests for feature-aggregator.cjs
 *
 * @gsd-context(phase:12) Unit tests for the feature aggregator module.
 * Follows node:test pattern established by all 47 existing test files.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  parsePrd,
  parseOpenTodos,
  crossReference,
  formatDependencies,
  generateFeaturesMarkdown,
  discoverPrdFiles,
} = require('../get-shit-done/bin/lib/feature-aggregator.cjs');

// ── parsePrd ────────────────────────────────────────────────────────────────

describe('parsePrd', () => {
  it('extracts AC lines from PRD content', () => {
    const content = [
      '## Auth Features',
      '',
      'AC-1: User can log in with email and password',
      'AC-2: Session expires after 30 minutes',
      '',
      '## Dashboard',
      '',
      'AC-3: Dashboard shows real-time metrics',
    ].join('\n');

    const result = parsePrd(content, 'PRD.md');

    assert.strictEqual(result.acs.length, 3);
    assert.strictEqual(result.acs[0].id, 'AC-1');
    assert.strictEqual(result.acs[0].description, 'User can log in with email and password');
    assert.strictEqual(result.acs[0].group, 'Auth Features');
    assert.strictEqual(result.acs[1].group, 'Auth Features');
    assert.strictEqual(result.acs[2].group, 'Dashboard');
    assert.strictEqual(result.acs[2].prdSource, 'PRD.md');
  });

  it('handles bold AC format (AC-N with double asterisks)', () => {
    const content = '**AC-1**: User can register\n**AC-2**: User can log out';
    const result = parsePrd(content);

    assert.strictEqual(result.acs.length, 2);
    assert.strictEqual(result.acs[0].id, 'AC-1');
    assert.strictEqual(result.acs[1].id, 'AC-2');
  });

  it('handles bulleted AC format', () => {
    const content = '- AC-1: User can register\n* AC-2: User can log out';
    const result = parsePrd(content);

    assert.strictEqual(result.acs.length, 2);
  });

  it('extracts dependency relationships with arrow syntax', () => {
    const content = [
      '## Dependencies',
      '',
      '- Auth -> Dashboard',
      '- Dashboard -> API Layer',
    ].join('\n');

    const result = parsePrd(content);

    assert.strictEqual(result.dependencies.length, 2);
    assert.strictEqual(result.dependencies[0].from, 'Auth');
    assert.strictEqual(result.dependencies[0].to, 'Dashboard');
  });

  it('extracts dependency relationships with "depends on" syntax', () => {
    const content = [
      '## Dependencies',
      '',
      '- Auth depends on Database',
    ].join('\n');

    const result = parsePrd(content);

    assert.strictEqual(result.dependencies.length, 1);
    assert.strictEqual(result.dependencies[0].from, 'Auth');
    assert.strictEqual(result.dependencies[0].to, 'Database');
  });

  it('tracks feature groups from headings', () => {
    const content = [
      '## Auth',
      'AC-1: Login',
      '## Billing',
      'AC-2: Payment',
    ].join('\n');

    const result = parsePrd(content);

    assert.deepStrictEqual(result.groups, ['Auth', 'Billing']);
  });

  it('returns empty arrays when no ACs found', () => {
    const result = parsePrd('# Just a heading\n\nSome text.');

    assert.strictEqual(result.acs.length, 0);
    assert.strictEqual(result.dependencies.length, 0);
  });
});

// ── parseOpenTodos ──────────────────────────────────────────────────────────

describe('parseOpenTodos', () => {
  it('extracts AC IDs from @gsd-todo section in CODE-INVENTORY.md', () => {
    const content = [
      '## Tags by Type',
      '',
      '### @gsd-todo',
      '',
      '#### src/auth.js',
      '',
      '| Line | Metadata | Description |',
      '|------|----------|-------------|',
      '| 12 | ref:AC-1, phase:12 | Implement login |',
      '| 25 | ref:AC-3 | Add session handling |',
      '',
      '### @gsd-context',
      '',
      '| Line | Metadata | Description |',
      '| 1 | ref:AC-2 | This should NOT be captured |',
    ].join('\n');

    const result = parseOpenTodos(content);

    assert.strictEqual(result.size, 2);
    assert.ok(result.has('AC-1'));
    assert.ok(result.has('AC-3'));
    assert.ok(!result.has('AC-2'), 'Should not capture refs from non-todo sections');
  });

  it('returns empty set when no @gsd-todo section exists', () => {
    const content = '## Tags by Type\n\n### @gsd-context\n\nSome content';
    const result = parseOpenTodos(content);

    assert.strictEqual(result.size, 0);
  });

  it('returns empty set for empty input', () => {
    const result = parseOpenTodos('');
    assert.strictEqual(result.size, 0);
  });
});

// ── crossReference ──────────────────────────────────────────────────────────

describe('crossReference', () => {
  it('marks ACs as open when they have open @gsd-todo tags', () => {
    const acs = [
      { id: 'AC-1', description: 'Login', group: 'Auth', prdSource: 'PRD.md' },
      { id: 'AC-2', description: 'Register', group: 'Auth', prdSource: 'PRD.md' },
      { id: 'AC-3', description: 'Dashboard', group: 'UI', prdSource: 'PRD.md' },
    ];
    const openTodos = new Set(['AC-1', 'AC-3']);

    const result = crossReference(acs, openTodos);

    assert.strictEqual(result[0].status, 'open');
    assert.strictEqual(result[1].status, 'done');
    assert.strictEqual(result[2].status, 'open');
  });

  it('marks all ACs as done when no open todos exist', () => {
    const acs = [
      { id: 'AC-1', description: 'Login', group: 'Auth', prdSource: 'PRD.md' },
    ];
    const result = crossReference(acs, new Set());

    assert.strictEqual(result[0].status, 'done');
  });
});

// ── formatDependencies ──────────────────────────────────────────────────────

describe('formatDependencies', () => {
  it('formats dependency list as markdown', () => {
    const deps = [
      { from: 'Auth', to: 'Database' },
      { from: 'Dashboard', to: 'Auth' },
    ];

    const result = formatDependencies(deps);

    assert.ok(result.includes('Auth --> Database'));
    assert.ok(result.includes('Dashboard --> Auth'));
    assert.ok(result.includes('**Auth** depends on **Database**'));
  });

  it('returns no-deps message when empty', () => {
    const result = formatDependencies([]);
    assert.ok(result.includes('No cross-feature dependencies'));
  });

  it('handles null input', () => {
    const result = formatDependencies(null);
    assert.ok(result.includes('No cross-feature dependencies'));
  });
});

// ── generateFeaturesMarkdown ────────────────────────────────────────────────

describe('generateFeaturesMarkdown', () => {
  it('generates complete FEATURES.md with header, progress, groups, and dependencies', () => {
    const enrichedAcs = [
      { id: 'AC-1', description: 'Login', group: 'Auth', prdSource: 'PRD.md', status: 'done' },
      { id: 'AC-2', description: 'Register', group: 'Auth', prdSource: 'PRD.md', status: 'open' },
      { id: 'AC-3', description: 'Metrics', group: 'Dashboard', prdSource: 'PRD.md', status: 'open' },
    ];
    const deps = [{ from: 'Dashboard', to: 'Auth' }];
    const groups = ['Auth', 'Dashboard'];

    const result = generateFeaturesMarkdown(enrichedAcs, deps, groups, ['PRD.md']);

    // Read-only header
    assert.ok(result.includes('This file is auto-generated. Do not edit manually.'));
    assert.ok(result.includes('Last updated:'));
    assert.ok(result.includes('Source hash:'));

    // Overall progress
    assert.ok(result.includes('Total ACs | 3'));
    assert.ok(result.includes('Done | 1'));
    assert.ok(result.includes('Open | 2'));
    assert.ok(result.includes('Completion | 33%'));

    // Group sections
    assert.ok(result.includes('### Auth'));
    assert.ok(result.includes('### Dashboard'));

    // Status indicators
    assert.ok(result.includes('DONE'));
    assert.ok(result.includes('OPEN'));

    // Dependencies
    assert.ok(result.includes('Dashboard --> Auth'));

    // Footer
    assert.ok(result.includes('auto-generated'));
  });

  it('includes source-hash that changes with different input', () => {
    const acs1 = [{ id: 'AC-1', description: 'A', group: 'G', prdSource: 'P', status: 'done' }];
    const acs2 = [{ id: 'AC-1', description: 'B', group: 'G', prdSource: 'P', status: 'open' }];

    const md1 = generateFeaturesMarkdown(acs1, [], [], ['P']);
    const md2 = generateFeaturesMarkdown(acs2, [], [], ['P']);

    const hash1 = md1.match(/Source hash:\*\* ([a-f0-9]+)/)[1];
    const hash2 = md2.match(/Source hash:\*\* ([a-f0-9]+)/)[1];

    assert.notStrictEqual(hash1, hash2, 'Different inputs should produce different hashes');
  });

  it('handles zero ACs gracefully', () => {
    const result = generateFeaturesMarkdown([], [], [], []);

    assert.ok(result.includes('Total ACs | 0'));
    assert.ok(result.includes('Completion | 0%'));
  });
});

// ── discoverPrdFiles ────────────────────────────────────────────────────────

describe('discoverPrdFiles', () => {
  it('returns empty array for non-existent directory', () => {
    const result = discoverPrdFiles('/tmp/nonexistent-gsd-test-dir-xyz');
    assert.deepStrictEqual(result, []);
  });
});
