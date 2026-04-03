// @cap-feature(feature:F-025) Session Extract CLI — extract and analyze Claude Code session data
// @cap-decision Output is structured Markdown — LLM-consumable and human-readable without formatting deps.
// @cap-decision Session index is 1-based, most recent first — matches natural "last session = 1" mental model.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path, os).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// --- Constants ---

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// --- Project Discovery ---

/**
 * Find the Claude Code project directory for a given working directory.
 * Claude encodes the absolute path with - replacing /.
 * @param {string} cwd - Current working directory
 * @returns {string|null} Path to the project session directory
 */
function getProjectDir(cwd) {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  const encoded = cwd.replace(/\//g, '-');
  const dir = path.join(PROJECTS_DIR, encoded);
  if (fs.existsSync(dir)) return dir;
  // Fallback: scan for matching suffix
  for (const d of fs.readdirSync(PROJECTS_DIR)) {
    if (d.endsWith(path.basename(cwd))) return path.join(PROJECTS_DIR, d);
  }
  return null;
}

/**
 * Find all Claude Code project directories for a path and its sub-projects.
 * For monorepos: if cwd is /GoetzeInvest, finds sessions for GoetzeInvest,
 * GoetzeInvest/GoetzeBooking, GoetzeInvest/EasySign, etc.
 * @param {string} cwd - Current working directory (typically monorepo root)
 * @returns {Array<{dir: string, name: string}>} Project directories with display names
 */
function getProjectDirsWithChildren(cwd) {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const encoded = cwd.replace(/\//g, '-');
  const results = [];

  for (const d of fs.readdirSync(PROJECTS_DIR)) {
    if (d.startsWith(encoded)) {
      const fullPath = path.join(PROJECTS_DIR, d);
      // Extract the sub-path relative to cwd for display
      const suffix = d.slice(encoded.length);
      const name = suffix ? suffix.replace(/^-/, '').replace(/-/g, '/') : '(root)';
      results.push({ dir: fullPath, name });
    }
  }

  return results;
}

/**
 * Get all session files across a project and its sub-projects (monorepo-aware).
 * @param {string} cwd - Working directory
 * @returns {{files: Array<{file: string, path: string, date: string|null, size: number, project: string}>, projects: string[]}}
 */
function getAllSessionFiles(cwd) {
  const projectDirs = getProjectDirsWithChildren(cwd);
  const allFiles = [];
  const projects = [];

  for (const { dir, name } of projectDirs) {
    const files = getSessionFiles(dir);
    if (files.length > 0) {
      projects.push(`${name} (${files.length} sessions)`);
      for (const f of files) {
        allFiles.push({ ...f, project: name });
      }
    }
  }

  // Sort all files by date, most recent first
  allFiles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { files: allFiles, projects };
}

// --- JSONL Parsing ---

/**
 * @typedef {Object} SessionMeta
 * @property {string} id - Session UUID
 * @property {string|null} timestamp - ISO timestamp
 * @property {string|null} version - Claude Code version
 * @property {string|null} branch - Git branch
 */

/**
 * @typedef {Object} ParsedSession
 * @property {SessionMeta} meta
 * @property {Array<Object>} messages
 */

/**
 * Parse a JSONL session file into structured data.
 * @param {string} filePath - Path to .jsonl file
 * @returns {ParsedSession}
 */
function parseSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const messages = [];
  let sessionMeta = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.sessionId && !sessionMeta) {
        sessionMeta = { id: obj.sessionId, timestamp: null, version: obj.version || null, branch: obj.gitBranch || null };
      }
      if (sessionMeta && !sessionMeta.timestamp && obj.timestamp) {
        sessionMeta.timestamp = obj.timestamp;
      }
      if (sessionMeta && !sessionMeta.branch && obj.gitBranch) {
        sessionMeta.branch = obj.gitBranch;
      }
      if (obj.type === 'user' || obj.type === 'assistant') {
        messages.push(obj);
      }
    } catch { /* skip malformed lines */ }
  }
  return { meta: sessionMeta || { id: 'unknown', timestamp: null, version: null, branch: null }, messages };
}

/**
 * Get sorted session file entries for a project directory.
 * @param {string} projectDir
 * @returns {Array<{file: string, path: string, date: string|null, size: number}>}
 */
function getSessionFiles(projectDir) {
  return fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl') && !f.includes('/'))
    .map(f => {
      const fp = path.join(projectDir, f);
      const stat = fs.statSync(fp);
      const firstLine = fs.readFileSync(fp, 'utf8').split('\n')[0];
      let ts = null;
      try { ts = JSON.parse(firstLine).timestamp; } catch { /* ignore */ }
      return { file: f, path: fp, date: ts, size: stat.size };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// --- Shared Patterns ---

/** Decision-related regex patterns for extracting key decisions from assistant messages. */
const DECISION_PATTERNS = [
  /(?:decided|decision|chose|choice|approach|strategy|trade-?off|rationale|conclusion)/i,
  /(?:the problem|the issue|root cause|the fix|solution|workaround)/i,
];

// --- Content Extraction Helpers ---

/**
 * Extract text content from a message object.
 * @param {Object} msg
 * @returns {string}
 */
function extractTextContent(msg) {
  const content = msg.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }
  return '';
}

/**
 * Extract tool use records from a message.
 * @param {Object} msg
 * @returns {Array<{tool: string, input: Object}>}
 */
function extractToolUses(msg) {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(c => c.type === 'tool_use')
    .map(c => ({ tool: c.name, input: c.input }));
}

// --- Formatting Helpers ---

/**
 * Format byte size for display.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return bytes + 'B';
}

/**
 * Format ISO timestamp for display.
 * @param {string|null} ts
 * @returns {string}
 */
function formatDate(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').substring(0, 16);
}

/**
 * Strip system-reminder and other XML tags from text.
 * @param {string} text
 * @returns {string}
 */
function stripSystemTags(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// --- Extract Modes ---

// @cap-todo(ref:F-025:AC-1) cap extract list — display all sessions with date, size, turns, preview

/**
 * List all sessions with metadata.
 * @param {string} projectDir
 * @returns {string} Formatted output
 */
function listSessions(projectDir) {
  const files = getSessionFiles(projectDir);
  const rows = files.map(f => {
    const lines = fs.readFileSync(f.path, 'utf8').trim().split('\n');
    let firstMsg = '';
    let userCount = 0;
    let assistantCount = 0;

    for (const line of lines.slice(0, 10)) {
      try {
        const obj = JSON.parse(line);
        if (!firstMsg && obj.type === 'user') {
          const text = extractTextContent(obj);
          firstMsg = stripSystemTags(text).substring(0, 80) || '(command)';
        }
      } catch { /* ignore */ }
    }
    for (const line of lines) {
      if (line.includes('"type":"user"')) userCount++;
      else if (line.includes('"type":"assistant"')) assistantCount++;
    }

    return {
      date: f.date,
      size: f.size,
      turns: userCount,
      responses: assistantCount,
      preview: firstMsg,
    };
  });

  const out = [];
  out.push(`# Sessions (${path.basename(projectDir)})\n`);
  out.push('| # | Date | Size | Turns | Preview |');
  out.push('|---|------|------|-------|---------|');
  rows.forEach((r, i) => {
    out.push(`| ${i + 1} | ${formatDate(r.date)} | ${formatSize(r.size)} | ${r.turns} | ${r.preview} |`);
  });
  out.push(`\n*${rows.length} sessions total*`);
  return out.join('\n');
}

// @cap-todo(ref:F-025:AC-2) cap extract stats — token counts, tool distribution, duration, turns

/**
 * Extract statistics from a single session.
 * @param {string} filePath
 * @returns {string} Formatted Markdown
 */
function extractStats(filePath) {
  const { meta, messages } = parseSession(filePath);
  const toolCounts = {};
  let userTurns = 0;
  let assistantTurns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  // Re-read raw lines for token data (not just user/assistant messages)
  const rawLines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  for (const line of rawLines) {
    try {
      const obj = JSON.parse(line);
      if (obj.timestamp) {
        if (!firstTimestamp) firstTimestamp = obj.timestamp;
        lastTimestamp = obj.timestamp;
      }
      if (obj.message?.usage) {
        totalInputTokens += obj.message.usage.input_tokens || 0;
        totalOutputTokens += obj.message.usage.output_tokens || 0;
      }
    } catch { /* ignore */ }
  }

  for (const msg of messages) {
    if (msg.type === 'user') userTurns++;
    if (msg.type === 'assistant') {
      assistantTurns++;
      for (const tool of extractToolUses(msg)) {
        toolCounts[tool.tool] = (toolCounts[tool.tool] || 0) + 1;
      }
    }
  }

  let duration = 'unknown';
  if (firstTimestamp && lastTimestamp) {
    const ms = new Date(lastTimestamp) - new Date(firstTimestamp);
    const mins = Math.round(ms / 60000);
    duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  const out = [];
  out.push(`# Session Stats`);
  out.push(`> Date: ${formatDate(meta.timestamp)} | Branch: ${meta.branch || 'unknown'}\n`);
  out.push(`| Metric | Value |`);
  out.push(`|--------|-------|`);
  out.push(`| Duration | ${duration} |`);
  out.push(`| User turns | ${userTurns} |`);
  out.push(`| Assistant turns | ${assistantTurns} |`);
  out.push(`| Input tokens | ${totalInputTokens.toLocaleString()} |`);
  out.push(`| Output tokens | ${totalOutputTokens.toLocaleString()} |`);
  out.push(`| Total tokens | ${(totalInputTokens + totalOutputTokens).toLocaleString()} |`);
  out.push('');

  const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  if (sortedTools.length > 0) {
    out.push('## Tool Usage\n');
    out.push('| Tool | Count |');
    out.push('|------|-------|');
    for (const [tool, count] of sortedTools) {
      out.push(`| ${tool} | ${count} |`);
    }
  }

  return out.join('\n');
}

// @cap-todo(ref:F-025:AC-3) cap extract conversation — user/assistant dialogue as Markdown

/**
 * Extract conversation from a session.
 * @param {string} filePath
 * @returns {string} Formatted Markdown
 */
function extractConversation(filePath) {
  const { meta, messages } = parseSession(filePath);
  const out = [];
  out.push(`# Session Conversation`);
  out.push(`> Date: ${formatDate(meta.timestamp)} | Branch: ${meta.branch || 'unknown'}\n`);

  let turnNum = 0;
  for (const msg of messages) {
    if (msg.isSidechain) continue;
    const text = extractTextContent(msg);
    if (!text.trim()) continue;
    const clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!clean) continue;

    if (msg.type === 'user') {
      turnNum++;
      const userText = stripSystemTags(clean);
      if (!userText) continue;
      out.push(`## Turn ${turnNum}`);
      out.push(`**User:** ${userText}\n`);
    } else if (msg.type === 'assistant') {
      out.push(clean);
      out.push('');
    }
  }
  return out.join('\n');
}

// @cap-todo(ref:F-025:AC-4) cap extract code — all file writes and edits grouped by file

/**
 * Extract code changes from a session.
 * @param {string} filePath
 * @returns {string} Formatted Markdown
 */
function extractCode(filePath) {
  const { meta, messages } = parseSession(filePath);
  const out = [];
  out.push(`# Session Code Changes`);
  out.push(`> Date: ${formatDate(meta.timestamp)} | Branch: ${meta.branch || 'unknown'}\n`);

  const fileChanges = {};

  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    for (const tool of extractToolUses(msg)) {
      if (tool.tool !== 'Write' && tool.tool !== 'Edit' && tool.tool !== 'MultiEdit') continue;
      const changedFilePath = tool.input?.file_path || tool.input?.filePath || 'unknown';
      if (!fileChanges[changedFilePath]) fileChanges[changedFilePath] = [];
      fileChanges[changedFilePath].push({
        op: tool.tool === 'Write' ? 'create/overwrite' : 'edit',
        tool: tool.tool,
        input: tool.input,
      });
    }
  }

  const paths = Object.keys(fileChanges);
  if (paths.length === 0) {
    out.push('_No code changes in this session._');
    return out.join('\n');
  }

  out.push(`**${paths.length} files changed:**\n`);
  for (const fp of paths.sort()) {
    const changes = fileChanges[fp];
    out.push(`### \`${fp}\` (${changes.length} ${changes.length === 1 ? 'change' : 'changes'})`);
    for (const c of changes) {
      if (c.op === 'create/overwrite') {
        const preview = (c.input?.content || '').substring(0, 300);
        out.push(`**${c.op}**`);
        out.push('```');
        out.push(preview + (c.input?.content?.length > 300 ? '\n// ... truncated' : ''));
        out.push('```');
      } else {
        out.push(`**${c.op}**`);
        out.push('```diff');
        out.push('- ' + (c.input?.old_string || '').substring(0, 200));
        out.push('+ ' + (c.input?.new_string || '').substring(0, 200));
        out.push('```');
      }
    }
    out.push('');
  }

  out.push(`---\n*${paths.length} files, ${Object.values(fileChanges).reduce((s, c) => s + c.length, 0)} changes total*`);
  return out.join('\n');
}

// @cap-todo(ref:F-025:AC-5) cap extract summary — structured Markdown for LLM consumption

/**
 * Extract a structured summary of a session (raw data for LLM consumption).
 * @param {string} filePath
 * @returns {string} Formatted Markdown
 */
function extractSummary(filePath) {
  const { meta, messages } = parseSession(filePath);
  const out = [];
  out.push(`# Session Summary`);
  out.push(`> Date: ${formatDate(meta.timestamp)} | Branch: ${meta.branch || 'unknown'}\n`);

  const decisions = [];

  // Files changed
  const filesChanged = new Set();

  // Features referenced
  const featuresReferenced = new Set();
  const featurePattern = /F-\d{3}/g;

  // Key outcomes: last assistant message
  let lastAssistantText = '';

  let userTurns = 0;
  let assistantTurns = 0;

  for (const msg of messages) {
    if (msg.isSidechain) continue;

    if (msg.type === 'user') userTurns++;
    if (msg.type === 'assistant') {
      assistantTurns++;
      const text = extractTextContent(msg);
      if (text.trim()) lastAssistantText = text;

      // Collect decisions
      const clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      const sentences = clean.split(/(?<=[.!?\n])\s+/);
      for (const sentence of sentences) {
        if (sentence.length >= 20 && sentence.length <= 500) {
          if (DECISION_PATTERNS.some(p => p.test(sentence))) {
            decisions.push(sentence.trim());
          }
        }
      }

      // Collect file changes
      for (const tool of extractToolUses(msg)) {
        if (tool.tool === 'Write' || tool.tool === 'Edit' || tool.tool === 'MultiEdit') {
          filesChanged.add(tool.input?.file_path || tool.input?.filePath || 'unknown');
        }
      }

      // Collect feature references
      const matches = clean.match(featurePattern);
      if (matches) matches.forEach(m => featuresReferenced.add(m));
    }
  }

  // Overview
  out.push(`## Overview`);
  out.push(`- **Turns:** ${userTurns} user / ${assistantTurns} assistant`);
  out.push(`- **Files changed:** ${filesChanged.size}`);
  out.push(`- **Features referenced:** ${featuresReferenced.size > 0 ? [...featuresReferenced].join(', ') : 'none'}`);
  out.push('');

  // Files
  if (filesChanged.size > 0) {
    out.push(`## Files Changed`);
    for (const f of [...filesChanged].sort()) {
      out.push(`- \`${f}\``);
    }
    out.push('');
  }

  // Decisions
  if (decisions.length > 0) {
    out.push(`## Decisions`);
    const unique = [...new Set(decisions)].slice(0, 20);
    for (const d of unique) {
      out.push(`- ${d}`);
    }
    out.push('');
  }

  return out.join('\n');
}

// --- Cross-Session Aggregation (F-026) ---

// @cap-feature(feature:F-026) Cross-Session Aggregation — decisions, hotspots, timeline, cost across all sessions

/**
 * Filter session files by --since date.
 * @param {Array<{file: string, path: string, date: string|null, size: number}>} files
 * @param {string|null} sinceDate - YYYY-MM-DD or null
 * @returns {Array}
 */
function filterBySince(files, sinceDate) {
  if (!sinceDate) return files;
  // String comparison works because ISO 8601 timestamps sort lexicographically
  return files.filter(f => f.date && f.date >= sinceDate);
}

/**
 * Parse --since flag from args array.
 * @param {string[]} args
 * @returns {{sinceDate: string|null, cleanArgs: string[]}}
 */
function parseSinceFlag(args) {
  const idx = args.indexOf('--since');
  if (idx === -1 || idx + 1 >= args.length) return { sinceDate: null, cleanArgs: args };
  const sinceDate = args[idx + 1];
  const cleanArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { sinceDate, cleanArgs };
}

// @cap-todo(ref:F-026:AC-1) cap extract decisions --all — decisions across all sessions

/**
 * Aggregate decisions across all sessions.
 * @param {string} projectDir
 * @param {string|null} sinceDate
 * @returns {string}
 */
function extractDecisionsAll(projectDir, sinceDate) {
  const files = filterBySince(getSessionFiles(projectDir), sinceDate);
  const out = [];
  out.push('# Decisions Across Sessions');
  if (sinceDate) out.push(`> Filtered: since ${sinceDate}`);
  out.push(`> Sessions scanned: ${files.length}\n`);

  let totalDecisions = 0;

  for (const f of files) {
    const { meta, messages } = parseSession(f.path);
    const sessionDecisions = [];

    for (const msg of messages) {
      if (msg.type !== 'assistant' || msg.isSidechain) continue;
      const text = extractTextContent(msg).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      const sentences = text.split(/(?<=[.!?\n])\s+/);
      for (const sentence of sentences) {
        if (sentence.length >= 20 && sentence.length <= 500) {
          if (DECISION_PATTERNS.some(p => p.test(sentence))) {
            sessionDecisions.push(sentence.trim());
          }
        }
      }
    }

    if (sessionDecisions.length > 0) {
      out.push(`## ${formatDate(meta.timestamp)} (${meta.branch || 'unknown'})`);
      const unique = [...new Set(sessionDecisions)];
      for (const d of unique) {
        out.push(`- ${d}`);
      }
      out.push('');
      totalDecisions += unique.length;
    }
  }

  if (totalDecisions === 0) {
    out.push('_No decisions found._');
  } else {
    out.push(`---\n*${totalDecisions} decisions across ${files.length} sessions*`);
  }
  return out.join('\n');
}

// @cap-todo(ref:F-026:AC-2) cap extract hotspots — files ranked by edit frequency

/**
 * Rank files by edit frequency across all sessions.
 * @param {string} projectDir
 * @param {string|null} sinceDate
 * @returns {string}
 */
function extractHotspots(projectDir, sinceDate) {
  const files = filterBySince(getSessionFiles(projectDir), sinceDate);
  const out = [];
  out.push('# File Hotspots');
  if (sinceDate) out.push(`> Filtered: since ${sinceDate}`);
  out.push(`> Sessions scanned: ${files.length}\n`);

  const fileCounts = {}; // path -> { edits: N, sessions: Set }

  for (const f of files) {
    const { messages } = parseSession(f.path);
    const sessionFiles = new Set();

    for (const msg of messages) {
      if (msg.type !== 'assistant') continue;
      for (const tool of extractToolUses(msg)) {
        if (tool.tool !== 'Write' && tool.tool !== 'Edit' && tool.tool !== 'MultiEdit') continue;
        const fp = tool.input?.file_path || tool.input?.filePath || 'unknown';
        if (!fileCounts[fp]) fileCounts[fp] = { edits: 0, sessions: new Set() };
        fileCounts[fp].edits++;
        sessionFiles.add(fp);
      }
    }

    for (const fp of sessionFiles) {
      fileCounts[fp].sessions.add(f.file);
    }
  }

  const sorted = Object.entries(fileCounts)
    .map(([fp, data]) => ({ path: fp, edits: data.edits, sessions: data.sessions.size }))
    .sort((a, b) => b.edits - a.edits);

  if (sorted.length === 0) {
    out.push('_No file edits found._');
    return out.join('\n');
  }

  out.push('| Rank | File | Edits | Sessions |');
  out.push('|------|------|-------|----------|');
  sorted.slice(0, 30).forEach((entry, i) => {
    out.push(`| ${i + 1} | \`${entry.path}\` | ${entry.edits} | ${entry.sessions} |`);
  });

  out.push(`\n*${sorted.length} files changed across ${files.length} sessions*`);
  return out.join('\n');
}

// @cap-todo(ref:F-026:AC-3) cap extract timeline — chronological view across sessions

/**
 * Chronological timeline of work across sessions.
 * @param {string} projectDir
 * @param {string|null} sinceDate
 * @returns {string}
 */
function extractTimeline(projectDir, sinceDate) {
  const files = filterBySince(getSessionFiles(projectDir), sinceDate);
  const out = [];
  out.push('# Session Timeline');
  if (sinceDate) out.push(`> Filtered: since ${sinceDate}`);
  out.push(`> Sessions: ${files.length}\n`);

  // Reverse to chronological order (oldest first)
  const chronological = [...files].reverse();

  for (const f of chronological) {
    const { meta, messages } = parseSession(f.path);

    // Collect changed files
    const changedFiles = new Set();
    const features = new Set();
    const featurePattern = /F-\d{3}/g;
    let firstUserMsg = '';

    for (const msg of messages) {
      if (msg.type === 'user' && !firstUserMsg) {
        firstUserMsg = stripSystemTags(extractTextContent(msg)).substring(0, 100);
      }
      if (msg.type === 'assistant') {
        for (const tool of extractToolUses(msg)) {
          if (tool.tool === 'Write' || tool.tool === 'Edit' || tool.tool === 'MultiEdit') {
            changedFiles.add(tool.input?.file_path || tool.input?.filePath || 'unknown');
          }
        }
        const text = extractTextContent(msg);
        const matches = text.match(featurePattern);
        if (matches) matches.forEach(m => features.add(m));
      }
    }

    const userTurns = messages.filter(m => m.type === 'user').length;

    out.push(`### ${formatDate(meta.timestamp)} — ${meta.branch || 'unknown'}`);
    out.push(`- **Topic:** ${firstUserMsg || '(unknown)'}`);
    out.push(`- **Turns:** ${userTurns}`);
    if (features.size > 0) out.push(`- **Features:** ${[...features].join(', ')}`);
    out.push(`- **Files changed:** ${changedFiles.size > 0 ? [...changedFiles].slice(0, 5).map(f => `\`${f}\``).join(', ') + (changedFiles.size > 5 ? ` +${changedFiles.size - 5} more` : '') : 'none'}`);
    out.push('');
  }

  return out.join('\n');
}

// @cap-todo(ref:F-026:AC-4) cap extract cost — token usage aggregated across sessions

/**
 * Aggregate token usage and estimate cost across sessions.
 * @param {string} projectDir
 * @param {string|null} sinceDate
 * @returns {string}
 */
function extractCost(projectDir, sinceDate) {
  const files = filterBySince(getSessionFiles(projectDir), sinceDate);
  const out = [];
  out.push('# Token Cost Report');
  if (sinceDate) out.push(`> Filtered: since ${sinceDate}`);
  out.push(`> Sessions: ${files.length}\n`);

  // Default rates (USD per 1M tokens) — Opus pricing as of 2025-05
  const inputRate = 15;
  const outputRate = 75;

  let grandInputTokens = 0;
  let grandOutputTokens = 0;
  const rows = [];

  for (const f of files) {
    const rawLines = fs.readFileSync(f.path, 'utf8').trim().split('\n');
    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of rawLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.message?.usage) {
          inputTokens += obj.message.usage.input_tokens || 0;
          outputTokens += obj.message.usage.output_tokens || 0;
        }
      } catch { /* ignore */ }
    }

    grandInputTokens += inputTokens;
    grandOutputTokens += outputTokens;

    const total = inputTokens + outputTokens;
    const cost = (inputTokens / 1e6) * inputRate + (outputTokens / 1e6) * outputRate;

    rows.push({
      date: f.date,
      input: inputTokens,
      output: outputTokens,
      total,
      cost,
    });
  }

  const grandTotal = grandInputTokens + grandOutputTokens;
  const grandCost = (grandInputTokens / 1e6) * inputRate + (grandOutputTokens / 1e6) * outputRate;

  out.push('## Per Session\n');
  out.push('| # | Date | Input | Output | Total | Est. Cost |');
  out.push('|---|------|-------|--------|-------|-----------|');
  rows.forEach((r, i) => {
    out.push(`| ${i + 1} | ${formatDate(r.date)} | ${r.input.toLocaleString()} | ${r.output.toLocaleString()} | ${r.total.toLocaleString()} | $${r.cost.toFixed(2)} |`);
  });

  out.push('');
  out.push('## Totals\n');
  out.push(`| Metric | Value |`);
  out.push(`|--------|-------|`);
  out.push(`| Input tokens | ${grandInputTokens.toLocaleString()} |`);
  out.push(`| Output tokens | ${grandOutputTokens.toLocaleString()} |`);
  out.push(`| Total tokens | ${grandTotal.toLocaleString()} |`);
  out.push(`| Estimated cost | $${grandCost.toFixed(2)} |`);
  out.push(`\n*Rates: $${inputRate}/1M input, $${outputRate}/1M output (Opus)*`);

  return out.join('\n');
}

// @cap-todo(ref:F-025:AC-8) Support session references by numeric index and date-based lookup

/**
 * Resolve a session reference to a file path.
 * Supports numeric index (1 = most recent) or date string (YYYY-MM-DD).
 * @param {string} projectDir
 * @param {string} ref - Session reference (number or date)
 * @returns {string} File path to session
 */
function resolveSessionRef(projectDir, ref) {
  const files = getSessionFiles(projectDir);
  if (files.length === 0) {
    throw new Error('No sessions found.');
  }

  // Numeric index
  const num = parseInt(ref, 10);
  if (!isNaN(num) && String(num) === ref) {
    if (num < 1 || num > files.length) {
      throw new Error(`Session #${num} not found. ${files.length} sessions available.`);
    }
    return files[num - 1].path;
  }

  // Date-based lookup (YYYY-MM-DD) — find first session matching that date
  if (/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    const match = files.find(f => f.date && f.date.startsWith(ref));
    if (!match) {
      throw new Error(`No session found for date ${ref}.`);
    }
    return match.path;
  }

  throw new Error(`Invalid session reference: "${ref}". Use a number (1 = most recent) or date (YYYY-MM-DD).`);
}

// @cap-todo(ref:F-025:AC-7) Register extract as subcommand with help text and error handling

/**
 * Run the extract CLI with given arguments.
 * @param {string[]} args - CLI arguments after "extract"
 * @param {string} [cwd] - Working directory override
 * @returns {string} Output text
 */
function run(args, cwd) {
  const workDir = cwd || process.cwd();
  const { sinceDate, cleanArgs } = parseSinceFlag(args);
  const command = cleanArgs[0] || 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    return getHelp();
  }

  const projectDir = getProjectDir(workDir);
  if (!projectDir) {
    throw new Error(`No Claude Code sessions found for: ${workDir}`);
  }

  if (command === 'list' || command === 'ls') {
    return listSessions(projectDir);
  }

  if (command === 'stats') {
    const ref = cleanArgs[1];
    if (!ref) throw new Error('Usage: cap extract stats <session#>');
    const filePath = resolveSessionRef(projectDir, ref);
    return extractStats(filePath);
  }

  // Cross-session commands (F-026)
  if (command === 'decisions') {
    return extractDecisionsAll(projectDir, sinceDate);
  }
  if (command === 'hotspots') {
    return extractHotspots(projectDir, sinceDate);
  }
  if (command === 'timeline') {
    return extractTimeline(projectDir, sinceDate);
  }
  if (command === 'cost') {
    return extractCost(projectDir, sinceDate);
  }

  // Session extraction modes: cap extract <ref> <mode>
  const ref = cleanArgs[0];
  const mode = cleanArgs[1] || 'conversation';
  const filePath = resolveSessionRef(projectDir, ref);

  switch (mode) {
    case 'conversation': return extractConversation(filePath);
    case 'code':         return extractCode(filePath);
    case 'summary':      return extractSummary(filePath);
    case 'stats':        return extractStats(filePath);
    default:
      throw new Error(`Unknown mode: "${mode}". Available: conversation, code, summary, stats`);
  }
}

/**
 * Get help text.
 * @returns {string}
 */
function getHelp() {
  return `cap extract — Extract and analyze Claude Code sessions

Usage:
  Single session:
    cap extract list                      List all sessions
    cap extract stats <ref>               Session statistics (tokens, tools, duration)
    cap extract <ref> conversation        User/assistant dialogue (default)
    cap extract <ref> code                All file writes and edits
    cap extract <ref> summary             Structured summary for LLM consumption

  Cross-session:
    cap extract decisions [--since DATE]  Decisions across all sessions
    cap extract hotspots  [--since DATE]  Files ranked by edit frequency
    cap extract timeline  [--since DATE]  Chronological work overview
    cap extract cost      [--since DATE]  Token usage and cost estimates

Session references:
  1, 2, 3...          By index (1 = most recent)
  2026-04-03           By date (YYYY-MM-DD)

Examples:
  cap extract list
  cap extract stats 1
  cap extract 1 conversation
  cap extract 2 code > changes.md
  cap extract decisions --since 2026-03-01
  cap extract hotspots
  cap extract cost`;
}

module.exports = {
  run,
  listSessions,
  extractStats,
  extractConversation,
  extractCode,
  extractSummary,
  extractDecisionsAll,
  extractHotspots,
  extractTimeline,
  extractCost,
  resolveSessionRef,
  getProjectDir,
  getProjectDirsWithChildren,
  getAllSessionFiles,
  parseSession,
  getSessionFiles,
  filterBySince,
  parseSinceFlag,
  extractTextContent,
  extractToolUses,
  formatSize,
  formatDate,
  getHelp,
};
