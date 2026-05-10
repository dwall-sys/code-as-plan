#!/usr/bin/env node
// @cap-feature(feature:F-009) Hooks System — statusline display (registered under top-level statusLine, not hooks.Notification)
// cap-hook-version: {{CAP_VERSION}}
// cap-hook-lifecycle: statusLine
// Claude Code Statusline - CAP Edition
// Shows: model | current task | directory | context usage

const fs = require('fs');
const path = require('path');
const os = require('os');

// Read JSON from stdin
let input = '';
// Timeout guard: if stdin doesn't close within 3s (e.g. pipe issues on
// Windows/Git Bash), exit silently instead of hanging. See #775.
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Context window display (shows USED percentage scaled to usable context)
    // Claude Code reserves ~16.5% for autocompact buffer, so usable context
    // is 83.5% of the total window. We normalize to show 100% at that point.
    const AUTO_COMPACT_BUFFER_PCT = 16.5;
    const totalIn = data.context_window?.total_input_tokens || 0;
    const totalOut = data.context_window?.total_output_tokens || 0;
    const windowSize = data.context_window?.context_window_size || 200000;
    const totalTokens = totalIn + totalOut;
    const fmtTokens = n => {
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };
    let ctx = '';
    if (remaining != null) {
      // Normalize: subtract buffer from remaining, scale to usable range
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

      // Write context metrics to bridge file for the context-monitor PostToolUse hook.
      // The monitor reads this file to inject agent-facing warnings when context is low.
      if (session) {
        try {
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
          const bridgeData = JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000)
          });
          fs.writeFileSync(bridgePath, bridgeData);
        } catch (e) {
          // Silent fail -- bridge is best-effort, don't break statusline
        }
      }

      // Token counts + progress bar (10 segments)
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      const tokenInfo = `In:${fmtTokens(totalIn)} Out:${fmtTokens(totalOut)} ${used}% (${fmtTokens(totalTokens)}/${fmtTokens(windowSize)})`;

      // Color based on usable context thresholds
      if (used < 50) {
        ctx = ` \x1b[32m${bar} ${tokenInfo}\x1b[0m`;
      } else if (used < 65) {
        ctx = ` \x1b[33m${bar} ${tokenInfo}\x1b[0m`;
      } else if (used < 80) {
        ctx = ` \x1b[38;5;208m${bar} ${tokenInfo}\x1b[0m`;
      } else {
        ctx = ` \x1b[5;31m💀 ${bar} ${tokenInfo}\x1b[0m`;
      }
    }

    // Current task from todos
    let task = '';
    const homeDir = os.homedir();
    // Respect CLAUDE_CONFIG_DIR for custom config directory setups (#870)
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
    const todosDir = path.join(claudeDir, 'todos');
    if (session && fs.existsSync(todosDir)) {
      try {
        const files = fs.readdirSync(todosDir)
          .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
          try {
            const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
            const inProgress = todos.find(t => t.status === 'in_progress');
            if (inProgress) task = inProgress.activeForm || '';
          } catch (e) {}
        }
      } catch (e) {
        // Silently fail on file system errors - don't break statusline
      }
    }

    // CAP update available?
    let capUpdate = '';
    const capCacheFile = path.join(claudeDir, 'cache', 'cap-update-check.json');
    const gsdCacheFile = path.join(claudeDir, 'cache', 'gsd-update-check.json');
    const cacheFile = fs.existsSync(capCacheFile) ? capCacheFile : gsdCacheFile;
    if (fs.existsSync(cacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cache.update_available) {
          capUpdate = '\x1b[33m⬆ /cap:update\x1b[0m │ ';
        }
        if (cache.stale_hooks && cache.stale_hooks.length > 0) {
          capUpdate += '\x1b[31m⚠ stale hooks — run /cap:update\x1b[0m │ ';
        }
      } catch (e) {}
    }

    // Active app + feature from CAP session
    let capContext = '';
    try {
      const sessionPath = path.join(dir, '.cap', 'SESSION.json');
      if (fs.existsSync(sessionPath)) {
        const capSession = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        const parts = [];
        if (capSession.activeApp) parts.push(capSession.activeApp);
        if (capSession.activeFeature) {
          let featureLabel = capSession.activeFeature;
          try {
            const mapPath = path.join(dir, 'FEATURE-MAP.md');
            if (fs.existsSync(mapPath)) {
              const mapContent = fs.readFileSync(mapPath, 'utf8');
              const re = new RegExp(`###\\s+${capSession.activeFeature}:\\s+(.+?)\\s*\\[`);
              const m = mapContent.match(re);
              if (m) featureLabel = `${capSession.activeFeature}: ${m[1].trim()}`;
            }
          } catch (e) {}
          parts.push(featureLabel);
        }
        if (parts.length > 0) capContext = `\x1b[36m${parts.join(' │ ')}\x1b[0m │ `;
      }
    } catch (e) {}

    // Output
    const dirname = path.basename(dir);
    if (task) {
      process.stdout.write(`${capUpdate}${capContext}\x1b[2m${model}\x1b[0m │ \x1b[1m${task}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`);
    } else {
      process.stdout.write(`${capUpdate}${capContext}\x1b[2m${model}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`);
    }
  } catch (e) {
    // Silent fail - don't break statusline on parse errors
  }
});
