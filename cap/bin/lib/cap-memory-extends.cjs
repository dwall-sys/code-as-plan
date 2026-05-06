// @cap-feature(feature:F-078, primary:true) Extends-Chain Resolver — resolves
// `extends: platform/<topic>` chains across per-feature memory files in a single lookup pass,
// with explicit cycle detection.
//
// @cap-context Per-Feature memory files (F-076) carry an optional `extends: platform/<topic>`
// frontmatter field (defined in cap-memory-schema.cjs:EXTENDS_RE). F-078/AC-3 says the reader
// MUST resolve those chains in a SINGLE pass — no recursive expansion that could blow up on
// pathological input, no per-feature partial-merge that could shadow upstream errors.
//
// @cap-context F-078/AC-5 says cycles MUST be rejected with the FULL chain in the error message
// (e.g. `F-070 → platform/A → platform/B → platform/A`), not a generic "cycle detected".
// That's testable in the error-string assertion, and it's the difference between a 30-second
// fix and an hour of debugging.
//
// @cap-decision(F-078/AC-3) Single-pass resolution: walk the extends chain iteratively with a
// visited-set, accumulating layers in order. Depth-bound at MAX_CHAIN_DEPTH (8) as a hard
// safety net — even if the cycle detector somehow missed a cycle, the depth cap fails loud
// instead of looping. This is defense-in-depth, not the primary detector.

'use strict';

const path = require('node:path');

const schema = require('./cap-memory-schema.cjs');
const platformLib = require('./cap-memory-platform.cjs');

// -------- Constants --------

// @cap-decision(F-078/D8) Hard cap on chain depth — any project that legitimately needs >8
// levels of platform extends has bigger problems than this resolver. The cap exists so a
// hostile input (a cycle that the visited-set somehow missed) can't loop forever.
const MAX_CHAIN_DEPTH = 8;

// @cap-decision(F-078/iter1) Stage-2 #1 fix: ANSI defense extended to extends-resolver.
// User-controlled bytes (extendsRef from frontmatter, ref strings shown in cycle-paths and
// dangling-warnings) flow into error/warning messages that are typically piped to a terminal.
// Without sanitization, an attacker-authored memory file containing ANSI escape bytes could
// recolor or truncate operator-visible output. We mirror the helper from cap-memory-platform.cjs
// rather than importing it: keeping the defense local to each module avoids a fragile coupling
// where someone refactors platform's helper out from under us. Both modules share the SAME
// behavior — strip non-printable bytes outside `0x20-0x7E`, slice to 64 chars.
function _safeForError(value) {
  if (typeof value !== 'string') return String(value);
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 64);
}

// @cap-decision(F-078/iter1) Stage-2 #2 fix helper: deep-clone YAML-derived frontmatter
// while preserving null-prototype on the returned object. JSON-roundtrip handles the
// nested arrays/objects (frontmatter is plain-data only — no Date, RegExp, Map, etc.),
// then we re-create with `Object.create(null)` to keep the proto-pollution defense.
function _deepCloneFrontmatter(src) {
  if (!src || typeof src !== 'object') return Object.create(null);
  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(src));
  } catch (_e) {
    cloned = {};
  }
  const out = Object.create(null);
  for (const k of Object.keys(cloned)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = cloned[k];
  }
  return out;
}

// -------- Typedefs --------

/**
 * @typedef {Object} ExtendsLayer
 * @property {'feature'|'platform'} kind
 * @property {string} ref - "F-NNN" or "platform/<topic>"
 * @property {string} path - filesystem path the layer was loaded from
 * @property {boolean} exists - true if the file was found and loaded
 * @property {import('./cap-memory-schema.cjs').FeatureMemoryFile|null} file - parsed file, or null if missing
 */

/**
 * @typedef {Object} ResolveResult
 * @property {boolean} ok - true if resolution succeeded; false if a cycle was detected
 * @property {ExtendsLayer[]} layers - ordered chain of resolved layers; first = root, last = deepest extends
 * @property {string[]} chain - human-readable chain of refs (e.g. ["F-070", "platform/A", "platform/B"])
 * @property {string[]} warnings - non-fatal warnings (e.g. dangling extends)
 * @property {string|null} error - cycle path or other fatal error, null on success
 * @property {string|null} cyclePath - "F-070 → platform/A → platform/A" formatted chain, null if no cycle
 */

// -------- Reference helpers --------

/**
 * Parse an extends-ref string into kind + ref components.
 * Currently only `platform/<topic>` is supported (mirrors EXTENDS_RE in the schema).
 * @param {string} ref
 * @returns {{kind:'platform', topic:string}|null}
 */
function parseExtendsRef(ref) {
  if (typeof ref !== 'string') return null;
  const m = ref.match(/^platform\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (!m) return null;
  return { kind: 'platform', topic: m[1] };
}

/**
 * Build a stable visited-set key for a layer ref (used in cycle detection).
 * @param {string} ref
 * @returns {string}
 */
function _refKey(ref) {
  return ref;
}

// -------- Loaders --------

/**
 * Load the layer at `extendsRef` (currently always platform). Returns the layer record
 * regardless of whether the underlying file exists — caller decides whether to treat
 * a dangling extends as fatal (we don't; we soft-warn per F-078 spec gap).
 *
 * @param {string} projectRoot
 * @param {string} extendsRef - e.g. "platform/observability"
 * @returns {ExtendsLayer}
 */
function loadLayer(projectRoot, extendsRef) {
  const parsed = parseExtendsRef(extendsRef);
  if (!parsed) {
    // Caller has already validated the ref shape via the schema's EXTENDS_RE, so this is a
    // defensive fallback: return a layer with exists=false so the resolver can warn cleanly.
    return {
      kind: 'platform',
      ref: extendsRef,
      path: '',
      exists: false,
      file: null,
    };
  }
  const loaded = platformLib.loadPlatformTopic(projectRoot, parsed.topic);
  return {
    kind: 'platform',
    ref: extendsRef,
    path: loaded.path,
    exists: loaded.exists,
    file: loaded.file,
  };
}

// -------- Core resolver --------

// @cap-todo(ac:F-078/AC-3) resolveExtends walks the extends-chain in a SINGLE pass and returns
//   the ordered layer list. Per-feature file is layer[0]; each platform extends is appended.
// @cap-todo(ac:F-078/AC-5) resolveExtends detects cycles via a visited-set keyed on the
//   normalized ref string. Cycle path is rendered with `→` separators so the error message
//   contains the FULL chain, not just "cycle detected".
// @cap-risk(reason:cycle-mishandling-corrupts-resolved-view) If the visited-set check fires
//   AFTER pushing the layer (not before), the cycle path would be off-by-one and could leak
//   the duplicate entry into the merged view. Order matters: check FIRST, then push.

/**
 * Resolve a per-feature memory file's extends chain into an ordered layer list.
 * Pure-ish: reads files via cap-memory-platform's loaders, but does not write.
 *
 * @param {string} projectRoot
 * @param {string} perFeaturePath - absolute path to a .cap/memory/features/F-NNN-<topic>.md file
 * @returns {ResolveResult}
 */
function resolveExtends(projectRoot, perFeaturePath) {
  /** @type {ResolveResult} */
  const result = {
    ok: true,
    layers: [],
    chain: [],
    warnings: [],
    error: null,
    cyclePath: null,
  };
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    result.ok = false;
    result.error = 'projectRoot must be a non-empty string';
    return result;
  }
  if (typeof perFeaturePath !== 'string' || perFeaturePath.length === 0) {
    result.ok = false;
    result.error = 'perFeaturePath must be a non-empty string';
    return result;
  }

  // 1. Load the root (per-feature) file. We don't go through getFeaturePath here because the
  //    caller might pass an arbitrary absolute path; the schema parser handles a missing file
  //    via parseFeatureMemoryFile only if we read it ourselves.
  const fs = require('node:fs');
  let rootRaw;
  try {
    rootRaw = fs.readFileSync(perFeaturePath, 'utf8');
  } catch (e) {
    result.ok = false;
    result.error = `failed to read root file ${perFeaturePath}: ${e && e.message ? e.message : String(e)}`;
    return result;
  }
  let rootFile;
  try {
    rootFile = schema.parseFeatureMemoryFile(rootRaw);
  } catch (e) {
    result.ok = false;
    result.error = `failed to parse root file ${perFeaturePath}: ${e && e.message ? e.message : String(e)}`;
    return result;
  }
  // Derive a chain-display ref for the root layer. Prefer `feature` from frontmatter, else
  // the basename without extension. This is purely cosmetic — the cycle detector keys on
  // the platform refs, which are unique on their own.
  const rootRef = (rootFile.frontmatter && typeof rootFile.frontmatter.feature === 'string'
    && rootFile.frontmatter.feature.length > 0)
    ? rootFile.frontmatter.feature
    : path.basename(perFeaturePath, '.md');
  result.layers.push({
    kind: 'feature',
    ref: rootRef,
    path: perFeaturePath,
    exists: true,
    file: rootFile,
  });
  result.chain.push(rootRef);

  // 2. Single-pass walk of the extends chain.
  // @cap-decision(F-078/AC-5) visited-set keys on the platform-ref string. The root feature
  // ref is NOT added to the visited-set because a per-feature file referencing itself is
  // structurally impossible (extends only points at platform/), and re-using the root ref
  // would produce a confusing duplicate entry in the displayed cycle path.
  const visited = new Set();
  let current = rootFile;
  let depth = 0;
  // @cap-decision(F-078/iter1) Stage-2 #3 fix: drop double 'platform/' prefix in
  // malformed-extends message. Track the *previous* layer's ref explicitly so the
  // mid-chain malformed-extends error names the actual parent file (already a full
  // ref like `platform/a`) instead of synthesizing `'platform/' + lastVisited`, which
  // double-prefixed because visited entries are already full refs. The variable starts
  // empty and is updated AFTER each successful push so it always points at the layer
  // whose `extends:` field we're currently validating.
  let lastRef = '';
  while (current && current.frontmatter && current.frontmatter.extends) {
    const extendsRef = String(current.frontmatter.extends).trim();
    if (extendsRef === '') break;

    // @cap-risk Validate the ref shape via the same regex the schema uses, so a malformed
    // extends value (e.g. `extends: ../../etc/passwd`) is rejected here too. parseExtendsRef
    // returns null on shape failure; we then surface a hard error rather than a soft warn,
    // because a malformed extends is an authoring bug, not a missing-file condition.
    const parsed = parseExtendsRef(extendsRef);
    if (!parsed) {
      result.ok = false;
      // @cap-decision(F-078/iter1) Stage-2 #1 fix: ANSI defense extended to extends-resolver.
      // Both extendsRef (user-controlled frontmatter) and lastRef (also a user-derived
      // upstream ref) are sanitized before interpolation. perFeaturePath is operator-supplied,
      // not user-controlled, but we sanitize it anyway as defense-in-depth — log-injection
      // class issues compound when even one slot is unsanitized.
      const inLocation = current === rootFile
        ? _safeForError(perFeaturePath)
        : _safeForError(lastRef || '?');
      result.error = `invalid extends ref "${_safeForError(extendsRef)}" in ${inLocation} (must match platform/<topic>)`;
      return result;
    }

    // @cap-decision(F-078/AC-5) Cycle check FIRST, then push. Reverse order would let the
    // duplicate slip into result.layers.
    if (visited.has(_refKey(extendsRef))) {
      // Cycle: build a display chain that includes the duplicate ref at the end so the
      // user sees the loop close visually.
      // @cap-decision(F-078/iter1) Stage-2 #1 fix: defense-in-depth — sanitize each ref in
      // the cycle path before joining. parseExtendsRef anchors the topic shape, so refs
      // SHOULD already be ANSI-clean, but the chain[0] is the ROOT ref which is derived
      // from `frontmatter.feature` or basename — both user-controlled paths.
      const cyclePath = [...result.chain, extendsRef].map(_safeForError).join(' → ');
      result.ok = false;
      result.cyclePath = cyclePath;
      result.error = `cycle detected in extends chain: ${cyclePath}`;
      return result;
    }

    if (depth >= MAX_CHAIN_DEPTH) {
      // Safety net — cycle detector should always catch this first, but if not, fail loud.
      result.ok = false;
      result.cyclePath = [...result.chain, extendsRef].map(_safeForError).join(' → ');
      result.error = `extends chain exceeds max depth ${MAX_CHAIN_DEPTH}: ${result.cyclePath}`;
      return result;
    }

    visited.add(_refKey(extendsRef));

    // Load the next layer.
    const layer = loadLayer(projectRoot, extendsRef);
    result.layers.push(layer);
    result.chain.push(extendsRef);

    if (!layer.exists || !layer.file) {
      // @cap-decision(F-078/spec-gap) Dangling extends is SOFT-warn, not fatal. Reasoning:
      // the spec says "validate that referenced topic exists OR deferred-warning if not
      // (don't hard-block on dangling extends)". A platform topic might be created in a
      // sibling PR, and a hard-block here would force ordering between PRs. The resolved
      // view excludes the dangling layer (we don't push the missing file's content into
      // any merged-view), but the chain still records that we attempted the link.
      // @cap-decision(F-078/iter1) Stage-2 #1 fix: ANSI-sanitize the ref + path in the
      // dangling warning text. layer.path is derived from a sanitized topic (via the
      // platform path helper), so already clean — but defense-in-depth is cheap.
      result.warnings.push(`dangling extends: ${_safeForError(extendsRef)} (file not found at ${_safeForError(layer.path)})`);
      break;
    }

    // Continue walking from the layer we just loaded. Update lastRef AFTER push so a
    // subsequent malformed-extends error names this layer (the parent of the bad ref).
    lastRef = extendsRef;
    current = layer.file;
    depth += 1;
  }

  return result;
}

// -------- Merged view --------

// @cap-decision(F-078/spec-gap) Merge semantics: when collapsing the layer chain into a
// single view, AUTO-block decisions/pitfalls CONCAT (preserve all sources, deduped on
// `text + location` to avoid noise on re-runs). FRONTMATTER fields use OVERRIDE-from-root
// (the per-feature file wins on conflict) — the per-feature file is the authoritative
// authoring point. The MANUAL-block raw text is NOT merged: it lives only on the root file
// (extending platform manual lessons would be confusing on re-runs and is out of scope for
// AC-3 which only asks for the chain to RESOLVE, not for a fully-merged authoring view).

/**
 * Collapse a resolved extends chain into a single merged view (concat auto-block, override
 * frontmatter from root, manual-block from root only).
 *
 * @param {ResolveResult} resolved
 * @returns {{frontmatter:Object, autoBlock:{decisions:Array<{text:string,location:string}>, pitfalls:Array<{text:string,location:string}>}, manualBlock:{raw:string}, layerCount:number}}
 */
function mergeResolvedView(resolved) {
  if (!resolved || !resolved.ok) {
    throw new Error('mergeResolvedView: cannot merge an unresolved chain');
  }
  const layers = resolved.layers || [];
  if (layers.length === 0) {
    return {
      frontmatter: Object.create(null),
      autoBlock: { decisions: [], pitfalls: [] },
      manualBlock: { raw: '' },
      layerCount: 0,
    };
  }
  const root = layers[0];
  // @cap-decision(F-078/iter1) Stage-2 #2 fix: deep-clone frontmatter on merge (F-082 lesson).
  // Object.assign was a shallow copy — array values (`related_features`, `key_files`) shared
  // their references with the parsed source file. A caller doing
  // `merged.frontmatter.related_features.push(...)` would silently mutate the upstream parsed
  // file. Frontmatter is YAML-derived plain data (strings, numbers, arrays of strings),
  // never functions or class instances, so JSON-roundtrip is safe and avoids the
  // structuredClone+`Object.create(null)` proto-edge-case (structuredClone preserves the
  // null-prototype, which we want, but the JSON path is the simpler proven contract here).
  // We then re-prototype the result with `Object.create(null)` to keep the same proto-poison
  // defense the original code provided.
  const frontmatter = _deepCloneFrontmatter(root.file ? root.file.frontmatter : {});
  const seen = new Set();
  const decisions = [];
  const pitfalls = [];

  // Walk DEEPEST to ROOT so the root layer's entries appear last (most-recent-wins display
  // order). On dedup, the LATER write wins because we check `seen` before pushing — but
  // since dedup is keyed on text+location, "winner" is irrelevant anyway.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.file || !layer.file.autoBlock) continue;
    for (const d of layer.file.autoBlock.decisions || []) {
      const k = `D|${d.text}|${d.location}`;
      if (seen.has(k)) continue;
      seen.add(k);
      decisions.push({ text: d.text, location: d.location, sourceRef: layer.ref });
    }
    for (const p of layer.file.autoBlock.pitfalls || []) {
      const k = `P|${p.text}|${p.location}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pitfalls.push({ text: p.text, location: p.location, sourceRef: layer.ref });
    }
  }

  return {
    frontmatter,
    autoBlock: { decisions, pitfalls },
    manualBlock: { raw: root.file ? (root.file.manualBlock ? root.file.manualBlock.raw : '') : '' },
    layerCount: layers.length,
  };
}

// -------- Exports --------

module.exports = {
  resolveExtends,
  mergeResolvedView,
  parseExtendsRef,
  loadLayer,
  MAX_CHAIN_DEPTH,
};
