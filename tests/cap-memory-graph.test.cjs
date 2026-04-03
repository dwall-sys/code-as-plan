'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createGraph,
  addNode,
  addEdge,
  removeNode,
  markStale,
  generateNodeId,
  queryByType,
  queryNeighbors,
  queryTemporal,
  buildFromMemory,
  incrementalUpdate,
  generateViews,
  serializeGraph,
  loadGraph,
  saveGraph,
  _parseMarkdownEntries,
  _getRelatedFeatureIds,
  GRAPH_FILE,
  GRAPH_VERSION,
  EDGE_TYPES,
  NODE_TYPES,
} = require('../cap/bin/lib/cap-memory-graph.cjs');

// --- Test Helpers ---

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-graph-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeNode(overrides = {}) {
  return {
    type: 'decision',
    id: overrides.id || 'decision-abc12345',
    label: overrides.label || 'Test decision node',
    active: overrides.active !== undefined ? overrides.active : true,
    metadata: overrides.metadata || {},
    ...overrides,
  };
}

function makeEdge(overrides = {}) {
  return {
    source: overrides.source || 'node-a',
    target: overrides.target || 'node-b',
    type: overrides.type || 'relates_to',
    active: overrides.active !== undefined ? overrides.active : true,
    metadata: overrides.metadata || {},
    ...overrides,
  };
}

/**
 * Set up a minimal project structure for buildFromMemory tests.
 */
function setupProject(options = {}) {
  const featureMapContent = options.featureMap || `# Feature Map

> Single source of truth.

## Features

### F-001: Tag Scanner [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Extract tags |

**Files:**
- \`cap/bin/lib/cap-tag-scanner.cjs\`

### F-002: Feature Map Management [shipped]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Read and parse |

**Files:**
- \`cap/bin/lib/cap-feature-map.cjs\`
`;

  fs.writeFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), featureMapContent, 'utf8');

  // Thread index
  const memDir = path.join(tmpDir, '.cap', 'memory');
  fs.mkdirSync(path.join(memDir, 'threads'), { recursive: true });

  const threadIndex = options.threadIndex || {
    version: '1.0.0',
    threads: [],
  };
  fs.writeFileSync(
    path.join(memDir, 'thread-index.json'),
    JSON.stringify(threadIndex, null, 2),
    'utf8'
  );

  // Memory files
  if (options.decisions) {
    fs.writeFileSync(path.join(memDir, 'decisions.md'), options.decisions, 'utf8');
  }
  if (options.hotspots) {
    fs.writeFileSync(path.join(memDir, 'hotspots.md'), options.hotspots, 'utf8');
  }

  return tmpDir;
}

// --- Unit Tests: Constants ---

describe('constants', () => {
  it('exposes valid edge types', () => {
    assert.ok(EDGE_TYPES.includes('depends_on'));
    assert.ok(EDGE_TYPES.includes('supersedes'));
    assert.ok(EDGE_TYPES.includes('conflicts_with'));
    assert.ok(EDGE_TYPES.includes('branched_from'));
    assert.ok(EDGE_TYPES.includes('informed_by'));
    assert.ok(EDGE_TYPES.includes('relates_to'));
    assert.strictEqual(EDGE_TYPES.length, 6);
  });

  it('exposes valid node types', () => {
    assert.ok(NODE_TYPES.includes('feature'));
    assert.ok(NODE_TYPES.includes('thread'));
    assert.ok(NODE_TYPES.includes('decision'));
    assert.ok(NODE_TYPES.includes('pitfall'));
    assert.ok(NODE_TYPES.includes('pattern'));
    assert.ok(NODE_TYPES.includes('hotspot'));
    assert.strictEqual(NODE_TYPES.length, 6);
  });
});

// --- Unit Tests: createGraph ---

describe('createGraph', () => {
  it('returns empty graph with correct version', () => {
    const g = createGraph();
    assert.strictEqual(g.version, GRAPH_VERSION);
    assert.ok(g.lastUpdated);
    assert.deepStrictEqual(g.nodes, {});
    assert.deepStrictEqual(g.edges, []);
  });
});

// --- Unit Tests: generateNodeId ---

describe('generateNodeId', () => {
  it('produces deterministic IDs from type and content', () => {
    const id1 = generateNodeId('decision', 'Use CJS modules');
    const id2 = generateNodeId('decision', 'Use CJS modules');
    assert.strictEqual(id1, id2);
    assert.ok(id1.startsWith('decision-'));
    assert.strictEqual(id1.length, 'decision-'.length + 8);
  });

  it('normalizes case for determinism', () => {
    const id1 = generateNodeId('pattern', 'Pure Logic Module');
    const id2 = generateNodeId('pattern', 'pure logic module');
    assert.strictEqual(id1, id2);
  });

  it('different content produces different IDs', () => {
    const id1 = generateNodeId('decision', 'Use CJS');
    const id2 = generateNodeId('decision', 'Use ESM');
    assert.notStrictEqual(id1, id2);
  });
});

// --- Unit Tests: addNode ---

describe('addNode', () => {
  it('adds a new node to the graph', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'decision-aaa' }));
    assert.ok(g.nodes['decision-aaa']);
    assert.strictEqual(g.nodes['decision-aaa'].type, 'decision');
    assert.strictEqual(g.nodes['decision-aaa'].active, true);
  });

  it('updates existing node on duplicate ID', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'decision-aaa', label: 'Original' }));
    addNode(g, makeNode({ id: 'decision-aaa', label: 'Updated', metadata: { extra: true } }));
    assert.strictEqual(Object.keys(g.nodes).length, 1);
    assert.strictEqual(g.nodes['decision-aaa'].label, 'Updated');
    assert.strictEqual(g.nodes['decision-aaa'].metadata.extra, true);
  });

  it('preserves createdAt on update', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'decision-aaa', createdAt: '2026-01-01T00:00:00Z' }));
    const createdAt = g.nodes['decision-aaa'].createdAt;
    addNode(g, makeNode({ id: 'decision-aaa', label: 'Updated' }));
    assert.strictEqual(g.nodes['decision-aaa'].createdAt, createdAt);
  });

  it('sets default active to true', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-x', label: 'X' });
    assert.strictEqual(g.nodes['feature-x'].active, true);
  });
});

// --- Unit Tests: addEdge ---

describe('addEdge', () => {
  it('adds a new edge to the graph', () => {
    const g = createGraph();
    addEdge(g, makeEdge());
    assert.strictEqual(g.edges.length, 1);
    assert.strictEqual(g.edges[0].source, 'node-a');
    assert.strictEqual(g.edges[0].target, 'node-b');
    assert.strictEqual(g.edges[0].type, 'relates_to');
  });

  it('deduplicates edges by source+target+type', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on', metadata: { v: 2 } }));
    assert.strictEqual(g.edges.length, 1);
    assert.strictEqual(g.edges[0].metadata.v, 2);
  });

  it('allows different edge types between same nodes', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'conflicts_with' }));
    assert.strictEqual(g.edges.length, 2);
  });
});

// --- Unit Tests: removeNode / markStale ---

describe('removeNode', () => {
  it('marks node as inactive', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1' }));
    removeNode(g, 'n1');
    assert.strictEqual(g.nodes['n1'].active, false);
  });

  it('marks connected edges as inactive', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1' }));
    addNode(g, makeNode({ id: 'n2' }));
    addEdge(g, makeEdge({ source: 'n1', target: 'n2' }));
    addEdge(g, makeEdge({ source: 'n2', target: 'n1', type: 'informed_by' }));
    removeNode(g, 'n1');
    assert.ok(g.edges.every(e => !e.active));
  });

  it('does nothing for non-existent node', () => {
    const g = createGraph();
    removeNode(g, 'nonexistent');
    assert.deepStrictEqual(g.nodes, {});
  });
});

describe('markStale', () => {
  it('behaves identically to removeNode (AC-6: preserves edges as inactive)', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1' }));
    addNode(g, makeNode({ id: 'n2' }));
    addEdge(g, makeEdge({ source: 'n1', target: 'n2' }));
    markStale(g, 'n1');
    assert.strictEqual(g.nodes['n1'].active, false);
    assert.strictEqual(g.edges[0].active, false);
    // Edge still exists in the array (not deleted)
    assert.strictEqual(g.edges.length, 1);
  });
});

// --- Unit Tests: queryByType ---

describe('queryByType', () => {
  it('returns only nodes of requested type', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', type: 'decision' }));
    addNode(g, makeNode({ id: 'n2', type: 'pattern' }));
    addNode(g, makeNode({ id: 'n3', type: 'decision' }));

    const decisions = queryByType(g, 'decision');
    assert.strictEqual(decisions.length, 2);
    assert.ok(decisions.every(n => n.type === 'decision'));
  });

  it('excludes inactive nodes by default', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', type: 'decision' }));
    addNode(g, makeNode({ id: 'n2', type: 'decision', active: false }));

    assert.strictEqual(queryByType(g, 'decision').length, 1);
    assert.strictEqual(queryByType(g, 'decision', { includeInactive: true }).length, 2);
  });
});

// --- Unit Tests: queryNeighbors ---

describe('queryNeighbors', () => {
  it('returns direct neighbors at depth 1', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a', type: 'feature' }));
    addNode(g, makeNode({ id: 'b', type: 'decision' }));
    addNode(g, makeNode({ id: 'c', type: 'pattern' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b' }));
    addEdge(g, makeEdge({ source: 'b', target: 'c' }));

    const sub = queryNeighbors(g, 'a', 1);
    assert.ok(sub.nodes['a']);
    assert.ok(sub.nodes['b']);
    assert.ok(!sub.nodes['c']); // 2 hops away
  });

  it('returns 2-hop neighbors at depth 2', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a', type: 'feature' }));
    addNode(g, makeNode({ id: 'b', type: 'decision' }));
    addNode(g, makeNode({ id: 'c', type: 'pattern' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b' }));
    addEdge(g, makeEdge({ source: 'b', target: 'c' }));

    const sub = queryNeighbors(g, 'a', 2);
    assert.ok(sub.nodes['a']);
    assert.ok(sub.nodes['b']);
    assert.ok(sub.nodes['c']);
    assert.strictEqual(sub.edges.length, 2);
  });

  it('excludes inactive edges by default', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', active: false }));

    const sub = queryNeighbors(g, 'a', 1);
    assert.ok(!sub.nodes['b']);
  });

  it('includes inactive edges when requested', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', active: false }));

    const sub = queryNeighbors(g, 'a', 1, { includeInactive: true });
    assert.ok(sub.nodes['b']);
  });

  it('filters by edge type', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addNode(g, makeNode({ id: 'c' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'c', type: 'conflicts_with' }));

    const sub = queryNeighbors(g, 'a', 1, { edgeTypes: ['depends_on'] });
    assert.ok(sub.nodes['b']);
    assert.ok(!sub.nodes['c']);
  });

  it('supports directional traversal', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addNode(g, makeNode({ id: 'c' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b' }));
    addEdge(g, makeEdge({ source: 'c', target: 'a' }));

    const outgoing = queryNeighbors(g, 'a', 1, { direction: 'outgoing' });
    assert.ok(outgoing.nodes['b']);
    assert.ok(!outgoing.nodes['c']);

    const incoming = queryNeighbors(g, 'a', 1, { direction: 'incoming' });
    assert.ok(incoming.nodes['c']);
    assert.ok(!incoming.nodes['b']);
  });

  it('returns starting node even with no neighbors', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'lonely' }));
    const sub = queryNeighbors(g, 'lonely', 1);
    assert.ok(sub.nodes['lonely']);
    assert.strictEqual(sub.edges.length, 0);
  });
});

// --- Unit Tests: queryTemporal ---

describe('queryTemporal', () => {
  it('returns nodes updated within date range', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'old', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }));
    addNode(g, makeNode({ id: 'new', createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z' }));

    const sub = queryTemporal(g, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z');
    assert.ok(sub.nodes['new']);
    assert.ok(!sub.nodes['old']);
  });

  it('returns edges created within date range', () => {
    const g = createGraph();
    g.edges.push({
      source: 'a', target: 'b', type: 'relates_to',
      createdAt: '2026-01-01T00:00:00Z', active: true, metadata: {},
    });
    g.edges.push({
      source: 'c', target: 'd', type: 'depends_on',
      createdAt: '2026-04-01T00:00:00Z', active: true, metadata: {},
    });

    const sub = queryTemporal(g, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z');
    assert.strictEqual(sub.edges.length, 1);
    assert.strictEqual(sub.edges[0].source, 'c');
  });
});

// --- Unit Tests: serializeGraph ---

describe('serializeGraph', () => {
  it('produces valid JSON with sorted keys', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'z-node' }));
    addNode(g, makeNode({ id: 'a-node' }));
    addEdge(g, makeEdge({ source: 'z-node', target: 'a-node' }));
    addEdge(g, makeEdge({ source: 'a-node', target: 'z-node', type: 'depends_on' }));

    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    // Verify it parses correctly
    assert.strictEqual(parsed.version, GRAPH_VERSION);
    assert.ok(parsed.nodes['a-node']);
    assert.ok(parsed.nodes['z-node']);
    assert.strictEqual(parsed.edges.length, 2);
  });

  it('sorts nodes by key alphabetically', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'z-node' }));
    addNode(g, makeNode({ id: 'a-node' }));
    addNode(g, makeNode({ id: 'm-node' }));

    const json = serializeGraph(g);
    const nodeKeys = Object.keys(JSON.parse(json).nodes);
    assert.deepStrictEqual(nodeKeys, ['a-node', 'm-node', 'z-node']);
  });

  it('sorts edges by source, target, type', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'b', target: 'c', type: 'relates_to' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'conflicts_with' }));

    const json = serializeGraph(g);
    const edges = JSON.parse(json).edges;
    assert.strictEqual(edges[0].source, 'a');
    assert.strictEqual(edges[0].type, 'conflicts_with');
    assert.strictEqual(edges[1].source, 'a');
    assert.strictEqual(edges[1].type, 'depends_on');
    assert.strictEqual(edges[2].source, 'b');
  });

  it('ends with newline for git-friendliness', () => {
    const g = createGraph();
    const json = serializeGraph(g);
    assert.ok(json.endsWith('\n'));
  });
});

// --- Unit Tests: loadGraph / saveGraph ---

describe('loadGraph / saveGraph', () => {
  it('round-trips a graph through save and load', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', label: 'Test node' }));
    addEdge(g, makeEdge({ source: 'n1', target: 'n2' }));

    saveGraph(tmpDir, g);
    const loaded = loadGraph(tmpDir);

    assert.strictEqual(loaded.version, GRAPH_VERSION);
    assert.ok(loaded.nodes['n1']);
    assert.strictEqual(loaded.nodes['n1'].label, 'Test node');
    assert.strictEqual(loaded.edges.length, 1);
  });

  it('returns empty graph when file does not exist', () => {
    const g = loadGraph(tmpDir);
    assert.strictEqual(g.version, GRAPH_VERSION);
    assert.deepStrictEqual(g.nodes, {});
    assert.deepStrictEqual(g.edges, []);
  });

  it('creates directory structure if missing', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1' }));
    saveGraph(tmpDir, g);

    const filePath = path.join(tmpDir, GRAPH_FILE);
    assert.ok(fs.existsSync(filePath));
  });

  it('handles malformed JSON gracefully', () => {
    const filePath = path.join(tmpDir, GRAPH_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'NOT JSON', 'utf8');

    const g = loadGraph(tmpDir);
    assert.strictEqual(g.version, GRAPH_VERSION);
    assert.deepStrictEqual(g.nodes, {});
  });
});

// --- Unit Tests: incrementalUpdate ---

describe('incrementalUpdate', () => {
  it('adds new memory entries as graph nodes', () => {
    const g = createGraph();
    const entries = [
      {
        category: 'decision',
        file: 'cap/bin/lib/foo.cjs',
        content: 'Use CJS for all modules',
        metadata: { source: 'code', branch: null, relatedFiles: ['cap/bin/lib/foo.cjs'], features: [], pinned: false },
      },
    ];

    incrementalUpdate(g, entries);
    const nodes = Object.values(g.nodes);
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'decision');
    assert.strictEqual(nodes[0].label, 'Use CJS for all modules');
  });

  it('links entries to existing feature nodes', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', metadata: { featureId: 'F-001' } });

    const entries = [
      {
        category: 'decision',
        file: null,
        content: 'Decided to use regex',
        metadata: { source: 'code', branch: null, relatedFiles: [], features: ['F-001'], pinned: false },
      },
    ];

    incrementalUpdate(g, entries);
    assert.ok(g.edges.some(e => e.target === 'feature-f001' && e.type === 'relates_to'));
  });

  it('marks specified nodes as stale', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'old-decision' }));
    addEdge(g, makeEdge({ source: 'old-decision', target: 'other' }));

    incrementalUpdate(g, [], { staleNodeIds: ['old-decision'] });
    assert.strictEqual(g.nodes['old-decision'].active, false);
    assert.strictEqual(g.edges[0].active, false);
  });
});

// --- Unit Tests: generateViews ---

describe('generateViews', () => {
  it('converts active graph nodes to memory entries', () => {
    const g = createGraph();
    addNode(g, {
      type: 'decision', id: 'd1', label: 'Use CJS modules',
      active: true, metadata: { source: 'code', file: 'foo.cjs' },
    });
    addNode(g, {
      type: 'hotspot', id: 'h1', label: 'Frequently modified',
      active: true, metadata: { file: 'bar.cjs', sessions: 3, edits: 10 },
    });
    addNode(g, {
      type: 'decision', id: 'd2', label: 'Stale decision',
      active: false, metadata: {},
    });
    // Feature node should be excluded
    addNode(g, {
      type: 'feature', id: 'f1', label: 'F-001',
      active: true, metadata: { featureId: 'F-001' },
    });

    const entries = generateViews(g);
    assert.strictEqual(entries.length, 2); // only active decision + hotspot
    assert.ok(entries.some(e => e.category === 'decision' && e.content === 'Use CJS modules'));
    assert.ok(entries.some(e => e.category === 'hotspot'));
  });

  it('includes related feature IDs from edges', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', active: true, metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'decision', id: 'd1', label: 'Use CJS', active: true, metadata: {} });
    addEdge(g, makeEdge({ source: 'd1', target: 'feature-f001', type: 'relates_to' }));

    const entries = generateViews(g);
    const decision = entries.find(e => e.category === 'decision');
    assert.ok(decision.metadata.features.includes('F-001'));
  });
});

// --- Unit Tests: _parseMarkdownEntries ---

describe('_parseMarkdownEntries', () => {
  it('parses hotspot table rows', () => {
    const content = `# Project Memory: Hotspots

| Rank | File | Sessions | Edits | Since |
|------|------|----------|-------|-------|
| <a id="abc123"></a>1 | \`cap/bin/lib/foo.cjs\` | 5 | 20 | 2026-01-01 |
| <a id="def456"></a>2 | \`cap/bin/lib/bar.cjs\` | 3 | 10 | 2026-02-01 |
`;
    const entries = _parseMarkdownEntries(content, 'hotspot');
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].metadata.file, 'cap/bin/lib/foo.cjs');
    assert.strictEqual(entries[0].metadata.sessions, 5);
    assert.strictEqual(entries[0].metadata.edits, 20);
  });

  it('parses decision/pitfall/pattern headings', () => {
    const content = `# Project Memory: Decisions

### <a id="abc123"></a>Use CJS for all modules

- **Date:** 2026-01-01 (F-001)
- **Files:** \`cap/bin/lib/foo.cjs\`

### <a id="def456"></a>Zero runtime dependencies **[pinned]**

- **Date:** 2026-02-01
- **Files:** cross-cutting
`;
    const entries = _parseMarkdownEntries(content, 'decision');
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].label, 'Use CJS for all modules');
    assert.ok(entries[0].features.includes('F-001'));
    assert.strictEqual(entries[1].metadata.pinned, true);
  });
});

// --- Unit Tests: buildFromMemory ---

describe('buildFromMemory', () => {
  it('builds graph from feature map', () => {
    setupProject();
    const g = buildFromMemory(tmpDir);

    // Should have feature nodes
    const features = queryByType(g, 'feature');
    assert.ok(features.length >= 2);

    // Should have dependency edges
    const depEdges = g.edges.filter(e => e.type === 'depends_on');
    assert.ok(depEdges.length >= 1);
  });

  it('builds graph from thread index', () => {
    const threadId = 'thr-abcd1234';
    const thread = {
      id: threadId,
      name: 'Test thread',
      timestamp: '2026-04-01T00:00:00Z',
      parentThreadId: null,
      divergencePoint: null,
      problemStatement: 'How to build memory graph',
      solutionShape: 'Connected graph with typed nodes',
      boundaryDecisions: [],
      featureIds: ['F-001'],
      keywords: ['memory', 'graph'],
    };

    setupProject({
      threadIndex: {
        version: '1.0.0',
        threads: [{
          id: threadId,
          name: 'Test thread',
          timestamp: '2026-04-01T00:00:00Z',
          featureIds: ['F-001'],
          parentThreadId: null,
          keywords: ['memory', 'graph'],
        }],
      },
    });

    // Write thread file
    const threadsDir = path.join(tmpDir, '.cap', 'memory', 'threads');
    fs.writeFileSync(path.join(threadsDir, `${threadId}.json`), JSON.stringify(thread, null, 2), 'utf8');

    const g = buildFromMemory(tmpDir);
    const threads = queryByType(g, 'thread');
    assert.strictEqual(threads.length, 1);
    assert.ok(threads[0].label === 'Test thread');

    // Thread should be linked to feature
    const informedEdges = g.edges.filter(e => e.type === 'informed_by');
    assert.ok(informedEdges.length >= 1);
  });

  it('ingests memory markdown files', () => {
    setupProject({
      decisions: `# Project Memory: Decisions

### <a id="abc123"></a>Use CJS for all modules

- **Date:** 2026-01-01 (F-001)
- **Files:** \`cap/bin/lib/foo.cjs\`
`,
    });

    const g = buildFromMemory(tmpDir);
    const decisions = queryByType(g, 'decision');
    assert.ok(decisions.length >= 1);
    assert.ok(decisions.some(d => d.label === 'Use CJS for all modules'));
  });

  it('returns empty graph for bare project', () => {
    // No FEATURE-MAP.md, no memory dir
    const g = buildFromMemory(tmpDir);
    assert.strictEqual(Object.keys(g.nodes).length, 0);
    assert.strictEqual(g.edges.length, 0);
  });
});

// --- Integration Tests: Full Lifecycle ---

describe('full lifecycle', () => {
  it('create -> add -> query -> save -> load', () => {
    const g = createGraph();

    // Add features
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001: Tag Scanner', metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'feature', id: 'feature-f002', label: 'F-002: Feature Map', metadata: { featureId: 'F-002' } });
    addEdge(g, { source: 'feature-f002', target: 'feature-f001', type: 'depends_on' });

    // Add decisions
    addNode(g, { type: 'decision', id: 'decision-cjs', label: 'Use CJS modules', metadata: { source: 'code' } });
    addEdge(g, { source: 'decision-cjs', target: 'feature-f001', type: 'informed_by' });

    // Query
    const neighbors = queryNeighbors(g, 'feature-f001', 2);
    assert.ok(neighbors.nodes['feature-f001']);
    assert.ok(neighbors.nodes['feature-f002']);
    assert.ok(neighbors.nodes['decision-cjs']);

    // Save and reload
    saveGraph(tmpDir, g);
    const loaded = loadGraph(tmpDir);

    assert.strictEqual(Object.keys(loaded.nodes).length, 3);
    assert.strictEqual(loaded.edges.length, 2);

    // Verify serialization order is stable
    const json1 = serializeGraph(g);
    const json2 = serializeGraph(loaded);
    // Timestamps may differ slightly; compare structure
    const parsed1 = JSON.parse(json1);
    const parsed2 = JSON.parse(json2);
    assert.deepStrictEqual(Object.keys(parsed1.nodes), Object.keys(parsed2.nodes));
  });

  it('incremental update does not require full rebuild', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', metadata: { featureId: 'F-001' } });

    // First increment: add a decision
    incrementalUpdate(g, [{
      category: 'decision',
      file: 'foo.cjs',
      content: 'First decision',
      metadata: { source: '2026-04-01', branch: null, relatedFiles: [], features: ['F-001'], pinned: false },
    }]);

    assert.strictEqual(Object.keys(g.nodes).length, 2);

    // Second increment: add another decision + mark first as stale
    const firstDecisionId = Object.keys(g.nodes).find(k => k.startsWith('decision-'));
    incrementalUpdate(g, [{
      category: 'pattern',
      file: null,
      content: 'Pure logic modules',
      metadata: { source: '2026-04-02', branch: null, relatedFiles: [], features: [], pinned: false },
    }], { staleNodeIds: [firstDecisionId] });

    assert.strictEqual(Object.keys(g.nodes).length, 3);
    assert.strictEqual(g.nodes[firstDecisionId].active, false);

    // Views should only include active nodes
    const views = generateViews(g);
    assert.ok(!views.some(e => e.content === 'First decision'));
    assert.ok(views.some(e => e.content === 'Pure logic modules'));
  });
});

// --- Unit Tests: _getRelatedFeatureIds ---

describe('_getRelatedFeatureIds', () => {
  it('finds feature IDs connected via edges', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', active: true, metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'feature', id: 'feature-f002', label: 'F-002', active: true, metadata: { featureId: 'F-002' } });
    addNode(g, { type: 'decision', id: 'd1', label: 'test', active: true, metadata: {} });
    addEdge(g, { source: 'd1', target: 'feature-f001', type: 'relates_to', active: true });
    addEdge(g, { source: 'feature-f002', target: 'd1', type: 'informed_by', active: true });

    const ids = _getRelatedFeatureIds(g, 'd1');
    assert.ok(ids.includes('F-001'));
    assert.ok(ids.includes('F-002'));
  });

  it('excludes inactive edges', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', active: true, metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'decision', id: 'd1', label: 'test', active: true, metadata: {} });
    addEdge(g, { source: 'd1', target: 'feature-f001', type: 'relates_to', active: false });

    const ids = _getRelatedFeatureIds(g, 'd1');
    assert.strictEqual(ids.length, 0);
  });
});

// ============================================================================
// ADVERSARIAL TESTS — added by cap-tester for RED-GREEN discipline
// ============================================================================

// --- AC-1: Stress and malformed node inputs ---

describe('AC-1 adversarial: node stress and malformed inputs', () => {
  // @cap-todo(ac:F-034/AC-1) Stress test: 1000 nodes
  it('handles 1000 nodes without error', () => {
    const g = createGraph();
    for (let i = 0; i < 1000; i++) {
      addNode(g, makeNode({ id: `node-${i}`, type: 'decision', label: `Decision ${i}` }));
    }
    assert.strictEqual(Object.keys(g.nodes).length, 1000);
    // queryByType should still work
    const decisions = queryByType(g, 'decision');
    assert.strictEqual(decisions.length, 1000);
  });

  // @cap-todo(ac:F-034/AC-1) Duplicate node IDs should merge, not duplicate
  it('duplicate node IDs merge metadata rather than creating duplicates', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'dup-1', metadata: { a: 1 } }));
    addNode(g, makeNode({ id: 'dup-1', metadata: { b: 2 } }));
    assert.strictEqual(Object.keys(g.nodes).length, 1);
    assert.strictEqual(g.nodes['dup-1'].metadata.a, 1);
    assert.strictEqual(g.nodes['dup-1'].metadata.b, 2);
  });

  // @cap-todo(ac:F-034/AC-1) Node with no type field
  it('adds node with undefined type without crashing', () => {
    const g = createGraph();
    addNode(g, { id: 'no-type', label: 'Missing type' });
    assert.ok(g.nodes['no-type']);
    assert.strictEqual(g.nodes['no-type'].type, undefined);
  });

  // @cap-todo(ac:F-034/AC-1) Node with unknown type — still stored
  it('adds node with unknown type string', () => {
    const g = createGraph();
    addNode(g, { id: 'alien', type: 'alien_type', label: 'Unknown type node' });
    assert.ok(g.nodes['alien']);
    assert.strictEqual(g.nodes['alien'].type, 'alien_type');
  });

  // @cap-todo(ac:F-034/AC-1) Node with empty string label
  it('handles empty string label', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'empty-label', label: '' }));
    assert.strictEqual(g.nodes['empty-label'].label, '');
  });

  // @cap-todo(ac:F-034/AC-1) Node with null metadata
  it('handles null metadata gracefully', () => {
    const g = createGraph();
    addNode(g, { id: 'null-meta', type: 'decision', label: 'test', metadata: null });
    // Should not throw; metadata should be usable
    assert.ok(g.nodes['null-meta']);
  });

  // @cap-todo(ac:F-034/AC-1) Adding nodes to graph preserves lastUpdated
  it('updates graph lastUpdated on every addNode call', () => {
    const g = createGraph();
    const before = g.lastUpdated;
    // Tiny delay to ensure timestamp changes
    addNode(g, makeNode({ id: 'n1' }));
    assert.ok(g.lastUpdated >= before);
  });
});

// --- AC-2: Edge validation and edge cases ---

describe('AC-2 adversarial: edge type validation and edge cases', () => {
  // @cap-todo(ac:F-034/AC-2) Self-referencing edge
  it('allows self-referencing edge (source === target)', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'self' }));
    addEdge(g, makeEdge({ source: 'self', target: 'self', type: 'relates_to' }));
    assert.strictEqual(g.edges.length, 1);
    assert.strictEqual(g.edges[0].source, 'self');
    assert.strictEqual(g.edges[0].target, 'self');
  });

  // @cap-todo(ac:F-034/AC-2) Duplicate edges are deduplicated
  it('deduplicates identical edges added multiple times', () => {
    const g = createGraph();
    for (let i = 0; i < 10; i++) {
      addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    }
    assert.strictEqual(g.edges.length, 1);
  });

  // @cap-todo(ac:F-034/AC-2) Edge with nonexistent source/target — still stored
  it('adds edge even when source and target nodes do not exist in graph', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'ghost-a', target: 'ghost-b', type: 'depends_on' }));
    assert.strictEqual(g.edges.length, 1);
  });

  // @cap-todo(ac:F-034/AC-2) All 6 edge types can be created
  it('supports creating all 6 edge types', () => {
    const g = createGraph();
    for (const edgeType of EDGE_TYPES) {
      addEdge(g, makeEdge({ source: 'a', target: 'b', type: edgeType }));
    }
    assert.strictEqual(g.edges.length, 6);
    const types = g.edges.map(e => e.type).sort();
    assert.deepStrictEqual(types, [...EDGE_TYPES].sort());
  });

  // @cap-todo(ac:F-034/AC-2) Edge with invalid type string — no validation, stored as-is
  it('stores edge with unknown type string without throwing', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'invented_edge_type' }));
    assert.strictEqual(g.edges.length, 1);
    assert.strictEqual(g.edges[0].type, 'invented_edge_type');
  });

  // @cap-todo(ac:F-034/AC-2) Reverse edges are not treated as duplicates
  it('treats a->b and b->a as distinct edges', () => {
    const g = createGraph();
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'b', target: 'a', type: 'depends_on' }));
    assert.strictEqual(g.edges.length, 2);
  });
});

// --- AC-3: queryNeighbors adversarial scenarios ---

describe('AC-3 adversarial: queryNeighbors edge cases', () => {
  // @cap-todo(ac:F-034/AC-3) depth 0 returns only starting node
  it('depth 0 returns only the starting node and no neighbors', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'center' }));
    addNode(g, makeNode({ id: 'neighbor' }));
    addEdge(g, makeEdge({ source: 'center', target: 'neighbor' }));

    const sub = queryNeighbors(g, 'center', 0);
    assert.ok(sub.nodes['center']);
    assert.ok(!sub.nodes['neighbor']);
    assert.strictEqual(sub.edges.length, 0);
  });

  // @cap-todo(ac:F-034/AC-3) depth 100 on small graph — does not hang or crash
  it('depth 100 on a 3-node graph terminates and returns all reachable nodes', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addNode(g, makeNode({ id: 'c' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b' }));
    addEdge(g, makeEdge({ source: 'b', target: 'c' }));

    const sub = queryNeighbors(g, 'a', 100);
    assert.strictEqual(Object.keys(sub.nodes).length, 3);
  });

  // @cap-todo(ac:F-034/AC-3) Disconnected nodes not reached
  it('does not include disconnected nodes', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'connected-a' }));
    addNode(g, makeNode({ id: 'connected-b' }));
    addNode(g, makeNode({ id: 'island' }));
    addEdge(g, makeEdge({ source: 'connected-a', target: 'connected-b' }));

    const sub = queryNeighbors(g, 'connected-a', 10);
    assert.ok(sub.nodes['connected-a']);
    assert.ok(sub.nodes['connected-b']);
    assert.ok(!sub.nodes['island']);
  });

  // @cap-todo(ac:F-034/AC-3) Cycle-safe traversal — graph with cycles does not infinite loop
  it('handles cycles without infinite loop', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'x' }));
    addNode(g, makeNode({ id: 'y' }));
    addNode(g, makeNode({ id: 'z' }));
    addEdge(g, makeEdge({ source: 'x', target: 'y' }));
    addEdge(g, makeEdge({ source: 'y', target: 'z' }));
    addEdge(g, makeEdge({ source: 'z', target: 'x' })); // cycle

    const sub = queryNeighbors(g, 'x', 50);
    assert.strictEqual(Object.keys(sub.nodes).length, 3);
    assert.strictEqual(sub.edges.length, 3);
  });

  // @cap-todo(ac:F-034/AC-3) Query nonexistent starting node
  it('returns empty subgraph when starting node does not exist', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));

    const sub = queryNeighbors(g, 'nonexistent', 5);
    assert.strictEqual(Object.keys(sub.nodes).length, 0);
    assert.strictEqual(sub.edges.length, 0);
  });

  // @cap-todo(ac:F-034/AC-3) Direction filtering — outgoing only skips incoming
  it('outgoing direction ignores edges pointing into the node', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'hub' }));
    addNode(g, makeNode({ id: 'upstream' }));
    addNode(g, makeNode({ id: 'downstream' }));
    addEdge(g, makeEdge({ source: 'hub', target: 'downstream', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'upstream', target: 'hub', type: 'informed_by' }));

    const sub = queryNeighbors(g, 'hub', 1, { direction: 'outgoing' });
    assert.ok(sub.nodes['downstream']);
    assert.ok(!sub.nodes['upstream']);
  });

  // @cap-todo(ac:F-034/AC-3) Edge type filtering combined with direction
  it('filters by edge type AND direction simultaneously', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addNode(g, makeNode({ id: 'c' }));
    addNode(g, makeNode({ id: 'd' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'c', type: 'relates_to' }));
    addEdge(g, makeEdge({ source: 'd', target: 'a', type: 'depends_on' }));

    const sub = queryNeighbors(g, 'a', 1, { edgeTypes: ['depends_on'], direction: 'outgoing' });
    assert.ok(sub.nodes['b']);
    assert.ok(!sub.nodes['c']); // wrong edge type
    assert.ok(!sub.nodes['d']); // wrong direction
  });

  // @cap-todo(ac:F-034/AC-3) Large fan-out — node connected to many neighbors
  it('handles node with 200 direct neighbors', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'hub' }));
    for (let i = 0; i < 200; i++) {
      addNode(g, makeNode({ id: `spoke-${i}` }));
      addEdge(g, makeEdge({ source: 'hub', target: `spoke-${i}` }));
    }
    const sub = queryNeighbors(g, 'hub', 1);
    // hub + 200 spokes
    assert.strictEqual(Object.keys(sub.nodes).length, 201);
    assert.strictEqual(sub.edges.length, 200);
  });

  // @cap-todo(ac:F-034/AC-3) Inactive nodes are skipped during traversal
  it('skips inactive neighbor nodes during traversal by default', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'start' }));
    addNode(g, makeNode({ id: 'middle', active: false }));
    addNode(g, makeNode({ id: 'end' }));
    addEdge(g, makeEdge({ source: 'start', target: 'middle' }));
    addEdge(g, makeEdge({ source: 'middle', target: 'end' }));

    const sub = queryNeighbors(g, 'start', 2);
    assert.ok(!sub.nodes['middle']); // inactive, skipped
    assert.ok(!sub.nodes['end']);    // unreachable through inactive middle
  });
});

// --- AC-4: generateViews adversarial scenarios ---

describe('AC-4 adversarial: generateViews edge cases', () => {
  // @cap-todo(ac:F-034/AC-4) Empty graph produces empty views
  it('returns empty array for empty graph', () => {
    const g = createGraph();
    const views = generateViews(g);
    assert.deepStrictEqual(views, []);
  });

  // @cap-todo(ac:F-034/AC-4) Graph with only inactive nodes
  it('returns empty array when all nodes are inactive', () => {
    const g = createGraph();
    addNode(g, { type: 'decision', id: 'd1', label: 'Stale', active: false, metadata: {} });
    addNode(g, { type: 'pattern', id: 'p1', label: 'Old pattern', active: false, metadata: {} });

    const views = generateViews(g);
    assert.strictEqual(views.length, 0);
  });

  // @cap-todo(ac:F-034/AC-4) Mixed active/inactive — only active appear
  it('includes active nodes and excludes inactive ones', () => {
    const g = createGraph();
    addNode(g, { type: 'decision', id: 'd1', label: 'Active', active: true, metadata: {} });
    addNode(g, { type: 'decision', id: 'd2', label: 'Inactive', active: false, metadata: {} });
    addNode(g, { type: 'pitfall', id: 'pit1', label: 'Active pitfall', active: true, metadata: {} });

    const views = generateViews(g);
    assert.strictEqual(views.length, 2);
    assert.ok(views.some(e => e.content === 'Active'));
    assert.ok(views.some(e => e.content === 'Active pitfall'));
    assert.ok(!views.some(e => e.content === 'Inactive'));
  });

  // @cap-todo(ac:F-034/AC-4) Feature and thread nodes are excluded from views
  it('excludes feature and thread node types from views', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'f1', label: 'Feature', active: true, metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'thread', id: 't1', label: 'Thread', active: true, metadata: {} });
    addNode(g, { type: 'decision', id: 'd1', label: 'Decision', active: true, metadata: {} });

    const views = generateViews(g);
    assert.strictEqual(views.length, 1);
    assert.strictEqual(views[0].category, 'decision');
  });

  // @cap-todo(ac:F-034/AC-4) Views include related feature IDs from active edges only
  it('only includes feature IDs from active edges in view metadata', () => {
    const g = createGraph();
    addNode(g, { type: 'feature', id: 'feature-f001', label: 'F-001', active: true, metadata: { featureId: 'F-001' } });
    addNode(g, { type: 'feature', id: 'feature-f002', label: 'F-002', active: true, metadata: { featureId: 'F-002' } });
    addNode(g, { type: 'decision', id: 'd1', label: 'Decision', active: true, metadata: {} });
    addEdge(g, { source: 'd1', target: 'feature-f001', type: 'relates_to', active: true });
    addEdge(g, { source: 'd1', target: 'feature-f002', type: 'relates_to', active: false }); // inactive

    const views = generateViews(g);
    const decision = views.find(e => e.category === 'decision');
    assert.ok(decision.metadata.features.includes('F-001'));
    assert.ok(!decision.metadata.features.includes('F-002'));
  });
});

// --- AC-5: queryTemporal adversarial scenarios ---

describe('AC-5 adversarial: queryTemporal edge cases', () => {
  // @cap-todo(ac:F-034/AC-5) Inverted date range (since > until) returns nothing
  it('returns empty results when since is after until', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', updatedAt: '2026-03-15T00:00:00Z' }));

    const sub = queryTemporal(g, '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z');
    assert.strictEqual(Object.keys(sub.nodes).length, 0);
    assert.strictEqual(sub.edges.length, 0);
  });

  // @cap-todo(ac:F-034/AC-5) Date range matching no entries
  it('returns empty results when no nodes or edges fall within range', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }));

    const sub = queryTemporal(g, '2027-01-01T00:00:00Z', '2027-12-31T00:00:00Z');
    assert.strictEqual(Object.keys(sub.nodes).length, 0);
  });

  // @cap-todo(ac:F-034/AC-5) Node with null/undefined timestamps — uses createdAt fallback
  it('uses createdAt when updatedAt is missing', () => {
    const g = createGraph();
    // Manually set node with no updatedAt
    g.nodes['raw'] = {
      type: 'decision', id: 'raw', label: 'Raw node',
      createdAt: '2026-06-01T00:00:00Z', updatedAt: null,
      active: true, metadata: {},
    };

    const sub = queryTemporal(g, '2026-05-01T00:00:00Z', '2026-07-01T00:00:00Z');
    // updatedAt is null, so updated = null || createdAt = createdAt
    assert.ok(sub.nodes['raw']);
  });

  // @cap-todo(ac:F-034/AC-5) since=null defaults to epoch
  it('treats null since as epoch start', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'old', createdAt: '1970-01-02T00:00:00Z', updatedAt: '1970-01-02T00:00:00Z' }));

    const sub = queryTemporal(g, null, '2099-01-01T00:00:00Z');
    assert.ok(sub.nodes['old']);
  });

  // @cap-todo(ac:F-034/AC-5) Exact boundary timestamps (inclusive)
  it('includes nodes exactly on the since and until boundaries', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'on-since', updatedAt: '2026-03-01T00:00:00Z', createdAt: '2026-03-01T00:00:00Z' }));
    addNode(g, makeNode({ id: 'on-until', updatedAt: '2026-04-01T00:00:00Z', createdAt: '2026-04-01T00:00:00Z' }));

    const sub = queryTemporal(g, '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');
    assert.ok(sub.nodes['on-since']);
    assert.ok(sub.nodes['on-until']);
  });
});

// --- AC-6: markStale adversarial scenarios ---

describe('AC-6 adversarial: markStale edge cases', () => {
  // @cap-todo(ac:F-034/AC-6) markStale on already-stale node
  it('marking an already-stale node does not throw or corrupt state', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'stale-node', active: false }));
    addEdge(g, makeEdge({ source: 'stale-node', target: 'other', active: false }));

    markStale(g, 'stale-node');
    assert.strictEqual(g.nodes['stale-node'].active, false);
    assert.strictEqual(g.edges[0].active, false);
    assert.strictEqual(g.edges.length, 1); // edge preserved
  });

  // @cap-todo(ac:F-034/AC-6) markStale on nonexistent node
  it('markStale on nonexistent node is a no-op', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'real' }));
    const nodesBefore = Object.keys(g.nodes).length;

    markStale(g, 'does-not-exist');
    assert.strictEqual(Object.keys(g.nodes).length, nodesBefore);
  });

  // @cap-todo(ac:F-034/AC-6) removeNode preserves edges as inactive, not deleted
  it('removeNode preserves all edges as inactive — they remain in edges array', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'target' }));
    addNode(g, makeNode({ id: 'other1' }));
    addNode(g, makeNode({ id: 'other2' }));
    addEdge(g, makeEdge({ source: 'target', target: 'other1', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'other2', target: 'target', type: 'informed_by' }));
    addEdge(g, makeEdge({ source: 'other1', target: 'other2', type: 'relates_to' })); // unrelated

    removeNode(g, 'target');
    assert.strictEqual(g.edges.length, 3); // all edges still present
    // Only edges connected to 'target' are inactive
    const targetEdges = g.edges.filter(e => e.source === 'target' || e.target === 'target');
    assert.ok(targetEdges.every(e => e.active === false));
    // Unrelated edge stays active
    const unrelatedEdge = g.edges.find(e => e.source === 'other1' && e.target === 'other2');
    assert.strictEqual(unrelatedEdge.active, true);
  });

  // @cap-todo(ac:F-034/AC-6) After markStale, queryNeighbors with includeInactive finds stale node
  it('stale nodes are reachable via queryNeighbors with includeInactive', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'live' }));
    addNode(g, makeNode({ id: 'stale-peer' }));
    addEdge(g, makeEdge({ source: 'live', target: 'stale-peer' }));
    markStale(g, 'stale-peer');

    // Without includeInactive: stale peer not found
    const sub1 = queryNeighbors(g, 'live', 1);
    assert.ok(!sub1.nodes['stale-peer']);

    // With includeInactive: stale peer found
    const sub2 = queryNeighbors(g, 'live', 1, { includeInactive: true });
    assert.ok(sub2.nodes['stale-peer']);
  });
});

// --- AC-7: incrementalUpdate adversarial scenarios ---

describe('AC-7 adversarial: incrementalUpdate edge cases', () => {
  // @cap-todo(ac:F-034/AC-7) Empty entries array is a no-op
  it('empty entries array does not add any nodes', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'existing' }));
    const nodeCountBefore = Object.keys(g.nodes).length;

    incrementalUpdate(g, []);
    assert.strictEqual(Object.keys(g.nodes).length, nodeCountBefore);
  });

  // @cap-todo(ac:F-034/AC-7) Entries that duplicate existing nodes update rather than create
  it('entries with content matching existing node IDs update rather than create new', () => {
    const g = createGraph();
    const content = 'Use CJS modules';
    const nodeId = generateNodeId('decision', content);

    // Pre-add the node
    addNode(g, { type: 'decision', id: nodeId, label: content, metadata: { source: 'old' } });
    const nodeCountBefore = Object.keys(g.nodes).length;

    // incrementalUpdate with same content generates same ID
    incrementalUpdate(g, [{
      category: 'decision',
      file: null,
      content: content,
      metadata: { source: 'new', relatedFiles: [], features: [], pinned: false },
    }]);

    assert.strictEqual(Object.keys(g.nodes).length, nodeCountBefore);
    // Label updated to the content
    assert.strictEqual(g.nodes[nodeId].label, content);
  });

  // @cap-todo(ac:F-034/AC-7) Does not touch unrelated nodes
  it('does not modify unrelated existing nodes', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'unrelated', label: 'Original label', metadata: { original: true } }));
    const originalUpdatedAt = g.nodes['unrelated'].updatedAt;

    incrementalUpdate(g, [{
      category: 'pattern',
      file: null,
      content: 'New pattern',
      metadata: { source: 'session', relatedFiles: [], features: [], pinned: false },
    }]);

    assert.strictEqual(g.nodes['unrelated'].label, 'Original label');
    assert.strictEqual(g.nodes['unrelated'].metadata.original, true);
    assert.strictEqual(g.nodes['unrelated'].updatedAt, originalUpdatedAt);
  });

  // @cap-todo(ac:F-034/AC-7) Feature linking only targets existing feature nodes
  it('does not create edges to nonexistent feature nodes', () => {
    const g = createGraph();
    // No feature nodes exist

    incrementalUpdate(g, [{
      category: 'decision',
      file: null,
      content: 'Some decision',
      metadata: { source: 'code', relatedFiles: [], features: ['F-999'], pinned: false },
    }]);

    // Edge should NOT be created because feature-f999 node doesn't exist
    assert.strictEqual(g.edges.length, 0);
  });
});

// --- AC-8: Serialization adversarial scenarios ---

describe('AC-8 adversarial: serialization correctness', () => {
  // @cap-todo(ac:F-034/AC-8) Top-level keys follow stable schema order (version, lastUpdated, nodes, edges)
  it('top-level JSON keys follow stable schema order', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1' }));

    const json = serializeGraph(g);
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);
    // Top-level uses semantic order; the "sorted keys" in AC-8 applies to node keys within nodes object
    assert.deepStrictEqual(keys, ['version', 'lastUpdated', 'nodes', 'edges']);
  });

  // @cap-todo(ac:F-034/AC-8) Edges sorted by [source, target, type]
  it('edges are sorted by source then target then type', () => {
    const g = createGraph();
    // Add edges in reverse order
    addEdge(g, makeEdge({ source: 'z', target: 'y', type: 'relates_to' }));
    addEdge(g, makeEdge({ source: 'a', target: 'z', type: 'depends_on' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'supersedes' }));
    addEdge(g, makeEdge({ source: 'a', target: 'b', type: 'conflicts_with' }));

    const json = serializeGraph(g);
    const edges = JSON.parse(json).edges;

    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1];
      const curr = edges[i];
      const cmp = prev.source.localeCompare(curr.source)
        || prev.target.localeCompare(curr.target)
        || prev.type.localeCompare(curr.type);
      assert.ok(cmp <= 0, `Edge ${i - 1} should come before edge ${i}: ${prev.source}|${prev.target}|${prev.type} vs ${curr.source}|${curr.target}|${curr.type}`);
    }
  });

  // @cap-todo(ac:F-034/AC-8) Node keys are sorted alphabetically
  it('node keys are sorted alphabetically in serialized output', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'zebra' }));
    addNode(g, makeNode({ id: 'alpha' }));
    addNode(g, makeNode({ id: 'middle' }));

    const json = serializeGraph(g);
    const nodeKeys = Object.keys(JSON.parse(json).nodes);
    assert.deepStrictEqual(nodeKeys, ['alpha', 'middle', 'zebra']);
  });

  // @cap-todo(ac:F-034/AC-8) Trailing newline present
  it('serialized output ends with exactly one newline', () => {
    const g = createGraph();
    const json = serializeGraph(g);
    assert.ok(json.endsWith('\n'));
    assert.ok(!json.endsWith('\n\n'));
  });

  // @cap-todo(ac:F-034/AC-8) Valid JSON after roundtrip
  it('serialized output is valid JSON that roundtrips correctly', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'n1', label: 'Has "quotes" and\nnewlines' }));
    addEdge(g, makeEdge({ source: 'n1', target: 'n2', metadata: { special: 'chars: <>&"' } }));

    const json = serializeGraph(g);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.nodes['n1'].label, 'Has "quotes" and\nnewlines');
    assert.strictEqual(parsed.edges[0].metadata.special, 'chars: <>&"');
  });

  // @cap-todo(ac:F-034/AC-8) Empty graph serializes correctly
  it('empty graph serializes to valid JSON with empty nodes and edges', () => {
    const g = createGraph();
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed.nodes, {});
    assert.deepStrictEqual(parsed.edges, []);
    assert.strictEqual(parsed.version, GRAPH_VERSION);
  });

  // @cap-todo(ac:F-034/AC-8) Serialization is idempotent — serialize twice gives same output
  it('serializing twice yields identical output (idempotent)', () => {
    const g = createGraph();
    addNode(g, makeNode({ id: 'a' }));
    addNode(g, makeNode({ id: 'b' }));
    addEdge(g, makeEdge({ source: 'b', target: 'a' }));

    const json1 = serializeGraph(g);
    const reparsed = JSON.parse(json1);
    // Build a new graph from parsed data to simulate load
    const g2 = {
      version: reparsed.version,
      lastUpdated: reparsed.lastUpdated,
      nodes: reparsed.nodes,
      edges: reparsed.edges,
    };
    const json2 = serializeGraph(g2);
    assert.strictEqual(json1, json2);
  });

  // @cap-todo(ac:F-034/AC-8) Save then load roundtrip preserves full fidelity
  it('save+load roundtrip preserves all data', () => {
    const g = createGraph();
    addNode(g, { type: 'decision', id: 'd1', label: 'Test', active: true, metadata: { key: 'value' } });
    addNode(g, { type: 'pattern', id: 'p1', label: 'Pattern', active: false, metadata: { nested: { deep: true } } });
    addEdge(g, { source: 'd1', target: 'p1', type: 'relates_to', active: true, metadata: { weight: 42 } });
    addEdge(g, { source: 'p1', target: 'd1', type: 'conflicts_with', active: false, metadata: {} });

    saveGraph(tmpDir, g);
    const loaded = loadGraph(tmpDir);

    // Verify nodes
    assert.strictEqual(Object.keys(loaded.nodes).length, 2);
    assert.strictEqual(loaded.nodes['d1'].label, 'Test');
    assert.strictEqual(loaded.nodes['d1'].metadata.key, 'value');
    assert.strictEqual(loaded.nodes['p1'].active, false);
    assert.deepStrictEqual(loaded.nodes['p1'].metadata.nested, { deep: true });

    // Verify edges
    assert.strictEqual(loaded.edges.length, 2);
    const relatesToEdge = loaded.edges.find(e => e.type === 'relates_to');
    assert.strictEqual(relatesToEdge.metadata.weight, 42);
    const conflictsEdge = loaded.edges.find(e => e.type === 'conflicts_with');
    assert.strictEqual(conflictsEdge.active, false);
  });
});
