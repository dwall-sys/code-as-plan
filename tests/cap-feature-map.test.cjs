'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  FEATURE_MAP_FILE,
  VALID_STATES,
  generateTemplate,
  readFeatureMap,
  writeFeatureMap,
  parseFeatureMapContent,
  addFeature,
  updateFeatureState,
  enrichFromTags,
  enrichFromDeps,
  getNextFeatureId,
  enrichFromScan,
  addFeatures,
  getStatus,
} = require('../get-shit-done/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Helper to write a sample FEATURE-MAP.md ---

function writeSampleFeatureMap(dir, features) {
  const featureMap = { features, lastScan: null };
  writeFeatureMap(dir, featureMap);
}

// --- generateTemplate tests ---

describe('generateTemplate', () => {
  // @gsd-todo(ref:AC-1) FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries
  it('contains Features section header', () => {
    const template = generateTemplate();
    assert.ok(template.includes('## Features'));
  });

  it('contains Legend section header', () => {
    const template = generateTemplate();
    assert.ok(template.includes('## Legend'));
  });

  it('contains no feature entries', () => {
    const template = generateTemplate();
    assert.ok(!template.includes('### F-'));
  });

  it('contains lifecycle states in Legend', () => {
    const template = generateTemplate();
    assert.ok(template.includes('planned'));
    assert.ok(template.includes('prototyped'));
    assert.ok(template.includes('tested'));
    assert.ok(template.includes('shipped'));
  });
});

// --- readFeatureMap tests ---

describe('readFeatureMap', () => {
  // @gsd-todo(ref:AC-10) Feature Map is the single source of truth
  it('parses features from valid FEATURE-MAP.md', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001',
      title: 'Initialize project',
      state: 'planned',
      acs: [{ id: 'AC-1', description: 'Creates config file', status: 'pending' }],
      files: [],
      dependencies: [],
      metadata: {},
    }]);
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features.length, 1);
    assert.strictEqual(result.features[0].id, 'F-001');
    assert.strictEqual(result.features[0].title, 'Initialize project');
    assert.strictEqual(result.features[0].state, 'planned');
  });

  it('returns empty feature map when file is missing', () => {
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features.length, 0);
    assert.strictEqual(result.lastScan, null);
  });

  // @gsd-todo(ref:AC-8) Each feature entry contains: feature ID, title, state, ACs, file references
  it('parses AC status from table rows', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001',
      title: 'Auth module',
      state: 'prototyped',
      acs: [
        { id: 'AC-1', description: 'Login endpoint', status: 'implemented' },
        { id: 'AC-2', description: 'Logout endpoint', status: 'pending' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    }]);
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features[0].acs.length, 2);
    assert.strictEqual(result.features[0].acs[0].status, 'implemented');
    assert.strictEqual(result.features[0].acs[1].status, 'pending');
  });

  it('extracts feature dependencies', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-002',
      title: 'User profile',
      state: 'planned',
      acs: [],
      files: [],
      dependencies: ['F-001'],
      metadata: {},
    }]);
    const result = readFeatureMap(tmpDir);
    assert.deepStrictEqual(result.features[0].dependencies, ['F-001']);
  });

  it('parses file references', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001',
      title: 'Auth module',
      state: 'planned',
      acs: [],
      files: ['src/auth.js', 'src/auth.test.js'],
      dependencies: [],
      metadata: {},
    }]);
    const result = readFeatureMap(tmpDir);
    assert.deepStrictEqual(result.features[0].files, ['src/auth.js', 'src/auth.test.js']);
  });
});

// --- writeFeatureMap / roundtrip tests ---

describe('writeFeatureMap', () => {
  it('roundtrips features through write then read', () => {
    const original = {
      features: [
        {
          id: 'F-001',
          title: 'Initialize project',
          state: 'planned',
          acs: [{ id: 'AC-1', description: 'Creates config file', status: 'pending' }],
          files: ['src/init.js'],
          dependencies: [],
          metadata: {},
        },
        {
          id: 'F-002',
          title: 'User authentication',
          state: 'prototyped',
          acs: [
            { id: 'AC-1', description: 'Login works', status: 'implemented' },
            { id: 'AC-2', description: 'Logout works', status: 'pending' },
          ],
          files: ['src/auth.js'],
          dependencies: ['F-001'],
          metadata: {},
        },
      ],
      lastScan: null,
    };
    writeFeatureMap(tmpDir, original);
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features.length, 2);
    assert.strictEqual(result.features[0].id, 'F-001');
    assert.strictEqual(result.features[1].id, 'F-002');
    assert.strictEqual(result.features[1].state, 'prototyped');
    assert.strictEqual(result.features[1].acs.length, 2);
    assert.deepStrictEqual(result.features[1].dependencies, ['F-001']);
    assert.deepStrictEqual(result.features[0].files, ['src/init.js']);
  });

  it('writes empty feature map correctly', () => {
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    const content = fs.readFileSync(path.join(tmpDir, FEATURE_MAP_FILE), 'utf8');
    assert.ok(content.includes('## Features'));
    assert.ok(content.includes('## Legend'));
    assert.ok(!content.includes('### F-'));
  });
});

// --- addFeature tests ---

describe('addFeature', () => {
  it('adds a new feature with auto-generated ID', () => {
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    const added = addFeature(tmpDir, { title: 'Initialize config' });
    assert.strictEqual(added.id, 'F-001');
    assert.strictEqual(added.state, 'planned');
    assert.strictEqual(added.title, 'Initialize config');
  });

  it('generates sequential IDs', () => {
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    addFeature(tmpDir, { title: 'First feature' });
    const second = addFeature(tmpDir, { title: 'Second feature' });
    assert.strictEqual(second.id, 'F-002');
  });

  // @gsd-todo(ref:AC-6) Idempotent -- adding features does not overwrite existing content
  it('preserves existing features when adding new ones', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Existing', state: 'shipped', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    addFeature(tmpDir, { title: 'New feature' });
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features.length, 2);
    assert.strictEqual(result.features[0].id, 'F-001');
    assert.strictEqual(result.features[0].state, 'shipped');
    assert.strictEqual(result.features[1].id, 'F-002');
  });
});

// --- getNextFeatureId tests ---

describe('getNextFeatureId', () => {
  it('returns F-001 for empty array', () => {
    assert.strictEqual(getNextFeatureId([]), 'F-001');
  });

  it('returns F-001 for null', () => {
    assert.strictEqual(getNextFeatureId(null), 'F-001');
  });

  it('returns next sequential ID', () => {
    const features = [{ id: 'F-001' }, { id: 'F-003' }];
    assert.strictEqual(getNextFeatureId(features), 'F-004');
  });

  it('pads to 3 digits', () => {
    const features = [{ id: 'F-009' }];
    assert.strictEqual(getNextFeatureId(features), 'F-010');
  });
});

// --- updateFeatureState tests ---

describe('updateFeatureState', () => {
  // @gsd-todo(ref:AC-9) Feature state lifecycle: planned -> prototyped -> tested -> shipped
  it('allows valid transition planned -> prototyped', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    const result = updateFeatureState(tmpDir, 'F-001', 'prototyped');
    assert.strictEqual(result, true);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'prototyped');
  });

  it('allows valid transition prototyped -> tested', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'prototyped', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
  });

  it('allows valid transition tested -> shipped', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'tested', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), true);
  });

  it('rejects invalid transition planned -> shipped', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    const result = updateFeatureState(tmpDir, 'F-001', 'shipped');
    assert.strictEqual(result, false);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'planned');
  });

  it('rejects invalid transition shipped -> planned', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'shipped', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'planned'), false);
  });

  it('rejects invalid state name', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Test', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'bogus'), false);
  });

  it('returns false for non-existent feature', () => {
    writeSampleFeatureMap(tmpDir, []);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-999', 'prototyped'), false);
  });
});

// --- enrichFromTags tests ---

describe('enrichFromTags', () => {
  // @gsd-todo(ref:AC-12) Feature Map auto-enriched from @cap-feature tags
  it('adds file references from tag scan', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Auth', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'src/auth.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'src/auth.test.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = enrichFromTags(tmpDir, tags);
    assert.deepStrictEqual(result.features[0].files, ['src/auth.js', 'src/auth.test.js']);
  });

  it('does not duplicate file references', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Auth', state: 'planned', acs: [], files: ['src/auth.js'], dependencies: [], metadata: {},
    }]);
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'src/auth.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = enrichFromTags(tmpDir, tags);
    assert.strictEqual(result.features[0].files.length, 1);
  });

  it('ignores tags for non-existent features', () => {
    writeSampleFeatureMap(tmpDir, [{
      id: 'F-001', title: 'Auth', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }]);
    const tags = [
      { type: 'feature', metadata: { feature: 'F-999' }, file: 'src/other.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = enrichFromTags(tmpDir, tags);
    assert.strictEqual(result.features[0].files.length, 0);
  });
});

// --- enrichFromDeps tests ---

describe('enrichFromDeps', () => {
  // @gsd-todo(ref:AC-13) Auto-enrichment from dependency graph, env vars, package.json
  it('reads dependencies from package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }));
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.dependencies, ['express']);
    assert.deepStrictEqual(result.devDependencies, ['vitest']);
  });

  it('reads env vars from .env file', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=postgres://...\nAPI_KEY=abc123\n');
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.envVars, ['DATABASE_URL', 'API_KEY']);
  });

  it('returns empty arrays when no package.json or .env', () => {
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.dependencies, []);
    assert.deepStrictEqual(result.devDependencies, []);
    assert.deepStrictEqual(result.envVars, []);
  });
});

// --- enrichFromScan tests ---

describe('enrichFromScan', () => {
  it('updates AC status based on matching @cap-feature tags', () => {
    const featureMap = {
      features: [{
        id: 'F-001', title: 'Auth', state: 'planned',
        acs: [{ id: 'AC-1', description: 'Login works', status: 'pending' }],
        files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    };
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001', ac: 'AC-1' }, file: 'src/auth.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = enrichFromScan(featureMap, tags);
    assert.strictEqual(result.features[0].acs[0].status, 'implemented');
  });

  it('ignores tags that do not match any Feature Map entry', () => {
    const featureMap = {
      features: [{
        id: 'F-001', title: 'Auth', state: 'planned',
        acs: [{ id: 'AC-1', description: 'Login', status: 'pending' }],
        files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    };
    const tags = [
      { type: 'feature', metadata: { feature: 'F-999' }, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = enrichFromScan(featureMap, tags);
    assert.strictEqual(result.features[0].acs[0].status, 'pending');
  });
});

// --- addFeatures tests ---

describe('addFeatures', () => {
  // @gsd-todo(ref:AC-11) Feature Map supports auto-derivation from brainstorm output
  it('adds new features without overwriting existing ones', () => {
    const featureMap = {
      features: [{
        id: 'F-001', title: 'Existing', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    };
    const newFeatures = [{
      id: 'F-002', title: 'New feature', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }];
    const result = addFeatures(featureMap, newFeatures);
    assert.strictEqual(result.features.length, 2);
  });

  it('rejects duplicate feature by ID', () => {
    const featureMap = {
      features: [{
        id: 'F-001', title: 'Existing', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    };
    const newFeatures = [{
      id: 'F-001', title: 'Duplicate', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }];
    const result = addFeatures(featureMap, newFeatures);
    assert.strictEqual(result.features.length, 1);
  });

  it('rejects duplicate feature by title (case-insensitive)', () => {
    const featureMap = {
      features: [{
        id: 'F-001', title: 'Initialize Config', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    };
    const newFeatures = [{
      id: 'F-002', title: 'initialize config', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
    }];
    const result = addFeatures(featureMap, newFeatures);
    assert.strictEqual(result.features.length, 1);
  });
});

// --- getStatus tests ---

describe('getStatus', () => {
  it('computes correct aggregate status', () => {
    const featureMap = {
      features: [
        {
          id: 'F-001', title: 'Auth', state: 'shipped',
          acs: [
            { id: 'AC-1', description: 'Login', status: 'reviewed' },
            { id: 'AC-2', description: 'Logout', status: 'tested' },
          ],
          files: [], dependencies: [], metadata: {},
        },
        {
          id: 'F-002', title: 'Profile', state: 'planned',
          acs: [
            { id: 'AC-1', description: 'View profile', status: 'pending' },
            { id: 'AC-2', description: 'Edit profile', status: 'implemented' },
          ],
          files: [], dependencies: [], metadata: {},
        },
      ],
      lastScan: null,
    };
    const status = getStatus(featureMap);
    assert.strictEqual(status.totalFeatures, 2);
    assert.strictEqual(status.completedFeatures, 1);
    assert.strictEqual(status.totalACs, 4);
    assert.strictEqual(status.implementedACs, 1);
    assert.strictEqual(status.testedACs, 1);
    assert.strictEqual(status.reviewedACs, 1);
  });

  it('returns zero counts for empty feature map', () => {
    const status = getStatus({ features: [], lastScan: null });
    assert.strictEqual(status.totalFeatures, 0);
    assert.strictEqual(status.completedFeatures, 0);
    assert.strictEqual(status.totalACs, 0);
    assert.strictEqual(status.implementedACs, 0);
  });
});

// --- Scale test ---

describe('scale', () => {
  // @gsd-todo(ref:AC-14) Feature Map scales to 80-120 features in a single file
  it('handles 100 features in a single file', () => {
    const features = [];
    for (let i = 1; i <= 100; i++) {
      features.push({
        id: `F-${String(i).padStart(3, '0')}`,
        title: `Feature number ${i}`,
        state: 'planned',
        acs: [{ id: 'AC-1', description: `AC for feature ${i}`, status: 'pending' }],
        files: [],
        dependencies: [],
        metadata: {},
      });
    }
    writeFeatureMap(tmpDir, { features, lastScan: null });
    const result = readFeatureMap(tmpDir);
    assert.strictEqual(result.features.length, 100);
    assert.strictEqual(result.features[99].id, 'F-100');
  });
});
