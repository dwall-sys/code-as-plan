// @cap-feature(feature:F-034) Memory Graph — connected graph structure linking features, threads, decisions, pitfalls, and patterns as typed nodes with labeled edges
// @cap-decision Pure logic module with explicit I/O functions — same pattern as cap-memory-engine.cjs. Graph manipulation functions are side-effect-free; only loadGraph/saveGraph touch disk.
// @cap-decision Graph stored as single JSON file (.cap/memory/graph.json) with sorted keys and one-entry-per-line edges for merge-friendly git diffs.
// @cap-decision Nodes keyed by ID in an object (O(1) lookup) while edges stored as a sorted array (merge-friendly diffs, easy filtering).
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path, crypto).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// --- Constants ---

/** Graph file path relative to project root. */
const GRAPH_FILE = path.join('.cap', 'memory', 'graph.json');

/** Current graph schema version. */
const GRAPH_VERSION = '1.0.0';

// @cap-todo(ac:F-034/AC-2) Support edge types: depends_on, supersedes, conflicts_with, branched_from, informed_by, relates_to
/** Valid edge types for the memory graph. */
const EDGE_TYPES = [
  'depends_on',
  'supersedes',
  'conflicts_with',
  'branched_from',
  'informed_by',
  'relates_to',
];

// @cap-todo(ac:F-034/AC-1) Node types: feature, thread, decision, pitfall, pattern, hotspot
/** Valid node types for the memory graph. */
const NODE_TYPES = [
  'feature',
  'thread',
  'decision',
  'pitfall',
  'pattern',
  'hotspot',
];

// --- Types ---

/**
 * @typedef {'feature'|'thread'|'decision'|'pitfall'|'pattern'|'hotspot'} NodeType
 */

/**
 * @typedef {'depends_on'|'supersedes'|'conflicts_with'|'branched_from'|'informed_by'|'relates_to'} EdgeType
 */

/**
 * @typedef {Object} GraphNode
 * @property {NodeType} type - Node type
 * @property {string} id - Unique node ID
 * @property {string} label - Human-readable label
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {boolean} active - Whether the node is active (false = stale/removed)
 * @property {Object} metadata - Arbitrary metadata
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} source - Source node ID
 * @property {string} target - Target node ID
 * @property {EdgeType} type - Edge type
 * @property {string} createdAt - ISO timestamp
 * @property {boolean} active - Whether the edge is active
 * @property {Object} metadata - Arbitrary metadata
 */

/**
 * @typedef {Object} MemoryGraph
 * @property {string} version - Schema version
 * @property {string} lastUpdated - ISO timestamp
 * @property {Object<string, GraphNode>} nodes - Nodes keyed by ID
 * @property {GraphEdge[]} edges - Array of edges
 */

/**
 * @typedef {Object} Subgraph
 * @property {Object<string, GraphNode>} nodes - Subset of nodes
 * @property {GraphEdge[]} edges - Subset of edges connecting returned nodes
 */

// --- Core Graph Functions ---

/**
 * Create an empty graph structure.
 * @returns {MemoryGraph}
 */
function createGraph() {
  return {
    version: GRAPH_VERSION,
    lastUpdated: new Date().toISOString(),
    nodes: {},
    edges: [],
  };
}

/**
 * Generate a stable node ID from type and content.
 * @param {NodeType} type - Node type
 * @param {string} content - Content to hash
 * @returns {string} Node ID in format "{type}-{8 hex chars}"
 */
function generateNodeId(type, content) {
  const hash = crypto.createHash('sha256')
    .update(content.toLowerCase().trim())
    .digest('hex')
    .substring(0, 8);
  return `${type}-${hash}`;
}

// @cap-todo(ac:F-034/AC-1) Maintain memory graph connecting features, threads, decisions, pitfalls, and patterns as typed nodes with labeled edges

/**
 * Add or update a node in the graph.
 * If a node with the same ID exists, it is updated (merged metadata, refreshed updatedAt).
 * @param {MemoryGraph} graph - Graph to mutate
 * @param {GraphNode} node - Node to add or update
 * @returns {MemoryGraph} The mutated graph (for chaining)
 */
function addNode(graph, node) {
  const now = new Date().toISOString();
  const existing = graph.nodes[node.id];

  if (existing) {
    // Update: merge metadata, refresh timestamp
    existing.label = node.label || existing.label;
    existing.updatedAt = now;
    existing.active = node.active !== undefined ? node.active : existing.active;
    existing.metadata = { ...existing.metadata, ...node.metadata };
  } else {
    // Insert
    graph.nodes[node.id] = {
      type: node.type,
      id: node.id,
      label: node.label || '',
      createdAt: node.createdAt || now,
      updatedAt: node.updatedAt || now,
      active: node.active !== undefined ? node.active : true,
      metadata: node.metadata || {},
    };
  }

  graph.lastUpdated = now;
  return graph;
}

// @cap-todo(ac:F-034/AC-2) Support labeled edges between nodes

/**
 * Add an edge to the graph. Deduplicates by source+target+type.
 * If duplicate found, updates metadata and refreshes the edge.
 * @param {MemoryGraph} graph - Graph to mutate
 * @param {GraphEdge} edge - Edge to add
 * @returns {MemoryGraph} The mutated graph (for chaining)
 */
function addEdge(graph, edge) {
  const now = new Date().toISOString();

  // Deduplicate by source+target+type
  const existingIdx = graph.edges.findIndex(
    e => e.source === edge.source && e.target === edge.target && e.type === edge.type
  );

  if (existingIdx >= 0) {
    // Update existing edge
    graph.edges[existingIdx].active = edge.active !== undefined ? edge.active : graph.edges[existingIdx].active;
    graph.edges[existingIdx].metadata = { ...graph.edges[existingIdx].metadata, ...edge.metadata };
  } else {
    graph.edges.push({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      createdAt: edge.createdAt || now,
      active: edge.active !== undefined ? edge.active : true,
      metadata: edge.metadata || {},
    });
  }

  graph.lastUpdated = now;
  return graph;
}

/**
 * Remove a node by marking it and its edges as inactive.
 * Does NOT delete — preserves historical context.
 * @param {MemoryGraph} graph - Graph to mutate
 * @param {string} nodeId - Node ID to remove
 * @returns {MemoryGraph} The mutated graph
 */
function removeNode(graph, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return graph;

  node.active = false;
  node.updatedAt = new Date().toISOString();

  // Mark all connected edges as inactive
  for (const edge of graph.edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      edge.active = false;
    }
  }

  graph.lastUpdated = new Date().toISOString();
  return graph;
}

// @cap-todo(ac:F-034/AC-6) When node marked stale, preserve edges as inactive so historical context is not lost

/**
 * Mark a node as stale (inactive) while preserving edges as inactive.
 * Same as removeNode but semantically distinct — stale means aged out, not deleted.
 * @param {MemoryGraph} graph - Graph to mutate
 * @param {string} nodeId - Node ID to mark stale
 * @returns {MemoryGraph} The mutated graph
 */
function markStale(graph, nodeId) {
  return removeNode(graph, nodeId);
}

// --- Query Functions ---

// @cap-todo(ac:F-034/AC-3) Graph queryable by node type and traversal depth

/**
 * Query nodes by type with optional filtering.
 * @param {MemoryGraph} graph - Graph to query
 * @param {NodeType} nodeType - Node type to filter by
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Include inactive nodes
 * @returns {GraphNode[]} Matching nodes
 */
function queryByType(graph, nodeType, options = {}) {
  const { includeInactive = false } = options;
  return Object.values(graph.nodes).filter(node => {
    if (node.type !== nodeType) return false;
    if (!includeInactive && !node.active) return false;
    return true;
  });
}

/**
 * Query neighbors of a node using BFS traversal up to N hops.
 * Returns a subgraph containing all reachable nodes and their connecting edges.
 * @param {MemoryGraph} graph - Graph to query
 * @param {string} nodeId - Starting node ID
 * @param {number} [depth=1] - Maximum traversal depth (hops)
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - Traverse inactive edges
 * @param {EdgeType[]} [options.edgeTypes] - Filter to specific edge types
 * @param {string} [options.direction='both'] - 'outgoing', 'incoming', or 'both'
 * @returns {Subgraph} Subgraph of reachable nodes and edges
 */
function queryNeighbors(graph, nodeId, depth = 1, options = {}) {
  const { includeInactive = false, edgeTypes, direction = 'both' } = options;

  const visitedNodes = new Set();
  const resultNodes = {};
  const resultEdges = [];
  const edgeSet = new Set(); // dedup edges by "source|target|type"

  // Include the starting node
  if (graph.nodes[nodeId]) {
    visitedNodes.add(nodeId);
    resultNodes[nodeId] = graph.nodes[nodeId];
  }

  // BFS
  let frontier = [nodeId];

  for (let d = 0; d < depth; d++) {
    const nextFrontier = [];

    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        // Filter by active status
        if (!includeInactive && !edge.active) continue;

        // Filter by edge type
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;

        let neighborId = null;

        if (direction === 'outgoing' || direction === 'both') {
          if (edge.source === currentId) neighborId = edge.target;
        }
        if (direction === 'incoming' || direction === 'both') {
          if (edge.target === currentId) neighborId = edge.source;
        }

        if (neighborId && !visitedNodes.has(neighborId) && graph.nodes[neighborId]) {
          const neighborNode = graph.nodes[neighborId];
          if (!includeInactive && !neighborNode.active) continue;

          visitedNodes.add(neighborId);
          resultNodes[neighborId] = neighborNode;
          nextFrontier.push(neighborId);
        }

        // Collect the edge if it connects visited nodes
        if (neighborId) {
          const edgeKey = `${edge.source}|${edge.target}|${edge.type}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            resultEdges.push(edge);
          }
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// @cap-todo(ac:F-034/AC-5) Support temporal queries — what changed between session X and session Y via timestamps

/**
 * Query nodes and edges created or updated within a date range.
 * @param {MemoryGraph} graph - Graph to query
 * @param {string} since - ISO timestamp (inclusive lower bound)
 * @param {string} [until] - ISO timestamp (inclusive upper bound, defaults to now)
 * @returns {Subgraph} Subgraph of nodes/edges within the time range
 */
function queryTemporal(graph, since, until) {
  const sinceTs = since || '1970-01-01T00:00:00Z';
  const untilTs = until || new Date().toISOString();

  const nodes = {};
  const nodeIds = new Set();

  for (const [id, node] of Object.entries(graph.nodes)) {
    const updated = node.updatedAt || node.createdAt;
    if (updated >= sinceTs && updated <= untilTs) {
      nodes[id] = node;
      nodeIds.add(id);
    }
  }

  const edges = graph.edges.filter(edge => {
    const ts = edge.createdAt;
    return ts >= sinceTs && ts <= untilTs;
  });

  return { nodes, edges };
}

// --- Build/Sync Functions ---

// @cap-todo(ac:F-034/AC-7) Graph incrementally updatable — adding new session shall not require full graph reconstruction

/**
 * Build a complete graph from all available memory sources.
 * Used for initial graph creation or full rebuild.
 * Reads memory entries (from cap-memory-engine), feature map, and thread index.
 *
 * @param {string} cwd - Absolute path to project root
 * @param {Object} [options]
 * @param {string|null} [options.appPath] - Relative app path for monorepo scoping
 * @returns {MemoryGraph}
 */
function buildFromMemory(cwd, options = {}) {
  const graph = createGraph();
  const { appPath = null } = options;

  // --- Load feature map ---
  // @cap-decision Lazy require to avoid circular dependencies — these modules are only needed during build/sync
  const { readFeatureMap } = require('./cap-feature-map.cjs');
  const featureMap = readFeatureMap(cwd, appPath);

  for (const feature of featureMap.features || []) {
    const nodeId = `feature-${feature.id.toLowerCase().replace(/-/g, '')}`;
    addNode(graph, {
      type: 'feature',
      id: nodeId,
      label: `${feature.id}: ${feature.title}`,
      active: true,
      metadata: {
        featureId: feature.id,
        state: feature.state,
        acCount: (feature.acs || []).length,
        files: feature.files || [],
      },
    });

    // Add dependency edges between features
    for (const dep of feature.dependencies || []) {
      const depNodeId = `feature-${dep.toLowerCase().replace(/-/g, '')}`;
      addEdge(graph, {
        source: nodeId,
        target: depNodeId,
        type: 'depends_on',
        metadata: {},
      });
    }
  }

  // --- Load thread index ---
  const { loadIndex, loadThread } = require('./cap-thread-tracker.cjs');
  const threadIndex = loadIndex(cwd);

  for (const entry of threadIndex.threads || []) {
    const threadNodeId = `thread-${entry.id.replace(/^thr-/, '')}`;
    const thread = loadThread(cwd, entry.id);

    addNode(graph, {
      type: 'thread',
      id: threadNodeId,
      label: entry.name,
      createdAt: entry.timestamp,
      updatedAt: entry.timestamp,
      active: true,
      metadata: {
        threadId: entry.id,
        keywords: entry.keywords || [],
        problemStatement: thread ? thread.problemStatement : '',
      },
    });

    // Link thread to features
    for (const fId of entry.featureIds || []) {
      const featureNodeId = `feature-${fId.toLowerCase().replace(/-/g, '')}`;
      addEdge(graph, {
        source: threadNodeId,
        target: featureNodeId,
        type: 'informed_by',
        metadata: {},
      });
    }

    // Link branched threads
    if (entry.parentThreadId) {
      const parentNodeId = `thread-${entry.parentThreadId.replace(/^thr-/, '')}`;
      addEdge(graph, {
        source: threadNodeId,
        target: parentNodeId,
        type: 'branched_from',
        metadata: {},
      });
    }
  }

  // --- Load memory entries from flat files ---
  const memoryDir = path.join(cwd, '.cap', 'memory');
  if (fs.existsSync(memoryDir)) {
    _ingestMemoryFiles(graph, memoryDir);
  }

  return graph;
}

/**
 * Ingest memory entries from the flat .cap/memory/*.md files into graph nodes.
 * Parses decisions.md, pitfalls.md, patterns.md, hotspots.md.
 * @param {MemoryGraph} graph - Graph to mutate
 * @param {string} memoryDir - Absolute path to .cap/memory/
 */
function _ingestMemoryFiles(graph, memoryDir) {
  const categories = {
    'decisions.md': 'decision',
    'pitfalls.md': 'pitfall',
    'patterns.md': 'pattern',
    'hotspots.md': 'hotspot',
  };

  for (const [filename, category] of Object.entries(categories)) {
    const filePath = path.join(memoryDir, filename);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const entries = _parseMarkdownEntries(content, category);

      for (const entry of entries) {
        const nodeId = generateNodeId(category, entry.label);
        addNode(graph, {
          type: category,
          id: nodeId,
          label: entry.label,
          active: true,
          metadata: {
            ...entry.metadata,
            sourceFile: filename,
          },
        });

        // Link to features mentioned in metadata
        for (const fId of entry.features || []) {
          const featureNodeId = `feature-${fId.toLowerCase().replace(/-/g, '')}`;
          if (graph.nodes[featureNodeId]) {
            addEdge(graph, {
              source: nodeId,
              target: featureNodeId,
              type: 'relates_to',
              metadata: {},
            });
          }
        }
      }
    } catch (_e) {
      // Skip unparseable files
    }
  }
}

/**
 * Parse markdown memory files into structured entries.
 * @param {string} content - Markdown content
 * @param {string} category - Memory category
 * @returns {Array<{label: string, metadata: Object, features: string[]}>}
 */
function _parseMarkdownEntries(content, category) {
  const entries = [];

  if (category === 'hotspot') {
    // Parse table rows: | Rank | File | Sessions | Edits | Since |
    const rowRe = /^\|\s*(?:<a id="[^"]*"><\/a>)?\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^\s|]+)/gm;
    let match;
    while ((match = rowRe.exec(content)) !== null) {
      entries.push({
        label: `Hotspot: ${match[1]}`,
        metadata: { file: match[1], sessions: parseInt(match[2], 10), edits: parseInt(match[3], 10), since: match[4] },
        features: [],
      });
    }
  } else {
    // Parse heading entries: ### <a id="..."></a>Content
    const headingRe = /^###\s+(?:<a id="[^"]*"><\/a>)?(.+?)(?:\s*\*\*\[pinned\]\*\*)?$/gm;
    let match;
    while ((match = headingRe.exec(content)) !== null) {
      const label = match[1].trim();
      // Extract features from following lines
      const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 300);
      const featureRe = /F-\d{3}/g;
      const features = [];
      let fMatch;
      while ((fMatch = featureRe.exec(afterMatch)) !== null) {
        features.push(fMatch[0]);
      }
      entries.push({
        label,
        metadata: { pinned: match[0].includes('[pinned]') },
        features: [...new Set(features)],
      });
    }
  }

  return entries;
}

/**
 * Incrementally update the graph with new memory entries.
 * Does NOT require full rebuild — only processes the new entries.
 *
 * @param {MemoryGraph} graph - Existing graph to update
 * @param {import('./cap-memory-engine.cjs').MemoryEntry[]} newEntries - New memory entries from accumulation
 * @param {Object} [options]
 * @param {string[]} [options.staleNodeIds] - Node IDs to mark as stale
 * @returns {MemoryGraph} The mutated graph
 */
function incrementalUpdate(graph, newEntries, options = {}) {
  const { staleNodeIds = [] } = options;

  // Add new entries as nodes
  for (const entry of newEntries) {
    const nodeId = generateNodeId(entry.category, entry.content);
    addNode(graph, {
      type: entry.category,
      id: nodeId,
      label: entry.content,
      active: true,
      metadata: {
        source: entry.metadata.source,
        file: entry.file,
        relatedFiles: entry.metadata.relatedFiles || [],
        pinned: entry.metadata.pinned || false,
        sessions: entry.metadata.sessions,
        edits: entry.metadata.edits,
      },
    });

    // Link to features
    for (const fId of entry.metadata.features || []) {
      const featureNodeId = `feature-${fId.toLowerCase().replace(/-/g, '')}`;
      if (graph.nodes[featureNodeId]) {
        addEdge(graph, {
          source: nodeId,
          target: featureNodeId,
          type: 'relates_to',
          metadata: {},
        });
      }
    }
  }

  // Mark stale nodes
  for (const nodeId of staleNodeIds) {
    markStale(graph, nodeId);
  }

  return graph;
}

// @cap-todo(ac:F-034/AC-4) Flat memory files (decisions.md, hotspots.md, patterns.md, pitfalls.md) remain as human-readable views generated from graph

/**
 * Generate flat markdown view content from graph nodes.
 * Returns content strings suitable for writing to .cap/memory/*.md files.
 * Delegates to cap-memory-dir.cjs for actual markdown formatting.
 *
 * @param {MemoryGraph} graph - Graph to generate views from
 * @returns {import('./cap-memory-engine.cjs').MemoryEntry[]} Memory entries suitable for writeMemoryDirectory()
 */
function generateViews(graph) {
  const entries = [];

  for (const node of Object.values(graph.nodes)) {
    if (!node.active) continue;
    if (!['decision', 'pitfall', 'pattern', 'hotspot'].includes(node.type)) continue;

    entries.push({
      category: node.type,
      file: node.metadata.file || null,
      content: node.label,
      metadata: {
        source: node.metadata.source || node.createdAt,
        branch: node.metadata.branch || null,
        relatedFiles: node.metadata.relatedFiles || [],
        features: _getRelatedFeatureIds(graph, node.id),
        pinned: node.metadata.pinned || false,
        sessions: node.metadata.sessions,
        edits: node.metadata.edits,
        confirmations: node.metadata.confirmations,
      },
    });
  }

  return entries;
}

/**
 * Get feature IDs connected to a node via relates_to or informed_by edges.
 * @param {MemoryGraph} graph
 * @param {string} nodeId
 * @returns {string[]}
 */
function _getRelatedFeatureIds(graph, nodeId) {
  const featureIds = [];
  for (const edge of graph.edges) {
    if (!edge.active) continue;
    if (edge.source !== nodeId && edge.target !== nodeId) continue;

    const otherId = edge.source === nodeId ? edge.target : edge.source;
    const otherNode = graph.nodes[otherId];
    if (otherNode && otherNode.type === 'feature' && otherNode.metadata.featureId) {
      featureIds.push(otherNode.metadata.featureId);
    }
  }
  return [...new Set(featureIds)];
}

// --- Serialization / I/O ---

// @cap-todo(ac:F-034/AC-8) Graph data git-committable and merge-friendly — sorted keys, one-entry-per-line JSON

/**
 * Serialize graph to merge-friendly JSON string.
 * - Top-level keys sorted
 * - Nodes object sorted by key
 * - Edges array sorted by [source, target, type]
 * - 2-space indent for readability
 *
 * @param {MemoryGraph} graph - Graph to serialize
 * @returns {string} JSON string
 */
function serializeGraph(graph) {
  // Sort nodes by key
  const sortedNodes = {};
  const nodeKeys = Object.keys(graph.nodes).sort();
  for (const key of nodeKeys) {
    sortedNodes[key] = graph.nodes[key];
  }

  // Sort edges by [source, target, type]
  const sortedEdges = [...graph.edges].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return a.type.localeCompare(b.type);
  });

  const output = {
    version: graph.version,
    lastUpdated: graph.lastUpdated,
    nodes: sortedNodes,
    edges: sortedEdges,
  };

  return JSON.stringify(output, null, 2) + '\n';
}

/**
 * Load graph from .cap/memory/graph.json.
 * Returns empty graph if file does not exist.
 *
 * @param {string} cwd - Absolute path to project root
 * @returns {MemoryGraph}
 */
function loadGraph(cwd) {
  const filePath = path.join(cwd, GRAPH_FILE);
  try {
    if (!fs.existsSync(filePath)) return createGraph();
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    // Forward-compatible merge with defaults
    return {
      version: parsed.version || GRAPH_VERSION,
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
      nodes: parsed.nodes || {},
      edges: parsed.edges || [],
    };
  } catch (_e) {
    return createGraph();
  }
}

/**
 * Save graph to .cap/memory/graph.json.
 * Creates directory if needed.
 *
 * @param {string} cwd - Absolute path to project root
 * @param {MemoryGraph} graph - Graph to save
 */
function saveGraph(cwd, graph) {
  const filePath = path.join(cwd, GRAPH_FILE);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, serializeGraph(graph), 'utf8');
}

// --- Exports ---

module.exports = {
  // Core graph operations
  createGraph,
  addNode,
  addEdge,
  removeNode,
  markStale,
  generateNodeId,

  // Query functions
  queryByType,
  queryNeighbors,
  queryTemporal,

  // Build/sync functions
  buildFromMemory,
  incrementalUpdate,
  generateViews,

  // Serialization / I/O
  serializeGraph,
  loadGraph,
  saveGraph,

  // Constants
  GRAPH_FILE,
  GRAPH_VERSION,
  EDGE_TYPES,
  NODE_TYPES,

  // Internal (for testing)
  _ingestMemoryFiles,
  _parseMarkdownEntries,
  _getRelatedFeatureIds,
};
