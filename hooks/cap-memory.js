#!/usr/bin/env node
// @cap-feature(feature:F-030) Memory Automation Hook — post-session hook that triggers memory accumulation pipeline
// @cap-history(sessions:2, edits:7, since:2026-04-03, learned:2026-04-03) Frequently modified — 2 sessions, 7 edits
// @cap-history(sessions:3, edits:9, since:2026-04-03, learned:2026-04-04) Frequently modified — 3 sessions, 9 edits
// cap-hook-version: {{CAP_VERSION}}
// Memory Hook - runs after session end to accumulate project memory.
//
// Pipeline: F-027 (Engine) → F-028 (Annotation Writer) → F-029 (Memory Directory)
//
// Two modes:
//   Incremental (default): Only processes sessions newer than .cap/memory/.last-run
//   Init (via /cap:memory init): Processes ALL sessions, builds initial memory
//
// Skip with CAP_SKIP_MEMORY=1 environment variable.

const fs = require('fs');
const path = require('path');
const os = require('os');

// @cap-todo(ref:F-030:AC-8) Hook skippable via CAP_SKIP_MEMORY=1
if (process.env.CAP_SKIP_MEMORY === '1') {
  process.exit(0);
}

// Resolve installed module paths
const homeDir = os.homedir();
const capLib = path.join(homeDir, '.claude', 'cap', 'bin', 'lib');

function tryRequire(modulePath) {
  try { return require(modulePath); } catch { return null; }
}

const LAST_RUN_FILE = '.last-run';

/**
 * Read the last-run timestamp from .cap/memory/.last-run
 * @param {string} cwd
 * @returns {string|null} ISO timestamp or null if never run
 */
function readLastRun(cwd) {
  const fp = path.join(cwd, '.cap', 'memory', LAST_RUN_FILE);
  try {
    return fs.readFileSync(fp, 'utf8').trim() || null;
  } catch { return null; }
}

/**
 * Write the current timestamp to .cap/memory/.last-run
 * @param {string} cwd
 */
function writeLastRun(cwd) {
  const dir = path.join(cwd, '.cap', 'memory');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, LAST_RUN_FILE), new Date().toISOString(), 'utf8');
}

/**
 * Filter session files to only those newer than a timestamp.
 * @param {Array<{path: string, date: string|null}>} files
 * @param {string|null} since - ISO timestamp
 * @returns {Array}
 */
function filterNewSessions(files, since) {
  if (!since) return files; // No last-run = process all
  return files.filter(f => f.date && f.date > since);
}

// @cap-todo(ref:F-030:AC-1) Post-session hook triggers F-027→F-028→F-029 pipeline
// @cap-todo(ref:F-030:AC-7) Hook completes within 5 seconds for up to 50 session files

/**
 * Run the memory pipeline.
 * @param {Object} [options]
 * @param {boolean} [options.init] - If true, process ALL sessions (bootstrap mode)
 */
function run(options = {}) {
  const startTime = Date.now();
  const cwd = process.cwd();

  // Load modules
  const extract = tryRequire(path.join(capLib, 'cap-session-extract.cjs'));
  const engine = tryRequire(path.join(capLib, 'cap-memory-engine.cjs'));
  const writer = tryRequire(path.join(capLib, 'cap-annotation-writer.cjs'));
  const memDir = tryRequire(path.join(capLib, 'cap-memory-dir.cjs'));

  if (!extract || !engine || !writer || !memDir) {
    // Modules not installed — skip silently
    return;
  }

  // Find project sessions — monorepo-aware for init, single-project for incremental
  let allSessionFiles;
  let projectInfo;

  if (options.init && extract.getAllSessionFiles) {
    // Init mode: scan all sub-project sessions (monorepo-aware)
    const result = extract.getAllSessionFiles(cwd);
    allSessionFiles = result.files;
    projectInfo = result.projects;
  } else {
    // Incremental mode: single project only (fast)
    const projectDir = extract.getProjectDir(cwd);
    if (!projectDir) return;
    allSessionFiles = extract.getSessionFiles(projectDir);
    projectInfo = null;
  }

  if (allSessionFiles.length === 0) return;

  // Incremental: only process sessions since last run (unless init mode)
  const lastRun = options.init ? null : readLastRun(cwd);
  const sessionFiles = filterNewSessions(allSessionFiles, lastRun);

  if (sessionFiles.length === 0) return; // Nothing new

  // Detect debug sessions from SESSION.json
  let activeDebug = false;
  try {
    const sessionPath = path.join(cwd, '.cap', 'SESSION.json');
    if (fs.existsSync(sessionPath)) {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      activeDebug = session.step === 'debug' || session.activeDebugSession != null;
    }
  } catch { /* ignore */ }

  // --- Primary source: Code tags (single source of truth) ---
  const scanner = tryRequire(path.join(capLib, 'cap-tag-scanner.cjs'));
  let codeEntries = [];
  if (scanner) {
    const tags = scanner.scanDirectory(cwd, { projectRoot: cwd });
    codeEntries = engine.accumulateFromCode(tags);
  }

  // --- Secondary source: Sessions (hotspots only — edit frequency) ---
  // @cap-decision Hotspots are inherently cumulative (a "hotspot" requires >= minHotspot sessions
  //                of edits to a single file). In incremental mode the new-session window is too
  //                narrow — usually 1–2 sessions — so naive filtering produces zero hotspots, and
  //                writeMemoryDirectory then overwrites hotspots.md with an empty stub. Real-world
  //                evidence: GoetzeInvest had 61 hotspot nodes in graph.json from a prior init run,
  //                but hotspots.md was a 202-byte "_No hotspots recorded yet._" header after every
  //                incremental run. Compute hotspots from ALL sessions every run; the
  //                filterNewSessions short-circuit above (early-return when sessionFiles is empty)
  //                still gates whether we run at all, so we don't burn IO on no-op invocations.
  const filesToProcess = allSessionFiles.map(f => ({
    path: f.path,
    isDebugSession: activeDebug,
  }));

  const sessionResult = engine.accumulateFromFiles(filesToProcess, { projectRoot: cwd });

  // Merge: code-based decisions/pitfalls + session-based hotspots (full-history)
  const allEntries = [...codeEntries, ...sessionResult.newEntries];

  if (allEntries.length === 0 && sessionResult.staleEntries.length === 0) {
    writeLastRun(cwd);
    return;
  }

  // F-028: Write hotspot annotations into source files (only annotatable source code)
  // Code-based decisions/pitfalls are ALREADY in the code as @cap-decision/@cap-todo — no need to re-annotate.
  const NON_ANNOTATABLE_EXT = new Set(['.md', '.markdown', '.json', '.jsonl', '.lock', '.svg', '.xml', '.html', '.css', '.scss']);
  const fileEntries = {};
  for (const entry of allEntries) {
    if (entry.category !== 'hotspot') continue; // Only write hotspot annotations
    if (entry.file && fs.existsSync(entry.file)) {
      const ext = path.extname(entry.file).toLowerCase();
      if (NON_ANNOTATABLE_EXT.has(ext)) continue;
      if (!fileEntries[entry.file]) fileEntries[entry.file] = [];
      fileEntries[entry.file].push(entry);
    }
  }

  if (Object.keys(fileEntries).length > 0) {
    writer.writeAnnotations(fileEntries);
  }

  // F-028: Remove stale annotations
  if (sessionResult.staleEntries.length > 0) {
    writer.removeStaleAnnotations(sessionResult.staleEntries);
  }

  // F-029: Write memory directory (merge mode for multi-developer support)
  memDir.writeMemoryDirectory(cwd, allEntries, { merge: !options.init });

  // @cap-decision(F-079/iter1) Stage-2 #1 fix: processSnapshots wired into memory-pipeline.
  // Closes AC-4 — "Memory-Pipeline MUSS Snapshots ... referenzieren" — by invoking
  // processSnapshots() after writeMemoryDirectory so per-feature/platform files get a
  // populated linked_snapshots block on every pipeline run. Idempotent: byte-identical on
  // re-run because processSnapshots groups by target and writes ONE upsert per target with
  // the FULL set. Wrapped in try/catch so a snapshot-linkage failure never blocks memory.
  const linkage = tryRequire(path.join(capLib, 'cap-snapshot-linkage.cjs'));
  if (linkage && linkage.processSnapshots) {
    try {
      linkage.processSnapshots(cwd, {});
    } catch (_e) {
      // Snapshot linkage is best-effort; never block the rest of the pipeline.
    }
  }

  // F-034: Update memory graph
  const memGraph = tryRequire(path.join(capLib, 'cap-memory-graph.cjs'));
  if (memGraph) {
    try {
      if (options.init) {
        // Full rebuild from all sources
        const graph = memGraph.buildFromMemory(cwd);
        memGraph.saveGraph(cwd, graph);
      } else {
        // Incremental update with new entries
        const graph = memGraph.loadGraph(cwd);
        const staleNodeIds = sessionResult.staleEntries.map(
          e => memGraph.generateNodeId(e.category, e.content)
        );
        memGraph.incrementalUpdate(graph, allEntries, { staleNodeIds });
        memGraph.saveGraph(cwd, graph);
      }
    } catch (_e) {
      // Graph update is non-critical — don't block session end
    }
  }

  // Save last-run timestamp
  writeLastRun(cwd);

  // Stats for reporting
  const stats = {
    decisions: allEntries.filter(e => e.category === 'decision').length,
    pitfalls: allEntries.filter(e => e.category === 'pitfall').length,
    patterns: allEntries.filter(e => e.category === 'pattern').length,
    hotspots: allEntries.filter(e => e.category === 'hotspot').length,
    fromCode: codeEntries.length,
    fromSessions: sessionResult.newEntries.length,
  };

  // Performance check
  const elapsed = Date.now() - startTime;
  if (elapsed > 5000 && !options.init) {
    process.stderr.write(`cap-memory: warning — hook took ${elapsed}ms (target: <5000ms)\n`);
  }

  // Report in init mode
  if (options.init) {
    const elapsed2 = Date.now() - startTime;
    if (projectInfo && projectInfo.length > 1) {
      process.stdout.write(`cap-memory init: monorepo mode — ${projectInfo.length} sub-projects found\n`);
      for (const p of projectInfo) {
        process.stdout.write(`  ${p}\n`);
      }
    }
    process.stdout.write(`cap-memory init: ${sessionFiles.length} sessions, ${stats.fromCode} code tags processed in ${elapsed2}ms\n`);
    process.stdout.write(`  decisions: ${stats.decisions} (from code), pitfalls: ${stats.pitfalls} (from code), hotspots: ${stats.hotspots} (from sessions)\n`);
  }
}

// CLI mode: support "init" argument for bootstrap
const args = process.argv.slice(2);
const isInit = args.includes('init') || args.includes('--init');

try {
  run({ init: isInit });
} catch (err) {
  // Never block session end — fail silently
  process.stderr.write(`cap-memory: ${err.message}\n`);
}
