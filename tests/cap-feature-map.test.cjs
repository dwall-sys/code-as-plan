'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  FEATURE_MAP_FILE,
  VALID_STATES,
  AC_VALID_STATUSES,
  generateTemplate,
  readFeatureMap,
  writeFeatureMap,
  parseFeatureMapContent,
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
  setAcStatus,
  detectDrift,
  formatDriftReport,
  enrichFromTags,
  enrichFromDeps,
  getNextFeatureId,
  enrichFromScan,
  addFeatures,
  getStatus,
  initAppFeatureMap,
  listAppFeatureMaps,
  rescopeFeatures,
} = require('../cap/bin/lib/cap-feature-map.cjs');

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

// --- parseFeatureMapContent alternate format tests ---

describe('parseFeatureMapContent alternate formats', () => {
  it('parses header without [state] when status is on separate line', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-001: Tag Scanner\n- **Status:** shipped\n`;
    const result = parseFeatureMapContent(content);
    assert.strictEqual(result.features.length, 1);
    assert.strictEqual(result.features[0].id, 'F-001');
    assert.strictEqual(result.features[0].title, 'Tag Scanner');
    assert.strictEqual(result.features[0].state, 'shipped');
  });

  it('defaults to planned when header has no [state] and no status line', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-001: Tag Scanner\n`;
    const result = parseFeatureMapContent(content);
    assert.strictEqual(result.features[0].state, 'planned');
  });

  it('parses ACs as checkboxes', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-001: Auth [prototyped]\n- **AC:**\n  - [x] Login works\n  - [ ] Logout works\n`;
    const result = parseFeatureMapContent(content);
    assert.strictEqual(result.features[0].acs.length, 2);
    assert.strictEqual(result.features[0].acs[0].id, 'AC-1');
    assert.strictEqual(result.features[0].acs[0].description, 'Login works');
    assert.strictEqual(result.features[0].acs[0].status, 'tested');
    assert.strictEqual(result.features[0].acs[1].id, 'AC-2');
    assert.strictEqual(result.features[0].acs[1].description, 'Logout works');
    assert.strictEqual(result.features[0].acs[1].status, 'pending');
  });

  it('parses inline files on **Files:** line', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-001: Auth [planned]\n- **Files:** \`src/auth.js\`\n`;
    const result = parseFeatureMapContent(content);
    assert.deepStrictEqual(result.features[0].files, ['src/auth.js']);
  });

  it('parses multiple inline files separated by commas', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-001: Auth [planned]\n- **Files:** \`src/auth.js\`, \`src/auth.test.js\`\n`;
    const result = parseFeatureMapContent(content);
    assert.deepStrictEqual(result.features[0].files, ['src/auth.js', 'src/auth.test.js']);
  });

  it('parses dependencies with dash prefix', () => {
    const content = `# Feature Map\n\n## Features\n\n### F-002: Profile [planned]\n- **Dependencies:** F-001\n`;
    const result = parseFeatureMapContent(content);
    assert.deepStrictEqual(result.features[0].dependencies, ['F-001']);
  });

  it('parses full agent-style format with all variant fields', () => {
    const content = `# Feature Map

## Features

### F-001: Tag Scanner
- **Status:** shipped
- **Files:** \`cap/bin/lib/cap-tag-scanner.cjs\`
- **AC:**
  - [x] Extract @cap-feature tags from source files
  - [x] Language-agnostic regex-based extraction
  - [ ] Support custom tag prefixes

### F-002: Feature Map Management
- **Status:** prototyped
- **Dependencies:** F-001
- **AC:**
  - [x] Read and parse FEATURE-MAP.md
  - [ ] Write structured data back
`;
    const result = parseFeatureMapContent(content);
    assert.strictEqual(result.features.length, 2);

    assert.strictEqual(result.features[0].id, 'F-001');
    assert.strictEqual(result.features[0].state, 'shipped');
    assert.deepStrictEqual(result.features[0].files, ['cap/bin/lib/cap-tag-scanner.cjs']);
    assert.strictEqual(result.features[0].acs.length, 3);
    assert.strictEqual(result.features[0].acs[2].status, 'pending');

    assert.strictEqual(result.features[1].id, 'F-002');
    assert.strictEqual(result.features[1].state, 'prototyped');
    assert.deepStrictEqual(result.features[1].dependencies, ['F-001']);
    assert.strictEqual(result.features[1].acs.length, 2);
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
    fs.writeFileSync(path.join(tmpDir, '.env'), 'CUSTOM_VAR=test\nOTHER_VAR=test\n');
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.envVars, ['CUSTOM_VAR', 'OTHER_VAR']);
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

// --- App-scoped readFeatureMap tests ---

describe('readFeatureMap with appPath', () => {
  it('reads from app subdirectory when appPath provided', () => {
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, {
      features: [{
        id: 'F-001', title: 'Flow auth', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    }, 'apps/flow');
    const result = readFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(result.features.length, 1);
    assert.strictEqual(result.features[0].title, 'Flow auth');
  });

  it('reads from root when appPath is null', () => {
    writeFeatureMap(tmpDir, {
      features: [{
        id: 'F-001', title: 'Root feature', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    });
    const result = readFeatureMap(tmpDir, null);
    assert.strictEqual(result.features.length, 1);
    assert.strictEqual(result.features[0].title, 'Root feature');
  });

  it('returns empty when app FEATURE-MAP.md does not exist', () => {
    const result = readFeatureMap(tmpDir, 'apps/nonexistent');
    assert.strictEqual(result.features.length, 0);
  });
});

// --- App-scoped writeFeatureMap tests ---

describe('writeFeatureMap with appPath', () => {
  it('writes to app subdirectory when appPath provided', () => {
    const appDir = path.join(tmpDir, 'apps', 'hub');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, {
      features: [{
        id: 'F-001', title: 'Hub feature', state: 'planned', acs: [], files: [], dependencies: [], metadata: {},
      }],
      lastScan: null,
    }, 'apps/hub');
    assert.ok(fs.existsSync(path.join(appDir, 'FEATURE-MAP.md')));
    const content = fs.readFileSync(path.join(appDir, 'FEATURE-MAP.md'), 'utf8');
    assert.ok(content.includes('Hub feature'));
  });

  it('does not write to root when appPath provided', () => {
    const appDir = path.join(tmpDir, 'apps', 'hub');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, {
      features: [{ id: 'F-001', title: 'Hub only', state: 'planned', acs: [], files: [], dependencies: [], metadata: {} }],
      lastScan: null,
    }, 'apps/hub');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'FEATURE-MAP.md')));
  });
});

// --- initAppFeatureMap tests ---

describe('initAppFeatureMap', () => {
  it('creates FEATURE-MAP.md for an app', () => {
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    const created = initAppFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(created, true);
    assert.ok(fs.existsSync(path.join(appDir, 'FEATURE-MAP.md')));
    const content = fs.readFileSync(path.join(appDir, 'FEATURE-MAP.md'), 'utf8');
    assert.ok(content.includes('## Features'));
  });

  it('returns false if FEATURE-MAP.md already exists', () => {
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    initAppFeatureMap(tmpDir, 'apps/flow');
    const created = initAppFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(created, false);
  });

  it('creates app directory if it does not exist', () => {
    const created = initAppFeatureMap(tmpDir, 'apps/new-app');
    assert.strictEqual(created, true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'apps', 'new-app', 'FEATURE-MAP.md')));
  });
});

// --- listAppFeatureMaps tests ---

describe('listAppFeatureMaps', () => {
  it('finds FEATURE-MAP.md at root and in apps', () => {
    // Create root FEATURE-MAP.md
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    // Create app FEATURE-MAP.md
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    initAppFeatureMap(tmpDir, 'apps/flow');

    const results = listAppFeatureMaps(tmpDir);
    assert.ok(results.includes('.'));
    assert.ok(results.includes(path.join('apps', 'flow')));
  });

  it('returns empty array when no FEATURE-MAP.md files exist', () => {
    const results = listAppFeatureMaps(tmpDir);
    assert.deepStrictEqual(results, []);
  });

  it('excludes node_modules and .git directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'FEATURE-MAP.md'), '# bogus');
    const results = listAppFeatureMaps(tmpDir);
    assert.strictEqual(results.length, 0);
  });

  it('handles unreadable subdirectories gracefully', () => {
    // Create a directory and make it unreadable
    const unreadable = path.join(tmpDir, 'restricted');
    fs.mkdirSync(unreadable);
    fs.chmodSync(unreadable, 0o000);
    try {
      const results = listAppFeatureMaps(tmpDir);
      assert.ok(Array.isArray(results), 'Should return array even with unreadable dirs');
    } finally {
      // Restore permissions for cleanup
      fs.chmodSync(unreadable, 0o755);
    }
  });
});

// --- App-scoped addFeature tests ---

describe('addFeature with appPath', () => {
  it('adds feature to app FEATURE-MAP.md', () => {
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, { features: [], lastScan: null }, 'apps/flow');
    const added = addFeature(tmpDir, { title: 'Flow login' }, 'apps/flow');
    assert.strictEqual(added.id, 'F-001');
    const result = readFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(result.features.length, 1);
    assert.strictEqual(result.features[0].title, 'Flow login');
  });
});

// --- enrichFromDeps error branches ---

describe('enrichFromDeps error branches', () => {
  it('handles malformed package.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ this is not json }');
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.dependencies, []);
    assert.deepStrictEqual(result.devDependencies, []);
  });

  it('handles unreadable .env gracefully', () => {
    // Create .env as a directory to trigger read error
    fs.mkdirSync(path.join(tmpDir, '.env'));
    const result = enrichFromDeps(tmpDir);
    assert.deepStrictEqual(result.envVars, []);
  });
});

// --- rescopeFeatures ---

describe('rescopeFeatures', () => {
  function mkFeature(id, title, files) {
    return { id, title, state: 'planned', acs: [], files: files || [], dependencies: [], metadata: {} };
  }

  it('returns zeros when no features exist', () => {
    writeFeatureMap(tmpDir, { features: [], lastScan: null });
    const result = rescopeFeatures(tmpDir, ['apps/flow']);
    assert.strictEqual(result.appsCreated, 0);
    assert.strictEqual(result.featuresDistributed, 0);
    assert.strictEqual(result.featuresKeptAtRoot, 0);
    assert.deepStrictEqual(result.distribution, {});
  });

  it('keeps features with no files at root', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'No files', [])], lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    const result = rescopeFeatures(tmpDir, ['apps/flow']);
    assert.strictEqual(result.featuresKeptAtRoot, 1);
    assert.strictEqual(result.featuresDistributed, 0);
  });

  it('distributes features to the correct app based on file refs', () => {
    const features = [
      mkFeature('F-001', 'Flow feature', ['apps/flow/src/index.js']),
      mkFeature('F-002', 'Hub feature', ['apps/hub/src/main.js']),
    ];
    writeFeatureMap(tmpDir, { features, lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'hub'), { recursive: true });
    const result = rescopeFeatures(tmpDir, ['apps/flow', 'apps/hub']);
    assert.strictEqual(result.appsCreated, 2);
    assert.strictEqual(result.featuresDistributed, 2);
    assert.ok(result.distribution['apps/flow'], 'Should have apps/flow distribution');
    assert.ok(result.distribution['apps/hub'], 'Should have apps/hub distribution');
  });

  it('assigns cross-app features to the app with most file refs', () => {
    const features = [
      mkFeature('F-001', 'Cross-app', ['apps/flow/a.js', 'apps/flow/b.js', 'apps/hub/c.js']),
    ];
    writeFeatureMap(tmpDir, { features, lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'hub'), { recursive: true });
    const result = rescopeFeatures(tmpDir, ['apps/flow', 'apps/hub']);
    assert.strictEqual(result.featuresDistributed, 1);
    assert.deepStrictEqual(result.distribution['apps/flow'], ['F-001']);
  });

  it('keeps features whose files do not match any app at root', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Unknown', ['lib/utils.js'])], lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    const result = rescopeFeatures(tmpDir, ['apps/flow']);
    assert.strictEqual(result.featuresKeptAtRoot, 1);
    assert.strictEqual(result.featuresDistributed, 0);
  });

  it('dry run reports without writing files', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Flow feature', ['apps/flow/src/index.js'])], lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    const result = rescopeFeatures(tmpDir, ['apps/flow'], { dryRun: true });
    assert.strictEqual(result.appsCreated, 1);
    assert.strictEqual(result.featuresDistributed, 1);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'apps', 'flow', 'FEATURE-MAP.md')));
  });

  it('does not duplicate features already in app Feature Map', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Flow feature', ['apps/flow/src/index.js'])], lastScan: null });
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Existing', [])], lastScan: null }, 'apps/flow');
    const result = rescopeFeatures(tmpDir, ['apps/flow']);
    assert.strictEqual(result.featuresDistributed, 0);
    const appMap = readFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(appMap.features.length, 1);
  });

  it('rewrites root Feature Map to contain only root features', () => {
    const features = [
      mkFeature('F-001', 'Flow feature', ['apps/flow/src/a.js']),
      mkFeature('F-002', 'Root only', []),
    ];
    writeFeatureMap(tmpDir, { features, lastScan: null });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    rescopeFeatures(tmpDir, ['apps/flow']);
    const rootMap = readFeatureMap(tmpDir);
    assert.strictEqual(rootMap.features.length, 1);
    assert.strictEqual(rootMap.features[0].id, 'F-002');
  });

  it('skips apps whose directory does not exist', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Ghost app', ['apps/ghost/src/x.js'])], lastScan: null });
    const result = rescopeFeatures(tmpDir, ['apps/ghost']);
    assert.strictEqual(result.appsCreated, 0);
  });

  it('re-numbers features for app starting after existing ones', () => {
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'New flow', ['apps/flow/src/x.js'])], lastScan: null });
    const appDir = path.join(tmpDir, 'apps', 'flow');
    fs.mkdirSync(appDir, { recursive: true });
    writeFeatureMap(tmpDir, { features: [mkFeature('F-001', 'Pre-existing', [])], lastScan: null }, 'apps/flow');
    // The new feature has a different ID so it won't be skipped
    writeFeatureMap(tmpDir, { features: [mkFeature('F-099', 'New flow', ['apps/flow/src/x.js'])], lastScan: null });
    rescopeFeatures(tmpDir, ['apps/flow']);
    const appMap = readFeatureMap(tmpDir, 'apps/flow');
    assert.strictEqual(appMap.features.length, 2);
    assert.strictEqual(appMap.features[1].id, 'F-002');
  });
});

// --- F-041: Parser/Serializer roundtrip symmetry tests ---

describe('F-041 parser-serializer roundtrip symmetry', () => {
  // Helper: deep-compare two FeatureMap structures for AC counts/ids/descriptions/statuses
  function assertFeaturesEquivalent(actual, expected, ctx) {
    assert.strictEqual(actual.length, expected.length, `${ctx}: feature count`);
    for (let i = 0; i < expected.length; i++) {
      const a = actual[i];
      const e = expected[i];
      assert.strictEqual(a.id, e.id, `${ctx}: feature[${i}].id`);
      assert.strictEqual(a.title, e.title, `${ctx}: feature[${i}].title`);
      assert.strictEqual(a.state, e.state, `${ctx}: feature[${i}].state`);
      assert.strictEqual(a.acs.length, e.acs.length, `${ctx}: ${e.id} AC count (expected ${e.acs.length}, got ${a.acs.length})`);
      for (let j = 0; j < e.acs.length; j++) {
        assert.strictEqual(a.acs[j].id, e.acs[j].id, `${ctx}: ${e.id}.acs[${j}].id`);
        assert.strictEqual(a.acs[j].description, e.acs[j].description, `${ctx}: ${e.id}.acs[${j}].description`);
        assert.strictEqual(a.acs[j].status, e.acs[j].status, `${ctx}: ${e.id}.acs[${j}].status`);
      }
      assert.deepStrictEqual(a.dependencies, e.dependencies, `${ctx}: ${e.id}.dependencies`);
    }
  }

  // @cap-feature(feature:F-041) Roundtrip-equivalence helper exercises AC-2.

  describe('AC-4: parser does not drop AC rows whose description contains the word "Status"', () => {
    // @cap-todo(ac:F-041/AC-4) Direct reproducer of the live bug seen in F-041 itself —
    // an AC whose description contains "Status" used to be misclassified as a table header
    // and silently truncated the table.
    it('parses all six ACs when AC-6 description contains the word "Status"', () => {
      const content = `# Feature Map

## Features

### F-901: Reproducer [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | First AC |
| AC-2 | pending | Second AC |
| AC-3 | pending | Third AC |
| AC-4 | pending | Fourth AC |
| AC-5 | pending | Fifth AC |
| AC-6 | pending | serializeFeatureMap shall emit Status lines as a serialization option |
`;
      const result = parseFeatureMapContent(content);
      assert.strictEqual(result.features.length, 1);
      assert.strictEqual(result.features[0].acs.length, 6, 'all six ACs must survive parsing');
      assert.strictEqual(result.features[0].acs[5].id, 'AC-6');
      assert.ok(
        result.features[0].acs[5].description.includes('Status'),
        'AC-6 description must contain the word that previously broke the parser'
      );
    });

    it('does not enter table mode when the only "| AC" line is an AC-N data row', () => {
      // No header row at all — just data rows. Should not crash, should parse zero ACs.
      const content = `# Feature Map

## Features

### F-902: NoHeader [planned]

| AC-1 | pending | A row without a header above it |
`;
      const result = parseFeatureMapContent(content);
      assert.strictEqual(result.features.length, 1);
      // Without a real table header, inAcTable stays false and AC-1 is not collected —
      // which is the correct conservative behaviour.
      assert.strictEqual(result.features[0].acs.length, 0);
    });

    it('preserves AC descriptions that contain literal pipe characters (F-040 parser bug)', () => {
      // Repro of the bug that dropped F-041/AC-6 and F-042/AC-3/AC-4 during the
      // 2026-04-21 ECC feature batch: a pipe inside a description truncated the
      // field at the first internal pipe. Fix: end-anchor the AC row regex so
      // the non-greedy description group expands to the trailing pipe of the row.
      const content = `# Feature Map

## Features

### F-903: PipeInDescription [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | normal description |
| AC-2 | pending | CLI flag --legacy-tags=warn|error controlling enforcement |
| AC-3 | pending | has | multiple | pipes | in the middle |
| AC-4 | pending | ends normally |
`;
      const result = parseFeatureMapContent(content);
      assert.strictEqual(result.features.length, 1);
      const acs = result.features[0].acs;
      assert.strictEqual(acs.length, 4, 'all four ACs must survive parsing');
      assert.strictEqual(acs[1].description, 'CLI flag --legacy-tags=warn|error controlling enforcement');
      assert.strictEqual(acs[2].description, 'has | multiple | pipes | in the middle');
      assert.strictEqual(acs[3].description, 'ends normally');
    });

    it('rejects a row missing the trailing pipe (strict table discipline)', () => {
      // If authors drop the closing pipe, we now silently skip the row rather
      // than accepting a malformed record. The next legitimate row still parses.
      const content = `# Feature Map

## Features

### F-904: MissingPipe [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | this row is missing its closing pipe
| AC-2 | pending | this row is well-formed |
`;
      const result = parseFeatureMapContent(content);
      assert.strictEqual(result.features.length, 1);
      assert.strictEqual(result.features[0].acs.length, 1);
      assert.strictEqual(result.features[0].acs[0].id, 'AC-2');
    });
  });

  describe('AC-1 + AC-2: parse -> serialize -> parse roundtrip is structurally equivalent', () => {
    // @cap-todo(ac:F-041/AC-1) Status values survive the full roundtrip.
    // @cap-todo(ac:F-041/AC-2) Two-step roundtrip preserves AC count, IDs, descriptions, statuses.
    it('roundtrips a feature with all four AC status values intact', () => {
      const original = {
        features: [{
          id: 'F-001',
          title: 'Roundtrip subject',
          state: 'prototyped',
          acs: [
            { id: 'AC-1', description: 'Pending one', status: 'pending' },
            { id: 'AC-2', description: 'Implemented one', status: 'implemented' },
            { id: 'AC-3', description: 'Tested one', status: 'tested' },
            { id: 'AC-4', description: 'Reviewed one', status: 'reviewed' },
          ],
          files: [],
          dependencies: [],
          metadata: {},
        }],
        lastScan: null,
      };
      const serialized = serializeFeatureMap(original);
      const reparsed = parseFeatureMapContent(serialized);
      assertFeaturesEquivalent(reparsed.features, original.features, 'roundtrip');
    });

    it('roundtrips a feature whose AC description contains markdown-table-like text', () => {
      const original = {
        features: [{
          id: 'F-002',
          title: 'Tricky descriptions',
          state: 'planned',
          acs: [
            { id: 'AC-1', description: 'description with `- [x]` checkbox token inside', status: 'pending' },
            { id: 'AC-2', description: 'description with the literal word Status in the middle', status: 'pending' },
          ],
          files: [],
          dependencies: [],
          metadata: {},
        }],
        lastScan: null,
      };
      const serialized = serializeFeatureMap(original);
      const reparsed = parseFeatureMapContent(serialized);
      assertFeaturesEquivalent(reparsed.features, original.features, 'tricky-descriptions');
    });

    it('two consecutive roundtrips converge to a stable representation', () => {
      const original = {
        features: [{
          id: 'F-003',
          title: 'Stability',
          state: 'tested',
          acs: [{ id: 'AC-1', description: 'One AC', status: 'tested' }],
          files: ['src/a.js'],
          dependencies: ['F-001'],
          metadata: {},
        }],
        lastScan: null,
      };
      const round1 = parseFeatureMapContent(serializeFeatureMap(original));
      const round2 = parseFeatureMapContent(serializeFeatureMap(round1));
      assertFeaturesEquivalent(round2.features, round1.features, 'stable-roundtrip');
    });
  });

  describe('AC-3: serializer does not lowercase status values', () => {
    // @cap-todo(ac:F-041/AC-3) Parser preserves case as written; serializer emits as stored.
    // Canonical CAP lifecycle values are already lowercase, but any non-canonical
    // value must survive the roundtrip without case mutation.
    it('preserves a non-canonical mixed-case AC status across roundtrip', () => {
      const original = {
        features: [{
          id: 'F-001',
          title: 'CasePreservation',
          state: 'planned',
          acs: [{ id: 'AC-1', description: 'One', status: 'InProgress' }],
          files: [],
          dependencies: [],
          metadata: {},
        }],
        lastScan: null,
      };
      const reparsed = parseFeatureMapContent(serializeFeatureMap(original));
      assert.strictEqual(reparsed.features[0].acs[0].status, 'InProgress',
        'mixed-case AC status must not be lowercased by parser or serializer');
    });

    it('preserves a non-canonical mixed-case feature state from a Status: line', () => {
      // Use the legacy Status: line input so we exercise the statusLineRE branch.
      const content = `# Feature Map

## Features

### F-001: LegacyState
- **Status:** InReview
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].state, 'InReview',
        'feature state from **Status:** line must preserve case');
    });
  });

  describe('AC-6: serializeFeatureMap supports legacyStatusLine option', () => {
    // @cap-todo(ac:F-041/AC-6) When legacyStatusLine: true, serializer emits the
    // pre-bracketed-header format that the parser still accepts. Roundtrip must be stable.
    it('emits **Status:** line and omits [state] from header when legacyStatusLine:true', () => {
      const fm = {
        features: [{
          id: 'F-001', title: 'Legacy', state: 'shipped',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const out = serializeFeatureMap(fm, { legacyStatusLine: true });
      assert.ok(out.includes('### F-001: Legacy\n'),
        'header must NOT carry the bracketed [state] suffix in legacy mode');
      assert.ok(!out.includes('### F-001: Legacy [shipped]'),
        'bracketed-header form must not be emitted when legacyStatusLine is true');
      assert.ok(out.includes('- **Status:** shipped'),
        'must emit the legacy **Status:** line');
    });

    it('roundtrips through the legacy emission format', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'LegacyRoundtrip', state: 'tested',
          acs: [{ id: 'AC-1', description: 'A', status: 'tested' }],
          files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const serialized = serializeFeatureMap(original, { legacyStatusLine: true });
      const reparsed = parseFeatureMapContent(serialized);
      assertFeaturesEquivalent(reparsed.features, original.features, 'legacy-roundtrip');
    });

    it('default behaviour (no options) still emits bracketed-header form', () => {
      const fm = {
        features: [{
          id: 'F-001', title: 'Default', state: 'planned',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const out = serializeFeatureMap(fm);
      assert.ok(out.includes('### F-001: Default [planned]'),
        'default mode must keep emitting bracketed-header form (backwards compatible)');
      assert.ok(!out.includes('- **Status:**'),
        'default mode must NOT emit the legacy Status line');
    });
  });

  describe('AC-5: regression test against the actual repository FEATURE-MAP.md', () => {
    // @cap-todo(ac:F-041/AC-5) Load the live FEATURE-MAP.md and assert roundtrip stability
    // for F-019..F-040 — the historical range exhibiting status drift in the real file.
    // @cap-decision The repository FEATURE-MAP.md is the authoritative regression fixture.
    // Loading it here couples the test to repo state, which is intentional: any future
    // regression that drops/transforms ACs will fail this test on the next CI run.
    const repoRoot = path.resolve(__dirname, '..');
    const repoFeatureMap = path.join(repoRoot, FEATURE_MAP_FILE);

    it('parses, serializes, and re-parses without changing F-019..F-040 ACs', { skip: !fs.existsSync(repoFeatureMap) }, () => {
      const content = fs.readFileSync(repoFeatureMap, 'utf8');
      const first = parseFeatureMapContent(content);
      const second = parseFeatureMapContent(serializeFeatureMap(first));

      // Filter to the historical range called out by F-041/AC-5.
      const inRange = (id) => {
        const m = id.match(/^F-(\d{3})$/);
        if (!m) return false;
        const n = parseInt(m[1], 10);
        return n >= 19 && n <= 40;
      };
      const firstRange = first.features.filter(f => inRange(f.id));
      const secondRange = second.features.filter(f => inRange(f.id));

      assert.ok(firstRange.length >= 1,
        'fixture sanity: repo FEATURE-MAP.md must contain at least one F-019..F-040 feature');
      assertFeaturesEquivalent(secondRange, firstRange, 'repo-roundtrip-F019-F040');
    });

    it('parses F-041 itself with all six ACs intact (in-vivo bug fixture)', { skip: !fs.existsSync(repoFeatureMap) }, () => {
      const content = fs.readFileSync(repoFeatureMap, 'utf8');
      const parsed = parseFeatureMapContent(content);
      const f041 = parsed.features.find(f => f.id === 'F-041');
      if (!f041) return; // tolerate future renames; the previous test covers the broader range
      assert.strictEqual(f041.acs.length, 6,
        'F-041 must parse with all 6 ACs (was 5 before the AC-4 fix)');
      assert.strictEqual(f041.acs[5].id, 'AC-6');
    });
  });
});

// --- F-041: Adversarial verification (cap-tester) ---
// These tests target edge cases the prototyper did not cover. Each test exists
// to break a specific assumption in the parser/serializer pair.

describe('F-041 adversarial verification', () => {
  function totalAcs(features) {
    return features.reduce((s, f) => s + f.acs.length, 0);
  }

  describe('adversarial AC-4: ambiguous "Status" hits in AC descriptions', () => {
    // @cap-todo(ac:F-041/AC-4) Description containing literal "| AC | Status | Description |"
    // text — even though the substring appears, the strict header regex must only fire when the
    // line starts with the exact pipe-delimited header columns, not when it appears mid-row.
    it('does not split the table when an AC description contains the literal table-header text', () => {
      const content = `# Feature Map

## Features

### F-901: AmbiguousHeaderInDesc [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | first AC |
| AC-2 | pending | desc with the literal text AC Status Description in the middle |
| AC-3 | pending | third AC after the trap |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 3,
        'all 3 ACs must survive a description containing the literal header text');
      assert.deepStrictEqual(
        parsed.features[0].acs.map(a => a.id),
        ['AC-1', 'AC-2', 'AC-3']
      );
    });

    it('parses an AC whose description is the literal word "Status"', () => {
      const content = `# Feature Map

## Features

### F-902: OnlyStatus [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Status |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 1);
      assert.strictEqual(parsed.features[0].acs[0].description, 'Status');
    });

    it('parses multiple consecutive AC rows where every description contains "Status"', () => {
      const content = `# Feature Map

## Features

### F-903: AllStatusDescs [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Status drift detection one |
| AC-2 | pending | Status drift detection two |
| AC-3 | pending | Status drift detection three |
| AC-4 | pending | Status drift detection four |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 4,
        'every consecutive Status-containing description must survive');
    });

    it('strict header regex tolerates extra whitespace inside the pipe cells', () => {
      const content = `# Feature Map

## Features

### F-904: WhitespaceHeader [planned]

|  AC  |  Status  |  Description  |
|------|----------|---------------|
| AC-1 | pending  | only one AC   |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 1,
        'whitespace-padded header must still trigger inAcTable mode');
    });
  });

  describe('adversarial AC-4: mixed checkbox + table format coexistence', () => {
    // @cap-todo(ac:F-041/AC-4) AC-4 says "shall not silently drop AC entries when both
    // checkbox and table formats coexist". Verify NO drops — the parser may yield duplicate
    // IDs (collision is a separate concern), but it must preserve every AC line.
    it('preserves the SUM of checkbox and table ACs without dropping either source', () => {
      const content = `# Feature Map

## Features

### F-905: MixedFormat [planned]
- **AC:**
  - [x] checkbox one
  - [ ] checkbox two

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | table one |
| AC-2 | pending | table two |
`;
      const parsed = parseFeatureMapContent(content);
      // 2 checkboxes + 2 table rows = 4 ACs total, none silently dropped
      assert.strictEqual(parsed.features[0].acs.length, 4,
        'mixed format must yield ALL 4 AC entries (2 checkbox + 2 table), none dropped');
      const descs = parsed.features[0].acs.map(a => a.description);
      assert.ok(descs.includes('checkbox one'), 'checkbox AC #1 lost');
      assert.ok(descs.includes('checkbox two'), 'checkbox AC #2 lost');
      assert.ok(descs.includes('table one'), 'table AC #1 lost');
      assert.ok(descs.includes('table two'), 'table AC #2 lost');
    });

    it('preserves order: checkbox-source ACs precede table-source ACs in mixed input', () => {
      const content = `# Feature Map

## Features

### F-906: OrderCheck [planned]
- **AC:**
  - [x] alpha checkbox

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | beta table |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 2);
      assert.strictEqual(parsed.features[0].acs[0].description, 'alpha checkbox',
        'checkbox AC must appear before table AC in source order');
      assert.strictEqual(parsed.features[0].acs[1].description, 'beta table');
    });
  });

  describe('adversarial AC-2: roundtrip stability under five repeated cycles', () => {
    // @cap-todo(ac:F-041/AC-2) Prototyper checked 2 cycles; this enforces convergence
    // doesn't drift over 5 — catches slow accumulation bugs (whitespace, duplicate
    // separators, header re-emission).
    it('converges to a stable representation within one cycle and stays stable for 5', () => {
      const original = {
        features: [{
          id: 'F-001',
          title: 'StableFiveCycles',
          state: 'shipped',
          acs: [
            { id: 'AC-1', description: 'first AC', status: 'tested' },
            { id: 'AC-2', description: 'second AC with the word Status inside', status: 'pending' },
            { id: 'AC-3', description: 'third AC normal', status: 'reviewed' },
          ],
          files: ['src/a.js', 'src/b.js'],
          dependencies: ['F-002', 'F-003'],
          metadata: {},
        }],
        lastScan: null,
      };
      let serialized = serializeFeatureMap(original);
      for (let i = 1; i <= 5; i++) {
        const parsed = parseFeatureMapContent(serialized);
        const next = serializeFeatureMap(parsed);
        // Ignore the *Last updated:* footer line which legitimately differs each call.
        const stripFooter = (s) => s.replace(/\*Last updated:.*?\*/g, '*Last updated: TS*');
        assert.strictEqual(
          stripFooter(next),
          stripFooter(serialized),
          `cycle ${i} produced a different serialization (drift detected)`
        );
        serialized = next;
      }
    });

    it('legacyStatusLine roundtrip is stable across five cycles', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'LegacyStable', state: 'shipped',
          acs: [{ id: 'AC-1', description: 'one', status: 'tested' }],
          files: ['src/x.js'], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      let serialized = serializeFeatureMap(original, { legacyStatusLine: true });
      for (let i = 1; i <= 5; i++) {
        const parsed = parseFeatureMapContent(serialized);
        const next = serializeFeatureMap(parsed, { legacyStatusLine: true });
        const stripFooter = (s) => s.replace(/\*Last updated:.*?\*/g, '*Last updated: TS*');
        assert.strictEqual(
          stripFooter(next),
          stripFooter(serialized),
          `legacy cycle ${i} produced drift`
        );
        serialized = next;
      }
    });

    it('live FEATURE-MAP.md remains AC-count-stable across five roundtrip cycles', { skip: !fs.existsSync(path.resolve(__dirname, '..', FEATURE_MAP_FILE)) }, () => {
      const repoMap = path.resolve(__dirname, '..', FEATURE_MAP_FILE);
      const content = fs.readFileSync(repoMap, 'utf8');
      let parsed = parseFeatureMapContent(content);
      const baselineFeatureCount = parsed.features.length;
      const baselineAcCount = totalAcs(parsed.features);
      for (let i = 1; i <= 5; i++) {
        parsed = parseFeatureMapContent(serializeFeatureMap(parsed));
        assert.strictEqual(parsed.features.length, baselineFeatureCount,
          `cycle ${i}: feature count drifted from ${baselineFeatureCount}`);
        assert.strictEqual(totalAcs(parsed.features), baselineAcCount,
          `cycle ${i}: AC total drifted from ${baselineAcCount}`);
      }
    });
  });

  describe('adversarial AC-3: case preservation edge cases', () => {
    // @cap-todo(ac:F-041/AC-3) Verify case is preserved verbatim (not lowercased and
    // not uppercased) across the parse/serialize boundary.
    it('preserves UPPERCASE AC status across roundtrip', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'UpperCase', state: 'planned',
          acs: [{ id: 'AC-1', description: 'one', status: 'PENDING' }],
          files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const reparsed = parseFeatureMapContent(serializeFeatureMap(original));
      assert.strictEqual(reparsed.features[0].acs[0].status, 'PENDING',
        'UPPERCASE status must round-trip verbatim');
    });

    it('preserves Title-case feature state across roundtrip', () => {
      // Bracketed-header form
      const content = `# Feature Map

## Features

### F-001: TitleCaseState [InReview]
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].state, 'InReview');
      const ser = serializeFeatureMap(parsed);
      const reparsed = parseFeatureMapContent(ser);
      assert.strictEqual(reparsed.features[0].state, 'InReview',
        'Title-case bracketed state must survive a full roundtrip');
    });

    it('does not normalize a non-canonical state to a canonical lowercase value', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'X', state: 'Shipped',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const ser = serializeFeatureMap(original);
      assert.ok(ser.includes('### F-001: X [Shipped]'),
        'serializer must not lowercase a Title-case state');
      const reparsed = parseFeatureMapContent(ser);
      assert.strictEqual(reparsed.features[0].state, 'Shipped');
    });
  });

  describe('adversarial AC-1: empty and boundary inputs', () => {
    // @cap-todo(ac:F-041/AC-1) Boundary cases the prototyper did not cover.
    it('roundtrips a feature with zero ACs (no table emitted, none re-parsed)', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'ZeroACs', state: 'planned',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const ser = serializeFeatureMap(original);
      assert.ok(!ser.includes('| AC |'),
        'no AC table must be emitted when feature has zero ACs');
      const reparsed = parseFeatureMapContent(ser);
      assert.strictEqual(reparsed.features[0].acs.length, 0);
      assert.strictEqual(reparsed.features[0].state, 'planned');
    });

    it('parses an AC table that has only header + separator, no rows', () => {
      const content = `# Feature Map

## Features

### F-907: EmptyTable [planned]

| AC | Status | Description |
|----|--------|-------------|
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].acs.length, 0,
        'empty AC table (header+separator only) must parse to zero ACs without crashing');
    });

    it('parses a feature header containing pipe characters in the title', () => {
      // The title-pipe edge case — not a regex/parser crash, just preserves the title.
      const content = `# Feature Map

## Features

### F-908: Pipes | In | Title [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | only AC |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].title, 'Pipes | In | Title');
      assert.strictEqual(parsed.features[0].state, 'planned');
      assert.strictEqual(parsed.features[0].acs.length, 1);
    });
  });

  describe('adversarial AC-6: legacy and bracketed format coexistence', () => {
    // @cap-todo(ac:F-041/AC-6) Verify the legacyStatusLine option behaves consistently
    // and a Files section between Status line and AC table does not break parsing.
    it('parses legacy-format input where **Files:** section sits between Status line and AC table', () => {
      const content = `# Feature Map

## Features

### F-001: ComplexLegacy
- **Status:** shipped

**Files:**
- \`src/a.js\`
- \`src/b.js\`

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | first |
| AC-2 | tested | second |
`;
      const parsed = parseFeatureMapContent(content);
      assert.strictEqual(parsed.features[0].state, 'shipped',
        'state from legacy Status line must be preserved');
      assert.deepStrictEqual(parsed.features[0].files, ['src/a.js', 'src/b.js'],
        'file refs after Status line must be captured');
      assert.strictEqual(parsed.features[0].acs.length, 2,
        'AC table after Files section must still be parsed');
    });

    it('legacyStatusLine: true preserves state when the title also contains a [bracketed] suffix', () => {
      // Edge case: when a title legitimately includes bracketed text, the legacy serializer
      // emits the bracket as part of the title AND adds a Status line. Parser strips the
      // bracket from the title (loses bracketed-text) but the Status line override means
      // the state is still correct. Document this behaviour so future refactors preserve it.
      const original = {
        features: [{
          id: 'F-001', title: 'Title [withBracket]', state: 'shipped',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const ser = serializeFeatureMap(original, { legacyStatusLine: true });
      const reparsed = parseFeatureMapContent(ser);
      assert.strictEqual(reparsed.features[0].state, 'shipped',
        'Status line must override any bracketed text the parser strips from title');
    });

    it('default mode does NOT emit any **Status:** line, even with non-canonical state', () => {
      const original = {
        features: [{
          id: 'F-001', title: 'X', state: 'WeirdState',
          acs: [], files: [], dependencies: [], metadata: {},
        }],
        lastScan: null,
      };
      const ser = serializeFeatureMap(original);
      assert.ok(!ser.includes('**Status:**'),
        'default serialization mode must never emit a **Status:** line');
      assert.ok(ser.includes('### F-001: X [WeirdState]'));
    });
  });

  describe('adversarial AC-5: live FEATURE-MAP.md F-041, F-042 specific survivors', () => {
    const repoFeatureMap = path.resolve(__dirname, '..', FEATURE_MAP_FILE);

    it('F-042 ACs containing the substring "Status" all survive a full roundtrip', { skip: !fs.existsSync(repoFeatureMap) }, () => {
      const content = fs.readFileSync(repoFeatureMap, 'utf8');
      const first = parseFeatureMapContent(content);
      const second = parseFeatureMapContent(serializeFeatureMap(first));
      const f042first = first.features.find(f => f.id === 'F-042');
      const f042second = second.features.find(f => f.id === 'F-042');
      if (!f042first) return; // tolerate F-042 being renumbered or removed in the future
      assert.ok(f042second, 'F-042 must still exist after roundtrip');
      assert.strictEqual(f042second.acs.length, f042first.acs.length,
        `F-042 AC count must survive roundtrip (was ${f042first.acs.length})`);
      // Verify each AC description survives (which proves no Status-substring drops happened)
      for (let i = 0; i < f042first.acs.length; i++) {
        assert.strictEqual(f042second.acs[i].description, f042first.acs[i].description,
          `F-042 AC[${i}] description drifted across roundtrip`);
      }
    });

    it('no feature in the live map loses or gains ACs across one roundtrip', { skip: !fs.existsSync(repoFeatureMap) }, () => {
      const content = fs.readFileSync(repoFeatureMap, 'utf8');
      const first = parseFeatureMapContent(content);
      const second = parseFeatureMapContent(serializeFeatureMap(first));
      assert.strictEqual(second.features.length, first.features.length,
        'feature count must not change');
      for (let i = 0; i < first.features.length; i++) {
        assert.strictEqual(
          second.features[i].acs.length,
          first.features[i].acs.length,
          `${first.features[i].id} AC count drifted (was ${first.features[i].acs.length}, became ${second.features[i].acs.length})`
        );
      }
    });

    it('no feature state changes across one roundtrip on the live map', { skip: !fs.existsSync(repoFeatureMap) }, () => {
      const content = fs.readFileSync(repoFeatureMap, 'utf8');
      const first = parseFeatureMapContent(content);
      const second = parseFeatureMapContent(serializeFeatureMap(first));
      for (let i = 0; i < first.features.length; i++) {
        assert.strictEqual(
          second.features[i].state,
          first.features[i].state,
          `${first.features[i].id} state changed from ${first.features[i].state} to ${second.features[i].state}`
        );
      }
    });
  });
});

// =============================================================================
// F-042: Propagate Feature State Transitions to Acceptance Criteria
// =============================================================================
// @cap-feature(feature:F-042) Test suite for state propagation, setAcStatus,
// and drift detection. Truth-table tests live under "F-042 truth table" below.

function makeFeature(state, acStatuses) {
  return {
    id: 'F-001',
    title: 'Test Feature',
    state,
    acs: acStatuses.map((s, i) => ({
      id: `AC-${i + 1}`,
      description: `criterion ${i + 1}`,
      status: s,
    })),
    files: [],
    dependencies: [],
    metadata: {},
  };
}

describe('F-042 state propagation — updateFeatureState extension', () => {
  // @cap-todo(ac:F-042/AC-1) updateFeatureState shall update child AC statuses on transitions to tested or shipped.

  it('planned -> prototyped does NOT change AC status', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending', 'pending', 'pending'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'prototyped'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['pending', 'pending', 'pending']);
    assert.strictEqual(map.features[0].state, 'prototyped');
  });

  it('prototyped -> tested promotes pending ACs to tested', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['pending', 'pending', 'pending'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['tested', 'tested', 'tested']);
  });

  it('prototyped -> tested promotes prototyped ACs to tested', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['prototyped', 'prototyped'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['tested', 'tested']);
  });

  it('prototyped -> tested leaves already-tested ACs alone (mixed input)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['tested', 'pending', 'prototyped'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['tested', 'tested', 'tested']);
  });

  it('tested -> shipped is REJECTED when any AC is still pending (shipped-gate)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested', 'pending', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    const map = readFeatureMap(tmpDir);
    // Feature state must be unchanged on rejection
    assert.strictEqual(map.features[0].state, 'tested');
    // ACs must be unchanged on rejection
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['tested', 'pending', 'tested']);
  });

  it('tested -> shipped is REJECTED when any AC is still prototyped', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested', 'prototyped', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'tested');
  });

  it('tested -> shipped SUCCEEDS when all ACs are tested', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested', 'tested', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), true);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'shipped');
    // ACs unchanged on shipped (no further promotion)
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['tested', 'tested', 'tested']);
  });

  it('tested -> shipped SUCCEEDS when feature has zero ACs (no obligations)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', [])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), true);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'shipped');
  });

  it('still rejects illegal transitions (e.g. planned -> tested) without touching ACs', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending', 'pending'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), false);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'planned');
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['pending', 'pending']);
  });
});

describe('F-042 truth table — feature transition × AC status', () => {
  // @cap-todo(ac:F-042/AC-5) Tests cover all valid state-transition × AC-status combinations.
  // Truth table dimensions:
  //   from-state ∈ {planned, prototyped, tested}  (shipped has no legal exits)
  //   to-state   ∈ legal successors of from-state
  //   ac-status  ∈ {pending, prototyped, tested}
  // For each combination we assert: (a) whether updateFeatureState returns true
  // and (b) the resulting AC status.

  /** @type {Array<{from:string,to:string,ac:string,expectAccept:boolean,expectAc:string}>} */
  const truthTable = [
    // planned -> prototyped: AC unchanged regardless
    { from: 'planned',    to: 'prototyped', ac: 'pending',    expectAccept: true,  expectAc: 'pending' },
    { from: 'planned',    to: 'prototyped', ac: 'prototyped', expectAccept: true,  expectAc: 'prototyped' },
    { from: 'planned',    to: 'prototyped', ac: 'tested',     expectAccept: true,  expectAc: 'tested' },

    // prototyped -> tested: pending/prototyped promoted to tested; tested left alone
    { from: 'prototyped', to: 'tested',     ac: 'pending',    expectAccept: true,  expectAc: 'tested' },
    { from: 'prototyped', to: 'tested',     ac: 'prototyped', expectAccept: true,  expectAc: 'tested' },
    { from: 'prototyped', to: 'tested',     ac: 'tested',     expectAccept: true,  expectAc: 'tested' },

    // tested -> shipped: gated; only allowed when AC is already tested
    { from: 'tested',     to: 'shipped',    ac: 'pending',    expectAccept: false, expectAc: 'pending' },
    { from: 'tested',     to: 'shipped',    ac: 'prototyped', expectAccept: false, expectAc: 'prototyped' },
    { from: 'tested',     to: 'shipped',    ac: 'tested',     expectAccept: true,  expectAc: 'tested' },
  ];

  for (const row of truthTable) {
    it(`${row.from} -> ${row.to} with AC=${row.ac} : accept=${row.expectAccept}, AC=>${row.expectAc}`, () => {
      writeSampleFeatureMap(tmpDir, [makeFeature(row.from, [row.ac])]);
      const result = updateFeatureState(tmpDir, 'F-001', row.to);
      assert.strictEqual(result, row.expectAccept, 'transition acceptance mismatch');
      const map = readFeatureMap(tmpDir);
      const expectedFinalState = row.expectAccept ? row.to : row.from;
      assert.strictEqual(map.features[0].state, expectedFinalState, 'feature state mismatch');
      assert.strictEqual(map.features[0].acs[0].status, row.expectAc, 'AC status mismatch');
    });
  }

  it('truth table covers every (from, to, ac) cell with a legal transition', () => {
    // Sanity: there are 3 (from-states with successors) × 1 successor each × 3 AC statuses = 9 rows.
    assert.strictEqual(truthTable.length, 9);
  });
});

describe('F-042 setAcStatus', () => {
  // @cap-todo(ac:F-042/AC-3) setAcStatus(projectRoot, featureId, acId, newStatus, appPath) — explicit per-AC mutation.

  it('exports the canonical AC status set', () => {
    assert.deepStrictEqual(AC_VALID_STATUSES, ['pending', 'prototyped', 'tested']);
  });

  it('updates a single AC and persists the change', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['pending', 'pending', 'pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-2', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['pending', 'tested', 'pending']);
  });

  it('does NOT modify feature state when promoting all ACs to tested', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['pending', 'pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'tested'), true);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-2', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'prototyped',
      'setAcStatus must not auto-promote feature state');
  });

  it('returns false for unknown feature', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-999', 'AC-1', 'tested'), false);
  });

  it('returns false for unknown AC ID', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-99', 'tested'), false);
  });

  it('returns false for invalid status', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'reviewed'), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'shipped'), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'bogus'), false);
    // verify the AC was not mutated
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'pending');
  });

  it('accepts each canonical status', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    for (const s of AC_VALID_STATUSES) {
      assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', s), true, `status ${s} should be accepted`);
      assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, s);
    }
  });
});

describe('F-042 drift detection', () => {
  // @cap-todo(ac:F-042/AC-4) detectDrift returns a structured DriftReport over features whose
  // state is shipped/tested but with one or more pending ACs.

  it('returns hasDrift=false for an empty Feature Map', () => {
    writeSampleFeatureMap(tmpDir, []);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.hasDrift, false);
    assert.strictEqual(report.driftCount, 0);
    assert.deepStrictEqual(report.features, []);
  });

  it('returns hasDrift=false when shipped features have only tested ACs', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped', ['tested', 'tested']), id: 'F-100' },
      { ...makeFeature('tested',  ['tested']),           id: 'F-101' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.hasDrift, false);
    assert.strictEqual(report.driftCount, 0);
  });

  it('flags a shipped feature with pending ACs', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped', ['tested', 'pending', 'tested']), id: 'F-100', title: 'Drifted' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.hasDrift, true);
    assert.strictEqual(report.driftCount, 1);
    assert.strictEqual(report.features[0].id, 'F-100');
    assert.strictEqual(report.features[0].state, 'shipped');
    assert.strictEqual(report.features[0].title, 'Drifted');
    assert.strictEqual(report.features[0].totalAcs, 3);
    assert.strictEqual(report.features[0].pendingAcs.length, 1);
    assert.strictEqual(report.features[0].pendingAcs[0].id, 'AC-2');
  });

  it('flags a tested feature with pending ACs', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('tested', ['pending', 'pending']), id: 'F-200' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 1);
    assert.strictEqual(report.features[0].state, 'tested');
    assert.strictEqual(report.features[0].pendingAcs.length, 2);
  });

  it('does NOT flag planned or prototyped features even if ACs are pending', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('planned',    ['pending', 'pending']), id: 'F-300' },
      { ...makeFeature('prototyped', ['pending', 'pending']), id: 'F-301' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.hasDrift, false);
  });

  it('does NOT flag features with prototyped ACs (only pending counts as drift)', () => {
    // Decision: drift is about clearly-unverified ACs (pending). prototyped is in-flight,
    // not necessarily a drift signal. AC-4 specifies "still pending" as the trigger.
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped', ['tested', 'prototyped']), id: 'F-400' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.hasDrift, false);
  });

  it('handles multiple drifting features and preserves order', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped',    ['tested']),          id: 'F-001' },  // clean
      { ...makeFeature('shipped',    ['pending']),         id: 'F-002' },  // drift
      { ...makeFeature('planned',    ['pending']),         id: 'F-003' },  // not flagged
      { ...makeFeature('tested',     ['pending', 'tested']), id: 'F-004' }, // drift
      { ...makeFeature('prototyped', ['pending']),         id: 'F-005' },  // not flagged
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 2);
    assert.deepStrictEqual(report.features.map(f => f.id), ['F-002', 'F-004']);
  });

  it('returns a structured report with the documented shape', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped', ['tested', 'pending']), id: 'F-500', title: 'Shape Check' },
    ]);
    const report = detectDrift(tmpDir);
    assert.ok('hasDrift' in report);
    assert.ok('driftCount' in report);
    assert.ok(Array.isArray(report.features));
    const entry = report.features[0];
    assert.deepStrictEqual(Object.keys(entry).sort(),
      ['id', 'pendingAcs', 'state', 'title', 'totalAcs'].sort());
    assert.deepStrictEqual(Object.keys(entry.pendingAcs[0]).sort(),
      ['description', 'id'].sort());
  });
});

describe('F-042 formatDriftReport', () => {
  // @cap-feature(feature:F-042) formatDriftReport renders the DriftReport as a markdown table for the
  // /cap:status --drift CLI (AC-6).

  it('returns a "no drift" message when the report is clean', () => {
    const out = formatDriftReport({ hasDrift: false, driftCount: 0, features: [] });
    assert.match(out, /none/i);
    assert.ok(!out.includes('|'));
  });

  it('renders a markdown table with one row per drifting feature', () => {
    const report = {
      hasDrift: true,
      driftCount: 2,
      features: [
        { id: 'F-019', title: 'A', state: 'shipped', pendingAcs: [{id:'AC-1',description:'x'}], totalAcs: 6 },
        { id: 'F-020', title: 'B', state: 'tested',  pendingAcs: [{id:'AC-1',description:'x'}, {id:'AC-2',description:'y'}], totalAcs: 4 },
      ],
    };
    const out = formatDriftReport(report);
    assert.match(out, /Status Drift Detected: 2 features/);
    assert.match(out, /\| Feature \| State\s+\| Pending ACs \|/);
    assert.match(out, /F-019/);
    assert.match(out, /F-020/);
    assert.match(out, /shipped/);
    assert.match(out, /tested/);
    assert.match(out, /1\/6/);
    assert.match(out, /2\/4/);
  });
});

describe('F-042 live Feature Map drift integration', () => {
  // @cap-feature(feature:F-042) Integration check against the actual repository FEATURE-MAP.md.
  // This test mirrors the acceptance gate for F-042/AC-4 — the drift report should detect every
  // shipped/tested feature with pending ACs in the live map.
  const repoFeatureMap = path.join(__dirname, '..', 'FEATURE-MAP.md');

  it('live Feature Map has zero drift (post-F-043 reconciliation invariant)',
    { skip: !fs.existsSync(repoFeatureMap) },
    () => {
      const report = detectDrift(path.dirname(repoFeatureMap));
      // Pre-F-043: this test asserted driftCount >= 14. After F-043 reconciliation
      // (commit 2c1a5ec on main) the live map should stay at 0 drift forever — any
      // regression here means a feature was promoted to shipped/tested without its
      // ACs being properly propagated, which is the symptom F-042 was meant to prevent.
      assert.strictEqual(report.driftCount, 0,
        `expected 0 drifting features post-reconciliation, got ${report.driftCount}`);
      assert.strictEqual(report.hasDrift, false);
    });

  it('formatDriftReport on a clean live map produces the no-drift message',
    { skip: !fs.existsSync(repoFeatureMap) },
    () => {
      const report = detectDrift(path.dirname(repoFeatureMap));
      const formatted = formatDriftReport(report);
      // Post-F-043: the formatter returns the no-drift sentinel for clean reports.
      // Pre-F-043 this test asserted the markdown table was rendered.
      assert.ok(formatted.length > 0, 'formatter must return a non-empty string even for clean reports');
      assert.ok(!formatted.includes('| F-'), 'no F-NNN rows expected in clean drift output');
    });
});

// =============================================================================
// F-042 adversarial — edge cases the prototyper may have missed
// =============================================================================
// @cap-feature(feature:F-042) Adversarial verification of state propagation,
// shipped-gate, setAcStatus defensive contract, drift detection borderlines,
// and the live --drift CLI fast-path. Every assertion here is designed to
// break the contract, not to demonstrate it.

describe('F-042 adversarial — shipped-gate corner cases', () => {
  // @cap-todo(ac:F-042/AC-2) Shipped-gate must reject illegal multi-step transitions
  // and must never silently write to disk on rejection.

  it('rejects planned -> shipped skip even when feature has zero ACs (transition guard wins)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', [])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'planned',
      'shipped-gate must not bypass the underlying transition table');
  });

  it('rejects prototyped -> shipped skip even when all ACs are tested', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['tested', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'prototyped');
  });

  it('rejects tested -> tested no-op (not in legal successor list)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'tested');
  });

  it('rejects shipped -> shipped (idempotency check; shipped is terminal)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('shipped', ['tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'shipped');
  });

  it('rejects backward transitions (shipped -> tested, tested -> prototyped) and leaves ACs untouched', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('shipped', ['tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'shipped');

    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'prototyped'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'tested',
      'rejected backward transition must not revert tested ACs');
  });

  it('rejected shipped-gate must NOT touch disk (mtime + content invariant)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['pending'])]);
    const filePath = path.join(tmpDir, FEATURE_MAP_FILE);
    const beforeMtime = fs.statSync(filePath).mtimeMs;
    const beforeContent = fs.readFileSync(filePath, 'utf8');
    // Spin to ensure the filesystem mtime resolution would actually advance
    const t0 = Date.now();
    while (Date.now() - t0 < 25) { /* spin */ }
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
    const afterMtime = fs.statSync(filePath).mtimeMs;
    const afterContent = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(beforeMtime, afterMtime, 'rejected transition must not rewrite the file');
    assert.strictEqual(beforeContent, afterContent, 'file content must be byte-identical after rejection');
  });

  it('shipped-gate treats legacy implemented AC status as blocking (only "tested" passes)', () => {
    // F-041 leaves room for legacy 'implemented' status to live in older feature maps.
    // The shipped-gate must require canonical 'tested', not the legacy synonym.
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['implemented'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), false);
  });

  it('updateFeatureState on missing FEATURE-MAP.md returns false without throwing', () => {
    // tmpDir exists but has no FEATURE-MAP.md
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), false);
  });

  it('rejects null/undefined/uppercase newState defensively', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', null), false);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', undefined), false);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'TESTED'), false,
      'state names are lowercase canonical; uppercase variants must not be accepted');
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', ''), false);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'xyz'), false);
  });

  it('rejects empty/null featureId defensively', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(updateFeatureState(tmpDir, '', 'tested'), false);
    assert.strictEqual(updateFeatureState(tmpDir, null, 'tested'), false);
    assert.strictEqual(updateFeatureState(tmpDir, 'f-001', 'prototyped'), false,
      'feature ID is case-sensitive; lowercase variant must not match');
  });
});

describe('F-042 adversarial — propagation edge cases', () => {
  // @cap-todo(ac:F-042/AC-1) Propagation must be a one-way ratchet on tested,
  // and must be a true no-op on prototyped regardless of AC mix.

  it('planned -> prototyped is a true no-op for every AC status (mixed)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending', 'prototyped', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'prototyped'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status), ['pending', 'prototyped', 'tested']);
  });

  it('prototyped -> tested with NO ACs at all transitions cleanly', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', [])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.strictEqual(map.features[0].state, 'tested');
    assert.deepStrictEqual(map.features[0].acs, []);
  });

  it('prototyped -> tested propagates only the affected AC subset (non-tested ones)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('prototyped', ['tested', 'pending', 'prototyped', 'tested'])]);
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'tested'), true);
    const map = readFeatureMap(tmpDir);
    assert.deepStrictEqual(map.features[0].acs.map(a => a.status),
      ['tested', 'tested', 'tested', 'tested']);
  });

  it('tested -> shipped does NOT mutate AC statuses when accepted (no further promotion)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested', 'tested'])]);
    const before = readFeatureMap(tmpDir).features[0].acs.map(a => ({ ...a }));
    assert.strictEqual(updateFeatureState(tmpDir, 'F-001', 'shipped'), true);
    const after = readFeatureMap(tmpDir).features[0].acs;
    assert.deepStrictEqual(after, before, 'shipped acceptance must be AC-neutral');
  });
});

describe('F-042 adversarial — setAcStatus contract', () => {
  // @cap-todo(ac:F-042/AC-3) setAcStatus is the explicit per-AC mutation surface.
  // It must be defensive on inputs, monorepo-aware, and orthogonal to feature state.

  it('rejects null/undefined/empty/uppercase status defensively', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', null), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', undefined), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', ''), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'TESTED'), false,
      'status is lowercase canonical; uppercase must not be accepted');
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', ' tested '), false,
      'status must not be whitespace-padded');
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'pending',
      'AC must remain unchanged after every rejection');
  });

  it('treats AC IDs as case-sensitive (ac-1 / Ac-1 do not match AC-1)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'ac-1', 'tested'), false);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'Ac-1', 'tested'), false);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'pending');
  });

  it('treats feature IDs as case-sensitive (f-001 does not match F-001)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'f-001', 'AC-1', 'tested'), false);
    assert.strictEqual(setAcStatus(tmpDir, '', 'AC-1', 'tested'), false);
    assert.strictEqual(setAcStatus(tmpDir, null, 'AC-1', 'tested'), false);
  });

  it('allows backward AC moves (tested -> pending) — explicit per-AC mutation, not a ratchet', () => {
    // setAcStatus is the ESCAPE HATCH for explicit control. Unlike updateFeatureState
    // which propagates monotonically, setAcStatus must not pretend to enforce a ratchet —
    // that would re-create the old "no way to correct a wrongly-promoted AC" pain.
    writeSampleFeatureMap(tmpDir, [makeFeature('tested', ['tested'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'pending'), true);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'pending');
    assert.strictEqual(readFeatureMap(tmpDir).features[0].state, 'tested',
      'feature state stays put — setAcStatus must never auto-demote the feature either');
  });

  it('setting AC to its current value still succeeds (idempotent write)', () => {
    writeSampleFeatureMap(tmpDir, [makeFeature('planned', ['pending'])]);
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'pending'), true);
    assert.strictEqual(readFeatureMap(tmpDir).features[0].acs[0].status, 'pending');
  });

  it('returns false on missing FEATURE-MAP.md without throwing', () => {
    // tmpDir is empty
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'tested'), false);
  });

  it('persists to the correct app-scoped FEATURE-MAP.md in monorepo mode', () => {
    fs.mkdirSync(path.join(tmpDir, 'apps', 'flow'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'apps', 'hub'), { recursive: true });
    const flowMap = { features: [makeFeature('planned', ['pending'])], lastScan: null };
    const hubMap  = { features: [makeFeature('planned', ['pending'])], lastScan: null };
    writeFeatureMap(tmpDir, flowMap, 'apps/flow');
    writeFeatureMap(tmpDir, hubMap,  'apps/hub');
    assert.strictEqual(setAcStatus(tmpDir, 'F-001', 'AC-1', 'tested', 'apps/flow'), true);
    // flow updated
    assert.strictEqual(readFeatureMap(tmpDir, 'apps/flow').features[0].acs[0].status, 'tested');
    // hub untouched (no cross-app bleed)
    assert.strictEqual(readFeatureMap(tmpDir, 'apps/hub').features[0].acs[0].status, 'pending');
  });
});

describe('F-042 adversarial — detectDrift borderline semantics', () => {
  // @cap-todo(ac:F-042/AC-4) Drift policy: only state ∈ {tested,shipped} ∧ pending ACs.
  // prototyped/implemented/tested ACs do NOT trigger drift, even under shipped state.

  it('shipped feature with ZERO ACs is NOT drift (vacuous — no pending obligations)', () => {
    writeSampleFeatureMap(tmpDir, [{ ...makeFeature('shipped', []), id: 'F-700' }]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 0,
      'a shipped feature with zero ACs has no pending ACs and is therefore not drift');
  });

  it('shipped feature with all ACs prototyped is NOT drift (only "pending" counts)', () => {
    writeSampleFeatureMap(tmpDir, [{ ...makeFeature('shipped', ['prototyped', 'prototyped']), id: 'F-701' }]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 0);
  });

  it('shipped feature with legacy "implemented" ACs is NOT drift (only "pending" counts)', () => {
    writeSampleFeatureMap(tmpDir, [{ ...makeFeature('shipped', ['implemented']), id: 'F-702' }]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 0,
      'detectDrift policy is pending-only; legacy implemented status does not surface as drift');
  });

  it('returns the no-drift shape on a missing FEATURE-MAP.md (no throw, hasDrift=false)', () => {
    // tmpDir exists but has no map
    const report = detectDrift(tmpDir);
    assert.deepStrictEqual(report, { hasDrift: false, driftCount: 0, features: [] });
  });

  it('totalAcs in drift entry counts ALL ACs, not just pending ones', () => {
    writeSampleFeatureMap(tmpDir, [
      { ...makeFeature('shipped', ['tested', 'tested', 'pending', 'prototyped']), id: 'F-800' },
    ]);
    const report = detectDrift(tmpDir);
    assert.strictEqual(report.driftCount, 1);
    assert.strictEqual(report.features[0].totalAcs, 4);
    assert.strictEqual(report.features[0].pendingAcs.length, 1);
    assert.strictEqual(report.features[0].pendingAcs[0].id, 'AC-3');
  });
});

describe('F-042 adversarial — formatDriftReport defensive', () => {
  // @cap-todo(ac:F-042/AC-6) formatDriftReport is the CLI surface; nullish input must
  // degrade gracefully rather than throw and crash the user-visible status command.

  it('does not throw on null input (treated as no-drift)', () => {
    let out;
    assert.doesNotThrow(() => { out = formatDriftReport(null); });
    assert.match(out, /none/i);
  });

  it('does not throw on undefined input (treated as no-drift)', () => {
    let out;
    assert.doesNotThrow(() => { out = formatDriftReport(undefined); });
    assert.match(out, /none/i);
  });

  it('does not throw on a fabricated empty-but-shaped report', () => {
    const out = formatDriftReport({ hasDrift: false, driftCount: 0, features: [] });
    assert.match(out, /none/i);
  });
});

describe('F-042 adversarial — live repo invariants', () => {
  // @cap-feature(feature:F-042) End-to-end invariants over the live repo Feature Map:
  // F-041 (state=tested, ACs still pending) must surface in drift; F-042 (state=prototyped)
  // must NOT — prototyped is intentionally outside the drift policy.
  const repoRoot = path.join(__dirname, '..');
  const repoFeatureMap = path.join(repoRoot, 'FEATURE-MAP.md');

  it('F-041 has zero drift in the live map (post-F-043 reconciliation invariant)',
    { skip: !fs.existsSync(repoFeatureMap) },
    () => {
      const report = detectDrift(repoRoot);
      const f041 = report.features.find(f => f.id === 'F-041');
      // Pre-F-043: F-041 was state=tested with all ACs still pending (drift candidate).
      // Post-F-043: ACs were promoted to tested by reconciliation. F-041 must NOT
      // appear in drift any longer — regression here means propagation broke.
      assert.strictEqual(f041, undefined,
        'F-041 must not appear in drift after F-043 reconciliation promoted its ACs');
    });

  it('F-042 itself does NOT appear in the live drift report (post-reconcile invariant)',
    { skip: !fs.existsSync(repoFeatureMap) },
    () => {
      const report = detectDrift(repoRoot);
      const f042 = report.features.find(f => f.id === 'F-042');
      assert.strictEqual(f042, undefined,
        'F-042 must not appear in drift — its self-promotion path correctly propagated all ACs');
    });

  it('formatDriftReport on the post-reconcile live repo lists no features',
    { skip: !fs.existsSync(repoFeatureMap) },
    () => {
      const report = detectDrift(repoRoot);
      const formatted = formatDriftReport(report);
      // Pre-F-043 this asserted F-041 visible in output. Post-F-043 the live map is
      // clean so neither F-041 nor any other F-NNN row should appear.
      assert.ok(!formatted.includes('| F-041'), 'F-041 must not appear in CLI output post-reconcile');
      assert.ok(!formatted.includes('| F-042'), 'F-042 must not appear in CLI output');
    });
});
