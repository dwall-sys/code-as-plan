// @cap-context CAP v5 F-068 Visual Design Editor for DESIGN.md — FIRST edit capability in CAP-UI.
// @cap-context Respects read-only invariants from F-065..F-067 while adding DESIGN.md-specific write endpoints and UI.
// @cap-decision(F-068/D1) Edit scope is STRICTLY DESIGN.md. FEATURE-MAP.md and Memory stay read-only — enforced at route layer AND here (functions only accept DESIGN.md content strings / write to DESIGN.md).
// @cap-decision(F-068/D2) Atomic writes: temp file + fs.renameSync. Crash-safe — either the old file or the new full content exists, never a truncated mid-write state.
// @cap-decision(F-068/D3) Git-friendly line-level edits: applyColorEdit / applySpacingEdit / applyComponentEdit perform surgical single-line edits so `git diff` shows exactly one changed line per user edit.
// @cap-decision(F-068/D4) Path-traversal guard: checkContainment enforces targetPath lies inside projectRoot. Used by atomicWriteDesign AND by createSnapshot (F-065 hand-off).
// @cap-decision(F-068/D5) Zero external deps. No color-picker lib, no React. HTML5 <input type="color"> + <input type="range"> cover AC-2/AC-3 natively.
// @cap-decision(F-068/D6) UI toggled via `editable` flag. When editable=false, buildEditorSection returns empty string so byte-identical read-only snapshots remain unchanged for existing F-065 tests.
// @cap-constraint Zero external dependencies — node builtins only (fs, path).

'use strict';

// @cap-feature(feature:F-068) Visual Design Editor — DESIGN.md line-level edits, atomic writes, path-traversal guard, editor UI.

const fs = require('node:fs');
const path = require('node:path');

const designLib = require('./cap-design.cjs');

const DESIGN_FILE = 'DESIGN.md';

// --- HTML escape (local copy — same pattern as sibling modules) ------------
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===========================================================================
//  Path containment + atomic write
// ===========================================================================

// @cap-todo(ac:F-068/AC-5) Path-traversal guard protects the atomic writer.
// @cap-todo(ac:F-068/AC-6) Same guard is reused by cap-ui.createSnapshot (F-065 hand-off carried into F-068).
/**
 * Throw if `targetPath` escapes `projectRoot`.
 * Uses path.resolve + a prefix check that tolerates symlinks on the project side.
 *
 * @param {string} projectRoot - Absolute project root directory.
 * @param {string} targetPath - Absolute or relative path to check.
 * @throws {Error} with message including "path traversal" when containment fails.
 */
function checkContainment(projectRoot, targetPath) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new Error('checkContainment: projectRoot must be a non-empty string');
  }
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('checkContainment: targetPath must be a non-empty string');
  }
  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, targetPath);
  // Both must be normalized. A `..` or symlink attack produces `abs` outside `root`.
  // Require abs === root OR abs starts with root + separator so `/tmp/foo` does not contain `/tmp/foobar`.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new Error(`path traversal: ${targetPath} resolves outside projectRoot (${root})`);
  }
  return abs;
}

// @cap-todo(ac:F-068/AC-5) atomicWriteDesign: temp-file + rename pattern so DESIGN.md is never truncated mid-write.
/**
 * Atomically write `content` to <projectRoot>/DESIGN.md.
 * @param {string} projectRoot - Absolute project root.
 * @param {string} content - Full DESIGN.md content.
 * @returns {{ path: string, bytes: number }} absolute path written + bytes.
 * @throws {Error} on containment violation or write failure.
 */
function atomicWriteDesign(projectRoot, content) {
  if (typeof content !== 'string') {
    throw new Error('atomicWriteDesign: content must be a string');
  }
  const target = checkContainment(projectRoot, DESIGN_FILE);
  // @cap-risk Temp path must also be inside projectRoot — otherwise a rename across devices would fail silently.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    // Clean up the temp file on rename failure; re-throw.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { path: target, bytes: Buffer.byteLength(content, 'utf8') };
}

// ===========================================================================
//  Line-level, git-friendly edit primitives (pure functions)
// ===========================================================================

// @cap-todo(ac:F-068/AC-2) applyColorEdit: change exactly one color token bullet line.
// @cap-todo(ac:F-068/AC-5) Only the matched bullet line is rewritten; all other bytes preserved.
/**
 * Rewrite the color-token bullet with the given DT-NNN id to `value`.
 * Preserves key name, trailing `(id: DT-NNN)` suffix, and surrounding whitespace.
 *
 * @param {string} designMdContent - Existing DESIGN.md content.
 * @param {{id: string, value: string}} edit - `id` is the DT-NNN to locate; `value` is the new color value (e.g. "#ff6600").
 * @returns {string} New DESIGN.md content.
 * @throws {Error} when id is not found, value is missing, or input is not a string.
 */
function applyColorEdit(designMdContent, edit) {
  if (typeof designMdContent !== 'string') throw new Error('applyColorEdit: content must be a string');
  if (!edit || typeof edit.id !== 'string' || typeof edit.value !== 'string') {
    throw new Error('applyColorEdit: edit.id and edit.value required');
  }
  _validateId(edit.id, /^DT-\d{3,}$/, 'DT-NNN');
  _validateColorValue(edit.value);

  const lines = designMdContent.split('\n');
  // Match: "- key: <value> (id: DT-NNN)". Tolerant of extra whitespace in value region.
  const target = new RegExp(`^(-\\s+[^:]+:\\s*)(.+?)(\\s*\\(id:\\s*${_escapeReg(edit.id)}\\)\\s*)$`);
  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    if (target.test(lines[i])) { hit = i; break; }
  }
  if (hit === -1) {
    throw new Error(`applyColorEdit: token ${edit.id} not found in DESIGN.md`);
  }
  lines[hit] = lines[hit].replace(target, (_m, prefix, _oldValue, suffix) => `${prefix}${edit.value}${suffix}`);
  return lines.join('\n');
}

// @cap-todo(ac:F-068/AC-3) applySpacingEdit: change spacing or typography scale arrays with byte-level care.
/**
 * Rewrite spacing / typography scale line with a new numeric array.
 * Matches three supported shapes:
 *   - "- scale: [4, 8, 16]"             (under ### Spacing or ### Typography)
 *   - "- family: \"...\""               (under ### Typography — renamed value)
 *   - "- familyMono: \"...\""           (under ### Typography — renamed value)
 * The `id` field is the KIND: "spacing.scale" | "typography.scale" | "typography.family" | "typography.familyMono".
 *
 * @param {string} designMdContent
 * @param {{id: string, value: string | number[]}} edit
 * @returns {string}
 */
function applySpacingEdit(designMdContent, edit) {
  if (typeof designMdContent !== 'string') throw new Error('applySpacingEdit: content must be a string');
  if (!edit || typeof edit.id !== 'string') throw new Error('applySpacingEdit: edit.id required');

  const lines = designMdContent.split('\n');
  let inSpacing = false;
  let inTypography = false;

  function flushHeader(trimmed) {
    if (trimmed === '### Spacing') { inSpacing = true; inTypography = false; return true; }
    if (trimmed === '### Typography') { inSpacing = false; inTypography = true; return true; }
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) { inSpacing = false; inTypography = false; return true; }
    return false;
  }

  // @cap-todo(ac:F-068/AC-5) Exactly one line rewritten; return early after hit.
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (flushHeader(trimmed)) continue;

    if (edit.id === 'spacing.scale' && inSpacing) {
      const m = lines[i].match(/^(-\s+scale:\s*)\[([^\]]*)\](.*)$/);
      if (m) {
        lines[i] = `${m[1]}[${_formatScale(edit.value)}]${m[3]}`;
        return lines.join('\n');
      }
    }
    if (edit.id === 'typography.scale' && inTypography) {
      const m = lines[i].match(/^(-\s+scale:\s*)\[([^\]]*)\](.*)$/);
      if (m) {
        lines[i] = `${m[1]}[${_formatScale(edit.value)}]${m[3]}`;
        return lines.join('\n');
      }
    }
    if (edit.id === 'typography.family' && inTypography) {
      const m = lines[i].match(/^(-\s+family:\s*)"([^"]*)"(.*)$/);
      if (m) {
        lines[i] = `${m[1]}"${_asString(edit.value)}"${m[3]}`;
        return lines.join('\n');
      }
    }
    if (edit.id === 'typography.familyMono' && inTypography) {
      const m = lines[i].match(/^(-\s+familyMono:\s*)"([^"]*)"(.*)$/);
      if (m) {
        lines[i] = `${m[1]}"${_asString(edit.value)}"${m[3]}`;
        return lines.join('\n');
      }
    }
  }
  throw new Error(`applySpacingEdit: no match for ${edit.id}`);
}

// @cap-todo(ac:F-068/AC-4) applyComponentEdit: add or remove a variant from a component block.
/**
 * Add or remove a variant from the variants list of a component (DC-NNN).
 * @param {string} designMdContent
 * @param {{id: string, variant: string, action: 'add'|'remove'}} edit
 * @returns {string}
 */
function applyComponentEdit(designMdContent, edit) {
  if (typeof designMdContent !== 'string') throw new Error('applyComponentEdit: content must be a string');
  if (!edit || typeof edit.id !== 'string' || typeof edit.variant !== 'string' || (edit.action !== 'add' && edit.action !== 'remove')) {
    throw new Error('applyComponentEdit: edit.id, edit.variant, edit.action required');
  }
  _validateId(edit.id, /^DC-\d{3,}$/, 'DC-NNN');
  const variant = edit.variant.trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(variant)) {
    throw new Error(`applyComponentEdit: variant "${edit.variant}" contains invalid characters (allowed: [a-zA-Z0-9_-], max 32 chars)`);
  }

  const lines = designMdContent.split('\n');
  // Locate the component header line carrying (id: DC-NNN), then find the first "- variants: [...]" line after it
  // before the next ### / ## boundary.
  const headerRe = new RegExp(`^###\\s+.*\\(id:\\s*${_escapeReg(edit.id)}\\)\\s*$`);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error(`applyComponentEdit: component ${edit.id} not found`);
  }
  let variantsIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) break;
    if (/^-\s+variants:\s*\[/.test(lines[i])) { variantsIdx = i; break; }
  }
  if (variantsIdx === -1) {
    throw new Error(`applyComponentEdit: variants list for ${edit.id} not found`);
  }

  const m = lines[variantsIdx].match(/^(-\s+variants:\s*)\[([^\]]*)\](.*)$/);
  if (!m) throw new Error(`applyComponentEdit: could not parse variants line for ${edit.id}`);

  const prefix = m[1];
  const inside = m[2];
  const tail = m[3];
  const existing = inside.split(',').map(s => s.trim()).filter(s => s.length > 0);

  let next;
  if (edit.action === 'add') {
    if (existing.includes(variant)) return designMdContent; // no-op, zero-diff
    next = existing.concat([variant]);
  } else {
    if (!existing.includes(variant)) return designMdContent; // no-op
    next = existing.filter(v => v !== variant);
  }
  lines[variantsIdx] = `${prefix}[${next.join(', ')}]${tail}`;
  return lines.join('\n');
}

// ===========================================================================
//  Editor UI — rendered only when `editable` is true
// ===========================================================================

// @cap-todo(ac:F-068/AC-1) Editor section is gated on `editable`. When false → empty string → no UI drift.
// @cap-todo(ac:F-068/AC-2) Color-picker per DT-NNN token with type color.
// @cap-todo(ac:F-068/AC-3) Range slider for spacing/typography scales.
// @cap-todo(ac:F-068/AC-4) Variant add/remove per DC-NNN component.
/**
 * Build the DESIGN.md editor section. Returns '' when editable=false.
 * @param {{ designMd: string|null, designData?: Object, editable: boolean }} params
 * @returns {string} HTML
 */
function buildEditorSection(params) {
  const editable = !!(params && params.editable);
  if (!editable) return '';
  const designMd = (params && params.designMd) || null;
  if (!designMd) {
    return `
<section class="cap-section" id="design-editor" data-cap-editor="1">
  <h2>Design Editor</h2>
  <p class="empty">No DESIGN.md found. Run /cap:design --new before editing.</p>
</section>`;
  }

  const ids = safeParseDesignIds(designMd);
  const tokenRows = [];
  // @cap-decision(F-068/D7) Only bullets recognisable as "- key: #HEX" get a color-picker.
  //   Non-hex bullets degrade to a read-only display (no widget) so /review and arbitrary string tokens still render.
  for (const id of ids.tokens) {
    const info = ids.byToken[id];
    if (!info) continue;
    const value = (info.value || '').trim();
    const isColor = /^#[0-9a-f]{3,8}$/i.test(value);
    if (isColor) {
      tokenRows.push(`    <tr data-editor-row="color" data-design-id="${escapeHtml(id)}">
      <td>${escapeHtml(id)}</td>
      <td>${escapeHtml(info.key || '')}</td>
      <td><input type="color" value="${escapeHtml(value)}" class="de-color" data-design-id="${escapeHtml(id)}" aria-label="Color picker for ${escapeHtml(info.key || id)}"></td>
      <td><code class="de-value" data-design-id="${escapeHtml(id)}">${escapeHtml(value)}</code></td>
    </tr>`);
    } else {
      tokenRows.push(`    <tr data-editor-row="token-readonly" data-design-id="${escapeHtml(id)}">
      <td>${escapeHtml(id)}</td>
      <td>${escapeHtml(info.key || '')}</td>
      <td class="empty">(non-color token — edit via DESIGN.md)</td>
      <td><code>${escapeHtml(value)}</code></td>
    </tr>`);
    }
  }

  const compRows = [];
  for (const id of ids.components) {
    const info = ids.byComponent[id];
    if (!info) continue;
    const variants = safeExtractVariants(designMd, id);
    const variantPills = variants.map(v =>
      `<span class="de-variant-pill" data-variant="${escapeHtml(v)}"><code>${escapeHtml(v)}</code> <button type="button" class="de-variant-remove" data-design-id="${escapeHtml(id)}" data-variant="${escapeHtml(v)}" aria-label="Remove variant ${escapeHtml(v)}">×</button></span>`
    ).join(' ');
    compRows.push(`    <tr data-editor-row="component" data-design-id="${escapeHtml(id)}">
      <td>${escapeHtml(id)}</td>
      <td>${escapeHtml(info.name || '')}</td>
      <td class="de-variants-cell" data-design-id="${escapeHtml(id)}">${variantPills || '<span class="empty">(no variants)</span>'}</td>
      <td>
        <input type="text" class="de-variant-input" data-design-id="${escapeHtml(id)}" placeholder="new variant" aria-label="New variant for ${escapeHtml(info.name || id)}" maxlength="32">
        <button type="button" class="de-variant-add tn-btn" data-design-id="${escapeHtml(id)}">Add</button>
      </td>
    </tr>`);
  }

  const scaleEditors = buildScaleEditors(designMd);

  return `
<section class="cap-section" id="design-editor" data-cap-editor="1">
  <h2>Design Editor <span class="de-badge">edit mode</span></h2>
  <p class="de-hint">Edits write directly to <code>DESIGN.md</code>. Ctrl+C the server to stop the session.</p>
  <div id="de-status" class="de-status" role="status" aria-live="polite"></div>

  <h3>Color Tokens</h3>
  ${tokenRows.length
    ? `<table class="ac-table de-table"><thead><tr><th>ID</th><th>Key</th><th>Picker</th><th>Value</th></tr></thead><tbody>\n${tokenRows.join('\n')}\n  </tbody></table>`
    : '<p class="empty">No DT-NNN color tokens found.</p>'}

  <h3>Scales</h3>
  ${scaleEditors || '<p class="empty">No scales found in DESIGN.md.</p>'}

  <h3>Components</h3>
  ${compRows.length
    ? `<table class="ac-table de-table"><thead><tr><th>ID</th><th>Name</th><th>Variants</th><th>Add</th></tr></thead><tbody>\n${compRows.join('\n')}\n  </tbody></table>`
    : '<p class="empty">No DC-NNN components found.</p>'}
</section>`;
}

function buildScaleEditors(designMd) {
  const parts = [];
  const spacing = extractScale(designMd, 'Spacing', 'scale');
  if (spacing) {
    parts.push(scaleRow('spacing.scale', 'Spacing', spacing));
  }
  const typoScale = extractScale(designMd, 'Typography', 'scale');
  if (typoScale) {
    parts.push(scaleRow('typography.scale', 'Typography — font size scale', typoScale));
  }
  return parts.join('\n');
}

function scaleRow(id, label, values) {
  const base = Math.max(...values, 1);
  const sliders = values.map((v, idx) =>
    `<label class="de-slider">
      <span class="de-slider-label">[${idx}]</span>
      <input type="range" min="0" max="${Math.max(128, Math.round(base * 2))}" step="1" value="${v}" class="de-scale" data-design-id="${escapeHtml(id)}" data-scale-idx="${idx}">
      <output class="de-scale-out" data-design-id="${escapeHtml(id)}" data-scale-idx="${idx}">${v}</output>
    </label>`
  ).join('\n');
  return `<div class="de-scale-row" data-design-id="${escapeHtml(id)}">
    <div class="de-scale-title">${escapeHtml(label)} (<code>${escapeHtml(id)}</code>)</div>
    ${sliders}
  </div>`;
}

function extractScale(designMd, sectionName, key) {
  const lines = String(designMd || '').split('\n');
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === `### ${sectionName}`) { inSection = true; continue; }
    if (inSection && (trimmed.startsWith('### ') || trimmed.startsWith('## '))) return null;
    if (!inSection) continue;
    const m = lines[i].match(new RegExp(`^-\\s+${_escapeReg(key)}:\\s*\\[([^\\]]*)\\]`));
    if (m) {
      const parts = m[1].split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n));
      if (parts.length > 0) return parts;
    }
  }
  return null;
}

function safeExtractVariants(designMd, componentId) {
  try {
    const lines = String(designMd || '').split('\n');
    const headerRe = new RegExp(`^###\\s+.*\\(id:\\s*${_escapeReg(componentId)}\\)\\s*$`);
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (headerRe.test(lines[i])) { headerIdx = i; break; }
    }
    if (headerIdx === -1) return [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) break;
      const m = lines[i].match(/^-\s+variants:\s*\[([^\]]*)\]/);
      if (m) return m[1].split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

function safeParseDesignIds(designMd) {
  try { return designLib.parseDesignIds(designMd) || { tokens: [], components: [], byToken: {}, byComponent: {} }; }
  catch { return { tokens: [], components: [], byToken: {}, byComponent: {} }; }
}

// ===========================================================================
//  Editor CSS + JS (composed by cap-ui only when editable)
// ===========================================================================

// @cap-todo(ac:F-068/AC-1) Editor CSS composed into buildCss() only when editable.
function buildEditorCss() {
  return `
section.cap-section#design-editor { max-width: 100%; }
#design-editor .de-badge {
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
#design-editor .de-hint { color: var(--fg-muted); font-size: 12px; margin: 4px 0 10px; }
#design-editor .de-status {
  min-height: 18px;
  font-size: 12px;
  padding: 4px 8px;
  margin: 6px 0 10px;
  border-radius: 2px;
  color: var(--fg-muted);
}
#design-editor .de-status.is-ok    { color: var(--state-tested); background: #d8ead9; }
#design-editor .de-status.is-err   { color: var(--accent); background: #fff4ea; border: 1px solid var(--accent-muted); }
#design-editor table.de-table th { white-space: nowrap; }
#design-editor .de-color { width: 44px; height: 28px; border: 1px solid var(--border); cursor: pointer; padding: 0; background: var(--bg-card); }
#design-editor .de-value { color: var(--fg); }
#design-editor .de-variants-cell { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
#design-editor .de-variant-pill {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  background: var(--border);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 11px;
}
#design-editor .de-variant-remove {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
#design-editor .de-variant-remove:hover { color: #9c4530; }
#design-editor .de-variant-input {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 2px;
  width: 160px;
}
#design-editor .de-scale-row {
  border: 1px solid var(--border);
  background: var(--bg-card);
  border-radius: 3px;
  padding: 8px 10px;
  margin: 6px 0;
}
#design-editor .de-scale-title { font-size: 12px; color: var(--fg-muted); margin-bottom: 6px; }
#design-editor .de-slider { display: inline-flex; align-items: center; gap: 6px; margin: 3px 10px 3px 0; font-size: 11px; color: var(--fg-muted); }
#design-editor .de-slider-label { min-width: 22px; }
#design-editor .de-slider input[type=range] { width: 160px; }
#design-editor .de-slider output { color: var(--fg); font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }
`.trim();
}

// @cap-todo(ac:F-068/AC-1) Editor JS composed into buildClientJs() only when editable.
// @cap-decision(F-068/D8) Uses fetch(PUT/DELETE) to /api/design/* endpoints. Endpoint error responses surface via #de-status.
// @cap-decision(F-068/D9) After each successful write the server pushes an SSE 'change' event — full-page reload picks up latest DESIGN.md content.
function buildEditorJs() {
  return `
(function(){
  var root = document.getElementById('design-editor');
  if (!root) return;
  var status = document.getElementById('de-status');

  function flash(kind, msg) {
    if (!status) return;
    status.textContent = msg;
    status.classList.remove('is-ok');
    status.classList.remove('is-err');
    if (kind === 'ok')  status.classList.add('is-ok');
    if (kind === 'err') status.classList.add('is-err');
  }

  function send(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function(res){
      return res.text().then(function(text){
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (_e) { payload = { error: text }; }
        if (!res.ok) {
          var msg = (payload && payload.error) ? payload.error : ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return payload;
      });
    });
  }

  // --- Color picker ---
  root.addEventListener('change', function(e){
    var el = e.target;
    if (el && el.classList && el.classList.contains('de-color')) {
      var id = el.getAttribute('data-design-id');
      var value = el.value;
      send('PUT', '/api/design/color/' + encodeURIComponent(id), { value: value }).then(function(){
        flash('ok', 'Updated ' + id + ' → ' + value);
        var view = root.querySelector('code.de-value[data-design-id="' + id + '"]');
        if (view) view.textContent = value;
      }).catch(function(err){ flash('err', err.message || 'write failed'); });
      return;
    }
    if (el && el.classList && el.classList.contains('de-scale')) {
      var sid = el.getAttribute('data-design-id');
      var idx = parseInt(el.getAttribute('data-scale-idx'), 10);
      var out = root.querySelector('output.de-scale-out[data-design-id="' + sid + '"][data-scale-idx="' + idx + '"]');
      if (out) out.textContent = el.value;
      // Collect the full scale array for this id.
      var inputs = root.querySelectorAll('input.de-scale[data-design-id="' + sid + '"]');
      var arr = [];
      for (var i = 0; i < inputs.length; i++) arr.push(parseFloat(inputs[i].value));
      send('PUT', '/api/design/spacing/' + encodeURIComponent(sid), { value: arr }).then(function(){
        flash('ok', 'Updated ' + sid);
      }).catch(function(err){ flash('err', err.message || 'write failed'); });
    }
  });

  // Live-preview while dragging the slider (no PUT until 'change' fires on release).
  root.addEventListener('input', function(e){
    var el = e.target;
    if (el && el.classList && el.classList.contains('de-scale')) {
      var sid = el.getAttribute('data-design-id');
      var idx = el.getAttribute('data-scale-idx');
      var out = root.querySelector('output.de-scale-out[data-design-id="' + sid + '"][data-scale-idx="' + idx + '"]');
      if (out) out.textContent = el.value;
    }
  });

  // --- Variant add/remove ---
  root.addEventListener('click', function(e){
    var el = e.target;
    if (el && el.classList && el.classList.contains('de-variant-add')) {
      var id = el.getAttribute('data-design-id');
      var input = root.querySelector('input.de-variant-input[data-design-id="' + id + '"]');
      if (!input || !input.value) return;
      var name = input.value;
      send('PUT', '/api/design/component/' + encodeURIComponent(id), { action: 'add', variant: name }).then(function(){
        flash('ok', 'Added variant ' + name + ' to ' + id);
        input.value = '';
      }).catch(function(err){ flash('err', err.message || 'write failed'); });
      return;
    }
    if (el && el.classList && el.classList.contains('de-variant-remove')) {
      var id2 = el.getAttribute('data-design-id');
      var name2 = el.getAttribute('data-variant');
      send('DELETE', '/api/design/component/' + encodeURIComponent(id2) + '/variant/' + encodeURIComponent(name2)).then(function(){
        flash('ok', 'Removed variant ' + name2 + ' from ' + id2);
      }).catch(function(err){ flash('err', err.message || 'write failed'); });
    }
  });
})();
`.trim();
}

// ===========================================================================
//  Internal helpers
// ===========================================================================

function _escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _validateId(id, re, label) { if (!re.test(id)) throw new Error(`invalid id "${id}" (expected ${label})`); }
function _validateColorValue(v) {
  // Accept hex #RGB, #RRGGBB, #RRGGBBAA. Anything else is rejected at the library layer so malformed input
  // never lands in DESIGN.md. (The route layer repeats this check for defense-in-depth.)
  if (!/^#[0-9a-f]{3,8}$/i.test(v)) throw new Error(`invalid color value "${v}" (expected #RGB / #RRGGBB / #RRGGBBAA)`);
}
function _formatScale(value) {
  if (Array.isArray(value)) {
    const cleaned = value.map(v => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
      throw new Error(`invalid scale entry: ${JSON.stringify(v)}`);
    });
    return cleaned.join(', ');
  }
  if (typeof value === 'string') {
    // Accept "4, 8, 16" style strings for convenience.
    const parts = value.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n));
    return parts.join(', ');
  }
  throw new Error('scale value must be an array of numbers');
}
function _asString(value) {
  if (typeof value === 'string') return value.replace(/"/g, '\\"');
  throw new Error('expected string value');
}

module.exports = {
  DESIGN_FILE,
  checkContainment,
  atomicWriteDesign,
  applyColorEdit,
  applySpacingEdit,
  applyComponentEdit,
  buildEditorSection,
  buildEditorCss,
  buildEditorJs,
  // Helpers exported for tests.
  _extractScale: extractScale,
  _extractVariants: safeExtractVariants,
};
