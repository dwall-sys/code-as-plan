// @cap-feature(feature:F-029) Cross-File Memory Directory — write aggregated memory to .cap/memory/ markdown files
// @cap-decision .cap/memory/ is git-tracked (not gitignored) — project memory persists across clones and team members.
// @cap-decision Stable anchor IDs derived from content hash — cross-reference links survive regeneration.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

// @cap-history(sessions:4, edits:12, since:2026-04-20, learned:2026-05-08) Frequently modified — 4 sessions, 12 edits
// @cap-history(sessions:2, edits:3, since:2026-04-20, learned:2026-04-21) Frequently modified — 2 sessions, 3 edits
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const confidence = require('./cap-memory-confidence.cjs');

// --- Constants ---

const MEMORY_DIR = path.join('.cap', 'memory');

const CATEGORY_FILES = {
  decision: 'decisions.md',
  hotspot: 'hotspots.md',
  pitfall: 'pitfalls.md',
  pattern: 'patterns.md',
};

// --- Anchor Generation (AC-6) ---

// @cap-todo(ref:F-029:AC-6) Generate stable anchor IDs so cross-reference links remain valid across regenerations

/**
 * Generate a stable anchor ID from entry content.
 * Uses first 8 chars of SHA-256 hash of normalized content.
 * @param {string} content
 * @returns {string} Anchor ID (e.g., "a3f2b1c0")
 */
function generateAnchorId(content) {
  const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 8);
}

// --- Markdown Generation ---

// @cap-todo(ref:F-029:AC-1) Write to .cap/memory/ as four markdown files
// @cap-todo(ref:F-029:AC-3) Each entry includes source session date, related files, summary

/**
 * Generate markdown content for a memory category file.
 * @param {string} category
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries
 * @param {{ minConfidence?: number }} [opts] - F-090: confidence threshold (default 0.6)
 * @returns {string}
 */
function generateCategoryMarkdown(category, entries, opts = {}) {
  const title = category.charAt(0).toUpperCase() + category.slice(1) + 's';
  const out = [];
  out.push(`# Project Memory: ${title}`);
  out.push('');
  out.push(`> Auto-generated from code tags and session data. Pinned entries are preserved; others may be updated on regeneration.`);
  out.push(`> Last updated: ${new Date().toISOString().substring(0, 10)}`);
  out.push('');

  if (entries.length === 0) {
    out.push(`_No ${category}s recorded yet._`);
    return out.join('\n');
  }

  if (category === 'hotspot') {
    return generateHotspotsMarkdown(out, entries);
  }

  // @cap-feature(feature:F-090, primary:true) Confidence-filter: drop low-signal entries from
  //   the .md output so agents reading the file at session-start don't ingest 568 KB of
  //   Confidence:0.50/Evidence:1 heuristic-extracted comment text. graph.json stays full
  //   (Cluster/Affinity components need every node); the filter only reduces the human/agent-
  //   readable .md surface.
  // @cap-decision(F-090/separation-of-concerns) generateCategoryMarkdown defaults to 0 (no filter)
  //   so it stays a pure rendering function — render-correctness tests don't have to think about
  //   the filter. writeMemoryDirectory (the pipeline entry point) defaults to 0.6 to apply the
  //   policy. Callers who want filtered rendering pass minConfidence explicitly.
  const minConfidence =
    typeof opts.minConfidence === 'number' ? opts.minConfidence : 0;
  const filtered = _filterEntriesForOutput(entries, { minConfidence });
  const droppedCount = entries.length - filtered.length;

  if (filtered.length === 0) {
    out.push(`_No high-confidence ${category}s recorded yet (filtered out ${droppedCount} low-confidence ${category}s)._`);
    return out.join('\n');
  }

  // Default: list format for decisions, pitfalls, patterns
  for (const entry of filtered) {
    const anchor = generateAnchorId(entry.content);
    // Newlines or CRs in entry content would fracture into phantom entries on the next readMemoryFile pass and could smuggle a fake anchor heading. Collapse on the write path so the Markdown grammar stays one-entry-per-heading.
    const safeContent = String(entry.content).replace(/[\r\n]+/g, ' ');
    const pinTag = entry.metadata.pinned ? ' **[pinned]**' : '';
    const date = entry.metadata.source ? entry.metadata.source.substring(0, 10) : 'unknown';
    const files = entry.metadata.relatedFiles?.length > 0
      ? entry.metadata.relatedFiles.map(f => `\`${f}\``).join(', ')
      : 'cross-cutting';
    const features = entry.metadata.features?.length > 0
      ? ` (${entry.metadata.features.join(', ')})`
      : '';

    // @cap-todo(ac:F-055/AC-1) Confidence + evidence_count rendered as entry-block bullets.
    // @cap-todo(ac:F-055/AC-3) ensureFields supplies defaults for entries that predate F-055.
    const fields = confidence.ensureFields(entry.metadata);
    // @cap-todo(ac:F-055/AC-6) Entries with confidence<0.3 render as a blockquote prefixed with "*(low confidence)*".
    const dim = confidence.isLowConfidence(entry.metadata);
    const prefix = dim ? '> ' : '';
    const dimMarker = dim ? '*(low confidence)* ' : '';

    out.push(`${prefix}### <a id="${anchor}"></a>${dimMarker}${safeContent}${pinTag}`);
    out.push(dim ? '>' : '');
    out.push(`${prefix}- **Date:** ${date}${features}`);
    out.push(`${prefix}- **Files:** ${files}`);
    out.push(`${prefix}- **Confidence:** ${fields.confidence.toFixed(2)}`);
    out.push(`${prefix}- **Evidence:** ${fields.evidence_count}`);
    // @cap-todo(ac:F-056/AC-3) Last Seen bullet written so the decay clock roundtrips through disk.
    out.push(`${prefix}- **Last Seen:** ${fields.last_seen}`);
    if (entry.metadata.confirmations) {
      out.push(`${prefix}- **Confirmed:** ${entry.metadata.confirmations} times`);
    }
    out.push('');
  }

  out.push(`---`);
  // @cap-feature(feature:F-090) Footer-Counter shows kept + filtered counts so the user can
  //   tell at a glance how aggressive the confidence filter was on this run.
  if (droppedCount > 0) {
    out.push(`*${filtered.length} ${category}s kept (filtered out ${droppedCount} low-confidence ${category}s; threshold=${minConfidence})*`);
  } else {
    out.push(`*${filtered.length} ${category}s total*`);
  }
  return out.join('\n');
}

// @cap-feature(feature:F-090) Pure filter for V5 monolithic Memory output.
// @cap-decision(F-090/AC-1) Filter rule: keep entry IFF (pinned OR confidence >= threshold).
//   evidence_count is implicit in confidence (each re-observation +0.1, default 0.5), so a
//   single check on confidence captures both "trustworthy" (high confidence) and "user-curated"
//   (pinned) signals. evidence-only entries without re-observation are noise by definition.
// @cap-decision(F-090/AC-5) Defense-in-depth: pinned wins regardless of confidence value.
//   A pinned entry with confidence:0.0 (e.g. user-suppressed via contradiction) is still
//   user-curated content and must round-trip to disk.
/**
 * Filter memory entries for .md output. graph.json is built independently and not affected.
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries
 * @param {{ minConfidence: number }} options
 * @returns {import('./cap-memory-engine.cjs').MemoryEntry[]}
 */
function _filterEntriesForOutput(entries, options) {
  const threshold = options.minConfidence;
  const out = [];
  for (const entry of entries) {
    if (!entry || !entry.metadata) continue;
    if (entry.metadata.pinned === true) { out.push(entry); continue; }
    const fields = confidence.ensureFields(entry.metadata);
    if (typeof fields.confidence === 'number' && fields.confidence >= threshold) {
      out.push(entry);
    }
  }
  return out;
}

// @cap-todo(ref:F-029:AC-4) hotspots.md ranks files by cross-session edit frequency

/**
 * Generate hotspots markdown with ranking table.
 * @param {string[]} out - Output lines (header already added)
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries
 * @returns {string}
 */
function generateHotspotsMarkdown(out, entries) {
  // Sort by sessions desc, then edits desc
  const sorted = [...entries].sort((a, b) => {
    const sDiff = (b.metadata.sessions || 0) - (a.metadata.sessions || 0);
    if (sDiff !== 0) return sDiff;
    return (b.metadata.edits || 0) - (a.metadata.edits || 0);
  });

  out.push('| Rank | File | Sessions | Edits | Since |');
  out.push('|------|------|----------|-------|-------|');

  // Newlines or stray pipes in entry.file / metadata.since would fracture the
  // markdown table into invalid rows. Parallel to the list-writer in
  // generateCategoryMarkdown that collapses \r\n in entry.content.
  const cellSanitize = (v) => String(v ?? '?').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

  sorted.forEach((entry, i) => {
    const anchor = generateAnchorId(entry.content + entry.file);
    const file = cellSanitize(entry.file);
    const sessions = cellSanitize(entry.metadata.sessions || '?');
    const edits = cellSanitize(entry.metadata.edits || '?');
    const since = cellSanitize(entry.metadata.since || '?');
    out.push(`| <a id="${anchor}"></a>${i + 1} | \`${file}\` | ${sessions} | ${edits} | ${since} |`);
  });

  out.push('');
  out.push(`---`);
  out.push(`*${entries.length} hotspots total*`);
  return out.join('\n');
}

// --- File I/O ---

// @cap-todo(ref:F-029:AC-2) Auto-generated — manual edits outside pinned entries overwritten
// @cap-todo(ref:F-029:AC-7) .cap/memory/ is git-committable (not gitignored)

/**
 * Parse existing memory entries from a markdown file to support merging.
 * Extracts anchor IDs to detect already-known entries.
 * @param {string} content - Markdown file content
 * @returns {Set<string>} Set of anchor IDs already present
 */
function parseExistingAnchors(content) {
  const anchors = new Set();
  const re = /<a id="([a-f0-9]+)"><\/a>/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    anchors.add(match[1]);
  }
  return anchors;
}

/**
 * Write all memory category files to .cap/memory/.
 * Supports merge mode: new entries are added to existing files, duplicates skipped by anchor ID.
 * @param {string} projectRoot - Project root directory
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} entries - All memory entries
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, return content without writing
 * @param {boolean} [options.merge] - If true, merge with existing entries instead of overwriting
 * @returns {{files: Object<string, string>, written: number}}
 */
function writeMemoryDirectory(projectRoot, entries, options = {}) {
  // @cap-feature(feature:F-093, primary:true) Layout dispatch: V5 monolithic (default) or V6 per-feature.
  //   V6 mode is opt-in via .cap/config.json: { memory: { layout: 'v6' } }. Without the flag
  //   behaviour is byte-identical to pre-F-093 (legacy callers and tests stay green).
  if (_isV6LayoutEnabled(projectRoot, options)) {
    return _writeMemoryV6(projectRoot, entries, options);
  }
  const memDir = path.join(projectRoot, MEMORY_DIR);
  const files = {};
  let written = 0;

  // Group entries by category
  const grouped = { decision: [], hotspot: [], pitfall: [], pattern: [] };
  for (const entry of entries) {
    const cat = entry.category;
    if (grouped[cat]) grouped[cat].push(entry);
  }

  // In merge mode, read existing files and skip entries with matching anchor IDs
  const existingFiles = options.merge ? readMemoryDirectory(projectRoot) : {};

  for (const [category, categoryEntries] of Object.entries(grouped)) {
    const filename = CATEGORY_FILES[category];

    // If merging: filter out entries whose anchor already exists
    let entriesToWrite = categoryEntries;
    if (options.merge && existingFiles[filename]) {
      const existingAnchors = parseExistingAnchors(existingFiles[filename]);
      entriesToWrite = categoryEntries.filter(entry => {
        const anchor = category === 'hotspot'
          ? generateAnchorId(entry.content + entry.file)
          : generateAnchorId(entry.content);
        return !existingAnchors.has(anchor);
      });

      // For hotspots: always regenerate fully (session counts change)
      if (category === 'hotspot') {
        entriesToWrite = categoryEntries;
      }
    }

    // @cap-feature(feature:F-090) Forward minConfidence option to the generator. graph.json
    //   is built separately from the same entries[] input — no filter applied there.
    // @cap-decision(F-090) Default = 0 (no filter) preserves backwards-compat for direct
    //   callers (tests, CLI tools). The HOOK (hooks/cap-memory.js) applies the policy by
    //   passing minConfidence:0.6 explicitly — that's where the agent-facing token-cost-of-read
    //   problem manifests, so that's where the policy lives.
    const content = generateCategoryMarkdown(
      category,
      category === 'hotspot' ? entriesToWrite : categoryEntries,
      { minConfidence: options.minConfidence }
    );
    files[filename] = content;

    if (!options.dryRun) {
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, filename), content, 'utf8');
      written++;
    }
  }

  return { files, written };
}

/**
 * Read existing memory directory entries (for merging with pinned entries).
 * @param {string} projectRoot
 * @returns {Object<string, string>} filename -> content
 */
function readMemoryDirectory(projectRoot) {
  const memDir = path.join(projectRoot, MEMORY_DIR);
  const result = {};

  if (!fs.existsSync(memDir)) return result;

  for (const [, filename] of Object.entries(CATEGORY_FILES)) {
    const fp = path.join(memDir, filename);
    if (fs.existsSync(fp)) {
      result[filename] = fs.readFileSync(fp, 'utf8');
    }
  }

  return result;
}

// @cap-todo(ref:F-029:AC-5) Code annotations include cross-reference link to memory file section

/**
 * Generate a cross-reference string for an annotation pointing to the memory directory.
 * @param {import('./cap-memory-engine.cjs').MemoryEntry} entry
 * @returns {string} e.g., "see .cap/memory/decisions.md#a3f2b1c0"
 */
function getCrossReference(entry) {
  const filename = CATEGORY_FILES[entry.category];
  if (!filename) return '';
  const anchor = entry.category === 'hotspot'
    ? generateAnchorId(entry.content + entry.file)
    : generateAnchorId(entry.content);
  return `see .cap/memory/${filename}#${anchor}`;
}

// --- Per-file Parser (F-055) ---

// @cap-feature(feature:F-055) readMemoryFile parses a single category markdown back into structured entries, applying lazy AC-3 migration for pre-F-055 files.
// @cap-decision Lightweight line-oriented parser rather than a full markdown AST — the write-side format is fixed and deterministic, so a state machine over bullet prefixes is both sufficient and robust to ad-hoc editing (dim-prefixes, pinned tags).

/**
 * Parse a single .cap/memory/{category}.md file back into structured entries.
 * Applies ensureFields() on every parsed entry so pre-F-055 files migrate silently (AC-3).
 *
 * Hotspots use a different format (ranking table) and are intentionally not parsed here —
 * the pipeline regenerates them fully each run from session data.
 *
 * @param {string} filePath - Absolute path to a decisions.md / pitfalls.md / patterns.md file
 * @returns {{entries: Array<{content:string, metadata:Object, anchor:string|null}>}}
 */
function readMemoryFile(filePath) {
  if (!fs.existsSync(filePath)) return { entries: [] };
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  const entries = [];
  let current = null;

  const stripQuote = (line) => line.replace(/^>\s?/, '');

  const flush = () => {
    if (!current) return;
    // @cap-todo(ac:F-055/AC-3) Missing confidence/evidence_count fields get defaulted silently on read.
    current.metadata = confidence.ensureFields(current.metadata);
    entries.push(current);
    current = null;
  };

  for (let rawLine of lines) {
    const quoted = rawLine.startsWith('>');
    const line = quoted ? stripQuote(rawLine) : rawLine;

    // Heading opens a new entry: "### <a id="HASH"></a>[*(low confidence)* ]Content[ **[pinned]**]"
    const headingMatch = line.match(/^###\s+<a id="([a-f0-9]+)"><\/a>\s*(.*)$/);
    if (headingMatch) {
      flush();
      let title = headingMatch[2].trim();
      // Strip dim marker + pinned suffix from the displayed content.
      const dim = title.startsWith('*(low confidence)*');
      if (dim) title = title.slice('*(low confidence)*'.length).trim();
      const pinned = / \*\*\[pinned\]\*\*\s*$/.test(title);
      title = title.replace(/ \*\*\[pinned\]\*\*\s*$/, '').trim();

      current = {
        content: title,
        anchor: headingMatch[1],
        metadata: {
          pinned,
          relatedFiles: [],
          features: [],
        },
      };
      continue;
    }

    if (!current) continue;

    // Terminator: a footer rule or the totals line ends the last entry.
    if (/^---\s*$/.test(line) || /^\*\d+\s+\w+s total\*/.test(line)) {
      flush();
      continue;
    }

    // Bullets:
    const dateMatch = line.match(/^-\s+\*\*Date:\*\*\s+(.+?)(?:\s+\((.+?)\))?\s*$/);
    if (dateMatch) {
      const dateStr = dateMatch[1].trim();
      current.metadata.source = dateStr === 'unknown' ? null : dateStr;
      if (dateMatch[2]) {
        current.metadata.features = dateMatch[2].split(',').map((f) => f.trim()).filter(Boolean);
      }
      continue;
    }

    const filesMatch = line.match(/^-\s+\*\*Files:\*\*\s+(.+?)\s*$/);
    if (filesMatch) {
      const body = filesMatch[1].trim();
      if (body === 'cross-cutting') {
        current.metadata.relatedFiles = [];
      } else {
        current.metadata.relatedFiles = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      }
      continue;
    }

    const confMatch = line.match(/^-\s+\*\*Confidence:\*\*\s+([0-9.]+)\s*$/);
    if (confMatch) {
      current.metadata.confidence = Number(confMatch[1]);
      continue;
    }

    const eviMatch = line.match(/^-\s+\*\*Evidence:\*\*\s+(\d+)\s*$/);
    if (eviMatch) {
      current.metadata.evidence_count = Number(eviMatch[1]);
      continue;
    }

    // @cap-todo(ac:F-056/AC-3) Last Seen parsed back; missing values get ensureFields-migrated.
    const lastSeenMatch = line.match(/^-\s+\*\*Last Seen:\*\*\s+(.+?)\s*$/);
    if (lastSeenMatch) {
      current.metadata.last_seen = lastSeenMatch[1].trim();
      continue;
    }

    const confirmedMatch = line.match(/^-\s+\*\*Confirmed:\*\*\s+(\d+)\s+times\s*$/);
    if (confirmedMatch) {
      current.metadata.confirmations = Number(confirmedMatch[1]);
      continue;
    }
  }

  flush();
  return { entries };
}

// =====================================================================
// F-093: V6 Per-Feature Memory Pipeline Layout
// =====================================================================
//
// @cap-feature(feature:F-093, primary:true) V6 layout opt-in via .cap/config.json
//   { memory: { layout: 'v6' } }. When enabled, writeMemoryDirectory groups entries
//   by feature using F-077's classifier (sourceFileToFeatureId code-tag reverse-index
//   + FEATURE-MAP key_files), writes per-feature files under .cap/memory/features/
//   and platform/, and produces top-level decisions.md/pitfalls.md as Index files.
//
// The classifier is shared with F-077 (one-shot migration), so the routing decisions
// are consistent: a Hub session running incremental V6 yields the same per-feature
// distribution that F-077 produced from the V5 monolith snapshot.
//
// Manual edits in per-feature files are preserved across regeneration via F-076's
// auto-block markers (<!-- cap:auto:start --> / <!-- cap:auto:end -->).

/**
 * @param {string} projectRoot
 * @param {Object} [options]
 * @returns {boolean}
 */
function _isV6LayoutEnabled(projectRoot, options) {
  if (options && options.layout === 'v6') return true;
  if (options && options.layout === 'v5') return false;
  if (!projectRoot) return false;
  try {
    const cfgPath = path.join(projectRoot, '.cap', 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.memory && parsed.memory.layout === 'v6');
  } catch (_e) {
    return false;
  }
}

/**
 * Slugify a string for use in filenames. Mirrors F-077's _slugify behavior
 * (lowercase, alpha-num + hyphens, trim).
 * @param {string} s
 * @returns {string}
 */
function _slugifyForV6(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Resolve a feature title from FEATURE-MAP given the F-NNN id. Falls back to the id itself.
 * @param {string} featureId
 * @param {Array<{id: string, title: string}>=} features
 * @returns {string}
 */
function _featureTitleFor(featureId, features) {
  if (!features) return featureId;
  const f = features.find((x) => x.id === featureId);
  return f && f.title ? f.title : featureId;
}

/**
 * Group entries into V6 destinations using F-077's classifier.
 * Returns a Map keyed by destination identifier ("feature:F-XXX" or "platform:topic")
 * with values { destination, featureId?, topic?, decisions, pitfalls }.
 * @param {Array} entries
 * @param {Object} context - F-077 ClassifierContext
 * @returns {Map<string, {destination: string, featureId?: string, topic?: string, decisions: Array, pitfalls: Array}>}
 */
function _groupEntriesByDestination(entries, context, classifyEntry) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.category === 'hotspot' || entry.category === 'pattern') continue; // V6 only handles decision/pitfall per F-076 schema
    const v5Entry = {
      kind: entry.category,
      title: entry.content,
      content: entry.content,
      relatedFiles: (entry.metadata && entry.metadata.relatedFiles) || [],
      taggedFeatureId: entry.metadata && entry.metadata.features && entry.metadata.features.length > 0 ? entry.metadata.features[0] : null,
      anchorId: '',
      dateLabel: '',
    };
    const decision = classifyEntry(v5Entry, context);
    let key, group;
    if (decision.destination === 'feature' && decision.confidence >= 0.7) {
      key = `feature:${decision.featureId}`;
      if (!groups.has(key)) groups.set(key, { destination: 'feature', featureId: decision.featureId, topic: decision.topic, decisions: [], pitfalls: [] });
      group = groups.get(key);
    } else {
      const topic = decision.topic || 'unassigned';
      key = `platform:${topic}`;
      if (!groups.has(key)) groups.set(key, { destination: 'platform', topic, decisions: [], pitfalls: [] });
      group = groups.get(key);
    }
    if (entry.category === 'decision') group.decisions.push(entry);
    else group.pitfalls.push(entry);
  }
  return groups;
}

/**
 * Build the auto-block items array (decisions or pitfalls) for F-076 schema.
 * @param {Array} entries
 * @returns {Array<{text: string, location?: string}>}
 */
function _toAutoBlockItems(entries) {
  return entries.map((e) => {
    const item = { text: e.content };
    const files = (e.metadata && e.metadata.relatedFiles) || [];
    if (files.length > 0) item.location = files[0];
    return item;
  });
}

/**
 * Write the top-level Index file (decisions.md or pitfalls.md) summarizing
 * per-feature counts. Replaces the V5 monolith with a sparse pointer table.
 * @param {string} category 'decision' | 'pitfall'
 * @param {Map} groups
 * @param {Object} context
 */
function _renderV6Index(category, groups, context) {
  const filename = CATEGORY_FILES[category];
  const titleCat = category.charAt(0).toUpperCase() + category.slice(1) + 's';
  const lines = [
    `# Project Memory: ${titleCat} (V6 Index)`,
    '',
    `> **V6 layout active.** Per-feature ${category}s live in \`.cap/memory/features/\` and \`.cap/memory/platform/\`. This file is an auto-generated index — see the linked feature file for the actual entries.`,
    `> Last updated: ${new Date().toISOString().substring(0, 10)}`,
    '',
    '| Destination | Count | File |',
    '|---|---|---|',
  ];
  // Sort: features alphabetically, then platform topics
  const featureGroups = [...groups.values()].filter((g) => g.destination === 'feature').sort((a, b) => String(a.featureId).localeCompare(String(b.featureId)));
  const platformGroups = [...groups.values()].filter((g) => g.destination === 'platform').sort((a, b) => String(a.topic).localeCompare(String(b.topic)));
  for (const g of featureGroups) {
    const items = category === 'decision' ? g.decisions : g.pitfalls;
    if (items.length === 0) continue;
    const slug = _slugifyForV6(_featureTitleFor(g.featureId, context.features));
    const file = `features/${g.featureId}-${slug}.md`;
    lines.push(`| ${g.featureId} | ${items.length} | [${file}](${file}) |`);
  }
  for (const g of platformGroups) {
    const items = category === 'decision' ? g.decisions : g.pitfalls;
    if (items.length === 0) continue;
    const file = `platform/${g.topic}.md`;
    lines.push(`| platform/${g.topic} | ${items.length} | [${file}](${file}) |`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Write a per-feature file using F-076 schema (auto-block + manual-block preservation).
 * @param {string} filePath
 * @param {string} title
 * @param {Array} decisions
 * @param {Array} pitfalls
 */
function _writeV6FeatureFile(filePath, title, decisions, pitfalls) {
  const schema = require('./cap-memory-schema.cjs');
  let parsed;
  try {
    const existing = fs.readFileSync(filePath, 'utf8');
    parsed = schema.parseFeatureMemoryFile(existing);
  } catch (_e) {
    parsed = {
      frontmatter: {},
      autoBlock: { decisions: [], pitfalls: [] },
      manualBlock: { raw: `# ${title}\n\n` },
    };
  }
  parsed.autoBlock = {
    decisions: _toAutoBlockItems(decisions),
    pitfalls: _toAutoBlockItems(pitfalls),
  };
  const out = schema.serializeFeatureMemoryFile(parsed);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out, 'utf8');
}

/**
 * Archive existing V5 monolith files to .archive/ before first V6 write,
 * mirroring F-077's backup convention. Idempotent on same date.
 * @param {string} projectRoot
 */
function _archiveV5IfPresent(projectRoot) {
  const memDir = path.join(projectRoot, MEMORY_DIR);
  const archiveDir = path.join(memDir, '.archive');
  const date = new Date().toISOString().substring(0, 10);
  for (const filename of Object.values(CATEGORY_FILES)) {
    const src = path.join(memDir, filename);
    if (!fs.existsSync(src)) continue;
    // Only archive if file looks like a V5 monolith — V6 index files have a special marker.
    let raw;
    try { raw = fs.readFileSync(src, 'utf8'); } catch (_e) { continue; }
    if (raw.includes('(V6 Index)')) continue; // already a V6 index, skip
    const base = filename.replace(/\.md$/, '');
    const dest = path.join(archiveDir, `${base}-pre-v6-${date}.md`);
    if (fs.existsSync(dest)) continue; // idempotent on same date
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * V6 layout writer — entry point dispatched from writeMemoryDirectory when
 * { memory: { layout: 'v6' } } is set in .cap/config.json.
 * @param {string} projectRoot
 * @param {Array} entries
 * @param {Object} options
 * @returns {{files: Object<string, string>, written: number}}
 */
function _writeMemoryV6(projectRoot, entries, options = {}) {
  // Lazy-load the F-077 classifier to avoid coupling the V5 path.
  const migrate = require('./cap-memory-migrate.cjs');
  const context = migrate.buildClassifierContext(projectRoot);

  const groups = _groupEntriesByDestination(entries, context, migrate.classifyEntry);

  const memDir = path.join(projectRoot, MEMORY_DIR);
  if (!options.dryRun) {
    fs.mkdirSync(memDir, { recursive: true });
    _archiveV5IfPresent(projectRoot);
  }

  const files = {};
  let written = 0;

  // Per-feature + per-platform writes
  for (const g of groups.values()) {
    let filePath, title;
    if (g.destination === 'feature') {
      const slug = _slugifyForV6(_featureTitleFor(g.featureId, context.features));
      filePath = path.join(memDir, 'features', `${g.featureId}-${slug}.md`);
      title = `${g.featureId}: ${_featureTitleFor(g.featureId, context.features)}`;
    } else {
      filePath = path.join(memDir, 'platform', `${g.topic}.md`);
      title = `Platform: ${g.topic}`;
    }
    if (!options.dryRun) {
      _writeV6FeatureFile(filePath, title, g.decisions, g.pitfalls);
      written++;
    }
    // Snapshot for return value
    const relKey = path.relative(memDir, filePath);
    files[relKey] = `${title}\n decisions:${g.decisions.length}\n pitfalls:${g.pitfalls.length}`;
  }

  // Top-level Index files
  for (const cat of ['decision', 'pitfall']) {
    const indexContent = _renderV6Index(cat, groups, context);
    const filename = CATEGORY_FILES[cat];
    files[filename] = indexContent;
    if (!options.dryRun) {
      fs.writeFileSync(path.join(memDir, filename), indexContent, 'utf8');
      written++;
    }
  }

  // Skip patterns/hotspots in V6 — those remain V5-monolith for now (out-of-scope per F-076 schema).
  // Generate empty stubs only if they don't exist, to preserve legacy callers.

  return { files, written };
}

module.exports = {
  generateAnchorId,
  generateCategoryMarkdown,
  parseExistingAnchors,
  writeMemoryDirectory,
  readMemoryDirectory,
  readMemoryFile,
  getCrossReference,
  // F-090: confidence filter exposed for tests + downstream tools that want the same gating.
  _filterEntriesForOutput,
  // F-093: V6 layout helpers exposed for testing.
  _isV6LayoutEnabled,
  _writeMemoryV6,
  _groupEntriesByDestination,
  _renderV6Index,
  _archiveV5IfPresent,
  MEMORY_DIR,
  CATEGORY_FILES,
};
