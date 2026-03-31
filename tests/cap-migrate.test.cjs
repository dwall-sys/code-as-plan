'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  GSD_TAG_RE,
  SUPPORTED_EXTENSIONS,
  EXCLUDE_DIRS,
  migrateLineTag,
  migrateTags,
  migrateArtifacts,
  extractFeaturesFromLegacy,
  migrateSession,
  analyzeMigration,
} = require('../cap/bin/lib/cap-migrate.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-migrate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- GSD_TAG_RE tests ---

describe('GSD_TAG_RE', () => {
  it('matches @gsd-feature tag', () => {
    const line = '// @gsd-feature Auth module implementation';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'feature');
  });

  it('matches @gsd-todo tag with metadata', () => {
    const line = '// @gsd-todo(ref:AC-20) Primary tags';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'todo');
    assert.strictEqual(match[3], '(ref:AC-20)');
  });

  it('matches @gsd-risk tag', () => {
    const line = '# @gsd-risk Memory leak possible';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'risk');
  });

  it('matches @gsd-decision tag', () => {
    const line = '// @gsd-decision Use bcrypt over argon2';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'decision');
  });

  it('matches @gsd-context tag', () => {
    const line = '// @gsd-context CAP v2.0 tag scanner';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'context');
  });

  it('matches @gsd-constraint tag', () => {
    const line = '// @gsd-constraint Zero external dependencies';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'constraint');
  });

  it('matches @gsd-pattern tag', () => {
    const line = '// @gsd-pattern Same comment anchor rule as ARC';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'pattern');
  });

  it('matches @gsd-api tag', () => {
    const line = '// @gsd-api parseMetadata(str) -- Parses values';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'api');
  });

  it('matches @gsd-status tag', () => {
    const line = '// @gsd-status implemented';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'status');
  });

  it('matches @gsd-depends tag', () => {
    const line = '// @gsd-depends F-001, F-002';
    const match = line.match(GSD_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[2], 'depends');
  });
});

// --- migrateLineTag tests ---

describe('migrateLineTag', () => {
  it('converts @gsd-feature to @cap-feature', () => {
    const result = migrateLineTag('// @gsd-feature Auth module');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-feature'));
    assert.ok(!result.replaced.includes('@gsd-'));
  });

  it('converts @gsd-todo to @cap-todo', () => {
    const result = migrateLineTag('// @gsd-todo Fix this bug');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-todo'));
  });

  it('converts @gsd-todo with metadata', () => {
    const result = migrateLineTag('// @gsd-todo(ref:AC-20) Primary tags');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-todo(ref:AC-20)'));
  });

  it('converts @gsd-risk to @cap-todo risk:', () => {
    const result = migrateLineTag('// @gsd-risk Memory leak possible');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-todo'));
    assert.ok(result.replaced.includes('risk:'));
    assert.ok(result.replaced.includes('Memory leak possible'));
  });

  it('converts @gsd-decision to @cap-todo decision:', () => {
    const result = migrateLineTag('// @gsd-decision Use bcrypt over argon2');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-todo'));
    assert.ok(result.replaced.includes('decision:'));
    assert.ok(result.replaced.includes('Use bcrypt over argon2'));
  });

  it('converts @gsd-constraint to @cap-todo risk: [constraint]', () => {
    const result = migrateLineTag('// @gsd-constraint Zero external deps');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-todo'));
    assert.ok(result.replaced.includes('risk: [constraint]'));
    assert.ok(result.replaced.includes('Zero external deps'));
  });

  it('removes @gsd-context tag (plain comment)', () => {
    const result = migrateLineTag('// @gsd-context CAP v2.0 scanner');
    assert.ok(result);
    assert.strictEqual(result.action, 'plain-comment');
    assert.ok(!result.replaced.includes('@gsd-'));
    assert.ok(result.replaced.includes('CAP v2.0 scanner'));
  });

  it('removes @gsd-status tag', () => {
    const result = migrateLineTag('// @gsd-status implemented');
    assert.ok(result);
    assert.strictEqual(result.action, 'removed');
    assert.ok(!result.replaced.includes('@gsd-'));
  });

  it('removes @gsd-depends tag', () => {
    const result = migrateLineTag('// @gsd-depends F-001');
    assert.ok(result);
    assert.strictEqual(result.action, 'removed');
    assert.ok(!result.replaced.includes('@gsd-'));
  });

  it('converts @gsd-pattern to plain comment', () => {
    const result = migrateLineTag('// @gsd-pattern Same anchor rule');
    assert.ok(result);
    assert.strictEqual(result.action, 'plain-comment');
    assert.ok(!result.replaced.includes('@gsd-pattern'));
  });

  it('converts @gsd-api to plain comment', () => {
    const result = migrateLineTag('// @gsd-api parseMetadata(str) -- Parses');
    assert.ok(result);
    assert.strictEqual(result.action, 'plain-comment');
    assert.ok(!result.replaced.includes('@gsd-api'));
  });

  it('converts @gsd-ref to @cap-ref', () => {
    const result = migrateLineTag('// @gsd-ref See AUTH-001');
    assert.ok(result);
    assert.strictEqual(result.action, 'converted');
    assert.ok(result.replaced.includes('@cap-ref'));
  });

  it('returns null for lines without @gsd- tags', () => {
    assert.strictEqual(migrateLineTag('const x = 1;'), null);
    assert.strictEqual(migrateLineTag('// Just a comment'), null);
    assert.strictEqual(migrateLineTag('// @cap-todo Already migrated'), null);
  });

  it('handles Python hash comments', () => {
    const result = migrateLineTag('# @gsd-feature Database module');
    assert.ok(result);
    assert.ok(result.replaced.includes('@cap-feature'));
  });
});

// --- migrateTags tests ---

describe('migrateTags', () => {
  it('scans and converts tags in source files', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'auth.js'),
      '// @gsd-feature Auth module\nconst login = () => {};\n// @gsd-todo Implement hashing\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.filesModified, 1);
    assert.strictEqual(result.tagsConverted, 2);
    assert.strictEqual(result.changes.length, 2);

    // Verify file was actually modified
    const content = fs.readFileSync(path.join(srcDir, 'auth.js'), 'utf8');
    assert.ok(content.includes('@cap-feature'));
    assert.ok(content.includes('@cap-todo'));
    assert.ok(!content.includes('@gsd-'));
  });

  it('supports dry run mode (no file writes)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'app.js'),
      '// @gsd-feature App entry\n',
      'utf8'
    );

    const result = migrateTags(tmpDir, { dryRun: true });
    assert.strictEqual(result.filesModified, 1);
    assert.strictEqual(result.tagsConverted, 1);

    // File should NOT be modified
    const content = fs.readFileSync(path.join(tmpDir, 'app.js'), 'utf8');
    assert.ok(content.includes('@gsd-feature'));
  });

  it('skips node_modules directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'dep.js'),
      '// @gsd-feature Should not be touched\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'app.js'),
      '// @gsd-feature Should be converted\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.tagsConverted, 1);
  });

  it('skips .git directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(
      path.join(tmpDir, '.git', 'hook.js'),
      '// @gsd-todo Should not appear\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesScanned, 0);
  });

  it('handles files with no tags', () => {
    fs.writeFileSync(path.join(tmpDir, 'clean.js'), 'const x = 1;\n', 'utf8');
    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.filesModified, 0);
    assert.strictEqual(result.tagsConverted, 0);
  });

  it('handles files with mixed @gsd- and @cap- tags', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'mixed.js'),
      '// @cap-feature Already migrated\n// @gsd-todo Still needs migration\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.tagsConverted, 1);

    const content = fs.readFileSync(path.join(tmpDir, 'mixed.js'), 'utf8');
    assert.ok(content.includes('@cap-feature Already migrated'));
    assert.ok(content.includes('@cap-todo'));
  });

  it('handles already-migrated files (all @cap- tags)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'migrated.js'),
      '// @cap-feature Auth module\n// @cap-todo Fix this\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesModified, 0);
    assert.strictEqual(result.tagsConverted, 0);
  });

  it('counts removed tags separately from converted tags', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'mixed.js'),
      '// @gsd-feature Auth\n// @gsd-context Some context\n// @gsd-status done\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.tagsConverted, 1);  // @gsd-feature
    assert.strictEqual(result.tagsRemoved, 2);     // @gsd-context + @gsd-status
  });

  it('processes nested directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'lib', 'util.js'),
      '// @gsd-todo Implement util\n',
      'utf8'
    );

    const result = migrateTags(tmpDir);
    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.tagsConverted, 1);
  });

  it('respects custom extensions filter', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), '// @gsd-feature JS file\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'app.py'), '# @gsd-feature Python file\n', 'utf8');

    const result = migrateTags(tmpDir, { extensions: ['.js'] });
    assert.strictEqual(result.filesScanned, 1);
    assert.strictEqual(result.tagsConverted, 1);
  });
});

// --- extractFeaturesFromLegacy tests ---

describe('extractFeaturesFromLegacy', () => {
  it('extracts features from markdown headings', () => {
    const content = `# Features

## Authentication System

- [x] Login endpoint
- [ ] Password reset

## Database Layer

- [ ] Connection pooling
`;
    const features = extractFeaturesFromLegacy(content);
    assert.strictEqual(features.length, 2);
    assert.strictEqual(features[0].title, 'Authentication System');
    assert.strictEqual(features[0].acs.length, 2);
    assert.strictEqual(features[0].acs[0].status, 'implemented');
    assert.strictEqual(features[0].acs[1].status, 'pending');
    assert.strictEqual(features[1].title, 'Database Layer');
  });

  it('extracts features with numbered headings', () => {
    const content = `## 1. Auth Module
## 2. API Gateway
`;
    const features = extractFeaturesFromLegacy(content);
    assert.strictEqual(features.length, 2);
    assert.strictEqual(features[0].title, 'Auth Module');
    assert.strictEqual(features[1].title, 'API Gateway');
  });

  it('returns empty array for content with no features', () => {
    const features = extractFeaturesFromLegacy('Just some text.\nNo features here.\n');
    assert.deepStrictEqual(features, []);
  });

  it('handles Feature: prefix in headings', () => {
    const content = '## Feature: User Dashboard\n';
    const features = extractFeaturesFromLegacy(content);
    assert.strictEqual(features.length, 1);
    assert.strictEqual(features[0].title, 'User Dashboard');
  });
});

// --- migrateArtifacts tests ---

describe('migrateArtifacts', () => {
  it('creates FEATURE-MAP.md from FEATURES.md', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'FEATURES.md'),
      '## Auth Module\n\n- [ ] Login endpoint\n- [ ] Password reset\n',
      'utf8'
    );

    const result = migrateArtifacts(tmpDir);
    assert.strictEqual(result.source, 'FEATURES.md');
    assert.strictEqual(result.featuresFound, 1);
    assert.strictEqual(result.featureMapCreated, true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'FEATURE-MAP.md')));
  });

  it('supports dry run mode', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'FEATURES.md'),
      '## Auth Module\n',
      'utf8'
    );

    const result = migrateArtifacts(tmpDir, { dryRun: true });
    assert.strictEqual(result.featuresFound, 1);
    assert.strictEqual(result.featureMapCreated, true);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'FEATURE-MAP.md')));
  });

  it('returns no-op when no legacy artifacts exist', () => {
    const result = migrateArtifacts(tmpDir);
    assert.strictEqual(result.source, 'none');
    assert.strictEqual(result.featuresFound, 0);
    assert.strictEqual(result.featureMapCreated, false);
  });

  it('falls back to REQUIREMENTS.md when FEATURES.md not found', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      '## User Authentication\n\n- [ ] OAuth support\n',
      'utf8'
    );

    const result = migrateArtifacts(tmpDir);
    assert.strictEqual(result.source, 'REQUIREMENTS.md');
    assert.strictEqual(result.featuresFound, 1);
  });

  it('does not overwrite existing FEATURE-MAP.md with duplicate features', () => {
    // Create existing Feature Map
    const capFeatureMap = require('../cap/bin/lib/cap-feature-map.cjs');
    const template = capFeatureMap.generateTemplate();
    fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), template, 'utf8');
    capFeatureMap.addFeature(tmpDir, { title: 'Auth Module', acs: [] });

    // Create legacy artifact with same feature
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'FEATURES.md'),
      '## Auth Module\n\n- [ ] Login\n',
      'utf8'
    );

    migrateArtifacts(tmpDir);
    const featureMap = capFeatureMap.readFeatureMap(tmpDir);
    // Should not duplicate
    const authFeatures = featureMap.features.filter(f => f.title.toLowerCase() === 'auth module');
    assert.strictEqual(authFeatures.length, 1);
  });
});

// --- migrateSession tests ---

describe('migrateSession', () => {
  it('migrates .planning/SESSION.json to .cap/SESSION.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'SESSION.json'),
      JSON.stringify({
        current_app: 'my-app',
        current_phase: 3,
        started_at: '2025-01-01T00:00:00Z',
      }),
      'utf8'
    );

    const result = migrateSession(tmpDir);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.oldFormat, 'v1.x');
    assert.strictEqual(result.newFormat, 'v2.0');

    // Verify .cap/SESSION.json was created
    assert.ok(fs.existsSync(path.join(tmpDir, '.cap', 'SESSION.json')));
    const newSession = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cap', 'SESSION.json'), 'utf8'));
    assert.strictEqual(newSession.version, '2.0.0');
    assert.strictEqual(newSession.metadata.legacyApp, 'my-app');
    assert.strictEqual(newSession.step, 'legacy-phase-3');
  });

  it('supports dry run mode', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'SESSION.json'),
      JSON.stringify({ current_app: 'test' }),
      'utf8'
    );

    const result = migrateSession(tmpDir, { dryRun: true });
    assert.strictEqual(result.migrated, true);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.cap', 'SESSION.json')));
  });

  it('returns no-op when no SESSION.json exists', () => {
    const result = migrateSession(tmpDir);
    assert.strictEqual(result.migrated, false);
    assert.strictEqual(result.oldFormat, 'none');
  });

  it('handles corrupt SESSION.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'SESSION.json'),
      '{not valid json',
      'utf8'
    );

    const result = migrateSession(tmpDir);
    assert.strictEqual(result.migrated, false);
    assert.strictEqual(result.oldFormat, 'corrupt');
  });

  it('preserves old session fields as metadata', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'SESSION.json'),
      JSON.stringify({ current_app: 'my-app', custom_field: 'custom_value' }),
      'utf8'
    );

    migrateSession(tmpDir);
    const newSession = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cap', 'SESSION.json'), 'utf8'));
    assert.strictEqual(newSession.metadata.gsd_current_app, 'my-app');
    assert.strictEqual(newSession.metadata.gsd_custom_field, 'custom_value');
  });
});

// --- analyzeMigration tests ---

describe('analyzeMigration', () => {
  it('detects GSD tags in source files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'app.js'),
      '// @gsd-feature Auth\n// @gsd-todo Fix this\n',
      'utf8'
    );

    const report = analyzeMigration(tmpDir);
    assert.strictEqual(report.gsdTagCount, 2);
    assert.ok(report.recommendations.length > 0);
  });

  it('detects .planning/ directory and artifacts', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'FEATURES.md'), '# Features\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf8');

    const report = analyzeMigration(tmpDir);
    assert.strictEqual(report.planningDir, true);
    assert.ok(report.gsdArtifacts.includes('.planning/FEATURES.md'));
    assert.ok(report.gsdArtifacts.includes('.planning/ROADMAP.md'));
  });

  it('detects .planning/SESSION.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SESSION.json'), '{}', 'utf8');

    const report = analyzeMigration(tmpDir);
    assert.strictEqual(report.sessionJson, true);
  });

  it('reports clean project with no GSD artifacts', () => {
    const report = analyzeMigration(tmpDir);
    assert.strictEqual(report.gsdTagCount, 0);
    assert.strictEqual(report.gsdArtifacts.length, 0);
    assert.strictEqual(report.planningDir, false);
    assert.strictEqual(report.sessionJson, false);
    assert.ok(report.recommendations.some(r => r.includes('No GSD v1.x artifacts detected')));
  });

  it('recommends creating FEATURE-MAP.md when missing', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'FEATURES.md'), '## Auth\n', 'utf8');

    const report = analyzeMigration(tmpDir);
    assert.ok(report.recommendations.some(r => r.includes('FEATURE-MAP.md')));
  });

  it('recommends initializing .cap/ when missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), '// @gsd-feature Auth\n', 'utf8');

    const report = analyzeMigration(tmpDir);
    assert.ok(report.recommendations.some(r => r.includes('.cap/')));
  });
});

// --- Zero-dep compliance ---

describe('zero-dep compliance', () => {
  it('cap-migrate.cjs only requires node: built-ins and local modules', () => {
    const migratePath = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-migrate.cjs');
    const content = fs.readFileSync(migratePath, 'utf8');

    const requireRE = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    const requires = [];
    while ((match = requireRE.exec(content)) !== null) {
      requires.push(match[1]);
    }

    for (const req of requires) {
      const isBuiltin = req.startsWith('node:');
      const isLocal = req.startsWith('./') || req.startsWith('../');
      assert.ok(
        isBuiltin || isLocal,
        `Unexpected external require: ${req}`
      );
    }
  });
});
