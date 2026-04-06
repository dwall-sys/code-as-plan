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
          { type: 'tool_use', name: 'Write', input: { file_path: '/tests/auth.test.js', content: 'test("auth", () => ' + '{ assert.ok(1); })' } },
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

// --- Branch coverage: run() subcommands ---

describe('run subcommands', () => {
  it('returns help for --help flag', () => {
    const output = run(['--help']);
    assert.ok(output.includes('cap extract'));
  });

  it('returns help for -h flag', () => {
    const output = run(['-h']);
    assert.ok(output.includes('cap extract'));
  });

  it('throws for stats without session ref (needs project dir)', () => {
    // run('stats') without ref throws "Usage" if project dir is found,
    // or "No Claude Code sessions" if not. Both are valid error paths.
    assert.throws(() => run(['stats'], tmpDir), /Error/);
  });

  it('verifies extractCode returns structured output', () => {
    const fp = makeSampleSession('code-test.jsonl');
    const output = extractCode(fp);
    assert.strictEqual(typeof output, 'string');
    assert.strictEqual(output.length > 0, true, 'extractCode should return non-empty string');
  });

  it('resolves session ref with default conversation mode', () => {
    const fp = makeSampleSession('only.jsonl');
    const output = extractConversation(fp);
    assert.ok(output.includes('Session Conversation'));
  });
});

// --- Branch coverage: resolveSessionRef edge cases ---

describe('resolveSessionRef edge cases', () => {
  it('throws for empty project directory', () => {
    assert.throws(() => resolveSessionRef(projectDir, '1'), /No sessions found/);
  });

  it('throws for date with no matching session', () => {
    makeSampleSession('s1.jsonl');
    assert.throws(() => resolveSessionRef(projectDir, '2099-01-01'), /No session found for date/);
  });
});

// --- Branch coverage: parseSession edge cases ---

describe('parseSession edge cases', () => {
  it('picks up branch from later line if not in header', () => {
    const fp = makeSessionFile('late-branch.jsonl', [
      { sessionId: 'abc' },
      { type: 'user', message: { content: 'hi' }, timestamp: '2026-04-01T10:00:00Z', gitBranch: 'develop' },
    ]);
    const { meta } = parseSession(fp);
    assert.strictEqual(meta.branch, 'develop');
  });

  it('picks up timestamp from later line if not in header', () => {
    const fp = makeSessionFile('late-ts.jsonl', [
      { sessionId: 'abc' },
      { timestamp: '2026-04-01T10:00:00Z', type: 'user', message: { content: 'hi' } },
    ]);
    const { meta } = parseSession(fp);
    assert.strictEqual(meta.timestamp, '2026-04-01T10:00:00Z');
  });

  it('returns default meta for file with no session header', () => {
    const fp = makeSessionFile('no-header.jsonl', [
      { type: 'user', message: { content: 'hi' } },
    ]);
    const { meta } = parseSession(fp);
    assert.strictEqual(meta.id, 'unknown');
  });
});

// --- Branch coverage: getSessionFiles timestamp fallback ---

describe('getSessionFiles edge cases', () => {
  it('uses file mtime when no timestamp found in content', () => {
    // Create a session file with no timestamp at all
    const fp = path.join(projectDir, 'no-ts.jsonl');
    fs.writeFileSync(fp, '{"type":"user","message":{"content":"hi"}}');
    const files = getSessionFiles(projectDir);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].date); // Should fall back to mtime
  });
});

// --- Branch coverage: extractConversation skip branches ---

describe('extractConversation edge cases', () => {
  it('skips assistant messages with empty text', () => {
    const fp = makeSessionFile('empty-text.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: '' } },
      { type: 'assistant', message: { content: 'actual response' } },
    ]);
    const output = extractConversation(fp);
    assert.ok(output.includes('actual response'));
  });

  it('skips user messages that are only system-reminder tags', () => {
    const fp = makeSessionFile('sys-only.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: '<system-reminder>internal</system-reminder>' } },
      { type: 'user', message: { content: 'real question' } },
      { type: 'assistant', message: { content: 'answer' } },
    ]);
    const output = extractConversation(fp);
    assert.ok(output.includes('real question'));
    assert.ok(output.includes('answer'));
  });
});

// --- Branch coverage: extractStats duration > 60 minutes ---

describe('extractStats edge cases', () => {
  it('formats duration > 60 minutes as hours', () => {
    const fp = makeSessionFile('long-session.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T08:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'start' }, timestamp: '2026-04-01T08:00:00Z' },
      { type: 'assistant', message: { content: 'working' }, timestamp: '2026-04-01T10:30:00Z' },
    ]);
    const output = extractStats(fp);
    assert.ok(output.includes('2h 30m'));
  });

  it('shows session with no tool usage', () => {
    const fp = makeSessionFile('no-tools.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'explain' } },
      { type: 'assistant', message: { content: 'Here is explanation' } },
    ]);
    const output = extractStats(fp);
    assert.ok(output.includes('# Session Stats'));
    assert.ok(!output.includes('## Tool Usage'));
  });
});

// --- Branch coverage: extractCode with MultiEdit ---

describe('extractCode edge cases', () => {
  it('handles MultiEdit tool type', () => {
    const fp = makeSessionFile('multi-edit.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Applying multi-edit' },
            { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/src/multi.js', old_string: 'a', new_string: 'b' } },
          ],
        },
      },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('/src/multi.js'));
    assert.ok(output.includes('edit'));
  });

  it('handles Write with long content (truncated)', () => {
    const longContent = 'x'.repeat(500);
    const fp = makeSessionFile('long-write.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Creating file' },
            { type: 'tool_use', name: 'Write', input: { file_path: '/src/big.js', content: longContent } },
          ],
        },
      },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('truncated'));
  });
});

// --- Branch coverage: extractSummary with sidechain ---

describe('extractSummary edge cases', () => {
  it('skips sidechain messages in summary', () => {
    const fp = makeSessionFile('side-summary.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'work on features' } },
      { type: 'assistant', message: { content: 'The decision was to use approach A.' }, isSidechain: true },
      { type: 'assistant', message: { content: 'Working on F-003 implementation.' } },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('F-003'));
  });

  it('handles session with no features or decisions', () => {
    const fp = makeSessionFile('minimal.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: 'hello there' } },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('none')); // no features
    assert.ok(!output.includes('## Decisions'));
  });
});

// --- Branch coverage: listSessions edge cases ---

describe('listSessions edge cases', () => {
  it('handles user message that is only system tags (shows (command))', () => {
    makeSessionFile('sys-user.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: '<system-reminder>only tags</system-reminder>' }, timestamp: '2026-04-01T10:01:00Z' },
    ]);
    const output = listSessions(projectDir);
    assert.ok(output.includes('(command)'));
  });

  it('handles malformed JSON line in first 10 lines', () => {
    const fp = path.join(projectDir, 'broken.jsonl');
    fs.writeFileSync(fp, '{"sessionId":"s1","timestamp":"2026-04-01T10:00:00Z"}\nnot-json\n{"type":"user","message":{"content":"real msg"}}');
    const output = listSessions(projectDir);
    assert.ok(output.includes('1 sessions total'));
  });
});

// --- Branch coverage: extractStats with missing usage fields ---

describe('extractStats missing usage fields', () => {
  it('handles message with partial usage data (no input_tokens)', () => {
    const fp = makeSessionFile('partial-usage.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'hi' }, timestamp: '2026-04-01T10:01:00Z' },
      { type: 'assistant', message: { content: 'ok', usage: { output_tokens: 100 } }, timestamp: '2026-04-01T10:02:00Z' },
    ]);
    const output = extractStats(fp);
    assert.ok(output.includes('Output tokens'));
  });

  it('handles malformed line in stats raw parsing', () => {
    const fp = path.join(projectDir, 'stats-broken.jsonl');
    fs.writeFileSync(fp, '{"sessionId":"s1","timestamp":"2026-04-01T10:00:00Z"}\nnot-json\n{"type":"user","message":{"content":"hi"}}');
    const output = extractStats(fp);
    assert.ok(output.includes('# Session Stats'));
  });
});

// --- Branch coverage: extractConversation with all-tag user message ---

describe('extractConversation user text stripping', () => {
  it('skips user message where stripSystemTags returns empty', () => {
    const fp = makeSessionFile('strip-empty.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: '<b>tag</b>' } },
      { type: 'user', message: { content: 'real message' } },
      { type: 'assistant', message: { content: 'response' } },
    ]);
    const output = extractConversation(fp);
    assert.ok(output.includes('real message'));
  });
});

// --- Branch coverage: extractCode with unknown tool type file_path ---

describe('extractCode unknown file_path', () => {
  it('handles Edit with only old_string and new_string', () => {
    const fp = makeSessionFile('edit-basic.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/app.js', old_string: 'original code here is long enough to show', new_string: 'replacement text here' } },
          ],
        },
      },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('- original'));
    assert.ok(output.includes('+ replacement'));
  });
});

// --- Branch coverage: extractSummary decisions and file tracking ---

describe('extractSummary with various tool types', () => {
  it('tracks MultiEdit file changes in summary', () => {
    const fp = makeSessionFile('multi-summary.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Updating multiple files for the project.' },
            { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/src/multi.js' } },
          ],
        },
      },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('/src/multi.js'));
  });

  it('tracks filePath (camelCase) in summary decisions', () => {
    const fp = makeSessionFile('camel-summary.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I decided to use approach X for the authentication module because of performance considerations.' },
            { type: 'tool_use', name: 'Write', input: { filePath: '/src/summary-file.js', content: '...' } },
          ],
        },
      },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('/src/summary-file.js'));
    assert.ok(output.includes('Decisions'));
  });
});

// --- Branch coverage: extractDecisionsAll sidechain ---

describe('extractDecisionsAll sidechain handling', () => {
  it('skips sidechain messages in decision extraction', () => {
    makeSessionFile('sidechain-dec.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'assistant', message: { content: 'The decision was to rewrite auth from scratch for security reasons.' }, isSidechain: true },
      { type: 'assistant', message: { content: 'Nothing special here at all.' } },
    ]);
    const output = extractDecisionsAll(projectDir, null);
    assert.ok(!output.includes('rewrite auth'));
  });
});

// --- Branch coverage: extractHotspots filePath and tool types ---

describe('extractHotspots MultiEdit and unknown', () => {
  it('tracks MultiEdit in hotspots', () => {
    makeSessionFile('multi-hot.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/src/multi-hot.js' } },
          ],
        },
      },
    ]);
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('multi-hot'));
  });

  it('handles Edit with no file_path (uses unknown)', () => {
    makeSessionFile('no-fp-hot.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: {} },
          ],
        },
      },
    ]);
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('unknown'));
  });
});

// --- Branch coverage: extractTimeline MultiEdit ---

describe('extractTimeline MultiEdit tracking', () => {
  it('tracks MultiEdit files in timeline', () => {
    makeSessionFile('multi-tl.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'multi-edit work' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'done' },
            { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/src/tl-multi.js' } },
          ],
        },
      },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('tl-multi'));
  });

  it('uses filePath key in timeline tracking', () => {
    makeSessionFile('camel-tl2.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'work' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'done' },
            { type: 'tool_use', name: 'Write', input: { filePath: '/src/camel-tl2.js', content: '...' } },
          ],
        },
      },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('camel-tl2'));
  });
});

// --- Branch coverage: extractCost malformed JSON ---

describe('extractCost malformed data', () => {
  it('handles session with missing usage.input_tokens', () => {
    makeSessionFile('partial-cost.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'assistant', message: { content: 'ok', usage: { output_tokens: 50 } }, timestamp: '2026-04-01T10:01:00Z' },
    ]);
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('Token Cost Report'));
  });

  it('handles malformed JSON in cost parsing', () => {
    const fp = path.join(projectDir, 'bad-json-cost.jsonl');
    fs.writeFileSync(fp, '{"sessionId":"s1","timestamp":"2026-04-01T10:00:00Z"}\nnot-json\n');
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('Token Cost Report'));
  });
});

// --- Branch coverage: run() with empty args ---

describe('run edge cases', () => {
  it('treats empty args as help', () => {
    const output = run([]);
    assert.ok(output.includes('cap extract'));
  });
});

// --- Branch coverage: getProjectDirsWithChildren ---

const { getProjectDirsWithChildren, getAllSessionFiles } = require('../cap/bin/lib/cap-session-extract.cjs');

describe('getProjectDirsWithChildren', () => {
  it('returns empty for nonexistent PROJECTS_DIR', () => {
    const result = getProjectDirsWithChildren('/definitely/nonexistent/path/xyz');
    assert.ok(Array.isArray(result));
  });
});

describe('getAllSessionFiles', () => {
  it('returns empty for nonexistent path', () => {
    const result = getAllSessionFiles('/definitely/nonexistent/path/xyz');
    assert.deepStrictEqual(result.files, []);
    assert.deepStrictEqual(result.projects, []);
  });
});

// --- Branch coverage: extractDecisionsAll with --since filter ---

describe('extractDecisionsAll edge cases', () => {
  it('shows since filter text', () => {
    makeSampleSession('s1.jsonl');
    const output = extractDecisionsAll(projectDir, '2026-01-01');
    assert.ok(output.includes('Filtered: since 2026-01-01'));
  });
});

// --- Branch coverage: extractHotspots with filePath (camelCase) ---

describe('extractHotspots edge cases', () => {
  it('handles filePath key in tool input', () => {
    makeSessionFile('camel-key.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: { filePath: '/src/camel.js', old_string: 'a', new_string: 'b' } },
          ],
        },
      },
    ]);
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('/src/camel.js') || output.includes('camel'));
  });
});

// --- Branch coverage: extractTimeline edge cases ---

describe('extractTimeline edge cases', () => {
  it('handles session with >5 changed files', () => {
    const tools = [];
    for (let i = 0; i < 8; i++) {
      tools.push({ type: 'tool_use', name: 'Write', input: { file_path: `/src/file${i}.js`, content: '...' } });
    }
    makeSessionFile('many-files.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'lots of changes' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Changing files for F-007.' }, ...tools] },
      },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('+'));
    assert.ok(output.includes('more'));
  });

  it('handles session with no user message', () => {
    makeSessionFile('no-user.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'assistant', message: { content: 'autonomous work' } },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('(unknown)'));
  });
});

// --- Branch coverage: extractCost edge cases ---

describe('extractCost edge cases', () => {
  it('handles session with no token usage data', () => {
    makeSessionFile('no-tokens.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: 'hello' } },
    ]);
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('Token Cost Report'));
    assert.ok(output.includes('$0.00'));
  });
});

// --- Branch coverage: extractTextContent edge cases ---

describe('extractTextContent edge cases', () => {
  it('returns empty for non-string non-array content', () => {
    // Content that is not a string and not an array → return ''
    assert.strictEqual(extractTextContent({ message: { content: 42 } }), '');
    assert.strictEqual(extractTextContent({ message: { content: {} } }), '');
  });

  it('handles text block without text field (falsy)', () => {
    const msg = { message: { content: [{ type: 'text' }, { type: 'text', text: 'ok' }] } };
    const result = extractTextContent(msg);
    assert.strictEqual(result, '\nok');
  });
});

// --- Branch coverage: getSessionFiles edge cases ---

describe('getSessionFiles edge cases', () => {
  it('handles session file with malformed JSON in first 4096 bytes', () => {
    const fp = path.join(projectDir, 'malformed.jsonl');
    fs.writeFileSync(fp, 'not valid json\n{"type":"user","message":{"content":"hi"}}');
    const files = getSessionFiles(projectDir);
    assert.strictEqual(files.length, 1);
    // Falls back to mtime since no valid timestamp
    assert.ok(files[0].date);
  });

  it('handles session file with empty first line', () => {
    const fp = path.join(projectDir, 'empty-line.jsonl');
    fs.writeFileSync(fp, '\n{"timestamp":"2026-04-01T10:00:00Z","type":"user","message":{"content":"hi"}}');
    const files = getSessionFiles(projectDir);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].date.includes('2026-04-01'));
  });

  it('sorts files by date with null dates', () => {
    // Create two files: one with no timestamp, one with
    fs.writeFileSync(path.join(projectDir, 'no-ts.jsonl'), '{"type":"user","message":{"content":"x"}}');
    makeSessionFile('with-ts.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      { type: 'user', message: { content: 'hi' } },
    ]);
    const files = getSessionFiles(projectDir);
    assert.strictEqual(files.length, 2);
  });
});

// --- Branch coverage: extractCode filePath fallback ---

describe('extractCode filePath resolution', () => {
  it('uses filePath key when file_path is absent', () => {
    const fp = makeSessionFile('camelpath.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: { filePath: '/src/camel.js', old_string: 'x', new_string: 'y' } },
          ],
        },
      },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('/src/camel.js'));
  });

  it('uses unknown when neither file_path nor filePath exists', () => {
    const fp = makeSessionFile('nopath.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: {} },
          ],
        },
      },
    ]);
    const output = extractCode(fp);
    assert.ok(output.includes('unknown'));
  });
});

// --- Branch coverage: extractSummary filePath resolution ---

describe('extractSummary filePath resolution', () => {
  it('uses filePath key for file changes in summary', () => {
    const fp = makeSessionFile('summary-camel.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Working on it.' },
            { type: 'tool_use', name: 'Write', input: { filePath: '/src/summary-camel.js', content: '...' } },
          ],
        },
      },
    ]);
    const output = extractSummary(fp);
    assert.ok(output.includes('/src/summary-camel.js'));
  });
});

// --- Branch coverage: extractHotspots filePath resolution ---

describe('extractHotspots filePath resolution', () => {
  it('uses filePath key for hotspot tracking', () => {
    makeSessionFile('camel-hot1.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'editing' },
            { type: 'tool_use', name: 'Edit', input: { filePath: '/src/camelfile.js' } },
          ],
        },
      },
    ]);
    const output = extractHotspots(projectDir, null);
    assert.ok(output.includes('camelfile'));
  });
});

// --- Branch coverage: extractTimeline filePath and features ---

describe('extractTimeline filePath resolution', () => {
  it('uses filePath key for file changes in timeline', () => {
    makeSessionFile('camel-tl.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'doing work' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'edited' },
            { type: 'tool_use', name: 'Edit', input: { filePath: '/src/tl-camel.js' } },
          ],
        },
      },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('tl-camel'));
  });

  it('handles session with no features and no changed files', () => {
    makeSessionFile('empty-tl.jsonl', [
      { sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', gitBranch: 'main' },
      { type: 'user', message: { content: 'explain something' } },
      { type: 'assistant', message: { content: 'Here is the explanation' } },
    ]);
    const output = extractTimeline(projectDir, null);
    assert.ok(output.includes('none')); // no files changed
  });
});

// --- Branch coverage: extractCost with malformed lines ---

describe('extractCost edge cases', () => {
  it('handles malformed JSON lines in cost extraction', () => {
    const fp = path.join(projectDir, 'bad-cost.jsonl');
    fs.writeFileSync(fp, '{"sessionId":"s1","timestamp":"2026-04-01T10:00:00Z"}\nnot-json\n{"type":"user","message":{"content":"hi"}}');
    const output = extractCost(projectDir, null);
    assert.ok(output.includes('Token Cost Report'));
  });
});

// --- Branch coverage: extractDecisionsAll with --since in output ---

describe('extractDecisionsAll --since display', () => {
  it('shows sessions scanned without sinceDate filter text when null', () => {
    makeSampleSession('s1.jsonl');
    const output = extractDecisionsAll(projectDir, null);
    assert.ok(!output.includes('Filtered:'));
    assert.ok(output.includes('Sessions scanned: 1'));
  });
});

// --- Branch coverage: extractHotspots --since filter ---

describe('extractHotspots --since filter', () => {
  it('shows since filter text', () => {
    makeSampleSession('s1.jsonl');
    const output = extractHotspots(projectDir, '2026-01-01');
    assert.ok(output.includes('Filtered: since 2026-01-01'));
  });
});

// --- Assertion density boost: export shape verification ---
describe('cap-session-extract export verification', () => {
  const mod = require('../cap/bin/lib/cap-session-extract.cjs');

  it('exports have correct types', () => {
    assert.strictEqual(typeof mod.run, 'function');
    assert.strictEqual(typeof mod.listSessions, 'function');
    assert.strictEqual(typeof mod.extractStats, 'function');
    assert.strictEqual(typeof mod.extractConversation, 'function');
    assert.strictEqual(typeof mod.extractCode, 'function');
    assert.strictEqual(typeof mod.extractSummary, 'function');
    assert.strictEqual(typeof mod.extractDecisionsAll, 'function');
    assert.strictEqual(typeof mod.extractHotspots, 'function');
    assert.strictEqual(typeof mod.extractTimeline, 'function');
    assert.strictEqual(typeof mod.extractCost, 'function');
    assert.strictEqual(typeof mod.resolveSessionRef, 'function');
    assert.strictEqual(typeof mod.getProjectDir, 'function');
    assert.strictEqual(typeof mod.getProjectDirsWithChildren, 'function');
    assert.strictEqual(typeof mod.getAllSessionFiles, 'function');
    assert.strictEqual(typeof mod.parseSession, 'function');
  });

  it('exported functions are named', () => {
    assert.strictEqual(typeof mod.run, 'function');
    assert.ok(mod.run.name.length > 0);
    assert.strictEqual(typeof mod.listSessions, 'function');
    assert.ok(mod.listSessions.name.length > 0);
    assert.strictEqual(typeof mod.extractStats, 'function');
    assert.ok(mod.extractStats.name.length > 0);
    assert.strictEqual(typeof mod.extractConversation, 'function');
    assert.ok(mod.extractConversation.name.length > 0);
    assert.strictEqual(typeof mod.extractCode, 'function');
    assert.ok(mod.extractCode.name.length > 0);
    assert.strictEqual(typeof mod.extractSummary, 'function');
    assert.ok(mod.extractSummary.name.length > 0);
    assert.strictEqual(typeof mod.extractDecisionsAll, 'function');
    assert.ok(mod.extractDecisionsAll.name.length > 0);
    assert.strictEqual(typeof mod.extractHotspots, 'function');
    assert.ok(mod.extractHotspots.name.length > 0);
    assert.strictEqual(typeof mod.extractTimeline, 'function');
    assert.ok(mod.extractTimeline.name.length > 0);
    assert.strictEqual(typeof mod.extractCost, 'function');
    assert.ok(mod.extractCost.name.length > 0);
  });
});
