#!/usr/bin/env node
// @cap-feature(feature:F-054) Hook-Based Tag Event Observation — PostToolUse entry point.
// cap-hook-version: {{CAP_VERSION}}
// PostToolUse hook: fires after Edit/Write/MultiEdit/NotebookEdit and emits a
// JSONL tag-event whenever the diff of @cap-feature/@cap-todo tags between the
// last snapshot and the current file contents is non-empty.
//
// This hook is the raw-observation layer for the memory system.
// F-030 (cap-memory.js) aggregates later; F-054 stays strictly additive.
//
// Skip via CAP_SKIP_TAG_OBSERVER=1.
// Never exits non-zero: a failure in this hook must not block the edit tool
// (see AC-6).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (process.env.CAP_SKIP_TAG_OBSERVER === '1') {
  process.exit(0);
}

const OBSERVED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  run(input);
});

function tryRequire(modulePath) {
  try { return require(modulePath); } catch { return null; }
}

function resolveObserverModule() {
  // Resolution precedence:
  //  1. CAP_OBSERVER_LIB — explicit env override (tests, vendored forks, debug
  //     builds). Must point at the absolute path of cap-tag-observer.cjs.
  //  2. Colocated lib (development, in-tree unit tests).
  //  3. Installed copy under ~/.claude (npx install).
  const candidates = [];
  if (process.env.CAP_OBSERVER_LIB) candidates.push(process.env.CAP_OBSERVER_LIB);
  candidates.push(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-tag-observer.cjs'));
  candidates.push(path.join(os.homedir(), '.claude', 'cap', 'bin', 'lib', 'cap-tag-observer.cjs'));
  for (const p of candidates) {
    const mod = tryRequire(p);
    if (mod) return mod;
  }
  return null;
}

function run(raw) {
  // @cap-todo(ac:F-054/AC-6) Gesamter Hook-Körper ist in try/catch; jeder Fehler
  //   wird über observer.logError persistiert, der Prozess exit'ed immer mit 0.
  let observer = null;
  let rawDir = null;
  try {
    const data = raw ? JSON.parse(raw) : {};
    const toolName = data.tool_name;

    // @cap-todo(ac:F-054/AC-1) Nur Edit/Write/MultiEdit/NotebookEdit beobachten.
    if (!toolName || !OBSERVED_TOOLS.has(toolName)) {
      process.exit(0);
    }

    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || toolInput.notebook_path;
    if (!filePath) process.exit(0);

    const cwd = data.cwd || process.cwd();
    rawDir = path.join(cwd, '.cap', 'memory', 'raw');

    observer = resolveObserverModule();
    if (!observer) {
      // Observer library not installed — silent no-op (matches cap-memory.js
      // behaviour when its modules are missing).
      process.exit(0);
    }

    observer.observe({
      filePath: path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath),
      tool: toolName,
      rawDir,
    });

    process.exit(0);
  } catch (err) {
    // AC-6: never propagate a failure to the edit tool. Persist and swallow.
    try {
      if (observer && rawDir) {
        observer.logError(rawDir, err);
      } else if (rawDir) {
        // Fallback: best-effort append without the library.
        if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
        fs.appendFileSync(
          path.join(rawDir, 'errors.log'),
          JSON.stringify({
            timestamp: new Date().toISOString(),
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          }) + '\n',
          'utf8',
        );
      }
    } catch {
      // Even logging failed — stay silent.
    }
    process.exit(0);
  }
}
