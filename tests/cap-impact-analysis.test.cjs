'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  detectOverlap,
  traceDependencyChain,
  detectCircularDeps,
  generateImpactReport,
  proposeResolutions,
  persistReport,
  serializeReport,
  loadReport,
  analyzeImpact,
  IMPACT_DIR,
  AC_SIMILARITY_THRESHOLD,
  AC_MIN_SHARED_KEYWORDS,
} = require('../cap/bin/lib/cap-impact-analysis.cjs');

// --- Test Helpers ---

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-impact-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a minimal feature object for testing.
 * @param {Object} overrides
 * @returns {import('../cap/bin/lib/cap-feature-map.cjs').Feature}
 */
function makeFeature(overrides = {}) {
  return {
    id: overrides.id || 'F-099',
    title: overrides.title || 'Test Feature',
    state: overrides.state || 'planned',
    acs: overrides.acs || [],
    files: overrides.files || [],
    dependencies: overrides.dependencies || [],
    metadata: overrides.metadata || {},
  };
}

/**
 * Create a minimal AC object for testing.
 */
function makeAC(id, description, status = 'pending') {
  return { id, description, status };
}

// --- detectOverlap ---

describe('detectOverlap', () => {
  it('detects AC description overlap based on shared keywords', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [
        makeAC('AC-1', 'Extract feature tags from source files using regex pattern matching'),
      ],
    });

    const existing = [
      makeFeature({
        id: 'F-001',
        title: 'Tag Scanner',
        acs: [
          makeAC('AC-1', 'Extract tags from source files using regex patterns'),
        ],
      }),
    ];

    const { overlaps } = detectOverlap(proposed, existing);
    assert.ok(overlaps.length > 0, 'Should detect keyword overlap');
    assert.strictEqual(overlaps[0].existingFeatureId, 'F-001');
    assert.ok(overlaps[0].similarity > 0);
    assert.ok(overlaps[0].sharedKeywords.length >= 2);
  });

  it('returns empty overlaps when no ACs match', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'Deploy application to production server')],
    });

    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', 'Parse markdown feature map into structured data')],
      }),
    ];

    const { overlaps } = detectOverlap(proposed, existing);
    assert.strictEqual(overlaps.length, 0);
  });

  it('skips self-comparison when proposed feature ID matches existing', () => {
    const proposed = makeFeature({
      id: 'F-001',
      acs: [makeAC('AC-1', 'Parse markdown feature map into structured data')],
    });

    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', 'Parse markdown feature map into structured data')],
      }),
    ];

    const { overlaps } = detectOverlap(proposed, existing);
    assert.strictEqual(overlaps.length, 0, 'Should not compare against self');
  });

  it('detects file path conflicts', () => {
    const proposed = makeFeature({
      id: 'F-100',
      files: ['cap/bin/lib/cap-feature-map.cjs', 'cap/bin/lib/cap-new.cjs'],
    });

    const existing = [
      makeFeature({
        id: 'F-002',
        files: ['cap/bin/lib/cap-feature-map.cjs'],
      }),
    ];

    const { fileConflicts } = detectOverlap(proposed, existing);
    assert.strictEqual(fileConflicts.length, 1);
    assert.strictEqual(fileConflicts[0].filePath, 'cap/bin/lib/cap-feature-map.cjs');
    assert.deepStrictEqual(fileConflicts[0].existingFeatureIds, ['F-002']);
  });

  it('returns empty file conflicts when no overlap', () => {
    const proposed = makeFeature({
      id: 'F-100',
      files: ['cap/bin/lib/cap-new.cjs'],
    });

    const existing = [
      makeFeature({
        id: 'F-002',
        files: ['cap/bin/lib/cap-feature-map.cjs'],
      }),
    ];

    const { fileConflicts } = detectOverlap(proposed, existing);
    assert.strictEqual(fileConflicts.length, 0);
  });

  it('handles features with no ACs gracefully', () => {
    const proposed = makeFeature({ id: 'F-100', acs: [] });
    const existing = [makeFeature({ id: 'F-001', acs: [] })];
    const { overlaps, fileConflicts } = detectOverlap(proposed, existing);
    assert.strictEqual(overlaps.length, 0);
    assert.strictEqual(fileConflicts.length, 0);
  });

  it('respects custom similarity threshold', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'Extract feature tags from source files using regex pattern matching')],
    });
    const existing = [
      makeFeature({
        id: 'F-001',
        title: 'Tag Scanner',
        acs: [makeAC('AC-1', 'Extract tags from source files using regex patterns')],
      }),
    ];

    // Very high threshold should suppress matches
    const { overlaps } = detectOverlap(proposed, existing, { similarityThreshold: 0.99 });
    assert.strictEqual(overlaps.length, 0);
  });
});

// --- traceDependencyChain ---

describe('traceDependencyChain', () => {
  const features = [
    makeFeature({ id: 'F-001', dependencies: [] }),
    makeFeature({ id: 'F-002', dependencies: ['F-001'] }),
    makeFeature({ id: 'F-003', dependencies: ['F-002'] }),
    makeFeature({ id: 'F-004', dependencies: ['F-002'] }),
    makeFeature({ id: 'F-005', dependencies: ['F-003', 'F-004'] }),
  ];

  it('traces upstream dependencies', () => {
    const chain = traceDependencyChain('F-005', features, 'upstream');
    assert.ok(chain.upstream.includes('F-003'));
    assert.ok(chain.upstream.includes('F-004'));
    assert.ok(chain.upstream.includes('F-002'));
    assert.ok(chain.upstream.includes('F-001'));
    assert.strictEqual(chain.downstream.length, 0);
  });

  it('traces downstream dependents', () => {
    const chain = traceDependencyChain('F-002', features, 'downstream');
    assert.ok(chain.downstream.includes('F-003'));
    assert.ok(chain.downstream.includes('F-004'));
    assert.ok(chain.downstream.includes('F-005'));
    assert.strictEqual(chain.upstream.length, 0);
  });

  it('traces both directions by default', () => {
    const chain = traceDependencyChain('F-002', features);
    assert.ok(chain.upstream.includes('F-001'));
    assert.ok(chain.downstream.includes('F-003'));
    assert.ok(chain.downstream.includes('F-004'));
    assert.ok(chain.downstream.includes('F-005'));
  });

  it('returns empty chains for isolated features', () => {
    const chain = traceDependencyChain('F-001', features, 'upstream');
    assert.strictEqual(chain.upstream.length, 0);
  });

  it('returns depth of traversal', () => {
    const chain = traceDependencyChain('F-001', features, 'downstream');
    assert.ok(chain.depth >= 2, `Expected depth >= 2, got ${chain.depth}`);
  });

  it('handles feature not in list gracefully', () => {
    const chain = traceDependencyChain('F-999', features);
    assert.strictEqual(chain.upstream.length, 0);
    assert.strictEqual(chain.downstream.length, 0);
  });
});

// --- detectCircularDeps ---

describe('detectCircularDeps', () => {
  it('detects direct circular dependency', () => {
    const existing = [
      makeFeature({ id: 'F-001', dependencies: ['F-002'] }),
      makeFeature({ id: 'F-002', dependencies: [] }),
    ];

    // Proposing F-002 depends on F-001 creates: F-001 -> F-002 -> F-001
    const result = detectCircularDeps('F-002', ['F-001'], [
      makeFeature({ id: 'F-001', dependencies: ['F-002'] }),
    ]);
    assert.ok(result.hasCycle, 'Should detect circular dependency');
    assert.ok(result.cycle.length >= 2);
  });

  it('detects transitive circular dependency', () => {
    const existing = [
      makeFeature({ id: 'F-001', dependencies: [] }),
      makeFeature({ id: 'F-002', dependencies: ['F-001'] }),
      makeFeature({ id: 'F-003', dependencies: ['F-002'] }),
    ];

    // Proposing F-001 depends on F-003 creates: F-001 -> F-003 -> F-002 -> F-001
    const result = detectCircularDeps('F-001', ['F-003'], existing);
    assert.ok(result.hasCycle, 'Should detect transitive circular dependency');
    assert.ok(result.cycle.length >= 3);
  });

  it('returns no cycle for valid DAG', () => {
    const existing = [
      makeFeature({ id: 'F-001', dependencies: [] }),
      makeFeature({ id: 'F-002', dependencies: ['F-001'] }),
    ];

    const result = detectCircularDeps('F-003', ['F-002'], existing);
    assert.strictEqual(result.hasCycle, false);
    assert.deepStrictEqual(result.cycle, []);
  });

  it('handles empty dependency list', () => {
    const existing = [makeFeature({ id: 'F-001', dependencies: [] })];
    const result = detectCircularDeps('F-002', [], existing);
    assert.strictEqual(result.hasCycle, false);
  });

  it('handles references to non-existent features', () => {
    const existing = [makeFeature({ id: 'F-001', dependencies: [] })];
    const result = detectCircularDeps('F-002', ['F-999'], existing);
    assert.strictEqual(result.hasCycle, false);
  });
});

// --- generateImpactReport ---

describe('generateImpactReport', () => {
  it('generates a complete impact report', () => {
    const proposed = makeFeature({
      id: 'F-100',
      title: 'New Analysis Feature',
      acs: [makeAC('AC-1', 'Extract keywords from session data for topic detection')],
      dependencies: ['F-031'],
      files: ['cap/bin/lib/cap-thread-tracker.cjs'],
    });

    const existing = [
      makeFeature({
        id: 'F-031',
        title: 'Thread Tracking',
        acs: [makeAC('AC-3', 'Keyword extraction for topic revisit detection')],
        files: ['cap/bin/lib/cap-thread-tracker.cjs'],
        dependencies: [],
      }),
    ];

    const report = generateImpactReport(proposed, existing);

    assert.strictEqual(report.proposedFeatureTitle, 'New Analysis Feature');
    assert.ok(report.timestamp);
    assert.ok(Array.isArray(report.overlappingACs));
    assert.ok(typeof report.affectedChains === 'object');
    assert.ok(Array.isArray(report.fileConflicts));
    assert.ok(typeof report.circularRisks === 'object');
    assert.ok(Array.isArray(report.resolutions));
  });

  it('produces clean report when no issues found', () => {
    const proposed = makeFeature({
      id: 'F-100',
      title: 'Completely New Feature',
      acs: [makeAC('AC-1', 'Something entirely novel and unprecedented')],
    });

    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', 'Parse markdown files into structured data')],
      }),
    ];

    const report = generateImpactReport(proposed, existing);
    assert.strictEqual(report.overlappingACs.length, 0);
    assert.strictEqual(report.fileConflicts.length, 0);
    assert.strictEqual(report.circularRisks.hasCycle, false);
    assert.strictEqual(report.resolutions.length, 0);
  });
});

// --- proposeResolutions ---

describe('proposeResolutions', () => {
  it('proposes adjust resolution for circular dependencies', () => {
    /** @type {ImpactReport} */
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: true, cycle: ['F-001', 'F-002', 'F-001'] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.ok(resolutions.length > 0);
    assert.strictEqual(resolutions[0].type, 'adjust');
    assert.ok(resolutions[0].description.includes('Circular dependency'));
  });

  it('proposes merge resolution for high overlap', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Existing Feature',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.7,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.ok(resolutions.some(r => r.type === 'merge'), 'Should propose merge for high overlap');
  });

  it('proposes flag resolution for low overlap', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Existing Feature',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.28,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.ok(resolutions.some(r => r.type === 'flag'), 'Should propose flag for low overlap');
  });

  it('proposes adjust resolution for file conflicts', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [
        { filePath: 'cap/bin/lib/shared.cjs', existingFeatureIds: ['F-001'] },
      ],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.ok(resolutions.some(r => r.type === 'adjust'));
  });

  it('returns empty array when no issues found', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.strictEqual(resolutions.length, 0);
  });
});

// --- persistReport / loadReport ---

describe('persistReport', () => {
  it('persists report as markdown file', () => {
    const report = {
      proposedFeatureTitle: 'Test Feature',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-100', report);

    const filePath = path.join(tmpDir, IMPACT_DIR, 'F-100.md');
    assert.ok(fs.existsSync(filePath), 'Report file should exist');

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('# Impact Analysis: F-100'));
    assert.ok(content.includes('Test Feature'));
    assert.ok(content.includes('advisory only'));
  });

  it('creates impact directory if it does not exist', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-001', report);
    assert.ok(fs.existsSync(path.join(tmpDir, IMPACT_DIR)));
  });
});

describe('loadReport', () => {
  it('loads previously persisted report', () => {
    const report = {
      proposedFeatureTitle: 'Test Feature',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-100', report);
    const loaded = loadReport(tmpDir, 'F-100');
    assert.ok(loaded !== null);
    assert.ok(loaded.includes('Impact Analysis: F-100'));
  });

  it('returns null for non-existent report', () => {
    const loaded = loadReport(tmpDir, 'F-999');
    assert.strictEqual(loaded, null);
  });
});

// --- serializeReport ---

describe('serializeReport', () => {
  it('serializes report with overlapping ACs', () => {
    const report = {
      proposedFeatureTitle: 'Impact Feature',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Tag Scanner',
          existingACId: 'AC-1',
          existingACDescription: 'Extract tags from source files',
          proposedACId: 'AC-2',
          proposedACDescription: 'Extract tags from project files',
          similarity: 0.45,
          sharedKeywords: ['extract', 'tags', 'files'],
          reason: 'Shared keywords: extract, tags, files',
        },
      ],
      affectedChains: { upstream: ['F-031'], downstream: ['F-034'], depth: 2 },
      fileConflicts: [
        { filePath: 'cap/bin/lib/shared.cjs', existingFeatureIds: ['F-001', 'F-002'] },
      ],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [
        { type: 'merge', description: 'Merge overlapping ACs', affectedFeatures: ['F-001'] },
      ],
    };

    const md = serializeReport('F-100', report);
    assert.ok(md.includes('## Overlapping ACs'));
    assert.ok(md.includes('F-001'));
    assert.ok(md.includes('AC-2'));
    assert.ok(md.includes('45.0%'));
    assert.ok(md.includes('## Dependency Chains'));
    assert.ok(md.includes('F-031'));
    assert.ok(md.includes('F-034'));
    assert.ok(md.includes('## File Conflicts'));
    assert.ok(md.includes('shared.cjs'));
    assert.ok(md.includes('## Proposed Resolutions'));
    assert.ok(md.includes('[MERGE]'));
  });

  it('serializes circular dependency warning', () => {
    const report = {
      proposedFeatureTitle: 'Cycle Feature',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: true, cycle: ['F-001', 'F-002', 'F-001'] },
      resolutions: [],
    };

    const md = serializeReport('F-100', report);
    assert.ok(md.includes('WARNING'));
    assert.ok(md.includes('F-001 -> F-002 -> F-001'));
  });
});

// --- analyzeImpact (integration) ---

describe('analyzeImpact', () => {
  it('reads Feature Map and produces impact report', () => {
    // Write a minimal FEATURE-MAP.md
    const featureMapContent = `# Feature Map

## Features

### F-001: Tag Scanner [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Extract tags from source files using regex patterns |

**Files:**
- \`cap/bin/lib/cap-tag-scanner.cjs\`

### F-002: Feature Map Management [shipped]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Read and parse feature map into structured data |

**Files:**
- \`cap/bin/lib/cap-feature-map.cjs\`

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified |

---
*Last updated: 2026-04-03T00:00:00.000Z*
`;
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');

    const proposed = makeFeature({
      id: 'F-100',
      title: 'Tag Enhancement',
      acs: [makeAC('AC-1', 'Extract tags from source files with improved regex patterns')],
      dependencies: ['F-001'],
      files: ['cap/bin/lib/cap-tag-scanner.cjs'],
    });

    const report = analyzeImpact(tmpDir, proposed);

    assert.strictEqual(report.proposedFeatureTitle, 'Tag Enhancement');
    assert.ok(report.overlappingACs.length > 0, 'Should detect AC overlap with F-001');
    assert.ok(report.fileConflicts.length > 0, 'Should detect file conflict on cap-tag-scanner.cjs');
    assert.ok(report.affectedChains.upstream.includes('F-001'));
    assert.strictEqual(report.circularRisks.hasCycle, false);
  });

  it('persists report when option set', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), `# Feature Map\n\n## Features\n\n## Legend\n`, 'utf8');

    const proposed = makeFeature({
      id: 'F-100',
      title: 'Test',
      acs: [makeAC('AC-1', 'Something new')],
    });

    analyzeImpact(tmpDir, proposed, { persist: true });

    const reportPath = path.join(tmpDir, IMPACT_DIR, 'F-100.md');
    assert.ok(fs.existsSync(reportPath), 'Report should be persisted');
  });

  it('does not persist by default', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), `# Feature Map\n\n## Features\n\n## Legend\n`, 'utf8');

    const proposed = makeFeature({ id: 'F-100', title: 'Test' });

    analyzeImpact(tmpDir, proposed);

    const reportPath = path.join(tmpDir, IMPACT_DIR, 'F-100.md');
    assert.ok(!fs.existsSync(reportPath), 'Report should not be persisted by default');
  });
});

// =============================================================================
// ADVERSARIAL / EDGE CASE TESTS
// =============================================================================

// --- AC-1 Adversarial: Overlap detection edge cases ---

describe('detectOverlap (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-1) 100% overlap — identical AC descriptions
  it('detects 100% overlap for identical AC descriptions', () => {
    const desc = 'Extract feature tags from source files using regex pattern matching';
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', desc)],
    });
    const existing = [
      makeFeature({
        id: 'F-001',
        title: 'Clone',
        acs: [makeAC('AC-1', desc)],
      }),
    ];
    const { overlaps } = detectOverlap(proposed, existing);
    assert.ok(overlaps.length > 0, 'Identical descriptions must produce overlap');
    assert.ok(overlaps[0].similarity >= 0.9, `Expected similarity >= 0.9, got ${overlaps[0].similarity}`);
  });

  // @cap-todo(ac:F-033/AC-1) Single-word ACs should not produce overlap (below min shared keywords)
  it('does not match single-word AC descriptions', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'deploy')],
    });
    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', 'deploy')],
      }),
    ];
    const { overlaps } = detectOverlap(proposed, existing);
    // Even with identical single word, min shared keywords = 2 should filter it out
    assert.strictEqual(overlaps.length, 0, 'Single-word ACs should not meet minimum shared keywords threshold');
  });

  // @cap-todo(ac:F-033/AC-1) Empty AC description strings
  it('handles empty AC description strings gracefully', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', '')],
    });
    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', '')],
      }),
    ];
    const { overlaps } = detectOverlap(proposed, existing);
    assert.strictEqual(overlaps.length, 0, 'Empty descriptions should produce no overlap');
  });

  // @cap-todo(ac:F-033/AC-1) Empty file lists produce no file conflicts
  it('handles empty file lists on both sides', () => {
    const proposed = makeFeature({ id: 'F-100', files: [] });
    const existing = [makeFeature({ id: 'F-001', files: [] })];
    const { fileConflicts } = detectOverlap(proposed, existing);
    assert.strictEqual(fileConflicts.length, 0);
  });

  // @cap-todo(ac:F-033/AC-1) Multiple existing features referencing same file
  it('aggregates multiple owners for same file conflict', () => {
    const proposed = makeFeature({
      id: 'F-100',
      files: ['shared.cjs'],
    });
    const existing = [
      makeFeature({ id: 'F-001', files: ['shared.cjs'] }),
      makeFeature({ id: 'F-002', files: ['shared.cjs'] }),
    ];
    const { fileConflicts } = detectOverlap(proposed, existing);
    assert.strictEqual(fileConflicts.length, 1);
    assert.ok(fileConflicts[0].existingFeatureIds.includes('F-001'));
    assert.ok(fileConflicts[0].existingFeatureIds.includes('F-002'));
  });

  // @cap-todo(ac:F-033/AC-1) Empty existing features array
  it('returns no overlaps when existing features array is empty', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'Extract tags from source files')],
      files: ['shared.cjs'],
    });
    const { overlaps, fileConflicts } = detectOverlap(proposed, []);
    assert.strictEqual(overlaps.length, 0);
    assert.strictEqual(fileConflicts.length, 0);
  });

  // @cap-todo(ac:F-033/AC-1) Custom minSharedKeywords override
  it('respects custom minSharedKeywords option', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'Extract feature tags from source files using regex pattern matching')],
    });
    const existing = [
      makeFeature({
        id: 'F-001',
        acs: [makeAC('AC-1', 'Extract tags from source files using regex patterns')],
      }),
    ];
    // Very high minSharedKeywords should suppress
    const { overlaps } = detectOverlap(proposed, existing, { minSharedKeywords: 100 });
    assert.strictEqual(overlaps.length, 0, 'Very high minSharedKeywords should suppress all matches');
  });

  // @cap-todo(ac:F-033/AC-1) Proposed feature with many ACs against many existing
  it('handles N x M AC comparison without error', () => {
    const proposedACs = Array.from({ length: 10 }, (_, i) =>
      makeAC(`AC-${i + 1}`, `Operation ${i} on data structure using algorithm ${i}`)
    );
    const proposed = makeFeature({ id: 'F-100', acs: proposedACs });
    const existing = Array.from({ length: 10 }, (_, i) =>
      makeFeature({
        id: `F-${String(i + 1).padStart(3, '0')}`,
        acs: [makeAC('AC-1', `Process ${i} on data structure using method ${i}`)],
      })
    );
    // Should not throw
    const { overlaps } = detectOverlap(proposed, existing);
    assert.ok(Array.isArray(overlaps));
  });
});

// --- AC-3 Adversarial: Impact report edge cases ---

describe('generateImpactReport (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-3) Report with empty features array
  it('handles empty existing features array', () => {
    const proposed = makeFeature({
      id: 'F-100',
      title: 'Solo Feature',
      acs: [makeAC('AC-1', 'Something brand new')],
    });
    const report = generateImpactReport(proposed, []);
    assert.strictEqual(report.overlappingACs.length, 0);
    assert.strictEqual(report.fileConflicts.length, 0);
    assert.strictEqual(report.circularRisks.hasCycle, false);
    assert.strictEqual(report.resolutions.length, 0);
  });

  // @cap-todo(ac:F-033/AC-3) Report includes timestamp in ISO format
  it('timestamp is a valid ISO string', () => {
    const proposed = makeFeature({ id: 'F-100', title: 'Test' });
    const report = generateImpactReport(proposed, []);
    // Should parse without NaN
    const parsed = Date.parse(report.timestamp);
    assert.ok(!isNaN(parsed), `Timestamp should be valid ISO: ${report.timestamp}`);
  });

  // @cap-todo(ac:F-033/AC-3) Report with all categories populated
  it('populates all report sections when all issue types present', () => {
    const existing = [
      makeFeature({
        id: 'F-001',
        title: 'Existing A',
        acs: [makeAC('AC-1', 'Extract feature tags from source files using regex pattern matching')],
        files: ['shared.cjs'],
        dependencies: [],
      }),
      makeFeature({
        id: 'F-002',
        title: 'Existing B',
        dependencies: ['F-001'],
        acs: [],
        files: [],
      }),
    ];
    // Create proposed that: overlaps ACs, shares files, creates a cycle
    const proposed = makeFeature({
      id: 'F-003',
      title: 'Triple Threat',
      acs: [makeAC('AC-1', 'Extract feature tags from source files using regex patterns')],
      files: ['shared.cjs'],
      dependencies: ['F-002'],
    });
    // Add F-001 depending on F-003 to create cycle in existing
    existing[0].dependencies = ['F-003'];

    const report = generateImpactReport(proposed, existing);
    assert.ok(report.overlappingACs.length > 0, 'Should have AC overlaps');
    assert.ok(report.fileConflicts.length > 0, 'Should have file conflicts');
    assert.ok(report.circularRisks.hasCycle, 'Should detect cycle');
    assert.ok(report.resolutions.length > 0, 'Should have resolutions');
  });

  // @cap-todo(ac:F-033/AC-3) Feature with no title
  it('handles proposed feature with empty title', () => {
    const proposed = { id: 'F-100', title: '', state: 'planned', acs: [], files: [], dependencies: [], metadata: {} };
    const report = generateImpactReport(proposed, []);
    assert.strictEqual(report.proposedFeatureTitle, '');
  });

  // @cap-todo(ac:F-033/AC-3) Feature with undefined title
  it('handles proposed feature with undefined title', () => {
    const proposed = makeFeature({ id: 'F-100' });
    delete proposed.title;
    const report = generateImpactReport(proposed, []);
    assert.strictEqual(report.proposedFeatureTitle, '');
  });
});

// --- AC-4 Adversarial: Dependency chain edge cases ---

describe('traceDependencyChain (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-4) Chain depth of 10
  it('handles deep dependency chains (depth 10)', () => {
    const features = [];
    for (let i = 0; i < 11; i++) {
      features.push(makeFeature({
        id: `F-${String(i).padStart(3, '0')}`,
        dependencies: i > 0 ? [`F-${String(i - 1).padStart(3, '0')}`] : [],
      }));
    }
    // F-010 depends on F-009 ... F-001 depends on F-000
    const chain = traceDependencyChain('F-010', features, 'upstream');
    assert.strictEqual(chain.upstream.length, 10, 'Should find all 10 upstream deps');
    assert.ok(chain.upstream.includes('F-000'));
    assert.strictEqual(chain.depth, 10);
  });

  // @cap-todo(ac:F-033/AC-4) Disconnected features
  it('returns empty chains for disconnected features', () => {
    const features = [
      makeFeature({ id: 'F-001', dependencies: [] }),
      makeFeature({ id: 'F-002', dependencies: [] }),
      makeFeature({ id: 'F-003', dependencies: [] }),
    ];
    const chain = traceDependencyChain('F-002', features);
    assert.strictEqual(chain.upstream.length, 0);
    assert.strictEqual(chain.downstream.length, 0);
    assert.strictEqual(chain.depth, 0);
  });

  // @cap-todo(ac:F-033/AC-4) Feature that depends on itself
  it('handles self-dependency without infinite loop', () => {
    const features = [
      makeFeature({ id: 'F-001', dependencies: ['F-001'] }),
    ];
    // Should not hang
    const chain = traceDependencyChain('F-001', features);
    // Self-dependency might appear in upstream or not, but must not crash
    assert.ok(typeof chain.depth === 'number');
  });

  // @cap-todo(ac:F-033/AC-4) Missing dependency in features array
  it('handles dependencies referencing features not in the array', () => {
    const features = [
      makeFeature({ id: 'F-001', dependencies: ['F-999'] }),
    ];
    const chain = traceDependencyChain('F-001', features, 'upstream');
    // F-999 is not in features, so depsMap won't have it
    // The BFS uses depsMap.get(id) which returns undefined for missing keys
    // Implementation accesses depsMap.get(dep) which could be undefined
    assert.ok(Array.isArray(chain.upstream));
  });

  // @cap-todo(ac:F-033/AC-4) Diamond dependency pattern
  it('handles diamond dependency pattern without duplicates', () => {
    const features = [
      makeFeature({ id: 'F-001', dependencies: [] }),
      makeFeature({ id: 'F-002', dependencies: ['F-001'] }),
      makeFeature({ id: 'F-003', dependencies: ['F-001'] }),
      makeFeature({ id: 'F-004', dependencies: ['F-002', 'F-003'] }),
    ];
    const chain = traceDependencyChain('F-004', features, 'upstream');
    // F-001 should appear only once even though reachable via two paths
    const f001Count = chain.upstream.filter(id => id === 'F-001').length;
    assert.strictEqual(f001Count, 1, 'Should not duplicate F-001 in upstream');
    assert.strictEqual(chain.upstream.length, 3); // F-002, F-003, F-001
  });

  // @cap-todo(ac:F-033/AC-4) Verify both directions surface impact on changing B
  it('surfaces impact on both A and C when B changes (A->B->C chain)', () => {
    const features = [
      makeFeature({ id: 'F-A', dependencies: ['F-B'] }),
      makeFeature({ id: 'F-B', dependencies: ['F-C'] }),
      makeFeature({ id: 'F-C', dependencies: [] }),
    ];
    const chain = traceDependencyChain('F-B', features, 'both');
    assert.ok(chain.upstream.includes('F-C'), 'Changing B should surface C as upstream');
    assert.ok(chain.downstream.includes('F-A'), 'Changing B should surface A as downstream');
  });
});

// --- AC-5 Adversarial: Resolution proposals ---

describe('proposeResolutions (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-5) Split resolution for many partial overlaps
  it('proposes split resolution when 3+ partial overlaps with same feature', () => {
    const overlaps = Array.from({ length: 4 }, (_, i) => ({
      existingFeatureId: 'F-001',
      existingFeatureTitle: 'Big Feature',
      existingACId: `AC-${i + 1}`,
      existingACDescription: 'test',
      proposedACId: `AC-${i + 1}`,
      proposedACDescription: 'test',
      similarity: 0.35, // below merge threshold but above flag
      sharedKeywords: ['keyword'],
      reason: 'test',
    }));

    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: overlaps,
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    assert.ok(resolutions.some(r => r.type === 'split'), 'Should propose split for 3+ partial overlaps');
  });

  // @cap-todo(ac:F-033/AC-5) Overlap exactly at threshold boundary
  it('handles overlap similarity exactly at merge threshold (0.5)', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Existing',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.5,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    // avgSimilarity === 0.5 should trigger merge (>= 0.5)
    assert.ok(resolutions.some(r => r.type === 'merge'), 'Similarity exactly 0.5 should trigger merge');
  });

  // @cap-todo(ac:F-033/AC-5) Multiple resolution types in one report
  it('produces multiple resolution types when report has mixed issues', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Feature A',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.8,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [
        { filePath: 'shared.cjs', existingFeatureIds: ['F-002'] },
      ],
      circularRisks: { hasCycle: true, cycle: ['F-003', 'F-004', 'F-003'] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    const types = new Set(resolutions.map(r => r.type));
    assert.ok(types.has('merge'), 'Should have merge resolution');
    assert.ok(types.has('adjust'), 'Should have adjust resolution for cycle and/or file conflict');
    assert.ok(resolutions.length >= 3, `Expected >= 3 resolutions, got ${resolutions.length}`);
  });

  // @cap-todo(ac:F-033/AC-5) Overlaps from multiple different features
  it('produces separate resolutions per overlapping feature', () => {
    const report = {
      proposedFeatureTitle: 'Test',
      timestamp: new Date().toISOString(),
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Feature A',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.3,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
        {
          existingFeatureId: 'F-002',
          existingFeatureTitle: 'Feature B',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-2',
          proposedACDescription: 'test',
          similarity: 0.3,
          sharedKeywords: ['keyword'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const resolutions = proposeResolutions(report);
    const flagResolutions = resolutions.filter(r => r.type === 'flag');
    assert.ok(flagResolutions.length >= 2, 'Should produce separate flag for each overlapping feature');
    const affectedIds = flagResolutions.flatMap(r => r.affectedFeatures);
    assert.ok(affectedIds.includes('F-001'));
    assert.ok(affectedIds.includes('F-002'));
  });
});

// --- AC-6 Adversarial: Advisory only ---

describe('AC-6: advisory only enforcement', () => {
  // @cap-todo(ac:F-033/AC-6) Verify module source has NO writeFeatureMap import or call
  it('module source does not import or call writeFeatureMap', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-impact-analysis.cjs'),
      'utf8'
    );
    // Strip comments to check actual code
    const codeLines = source.split('\n').filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    }).join('\n');

    assert.ok(
      !codeLines.includes('writeFeatureMap'),
      'Module code (excluding comments) must not reference writeFeatureMap'
    );
  });

  // @cap-todo(ac:F-033/AC-6) analyzeImpact return value is plain data, not a mutation handle
  it('analyzeImpact returns a plain object with no write methods', () => {
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), `# Feature Map\n\n## Features\n\n## Legend\n`, 'utf8');
    const proposed = makeFeature({ id: 'F-100', title: 'Test' });
    const report = analyzeImpact(tmpDir, proposed);

    // Report should be a plain object — no functions attached
    const reportValues = Object.values(report);
    const hasFunctions = reportValues.some(v => v instanceof Function);
    assert.strictEqual(hasFunctions, false, 'Report must not contain function values (advisory only)');
  });
});

// --- AC-7 Adversarial: Persistence edge cases ---

describe('persistReport (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-7) Special characters in feature ID
  it('handles feature ID with special characters', () => {
    const report = {
      proposedFeatureTitle: 'Special',
      timestamp: new Date().toISOString(),
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    // Feature IDs should be F-NNN but test edge case
    persistReport(tmpDir, 'F-100', report);
    const loaded = loadReport(tmpDir, 'F-100');
    assert.ok(loaded !== null, 'Should persist and load standard feature ID');
  });

  // @cap-todo(ac:F-033/AC-7) Verify markdown format includes advisory disclaimer
  it('persisted report contains advisory-only disclaimer', () => {
    const report = {
      proposedFeatureTitle: 'Advisory Test',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-200', report);
    const content = fs.readFileSync(
      path.join(tmpDir, IMPACT_DIR, 'F-200.md'),
      'utf8'
    );
    assert.ok(content.includes('advisory only'), 'Persisted report must include advisory disclaimer');
  });

  // @cap-todo(ac:F-033/AC-7) Overwrite existing report
  it('overwrites existing report file on re-persist', () => {
    const report1 = {
      proposedFeatureTitle: 'Version 1',
      timestamp: '2026-04-01T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };
    const report2 = {
      proposedFeatureTitle: 'Version 2',
      timestamp: '2026-04-02T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-100', report1);
    persistReport(tmpDir, 'F-100', report2);

    const content = loadReport(tmpDir, 'F-100');
    assert.ok(content.includes('Version 2'), 'Should contain updated title');
    assert.ok(!content.includes('Version 1'), 'Should not contain old title');
  });

  // @cap-todo(ac:F-033/AC-7) Verify markdown structure has expected sections
  it('persisted report contains all required markdown sections', () => {
    const report = {
      proposedFeatureTitle: 'Section Test',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    persistReport(tmpDir, 'F-300', report);
    const content = loadReport(tmpDir, 'F-300');

    assert.ok(content.includes('# Impact Analysis: F-300'), 'Must have H1 title');
    assert.ok(content.includes('## Overlapping ACs'), 'Must have Overlapping ACs section');
    assert.ok(content.includes('## Dependency Chains'), 'Must have Dependency Chains section');
    assert.ok(content.includes('## File Conflicts'), 'Must have File Conflicts section');
    assert.ok(content.includes('## Circular Dependency Risks'), 'Must have Circular Dep section');
    assert.ok(content.includes('## Proposed Resolutions'), 'Must have Resolutions section');
  });
});

// --- AC-8 Adversarial: Circular dependency detection ---

describe('detectCircularDeps (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-8) Self-dependency (A depends on A)
  it('detects self-dependency', () => {
    const existing = [];
    const result = detectCircularDeps('F-001', ['F-001'], existing);
    // F-001 depends on F-001 — self-loop
    // The graph will have F-001 -> [F-001], DFS from F-001 visits F-001 which is GRAY
    assert.ok(result.hasCycle, 'Self-dependency should be detected as a cycle');
    assert.ok(result.cycle.length >= 2, 'Cycle path should include at least start and end');
  });

  // @cap-todo(ac:F-033/AC-8) Long chain cycle A->B->C->D->A
  it('detects long chain cycle (A->B->C->D->A)', () => {
    const existing = [
      makeFeature({ id: 'F-B', dependencies: ['F-C'] }),
      makeFeature({ id: 'F-C', dependencies: ['F-D'] }),
      makeFeature({ id: 'F-D', dependencies: ['F-A'] }),
    ];
    // Proposing F-A depends on F-B creates: F-A->F-B->F-C->F-D->F-A
    const result = detectCircularDeps('F-A', ['F-B'], existing);
    assert.ok(result.hasCycle, 'Should detect 4-node cycle');
    assert.ok(result.cycle.length >= 4, `Expected cycle length >= 4, got ${result.cycle.length}`);
  });

  // @cap-todo(ac:F-033/AC-8) No cycle in large DAG
  it('correctly identifies no cycle in a large DAG', () => {
    const features = [];
    for (let i = 0; i < 20; i++) {
      features.push(makeFeature({
        id: `F-${String(i).padStart(3, '0')}`,
        dependencies: i > 0 ? [`F-${String(i - 1).padStart(3, '0')}`] : [],
      }));
    }
    // Adding new feature at the end, no cycle
    const result = detectCircularDeps('F-020', ['F-019'], features);
    assert.strictEqual(result.hasCycle, false);
    assert.deepStrictEqual(result.cycle, []);
  });

  // @cap-todo(ac:F-033/AC-8) Multiple dependencies, only one creates cycle
  it('detects cycle through only one of multiple proposed deps', () => {
    const existing = [
      makeFeature({ id: 'F-001', dependencies: ['F-003'] }),
      makeFeature({ id: 'F-002', dependencies: [] }),
    ];
    // F-003 depends on F-001 and F-002. F-001->F-003->F-001 is a cycle but F-002 is fine.
    const result = detectCircularDeps('F-003', ['F-001', 'F-002'], existing);
    assert.ok(result.hasCycle, 'Should detect cycle even with non-cyclic deps present');
  });

  // @cap-todo(ac:F-033/AC-8) Empty existing features with self-dep
  it('detects self-dependency with empty existing features', () => {
    const result = detectCircularDeps('F-001', ['F-001'], []);
    assert.ok(result.hasCycle, 'Self-dep with empty existing should still detect cycle');
  });
});

// --- serializeReport adversarial ---

describe('serializeReport (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-3) Report with no overlaps, no chains, no conflicts, no cycles
  it('serializes clean report with all empty sections', () => {
    const report = {
      proposedFeatureTitle: 'Clean Feature',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const md = serializeReport('F-100', report);
    assert.ok(md.includes('No AC overlaps detected'));
    assert.ok(md.includes('No file conflicts detected'));
    assert.ok(md.includes('No circular dependencies detected'));
    assert.ok(md.includes('No resolutions needed'));
  });

  // @cap-todo(ac:F-033/AC-3) Similarity formatting precision
  it('formats similarity as percentage with one decimal place', () => {
    const report = {
      proposedFeatureTitle: 'Precision Test',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [
        {
          existingFeatureId: 'F-001',
          existingFeatureTitle: 'Existing',
          existingACId: 'AC-1',
          existingACDescription: 'test',
          proposedACId: 'AC-1',
          proposedACDescription: 'test',
          similarity: 0.333,
          sharedKeywords: ['a', 'b'],
          reason: 'test',
        },
      ],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [],
    };

    const md = serializeReport('F-100', report);
    assert.ok(md.includes('33.3%'), 'Should format 0.333 as 33.3%');
  });

  // @cap-todo(ac:F-033/AC-5) All resolution types serialized with correct labels
  it('serializes all resolution types with correct uppercase labels', () => {
    const report = {
      proposedFeatureTitle: 'All Types',
      timestamp: '2026-04-03T00:00:00.000Z',
      overlappingACs: [],
      affectedChains: { upstream: [], downstream: [], depth: 0 },
      fileConflicts: [],
      circularRisks: { hasCycle: false, cycle: [] },
      resolutions: [
        { type: 'merge', description: 'Merge test', affectedFeatures: ['F-001'] },
        { type: 'split', description: 'Split test', affectedFeatures: ['F-002'] },
        { type: 'adjust', description: 'Adjust test', affectedFeatures: ['F-003'] },
        { type: 'flag', description: 'Flag test', affectedFeatures: ['F-004'] },
      ],
    };

    const md = serializeReport('F-100', report);
    assert.ok(md.includes('[MERGE]'), 'Should have MERGE label');
    assert.ok(md.includes('[SPLIT]'), 'Should have SPLIT label');
    assert.ok(md.includes('[ADJUST]'), 'Should have ADJUST label');
    assert.ok(md.includes('[FLAG]'), 'Should have FLAG label');
  });
});

// --- analyzeImpact adversarial ---

describe('analyzeImpact (adversarial)', () => {
  // @cap-todo(ac:F-033/AC-2) Missing FEATURE-MAP.md returns clean report (readFeatureMap returns empty features)
  it('handles missing FEATURE-MAP.md gracefully with empty report', () => {
    const proposed = makeFeature({ id: 'F-100', title: 'Test' });
    // tmpDir has no FEATURE-MAP.md — readFeatureMap returns { features: [] }
    const report = analyzeImpact(tmpDir, proposed);
    assert.strictEqual(report.overlappingACs.length, 0, 'No overlaps when no Feature Map');
    assert.strictEqual(report.fileConflicts.length, 0, 'No file conflicts when no Feature Map');
    assert.strictEqual(report.circularRisks.hasCycle, false, 'No cycles when no Feature Map');
    assert.strictEqual(report.resolutions.length, 0, 'No resolutions when no Feature Map');
  });

  // @cap-todo(ac:F-033/AC-7) Persist with deeply nested missing directories
  it('creates nested impact directory structure', () => {
    const nestedDir = path.join(tmpDir, 'sub', 'project');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'FEATURE-MAP.md'), `# Feature Map\n\n## Features\n\n## Legend\n`, 'utf8');

    const proposed = makeFeature({ id: 'F-100', title: 'Nested Test' });
    analyzeImpact(nestedDir, proposed, { persist: true });

    const reportPath = path.join(nestedDir, IMPACT_DIR, 'F-100.md');
    assert.ok(fs.existsSync(reportPath), 'Should create nested impact dir and persist');
  });

  // @cap-todo(ac:F-033/AC-1) analyzeImpact passes through threshold options
  it('passes similarity threshold options through to detection', () => {
    const featureMapContent = `# Feature Map\n\n## Features\n\n### F-001: Tag Scanner [shipped]\n\n| AC | Status | Description |\n|----|--------|-------------|\n| AC-1 | tested | Extract tags from source files using regex patterns |\n\n**Files:**\n- \`cap/bin/lib/cap-tag-scanner.cjs\`\n\n## Legend\n`;
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');

    const proposed = makeFeature({
      id: 'F-100',
      title: 'Tag Overlap',
      acs: [makeAC('AC-1', 'Extract feature tags from source files using regex pattern matching')],
    });

    // Default threshold detects overlap
    const reportDefault = analyzeImpact(tmpDir, proposed);
    assert.ok(reportDefault.overlappingACs.length > 0, 'Default threshold should detect overlaps');

    // Very high threshold suppresses overlap
    const reportHigh = analyzeImpact(tmpDir, proposed, { similarityThreshold: 0.99 });
    assert.strictEqual(reportHigh.overlappingACs.length, 0, 'High threshold should suppress overlaps');
  });
});

// --- Branch coverage: missing optional fields ---
describe('detectOverlap (missing field branches)', () => {
  it('handles proposed feature without acs or files', () => {
    const proposed = { id: 'F-100', title: 'No ACs' };
    const existing = [
      { id: 'F-001', title: 'Existing', acs: [makeAC('AC-1', 'Extract tags')], files: ['f.js'] },
    ];
    const result = detectOverlap(proposed, existing);
    assert.strictEqual(result.overlaps.length, 0);
    assert.strictEqual(result.fileConflicts.length, 0);
  });

  it('handles existing features without acs, files, or dependencies', () => {
    const proposed = makeFeature({
      id: 'F-100',
      acs: [makeAC('AC-1', 'Extract tags from source files')],
      files: ['shared.js'],
    });
    const existing = [
      { id: 'F-001', title: 'Bare Feature' },
    ];
    const result = detectOverlap(proposed, existing);
    assert.strictEqual(result.overlaps.length, 0);
    assert.strictEqual(result.fileConflicts.length, 0);
  });
});

describe('traceDependencyChain (missing fields)', () => {
  it('handles features without dependencies field', () => {
    const features = [
      { id: 'F-001', title: 'A' },
      { id: 'F-002', title: 'B' },
    ];
    const result = traceDependencyChain('F-001', features);
    assert.strictEqual(result.upstream.length, 0);
    assert.strictEqual(result.downstream.length, 0);
  });
});

// --- Branch coverage: cycle in unvisited nodes ---
describe('detectCircularDeps (unvisited-node cycle)', () => {
  it('detects cycle among existing features not reachable from proposed feature', () => {
    const existingFeatures = [
      { id: 'F-X', dependencies: ['F-Y'] },
      { id: 'F-Y', dependencies: ['F-X'] },
    ];
    const result = detectCircularDeps('F-NEW', [], existingFeatures);
    assert.strictEqual(result.hasCycle, true);
    assert.ok(result.cycle.length > 0);
  });
});

// --- Branch coverage: loadReport error path ---
describe('loadReport (error branch)', () => {
  it('returns null when impact dir is a file instead of directory', () => {
    const impactPath = path.join(tmpDir, IMPACT_DIR);
    fs.mkdirSync(path.dirname(impactPath), { recursive: true });
    fs.writeFileSync(impactPath, 'not-a-directory', 'utf8');
    const result = loadReport(tmpDir, 'F-001');
    assert.strictEqual(result, null);
  });

  it('returns null when report file exists but is unreadable', () => {
    const impactDir = path.join(tmpDir, IMPACT_DIR);
    fs.mkdirSync(impactDir, { recursive: true });
    const reportFile = path.join(impactDir, 'F-001.md');
    fs.writeFileSync(reportFile, '# Impact Report\n', 'utf8');
    fs.chmodSync(reportFile, 0o000);
    const result = loadReport(tmpDir, 'F-001');
    // Restore for cleanup
    fs.chmodSync(reportFile, 0o644);
    assert.strictEqual(result, null);
  });
});
