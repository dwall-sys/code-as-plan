// @cap-feature(feature:F-068) CAP-UI Visual Design Editor — adversarial hardening tests.
// @cap-context Probes path-traversal, editable gating, atomic-write crash safety, body-parser DoS,
//              value validation, Git-friendly diff invariants, module-split back-compat, and snapshot read-only posture.
// @cap-decision Zero external deps. node:test + node:assert + node:http only, mirror of the baseline file.
// @cap-decision Baseline file (cap-ui-design-editor.test.cjs) covers happy-path AC-1..AC-6.
//               THIS file ships ONLY adversarial / negative / invariant probes that the baseline does not cover.
// @cap-pattern Tear-down every server + tmp dir in afterEach — leaks cascade across node --test.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const editor = require('../cap/bin/lib/cap-ui-design-editor.cjs');
const mindMapLib = require('../cap/bin/lib/cap-ui-mind-map.cjs');
const threadNavLib = require('../cap/bin/lib/cap-ui-thread-nav.cjs');
const designLib = require('../cap/bin/lib/cap-design.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');
const doctorLib = require('../cap/bin/lib/cap-doctor.cjs');

// --- Helpers ---------------------------------------------------------------

function makeProjectWithDesign() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ui-edit-adv-'));
  featureMapLib.writeFeatureMap(dir, { features: [], lastScan: null });
  const fam = designLib.mapAnswersToFamily('read-heavy', 'developer', 'balanced');
  designLib.writeDesignMd(dir, designLib.buildDesignMd({ family: fam, withIds: true }));
  return dir;
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function httpRequest(method, url, body, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    let data = null;
    if (body !== undefined) {
      data = (typeof body === 'string') ? body : JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''), method, headers }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: buf }); });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('timeout')); });
    if (data !== null) req.write(data);
    req.end();
  });
}

function parseBody(res) { try { return JSON.parse(res.body || '{}'); } catch { return { _raw: res.body }; } }

function readDesign(dir) { return fs.readFileSync(path.join(dir, 'DESIGN.md'), 'utf8'); }

// ---------------------------------------------------------------------------
//  checkContainment — exhaustive adversarial probe
// ---------------------------------------------------------------------------

describe('F-068 adv: checkContainment rejects every traversal vector', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ct-adv-')); });
  afterEach(() => rmTmp(tmp));

  it('rejects ../ relative escape', () => {
    assert.throws(() => editor.checkContainment(tmp, '../x'), /path traversal/i);
  });

  it('rejects deeply-nested ../ chain', () => {
    assert.throws(() => editor.checkContainment(tmp, 'a/b/c/../../../../x'), /path traversal/i);
  });

  it('rejects absolute path outside root', () => {
    assert.throws(() => editor.checkContainment(tmp, '/etc/passwd'), /path traversal/i);
  });

  it('rejects sibling-prefix attack (root + "sibling" must NOT be inside root)', () => {
    assert.throws(() => editor.checkContainment(tmp, tmp + 'sibling/DESIGN.md'), /path traversal/i);
  });

  it('rejects ./foo/../../etc escape', () => {
    assert.throws(() => editor.checkContainment(tmp, './foo/../../etc'), /path traversal/i);
  });

  it('accepts the project root itself (.)', () => {
    assert.doesNotThrow(() => editor.checkContainment(tmp, '.'));
    const resolved = editor.checkContainment(tmp, '.');
    assert.strictEqual(resolved, path.resolve(tmp));
  });

  it('accepts nested paths inside root (.cap/ui/snapshot.html)', () => {
    const abs = editor.checkContainment(tmp, '.cap/ui/snapshot.html');
    assert.ok(abs.startsWith(path.resolve(tmp) + path.sep));
  });

  it('normalises harmless internal ./foo/../bar', () => {
    const abs = editor.checkContainment(tmp, './foo/../bar');
    assert.strictEqual(abs, path.resolve(tmp, 'bar'));
  });

  it('refuses empty / null / non-string inputs (fail-loud contract)', () => {
    assert.throws(() => editor.checkContainment('', 'x'), /non-empty string/);
    assert.throws(() => editor.checkContainment(tmp, ''), /non-empty string/);
    assert.throws(() => editor.checkContainment(null, 'x'), /non-empty string/);
    assert.throws(() => editor.checkContainment(tmp, null), /non-empty string/);
    assert.throws(() => editor.checkContainment(undefined, 'x'), /non-empty string/);
    assert.throws(() => editor.checkContainment(tmp, 123), /non-empty string/);
  });

  it('tolerates trailing separator on projectRoot', () => {
    assert.doesNotThrow(() => editor.checkContainment(tmp + path.sep, 'DESIGN.md'));
  });
});

// ---------------------------------------------------------------------------
//  atomicWriteDesign crash + concurrency + permission probes
// ---------------------------------------------------------------------------

describe('F-068 adv: atomicWriteDesign crash safety', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => {
    try { fs.chmodSync(tmp, 0o755); } catch { /* ignore */ }
    rmTmp(tmp);
  });

  it('rename failure leaves original DESIGN.md unchanged AND cleans up .tmp', () => {
    const origContent = readDesign(tmp);
    const origRename = fs.renameSync;
    fs.renameSync = function () { throw Object.assign(new Error('ENOSPC: simulated'), { code: 'ENOSPC' }); };
    try {
      assert.throws(() => editor.atomicWriteDesign(tmp, '# hijacked\n'), /ENOSPC/);
    } finally {
      fs.renameSync = origRename;
    }
    assert.strictEqual(readDesign(tmp), origContent, 'DESIGN.md must stay byte-identical');
    const tmpLeftovers = fs.readdirSync(tmp).filter(e => e.includes('.tmp'));
    assert.deepStrictEqual(tmpLeftovers, [], 'temp file must be cleaned up after rename failure');
  });

  it('rejects non-string content with clear error (type contract)', () => {
    assert.throws(() => editor.atomicWriteDesign(tmp, 42), /content must be a string/);
    assert.throws(() => editor.atomicWriteDesign(tmp, null), /content must be a string/);
    assert.throws(() => editor.atomicWriteDesign(tmp, Buffer.from('x')), /content must be a string/);
  });

  it('100 sequential atomic writes do not corrupt DESIGN.md or leak .tmp files', () => {
    let content = readDesign(tmp);
    for (let i = 0; i < 100; i++) {
      const hex = '#' + i.toString(16).padStart(6, '0');
      content = editor.applyColorEdit(content, { id: 'DT-001', value: hex });
      editor.atomicWriteDesign(tmp, content);
    }
    const final = readDesign(tmp);
    // Last write wins — #000063 (99 hex padded).
    assert.ok(final.includes('#000063'), 'last value must be present');
    // IDs still parseable.
    const ids = designLib.parseDesignIds(final);
    assert.ok(ids.tokens.includes('DT-001'));
    assert.ok(ids.components.includes('DC-001'));
    // No tmp leakage.
    const leftovers = fs.readdirSync(tmp).filter(e => e.includes('.tmp'));
    assert.deepStrictEqual(leftovers, [], 'no .tmp files may leak across rapid sequential writes');
  });

  it('line-count of DESIGN.md is preserved across color/spacing/component edits', () => {
    const orig = readDesign(tmp);
    const before = orig.split('\n').length;
    let cur = orig;
    cur = editor.applyColorEdit(cur, { id: 'DT-002', value: '#abcdef' });
    cur = editor.applySpacingEdit(cur, { id: 'spacing.scale', value: [1, 2, 4] });
    // add+remove is zero-diff (no-op remove+add round-trip).
    cur = editor.applyComponentEdit(cur, { id: 'DC-001', action: 'add', variant: 'outlined' });
    cur = editor.applyComponentEdit(cur, { id: 'DC-001', action: 'remove', variant: 'outlined' });
    assert.strictEqual(cur.split('\n').length, before, 'line count must never drift');
  });

  it('atomicWriteDesign is Buffer-clean: no BOM inserted', () => {
    editor.atomicWriteDesign(tmp, '# DESIGN.md\n');
    const buf = fs.readFileSync(path.join(tmp, 'DESIGN.md'));
    assert.notStrictEqual(buf[0], 0xEF, 'no UTF-8 BOM 0xEF');
    assert.notStrictEqual(buf[0], 0xFE, 'no UTF-16 BOM 0xFE');
    assert.notStrictEqual(buf[0], 0xFF, 'no UTF-16 BOM 0xFF');
    assert.strictEqual(buf.toString('utf8'), '# DESIGN.md\n');
  });

  it('atomicWriteDesign preserves trailing newline exactly (no coercion)', () => {
    editor.atomicWriteDesign(tmp, '# no-trailing-newline');
    assert.strictEqual(readDesign(tmp), '# no-trailing-newline');
    editor.atomicWriteDesign(tmp, '# one-trailing-newline\n');
    assert.strictEqual(readDesign(tmp), '# one-trailing-newline\n');
  });
});

// ---------------------------------------------------------------------------
//  Edit-primitive value validation
// ---------------------------------------------------------------------------

describe('F-068 adv: applyColorEdit value validation', () => {
  let tmp, md;
  beforeEach(() => { tmp = makeProjectWithDesign(); md = readDesign(tmp); });
  afterEach(() => rmTmp(tmp));

  it('rejects every non-hex form (XSS, CSS-expressions, rgb(), bare words, empty)', () => {
    const badValues = ['', ' ', '#', '#GGG', '#12', '#0',
      'ff0000', 'rgb(0,0,0)', 'javascript:alert(1)', '#123456789',
      '#12345-6', 'expression(alert(1))', '</style>', '"; DROP TABLE;--'];
    for (const v of badValues) {
      assert.throws(() => editor.applyColorEdit(md, { id: 'DT-001', value: v }),
        /invalid color value/, `expected rejection for ${JSON.stringify(v)}`);
    }
  });

  it('accepts every valid hex form (#RGB, #RGBA, #RRGGBB, #RRGGBBAA, case-insensitive)', () => {
    const good = ['#abc', '#ABC', '#abcd', '#abcdef', '#ABCDEF', '#abcdef12', '#000', '#fff', '#12345'];
    for (const v of good) {
      const next = editor.applyColorEdit(md, { id: 'DT-001', value: v });
      assert.ok(next.includes(v), `expected ${v} to appear in output`);
      // Exactly-one-line diff invariant.
      const before = md.split('\n'); const after = next.split('\n');
      assert.strictEqual(before.length, after.length);
      const diffs = before.map((l, i) => l !== after[i] ? i : -1).filter(i => i !== -1);
      assert.strictEqual(diffs.length, 1, `value ${v} must produce single-line diff`);
    }
  });

  it('rejects malformed edit objects (missing fields, wrong types, bad id format)', () => {
    const cases = [null, undefined, {}, { id: 'DT-001' }, { value: '#aaa' },
      { id: 'DT-001', value: 42 }, { id: 42, value: '#aaa' },
      { id: 'XX-001', value: '#aaa' }, { id: 'DT-ABC', value: '#aaa' },
      { id: 'dt-001', value: '#aaa' }, // lowercase DT prefix
      { id: 'DT-1', value: '#aaa' },   // too few digits (must be >=3)
    ];
    for (const c of cases) {
      assert.throws(() => editor.applyColorEdit(md, c), Error,
        `expected rejection for ${JSON.stringify(c)}`);
    }
  });

  it('throws with informative message when DT-NNN not in file', () => {
    assert.throws(() => editor.applyColorEdit(md, { id: 'DT-999', value: '#abcabc' }),
      /DT-999 not found/);
  });

  it('applyColorEdit is idempotent when re-applying the same value', () => {
    const once = editor.applyColorEdit(md, { id: 'DT-001', value: '#abcdef' });
    const twice = editor.applyColorEdit(once, { id: 'DT-001', value: '#abcdef' });
    assert.strictEqual(once, twice, 'same value applied twice must be byte-identical');
  });
});

describe('F-068 adv: applySpacingEdit value validation', () => {
  let tmp, md;
  beforeEach(() => { tmp = makeProjectWithDesign(); md = readDesign(tmp); });
  afterEach(() => rmTmp(tmp));

  it('rejects null / undefined / primitives as scale value', () => {
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: null }),
      /array of numbers/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: undefined }),
      /array of numbers/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: 42 }),
      /array of numbers/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: {} }),
      /array of numbers/);
  });

  it('rejects arrays containing non-finite entries', () => {
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: [1, 2, 'x'] }),
      /invalid scale entry/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: [1, undefined, 2] }),
      /invalid scale entry/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: [1, {}, 2] }),
      /invalid scale entry/);
    assert.throws(() => editor.applySpacingEdit(md, { id: 'spacing.scale', value: [1, NaN, 2] }),
      /invalid scale entry/);
  });

  it('tolerates CSV strings ("4, 8, 16") for convenience', () => {
    const next = editor.applySpacingEdit(md, { id: 'spacing.scale', value: '4, 8, 16' });
    assert.ok(next.includes('[4, 8, 16]'), 'CSV string normalised');
  });

  it('throws when id is unknown kind (strict id dispatch)', () => {
    assert.throws(() => editor.applySpacingEdit(md, { id: 'bogus.id', value: [1, 2, 3] }),
      /no match for bogus\.id/);
  });

  it('rewrites typography.family with escaped quotes intact', () => {
    const next = editor.applySpacingEdit(md, { id: 'typography.family', value: 'Berkeley "Mono"' });
    assert.ok(next.includes('- family: "Berkeley \\"Mono\\""'), 'quotes must be escaped');
  });

  it('revert: two edits back to original value produces byte-identical file', () => {
    const orig = md.split('\n').find(l => l.trim().startsWith('- scale: ['));
    assert.ok(orig, 'fixture must have spacing scale line');
    const changed = editor.applySpacingEdit(md, { id: 'spacing.scale', value: [1, 2, 3] });
    const reverted = editor.applySpacingEdit(changed, { id: 'spacing.scale', value: [4, 8, 16, 24, 32] });
    assert.strictEqual(reverted, md, 'revert must round-trip byte-for-byte');
  });
});

describe('F-068 adv: applyComponentEdit variant validation', () => {
  let tmp, md;
  beforeEach(() => { tmp = makeProjectWithDesign(); md = readDesign(tmp); });
  afterEach(() => rmTmp(tmp));

  it('rejects variant names violating [a-zA-Z0-9_-]{1,32}', () => {
    const bad = ['', '   ', 'a'.repeat(33), 'name with space', 'name/slash',
      'üniñal', '..', 'new\nline', 'path\\traversal', 'q;drop', '<script>'];
    for (const v of bad) {
      assert.throws(() => editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: v }),
        /invalid characters|applyComponentEdit/, `expected rejection for ${JSON.stringify(v)}`);
    }
  });

  it('accepts exactly 32-char variant (boundary)', () => {
    const name = 'a'.repeat(32);
    const next = editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: name });
    assert.ok(next.includes(name));
  });

  it('rejects invalid action values', () => {
    for (const action of ['update', 'set', '', null, undefined, 'ADD', 'Remove']) {
      assert.throws(() => editor.applyComponentEdit(md, { id: 'DC-001', action, variant: 'x' }),
        /action required|invalid/i, `action ${JSON.stringify(action)} must be rejected`);
    }
  });

  it('rejects DC ID that is not in file', () => {
    assert.throws(() => editor.applyComponentEdit(md, { id: 'DC-999', action: 'add', variant: 'x' }),
      /DC-999 not found/);
  });

  it('add is case-sensitive: "Primary" and "primary" are distinct variants', () => {
    const next = editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: 'Primary' });
    assert.ok(next.includes('Primary'));
    const variantsLine = next.split('\n').find(l => l.includes('- variants:'));
    assert.ok(variantsLine.includes('primary'), 'original lowercase primary preserved');
    assert.ok(variantsLine.includes('Primary'), 'new capitalised Primary appended');
  });

  it('throws when component block has no variants: line', () => {
    const stripped = md.replace(/^-\s+variants:.+$/gm, '- states: [default]');
    assert.throws(() => editor.applyComponentEdit(stripped, { id: 'DC-001', action: 'add', variant: 'x' }),
      /variants list for DC-001 not found/);
  });

  it('round-trip add+remove is byte-identical to original (zero Git noise)', () => {
    const added = editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: 'outlined' });
    const removed = editor.applyComponentEdit(added, { id: 'DC-001', action: 'remove', variant: 'outlined' });
    assert.strictEqual(removed, md, 'add+remove must produce byte-for-byte identical content');
  });
});

// ---------------------------------------------------------------------------
//  HTTP — path-traversal + URL decoding
// ---------------------------------------------------------------------------

describe('F-068 adv: HTTP route hardening', () => {
  let tmp, srv;
  beforeEach(async () => {
    tmp = makeProjectWithDesign();
    srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
  });
  afterEach(async () => { if (srv) await srv.stop(); rmTmp(tmp); });

  it('URL-encoded %2e%2e (..) in :id param is rejected → 404 (matchPattern refuses)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/%2e%2e', { value: '#000000' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(readDesign(tmp).startsWith('# DESIGN.md'), true, 'DESIGN.md untouched');
  });

  it('URL-encoded slash %2F in :id param is rejected → 404', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/..%2Fetc%2Fpasswd', { value: '#000000' });
    assert.strictEqual(res.status, 404);
  });

  it('Empty :id segment (trailing slash form) does not match → 404', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/', { value: '#000000' });
    assert.strictEqual(res.status, 404);
  });

  it('Encoded upper-case %2E%2E also rejected (case-insensitive decode)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/%2E%2E', { value: '#000000' });
    assert.strictEqual(res.status, 404);
  });

  it('GET on a PUT-only route returns 405 with Allow: PUT', async () => {
    const res = await httpRequest('GET', srv.url + '/api/design/color/DT-001');
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.allow, 'PUT', 'Allow header must expose only PUT');
  });

  it('POST on a PUT-only route returns 405', async () => {
    const res = await httpRequest('POST', srv.url + '/api/design/color/DT-001', { value: '#123456' });
    assert.strictEqual(res.status, 405);
  });

  it('DELETE on a PUT-only route (color/:id) returns 405', async () => {
    const res = await httpRequest('DELETE', srv.url + '/api/design/color/DT-001');
    assert.strictEqual(res.status, 405);
  });

  it('PATCH on a PUT-only route returns 405', async () => {
    const res = await httpRequest('PATCH', srv.url + '/api/design/color/DT-001', { value: '#123456' });
    assert.strictEqual(res.status, 405);
  });

  it('Query string on a valid PUT still routes through matcher (200)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001?noise=1', { value: '#deadbe' });
    assert.strictEqual(res.status, 200);
    assert.ok(readDesign(tmp).includes('#deadbe'));
  });

  it('Null value in body returns 400 (and DESIGN.md unchanged)', async () => {
    const before = readDesign(tmp);
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', { value: null });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(readDesign(tmp), before);
  });

  it('Array value where string expected returns 400', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', { value: ['#123456'] });
    assert.strictEqual(res.status, 400);
  });

  it('Unknown action on component route returns 400', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/component/DC-001', { action: 'update', variant: 'outlined' });
    assert.strictEqual(res.status, 400);
  });

  it('Empty variant string on component route returns 400', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/component/DC-001', { action: 'add', variant: '' });
    assert.strictEqual(res.status, 400);
  });

  it('Spacing route rejects scalar value (not array, not CSV string)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/spacing/spacing.scale', { value: 42 });
    assert.strictEqual(res.status, 400);
  });

  it('Spacing route accepts CSV string convenience form', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/spacing/spacing.scale', { value: '2, 4, 8' });
    assert.strictEqual(res.status, 200);
    assert.ok(readDesign(tmp).includes('[2, 4, 8]'));
  });

  it('GET /api/design/read is available (200) even without --editable path', async () => {
    const res = await httpRequest('GET', srv.url + '/api/design/read');
    assert.strictEqual(res.status, 200);
    assert.ok(parseBody(res).content, 'content field should contain DESIGN.md body');
  });

  it('Idempotent no-op add returns 200 with noop:true and does NOT rewrite the file', async () => {
    const before = readDesign(tmp);
    const beforeMtime = fs.statSync(path.join(tmp, 'DESIGN.md')).mtimeMs;
    // Find an already-present variant so add is a no-op.
    const existing = editor._extractVariants(before, 'DC-001');
    assert.ok(existing.length > 0, 'fixture must have at least one variant');
    // Wait a millisecond so any file write would produce a new mtime.
    await new Promise(r => setTimeout(r, 10));
    const res = await httpRequest('PUT', srv.url + '/api/design/component/DC-001', { action: 'add', variant: existing[0] });
    assert.strictEqual(res.status, 200);
    const body = parseBody(res);
    assert.strictEqual(body.noop, true, 'response must signal noop:true');
    assert.strictEqual(readDesign(tmp), before, 'file content must be byte-identical');
    assert.strictEqual(fs.statSync(path.join(tmp, 'DESIGN.md')).mtimeMs, beforeMtime,
      'mtime must not advance on no-op (no rewrite)');
  });
});

// ---------------------------------------------------------------------------
//  HTTP — body parser DoS + malformed payloads
// ---------------------------------------------------------------------------

describe('F-068 adv: body-parser DoS resilience', () => {
  let tmp, srv;
  beforeEach(async () => {
    tmp = makeProjectWithDesign();
    srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
  });
  afterEach(async () => { if (srv) await srv.stop(); rmTmp(tmp); });

  it('> 64KB body returns 413 and DESIGN.md is unchanged', async () => {
    const before = readDesign(tmp);
    const payload = JSON.stringify({ value: '#' + 'a'.repeat(70 * 1024) });
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', payload);
    assert.strictEqual(res.status, 413);
    assert.strictEqual(readDesign(tmp), before);
  });

  it('Malformed JSON returns 400 with error message (no crash)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', '{this is not json');
    assert.strictEqual(res.status, 400);
    assert.ok(/invalid JSON/i.test(parseBody(res).error || ''));
  });

  it('Empty body on PUT /api/design/color/:id returns 400 (value required)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', '{}');
    assert.strictEqual(res.status, 400);
    assert.ok(/value/i.test(parseBody(res).error || ''));
  });

  it('Server remains responsive after a malformed-body hit', async () => {
    await httpRequest('PUT', srv.url + '/api/design/color/DT-001', '{broken');
    const res = await httpRequest('GET', srv.url + '/healthz');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(parseBody(res).ok, true);
  });

  it('Body parser is robust against prototype-pollution payloads', async () => {
    // JSON.parse is intrinsically immune to __proto__/constructor shenanigans in modern Node,
    // but we assert the route handlers do not blindly trust arbitrary fields.
    const evil = JSON.stringify({ value: '#abcdef', __proto__: { polluted: true } });
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', evil);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(({}).polluted, undefined, 'Object.prototype must not be polluted');
  });
});

// ---------------------------------------------------------------------------
//  AC-1 gating — editable=false must register ZERO edit routes
// ---------------------------------------------------------------------------

describe('F-068 adv: editable=false registers zero edit routes', () => {
  let tmp, srv;
  beforeEach(async () => {
    tmp = makeProjectWithDesign();
    srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false /* editable omitted */ });
  });
  afterEach(async () => { if (srv) await srv.stop(); rmTmp(tmp); });

  it('PUT /api/design/color/:id is NOT registered → 404 (route absent)', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/color/DT-001', { value: '#000000' });
    assert.strictEqual(res.status, 404, 'must be 404 — route not registered, not 405');
  });

  it('PUT /api/design/spacing/:id is NOT registered → 404', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/spacing/spacing.scale', { value: [1, 2, 3] });
    assert.strictEqual(res.status, 404);
  });

  it('PUT /api/design/component/:id is NOT registered → 404', async () => {
    const res = await httpRequest('PUT', srv.url + '/api/design/component/DC-001', { action: 'add', variant: 'x' });
    assert.strictEqual(res.status, 404);
  });

  it('DELETE /api/design/component/:id/variant/:name is NOT registered → 404', async () => {
    const res = await httpRequest('DELETE', srv.url + '/api/design/component/DC-001/variant/primary');
    assert.strictEqual(res.status, 404);
  });

  it('_buildRoutes with editable=false exposes zero PUT/DELETE routes', () => {
    const routes = ui._buildRoutes({ projectRoot: tmp, editable: false, clients: new Set(), broadcast: () => {} });
    for (const r of routes) {
      for (const m of r.methods) {
        assert.notStrictEqual(m, 'PUT', `found PUT route ${r.pattern} with editable=false`);
        assert.notStrictEqual(m, 'DELETE', `found DELETE route ${r.pattern} with editable=false`);
        assert.notStrictEqual(m, 'POST', `found POST route ${r.pattern} with editable=false`);
        assert.notStrictEqual(m, 'PATCH', `found PATCH route ${r.pattern} with editable=false`);
      }
    }
  });

  it('_buildRoutes with editable=true adds exactly 4 edit routes', () => {
    const before = ui._buildRoutes({ projectRoot: tmp, editable: false, clients: new Set(), broadcast: () => {} });
    const after = ui._buildRoutes({ projectRoot: tmp, editable: true, clients: new Set(), broadcast: () => {} });
    const editRoutes = after.filter(r => r.methods.includes('PUT') || r.methods.includes('DELETE'));
    assert.strictEqual(editRoutes.length, 4, 'exactly 4 edit routes when editable=true');
    assert.strictEqual(after.length - before.length, 4, 'edit mode adds exactly 4 routes');
  });

  it('GET / in read-only mode contains NO editor UI artefacts', async () => {
    const res = await httpRequest('GET', srv.url + '/');
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.includes('id="design-editor"'));
    assert.ok(!res.body.includes('data-cap-editor="1"'));
    assert.ok(!res.body.includes('class="de-color"'));
    assert.ok(!res.body.includes('de-variant-add'));
    // The `editable-badge` CSS class is defined in core CSS but must NOT be INSTANTIATED as an element
    // in RO mode. The element markup is `<span class="editable-badge">editable</span>` when present.
    assert.ok(!res.body.includes('<span class="editable-badge">'), 'editable-badge span must not render in RO mode');
    // Footer also encodes "EDIT MODE" marker — must be absent in RO.
    assert.ok(!res.body.includes('EDIT MODE'), 'footer must not advertise EDIT MODE in RO');
  });
});

// ---------------------------------------------------------------------------
//  AC-6 — FEATURE-MAP + Memory are frozen against every mutating method
// ---------------------------------------------------------------------------

describe('F-068 adv: AC-6 FEATURE-MAP + Memory hard-freeze', () => {
  let tmp, srv;
  beforeEach(async () => {
    tmp = makeProjectWithDesign();
    srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false, editable: true });
  });
  afterEach(async () => { if (srv) await srv.stop(); rmTmp(tmp); });

  const mutating = ['PUT', 'POST', 'DELETE', 'PATCH'];
  const readOnlyPaths = [
    '/api/feature-map',
    '/api/feature-map/F-001',
    '/api/memory',
    '/api/memory/decisions',
  ];

  for (const p of readOnlyPaths) {
    for (const m of mutating) {
      it(`${m} ${p} returns 405 with Allow: GET`, async () => {
        const res = await httpRequest(m, srv.url + p, m === 'DELETE' ? undefined : { x: 1 });
        assert.strictEqual(res.status, 405, `${m} ${p} must be 405`);
        assert.strictEqual(res.headers.allow, 'GET', 'Allow header must be GET');
      });
    }
  }

  it('GET /api/feature-map returns read-only stub payload', async () => {
    const res = await httpRequest('GET', srv.url + '/api/feature-map');
    assert.strictEqual(res.status, 200);
    const body = parseBody(res);
    assert.strictEqual(body.readOnly, true);
    assert.strictEqual(body.kind, 'feature-map');
  });

  it('GET /api/memory returns read-only stub payload', async () => {
    const res = await httpRequest('GET', srv.url + '/api/memory');
    assert.strictEqual(res.status, 200);
    const body = parseBody(res);
    assert.strictEqual(body.readOnly, true);
    assert.strictEqual(body.kind, 'memory');
  });
});

// ---------------------------------------------------------------------------
//  Snapshot invariants (AC-6 + D9)
// ---------------------------------------------------------------------------

describe('F-068 adv: createSnapshot never embeds edit UI', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('Snapshot HTML omits editor section entirely', () => {
    const { snapshotPath } = ui.createSnapshot({ projectRoot: tmp, outputPath: '.cap/ui/snap.html' });
    const html = fs.readFileSync(path.join(tmp, snapshotPath), 'utf8');
    assert.ok(!html.includes('id="design-editor"'), 'snapshot must not contain editor section');
    assert.ok(!html.includes('data-cap-editor'), 'snapshot must not contain editor marker');
    assert.ok(!html.includes('class="de-color"'), 'snapshot must not contain color widgets');
    assert.ok(!html.includes('fetch(\'PUT\''), 'snapshot must not contain PUT fetch JS');
    assert.ok(!html.includes('/api/design/color/'), 'snapshot must not reference edit endpoints');
  });

  it('createSnapshot refuses absolute outputPath outside projectRoot', () => {
    assert.throws(() => ui.createSnapshot({ projectRoot: tmp, outputPath: '/tmp/evil.html' }),
      /path traversal/i);
  });

  it('createSnapshot refuses ../ traversal outputPath', () => {
    assert.throws(() => ui.createSnapshot({ projectRoot: tmp, outputPath: '../../evil.html' }),
      /path traversal/i);
  });

  it('createSnapshot accepts nested path inside projectRoot', () => {
    const res = ui.createSnapshot({ projectRoot: tmp, outputPath: '.cap/ui/nested/snap.html' });
    assert.ok(res.snapshotPath.endsWith('snap.html'));
    const html = fs.readFileSync(path.join(tmp, res.snapshotPath), 'utf8');
    assert.ok(html.startsWith('<!doctype html>'));
  });
});

// ---------------------------------------------------------------------------
//  Git-friendly diff invariants (AC-5)
// ---------------------------------------------------------------------------

describe('F-068 adv: Git-friendly diff — exactly one-line-changed invariants', () => {
  let tmp, md;
  beforeEach(() => { tmp = makeProjectWithDesign(); md = readDesign(tmp); });
  afterEach(() => rmTmp(tmp));

  function countChangedLines(a, b) {
    const aa = a.split('\n'); const bb = b.split('\n');
    if (aa.length !== bb.length) return -1;
    let n = 0;
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) n++;
    return n;
  }

  it('spacing.scale edit → exactly 1 line changed', () => {
    const next = editor.applySpacingEdit(md, { id: 'spacing.scale', value: [2, 4, 6, 8] });
    assert.strictEqual(countChangedLines(md, next), 1);
  });

  it('typography.scale edit → exactly 1 line changed', () => {
    const next = editor.applySpacingEdit(md, { id: 'typography.scale', value: [10, 12, 16] });
    assert.strictEqual(countChangedLines(md, next), 1);
  });

  it('typography.family edit → exactly 1 line changed', () => {
    const next = editor.applySpacingEdit(md, { id: 'typography.family', value: 'JetBrains Mono' });
    assert.strictEqual(countChangedLines(md, next), 1);
  });

  it('component add variant → exactly 1 line changed', () => {
    const next = editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: 'outlined' });
    assert.strictEqual(countChangedLines(md, next), 1);
  });

  it('component remove variant → exactly 1 line changed', () => {
    const added = editor.applyComponentEdit(md, { id: 'DC-001', action: 'add', variant: 'outlined' });
    const removed = editor.applyComponentEdit(added, { id: 'DC-001', action: 'remove', variant: 'outlined' });
    // add+remove is round-trip → 0 diff vs md
    assert.strictEqual(countChangedLines(md, removed), 0);
    // But removed vs added is exactly 1 line.
    assert.strictEqual(countChangedLines(added, removed), 1);
  });

  it('no edit ever changes total byte-length order-of-magnitude (bounded growth)', () => {
    let cur = md;
    const origLen = md.length;
    for (let i = 0; i < 20; i++) cur = editor.applyColorEdit(cur, { id: 'DT-001', value: '#000000' });
    assert.ok(Math.abs(cur.length - origLen) < 50, 'repeated edits must not balloon the file');
  });
});

// ---------------------------------------------------------------------------
//  Performance (AC-5 — single-line rewrite must stay sub-50ms even on huge files)
// ---------------------------------------------------------------------------

describe('F-068 adv: performance on large DESIGN.md', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('applyColorEdit on 10,000-line DESIGN.md completes in < 100ms', () => {
    const md = readDesign(tmp);
    const padded = md + '\n' + Array(10000).fill('- filler: value').join('\n') + '\n';
    const start = process.hrtime.bigint();
    const next = editor.applyColorEdit(padded, { id: 'DT-001', value: '#deadbe' });
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(durMs < 100, `edit took ${durMs.toFixed(2)}ms, budget 100ms`);
    assert.ok(next.includes('#deadbe'));
  });
});

// ---------------------------------------------------------------------------
//  Client JS — deeper invariants beyond baseline
// ---------------------------------------------------------------------------

describe('F-068 adv: client JS composition invariants', () => {
  it('editor JS uses fetch with PUT/DELETE (D8) — no XMLHttpRequest fallback', () => {
    const js = editor.buildEditorJs();
    assert.ok(/fetch\s*\(/.test(js), 'editor JS must use fetch()');
    assert.ok(/method:\s*method/.test(js) || /'PUT'/.test(js) || /"PUT"/.test(js), 'editor JS must issue PUT');
    assert.ok(!/XMLHttpRequest/.test(js), 'no legacy XHR fallback');
  });

  it('editor JS wires color picker, slider, variant add, variant remove', () => {
    const js = editor.buildEditorJs();
    assert.ok(/de-color/.test(js), 'color handler present');
    assert.ok(/de-scale/.test(js), 'scale handler present');
    assert.ok(/de-variant-add/.test(js), 'variant add handler present');
    assert.ok(/de-variant-remove/.test(js), 'variant remove handler present');
  });

  it('editor JS has no literal </script sequence (XSS defence)', () => {
    const js = editor.buildEditorJs();
    assert.ok(!/<\/script/i.test(js));
  });

  it('editor JS composed into buildClientJs only when editable=true', () => {
    const ro = ui.buildClientJs({ live: true, editable: false });
    const rw = ui.buildClientJs({ live: true, editable: true });
    assert.ok(!ro.includes('/api/design/color/'), 'read-only JS must not leak edit endpoints');
    assert.ok(rw.includes('/api/design/color/'), 'editor JS must include edit endpoints');
  });

  it('editor JS parseable by Function constructor (both live modes)', () => {
    for (const live of [true, false]) {
      const js = ui.buildClientJs({ live, editable: true });
      // eslint-disable-next-line no-new-func
      assert.doesNotThrow(() => new Function(js), `editor JS (live=${live}) must parse`);
    }
  });
});

// ---------------------------------------------------------------------------
//  editable=false byte-identity (D6)
// ---------------------------------------------------------------------------

describe('F-068 adv: D6 byte-identity — editable=false leaves HTML lean', () => {
  let tmp;
  beforeEach(() => { tmp = makeProjectWithDesign(); });
  afterEach(() => rmTmp(tmp));

  it('read-only HTML contains no editor CSS / JS / markup', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    snap.generatedAt = 'FROZEN'; // pin for deterministic compare
    const ro = ui.renderHtml({ snapshot: snap, options: { live: false, editable: false } });
    assert.ok(!ro.includes('#design-editor .de-badge'), 'editor CSS must be absent');
    assert.ok(!ro.includes('de-color'), 'editor color class must be absent');
    assert.ok(!ro.includes('/api/design/color/'), 'editor JS must not reference PUT endpoints');
    assert.ok(!ro.includes('data-cap-editor'), 'editor marker must be absent');
    assert.ok(!ro.includes('id="design-editor"'), 'editor section must be absent');
  });

  it('read-only HTML size is strictly smaller than edit-mode HTML', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    snap.generatedAt = 'FROZEN';
    const ro = ui.renderHtml({ snapshot: snap, options: { live: false, editable: false } });
    const rw = ui.renderHtml({ snapshot: snap, options: { live: false, editable: true } });
    assert.ok(rw.length > ro.length, 'editor mode must add bytes');
    // Sanity: not pathologically bloated either.
    assert.ok(rw.length - ro.length < 30 * 1024, 'editor addition stays under 30KB');
  });

  it('two successive renderHtml calls are byte-identical (pure function)', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    snap.generatedAt = 'FROZEN';
    const a = ui.renderHtml({ snapshot: snap, options: { live: false, editable: true } });
    const b = ui.renderHtml({ snapshot: snap, options: { live: false, editable: true } });
    assert.strictEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
//  Module split back-compat
// ---------------------------------------------------------------------------

describe('F-068 adv: module-split back-compat preserves the cap-ui.cjs surface', () => {
  const expectedExports = [
    // F-065 core
    'startServer', 'renderHtml', 'createSnapshot', 'startFileWatcher',
    'sseResponse', 'collectProjectSnapshot', 'logEvent', 'escapeHtml',
    'buildCoreCss', 'buildCoreJs', 'buildCss', 'buildClientJs',
    // F-066 mind-map re-exports
    'buildGraphData', 'runForceLayout', 'renderMindMapSvg',
    'buildMindMapSection', 'buildMindMapCss', 'buildMindMapJs',
    // F-067 thread-nav re-exports
    'buildThreadData', 'renderThreadList', 'renderThreadDetail',
    'renderClusterView', 'renderKeywordOverlap',
    'buildThreadNavSection', 'buildThreadNavCss', 'buildThreadNavJs',
    // F-068 editor re-exports
    'buildEditorSection', 'buildEditorCss', 'buildEditorJs',
    'applyColorEdit', 'applySpacingEdit', 'applyComponentEdit',
    'checkContainment', 'atomicWriteDesign',
  ];

  for (const name of expectedExports) {
    it(`cap-ui.cjs exports ${name}`, () => {
      assert.strictEqual(typeof ui[name], 'function', `${name} must be a function`);
    });
  }

  it('F-066 mind-map re-export === the sibling module export', () => {
    assert.strictEqual(ui.buildGraphData, mindMapLib.buildGraphData);
    assert.strictEqual(ui.buildMindMapSection, mindMapLib.buildMindMapSection);
  });

  it('F-067 thread-nav re-export === the sibling module export', () => {
    assert.strictEqual(ui.buildThreadData, threadNavLib.buildThreadData);
    assert.strictEqual(ui.buildThreadNavSection, threadNavLib.buildThreadNavSection);
  });

  it('F-068 editor re-export === the sibling module export', () => {
    assert.strictEqual(ui.applyColorEdit, editor.applyColorEdit);
    assert.strictEqual(ui.applyComponentEdit, editor.applyComponentEdit);
    assert.strictEqual(ui.checkContainment, editor.checkContainment);
    assert.strictEqual(ui.atomicWriteDesign, editor.atomicWriteDesign);
  });

  it('module manifest is 78 after F-072 adds cap-fitness-score.cjs (doctor contract)', () => {
    // @cap-decision(F-061) Bumped 73 -> 74 when cap-telemetry.cjs was added (Token Telemetry observability).
    // @cap-decision(F-075) Bumped 74 -> 75 when cap-trust-mode.cjs was added (Trust-Mode Configuration Slot).
    // @cap-decision(F-070) Bumped 75 -> 76 when cap-learning-signals.cjs was added (Collect Learning Signals).
    // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added (Heuristic + LLM-briefing pattern pipeline).
    // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added (Two-Layer Fitness Score for Pattern Unlearn).
    assert.strictEqual(doctorLib.CAP_MODULE_MANIFEST.length, 78);
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-ui-design-editor.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-ui-mind-map.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-ui-thread-nav.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-ui.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-telemetry.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-trust-mode.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-learning-signals.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-pattern-pipeline.cjs'));
    assert.ok(doctorLib.CAP_MODULE_MANIFEST.includes('cap-fitness-score.cjs'));
  });
});

// ---------------------------------------------------------------------------
//  buildEditorSection edge cases
// ---------------------------------------------------------------------------

describe('F-068 adv: buildEditorSection edge cases', () => {
  it('returns "No DESIGN.md" fallback when designMd is null', () => {
    const s = editor.buildEditorSection({ designMd: null, editable: true });
    assert.ok(s.includes('id="design-editor"'));
    assert.ok(s.includes('No DESIGN.md found'));
  });

  it('returns "No DESIGN.md" fallback when designMd is empty string', () => {
    const s = editor.buildEditorSection({ designMd: '', editable: true });
    assert.ok(s.includes('No DESIGN.md found'));
  });

  it('returns empty string regardless of designMd when editable is false (D6)', () => {
    assert.strictEqual(editor.buildEditorSection({ designMd: '# DESIGN.md', editable: false }), '');
    assert.strictEqual(editor.buildEditorSection({ designMd: null, editable: false }), '');
    assert.strictEqual(editor.buildEditorSection({ designMd: '', editable: false }), '');
    assert.strictEqual(editor.buildEditorSection({}), ''); // editable undefined → falsy
  });

  it('degrades gracefully on DESIGN.md with no DT-NNN / DC-NNN tokens', () => {
    const s = editor.buildEditorSection({ designMd: '# DESIGN.md\n\nJust text.\n', editable: true });
    assert.ok(s.includes('No DT-NNN color tokens found'));
    assert.ok(s.includes('No DC-NNN components found'));
  });

  it('non-hex token value renders read-only row (D7 degrade)', () => {
    const md = [
      '# DESIGN.md',
      '',
      '## Tokens',
      '',
      '### Colors',
      '',
      '- weird: not-a-hex-value (id: DT-001)',
      '',
    ].join('\n');
    const s = editor.buildEditorSection({ designMd: md, editable: true });
    assert.ok(s.includes('data-editor-row="token-readonly"'), 'non-hex must render as read-only row');
    assert.ok(!s.includes('<input type="color" value="not-a-hex-value"'), 'no color picker for non-hex');
  });

  it('properly HTML-escapes malicious values in the editor table', () => {
    const md = [
      '# DESIGN.md',
      '',
      '## Tokens',
      '',
      '### Colors',
      '',
      '- evil: <script>alert(1)</script> (id: DT-001)',
      '',
    ].join('\n');
    const s = editor.buildEditorSection({ designMd: md, editable: true });
    assert.ok(!s.includes('<script>alert(1)</script>'), 'raw script must not be injected');
    assert.ok(s.includes('&lt;script&gt;'), 'escaped form must be present');
  });
});
