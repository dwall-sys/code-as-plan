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
  initAppFeatureMap,
  listAppFeatureMaps,
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
