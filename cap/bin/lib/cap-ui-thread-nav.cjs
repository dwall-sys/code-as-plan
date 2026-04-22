// @cap-context CAP v5 F-067 Thread + Cluster Navigator — thread browser, detail view, cluster visualization, keyword overlap, drift warnings, keyboard nav.
// @cap-context Extracted from cap-ui.cjs as part of F-068 hand-off (cap-ui.cjs was 2245 LOC). Public API stays stable via re-exports from cap-ui.cjs.
// @cap-decision(F-068/split) Extracted as a standalone module so F-068 can add cap-ui-design-editor.cjs alongside without touching unrelated code.
// @cap-decision(F-067/D1) Thread list is sorted newest-first. Chronologically recent threads are the more useful default for "what did we discuss recently".
// @cap-decision(F-067/D2) Thread detail uses an inline side-panel layout (list left, detail right). Familiar pattern, keyboard-friendly, no modal z-index wrangling.
// @cap-decision(F-067/D3) Cluster visualization is a plain list (not a mini-graph). The mind-map (F-066) already covers graph topology; the cluster view adds tabular depth (members, affinity, drift) that a mini-graph would hide.
// @cap-decision(F-067/D4) Keyword overlap is a 3-column list (A∩B | A only | B only). A Venn diagram would add SVG complexity for no accuracy gain.
// @cap-decision(F-067/D5) Drift warnings render as an inline icon plus a colored left border on the cluster row — visible without being loud.
// @cap-decision(F-067/D6) Keyboard navigation extends to BOTH the thread-list and mind-map nodes (F-066 deferred a11y is tied up here). Tab/Arrow/Enter/Escape wired consistently.
// @cap-constraint Zero external dependencies — node builtins only (here: none; pure data derivation + string rendering).

'use strict';

// @cap-feature(feature:F-067) Thread + Cluster Navigator — thread browser, detail view, cluster list, keyword overlap, drift warnings, keyboard nav.

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
// @cap-decision(F-067-review/hardening) Keyword-overlap uses Object.create(null) maps to avoid prototype-pollution on odd keys.
function buildThreadNavJs() {
  return `
(function(){
  var dataNode = document.getElementById('tn-data');
  if (!dataNode) return;
  var payload;
  try { payload = JSON.parse(dataNode.textContent || '{}'); } catch (e) { payload = { threads: [] }; }
  var threads = Array.isArray(payload.threads) ? payload.threads : [];
  var threadById = Object.create(null);
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
    // @cap-decision(F-067-review/hardening) Use null-proto maps so keyword keys like "constructor" are treated as data.
    var setA = Object.create(null); (a.keywords || []).forEach(function(k){ setA[k] = true; });
    var setB = Object.create(null); (b.keywords || []).forEach(function(k){ setB[k] = true; });
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

module.exports = {
  buildThreadData,
  renderThreadList,
  renderThreadDetail,
  renderClusterView,
  renderKeywordOverlap,
  buildThreadNavSection,
  buildThreadNavCss,
  buildThreadNavJs,
};
