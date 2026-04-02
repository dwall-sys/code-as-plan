/**
 * feature-aggregator — Auto-generates FEATURES.md from PRD acceptance criteria
 * and @gsd-tag status in CODE-INVENTORY.md.
 *
 * Requirements: FMAP-01, FMAP-02, FMAP-03, FMAP-04, FMAP-05
 */

'use strict';

// @cap-feature(feature:F-015) Legacy ARC Scanner — feature aggregator (auto-generates FEATURES.md from PRD ACs)
// @cap-context(phase:12) Feature aggregator — reads PRDs and CODE-INVENTORY.md to produce FEATURES.md.
// Dual-input design: PRD ACs are authoritative, code tags refine completion status.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── PRD Parsing ─────────────────────────────────────────────────────────────

// @cap-pattern AC lines in PRDs follow the format: AC-N: description text
// This regex must match the exact format emitted by /gsd:brainstorm and /gsd:prototype PRD templates.
const AC_LINE_RE = /^(?:[-*]\s*)?(?:\*\*)?AC-(\d+)(?:\*\*)?:\s*(.+)$/gm;

// @cap-pattern Feature group headings in PRDs use ## or ### markdown headers
const FEATURE_GROUP_RE = /^#{2,3}\s+(.+)$/gm;

// @cap-pattern Dependency sections in PRDs use "## Dependencies" or "### Dependencies"
const DEPENDENCY_SECTION_RE = /^#{2,3}\s+Dependencies\s*$/im;

/**
 * Parse a PRD file and extract acceptance criteria, feature groups, and dependencies.
 *
 * @cap-api Parameters: prdContent (string) — raw PRD markdown.
 * Returns: { acs: Array<{id, description, group}>, dependencies: Array<{from, to}>, groups: string[] }
 *
 * @param {string} prdContent - Raw PRD Markdown content
 * @param {string} [prdName] - Name of the PRD file (for provenance tracking)
 * @returns {{ acs: Array<{id: string, description: string, group: string, prdSource: string}>, dependencies: Array<{from: string, to: string}>, groups: string[] }}
 */
function parsePrd(prdContent, prdName) {
  // @cap-todo(ref:AC-1) Implement full PRD parsing — extract ACs, feature groups, and dependency sections from PRD markdown
  const acs = [];
  const groups = [];
  const dependencies = [];

  let currentGroup = '(ungrouped)';

  const lines = prdContent.split('\n');
  let inDependencySection = false;

  for (const line of lines) {
    // Detect feature group headings
    const groupMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (groupMatch) {
      const heading = groupMatch[1].trim();
      if (/^dependencies$/i.test(heading)) {
        inDependencySection = true;
        continue;
      }
      inDependencySection = false;
      currentGroup = heading;
      if (!groups.includes(heading)) {
        groups.push(heading);
      }
      continue;
    }

    // Parse dependency lines (format: "- FeatureA -> FeatureB" or "- FeatureA depends on FeatureB")
    if (inDependencySection) {
      const depArrowMatch = line.match(/^[-*]\s+(.+?)\s*(?:->|→)\s*(.+)$/);
      if (depArrowMatch) {
        dependencies.push({
          from: depArrowMatch[1].trim(),
          to: depArrowMatch[2].trim(),
        });
        continue;
      }
      const depTextMatch = line.match(/^[-*]\s+(.+?)\s+depends on\s+(.+)$/i);
      if (depTextMatch) {
        dependencies.push({
          from: depTextMatch[1].trim(),
          to: depTextMatch[2].trim(),
        });
        continue;
      }
    }

    // Parse AC lines
    const acMatch = line.match(/^(?:[-*]\s*)?(?:\*\*)?AC-(\d+)(?:\*\*)?:\s*(.+)$/);
    if (acMatch) {
      inDependencySection = false;
      acs.push({
        id: `AC-${acMatch[1]}`,
        description: acMatch[2].trim(),
        group: currentGroup,
        prdSource: prdName || 'unknown',
      });
    }
  }

  return { acs, dependencies, groups };
}

// ── CODE-INVENTORY Parsing ──────────────────────────────────────────────────

// @cap-pattern Open @cap-todo tags with ref:AC-N metadata indicate incomplete ACs.
// Absence of such a tag means the AC is considered done.
const TODO_REF_RE = /ref:(AC-\d+)/;

/**
 * Parse CODE-INVENTORY.md to find open @cap-todo tags with AC references.
 *
 * @cap-api Parameters: inventoryContent (string) — raw CODE-INVENTORY.md.
 * Returns: Set<string> of open AC IDs (e.g., Set(['AC-1', 'AC-3']))
 *
 * @param {string} inventoryContent - Raw CODE-INVENTORY.md content
 * @returns {Set<string>} Set of AC IDs that still have open @cap-todo tags
 */
function parseOpenTodos(inventoryContent) {
  // @cap-todo(ref:AC-2) Implement CODE-INVENTORY.md parsing to extract open @cap-todo(ref:AC-N) tags and determine per-AC completion status
  const openAcIds = new Set();
  const lines = inventoryContent.split('\n');

  // We look for lines in the @cap-todo section that contain ref:AC-N metadata
  let inTodoSection = false;

  for (const line of lines) {
    // Detect the @cap-todo section heading
    if (/^###\s+@cap-todo/.test(line)) {
      inTodoSection = true;
      continue;
    }
    // Exit todo section on next ### heading
    if (inTodoSection && /^###\s+@gsd-/.test(line)) {
      inTodoSection = false;
      continue;
    }

    if (inTodoSection) {
      const refMatch = line.match(TODO_REF_RE);
      if (refMatch) {
        openAcIds.add(refMatch[1]);
      }
    }
  }

  return openAcIds;
}

// ── Cross-Reference Engine ──────────────────────────────────────────────────

// @cap-decision AC completion is derived from tag presence: if a @cap-todo with ref:AC-N
// exists in CODE-INVENTORY.md, that AC is "open". If absent, it is "done".
// This avoids needing explicit "done" markers — the absence of work IS the signal.

/**
 * Cross-reference PRD ACs with open @cap-todo tags to determine completion status.
 *
 * @cap-api Parameters: acs (Array), openTodoAcIds (Set<string>).
 * Returns: Array of AC objects enriched with `status` field ('done' | 'open').
 *
 * @param {Array<{id: string, description: string, group: string, prdSource: string}>} acs
 * @param {Set<string>} openTodoAcIds - AC IDs that still have open @cap-todo tags
 * @returns {Array<{id: string, description: string, group: string, prdSource: string, status: string}>}
 */
function crossReference(acs, openTodoAcIds) {
  return acs.map(ac => ({
    ...ac,
    status: openTodoAcIds.has(ac.id) ? 'open' : 'done',
  }));
}

// ── Dependency Extraction ───────────────────────────────────────────────────

/**
 * Extract and format dependency relationships from parsed PRD data.
 *
 * @cap-api Parameters: dependencies (Array<{from, to}>).
 * Returns: string — Markdown-formatted dependency visualization.
 *
 * @param {Array<{from: string, to: string}>} dependencies
 * @returns {string} Markdown dependency section content
 */
function formatDependencies(dependencies) {
  // @cap-todo(ref:AC-3) Implement dependency visualization in FEATURES.md from PRD dependency sections
  if (!dependencies || dependencies.length === 0) {
    return 'No cross-feature dependencies documented.';
  }

  const lines = [];
  lines.push('```');
  for (const dep of dependencies) {
    lines.push(`  ${dep.from} --> ${dep.to}`);
  }
  lines.push('```');
  lines.push('');

  // Also produce a readable list
  for (const dep of dependencies) {
    lines.push(`- **${dep.from}** depends on **${dep.to}**`);
  }

  return lines.join('\n');
}

// ── FEATURES.md Generation ──────────────────────────────────────────────────

// @cap-constraint FEATURES.md is a derived read-only artifact. It must never be manually edited.
// The header includes last-updated and source-hash to signal this.

/**
 * Generate the complete FEATURES.md content string.
 *
 * @cap-api Parameters: enrichedAcs (Array), dependencies (Array), groups (string[]).
 * Returns: string — complete FEATURES.md Markdown content with header, status table, and dependencies.
 *
 * @param {Array<{id: string, description: string, group: string, prdSource: string, status: string}>} enrichedAcs
 * @param {Array<{from: string, to: string}>} dependencies
 * @param {string[]} groups
 * @param {string[]} prdSources - List of PRD file paths used as input
 * @returns {string}
 */
function generateFeaturesMarkdown(enrichedAcs, dependencies, groups, prdSources) {
  // @cap-todo(ref:AC-5) Generate FEATURES.md as a derived read-only artifact with last-updated timestamp and source-hash header
  const now = new Date().toISOString();

  // Compute source hash from input data for staleness detection
  const hashInput = JSON.stringify({ enrichedAcs, dependencies, prdSources });
  const sourceHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 12);

  const totalAcs = enrichedAcs.length;
  const doneAcs = enrichedAcs.filter(ac => ac.status === 'done').length;
  const openAcs = totalAcs - doneAcs;
  const completionPct = totalAcs > 0 ? Math.round((doneAcs / totalAcs) * 100) : 0;

  const lines = [];

  // ── Header ──
  lines.push('# FEATURES.md');
  lines.push('');
  lines.push('> **This file is auto-generated. Do not edit manually.**');
  lines.push(`> **Last updated:** ${now}`);
  lines.push(`> **Source hash:** ${sourceHash}`);
  lines.push(`> **Sources:** ${prdSources.join(', ')}`);
  lines.push('');

  // ── Overall Progress ──
  lines.push('## Overall Progress');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total ACs | ${totalAcs} |`);
  lines.push(`| Done | ${doneAcs} |`);
  lines.push(`| Open | ${openAcs} |`);
  lines.push(`| Completion | ${completionPct}% |`);
  lines.push('');

  // ── Features by Group ──
  lines.push('## Features by Group');
  lines.push('');

  // Determine groups to render (use parsed groups, plus catch ungrouped)
  const groupOrder = groups.length > 0 ? [...groups] : ['(ungrouped)'];
  if (!groupOrder.includes('(ungrouped)')) {
    const ungrouped = enrichedAcs.filter(ac => ac.group === '(ungrouped)');
    if (ungrouped.length > 0) {
      groupOrder.push('(ungrouped)');
    }
  }

  for (const group of groupOrder) {
    const groupAcs = enrichedAcs.filter(ac => ac.group === group);
    if (groupAcs.length === 0) continue;

    const groupDone = groupAcs.filter(ac => ac.status === 'done').length;
    const groupTotal = groupAcs.length;
    const groupPct = Math.round((groupDone / groupTotal) * 100);

    lines.push(`### ${group}`);
    lines.push('');
    lines.push(`**Progress:** ${groupDone}/${groupTotal} (${groupPct}%)`);
    lines.push('');
    lines.push('| AC | Status | Description | Source |');
    lines.push('|----|--------|-------------|--------|');

    for (const ac of groupAcs) {
      const statusIcon = ac.status === 'done' ? 'DONE' : 'OPEN';
      lines.push(`| ${ac.id} | ${statusIcon} | ${ac.description} | ${ac.prdSource} |`);
    }

    lines.push('');
  }

  // ── Dependencies ──
  lines.push('## Dependencies');
  lines.push('');
  lines.push(formatDependencies(dependencies));
  lines.push('');

  // ── Footer ──
  lines.push('---');
  lines.push('*Generated by feature-aggregator.cjs via `aggregate-features` subcommand.*');
  lines.push('*Regenerated automatically on every `extract-tags` run.*');
  lines.push('');

  return lines.join('\n');
}

// ── File Discovery ──────────────────────────────────────────────────────────

// @cap-decision PRD discovery uses a simple glob: .planning/PRD.md and .planning/PRD-*.md
// No recursive search needed — PRDs live at the .planning/ root by convention.

/**
 * Discover all PRD files in the .planning/ directory.
 *
 * @param {string} planningDir - Path to .planning/ directory
 * @returns {string[]} Array of absolute PRD file paths
 */
function discoverPrdFiles(planningDir) {
  const prdFiles = [];
  try {
    const entries = fs.readdirSync(planningDir);
    for (const entry of entries) {
      if (entry === 'PRD.md' || (entry.startsWith('PRD-') && entry.endsWith('.md'))) {
        prdFiles.push(path.join(planningDir, entry));
      }
    }
  } catch {
    // .planning/ may not exist yet
  }
  return prdFiles;
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────

// @cap-pattern CLI entry follows arc-scanner.cjs cmdExtractTags pattern:
// accept cwd + opts, resolve paths, call pure functions, write output.

/**
 * CLI entry point: aggregate features from PRDs and CODE-INVENTORY.md,
 * write .planning/FEATURES.md.
 *
 * Called by gsd-tools.cjs case 'aggregate-features'.
 *
 * @cap-api CLI entry: cmdAggregateFeatures(cwd, opts).
 * opts.outputFile defaults to .planning/FEATURES.md.
 * opts.inventoryFile defaults to .planning/prototype/CODE-INVENTORY.md.
 *
 * @param {string} cwd - Current working directory
 * @param {Object} [opts] - Options
 * @param {string} [opts.outputFile] - Output path (default: .planning/FEATURES.md)
 * @param {string} [opts.inventoryFile] - CODE-INVENTORY.md path
 */
function cmdAggregateFeatures(cwd, opts) {
  // @cap-todo(ref:AC-4) Wire aggregate-features into extract-tags auto-chain so FEATURES.md regenerates on every extract-tags run
  opts = opts || {};

  const planningDir = path.join(cwd, '.planning');
  const outputFile = opts.outputFile || path.join(planningDir, 'FEATURES.md');
  const inventoryFile = opts.inventoryFile || path.join(planningDir, 'prototype', 'CODE-INVENTORY.md');

  // Step 1: Discover and parse PRD files
  const prdFiles = discoverPrdFiles(planningDir);
  if (prdFiles.length === 0) {
    // @cap-risk No PRDs found — FEATURES.md cannot be generated without at least one PRD.
    // This is expected for projects that have not yet run /gsd:brainstorm or created a PRD manually.
    process.stderr.write('feature-aggregator: No PRD files found in .planning/ — skipping FEATURES.md generation.\n');
    return;
  }

  let allAcs = [];
  let allDependencies = [];
  let allGroups = [];
  const prdSources = [];

  for (const prdFile of prdFiles) {
    const content = fs.readFileSync(prdFile, 'utf-8');
    const prdName = path.basename(prdFile);
    prdSources.push(prdName);

    const parsed = parsePrd(content, prdName);
    allAcs = allAcs.concat(parsed.acs);
    allDependencies = allDependencies.concat(parsed.dependencies);
    for (const g of parsed.groups) {
      if (!allGroups.includes(g)) allGroups.push(g);
    }
  }

  // Step 2: Parse CODE-INVENTORY.md for open @cap-todo tags
  let openTodoAcIds = new Set();
  try {
    const inventoryContent = fs.readFileSync(inventoryFile, 'utf-8');
    openTodoAcIds = parseOpenTodos(inventoryContent);
  } catch {
    // CODE-INVENTORY.md may not exist yet — treat all ACs as done (no open todos)
    // @cap-risk If CODE-INVENTORY.md is missing, all ACs appear "done" by default.
    // This is intentional: no code = no open todos. But it may confuse users on first run.
  }

  // Step 3: Cross-reference to determine AC completion status
  const enrichedAcs = crossReference(allAcs, openTodoAcIds);

  // Step 4: Generate FEATURES.md content
  const markdown = generateFeaturesMarkdown(enrichedAcs, allDependencies, allGroups, prdSources);

  // Step 5: Write output
  const outDir = path.dirname(outputFile);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputFile, markdown, 'utf-8');

  process.stderr.write(`feature-aggregator: Wrote ${outputFile} (${allAcs.length} ACs, ${prdSources.length} PRD(s))\n`);
}

module.exports = {
  parsePrd,
  parseOpenTodos,
  crossReference,
  formatDependencies,
  generateFeaturesMarkdown,
  discoverPrdFiles,
  cmdAggregateFeatures,
};
