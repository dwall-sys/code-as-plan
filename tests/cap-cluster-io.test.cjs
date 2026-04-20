'use strict';

// @cap-feature(feature:F-050) Tests for cap-cluster-io.cjs -- I/O layer with structured diagnostics.
// Targets ≥70% line coverage on the io module per F-050/AC-3.
// Verifies F-050/AC-2: each catch-block emits a structured diagnostic via cap-logger when CAP_DEBUG is set.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const io = require('../cap/bin/lib/cap-cluster-io.cjs');

let tmpDir;
let originalDebugEnv;
let originalConsoleWarn;
let captured;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-cluster-io-'));
  originalDebugEnv = process.env.CAP_DEBUG;
  captured = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDebugEnv === undefined) {
    delete process.env.CAP_DEBUG;
  } else {
    process.env.CAP_DEBUG = originalDebugEnv;
  }
});

// Patch console.warn from inside the test body (not beforeEach) — Node's test
// runner gives each test a distinct console, so assignments in beforeEach do
// not reach the test's console when running under --test-isolation=none.
function patchWarn() {
  originalConsoleWarn = console.warn;
  // eslint-disable-next-line no-console
  console.warn = (msg) => { captured.push(msg); };
  return () => {
    // eslint-disable-next-line no-console
    console.warn = originalConsoleWarn;
  };
}

// Helper: write a valid graph JSON to a project's .cap/memory directory
function writeGraph(root, data) {
  const dir = path.join(root, '.cap', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(data, null, 2), 'utf8');
}

// Helper: write a thread index + thread files
function writeThreads(root, threads) {
  const dir = path.join(root, '.cap', 'memory');
  const threadsDir = path.join(dir, 'threads');
  fs.mkdirSync(threadsDir, { recursive: true });
  const index = {
    threads: threads.map(t => ({ id: t.id, name: t.name, timestamp: t.timestamp })),
  };
  fs.writeFileSync(path.join(dir, 'thread-index.json'), JSON.stringify(index, null, 2), 'utf8');
  for (const t of threads) {
    fs.writeFileSync(path.join(threadsDir, `${t.id}.json`), JSON.stringify(t, null, 2), 'utf8');
  }
}

// =========================================================================
// _loadClusterData -- structure and recovery semantics
// =========================================================================

describe('_loadClusterData', () => {
  it('returns expected shape for empty project', () => {
    const data = io._loadClusterData(tmpDir);
    assert.ok(Array.isArray(data.clusters));
    assert.ok(Array.isArray(data.threads));
    assert.ok(Array.isArray(data.affinityResults));
    assert.ok(data.graph !== null && typeof data.graph === 'object');
  });

  it('survives corrupt graph.json (returns empty graph fallback)', () => {
    const dir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph.json'), '!!! not json !!!', 'utf8');
    const data = io._loadClusterData(tmpDir);
    assert.ok(data.graph !== null);
  });

  it('survives corrupt thread-index.json (returns empty threads)', () => {
    const dir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'thread-index.json'), 'definitely not json', 'utf8');
    const data = io._loadClusterData(tmpDir);
    assert.deepStrictEqual(data.threads, []);
  });

  it('skips threads listed in index whose files are missing on disk', () => {
    const dir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'thread-index.json'),
      JSON.stringify({ threads: [{ id: 'thr-ghost', name: 'Ghost', timestamp: '2026-01-01T00:00:00Z' }] }),
      'utf8'
    );
    const data = io._loadClusterData(tmpDir);
    assert.strictEqual(data.threads.length, 0);
  });

  it('loads threads when index and thread files exist', () => {
    writeThreads(tmpDir, [
      {
        id: 'thr-001',
        name: 'Auth',
        timestamp: '2026-04-01T00:00:00Z',
        keywords: ['auth', 'jwt'],
        problemStatement: 'p',
        solutionShape: 's',
        featureIds: ['F-001'],
        boundaryDecisions: [],
      },
      {
        id: 'thr-002',
        name: 'Session',
        timestamp: '2026-04-02T00:00:00Z',
        keywords: ['session', 'cookies'],
        problemStatement: 'p',
        solutionShape: 's',
        featureIds: ['F-002'],
        boundaryDecisions: [],
      },
    ]);
    const data = io._loadClusterData(tmpDir);
    assert.ok(data.threads.length >= 2);
  });

  it('produces some affinity / cluster output when threads exist (smoke)', () => {
    writeGraph(tmpDir, {
      version: '1.0',
      lastUpdated: '2026-04-01T00:00:00Z',
      nodes: {
        'node-thr-001': { type: 'thread', metadata: { threadId: 'thr-001' } },
        'node-thr-002': { type: 'thread', metadata: { threadId: 'thr-002' } },
      },
      edges: [],
    });
    writeThreads(tmpDir, [
      { id: 'thr-001', name: 'A', timestamp: '2026-04-01T00:00:00Z', keywords: ['x', 'y'], problemStatement: 'p', solutionShape: 's', featureIds: [], boundaryDecisions: [] },
      { id: 'thr-002', name: 'B', timestamp: '2026-04-02T00:00:00Z', keywords: ['x', 'z'], problemStatement: 'p', solutionShape: 's', featureIds: [], boundaryDecisions: [] },
    ]);
    const data = io._loadClusterData(tmpDir);
    assert.ok(Array.isArray(data.affinityResults));
    assert.ok(Array.isArray(data.clusters));
  });
});

// =========================================================================
// AC-2: structured diagnostics emit when CAP_DEBUG=1
// =========================================================================

describe('F-050 AC-2: structured diagnostics on catch blocks', () => {
  // The downstream loader modules (cap-memory-graph.loadGraph, cap-thread-tracker.loadIndex/loadThread,
  // cap-affinity-engine.computeAffinityBatch, cap-cluster-detect.runClusterDetection) all have their own
  // internal try/catches that swallow JSON-parse errors and return defaults. To genuinely verify that
  // _loadClusterData's catch blocks emit structured diagnostics when an underlying call DOES throw,
  // we monkey-patch the loader modules and force throws.

  /**
   * Install temporary throw on a module method via require.cache mutation.
   * Returns a restore function.
   */
  function patchModule(modulePath, fnName, replacement) {
    const mod = require(modulePath);
    const original = mod[fnName];
    mod[fnName] = replacement;
    return () => { mod[fnName] = original; };
  }

  const graphModPath = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-memory-graph.cjs');
  const threadModPath = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-thread-tracker.cjs');
  const affinityModPath = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-affinity-engine.cjs');
  const clusterModPath = path.resolve(__dirname, '..', 'cap', 'bin', 'lib', 'cap-cluster-detect.cjs');

  it('emits diagnostic when loadGraph throws (CAP_DEBUG=1)', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    const restore = patchModule(graphModPath, 'loadGraph', () => {
      const e = new Error('synthetic graph load failure');
      e.code = 'EGRAPHFAIL';
      throw e;
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const diag = captured.find(c => c.includes('loadClusterData.loadGraph'));
    assert.ok(diag, 'expected a loadGraph diagnostic');
    assert.ok(diag.includes('EGRAPHFAIL'));
    assert.ok(diag.includes('"recoveryAction"'));
    assert.ok(diag.includes('"file"'));
  });

  it('emits diagnostic when loadIndex throws (CAP_DEBUG=1)', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    const restore = patchModule(threadModPath, 'loadIndex', () => {
      throw new Error('synthetic index failure');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const diag = captured.find(c => c.includes('loadClusterData.loadIndex'));
    assert.ok(diag, 'expected a loadIndex diagnostic');
    assert.ok(diag.includes('"recoveryAction"'));
  });

  it('emits per-thread diagnostic when loadThread throws (CAP_DEBUG=1)', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    // Set up a real index that points to a thread, then force loadThread to throw
    const dir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'thread-index.json'),
      JSON.stringify({ threads: [{ id: 'thr-victim', timestamp: 'x' }] }),
      'utf8'
    );
    const restore = patchModule(threadModPath, 'loadThread', () => {
      throw new Error('synthetic thread load failure');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const diag = captured.find(c => c.includes('loadClusterData.loadThread'));
    assert.ok(diag, 'expected a loadThread diagnostic');
    assert.ok(diag.includes('thr-victim'));
    assert.ok(diag.includes('"recoveryAction"'));
  });

  it('emits diagnostic when computeAffinityBatch throws (CAP_DEBUG=1)', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    const restore = patchModule(affinityModPath, 'computeAffinityBatch', () => {
      throw new Error('synthetic affinity failure');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const diag = captured.find(c => c.includes('loadClusterData.computeAffinity'));
    assert.ok(diag, 'expected a computeAffinity diagnostic');
    assert.ok(diag.includes('"recoveryAction"'));
  });

  it('emits diagnostic when runClusterDetection throws (CAP_DEBUG=1)', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    const restore = patchModule(clusterModPath, 'runClusterDetection', () => {
      throw new Error('synthetic cluster failure');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const diag = captured.find(c => c.includes('loadClusterData.runClusterDetection'));
    assert.ok(diag, 'expected a runClusterDetection diagnostic');
    assert.ok(diag.includes('"recoveryAction"'));
  });

  it('does NOT emit diagnostics when CAP_DEBUG is unset (silent recovery preserved)', () => {
    const unpatch = patchWarn();
    delete process.env.CAP_DEBUG;
    const restore = patchModule(graphModPath, 'loadGraph', () => {
      throw new Error('synthetic, but should be silent');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }
    assert.strictEqual(captured.length, 0, 'no output expected when CAP_DEBUG is unset');
  });

  it('diagnostic payload is parseable JSON with op/errorType/recoveryAction', () => {
    const unpatch = patchWarn();
    process.env.CAP_DEBUG = '1';
    const restore = patchModule(graphModPath, 'loadGraph', () => {
      throw new Error('synthetic');
    });
    try {
      io._loadClusterData(tmpDir);
    } finally {
      restore();
      unpatch();
    }

    const line = captured.find(c => c.startsWith('[cap:debug]'));
    assert.ok(line);
    const json = line.replace(/^\[cap:debug\] /, '');
    const parsed = JSON.parse(json);
    assert.ok(parsed.op, 'payload.op must be set');
    assert.ok(parsed.errorType, 'payload.errorType must be set');
    assert.ok(parsed.recoveryAction, 'payload.recoveryAction must be set');
    assert.ok(parsed.errorMessage, 'payload.errorMessage must be set');
  });

  it('preserves silent-recovery semantics: graph fallback returns valid empty graph', () => {
    delete process.env.CAP_DEBUG;
    const restore = patchModule(graphModPath, 'loadGraph', () => {
      throw new Error('synthetic');
    });
    let data;
    try {
      data = io._loadClusterData(tmpDir);
    } finally {
      restore();
    }
    // Behavior unchanged: caller still gets a graph (the empty createGraph fallback)
    assert.ok(data.graph !== null && typeof data.graph === 'object');
  });
});

// =========================================================================
// loadAndFormat* convenience wrappers
// =========================================================================

describe('loadAndFormat wrappers', () => {
  it('loadAndFormatOverview returns a string for empty project', () => {
    const out = io.loadAndFormatOverview(tmpDir);
    assert.strictEqual(typeof out, 'string');
    assert.ok(out.length > 0);
  });

  it('loadAndFormatStatus returns a string for empty project', () => {
    const out = io.loadAndFormatStatus(tmpDir);
    assert.strictEqual(typeof out, 'string');
    assert.ok(out.includes('Neural Memory'));
  });

  it('loadAndFormatDetail returns "not found" for unknown label on empty project', () => {
    const out = io.loadAndFormatDetail(tmpDir, 'nope');
    assert.strictEqual(typeof out, 'string');
    assert.ok(out.includes('not found') || out.includes('No clusters'));
  });

  it('loadAndFormatDetail handles null clusterLabel input', () => {
    const out = io.loadAndFormatDetail(tmpDir, null);
    assert.strictEqual(typeof out, 'string');
  });

  it('loadAndFormatDetail lists "(none)" when no clusters available', () => {
    const out = io.loadAndFormatDetail(tmpDir, 'whatever');
    assert.ok(out.includes('Available clusters:'));
    assert.ok(out.includes('(none)'));
  });

  it('loadAndFormatOverview survives corrupt graph and thread index gracefully', () => {
    const dir = path.join(tmpDir, '.cap', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph.json'), 'X', 'utf8');
    fs.writeFileSync(path.join(dir, 'thread-index.json'), 'Y', 'utf8');
    const out = io.loadAndFormatOverview(tmpDir);
    assert.strictEqual(typeof out, 'string');
  });
});
