// @cap-context CAP v5 CAP-UI Core — local HTTP server + static snapshot export for Feature-Map, Memory, Threads, DESIGN.md.
// @cap-decision Zero external deps by design. Only node: builtins (http, fs, path, url, os, crypto). No Express, no WebSockets, no React.
// @cap-decision Read-only UI for Feature-Map + Memory + Threads. DESIGN.md edit capability is scoped to F-068. No POST/PUT routes in F-065.
// @cap-decision Server-Sent Events (SSE) over WebSockets — browser-native EventSource handles reconnect, firewalls, and proxies more gracefully.
// @cap-decision HTML rendered via template literals (not DOM builder, not JSX) — zero build step, same code path for --serve and --share.
// @cap-decision CSS + JS embedded inline in every response — required for --share to produce a standalone shareable HTML file.
// @cap-constraint All file I/O goes through this module (and the shared lib readers); no direct fs access from command layer for UI state.
// @cap-pattern Renderer is a pure function over data; server and snapshot both call the same renderHtml() so they stay byte-compatible.

'use strict';

// @cap-feature(feature:F-065) CAP-UI Core — local server, renderer, file watcher, snapshot exporter.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const featureMapLib = require('./cap-feature-map.cjs');
const sessionLib = require('./cap-session.cjs');
const threadLib = require('./cap-thread-tracker.cjs');

// --- Constants -------------------------------------------------------------

/** Default port. AC-1 requires configurable port; this is the default. */
const DEFAULT_PORT = 4747;

/** Max auto-increment attempts when the default port is busy (D5). */
const MAX_PORT_ATTEMPTS = 10;

/** Debounce window (ms) for file-watcher change coalescing. */
const WATCH_DEBOUNCE_MS = 100;

/** Heartbeat interval (ms) for SSE connections. */
const SSE_HEARTBEAT_MS = 30000;

/** Paths watched by the file-watcher (relative to project root). AC-3. */
const WATCH_TARGETS = [
  'FEATURE-MAP.md',
  'DESIGN.md',
  path.join('.cap', 'SESSION.json'),
  path.join('.cap', 'memory'), // recursive
];

/** Snapshot output path (AC-4). */
const SNAPSHOT_PATH = path.join('.cap', 'ui', 'snapshot.html');

// --- Types -----------------------------------------------------------------

/**
 * @typedef {Object} ProjectSnapshot
 * @property {string} projectName
 * @property {string} generatedAt - ISO timestamp
 * @property {Object} session - CapSession from cap-session.cjs
 * @property {Object} featureMap - FeatureMap from cap-feature-map.cjs
 * @property {Object[]} threads - Thread index entries from cap-thread-tracker.cjs
 * @property {Object} memory - { decisions, pitfalls, patterns, hotspots } as markdown strings
 * @property {string|null} designMd - DESIGN.md contents if present, else null
 */

// --- Logging ---------------------------------------------------------------

// @cap-todo(ac:F-065/AC-6) Server logs all events (start, SSE connect, file change, heartbeat) with ISO timestamps to stdout for debugging.
/**
 * Emit a structured log line to stdout. Single line, ISO timestamp, level + message + optional meta.
 * @param {'info'|'warn'|'error'} level
 * @param {string} msg
 * @param {Object} [meta]
 */
function logEvent(level, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  // Use process.stdout.write so tests can capture without newline-buffering surprises.
  process.stdout.write(`[${ts}] [cap:ui] [${level}] ${msg}${metaStr}\n`);
}

// --- Data collection -------------------------------------------------------

/**
 * Collect all project state the UI needs to render.
 * Pure data aggregation — no rendering, no side effects.
 * @param {string} projectRoot - Absolute path to project root
 * @returns {ProjectSnapshot}
 */
function collectProjectSnapshot(projectRoot) {
  // @cap-risk Reading a large FEATURE-MAP.md or many thread files on every request is O(n); fine for CAP-scale projects (<200 features, <500 threads) but should be monitored.
  const featureMap = safeCall(() => featureMapLib.readFeatureMap(projectRoot), { features: [], lastScan: null });
  const session = safeCall(() => sessionLib.loadSession(projectRoot), {});
  const threadIndex = safeCall(() => threadLib.listThreads(projectRoot), []);

  const memory = {
    decisions: readIfExists(path.join(projectRoot, '.cap', 'memory', 'decisions.md')),
    pitfalls: readIfExists(path.join(projectRoot, '.cap', 'memory', 'pitfalls.md')),
    patterns: readIfExists(path.join(projectRoot, '.cap', 'memory', 'patterns.md')),
    hotspots: readIfExists(path.join(projectRoot, '.cap', 'memory', 'hotspots.md')),
  };

  const designMd = readIfExists(path.join(projectRoot, 'DESIGN.md'));

  const projectName = detectProjectName(projectRoot);

  return {
    projectName,
    generatedAt: new Date().toISOString(),
    session,
    featureMap,
    threads: threadIndex,
    memory,
    designMd,
  };
}

function readIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function detectProjectName(projectRoot) {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name;
    }
  } catch { /* ignore */ }
  return path.basename(projectRoot);
}

// --- HTML rendering --------------------------------------------------------

// @cap-decision(D1) Use template literals (not DOM builder / JSX) for HTML generation — simpler, zero build step, trivially auditable.
// @cap-decision(D2) CSS embedded via inline <style>; JS via inline <script>. Same output for --serve and --share (snapshot needs standalone).

// @cap-todo(ac:F-065/AC-2) renderHtml produces a full HTML page: header (project name, active feature, timestamp), Features section, Design section, Memory section, Threads section, footer.
/**
 * Render a full HTML document for the given project snapshot.
 * Pure function — no I/O, no dates beyond what the snapshot already carries.
 * @param {Object} params
 * @param {ProjectSnapshot} params.snapshot
 * @param {Object} [params.options]
 * @param {boolean} [params.options.live] - If true, include SSE client JS (for --serve). If false, static snapshot (for --share).
 * @returns {string} Full HTML document
 */
function renderHtml({ snapshot, options = {} }) {
  const live = options.live === true;
  const s = snapshot;

  const css = buildCss();
  const js = buildClientJs({ live });

  const body = [
    renderHeader(s),
    renderNav(),
    renderFeaturesSection(s.featureMap),
    renderDesignSection(s.designMd),
    renderMemorySection(s.memory),
    renderThreadsSection(s.threads),
    renderFooter(live),
  ].join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(s.projectName)} — cap:ui</title>`,
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    body,
    `<script>${js}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

// @cap-decision(Terminal-Core) Font stack is system monospace only — ui-monospace, SF Mono, Menlo, Consolas, monospace. NO Inter/Roboto/Arial (F-062 Anti-Slop).
// @cap-decision(Terminal-Core) Palette: warm neutrals + terracotta accent. NO purple-blue gradients, NO 3-column feature-card template.
function buildCss() {
  return `
:root {
  --fg: #2a2420;
  --fg-muted: #6b5e54;
  --bg: #faf7f2;
  --bg-card: #fffbf5;
  --border: #d9cfc2;
  --accent: #b4553a;
  --accent-muted: #d49a83;
  --state-planned: #8a7a66;
  --state-prototyped: #b47a3a;
  --state-tested: #3a7a55;
  --state-shipped: #2a5a7a;
  --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.55;
  color: var(--fg);
  background: var(--bg);
  padding: 0;
}
header.cap-header {
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
}
header.cap-header h1 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent);
}
header.cap-header .meta {
  color: var(--fg-muted);
  font-size: 12px;
}
nav.cap-nav {
  padding: 8px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
nav.cap-nav a {
  color: var(--fg-muted);
  text-decoration: none;
  margin-right: 16px;
  font-size: 12px;
}
nav.cap-nav a:hover { color: var(--accent); }
main { padding: 16px 24px 48px; max-width: 1100px; }
section.cap-section {
  margin: 24px 0;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
section.cap-section:first-child { border-top: none; }
section.cap-section > h2 {
  margin: 8px 0 12px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.feature-list { list-style: none; padding: 0; margin: 0; }
.feature-item {
  border: 1px solid var(--border);
  background: var(--bg-card);
  padding: 10px 12px;
  margin: 6px 0;
  border-radius: 3px;
}
.feature-item .id {
  font-weight: 600;
  color: var(--accent);
}
.feature-item .title { color: var(--fg); }
.feature-item .state {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--border);
  color: var(--fg);
  margin-left: 6px;
}
.feature-item .state.planned   { background: var(--border);        color: var(--state-planned); }
.feature-item .state.prototyped{ background: #f1e4d0;              color: var(--state-prototyped); }
.feature-item .state.tested    { background: #d8ead9;              color: var(--state-tested); }
.feature-item .state.shipped   { background: #d0dde9;              color: var(--state-shipped); }
.ac-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 12.5px;
}
.ac-table th, .ac-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.ac-table th { color: var(--fg-muted); font-weight: 500; }
.memory-block {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 10px 12px;
  margin: 6px 0;
  white-space: pre-wrap;
  font-size: 12.5px;
  border-radius: 3px;
  max-height: 360px;
  overflow: auto;
}
.thread-list { list-style: none; padding: 0; margin: 0; }
.thread-item {
  border: 1px solid var(--border);
  background: var(--bg-card);
  padding: 8px 12px;
  margin: 4px 0;
  font-size: 12.5px;
  border-radius: 3px;
}
.thread-item .ts { color: var(--fg-muted); margin-right: 8px; }
.empty { color: var(--fg-muted); font-style: italic; }
footer.cap-footer {
  padding: 12px 24px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 11px;
}
.live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-muted);
  margin-right: 6px;
  vertical-align: middle;
}
.live-dot.on { background: #3a7a55; }
.filter-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 2px;
  width: 260px;
}
`.trim();
}

// @cap-decision(D3) Client JS inline — vanilla, no modules, no bundler. For snapshots (--share) the script is a no-op reconnect guard.
// @cap-decision(D4) EventSource handles reconnect natively; client code only needs to connect + refresh on 'reload'/'change' events.
function buildClientJs({ live }) {
  if (!live) {
    // Static snapshot: no live features, but keep a tiny client filter for feature search.
    return `
(function(){
  var input=document.getElementById('feature-filter');
  if(!input)return;
  input.addEventListener('input',function(e){
    var q=e.target.value.trim().toLowerCase();
    document.querySelectorAll('.feature-item').forEach(function(el){
      el.style.display = !q || el.textContent.toLowerCase().indexOf(q)>=0 ? '' : 'none';
    });
  });
})();
`.trim();
  }
  return `
(function(){
  var dot=document.getElementById('live-dot');
  function setDot(on){ if(dot) dot.className='live-dot'+(on?' on':''); }
  var input=document.getElementById('feature-filter');
  if(input){
    input.addEventListener('input',function(e){
      var q=e.target.value.trim().toLowerCase();
      document.querySelectorAll('.feature-item').forEach(function(el){
        el.style.display = !q || el.textContent.toLowerCase().indexOf(q)>=0 ? '' : 'none';
      });
    });
  }
  try {
    var es=new EventSource('/events');
    es.addEventListener('open',function(){ setDot(true); });
    es.addEventListener('error',function(){ setDot(false); });
    es.addEventListener('change',function(){ location.reload(); });
    es.addEventListener('reload',function(){ location.reload(); });
    es.addEventListener('heartbeat',function(){ setDot(true); });
  } catch(e){ setDot(false); }
})();
`.trim();
}

function renderHeader(s) {
  const activeFeature = s.session && s.session.activeFeature ? s.session.activeFeature : '(none)';
  const lastScan = (s.featureMap && s.featureMap.lastScan) || s.generatedAt;
  return `
<header class="cap-header">
  <h1>${escapeHtml(s.projectName)} <span class="meta">— cap:ui</span></h1>
  <div class="meta">active feature: ${escapeHtml(activeFeature)} · generated: ${escapeHtml(s.generatedAt)} · last scan: ${escapeHtml(lastScan)}</div>
</header>`.trim();
}

function renderNav() {
  return `
<nav class="cap-nav">
  <span id="live-dot" class="live-dot"></span>
  <a href="#features">Features</a>
  <a href="#design">Design</a>
  <a href="#memory">Memory</a>
  <a href="#threads">Threads</a>
</nav>`.trim();
}

function renderFeaturesSection(featureMap) {
  const features = (featureMap && featureMap.features) || [];
  if (features.length === 0) {
    return `
<main><section class="cap-section" id="features">
  <h2>Features</h2>
  <p class="empty">No features found. Run /cap:brainstorm to create one.</p>
</section>`;
  }
  const items = features.map(renderFeatureItem).join('\n');
  return `
<main><section class="cap-section" id="features">
  <h2>Features (${features.length})</h2>
  <input id="feature-filter" class="filter-input" type="search" placeholder="filter features…" aria-label="Filter features">
  <ul class="feature-list">
${items}
  </ul>
</section>`;
}

function renderFeatureItem(f) {
  const state = (f.state || 'planned').toLowerCase();
  // @cap-risk XSS defence: state is injected into a class attribute. Even though escapeHtml would neutralise
  //   angle brackets, a hostile value like `" onclick=x` could still break out of the attribute. Restrict to
  //   a safe CSS token charset [a-z0-9_-] so the class-based state styling keeps working for legitimate
  //   values (planned|prototyped|tested|shipped) while hostile values degrade to an empty token.
  const stateToken = state.replace(/[^a-z0-9_-]/g, '');
  const deps = (f.dependencies || []).length > 0
    ? `<div class="meta">depends on: ${escapeHtml((f.dependencies || []).join(', '))}</div>`
    : '';
  const usesDesign = (f.usesDesign || []).length > 0
    ? `<div class="meta">uses design: ${escapeHtml((f.usesDesign || []).join(', '))}</div>`
    : '';
  const acs = (f.acs || []).map(function (ac) {
    return `<tr><td>${escapeHtml(ac.id)}</td><td>${escapeHtml(ac.status || 'pending')}</td><td>${escapeHtml(ac.description || '')}</td></tr>`;
  }).join('');
  const acTable = acs
    ? `<table class="ac-table"><thead><tr><th>AC</th><th>Status</th><th>Description</th></tr></thead><tbody>${acs}</tbody></table>`
    : '';
  return `    <li class="feature-item">
      <span class="id">${escapeHtml(f.id)}</span>
      <span class="title">${escapeHtml(f.title || '')}</span>
      <span class="state ${stateToken}">${escapeHtml(state)}</span>
      ${deps}
      ${usesDesign}
      ${acTable}
    </li>`;
}

function renderDesignSection(designMd) {
  if (!designMd) {
    return `
<section class="cap-section" id="design">
  <h2>Design</h2>
  <p class="empty">No DESIGN.md found. Run /cap:design --new.</p>
</section>`;
  }
  return `
<section class="cap-section" id="design">
  <h2>Design (DESIGN.md)</h2>
  <div class="memory-block">${escapeHtml(designMd)}</div>
</section>`;
}

function renderMemorySection(memory) {
  const blocks = ['decisions', 'pitfalls', 'patterns', 'hotspots'].map(function (key) {
    const content = memory[key];
    if (!content) {
      return `<h3>${key}</h3><p class="empty">— none —</p>`;
    }
    return `<h3>${key}</h3><div class="memory-block">${escapeHtml(content)}</div>`;
  }).join('\n');
  return `
<section class="cap-section" id="memory">
  <h2>Memory</h2>
  ${blocks}
</section>`;
}

function renderThreadsSection(threads) {
  if (!threads || threads.length === 0) {
    return `
<section class="cap-section" id="threads">
  <h2>Threads</h2>
  <p class="empty">No threads yet. Run /cap:brainstorm to create one.</p>
</section>`;
  }
  const items = threads.map(function (t) {
    const fids = (t.featureIds && t.featureIds.length > 0) ? t.featureIds.join(', ') : '(no features)';
    const kw = (t.keywords && t.keywords.length > 0) ? t.keywords.slice(0, 6).join(', ') : '';
    return `    <li class="thread-item">
      <span class="ts">${escapeHtml(t.timestamp || '')}</span>
      <strong>${escapeHtml(t.name || t.id)}</strong>
      <span class="meta"> · ${escapeHtml(fids)}${kw ? ' · ' + escapeHtml(kw) : ''}</span>
    </li>`;
  }).join('\n');
  return `
<section class="cap-section" id="threads">
  <h2>Threads (${threads.length})</h2>
  <ul class="thread-list">
${items}
  </ul>
</section></main>`;
}

function renderFooter(live) {
  const mode = live ? 'live (--serve)' : 'static snapshot (--share)';
  return `
<footer class="cap-footer">
  cap:ui v0.1 — read-only view · mode: ${escapeHtml(mode)} · press Ctrl+C to stop.
</footer>`.trim();
}

// @cap-risk HTML escaping is critical — Feature-Map and memory content are developer-authored but may contain markdown symbols or user-controlled strings in multi-user repos. Centralize escaping here.
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- SSE helper ------------------------------------------------------------

// @cap-todo(ac:F-065/AC-3) SSE helper writes text/event-stream headers and provides send() / heartbeat / close handlers.
/**
 * Upgrade an http response to an SSE stream. Returns a controller with send() and close().
 * @param {http.ServerResponse} res
 * @returns {{ send: (event: string, data: any) => boolean, close: () => void }}
 */
function sseResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Initial comment to open the stream immediately on proxied connections.
  res.write(': cap-ui sse open\n\n');

  let closed = false;

  function send(event, data) {
    if (closed) return false;
    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
      return true;
    } catch {
      return false;
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    try { res.end(); } catch { /* ignore */ }
  }
  res.on('close', close);
  res.on('error', close);
  return { send, close };
}

// --- File watcher ----------------------------------------------------------

// @cap-todo(ac:F-065/AC-3) startFileWatcher wraps fs.watch for FEATURE-MAP.md, DESIGN.md, .cap/SESSION.json, .cap/memory/ (recursive).
// @cap-risk fs.watch behaves differently per platform (macOS FSEvents fires once, Linux inotify fires multiple times, Windows is separate). Debounce + best-effort is the right trade-off for a local dev UI.
/**
 * Start a file-watcher across FEATURE-MAP.md, DESIGN.md, .cap/SESSION.json, .cap/memory/.
 * Coalesces bursts into a single onChange call via debounce.
 * @param {Object} params
 * @param {string} params.projectRoot
 * @param {(event: {file: string, type: string}) => void} params.onChange
 * @param {number} [params.debounceMs]
 * @returns {{ stop: () => void }}
 */
function startFileWatcher({ projectRoot, onChange, debounceMs = WATCH_DEBOUNCE_MS }) {
  const watchers = [];
  const pending = new Map(); // path -> Timeout
  let stopped = false;

  function fire(file, type) {
    if (stopped) return;
    const existing = pending.get(file);
    if (existing) clearTimeout(existing);
    const to = setTimeout(function () {
      pending.delete(file);
      try {
        logEvent('info', 'file-change', { file, type });
        onChange({ file, type });
      } catch (err) {
        logEvent('error', 'onChange threw', { error: err && err.message });
      }
    }, debounceMs);
    pending.set(file, to);
  }

  for (const target of WATCH_TARGETS) {
    const abs = path.join(projectRoot, target);
    try {
      // @cap-risk Non-existent paths: we attach a best-effort watcher and silently skip if missing.
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      const isDir = stat.isDirectory();
      const w = fs.watch(abs, { recursive: isDir }, function (eventType, filename) {
        const rel = filename ? path.join(target, String(filename)) : target;
        fire(rel, eventType || 'change');
      });
      watchers.push(w);
    } catch (err) {
      logEvent('warn', 'file-watcher attach failed', { target, error: err && err.message });
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    for (const to of pending.values()) clearTimeout(to);
    pending.clear();
  }

  return { stop };
}

// --- HTTP server -----------------------------------------------------------

// @cap-todo(ac:F-065/AC-1) startServer binds to requested port, auto-increments on EADDRINUSE, returns {url, stop}.
// @cap-todo(ac:F-065/AC-5) Server is read-only: only GET routes are registered. POST/PUT/DELETE return 405 Method Not Allowed.
// @cap-decision(D5) Port conflict handling: auto-increment up to MAX_PORT_ATTEMPTS, then fail loudly. Mirrors how dev servers like Vite behave.
/**
 * Start the CAP-UI HTTP server.
 * @param {Object} params
 * @param {string} params.projectRoot - Absolute path to project root
 * @param {number} [params.port] - Desired port (default DEFAULT_PORT). Use 0 for an OS-assigned port.
 * @param {boolean} [params.watch] - If true, start file watcher and broadcast changes via SSE (default true)
 * @returns {Promise<{ url: string, port: number, stop: () => Promise<void> }>}
 */
function startServer({ projectRoot, port, watch = true }) {
  const desired = (typeof port === 'number') ? port : DEFAULT_PORT;
  const clients = new Set();

  // Broadcast to all SSE clients.
  function broadcast(event, data) {
    for (const c of clients) {
      const ok = c.send(event, data);
      if (!ok) clients.delete(c);
    }
  }

  const server = http.createServer(function (req, res) {
    // @cap-todo(ac:F-065/AC-5) Reject non-GET/HEAD methods — read-only server.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
      res.end('Method Not Allowed — cap:ui is read-only in F-065.');
      return;
    }

    const url = req.url || '/';

    if (url === '/events') {
      const client = sseResponse(res);
      clients.add(client);
      logEvent('info', 'sse-connect', { clients: clients.size });
      // Send one change immediately so clients pick up latest state without waiting.
      client.send('heartbeat', { at: new Date().toISOString() });
      const hb = setInterval(function () {
        if (!client.send('heartbeat', { at: new Date().toISOString() })) {
          clearInterval(hb);
          clients.delete(client);
        }
      }, SSE_HEARTBEAT_MS);
      res.on('close', function () {
        clearInterval(hb);
        clients.delete(client);
        logEvent('info', 'sse-disconnect', { clients: clients.size });
      });
      return;
    }

    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, at: new Date().toISOString() }));
      return;
    }

    if (url === '/' || url === '/index.html') {
      const snapshot = collectProjectSnapshot(projectRoot);
      const html = renderHtml({ snapshot, options: { live: true } });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  let watcherHandle = null;

  return new Promise(function (resolve, reject) {
    let attempt = 0;
    let tryingPort = desired;

    function tryListen() {
      server.once('error', onError);
      server.listen(tryingPort, '127.0.0.1', onListening);
    }
    function onError(err) {
      if (err && err.code === 'EADDRINUSE' && desired !== 0 && attempt < MAX_PORT_ATTEMPTS) {
        attempt += 1;
        logEvent('warn', 'port-in-use', { port: tryingPort, trying: tryingPort + 1 });
        tryingPort += 1;
        // fs server needs a fresh listen attempt; remove listeners and retry.
        server.removeListener('listening', onListening);
        tryListen();
        return;
      }
      reject(err);
    }
    function onListening() {
      server.removeListener('error', onError);
      const addr = server.address();
      const actualPort = (addr && typeof addr === 'object') ? addr.port : tryingPort;
      const url = `http://127.0.0.1:${actualPort}`;
      logEvent('info', 'server-start', { port: actualPort, url });

      if (watch) {
        watcherHandle = startFileWatcher({
          projectRoot,
          onChange: function (evt) { broadcast('change', evt); },
        });
      }

      function stop() {
        return new Promise(function (res2) {
          try { if (watcherHandle) watcherHandle.stop(); } catch { /* ignore */ }
          for (const c of clients) { try { c.close(); } catch { /* ignore */ } }
          clients.clear();
          try {
            server.close(function () { res2(); });
          } catch { res2(); }
        });
      }

      resolve({ url, port: actualPort, stop });
    }

    tryListen();
  });
}

// --- Snapshot (standalone HTML) -------------------------------------------

// @cap-todo(ac:F-065/AC-4) createSnapshot writes a standalone HTML snapshot to .cap/ui/snapshot.html with inline CSS/JS and no external fetch.
// @cap-decision(D2) Snapshot and live server share the same renderHtml() — the only difference is options.live=false (disables SSE client).
/**
 * Generate a standalone HTML snapshot at .cap/ui/snapshot.html (or custom outputPath).
 * Contains inline CSS + JS; no external fetch required.
 * @param {Object} params
 * @param {string} params.projectRoot
 * @param {string} [params.outputPath] - Relative path from projectRoot; default `.cap/ui/snapshot.html`.
 * @returns {{ snapshotPath: string, bytes: number }}
 */
function createSnapshot({ projectRoot, outputPath }) {
  const rel = outputPath || SNAPSHOT_PATH;
  const abs = path.join(projectRoot, rel);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const snapshot = collectProjectSnapshot(projectRoot);
  const html = renderHtml({ snapshot, options: { live: false } });

  fs.writeFileSync(abs, html, 'utf8');
  logEvent('info', 'snapshot-written', { path: rel, bytes: html.length });
  return { snapshotPath: rel, bytes: html.length };
}

// --- Exports ---------------------------------------------------------------

module.exports = {
  // Constants
  DEFAULT_PORT,
  MAX_PORT_ATTEMPTS,
  WATCH_DEBOUNCE_MS,
  WATCH_TARGETS,
  SNAPSHOT_PATH,

  // Core
  startServer,
  renderHtml,
  createSnapshot,
  startFileWatcher,

  // Helpers (exported for testing)
  sseResponse,
  collectProjectSnapshot,
  logEvent,
  escapeHtml,
};
