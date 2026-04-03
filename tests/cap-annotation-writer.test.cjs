'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  getCommentPrefix,
  parseExistingAnnotations,
  findInsertionPoint,
  planFileChanges,
  applyChanges,
  writeAnnotations,
  removeStaleAnnotations,
} = require('../cap/bin/lib/cap-annotation-writer.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-writer-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name, content) {
  const fp = path.join(tmpDir, name);
  fs.writeFileSync(fp, content);
  return fp;
}

// --- getCommentPrefix ---

describe('getCommentPrefix', () => {
  it('returns // for JavaScript', () => {
    assert.strictEqual(getCommentPrefix('file.js'), '//');
  });

  it('returns // for TypeScript', () => {
    assert.strictEqual(getCommentPrefix('file.ts'), '//');
  });

  it('returns // for CJS', () => {
    assert.strictEqual(getCommentPrefix('file.cjs'), '//');
  });

  it('returns # for Python', () => {
    assert.strictEqual(getCommentPrefix('file.py'), '#');
  });

  it('returns # for Shell', () => {
    assert.strictEqual(getCommentPrefix('file.sh'), '#');
  });

  it('returns # for YAML', () => {
    assert.strictEqual(getCommentPrefix('file.yml'), '#');
  });

  it('returns -- for SQL', () => {
    assert.strictEqual(getCommentPrefix('file.sql'), '--');
  });

  it('returns -- for Lua', () => {
    assert.strictEqual(getCommentPrefix('file.lua'), '--');
  });

  it('returns // for unknown extensions', () => {
    assert.strictEqual(getCommentPrefix('file.xyz'), '//');
  });

  it('handles Dockerfile', () => {
    assert.strictEqual(getCommentPrefix('Dockerfile'), '#');
  });
});

// --- parseExistingAnnotations ---

describe('parseExistingAnnotations', () => {
  it('parses memory annotations from JS file', () => {
    const lines = [
      '// @cap-feature(feature:F-001) Some feature',
      '// @cap-history(sessions:3, edits:8) Hotspot',
      '// @cap-pitfall(pinned:true) Watch out',
      '',
      'const x = 1;',
    ];
    const result = parseExistingAnnotations(lines);
    assert.strictEqual(result.length, 2); // cap-feature is not a memory tag
    assert.strictEqual(result[0].tag, 'cap-history');
    assert.strictEqual(result[1].tag, 'cap-pitfall');
  });

  it('parses annotations with # prefix', () => {
    const lines = [
      '# @cap-pattern(confirmed:2) Good approach',
    ];
    const result = parseExistingAnnotations(lines);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tag, 'cap-pattern');
    assert.strictEqual(result[0].prefix, '# ');
  });

  it('returns empty for no annotations', () => {
    const lines = ['const x = 1;', 'const y = 2;'];
    assert.strictEqual(parseExistingAnnotations(lines).length, 0);
  });
});

// --- findInsertionPoint ---

describe('findInsertionPoint', () => {
  it('skips shebang', () => {
    const lines = ['#!/usr/bin/env node', 'const x = 1;'];
    assert.strictEqual(findInsertionPoint(lines), 1);
  });

  it('skips use strict', () => {
    const lines = ["'use strict';", '', 'const x = 1;'];
    assert.strictEqual(findInsertionPoint(lines), 2);
  });

  it('skips existing @cap annotations', () => {
    const lines = [
      "'use strict';",
      '',
      '// @cap-feature(feature:F-001) Feature',
      '// @cap-decision Some decision',
      '',
      'const x = 1;',
    ];
    assert.strictEqual(findInsertionPoint(lines), 5);
  });

  it('returns 0 for plain file', () => {
    const lines = ['const x = 1;', 'const y = 2;'];
    assert.strictEqual(findInsertionPoint(lines), 0);
  });

  it('handles shebang + use strict + annotations', () => {
    const lines = [
      '#!/usr/bin/env node',
      "'use strict';",
      '',
      '// @cap-feature(feature:F-025) Extract',
      '// @cap-history(sessions:2) Hotspot',
      '',
      'const fs = require("fs");',
    ];
    assert.strictEqual(findInsertionPoint(lines), 6);
  });
});

// --- planFileChanges ---

describe('planFileChanges', () => {
  it('plans addition of new annotation', () => {
    const content = "'use strict';\n\nconst x = 1;\n";
    const entries = [{
      category: 'hotspot',
      file: '/test.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
    }];
    const changes = planFileChanges('/test.js', content, entries);
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].action, 'add');
    assert.ok(changes[0].annotation.includes('@cap-history'));
  });

  it('plans update of existing annotation', () => {
    const content = "// @cap-history(sessions:2, edits:4, since:2026-03-15, learned:2026-03-20) Frequently modified\nconst x = 1;\n";
    const entries = [{
      category: 'hotspot',
      file: '/test.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
    }];
    const changes = planFileChanges('/test.js', content, entries);
    const updates = changes.filter(c => c.action === 'update');
    assert.strictEqual(updates.length, 1);
    assert.ok(updates[0].annotation.includes('sessions:3'));
  });

  it('plans removal of stale annotation', () => {
    const content = "// @cap-history(sessions:1) Old hotspot\nconst x = 1;\n";
    const changes = planFileChanges('/test.js', content, [], ['@cap-history(sessions:1) Old hotspot']);
    const removals = changes.filter(c => c.action === 'remove');
    assert.strictEqual(removals.length, 1);
  });

  it('does not duplicate if annotation unchanged', () => {
    const entry = {
      category: 'hotspot',
      file: '/test.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
    };
    const { formatAnnotation } = require('../cap/bin/lib/cap-memory-engine.cjs');
    const formatted = `// ${formatAnnotation(entry)}`;
    const content = `${formatted}\nconst x = 1;\n`;
    const changes = planFileChanges('/test.js', content, [entry]);
    assert.strictEqual(changes.filter(c => c.action === 'add').length, 0);
  });
});

// --- applyChanges ---

describe('applyChanges', () => {
  it('adds annotations at insertion point', () => {
    const content = "'use strict';\n\nconst x = 1;";
    const changes = [{ action: 'add', file: 'f.js', annotation: '// @cap-history(sessions:2) Hotspot' }];
    const result = applyChanges(content, changes);
    assert.ok(result.includes('@cap-history'));
    // Should be after 'use strict' and empty line
    const lines = result.split('\n');
    assert.ok(lines.indexOf("// @cap-history(sessions:2) Hotspot") <= 2);
  });

  it('removes annotations by line index', () => {
    const content = "// @cap-history(sessions:1) Old\nconst x = 1;";
    const changes = [{ action: 'remove', file: 'f.js', annotation: '', lineIndex: 0 }];
    const result = applyChanges(content, changes);
    assert.ok(!result.includes('@cap-history'));
    assert.ok(result.includes('const x = 1;'));
  });

  it('updates annotations in-place', () => {
    const content = "// @cap-history(sessions:1) Old\nconst x = 1;";
    const changes = [{ action: 'update', file: 'f.js', annotation: '// @cap-history(sessions:3) Updated', lineIndex: 0 }];
    const result = applyChanges(content, changes);
    assert.ok(result.includes('sessions:3'));
    assert.ok(!result.includes('sessions:1'));
  });
});

// --- writeAnnotations (integration) ---

describe('writeAnnotations', () => {
  it('writes annotations to a real file', () => {
    const fp = writeFile('test.js', "'use strict';\n\nconst x = 1;\n");
    const entries = {
      [fp]: [{
        category: 'hotspot',
        file: fp,
        content: 'Frequently modified',
        metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
      }],
    };
    const result = writeAnnotations(entries);
    assert.strictEqual(result.filesModified, 1);
    const updated = fs.readFileSync(fp, 'utf8');
    assert.ok(updated.includes('@cap-history'));
  });

  it('dry-run does not modify file', () => {
    const fp = writeFile('test.js', "const x = 1;\n");
    const original = fs.readFileSync(fp, 'utf8');
    const entries = {
      [fp]: [{
        category: 'decision',
        file: fp,
        content: 'Use token refresh',
        metadata: { pinned: false, source: '2026-04-01T10:00:00Z' },
      }],
    };
    const result = writeAnnotations(entries, { dryRun: true });
    assert.strictEqual(result.filesModified, 1);
    assert.strictEqual(result.changes.length, 1);
    const after = fs.readFileSync(fp, 'utf8');
    assert.strictEqual(after, original); // unchanged
  });

  it('skips nonexistent files', () => {
    const entries = {
      '/nonexistent/file.js': [{
        category: 'hotspot',
        file: '/nonexistent/file.js',
        content: 'test',
        metadata: { sessions: 2, edits: 3, since: '2026-01-01', pinned: false, source: '2026-04-01T10:00:00Z' },
      }],
    };
    const result = writeAnnotations(entries);
    assert.strictEqual(result.filesModified, 0);
  });

  it('writes correct comment prefix for Python', () => {
    const fp = writeFile('test.py', "import os\n\nx = 1\n");
    const entries = {
      [fp]: [{
        category: 'pitfall',
        file: fp,
        content: 'Watch out for imports',
        metadata: { pinned: true, source: '2026-04-01T10:00:00Z' },
      }],
    };
    writeAnnotations(entries);
    const updated = fs.readFileSync(fp, 'utf8');
    assert.ok(updated.includes('# @cap-pitfall'));
    assert.ok(!updated.includes('// @cap-pitfall'));
  });

  it('writes correct comment prefix for SQL', () => {
    const fp = writeFile('test.sql', "SELECT * FROM users;\n");
    const entries = {
      [fp]: [{
        category: 'decision',
        file: fp,
        content: 'Use index on email',
        metadata: { pinned: false, source: '2026-04-01T10:00:00Z' },
      }],
    };
    writeAnnotations(entries);
    const updated = fs.readFileSync(fp, 'utf8');
    assert.ok(updated.includes('-- @cap-decision'));
  });
});

// --- removeStaleAnnotations ---

describe('removeStaleAnnotations', () => {
  it('removes stale annotations from file', () => {
    const fp = writeFile('test.js', "// @cap-history(sessions:1) Old hotspot\nconst x = 1;\n");
    const stale = [{ file: fp, content: '@cap-history(sessions:1) Old hotspot' }];
    const result = removeStaleAnnotations(stale);
    assert.strictEqual(result.removed, 1);
    const updated = fs.readFileSync(fp, 'utf8');
    assert.ok(!updated.includes('@cap-history'));
    assert.ok(updated.includes('const x = 1;'));
  });

  it('dry-run does not modify file', () => {
    const fp = writeFile('test.js', "// @cap-history(sessions:1) Old\nconst x = 1;\n");
    const original = fs.readFileSync(fp, 'utf8');
    removeStaleAnnotations([{ file: fp, content: '@cap-history(sessions:1) Old' }], { dryRun: true });
    assert.strictEqual(fs.readFileSync(fp, 'utf8'), original);
  });

  it('handles nonexistent files', () => {
    const result = removeStaleAnnotations([{ file: '/nope.js', content: 'x' }]);
    assert.strictEqual(result.removed, 0);
  });
});
