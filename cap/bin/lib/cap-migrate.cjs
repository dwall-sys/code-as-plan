// @cap-feature(feature:F-006) GSD-to-CAP Migration — convert @gsd-* tags, planning artifacts, and session format to CAP v2.0
// @cap-todo decision: Regex-based tag replacement (not AST) -- language-agnostic, zero dependencies, handles all comment styles.
// @cap-todo risk: Destructive file writes -- dry-run mode is the default safety net.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// --- Constants ---

const GSD_TAG_RE = /(@gsd-(feature|todos?|risk|decision|context|status|depends|ref|pattern|api|constraint|placeholder|concern))(\([^)]*\))?\s*(.*)/;

const SUPPORTED_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.sh', '.md'];
const EXCLUDE_DIRS = ['node_modules', '.git', '.cap', 'dist', 'build', 'coverage'];

const GSD_ARTIFACTS = [
  '.planning/FEATURES.md',
  '.planning/REQUIREMENTS.md',
  '.planning/PRD.md',
  '.planning/ROADMAP.md',
  '.planning/STATE.md',
  '.planning/CODE-INVENTORY.md',
  '.planning/BRAINSTORM-LEDGER.md',
  '.planning/SESSION.json',
];

// --- Tag migration ---

/**
 * @typedef {Object} TagChange
 * @property {string} file - Relative file path
 * @property {number} line - 1-based line number
 * @property {string} original - Original line content
 * @property {string} replaced - Replacement line content (or null if removed)
 * @property {string} action - 'converted' | 'removed' | 'plain-comment'
 */

/**
 * Apply tag migration to a single line.
 * @param {string} line - Source line
 * @returns {{ replaced: string, action: string } | null} - null if no @gsd- tag found
 */
function migrateLineTag(line) {
  const match = line.match(GSD_TAG_RE);
  if (!match) return null;

  const fullTag = match[1];       // e.g., @gsd-feature
  const tagType = match[2];       // e.g., feature
  const metadata = match[3] || ''; // e.g., (ref:AC-20)
  const description = match[4] || '';

  switch (tagType) {
    case 'feature':
      return {
        replaced: line.replace(fullTag, '@cap-feature'),
        action: 'converted',
      };

    case 'todo':
      return {
        replaced: line.replace(fullTag, '@cap-todo'),
        action: 'converted',
      };

    case 'risk':
      // @gsd-risk Some risk → @cap-todo risk: Some risk
      return {
        replaced: line.replace(fullTag + metadata + (description ? ' ' : ''), '@cap-todo' + metadata + ' risk: ').replace(/  +/g, ' '),
        action: 'converted',
      };

    case 'decision':
      // @gsd-decision Some decision → @cap-todo decision: Some decision
      return {
        replaced: line.replace(fullTag + metadata + (description ? ' ' : ''), '@cap-todo' + metadata + ' decision: ').replace(/  +/g, ' '),
        action: 'converted',
      };

    case 'constraint':
      // @gsd-constraint Some constraint → @cap-todo risk: [constraint] Some constraint
      return {
        replaced: line.replace(fullTag + metadata + (description ? ' ' : ''), '@cap-todo' + metadata + ' risk: [constraint] ').replace(/  +/g, ' '),
        action: 'converted',
      };

    case 'context':
      // @gsd-context Some context → plain comment (remove the tag)
      return {
        replaced: line.replace(fullTag + metadata + ' ', '').replace(fullTag + metadata, ''),
        action: 'plain-comment',
      };

    case 'status':
    case 'depends':
      // Remove entirely (convert to plain comment to avoid losing info)
      return {
        replaced: line.replace(fullTag + metadata + ' ', '').replace(fullTag + metadata, ''),
        action: 'removed',
      };

    case 'ref':
      // Keep as @cap-ref if it has content, otherwise remove
      if (description.trim()) {
        return {
          replaced: line.replace(fullTag, '@cap-ref'),
          action: 'converted',
        };
      }
      return {
        replaced: line.replace(fullTag + metadata + ' ', '').replace(fullTag + metadata, ''),
        action: 'removed',
      };

    case 'pattern':
    case 'api':
      // Convert to plain comment (remove the tag prefix)
      return {
        replaced: line.replace(fullTag + metadata + ' ', '').replace(fullTag + metadata, ''),
        action: 'plain-comment',
      };

    case 'todos':
      // @gsd-todos (plural typo) → @cap-todo
      return {
        replaced: line.replace(fullTag, '@cap-todo'),
        action: 'converted',
      };

    case 'placeholder':
      // @gsd-placeholder → @cap-todo (placeholder is a todo variant)
      return {
        replaced: line.replace(fullTag, '@cap-todo'),
        action: 'converted',
      };

    case 'concern':
      // @gsd-concern → @cap-todo risk: (concerns are risks)
      return {
        replaced: line.replace(fullTag + metadata + (description ? ' ' : ''), '@cap-todo' + metadata + ' risk: ').replace(/  +/g, ' '),
        action: 'converted',
      };

    default:
      return null;
  }
}

/**
 * Scan all source files and replace @gsd-* tags with @cap-* equivalents.
 *
 * Mapping:
 *   @gsd-feature    → @cap-feature
 *   @gsd-todo       → @cap-todo
 *   @gsd-risk       → @cap-todo risk:
 *   @gsd-decision   → @cap-todo decision:
 *   @gsd-context    → plain comment (tag removed)
 *   @gsd-status     → plain comment (tag removed)
 *   @gsd-depends    → plain comment (tag removed)
 *   @gsd-ref        → @cap-ref (if content exists) or removed
 *   @gsd-pattern    → plain comment (tag removed)
 *   @gsd-api        → plain comment (tag removed)
 *   @gsd-constraint → @cap-todo risk: [constraint]
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, report changes without writing
 * @param {string[]} [options.extensions] - File extensions to process
 * @returns {{ filesScanned: number, filesModified: number, tagsConverted: number, tagsRemoved: number, changes: TagChange[] }}
 */
function migrateTags(projectRoot, options = {}) {
  const dryRun = options.dryRun || false;
  const extensions = options.extensions || SUPPORTED_EXTENSIONS;
  const result = {
    filesScanned: 0,
    filesModified: 0,
    tagsConverted: 0,
    tagsRemoved: 0,
    changes: [],
  };

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) continue;
        processFile(fullPath);
      }
    }
  }

  function processFile(filePath) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      return;
    }

    result.filesScanned++;
    const relativePath = path.relative(projectRoot, filePath);
    const lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const migration = migrateLineTag(lines[i]);
      if (!migration) continue;

      const change = {
        file: relativePath,
        line: i + 1,
        original: lines[i],
        replaced: migration.replaced,
        action: migration.action,
      };
      result.changes.push(change);

      if (migration.action === 'converted') {
        result.tagsConverted++;
      } else {
        result.tagsRemoved++;
      }

      lines[i] = migration.replaced;
      modified = true;
    }

    if (modified) {
      result.filesModified++;
      if (!dryRun) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      }
    }
  }

  walk(projectRoot);
  return result;
}

// --- Artifact migration ---

/**
 * Convert .planning/FEATURES.md or REQUIREMENTS.md into FEATURE-MAP.md format.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, report without writing
 * @returns {{ featuresFound: number, featureMapCreated: boolean, source: string }}
 */
function migrateArtifacts(projectRoot, options = {}) {
  const dryRun = options.dryRun || false;
  const result = { featuresFound: 0, featureMapCreated: false, source: 'none' };

  // Check if FEATURE-MAP.md already exists
  const featureMapPath = path.join(projectRoot, 'FEATURE-MAP.md');
  const featureMapExists = fs.existsSync(featureMapPath);

  // Try reading source artifacts in priority order
  let sourceContent = null;
  let sourceName = null;

  const sources = [
    { file: '.planning/FEATURES.md', name: 'FEATURES.md' },
    { file: '.planning/REQUIREMENTS.md', name: 'REQUIREMENTS.md' },
    { file: '.planning/PRD.md', name: 'PRD.md' },
  ];

  for (const src of sources) {
    const srcPath = path.join(projectRoot, src.file);
    if (fs.existsSync(srcPath)) {
      try {
        sourceContent = fs.readFileSync(srcPath, 'utf8');
        sourceName = src.name;
        result.source = src.name;
        break;
      } catch (_e) {
        continue;
      }
    }
  }

  if (!sourceContent) return result;

  // Extract features from the source artifact
  const features = extractFeaturesFromLegacy(sourceContent);
  result.featuresFound = features.length;

  if (features.length === 0) return result;

  if (featureMapExists) {
    // Merge into existing Feature Map
    const capFeatureMap = require('./cap-feature-map.cjs');
    if (!dryRun) {
      // @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
      // @cap-decision(F-081/iter2) Bail on parseError — do not persist partial enrichment.
      const existing = capFeatureMap.readFeatureMap(projectRoot, undefined, { safe: true });
      if (existing && existing.parseError) {
        console.warn('cap: migrate aborted — duplicate feature ID detected: ' + String(existing.parseError.message).trim());
        return result;
      }
      const existingTitles = new Set(existing.features.map(f => f.title.toLowerCase()));

      for (const feature of features) {
        if (!existingTitles.has(feature.title.toLowerCase())) {
          capFeatureMap.addFeature(projectRoot, feature);
        }
      }
      result.featureMapCreated = true;
    }
  } else {
    // Create new Feature Map
    if (!dryRun) {
      const capFeatureMap = require('./cap-feature-map.cjs');
      const template = capFeatureMap.generateTemplate();
      fs.writeFileSync(featureMapPath, template, 'utf8');
      for (const feature of features) {
        capFeatureMap.addFeature(projectRoot, feature);
      }
      result.featureMapCreated = true;
    } else {
      result.featureMapCreated = true; // Would be created
    }
  }

  return result;
}

/**
 * Extract feature entries from legacy GSD planning artifacts.
 * Looks for markdown headings, list items with feature-like patterns.
 *
 * @param {string} content - Markdown content of legacy artifact
 * @returns {{ title: string, acs: Array, dependencies: string[] }[]}
 */
function extractFeaturesFromLegacy(content) {
  const features = [];
  const lines = content.split('\n');

  // Match headings that look like features: ## Feature Name, ### Feature Name, ## 1. Feature Name
  const featureHeadingRE = /^#{2,4}\s+(?:\d+\.\s*)?(?:Feature:\s*)?(.+?)(?:\s*\[.*\])?\s*$/;
  // Match list items that look like acceptance criteria: - [ ] description, - [x] description
  const acRE = /^[-*]\s+\[([x ])\]\s+(.+)/i;
  // Match plain list items as potential ACs
  const plainListRE = /^[-*]\s+(?!#)(.+)/;

  let currentFeature = null;
  let acCounter = 0;

  for (const line of lines) {
    const headingMatch = line.match(featureHeadingRE);
    if (headingMatch) {
      if (currentFeature && currentFeature.title) {
        features.push(currentFeature);
      }
      currentFeature = {
        title: headingMatch[1].trim(),
        acs: [],
        dependencies: [],
      };
      acCounter = 0;
      continue;
    }

    if (currentFeature) {
      const acMatch = line.match(acRE);
      if (acMatch) {
        acCounter++;
        currentFeature.acs.push({
          id: `AC-${acCounter}`,
          description: acMatch[2].trim(),
          status: acMatch[1] === 'x' || acMatch[1] === 'X' ? 'implemented' : 'pending',
        });
        continue;
      }

      // Empty line after ACs but before next heading -- stop collecting ACs
      if (line.trim() === '' && currentFeature.acs.length > 0) {
        // Keep collecting -- next heading or feature resets
      }
    }
  }

  if (currentFeature && currentFeature.title) {
    features.push(currentFeature);
  }

  return features;
}

// --- Session migration ---

/**
 * Migrate .planning/SESSION.json to .cap/SESSION.json format.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, report without writing
 * @returns {{ migrated: boolean, oldFormat: string, newFormat: string }}
 */
function migrateSession(projectRoot, options = {}) {
  const dryRun = options.dryRun || false;
  const result = { migrated: false, oldFormat: 'none', newFormat: 'none' };

  const oldSessionPath = path.join(projectRoot, '.planning', 'SESSION.json');
  if (!fs.existsSync(oldSessionPath)) return result;

  let oldSession;
  try {
    const content = fs.readFileSync(oldSessionPath, 'utf8');
    oldSession = JSON.parse(content);
    result.oldFormat = 'v1.x';
  } catch (_e) {
    result.oldFormat = 'corrupt';
    return result;
  }

  // Map old session fields to new CAP session format
  const capSession = require('./cap-session.cjs');
  const newSession = capSession.getDefaultSession();

  // Map known v1.x fields
  if (oldSession.current_app) {
    newSession.metadata.legacyApp = oldSession.current_app;
  }
  if (oldSession.current_phase) {
    newSession.step = `legacy-phase-${oldSession.current_phase}`;
  }
  if (oldSession.started_at || oldSession.startedAt) {
    newSession.startedAt = oldSession.started_at || oldSession.startedAt;
  }
  if (oldSession.last_command || oldSession.lastCommand) {
    newSession.lastCommand = oldSession.last_command || oldSession.lastCommand;
  }

  // Preserve all old fields as metadata for reference
  for (const [key, value] of Object.entries(oldSession)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      newSession.metadata[`gsd_${key}`] = String(value);
    }
  }

  result.newFormat = 'v2.0';

  if (!dryRun) {
    capSession.initCapDirectory(projectRoot);
    capSession.saveSession(projectRoot, newSession);
    result.migrated = true;
  } else {
    result.migrated = true; // Would be migrated
  }

  return result;
}

// --- Analysis ---

/**
 * Generate a migration report summarizing what was found and what needs attention.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ gsdTagCount: number, gsdArtifacts: string[], planningDir: boolean, sessionJson: boolean, recommendations: string[] }}
 */
function analyzeMigration(projectRoot) {
  const result = {
    gsdTagCount: 0,
    gsdArtifacts: [],
    planningDir: false,
    sessionJson: false,
    recommendations: [],
  };

  // Check for .planning/ directory
  const planningDir = path.join(projectRoot, '.planning');
  result.planningDir = fs.existsSync(planningDir);

  // Check for known GSD artifacts
  for (const artifact of GSD_ARTIFACTS) {
    const artifactPath = path.join(projectRoot, artifact);
    if (fs.existsSync(artifactPath)) {
      result.gsdArtifacts.push(artifact);
    }
  }

  // Check for .planning/SESSION.json specifically
  result.sessionJson = fs.existsSync(path.join(projectRoot, '.planning', 'SESSION.json'));

  // Count @gsd-* tags in source files
  const tagResult = migrateTags(projectRoot, { dryRun: true });
  result.gsdTagCount = tagResult.tagsConverted + tagResult.tagsRemoved;

  // Build recommendations
  if (result.gsdTagCount > 0) {
    result.recommendations.push(`Found ${result.gsdTagCount} @gsd-* tags to migrate. Run /cap:migrate to convert them to @cap-* tags.`);
  }

  if (result.gsdArtifacts.length > 0) {
    result.recommendations.push(`Found ${result.gsdArtifacts.length} legacy planning artifacts: ${result.gsdArtifacts.join(', ')}. These can be converted to FEATURE-MAP.md entries.`);
  }

  if (result.sessionJson) {
    result.recommendations.push('Found .planning/SESSION.json. This can be migrated to .cap/SESSION.json format.');
  }

  if (!fs.existsSync(path.join(projectRoot, 'FEATURE-MAP.md'))) {
    result.recommendations.push('No FEATURE-MAP.md found. Migration will create one from existing artifacts.');
  }

  if (!fs.existsSync(path.join(projectRoot, '.cap'))) {
    result.recommendations.push('No .cap/ directory found. Migration will initialize it.');
  }

  if (result.gsdTagCount === 0 && result.gsdArtifacts.length === 0 && !result.sessionJson) {
    result.recommendations.push('No GSD v1.x artifacts detected. This project may already be using CAP v2.0 or is a fresh project.');
  }

  return result;
}

module.exports = {
  GSD_TAG_RE,
  SUPPORTED_EXTENSIONS,
  EXCLUDE_DIRS,
  GSD_ARTIFACTS,
  migrateLineTag,
  migrateTags,
  migrateArtifacts,
  extractFeaturesFromLegacy,
  migrateSession,
  analyzeMigration,
};
