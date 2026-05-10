'use strict';

/**
 * Verification command router — dispatches `verify <subcommand>` to lib/verify.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const verify = require('../verify.cjs');
const { error } = require('../core.cjs');

function dispatch(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'plan-structure') {
    verify.cmdVerifyPlanStructure(cwd, args[2], raw);
  } else if (subcommand === 'phase-completeness') {
    verify.cmdVerifyPhaseCompleteness(cwd, args[2], raw);
  } else if (subcommand === 'references') {
    verify.cmdVerifyReferences(cwd, args[2], raw);
  } else if (subcommand === 'commits') {
    verify.cmdVerifyCommits(cwd, args.slice(2), raw);
  } else if (subcommand === 'artifacts') {
    verify.cmdVerifyArtifacts(cwd, args[2], raw);
  } else if (subcommand === 'key-links') {
    verify.cmdVerifyKeyLinks(cwd, args[2], raw);
  } else {
    error('Unknown verify subcommand. Available: plan-structure, phase-completeness, references, commits, artifacts, key-links');
  }
}

module.exports = { dispatch };
