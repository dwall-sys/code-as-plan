'use strict';

/**
 * Init command router — dispatches `init <workflow>` to lib/init.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const init = require('../init.cjs');
const { error } = require('../core.cjs');

function dispatch(args, cwd, raw) {
  const workflow = args[1];
  switch (workflow) {
    case 'execute-phase':
      init.cmdInitExecutePhase(cwd, args[2], raw);
      break;
    case 'plan-phase':
      init.cmdInitPlanPhase(cwd, args[2], raw);
      break;
    case 'new-project':
      init.cmdInitNewProject(cwd, raw);
      break;
    case 'new-milestone':
      init.cmdInitNewMilestone(cwd, raw);
      break;
    case 'quick':
      init.cmdInitQuick(cwd, args.slice(2).join(' '), raw);
      break;
    case 'resume':
      init.cmdInitResume(cwd, raw);
      break;
    case 'verify-work':
      init.cmdInitVerifyWork(cwd, args[2], raw);
      break;
    case 'phase-op':
      init.cmdInitPhaseOp(cwd, args[2], raw);
      break;
    case 'todos':
      init.cmdInitTodos(cwd, args[2], raw);
      break;
    case 'milestone-op':
      init.cmdInitMilestoneOp(cwd, raw);
      break;
    case 'map-codebase':
      init.cmdInitMapCodebase(cwd, raw);
      break;
    case 'progress':
      init.cmdInitProgress(cwd, raw);
      break;
    case 'manager':
      init.cmdInitManager(cwd, raw);
      break;
    case 'new-workspace':
      init.cmdInitNewWorkspace(cwd, raw);
      break;
    case 'list-workspaces':
      init.cmdInitListWorkspaces(cwd, raw);
      break;
    case 'remove-workspace':
      init.cmdInitRemoveWorkspace(cwd, args[2], raw);
      break;
    default:
      error(`Unknown init workflow: ${workflow}\nAvailable: execute-phase, plan-phase, new-project, new-milestone, quick, resume, verify-work, phase-op, todos, milestone-op, map-codebase, progress, manager, new-workspace, list-workspaces, remove-workspace`);
  }
}

module.exports = { dispatch };
