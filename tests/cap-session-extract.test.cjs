'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  run,
  parseSession,
  extractTextContent,
  extractToolUses,
  formatSize,
  formatDate,
  getHelp,
  extractStats,
  extractConversation,
  extractCode,
  extractSummary,
  extractDecisionsAll,
  extractHotspots,
  extractTimeline,
  extractCost,
  resolveSessionRef,
  getSessionFiles,
  filterBySince,
  parseSinceFlag,
  listSessions,
} = require('../cap/bin/lib/cap-session-extract.cjs');

// --- Test Helpers ---

let tmpDir;
let projectDir;

function makeSessionFile(name, lines) {
  const fp = path.join(projectDir, name);
  fs.writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n'));
  return fp;
}

function makeSampleSession(name = 'abc-def.jsonl') {
  return makeSessionFile(name, [
    { sessionId: 'abc-def', version: '1.0', gitBranch: 'main', timestamp: '2026-04-01T10:00:00Z' },
    { type: 'user', message: { content: 'Fix the login bug' }, timestamp: '2026-04-01T10:01:00Z' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'I decided to use a token-based approach. The root cause is the expired session cookie.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'old', new_string: 'new' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/src/login.js', content: 'module.exports = {};\n// new file' } },
        ],
        usage: { input_tokens: 500, output_tokens: 200 },
      },
      timestamp: '2026-04-01T10:02:00Z',
    },
    { type: 'user', message: { content: 'Now add tests for F-001' }, timestamp: '2026-04-01T10:03:00Z' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Done. The solution works correctly.' },
          { type: 'tool_use', name: 'Write', input: { file_path: '/tests/auth.test.js', content: 'test("auth", () => {})' } },
        ],
        usage: { input_tokens: 300, output_tokens: 150 },
      },
      timestamp: '2026-04-01T10:05:00Z',
    },
  ]);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-extract-'));
  projectDir = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Unit Tests ---

describe('formatSize', () => {
  it('formats bytes', () => {
    assert.strictEqual(formatSize(500), '500B');
  });

  it('formats kilobytes', () => {
    assert.strictEqual(formatSize(2048), '2KB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(formatSize(1572864), '1.5MB');
  });
});

describe('formatDate', () => {
  it('formats ISO timestamp', () => {
    assert.strictEqual(formatDate('2026-04-01T10:30:00Z'), '2026-04-01 10:30');
  });

  it('returns unknown for null', () => {
    assert.strictEqual(formatDate(null), 'unknown');
  });
});

describe('extractTextContent', () => {
  it('extracts string content', () => {
    assert.strictEqual(extractTextContent({ message: { content: 'hello' } }), 'hello');
  });

  it('extracts array content', () => {
    const msg = { message: { content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] } };
    assert.strictEqual(extractTextContent(msg), 'line1\nline2');
  });

  it('filters non-text blocks', () => {
    const msg = { message: { content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', name: 'Read' }] } };
    assert.strictEqual(extractTextContent(msg), 'hello');
  });

  it('returns empty for missing content', () => {
    assert.strictEqual(extractTextContent({}), '');
  });
});

describe('extractToolUses', () => {
  it('extracts tool_use blocks', () => {
    const msg = {
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/a.js' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/b.js', content: '...' } },
        ],
      },
    };
    const tools = extractToolUses(msg);
    assert.strictEqual(tools.length, 2);
    assert.strictEqual(tools[0].tool, 'Edit');
    assert.strictEqual(tools[1].tool, 'Write');
  });

  it('returns empty for non-array content', () => {
    assert.deepStrictEqual(extractToolUses({ message: { content: 'text' } }), []);
  });
});

describe('parseSession', () => {
  it('parses JSONL into meta and messages', () => {
    const fp = makeSampleSession();
    const { meta, messages } = parseSession(fp);
    assert.strictEqual(meta.id, 'abc-def');
    assert.strictEqual(meta.branch, 'main');
    assert.strictEqual(messages.length, 4); // 2 user + 2 assistant
  });

  it('handles malformed lines gracefully', () => {
    const fp = path.join(projectDir, 'bad.jsonl');
    fs.writeFileSync(fp, '{"sessionId":"x"}\nnot json\n{"type":"user","message":{"content":"hi"}}');
    const { messages } = parseSession(fp);
    assert.strictEqual(messages.length, 1);
  });
});

describe('getHelp', () => {
  it('returns usage text', () => {
    const help = getHelp();
    assert.ok(help.includes('cap extract'));
    assert.ok(help.includes('list'));
    assert.ok(help.includes('conversation'));
    assert.ok(help.includes('summary'));
  });
});

// --- Integration Tests: Extract Modes ---

describe('listSessions', () => {
  it('lists sessions in a project directory', () => {
    makeSampleSession('session1.jsonl');
    makeSampleSession('session2.jsonl');
    const output = listSessions(projectDir);
    assert.ok(output.includes('# Sessions'));
    assert.ok(output.includes('2 sessions total'));
  });

  it('handles empty directory', () => {
    const output = listSessions(projectDir);
    assert.ok(output.includes('0 sessions total'));
  });
});

describe('extractStats', () => {
  it('extracts session statistics', () => {
    const fp = makeSampleSession();
    const output = extractStats(fp);
    assert.ok(output.includes('# Session Stats'));
    assert.ok(output.includes('User turns'));
    assert.ok(output.includes('2')); // 2 user turns
    assert.ok(output.includes('Tool Usage'));
    assert.ok(output.includes('Edit'));
    assert.ok(output.includes('Write'));
  });

  it('calculates duration', () => {
    const fp = makeSampleSession();
    const output = extractStats(fp);
    assert.ok(output.includes('Duration'));
    assert.ok(output.includes('5m')); // 10:00 to 10:05
  });

  it('shows token counts', () => {
    const fp = makeSampleSession();
    const output = extractStats(fp);
    assert.ok(output.includes('Input tokens'));
    assert.ok(output.includes('Output tokens'));
  });
});

describe('extractConversation', () => {
  it('extracts user/assistant dialogue', () => {
    const fp = makeSampleSession();
    const output = extractConversation(fp);
    assert.ok(output.includes('# Session Conversation'));
    assert.ok(output.includes('Turn 1'));
    assert.ok(output.includes('Fix the login bug'));
    assert.ok(output.includes('Turn 2'));
    assert.ok(output.includes('add tests'));
  });

  it('skips sidechain messages', () => {
    const fp = makeSessionFile('side.jsonl', [
      { sessionId: 's1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'hello' } },
      { type: 'assistant', message: { content: 'response' }, isSidechain: true },
      { type: 'assistant', message: { content: 'main response' } },
    ]);
    const output = extractConversation(fp);
    assert.ok(output.includes('main response'));
    assert.ok(!output.includes('response\n\nmain')); // sidechain not included separately
  });
});

describe('extractCode', () => {
  it('extracts code changes grouped by file', () => {
    const fp = makeSampleSession();
    const output = extractCode(fp);
    assert.ok(output.includes('# Session Code Changes'));
    assert.ok(output.includes('/src/auth.js'));
    assert.ok(output.includes('/src/login.js'));
    assert.ok(output.includes('/tests/auth.test.js'));
    assert.ok(output.includes('3 files'));
  });

  it('reports no changes for conversation-only session', () => {
    const fp = makeSessionFile('nocode.jsonl', [
      { sessionId: 's1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'explain X' } },
      { type: 'assistant', message: { content: 'X means...' } },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('No code changes'));
  });
});

describe('extractSummary', () => {
  it('extracts structured summary', () => {
    const fp = makeSampleSession();
    const output = extractSummary(fp);
    assert.ok(output.includes('# Session Summary'));
    assert.ok(output.includes('## Overview'));
    assert.ok(output.includes('## Files Changed'));
    assert.ok(output.includes('/src/auth.js'));
  });

  it('detects feature references', () => {
    const fp = makeSessionFile('feat.jsonl', [
      { sessionId: 's1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'work on F-001' } },
      { type: 'assistant', message: { content: 'Working on F-001 and F-002 now.' } },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('F-001'));
    assert.ok(output.includes('F-002'));
  });

  it('extracts decisions', () => {
    const fp = makeSampleSession();
    const output = extractSummary(fp);
    assert.ok(output.includes('## Decisions'));
    assert.ok(output.includes('root cause'));
  });
});

describe('resolveSessionRef', () => {
  it('resolves by numeric index', () => {
    makeSampleSession('s1.jsonl');
    const fp = resolveSessionRef(projectDir, '1');
    assert.ok(fp.endsWith('s1.jsonl'));
  });

  it('throws for out-of-range index', () => {
    makeSampleSession('s1.jsonl');
    assert.throws(() => resolveSessionRef(projectDir, '5'), /not found/);
  });

  it('resolves by date', () => {
    makeSampleSession('s1.jsonl');
    const fp = resolveSessionRef(projectDir, '2026-04-01');
    assert.ok(fp.endsWith('s1.jsonl'));
  });

  it('throws for invalid ref', () => {
    makeSampleSession('s1.jsonl');
    assert.throws(() => resolveSessionRef(projectDir, 'garbage'), /Invalid session reference/);
  });
});

describe('run', () => {
  it('returns help for help command', () => {
    const output = run(['help']);
    assert.ok(output.includes('cap extract'));
  });

  it('throws for unknown directory', () => {
    assert.throws(() => run(['list'], '/nonexistent/path/that/does/not/exist'), /No Claude Code sessions/);
  });

  it('help includes cross-session commands', () => {
    const output = run(['help']);
    assert.ok(output.includes('decisions'));
    assert.ok(output.includes('hotspots'));
    assert.ok(output.includes('timeline'));
    assert.ok(output.includes('cost'));
    assert.ok(output.includes('--since'));
  });
});

// --- F-026: Cross-Session Aggregation ---

describe('parseSinceFlag', () => {
  it('extracts --since date and returns clean args', () => {
    const { sinceDate, cleanArgs } = parseSinceFlag(['decisions', '--since', '2026-03-01']);
    assert.strictEqual(sinceDate, '2026-03-01');
    assert.deepStrictEqual(cleanArgs, ['decisions']);
  });

  it('returns null sinceDate when no --since flag', () => {
    const { sinceDate, cleanArgs } = parseSinceFlag(['hotspots']);
    assert.strictEqual(sinceDate, null);
    assert.deepStrictEqual(cleanArgs, ['hotspots']);
  });

  it('handles --since at end without value', () => {
    const { sinceDate } = parseSinceFlag(['decisions', '--since']);
    assert.strictEqual(sinceDate, null);
  });
});

describe('filterBySince', () => {
  it('filters files by date', () => {
    const files = [
      { file: 'a.jsonl', date: '2026-04-01T10:00:00Z' },
      { file: 'b.jsonl', date: '2026-03-15T10:00:00Z' },
      { file: 'c.jsonl', date: '2026-02-01T10:00:00Z' },
    ];
    const filtered = filterBySince(files, '2026-03-01');
    assert.strictEqual(filtered.length, 2);
  });

  it('returns all when sinceDate is null', () => {
    const files = [{ file: 'a.jsonl', date: '2026-01-01T00:00:00Z' }];
    assert.strictEqual(filterBySince(files, null).length, 1);
  });
});

function makeMultiSessionFixture() {
  // Session 1: older, has decisions and edits
  makeSessionFile('session-old.jsonl', [
    { sessionId: 's-old', timestamp: '2026-03-01T09:00:00Z', gitBranch: 'feature-a' },
    { type: 'user', message: { content: 'Fix the auth bug' }, timestamp: '2026-03-01T09:01:00Z' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'I decided to refactor the auth module. The root cause is expired tokens.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'old', new_string: 'new' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'x', new_string: 'y' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/src/utils.js', content: '...' } },
        ],
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
      timestamp: '2026-03-01T09:30:00Z',
    },
  ]);

  // Session 2: newer, has edits to same file + new files
  makeSessionFile('session-new.jsonl', [
    { sessionId: 's-new', timestamp: '2026-04-01T14:00:00Z', gitBranch: 'main' },
    { type: 'user', message: { content: 'Add F-001 tests' }, timestamp: '2026-04-01T14:01:00Z' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Working on F-001. The approach is to use integration tests.' },
          { type: 'tool_use', name: 'Write', input: { file_path: '/tests/auth.test.js', content: 'test(...)' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/src/auth.js', old_string: 'a', new_string: 'b' } },
        ],
        usage: { input_tokens: 2000, output_tokens: 800 },
      },
      timestamp: '2026-04-01T14:30:00Z',
    },
  ]);
}

describe('extractDecisionsAll', () => {
  it('aggregates decisions across sessions', () => {
    makeMultiSessionFixture();
    const output = extractDecisionsAll(projectDir, null);
    assert.ok(output.includes('# Decisions Across Sessions'));
    assert.ok(output.includes('Sessions scanned: 2'));
    assert.ok(output.includes('root cause'));
  });

  it('respects --since filter', () => {
    makeMultiSessionFixture();
    const output = extractDecisionsAll(projectDir, '2026-03-15');
    assert.ok(output.includes('Sessions scanned: 1'));
    assert.ok(!output.includes('root cause')); // old session filtered out
  });

  it('handles no decisions', () => {
    makeSessionFile('empty.jsonl', [
      { sessionId: 's1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: 'hello' } },
    ]);
    const output = extractDecisionsAll(projectDir, null);
    assert.ok(output.includes('No decisions found'));
  });
});

describe('extractHotspots', () => {
  it('ranks files by edit frequency', () => {
    makeMultiSessionFixture();
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('# File Hotspots'));
    assert.ok(output.includes('/src/auth.js'));
    // auth.js has 3 edits across 2 sessions — should be rank 1
    assert.ok(output.includes('| 1 |'));
  });

  it('shows sessions count per file', () => {
    makeMultiSessionFixture();
    const output = extractHotspots(projectDir, null);
    // /src/auth.js edited in 2 sessions
    assert.ok(output.match(/auth\.js.*2/));
  });

  it('handles no edits', () => {
    makeSessionFile('noedits.jsonl', [
      { sessionId: 's1', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'explain X' } },
      { type: 'assistant', message: { content: 'X is...' } },
    ]);
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('No file edits found'));
  });
});

describe('extractTimeline', () => {
  it('shows chronological session overview', () => {
    makeMultiSessionFixture();
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('# Session Timeline'));
    assert.ok(output.includes('Sessions: 2'));
    assert.ok(output.includes('feature-a'));
    assert.ok(output.includes('main'));
  });

  it('shows features referenced', () => {
    makeMultiSessionFixture();
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('F-001'));
  });

  it('shows files changed count', () => {
    makeMultiSessionFixture();
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('Files changed:'));
  });

  it('respects --since filter', () => {
    makeMultiSessionFixture();
    const output = extractTimeline(projectDir, '2026-03-15');
    assert.ok(output.includes('Sessions: 1'));
    assert.ok(!output.includes('feature-a'));
  });
});

describe('extractCost', () => {
  it('aggregates token costs across sessions', () => {
    makeMultiSessionFixture();
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('# Token Cost Report'));
    assert.ok(output.includes('## Totals'));
    assert.ok(output.includes('Estimated cost'));
  });

  it('shows per-session breakdown', () => {
    makeMultiSessionFixture();
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('## Per Session'));
    assert.ok(output.includes('| 1 |'));
    assert.ok(output.includes('| 2 |'));
  });

  it('calculates total tokens', () => {
    makeMultiSessionFixture();
    const output = extractCost(projectDir, null);
    // Total: 1000+2000 input = 3000, 500+800 output = 1300
    assert.ok(output.includes('Total tokens'));
  });

  it('respects --since filter', () => {
    makeMultiSessionFixture();
    const output = extractCost(projectDir, '2026-03-15');
    assert.ok(output.includes('Sessions: 1'));
  });
});
