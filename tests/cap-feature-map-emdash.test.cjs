'use strict';

// @cap-feature(feature:F-082) Em-dash header separator tolerance — real-world variance discovered via GoetzeInvest dry-run.
// @cap-decision(F-082/iter2) Em-dash separator (`### F-001 — Title`) is semantically identical to colon
//   separator (`### F-001: Title`); CAP parser must accept both for legacy/template tolerance.
//   Hyphen separator requires surrounding whitespace (` - `) to disambiguate from hyphens inside long-form IDs.

const test = require('node:test');
const assert = require('node:assert');
const { parseFeatureMapContent } = require('../cap/bin/lib/cap-feature-map.cjs');

test.describe('F-082/iter2 header separator tolerance', () => {
  test.it('parses colon-separated headers (regression baseline)', () => {
    const content = '## Features\n\n### F-001: Title alpha [shipped]\n\nDescription.\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-001');
    assert.strictEqual(r.features[0].title, 'Title alpha');
    assert.strictEqual(r.features[0].state, 'shipped');
  });

  test.it('parses em-dash separator', () => {
    const content = '## Features\n\n### F-001 — Title alpha [shipped]\n\nDescription.\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-001');
    assert.strictEqual(r.features[0].title, 'Title alpha');
    assert.strictEqual(r.features[0].state, 'shipped');
  });

  test.it('parses en-dash separator', () => {
    const content = '## Features\n\n### F-001 – Title alpha [shipped]\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-001');
    assert.strictEqual(r.features[0].title, 'Title alpha');
  });

  test.it('parses hyphen separator with surrounding whitespace', () => {
    const content = '## Features\n\n### F-001 - Title alpha [shipped]\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-001');
    assert.strictEqual(r.features[0].title, 'Title alpha');
  });

  test.it('parses long-form ID with em-dash separator', () => {
    const content = '## Features\n\n### F-HUB-AUTH — Authentication module [shipped]\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-HUB-AUTH');
    assert.strictEqual(r.features[0].title, 'Authentication module');
    assert.strictEqual(r.features[0].state, 'shipped');
  });

  test.it('parses long-form ID with hyphen separator (whitespace required)', () => {
    const content = '## Features\n\n### F-HUB-AUTH - Authentication module [shipped]\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-HUB-AUTH');
  });

  test.it('rejects header without separator (malformed)', () => {
    const content = '## Features\n\n### F-001Title alpha\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 0);
  });

  test.it('rejects hyphen separator without surrounding whitespace (would conflict with long-form IDs)', () => {
    const content = '## Features\n\n### F-001-Title\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 0);
  });

  test.it('mixed separators across features in same map', () => {
    const content = [
      '## Features',
      '',
      '### F-001: Colon-separated [shipped]',
      'Description 1.',
      '',
      '### F-002 — Em-dash-separated [planned]',
      'Description 2.',
      '',
      '### F-DEPLOY — Long-form em-dash [shipped]',
      'Description 3.',
      '',
    ].join('\n');
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 3);
    assert.deepStrictEqual(r.features.map(f => f.id), ['F-001', 'F-002', 'F-DEPLOY']);
  });

  test.it('em-dash inside title is preserved (greedy-via-end-anchor)', () => {
    const content = '## Features\n\n### F-001 — Title — with — dashes [shipped]\n\n';
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].title, 'Title — with — dashes');
    assert.strictEqual(r.features[0].state, 'shipped');
  });

  test.it('GoetzeInvest-shape header parses correctly (real-world canary)', () => {
    const content = [
      '## Features',
      '',
      '### F-001 — Configure Supabase Storage Infrastructure [shipped]',
      '',
      'Storage-Grundlage: drei Supabase Storage Buckets mit RLS Policies.',
      '',
      '**Group:** Storage',
      '**Depends on:** none',
      '',
      '- [x] AC-1: Create three Supabase Storage buckets',
      '- [x] AC-2: project-images bucket allows unauthenticated read access',
      '',
    ].join('\n');
    const r = parseFeatureMapContent(content);
    assert.strictEqual(r.features.length, 1);
    assert.strictEqual(r.features[0].id, 'F-001');
    assert.strictEqual(r.features[0].acs.length, 2);
  });
});
