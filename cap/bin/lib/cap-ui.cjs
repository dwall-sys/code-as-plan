// @cap-context CAP v5 CAP-UI Core — local HTTP server + static snapshot export for Feature-Map, Memory, Threads, DESIGN.md.
// @cap-context CAP v5 F-066 extends this module with a Tag Mind-Map Visualization (SVG + vanilla JS, zero external deps).
// @cap-decision Zero external deps by design. Only node: builtins (http, fs, path, url, os, crypto). No Express, no WebSockets, no React.
// @cap-decision Read-only UI for Feature-Map + Memory + Threads. DESIGN.md edit capability is scoped to F-068. No POST/PUT routes in F-065.
// @cap-decision Server-Sent Events (SSE) over WebSockets — browser-native EventSource handles reconnect, firewalls, and proxies more gracefully.
// @cap-decision HTML rendered via template literals (not DOM builder, not JSX) — zero build step, same code path for --serve and --share.
// @cap-decision CSS + JS embedded inline in every response — required for --share to produce a standalone shareable HTML file.
// @cap-decision(F-066/D1) Mind-Map renders via handrolled SVG + vanilla force-directed layout — NO D3, NO vis.js, NO cytoscape. Keeps zero-deps purity intact at source and require-graph level.
// @cap-decision(F-066/D2) buildCss() and buildClientJs() are split into composable pieces (buildCoreCss + buildMindMapCss, buildCoreJs + buildMindMapJs) so F-067/F-068 can extend without touching the core.
// @cap-constraint All file I/O goes through this module (and the shared lib readers); no direct fs access from command layer for UI state.
// @cap-pattern Renderer is a pure function over data; server and snapshot both call the same renderHtml() so they stay byte-compatible.

'use strict';

// @cap-feature(feature:F-065) CAP-UI Core — local server, renderer, file watcher, snapshot exporter.
// @cap-feature(feature:F-066) Tag Mind-Map Visualization — graph data derivation, deterministic force layout, SVG renderer, inline interaction JS.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const featureMapLib = require('./cap-feature-map.cjs');
const sessionLib = require('./cap-session.cjs');
const threadLib = require('./cap-thread-tracker.cjs');
// @cap-todo(ac:F-066/AC-1) Design IDs come from cap-design.cjs so Mind-Map can classify DT-NNN / DC-NNN nodes when DESIGN.md exists.
const designLib = require('./cap-design.cjs');

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

  // @cap-todo(ac:F-066/AC-2) Parse DT-NNN / DC-NNN IDs out of DESIGN.md so the mind-map can show design-token / design-component nodes.
  // Empty graph is handled gracefully — if no DESIGN.md or no IDs, the design arrays stay empty.
  let designIds = { tokens: [], components: [], byToken: {}, byComponent: {} };
  if (designMd) {
    try { designIds = designLib.parseDesignIds(designMd) || designIds; } catch { /* ignore */ }
  }

  const projectName = detectProjectName(projectRoot);

  return {
    projectName,
    generatedAt: new Date().toISOString(),
    session,
    featureMap,
    threads: threadIndex,
    memory,
    designMd,
    designIds,
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

  // @cap-todo(ac:F-066/AC-5) Mind-Map section is composed into renderHtml so it appears in BOTH the live /-response AND the .cap/ui/snapshot.html output.
  const graphData = buildGraphData({
    featureMap: s.featureMap,
    designTokens: (s.designIds && s.designIds.tokens) || [],
    designComponents: (s.designIds && s.designIds.components) || [],
  });

  const body = [
    renderHeader(s),
    renderNav(),
    renderFeaturesSection(s.featureMap),
    renderDesignSection(s.designMd),
    buildMindMapSection({ graphData }),
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
// @cap-decision(F-066/D2) buildCss composes buildCoreCss + buildMindMapCss (+ future F-067/F-068 contributions). Entry point stays stable for callers.
function buildCss() {
  return [buildCoreCss(), buildMindMapCss()].join('\n');
}

function buildCoreCss() {
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
// @cap-decision(F-066/D2) buildClientJs composes buildCoreJs + buildMindMapJs (+ future F-067/F-068). Both are plain strings joined by a newline.
function buildClientJs({ live }) {
  return [buildCoreJs({ live }), buildMindMapJs()].join('\n');
}

function buildCoreJs({ live }) {
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
  <a href="#mind-map">Mind-Map</a>
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

// --- F-066 Mind-Map Visualization ------------------------------------------

// @cap-decision(F-066/D3) Graph derivation is a pure function over (featureMap, designTokens, designComponents).
//   Input: parsed feature map + design IDs from DESIGN.md. Output: { nodes[], edges[] }. No I/O, no side effects.
//   This makes the graph easy to test without a running server and keeps the renderer downstream.
// @cap-decision(F-066/D4) Edge kinds in v1: `depends_on` (feature -> feature) and `uses-design` (feature -> DT/DC).
//   Feature-AC edges are deferred — would multiply node count by ~5x and clutter the view for limited signal.
//   If a future request demands them, add them behind a graph-option flag.
// @cap-decision(F-066/D5) Nodes are typed as 'feature' | 'token' | 'component'. Classification is structural:
//   feature IDs start with F-, tokens with DT-, components with DC-. No heuristics beyond the ID prefix.

/**
 * @typedef {Object} MindMapNode
 * @property {string} id - Stable identifier (F-001, DT-001, DC-001)
 * @property {'feature'|'token'|'component'} type - Node category
 * @property {string} label - Display label (usually same as id, may include short title for features)
 * @property {string|null} group - Optional grouping key (e.g., feature.metadata.group) for filtering
 * @property {string|null} title - Full title for hover tooltip (feature title)
 * @property {string|null} state - Feature state for coloring ('planned'|'prototyped'|'tested'|'shipped'); null for non-features
 */

/**
 * @typedef {Object} MindMapEdge
 * @property {string} from - Source node id
 * @property {string} to - Target node id
 * @property {'depends_on'|'uses-design'} kind - Edge category
 */

/**
 * @typedef {Object} MindMapGraph
 * @property {MindMapNode[]} nodes
 * @property {MindMapEdge[]} edges
 */

// @cap-todo(ac:F-066/AC-1) Derive a graph of all @cap-* tag categories (features + design tokens + design components) from parsed state.
// @cap-todo(ac:F-066/AC-2) Node types: feature/token/component. Edge kinds: depends_on, uses-design.
/**
 * Pure function: derive mind-map graph from feature map + design IDs.
 * Edges are only emitted when BOTH endpoints exist as nodes — this prevents dangling
 * references (e.g. a feature.dependencies entry pointing to a feature that was deleted).
 * @param {{ featureMap: {features: Array<Object>}, designTokens?: string[], designComponents?: string[] }} params
 * @returns {MindMapGraph}
 */
function buildGraphData(params) {
  const features = (params && params.featureMap && Array.isArray(params.featureMap.features))
    ? params.featureMap.features
    : [];
  const designTokens = (params && Array.isArray(params.designTokens)) ? params.designTokens : [];
  const designComponents = (params && Array.isArray(params.designComponents)) ? params.designComponents : [];

  /** @type {MindMapNode[]} */
  const nodes = [];
  const nodeIds = new Set();

  // Features first, stable order.
  for (const f of features) {
    if (!f || !f.id || nodeIds.has(f.id)) continue;
    nodes.push({
      id: f.id,
      type: 'feature',
      label: f.id,
      group: (f.metadata && f.metadata.group) ? String(f.metadata.group) : null,
      title: f.title || null,
      state: f.state || 'planned',
    });
    nodeIds.add(f.id);
  }

  // Design tokens (deduped, stable order via sort for determinism across calls with permuted inputs).
  const sortedTokens = [...new Set(designTokens)].sort();
  for (const id of sortedTokens) {
    if (nodeIds.has(id)) continue;
    nodes.push({ id, type: 'token', label: id, group: 'design', title: null, state: null });
    nodeIds.add(id);
  }

  // Design components.
  const sortedComponents = [...new Set(designComponents)].sort();
  for (const id of sortedComponents) {
    if (nodeIds.has(id)) continue;
    nodes.push({ id, type: 'component', label: id, group: 'design', title: null, state: null });
    nodeIds.add(id);
  }

  /** @type {MindMapEdge[]} */
  const edges = [];
  const seenEdges = new Set();
  function addEdge(from, to, kind) {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    if (from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, kind });
  }

  for (const f of features) {
    if (!f || !f.id) continue;
    for (const dep of (f.dependencies || [])) {
      addEdge(f.id, String(dep).trim(), 'depends_on');
    }
    for (const du of (f.usesDesign || [])) {
      addEdge(f.id, String(du).trim(), 'uses-design');
    }
  }

  return { nodes, edges };
}

// @cap-decision(F-066/D6) Seeded RNG: 32-bit mulberry-style from a stable string hash. Guarantees byte-identical
//   SVG output for byte-identical input — required for F-062 determinism pattern and AC-5 snapshot stability.
/**
 * @param {string} str
 * @returns {number} - 32-bit unsigned integer hash
 */
function hashString32(str) {
  let h = 2166136261 >>> 0; // FNV-1a seed
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// @cap-todo(ac:F-066/AC-3) Handroll a deterministic force-directed layout — NO D3, NO runtime require of any external lib.
// @cap-decision(F-066/D7) Simple repulsion + spring attraction, Euler integration, damping. ~150-250 iterations converge for ≤200 nodes.
// @cap-risk Quadratic repulsion loop (O(N^2)) is fine for CAP-scale (~60-120 nodes). If the graph ever exceeds 500
//   nodes, introduce spatial hashing / Barnes-Hut. For now, complexity is traded for code simplicity.
/**
 * Run a deterministic force-directed layout. Same input -> same (x,y) for every node.
 * @param {MindMapNode[]} nodes - Input nodes (copied — not mutated)
 * @param {MindMapEdge[]} edges
 * @param {{ width?: number, height?: number, iterations?: number, seed?: string }} [options]
 * @returns {Array<MindMapNode & {x:number, y:number}>}
 */
function runForceLayout(nodes, edges, options) {
  const opts = options || {};
  const width = typeof opts.width === 'number' ? opts.width : 800;
  const height = typeof opts.height === 'number' ? opts.height : 600;
  const iterations = typeof opts.iterations === 'number' ? opts.iterations : 200;
  // Seed the RNG from a stable hash of the node IDs so layout is reproducible.
  const seedSource = opts.seed || nodes.map(n => n.id).sort().join(',') || 'empty';
  const rand = mulberry32(hashString32(seedSource));

  const N = nodes.length;
  if (N === 0) return [];

  // Initial positions — pseudo-random inside the viewbox using the seeded RNG.
  const positions = new Array(N);
  const velocities = new Array(N);
  const indexById = new Map();
  for (let i = 0; i < N; i++) {
    indexById.set(nodes[i].id, i);
    positions[i] = { x: rand() * width, y: rand() * height };
    velocities[i] = { x: 0, y: 0 };
  }

  // Tuning constants — empirically okay for ~10-200 nodes at 800x600.
  const REPULSION = 12000;   // node-node push strength
  const SPRING = 0.02;       // edge pull strength
  const REST_LEN = 90;       // preferred edge length in pixels
  const DAMPING = 0.82;      // velocity decay per step
  const MAX_STEP = 20;       // clamp per-iteration displacement

  // Build quick-lookup of adjacency.
  /** @type {Array<Array<number>>} */
  const adjacency = new Array(N).fill(null).map(() => []);
  for (const e of edges) {
    const a = indexById.get(e.from);
    const b = indexById.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Array(N);
    for (let i = 0; i < N; i++) forces[i] = { x: 0, y: 0 };

    // Repulsion: O(N^2). Fine for CAP-scale graphs.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 0.01) dist2 = 0.01;
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[i].x += fx; forces[i].y += fy;
        forces[j].x -= fx; forces[j].y -= fy;
      }
    }

    // Spring attraction along edges.
    for (let i = 0; i < N; i++) {
      for (const j of adjacency[i]) {
        if (j <= i) continue; // apply once per pair
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const disp = dist - REST_LEN;
        const fx = (dx / dist) * disp * SPRING;
        const fy = (dy / dist) * disp * SPRING;
        forces[i].x += fx; forces[i].y += fy;
        forces[j].x -= fx; forces[j].y -= fy;
      }
    }

    // Weak centering pull so disconnected components stay on-canvas.
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < N; i++) {
      forces[i].x += (cx - positions[i].x) * 0.0015;
      forces[i].y += (cy - positions[i].y) * 0.0015;
    }

    // Integrate.
    for (let i = 0; i < N; i++) {
      velocities[i].x = (velocities[i].x + forces[i].x) * DAMPING;
      velocities[i].y = (velocities[i].y + forces[i].y) * DAMPING;
      let dx = velocities[i].x;
      let dy = velocities[i].y;
      // Clamp per-step displacement to avoid explosion.
      if (dx > MAX_STEP) dx = MAX_STEP; else if (dx < -MAX_STEP) dx = -MAX_STEP;
      if (dy > MAX_STEP) dy = MAX_STEP; else if (dy < -MAX_STEP) dy = -MAX_STEP;
      positions[i].x += dx;
      positions[i].y += dy;
    }
  }

  // Scale positions into the viewbox with a margin so nodes/labels fit.
  const MARGIN = 40;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const innerW = Math.max(1, width - 2 * MARGIN);
  const innerH = Math.max(1, height - 2 * MARGIN);

  const result = new Array(N);
  for (let i = 0; i < N; i++) {
    const nx = MARGIN + ((positions[i].x - minX) / spanX) * innerW;
    const ny = MARGIN + ((positions[i].y - minY) / spanY) * innerH;
    // Round to 2 decimal places so tiny floating-point jitter across Node versions does not break snapshot byte-identity.
    result[i] = Object.assign({}, nodes[i], {
      x: Math.round(nx * 100) / 100,
      y: Math.round(ny * 100) / 100,
    });
  }
  return result;
}

// @cap-todo(ac:F-066/AC-3) Render the mind-map as SVG. Pure string output, no DOM APIs needed.
// @cap-decision(F-066/D8) Edges rendered first, then nodes on top — standard z-ordering for graphs.
/**
 * Render the SVG markup for the mind-map.
 * @param {Array<MindMapNode & {x:number,y:number}>} layoutedNodes
 * @param {MindMapEdge[]} edges
 * @param {{ width?: number, height?: number }} [options]
 * @returns {string} SVG markup
 */
function renderMindMapSvg(layoutedNodes, edges, options) {
  const opts = options || {};
  const width = typeof opts.width === 'number' ? opts.width : 800;
  const height = typeof opts.height === 'number' ? opts.height : 600;

  if (!Array.isArray(layoutedNodes) || layoutedNodes.length === 0) {
    return `<svg class="mind-map" id="cap-mind-map" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="CAP Mind-Map (empty)"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="mind-map-empty">No features to visualize yet.</text></svg>`;
  }

  const byId = new Map();
  for (const n of layoutedNodes) byId.set(n.id, n);

  const edgeParts = [];
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const cls = e.kind === 'uses-design' ? 'edge edge-uses-design' : 'edge edge-depends';
    edgeParts.push(
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}" data-from="${escapeHtml(e.from)}" data-to="${escapeHtml(e.to)}" data-kind="${escapeHtml(e.kind)}" />`
    );
  }

  const nodeParts = [];
  for (const n of layoutedNodes) {
    const r = n.type === 'feature' ? 20 : (n.type === 'component' ? 14 : 12);
    const stateClass = n.type === 'feature' ? ` node-state-${escapeHtml((n.state || 'planned').replace(/[^a-z0-9_-]/gi, ''))}` : '';
    const cls = `node node-${n.type}${stateClass}`;
    const group = n.group ? ` data-group="${escapeHtml(n.group)}"` : '';
    const titleAttr = n.title ? ` data-title="${escapeHtml(n.title)}"` : '';
    // SVG <title> child gives a native tooltip.
    const titleChild = n.title ? `<title>${escapeHtml(n.id)} — ${escapeHtml(n.title)}</title>` : `<title>${escapeHtml(n.id)}</title>`;
    nodeParts.push(
      `<g class="${cls}" data-id="${escapeHtml(n.id)}"${group}${titleAttr}>` +
      `${titleChild}` +
      `<circle cx="${n.x}" cy="${n.y}" r="${r}" />` +
      `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" class="node-label">${escapeHtml(n.label)}</text>` +
      `</g>`
    );
  }

  return [
    `<svg class="mind-map" id="cap-mind-map" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="CAP Mind-Map">`,
    `<g class="edges">`,
    edgeParts.join(''),
    `</g>`,
    `<g class="nodes">`,
    nodeParts.join(''),
    `</g>`,
    `</svg>`,
  ].join('');
}

// @cap-todo(ac:F-066/AC-1) Mind-Map HTML section — wraps SVG with a toolbar (filter checkboxes + legend) and a help hint.
// @cap-todo(ac:F-066/AC-4) Filter UI: one checkbox per distinct group; toggling hides nodes/edges whose group is unchecked.
/**
 * Build the HTML section for the mind-map. Includes SVG + interaction scaffolding.
 * @param {{ graphData: MindMapGraph, options?: { width?: number, height?: number } }} params
 * @returns {string} HTML section markup
 */
function buildMindMapSection(params) {
  const graphData = (params && params.graphData) || { nodes: [], edges: [] };
  const opts = (params && params.options) || {};
  const width = typeof opts.width === 'number' ? opts.width : 800;
  const height = typeof opts.height === 'number' ? opts.height : 600;

  const layouted = runForceLayout(graphData.nodes, graphData.edges, { width, height });
  const svg = renderMindMapSvg(layouted, graphData.edges, { width, height });

  // Collect unique groups present in the graph for filter UI.
  const groupSet = new Set();
  for (const n of graphData.nodes) {
    if (n.group) groupSet.add(n.group);
  }
  // Always include a synthetic bucket for ungrouped feature nodes so users can toggle them.
  const groups = Array.from(groupSet).sort();
  const hasUngrouped = graphData.nodes.some(n => !n.group);

  const groupCheckboxes = groups.map(function (g) {
    return `<label class="mm-filter"><input type="checkbox" class="mm-filter-input" data-filter-group="${escapeHtml(g)}" checked> ${escapeHtml(g)}</label>`;
  }).join('\n    ');
  const ungroupedCheckbox = hasUngrouped
    ? `<label class="mm-filter"><input type="checkbox" class="mm-filter-input" data-filter-group="__ungrouped__" checked> (ungrouped)</label>`
    : '';

  const nodeCount = graphData.nodes.length;
  const edgeCount = graphData.edges.length;
  const featureCount = graphData.nodes.filter(n => n.type === 'feature').length;
  const tokenCount = graphData.nodes.filter(n => n.type === 'token').length;
  const componentCount = graphData.nodes.filter(n => n.type === 'component').length;

  return `
<section class="cap-section" id="mind-map">
  <h2>Mind-Map</h2>
  <div class="mm-meta">${nodeCount} nodes (${featureCount} features, ${tokenCount} tokens, ${componentCount} components) · ${edgeCount} edges</div>
  <div class="mm-toolbar">
    <div class="mm-legend">
      <span class="mm-swatch mm-sw-feature"></span> feature
      <span class="mm-swatch mm-sw-token"></span> token
      <span class="mm-swatch mm-sw-component"></span> component
      <span class="mm-edge-sample mm-edge-depends"></span> depends_on
      <span class="mm-edge-sample mm-edge-uses-design"></span> uses-design
    </div>
    <div class="mm-filters">
    ${groupCheckboxes}
    ${ungroupedCheckbox}
    </div>
    <div class="mm-hint">wheel: zoom · drag: pan · click node: focus · click empty: reset</div>
  </div>
  <div class="mm-viewport" id="mm-viewport">
    ${svg}
  </div>
</section>`;
}

// @cap-todo(ac:F-066/AC-3) Mind-Map CSS is its own string composed into buildCss(). Anti-Slop: warm neutrals + terracotta accent, no gradients.
function buildMindMapCss() {
  return `
section.cap-section#mind-map { max-width: 100%; }
.mm-meta {
  color: var(--fg-muted);
  font-size: 12px;
  margin-bottom: 6px;
}
.mm-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: center;
  padding: 8px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 3px;
  margin-bottom: 8px;
  font-size: 12px;
}
.mm-legend, .mm-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  color: var(--fg-muted);
}
.mm-filter { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.mm-filter-input { margin: 0; }
.mm-hint { color: var(--fg-muted); font-size: 11px; margin-left: auto; }
.mm-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 2px;
}
.mm-sw-feature   { background: var(--accent); }
.mm-sw-token     { background: var(--accent-muted); }
.mm-sw-component { background: var(--state-prototyped); }
.mm-edge-sample {
  display: inline-block;
  width: 20px;
  height: 0;
  border-top: 1.5px solid var(--fg-muted);
  vertical-align: middle;
  margin: 0 2px;
}
.mm-edge-sample.mm-edge-depends { border-top-style: solid; border-top-color: var(--fg-muted); }
.mm-edge-sample.mm-edge-uses-design { border-top-style: dashed; border-top-color: var(--accent); }
.mm-viewport {
  border: 1px solid var(--border);
  background: var(--bg-card);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
  touch-action: none;
}
svg.mind-map {
  display: block;
  width: 100%;
  height: 600px;
  cursor: grab;
  user-select: none;
}
svg.mind-map:active { cursor: grabbing; }
svg.mind-map text.mind-map-empty {
  fill: var(--fg-muted);
  font-family: var(--mono);
  font-size: 13px;
}
svg.mind-map g.edges line {
  stroke: var(--fg-muted);
  stroke-width: 1;
  stroke-opacity: 0.45;
}
svg.mind-map g.edges line.edge-uses-design {
  stroke: var(--accent);
  stroke-dasharray: 4 3;
  stroke-opacity: 0.7;
}
svg.mind-map g.nodes g.node { cursor: pointer; transition: transform 120ms ease; transform-origin: center; transform-box: fill-box; }
svg.mind-map g.nodes g.node text.node-label {
  fill: var(--fg);
  font-family: var(--mono);
  font-size: 10px;
  pointer-events: none;
}
svg.mind-map g.nodes g.node circle {
  stroke: var(--border);
  stroke-width: 1.5;
}
svg.mind-map g.nodes g.node-feature circle { fill: var(--accent); }
svg.mind-map g.nodes g.node-feature text.node-label { fill: var(--bg); font-weight: 600; }
svg.mind-map g.nodes g.node-feature.node-state-planned    circle { fill: var(--state-planned); }
svg.mind-map g.nodes g.node-feature.node-state-prototyped circle { fill: var(--state-prototyped); }
svg.mind-map g.nodes g.node-feature.node-state-tested     circle { fill: var(--state-tested); }
svg.mind-map g.nodes g.node-feature.node-state-shipped    circle { fill: var(--state-shipped); }
svg.mind-map g.nodes g.node-token circle     { fill: var(--accent-muted); }
svg.mind-map g.nodes g.node-component circle { fill: #d8c49b; }
svg.mind-map g.nodes g.node:hover circle { stroke: var(--accent); stroke-width: 2; }
svg.mind-map g.nodes g.node.mm-dim { opacity: 0.15; }
svg.mind-map g.edges line.mm-dim { opacity: 0.08; }
svg.mind-map g.nodes g.node.mm-focused circle { stroke: var(--accent); stroke-width: 3; }
svg.mind-map g.nodes g.node.mm-neighbour circle { stroke: var(--accent-muted); stroke-width: 2.5; }
svg.mind-map g.nodes g.node.mm-hidden, svg.mind-map g.edges line.mm-hidden { display: none; }
`.trim();
}

// @cap-todo(ac:F-066/AC-4) Mind-Map client JS: zoom (wheel), pan (drag), filter (checkboxes), hover (CSS :hover), click-to-focus (neighbour highlight).
// @cap-decision(F-066/D9) Interaction via viewBox manipulation — no transforms on the SVG itself. Keeps coordinates portable across browsers.
// @cap-decision(F-066/D10) Vanilla JS, IIFE, no external libs, no ES modules. Same code path for --serve and --share.
function buildMindMapJs() {
  return `
(function(){
  var svg = document.getElementById('cap-mind-map');
  if (!svg) return;
  var viewport = document.getElementById('mm-viewport');

  // --- Zoom + Pan via viewBox ---------------------------------------------
  var vb = { x: 0, y: 0, w: 800, h: 600 };
  var vbAttr = svg.getAttribute('viewBox');
  if (vbAttr) {
    var parts = vbAttr.split(/\\s+/).map(function(p){ return parseFloat(p); });
    if (parts.length === 4 && parts.every(function(n){ return !isNaN(n); })) {
      vb.x = parts[0]; vb.y = parts[1]; vb.w = parts[2]; vb.h = parts[3];
    }
  }
  var baseW = vb.w, baseH = vb.h;
  function applyViewBox() {
    svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  }

  svg.addEventListener('wheel', function(e){
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var mx = vb.x + (e.clientX - rect.left) / rect.width * vb.w;
    var my = vb.y + (e.clientY - rect.top) / rect.height * vb.h;
    var factor = e.deltaY > 0 ? 1.1 : 0.9;
    var nextW = vb.w * factor;
    var nextH = vb.h * factor;
    // Clamp to 0.25x..4x of original viewBox.
    if (nextW < baseW * 0.25 || nextW > baseW * 4) return;
    vb.x = mx - (mx - vb.x) * factor;
    vb.y = my - (my - vb.y) * factor;
    vb.w = nextW;
    vb.h = nextH;
    applyViewBox();
  }, { passive: false });

  var panning = false;
  var panStart = null;
  svg.addEventListener('mousedown', function(e){
    if (e.button !== 0) return;
    // Don't start panning when the click lands on a node — nodes handle their own click.
    var targetNode = e.target && e.target.closest ? e.target.closest('g.node') : null;
    if (targetNode) return;
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, vbx: vb.x, vby: vb.y };
  });
  window.addEventListener('mousemove', function(e){
    if (!panning || !panStart) return;
    var rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var dx = (e.clientX - panStart.x) / rect.width * vb.w;
    var dy = (e.clientY - panStart.y) / rect.height * vb.h;
    vb.x = panStart.vbx - dx;
    vb.y = panStart.vby - dy;
    applyViewBox();
  });
  window.addEventListener('mouseup', function(){ panning = false; panStart = null; });

  // --- Filter by group ----------------------------------------------------
  function activeGroups() {
    var boxes = document.querySelectorAll('.mm-filter-input');
    var active = new Set();
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) active.add(boxes[i].getAttribute('data-filter-group'));
    }
    return active;
  }
  function applyFilters() {
    var active = activeGroups();
    var nodes = svg.querySelectorAll('g.nodes > g.node');
    var hiddenIds = new Set();
    for (var i = 0; i < nodes.length; i++) {
      var g = nodes[i].getAttribute('data-group');
      var key = g ? g : '__ungrouped__';
      if (!active.has(key)) {
        nodes[i].classList.add('mm-hidden');
        hiddenIds.add(nodes[i].getAttribute('data-id'));
      } else {
        nodes[i].classList.remove('mm-hidden');
      }
    }
    var edges = svg.querySelectorAll('g.edges > line');
    for (var j = 0; j < edges.length; j++) {
      var from = edges[j].getAttribute('data-from');
      var to = edges[j].getAttribute('data-to');
      if (hiddenIds.has(from) || hiddenIds.has(to)) {
        edges[j].classList.add('mm-hidden');
      } else {
        edges[j].classList.remove('mm-hidden');
      }
    }
  }
  var filterBoxes = document.querySelectorAll('.mm-filter-input');
  for (var f = 0; f < filterBoxes.length; f++) {
    filterBoxes[f].addEventListener('change', applyFilters);
  }

  // --- Click-to-Focus -----------------------------------------------------
  function clearFocus() {
    var dimmed = svg.querySelectorAll('.mm-dim, .mm-focused, .mm-neighbour');
    for (var i = 0; i < dimmed.length; i++) {
      dimmed[i].classList.remove('mm-dim');
      dimmed[i].classList.remove('mm-focused');
      dimmed[i].classList.remove('mm-neighbour');
    }
  }
  function focusNode(id) {
    if (!id) return;
    clearFocus();
    var neighbours = new Set();
    neighbours.add(id);
    var edges = svg.querySelectorAll('g.edges > line');
    for (var i = 0; i < edges.length; i++) {
      var from = edges[i].getAttribute('data-from');
      var to = edges[i].getAttribute('data-to');
      if (from === id) neighbours.add(to);
      else if (to === id) neighbours.add(from);
    }
    var nodes = svg.querySelectorAll('g.nodes > g.node');
    for (var j = 0; j < nodes.length; j++) {
      var nid = nodes[j].getAttribute('data-id');
      if (nid === id) nodes[j].classList.add('mm-focused');
      else if (neighbours.has(nid)) nodes[j].classList.add('mm-neighbour');
      else nodes[j].classList.add('mm-dim');
    }
    for (var k = 0; k < edges.length; k++) {
      var fromE = edges[k].getAttribute('data-from');
      var toE = edges[k].getAttribute('data-to');
      if (fromE === id || toE === id) {
        // edge stays at default opacity
      } else {
        edges[k].classList.add('mm-dim');
      }
    }
  }
  svg.addEventListener('click', function(e){
    var node = e.target && e.target.closest ? e.target.closest('g.node') : null;
    if (node) {
      focusNode(node.getAttribute('data-id'));
    } else {
      clearFocus();
    }
  });
})();
`.trim();
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

  // F-066 Mind-Map
  buildGraphData,
  runForceLayout,
  renderMindMapSvg,
  buildMindMapSection,
  buildMindMapCss,
  buildMindMapJs,
  buildCoreCss,
  buildCoreJs,
  buildCss,
  buildClientJs,
};
