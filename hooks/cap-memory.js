#!/usr/bin/env node
// @cap-feature(feature:F-030) Memory Automation Hook — post-session hook that triggers memory accumulation pipeline
// cap-hook-version: {{CAP_VERSION}}
// Memory Hook - runs after session end to accumulate project memory.
//
// Pipeline: F-027 (Engine) → F-028 (Annotation Writer) → F-029 (Memory Directory)
//
// Reads Claude Code session JSONL files, extracts decisions/pitfalls/patterns/hotspots,
// writes annotations into source files and generates .cap/memory/ directory.
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

// @cap-todo(ref:F-030:AC-1) Post-session hook triggers F-027→F-028→F-029 pipeline
// @cap-todo(ref:F-030:AC-7) Hook completes within 5 seconds for up to 50 session files

function run() {
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

  // Find project sessions
  const projectDir = extract.getProjectDir(cwd);
  if (!projectDir) return;

  const sessionFiles = extract.getSessionFiles(projectDir);
  if (sessionFiles.length === 0) return;

  // Detect debug sessions from SESSION.json
  let activeDebug = false;
  try {
    const sessionPath = path.join(cwd, '.cap', 'SESSION.json');
    if (fs.existsSync(sessionPath)) {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      activeDebug = session.step === 'debug' || session.activeDebugSession != null;
    }
  } catch { /* ignore */ }

  // F-027: Accumulate memory from sessions (limit to last 10 for performance)
  const recentFiles = sessionFiles.slice(0, 10).map(f => ({
    path: f.path,
    isDebugSession: activeDebug,
  }));

  const result = engine.accumulateFromFiles(recentFiles);

  if (result.stats.total === 0 && result.staleEntries.length === 0) return;

  // F-028: Write annotations into source files
  const fileEntries = {};
  for (const entry of result.newEntries) {
    if (entry.file && fs.existsSync(entry.file)) {
      if (!fileEntries[entry.file]) fileEntries[entry.file] = [];
      fileEntries[entry.file].push(entry);
    }
  }

  if (Object.keys(fileEntries).length > 0) {
    writer.writeAnnotations(fileEntries);
  }

  // F-028: Remove stale annotations
  if (result.staleEntries.length > 0) {
    writer.removeStaleAnnotations(result.staleEntries);
  }

  // F-029: Write memory directory
  memDir.writeMemoryDirectory(cwd, result.newEntries);

  // Performance check
  const elapsed = Date.now() - startTime;
  if (elapsed > 5000) {
    process.stderr.write(`cap-memory: warning — hook took ${elapsed}ms (target: <5000ms)\n`);
  }
}

try {
  run();
} catch (err) {
  // Never block session end — fail silently
  process.stderr.write(`cap-memory: ${err.message}\n`);
}
