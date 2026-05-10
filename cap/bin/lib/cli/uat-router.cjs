'use strict';

/**
 * UAT command router — dispatches `uat <subcommand>` and the standalone
 * `audit-uat` command to lib/uat.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const { error } = require('../core.cjs');
const { parseNamedArgs } = require('./arg-helpers.cjs');

function dispatchAuditUat(args, cwd, raw) {
  const uat = require('../uat.cjs');
  uat.cmdAuditUat(cwd, raw);
}

function dispatchUat(args, cwd, raw) {
  const subcommand = args[1];
  const uat = require('../uat.cjs');
  if (subcommand === 'render-checkpoint') {
    const options = parseNamedArgs(args, ['file']);
    uat.cmdRenderCheckpoint(cwd, options, raw);
  } else {
    error('Unknown uat subcommand. Available: render-checkpoint');
  }
}

module.exports = { dispatchAuditUat, dispatchUat };
