// @cap-feature(feature:F-089) Sharded Feature Map — unit tests for shard helpers
// @cap-context Pure-function tests for ID validation, index parse/serialize, and surgical patches.
//   Filesystem probes (isShardedMap) tested with tmpdir scaffolding.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shard = require('../cap/bin/lib/cap-feature-map-shard.cjs');

describe('F-089 cap-feature-map-shard — validateFeatureId', () => {
  it('accepts legacy F-NNN', () => {
    assert.equal(shard.validateFeatureId('F-001'), true);
    assert.equal(shard.validateFeatureId('F-088'), true);
    assert.equal(shard.validateFeatureId('F-1234'), true);
  });

  it('accepts F-LONGFORM uppercase IDs', () => {
    assert.equal(shard.validateFeatureId('F-DEPLOY'), true);
    assert.equal(shard.validateFeatureId('F-FOO_BAR'), true);
    assert.equal(shard.validateFeatureId('F-FOO-BAR'), true);
  });

  it('accepts F-Deskriptiv mixed-case IDs (capital first letter + at least one hyphen)', () => {
    assert.equal(shard.validateFeatureId('F-Hub-Spotlight-Carousel'), true);
    assert.equal(shard.validateFeatureId('F-App2-Feature3'), true);
    assert.equal(shard.validateFeatureId('F-Hub-AuthGate'), true);
  });

  it('rejects single-segment descriptive forms (must have at least one hyphen)', () => {
    assert.equal(shard.validateFeatureId('F-Hub'), false); // no hyphen, mixed case
    assert.equal(shard.validateFeatureId('F-deploy'), false); // lowercase single segment
  });

  it('rejects pure-lowercase descriptive forms (must start with uppercase)', () => {
    assert.equal(shard.validateFeatureId('F-foo-bar'), false);
    assert.equal(shard.validateFeatureId('F-hub-spotlight'), false);
  });

  it('rejects F-076-suffix (preserves F-076 schema invariant)', () => {
    assert.equal(shard.validateFeatureId('F-076-suffix'), false);
    assert.equal(shard.validateFeatureId('F-001-extra'), false);
  });

  it('rejects malformed inputs', () => {
    assert.equal(shard.validateFeatureId(''), false);
    assert.equal(shard.validateFeatureId('F-'), false);
    assert.equal(shard.validateFeatureId('F'), false);
    assert.equal(shard.validateFeatureId('foo'), false);
    assert.equal(shard.validateFeatureId('F-foo--bar'), false); // consecutive separator
    assert.equal(shard.validateFeatureId('F-foo-'), false); // trailing hyphen
    assert.equal(shard.validateFeatureId('F-foo bar'), false); // whitespace
  });

  it('rejects non-string inputs', () => {
    assert.equal(shard.validateFeatureId(null), false);
    assert.equal(shard.validateFeatureId(undefined), false);
    assert.equal(shard.validateFeatureId(123), false);
    assert.equal(shard.validateFeatureId({}), false);
    assert.equal(shard.validateFeatureId([]), false);
  });

  it('rejects path-traversal attempts (defense in depth)', () => {
    assert.equal(shard.validateFeatureId('F-../etc-passwd'), false);
    assert.equal(shard.validateFeatureId('F-foo/bar'), false);
    assert.equal(shard.validateFeatureId('F-foo\\bar'), false);
  });

  it('rejects IDs longer than MAX_ID_LENGTH', () => {
    const longTail = 'a'.repeat(shard.MAX_ID_LENGTH);
    assert.equal(shard.validateFeatureId('F-' + longTail), false);
  });
});

describe('F-089 cap-feature-map-shard — featureFilename', () => {
  it('returns <ID>.md for valid IDs', () => {
    assert.equal(shard.featureFilename('F-001'), 'F-001.md');
    assert.equal(shard.featureFilename('F-Hub-Spotlight'), 'F-Hub-Spotlight.md');
  });

  it('throws on invalid IDs', () => {
    assert.throws(() => shard.featureFilename('F-076-suffix'), /invalid feature ID/);
    assert.throws(() => shard.featureFilename('../etc/passwd'), /invalid feature ID/);
  });
});

describe('F-089 cap-feature-map-shard — featuresDirPath / featureFilePath', () => {
  it('joins projectRoot with features/', () => {
    assert.equal(shard.featuresDirPath('/proj'), path.join('/proj', 'features'));
    assert.equal(shard.featuresDirPath('/proj', null), path.join('/proj', 'features'));
  });

  it('respects appPath for monorepo sub-app scoping', () => {
    assert.equal(
      shard.featuresDirPath('/proj', 'apps/hub'),
      path.join('/proj', 'apps/hub', 'features')
    );
  });

  it('featureFilePath assembles the full path', () => {
    assert.equal(
      shard.featureFilePath('/proj', 'F-001'),
      path.join('/proj', 'features', 'F-001.md')
    );
    assert.equal(
      shard.featureFilePath('/proj', 'F-Hub-Auth', 'apps/hub'),
      path.join('/proj', 'apps/hub', 'features', 'F-Hub-Auth.md')
    );
  });
});

describe('F-089 cap-feature-map-shard — isShardedMap', () => {
  let tmp;
  function setUp() {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-shard-'));
  }
  function tearDown() {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  it('returns false when features/ directory is absent', () => {
    setUp();
    try {
      assert.equal(shard.isShardedMap(tmp), false);
    } finally {
      tearDown();
    }
  });

  it('returns false when features/ exists but is empty', () => {
    setUp();
    try {
      fs.mkdirSync(path.join(tmp, 'features'));
      assert.equal(shard.isShardedMap(tmp), false);
    } finally {
      tearDown();
    }
  });

  it('returns false when features/ contains no F-*.md files', () => {
    setUp();
    try {
      fs.mkdirSync(path.join(tmp, 'features'));
      fs.writeFileSync(path.join(tmp, 'features', 'README.md'), '# notes');
      fs.writeFileSync(path.join(tmp, 'features', 'other.txt'), 'x');
      assert.equal(shard.isShardedMap(tmp), false);
    } finally {
      tearDown();
    }
  });

  it('returns true when at least one F-*.md exists', () => {
    setUp();
    try {
      fs.mkdirSync(path.join(tmp, 'features'));
      fs.writeFileSync(path.join(tmp, 'features', 'F-001.md'), '### F-001: Test');
      assert.equal(shard.isShardedMap(tmp), true);
    } finally {
      tearDown();
    }
  });

  it('respects appPath scoping', () => {
    setUp();
    try {
      fs.mkdirSync(path.join(tmp, 'apps', 'hub', 'features'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps', 'hub', 'features', 'F-Hub-Auth.md'), '### F-Hub-Auth: x');
      assert.equal(shard.isShardedMap(tmp, 'apps/hub'), true);
      assert.equal(shard.isShardedMap(tmp), false); // root-level features/ is absent
    } finally {
      tearDown();
    }
  });
});

describe('F-089 cap-feature-map-shard — parseIndexLine', () => {
  it('parses canonical index line', () => {
    const e = shard.parseIndexLine('- F-001 | shipped | Tag Scanner');
    assert.deepEqual(e, { id: 'F-001', state: 'shipped', title: 'Tag Scanner' });
  });

  it('parses deskriptiv ID', () => {
    const e = shard.parseIndexLine('- F-Hub-Spotlight | planned | Spotlight Carousel auf Homepage');
    assert.deepEqual(e, {
      id: 'F-Hub-Spotlight',
      state: 'planned',
      title: 'Spotlight Carousel auf Homepage',
    });
  });

  it('tolerates extra whitespace', () => {
    const e = shard.parseIndexLine('-   F-001   |   shipped   |   Tag Scanner   ');
    assert.deepEqual(e, { id: 'F-001', state: 'shipped', title: 'Tag Scanner' });
  });

  it('returns null on malformed input', () => {
    assert.equal(shard.parseIndexLine('not a line'), null);
    assert.equal(shard.parseIndexLine('- F-001 shipped Tag Scanner'), null); // missing pipes
    assert.equal(shard.parseIndexLine('- INVALID | shipped | foo'), null); // bad ID
    assert.equal(shard.parseIndexLine(''), null);
  });
});

describe('F-089 cap-feature-map-shard — serializeIndexEntry', () => {
  it('emits canonical line for valid entry', () => {
    assert.equal(
      shard.serializeIndexEntry({ id: 'F-001', state: 'shipped', title: 'Tag Scanner' }),
      '- F-001 | shipped | Tag Scanner'
    );
  });

  it('throws on invalid feature ID', () => {
    assert.throws(
      () => shard.serializeIndexEntry({ id: 'BAD', state: 'shipped', title: 'x' }),
      /invalid feature ID/
    );
  });

  it('throws on title with pipe character', () => {
    assert.throws(
      () => shard.serializeIndexEntry({ id: 'F-001', state: 'shipped', title: 'a | b' }),
      /title cannot contain/
    );
  });

  it('throws on title with newline', () => {
    assert.throws(
      () => shard.serializeIndexEntry({ id: 'F-001', state: 'shipped', title: 'a\nb' }),
      /title cannot contain/
    );
  });

  it('throws on empty/whitespace state', () => {
    assert.throws(
      () => shard.serializeIndexEntry({ id: 'F-001', state: '', title: 'x' }),
      /invalid state/
    );
    assert.throws(
      () => shard.serializeIndexEntry({ id: 'F-001', state: 'a b', title: 'x' }),
      /invalid state/
    );
  });
});

describe('F-089 cap-feature-map-shard — parseIndex', () => {
  it('extracts entries from the ## Features section', () => {
    const content = [
      '# Feature Map',
      '',
      '> Some prose',
      '',
      '## Features',
      '',
      '- F-001 | shipped | Tag Scanner',
      '- F-088 | shipped | Lossless FEATURE-MAP Round-Trip',
      '- F-Hub-Spotlight | planned | Spotlight Carousel',
      '',
      '## Legend',
      '',
      '| State | Meaning |',
      '|-------|---------|',
      '| planned | Feature identified, not yet implemented |',
      '',
    ].join('\n');
    const entries = shard.parseIndex(content);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].id, 'F-001');
    assert.equal(entries[2].id, 'F-Hub-Spotlight');
  });

  it('ignores lines outside the Features section', () => {
    const content = [
      '# Feature Map',
      '',
      '- F-001 | shipped | Outside section', // before Features header — ignored
      '',
      '## Features',
      '',
      '- F-002 | planned | Inside',
      '',
      '## Legend',
      '',
      '- F-003 | shipped | Outside (in Legend)',
      '',
    ].join('\n');
    const entries = shard.parseIndex(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'F-002');
  });

  it('returns empty array on no Features section', () => {
    const content = '# Feature Map\n\nSome prose\n';
    assert.deepEqual(shard.parseIndex(content), []);
  });

  it('skips malformed lines silently', () => {
    const content = [
      '## Features',
      '',
      '- F-001 | shipped | OK',
      'not a line',
      '- BAD-ID | shipped | invalid id',
      '- F-002 | tested | also OK',
      '',
    ].join('\n');
    const entries = shard.parseIndex(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, 'F-001');
    assert.equal(entries[1].id, 'F-002');
  });
});

describe('F-089 cap-feature-map-shard — serializeIndex', () => {
  it('emits header + entries + Legend + footer', () => {
    const fixedDate = new Date('2026-05-08T10:00:00.000Z');
    const out = shard.serializeIndex(
      [
        { id: 'F-001', state: 'shipped', title: 'Tag Scanner' },
        { id: 'F-Hub-Auth', state: 'planned', title: 'Hub Feature' },
      ],
      { now: () => fixedDate }
    );
    assert.match(out, /^# Feature Map\n/);
    assert.match(out, /\n## Features\n/);
    assert.match(out, /- F-001 \| shipped \| Tag Scanner/);
    assert.match(out, /- F-Hub-Auth \| planned \| Hub Feature/);
    assert.match(out, /\n## Legend\n/);
    assert.match(out, /\n\*Last updated: 2026-05-08T10:00:00\.000Z\*\n/);
  });

  it('emits placeholder comment on empty entry list', () => {
    const out = shard.serializeIndex([]);
    assert.match(out, /<!-- No features yet/);
  });

  it('round-trips: serializeIndex then parseIndex returns the same entries', () => {
    const entries = [
      { id: 'F-001', state: 'shipped', title: 'Tag Scanner' },
      { id: 'F-088', state: 'shipped', title: 'Lossless Round-Trip' },
      { id: 'F-Hub-Spotlight', state: 'planned', title: 'Spotlight on Homepage' },
    ];
    const out = shard.serializeIndex(entries);
    const parsed = shard.parseIndex(out);
    assert.deepEqual(parsed, entries);
  });
});

describe('F-089 cap-feature-map-shard — _updateIndexEntry (surgical patch)', () => {
  const baseContent = [
    '# Feature Map',
    '',
    '## Features',
    '',
    '- F-001 | planned | Tag Scanner',
    '- F-002 | shipped | Feature Map',
    '- F-Hub-Spotlight | planned | Spotlight',
    '',
    '## Legend',
  ].join('\n');

  it('updates state of an existing entry without touching siblings', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-001', { state: 'shipped' });
    assert.equal(result.hit, true);
    assert.match(result.content, /- F-001 \| shipped \| Tag Scanner/);
    assert.match(result.content, /- F-002 \| shipped \| Feature Map/); // unchanged
  });

  it('updates title without touching state', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-002', { title: 'Feature Map (renamed)' });
    assert.equal(result.hit, true);
    assert.match(result.content, /- F-002 \| shipped \| Feature Map \(renamed\)/);
  });

  it('updates both state and title in one call', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-Hub-Spotlight', { state: 'shipped', title: 'New' });
    assert.equal(result.hit, true);
    assert.match(result.content, /- F-Hub-Spotlight \| shipped \| New/);
  });

  it('returns hit:false when ID is not present', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-999', { state: 'shipped' });
    assert.equal(result.hit, false);
    assert.equal(result.content, baseContent);
  });

  it('returns hit:false on invalid ID', () => {
    const result = shard._updateIndexEntry(baseContent, 'BAD', { state: 'shipped' });
    assert.equal(result.hit, false);
    assert.equal(result.content, baseContent);
  });

  it('rejects pipe in new title (would corrupt format)', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-001', { title: 'a | b' });
    assert.equal(result.hit, false);
    assert.equal(result.content, baseContent);
  });

  it('rejects whitespace in new state', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-001', { state: 'in progress' });
    assert.equal(result.hit, false);
  });

  it('preserves byte-for-byte content outside the matched line', () => {
    const result = shard._updateIndexEntry(baseContent, 'F-002', { state: 'tested' });
    const beforeAfter = baseContent.replace('- F-002 | shipped |', '- F-002 | tested |');
    assert.equal(result.content, beforeAfter);
  });
});

describe('F-089 cap-feature-map-shard — _appendIndexEntry', () => {
  const baseContent = [
    '# Feature Map',
    '',
    '## Features',
    '',
    '- F-001 | planned | Tag Scanner',
    '',
    '## Legend',
    '',
    '| State | Meaning |',
  ].join('\n');

  it('appends a new entry at the end of the Features section', () => {
    const result = shard._appendIndexEntry(baseContent, {
      id: 'F-002',
      state: 'planned',
      title: 'New Feature',
    });
    assert.equal(result.hit, true);
    const featuresIdx = result.content.indexOf('## Features');
    const legendIdx = result.content.indexOf('## Legend');
    const featuresSection = result.content.slice(featuresIdx, legendIdx);
    assert.match(featuresSection, /- F-001 \| planned \| Tag Scanner/);
    assert.match(featuresSection, /- F-002 \| planned \| New Feature/);
    // F-002 should appear AFTER F-001
    assert.ok(
      featuresSection.indexOf('F-001') < featuresSection.indexOf('F-002'),
      'new entry must appear after existing'
    );
  });

  it('throws on invalid entry (validation cascades from serializeIndexEntry)', () => {
    assert.throws(
      () => shard._appendIndexEntry(baseContent, { id: 'BAD', state: 'planned', title: 'x' }),
      /invalid feature ID/
    );
  });

  it('returns hit:false when ## Features section is missing', () => {
    const result = shard._appendIndexEntry('# Feature Map\n\nNo features section.', {
      id: 'F-001',
      state: 'planned',
      title: 'x',
    });
    assert.equal(result.hit, false);
  });

  it('does not accumulate blank lines on repeated appends', () => {
    let content = baseContent;
    for (let i = 2; i <= 5; i++) {
      const r = shard._appendIndexEntry(content, {
        id: 'F-' + String(i).padStart(3, '0'),
        state: 'planned',
        title: 'Feature ' + i,
      });
      assert.equal(r.hit, true);
      content = r.content;
    }
    // Count consecutive blank lines anywhere — should never exceed 1 within Features section.
    const featuresIdx = content.indexOf('## Features');
    const legendIdx = content.indexOf('## Legend');
    const section = content.slice(featuresIdx, legendIdx);
    assert.ok(!/\n\n\n/.test(section), 'no triple-newline blocks in Features section');
  });
});
