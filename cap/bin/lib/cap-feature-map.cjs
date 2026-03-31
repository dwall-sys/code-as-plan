// @gsd-context CAP v2.0 Feature Map reader/writer -- FEATURE-MAP.md is the single source of truth for all features, ACs, status, and dependencies.
// @gsd-decision Markdown format for Feature Map (not JSON/YAML) -- human-readable, diffable in git, editable in any text editor. Machine-readable via regex parsing of structured table rows.
// @gsd-decision Read and write are separate operations -- no in-memory mutation API. Read returns structured data, write takes structured data and serializes to markdown.
// @gsd-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @gsd-pattern Feature Map is the bridge between all CAP workflows. Brainstorm writes entries, scan updates status, status reads for dashboard.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FEATURE_MAP_FILE = 'FEATURE-MAP.md';

// @gsd-todo(ref:AC-9) Feature state lifecycle: planned -> prototyped -> tested -> shipped
const VALID_STATES = ['planned', 'prototyped', 'tested', 'shipped'];
const STATE_TRANSITIONS = {
  planned: ['prototyped'],
  prototyped: ['tested'],
  tested: ['shipped'],
  shipped: [],
};

/**
 * @typedef {Object} AcceptanceCriterion
 * @property {string} id - AC identifier (e.g., "AC-1")
 * @property {string} description - Imperative description text
 * @property {'pending'|'implemented'|'tested'|'reviewed'} status - Current status
 */

/**
 * @typedef {Object} Feature
 * @property {string} id - Feature ID (e.g., "F-001")
 * @property {string} title - Feature title (verb+object format)
 * @property {'planned'|'prototyped'|'tested'|'shipped'} state - Feature lifecycle state
 * @property {AcceptanceCriterion[]} acs - Acceptance criteria
 * @property {string[]} files - File references linked to this feature
 * @property {string[]} dependencies - Feature IDs this depends on
 * @property {Object<string,string>} metadata - Additional key-value metadata
 */

/**
 * @typedef {Object} FeatureMap
 * @property {Feature[]} features - All features
 * @property {string} lastScan - ISO timestamp of last scan
 */

// @gsd-todo(ref:AC-7) Feature Map is a single Markdown file at the project root named FEATURE-MAP.md

// @gsd-todo(ref:AC-1) Generate empty FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries
/**
 * Generate the empty FEATURE-MAP.md template for /cap:init.
 * @returns {string}
 */
function generateTemplate() {
  return `# Feature Map

> Single source of truth for feature identity, state, acceptance criteria, and relationships.
> Auto-enriched by \`@cap-feature\` tags and dependency analysis.

## Features

<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: ${new Date().toISOString()}*
`;
}

// @gsd-api readFeatureMap(projectRoot) -- Reads and parses FEATURE-MAP.md from project root.
// Returns: FeatureMap object with features and lastScan timestamp.
// @gsd-todo(ref:AC-10) Feature Map is the single source of truth for feature identity, state, ACs, and relationships
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {FeatureMap}
 */
function readFeatureMap(projectRoot) {
  const filePath = path.join(projectRoot, FEATURE_MAP_FILE);
  if (!fs.existsSync(filePath)) {
    return { features: [], lastScan: null };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return parseFeatureMapContent(content);
}

// @gsd-todo(ref:AC-8) Each feature entry contains: feature ID, title, state, ACs, and file references
// @gsd-todo(ref:AC-14) Feature Map scales to 80-120 features in a single file
/**
 * Parse FEATURE-MAP.md content into structured data.
 * @param {string} content - Raw markdown content
 * @returns {FeatureMap}
 */
function parseFeatureMapContent(content) {
  const features = [];
  const lines = content.split('\n');

  // Match feature headers: ### F-001: Title text [state]
  const featureHeaderRE = /^###\s+(F-\d{3}):\s+(.+?)\s+\[(\w+)\]\s*$/;
  // Match AC rows: | AC-N | status | description |
  const acRowRE = /^\|\s*(AC-\d+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|/;
  // Match file refs: - `path/to/file`
  const fileRefRE = /^-\s+`(.+?)`/;
  // Match dependencies: **Depends on:** F-001, F-002
  const depsRE = /^\*\*Depends on:\*\*\s*(.+)/;
  // Match lastScan in footer
  const lastScanRE = /^\*Last updated:\s*(.+?)\*$/;

  let currentFeature = null;
  let inAcTable = false;
  let inFileRefs = false;
  let lastScan = null;

  for (const line of lines) {
    const headerMatch = line.match(featureHeaderRE);
    if (headerMatch) {
      if (currentFeature) features.push(currentFeature);
      currentFeature = {
        id: headerMatch[1],
        title: headerMatch[2],
        state: headerMatch[3],
        acs: [],
        files: [],
        dependencies: [],
        metadata: {},
      };
      inAcTable = false;
      inFileRefs = false;
      continue;
    }

    if (!currentFeature) {
      const scanMatch = line.match(lastScanRE);
      if (scanMatch) lastScan = scanMatch[1].trim();
      continue;
    }

    // Detect AC table start
    if (line.startsWith('| AC') && line.includes('Status')) {
      inAcTable = true;
      inFileRefs = false;
      continue;
    }
    // Skip table separator
    if (line.match(/^\|[\s-]+\|/)) continue;

    const acMatch = line.match(acRowRE);
    if (acMatch && inAcTable) {
      currentFeature.acs.push({
        id: acMatch[1],
        description: acMatch[3].trim(),
        status: acMatch[2].toLowerCase(),
      });
      continue;
    }

    // File references section
    if (line.startsWith('**Files:**')) {
      inFileRefs = true;
      inAcTable = false;
      continue;
    }

    if (inFileRefs) {
      const refMatch = line.match(fileRefRE);
      if (refMatch) {
        currentFeature.files.push(refMatch[1]);
        continue;
      } else if (line.trim() === '') {
        inFileRefs = false;
      }
    }

    // Dependencies
    const depsMatch = line.match(depsRE);
    if (depsMatch) {
      currentFeature.dependencies = depsMatch[1].split(',').map(d => d.trim()).filter(Boolean);
      continue;
    }

    const scanMatch = line.match(lastScanRE);
    if (scanMatch) lastScan = scanMatch[1].trim();
  }

  if (currentFeature) features.push(currentFeature);

  return { features, lastScan };
}

// @gsd-api writeFeatureMap(projectRoot, featureMap) -- Serializes FeatureMap to FEATURE-MAP.md.
// Side effect: overwrites FEATURE-MAP.md at project root.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {FeatureMap} featureMap - Structured feature map data
 */
function writeFeatureMap(projectRoot, featureMap) {
  const filePath = path.join(projectRoot, FEATURE_MAP_FILE);
  const content = serializeFeatureMap(featureMap);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Serialize FeatureMap to markdown string.
 * @param {FeatureMap} featureMap
 * @returns {string}
 */
function serializeFeatureMap(featureMap) {
  const lines = [
    '# Feature Map',
    '',
    '> Single source of truth for feature identity, state, acceptance criteria, and relationships.',
    '> Auto-enriched by `@cap-feature` tags and dependency analysis.',
    '',
    '## Features',
    '',
  ];

  for (const feature of featureMap.features) {
    lines.push(`### ${feature.id}: ${feature.title} [${feature.state}]`);
    lines.push('');

    if (feature.dependencies.length > 0) {
      lines.push(`**Depends on:** ${feature.dependencies.join(', ')}`);
      lines.push('');
    }

    if (feature.acs.length > 0) {
      lines.push('| AC | Status | Description |');
      lines.push('|----|--------|-------------|');
      for (const ac of feature.acs) {
        lines.push(`| ${ac.id} | ${ac.status} | ${ac.description} |`);
      }
      lines.push('');
    }

    if (feature.files.length > 0) {
      lines.push('**Files:**');
      for (const file of feature.files) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
  }

  if (featureMap.features.length === 0) {
    lines.push('<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->');
    lines.push('');
  }

  lines.push('## Legend');
  lines.push('');
  lines.push('| State | Meaning |');
  lines.push('|-------|---------|');
  lines.push('| planned | Feature identified, not yet implemented |');
  lines.push('| prototyped | Initial implementation exists |');
  lines.push('| tested | Tests written and passing |');
  lines.push('| shipped | Deployed / merged to main |');
  lines.push('');
  lines.push('---');
  lines.push(`*Last updated: ${new Date().toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}

// @gsd-api addFeature(projectRoot, feature) -- Add a new feature entry to FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {{ title: string, acs?: AcceptanceCriterion[], dependencies?: string[], metadata?: Object }} feature - Feature data (ID auto-generated)
 * @returns {Feature} - The added feature with generated ID
 */
function addFeature(projectRoot, feature) {
  const featureMap = readFeatureMap(projectRoot);
  const id = getNextFeatureId(featureMap.features);
  const newFeature = {
    id,
    title: feature.title,
    state: 'planned',
    acs: feature.acs || [],
    files: [],
    dependencies: feature.dependencies || [],
    metadata: feature.metadata || {},
  };
  featureMap.features.push(newFeature);
  writeFeatureMap(projectRoot, featureMap);
  return newFeature;
}

// @gsd-api updateFeatureState(projectRoot, featureId, newState) -- Transition feature state.
// @gsd-todo(ref:AC-9) Enforce valid state transitions: planned->prototyped->tested->shipped
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} featureId - Feature ID (e.g., "F-001")
 * @param {string} newState - Target state
 * @returns {boolean} - True if transition was valid and applied
 */
function updateFeatureState(projectRoot, featureId, newState) {
  if (!VALID_STATES.includes(newState)) return false;

  const featureMap = readFeatureMap(projectRoot);
  const feature = featureMap.features.find(f => f.id === featureId);
  if (!feature) return false;

  const allowed = STATE_TRANSITIONS[feature.state];
  if (!allowed || !allowed.includes(newState)) return false;

  feature.state = newState;
  writeFeatureMap(projectRoot, featureMap);
  return true;
}

// @gsd-api enrichFromTags(projectRoot, scanResults) -- Update file references from tag scan.
// @gsd-todo(ref:AC-12) Feature Map auto-enriched from @cap-feature tags found in source code
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults - Tags from cap-tag-scanner
 * @returns {FeatureMap}
 */
function enrichFromTags(projectRoot, scanResults) {
  const featureMap = readFeatureMap(projectRoot);

  for (const tag of scanResults) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference if not already present
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }
  }

  writeFeatureMap(projectRoot, featureMap);
  return featureMap;
}

// @gsd-api enrichFromDeps(projectRoot) -- Read package.json, detect imports, add dependency info to features.
// @gsd-todo(ref:AC-13) Feature Map auto-enriched from dependency graph analysis, env vars, package.json
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ dependencies: string[], devDependencies: string[], envVars: string[] }}
 */
function enrichFromDeps(projectRoot) {
  const result = { dependencies: [], devDependencies: [], envVars: [] };

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dependencies) result.dependencies = Object.keys(pkg.dependencies);
      if (pkg.devDependencies) result.devDependencies = Object.keys(pkg.devDependencies);
    } catch (_e) {
      // Malformed package.json
    }
  }

  // Scan for .env file to detect environment variables
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envRE = /^([A-Z_][A-Z0-9_]*)=/gm;
      let match;
      while ((match = envRE.exec(envContent)) !== null) {
        result.envVars.push(match[1]);
      }
    } catch (_e) {
      // Ignore
    }
  }

  return result;
}

// @gsd-api getNextFeatureId(features) -- Generate next F-NNN ID.
/**
 * @param {Feature[]} features - Existing features
 * @returns {string} - Next feature ID (e.g., "F-001")
 */
function getNextFeatureId(features) {
  if (!features || features.length === 0) return 'F-001';

  let maxNum = 0;
  for (const f of features) {
    const match = f.id.match(/^F-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `F-${String(maxNum + 1).padStart(3, '0')}`;
}

// @gsd-api enrichFromScan(featureMap, tags) -- Updates Feature Map status from tag scan results.
// Returns: updated FeatureMap with AC statuses reflecting code annotations.
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} tags - Tags from cap-tag-scanner
 * @returns {FeatureMap}
 */
function enrichFromScan(featureMap, tags) {
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }

    // If AC reference in metadata, mark it as implemented
    const acRef = tag.metadata.ac;
    if (acRef) {
      const ac = feature.acs.find(a => a.id === acRef);
      if (ac && ac.status === 'pending') {
        ac.status = 'implemented';
      }
    }
  }

  return featureMap;
}

// @gsd-api addFeatures(featureMap, newFeatures) -- Adds new features to an existing Feature Map (from brainstorm).
// @gsd-todo(ref:AC-11) Feature Map supports auto-derivation from brainstorm output
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {Feature[]} newFeatures - Features to add
 * @returns {FeatureMap}
 */
function addFeatures(featureMap, newFeatures) {
  const existingIds = new Set(featureMap.features.map(f => f.id));
  const existingTitles = new Set(featureMap.features.map(f => f.title.toLowerCase()));

  for (const nf of newFeatures) {
    // Skip duplicates by ID or title
    if (existingIds.has(nf.id)) continue;
    if (existingTitles.has(nf.title.toLowerCase())) continue;

    featureMap.features.push(nf);
    existingIds.add(nf.id);
    existingTitles.add(nf.title.toLowerCase());
  }

  return featureMap;
}

// @gsd-api getStatus(featureMap) -- Computes aggregate project status from Feature Map.
/**
 * @param {FeatureMap} featureMap
 * @returns {{ totalFeatures: number, completedFeatures: number, totalACs: number, implementedACs: number, testedACs: number, reviewedACs: number }}
 */
function getStatus(featureMap) {
  let totalFeatures = featureMap.features.length;
  let completedFeatures = featureMap.features.filter(f => f.state === 'shipped').length;
  let totalACs = 0;
  let implementedACs = 0;
  let testedACs = 0;
  let reviewedACs = 0;

  for (const f of featureMap.features) {
    totalACs += f.acs.length;
    for (const ac of f.acs) {
      if (ac.status === 'implemented') implementedACs++;
      if (ac.status === 'tested') testedACs++;
      if (ac.status === 'reviewed') reviewedACs++;
    }
  }

  return { totalFeatures, completedFeatures, totalACs, implementedACs, testedACs, reviewedACs };
}

module.exports = {
  FEATURE_MAP_FILE,
  VALID_STATES,
  STATE_TRANSITIONS,
  generateTemplate,
  readFeatureMap,
  writeFeatureMap,
  parseFeatureMapContent,
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
  enrichFromTags,
  enrichFromDeps,
  getNextFeatureId,
  enrichFromScan,
  addFeatures,
  getStatus,
};
