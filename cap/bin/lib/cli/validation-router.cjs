'use strict';

/**
 * Validation command router — dispatches `validate <subcommand>` to lib/verify.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const verify = require('../verify.cjs');
const { error } = require('../core.cjs');

function dispatch(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'consistency') {
    verify.cmdValidateConsistency(cwd, raw);
  } else if (subcommand === 'health') {
    const repairFlag = args.includes('--repair');
    verify.cmdValidateHealth(cwd, { repair: repairFlag }, raw);
  } else if (subcommand === 'agents') {
    verify.cmdValidateAgents(cwd, raw);
  } else {
    error('Unknown validate subcommand. Available: consistency, health, agents');
  }
}

module.exports = { dispatch };
