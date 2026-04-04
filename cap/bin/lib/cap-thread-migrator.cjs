// @cap-feature(feature:F-031) Thread migration — extract brainstorm sessions from past JSONL logs and persist as conversation threads
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Migrate past brainstorm sessions to conversation threads.
 * Scans Claude Code JSONL session files for brainstorm activity and creates
 * threads from them. Idempotent — skips if threads already exist.
 *
 * @param {string} cwd - Project root
 * @returns {{ migrated: number, totalSessions: number, reason?: string }}
 */
function migrateBrainstormSessions(cwd) {
  const tracker = require('./cap-thread-tracker.cjs');
  const extract = require('./cap-session-extract.cjs');

  // Skip if threads already exist
  const index = tracker.loadIndex(cwd);
  if (index.threads.length > 0) {
    return { migrated: 0, totalSessions: 0, reason: 'threads already exist' };
  }

  // Find project sessions
  const projectDir = extract.getProjectDir(cwd);
  if (!projectDir) {
    return { migrated: 0, totalSessions: 0, reason: 'no session directory' };
  }

  const sessionFiles = extract.getSessionFiles(projectDir);
  if (sessionFiles.length === 0) {
    return { migrated: 0, totalSessions: 0, reason: 'no sessions' };
  }

  let migrated = 0;
  for (const sf of sessionFiles) {
    try {
      const content = fs.readFileSync(sf.path, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      // Check if this session contained a brainstorm
      const hasBrainstorm = lines.some(l => {
        try {
          const msg = JSON.parse(l);
          const text = _extractText(msg);
          return text.includes('/cap:brainstorm') ||
                 text.includes('BRAINSTORM OUTPUT') ||
                 text.includes('=== FEATURE:');
        } catch { return false; }
      });

      if (!hasBrainstorm) continue;

      // Extract problem statement and feature IDs
      let problemStatement = '';
      let featureIds = [];
      for (const l of lines) {
        try {
          const msg = JSON.parse(l);
          const text = _extractText(msg);

          const fMatches = text.match(/F-\d{3}/g);
          if (fMatches) featureIds.push(...fMatches);

          if (msg.type === 'user' && text.length > 20 && !problemStatement && !text.includes('/cap:')) {
            problemStatement = text.substring(0, 200);
          }
        } catch { /* skip */ }
      }

      if (!problemStatement) {
        problemStatement = 'Brainstorm session from ' + (sf.date || 'unknown date');
      }
      featureIds = [...new Set(featureIds)];

      const thread = tracker.createThread({
        problemStatement,
        solutionShape: '',
        boundaryDecisions: [],
        featureIds,
      });
      if (sf.date) thread.timestamp = sf.date;
      tracker.persistThread(cwd, thread);
      migrated++;
    } catch { /* skip unparseable sessions */ }
  }

  return { migrated, totalSessions: sessionFiles.length };
}

/**
 * Extract text content from a JSONL message object.
 * @param {Object} msg
 * @returns {string}
 */
function _extractText(msg) {
  const content = msg.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
  }
  return '';
}

module.exports = { migrateBrainstormSessions };
