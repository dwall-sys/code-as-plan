// @cap-context CAP v5 F-066 Tag Mind-Map Visualization — graph data derivation, deterministic force layout, SVG renderer, CSS, client JS.
// @cap-context Extracted from cap-ui.cjs as part of F-068 hand-off (cap-ui.cjs was 2245 LOC). Public API stays stable via re-exports from cap-ui.cjs.
// @cap-decision(F-068/split) Extracted as a standalone module so F-068 can add cap-ui-design-editor.cjs alongside without touching unrelated code.
// @cap-decision(F-066/D1) Mind-Map renders via handrolled SVG + vanilla force-directed layout — NO D3, NO vis.js, NO cytoscape. Keeps zero-deps purity intact at source and require-graph level.
// @cap-decision(F-066/D2) buildMindMapCss / buildMindMapJs are composable strings, joined by cap-ui.cjs into the full page output.
// @cap-constraint Zero external dependencies — node builtins only (here: none; pure string/number work).

'use strict';

// @cap-feature(feature:F-066) Tag Mind-Map Visualization — graph data derivation, deterministic force layout, SVG renderer, inline interaction JS.

// --- HTML escape (local copy; cap-ui.cjs keeps the canonical one for re-export stability) ---
// @cap-decision(F-068/split) Local escapeHtml avoids a circular require with cap-ui.cjs. Behaviour is byte-identical to cap-ui.escapeHtml.
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

module.exports = {
  buildGraphData,
  runForceLayout,
  renderMindMapSvg,
  buildMindMapSection,
  buildMindMapCss,
  buildMindMapJs,
  // Exported for internal testing (hashing determinism).
  _hashString32: hashString32,
  _mulberry32: mulberry32,
};
