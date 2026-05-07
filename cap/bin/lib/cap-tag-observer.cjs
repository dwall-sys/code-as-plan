'use strict';

// @cap-feature(feature:F-054) Hook-Based Tag Event Observation — pure logic module (extractTags, diffTags, snapshot I/O, event append).
// @cap-decision Snapshot-basiert statt PreToolUse — ein einheitlicher Code-Pfad für alle vier Tools (Edit/Write/MultiEdit/NotebookEdit), robust gegen Tool-Input-Schema-Änderungen, weil wir immer den aktuellen Datei-Inhalt neu lesen und gegen einen persistenten Snapshot diffen.
// @cap-constraint Zero external dependencies — nur node:-prefixed Built-ins (fs, path, crypto).

// @cap-history(sessions:2, edits:5, since:2026-04-20, learned:2026-04-21) Frequently modified — 2 sessions, 5 edits
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// @cap-decision Tag-Regex bewusst eng an cap-tag-scanner.cjs gehalten (dort: `/^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(feature|todo|risk|decision)(?:\(([^)]*)\))?[ \t]*(.*)/`). Für F-054 beschränken wir uns explizit auf `feature|todo` (Scope des Memory-Events) und matchen Comment-Tokens zeilengenau, damit @cap-Strings innerhalb von String-Literalen oder Prosa nicht gezählt werden.
const TAG_LINE_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(?:feature|todo)(?:[ \t]*\([^)]*\))?[ \t]*.*$/;

// Matches the tag token (type + optional metadata in parens). Global flag enables matchAll so multiple tokens on the same comment line are captured; `[ \t]*` before the paren tolerates `@cap-todo ( ac:F-1/AC-1 )`-style whitespace which is then stripped by the caller's normalisation step.
const TAG_TOKEN_RE = /@cap-(?:feature|todo)(?:[ \t]*\([^)]*\))?/g;

/**
 * Extract @cap-feature and @cap-todo tags from file content.
 *
 * Returns normalized tag identities as strings (e.g. `@cap-todo(ac:F-054/AC-1)`).
 * Metadata inside parens is part of the identity, so
 * `@cap-todo(ac:F-054/AC-1)` and `@cap-todo(ac:F-054/AC-2)` are distinct tags.
 * Duplicates within the same file are deduplicated (Set-based).
 *
 * @cap-todo(ac:F-054/AC-2) extractTags ist die linke Hand des Diff — jede
 *   Datei wird zu einer dedup'd Menge von @cap-feature/@cap-todo Tags normalisiert,
 *   damit added/removed gegen den Snapshot ein reines Set-Delta bleibt.
 *
 * @param {string} content - File content to scan
 * @returns {string[]} Sorted unique tag identities
 */
function extractTags(content) {
  if (typeof content !== 'string' || content.length === 0) return [];
  const seen = new Set();
  const lines = content.split('\n');
  for (const line of lines) {
    if (!TAG_LINE_RE.test(line)) continue;
    for (const match of line.matchAll(TAG_TOKEN_RE)) {
      // Normalise internal whitespace: `@cap-todo ( ac:F-1/AC-1 )` -> `@cap-todo(ac:F-1/AC-1)`.
      const tag = match[0].replace(/\s+/g, '');
      seen.add(tag);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Compute added/removed tag sets between two normalized tag arrays.
 *
 * @cap-todo(ac:F-054/AC-2) diffTags erzeugt das Delta, das später als JSONL-Event
 *   persistiert wird. Dedupe geschieht per Set, Inputs müssen nicht sortiert sein.
 *
 * @param {string[]} before - Previous tag set
 * @param {string[]} after - Current tag set
 * @returns {{added: string[], removed: string[]}}
 */
function diffTags(before, after) {
  const beforeSet = new Set(Array.isArray(before) ? before : []);
  const afterSet = new Set(Array.isArray(after) ? after : []);
  const added = [];
  const removed = [];
  for (const t of afterSet) if (!beforeSet.has(t)) added.push(t);
  for (const t of beforeSet) if (!afterSet.has(t)) removed.push(t);
  added.sort();
  removed.sort();
  return { added, removed };
}

/**
 * Compute the absolute path of a snapshot file for a given observed source file.
 * Uses SHA-1 of the absolute source path, stored under `.snapshots/`.
 *
 * @param {string} rawDir - Absolute path to `.cap/memory/raw`
 * @param {string} filePath - Path to the observed file (relative or absolute)
 * @returns {string} Absolute path to the snapshot JSON file
 */
function snapshotPath(rawDir, filePath) {
  const abs = path.resolve(filePath);
  const hash = crypto.createHash('sha1').update(abs).digest('hex');
  return path.join(rawDir, '.snapshots', `${hash}.json`);
}

/**
 * Ensure a directory exists (recursive mkdir, idempotent).
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Load a previously persisted tag snapshot.
 *
 * A missing snapshot is an expected "first observation" state — silent null.
 * A corrupt snapshot (non-JSON, wrong shape) is an anomaly worth a breadcrumb
 * so we can later correlate spurious `removed`-events with snapshot damage.
 *
 * @param {string} rawDir
 * @param {string} filePath
 * @returns {{file:string, tags:string[], mtime:(number|null), updatedAt:string}|null}
 */
function loadSnapshot(rawDir, filePath) {
  const snap = snapshotPath(rawDir, filePath);
  let raw;
  try {
    raw = fs.readFileSync(snap, 'utf8');
  } catch {
    // ENOENT / EACCES / first-ever observation — no breadcrumb, caller treats as fresh.
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tags)) {
      logError(rawDir, new Error(`corrupt snapshot (missing tags array): ${snap}`));
      return null;
    }
    return parsed;
  } catch (err) {
    logError(rawDir, new Error(`corrupt snapshot (${err.message}): ${snap}`));
    return null;
  }
}

/**
 * Write a tag snapshot atomically (tmp + rename).
 *
 * @cap-decision Atomic tmp+rename statt direktem Write, damit ein abgebrochener
 *   Hook (z.B. durch SIGTERM des Parent-Claude-Prozesses) nie einen halb-
 *   geschriebenen Snapshot hinterlässt, der beim nächsten Lauf als `tags:[]`
 *   interpretiert würde und einen falschen `removed`-Event produziert.
 *
 * @param {string} rawDir
 * @param {string} filePath
 * @param {{file:string, tags:string[], mtime:(number|null), updatedAt:string}} data
 */
function writeSnapshot(rawDir, filePath, data) {
  const snap = snapshotPath(rawDir, filePath);
  ensureDir(path.dirname(snap));
  // 8 random bytes disambiguate two hook invocations that land in the same
  // millisecond from the same pid (e.g. parallel Edit calls under CI) — Date.now()
  // alone is insufficient because rename(2) on an existing tmp is a data-race.
  const tmp = `${snap}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, snap);
}

/**
 * Format a date into the daily log filename suffix (UTC-stable `YYYY-MM-DD`).
 *
 * @cap-decision UTC statt Lokalzeit, damit Log-Rotation zwischen Maschinen /
 *   CI-Runnern mit unterschiedlichen TZ deterministisch bleibt und
 *   /cap:memory prune (F-056) den Tagesstempel einfach vergleichen kann.
 *
 * @param {Date} date
 * @returns {string}
 */
function dayStamp(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Append a JSONL event line to the daily tag-events log.
 *
 * @cap-todo(ac:F-054/AC-3) appendEvent schreibt eine Zeile
 *   {timestamp, tool, file, added[], removed[]} nach
 *   `.cap/memory/raw/tag-events-{YYYY-MM-DD}.jsonl`.
 * @cap-todo(ac:F-054/AC-7) Tages-Rotation: Der Dateiname trägt das Datum, der
 *   Cleanup von >30 Tage alten Files ist F-056's Job.
 *
 * @cap-risk `fs.appendFileSync` ist auf POSIX atomar für ≤ PIPE_BUF-sized writes
 *   (≥4 KiB, typischer JSONL-Event ist weit darunter). Auf Windows gibt es
 *   keine formale Garantie; die Payloads bleiben bewusst klein, damit der Hook
 *   bei parallelen Tool-Calls nicht interleavt.
 *
 * @param {string} rawDir
 * @param {{timestamp:string, tool:string, file:string, added:string[], removed:string[]}} event
 */
function appendEvent(rawDir, event) {
  ensureDir(rawDir);
  const when = event && event.timestamp ? new Date(event.timestamp) : new Date();
  const safeDay = Number.isNaN(when.getTime()) ? dayStamp(new Date()) : dayStamp(when);
  const file = path.join(rawDir, `tag-events-${safeDay}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
}

/**
 * Append an error record to `.cap/memory/raw/errors.log`.
 *
 * @cap-todo(ac:F-054/AC-6) Hook-Fehler landen hier und blockieren den Edit-Tool
 *   nie — der Aufrufer (Hook-Entry) ruft logError im catch und exit'ed mit 0.
 *
 * @param {string} rawDir
 * @param {Error|{message:string, stack?:string}} err
 */
function logError(rawDir, err) {
  try {
    ensureDir(rawDir);
    const entry = {
      timestamp: new Date().toISOString(),
      message: (err && err.message) || String(err),
      stack: (err && err.stack) || null,
    };
    fs.appendFileSync(path.join(rawDir, 'errors.log'), JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Best-effort — if even logging fails, we must stay silent (AC-6).
  }
}

// @cap-decision Hard cap for readFile — any file > MAX_OBSERVE_BYTES is skipped
// with a breadcrumb. Rationale: the hook runs synchronously on every Edit/Write
// and must stay <100 ms (AC-5). A pathological 200 MB generated fixture would
// not only blow the budget but also push the entire file into memory for a
// regex scan. 5 MiB comfortably holds any hand-authored source while bounding
// worst-case latency.
const MAX_OBSERVE_BYTES = 5 * 1024 * 1024;

/**
 * Read the observed file's bytes within the size cap. Returns null (and logs)
 * on I/O failure or size-overflow; never throws.
 *
 * @param {string} filePath
 * @param {string} rawDir
 * @param {(p:string)=>string} readFile
 * @returns {{content:string, mtime:(number|null)}|null}
 */
function readObservedFile(filePath, rawDir, readFile) {
  let size = null;
  let mtime = null;
  try {
    const st = fs.statSync(filePath);
    size = st.size;
    mtime = st.mtimeMs;
  } catch {
    // statSync failure is non-fatal — readFile may still succeed (e.g. injected
    // reader in tests). Proceed without the size-guard short-circuit.
  }
  if (size !== null && size > MAX_OBSERVE_BYTES) {
    logError(rawDir, new Error(`skipping oversized file (${size} bytes > ${MAX_OBSERVE_BYTES}): ${filePath}`));
    return null;
  }
  try {
    return { content: readFile(filePath), mtime };
  } catch (err) {
    logError(rawDir, err);
    return null;
  }
}

/**
 * Compute the tag-diff between the current file content and the last snapshot.
 * Pure function modulo the snapshot-read side-effect inside loadSnapshot.
 *
 * @param {string} content
 * @param {string} rawDir
 * @param {string} filePath
 * @returns {{currentTags:string[], snapshot:object|null, added:string[], removed:string[]}}
 */
function computeDelta(content, rawDir, filePath) {
  const currentTags = extractTags(content);
  const snapshot = loadSnapshot(rawDir, filePath);
  const previousTags = snapshot ? snapshot.tags : [];
  const { added, removed } = diffTags(previousTags, currentTags);
  return { currentTags, snapshot, added, removed };
}

/**
 * Persist the JSONL event and update the snapshot. Event-write failure is fatal
 * for this observation (returns eventWritten=false); snapshot-write failure is
 * non-fatal (next run re-diffs against the stale snapshot).
 */
function persistObservation(rawDir, filePath, tool, now, currentTags, mtime, added, removed) {
  try {
    appendEvent(rawDir, {
      timestamp: now.toISOString(),
      tool,
      file: path.resolve(filePath),
      added,
      removed,
    });
  } catch (err) {
    logError(rawDir, err);
    return { eventWritten: false };
  }
  try {
    writeSnapshot(rawDir, filePath, {
      file: path.resolve(filePath),
      tags: currentTags,
      mtime,
      updatedAt: now.toISOString(),
    });
  } catch (err) {
    logError(rawDir, err);
  }
  return { eventWritten: true };
}

/**
 * Main entry: observe a file after a tool invocation, compute tag diff against
 * the last snapshot, persist an event on change.
 *
 * @cap-todo(ac:F-054/AC-2) observe liest die aktuelle Datei, lädt den Snapshot,
 *   ruft diffTags auf und persistiert sowohl Event als auch aktualisierten
 *   Snapshot.
 * @cap-todo(ac:F-054/AC-4) Kein Diff (added.length === 0 && removed.length === 0)
 *   → kein Write. Keine leere JSONL-Zeile, kein Noise.
 * @cap-todo(ac:F-054/AC-5) observe ist synchron und vermeidet zweite Reads/
 *   Regex-Passes: ein einziger split+Regex-Scan, dann Set-Diff. Performance-Test
 *   in cap-tag-observer.test.cjs erzwingt <100 ms für 10 000-Zeilen-Files.
 *
 * @param {Object} opts
 * @param {string} opts.filePath - Absolute or cwd-relative path to the file that was edited.
 * @param {string} opts.tool - Tool name (Edit/Write/MultiEdit/NotebookEdit).
 * @param {string} [opts.rawDir] - Override raw memory directory (defaults to `<cwd>/.cap/memory/raw`).
 * @param {Date}   [opts.now] - Injected clock for testing.
 * @param {(p:string)=>string} [opts.readFile] - Injected reader for testing.
 * @returns {{eventWritten:boolean, added:string[], removed:string[]}}
 */
function observe(opts) {
  const filePath = opts && opts.filePath;
  const tool = (opts && opts.tool) || 'unknown';
  const now = (opts && opts.now) || new Date();
  const readFile = (opts && opts.readFile) || ((p) => fs.readFileSync(p, 'utf8'));
  const rawDir = (opts && opts.rawDir) || path.join(process.cwd(), '.cap', 'memory', 'raw');

  if (!filePath) return { eventWritten: false, added: [], removed: [] };

  const read = readObservedFile(filePath, rawDir, readFile);
  if (!read) return { eventWritten: false, added: [], removed: [] };

  const { currentTags, snapshot, added, removed } = computeDelta(read.content, rawDir, filePath);

  if (added.length === 0 && removed.length === 0) {
    // AC-4: nothing to report. Still seed a snapshot on first-ever observation
    // of a tagless file so we don't re-diff the same empty set forever.
    if (!snapshot) {
      try {
        writeSnapshot(rawDir, filePath, {
          file: path.resolve(filePath),
          tags: currentTags,
          mtime: read.mtime,
          updatedAt: now.toISOString(),
        });
      } catch (err) {
        logError(rawDir, err);
      }
    }
    return { eventWritten: false, added, removed };
  }

  const { eventWritten } = persistObservation(
    rawDir, filePath, tool, now, currentTags, read.mtime, added, removed,
  );
  return { eventWritten, added, removed };
}

module.exports = {
  extractTags,
  diffTags,
  snapshotPath,
  loadSnapshot,
  writeSnapshot,
  appendEvent,
  logError,
  observe,
  // exposed for tests
  _dayStamp: dayStamp,
};
