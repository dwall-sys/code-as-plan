// @cap-feature(feature:F-068) CAP-UI Visual Design Editor — RED-GREEN tests for AC-1..AC-6 + security.
// @cap-decision Tests use node:http, node:test, node:assert only (zero external deps).
// @cap-decision All HTTP tests use port 0 (ephemeral) to avoid collisions with real cap:ui instances.
// @cap-constraint Zero external test dependencies (node:test + node:assert + node:http only).

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const editor = require('../cap/bin/lib/cap-ui-design-editor.cjs');
const designLib = require('../cap/bin/lib/cap-design.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');

// --- Helpers ---------------------------------------------------------------

function makeProjectWithDesign() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ui-edit-'));
  // Minimal FEATURE-MAP so collectProjectSnapshot is happy.
  featureMapLib.writeFeatureMap(dir, { features: [], lastScan: null });
  // Build a deterministic DESIGN.md with IDs.
  const fam = designLib.mapAnswersToFamily('read-heavy', 'developer', 'balanced');
  const md = designLib.buildDesignMd({ family: fam, withIds: true });
  designLib.writeDesignMd(dir, md);
  return dir;
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function httpRequest(method, url, body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const headers = { 'Content-Type': 'application/json' };
    let data = null;
    if (body !== undefined) {
      data = (typeof body === 'string') ? body : JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('timeout')); });
    if (data !== null) req.write(data);
    req.end();
  });
}

function parseBody(res) { try { return JSON.parse(res.body || '{}'); } catch { return { _raw: res.body }; } }

// ---------------------------------------------------------------------------
//  AC-1: --editable flag parses; editor section shown only when flag set
// ---------------------------------------------------------------------------

describe('F-068 AC-1: --editable flag gates the editor UI', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('startServer accepts editable parameter without throwing', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      assert.strictEqual(typeof srv.stop, 'function');
    } finally {
      await srv.stop();
    }
  });

  it('GET / includes Design Editor section when editable=true', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('GET', srv.url + '/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('id="design-editor"'), 'editor section id must be present');
      assert.ok(res.body.includes('data-cap-editor="1"'), 'editor section marker must be present');
    } finally { await srv.stop(); }
  });

  it('GET / does NOT include Design Editor section when editable=false (default)', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    try {
      const res = await httpRequest('GET', srv.url + '/');
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.includes('id="design-editor"'), 'editor section must NOT appear in read-only mode');
      assert.ok(!res.body.includes('data-cap-editor="1"'), 'editor marker must NOT appear in read-only mode');
    } finally { await srv.stop(); }
  });

  it('buildEditorSection returns empty string when editable=false', () => {
    const out = editor.buildEditorSection({ designMd: '# DESIGN.md\n', editable: false });
    assert.strictEqual(out, '');
  });

  it('buildEditorSection returns non-empty HTML when editable=true + DESIGN.md present', () => {
    const tmpDir = tmp;
    const md = fs.readFileSync(path.join(tmpDir, 'DESIGN.md'), 'utf8');
    const out = editor.buildEditorSection({ designMd: md, editable: true });
    assert.ok(out.includes('id="design-editor"'));
    assert.ok(out.includes('type="color"'), 'color pickers present');
  });
});

// ---------------------------------------------------------------------------
//  AC-2: Color-picker PUT writes back to DESIGN.md
// ---------------------------------------------------------------------------

describe('F-068 AC-2: color PUT updates DESIGN.md', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('applyColorEdit changes exactly one line and preserves structure', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const ids = designLib.parseDesignIds(md);
    assert.ok(ids.tokens.length > 0, 'fixture must have DT-NNN tokens');
    const id = ids.tokens[0];
    const next = editor.applyColorEdit(md, { id, value: '#ff6600' });
    // Exactly one line differs
    const before = md.split('\n');
    const after = next.split('\n');
    assert.strictEqual(before.length, after.length, 'line count must be preserved');
    const diffs = before.map((l, i) => l !== after[i] ? i : -1).filter(i => i !== -1);
    assert.strictEqual(diffs.length, 1, `exactly one line should change, got ${diffs.length}`);
    assert.ok(after[diffs[0]].includes('#ff6600'), 'new value must be embedded');
    assert.ok(after[diffs[0]].includes(`(id: ${id})`), 'id suffix must be preserved');
  });

  it('PUT /api/design/color/:id writes to disk via atomic rename', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const before = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      const ids = designLib.parseDesignIds(before);
      const id = ids.tokens[0];
      const res = await httpRequest('PUT', srv.url + '/api/design/color/' + id, { value: '#ff6600' });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(parseBody(res), { ok: true });

      const after = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.notStrictEqual(before, after, 'DESIGN.md must change');
      assert.ok(after.includes('#ff6600'), 'new color must land on disk');
    } finally { await srv.stop(); }
  });

  it('PUT with invalid color value returns 400', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const ids = designLib.parseDesignIds(fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8'));
      const id = ids.tokens[0];
      const res = await httpRequest('PUT', srv.url + '/api/design/color/' + id, { value: 'not-a-color' });
      assert.strictEqual(res.status, 400);
      assert.ok(parseBody(res).error, 'error body expected');
    } finally { await srv.stop(); }
  });

  it('PUT with unknown DT-NNN returns 400 (not found)', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-999', { value: '#abcabc' });
      assert.strictEqual(res.status, 400);
    } finally { await srv.stop(); }
  });
});

// ---------------------------------------------------------------------------
//  AC-3: Spacing / typography scale slider PUT
// ---------------------------------------------------------------------------

describe('F-068 AC-3: spacing + typography scales via PUT', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('applySpacingEdit rewrites only the spacing scale line', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const next = editor.applySpacingEdit(md, { id: 'spacing.scale', value: [2, 4, 8, 16] });
    const before = md.split('\n');
    const after = next.split('\n');
    assert.strictEqual(before.length, after.length);
    const diffs = before.map((l, i) => l !== after[i] ? i : -1).filter(i => i !== -1);
    assert.strictEqual(diffs.length, 1, 'exactly one line changes');
    assert.ok(after[diffs[0]].includes('[2, 4, 8, 16]'));
  });

  it('applySpacingEdit on typography.scale works', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const next = editor.applySpacingEdit(md, { id: 'typography.scale', value: [12, 14, 16, 20, 28] });
    assert.ok(next.includes('[12, 14, 16, 20, 28]'), 'typography scale rewritten');
  });

  it('PUT /api/design/spacing/spacing.scale accepts array', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('PUT', srv.url + '/api/design/spacing/spacing.scale', { value: [2, 4, 8, 16, 32] });
      assert.strictEqual(res.status, 200);
      const after = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.ok(after.includes('[2, 4, 8, 16, 32]'));
    } finally { await srv.stop(); }
  });
});

// ---------------------------------------------------------------------------
//  AC-4: Component variant add/remove
// ---------------------------------------------------------------------------

describe('F-068 AC-4: component variants via PUT + DELETE', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('applyComponentEdit add is a no-op when variant already present', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const ids = designLib.parseDesignIds(md);
    assert.ok(ids.components.length > 0);
    const id = ids.components[0];
    const variants = editor._extractVariants(md, id);
    assert.ok(variants.length > 0, 'component has at least one variant');
    const again = editor.applyComponentEdit(md, { id, action: 'add', variant: variants[0] });
    assert.strictEqual(again, md, 'no-op add returns identical content (zero diff)');
  });

  it('applyComponentEdit add appends a new variant', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const id = designLib.parseDesignIds(md).components[0];
    const next = editor.applyComponentEdit(md, { id, action: 'add', variant: 'outlined' });
    assert.ok(next.includes('outlined'), 'new variant embedded');
    const afterVariants = editor._extractVariants(next, id);
    assert.ok(afterVariants.includes('outlined'));
  });

  it('applyComponentEdit remove drops the variant', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const id = designLib.parseDesignIds(md).components[0];
    const added = editor.applyComponentEdit(md, { id, action: 'add', variant: 'outlined' });
    const removed = editor.applyComponentEdit(added, { id, action: 'remove', variant: 'outlined' });
    assert.strictEqual(removed, md, 'add+remove returns to original');
  });

  it('PUT /api/design/component/:id add + DELETE /variant/:name round-trip', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const before = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      const id = designLib.parseDesignIds(before).components[0];

      const addRes = await httpRequest('PUT', srv.url + '/api/design/component/' + id, { action: 'add', variant: 'outlined' });
      assert.strictEqual(addRes.status, 200);
      const added = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.ok(added.includes('outlined'));

      const delRes = await httpRequest('DELETE', srv.url + '/api/design/component/' + id + '/variant/outlined');
      assert.strictEqual(delRes.status, 200);
      const removed = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.strictEqual(removed, before, 'round-trip returns to byte-identical content');
    } finally { await srv.stop(); }
  });

  it('rejects variant with disallowed characters', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const id = designLib.parseDesignIds(fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8')).components[0];
      const res = await httpRequest('PUT', srv.url + '/api/design/component/' + id, { action: 'add', variant: 'bad name!' });
      assert.strictEqual(res.status, 400);
    } finally { await srv.stop(); }
  });
});

// ---------------------------------------------------------------------------
//  AC-5: Atomic writes + Git-friendly diffs
// ---------------------------------------------------------------------------

describe('F-068 AC-5: atomic writes + single-line diffs', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('atomicWriteDesign replaces DESIGN.md without leaving temp files behind', () => {
    editor.atomicWriteDesign(tmp, '# new DESIGN.md\n');
    const content = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    assert.strictEqual(content, '# new DESIGN.md\n');
    const entries = fs.readdirSync(tmp);
    const orphanTmp = entries.filter(e => e.includes('.tmp'));
    assert.deepStrictEqual(orphanTmp, [], 'no .tmp leftovers');
  });

  it('atomicWriteDesign rejects paths outside projectRoot', () => {
    // checkContainment is exercised by atomicWriteDesign indirectly via DESIGN.md — here we test it directly.
    assert.throws(() => editor.checkContainment(tmp, '../../etc/passwd'), /path traversal/i);
    assert.throws(() => editor.checkContainment(tmp, '/etc/passwd'), /path traversal/i);
  });

  it('single-line color edit produces a single-line diff', () => {
    const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
    const id = designLib.parseDesignIds(md).tokens[0];
    const next = editor.applyColorEdit(md, { id, value: '#123456' });
    const before = md.split('\n');
    const after = next.split('\n');
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    assert.strictEqual(changed, 1, 'Git-friendly: exactly one line changes');
  });
});

// ---------------------------------------------------------------------------
//  AC-6: FEATURE-MAP + Memory are ALWAYS read-only
// ---------------------------------------------------------------------------

describe('F-068 AC-6: FEATURE-MAP + Memory stay read-only even with --editable', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('PUT /api/feature-map/F-001 returns 405 in edit mode', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('PUT', srv.url + '/api/feature-map/F-001', { title: 'hacked' });
      assert.strictEqual(res.status, 405);
      assert.ok(String(res.headers['allow'] || '').includes('GET'));
    } finally { await srv.stop(); }
  });

  it('PUT /api/memory/anything returns 405 in edit mode', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('PUT', srv.url + '/api/memory/decisions', { content: 'x' });
      assert.strictEqual(res.status, 405);
    } finally { await srv.stop(); }
  });

  it('DELETE /api/feature-map returns 405 in edit mode', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('DELETE', srv.url + '/api/feature-map');
      assert.strictEqual(res.status, 405);
    } finally { await srv.stop(); }
  });

  it('POST /api/memory returns 405 in edit mode', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      const res = await httpRequest('POST', srv.url + '/api/memory', {});
      assert.strictEqual(res.status, 405);
    } finally { await srv.stop(); }
  });
});

// ---------------------------------------------------------------------------
//  Security — path traversal
// ---------------------------------------------------------------------------

describe('F-068 security: path traversal + editable-flag gating', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('URL with .. segment is rejected (404 via matchRoute refusal)', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
    try {
      // matchRoute refuses '..' segments, so the path does not match any route -> 404.
      const res = await httpRequest('PUT', srv.url + '/api/design/../../../etc/passwd', { value: '#000000' });
      assert.ok([404, 405].includes(res.status), `expected 404 or 405, got ${res.status}`);
      // DESIGN.md must be unchanged.
      const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.ok(md.startsWith('# DESIGN.md'));
    } finally { await srv.stop(); }
  });

  it('checkContainment blocks ../ escape even with allowed prefix collision', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ct-'));
    try {
      // /tmp/foobar should NOT be seen as inside /tmp/foo
      const sibling = root + 'x';
      fs.mkdirSync(sibling, { recursive: true });
      assert.throws(() => editor.checkContainment(root, path.relative(root, path.join(sibling, 'a'))), /path traversal/i);
      fs.rmSync(sibling, { recursive: true, force: true });
    } finally { rmTmp(root); }
  });

  it('PUT without --editable returns 404 (route not registered)', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false /* editable defaults to false */ });
    try {
      const id = designLib.parseDesignIds(fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8')).tokens[0];
      const res = await httpRequest('PUT', srv.url + '/api/design/color/' + id, { value: '#000000' });
      // Route not registered -> 404. (405 would also be acceptable; either proves the write was rejected.)
      assert.ok([404, 405].includes(res.status), `expected 404/405 without --editable, got ${res.status}`);
      // DESIGN.md unchanged.
      const md = fs.readFileSync(path.join(tmp, 'DESIGN.md'), 'utf8');
      assert.ok(!md.includes('#000000 (id:'), 'DESIGN.md must not change without --editable');
    } finally { await srv.stop(); }
  });

  it('F-065 invariant preserved: POST / returns 405 in default mode', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    try {
      const res = await httpRequest('POST', srv.url + '/', {});
      assert.strictEqual(res.status, 405);
    } finally { await srv.stop(); }
  });

  it('createSnapshot refuses outputPath outside projectRoot', () => {
    assert.throws(
      () => ui.createSnapshot({ projectRoot: tmp, outputPath: '../../evil.html' }),
      /path traversal/i
    );
  });
});

// ---------------------------------------------------------------------------
//  F-067 review hand-off tests (client JS syntax + </script invariant)
// ---------------------------------------------------------------------------

describe('F-068 test-surface: client JS syntax check + </script defence', () => {
  it('buildClientJs({live:true}) is syntactically valid JavaScript', () => {
    const js = ui.buildClientJs({ live: true });
    // Pass through Function constructor — if it throws, the bundled client JS is broken.
    // eslint-disable-next-line no-new-func
    assert.doesNotThrow(() => new Function(js));
  });

  it('buildClientJs({live:true, editable:true}) is syntactically valid JavaScript', () => {
    const js = ui.buildClientJs({ live: true, editable: true });
    // eslint-disable-next-line no-new-func
    assert.doesNotThrow(() => new Function(js));
  });

  it('buildClientJs does not contain a literal </script sequence (XSS defence)', () => {
    const jsLive = ui.buildClientJs({ live: true });
    const jsStatic = ui.buildClientJs({ live: false });
    const jsEdit = ui.buildClientJs({ live: true, editable: true });
    assert.ok(!/<\/script/i.test(jsLive), 'live JS contains </script');
    assert.ok(!/<\/script/i.test(jsStatic), 'static JS contains </script');
    assert.ok(!/<\/script/i.test(jsEdit), 'editor JS contains </script');
  });
});
