// @cap-context F-089 sharded Feature Map — migration tool. Transforms a monolithic FEATURE-MAP.md
//   into the sharded layout: index file (FEATURE-MAP.md) + per-feature files (features/<ID>.md).
// @cap-decision(F-089/AC-6) Byte-lossless extraction of feature blocks. We slice each block from its
//   `### F-...` header to just before the next `### F-...` (or to the next non-feature `## ` header
//   for the final feature). The slice is written verbatim — no parse → serialize round-trip — so all
//   prose, group markers, separator lines, and header-format variations survive intact. F-088 lossy
//   round-trip class is sidestepped entirely on the migration path.
// @cap-decision(F-089/AC-6 idempotency) Already-sharded projects (features/ dir present with at least
//   one F-*.md) return a no-op status. Re-running the migrator is safe.
// @cap-decision(F-089/AC-6 backup) On --apply, we write a backup copy `FEATURE-MAP.md.backup-pre-F-089`
//   alongside the original before overwriting. Also surfaced in the dry-run report so the user knows
//   the recovery path before committing.

'use strict';

// @cap-feature(feature:F-089) Sharded Feature Map — Migration

const fs = require('node:fs');
const path = require('node:path');

const shard = require('./cap-feature-map-shard.cjs');

const BACKUP_SUFFIX = '.backup-pre-F-089';

/**
 * @typedef {Object} FeatureBlock
 * @property {string} id
 * @property {string} state
 * @property {string} title
 * @property {string} rawBlock     The original content slice, byte-identical to source
 * @property {number} startLine    1-based line number of the `### F-` header in the source
 * @property {number} endLine      1-based line number of the last line of the block
 */

/**
 * Extract feature blocks from monolithic FEATURE-MAP.md content. Byte-lossless — each block is a
 * raw substring slice of the input. Header parsing for {id, state, title} accepts the same shapes
 * the existing parser does (bracket form + em-dash separator), but we DO NOT re-emit the header.
 *
 * @param {string} content
 * @returns {{ blocks: FeatureBlock[], preFeaturesIntro: string, postFeaturesTail: string }}
 */
function extractFeatureBlocks(content) {
  const lines = String(content).split('\n');
  // @cap-decision(F-089/regex-sync) Header regex is intentionally permissive — must accept everything
  //   the cap-feature-map.cjs parser accepts (mixed-case IDs are a F-089 expansion; legacy uppercase-only
  //   forms also accepted). Keep in sync with FEATURE_ID_PATTERN in cap-feature-map-shard.cjs.
  const headerRE = /^###\s+(F-(?:\d{3,}|[A-Z](?:[A-Z0-9_]*[A-Z0-9])?(?:[-_][A-Z0-9_]*[A-Z0-9])*|[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+))(?::\s+|\s+[—–-]\s+)(.+?)\s*$/;
  // Top-level section break (## Foo) — terminates the final feature block.
  const topSectionRE = /^##\s+/;

  /** @type {FeatureBlock[]} */
  const blocks = [];
  /** @type {{ id: string, title: string, state: string, startIdx: number }|null} */
  let current = null;
  /** @type {number|null} */
  let firstHeaderIdx = null;
  /** @type {number|null} */
  let postTailStart = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(headerRE);
    const isTopSection = topSectionRE.test(line) && !line.startsWith('### ');

    if (headerMatch) {
      if (firstHeaderIdx === null) firstHeaderIdx = i;
      // Close out previous feature block if any.
      if (current) {
        const blockLines = lines.slice(current.startIdx, i);
        // Trim only trailing blank lines (preserve leading prose / decorations within block).
        while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === '') {
          blockLines.pop();
        }
        blocks.push({
          id: current.id,
          state: current.state,
          title: current.title,
          rawBlock: blockLines.join('\n') + '\n',
          startLine: current.startIdx + 1,
          endLine: current.startIdx + blockLines.length,
        });
      }
      // Start new feature block.
      let title = headerMatch[2];
      let state = 'planned';
      const stateMatch = title.match(/^(.+?)\s+\[(\w+)\]\s*$/);
      if (stateMatch) {
        title = stateMatch[1];
        state = stateMatch[2];
      }
      current = {
        id: headerMatch[1],
        title: title.trim(),
        state,
        startIdx: i,
      };
      continue;
    }

    if (isTopSection && current) {
      // Top-level section header (e.g. `## Legend`) — terminates the final feature block.
      const blockLines = lines.slice(current.startIdx, i);
      while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === '') {
        blockLines.pop();
      }
      blocks.push({
        id: current.id,
        state: current.state,
        title: current.title,
        rawBlock: blockLines.join('\n') + '\n',
        startLine: current.startIdx + 1,
        endLine: current.startIdx + blockLines.length,
      });
      current = null;
      postTailStart = i;
      // Continue scanning — but no further blocks expected.
    }
  }

  // EOF: close any still-open feature block.
  if (current) {
    const blockLines = lines.slice(current.startIdx);
    while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === '') {
      blockLines.pop();
    }
    blocks.push({
      id: current.id,
      state: current.state,
      title: current.title,
      rawBlock: blockLines.join('\n') + '\n',
      startLine: current.startIdx + 1,
      endLine: current.startIdx + blockLines.length,
    });
    current = null;
  }

  const preFeaturesIntro =
    firstHeaderIdx !== null && firstHeaderIdx > 0
      ? lines.slice(0, firstHeaderIdx).join('\n')
      : '';
  const postFeaturesTail =
    postTailStart !== null
      ? lines.slice(postTailStart).join('\n')
      : '';

  return { blocks, preFeaturesIntro, postFeaturesTail };
}

/**
 * @typedef {Object} MigrationPlan
 * @property {'sharded' | 'monolithic' | 'missing'} sourceMode
 * @property {string} featureMapPath          Absolute path to the monolithic source file
 * @property {string} featuresDir             Absolute path to the per-feature directory
 * @property {string} backupPath              Absolute path of the backup that will be written
 * @property {Array<{id: string, filePath: string, lineCount: number, state: string, title: string}>} writes
 * @property {Array<{id: string, reason: string}>} skips
 * @property {Array<string>} warnings
 */

/**
 * Plan a migration without writing anything. Idempotent — returns sourceMode:'sharded' for already
 * migrated projects.
 *
 * @param {string} projectRoot
 * @param {string|null|undefined} [appPath]
 * @returns {MigrationPlan}
 */
function planMigration(projectRoot, appPath) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const featureMapPath = path.join(baseDir, shard.FEATURE_MAP_FILE);
  const featuresDir = shard.featuresDirPath(projectRoot, appPath);
  const backupPath = featureMapPath + BACKUP_SUFFIX;

  /** @type {MigrationPlan} */
  const plan = {
    sourceMode: 'missing',
    featureMapPath,
    featuresDir,
    backupPath,
    writes: [],
    skips: [],
    warnings: [],
  };

  if (!fs.existsSync(featureMapPath)) {
    plan.warnings.push('FEATURE-MAP.md not found — nothing to migrate.');
    return plan;
  }

  if (shard.isShardedMap(projectRoot, appPath)) {
    plan.sourceMode = 'sharded';
    plan.warnings.push('Already in sharded mode (features/ exists with F-*.md files). No migration needed.');
    return plan;
  }

  plan.sourceMode = 'monolithic';
  const content = fs.readFileSync(featureMapPath, 'utf8');
  const { blocks } = extractFeatureBlocks(content);

  if (blocks.length === 0) {
    plan.warnings.push('No feature blocks found in FEATURE-MAP.md — index will be empty.');
  }

  // Detect duplicate IDs — refuse migration to keep the user-visible failure mode loud.
  const seen = new Map();
  for (const b of blocks) {
    if (!shard.validateFeatureId(b.id)) {
      plan.skips.push({ id: b.id, reason: 'Invalid feature ID — would produce unsafe filename.' });
      continue;
    }
    if (seen.has(b.id)) {
      plan.skips.push({
        id: b.id,
        reason: `Duplicate ID — first occurrence at line ${seen.get(b.id)}, this one at line ${b.startLine}. Resolve in source before migrating.`,
      });
      continue;
    }
    seen.set(b.id, b.startLine);
    plan.writes.push({
      id: b.id,
      filePath: shard.featureFilePath(projectRoot, b.id, appPath),
      lineCount: b.rawBlock.split('\n').length,
      state: b.state,
      title: b.title,
    });
  }

  return plan;
}

/**
 * Apply a migration. Writes per-feature files, backup of original FEATURE-MAP.md, and the new
 * index FEATURE-MAP.md. Atomic-ish: feature files first, then backup, then index. If the index
 * write fails, the per-feature files and backup are present so the user can recover manually.
 *
 * @param {string} projectRoot
 * @param {string|null|undefined} [appPath]
 * @param {{ force?: boolean }} [options]
 * @returns {{ ok: boolean, plan: MigrationPlan, applied: { featuresWritten: number, indexWritten: boolean, backupWritten: boolean } }}
 */
function applyMigration(projectRoot, appPath, options) {
  const force = Boolean(options && options.force);
  const plan = planMigration(projectRoot, appPath);
  const applied = { featuresWritten: 0, indexWritten: false, backupWritten: false };

  if (plan.sourceMode !== 'monolithic') {
    return { ok: false, plan, applied };
  }
  if (plan.skips.length > 0 && !force) {
    plan.warnings.push('Refused to apply: ' + plan.skips.length + ' feature(s) had errors. Pass {force:true} to skip them and proceed (NOT recommended for duplicate IDs).');
    return { ok: false, plan, applied };
  }

  // Re-extract blocks (planMigration discarded them); we need them here for content writes.
  const content = fs.readFileSync(plan.featureMapPath, 'utf8');
  const { blocks } = extractFeatureBlocks(content);

  // Step 1: ensure features/ dir exists.
  fs.mkdirSync(plan.featuresDir, { recursive: true });

  // Step 2: write per-feature files. Skip duplicates and invalid IDs (already in plan.skips).
  const planned = new Set(plan.writes.map(w => w.id));
  for (const b of blocks) {
    if (!planned.has(b.id)) continue;
    const target = shard.featureFilePath(projectRoot, b.id, appPath);
    // Atomic write: tmp + rename.
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, b.rawBlock, 'utf8');
    fs.renameSync(tmp, target);
    applied.featuresWritten++;
  }

  // Step 3: backup the source.
  fs.writeFileSync(plan.backupPath, content, 'utf8');
  applied.backupWritten = true;

  // Step 4: write the new index FEATURE-MAP.md from the planned writes (already validated).
  const indexEntries = plan.writes.map(w => ({ id: w.id, state: w.state, title: w.title }));
  const indexContent = shard.serializeIndex(indexEntries);
  // Atomic write.
  const indexTmp = plan.featureMapPath + '.tmp';
  fs.writeFileSync(indexTmp, indexContent, 'utf8');
  fs.renameSync(indexTmp, plan.featureMapPath);
  applied.indexWritten = true;

  return { ok: true, plan, applied };
}

/**
 * Render a MigrationPlan as a human-friendly text report (used by the CLI / command).
 * @param {MigrationPlan} plan
 * @returns {string}
 */
function formatPlan(plan) {
  const lines = [];
  lines.push('Migration plan: monolithic → sharded FEATURE-MAP');
  lines.push('');
  lines.push('Source mode: ' + plan.sourceMode);
  lines.push('Source file: ' + plan.featureMapPath);
  lines.push('Target dir : ' + plan.featuresDir);
  lines.push('Backup file: ' + plan.backupPath);
  lines.push('');
  if (plan.warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of plan.warnings) lines.push('  - ' + w);
    lines.push('');
  }
  if (plan.writes.length > 0) {
    lines.push('Will write ' + plan.writes.length + ' per-feature file(s):');
    for (const w of plan.writes) {
      lines.push('  - ' + w.id + '  [' + w.state + ']  ' + w.title + '   (' + w.lineCount + ' lines)');
    }
    lines.push('');
  }
  if (plan.skips.length > 0) {
    lines.push('Skipped ' + plan.skips.length + ' feature(s):');
    for (const s of plan.skips) {
      lines.push('  - ' + s.id + ': ' + s.reason);
    }
    lines.push('');
  }
  if (plan.sourceMode === 'monolithic' && plan.writes.length > 0) {
    lines.push('Apply with: applyMigration(projectRoot, appPath)  // dry-run by default');
  }
  return lines.join('\n');
}

module.exports = {
  BACKUP_SUFFIX,
  extractFeatureBlocks,
  planMigration,
  applyMigration,
  formatPlan,
};
