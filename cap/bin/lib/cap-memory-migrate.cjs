// @cap-context CAP V6 Memory Migration Tool — one-shot conversion of V5 monolith memory files
// (decisions.md, pitfalls.md, patterns.md, hotspots.md, graph.json) to the V6 per-feature layout
// defined by F-076 (cap-memory-schema.cjs). Designed to handle production scale: 1219+ entries,
// 38+ orphan snapshots without breakage. Hard-cutover: no V5/V6 coexistence at runtime; the user
// commits the new layout to git after this tool runs successfully.

'use strict';

// @cap-feature(feature:F-077, primary:true) V6 Memory Migration Tool — one-shot migration from V5 monolith to per-feature files (F-076 schema)

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const schema = require('./cap-memory-schema.cjs');
const { readFeatureMap } = require('./cap-feature-map.cjs');

// -------- Constants --------

// @cap-decision(F-077/D1) Confidence threshold for auto vs ask is 0.7. Picked because:
// (1) tag-metadata + path-heuristic combined yield ≥0.7 on >90% of GoetzeInvest entries (manual
// audit on 50-sample),  (2) leaves headroom under 1.0 so future signals (e.g., ANN over content
// embeddings) can lift confidence without breaking calibration, (3) symmetric with F-072 fitness
// score thresholds where 0.7 is the "trust" cutoff. Re-runs with different signal sets need to
// recalibrate but the constant is exposed so a future flag can override.
const CONFIDENCE_AUTO_THRESHOLD = 0.7;

// @cap-decision(F-077/D2) Backup file naming uses date-only (YYYY-MM-DD) suffix. Idempotent on
// same-day re-run — overwriting a same-day backup is safe because the only path to that state is
// replaying the same migration. A timestamp-with-seconds suffix would yield non-idempotent backups
// and pollute .cap/memory/.archive/ with one file per re-run. Cross-day re-run produces a NEW
// backup file (audit trail preserved across days).
const BACKUP_DIR = '.cap/memory/.archive';

// V5 source files we know how to parse.
const V5_SOURCES = ['decisions.md', 'pitfalls.md', 'patterns.md', 'hotspots.md'];
const V5_BINARY_SOURCES = ['graph.json'];

// @cap-decision(F-077/D3) Migration report lives in .cap/memory/.archive/migration-report-<date>.md.
// Same-day re-run REPLACES the report (simpler than an append-mode report; the previous run's
// report is still recoverable from git history if needed). The .archive/ folder is the single
// destination for all V5-derived artifacts (backups + report) so a user inspecting "what
// happened during V6 migration" only has to look in one place.
const MIGRATION_REPORT_PREFIX = 'migration-report';

// Platform topic for entries with no signal — deliberate "unassigned" bucket so no entry is lost.
const UNASSIGNED_PLATFORM_TOPIC = 'unassigned';
const UNASSIGNED_SNAPSHOTS_TOPIC = 'snapshots-unassigned';

// Snapshot date-proximity window for the heuristic (hours).
const SNAPSHOT_DATE_WINDOW_HOURS = 24;

// @cap-decision(F-077/D7) Title-prefix heuristic threshold — minimum occurrences across the V5
//                 corpus before a prefix counts as signal. 5 is the floor where we stop seeing
//                 sentence-starts ("Select:", "Update:", "Migration 067:") and start seeing
//                 actual app-name buckets ("GoetzeBooking:" appears 30+ times, "EasyMail:" 50+,
//                 etc.). Exposed for future tuning; tests pin the constant explicitly.
const TITLE_PREFIX_MIN_OCCURRENCES = 5;

// -------- Typedefs --------

/**
 * @typedef {Object} V5Entry
 * @property {'decision'|'pitfall'|'pattern'|'hotspot'} kind
 * @property {string} anchorId - the `<a id="..."></a>` anchor (or '' if none)
 * @property {string} title - the H3 heading text
 * @property {string} content - body text (multi-line, preserved)
 * @property {string} sourceFile - "decisions.md" etc.
 * @property {number} sourceLine - 1-indexed line number where the entry's H3 starts
 * @property {string|null} dateLabel - the "Date:" field text (e.g., "code", "code (F-050)")
 * @property {string[]} relatedFiles - paths from the "Files:" field
 * @property {number|null} confidence - the "Confidence:" field as 0..1, null if missing
 * @property {string|null} lastSeen - the "Last Seen:" ISO string, null if missing
 * @property {string|null} taggedFeatureId - F-NNN extracted from anchor's tag-metadata if any
 * @property {string|null} taggedPlatformTopic - platform topic if `@cap-decision platform:<topic>` was tagged
 */

/**
 * @typedef {Object} V5Snapshot
 * @property {string} fileName - relative to `.cap/snapshots/`
 * @property {string} sourcePath - absolute path
 * @property {string|null} feature - frontmatter `feature:` field, null if absent
 * @property {string|null} date - frontmatter `date:` ISO timestamp
 * @property {string} title - the H1 heading text or fileName fallback
 * @property {string} bodyHash - first 8 chars of content sha — cheap dedup key
 */

/**
 * @typedef {Object} ClassificationDecision
 * @property {'feature'|'platform'|'unassigned'} destination
 * @property {string=} featureId - F-NNN if destination === 'feature'
 * @property {string=} topic - kebab-case topic for the destination file
 * @property {number} confidence - 0..1
 * @property {string[]} reasons - human-readable signal trace
 * @property {Array<{featureId?: string, topic?: string, confidence: number, reason: string}>=} candidates - top-3 alternatives for ambiguity prompt
 */

/**
 * @typedef {Object} ClassifierContext
 * @property {Array<{id: string, title: string, files: string[]}>} features - from FEATURE-MAP.md
 * @property {Map<string, string>} fileToFeatureId - reverse-index: repo-relative path → F-NNN
 * @property {Map<string, {state: string, transitionAt: string|null}>} featureState - F-NNN → last-known state-transition info (for snapshot date heuristic)
 */

/**
 * @typedef {Object} PlannedWrite
 * @property {string} destinationPath - absolute path
 * @property {string} destinationKind - 'feature' | 'platform'
 * @property {string=} featureId
 * @property {string=} topic
 * @property {V5Entry[]} decisions
 * @property {V5Entry[]} pitfalls
 * @property {V5Snapshot[]} snapshots
 */

/**
 * @typedef {Object} MigrationPlan
 * @property {Object<string, number>} sourceCounts - { 'decisions.md': N, ... }
 * @property {Object<string, number>} sourceSizes - { 'decisions.md': bytes, ... }
 * @property {PlannedWrite[]} writes - one entry per output file
 * @property {Array<{entry: V5Entry|V5Snapshot, decision: ClassificationDecision, kind: string}>} ambiguous - confidence < threshold
 * @property {Array<{entry: V5Entry|V5Snapshot, kind: string}>} unassigned - confidence 0
 * @property {Array<{from: string, to: string, exists: boolean}>} backups
 * @property {string[]} parseErrors
 */

/**
 * @typedef {Object} MigrationOptions
 * @property {boolean=} dryRun - default true
 * @property {boolean=} apply - default false
 * @property {boolean=} interactive - default true
 * @property {number=} now - epoch millis for date snapshots; default Date.now()
 * @property {(prompt: string) => Promise<string>=} promptFn - test injection point
 * @property {(prompt: string) => boolean=} confirmFn - test injection point for the apply confirm
 * @property {(line: string) => void=} log - stderr writer; default console.error
 * @property {Array<{choice: string}>=} _testPromptResponses - canned responses for tests, consumed in order
 */

/**
 * @typedef {Object} MigrationResult
 * @property {boolean} dryRun
 * @property {MigrationPlan} plan
 * @property {Object|null} report - rendered report metadata after --apply, else null
 * @property {string[]} errors
 * @property {string[]} wroteFiles
 * @property {string[]} backups
 * @property {number} exitCode - 0 success, 1 error, 2 user-quit
 */

// -------- Public API --------

// @cap-todo(ac:F-077/AC-4) Default options: dryRun=true, apply=false, interactive=true.
//                          --apply switches dryRun to false; the actual writes are gated on apply.
/**
 * One-shot migration entry point.
 * @param {string} projectRoot
 * @param {MigrationOptions=} options
 * @returns {Promise<MigrationResult>}
 */
async function migrateMemory(projectRoot, options) {
  const opts = _normalizeOptions(options);
  const result = /** @type {MigrationResult} */ ({
    dryRun: !opts.apply,
    plan: /** @type {MigrationPlan} */ ({ sourceCounts: {}, sourceSizes: {}, writes: [], ambiguous: [], unassigned: [], backups: [], parseErrors: [] }),
    report: null,
    errors: [],
    wroteFiles: [],
    backups: [],
    exitCode: 0,
  });

  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    result.errors.push('projectRoot must be a non-empty string');
    result.exitCode = 1;
    return result;
  }

  // 1. Build classifier context (FEATURE-MAP key_files index).
  let context;
  try {
    context = buildClassifierContext(projectRoot);
  } catch (e) {
    // FEATURE-MAP missing — degrade to no-key-files heuristic, but continue.
    result.errors.push(`feature-map context unavailable: ${e && e.message ? e.message : String(e)}`);
    context = { features: [], fileToFeatureId: new Map(), featureState: new Map() };
  }

  // 2. Build the migration plan (no IO writes). This is the dry-run output.
  const plan = buildMigrationPlan(projectRoot, context, opts);
  result.plan = plan;

  // 3. Dry-run: log + return.
  if (!opts.apply) {
    _emitDryRunReport(plan, opts.log);
    return result;
  }

  // 4. Apply path: confirm prompt (when interactive) + ambiguity resolution + atomic writes.
  if (opts.interactive) {
    const ok = await _confirmApply(plan, opts);
    if (!ok) {
      result.errors.push('user declined apply');
      result.exitCode = 2;
      return result;
    }
  }

  // 5. Resolve ambiguous entries by prompting (or auto-routing if non-interactive).
  let resolved;
  try {
    resolved = await resolveAmbiguities(plan, opts);
  } catch (e) {
    if (e && e.code === 'USER_QUIT') {
      result.errors.push('user quit migration');
      result.exitCode = 2;
      return result;
    }
    result.errors.push(`ambiguity resolution failed: ${e && e.message ? e.message : String(e)}`);
    result.exitCode = 1;
    return result;
  }

  // 6. Backups (idempotent on same date).
  const backupDate = _isoDate(opts.now);
  for (const backup of resolved.backups) {
    try {
      const wrote = _writeBackup(backup.from, backup.to);
      if (wrote) result.backups.push(backup.to);
    } catch (e) {
      result.errors.push(`backup failed for ${backup.from}: ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 7. Atomic writes — features and platform files.
  // @cap-decision(F-077/D6) Use plan.sourceMaxMtime (not opts.now) for the V6 `updated:` field so
  //                  re-running migrate against unchanged V5 sources produces byte-identical output.
  //                  Fall back to opts.now only if there were no source files (rare — unit tests).
  const updatedTimestamp = plan.sourceMaxMtime || opts.now;
  for (const write of resolved.writes) {
    try {
      const ok = _writePlannedFile(write, updatedTimestamp);
      if (ok) result.wroteFiles.push(write.destinationPath);
      else result.errors.push(`atomic write failed for ${write.destinationPath}`);
    } catch (e) {
      result.errors.push(`write error for ${write.destinationPath}: ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 8. Migration report.
  const reportPath = path.join(projectRoot, BACKUP_DIR, `${MIGRATION_REPORT_PREFIX}-${backupDate}.md`);
  const reportData = _buildReportData(projectRoot, resolved, result, opts);
  try {
    _atomicWriteFile(reportPath, _renderReport(reportData));
    result.report = reportData;
  } catch (e) {
    result.errors.push(`report write failed: ${e && e.message ? e.message : String(e)}`);
  }

  if (result.errors.length > 0) result.exitCode = 1;
  return result;
}

// @cap-todo(ac:F-077/AC-1) buildMigrationPlan parses all V5 sources and routes each entry/snapshot
//                          via classifyEntry. Pure planning step — no fs writes.
/**
 * Build a migration plan from disk state. Pure computation — only fs reads.
 * @param {string} projectRoot
 * @param {ClassifierContext} context
 * @param {MigrationOptions=} options
 * @returns {MigrationPlan}
 */
function buildMigrationPlan(projectRoot, context, options) {
  const opts = _normalizeOptions(options);
  const memoryDir = path.join(projectRoot, '.cap', 'memory');
  const featuresDir = path.join(memoryDir, 'features');
  const platformDir = path.join(memoryDir, 'platform');
  const snapshotsDir = path.join(projectRoot, '.cap', 'snapshots');

  /** @type {MigrationPlan} */
  const plan = {
    sourceCounts: {},
    sourceSizes: {},
    sourceMaxMtime: 0, // F-077/D6: max(mtimeMs) across V5 sources, used as `updated:` for V6 files
    writes: [],
    ambiguous: [],
    unassigned: [],
    backups: [],
    parseErrors: [],
  };

  // 1. Parse the four V5 markdown sources.
  /** @type {V5Entry[]} */
  const allEntries = [];
  for (const sourceName of V5_SOURCES) {
    const fp = path.join(memoryDir, sourceName);
    if (!fs.existsSync(fp)) {
      plan.sourceCounts[sourceName] = 0;
      plan.sourceSizes[sourceName] = 0;
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(fp, 'utf8');
    } catch (e) {
      plan.parseErrors.push(`read failed for ${sourceName}: ${e && e.message ? e.message : String(e)}`);
      plan.sourceCounts[sourceName] = 0;
      plan.sourceSizes[sourceName] = 0;
      continue;
    }
    const stat = fs.statSync(fp);
    plan.sourceSizes[sourceName] = stat.size;
    // @cap-decision(F-077/D6) Track max source mtime to derive a stable `updated:` field for V6
    //                  files. AC-2 says "wiederholtes Ausführen ohne neue Inputs darf keine
    //                  Diff-Änderungen produzieren" — using Date.now() at write-time would put a
    //                  fresh ISO timestamp into every regenerated V6 file on every run, even when
    //                  the V5 sources hadn't changed. Source-mtime makes the timestamp truly a
    //                  function of the input, not the run.
    if (!plan.sourceMaxMtime || stat.mtimeMs > plan.sourceMaxMtime) {
      plan.sourceMaxMtime = stat.mtimeMs;
    }
    const entries = parseV5MarkdownFile(raw, sourceName);
    plan.sourceCounts[sourceName] = entries.length;
    allEntries.push(...entries);
  }

  // 2. Parse graph.json for hotspot-style structured nodes when hotspots.md was empty/parsed-empty.
  const graphPath = path.join(memoryDir, 'graph.json');
  if (fs.existsSync(graphPath) && (!plan.sourceCounts['hotspots.md'] || plan.sourceCounts['hotspots.md'] === 0)) {
    try {
      const raw = fs.readFileSync(graphPath, 'utf8');
      const graphEntries = parseGraphJson(raw);
      // graph.json is the canonical source for tagged feature-id metadata when present.
      // Cross-link by anchor id where possible to enrich the markdown-parsed entries.
      _enrichEntriesFromGraph(allEntries, graphEntries);
      // Hotspot-only nodes in graph that have no markdown counterpart get added directly.
      for (const ge of graphEntries.hotspotsWithoutMarkdown) {
        allEntries.push(ge);
      }
    } catch (e) {
      plan.parseErrors.push(`graph.json parse: ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 3. Parse snapshots.
  /** @type {V5Snapshot[]} */
  const snapshots = [];
  if (fs.existsSync(snapshotsDir)) {
    let names = [];
    try {
      names = fs.readdirSync(snapshotsDir);
    } catch (_e) {
      // ignore
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const fp = path.join(snapshotsDir, name);
      let raw;
      try { raw = fs.readFileSync(fp, 'utf8'); } catch (_e) { continue; }
      try {
        snapshots.push(parseSnapshot(name, fp, raw));
      } catch (e) {
        plan.parseErrors.push(`snapshot parse ${name}: ${e && e.message ? e.message : String(e)}`);
      }
    }
  }

  // 4. Classify every entry + snapshot.
  // @cap-decision(F-077/D7) Title-prefix heuristic uses a two-pass: count prefix occurrences first,
  //                  then promote only prefixes with ≥ TITLE_PREFIX_MIN_OCCURRENCES entries. Single-
  //                  occurrence prefixes are noise (sentences starting with "Select:", "Update:",
  //                  "Migration 067:" etc.) and would otherwise produce a swarm of 1-2-entry
  //                  platform files. Real-world: GoetzeInvest pre-threshold produced 130 platform
  //                  files with mostly junk; threshold-5 yields ~5-8 meaningful app-buckets.
  context.titlePrefixCounts = _countTitlePrefixes(allEntries);

  /** @type {Map<string, PlannedWrite>} */
  const writeIndex = new Map();
  const ensureWrite = (key, build) => {
    if (writeIndex.has(key)) return /** @type {PlannedWrite} */ (writeIndex.get(key));
    const w = build();
    writeIndex.set(key, w);
    plan.writes.push(w);
    return w;
  };

  for (const entry of allEntries) {
    const decision = classifyEntry(entry, context);
    if (decision.confidence < CONFIDENCE_AUTO_THRESHOLD && decision.destination !== 'unassigned') {
      // Hold for ambiguity resolution. The "primary" decision is captured but the actual
      // destination is deferred until resolveAmbiguities pickes a candidate.
      plan.ambiguous.push({ entry, decision, kind: entry.kind });
      continue;
    }
    _routeEntryToWrite(entry, decision, projectRoot, featuresDir, platformDir, ensureWrite, plan);
  }

  // Snapshots — separate classifier (frontmatter feature wins → date heuristic → keyword).
  for (const snap of snapshots) {
    const decision = classifySnapshot(snap, context);
    if (decision.confidence < CONFIDENCE_AUTO_THRESHOLD && decision.destination !== 'unassigned') {
      plan.ambiguous.push({ entry: snap, decision, kind: 'snapshot' });
      continue;
    }
    _routeSnapshotToWrite(snap, decision, projectRoot, featuresDir, platformDir, ensureWrite, plan);
  }

  // 5. Backups — only files that exist get backed up.
  const backupDate = _isoDate(opts.now);
  for (const sourceName of [...V5_SOURCES, ...V5_BINARY_SOURCES]) {
    const from = path.join(memoryDir, sourceName);
    if (!fs.existsSync(from)) continue;
    const ext = path.extname(sourceName);
    const stem = sourceName.slice(0, sourceName.length - ext.length);
    const backupName = `${stem}-pre-v6-${backupDate}${ext}`;
    const to = path.join(projectRoot, BACKUP_DIR, backupName);
    plan.backups.push({ from, to, exists: fs.existsSync(to) });
  }

  // 6. Sort writes for deterministic output (helps tests, idempotency).
  plan.writes.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
  for (const w of plan.writes) {
    w.decisions.sort(_compareEntriesByText);
    w.pitfalls.sort(_compareEntriesByText);
    w.snapshots.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  return plan;
}

// @cap-todo(ac:F-077/AC-5) classifyEntry — priority order:
//   1. Tag metadata (feature:F-NNN) — confidence 1.0
//   2. Tagged platform topic (platform:<topic>) — confidence 1.0
//   3. Path heuristic against FEATURE-MAP key_files — confidence 0.7
//   4. F-NNN mention in body text (exactly once) — confidence 0.5
//   5. No signal — confidence 0.0, route to unassigned.
/**
 * @param {V5Entry} entry
 * @param {ClassifierContext} context
 * @returns {ClassificationDecision}
 */
function classifyEntry(entry, context) {
  const reasons = [];

  // 1. Tagged feature id (highest signal).
  if (entry.taggedFeatureId) {
    reasons.push(`tag-metadata:${entry.taggedFeatureId}`);
    return {
      destination: 'feature',
      featureId: entry.taggedFeatureId,
      topic: _topicForFeature(entry.taggedFeatureId, context),
      confidence: 1.0,
      reasons,
    };
  }

  // 2. Tagged platform topic.
  if (entry.taggedPlatformTopic) {
    reasons.push(`platform-tag:${entry.taggedPlatformTopic}`);
    return {
      destination: 'platform',
      topic: entry.taggedPlatformTopic,
      confidence: 1.0,
      reasons,
    };
  }

  // 3. Path heuristic — match relatedFiles against FEATURE-MAP key_files.
  const matches = new Map(); // featureId -> hit count
  for (const f of entry.relatedFiles || []) {
    const normalized = _normalizeRepoPath(f);
    const fid = context.fileToFeatureId.get(normalized);
    if (fid) {
      matches.set(fid, (matches.get(fid) || 0) + 1);
    }
  }
  if (matches.size === 1) {
    const [fid] = matches.keys();
    reasons.push(`path-match:${fid}`);
    return {
      destination: 'feature',
      featureId: fid,
      topic: _topicForFeature(fid, context),
      confidence: 0.7,
      reasons,
    };
  }
  if (matches.size > 1) {
    // Multiple feature matches — emit as ambiguous with top-3 candidates.
    const sorted = [...matches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    reasons.push(`path-match-multi:${sorted.map((s) => s[0]).join(',')}`);
    const candidates = sorted.map(([fid, count]) => ({
      featureId: fid,
      topic: _topicForFeature(fid, context),
      confidence: 0.6 + 0.05 * count, // tie-break on hit count, capped below auto threshold
      reason: `path-match (${count} hit${count === 1 ? '' : 's'})`,
    }));
    return {
      destination: 'feature',
      featureId: candidates[0].featureId,
      topic: candidates[0].topic,
      confidence: 0.6, // below threshold → ambiguity
      reasons,
      candidates,
    };
  }

  // 4. F-NNN mention in body text — exactly one unique id.
  const haystack = `${entry.title}\n${entry.content}\n${entry.dateLabel || ''}`;
  const ids = new Set(_extractFeatureIdsFromText(haystack));
  if (ids.size === 1) {
    const [fid] = ids;
    reasons.push(`text-mention:${fid}`);
    return {
      destination: 'feature',
      featureId: fid,
      topic: _topicForFeature(fid, context),
      confidence: 0.5,
      reasons,
      candidates: [{
        featureId: fid,
        topic: _topicForFeature(fid, context),
        confidence: 0.5,
        reason: 'F-NNN mentioned in body text',
      }],
    };
  }
  if (ids.size > 1) {
    const list = [...ids].slice(0, 3);
    reasons.push(`text-mention-multi:${list.join(',')}`);
    return {
      destination: 'feature',
      featureId: list[0],
      topic: _topicForFeature(list[0], context),
      confidence: 0.4,
      reasons,
      candidates: list.map((fid) => ({
        featureId: fid,
        topic: _topicForFeature(fid, context),
        confidence: 0.4,
        reason: 'F-NNN mentioned in body text (multi)',
      })),
    };
  }

  // 5. Title-prefix heuristic — last-chance signal before falling back to unassigned.
  // @cap-decision(F-077/D7) Many projects encode the app/sub-feature in a title-prefix convention
  //                  ("GoetzeBooking: ...", "EasyMail: ...", "Hub: ..."). When tag-metadata,
  //                  path-match, and F-NNN-mention all miss, a recognizable prefix is still useful
  //                  signal: route to `platform/prefix-<slug>.md`. Real-world: GoetzeInvest dry-run
  //                  pre-D7 produced 0 feature files / 1347 unassigned over 1287 V5 entries because
  //                  the project's FEATURE-MAP uses long-form IDs (F-DEPLOY, F-HUB-AUTH) that
  //                  cap-feature-map.cjs doesn't parse. Issue #39 tracks the proper multi-format
  //                  + monorepo support; D7 is the bridge that makes V6.0 useful for that project
  //                  in the meantime. Threshold-gated: prefix must appear in
  //                  TITLE_PREFIX_MIN_OCCURRENCES entries (default 5) before it counts as signal
  //                  — avoids the 130-tiny-files swarm from sentences that incidentally start with
  //                  a capitalised word + colon (Select:, Update:, Migration 067:, etc.).
  const prefixSlug = _extractTitlePrefixSlug(entry.title);
  if (prefixSlug) {
    const count = context.titlePrefixCounts ? context.titlePrefixCounts.get(prefixSlug) || 0 : 0;
    if (count >= TITLE_PREFIX_MIN_OCCURRENCES) {
      reasons.push(`title-prefix:${prefixSlug}(${count})`);
      return {
        destination: 'platform',
        topic: `prefix-${prefixSlug}`,
        confidence: 0.7,
        reasons,
      };
    }
  }

  // 6. No signal.
  reasons.push('no-signal');
  return {
    destination: 'unassigned',
    topic: UNASSIGNED_PLATFORM_TOPIC,
    confidence: 0,
    reasons,
  };
}

/**
 * Extract a slugified prefix from a V5 decision/pitfall title using the `<Prefix>:` convention.
 * Returns null when the title doesn't match the convention or when the prefix is too short to be
 * meaningful (< 3 chars after slugification).
 *
 * @cap-decision(F-077/D7) Prefix must start with a letter, be 2-40 chars long, contain only
 *                         alphanumerics + space + dash, and be followed by exactly one ":". This
 *                         excludes URLs ("http://"), code patterns ("foo::bar"), and misc colons
 *                         in normal prose. Slug is kebab-case lowercase, max 40 chars.
 *
 * @param {string} title
 * @returns {string|null}
 */
function _extractTitlePrefixSlug(title) {
  if (typeof title !== 'string') return null;
  const m = title.match(/^([A-Za-z][A-Za-z0-9 \-]{1,40}):\s/);
  if (!m) return null;
  const prefix = m[1].trim();
  // Reject prefixes that are obviously not app-names: too short, all-numeric, generic words.
  if (prefix.length < 3) return null;
  const NOISE_PREFIXES = new Set(['todo', 'note', 'fix', 'bug', 'wip', 'tbd', 'fixme', 'xxx']);
  if (NOISE_PREFIXES.has(prefix.toLowerCase())) return null;
  // Slugify: lowercase, replace runs of non-alphanumeric with single dash, strip leading/trailing dashes.
  const slug = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length < 3 || slug.length > 40) return null;
  return slug;
}

/**
 * Count title-prefix occurrences across all entries. The classifier's title-prefix step (D7) gates
 * on `count >= TITLE_PREFIX_MIN_OCCURRENCES`, so a single-occurrence prefix doesn't get its own
 * platform file.
 *
 * @param {V5Entry[]} entries
 * @returns {Map<string, number>} slug → occurrence count
 */
function _countTitlePrefixes(entries) {
  const counts = new Map();
  for (const e of entries) {
    const slug = _extractTitlePrefixSlug(e.title || '');
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
}

// @cap-todo(ac:F-077/AC-5) classifySnapshot — priority order:
//   1. Frontmatter `feature:` field — confidence 1.0
//   2. Date proximity to FEATURE-MAP state-transition (within 24h) — confidence 0.6
//   3. Title keyword: F-NNN in title — confidence 0.4
//   4. No signal — confidence 0.0
/**
 * @param {V5Snapshot} snap
 * @param {ClassifierContext} context
 * @returns {ClassificationDecision}
 */
function classifySnapshot(snap, context) {
  const reasons = [];

  if (snap.feature && /^F-\d{3,}$/.test(snap.feature)) {
    reasons.push(`frontmatter:${snap.feature}`);
    return {
      destination: 'feature',
      featureId: snap.feature,
      topic: _topicForFeature(snap.feature, context),
      confidence: 1.0,
      reasons,
    };
  }

  // Date-proximity heuristic.
  if (snap.date) {
    const snapTime = new Date(snap.date).getTime();
    if (!Number.isNaN(snapTime)) {
      const candidates = [];
      for (const [fid, info] of context.featureState.entries()) {
        if (!info.transitionAt) continue;
        const t = new Date(info.transitionAt).getTime();
        if (Number.isNaN(t)) continue;
        const dh = Math.abs(snapTime - t) / (1000 * 60 * 60);
        if (dh <= SNAPSHOT_DATE_WINDOW_HOURS) {
          candidates.push({ featureId: fid, dh });
        }
      }
      if (candidates.length === 1) {
        reasons.push(`date-proximity:${candidates[0].featureId}`);
        return {
          destination: 'feature',
          featureId: candidates[0].featureId,
          topic: _topicForFeature(candidates[0].featureId, context),
          confidence: 0.6,
          reasons,
          candidates: candidates.map((c) => ({
            featureId: c.featureId,
            topic: _topicForFeature(c.featureId, context),
            confidence: 0.6,
            reason: `state-transition within ${SNAPSHOT_DATE_WINDOW_HOURS}h`,
          })),
        };
      }
      if (candidates.length > 1) {
        candidates.sort((a, b) => a.dh - b.dh);
        const top = candidates.slice(0, 3);
        reasons.push(`date-proximity-multi:${top.map((c) => c.featureId).join(',')}`);
        return {
          destination: 'feature',
          featureId: top[0].featureId,
          topic: _topicForFeature(top[0].featureId, context),
          confidence: 0.5,
          reasons,
          candidates: top.map((c) => ({
            featureId: c.featureId,
            topic: _topicForFeature(c.featureId, context),
            confidence: 0.5,
            reason: `state-transition within ${SNAPSHOT_DATE_WINDOW_HOURS}h (multi)`,
          })),
        };
      }
    }
  }

  // Title keyword: F-NNN in title.
  const ids = new Set(_extractFeatureIdsFromText(snap.title));
  if (ids.size === 1) {
    const [fid] = ids;
    reasons.push(`title:${fid}`);
    return {
      destination: 'feature',
      featureId: fid,
      topic: _topicForFeature(fid, context),
      confidence: 0.4,
      reasons,
      candidates: [{
        featureId: fid,
        topic: _topicForFeature(fid, context),
        confidence: 0.4,
        reason: 'F-NNN in snapshot title',
      }],
    };
  }

  reasons.push('no-signal');
  return {
    destination: 'unassigned',
    topic: UNASSIGNED_SNAPSHOTS_TOPIC,
    confidence: 0,
    reasons,
  };
}

// @cap-todo(ac:F-077/AC-6) resolveAmbiguities — interactive runner. In dry-run we don't reach
//                          this codepath; in --apply we either prompt the user or auto-route to
//                          the highest-confidence candidate (when interactive=false).
/**
 * @param {MigrationPlan} plan
 * @param {MigrationOptions} opts
 * @returns {Promise<MigrationPlan>}
 */
async function resolveAmbiguities(plan, opts) {
  if (plan.ambiguous.length === 0) return plan;

  // Non-interactive path: auto-route every ambiguous entry to its top candidate (or unassigned if no
  // candidates were attached).
  if (!opts.interactive) {
    for (const item of plan.ambiguous) {
      _autoResolveAmbiguous(item, plan);
    }
    plan.ambiguous = [];
    return plan;
  }

  // Interactive path: walk the list one-by-one.
  const total = plan.ambiguous.length;
  let autoMode = false;
  for (let i = 0; i < plan.ambiguous.length; i++) {
    const item = plan.ambiguous[i];
    if (autoMode) {
      _autoResolveAmbiguous(item, plan);
      continue;
    }
    const choice = await _promptAmbiguity(item, i + 1, total, opts);
    if (choice === 'q') {
      const err = new Error('user quit');
      // @ts-ignore custom code
      err.code = 'USER_QUIT';
      throw err;
    }
    if (choice === 'a') {
      autoMode = true;
      _autoResolveAmbiguous(item, plan);
      continue;
    }
    if (choice === 's') {
      _routeAmbiguousToUnassigned(item, plan);
      continue;
    }
    // numeric choice — pick candidate index (1-based)
    // @cap-decision(F-077/D4) Empty input (just Enter) and non-numeric input (parseInt → NaN)
    //                must route to unassigned, NOT crash. NaN comparisons always return false,
    //                so the bounds check needs an explicit Number.isNaN guard. Pre-fix: empty
    //                input on prompt → TypeError on `picked.featureId` → half-applied migration
    //                with backups written but no V6 files. Most common UX mistake (user hits
    //                Enter without thinking) currently corrupts the migration.
    const idx = parseInt(choice, 10) - 1;
    const candidates = item.decision.candidates || [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
      // Invalid / empty / non-numeric input → fallback to skip (route to unassigned)
      _routeAmbiguousToUnassigned(item, plan);
      continue;
    }
    const picked = candidates[idx];
    _routeAmbiguousToCandidate(item, picked, plan);
  }
  // Re-sort writes for determinism.
  plan.writes.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
  for (const w of plan.writes) {
    w.decisions.sort(_compareEntriesByText);
    w.pitfalls.sort(_compareEntriesByText);
    w.snapshots.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  plan.ambiguous = [];
  return plan;
}

// -------- Internals: V5 markdown parsers --------

// @cap-todo(ac:F-077/AC-1) parseV5MarkdownFile — recognizes the pipeline-emitted shape:
//   ### <a id="..."></a>Title text\n
//   - **Date:** ...\n
//   - **Files:** `path1`, `path2`\n
//   - **Confidence:** 0.50\n
//   - **Evidence:** N\n
//   - **Last Seen:** ISO\n
//   - **Pinned:** true (optional)\n
// Fields beyond the standard set are preserved in `content` for later inspection.
/**
 * @param {string} content
 * @param {string} sourceFile
 * @returns {V5Entry[]}
 */
function parseV5MarkdownFile(content, sourceFile) {
  /** @type {V5Entry[]} */
  const out = [];
  const lines = content.split(/\r?\n/);
  const kindMap = {
    'decisions.md': 'decision',
    'pitfalls.md': 'pitfall',
    'patterns.md': 'pattern',
    'hotspots.md': 'hotspot',
  };
  const kind = kindMap[sourceFile] || 'decision';

  // Find each H3 entry.
  const headerRe = /^###\s+(?:<a\s+id="([^"]+)"><\/a>)?\s*(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(headerRe);
    if (!m) { i++; continue; }
    const startLine = i + 1; // 1-indexed
    const anchorId = m[1] || '';
    const title = (m[2] || '').trim();
    if (!title && !anchorId) { i++; continue; }

    // Collect body lines until the next H3 / EOF.
    const bodyLines = [];
    i++;
    while (i < lines.length) {
      if (/^###\s+/.test(lines[i])) break;
      bodyLines.push(lines[i]);
      i++;
    }
    const body = bodyLines.join('\n');

    // Skip if this is the H1/H2 docstring block (no body fields).
    if (!title) continue;

    /** @type {V5Entry} */
    const entry = {
      kind: /** @type {any} */ (kind),
      anchorId,
      title,
      content: body,
      sourceFile,
      sourceLine: startLine,
      dateLabel: _extractFieldFromBody(body, 'Date'),
      relatedFiles: _extractFilesFromBody(body),
      confidence: _extractConfidenceFromBody(body),
      lastSeen: _extractFieldFromBody(body, 'Last Seen'),
      taggedFeatureId: null,
      taggedPlatformTopic: null,
    };

    // dateLabel sometimes carries "(F-NNN)" — surface it as taggedFeatureId.
    const fidFromDate = entry.dateLabel ? _extractFeatureIdsFromText(entry.dateLabel) : [];
    if (fidFromDate.length === 1) {
      entry.taggedFeatureId = fidFromDate[0];
    }

    out.push(entry);
  }
  return out;
}

/**
 * @param {string} body
 * @param {string} fieldName
 * @returns {string|null}
 */
function _extractFieldFromBody(body, fieldName) {
  const re = new RegExp(`^[-*]\\s*\\*\\*${fieldName}:\\*\\*\\s*(.+?)\\s*$`, 'm');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract repo-relative paths from a "- **Files:** `a.cjs`, `b.cjs`" line.
 * @param {string} body
 * @returns {string[]}
 */
function _extractFilesFromBody(body) {
  const filesLine = _extractFieldFromBody(body, 'Files');
  if (!filesLine) return [];
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(filesLine)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * @param {string} body
 * @returns {number|null}
 */
function _extractConfidenceFromBody(body) {
  const v = _extractFieldFromBody(body, 'Confidence');
  if (v === null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function _extractFeatureIdsFromText(text) {
  if (!text) return [];
  const re = /\bF-\d{3,}\b/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

// -------- graph.json parsing --------

/**
 * @param {string} raw
 * @returns {{ byAnchor: Map<string, V5Entry>, hotspotsWithoutMarkdown: V5Entry[] }}
 */
function parseGraphJson(raw) {
  /** @type {Map<string, V5Entry>} */
  const byAnchor = new Map();
  /** @type {V5Entry[]} */
  const hotspotsWithoutMarkdown = [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return { byAnchor, hotspotsWithoutMarkdown };
  }
  const nodes = (parsed && parsed.nodes) || {};
  for (const id of Object.keys(nodes)) {
    const node = nodes[id];
    if (!node || typeof node !== 'object') continue;
    const meta = node.metadata || {};
    const anchorId = id.replace(/^(decision|pitfall|pattern|hotspot)-/, '');
    const kind = (id.split('-')[0]);
    const taggedFeatureId = _firstFeatureIdFromList([
      meta.feature,
      meta.featureId,
      ...(Array.isArray(meta.relatedFiles) ? [meta.relatedFiles.join(' ')] : []),
    ]);
    /** @type {V5Entry} */
    const entry = {
      kind: /** @type {any} */ (['decision', 'pitfall', 'pattern', 'hotspot'].includes(kind) ? kind : 'decision'),
      anchorId,
      title: node.label || '',
      content: '',
      sourceFile: 'graph.json',
      sourceLine: 0,
      dateLabel: meta.source || null,
      relatedFiles: Array.isArray(meta.relatedFiles) ? meta.relatedFiles.slice() : (meta.file ? [meta.file] : []),
      confidence: typeof meta.confidence === 'number' ? meta.confidence : null,
      lastSeen: node.updatedAt || node.createdAt || null,
      taggedFeatureId,
      taggedPlatformTopic: meta.platform || null,
    };
    byAnchor.set(anchorId, entry);
    if (entry.kind === 'hotspot') hotspotsWithoutMarkdown.push(entry);
  }
  return { byAnchor, hotspotsWithoutMarkdown };
}

/**
 * @param {Array<any>} list
 * @returns {string|null}
 */
function _firstFeatureIdFromList(list) {
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const ids = _extractFeatureIdsFromText(v);
    if (ids.length > 0) return ids[0];
  }
  return null;
}

/**
 * Enrich markdown-parsed entries with metadata from graph.json (tagged feature id, etc).
 * @param {V5Entry[]} entries
 * @param {{ byAnchor: Map<string, V5Entry> }} graph
 */
function _enrichEntriesFromGraph(entries, graph) {
  for (const entry of entries) {
    if (!entry.anchorId) continue;
    const ge = graph.byAnchor.get(entry.anchorId);
    if (!ge) continue;
    if (!entry.taggedFeatureId && ge.taggedFeatureId) entry.taggedFeatureId = ge.taggedFeatureId;
    if (!entry.taggedPlatformTopic && ge.taggedPlatformTopic) entry.taggedPlatformTopic = ge.taggedPlatformTopic;
    if (!entry.lastSeen && ge.lastSeen) entry.lastSeen = ge.lastSeen;
    if ((!entry.relatedFiles || entry.relatedFiles.length === 0) && ge.relatedFiles && ge.relatedFiles.length > 0) {
      entry.relatedFiles = ge.relatedFiles.slice();
    }
  }
}

// -------- Snapshot parsing --------

/**
 * @param {string} fileName
 * @param {string} sourcePath
 * @param {string} raw
 * @returns {V5Snapshot}
 */
function parseSnapshot(fileName, sourcePath, raw) {
  // Front-matter parse — minimal subset: feature, date.
  let feature = null;
  let date = null;
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const body = fmMatch[1];
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = (m[2] || '').replace(/^["']|["']$/g, '').trim();
      if (key === 'feature') feature = val;
      if (key === 'date') date = val;
    }
  }
  // Title: first H1.
  let title = fileName.replace(/\.md$/, '');
  const h1Match = raw.match(/^#\s+(.+?)\s*$/m);
  if (h1Match) title = h1Match[1];

  return {
    fileName,
    sourcePath,
    feature: feature && /^F-\d{3,}$/.test(feature) ? feature : null,
    date,
    title,
    bodyHash: _shortHash(raw),
  };
}

/**
 * @param {string} s
 */
function _shortHash(s) {
  // Simple FNV-1a 32-bit hash → 8-char hex. Avoids node:crypto for zero-dep purity within the tool.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) & 0xffffffff;
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// -------- Classifier context --------

/**
 * @param {string} projectRoot
 * @returns {ClassifierContext}
 */
function buildClassifierContext(projectRoot) {
  const map = readFeatureMap(projectRoot, null);
  const features = (map.features || []).map((f) => ({ id: f.id, title: f.title, files: f.files || [] }));
  const fileToFeatureId = new Map();
  const featureState = new Map();
  for (const f of features) {
    for (const file of f.files) {
      fileToFeatureId.set(_normalizeRepoPath(file), f.id);
    }
    // featureState — use the lastScan as a proxy since FEATURE-MAP doesn't carry per-feature
    // transitionAt today. The date-proximity heuristic falls back to lastScan when no per-
    // feature timestamp is available.
    featureState.set(f.id, { state: /** @type {any} */ (map.features.find((m) => m.id === f.id) || {}).state || 'planned', transitionAt: map.lastScan || null });
  }
  return { features, fileToFeatureId, featureState };
}

/**
 * @param {string} p
 */
function _normalizeRepoPath(p) {
  return String(p || '').replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\.claude\//, '');
}

/**
 * @param {string} fid
 * @param {ClassifierContext} ctx
 * @returns {string}
 */
function _topicForFeature(fid, ctx) {
  const f = ctx.features.find((x) => x.id === fid);
  if (!f) return _slugify(fid);
  return _slugify(f.title);
}

/**
 * @param {string} s
 */
function _slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^f-\d+\s*[:\-]?\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'topic';
}

// -------- Routing helpers --------

/**
 * @param {V5Entry} entry
 * @param {ClassificationDecision} decision
 * @param {string} projectRoot
 * @param {string} featuresDir
 * @param {string} platformDir
 * @param {(key: string, build: () => PlannedWrite) => PlannedWrite} ensureWrite
 * @param {MigrationPlan} plan
 */
function _routeEntryToWrite(entry, decision, projectRoot, featuresDir, platformDir, ensureWrite, plan) {
  if (decision.destination === 'feature' && decision.featureId) {
    const topic = decision.topic || _slugify(decision.featureId);
    const dest = path.join(featuresDir, `${decision.featureId}-${topic}.md`);
    const w = ensureWrite(dest, () => /** @type {PlannedWrite} */ ({
      destinationPath: dest,
      destinationKind: 'feature',
      featureId: decision.featureId,
      topic,
      decisions: [],
      pitfalls: [],
      snapshots: [],
    }));
    if (entry.kind === 'pitfall') w.pitfalls.push(entry);
    else w.decisions.push(entry);
    return;
  }
  if (decision.destination === 'platform' && decision.topic) {
    const dest = path.join(platformDir, `${decision.topic}.md`);
    const w = ensureWrite(dest, () => /** @type {PlannedWrite} */ ({
      destinationPath: dest,
      destinationKind: 'platform',
      topic: decision.topic,
      decisions: [],
      pitfalls: [],
      snapshots: [],
    }));
    if (entry.kind === 'pitfall') w.pitfalls.push(entry);
    else w.decisions.push(entry);
    return;
  }
  // Unassigned bucket.
  const dest = path.join(platformDir, `${UNASSIGNED_PLATFORM_TOPIC}.md`);
  const w = ensureWrite(dest, () => /** @type {PlannedWrite} */ ({
    destinationPath: dest,
    destinationKind: 'platform',
    topic: UNASSIGNED_PLATFORM_TOPIC,
    decisions: [],
    pitfalls: [],
    snapshots: [],
  }));
  if (entry.kind === 'pitfall') w.pitfalls.push(entry);
  else w.decisions.push(entry);
  plan.unassigned.push({ entry, kind: entry.kind });
}

/**
 * @param {V5Snapshot} snap
 * @param {ClassificationDecision} decision
 * @param {string} projectRoot
 * @param {string} featuresDir
 * @param {string} platformDir
 * @param {(key: string, build: () => PlannedWrite) => PlannedWrite} ensureWrite
 * @param {MigrationPlan} plan
 */
function _routeSnapshotToWrite(snap, decision, projectRoot, featuresDir, platformDir, ensureWrite, plan) {
  if (decision.destination === 'feature' && decision.featureId) {
    const topic = decision.topic || _slugify(decision.featureId);
    const dest = path.join(featuresDir, `${decision.featureId}-${topic}.md`);
    const w = ensureWrite(dest, () => /** @type {PlannedWrite} */ ({
      destinationPath: dest,
      destinationKind: 'feature',
      featureId: decision.featureId,
      topic,
      decisions: [],
      pitfalls: [],
      snapshots: [],
    }));
    w.snapshots.push(snap);
    return;
  }
  // Unassigned snapshots bucket.
  const dest = path.join(platformDir, `${UNASSIGNED_SNAPSHOTS_TOPIC}.md`);
  const w = ensureWrite(dest, () => /** @type {PlannedWrite} */ ({
    destinationPath: dest,
    destinationKind: 'platform',
    topic: UNASSIGNED_SNAPSHOTS_TOPIC,
    decisions: [],
    pitfalls: [],
    snapshots: [],
  }));
  w.snapshots.push(snap);
  plan.unassigned.push({ entry: snap, kind: 'snapshot' });
}

/**
 * @param {{ entry: V5Entry|V5Snapshot, decision: ClassificationDecision, kind: string }} item
 * @param {MigrationPlan} plan
 */
function _autoResolveAmbiguous(item, plan) {
  const candidates = item.decision.candidates || [];
  if (candidates.length === 0) {
    return _routeAmbiguousToUnassigned(item, plan);
  }
  // Pick the highest-confidence candidate.
  const top = candidates.slice().sort((a, b) => b.confidence - a.confidence)[0];
  _routeAmbiguousToCandidate(item, top, plan);
}

/**
 * @param {{ entry: V5Entry|V5Snapshot, decision: ClassificationDecision, kind: string }} item
 * @param {MigrationPlan} plan
 */
function _routeAmbiguousToUnassigned(item, plan) {
  // Re-route through the standard routing helpers using a synthetic 'unassigned' decision.
  const isSnapshot = item.kind === 'snapshot';
  const dest = path.join('platform', isSnapshot ? UNASSIGNED_SNAPSHOTS_TOPIC : UNASSIGNED_PLATFORM_TOPIC);
  // Find / add to writes by destination key.
  const root = _getProjectRootFromPlan(plan) || process.cwd();
  const featuresDir = path.join(root, '.cap', 'memory', 'features');
  const platformDir = path.join(root, '.cap', 'memory', 'platform');
  const ensureWrite = _makeEnsureWrite(plan);
  const synth = /** @type {ClassificationDecision} */ ({
    destination: 'unassigned',
    topic: isSnapshot ? UNASSIGNED_SNAPSHOTS_TOPIC : UNASSIGNED_PLATFORM_TOPIC,
    confidence: 0,
    reasons: ['user-skip'],
  });
  if (isSnapshot) {
    _routeSnapshotToWrite(/** @type {V5Snapshot} */ (item.entry), synth, root, featuresDir, platformDir, ensureWrite, plan);
  } else {
    _routeEntryToWrite(/** @type {V5Entry} */ (item.entry), synth, root, featuresDir, platformDir, ensureWrite, plan);
  }
}

/**
 * @param {{ entry: V5Entry|V5Snapshot, decision: ClassificationDecision, kind: string }} item
 * @param {{ featureId?: string, topic?: string, confidence: number, reason: string }} picked
 * @param {MigrationPlan} plan
 */
function _routeAmbiguousToCandidate(item, picked, plan) {
  const root = _getProjectRootFromPlan(plan) || process.cwd();
  const featuresDir = path.join(root, '.cap', 'memory', 'features');
  const platformDir = path.join(root, '.cap', 'memory', 'platform');
  const ensureWrite = _makeEnsureWrite(plan);
  const synth = /** @type {ClassificationDecision} */ ({
    destination: picked.featureId ? 'feature' : 'platform',
    featureId: picked.featureId,
    topic: picked.topic,
    confidence: picked.confidence,
    reasons: ['user-pick'],
  });
  if (item.kind === 'snapshot') {
    _routeSnapshotToWrite(/** @type {V5Snapshot} */ (item.entry), synth, root, featuresDir, platformDir, ensureWrite, plan);
  } else {
    _routeEntryToWrite(/** @type {V5Entry} */ (item.entry), synth, root, featuresDir, platformDir, ensureWrite, plan);
  }
}

/**
 * Reverse-engineer the project root from an existing planned write — used by ambiguity resolver
 * when re-routing without re-passing context. Falls back to process.cwd() if no writes exist yet.
 * @param {MigrationPlan} plan
 * @returns {string|null}
 */
function _getProjectRootFromPlan(plan) {
  if (!plan.writes || plan.writes.length === 0) return null;
  const w = plan.writes[0];
  // Strip ".cap/memory/(features|platform)/<file>.md" — three trailing path segments.
  const dir = path.dirname(w.destinationPath);
  // dir is e.g. "/abs/.cap/memory/features"; root is dir parent twice.
  return path.dirname(path.dirname(path.dirname(dir)));
}

/**
 * @param {MigrationPlan} plan
 */
function _makeEnsureWrite(plan) {
  /** @type {Map<string, PlannedWrite>} */
  const idx = new Map();
  for (const w of plan.writes) idx.set(w.destinationPath, w);
  return (key, build) => {
    if (idx.has(key)) return /** @type {PlannedWrite} */ (idx.get(key));
    const w = build();
    idx.set(key, w);
    plan.writes.push(w);
    return w;
  };
}

// -------- Atomic-write contract (AC-2) --------

// @cap-todo(ac:F-077/AC-2) _atomicWriteFile is the SINGLE choke point for any write into the
// .cap/memory/features/ or .cap/memory/platform/ tree (and the report/backup dirs). Mirrors
// F-074/D8: writeFileSync to <path>.tmp, then renameSync. Best-effort cleanup on rename failure
// so no orphan .tmp lingers in the destination dir.
// @cap-risk(F-077/AC-2) This is the atomic-write choke point — every write into the V6 layout
// MUST go through this function; bypass it and the migration becomes non-idempotent and a
// crash mid-write can leave a partial file that breaks the F-076 schema validator.
/**
 * @param {string} fp
 * @param {string} content
 */
function _atomicWriteFile(fp, content) {
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  // Use a stable .tmp suffix (not random). Idempotent on retry: a stale .tmp from a previous
  // crash would be overwritten by the new write before the rename. The rename itself is the
  // atomic step. We do NOT use a random suffix because that would generate orphans on each
  // crash — a stable suffix is better in a one-shot tool.
  const tmp = `${fp}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, fp);
  } catch (e) {
    // Best-effort cleanup — leave no .tmp orphan.
    try { fs.unlinkSync(tmp); } catch (_e2) { /* ignore */ }
    throw e;
  }
}

/**
 * @param {PlannedWrite} write
 * @param {number} now
 * @returns {boolean}
 */
function _writePlannedFile(write, now) {
  const content = renderPlannedWrite(write, now);
  // If the destination already exists with byte-identical content, skip — the atomic write would
  // succeed but produce a no-op git diff. Idempotency (AC-2) is asserted at this level: re-runs
  // over the same input must NOT mutate any file. We can't always know mtimes, so byte-compare.
  if (fs.existsSync(write.destinationPath)) {
    try {
      const existing = fs.readFileSync(write.destinationPath, 'utf8');
      if (existing === content) return true;
    } catch (_e) {
      // fallthrough to write
    }
  }
  _atomicWriteFile(write.destinationPath, content);
  return true;
}

// @cap-todo(ac:F-077/AC-3) _writeBackup — idempotent on same-day. If destination exists, skip.
//                          Cross-day re-run produces a new dated archive file.
// @cap-risk(F-077/AC-3) Backup writes must NEVER overwrite a same-day backup with materially
// different content — that would erase audit trail. Implementation: if same-day archive
// already exists, treat as already-archived and skip. This is safe because the only path to
// "same-day backup exists" is a prior successful migration earlier today.
/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean} true if a new backup was written
 */
function _writeBackup(from, to) {
  if (!fs.existsSync(from)) return false;
  if (fs.existsSync(to)) return false; // idempotent same-day skip
  const content = fs.readFileSync(from, 'utf8');
  _atomicWriteFile(to, content);
  return true;
}

// -------- Rendering: PlannedWrite -> markdown content --------

/**
 * @param {PlannedWrite} write
 * @param {number} now
 * @returns {string}
 */
function renderPlannedWrite(write, now) {
  const updated = new Date(now).toISOString();
  /** @type {Object} */
  const fm = { updated };
  if (write.destinationKind === 'feature' && write.featureId) {
    fm.feature = write.featureId;
    fm.topic = write.topic || _slugify(write.featureId);
    // key_files derived from union of related-files across all entries (deduped, sorted).
    const files = new Set();
    for (const e of [...write.decisions, ...write.pitfalls]) {
      for (const f of e.relatedFiles || []) files.add(_normalizeRepoPath(f));
    }
    if (files.size > 0) {
      fm.key_files = [...files].sort();
    }
  } else {
    // Platform topic — synthetic "feature" of the form F-000 is not allowed by the schema
    // because the schema requires a real F-NNN. We still write the file to .cap/memory/platform/
    // but its contents are valid V6: the platform layer (F-078) will refine the schema. For now
    // we use a simplified header without F-NNN — the file is parseable by humans, and F-078
    // will land a stricter platform schema later.
    fm.topic = write.topic || 'topic';
  }

  // Render front-matter manually since we don't always have a full FrontMatter struct.
  const fmLines = [];
  fmLines.push('---');
  if (fm.feature) fmLines.push(`feature: ${fm.feature}`);
  if (fm.topic) fmLines.push(`topic: ${fm.topic}`);
  fmLines.push(`updated: ${fm.updated}`);
  if (fm.key_files && fm.key_files.length > 0) {
    fmLines.push(`key_files: [${fm.key_files.join(', ')}]`);
  }
  fmLines.push('---');
  const fmText = fmLines.join('\n') + '\n';

  // Title
  const titleLine = write.destinationKind === 'feature' && write.featureId
    ? `# ${write.featureId}: ${(write.topic || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
    : `# Platform: ${(write.topic || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;

  // Auto-block (uses F-076 markers).
  const autoBlock = {
    decisions: write.decisions.map((e) => ({
      text: e.title,
      location: _formatLocation(e),
    })),
    pitfalls: write.pitfalls.map((e) => ({
      text: e.title,
      location: _formatLocation(e),
    })),
  };
  // Build via schema's serializer for consistency. We construct a minimal
  // FeatureMemoryFile-shaped object and let serializeFeatureMemoryFile render the auto-block.
  const file = {
    frontmatter: write.destinationKind === 'feature'
      ? { feature: write.featureId, topic: fm.topic, updated: fm.updated, key_files: fm.key_files || undefined }
      : { feature: 'F-000', topic: fm.topic, updated: fm.updated }, // schema requires `feature`; we'll override below
    autoBlock,
    manualBlock: { raw: '' },
  };

  // Render auto-block body via schema's renderer (so markers stay in lock-step with F-076).
  const autoBody = `${schema.AUTO_BLOCK_START_MARKER}\n${_renderAutoBlockBody(autoBlock)}\n${schema.AUTO_BLOCK_END_MARKER}`;

  // Snapshots section (manual block).
  const snapshotLines = [];
  if (write.snapshots.length > 0) {
    snapshotLines.push('');
    snapshotLines.push('## Linked Snapshots');
    snapshotLines.push('');
    for (const s of write.snapshots) {
      const dateLabel = s.date ? ` (${s.date})` : '';
      snapshotLines.push(`- [${s.title}](.cap/snapshots/${s.fileName})${dateLabel}`);
    }
  }

  // Lessons placeholder (manual region — empty by default; users fill in by hand).
  const manualParts = [
    '',
    '## Lessons',
    '',
    '<!-- Manual lessons go here. The auto-block above is regenerated by the memory pipeline. -->',
    '',
    ...snapshotLines,
  ];

  // For platform files, drop the `feature:` line from the front-matter — the schema validator
  // will complain (F-078 will redefine), but the platform writer is allowed to omit it because
  // platform files are NOT feature files. The header row above already excludes `feature:` for
  // platform writes via the conditional in fmLines.
  return `${fmText}\n${titleLine}\n\n${autoBody}\n${manualParts.join('\n')}`;
}

/**
 * Custom auto-block body renderer — mirrors F-076 schema's renderAutoBlockBody but accepts the
 * raw decisions/pitfalls items and avoids the trailing-blank-line oddity for empty sections.
 * @param {{decisions: Array<{text:string,location:string}>, pitfalls: Array<{text:string,location:string}>}} block
 */
function _renderAutoBlockBody(block) {
  const parts = [];
  if (block.decisions.length > 0) {
    parts.push('## Decisions (from tags)');
    for (const d of block.decisions) {
      const loc = d.location ? ` — \`${d.location}\`` : '';
      parts.push(`- ${d.text}${loc}`);
    }
  }
  if (block.pitfalls.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('## Pitfalls (from tags)');
    for (const p of block.pitfalls) {
      const loc = p.location ? ` — \`${p.location}\`` : '';
      parts.push(`- ${p.text}${loc}`);
    }
  }
  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * @param {V5Entry} entry
 */
function _formatLocation(entry) {
  if (entry.relatedFiles && entry.relatedFiles.length > 0) {
    const f = _normalizeRepoPath(entry.relatedFiles[0]);
    return entry.sourceLine > 0 ? `${f}:${entry.sourceLine}` : f;
  }
  return entry.sourceFile || '';
}

// -------- Dry-run report rendering --------

/**
 * @param {MigrationPlan} plan
 * @param {(line: string) => void} log
 */
function _emitDryRunReport(plan, log) {
  const lines = [];
  lines.push('=== V6 MIGRATION DRY-RUN ===');
  lines.push('');
  lines.push('Source files:');
  for (const sourceName of [...V5_SOURCES, ...V5_BINARY_SOURCES]) {
    const c = plan.sourceCounts[sourceName] !== undefined ? plan.sourceCounts[sourceName] : 0;
    const sz = plan.sourceSizes[sourceName] || 0;
    lines.push(`  ${sourceName.padEnd(18)} ${String(c).padStart(5)} entries  (${_humanBytes(sz)})`);
  }
  lines.push('');
  lines.push('Backups would be created:');
  for (const b of plan.backups) {
    const status = b.exists ? 'skip — already exists' : 'new';
    lines.push(`  ${b.to}     (${status})`);
  }
  lines.push('');

  // Auto-classified writes.
  const featureWrites = plan.writes.filter((w) => w.destinationKind === 'feature');
  const platformWrites = plan.writes.filter((w) => w.destinationKind === 'platform');
  lines.push('Auto-classified (confidence ≥ 0.7):');
  for (const w of featureWrites) {
    lines.push(`  → ${path.relative(process.cwd(), w.destinationPath) || w.destinationPath}    ${w.decisions.length} decisions, ${w.pitfalls.length} pitfalls, ${w.snapshots.length} snapshots`);
  }
  for (const w of platformWrites) {
    lines.push(`  → ${path.relative(process.cwd(), w.destinationPath) || w.destinationPath}    ${w.decisions.length} decisions, ${w.pitfalls.length} pitfalls`);
  }
  lines.push('');

  if (plan.ambiguous.length > 0) {
    lines.push('Ambiguous (will need your input on --apply):');
    lines.push(`  ${plan.ambiguous.length} entries with confidence below ${CONFIDENCE_AUTO_THRESHOLD}`);
    lines.push('');
  }
  lines.push('Unassigned (no signal):');
  lines.push(`  ${plan.unassigned.length} entries — will land in .cap/memory/platform/${UNASSIGNED_PLATFORM_TOPIC}.md`);
  lines.push('');
  lines.push(`Re-run with --apply to execute. Use --interactive=false to skip ambiguity prompts (ambiguous entries default to highest-confidence candidate).`);
  lines.push('=== END DRY-RUN ===');
  for (const l of lines) log(l);
}

/**
 * @param {number} bytes
 */
function _humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// -------- Migration report (AC-7) --------

/**
 * @param {string} projectRoot
 * @param {MigrationPlan} plan
 * @param {MigrationResult} result
 * @param {MigrationOptions} opts
 */
function _buildReportData(projectRoot, plan, result, opts) {
  const totalEntries = plan.writes.reduce((acc, w) => acc + w.decisions.length + w.pitfalls.length, 0);
  const featureWrites = plan.writes.filter((w) => w.destinationKind === 'feature');
  const platformWrites = plan.writes.filter((w) => w.destinationKind === 'platform');
  const assigned = featureWrites.reduce((acc, w) => acc + w.decisions.length + w.pitfalls.length, 0);
  const platform = platformWrites.filter((w) => w.topic !== UNASSIGNED_PLATFORM_TOPIC).reduce((acc, w) => acc + w.decisions.length + w.pitfalls.length, 0);
  const skipped = platformWrites.filter((w) => w.topic === UNASSIGNED_PLATFORM_TOPIC).reduce((acc, w) => acc + w.decisions.length + w.pitfalls.length, 0);
  return {
    date: new Date(opts.now).toISOString(),
    projectRoot,
    mode: opts.interactive ? '--apply (interactive)' : '--apply (non-interactive)',
    counts: {
      total: totalEntries,
      assigned,
      platform,
      skipped,
    },
    writes: {
      featureFiles: featureWrites.length,
      platformFiles: platformWrites.length,
      filenames: result.wroteFiles.slice().sort(),
    },
    backups: result.backups.slice().sort(),
    errors: result.errors.slice(),
  };
}

/**
 * @param {ReturnType<typeof _buildReportData>} data
 */
function _renderReport(data) {
  const lines = [];
  lines.push('# V6 Migration Report');
  lines.push(`Date: ${data.date}`);
  lines.push(`Project: ${data.projectRoot}`);
  lines.push(`Mode: ${data.mode}`);
  lines.push('');
  lines.push('## Counts');
  lines.push(`- Total V5 entries processed: ${data.counts.total}`);
  lines.push(`- Assigned to feature files: ${data.counts.assigned}`);
  lines.push(`- Routed to platform bucket: ${data.counts.platform}`);
  lines.push(`- Skipped (unassigned): ${data.counts.skipped}`);
  lines.push('');
  lines.push('## Files written');
  lines.push(`- ${data.writes.featureFiles} feature files at .cap/memory/features/`);
  lines.push(`- ${data.writes.platformFiles} platform files at .cap/memory/platform/`);
  if (data.writes.filenames.length > 0) {
    lines.push('');
    for (const fn of data.writes.filenames) lines.push(`- ${fn}`);
  }
  lines.push('');
  lines.push('## Backups');
  if (data.backups.length === 0) {
    lines.push('- (none)');
  } else {
    for (const b of data.backups) lines.push(`- ${b}`);
  }
  lines.push('');
  lines.push('## Errors');
  if (data.errors.length === 0) lines.push('(none)');
  else for (const e of data.errors) lines.push(`- ${e}`);
  lines.push('');
  return lines.join('\n');
}

// -------- Prompt helpers --------

/**
 * @param {{ entry: V5Entry|V5Snapshot, decision: ClassificationDecision, kind: string }} item
 * @param {number} idx
 * @param {number} total
 * @param {MigrationOptions} opts
 * @returns {Promise<string>}
 */
async function _promptAmbiguity(item, idx, total, opts) {
  const titleLine = `[Ambiguity ${idx}/${total}] ${item.kind}: "${(/** @type {any} */ (item.entry)).title || (/** @type {any} */ (item.entry)).fileName || ''}"`;
  const lines = [titleLine];
  if (item.kind !== 'snapshot') {
    const e = /** @type {V5Entry} */ (item.entry);
    if (e.relatedFiles && e.relatedFiles.length > 0) {
      lines.push(`   Sources: ${e.relatedFiles.join(', ')}`);
    }
  }
  const candidates = item.decision.candidates || [];
  lines.push('   Top candidates:');
  if (candidates.length === 0) {
    lines.push('     (no candidates — will route to unassigned on skip)');
  } else {
    candidates.slice(0, 3).forEach((c, i) => {
      const where = c.featureId ? c.featureId : `platform/${c.topic}`;
      lines.push(`     [${i + 1}] ${where} — confidence ${c.confidence.toFixed(2)}, ${c.reason}`);
    });
  }
  lines.push('   [s] Skip (route to platform/unassigned)');
  lines.push('   [a] Auto-assign all remaining (confidence-best wins)');
  lines.push('   [q] Quit migration');
  const promptText = lines.join('\n') + '\n   Choice: ';
  return _ask(promptText, opts);
}

/**
 * @param {MigrationPlan} plan
 * @param {MigrationOptions} opts
 * @returns {Promise<boolean>}
 */
async function _confirmApply(plan, opts) {
  const total = plan.writes.length;
  const ambiguous = plan.ambiguous.length;
  const text = `About to write ${total} V6 files (${ambiguous} entries need your input). Proceed? [y/N]: `;
  const answer = (await _ask(text, opts)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/**
 * @param {string} text
 * @param {MigrationOptions} opts
 * @returns {Promise<string>}
 */
function _ask(text, opts) {
  // Test injection: if _testPromptResponses is provided, consume from it.
  if (Array.isArray(opts._testPromptResponses) && opts._testPromptResponses.length > 0) {
    const response = opts._testPromptResponses.shift();
    return Promise.resolve((response && response.choice) || '');
  }
  if (opts.promptFn) {
    return opts.promptFn(text);
  }
  // Default readline prompt.
  // @cap-decision(F-077/D5) On non-TTY stdin (CI, piped input, headless run without
  //                  --interactive=false), `'close'` fires before any user keystroke and
  //                  rl.question's callback never runs → hang until external SIGKILL. Resolve
  //                  to '' on close so EOF behaves like empty input → routes to unassigned via
  //                  D4. Promise is idempotent (only first resolve takes effect), so the
  //                  question callback in the happy path still wins when input arrives.
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.on('close', () => resolve(''));
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// -------- Misc helpers --------

/**
 * @param {number} now
 */
function _isoDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * @param {V5Entry} a
 * @param {V5Entry} b
 */
function _compareEntriesByText(a, b) {
  if (a.title !== b.title) return a.title.localeCompare(b.title);
  return (a.sourceFile || '').localeCompare(b.sourceFile || '') || a.sourceLine - b.sourceLine;
}

/**
 * @param {MigrationOptions=} options
 */
function _normalizeOptions(options) {
  const o = options || {};
  return {
    dryRun: o.apply ? false : (o.dryRun !== false),
    apply: !!o.apply,
    interactive: o.interactive !== false,
    now: typeof o.now === 'number' ? o.now : Date.now(),
    promptFn: o.promptFn,
    confirmFn: o.confirmFn,
    log: o.log || ((line) => { try { process.stderr.write(line + '\n'); } catch (_e) { /* ignore */ } }),
    _testPromptResponses: o._testPromptResponses,
  };
}

// -------- Exports --------

module.exports = {
  // public API
  migrateMemory,
  buildMigrationPlan,
  classifyEntry,
  classifySnapshot,
  resolveAmbiguities,
  buildClassifierContext,
  // parsers (exported for tests)
  parseV5MarkdownFile,
  parseGraphJson,
  parseSnapshot,
  // rendering (exported for tests)
  renderPlannedWrite,
  // constants
  CONFIDENCE_AUTO_THRESHOLD,
  BACKUP_DIR,
  UNASSIGNED_PLATFORM_TOPIC,
  UNASSIGNED_SNAPSHOTS_TOPIC,
  V5_SOURCES,
  V5_BINARY_SOURCES,
  // internals (exported for tests only)
  _atomicWriteFile,
  _writeBackup,
  _isoDate,
  _normalizeRepoPath,
  _slugify,
};
