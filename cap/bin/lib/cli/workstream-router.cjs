'use strict';

/**
 * Workstream command router — dispatches `workstream <subcommand>` to
 * lib/workstream.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const workstream = require('../workstream.cjs');
const { error } = require('../core.cjs');

function dispatch(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'create') {
    const migrateNameIdx = args.indexOf('--migrate-name');
    const noMigrate = args.includes('--no-migrate');
    workstream.cmdWorkstreamCreate(cwd, args[2], {
      migrate: !noMigrate,
      migrateName: migrateNameIdx !== -1 ? args[migrateNameIdx + 1] : null,
    }, raw);
  } else if (subcommand === 'list') {
    workstream.cmdWorkstreamList(cwd, raw);
  } else if (subcommand === 'status') {
    workstream.cmdWorkstreamStatus(cwd, args[2], raw);
  } else if (subcommand === 'complete') {
    workstream.cmdWorkstreamComplete(cwd, args[2], {}, raw);
  } else if (subcommand === 'set') {
    workstream.cmdWorkstreamSet(cwd, args[2], raw);
  } else if (subcommand === 'get') {
    workstream.cmdWorkstreamGet(cwd, raw);
  } else if (subcommand === 'progress') {
    workstream.cmdWorkstreamProgress(cwd, raw);
  } else {
    error('Unknown workstream subcommand. Available: create, list, status, complete, set, get, progress');
  }
}

module.exports = { dispatch };
