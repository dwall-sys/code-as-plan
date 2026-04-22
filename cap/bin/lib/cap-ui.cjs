// @cap-context CAP v5 CAP-UI Core — local HTTP server + static snapshot export for Feature-Map, Memory, Threads, DESIGN.md.
// @cap-context CAP v5 F-066 extends this module with a Tag Mind-Map Visualization (SVG + vanilla JS, zero external deps).
// @cap-context CAP v5 F-067 extends this module with a Thread + Cluster Navigator (thread browser, detail view, cluster visualization, keyword overlap, drift warnings, keyboard nav).
// @cap-decision Zero external deps by design. Only node: builtins (http, fs, path, url, os, crypto). No Express, no WebSockets, no React.
// @cap-decision Read-only UI for Feature-Map + Memory + Threads. DESIGN.md edit capability is scoped to F-068. No POST/PUT routes in F-065.
// @cap-decision Server-Sent Events (SSE) over WebSockets — browser-native EventSource handles reconnect, firewalls, and proxies more gracefully.
// @cap-decision HTML rendered via template literals (not DOM builder, not JSX) — zero build step, same code path for --serve and --share.
// @cap-decision CSS + JS embedded inline in every response — required for --share to produce a standalone shareable HTML file.
// @cap-decision(F-066/D1) Mind-Map renders via handrolled SVG + vanilla force-directed layout — NO D3, NO vis.js, NO cytoscape. Keeps zero-deps purity intact at source and require-graph level.
// @cap-decision(F-066/D2) buildCss() and buildClientJs() are split into composable pieces (buildCoreCss + buildMindMapCss, buildCoreJs + buildMindMapJs) so F-067/F-068 can extend without touching the core.
// @cap-decision(F-067/D1) Thread list is sorted newest-first. Chronologically recent threads are the more useful default for "what did we discuss recently".
// @cap-decision(F-067/D2) Thread detail uses an inline side-panel layout (list left, detail right). Familiar pattern, keyboard-friendly, no modal z-index wrangling.
// @cap-decision(F-067/D3) Cluster visualization is a plain list (not a mini-graph). The mind-map (F-066) already covers graph topology; the cluster view adds tabular depth (members, affinity, drift) that a mini-graph would hide.
// @cap-decision(F-067/D4) Keyword overlap is a 3-column list (A∩B | A only | B only). A Venn diagram would add SVG complexity for no accuracy gain.
// @cap-decision(F-067/D5) Drift warnings render as an inline icon plus a colored left border on the cluster row — visible without being loud.
// @cap-decision(F-067/D6) Keyboard navigation extends to BOTH the thread-list and mind-map nodes (F-066 deferred a11y is tied up here). Tab/Arrow/Enter/Escape wired consistently.
// @cap-constraint All file I/O goes through this module (and the shared lib readers); no direct fs access from command layer for UI state.
// @cap-pattern Renderer is a pure function over data; server and snapshot both call the same renderHtml() so they stay byte-compatible.

'use strict';

// @cap-feature(feature:F-065) CAP-UI Core — local server, renderer, file watcher, snapshot exporter.
// @cap-feature(feature:F-066) Tag Mind-Map Visualization — graph data derivation, deterministic force layout, SVG renderer, inline interaction JS.
// @cap-feature(feature:F-067) Thread + Cluster Navigator — thread browser, detail view, cluster list, keyword overlap, drift warnings, keyboard nav.

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

  // @cap-todo(ac:F-067/AC-1) Thread-Nav section is composed into renderHtml so it appears in --serve AND --share output.
  const threadData = buildThreadData({
    threads: s.fullThreads || [],
    clusters: s.clusters || [],
    affinity: s.affinityResults || [],
    graph: s.clusterGraph || { nodes: {}, edges: [] },
  });

  const body = [
    renderHeader(s),
    renderNav(),
    renderFeaturesSection(s.featureMap),
    renderDesignSection(s.designMd),
    buildMindMapSection({ graphData }),
    renderMemorySection(s.memory),
    buildThreadNavSection({ threadData }),
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
// @cap-todo(ac:F-067/AC-1) buildCss now also composes buildThreadNavCss so the Thread-Nav styling travels with --serve + --share.
function buildCss() {
  return [buildCoreCss(), buildMindMapCss(), buildThreadNavCss()].join('\n');
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
// @cap-todo(ac:F-067/AC-1) buildClientJs now also composes buildThreadNavJs so the thread navigator works in both live + static modes.
function buildClientJs({ live }) {
  return [buildCoreJs({ live }), buildMindMapJs(), buildThreadNavJs()].join('\n');
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
    // @cap-todo(ac:F-067/AC-1) Mind-map nodes become keyboard-reachable (tabindex=0) — tying up F-066's deferred a11y per D6.
    nodeParts.push(
      `<g class="${cls}" data-id="${escapeHtml(n.id)}"${group}${titleAttr} tabindex="0" role="button" aria-label="${escapeHtml(n.id)}${n.title ? ' — ' + escapeHtml(n.title) : ''}">` +
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
svg.mind-map g.nodes g.node:focus { outline: none; }
svg.mind-map g.nodes g.node:focus-visible circle { stroke: var(--accent); stroke-width: 3; }
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

  // --- Keyboard navigation (F-067/D6 — tying up F-066 deferred a11y) -----
  // Enter/Space focuses the node, Escape clears focus. Tab + Shift+Tab move
  // between nodes via native tabindex order.
  svg.addEventListener('keydown', function(e){
    if (e.key === 'Escape') {
      clearFocus();
      e.preventDefault();
      return;
    }
    var node = e.target && e.target.closest ? e.target.closest('g.node') : null;
    if (!node) return;
    if (e.key === 'Enter' || e.key === ' ') {
      focusNode(node.getAttribute('data-id'));
      e.preventDefault();
    }
  });
})();
`.trim();
}

// --- F-067 Thread + Cluster Navigator --------------------------------------

// @cap-decision(F-067/D7) buildThreadData is a pure derivation: input = (threads, clusters, affinity, graph);
//   output = { threads, clusters, keywordIndex } with chronological order, member counts, and avg affinity
//   precomputed per cluster. No DOM, no I/O — testable in isolation without a running server.
// @cap-decision(F-067/D8) Drift detection reuses cap-cluster-helpers._computeDriftStatus via the graph
//   passed through. Not a re-implementation; a thin projection into a UI-friendly shape.

// Lazy require of cluster-helpers for the drift computation — avoids adding it to the top-level
// require graph (cap-cluster-helpers already sits behind cap-cluster-io's lazy require pattern).
/** @returns {typeof import('./cap-cluster-helpers.cjs')} */
function _clusterHelpers() {
  return require('./cap-cluster-helpers.cjs');
}

/**
 * @typedef {Object} ThreadNavData
 * @property {Object[]} threads - Full Thread objects sorted newest-first
 * @property {Object[]} clusters - Clusters augmented with drift, avgAffinity, memberCount, pairwise[]
 * @property {Object<string,string[]>} keywordIndex - threadId -> sorted unique keywords
 */

// @cap-todo(ac:F-067/AC-1) Pure derivation: chronological sort + keyword index + cluster enrichment.
// @cap-todo(ac:F-067/AC-3) Cluster enrichment adds drift status, avg affinity, pairwise edges for rendering.
// @cap-todo(ac:F-067/AC-5) Drift status is stamped onto each cluster so the renderer can highlight drifting clusters.
/**
 * Pure derivation: take raw threads + clusters + affinity + graph, return a UI-friendly bundle.
 * @param {Object} params
 * @param {Object[]} [params.threads] - Full Thread objects
 * @param {Object[]} [params.clusters] - Clusters (id, label, members, drift?)
 * @param {Object[]} [params.affinity] - Pairwise AffinityResult[]
 * @param {Object} [params.graph] - Memory graph (for drift computation)
 * @returns {ThreadNavData}
 */
function buildThreadData(params) {
  const rawThreads = (params && Array.isArray(params.threads)) ? params.threads : [];
  const rawClusters = (params && Array.isArray(params.clusters)) ? params.clusters : [];
  const affinity = (params && Array.isArray(params.affinity)) ? params.affinity : [];
  const graph = (params && params.graph) || { nodes: {}, edges: [] };

  // @cap-decision(F-067/D1) Chronological sort: newest timestamp first. Lexicographic ISO-8601 sort
  //   works byte-identically to Date-based sort and is deterministic.
  const threads = [...rawThreads].sort(function (a, b) {
    const at = (a && a.timestamp) ? String(a.timestamp) : '';
    const bt = (b && b.timestamp) ? String(b.timestamp) : '';
    if (at === bt) return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
    return bt.localeCompare(at);
  });

  // Build keyword index (threadId -> sorted deduped keywords)
  const keywordIndex = {};
  for (const t of threads) {
    if (!t || !t.id) continue;
    const kws = Array.isArray(t.keywords) ? t.keywords : [];
    keywordIndex[t.id] = [...new Set(kws.map(k => String(k)))].sort();
  }

  // Affinity map: "threadA|threadB" (sorted) -> compositeScore
  const affinityMap = new Map();
  for (const a of affinity) {
    if (!a || !a.sourceThreadId || !a.targetThreadId) continue;
    const key = a.sourceThreadId < a.targetThreadId
      ? `${a.sourceThreadId}|${a.targetThreadId}`
      : `${a.targetThreadId}|${a.sourceThreadId}`;
    // Keep max if duplicates exist (mirrors cluster-detect._buildAffinityMap).
    const existing = affinityMap.get(key) || 0;
    if (typeof a.compositeScore === 'number' && a.compositeScore > existing) {
      affinityMap.set(key, a.compositeScore);
    }
  }

  const helpers = _clusterHelpers();
  const clusters = rawClusters.map(function (c) {
    const members = Array.isArray(c.members) ? c.members : [];
    // Pairwise rows within the cluster: member-A, member-B, score.
    const pairwise = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const score = affinityMap.get(key) || 0;
        pairwise.push({ a, b, score });
      }
    }
    pairwise.sort((x, y) => y.score - x.score);

    // Avg affinity = mean of pairwise scores. Empty cluster (single member) -> 0.
    let avg = 0;
    if (pairwise.length > 0) {
      let sum = 0;
      for (const p of pairwise) sum += p.score;
      avg = sum / pairwise.length;
    }

    // @cap-todo(ac:F-067/AC-5) Compute drift status via cap-cluster-helpers (reuses established logic).
    //   If the graph has no relevant edges, drift stays "stable (...)" — that's the intended empty-state string.
    let drift = 'stable (no data)';
    try {
      drift = helpers._computeDriftStatus(members, graph);
    } catch {
      drift = 'stable (no data)';
    }
    const drifting = /drift|diverging/i.test(drift) && !/^stable/i.test(drift);

    return {
      id: c.id,
      label: c.label || 'unnamed',
      members: members,
      memberCount: members.length,
      pairwise,
      avgAffinity: Math.round(avg * 1000) / 1000,
      drift,
      drifting,
    };
  });

  return { threads, clusters, keywordIndex };
}

// @cap-todo(ac:F-067/AC-1) Render thread list chronologically: timestamp, name, featureIds, keyword badges.
// @cap-decision(F-067/D9) Each list item carries tabindex=0 + role=button + data-thread-id so the client-side
//   JS can drive both mouse and keyboard interaction with the same selector.
/**
 * Render the thread list HTML (left rail of the navigator).
 * Pure function — no DOM access, no I/O.
 * @param {Object[]} threads - Threads sorted newest-first (from buildThreadData)
 * @returns {string} HTML markup for the list
 */
function renderThreadList(threads) {
  if (!Array.isArray(threads) || threads.length === 0) {
    return '<ul class="thread-list" id="thread-nav-list"><li class="empty">No threads yet. Run /cap:brainstorm to create one.</li></ul>';
  }
  const items = threads.map(function (t, idx) {
    const fids = (t.featureIds && t.featureIds.length > 0)
      ? t.featureIds.map(function (f) { return `<span class="tn-fid">${escapeHtml(f)}</span>`; }).join(' ')
      : '';
    const kws = (t.keywords && t.keywords.length > 0)
      ? t.keywords.slice(0, 6).map(function (k) { return `<span class="tn-kw">${escapeHtml(k)}</span>`; }).join(' ')
      : '';
    return `    <li class="thread-item tn-thread" role="button" tabindex="0" aria-label="Open thread ${escapeHtml(t.name || t.id)}" data-thread-id="${escapeHtml(t.id || '')}" data-thread-index="${idx}">
      <div class="tn-head"><span class="ts">${escapeHtml(t.timestamp || '')}</span> <strong>${escapeHtml(t.name || t.id || '')}</strong></div>
      <div class="tn-meta">${fids}${fids && kws ? ' · ' : ''}${kws}</div>
    </li>`;
  }).join('\n');
  return `<ul class="thread-list" id="thread-nav-list">\n${items}\n  </ul>`;
}

// @cap-todo(ac:F-067/AC-2) Thread detail view: problem statement, solution shape, boundary decisions, feature IDs, parent link.
/**
 * Render the thread detail view for a single thread.
 * Returns the full panel markup including the 5 mandated fields.
 * @param {Object|null} thread - Thread to render, or null for empty state
 * @returns {string} HTML markup
 */
function renderThreadDetail(thread) {
  if (!thread) {
    return '<div class="tn-detail-empty">Select a thread on the left to see its details.</div>';
  }
  const problemStatement = thread.problemStatement || '';
  const solutionShape = thread.solutionShape || '';
  const boundaryDecisions = Array.isArray(thread.boundaryDecisions) ? thread.boundaryDecisions : [];
  const featureIds = Array.isArray(thread.featureIds) ? thread.featureIds : [];
  const parentId = thread.parentThreadId || null;

  const boundaryItems = boundaryDecisions.length > 0
    ? boundaryDecisions.map(function (b) { return `<li>${escapeHtml(b)}</li>`; }).join('')
    : '<li class="empty">(none)</li>';

  const featurePills = featureIds.length > 0
    ? featureIds.map(function (f) { return `<span class="tn-fid">${escapeHtml(f)}</span>`; }).join(' ')
    : '<span class="empty">(none)</span>';

  const parentLine = parentId
    ? `<a class="tn-parent-link" href="#thread-${escapeHtml(parentId)}" data-parent-id="${escapeHtml(parentId)}">${escapeHtml(parentId)}</a>`
    : '<span class="empty">(root thread — no parent)</span>';

  return `<article class="tn-detail" id="thread-${escapeHtml(thread.id || '')}" aria-live="polite">
    <header class="tn-detail-head">
      <h3>${escapeHtml(thread.name || thread.id || '')}</h3>
      <div class="tn-detail-meta">
        <span class="ts">${escapeHtml(thread.timestamp || '')}</span>
        · ${escapeHtml(thread.id || '')}
      </div>
    </header>
    <section class="tn-field"><h4>Problem Statement</h4><p>${escapeHtml(problemStatement)}</p></section>
    <section class="tn-field"><h4>Solution Shape</h4><p>${escapeHtml(solutionShape)}</p></section>
    <section class="tn-field"><h4>Boundary Decisions</h4><ul>${boundaryItems}</ul></section>
    <section class="tn-field"><h4>Feature IDs</h4><div>${featurePills}</div></section>
    <section class="tn-field"><h4>Parent Thread</h4><div>${parentLine}</div></section>
  </article>`;
}

// @cap-todo(ac:F-067/AC-3) Cluster view: per cluster — name, members, pairwise affinity, drift status.
// @cap-todo(ac:F-067/AC-5) Drift-status clusters render with the drift-warning class (CSS icon + colored border).
/**
 * Render the cluster overview list.
 * @param {Object[]} clusters - Clusters enriched by buildThreadData (with drift + pairwise)
 * @returns {string} HTML markup
 */
function renderClusterView(clusters) {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return '<div class="tn-cluster-empty empty">No clusters detected yet. Run /cap:cluster after a few brainstorm sessions.</div>';
  }
  const items = clusters.map(function (c) {
    const driftClass = c.drifting ? ' drift-warning' : '';
    const driftIcon = c.drifting ? '<span class="tn-drift-icon" aria-hidden="true">⚠</span>' : '';
    const members = (c.members || []).map(function (m) { return `<span class="tn-member">${escapeHtml(m)}</span>`; }).join(' ');
    const top = (c.pairwise || []).slice(0, 3).map(function (p) {
      return `<li><code>${escapeHtml(p.a)} ↔ ${escapeHtml(p.b)}</code> <span class="tn-score">${p.score.toFixed(3)}</span></li>`;
    }).join('');
    return `    <li class="tn-cluster${driftClass}" data-cluster-id="${escapeHtml(c.id || '')}">
      <div class="tn-cluster-head">${driftIcon}<strong>${escapeHtml(c.label || 'unnamed')}</strong> <span class="tn-cluster-meta">${c.memberCount} members · avg aff. ${(c.avgAffinity || 0).toFixed(3)}</span></div>
      <div class="tn-drift-status" aria-label="drift status">drift: ${escapeHtml(c.drift || 'unknown')}</div>
      <div class="tn-cluster-members">${members}</div>
      <ul class="tn-pairwise">${top || '<li class="empty">(single member — no pairs)</li>'}</ul>
    </li>`;
  }).join('\n');
  return `<ul class="tn-cluster-list">\n${items}\n  </ul>`;
}

// @cap-todo(ac:F-067/AC-4) Keyword overlap: shared + unique keywords for a selected thread pair.
/**
 * Render a 3-column keyword overlap view for two threads.
 * Pure function — determinism via sorted arrays.
 * @param {Object|null} threadA
 * @param {Object|null} threadB
 * @returns {string} HTML markup
 */
function renderKeywordOverlap(threadA, threadB) {
  if (!threadA || !threadB) {
    return '<div class="tn-overlap-empty empty">Pick two threads above to compare their keywords.</div>';
  }
  const kwA = new Set((threadA.keywords || []).map(String));
  const kwB = new Set((threadB.keywords || []).map(String));

  const shared = [...kwA].filter(k => kwB.has(k)).sort();
  const onlyA = [...kwA].filter(k => !kwB.has(k)).sort();
  const onlyB = [...kwB].filter(k => !kwA.has(k)).sort();

  const col = function (title, kws) {
    if (kws.length === 0) return `<div class="tn-col"><h4>${escapeHtml(title)}</h4><p class="empty">(none)</p></div>`;
    const pills = kws.map(function (k) { return `<span class="tn-kw">${escapeHtml(k)}</span>`; }).join(' ');
    return `<div class="tn-col"><h4>${escapeHtml(title)} (${kws.length})</h4><div>${pills}</div></div>`;
  };

  return `<div class="tn-overlap" aria-live="polite">
    ${col(`${threadA.name || threadA.id} ∩ ${threadB.name || threadB.id}`, shared)}
    ${col(`${threadA.name || threadA.id} only`, onlyA)}
    ${col(`${threadB.name || threadB.id} only`, onlyB)}
  </div>`;
}

// @cap-todo(ac:F-067/AC-1) The composed Thread-Nav section — list + detail + clusters + overlap tool.
//   This function is the single entry point renderHtml() calls to append F-067 markup.
/**
 * Build the complete Thread-Navigator HTML section.
 * @param {{ threadData: ThreadNavData }} params
 * @returns {string} HTML markup (closes with </main> since it is the last section)
 */
function buildThreadNavSection(params) {
  const data = (params && params.threadData) || { threads: [], clusters: [], keywordIndex: {} };
  const threads = Array.isArray(data.threads) ? data.threads : [];
  const clusters = Array.isArray(data.clusters) ? data.clusters : [];

  const listHtml = renderThreadList(threads);
  // Detail stays empty on first render — client JS fills it on click / keyboard Enter.
  const detailHtml = renderThreadDetail(null);
  const clusterHtml = renderClusterView(clusters);
  const overlapHtml = renderKeywordOverlap(null, null);

  // Thread-pair pickers for the keyword-overlap tool.
  const threadOptions = threads.map(function (t) {
    return `<option value="${escapeHtml(t.id || '')}">${escapeHtml(t.name || t.id || '')}</option>`;
  }).join('\n');

  // Embed thread + keyword data as a tiny JSON blob the client JS reads out of the DOM.
  // @cap-risk(feature:F-067) JSON embedding uses the `</` escape defense to avoid breaking out
  //   of the <script type="application/json"> block. XSS surface is zero in practice because
  //   escapeHtml is applied everywhere user content meets attributes, but defense-in-depth still matters.
  const payload = JSON.stringify({
    threads: threads.map(function (t) {
      return {
        id: t.id,
        name: t.name,
        timestamp: t.timestamp,
        problemStatement: t.problemStatement || '',
        solutionShape: t.solutionShape || '',
        boundaryDecisions: Array.isArray(t.boundaryDecisions) ? t.boundaryDecisions : [],
        featureIds: Array.isArray(t.featureIds) ? t.featureIds : [],
        keywords: Array.isArray(t.keywords) ? t.keywords : [],
        parentThreadId: t.parentThreadId || null,
      };
    }),
  }).replace(/<\//g, '<\\/');

  return `
<section class="cap-section" id="threads">
  <h2>Threads (${threads.length})</h2>
  <script id="tn-data" type="application/json">${payload}</script>
  <div class="tn-layout">
    <div class="tn-left">
      ${listHtml}
    </div>
    <div class="tn-right" id="tn-detail-panel" aria-label="Thread detail">
      ${detailHtml}
    </div>
  </div>
</section>
<section class="cap-section" id="clusters">
  <h2>Clusters (${clusters.length})</h2>
  ${clusterHtml}
</section>
<section class="cap-section" id="keyword-overlap">
  <h2>Keyword Overlap</h2>
  <div class="tn-overlap-picker">
    <label>Thread A <select id="tn-overlap-a" aria-label="Select thread A"><option value="">—</option>${threadOptions}</select></label>
    <label>Thread B <select id="tn-overlap-b" aria-label="Select thread B"><option value="">—</option>${threadOptions}</select></label>
    <button type="button" id="tn-overlap-compare" class="tn-btn">Compare</button>
  </div>
  <div id="tn-overlap-result">${overlapHtml}</div>
</section></main>`;
}

// @cap-todo(ac:F-067/AC-1) Thread-Nav CSS: warm-neutral + terracotta palette, monospace, no gradients.
// @cap-todo(ac:F-067/AC-5) Drift-warning: inline icon + colored left border (D5). No full-row red.
function buildThreadNavCss() {
  return `
.tn-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 16px;
}
@media (max-width: 780px) { .tn-layout { grid-template-columns: 1fr; } }
.tn-left ul.thread-list { max-height: 520px; overflow: auto; margin: 0; padding: 0; }
.tn-thread {
  list-style: none;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  padding: 8px 10px;
  margin: 0 0 6px;
  border-radius: 3px;
  outline: none;
}
.tn-thread:hover { border-color: var(--accent-muted); }
.tn-thread.tn-selected { border-color: var(--accent); background: #fff4ea; }
.tn-thread:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tn-thread .tn-head { display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; }
.tn-thread .tn-head .ts { color: var(--fg-muted); font-size: 11px; white-space: nowrap; }
.tn-thread .tn-meta { margin-top: 4px; font-size: 11.5px; color: var(--fg-muted); display: flex; flex-wrap: wrap; gap: 4px; }
.tn-fid {
  display: inline-block;
  padding: 1px 5px;
  background: #f1e4d0;
  color: var(--state-prototyped);
  border-radius: 2px;
  font-size: 11px;
}
.tn-kw {
  display: inline-block;
  padding: 1px 5px;
  background: var(--border);
  color: var(--fg);
  border-radius: 2px;
  font-size: 11px;
}
.tn-right {
  border: 1px solid var(--border);
  background: var(--bg-card);
  border-radius: 3px;
  padding: 12px 14px;
  min-height: 260px;
}
.tn-detail-empty, .tn-cluster-empty, .tn-overlap-empty {
  color: var(--fg-muted);
  font-style: italic;
  padding: 12px 0;
}
.tn-detail-head h3 {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--accent);
}
.tn-detail-meta { font-size: 11px; color: var(--fg-muted); margin-bottom: 10px; }
.tn-field {
  margin: 10px 0;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
.tn-field:first-of-type { border-top: none; padding-top: 0; }
.tn-field h4 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.tn-field p, .tn-field ul { margin: 0; font-size: 12.5px; }
.tn-field ul { padding-left: 18px; }
.tn-parent-link { color: var(--accent); text-decoration: none; border-bottom: 1px dashed var(--accent-muted); }
.tn-parent-link:hover { border-bottom-style: solid; }
.tn-cluster-list { list-style: none; padding: 0; margin: 0; }
.tn-cluster {
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  background: var(--bg-card);
  padding: 10px 12px;
  margin: 0 0 8px;
  border-radius: 3px;
  font-size: 12.5px;
}
.tn-cluster.drift-warning {
  border-left-color: var(--accent);
  background: #fff4ea;
}
.tn-drift-icon {
  display: inline-block;
  margin-right: 6px;
  color: var(--accent);
  font-weight: 700;
}
.tn-cluster-head strong { color: var(--accent); }
.tn-cluster-meta { color: var(--fg-muted); font-size: 11px; margin-left: 6px; }
.tn-drift-status { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
.tn-cluster-members { margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px; }
.tn-member {
  display: inline-block;
  padding: 1px 5px;
  background: var(--border);
  border-radius: 2px;
  font-size: 11px;
}
.tn-pairwise { list-style: none; padding: 0; margin: 6px 0 0; font-size: 11.5px; }
.tn-pairwise li { padding: 2px 0; color: var(--fg-muted); }
.tn-pairwise code { color: var(--fg); }
.tn-pairwise .tn-score { color: var(--accent); font-weight: 600; margin-left: 6px; }
.tn-overlap-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 3px;
  margin-bottom: 8px;
  font-size: 12px;
}
.tn-overlap-picker label { display: inline-flex; gap: 6px; align-items: center; color: var(--fg-muted); }
.tn-overlap-picker select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 2px;
}
.tn-btn {
  background: var(--accent);
  color: var(--bg);
  border: none;
  padding: 4px 10px;
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
  border-radius: 2px;
}
.tn-btn:hover { background: #9c4530; }
.tn-overlap { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
@media (max-width: 780px) { .tn-overlap { grid-template-columns: 1fr; } }
.tn-col {
  border: 1px solid var(--border);
  background: var(--bg-card);
  border-radius: 3px;
  padding: 8px 10px;
}
.tn-col h4 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.tn-col div { display: flex; flex-wrap: wrap; gap: 4px; }
`.trim();
}

// @cap-todo(ac:F-067/AC-2) Thread-Nav client JS: click → detail, keyboard nav (Tab/Arrow/Enter/Space/Escape),
//   parent-link follow, overlap compare button, drift warning is CSS-only (no JS needed for AC-5).
// @cap-decision(F-067/D10) Data passed via inline <script type="application/json"> so the same code path works
//   for --serve (live) and --share (static snapshot). No fetch('/threads.json') — consistent with F-066.
function buildThreadNavJs() {
  return `
(function(){
  var dataNode = document.getElementById('tn-data');
  if (!dataNode) return;
  var payload;
  try { payload = JSON.parse(dataNode.textContent || '{}'); } catch (e) { payload = { threads: [] }; }
  var threads = Array.isArray(payload.threads) ? payload.threads : [];
  var threadById = {};
  for (var i = 0; i < threads.length; i++) { if (threads[i] && threads[i].id) threadById[threads[i].id] = threads[i]; }

  var detailPanel = document.getElementById('tn-detail-panel');
  var list = document.getElementById('thread-nav-list');

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Mirror of server-side renderThreadDetail — kept minimal: same 5 fields, same IDs.
  function renderDetail(t) {
    if (!t) {
      return '<div class="tn-detail-empty">Select a thread on the left to see its details.</div>';
    }
    var boundary = (t.boundaryDecisions && t.boundaryDecisions.length)
      ? t.boundaryDecisions.map(function(b){ return '<li>' + escapeHtml(b) + '</li>'; }).join('')
      : '<li class="empty">(none)</li>';
    var fids = (t.featureIds && t.featureIds.length)
      ? t.featureIds.map(function(f){ return '<span class="tn-fid">' + escapeHtml(f) + '</span>'; }).join(' ')
      : '<span class="empty">(none)</span>';
    var parent = t.parentThreadId
      ? '<a class="tn-parent-link" href="#thread-' + escapeHtml(t.parentThreadId) + '" data-parent-id="' + escapeHtml(t.parentThreadId) + '">' + escapeHtml(t.parentThreadId) + '</a>'
      : '<span class="empty">(root thread — no parent)</span>';
    return '<article class="tn-detail" id="thread-' + escapeHtml(t.id) + '" aria-live="polite">'
      + '<header class="tn-detail-head"><h3>' + escapeHtml(t.name || t.id) + '</h3>'
      + '<div class="tn-detail-meta"><span class="ts">' + escapeHtml(t.timestamp || '') + '</span> · ' + escapeHtml(t.id) + '</div></header>'
      + '<section class="tn-field"><h4>Problem Statement</h4><p>' + escapeHtml(t.problemStatement || '') + '</p></section>'
      + '<section class="tn-field"><h4>Solution Shape</h4><p>' + escapeHtml(t.solutionShape || '') + '</p></section>'
      + '<section class="tn-field"><h4>Boundary Decisions</h4><ul>' + boundary + '</ul></section>'
      + '<section class="tn-field"><h4>Feature IDs</h4><div>' + fids + '</div></section>'
      + '<section class="tn-field"><h4>Parent Thread</h4><div>' + parent + '</div></section>'
      + '</article>';
  }

  function selectThread(id, opts) {
    var t = threadById[id];
    if (!t) return;
    if (detailPanel) detailPanel.innerHTML = renderDetail(t);
    var items = list ? list.querySelectorAll('.tn-thread') : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-thread-id') === id) {
        items[i].classList.add('tn-selected');
        if (opts && opts.focus) items[i].focus();
      } else {
        items[i].classList.remove('tn-selected');
      }
    }
  }

  // --- Click & keyboard on thread-list items ------------------------------
  if (list) {
    list.addEventListener('click', function(e){
      var li = e.target && e.target.closest ? e.target.closest('.tn-thread') : null;
      if (!li) return;
      var id = li.getAttribute('data-thread-id');
      if (id) selectThread(id);
    });

    list.addEventListener('keydown', function(e){
      var li = e.target && e.target.closest ? e.target.closest('.tn-thread') : null;
      var items = list.querySelectorAll('.tn-thread');
      if (!items.length) return;
      var currentIndex = -1;
      for (var i = 0; i < items.length; i++) { if (items[i] === li) { currentIndex = i; break; } }

      if (e.key === 'Enter' || e.key === ' ') {
        if (li) {
          var id = li.getAttribute('data-thread-id');
          if (id) selectThread(id);
          e.preventDefault();
        }
      } else if (e.key === 'ArrowDown') {
        var next = Math.min(items.length - 1, currentIndex + 1);
        if (next >= 0 && items[next]) items[next].focus();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        var prev = Math.max(0, currentIndex - 1);
        if (prev >= 0 && items[prev]) items[prev].focus();
        e.preventDefault();
      } else if (e.key === 'Home') {
        if (items[0]) items[0].focus();
        e.preventDefault();
      } else if (e.key === 'End') {
        if (items[items.length - 1]) items[items.length - 1].focus();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (detailPanel) detailPanel.innerHTML = renderDetail(null);
        for (var j = 0; j < items.length; j++) items[j].classList.remove('tn-selected');
        e.preventDefault();
      }
    });
  }

  // --- Parent-thread link follows to the selected thread ------------------
  if (detailPanel) {
    detailPanel.addEventListener('click', function(e){
      var link = e.target && e.target.closest ? e.target.closest('.tn-parent-link') : null;
      if (!link) return;
      var pid = link.getAttribute('data-parent-id');
      if (pid && threadById[pid]) {
        e.preventDefault();
        selectThread(pid, { focus: true });
      }
    });
  }

  // --- Keyword-overlap picker ---------------------------------------------
  function renderOverlap(a, b) {
    if (!a || !b) {
      return '<div class="tn-overlap-empty empty">Pick two threads above to compare their keywords.</div>';
    }
    var setA = {}; (a.keywords || []).forEach(function(k){ setA[k] = true; });
    var setB = {}; (b.keywords || []).forEach(function(k){ setB[k] = true; });
    var shared = []; var onlyA = []; var onlyB = [];
    Object.keys(setA).sort().forEach(function(k){ if (setB[k]) shared.push(k); else onlyA.push(k); });
    Object.keys(setB).sort().forEach(function(k){ if (!setA[k]) onlyB.push(k); });
    function col(title, kws) {
      if (!kws.length) return '<div class="tn-col"><h4>' + escapeHtml(title) + '</h4><p class="empty">(none)</p></div>';
      var pills = kws.map(function(k){ return '<span class="tn-kw">' + escapeHtml(k) + '</span>'; }).join(' ');
      return '<div class="tn-col"><h4>' + escapeHtml(title) + ' (' + kws.length + ')</h4><div>' + pills + '</div></div>';
    }
    var nameA = a.name || a.id;
    var nameB = b.name || b.id;
    return '<div class="tn-overlap" aria-live="polite">'
      + col(nameA + ' ∩ ' + nameB, shared)
      + col(nameA + ' only', onlyA)
      + col(nameB + ' only', onlyB)
      + '</div>';
  }

  var btn = document.getElementById('tn-overlap-compare');
  var selA = document.getElementById('tn-overlap-a');
  var selB = document.getElementById('tn-overlap-b');
  var result = document.getElementById('tn-overlap-result');
  function doCompare() {
    if (!selA || !selB || !result) return;
    var a = threadById[selA.value];
    var b = threadById[selB.value];
    result.innerHTML = renderOverlap(a, b);
  }
  if (btn) btn.addEventListener('click', doCompare);
  // Auto-recompute when either select changes so the view stays in sync without requiring the button.
  if (selA) selA.addEventListener('change', doCompare);
  if (selB) selB.addEventListener('change', doCompare);
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

  // F-067 Thread + Cluster Navigator
  buildThreadData,
  renderThreadList,
  renderThreadDetail,
  renderClusterView,
  renderKeywordOverlap,
  buildThreadNavSection,
  buildThreadNavCss,
  buildThreadNavJs,
};
