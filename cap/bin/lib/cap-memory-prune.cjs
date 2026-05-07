// @cap-feature(feature:F-056) Memory Prune Command — decay, archive, raw-log purge.
// @cap-decision Default dry-run — --apply required to mutate files (AC-2 is a data-safety commitment).
// @cap-decision Archive path uses the archival month (when pruned), not the entry's own month — simplifies filename collisions and gives a rolling history.
// @cap-decision Pinned entries (metadata.pinned:true) are never decayed nor archived — F-030 pin semantics outweigh decay/TTL.
// @cap-constraint Zero external deps — node: built-ins only.

'use strict';

// @cap-history(sessions:2, edits:7, since:2026-04-20, learned:2026-04-21) Frequently modified — 2 sessions, 7 edits
const fs = require('node:fs');
const path = require('node:path');

const confidence = require('./cap-memory-confidence.cjs');
const {
  writeMemoryDirectory,
  readMemoryFile,
  MEMORY_DIR,
  CATEGORY_FILES,
} = require('./cap-memory-dir.cjs');
// @cap-feature(feature:F-086) cap-memory-prune consumes the shared scope filter so its
//   --gitignored mode uses the same path-decision logic as the scanner and migrator.
const scopeModule = require('./cap-scope-filter.cjs');

// --- Constants ---

const DECAY_START_DAYS = 90;
const DECAY_STEP_DAYS = 30;
const DECAY_AMOUNT = 0.05;
const ARCHIVE_CONFIDENCE_THRESHOLD = 0.2;
const ARCHIVE_AGE_DAYS = 180;
const RAW_LOG_RETENTION_DAYS = 30;
const CONFIDENCE_FLOOR = 0.0;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RAW_LOG_DIR_PARTS = ['.cap', 'memory', 'raw'];
const ARCHIVE_DIR_PARTS = ['.cap', 'memory', 'archive'];
const PRUNE_LOG_PARTS = ['.cap', 'memory', 'prune-log.jsonl'];

// Decay-eligible categories: hotspots excluded (ranking-table format, regenerated fresh each run).
const DECAY_CATEGORIES = ['decision', 'pitfall', 'pattern'];

// --- Types ---

/**
 * @typedef {{category:string, content:string, file?:string, metadata:Object}} MemoryEntry
 */

// --- Pure helpers ---

/**
 * @param {Date|string|undefined|null} value
 * @returns {number|null} milliseconds since epoch, or null if invalid
 */
function toMillis(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    // Date.parse silently normalises overflow calendar dates ("2026-02-30" → March 2),
    // which would make "invalid" inputs yield plausible ages. Reject anything whose
    // YYYY-MM-DD prefix doesn't roundtrip through the parsed timestamp.
    const isoPrefix = value.substring(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoPrefix) && new Date(ms).toISOString().substring(0, 10) !== isoPrefix) {
      return null;
    }
    return ms;
  }
  return null;
}

/**
 * Whole days between two Date-or-ISO-string inputs. UTC-aligned, floored.
 * Invalid inputs yield Infinity (semantically "very old").
 * @param {Date|string} a
 * @param {Date|string} b
 * @returns {number}
 */
function daysBetween(a, b) {
  const ma = toMillis(a);
  const mb = toMillis(b);
  if (ma === null || mb === null) return Infinity;
  return Math.floor(Math.abs(mb - ma) / MS_PER_DAY);
}

/**
 * Compute decayed confidence for an entry.
 * 0 steps when age <= DECAY_START_DAYS.
 * Otherwise floor((age - start) / step) decay events of DECAY_AMOUNT each.
 * Floored at CONFIDENCE_FLOOR.
 * @cap-todo(ac:F-056/AC-3)
 * @param {number} currentConfidence
 * @param {Date|string} lastSeen
 * @param {Date} now
 * @returns {{newConfidence:number, steps:number}}
 */
function computeDecay(currentConfidence, lastSeen, now) {
  const age = daysBetween(lastSeen, now);
  if (!Number.isFinite(age)) {
    // "Very old" — run decay until floor.
    const raw = typeof currentConfidence === 'number' ? currentConfidence : confidence.DEFAULT_CONFIDENCE;
    return { newConfidence: CONFIDENCE_FLOOR, steps: Math.ceil(raw / DECAY_AMOUNT) };
  }
  if (age <= DECAY_START_DAYS) {
    return { newConfidence: round2(currentConfidence), steps: 0 };
  }
  const steps = Math.floor((age - DECAY_START_DAYS) / DECAY_STEP_DAYS);
  if (steps <= 0) {
    return { newConfidence: round2(currentConfidence), steps: 0 };
  }
  const raw = Math.max(CONFIDENCE_FLOOR, currentConfidence - steps * DECAY_AMOUNT);
  return { newConfidence: round2(raw), steps };
}

/**
 * @cap-todo(ac:F-056/AC-4)
 * @param {number} conf
 * @param {Date|string} lastSeen
 * @param {Date} now
 * @returns {boolean}
 */
function shouldArchive(conf, lastSeen, now) {
  const age = daysBetween(lastSeen, now);
  if (typeof conf !== 'number' || Number.isNaN(conf)) return false;
  return conf < ARCHIVE_CONFIDENCE_THRESHOLD && age > ARCHIVE_AGE_DAYS;
}

/**
 * Two-decimal rounding to keep markdown clean (avoids 0.30000000000000004).
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Split entries into kept / decayed / archived buckets.
 * Decay is applied BEFORE the archive check so an entry that crosses the
 * ARCHIVE_CONFIDENCE_THRESHOLD *due to decay* is archived in the same run.
 * Pinned entries bypass both.
 * @cap-todo(ac:F-056/AC-3)
 * @cap-todo(ac:F-056/AC-4)
 * @param {MemoryEntry[]} entries
 * @param {Date} now
 * @returns {{kept:MemoryEntry[], decayed:Array<{entry:MemoryEntry, oldConf:number, newConf:number, steps:number}>, archived:MemoryEntry[]}}
 */
function classifyEntries(entries, now) {
  const kept = [];
  const decayed = [];
  const archived = [];

  for (const raw of entries || []) {
    if (!raw || !raw.metadata) {
      kept.push(raw);
      continue;
    }

    const meta = confidence.ensureFields(raw.metadata);
    const entry = { ...raw, metadata: meta };

    if (meta.pinned === true) {
      kept.push(entry);
      continue;
    }

    const { newConfidence, steps } = computeDecay(meta.confidence, meta.last_seen, now);
    const didDecay = steps > 0 && newConfidence !== meta.confidence;

    const postDecayMeta = didDecay
      ? { ...meta, confidence: newConfidence }
      : meta;
    const postDecayEntry = didDecay
      ? { ...entry, metadata: postDecayMeta }
      : entry;

    if (shouldArchive(postDecayMeta.confidence, postDecayMeta.last_seen, now)) {
      archived.push(postDecayEntry);
      continue;
    }

    if (didDecay) {
      decayed.push({ entry: postDecayEntry, oldConf: meta.confidence, newConf: newConfidence, steps });
    }
    kept.push(postDecayEntry);
  }

  return { kept, decayed, archived };
}

// --- Raw-log selection (AC-5) ---

const RAW_LOG_FILENAME_RE = /^tag-events-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

/**
 * Select raw-event-log files older than maxAgeDays.
 * Ignores files without the tag-events-YYYY-MM-DD prefix, invalid dates, and subdirectories.
 * @cap-todo(ac:F-056/AC-5)
 * @param {string} rawDir - Absolute directory path
 * @param {Date} now
 * @param {number} [maxAgeDays=RAW_LOG_RETENTION_DAYS]
 * @returns {string[]} Absolute paths of stale log files
 */
function selectStaleRawLogs(rawDir, now, maxAgeDays = RAW_LOG_RETENTION_DAYS) {
  if (!rawDir || !fs.existsSync(rawDir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(rawDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const stale = [];
  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    const m = RAW_LOG_FILENAME_RE.exec(dirent.name);
    if (!m) continue;
    const iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
    const age = daysBetween(iso, now);
    if (!Number.isFinite(age)) continue;
    if (age > maxAgeDays) {
      stale.push(path.join(rawDir, dirent.name));
    }
  }
  return stale;
}

// --- Reporting ---

/**
 * Human-readable report block.
 * @param {{dryRun:boolean, decayed:number, archived:number, purged:number, rawLogFiles:string[], migrationWarning?:boolean}} result
 * @returns {string}
 */
function formatReport(result) {
  const mode = result.dryRun ? 'DRY-RUN (no files written)' : 'APPLIED';
  const lines = [
    'Memory Prune Report',
    `  Mode:     ${mode}`,
    `  Decayed:  ${result.decayed}`,
    `  Archived: ${result.archived}`,
    `  Purged:   ${result.purged} raw-log file(s)`,
  ];
  if (result.rawLogFiles && result.rawLogFiles.length > 0) {
    lines.push('  Raw logs targeted:');
    for (const f of result.rawLogFiles) lines.push(`    - ${path.basename(f)}`);
  }
  if (result.migrationWarning) {
    lines.push('');
    lines.push('Warning: archive count dwarfs decay count — likely a first-run migration');
    lines.push('  of pre-F-055 memory files (missing last_seen, treated as Infinity-age).');
    lines.push('  Review archived entries before committing.');
  }
  if (result.dryRun) {
    lines.push('');
    lines.push('Rerun with --apply to commit these changes.');
  }
  return lines.join('\n');
}

/**
 * Single-line JSONL record for prune-log.jsonl.
 * @cap-todo(ac:F-056/AC-6)
 * @param {{dryRun:boolean, decayed:number, archived:number, purged:number, archiveFile?:string|null, errors?:Array}} result
 * @param {Date} now
 * @returns {string}
 */
function formatPruneLogEntry(result, now) {
  const payload = {
    timestamp: (now instanceof Date ? now : new Date()).toISOString(),
    dryRun: !!result.dryRun,
    decayed: result.decayed | 0,
    archived: result.archived | 0,
    purged: result.purged | 0,
    // Additive (new in review follow-up): keep the payload shape extensible without
    // breaking older log-consumers that read only the original keys.
    archiveFile: result.archiveFile ? path.basename(result.archiveFile) : null,
    errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
  };
  return JSON.stringify(payload) + '\n';
}

/**
 * Normalise an Error-or-string into a short, log-safe message string.
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

// --- Archive writing ---

/**
 * Format a single archived entry as a markdown block for the archive file.
 * @param {MemoryEntry} entry
 * @param {Date} now
 * @returns {string}
 */
function formatArchivedEntry(entry, now) {
  const meta = confidence.ensureFields(entry.metadata);
  const safeContent = String(entry.content || '').replace(/[\r\n]+/g, ' ');
  const files = meta.relatedFiles?.length > 0
    ? meta.relatedFiles.map((f) => `\`${f}\``).join(', ')
    : 'cross-cutting';
  const features = meta.features?.length > 0 ? ` (${meta.features.join(', ')})` : '';
  const date = meta.source ? String(meta.source).substring(0, 10) : 'unknown';
  const archivedAt = (now instanceof Date ? now : new Date()).toISOString();
  return [
    `### ${safeContent}`,
    `- **Category:** ${entry.category}`,
    `- **Date:** ${date}${features}`,
    `- **Files:** ${files}`,
    `- **Confidence:** ${meta.confidence.toFixed(2)}`,
    `- **Evidence:** ${meta.evidence_count}`,
    `- **Last Seen:** ${meta.last_seen}`,
    `- **Archived At:** ${archivedAt}`,
    '',
  ].join('\n');
}

/**
 * Append-or-create archive markdown for the current archival month.
 * Idempotent: multiple runs in the same month append to the same file.
 * @cap-todo(ac:F-056/AC-4)
 * @param {string} archiveDir
 * @param {MemoryEntry[]} archivedEntries
 * @param {Date} now
 * @returns {string|null} filepath written, or null if nothing to archive
 */
function writeArchive(archiveDir, archivedEntries, now) {
  if (!archivedEntries || archivedEntries.length === 0) return null;
  const d = now instanceof Date ? now : new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const filename = `${yyyy}-${mm}.md`;
  const filepath = path.join(archiveDir, filename);

  fs.mkdirSync(archiveDir, { recursive: true });

  let body = '';
  if (!fs.existsSync(filepath)) {
    body += `# Memory Archive: ${yyyy}-${mm}\n\n`;
    body += '> Entries archived from project memory because they fell below confidence and age thresholds.\n';
    body += '> Archive is additive — entries can be appended but are not mutated in place.\n\n';
  }
  for (const entry of archivedEntries) {
    body += formatArchivedEntry(entry, d);
  }
  fs.appendFileSync(filepath, body, 'utf8');
  return filepath;
}

// --- Main entry point ---

/**
 * Classify entries across all decay-eligible category files.
 * @param {string} memDir
 * @param {Date} now
 * @returns {{perCategoryKept:Object, allDecayed:Array, allArchived:MemoryEntry[], errors:Array}}
 */
function classifyPhase(memDir, now) {
  const allDecayed = [];
  const allArchived = [];
  const perCategoryKept = {};
  const errors = [];

  for (const category of DECAY_CATEGORIES) {
    try {
      const fp = path.join(memDir, CATEGORY_FILES[category]);
      const { entries } = readMemoryFile(fp);
      const enriched = entries.map((e) => ({ category, content: e.content, metadata: e.metadata }));
      const { kept, decayed, archived } = classifyEntries(enriched, now);
      perCategoryKept[category] = kept;
      for (const d of decayed) allDecayed.push(d);
      for (const a of archived) allArchived.push(a);
    } catch (err) {
      errors.push({ stage: `classify:${category}`, message: errorMessage(err) });
      perCategoryKept[category] = [];
    }
  }

  return { perCategoryKept, allDecayed, allArchived, errors };
}

/**
 * Apply the side-effects of a prune run: write archive, rewrite memory files,
 * purge stale raw logs, append the prune-log record. Each stage captures its
 * own errors into `errors`; archive/memory failures short-circuit the
 * remainder to avoid partial rewrites.
 *
 * @param {{projectRoot:string, archiveDir:string, pruneLogPath:string, rawLogFiles:string[], allArchived:MemoryEntry[], perCategoryKept:Object, now:Date}} ctx
 * @param {Object} result - mutated in place with final counts + archiveFile
 * @param {Array} errors - mutated in place with per-stage failures
 * @returns {void}
 */
function applySideEffects(ctx, result, errors) {
  const { projectRoot, archiveDir, pruneLogPath, rawLogFiles, allArchived, perCategoryKept, now } = ctx;

  const entriesToWrite = [];
  for (const category of DECAY_CATEGORIES) {
    for (const e of perCategoryKept[category] || []) {
      entriesToWrite.push({ category, content: e.content, file: e.file, metadata: e.metadata });
    }
  }

  // Archive first so a failed archive leaves live memory intact and archived
  // entries remain recoverable on the next run. If archive succeeds but memory
  // rewrite fails, we re-archive idempotent duplicates — never data loss.
  try {
    result.archiveFile = writeArchive(archiveDir, allArchived, now);
  } catch (err) {
    errors.push({ stage: 'write-archive', message: errorMessage(err) });
    return;
  }

  try {
    writeMemoryDirectory(projectRoot, entriesToWrite);
  } catch (err) {
    errors.push({ stage: 'write-memory', message: errorMessage(err) });
    return;
  }

  const purgedOk = [];
  for (const f of rawLogFiles) {
    try {
      fs.unlinkSync(f);
      purgedOk.push(f);
    } catch (err) {
      errors.push({ stage: 'unlink-raw-log', message: `${path.basename(f)}: ${errorMessage(err)}` });
    }
  }
  result.purgedFiles = purgedOk;
  result.purged = purgedOk.length;

  try {
    fs.mkdirSync(path.dirname(pruneLogPath), { recursive: true });
    fs.appendFileSync(pruneLogPath, formatPruneLogEntry(result, now), 'utf8');
  } catch (err) {
    errors.push({ stage: 'append-prune-log', message: errorMessage(err) });
  }
}

/**
 * Prune project memory: decay stale entries, archive very-stale low-confidence ones,
 * purge old raw-event-log files.
 *
 * @cap-todo(ac:F-056/AC-1)
 * @cap-todo(ac:F-056/AC-2)
 * @cap-todo(ac:F-056/AC-6)
 * @param {string} projectRoot
 * @param {{apply?:boolean, now?:Date}} [options]
 * @returns {{dryRun:boolean, decayed:number, archived:number, purged:number, decayedEntries:Array, archivedEntries:MemoryEntry[], purgedFiles:string[], rawLogFiles:string[], archiveFile:string|null, migrationWarning:boolean, errors:Array<{stage:string, message:string}>}}
 */
function prune(projectRoot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const apply = options.apply === true;

  const memDir = path.join(projectRoot, MEMORY_DIR);
  const rawDir = path.join(projectRoot, ...RAW_LOG_DIR_PARTS);
  const archiveDir = path.join(projectRoot, ...ARCHIVE_DIR_PARTS);
  const pruneLogPath = path.join(projectRoot, ...PRUNE_LOG_PARTS);

  const { perCategoryKept, allDecayed, allArchived, errors } = classifyPhase(memDir, now);

  // selectStaleRawLogs already swallows its own I/O errors (empty/missing dir,
  // readdir failure) and returns []. Wrapping it in an outer try/catch was
  // redundant dead code — the inner handler is authoritative.
  const rawLogFiles = selectStaleRawLogs(rawDir, now, RAW_LOG_RETENTION_DAYS);

  // Migration warning: if a run archives dramatically more than it decays,
  // the most likely cause is pre-F-055 memory files that lack last_seen —
  // classifyEntries then treats them as Infinity-age and archives wholesale.
  // Flag so the CLI can surface a "looks like a first-run migration" hint.
  const migrationWarning = allArchived.length >= 5 && allArchived.length > allDecayed.length * 4;

  const result = {
    dryRun: !apply,
    decayed: allDecayed.length,
    archived: allArchived.length,
    purged: rawLogFiles.length,
    decayedEntries: allDecayed,
    archivedEntries: allArchived,
    purgedFiles: rawLogFiles.slice(),
    rawLogFiles: rawLogFiles.slice(),
    archiveFile: null,
    migrationWarning,
    errors,
  };

  if (!apply) return result;

  applySideEffects(
    { projectRoot, archiveDir, pruneLogPath, rawLogFiles, allArchived, perCategoryKept, now },
    result,
    errors,
  );

  return result;
}

// ---------------------------------------------------------------------------
// F-086/AC-3: pruneGitignored — clean already-existing memory files of entries
//   whose related-files would now be excluded by the scope filter. Useful for
//   projects that bootstrapped with a pre-F-085 CAP version and accumulated
//   build-output decisions / bundle-artefact references in their memory files.

// @cap-todo(ac:F-086/AC-3) V6 platform-memory bullet pattern: bullet line ending with a
//   backtick-wrapped path:linenum reference. We extract the path, drop the line if the
//   scope filter would exclude it. Auto-block markers (cap:auto:start / end) and headings
//   are preserved verbatim.
const V6_BULLET_PATH_RE = /`([^`\s][^`]*?)(?::\d+)?`\s*$/;

/**
 * Scan V5 monolith files (decisions/pitfalls/patterns/hotspots) and V6 platform/feature
 * files for entries whose source file is now out-of-scope per the scope filter.
 *
 * Default behaviour is dry-run; pass `apply: true` to rewrite the files. Returns counts
 * + per-file diffs so callers can render a report before committing.
 *
 * @param {string} projectRoot
 * @param {{apply?: boolean, scope?: import('./cap-scope-filter.cjs').ScopeFilter}} [options]
 * @returns {{
 *   dryRun: boolean,
 *   v5RemovedTotal: number,
 *   v6RemovedTotal: number,
 *   v5Files: Array<{file: string, removed: string[], kept: number}>,
 *   v6Files: Array<{file: string, removed: string[], kept: number}>,
 *   errors: Array<{stage: string, message: string}>
 * }}
 */
function pruneGitignored(projectRoot, options) {
  const opts = options || {};
  const apply = opts.apply === true;
  const scope = opts.scope || scopeModule.buildScopeFilter(projectRoot);

  const result = {
    dryRun: !apply,
    v5RemovedTotal: 0,
    v6RemovedTotal: 0,
    v5Files: [],
    v6Files: [],
    errors: [],
  };

  // ---- V5 monolith files ----
  for (const [, filename] of Object.entries(CATEGORY_FILES)) {
    const fp = path.join(projectRoot, MEMORY_DIR, filename);
    if (!fs.existsSync(fp)) continue;
    try {
      const { entries } = readMemoryFile(fp);
      const kept = [];
      const removed = [];
      for (const entry of entries) {
        const files = (entry.metadata && Array.isArray(entry.metadata.relatedFiles)) ? entry.metadata.relatedFiles : [];
        // Drop entry only when ALL related files are out-of-scope (and there's at least one to judge by).
        if (files.length > 0 && files.every((f) => scope.isExcluded(path.resolve(projectRoot, f), false))) {
          removed.push(entry.content);
        } else {
          kept.push(entry);
        }
      }
      result.v5RemovedTotal += removed.length;
      result.v5Files.push({ file: path.relative(projectRoot, fp), removed, kept: kept.length });
      if (apply && removed.length > 0) {
        // Re-render via writeMemoryDirectory in non-merge mode (full overwrite of this file's category).
        // The `category` is derived from the filename via reverse-lookup.
        const category = Object.entries(CATEGORY_FILES).find(([, fn]) => fn === filename)[0];
        const re = require('./cap-memory-dir.cjs');
        const md = re.generateCategoryMarkdown
          ? re.generateCategoryMarkdown(category, kept.map((e) => ({ category, ...e })))
          : null;
        if (md != null) {
          const tmp = fp + '.tmp';
          fs.writeFileSync(tmp, md, 'utf8');
          fs.renameSync(tmp, fp);
        }
      }
    } catch (err) {
      result.errors.push({ stage: `v5:${filename}`, message: errorMessage(err) });
    }
  }

  // ---- V6 platform/feature files ----
  // Walk .cap/memory/platform/*.md and .cap/memory/features/*.md
  const v6Dirs = [
    path.join(projectRoot, MEMORY_DIR, 'platform'),
    path.join(projectRoot, MEMORY_DIR, 'features'),
  ];
  for (const dir of v6Dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      result.errors.push({ stage: `v6:readdir:${path.relative(projectRoot, dir)}`, message: errorMessage(err) });
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const fp = path.join(dir, name);
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        const lines = raw.split('\n');
        const newLines = [];
        const removed = [];
        let kept = 0;
        for (const line of lines) {
          const isBullet = /^- /.test(line);
          if (isBullet) {
            const match = V6_BULLET_PATH_RE.exec(line);
            if (match) {
              const filePath = match[1];
              if (scope.isExcluded(path.resolve(projectRoot, filePath), false)) {
                removed.push(line.trim());
                continue; // drop this line
              }
              kept++;
            }
          }
          newLines.push(line);
        }
        result.v6RemovedTotal += removed.length;
        result.v6Files.push({ file: path.relative(projectRoot, fp), removed, kept });
        if (apply && removed.length > 0) {
          const tmp = fp + '.tmp';
          fs.writeFileSync(tmp, newLines.join('\n'), 'utf8');
          fs.renameSync(tmp, fp);
        }
      } catch (err) {
        result.errors.push({ stage: `v6:${path.relative(projectRoot, fp)}`, message: errorMessage(err) });
      }
    }
  }

  return result;
}

/**
 * Format a prune-gitignored result as a human-readable report.
 * @param {ReturnType<typeof pruneGitignored>} result
 * @returns {string}
 */
function formatGitignoredReport(result) {
  const lines = [];
  lines.push(`cap:memory prune --gitignored ${result.dryRun ? '(dry-run)' : '(applied)'}`);
  lines.push(`  V5 entries removed: ${result.v5RemovedTotal}`);
  lines.push(`  V6 lines removed:   ${result.v6RemovedTotal}`);
  if (result.v5Files.length > 0) {
    const dirty = result.v5Files.filter((f) => f.removed.length > 0);
    if (dirty.length > 0) {
      lines.push('');
      lines.push('V5 files affected:');
      for (const f of dirty) lines.push(`  ${f.file} — ${f.removed.length} removed, ${f.kept} kept`);
    }
  }
  if (result.v6Files.length > 0) {
    const dirty = result.v6Files.filter((f) => f.removed.length > 0);
    if (dirty.length > 0) {
      lines.push('');
      lines.push('V6 files affected:');
      for (const f of dirty) lines.push(`  ${f.file} — ${f.removed.length} removed, ${f.kept} kept`);
    }
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const e of result.errors) lines.push(`  ${e.stage}: ${e.message}`);
  }
  return lines.join('\n');
}

module.exports = {
  DECAY_START_DAYS,
  DECAY_STEP_DAYS,
  DECAY_AMOUNT,
  ARCHIVE_CONFIDENCE_THRESHOLD,
  ARCHIVE_AGE_DAYS,
  RAW_LOG_RETENTION_DAYS,
  CONFIDENCE_FLOOR,

  daysBetween,
  computeDecay,
  shouldArchive,
  classifyEntries,
  selectStaleRawLogs,
  formatReport,
  formatPruneLogEntry,
  formatArchivedEntry,
  writeArchive,
  // Exported for unit testing — not part of the CLI surface.
  classifyPhase,
  applySideEffects,
  errorMessage,
  prune,
  // F-086/AC-3
  pruneGitignored,
  formatGitignoredReport,
};
