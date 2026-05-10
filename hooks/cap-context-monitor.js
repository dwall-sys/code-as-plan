#!/usr/bin/env node
// @cap-feature(feature:F-009) Hooks System — context window monitor (PostToolUse hook)
// cap-hook-version: {{CAP_VERSION}}
/**
 * Context Monitor - PostToolUse/AfterTool hook (Gemini uses AfterTool)
 *
 * Reads context metrics from the statusline bridge file and injects
 * advisory hints when context usage is high. This makes the AGENT aware of
 * context limits (the statusline only shows the user).
 *
 * How it works:
 *   1. The statusline hook writes metrics to /tmp/claude-ctx-{session_id}.json
 *   2. This hook reads those metrics after each tool use
 *   3. When remaining context drops below thresholds, it injects an advisory
 *      hint as additionalContext, which the agent sees in its conversation
 *
 * Behavior changes (vs. earlier revisions):
 *   - Tonality is **advisory**, not imperative. Messages no longer say
 *     "Inform the user…" — they say "Hinweis (vom CAP-Framework, vom
 *     User-Prompt unabhängig): … Der Agent kann den User informieren falls
 *     relevant für die Aufgabe." This avoids overriding user preferences
 *     such as "terse responses, no summaries".
 *   - Warning threshold lowered from 35% → 30% to reduce early warnings;
 *     focus is on the truly critical 25% escalation.
 *   - New ENV `CAP_DISABLE_CONTEXT_MONITOR=1` silences the hook entirely
 *     (for power users who don't want any advisory injection).
 *
 * Thresholds:
 *   WARNING  (remaining <= 30%): advisory hint, agent decides whether to surface
 *   CRITICAL (remaining <= 25%): stronger advisory, agent decides whether to surface
 *
 * Debounce: 5 tool uses between warnings to avoid spam.
 * Severity escalation bypasses debounce (WARNING -> CRITICAL fires immediately).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const WARNING_THRESHOLD = 30;  // remaining_percentage <= 30% (was 35%)
const CRITICAL_THRESHOLD = 25; // remaining_percentage <= 25%
const STALE_SECONDS = 60;      // ignore metrics older than 60s
const DEBOUNCE_CALLS = 5;      // min tool uses between warnings

// Power-user kill switch: if set, hook is fully silent regardless of context state.
if (process.env.CAP_DISABLE_CONTEXT_MONITOR === '1' ||
    process.env.CAP_DISABLE_CONTEXT_MONITOR === 'true') {
  process.exit(0);
}

let input = '';
// Timeout guard: if stdin doesn't close within 10s (e.g. pipe issues on
// Windows/Git Bash, or slow Claude Code piping during large outputs),
// exit silently instead of hanging until Claude Code kills the process
// and reports "hook error". See #775, #1162.
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;

    if (!sessionId) {
      process.exit(0);
    }

    // Check if context warnings are disabled via config
    const cwd = data.cwd || process.cwd();
    const configPath = path.join(cwd, '.planning', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.hooks?.context_warnings === false) {
          process.exit(0);
        }
      } catch (e) {
        // Ignore config parse errors
      }
    }

    const tmpDir = os.tmpdir();
    const metricsPath = path.join(tmpDir, `claude-ctx-${sessionId}.json`);

    // If no metrics file, this is a subagent or fresh session -- exit silently
    if (!fs.existsSync(metricsPath)) {
      process.exit(0);
    }

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);

    // Ignore stale metrics
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) {
      process.exit(0);
    }

    const remaining = metrics.remaining_percentage;
    const usedPct = metrics.used_pct;

    // No warning needed
    if (remaining > WARNING_THRESHOLD) {
      process.exit(0);
    }

    // Debounce: check if we warned recently
    const warnPath = path.join(tmpDir, `claude-ctx-${sessionId}-warned.json`);
    let warnData = { callsSinceWarn: 0, lastLevel: null };
    let firstWarn = true;

    if (fs.existsSync(warnPath)) {
      try {
        warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
        firstWarn = false;
      } catch (e) {
        // Corrupted file, reset
      }
    }

    warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

    const isCritical = remaining <= CRITICAL_THRESHOLD;
    const currentLevel = isCritical ? 'critical' : 'warning';

    // Emit immediately on first warning, then debounce subsequent ones
    // Severity escalation (WARNING -> CRITICAL) bypasses debounce
    const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';
    if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
      // Update counter and exit without warning
      fs.writeFileSync(warnPath, JSON.stringify(warnData));
      process.exit(0);
    }

    // Reset debounce counter
    warnData.callsSinceWarn = 0;
    warnData.lastLevel = currentLevel;
    fs.writeFileSync(warnPath, JSON.stringify(warnData));

    // Detect if GSD is active (has .planning/STATE.md in working directory)
    const isGsdActive = fs.existsSync(path.join(cwd, '.planning', 'STATE.md'));

    // Build advisory message (no imperative commands — see #884).
    // The framework-prefix makes it explicit that this is metadata
    // independent of the user prompt, so user preferences like
    // "terse responses" are not violated by the agent itself.
    const PREFIX = 'Hinweis (vom CAP-Framework, vom User-Prompt unabhängig): ';
    const SUFFIX = ' Der Agent kann den User informieren falls relevant für die Aufgabe.';

    let message;
    if (isCritical) {
      message = isGsdActive
        ? `${PREFIX}CONTEXT CRITICAL — Auslastung bei ${usedPct}%, verbleibend ${remaining}%. ` +
          'Context ist nahezu erschöpft. GSD-State ist bereits in STATE.md getrackt; ' +
          'es ist nicht nötig, autonom Handoff-Dateien zu schreiben oder neue komplexe Arbeit zu starten.' +
          SUFFIX
        : `${PREFIX}CONTEXT CRITICAL — Auslastung bei ${usedPct}%, verbleibend ${remaining}%. ` +
          'Context ist nahezu erschöpft. Autonomes Speichern von State oder Handoff-Dateien ' +
          'ist nicht erforderlich, sofern der User nicht ausdrücklich danach fragt.' +
          SUFFIX;
    } else {
      message = isGsdActive
        ? `${PREFIX}CONTEXT WARNING — Auslastung bei ${usedPct}%, verbleibend ${remaining}%. ` +
          'Context-Budget wird knapp. Größere neue Arbeit zwischen definierten Plan-Schritten ' +
          'ist günstig zu vermeiden.' +
          SUFFIX
        : `${PREFIX}CONTEXT WARNING — Auslastung bei ${usedPct}%, verbleibend ${remaining}%. ` +
          'Context-Budget wird knapp. Unnötige Exploration oder das Anstoßen neuer komplexer ' +
          'Arbeit ist günstig zu vermeiden.' +
          SUFFIX;
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: process.env.GEMINI_API_KEY ? "AfterTool" : "PostToolUse",
        additionalContext: message
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    // Silent fail -- never block tool execution
    process.exit(0);
  }
});
