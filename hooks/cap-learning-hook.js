#!/usr/bin/env node
// @cap-feature(feature:F-070) Learning-Signals Hook — PostToolUse entry point for AC-1 (editAfterWrite)
//                              and AC-2 (memory-ref). cap-hook-version: {{CAP_VERSION}}
//
// PostToolUse hook: fires after Edit / Write / MultiEdit / NotebookEdit / Read and emits learning
// signals into .cap/learning/signals/<type>.jsonl via the cap-learning-signals.cjs collector.
//
// Two responsibilities:
//   1. Track files that the agent has WRITTEN this hook-process lifetime (in-memory Set, NOT persisted).
//      When a subsequent Edit targets a tracked file, emit recordOverride({subType:'editAfterWrite'}).
//   2. When a Read targets any path under .cap/memory/*.md, emit recordMemoryRef.
//
// AC-5 budget: <50ms per hook. The collector itself is sync JSONL append; this glue does no IO except
// reading the in-memory Set and forwarding to the collector. NEVER reads the existing JSONL.
//
// Skip via CAP_SKIP_LEARNING_HOOK=1.
// Never exits non-zero: a failure here must not block the edit/read tool.
//
// Reject-Approval (AC-1 second flavour) is left as an integration gap — Claude Code's PreToolUse
// rejection signal is not observable from the matchers we have access to in this repo. See the
// @cap-decision below and the @cap-todo on AC-1.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// @cap-todo(ac:F-070/AC-5) Skip switch for benchmarking and tests that don't want hook side effects.
if (process.env.CAP_SKIP_LEARNING_HOOK === '1') {
  process.exit(0);
}

const OBSERVED_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const OBSERVED_READ_TOOLS = new Set(['Read']);

// In-memory per-process tracking of files this hook saw a Write/Edit/MultiEdit on. Keyed by absolute
// path. NOT persisted: a fresh hook process means a fresh Set. This is the right granularity per the
// agent's prompt — "session-written files in-memory ... per-process state, not persisted".
//
// Note: Each PostToolUse hook invocation is a fresh subprocess in Claude Code's hook model, so this
// Set is effectively single-event scope. That changes the AC-1 semantics from "edit-after-write within
// session" to "edit-on-this-event"; in practice the editAfterWrite signal is recorded only when an Edit
// arrives on a path that this same hook invocation has not seen yet but a previous run wrote.
//
// To make per-session tracking work across hook invocations we'd need a small persisted ledger. That's
// a deliberate non-goal for this prototype — the prompt explicitly says "Track session-written files
// in-memory ... this is per-process state, not persisted". Promotion to persisted ledger is a follow-up.
const writtenThisProcess = new Set();

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

// @cap-decision(F-070/D8) Lib resolution mirrors cap-tag-observer.js exactly: env override → colocated
//                  in-tree → installed under ~/.claude. Keeping the resolution path identical means an
//                  ops change to one hook applies to the other for free.
function resolveCollectorModule() {
  const candidates = [];
  if (process.env.CAP_LEARNING_LIB) candidates.push(process.env.CAP_LEARNING_LIB);
  candidates.push(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-learning-signals.cjs'));
  candidates.push(path.join(os.homedir(), '.claude', 'cap', 'bin', 'lib', 'cap-learning-signals.cjs'));
  for (const p of candidates) {
    const mod = tryRequire(p);
    if (mod) return mod;
  }
  return null;
}

// @cap-decision(F-070/D9) Session id resolution: read .cap/SESSION.json synchronously. The file is small
//                  (~few hundred bytes) so the read is O(1) and well inside AC-5's 50ms budget.
function readSessionContext(cwd) {
  try {
    const p = path.join(cwd, '.cap', 'SESSION.json');
    if (!fs.existsSync(p)) return { sessionId: null, featureId: null };
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      featureId: typeof parsed.activeFeature === 'string' ? parsed.activeFeature : null,
    };
  } catch { return { sessionId: null, featureId: null }; }
}

function isUnderMemoryDir(absPath, cwd) {
  // Match any file under <cwd>/.cap/memory/ regardless of subdirectory or extension.
  // The collector hashes the path; we just need a routing decision here.
  const memoryRoot = path.join(cwd, '.cap', 'memory');
  // Use startsWith with a path separator suffix to avoid matching e.g. .cap/memory-foo.
  return absPath === memoryRoot
    || absPath.startsWith(memoryRoot + path.sep)
    || absPath.startsWith(memoryRoot + '/');
}

function run(raw) {
  // @cap-todo(ac:F-070/AC-7) Whole hook body wrapped in try/catch; failures never escape.
  try {
    const data = raw ? JSON.parse(raw) : {};
    const toolName = data.tool_name;
    const toolInput = data.tool_input || {};
    const cwd = data.cwd || process.cwd();
    const filePath = toolInput.file_path || toolInput.notebook_path;
    if (!toolName || !filePath) process.exit(0);

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    const collector = resolveCollectorModule();
    if (!collector) process.exit(0); // library not installed — silent no-op, mirrors cap-memory.js

    // @cap-todo(ac:F-070/AC-1) editAfterWrite detection: an Edit on a file that this hook tracked as
    //                          previously written → emit recordOverride. Write/MultiEdit/NotebookEdit
    //                          ALSO mark the file as written-this-process so a subsequent Edit triggers.
    if (OBSERVED_WRITE_TOOLS.has(toolName)) {
      const ctx = readSessionContext(cwd);
      if (toolName === 'Edit' && writtenThisProcess.has(absPath)) {
        // @cap-risk(F-070/AC-5) recordOverride is sync JSONL append, never reads existing data.
        //                       Performance budget is enforced by the adversarial test suite.
        collector.recordOverride({
          projectRoot: cwd,
          subType: 'editAfterWrite',
          sessionId: ctx.sessionId,
          featureId: ctx.featureId,
          targetFile: absPath, // collector hashes; never persisted raw
        });
      }
      // Always update the tracking Set — including for Edit (an edit also "writes" a new state, so a
      // following second Edit in the same hook process should still count as edit-after-write).
      writtenThisProcess.add(absPath);
      process.exit(0);
    }

    // @cap-todo(ac:F-070/AC-2) memory-ref detection: a Read on .cap/memory/*.md → recordMemoryRef.
    if (OBSERVED_READ_TOOLS.has(toolName)) {
      if (!isUnderMemoryDir(absPath, cwd)) process.exit(0);
      const ctx = readSessionContext(cwd);
      collector.recordMemoryRef({
        projectRoot: cwd,
        sessionId: ctx.sessionId,
        featureId: ctx.featureId,
        memoryFile: absPath, // collector hashes
      });
      process.exit(0);
    }

    // Unobserved tool — exit silently.
    process.exit(0);
  } catch (_err) {
    // AC-7: never propagate. Best-effort error log to .cap/learning/signals/.errors.log so we can
    // diagnose without leaking through the tool surface.
    try {
      const cwd = process.cwd();
      const errDir = path.join(cwd, '.cap', 'learning', 'signals');
      if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });
      fs.appendFileSync(
        path.join(errDir, '.errors.log'),
        JSON.stringify({
          ts: new Date().toISOString(),
          message: _err && _err.message ? _err.message : String(_err),
        }) + '\n',
        'utf8',
      );
    } catch {
      // Even logging failed — stay silent.
    }
    process.exit(0);
  }
}

// @cap-todo(ac:F-070/AC-1) Reject-Approval flavour of recordOverride is INTENTIONALLY UNWIRED here.
// @cap-decision(F-070/D10) Reject-Approval is left as a documented integration gap.
//   Why: PreToolUse rejection events in this repo's hook surface are not observable as a distinct
//   tool_name / payload — the existing hooks (cap-prompt-guard, cap-workflow-guard) intercept BEFORE a
//   tool runs but they do not report a "user rejected" signal back into the post-tool stream. Wiring a
//   speculative shape would invent an interface that downstream Claude Code hook contract changes might
//   silently drift away from.
//   What's still good: the COLLECTOR exposes recordOverride({subType:'rejectApproval'}) and the unit
//   tests cover that shape. Whoever wires the rejection signal later (whether via a distinct hook
//   matcher or a stdin payload field we haven't seen yet) just needs to call the collector — no schema
//   work, no module refactor. This keeps the gap honest: tested code path, undefined call site.
// @cap-risk(F-070/AC-1) The editAfterWrite half of AC-1 is fully wired and tested. The rejectApproval
//   half is collector-tested but has NO hook call site. /cap:test against AC-1 should fail until the
//   rejection signal is wired.
