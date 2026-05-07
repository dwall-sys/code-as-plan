#!/usr/bin/env node
// @cap-feature(feature:F-084) Version-check SessionStart hook —
//   emits a one-line advisory when installed CAP version != .cap/version marker.
// cap-hook-version: {{CAP_VERSION}}
//
// Contract:
//   - Non-blocking: never throws, never blocks Claude Code session start.
//   - Throttled: max 1 emit per session (via .cap/.session-advisories.json).
//   - Suppressible: `.cap/config.json:upgrade.notify=false` silences entirely.
//   - Silent in normal cases: produces ZERO stdout/stderr unless an advisory
//     is needed AND the throttle allows it.
//
// @cap-decision(F-084/AC-6) Hook lives in hooks/ alongside cap-memory.js (Stop
//   hook) so the install pipeline picks it up via the same glob. The dist build
//   bundles it via scripts/build-hooks.js.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// @cap-decision(F-084/AC-6) Module-load is tolerant: if cap-upgrade.cjs is missing
//   (partial install, install-hardening fixture, etc.) the hook silently exits.
//   Mirror of cap-memory.js:tryRequire pattern.
function tryRequire(modulePath) {
  try { return require(modulePath); } catch { return null; }
}

function loadUpgradeModule() {
  // Try the local repo path first (development), then the global install path.
  // Mirrors cap-doctor.cjs:detectInstallDir() ordering.
  const candidates = [
    path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-upgrade.cjs'),
    path.join(os.homedir(), '.claude', 'cap', 'cap', 'bin', 'lib', 'cap-upgrade.cjs'),
  ];
  for (const c of candidates) {
    const mod = tryRequire(c);
    if (mod) return mod;
  }
  return null;
}

// @cap-decision(F-084/AC-6) Config readout for `upgrade.notify`. The config file
//   `.cap/config.json` is OPTIONAL — its absence means "default config" (notify=true).
function readNotifyFlag(cwd) {
  const fp = path.join(cwd, '.cap', 'config.json');
  if (!fs.existsSync(fp)) return null;  // null = "use default" (which is "do emit")
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.upgrade && typeof parsed.upgrade === 'object') {
      if (parsed.upgrade.notify === false) return false;
    }
  } catch (_e) {
    // Malformed config — degrade to default (do emit). Logging here would be noise.
  }
  return null;
}

function main() {
  const cwd = process.cwd();
  const upgrade = loadUpgradeModule();
  if (!upgrade) {
    // Module missing → silent exit. Stage-2 #4: silent-skip is REAL silent.
    return 0;
  }
  let installedVersion;
  let markerVersion;
  try {
    installedVersion = upgrade.getInstalledVersion();
    const marker = upgrade.getMarkerVersion(cwd);
    markerVersion = marker ? marker.version : null;
  } catch (_e) {
    // Defensive: any throw → silent exit. Hooks must never block.
    return 0;
  }
  if (!upgrade.needsAdvisory(installedVersion, markerVersion)) {
    // Versions match → no advisory. Silent.
    return 0;
  }
  const configNotify = readNotifyFlag(cwd);
  // Session ID: prefer Claude Code's CLAUDE_SESSION_ID, fallback to ppid+start.
  const sessionId = process.env.CLAUDE_SESSION_ID || process.env.CAP_SESSION_ID
    || `pid-${process.ppid || process.pid}-${process.env.SHLVL || '0'}`;
  let throttle;
  try {
    throttle = upgrade.shouldEmitAdvisory(cwd, { sessionId, configNotify });
  } catch (_e) {
    // If the throttle itself throws, default to silent (favor "no spam").
    return 0;
  }
  if (!throttle.shouldEmit) {
    // Throttled or suppressed → silent.
    return 0;
  }
  const msg = upgrade.buildAdvisoryMessage(installedVersion, markerVersion);
  // Emit a single line to stdout. Non-blocking, no fancy formatting.
  try {
    process.stdout.write(msg + '\n');
  } catch (_e) {
    // If even stdout is broken, give up silently.
  }
  return 0;
}

try {
  process.exit(main() || 0);
} catch (_e) {
  // Last-resort: never block session start.
  process.exit(0);
}
