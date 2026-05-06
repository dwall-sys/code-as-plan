'use strict';

// @cap-feature(feature:F-078) Tests for cap-memory-platform.cjs + cap-memory-extends.cjs
//   — happy-path coverage for AC-1 (topic layout), AC-3 (extends-resolution),
//   AC-4 (checklist layout), AC-6 (test verification).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const platformLib = require('../cap/bin/lib/cap-memory-platform.cjs');
const extendsLib = require('../cap/bin/lib/cap-memory-extends.cjs');
const schema = require('../cap/bin/lib/cap-memory-schema.cjs');

// -------- Test sandbox --------

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-platform-test-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function makeRoot() {
  // Each test gets its own isolated subdir so writes don't collide.
  const root = fs.mkdtempSync(path.join(SANDBOX, 'root-'));
  return root;
}

// -------- AC-1: Platform topic layout --------

describe('platform topic layout (AC-1)', () => {
  it('writePlatformTopic + loadPlatformTopic round-trip', () => {
    const root = makeRoot();
    const content = platformLib.renderPlatformTopic({
      topic: 'observability',
      decisions: [
        { text: 'Telemetry uses JSONL append', location: 'cap/bin/lib/cap-telemetry.cjs:155' },
      ],
      pitfalls: [
        { text: 'Atomic appends require <=PIPE_BUF', location: 'cap/bin/lib/cap-telemetry.cjs:163' },
      ],
      updated: '2026-05-06T12:00:00Z',
    });
    const writeResult = platformLib.writePlatformTopic(root, 'observability', content);
    assert.equal(writeResult.updated, true);
    assert.match(writeResult.path, /\/observability\.md$/);

    const loaded = platformLib.loadPlatformTopic(root, 'observability');
    assert.equal(loaded.exists, true);
    assert.equal(loaded.raw, content);
    assert.ok(loaded.file);
    assert.deepEqual(loaded.file.autoBlock.decisions, [
      { text: 'Telemetry uses JSONL append', location: 'cap/bin/lib/cap-telemetry.cjs:155' },
    ]);
    assert.deepEqual(loaded.file.autoBlock.pitfalls, [
      { text: 'Atomic appends require <=PIPE_BUF', location: 'cap/bin/lib/cap-telemetry.cjs:163' },
    ]);
  });

  it('writePlatformTopic is idempotent (byte-identical no-op)', () => {
    const root = makeRoot();
    const content = platformLib.renderPlatformTopic({
      topic: 'idempotency',
      decisions: [{ text: 'Same content twice', location: 'a:1' }],
      updated: '2026-05-06T12:00:00Z',
    });
    const first = platformLib.writePlatformTopic(root, 'idempotency', content);
    const second = platformLib.writePlatformTopic(root, 'idempotency', content);
    assert.equal(first.updated, true);
    assert.equal(second.updated, false);
    assert.equal(second.reason, 'byte-identical-noop');
  });

  it('loadPlatformTopic returns exists:false when file is missing', () => {
    const root = makeRoot();
    const loaded = platformLib.loadPlatformTopic(root, 'never-written');
    assert.equal(loaded.exists, false);
    assert.equal(loaded.file, null);
    assert.equal(loaded.raw, null);
  });

  it('listPlatformTopics returns sorted slug list and skips non-md / checklists subdir', () => {
    const root = makeRoot();
    // Write three topics.
    platformLib.writePlatformTopic(root, 'zeta', platformLib.renderPlatformTopic({ topic: 'zeta', updated: '2026-05-06T00:00:00Z' }));
    platformLib.writePlatformTopic(root, 'alpha', platformLib.renderPlatformTopic({ topic: 'alpha', updated: '2026-05-06T00:00:00Z' }));
    platformLib.writePlatformTopic(root, 'mid-section', platformLib.renderPlatformTopic({ topic: 'mid-section', updated: '2026-05-06T00:00:00Z' }));
    // Write a stray non-md file and a checklists subdir entry.
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.writeFileSync(path.join(platformDir, 'README.txt'), 'not a topic\n');
    platformLib.writeChecklist(root, 'security', platformLib.renderPlatformTopic({ topic: 'security', updated: '2026-05-06T00:00:00Z' }));

    const topics = platformLib.listPlatformTopics(root);
    assert.deepEqual(topics, ['alpha', 'mid-section', 'zeta']);
  });

  it('listPlatformTopics returns [] when platform dir does not exist', () => {
    const root = makeRoot();
    assert.deepEqual(platformLib.listPlatformTopics(root), []);
  });

  it('renderPlatformTopic produces F-076-marker-compatible content', () => {
    const out = platformLib.renderPlatformTopic({
      topic: 'observability',
      decisions: [{ text: 'A', location: 'b:1' }],
      updated: '2026-05-06T12:00:00Z',
    });
    assert.ok(out.includes(schema.AUTO_BLOCK_START_MARKER));
    assert.ok(out.includes(schema.AUTO_BLOCK_END_MARKER));
    assert.ok(out.includes('---\ntopic: observability\nupdated: 2026-05-06T12:00:00Z\n---'));
    assert.ok(out.includes('# Platform: Observability'));
  });
});

// -------- AC-4: Checklist layout --------

describe('checklist layout (AC-4)', () => {
  it('writeChecklist + loadChecklist round-trip', () => {
    const root = makeRoot();
    const content = [
      '---',
      'topic: memory',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# Subsystem Checklist: Memory',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
      '## Pitfall checklist',
      '',
      '- [ ] Schema validation runs before write',
      '- [ ] Atomic-write goes through _atomicWriteFile',
      '',
    ].join('\n');
    const writeResult = platformLib.writeChecklist(root, 'memory', content);
    assert.equal(writeResult.updated, true);
    assert.match(writeResult.path, /platform\/checklists\/memory\.md$/);

    const loaded = platformLib.loadChecklist(root, 'memory');
    assert.equal(loaded.exists, true);
    assert.equal(loaded.raw, content);
  });

  it('listChecklists returns sorted subsystem slugs from checklists subdir only', () => {
    const root = makeRoot();
    // Write a topic and a checklist with the same name to verify they don't collide.
    platformLib.writePlatformTopic(root, 'memory', platformLib.renderPlatformTopic({ topic: 'memory', updated: '2026-05-06T00:00:00Z' }));
    platformLib.writeChecklist(root, 'memory', platformLib.renderPlatformTopic({ topic: 'memory', updated: '2026-05-06T00:00:00Z' }));
    platformLib.writeChecklist(root, 'tag-scanner', platformLib.renderPlatformTopic({ topic: 'tag-scanner', updated: '2026-05-06T00:00:00Z' }));

    assert.deepEqual(platformLib.listChecklists(root), ['memory', 'tag-scanner']);
    // The topic-list MUST NOT include the checklist (different layout).
    assert.deepEqual(platformLib.listPlatformTopics(root), ['memory']);
  });

  it('checklist path layout is .cap/memory/platform/checklists/<slug>.md', () => {
    const root = makeRoot();
    const fp = platformLib.getChecklistPath(root, 'security');
    assert.equal(fp, path.join(root, '.cap', 'memory', 'platform', 'checklists', 'security.md'));
  });
});

// -------- AC-3: Extends round-trip + frontmatter --------

describe('extends frontmatter round-trip (AC-3)', () => {
  it('per-feature file with extends: platform/foo round-trips byte-identical', () => {
    const featureContent = [
      '---',
      'feature: F-070',
      'topic: collect-signals',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/observability',
      '---',
      '',
      '# F-070: Collect Signals',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- Local decision — `cap/x.cjs:1`',
      '<!-- cap:auto:end -->',
      '',
      '## Lessons',
      '',
      '<!-- Manual lessons go here. -->',
      '',
    ].join('\n');

    const parsed = schema.parseFeatureMemoryFile(featureContent);
    assert.equal(parsed.frontmatter.extends, 'platform/observability');
    const reSerialized = schema.serializeFeatureMemoryFile(parsed);
    assert.equal(reSerialized, featureContent, 'extends frontmatter must round-trip byte-identical');
  });

  it('resolveExtends produces ordered layer chain when platform topic exists', () => {
    const root = makeRoot();
    // 1. Write the platform topic.
    const platformContent = platformLib.renderPlatformTopic({
      topic: 'observability',
      decisions: [{ text: 'Platform: telemetry uses JSONL', location: 'cap/x.cjs:1' }],
      updated: '2026-05-06T12:00:00Z',
    });
    platformLib.writePlatformTopic(root, 'observability', platformContent);

    // 2. Write a per-feature file that extends it.
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070-collect-signals.md');
    const featureContent = [
      '---',
      'feature: F-070',
      'topic: collect-signals',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/observability',
      '---',
      '',
      '# F-070: Collect Signals',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- Local F-070 decision — `cap/x.cjs:1`',
      '<!-- cap:auto:end -->',
      '',
      '## Lessons',
      '',
      '',
    ].join('\n');
    fs.writeFileSync(featureFile, featureContent);

    // 3. Resolve.
    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.error, null);
    assert.equal(resolved.layers.length, 2);
    assert.equal(resolved.layers[0].kind, 'feature');
    assert.equal(resolved.layers[0].ref, 'F-070');
    assert.equal(resolved.layers[1].kind, 'platform');
    assert.equal(resolved.layers[1].ref, 'platform/observability');
    assert.deepEqual(resolved.chain, ['F-070', 'platform/observability']);
  });

  it('mergeResolvedView concats decisions across layers (deduped by text+location)', () => {
    const root = makeRoot();
    const platformContent = platformLib.renderPlatformTopic({
      topic: 'observability',
      decisions: [
        { text: 'Platform decision A', location: 'p:1' },
        { text: 'Shared decision', location: 's:1' },
      ],
      updated: '2026-05-06T12:00:00Z',
    });
    platformLib.writePlatformTopic(root, 'observability', platformContent);

    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070-collect-signals.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect-signals',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/observability',
      '---',
      '',
      '# F-070: Collect Signals',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- Feature decision B — `f:1`',
      '- Shared decision — `s:1`',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    const merged = extendsLib.mergeResolvedView(resolved);
    // Three unique decisions: Platform A, Shared (deduped), Feature B.
    const texts = merged.autoBlock.decisions.map((d) => d.text).sort();
    assert.deepEqual(texts, ['Feature decision B', 'Platform decision A', 'Shared decision']);
    assert.equal(merged.layerCount, 2);
  });

  it('resolveExtends single-pass terminates when no extends present', () => {
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070-collect-signals.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect-signals',
      'updated: 2026-05-06T12:00:00Z',
      '---',
      '',
      '# F-070: Collect Signals',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.layers.length, 1);
    assert.deepEqual(resolved.chain, ['F-070']);
  });

  it('resolveExtends walks transitive chain F-070 → platform/A → platform/B', () => {
    const root = makeRoot();
    // platform/B (terminal).
    platformLib.writePlatformTopic(root, 'b', platformLib.renderPlatformTopic({
      topic: 'b',
      decisions: [{ text: 'B says hi', location: 'b:1' }],
      updated: '2026-05-06T12:00:00Z',
    }));
    // platform/A extends platform/B.
    const aPath = platformLib.getPlatformTopicPath(root, 'a');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, [
      '---',
      'topic: a',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/b',
      '---',
      '',
      '# Platform: A',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- A says hi — `a:1`',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));
    // F-070 extends platform/A.
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.chain, ['F-070', 'platform/a', 'platform/b']);
    assert.equal(resolved.layers.length, 3);
  });
});

// -------- AC-2 baseline: explicit-only-promotion (happy path) --------

describe('classifyDecisionTag (AC-2 happy path)', () => {
  it('@cap-decision(platform:foo) → platform-bucket', () => {
    const tag = {
      type: 'decision',
      metadata: { platform: 'observability' },
      file: 'cap/x.cjs',
      line: 10,
      description: 'something',
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'platform');
    assert.equal(result.topic, 'observability');
    assert.equal(result.featureId, null);
    assert.equal(result.reason, 'explicit-platform-tag');
  });

  it('@cap-decision(feature:F-070) → feature-bucket', () => {
    const tag = {
      type: 'decision',
      metadata: { feature: 'F-070' },
      file: 'cap/x.cjs',
      line: 10,
      description: 'feature scoped',
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'feature');
    assert.equal(result.featureId, 'F-070');
    assert.equal(result.topic, null);
  });

  it('plain @cap-decision (no routing key) → unassigned', () => {
    const tag = {
      type: 'decision',
      metadata: {},
      file: 'cap/x.cjs',
      line: 10,
      description: 'unscoped',
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'unassigned');
    assert.equal(result.reason, 'no-routing-tag');
  });

  it('non-decision tag types pass through as unassigned (safe to call in generic loop)', () => {
    const tag = {
      type: 'feature',
      metadata: { feature: 'F-070' },
      file: 'cap/x.cjs',
      line: 10,
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'unassigned');
    assert.equal(result.reason, 'not-a-decision-tag');
  });
});
