#!/usr/bin/env node
// @cap-feature(feature:F-009) Hooks System — workflow guard (PreToolUse hook)
// cap-hook-version: {{CAP_VERSION}}
/**
 * CAP Workflow Guard — PreToolUse hook
 *
 * Detects when Claude attempts file edits outside a CAP workflow context
 * (no active /cap: command or Task subagent) and injects an advisory hint.
 *
 * This is a SOFT guard — it advises, not blocks. The edit still proceeds.
 * The hint nudges Claude to consider /cap:prototype or /cap:iterate instead
 * of making direct edits that bypass state tracking.
 *
 * Activation (any of):
 *   - ENV `CAP_WORKFLOW_GUARD=1` (fast path, no config-file read)
 *   - Existing `.planning/config.json` with `hooks.workflow_guard: true`
 *     (legacy path, kept for backwards-compatibility)
 * If neither is present the hook exits silently before doing any I/O.
 *
 * Behavior changes (vs. earlier revisions):
 *   - Tonality is **advisory**, not imperative. The hint frames the
 *     observation as CAP-Framework metadata rather than a directive,
 *     so user preferences (e.g. "terse responses, no summaries") are
 *     not overridden.
 *   - "Allow-Once" / cool-down: if 3 advisories were emitted within a
 *     short window, the hook self-suspends for 10 minutes via a marker
 *     file in /tmp, to avoid spam during legitimate direct-edit bursts.
 *
 * Only triggers on Write/Edit tool calls to non-.cap/, non-allowlisted files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SUSPEND_THRESHOLD = 3;            // advisories within window
const SUSPEND_WINDOW_MS = 10 * 60_000;  // 10-minute rolling window
const SUSPEND_DURATION_MS = 10 * 60_000; // suspend for 10 minutes once tripped

// Scope the marker per-cwd so different projects (and test fixtures) don't
// collide on the same /tmp file.
function markerPathFor(cwd) {
  const hash = crypto.createHash('sha1').update(String(cwd)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `cap-workflow-guard-marker-${hash}.json`);
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;

    // Only guard Write and Edit tool calls
    if (toolName !== 'Write' && toolName !== 'Edit') {
      process.exit(0);
    }

    // Check if we're inside a CAP workflow (Task subagent or /cap: command)
    if (data.tool_input?.is_subagent || data.session_type === 'task') {
      process.exit(0);
    }

    // Check the file being edited
    const filePath = data.tool_input?.file_path || data.tool_input?.path || '';

    // Allow edits to .cap/ and .planning/ files (CAP/GSD state management)
    if (filePath.includes('.cap/') || filePath.includes('.cap\\') ||
        filePath.includes('.planning/') || filePath.includes('.planning\\')) {
      process.exit(0);
    }

    // Allow edits to common config/docs files that don't need CAP tracking
    const allowedPatterns = [
      /\.gitignore$/,
      /\.env/,
      /CLAUDE\.md$/,
      /AGENTS\.md$/,
      /GEMINI\.md$/,
      /settings\.json$/,
    ];
    if (allowedPatterns.some(p => p.test(filePath))) {
      process.exit(0);
    }

    // ── Activation gate ────────────────────────────────────────────────
    // ENV fast-path lets power users opt in without touching the project
    // config file. If ENV is unset we fall back to the legacy config-based
    // activation to preserve backwards-compatibility.
    const envEnabled =
      process.env.CAP_WORKFLOW_GUARD === '1' ||
      process.env.CAP_WORKFLOW_GUARD === 'true';

    const cwd = data.cwd || process.cwd();

    if (!envEnabled) {
      const configPath = path.join(cwd, '.planning', 'config.json');
      if (!fs.existsSync(configPath)) {
        process.exit(0); // No CAP project — don't guard
      }
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.hooks?.workflow_guard) {
          process.exit(0); // Guard disabled (default)
        }
      } catch (e) {
        process.exit(0);
      }
    }

    // ── Allow-Once / cool-down marker ─────────────────────────────────
    // Track recent advisory timestamps. If too many fire in the rolling
    // window, suspend for SUSPEND_DURATION_MS to avoid spam on legitimate
    // direct-edit bursts.
    const now = Date.now();
    const markerPath = markerPathFor(cwd);
    let marker = { recent: [], suspendedUntil: 0 };
    if (fs.existsSync(markerPath)) {
      try {
        marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        if (!Array.isArray(marker.recent)) marker.recent = [];
        if (typeof marker.suspendedUntil !== 'number') marker.suspendedUntil = 0;
      } catch (_e) {
        marker = { recent: [], suspendedUntil: 0 };
      }
    }

    // Currently suspended? Stay quiet.
    if (marker.suspendedUntil && now < marker.suspendedUntil) {
      process.exit(0);
    }

    // Drop entries outside the rolling window.
    marker.recent = marker.recent.filter(ts => (now - ts) <= SUSPEND_WINDOW_MS);

    // If we're at or above the threshold *before* recording this one,
    // trip the suspend and stay silent for this call too.
    if (marker.recent.length >= SUSPEND_THRESHOLD) {
      marker.suspendedUntil = now + SUSPEND_DURATION_MS;
      marker.recent = []; // reset window after tripping
      try { fs.writeFileSync(MARKER_PATH, JSON.stringify(marker)); } catch (_e) { /* ignore */ }
      process.exit(0);
    }

    // Record this advisory.
    marker.recent.push(now);
    try { fs.writeFileSync(MARKER_PATH, JSON.stringify(marker)); } catch (_e) { /* ignore */ }

    // ── Emit advisory (advisory tone, not imperative) ─────────────────
    const fileName = path.basename(filePath) || filePath;
    const message =
      `Hinweis (vom CAP-Framework, vom User-Prompt unabhängig): WORKFLOW ADVISORY — ` +
      `direkter Edit an ${fileName} ohne aktiven CAP-Command. ` +
      'Dieser Edit wird nicht von CAP getrackt. ' +
      '/cap:prototype oder /cap:iterate würden Feature-Tracking via @cap-feature-Tags erhalten. ' +
      'Falls der direkte Edit beabsichtigt ist (z.B. ausdrücklich vom User gewünscht), ' +
      'kann normal weitergearbeitet werden.';

    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    // Silent fail — never block tool execution
    process.exit(0);
  }
});
