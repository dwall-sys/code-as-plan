// @cap-context CAP v5 CAP-UI Core — local HTTP server + static snapshot export for Feature-Map, Memory, Threads, DESIGN.md.
// @cap-context CAP v5 F-066 composes a Tag Mind-Map Visualization (SVG + vanilla JS, zero external deps) — extracted to cap-ui-mind-map.cjs.
// @cap-context CAP v5 F-067 composes a Thread + Cluster Navigator (thread browser, detail view, cluster visualization, keyword overlap, drift warnings, keyboard nav) — extracted to cap-ui-thread-nav.cjs.
// @cap-context CAP v5 F-068 adds a Visual Design Editor (DESIGN.md-only edits) — implemented in cap-ui-design-editor.cjs; this file wires it into the HTTP server and renderer when --editable is set.
// @cap-decision Zero external deps by design. Only node: builtins (http, fs, path, url, os, crypto). No Express, no WebSockets, no React.
// @cap-decision Read-only UI for Feature-Map + Memory + Threads is the DEFAULT. DESIGN.md edit capability requires an explicit `editable: true` flag (F-068/AC-1 + AC-6).
// @cap-decision Server-Sent Events (SSE) over WebSockets — browser-native EventSource handles reconnect, firewalls, and proxies more gracefully.
// @cap-decision HTML rendered via template literals (not DOM builder, not JSX) — zero build step, same code path for --serve and --share.
// @cap-decision CSS + JS embedded inline in every response — required for --share to produce a standalone shareable HTML file.
// @cap-decision(F-068/refactor) The request handler now uses a per-route method dispatch table.
//   GET-only routes keep their 405-on-non-GET behaviour (F-065/AC-5 invariant). Edit routes accept PUT/DELETE
//   ONLY when the server was started with `editable: true`. FEATURE-MAP / MEMORY paths ALWAYS 405 on writes (AC-6).
// @cap-decision(F-068/split) F-066 / F-067 helpers live in their own modules and are re-exported here so existing tests
//   (cap-ui.test.cjs, cap-ui-adversarial.test.cjs, cap-ui-mind-map.test.cjs, cap-ui-thread-nav.test.cjs) keep working unchanged.
// @cap-constraint All file I/O goes through this module (and the shared lib readers); no direct fs access from command layer for UI state.
// @cap-pattern Renderer is a pure function over data; server and snapshot both call the same renderHtml() so they stay byte-compatible.

'use strict';

// @cap-feature(feature:F-065) CAP-UI Core — local server, renderer, file watcher, snapshot exporter.
// @cap-feature(feature:F-066) Tag Mind-Map Visualization — graph data derivation, deterministic force layout, SVG renderer, inline interaction JS. (impl: cap-ui-mind-map.cjs)
// @cap-feature(feature:F-067) Thread + Cluster Navigator — thread browser, detail view, cluster list, keyword overlap, drift warnings, keyboard nav. (impl: cap-ui-thread-nav.cjs)
// @cap-feature(feature:F-068) Visual Design Editor — DESIGN.md-only edit surface, atomic writes, path-traversal guard. (impl: cap-ui-design-editor.cjs)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const featureMapLib = require('./cap-feature-map.cjs');
const sessionLib = require('./cap-session.cjs');
const threadLib = require('./cap-thread-tracker.cjs');
// @cap-todo(ac:F-066/AC-1) Design IDs come from cap-design.cjs so Mind-Map can classify DT-NNN / DC-NNN nodes when DESIGN.md exists.
const designLib = require('./cap-design.cjs');
// @cap-todo(ac:F-067/AC-3) Cluster + affinity data comes from cap-cluster-io.cjs so the Thread-Nav can visualize neural clusters + drift.
// @cap-risk Loading the full cluster pipeline on every HTTP request is the same O(threads²) cost paid by /cap:status; for CAP-scale (<500 threads) acceptable.
//   If this becomes a hot-path bottleneck, cache the result keyed on graph.json mtime.
const clusterIo = require('./cap-cluster-io.cjs');

// F-066 mind-map lives in its own module (extracted for F-068 hand-off).
const mindMapLib = require('./cap-ui-mind-map.cjs');
// F-067 thread-nav lives in its own module (extracted for F-068 hand-off).
const threadNavLib = require('./cap-ui-thread-nav.cjs');
// F-068 design editor (DESIGN.md-only write surface).
const designEditorLib = require('./cap-ui-design-editor.cjs');

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
 * @property {Object[]} threads - Thread index entries from cap-thread-tracker.cjs (lightweight list for the top-level view)
 * @property {Object[]} fullThreads - Full Thread objects (problemStatement, solutionShape, boundaryDecisions, featureIds, keywords, parent)
 * @property {Object[]} clusters - Detected clusters from cap-cluster-io (id, label, members, drift)
 * @property {Object[]} affinityResults - Pairwise affinity results (sourceThreadId, targetThreadId, compositeScore)
 * @property {Object} clusterGraph - Memory graph (nodes/edges) used for drift computation
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

  // @cap-todo(ac:F-067/AC-1) Load full thread objects (problemStatement, solutionShape, boundaryDecisions, keywords, parent) for the navigator detail view.
  // @cap-risk(feature:F-067) If the per-thread file is missing (index referenced an id but the thread file was never written,
  //   or was deleted), we degrade gracefully by promoting the index entry to a thread stub. Detail fields stay empty, but the
  //   thread still appears in the list. This keeps F-065 tests (which seed only the index) green.
  const fullThreads = safeCall(() => {
    const out = [];
    for (const entry of threadIndex) {
      const t = threadLib.loadThread(projectRoot, entry.id);
      if (t) {
        out.push(t);
      } else if (entry && entry.id) {
        out.push({
          id: entry.id,
          name: entry.name || entry.id,
          timestamp: entry.timestamp || '',
          featureIds: Array.isArray(entry.featureIds) ? entry.featureIds : [],
          keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
          parentThreadId: entry.parentThreadId || null,
          problemStatement: '',
          solutionShape: '',
          boundaryDecisions: [],
        });
      }
    }
    return out;
  }, []);

  // @cap-todo(ac:F-067/AC-3) Load cluster + affinity data via cap-cluster-io so the navigator can visualize neural clusters.
  // @cap-risk(feature:F-067) Fresh project with no .cap/memory/graph.json: cluster-io already handles this gracefully
  //   (returns empty clusters array); safeCall is a belt-and-suspenders fallback.
  const clusterBundle = safeCall(
    () => clusterIo._loadClusterData(projectRoot),
    { clusters: [], graph: { nodes: {}, edges: [] }, affinityResults: [], threads: [] }
  );

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
    fullThreads,
    clusters: clusterBundle.clusters || [],
    affinityResults: clusterBundle.affinityResults || [],
    clusterGraph: clusterBundle.graph || { nodes: {}, edges: [] },
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
 * @param {boolean} [params.options.editable] - If true, include the F-068 DESIGN.md editor UI + JS.
 * @returns {string} Full HTML document
 */
function renderHtml({ snapshot, options = {} }) {
  const live = options.live === true;
  const editable = options.editable === true;
  const s = snapshot;

  const css = buildCss({ editable });
  const js = buildClientJs({ live, editable });

  // @cap-todo(ac:F-066/AC-5) Mind-Map section is composed into renderHtml so it appears in BOTH the live /-response AND the .cap/ui/snapshot.html output.
  const graphData = mindMapLib.buildGraphData({
    featureMap: s.featureMap,
    designTokens: (s.designIds && s.designIds.tokens) || [],
    designComponents: (s.designIds && s.designIds.components) || [],
  });

  // @cap-todo(ac:F-067/AC-1) Thread-Nav section is composed into renderHtml so it appears in --serve AND --share output.
  const threadData = threadNavLib.buildThreadData({
    threads: s.fullThreads || [],
    clusters: s.clusters || [],
    affinity: s.affinityResults || [],
    graph: s.clusterGraph || { nodes: {}, edges: [] },
  });

  // @cap-todo(ac:F-068/AC-1) Design editor section rendered ONLY when editable=true. Empty string otherwise.
  const editorSection = designEditorLib.buildEditorSection({
    designMd: s.designMd,
    designData: s.designIds,
    editable,
  });

  const body = [
    renderHeader(s, editable),
    renderNav(editable),
    renderFeaturesSection(s.featureMap),
    renderDesignSection(s.designMd),
    editorSection,
    mindMapLib.buildMindMapSection({ graphData }),
    renderMemorySection(s.memory),
    threadNavLib.buildThreadNavSection({ threadData }),
    renderFooter(live, editable),
  ].filter(Boolean).join('\n');

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
// @cap-decision(F-066/D2) buildCss composes buildCoreCss + mindMapLib.buildMindMapCss + threadNavLib.buildThreadNavCss (+ F-068 editor CSS when editable).
// @cap-todo(ac:F-068/AC-1) Editor CSS opts in only when `editable` is true — read-only snapshot HTML stays lean for F-065/AC-4 size checks.
function buildCss(opts) {
  const editable = !!(opts && opts.editable);
  const parts = [buildCoreCss(), mindMapLib.buildMindMapCss(), threadNavLib.buildThreadNavCss()];
  if (editable) parts.push(designEditorLib.buildEditorCss());
  return parts.join('\n');
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
header.cap-header .editable-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  background: var(--accent);
  color: var(--bg);
  font-size: 10px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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
// @cap-decision(F-066/D2) buildClientJs composes buildCoreJs + mindMapLib.buildMindMapJs + threadNavLib.buildThreadNavJs (+ F-068 editor JS when editable).
function buildClientJs(opts) {
  const live = !!(opts && opts.live);
  const editable = !!(opts && opts.editable);
  const parts = [buildCoreJs({ live }), mindMapLib.buildMindMapJs(), threadNavLib.buildThreadNavJs()];
  if (editable) parts.push(designEditorLib.buildEditorJs());
  return parts.join('\n');
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

function renderHeader(s, editable) {
  const activeFeature = s.session && s.session.activeFeature ? s.session.activeFeature : '(none)';
  const lastScan = (s.featureMap && s.featureMap.lastScan) || s.generatedAt;
  const badge = editable ? ' <span class="editable-badge">editable</span>' : '';
  return `
<header class="cap-header">
  <h1>${escapeHtml(s.projectName)} <span class="meta">— cap:ui</span>${badge}</h1>
  <div class="meta">active feature: ${escapeHtml(activeFeature)} · generated: ${escapeHtml(s.generatedAt)} · last scan: ${escapeHtml(lastScan)}</div>
</header>`.trim();
}

function renderNav(editable) {
  const editorLink = editable ? '\n  <a href="#design-editor">Design Editor</a>' : '';
  return `
<nav class="cap-nav">
  <span id="live-dot" class="live-dot"></span>
  <a href="#features">Features</a>
  <a href="#design">Design</a>${editorLink}
  <a href="#mind-map">Mind-Map</a>
  <a href="#memory">Memory</a>
  <a href="#threads">Threads</a>
  <a href="#clusters">Clusters</a>
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

// @cap-decision(F-067) The old flat renderThreadsSection is superseded by buildThreadNavSection (F-067).
//   The new section owns the closing </main> tag (previously emitted here) so the HTML document stays well-formed.

function renderFooter(live, editable) {
  const mode = live ? 'live (--serve)' : 'static snapshot (--share)';
  const edit = editable ? ' · edit mode: DESIGN.md only (FEATURE-MAP + Memory stay read-only)' : '';
  return `
<footer class="cap-footer">
  cap:ui v0.1 — ${editable ? 'EDIT MODE' : 'read-only view'} · mode: ${escapeHtml(mode)}${edit} · press Ctrl+C to stop.
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
// @cap-todo(ac:F-065/AC-5) Default server is read-only: only GET routes are registered. POST/PUT/DELETE return 405 Method Not Allowed.
// @cap-todo(ac:F-068/AC-1) When `editable: true`, the server also accepts PUT/DELETE on `/api/design/*` paths.
// @cap-todo(ac:F-068/AC-6) `/api/feature-map/*` and `/api/memory/*` paths ALWAYS 405 on writes — edit mode never unlocks them.
// @cap-decision(D5) Port conflict handling: auto-increment up to MAX_PORT_ATTEMPTS, then fail loudly. Mirrors how dev servers like Vite behave.
/**
 * Start the CAP-UI HTTP server.
 * @param {Object} params
 * @param {string} params.projectRoot - Absolute path to project root
 * @param {number} [params.port] - Desired port (default DEFAULT_PORT). Use 0 for an OS-assigned port.
 * @param {boolean} [params.watch] - If true, start file watcher and broadcast changes via SSE (default true)
 * @param {boolean} [params.editable] - If true, enable DESIGN.md edit endpoints (F-068). Default false.
 * @returns {Promise<{ url: string, port: number, stop: () => Promise<void> }>}
 */
function startServer({ projectRoot, port, watch = true, editable = false }) {
  const desired = (typeof port === 'number') ? port : DEFAULT_PORT;
  const clients = new Set();

  // Broadcast to all SSE clients.
  function broadcast(event, data) {
    for (const c of clients) {
      const ok = c.send(event, data);
      if (!ok) clients.delete(c);
    }
  }

  // @cap-todo(ac:F-068/refactor) Route table — per-route method set + handler. Replaces the monolithic
  // `if (req.method !== 'GET') return send405()` approach so edit mode can slot in PUT/DELETE handlers
  // without weakening the invariant for read-only paths.
  const routes = buildRoutes({ projectRoot, editable, clients, broadcast });

  const server = http.createServer(function (req, res) {
    const method = req.method || 'GET';
    const url = req.url || '/';
    const match = matchRoute(routes, url);

    // No route pattern matches → 404.
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Found the route; check method.
    // @cap-decision(F-068/refactor) HEAD is accepted wherever GET is accepted. Other methods → 405 with correct Allow header.
    const allowedMethods = match.route.methods;
    const methodOk = allowedMethods.includes(method) || (method === 'HEAD' && allowedMethods.includes('GET'));
    if (!methodOk) {
      res.writeHead(405, {
        'Content-Type': 'text/plain',
        'Allow': allowedMethods.join(', ') || 'GET, HEAD',
      });
      res.end(`Method Not Allowed — ${allowedMethods.join(', ') || 'GET'} only on ${match.pattern}`);
      return;
    }

    try {
      match.route.handler(req, res, match.params);
    } catch (err) {
      logEvent('error', 'route-handler-threw', { url, method, error: err && err.message });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    }
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
      logEvent('info', 'server-start', { port: actualPort, url, editable });

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

// --- Route dispatch --------------------------------------------------------

// @cap-todo(ac:F-068/refactor) Per-route method dispatch — GET-only routes stay GET-only, edit endpoints
//   only register when `editable` is true. FEATURE-MAP + Memory writes are explicitly 405 guarded (AC-6).
/**
 * @typedef {Object} Route
 * @property {string} pattern - URL pattern (supports `:id` segments)
 * @property {string[]} methods - Allowed HTTP methods (e.g. ['GET'] or ['PUT'])
 * @property {(req: http.IncomingMessage, res: http.ServerResponse, params: Object) => void} handler
 */

/**
 * Build the route table.
 * @param {{projectRoot:string, editable:boolean, clients:Set, broadcast:Function}} ctx
 * @returns {Route[]}
 */
function buildRoutes(ctx) {
  const { projectRoot, editable, clients, broadcast } = ctx;
  const routes = [];

  // --- Read-only GET routes (always available) ----------------------------
  routes.push({
    pattern: '/events',
    methods: ['GET'],
    handler: function (req, res) {
      const client = sseResponse(res);
      clients.add(client);
      logEvent('info', 'sse-connect', { clients: clients.size });
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
    },
  });

  routes.push({
    pattern: '/healthz',
    methods: ['GET'],
    handler: function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, at: new Date().toISOString(), editable }));
    },
  });

  // @cap-decision(F-068) Index pages are registered twice with different patterns for exact matching
  //   (matchRoute treats pattern literals strictly — `/` does not collide with `/index.html`).
  const indexHandler = function (req, res) {
    const snapshot = collectProjectSnapshot(projectRoot);
    const html = renderHtml({ snapshot, options: { live: true, editable } });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if ((req.method || 'GET') === 'HEAD') { res.end(); return; }
    res.end(html);
  };
  routes.push({ pattern: '/', methods: ['GET'], handler: indexHandler });
  routes.push({ pattern: '/index.html', methods: ['GET'], handler: indexHandler });

  // --- AC-6 guard: FEATURE-MAP + MEMORY are ALWAYS read-only (even in edit mode). ----
  // They respond 405 with an explicit Allow: GET header for any non-GET method.
  // @cap-todo(ac:F-068/AC-6) FEATURE-MAP + Memory paths explicitly 405 on any mutating method.
  routes.push({ pattern: '/api/feature-map', methods: ['GET'], handler: guardReadOnlyApi('feature-map') });
  routes.push({ pattern: '/api/feature-map/:id', methods: ['GET'], handler: guardReadOnlyApi('feature-map') });
  routes.push({ pattern: '/api/memory', methods: ['GET'], handler: guardReadOnlyApi('memory') });
  routes.push({ pattern: '/api/memory/:id', methods: ['GET'], handler: guardReadOnlyApi('memory') });

  // --- DESIGN.md read route (always available) ----------------------------
  routes.push({
    pattern: '/api/design/read',
    methods: ['GET'],
    handler: function (req, res) {
      try {
        const content = designLib.readDesignMd(projectRoot);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: content || null }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      }
    },
  });

  // --- F-068 edit routes — ONLY when editable=true ------------------------
  if (editable) {
    // @cap-todo(ac:F-068/AC-2) PUT /api/design/color/:id — update a color token.
    routes.push({
      pattern: '/api/design/color/:id',
      methods: ['PUT'],
      handler: withJsonBody(function (req, res, params, body) {
        const id = params.id;
        if (typeof body.value !== 'string') {
          return sendJson(res, 400, { error: 'body.value (string) required' });
        }
        applyAndWrite(projectRoot, (content) =>
          designEditorLib.applyColorEdit(content, { id, value: body.value }),
          broadcast, res, { op: 'color', id, value: body.value });
      }),
    });

    // @cap-todo(ac:F-068/AC-3) PUT /api/design/spacing/:id — update a scale array (spacing or typography).
    routes.push({
      pattern: '/api/design/spacing/:id',
      methods: ['PUT'],
      handler: withJsonBody(function (req, res, params, body) {
        const id = params.id;
        if (!Array.isArray(body.value) && typeof body.value !== 'string') {
          return sendJson(res, 400, { error: 'body.value (array or CSV string) required' });
        }
        applyAndWrite(projectRoot, (content) =>
          designEditorLib.applySpacingEdit(content, { id, value: body.value }),
          broadcast, res, { op: 'spacing', id });
      }),
    });

    // @cap-todo(ac:F-068/AC-4) PUT /api/design/component/:id — add/remove a variant via JSON body.
    routes.push({
      pattern: '/api/design/component/:id',
      methods: ['PUT'],
      handler: withJsonBody(function (req, res, params, body) {
        const id = params.id;
        const action = body.action;
        const variant = body.variant;
        if (action !== 'add' && action !== 'remove') {
          return sendJson(res, 400, { error: "body.action must be 'add' or 'remove'" });
        }
        if (typeof variant !== 'string' || variant.length === 0) {
          return sendJson(res, 400, { error: 'body.variant (string) required' });
        }
        applyAndWrite(projectRoot, (content) =>
          designEditorLib.applyComponentEdit(content, { id, action, variant }),
          broadcast, res, { op: 'component', id, action, variant });
      }),
    });

    // @cap-todo(ac:F-068/AC-4) DELETE /api/design/component/:id/variant/:name — alias for {action:'remove'}.
    routes.push({
      pattern: '/api/design/component/:id/variant/:name',
      methods: ['DELETE'],
      handler: function (req, res, params) {
        applyAndWrite(projectRoot, (content) =>
          designEditorLib.applyComponentEdit(content, { id: params.id, action: 'remove', variant: params.name }),
          broadcast, res, { op: 'component-variant-delete', id: params.id, variant: params.name });
      },
    });
  }

  return routes;
}

// @cap-decision(F-068) Route matching: strict literal segments + `:name` placeholder.
//   Any segment containing `..` or a slash (after decoding) fails to match — extra defense beyond the
//   library-layer path-traversal check in cap-ui-design-editor.cjs.
function matchRoute(routes, rawUrl) {
  let pathname = rawUrl;
  const qIdx = pathname.indexOf('?');
  if (qIdx !== -1) pathname = pathname.slice(0, qIdx);
  const hIdx = pathname.indexOf('#');
  if (hIdx !== -1) pathname = pathname.slice(0, hIdx);

  // Normalise: refuse `..` anywhere in the path to prevent traversal via patterns like /api/design/../../etc.
  // @cap-todo(ac:F-068/AC-5) First line of defense against path-traversal in URLs — refuse any segment equal to '..'.
  const rawSegments = pathname.split('/');
  for (const seg of rawSegments) {
    if (seg === '..' || seg === '.') return null;
    // Backslashes should never appear in URL paths; reject them defensively.
    if (seg.indexOf('\\') !== -1) return null;
  }

  for (const route of routes) {
    const params = matchPattern(route.pattern, pathname);
    if (params) return { route, pattern: route.pattern, params };
  }
  return null;
}

function matchPattern(pattern, pathname) {
  const patParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    const p = patParts[i];
    const v = pathParts[i];
    if (p.startsWith(':')) {
      // @cap-risk URL-decoded params are passed to handlers. Handlers MUST validate format (DT-NNN etc.) before use.
      let decoded;
      try { decoded = decodeURIComponent(v); } catch { return null; }
      if (decoded.indexOf('/') !== -1 || decoded.indexOf('..') !== -1 || decoded.length === 0) return null;
      params[p.slice(1)] = decoded;
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}

// @cap-todo(ac:F-068/AC-6) guardReadOnlyApi: FEATURE-MAP / Memory endpoints respond with a minimal read-only stub on GET,
//   and the route registration guarantees 405 on any other method (including in --editable mode).
function guardReadOnlyApi(kind) {
  return function (req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ readOnly: true, kind, note: 'Collaboration is Git-based for FEATURE-MAP and Memory (F-068/AC-6).' }));
  };
}

// Body parsing helper — reads a small JSON body (≤64KB) and calls the handler.
function withJsonBody(handler) {
  return function (req, res, params) {
    const chunks = [];
    let total = 0;
    const LIMIT = 64 * 1024;
    req.on('data', function (chunk) {
      total += chunk.length;
      if (total > LIMIT) {
        req.removeAllListeners('data');
        sendJson(res, 413, { error: 'request body too large' });
        try { req.destroy(); } catch { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      let body = {};
      if (chunks.length > 0) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (err) { return sendJson(res, 400, { error: 'invalid JSON: ' + err.message }); }
      }
      handler(req, res, params, body);
    });
    req.on('error', function (err) { sendJson(res, 400, { error: 'request error: ' + err.message }); });
  };
}

function sendJson(res, status, obj) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
  }
  res.end(JSON.stringify(obj));
}

// @cap-todo(ac:F-068/AC-5) applyAndWrite: read DESIGN.md, run pure transform, atomically write result, broadcast change.
function applyAndWrite(projectRoot, transform, broadcast, res, meta) {
  let content;
  try {
    content = designLib.readDesignMd(projectRoot);
  } catch (err) {
    return sendJson(res, 500, { error: 'failed to read DESIGN.md: ' + (err && err.message) });
  }
  if (content === null) {
    return sendJson(res, 404, { error: 'DESIGN.md not found — run /cap:design --new first' });
  }
  let next;
  try {
    next = transform(content);
  } catch (err) {
    return sendJson(res, 400, { error: (err && err.message) || 'edit failed' });
  }
  if (typeof next !== 'string') {
    return sendJson(res, 500, { error: 'transform did not return a string' });
  }
  if (next === content) {
    // No-op edit — do not write, do not broadcast, but report success for idempotency.
    logEvent('info', 'design-edit-noop', meta);
    return sendJson(res, 200, { ok: true, noop: true });
  }
  try {
    designEditorLib.atomicWriteDesign(projectRoot, next);
  } catch (err) {
    logEvent('error', 'atomic-write-failed', { err: err && err.message, meta });
    return sendJson(res, 500, { error: (err && err.message) || 'write failed' });
  }
  logEvent('info', 'design-edit', meta);
  try { broadcast('change', { file: 'DESIGN.md', type: 'edit' }); } catch { /* ignore */ }
  sendJson(res, 200, { ok: true });
}

// --- Snapshot (standalone HTML) -------------------------------------------

// @cap-todo(ac:F-065/AC-4) createSnapshot writes a standalone HTML snapshot to .cap/ui/snapshot.html with inline CSS/JS and no external fetch.
// @cap-todo(ac:F-068/hand-off) createSnapshot outputPath is now path-traversal-guarded via designEditorLib.checkContainment.
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
  // @cap-todo(ac:F-068/hand-off) F-065 review deferred this containment check to F-068 — enforce now.
  const abs = designEditorLib.checkContainment(projectRoot, rel);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const snapshot = collectProjectSnapshot(projectRoot);
  // @cap-decision(F-068) Snapshot stays read-only — even in --editable sessions, --share does not embed the edit UI.
  //   A static shareable HTML has no server to PUT against, so the editor would be non-functional and misleading.
  const html = renderHtml({ snapshot, options: { live: false, editable: false } });

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

  // Composition entry points
  buildCoreCss,
  buildCoreJs,
  buildCss,
  buildClientJs,

  // F-066 Mind-Map (re-exported from cap-ui-mind-map.cjs for back-compat).
  buildGraphData:      mindMapLib.buildGraphData,
  runForceLayout:      mindMapLib.runForceLayout,
  renderMindMapSvg:    mindMapLib.renderMindMapSvg,
  buildMindMapSection: mindMapLib.buildMindMapSection,
  buildMindMapCss:     mindMapLib.buildMindMapCss,
  buildMindMapJs:      mindMapLib.buildMindMapJs,

  // F-067 Thread + Cluster Navigator (re-exported from cap-ui-thread-nav.cjs for back-compat).
  buildThreadData:        threadNavLib.buildThreadData,
  renderThreadList:       threadNavLib.renderThreadList,
  renderThreadDetail:     threadNavLib.renderThreadDetail,
  renderClusterView:      threadNavLib.renderClusterView,
  renderKeywordOverlap:   threadNavLib.renderKeywordOverlap,
  buildThreadNavSection:  threadNavLib.buildThreadNavSection,
  buildThreadNavCss:      threadNavLib.buildThreadNavCss,
  buildThreadNavJs:       threadNavLib.buildThreadNavJs,

  // F-068 Design Editor (re-exported for convenience + testing).
  buildEditorSection:  designEditorLib.buildEditorSection,
  buildEditorCss:      designEditorLib.buildEditorCss,
  buildEditorJs:       designEditorLib.buildEditorJs,
  applyColorEdit:      designEditorLib.applyColorEdit,
  applySpacingEdit:    designEditorLib.applySpacingEdit,
  applyComponentEdit:  designEditorLib.applyComponentEdit,
  checkContainment:    designEditorLib.checkContainment,
  atomicWriteDesign:   designEditorLib.atomicWriteDesign,

  // Internal — exposed for tests.
  _matchRoute: matchRoute,
  _matchPattern: matchPattern,
  _buildRoutes: buildRoutes,
};
