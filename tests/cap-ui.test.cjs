// @cap-feature(feature:F-065) CAP-UI Core — RED-GREEN tests covering AC-1..AC-6.
// @cap-decision All HTTP tests use port 0 (OS-assigned ephemeral) to avoid collisions and parallel-test flakiness.
// @cap-decision Tests use node:http only — never fetch/undici/axios — to enforce the zero-deps constraint at the test layer.
// @cap-constraint Zero external test dependencies (node:test + node:assert only).

'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const ui = require('../cap/bin/lib/cap-ui.cjs');
const featureMapLib = require('../cap/bin/lib/cap-feature-map.cjs');

// --- Helpers ---------------------------------------------------------------

function makeTmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ui-'));
  // Seed a minimal FEATURE-MAP.md so renderers have something to render.
  const featureMap = {
    features: [
      {
        id: 'F-001', title: 'Tag Scanner', state: 'shipped',
        acs: [{ id: 'AC-1', status: 'tested', description: 'Extract tags' }],
        files: [], dependencies: [], usesDesign: [], metadata: {},
      },
      {
        id: 'F-065', title: 'CAP-UI Core', state: 'prototyped',
        acs: [{ id: 'AC-1', status: 'pending', description: 'Local server' }],
        files: [], dependencies: [], usesDesign: [], metadata: {},
      },
    ],
    lastScan: null,
  };
  featureMapLib.writeFeatureMap(dir, featureMap);
  // Seed .cap/memory for a richer render.
  const memDir = path.join(dir, '.cap', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'decisions.md'), '# Decisions\n- Zero deps.\n');
  // Seed a thread index so AC-2 (threads section) has content.
  fs.writeFileSync(path.join(memDir, 'thread-index.json'), JSON.stringify({
    version: '1',
    threads: [
      { id: 'thr-abc', name: 'CAP-UI brainstorm', timestamp: '2026-04-21T10:00:00Z', featureIds: ['F-065'], parentThreadId: null, keywords: ['ui', 'server'] },
    ],
  }));
  // Seed .cap/SESSION.json.
  fs.writeFileSync(path.join(dir, '.cap', 'SESSION.json'), JSON.stringify({
    version: '2.0.0', activeFeature: 'F-065', step: 'prototype', lastCommand: '/cap:ui', metadata: {},
  }));
  return dir;
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('timeout')); });
  });
}

function httpMethod(url, method) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method,
    }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// --- Tests -----------------------------------------------------------------

describe('cap-ui AC-1: zero-deps local HTTP server', () => {
  let tmp, stop;

  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(async () => {
    if (stop) { await stop(); stop = null; }
    rmTmp(tmp);
  });

  it('startServer returns { url, port, stop } and binds to an ephemeral port', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    assert.ok(srv.url.startsWith('http://127.0.0.1:'), 'url should be loopback');
    assert.ok(typeof srv.port === 'number' && srv.port > 0, 'port should be assigned');
    assert.strictEqual(typeof srv.stop, 'function', 'stop should be callable');
  });

  it('DEFAULT_PORT constant is 4747 (AC-1 default)', () => {
    assert.strictEqual(ui.DEFAULT_PORT, 4747);
  });

  it('cap-ui.cjs does not import any non-node-prefixed module (zero-deps)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-ui.cjs'), 'utf8');
    const requireRE = /require\(['"]([^'"]+)['"]\)/g;
    let m;
    while ((m = requireRE.exec(src)) !== null) {
      const mod = m[1];
      const isNodePrefixed = mod.startsWith('node:');
      const isRelative = mod.startsWith('./') || mod.startsWith('../');
      assert.ok(
        isNodePrefixed || isRelative,
        `cap-ui.cjs requires external module "${mod}" — must be node: prefixed or relative`
      );
    }
  });

  it('responds 200 on GET / with HTML content', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    const res = await httpGet(srv.url + '/');
    assert.strictEqual(res.status, 200);
    assert.ok(String(res.headers['content-type'] || '').includes('text/html'));
    assert.ok(res.body.startsWith('<!doctype html>'));
  });

  it('responds 404 on unknown route', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    const res = await httpGet(srv.url + '/nope');
    assert.strictEqual(res.status, 404);
  });
});

describe('cap-ui AC-2: renders Feature Map + Memory + Threads', () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('renderHtml output contains a Features section with feature IDs', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot });
    assert.ok(html.includes('>Features'), 'should have Features heading');
    assert.ok(html.includes('F-001'), 'should include seeded feature id F-001');
    assert.ok(html.includes('F-065'), 'should include seeded feature id F-065');
  });

  it('renderHtml output contains Memory section and decisions content', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot });
    assert.ok(html.includes('>Memory'), 'should have Memory heading');
    assert.ok(html.includes('Zero deps'), 'should include seeded decisions.md body');
  });

  it('renderHtml output contains Threads section with thread name', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot });
    assert.ok(html.includes('>Threads'), 'should have Threads heading');
    assert.ok(html.includes('CAP-UI brainstorm'), 'should include seeded thread name');
  });

  it('renderHtml escapes HTML special characters in feature content', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    snapshot.featureMap.features[0].title = '<script>alert(1)</script>';
    const html = ui.renderHtml({ snapshot });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must be escaped');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped form expected');
  });
});

describe('cap-ui AC-3: file watcher fires SSE change events', () => {
  let tmp, stop;
  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(async () => {
    if (stop) { await stop(); stop = null; }
    rmTmp(tmp);
  });

  it('startFileWatcher fires onChange when FEATURE-MAP.md is modified', async () => {
    let appendTimer = null;
    let timeoutTimer = null;
    let handle = null;
    const tmpDir = tmp;
    try {
      await new Promise(function (resolve, reject) {
        handle = ui.startFileWatcher({
          projectRoot: tmpDir,
          debounceMs: 20,
          onChange: function (evt) {
            try {
              assert.ok(evt && typeof evt.file === 'string', 'event should carry file');
              resolve();
            } catch (err) { reject(err); }
          },
        });
        appendTimer = setTimeout(function () {
          // Guard against the tmp being torn down before the timer fires.
          try { fs.appendFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), '\n<!-- touched -->\n'); }
          catch { /* tmp removed — test is already past this point */ }
        }, 50);
        timeoutTimer = setTimeout(function () { reject(new Error('watcher did not fire within 2s')); }, 2000);
      });
    } finally {
      // Always cancel outstanding timers AND stop the watcher before afterEach tears down tmp.
      if (appendTimer) clearTimeout(appendTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (handle) { try { handle.stop(); } catch { /* ignore */ } }
    }
  });

  it('/events endpoint responds with text/event-stream', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    await new Promise(function (resolve, reject) {
      const u = new URL(srv.url + '/events');
      const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, function (res) {
        try {
          assert.strictEqual(res.statusCode, 200);
          assert.ok(String(res.headers['content-type'] || '').includes('text/event-stream'));
          req.destroy();
          resolve();
        } catch (err) { reject(err); }
      });
      req.on('error', reject);
      req.setTimeout(3000, function () { req.destroy(new Error('sse timeout')); });
    });
  });

  it('sseResponse writes an event and respects close', () => {
    // Minimal fake response object — we only need writeHead, write, end, and event listeners.
    const writes = [];
    let ended = false;
    let closeHandler = null;
    const fakeRes = {
      writeHead: function () {},
      write: function (chunk) { writes.push(String(chunk)); return true; },
      end: function () { ended = true; },
      on: function (ev, cb) { if (ev === 'close') closeHandler = cb; },
    };
    const ctl = ui.sseResponse(fakeRes);
    const ok = ctl.send('change', { file: 'FEATURE-MAP.md', type: 'modify' });
    assert.ok(ok, 'send should return true on open stream');
    const joined = writes.join('');
    assert.ok(joined.includes('event: change'), 'event line present');
    assert.ok(joined.includes('data: {"file":"FEATURE-MAP.md"'), 'data line present');
    ctl.close();
    assert.ok(ended, 'close should end the response');
    // Send after close returns false.
    assert.strictEqual(ctl.send('change', {}), false);
  });
});

describe('cap-ui AC-4: standalone HTML snapshot (--share)', () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('createSnapshot writes .cap/ui/snapshot.html by default', () => {
    const out = ui.createSnapshot({ projectRoot: tmp });
    assert.strictEqual(out.snapshotPath, path.join('.cap', 'ui', 'snapshot.html'));
    const abs = path.join(tmp, out.snapshotPath);
    assert.ok(fs.existsSync(abs), 'snapshot file should exist');
    assert.ok(out.bytes > 0, 'bytes should be positive');
  });

  it('snapshot HTML contains inline <style> and inline <script> (no external fetch)', () => {
    ui.createSnapshot({ projectRoot: tmp });
    const html = fs.readFileSync(path.join(tmp, '.cap', 'ui', 'snapshot.html'), 'utf8');
    assert.ok(html.includes('<style>'), 'inline <style> required for standalone');
    assert.ok(html.includes('<script>'), 'inline <script> required for standalone');
  });

  it('snapshot HTML references no external http(s) URLs', () => {
    ui.createSnapshot({ projectRoot: tmp });
    const html = fs.readFileSync(path.join(tmp, '.cap', 'ui', 'snapshot.html'), 'utf8');
    // Allow http://127.0.0.1 references in text (none expected, but safe filter), disallow any other http(s):
    const hits = html.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"'<>]+/g) || [];
    assert.deepStrictEqual(hits, [], `snapshot must not fetch external URLs; found: ${hits.join(', ')}`);
  });

  it('snapshot HTML does not open an SSE stream (static, not live)', () => {
    ui.createSnapshot({ projectRoot: tmp });
    const html = fs.readFileSync(path.join(tmp, '.cap', 'ui', 'snapshot.html'), 'utf8');
    assert.ok(!html.includes('new EventSource'), 'snapshot must not open EventSource');
  });
});

describe('cap-ui AC-5: read-only — no edit endpoints', () => {
  let tmp, stop;
  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(async () => {
    if (stop) { await stop(); stop = null; }
    rmTmp(tmp);
  });

  it('rendered HTML contains no <form> element', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot });
    assert.ok(!/<form\b/i.test(html), 'F-065 UI must not contain a form');
  });

  it('rendered HTML contains no POST/PUT/DELETE strings in client JS', () => {
    const snapshot = ui.collectProjectSnapshot(tmp);
    const html = ui.renderHtml({ snapshot });
    // Only check between <script>…</script>.
    const scriptRE = /<script>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = scriptRE.exec(html)) !== null) {
      const body = m[1];
      assert.ok(!/method\s*:\s*['"]POST['"]/i.test(body), 'no POST fetch config allowed');
      assert.ok(!/method\s*:\s*['"]PUT['"]/i.test(body),  'no PUT fetch config allowed');
      assert.ok(!/method\s*:\s*['"]DELETE['"]/i.test(body),'no DELETE fetch config allowed');
    }
  });

  it('server returns 405 Method Not Allowed for POST requests', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    const res = await httpMethod(srv.url + '/', 'POST');
    assert.strictEqual(res.status, 405);
    assert.ok(String(res.headers['allow'] || '').includes('GET'));
  });

  it('server returns 405 for PUT and DELETE as well', async () => {
    const srv = await ui.startServer({ projectRoot: tmp, port: 0, watch: false });
    stop = srv.stop;
    const put = await httpMethod(srv.url + '/', 'PUT');
    const del = await httpMethod(srv.url + '/', 'DELETE');
    assert.strictEqual(put.status, 405);
    assert.strictEqual(del.status, 405);
  });
});

describe('cap-ui AC-6: ISO-timestamped stdout logging', () => {
  it('logEvent writes a single line with ISO timestamp, level, and message to stdout', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    const captured = [];
    // Replace process.stdout.write with a capture stub.
    process.stdout.write = function (chunk) {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    };
    try {
      ui.logEvent('info', 'server-start', { port: 4747 });
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.strictEqual(captured.length, 1, 'exactly one stdout write per log');
    const line = captured[0];
    // ISO8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    const isoRE = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[cap:ui\] \[info\] server-start /;
    assert.ok(isoRE.test(line), `expected ISO-prefixed log line, got: ${JSON.stringify(line)}`);
    assert.ok(line.includes('"port":4747'), 'meta object should be serialized as JSON');
    assert.ok(line.endsWith('\n'), 'log line should end with newline');
  });

  it('logEvent handles missing meta', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    const captured = [];
    process.stdout.write = function (chunk) { captured.push(String(chunk)); return true; };
    try {
      ui.logEvent('warn', 'port-in-use');
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.strictEqual(captured.length, 1);
    assert.ok(/\[warn\] port-in-use\n$/.test(captured[0]));
  });
});

describe('cap-ui: collectProjectSnapshot', () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpProject(); });
  afterEach(() => { rmTmp(tmp); });

  it('returns featureMap, threads, memory, session from seeded project', () => {
    const snap = ui.collectProjectSnapshot(tmp);
    assert.ok(snap.featureMap && Array.isArray(snap.featureMap.features));
    assert.ok(snap.featureMap.features.length >= 2);
    assert.ok(Array.isArray(snap.threads));
    assert.strictEqual(snap.session.activeFeature, 'F-065');
    assert.ok(typeof snap.memory.decisions === 'string');
    assert.ok(typeof snap.generatedAt === 'string');
  });

  it('tolerates missing .cap/memory and missing DESIGN.md', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-ui-empty-'));
    try {
      const snap = ui.collectProjectSnapshot(empty);
      assert.ok(snap.featureMap);
      assert.strictEqual(snap.memory.decisions, null);
      assert.strictEqual(snap.designMd, null);
    } finally {
      rmTmp(empty);
    }
  });
});

describe('cap-ui: escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    assert.strictEqual(ui.escapeHtml(`a & b <c> "d" 'e'`), 'a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;');
  });
  it('returns empty string for null and undefined', () => {
    assert.strictEqual(ui.escapeHtml(null), '');
    assert.strictEqual(ui.escapeHtml(undefined), '');
  });
});
