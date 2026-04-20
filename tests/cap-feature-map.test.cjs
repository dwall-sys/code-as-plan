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
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
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
