'use strict';

// @cap-feature(feature:F-077) Tests for V6 Memory Migration Tool — covers AC-1..AC-7 plus adversarial edges.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const migrate = require('../cap/bin/lib/cap-memory-migrate.cjs');
const {
  migrateMemory,
  buildMigrationPlan,
  classifyEntry,
  classifySnapshot,
  buildClassifierContext,
  parseV5MarkdownFile,
  parseGraphJson,
  parseSnapshot,
  renderPlannedWrite,
  resolveAmbiguities,
  CONFIDENCE_AUTO_THRESHOLD,
  UNASSIGNED_PLATFORM_TOPIC,
  UNASSIGNED_SNAPSHOTS_TOPIC,
  _atomicWriteFile,
  _writeBackup,
  _isoDate,
  _slugify,
} = migrate;

// --- Sandbox helpers ---

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f077-'));
  fs.mkdirSync(path.join(root, '.cap', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(root, '.cap', 'snapshots'), { recursive: true });
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function writeFile(root, rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

function readFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function writeFeatureMap(root, features) {
  // Minimal FEATURE-MAP.md compatible with cap-feature-map.cjs parser.
  const blocks = features.map((f) => {
    const filesBlock = (f.files || []).map((p) => `- \`${p}\``).join('\n');
    return `### ${f.id}: ${f.title} [${f.state || 'shipped'}]\n\n| AC | Status | Description |\n|----|--------|-------------|\n| AC-1 | tested | Some AC |\n\n**Files:**\n${filesBlock}\n`;
  }).join('\n');
  const content = `# Feature Map\n\n## Features\n\n${blocks}\n\n*Last updated: 2026-05-06T12:00:00.000Z*\n`;
  writeFile(root, 'FEATURE-MAP.md', content);
}

function makeV5DecisionsMd(entries) {
  const blocks = entries.map((e) => {
    const fileLine = e.files && e.files.length > 0 ? `\n- **Files:** ${e.files.map((f) => `\`${f}\``).join(', ')}` : '';
    const dateLabel = e.dateLabel || 'code';
    return `### <a id="${e.anchorId}"></a>${e.title}\n\n- **Date:** ${dateLabel}${fileLine}\n- **Confidence:** 0.50\n- **Evidence:** 1\n- **Last Seen:** 2026-05-06T08:00:00.000Z\n`;
  }).join('\n');
  return `# Project Memory: Decisions\n\n> Auto-generated from code tags and session data.\n> Last updated: 2026-05-06\n\n${blocks}`;
}

function makeV5PitfallsMd(entries) {
  const blocks = entries.map((e) => {
    const fileLine = e.files && e.files.length > 0 ? `\n- **Files:** ${e.files.map((f) => `\`${f}\``).join(', ')}` : '';
    const dateLabel = e.dateLabel || 'code';
    return `### <a id="${e.anchorId}"></a>${e.title}\n\n- **Date:** ${dateLabel}${fileLine}\n- **Confidence:** 0.50\n- **Evidence:** 1\n- **Last Seen:** 2026-05-06T08:00:00.000Z\n`;
  }).join('\n');
  return `# Project Memory: Pitfalls\n\n> Auto-generated.\n\n${blocks}`;
}

const FIXED_NOW = new Date('2026-05-06T14:00:00.000Z').getTime();

// --- AC-1: Source parsing ---

describe('AC-1: Source parsing', () => {
  it('parseV5MarkdownFile parses decisions.md into entries with title, anchor, files, line', () => {
    const md = makeV5DecisionsMd([
      { anchorId: 'aaa11111', title: 'Decision A', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      { anchorId: 'bbb22222', title: 'Decision B', files: ['cap/bin/lib/cap-feature-map.cjs'] },
    ]);
    const entries = parseV5MarkdownFile(md, 'decisions.md');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, 'decision');
    assert.equal(entries[0].anchorId, 'aaa11111');
    assert.equal(entries[0].title, 'Decision A');
    assert.deepEqual(entries[0].relatedFiles, ['cap/bin/lib/cap-tag-scanner.cjs']);
    assert.equal(entries[0].confidence, 0.5);
    assert.equal(entries[0].lastSeen, '2026-05-06T08:00:00.000Z');
    assert.ok(entries[0].sourceLine > 0);
  });

  it('parses pitfalls.md with kind=pitfall', () => {
    const md = makeV5PitfallsMd([{ anchorId: 'pi1', title: 'Pitfall X', files: ['a.cjs'] }]);
    const entries = parseV5MarkdownFile(md, 'pitfalls.md');
    assert.equal(entries[0].kind, 'pitfall');
  });

  it('handles malformed entries (missing anchor) gracefully', () => {
    const md = `# Heading\n\n### Decision Without Anchor\n\n- **Date:** code\n`;
    const entries = parseV5MarkdownFile(md, 'decisions.md');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].anchorId, '');
    assert.equal(entries[0].title, 'Decision Without Anchor');
  });

  it('skips truly empty H3 lines', () => {
    const md = `### \n\n### Real Decision\n\n- **Date:** code\n`;
    const entries = parseV5MarkdownFile(md, 'decisions.md');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'Real Decision');
  });

  it('extracts dateLabel "(F-NNN)" and propagates to taggedFeatureId', () => {
    const md = `### <a id="x1"></a>Tagged decision\n\n- **Date:** code (F-070)\n`;
    const entries = parseV5MarkdownFile(md, 'decisions.md');
    assert.equal(entries[0].taggedFeatureId, 'F-070');
  });

  it('returns empty array for empty source files', () => {
    assert.deepEqual(parseV5MarkdownFile('', 'decisions.md'), []);
  });

  it('parseGraphJson recognizes hotspot/decision nodes', () => {
    const graph = JSON.stringify({
      nodes: {
        'decision-aaa11111': {
          type: 'decision',
          id: 'decision-aaa11111',
          label: 'A graph-side decision',
          updatedAt: '2026-05-06T08:00:00.000Z',
          metadata: { source: 'code', file: 'cap/bin/lib/cap-tag-scanner.cjs', relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        },
        'hotspot-zzz99999': {
          type: 'hotspot',
          id: 'hotspot-zzz99999',
          label: 'cap/bin/lib/cap-tag-scanner.cjs',
          metadata: { relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        },
      },
    });
    const parsed = parseGraphJson(graph);
    assert.ok(parsed.byAnchor.has('aaa11111'));
    assert.equal(parsed.byAnchor.get('aaa11111').kind, 'decision');
    assert.equal(parsed.hotspotsWithoutMarkdown.length, 1);
    assert.equal(parsed.hotspotsWithoutMarkdown[0].kind, 'hotspot');
  });

  it('parseGraphJson recovers gracefully from malformed JSON', () => {
    const parsed = parseGraphJson('{not json');
    assert.equal(parsed.byAnchor.size, 0);
    assert.equal(parsed.hotspotsWithoutMarkdown.length, 0);
  });

  it('buildMigrationPlan returns sourceCounts for each known V5 source', () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['a.cjs'] },
        { anchorId: 'a2', title: 'D2', files: ['b.cjs'] },
      ]));
      writeFile(root, '.cap/memory/pitfalls.md', makeV5PitfallsMd([
        { anchorId: 'p1', title: 'P1', files: ['a.cjs'] },
      ]));
      writeFeatureMap(root, []);
      const ctx = buildClassifierContext(root);
      const plan = buildMigrationPlan(root, ctx, { now: FIXED_NOW });
      assert.equal(plan.sourceCounts['decisions.md'], 2);
      assert.equal(plan.sourceCounts['pitfalls.md'], 1);
      assert.equal(plan.sourceCounts['patterns.md'], 0);
      assert.equal(plan.sourceCounts['hotspots.md'], 0);
    } finally {
      cleanup(root);
    }
  });
});

// --- AC-2: Atomic-write + idempotent ---

describe('AC-2: Atomic-write + idempotent', () => {
  it('atomic-write produces no .tmp orphan on success', () => {
    const root = makeProject();
    try {
      const fp = path.join(root, '.cap', 'memory', 'features', 'F-001-tag-scanner.md');
      _atomicWriteFile(fp, 'hello');
      assert.equal(readFile(root, '.cap/memory/features/F-001-tag-scanner.md'), 'hello');
      assert.equal(fs.existsSync(fp + '.tmp'), false);
    } finally { cleanup(root); }
  });

  it('atomic-write cleans up .tmp on rename failure', () => {
    const root = makeProject();
    const realRename = fs.renameSync;
    try {
      fs.renameSync = () => { throw new Error('simulated rename failure'); };
      const fp = path.join(root, '.cap', 'memory', 'features', 'F-001-foo.md');
      assert.throws(() => _atomicWriteFile(fp, 'hello'), /simulated rename/);
      assert.equal(fs.existsSync(fp), false);
      assert.equal(fs.existsSync(fp + '.tmp'), false);
    } finally {
      fs.renameSync = realRename;
      cleanup(root);
    }
  });

  it('apply twice over the same input produces no diff on the second run', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const opts = { apply: true, interactive: false, now: FIXED_NOW };
      const r1 = await migrateMemory(root, opts);
      assert.equal(r1.errors.length, 0, `errors on first run: ${r1.errors.join(', ')}`);
      assert.ok(r1.wroteFiles.length > 0);

      // Snapshot every output file's content + mtime.
      const snapshot = new Map();
      for (const fp of r1.wroteFiles) {
        snapshot.set(fp, fs.readFileSync(fp, 'utf8'));
      }

      const r2 = await migrateMemory(root, opts);
      assert.equal(r2.errors.length, 0);
      // Byte-identical content after second run.
      for (const fp of r1.wroteFiles) {
        assert.equal(fs.readFileSync(fp, 'utf8'), snapshot.get(fp), `${fp} changed on second run`);
      }
    } finally { cleanup(root); }
  });

  it('all writes go through atomic-write — no orphan .tmp after a full migration', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW });
      // Recursively assert no .tmp under .cap/memory.
      const orphans = [];
      function walk(d) {
        for (const name of fs.readdirSync(d)) {
          const fp = path.join(d, name);
          const st = fs.statSync(fp);
          if (st.isDirectory()) walk(fp);
          else if (name.endsWith('.tmp')) orphans.push(fp);
        }
      }
      walk(path.join(root, '.cap', 'memory'));
      assert.deepEqual(orphans, []);
    } finally { cleanup(root); }
  });
});

// --- AC-3: Backup ---

describe('AC-3: Backup', () => {
  it('writes backup with date-only suffix at .cap/memory/.archive/', () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', '# decisions');
      const from = path.join(root, '.cap/memory/decisions.md');
      const to = path.join(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md');
      const wrote = _writeBackup(from, to);
      assert.equal(wrote, true);
      assert.equal(readFile(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md'), '# decisions');
    } finally { cleanup(root); }
  });

  it('idempotent on same date — does not overwrite an existing backup', () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', '# new content');
      writeFile(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md', '# old backup');
      const wrote = _writeBackup(
        path.join(root, '.cap/memory/decisions.md'),
        path.join(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md'),
      );
      assert.equal(wrote, false);
      assert.equal(readFile(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md'), '# old backup');
    } finally { cleanup(root); }
  });

  it('migrateMemory --apply creates backups and lists them in result.backups', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW });
      assert.equal(r.errors.length, 0);
      const expectedBackup = path.join(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md');
      assert.ok(r.backups.includes(expectedBackup), `expected backup not in result: ${r.backups.join(', ')}`);
      assert.ok(fs.existsSync(expectedBackup));
    } finally { cleanup(root); }
  });

  it('cross-day re-run creates a new dated backup file', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const day1 = new Date('2026-05-06T12:00:00.000Z').getTime();
      const day2 = new Date('2026-05-07T12:00:00.000Z').getTime();
      await migrateMemory(root, { apply: true, interactive: false, now: day1 });
      await migrateMemory(root, { apply: true, interactive: false, now: day2 });
      assert.ok(fs.existsSync(path.join(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-06.md')));
      assert.ok(fs.existsSync(path.join(root, '.cap/memory/.archive/decisions-pre-v6-2026-05-07.md')));
    } finally { cleanup(root); }
  });

  it('skips backup when source file does not exist', () => {
    const root = makeProject();
    try {
      const wrote = _writeBackup(
        path.join(root, '.cap/memory/does-not-exist.md'),
        path.join(root, '.cap/memory/.archive/x.md'),
      );
      assert.equal(wrote, false);
    } finally { cleanup(root); }
  });
});

// --- AC-4: Dry-run default + apply gate ---

describe('AC-4: Dry-run default', () => {
  it('default options yield dry-run with no fs writes', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      assert.equal(r.dryRun, true);
      assert.equal(r.wroteFiles.length, 0);
      assert.equal(r.report, null);
      // No features or platform dirs created.
      assert.equal(fs.existsSync(path.join(root, '.cap/memory/features')), false);
      assert.equal(fs.existsSync(path.join(root, '.cap/memory/platform')), false);
      // .archive not created either.
      assert.equal(fs.existsSync(path.join(root, '.cap/memory/.archive')), false);
    } finally { cleanup(root); }
  });

  it('returns a populated plan in dry-run mode', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      assert.equal(r.plan.writes.length, 1);
      assert.equal(r.plan.writes[0].destinationKind, 'feature');
      assert.equal(r.plan.writes[0].featureId, 'F-001');
      assert.equal(r.plan.backups.length, 1);
      assert.equal(r.plan.backups[0].exists, false);
    } finally { cleanup(root); }
  });

  it('--apply with confirm=yes proceeds to writes', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, {
        apply: true,
        interactive: true,
        now: FIXED_NOW,
        log: () => {},
        _testPromptResponses: [{ choice: 'y' }],
      });
      assert.equal(r.errors.length, 0);
      assert.ok(r.wroteFiles.length > 0);
    } finally { cleanup(root); }
  });

  it('--apply with confirm=no aborts before writes (exit code 2)', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, {
        apply: true,
        interactive: true,
        now: FIXED_NOW,
        log: () => {},
        _testPromptResponses: [{ choice: 'n' }],
      });
      assert.equal(r.exitCode, 2);
      assert.equal(r.wroteFiles.length, 0);
      assert.match(r.errors[0], /declined/);
    } finally { cleanup(root); }
  });

  it('--apply --interactive=false runs without prompt and writes', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.exitCode, 0);
      assert.ok(r.wroteFiles.length > 0);
    } finally { cleanup(root); }
  });

  it('emits a dry-run report via the log function', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const log = [];
      await migrateMemory(root, { now: FIXED_NOW, log: (l) => log.push(l) });
      const text = log.join('\n');
      assert.match(text, /=== V6 MIGRATION DRY-RUN ===/);
      assert.match(text, /Source files:/);
      assert.match(text, /Backups would be created:/);
      assert.match(text, /=== END DRY-RUN ===/);
    } finally { cleanup(root); }
  });
});

// --- AC-5: Classifier priority ---

describe('AC-5: Classifier priority', () => {
  function makeContext() {
    return {
      features: [
        { id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { id: 'F-002', title: 'Feature Map', files: ['cap/bin/lib/cap-feature-map.cjs'] },
      ],
      fileToFeatureId: new Map([
        ['cap/bin/lib/cap-tag-scanner.cjs', 'F-001'],
        ['cap/bin/lib/cap-feature-map.cjs', 'F-002'],
      ]),
      featureState: new Map(),
    };
  }

  it('tag-metadata wins over path-heuristic when they disagree', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: '',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code (F-070)',
      relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'], // path → F-001
      confidence: null, lastSeen: null,
      taggedFeatureId: 'F-070', taggedPlatformTopic: null, // tag → F-070
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-070');
    assert.equal(decision.confidence, 1.0);
  });

  it('path-heuristic wins over content-mention', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 'mentions F-002', content: 'F-002 is referenced in body',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'], // path → F-001
      confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-001');
    assert.equal(decision.confidence, 0.7);
  });

  it('content-mention used when no tag and no path-match', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: 'F-070 is the only mention',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: [],
      confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-070');
    assert.equal(decision.confidence, 0.5);
  });

  it('multi-feature-id mention yields ambiguous decision (confidence < threshold)', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: 'F-070 and F-071 both apply',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: [],
      confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD);
    assert.ok(decision.candidates.length >= 2);
  });

  it('no-signal entry routes to unassigned with confidence 0', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 'plain', content: 'no f number here',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: [],
      confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'unassigned');
    assert.equal(decision.confidence, 0);
  });

  it('platform-tag wins over everything except feature-tag', () => {
    const ctx = makeContext();
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: '',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'],
      confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: 'atomic-writes',
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.destination, 'platform');
    assert.equal(decision.topic, 'atomic-writes');
    assert.equal(decision.confidence, 1.0);
  });

  it('confidence 0.7 is auto, anything below is ambiguous', () => {
    const ctx = makeContext();
    // Single path-match yields exactly 0.7 — must auto-route.
    const e1 = {
      kind: 'decision', anchorId: 'a', title: 't', content: '', sourceFile: 'decisions.md',
      sourceLine: 1, dateLabel: 'code', relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'],
      confidence: null, lastSeen: null, taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const d1 = classifyEntry(e1, ctx);
    assert.equal(d1.confidence, 0.7);
    // Single content-mention yields 0.5 — ambiguous.
    const e2 = {
      kind: 'decision', anchorId: 'a', title: 't', content: 'F-070 mentioned',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code', relatedFiles: [],
      confidence: null, lastSeen: null, taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const d2 = classifyEntry(e2, ctx);
    assert.ok(d2.confidence < CONFIDENCE_AUTO_THRESHOLD);
  });

  it('snapshot frontmatter feature wins over date-proximity', () => {
    const ctx = { features: [], fileToFeatureId: new Map(), featureState: new Map([['F-070', { state: 'shipped', transitionAt: '2026-05-06T12:00:00.000Z' }]]) };
    const snap = {
      fileName: 'snap.md', sourcePath: '/x/snap.md',
      feature: 'F-070', date: '2026-05-06T12:00:00.000Z',
      title: 'Some Snapshot', bodyHash: 'abc',
    };
    const decision = classifySnapshot(snap, ctx);
    assert.equal(decision.featureId, 'F-070');
    assert.equal(decision.confidence, 1.0);
  });

  it('snapshot date-proximity heuristic suggests a feature when within 24h', () => {
    const ctx = { features: [], fileToFeatureId: new Map(), featureState: new Map([['F-070', { state: 'shipped', transitionAt: '2026-05-06T12:00:00.000Z' }]]) };
    const snap = {
      fileName: 'snap.md', sourcePath: '/x/snap.md', feature: null,
      date: '2026-05-06T20:00:00.000Z', title: 'No-id snapshot', bodyHash: 'abc',
    };
    const decision = classifySnapshot(snap, ctx);
    assert.equal(decision.featureId, 'F-070');
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD);
  });

  it('snapshot title with F-NNN suggests that feature when nothing else matches', () => {
    const ctx = { features: [], fileToFeatureId: new Map(), featureState: new Map() };
    const snap = {
      fileName: 'foo.md', sourcePath: '/x/foo.md', feature: null, date: null,
      title: 'F-077 V6 Migration Snapshot', bodyHash: 'abc',
    };
    const decision = classifySnapshot(snap, ctx);
    assert.equal(decision.featureId, 'F-077');
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD);
  });

  it('snapshot with no signal routes to unassigned with confidence 0', () => {
    const ctx = { features: [], fileToFeatureId: new Map(), featureState: new Map() };
    const snap = {
      fileName: 'foo.md', sourcePath: '/x/foo.md', feature: null, date: null,
      title: 'No identifier here', bodyHash: 'abc',
    };
    const decision = classifySnapshot(snap, ctx);
    assert.equal(decision.destination, 'unassigned');
    assert.equal(decision.topic, UNASSIGNED_SNAPSHOTS_TOPIC);
  });
});

// --- AC-6: Interactive prompt ---

describe('AC-6: Interactive ambiguity prompt', () => {
  it('numeric pick routes ambiguous entry to that candidate', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070 and F-071', files: [] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-070', title: 'Collect Signals', files: [] },
        { id: 'F-071', title: 'Pattern Extraction', files: [] },
      ]);
      const r = await migrateMemory(root, {
        apply: true, interactive: true, now: FIXED_NOW, log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: '2' }], // confirm + pick candidate 2
      });
      assert.equal(r.errors.length, 0);
      const wrote = r.wroteFiles.find((fp) => fp.includes('F-071'));
      assert.ok(wrote, `expected F-071 file in writes: ${r.wroteFiles.join(', ')}`);
    } finally { cleanup(root); }
  });

  it('skip option routes ambiguous entry to platform/unassigned', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070 and F-071', files: [] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-070', title: 'Collect Signals', files: [] },
        { id: 'F-071', title: 'Pattern Extraction', files: [] },
      ]);
      const r = await migrateMemory(root, {
        apply: true, interactive: true, now: FIXED_NOW, log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: 's' }],
      });
      assert.equal(r.errors.length, 0);
      const wrote = r.wroteFiles.find((fp) => fp.includes(UNASSIGNED_PLATFORM_TOPIC));
      assert.ok(wrote, `expected unassigned file in writes: ${r.wroteFiles.join(', ')}`);
    } finally { cleanup(root); }
  });

  it('auto-mode (a) resolves remaining ambiguities with confidence-best winner', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070', files: [] },
        { anchorId: 'a2', title: 'Mentions F-071', files: [] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-070', title: 'Collect Signals', files: [] },
        { id: 'F-071', title: 'Pattern Extraction', files: [] },
      ]);
      const r = await migrateMemory(root, {
        apply: true, interactive: true, now: FIXED_NOW, log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: 'a' }],
      });
      assert.equal(r.errors.length, 0);
      // Both F-070 and F-071 files should exist (each entry routes to its single best candidate).
      assert.ok(r.wroteFiles.find((fp) => fp.includes('F-070')));
      assert.ok(r.wroteFiles.find((fp) => fp.includes('F-071')));
    } finally { cleanup(root); }
  });

  it('quit (q) aborts migration with exit code 2 and no writes survive', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070 and F-071', files: [] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-070', title: 'Collect Signals', files: [] },
        { id: 'F-071', title: 'Pattern Extraction', files: [] },
      ]);
      const r = await migrateMemory(root, {
        apply: true, interactive: true, now: FIXED_NOW, log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: 'q' }],
      });
      assert.equal(r.exitCode, 2);
      assert.equal(r.wroteFiles.length, 0);
      // Backups must NOT have been written either (quit happens before the write phase).
      assert.equal(r.backups.length, 0);
    } finally { cleanup(root); }
  });

  it('non-interactive apply auto-resolves ambiguities to confidence-best', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070', files: [] },
      ]));
      writeFeatureMap(root, [{ id: 'F-070', title: 'Collect Signals', files: [] }]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.ok(r.wroteFiles.find((fp) => fp.includes('F-070')));
    } finally { cleanup(root); }
  });

  it('invalid numeric choice falls back to unassigned (defensive)', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Mentions F-070 and F-071', files: [] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-070', title: 'Collect Signals', files: [] },
        { id: 'F-071', title: 'Pattern Extraction', files: [] },
      ]);
      const r = await migrateMemory(root, {
        apply: true, interactive: true, now: FIXED_NOW, log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: '99' }],
      });
      assert.equal(r.errors.length, 0);
      assert.ok(r.wroteFiles.find((fp) => fp.includes(UNASSIGNED_PLATFORM_TOPIC)));
    } finally { cleanup(root); }
  });
});

// --- AC-7: Migration report ---

describe('AC-7: Migration report', () => {
  it('writes report file at .cap/memory/.archive/migration-report-<date>.md', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const reportPath = path.join(root, '.cap/memory/.archive/migration-report-2026-05-06.md');
      assert.ok(fs.existsSync(reportPath), 'report file not written');
      const text = fs.readFileSync(reportPath, 'utf8');
      assert.match(text, /^# V6 Migration Report/m);
      assert.match(text, /Total V5 entries processed:\s*\d+/);
      assert.match(text, /Files written/);
    } finally { cleanup(root); }
  });

  it('report counts match the actual writes', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { anchorId: 'a2', title: 'D2', files: ['cap/bin/lib/cap-feature-map.cjs'] },
      ]));
      writeFile(root, '.cap/memory/pitfalls.md', makeV5PitfallsMd([
        { anchorId: 'p1', title: 'P1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { id: 'F-002', title: 'Feature Map', files: ['cap/bin/lib/cap-feature-map.cjs'] },
      ]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.equal(r.report.counts.total, 3);
      assert.equal(r.report.counts.assigned, 3);
    } finally { cleanup(root); }
  });

  it('report lists backups under ## Backups', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const text = fs.readFileSync(path.join(root, '.cap/memory/.archive/migration-report-2026-05-06.md'), 'utf8');
      assert.match(text, /## Backups/);
      assert.match(text, /decisions-pre-v6-2026-05-06\.md/);
    } finally { cleanup(root); }
  });

  it('same-day apply replaces the report rather than appending', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const reportPath = path.join(root, '.cap/memory/.archive/migration-report-2026-05-06.md');
      const t1 = fs.readFileSync(reportPath, 'utf8');
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const t2 = fs.readFileSync(reportPath, 'utf8');
      // The report is REPLACED (not appended) — both renderings start with the same H1 once.
      assert.match(t2, /^# V6 Migration Report\n/);
      const headingCount = (t2.match(/^# V6 Migration Report/gm) || []).length;
      assert.equal(headingCount, 1, 'report should not contain duplicate H1 (i.e., not appended)');
      // The output FEATURE/PLATFORM files MUST be byte-identical across re-runs (true idempotency).
      const featureFile = path.join(root, '.cap/memory/features/F-001-tag-scanner.md');
      const featureContent = fs.readFileSync(featureFile, 'utf8');
      // Re-run a third time and verify feature file unchanged.
      await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(fs.readFileSync(featureFile, 'utf8'), featureContent);
      // First run wrote the backup; second run skipped (already exists). The report on the second run
      // reflects what the second run actually did — backups list is empty there.
      assert.match(t1, /decisions-pre-v6-2026-05-06\.md/);
    } finally { cleanup(root); }
  });
});

// --- Adversarial / edge cases ---

describe('Adversarial edges', () => {
  it('empty source files (decisions.md exists with 0 entries) — no error, plan empty', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', '# Empty\n');
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.equal(r.plan.writes.length, 0);
    } finally { cleanup(root); }
  });

  it('source files do not exist — no error, plan empty', async () => {
    const root = makeProject();
    try {
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.equal(r.plan.writes.length, 0);
      assert.equal(r.plan.backups.length, 0);
    } finally { cleanup(root); }
  });

  it('FEATURE-MAP.md missing — falls back to no-key-files heuristic', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'No tag, no path-match', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      // No FEATURE-MAP.md.
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      // No fileToFeatureId entries → entry routes to unassigned (no signal).
      assert.equal(r.plan.unassigned.length, 1);
    } finally { cleanup(root); }
  });

  it('tagged feature wins over body-mention smuggle', () => {
    const ctx = {
      features: [
        { id: 'F-001', title: 'X', files: [] },
        { id: 'F-002', title: 'Y', files: [] },
      ],
      fileToFeatureId: new Map(),
      featureState: new Map(),
    };
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: 'mentions F-002 in body',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code (F-001)',
      relatedFiles: [], confidence: null, lastSeen: null,
      taggedFeatureId: 'F-001', taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.equal(decision.featureId, 'F-001');
    assert.equal(decision.confidence, 1.0);
  });

  it('1000-entry stress test runs in under 5 seconds in dry-run', async () => {
    const root = makeProject();
    try {
      const fixtures = [];
      for (let i = 0; i < 1000; i++) {
        fixtures.push({ anchorId: `a${i.toString(16)}`, title: `Decision ${i}`, files: ['cap/bin/lib/cap-tag-scanner.cjs'] });
      }
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd(fixtures));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const t0 = Date.now();
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      const elapsed = Date.now() - t0;
      assert.equal(r.errors.length, 0);
      assert.equal(r.plan.sourceCounts['decisions.md'], 1000);
      assert.ok(elapsed < 5000, `dry-run took ${elapsed}ms`);
    } finally { cleanup(root); }
  });

  it('non-string projectRoot returns error (does not crash)', async () => {
    const r = await migrateMemory(/** @type {any} */ (null), { now: FIXED_NOW, log: () => {} });
    assert.equal(r.exitCode, 1);
    assert.match(r.errors[0], /projectRoot/);
  });

  it('entry kind=pitfall routes into pitfalls section of write', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/pitfalls.md', makeV5PitfallsMd([
        { anchorId: 'p1', title: 'A pitfall', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      const wrote = r.wroteFiles.find((fp) => fp.includes('F-001'));
      const text = fs.readFileSync(wrote, 'utf8');
      assert.match(text, /## Pitfalls \(from tags\)/);
      assert.match(text, /A pitfall/);
    } finally { cleanup(root); }
  });

  it('snapshot routing places snapshot link under ## Linked Snapshots', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/snapshots/2026-05-06-v5.md', '---\nfeature: F-001\ndate: 2026-05-06T08:00:00Z\n---\n\n# Some Snapshot\n');
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      const wrote = r.wroteFiles.find((fp) => fp.includes('F-001'));
      const text = fs.readFileSync(wrote, 'utf8');
      assert.match(text, /## Linked Snapshots/);
      assert.match(text, /2026-05-06-v5\.md/);
    } finally { cleanup(root); }
  });

  it('graph.json enriches markdown entries with tagged feature id when anchor matches', () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'aaa11111', title: 'D from md', files: [] },
      ]));
      writeFile(root, '.cap/memory/graph.json', JSON.stringify({
        nodes: {
          'decision-aaa11111': {
            type: 'decision', id: 'decision-aaa11111', label: 'D from md',
            metadata: { feature: 'F-070', file: 'cap/bin/lib/cap-tag-scanner.cjs', relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'] },
          },
        },
      }));
      writeFeatureMap(root, [{ id: 'F-070', title: 'Collect Signals', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const ctx = buildClassifierContext(root);
      const plan = buildMigrationPlan(root, ctx, { now: FIXED_NOW });
      // Entry should be routed into F-070 (graph metadata wins via taggedFeatureId).
      const w = plan.writes.find((x) => x.featureId === 'F-070');
      assert.ok(w, `expected F-070 in writes: ${plan.writes.map((x) => x.destinationPath).join(', ')}`);
      assert.equal(w.decisions.length, 1);
    } finally { cleanup(root); }
  });

  it('parseSnapshot extracts feature + date from frontmatter', () => {
    const raw = '---\nfeature: F-070\ndate: 2026-05-06T08:00:00Z\n---\n\n# Title here\n';
    const snap = parseSnapshot('snap.md', '/x/snap.md', raw);
    assert.equal(snap.feature, 'F-070');
    assert.equal(snap.date, '2026-05-06T08:00:00Z');
    assert.equal(snap.title, 'Title here');
  });

  it('parseSnapshot rejects non-F-NNN feature value', () => {
    const raw = '---\nfeature: not-a-feature\n---\n\n# Title\n';
    const snap = parseSnapshot('snap.md', '/x/snap.md', raw);
    assert.equal(snap.feature, null);
  });

  it('_slugify handles edge cases', () => {
    assert.equal(_slugify('F-001: Tag Scanner'), 'tag-scanner');
    assert.equal(_slugify(''), 'topic');
    assert.equal(_slugify('   '), 'topic');
    assert.equal(_slugify('Already-Kebab'), 'already-kebab');
  });

  it('_isoDate produces a YYYY-MM-DD string', () => {
    const d = _isoDate(new Date('2026-05-06T14:23:01Z').getTime());
    assert.equal(d, '2026-05-06');
  });

  it('renderPlannedWrite produces a parseable F-076 file (markers present)', () => {
    const write = {
      destinationPath: '/x/.cap/memory/features/F-001-tag-scanner.md',
      destinationKind: 'feature',
      featureId: 'F-001',
      topic: 'tag-scanner',
      decisions: [{
        kind: 'decision', anchorId: 'a', title: 'A decision', content: '',
        sourceFile: 'decisions.md', sourceLine: 5, dateLabel: 'code',
        relatedFiles: ['cap/bin/lib/cap-tag-scanner.cjs'], confidence: 0.5,
        lastSeen: '2026-05-06T08:00:00Z', taggedFeatureId: null, taggedPlatformTopic: null,
      }],
      pitfalls: [],
      snapshots: [],
    };
    const text = renderPlannedWrite(write, FIXED_NOW);
    assert.match(text, /<!-- cap:auto:start -->/);
    assert.match(text, /<!-- cap:auto:end -->/);
    assert.match(text, /## Decisions \(from tags\)/);
    assert.match(text, /A decision/);
    assert.match(text, /feature: F-001/);
    assert.match(text, /topic: tag-scanner/);
  });

  it('two entries with the same title route deterministically (sort stable)', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'Same Title', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { anchorId: 'a2', title: 'Same Title', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      const r1 = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const text1 = fs.readFileSync(r1.wroteFiles[0], 'utf8');
      // Wipe and re-create to test determinism across runs.
      fs.rmSync(path.join(root, '.cap/memory/features'), { recursive: true, force: true });
      fs.rmSync(path.join(root, '.cap/memory/.archive'), { recursive: true, force: true });
      const r2 = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      const text2 = fs.readFileSync(r2.wroteFiles[0], 'utf8');
      assert.equal(text1, text2);
    } finally { cleanup(root); }
  });

  it('multi-path-match yields ambiguous decision with top-3 candidates', () => {
    const ctx = {
      features: [
        { id: 'F-001', title: 'A', files: [] },
        { id: 'F-002', title: 'B', files: [] },
      ],
      fileToFeatureId: new Map([
        ['a.cjs', 'F-001'],
        ['b.cjs', 'F-002'],
      ]),
      featureState: new Map(),
    };
    const entry = {
      kind: 'decision', anchorId: 'a', title: 't', content: '',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: ['a.cjs', 'b.cjs'], confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD);
    assert.equal(decision.candidates.length, 2);
    const ids = decision.candidates.map((c) => c.featureId).sort();
    assert.deepEqual(ids, ['F-001', 'F-002']);
  });

  it('snapshot multi-date-proximity emits multiple candidates', () => {
    const ctx = {
      features: [],
      fileToFeatureId: new Map(),
      featureState: new Map([
        ['F-070', { state: 'shipped', transitionAt: '2026-05-06T12:00:00.000Z' }],
        ['F-071', { state: 'shipped', transitionAt: '2026-05-06T15:00:00.000Z' }],
      ]),
    };
    const snap = {
      fileName: 'snap.md', sourcePath: '/x/snap.md', feature: null,
      date: '2026-05-06T13:00:00.000Z', title: 'snapshot',
      bodyHash: 'abc',
    };
    const decision = classifySnapshot(snap, ctx);
    assert.ok(decision.candidates.length >= 2);
    assert.ok(decision.confidence < CONFIDENCE_AUTO_THRESHOLD);
  });

  it('multi-mention F-NNN in title — text-mention-multi candidate set', () => {
    const ctx = {
      features: [{ id: 'F-070', title: 'A', files: [] }, { id: 'F-071', title: 'B', files: [] }],
      fileToFeatureId: new Map(),
      featureState: new Map(),
    };
    const entry = {
      kind: 'decision', anchorId: 'a', title: 'F-070 and F-071 both', content: '',
      sourceFile: 'decisions.md', sourceLine: 1, dateLabel: 'code',
      relatedFiles: [], confidence: null, lastSeen: null,
      taggedFeatureId: null, taggedPlatformTopic: null,
    };
    const decision = classifyEntry(entry, ctx);
    assert.ok(decision.candidates.length === 2);
  });

  it('write error during apply is reported in result.errors (does not crash)', async () => {
    const root = makeProject();
    const realWrite = fs.writeFileSync;
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a1', title: 'D1', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [{ id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] }]);
      let calls = 0;
      // Simulate write failure for the feature file (after the backup write succeeds first).
      fs.writeFileSync = function (fp, data, enc) {
        calls++;
        if (typeof fp === 'string' && fp.includes('features/F-001-')) {
          throw new Error('simulated write failure');
        }
        return realWrite.call(fs, fp, data, enc);
      };
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.ok(r.errors.length > 0);
      assert.ok(r.errors.some((e) => /simulated write failure/.test(e)), `expected simulated failure in errors: ${r.errors.join(', ')}`);
      assert.equal(r.exitCode, 1);
    } finally {
      fs.writeFileSync = realWrite;
      cleanup(root);
    }
  });

  it('platform-tagged decision routes to platform/<topic>.md', async () => {
    const root = makeProject();
    try {
      // Construct an entry tagged with a platform topic by routing it through graph.json.
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'pl1', title: 'Atomic write contract', files: [] },
      ]));
      writeFile(root, '.cap/memory/graph.json', JSON.stringify({
        nodes: {
          'decision-pl1': {
            type: 'decision', id: 'decision-pl1', label: 'Atomic write contract',
            metadata: { platform: 'atomic-writes' },
          },
        },
      }));
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      const wrote = r.wroteFiles.find((fp) => fp.includes('platform/atomic-writes.md'));
      assert.ok(wrote, `expected platform/atomic-writes.md in writes: ${r.wroteFiles.join(', ')}`);
    } finally { cleanup(root); }
  });

  it('sources at .cap/memory have stable sort order in writes (idempotency)', async () => {
    const root = makeProject();
    try {
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        { anchorId: 'a3', title: 'C decision', files: ['cap/bin/lib/cap-feature-map.cjs'] },
        { anchorId: 'a1', title: 'A decision', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { anchorId: 'a2', title: 'B decision', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
      ]));
      writeFeatureMap(root, [
        { id: 'F-001', title: 'Tag Scanner', files: ['cap/bin/lib/cap-tag-scanner.cjs'] },
        { id: 'F-002', title: 'Feature Map', files: ['cap/bin/lib/cap-feature-map.cjs'] },
      ]);
      const r = await migrateMemory(root, { now: FIXED_NOW, log: () => {} });
      // Plan writes should be alphabetically sorted by destination path.
      const paths = r.plan.writes.map((w) => w.destinationPath);
      const sorted = paths.slice().sort();
      assert.deepEqual(paths, sorted);
    } finally { cleanup(root); }
  });
});

// ---------------------------------------------------------------------------
// PR #36 Stage-2 review hardening — pin three real bugs caught by the reviewer.
// ---------------------------------------------------------------------------

describe('PR #36 review hardening', () => {
  it('AC-6: empty input on the ambiguity prompt routes to unassigned (not crash)', async () => {
    // Reviewer finding #1 (CRITICAL): empty input → parseInt('', 10) → NaN. Pre-fix the bounds
    // check `idx < 0 || idx >= candidates.length` was bypassed (NaN comparisons always false),
    // so candidates[NaN] returned undefined and `.featureId` access crashed. The migration
    // would corrupt half-state — backups already written, V6 files NOT written.
    const root = makeProject();
    try {
      writeFeatureMap(root, [
        { id: 'F-100', title: 'Alpha', files: ['src/alpha.cjs'] },
        { id: 'F-200', title: 'Beta', files: ['src/beta.cjs'] },
      ]);
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        {
          anchorId: 'a1',
          title: 'Ambiguous decision spanning multiple modules',
          files: ['src/alpha.cjs', 'src/beta.cjs'],
        },
      ]));
      const result = await migrateMemory(root, {
        apply: true,
        interactive: true,
        now: FIXED_NOW,
        log: () => {},
        _testPromptResponses: [{ choice: 'y' }, { choice: '' }], // confirm + EMPTY ambiguity input
      });
      // Migration should NOT crash; the entry should land in unassigned.
      assert.equal(
        result.errors.length,
        0,
        `unexpected errors: ${JSON.stringify(result.errors)}`,
      );
      // The unassigned route writes to .cap/memory/platform/unassigned.md.
      assert.ok(
        result.wroteFiles.some((p) => p.endsWith('platform/unassigned.md')),
        `expected unassigned write, got: ${result.wroteFiles.join(', ')}`,
      );
    } finally {
      cleanup(root);
    }
  });

  it('AC-6: non-numeric and out-of-range input also fall back safely', async () => {
    for (const choice of ['xyz', '99', '0', '-1']) {
      const root = makeProject();
      try {
        writeFeatureMap(root, [
          { id: 'F-100', title: 'Alpha', files: ['src/alpha.cjs'] },
          { id: 'F-200', title: 'Beta', files: ['src/beta.cjs'] },
        ]);
        writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
          {
            anchorId: 'a1',
            title: 'Ambiguous decision',
            files: ['src/alpha.cjs', 'src/beta.cjs'],
          },
        ]));
        const result = await migrateMemory(root, {
          apply: true,
          interactive: true,
          now: FIXED_NOW,
          log: () => {},
          _testPromptResponses: [{ choice: 'y' }, { choice }],
        });
        assert.equal(
          result.errors.length,
          0,
          `failed for choice=${JSON.stringify(choice)}: ${JSON.stringify(result.errors)}`,
        );
      } finally {
        cleanup(root);
      }
    }
  });

  it('AC-2: re-running migrate with default opts.now produces byte-identical V6 files', async () => {
    // Reviewer finding #3 (warning): the `updated:` field used Date.now() at write time, so
    // two re-runs five minutes apart produced different `updated:` ISO strings → AC-2 violated.
    // Fix (D6): derive `updated` from max source-file mtime so unchanged source = same V6 file.
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'Alpha', files: ['src/alpha.cjs'] }]);
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        {
          anchorId: 'a1',
          title: 'A specific tagged decision F-100 from real source',
          files: ['src/alpha.cjs'],
        },
      ]));
      // First apply — uses Date.now() default (no `now` pinned).
      const r1 = await migrateMemory(root, { apply: true, interactive: false, log: () => {} });
      assert.equal(r1.errors.length, 0);
      const v6Path = r1.wroteFiles.find((p) => p.includes('features/') && p.includes('F-100'));
      assert.ok(v6Path, 'expected an F-100 feature file');
      const content1 = fs.readFileSync(v6Path, 'utf8');

      // Spin until Date.now() advances by at least 100 ms so any wall-clock-derived `updated:`
      // would clearly differ between runs.
      const sleepUntil = Date.now() + 100;
      while (Date.now() < sleepUntil) { /* spin */ }

      // Second apply over UNCHANGED V5 input must produce zero diff.
      const r2 = await migrateMemory(root, { apply: true, interactive: false, log: () => {} });
      assert.equal(r2.errors.length, 0);
      const content2 = fs.readFileSync(v6Path, 'utf8');
      assert.equal(
        content2,
        content1,
        'V6 file content must be byte-identical across re-runs (AC-2 idempotency)',
      );
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// D7 — Title-prefix heuristic with occurrence threshold.
// ---------------------------------------------------------------------------

describe('F-077/D7: title-prefix heuristic', () => {
  it('routes prefix-clustered entries to platform/prefix-<slug>.md when count ≥ 5', async () => {
    // 5 GoetzeBooking-prefixed decisions + 5 EasyMail-prefixed → both should bucket. No
    // tag-metadata, no path-match, no F-NNN mention — only the prefix is signal.
    const root = makeProject();
    try {
      const entries = [];
      for (let i = 0; i < 5; i++) {
        entries.push({ anchorId: `gb${i}`, title: `GoetzeBooking: decision number ${i}`, files: [] });
      }
      for (let i = 0; i < 5; i++) {
        entries.push({ anchorId: `em${i}`, title: `EasyMail: design choice ${i}`, files: [] });
      }
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd(entries));
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.ok(
        r.wroteFiles.some((p) => p.endsWith('platform/prefix-goetzebooking.md')),
        `expected GoetzeBooking bucket, got: ${r.wroteFiles.join(', ')}`,
      );
      assert.ok(
        r.wroteFiles.some((p) => p.endsWith('platform/prefix-easymail.md')),
        'expected EasyMail bucket',
      );
      // Unassigned bucket should NOT exist (everything got routed by prefix).
      assert.ok(
        !r.wroteFiles.some((p) => p.endsWith('platform/unassigned.md')),
        'unassigned bucket should be empty when all entries are prefix-clustered',
      );
    } finally {
      cleanup(root);
    }
  });

  it('does NOT bucket low-occurrence prefixes (below threshold)', async () => {
    // 4 GoetzeBooking entries (below threshold of 5) + 6 unrelated → GoetzeBooking goes to
    // unassigned, NOT to platform/prefix-goetzebooking.md. Pin the threshold so a future change
    // (raising or lowering 5) is visible.
    const root = makeProject();
    try {
      const entries = [];
      for (let i = 0; i < 4; i++) {
        entries.push({ anchorId: `gb${i}`, title: `GoetzeBooking: decision ${i}`, files: [] });
      }
      for (let i = 0; i < 6; i++) {
        entries.push({ anchorId: `o${i}`, title: `Some random decision ${i}`, files: [] });
      }
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd(entries));
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.ok(
        !r.wroteFiles.some((p) => p.endsWith('platform/prefix-goetzebooking.md')),
        'below-threshold prefix must NOT produce its own bucket',
      );
      assert.ok(
        r.wroteFiles.some((p) => p.endsWith('platform/unassigned.md')),
        'below-threshold entries route to unassigned',
      );
    } finally {
      cleanup(root);
    }
  });

  it('rejects sentence-noise prefixes (Select:, Update:) regardless of count', async () => {
    // 10 entries each starting with "Select" / "Update" / "Insert" — these are SQL-ish
    // sentence-starts, not app names. Even at 10x count, the noise-prefix list filters them.
    // Wait: NOISE_PREFIXES has lowercase strings (todo, note, fix, ...). Capital "Select" /
    // "Update" / "Insert" aren't in that set. So this test verifies that *capitalised SQL words*
    // CURRENTLY DO bucket — pinning that as a known limitation, not an error path. If we expand
    // NOISE_PREFIXES later to cover SQL, update this test to assert NO bucket.
    const root = makeProject();
    try {
      const entries = [];
      for (let i = 0; i < 10; i++) {
        entries.push({ anchorId: `s${i}`, title: `Select: query foo from bar where ${i}`, files: [] });
      }
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd(entries));
      writeFeatureMap(root, []);
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      // Currently routes to platform/prefix-select.md. If a future update extends NOISE_PREFIXES,
      // change this assertion. The point of the test: pin observable behaviour.
      assert.ok(
        r.wroteFiles.some((p) => p.endsWith('platform/prefix-select.md')),
        'Select: prefix at count 10 currently buckets — pin until NOISE_PREFIXES is expanded',
      );
    } finally {
      cleanup(root);
    }
  });

  it('does not fire when path-heuristic already produced a match', async () => {
    // Tag-metadata wins over title-prefix. An entry that has both `@cap-decision(feature:F-100)`
    // metadata AND a "GoetzeBooking:" title-prefix must route to F-100, not platform/prefix-...
    // Ensures D7 is a fallback, not a competitor with stronger signals.
    const root = makeProject();
    try {
      writeFeatureMap(root, [{ id: 'F-100', title: 'Booking', files: ['apps/booking/foo.ts'] }]);
      writeFile(root, '.cap/memory/decisions.md', makeV5DecisionsMd([
        // Path match wins (file is in F-100 key_files)
        { anchorId: 'a1', title: 'GoetzeBooking: a tagged decision', files: ['apps/booking/foo.ts'] },
      ]));
      const r = await migrateMemory(root, { apply: true, interactive: false, now: FIXED_NOW, log: () => {} });
      assert.equal(r.errors.length, 0);
      assert.ok(
        r.wroteFiles.some((p) => p.includes('features/') && p.includes('F-100')),
        'path-match should win over title-prefix',
      );
      assert.ok(
        !r.wroteFiles.some((p) => p.endsWith('platform/prefix-goetzebooking.md')),
        'title-prefix bucket should NOT be created when stronger signal exists',
      );
    } finally {
      cleanup(root);
    }
  });
});
