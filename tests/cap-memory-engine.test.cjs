'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  analyzeSession,
  accumulate,
  accumulateFromFiles,
  formatAnnotation,
  extractText,
  extractTools,
  stripTags,
  DEFAULT_STALE_THRESHOLD,
  MIN_HOTSPOT_SESSIONS,
  MIN_PATTERN_CONFIRMATIONS,
} = require('../cap/bin/lib/cap-memory-engine.cjs');

// --- Test Helpers ---

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSessionFile(name, lines) {
  const fp = path.join(tmpDir, name);
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'));
  return fp;
}

function makeSession(overrides = {}) {
  return {
    meta: { id: 'test', timestamp: '2026-04-01T10:00:00Z', branch: 'main', ...overrides.meta },
    messages: overrides.messages || [],
  };
}

function userMsg(text) {
  return { type: 'user', message: { content: text } };
}

function assistantMsg(text, tools = []) {
  const content = [{ type: 'text', text }];
  for (const t of tools) content.push({ type: 'tool_use', name: t.tool, input: t.input });
  return { type: 'assistant', message: { content } };
}

// --- Unit Tests: Helpers ---

describe('extractText', () => {
  it('extracts string content', () => {
    assert.strictEqual(extractText({ message: { content: 'hello' } }), 'hello');
  });

  it('extracts array content', () => {
    const msg = { message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } };
    assert.strictEqual(extractText(msg), 'a\nb');
  });
});

describe('stripTags', () => {
  it('removes system-reminder tags', () => {
    const input = 'before <system-reminder>hidden</system-reminder> after';
    assert.strictEqual(stripTags(input), 'before  after');
  });
});

// --- analyzeSession ---

describe('analyzeSession', () => {
  it('detects decisions from assistant messages', () => {
    const session = makeSession({
      messages: [
        userMsg('fix auth'),
        assistantMsg('I decided to use token-based refresh. The root cause is expired cookies.'),
      ],
    });
    const result = analyzeSession(session);
    assert.ok(result.decisions.length > 0);
    assert.ok(result.decisions.some(d => d.includes('decided') || d.includes('root cause')));
  });

  it('detects pitfalls from debug sessions', () => {
    const session = makeSession({
      messages: [
        userMsg('debug auth'),
        assistantMsg('The bug was caused by a subtle race condition. Hours of debugging revealed the workaround.'),
      ],
    });
    const result = analyzeSession(session, { isDebugSession: true });
    assert.ok(result.pitfalls.length > 0);
  });

  it('detects pitfalls from pitfall-pattern text even without debug flag', () => {
    const session = makeSession({
      messages: [
        userMsg('fix issue'),
        assistantMsg('Watch out for the broken cache invalidation — this is a known gotcha in this module.'),
      ],
    });
    const result = analyzeSession(session, { isDebugSession: false });
    assert.ok(result.pitfalls.length > 0);
  });

  it('detects patterns', () => {
    const session = makeSession({
      messages: [
        userMsg('refactor tests'),
        assistantMsg('This approach works well — integration tests over mocks are better to catch real issues.'),
      ],
    });
    const result = analyzeSession(session);
    assert.ok(result.patterns.length > 0);
  });

  it('tracks edited files', () => {
    const session = makeSession({
      messages: [
        assistantMsg('Editing files.', [
          { tool: 'Edit', input: { file_path: '/src/auth.js', old_string: 'a', new_string: 'b' } },
          { tool: 'Edit', input: { file_path: '/src/auth.js', old_string: 'c', new_string: 'd' } },
          { tool: 'Write', input: { file_path: '/src/utils.js', content: '...' } },
        ]),
      ],
    });
    const result = analyzeSession(session);
    assert.strictEqual(result.editedFiles['/src/auth.js'], 2);
    assert.strictEqual(result.editedFiles['/src/utils.js'], 1);
  });

  it('collects feature references', () => {
    const session = makeSession({
      messages: [
        assistantMsg('Working on F-025 and F-026 now.'),
      ],
    });
    const result = analyzeSession(session);
    assert.ok(result.features.has('F-025'));
    assert.ok(result.features.has('F-026'));
  });

  it('skips sidechain messages', () => {
    const session = makeSession({
      messages: [
        { type: 'assistant', message: { content: 'I decided to use X.' }, isSidechain: true },
        assistantMsg('Hello world, nothing special here at all.'),
      ],
    });
    const result = analyzeSession(session);
    assert.strictEqual(result.decisions.length, 0);
  });

  it('returns session date and branch', () => {
    const session = makeSession({ meta: { timestamp: '2026-04-01T10:00:00Z', branch: 'feature-x' } });
    const result = analyzeSession(session);
    assert.strictEqual(result.date, '2026-04-01T10:00:00Z');
    assert.strictEqual(result.branch, 'feature-x');
  });
});

// --- accumulate ---

describe('accumulate', () => {
  it('detects hotspots from cross-session edits', () => {
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/src/auth.js': 3 }, features: new Set(), date: '2026-03-01T00:00:00Z', branch: 'main' },
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/src/auth.js': 2 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const hotspots = result.newEntries.filter(e => e.category === 'hotspot');
    assert.strictEqual(hotspots.length, 1);
    assert.strictEqual(hotspots[0].file, '/src/auth.js');
    assert.strictEqual(hotspots[0].metadata.sessions, 2);
    assert.strictEqual(hotspots[0].metadata.edits, 5);
  });

  it('requires minimum sessions for hotspot', () => {
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/src/auth.js': 10 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const hotspots = result.newEntries.filter(e => e.category === 'hotspot');
    assert.strictEqual(hotspots.length, 0); // only 1 session
  });

  it('collects decisions across sessions', () => {
    const analyses = [
      { decisions: ['I decided to use token refresh.'], pitfalls: [], patterns: [], editedFiles: { '/src/auth.js': 1 }, features: new Set(['F-001']), date: '2026-04-01T00:00:00Z', branch: 'main' },
      { decisions: ['The conclusion is to avoid mocks.'], pitfalls: [], patterns: [], editedFiles: {}, features: new Set(), date: '2026-04-02T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const decisions = result.newEntries.filter(e => e.category === 'decision');
    assert.strictEqual(decisions.length, 2);
    assert.ok(decisions[0].metadata.features.includes('F-001'));
  });

  it('deduplicates decisions by content prefix', () => {
    const analyses = [
      { decisions: ['I decided to use token refresh.'], pitfalls: [], patterns: [], editedFiles: {}, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
      { decisions: ['I decided to use token refresh.'], pitfalls: [], patterns: [], editedFiles: {}, features: new Set(), date: '2026-04-02T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const decisions = result.newEntries.filter(e => e.category === 'decision');
    assert.strictEqual(decisions.length, 1);
  });

  it('collects pitfalls', () => {
    const analyses = [
      { decisions: [], pitfalls: ['The bug was a subtle race condition.'], patterns: [], editedFiles: { '/src/race.js': 1 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const pitfalls = result.newEntries.filter(e => e.category === 'pitfall');
    assert.strictEqual(pitfalls.length, 1);
    assert.strictEqual(pitfalls[0].file, '/src/race.js');
  });

  it('requires minimum confirmations for patterns', () => {
    const analyses = [
      { decisions: [], pitfalls: [], patterns: ['This approach works well for auth modules.'], editedFiles: {}, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const patterns = result.newEntries.filter(e => e.category === 'pattern');
    assert.strictEqual(patterns.length, 0); // only confirmed once
  });

  it('emits patterns when confirmed enough times', () => {
    const analyses = [
      { decisions: [], pitfalls: [], patterns: ['This approach works well for auth modules.'], editedFiles: {}, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
      { decisions: [], pitfalls: [], patterns: ['This approach works well for auth modules.'], editedFiles: {}, features: new Set(), date: '2026-04-02T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    const patterns = result.newEntries.filter(e => e.category === 'pattern');
    assert.strictEqual(patterns.length, 1);
    assert.strictEqual(patterns[0].metadata.confirmations, 2);
  });

  it('marks stale annotations for removal', () => {
    const existing = [
      { category: 'hotspot', file: '/old/file.js', content: 'old hotspot', pinned: false, lastEditSession: 6 },
    ];
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: {}, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses, { existingAnnotations: existing });
    assert.strictEqual(result.staleEntries.length, 1);
    assert.strictEqual(result.staleEntries[0].file, '/old/file.js');
  });

  it('does not mark pinned annotations as stale', () => {
    const existing = [
      { category: 'pitfall', file: '/critical/auth.js', content: 'never forget', pinned: true, lastEditSession: 10 },
    ];
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: {}, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses, { existingAnnotations: existing });
    assert.strictEqual(result.staleEntries.length, 0);
  });

  it('does not mark stale if file was recently edited', () => {
    const existing = [
      { category: 'hotspot', file: '/src/auth.js', content: 'hotspot', pinned: false, lastEditSession: 6 },
    ];
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/src/auth.js': 1 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses, { existingAnnotations: existing });
    assert.strictEqual(result.staleEntries.length, 0);
  });

  it('returns stats', () => {
    const analyses = [
      { decisions: ['decided X.'], pitfalls: [], patterns: [], editedFiles: { '/a.js': 1 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/a.js': 1 }, features: new Set(), date: '2026-04-02T00:00:00Z', branch: 'main' },
    ];
    const result = accumulate(analyses);
    assert.strictEqual(result.stats.sessionsAnalyzed, 2);
    assert.strictEqual(result.stats.decisions, 1);
    assert.strictEqual(result.stats.hotspots, 1);
    assert.ok(result.stats.total >= 2);
  });

  it('allows custom thresholds', () => {
    const analyses = [
      { decisions: [], pitfalls: [], patterns: [], editedFiles: { '/a.js': 1 }, features: new Set(), date: '2026-04-01T00:00:00Z', branch: 'main' },
    ];
    // With minHotspotSessions: 1, even 1 session qualifies
    const result = accumulate(analyses, { minHotspotSessions: 1 });
    assert.strictEqual(result.newEntries.filter(e => e.category === 'hotspot').length, 1);
  });
});

// --- formatAnnotation ---

describe('formatAnnotation', () => {
  it('formats hotspot annotation', () => {
    const entry = {
      category: 'hotspot',
      file: '/src/auth.js',
      content: 'Frequently modified',
      metadata: { sessions: 3, edits: 8, since: '2026-03-15', pinned: false, source: '2026-04-01T10:00:00Z' },
    };
    const result = formatAnnotation(entry);
    assert.ok(result.startsWith('@cap-history'));
    assert.ok(result.includes('sessions:3'));
    assert.ok(result.includes('edits:8'));
    assert.ok(result.includes('since:2026-03-15'));
  });

  it('formats decision annotation', () => {
    const entry = {
      category: 'decision',
      file: '/src/auth.js',
      content: 'Use token refresh',
      metadata: { pinned: false, source: '2026-04-01T10:00:00Z' },
    };
    const result = formatAnnotation(entry);
    assert.ok(result.startsWith('@cap-decision'));
    assert.ok(result.includes('learned:2026-04-01'));
  });

  it('formats pitfall annotation with pinned', () => {
    const entry = {
      category: 'pitfall',
      file: '/src/auth.js',
      content: 'Token expiry causes silent failure',
      metadata: { pinned: true, source: '2026-04-01T10:00:00Z' },
    };
    const result = formatAnnotation(entry);
    assert.ok(result.startsWith('@cap-pitfall'));
    assert.ok(result.includes('pinned:true'));
  });

  it('formats pattern annotation with confirmations', () => {
    const entry = {
      category: 'pattern',
      file: '/tests/auth.test.js',
      content: 'Integration tests over mocks',
      metadata: { pinned: false, confirmations: 3, source: '2026-04-01T10:00:00Z' },
    };
    const result = formatAnnotation(entry);
    assert.ok(result.startsWith('@cap-pattern'));
    assert.ok(result.includes('confirmed:3'));
  });
});

// --- accumulateFromFiles ---

describe('accumulateFromFiles', () => {
  it('reads JSONL files and accumulates', () => {
    const fp1 = makeSessionFile('s1.jsonl', [
      { sessionId: 's1', timestamp: '2026-03-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'fix auth' } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'I decided to refactor auth. The root cause is expired tokens.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'a', new_string: 'b' } },
      ] } },
    ]);
    const fp2 = makeSessionFile('s2.jsonl', [
      { sessionId: 's2', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'Continuing work.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'x', new_string: 'y' } },
      ] } },
    ]);

    const result = accumulateFromFiles([{ path: fp1 }, { path: fp2 }]);
    assert.ok(result.stats.sessionsAnalyzed === 2);
    assert.ok(result.stats.hotspots >= 1); // auth.js edited in 2 sessions
    assert.ok(result.stats.decisions >= 1);
  });

  it('handles unreadable files gracefully', () => {
    const result = accumulateFromFiles([{ path: '/nonexistent/file.jsonl' }]);
    assert.strictEqual(result.stats.sessionsAnalyzed, 0);
  });

  it('marks debug sessions for pitfall detection', () => {
    const fp = makeSessionFile('debug.jsonl', [
      { sessionId: 'd1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'assistant', message: { content: 'The bug was a subtle regression caused by broken cache invalidation.' } },
    ]);

    const result = accumulateFromFiles([{ path: fp, isDebugSession: true }]);
    assert.ok(result.stats.pitfalls >= 1);
  });
});
