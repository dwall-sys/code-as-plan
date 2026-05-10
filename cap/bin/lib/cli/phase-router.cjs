'use strict';

/**
 * Phase / phases / roadmap / requirements / milestone command routers.
 *
 * Each command group has its own dispatch function. They are bundled in this
 * single module because they all touch phase- or roadmap-level concepts and
 * extracting them as separate files would proliferate tiny modules.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const phase = require('../phase.cjs');
const roadmap = require('../roadmap.cjs');
const milestone = require('../milestone.cjs');
const { error } = require('../core.cjs');
const { parseMultiwordArg } = require('./arg-helpers.cjs');

function dispatchPhases(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'list') {
    const typeIndex = args.indexOf('--type');
    const phaseIndex = args.indexOf('--phase');
    const options = {
      type: typeIndex !== -1 ? args[typeIndex + 1] : null,
      phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
      includeArchived: args.includes('--include-archived'),
    };
    phase.cmdPhasesList(cwd, options, raw);
  } else {
    error('Unknown phases subcommand. Available: list');
  }
}

function dispatchPhase(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'next-decimal') {
    phase.cmdPhaseNextDecimal(cwd, args[2], raw);
  } else if (subcommand === 'add') {
    let customId = null;
    const descArgs = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--id' && i + 1 < args.length) {
        customId = args[i + 1];
        i++; // skip value
      } else {
        descArgs.push(args[i]);
      }
    }
    phase.cmdPhaseAdd(cwd, descArgs.join(' '), raw, customId);
  } else if (subcommand === 'insert') {
    phase.cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
  } else if (subcommand === 'remove') {
    const forceFlag = args.includes('--force');
    phase.cmdPhaseRemove(cwd, args[2], { force: forceFlag }, raw);
  } else if (subcommand === 'complete') {
    phase.cmdPhaseComplete(cwd, args[2], raw);
  } else {
    error('Unknown phase subcommand. Available: next-decimal, add, insert, remove, complete');
  }
}

function dispatchRoadmap(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'get-phase') {
    roadmap.cmdRoadmapGetPhase(cwd, args[2], raw);
  } else if (subcommand === 'analyze') {
    roadmap.cmdRoadmapAnalyze(cwd, raw);
  } else if (subcommand === 'update-plan-progress') {
    roadmap.cmdRoadmapUpdatePlanProgress(cwd, args[2], raw);
  } else {
    error('Unknown roadmap subcommand. Available: get-phase, analyze, update-plan-progress');
  }
}

function dispatchRequirements(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'mark-complete') {
    milestone.cmdRequirementsMarkComplete(cwd, args.slice(2), raw);
  } else {
    error('Unknown requirements subcommand. Available: mark-complete');
  }
}

function dispatchMilestone(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'complete') {
    const milestoneName = parseMultiwordArg(args, 'name');
    const archivePhases = args.includes('--archive-phases');
    milestone.cmdMilestoneComplete(cwd, args[2], { name: milestoneName, archivePhases }, raw);
  } else {
    error('Unknown milestone subcommand. Available: complete');
  }
}

module.exports = {
  dispatchPhases,
  dispatchPhase,
  dispatchRoadmap,
  dispatchRequirements,
  dispatchMilestone,
};
