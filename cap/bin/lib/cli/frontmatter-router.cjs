'use strict';

/**
 * Frontmatter command router — dispatches `frontmatter <subcommand>` to
 * lib/frontmatter.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const frontmatter = require('../frontmatter.cjs');
const { error } = require('../core.cjs');
const { parseNamedArgs } = require('./arg-helpers.cjs');

function dispatch(args, cwd, raw) {
  const subcommand = args[1];
  const file = args[2];
  if (subcommand === 'get') {
    frontmatter.cmdFrontmatterGet(cwd, file, parseNamedArgs(args, ['field']).field, raw);
  } else if (subcommand === 'set') {
    const { field, value } = parseNamedArgs(args, ['field', 'value']);
    frontmatter.cmdFrontmatterSet(cwd, file, field, value !== null ? value : undefined, raw);
  } else if (subcommand === 'merge') {
    frontmatter.cmdFrontmatterMerge(cwd, file, parseNamedArgs(args, ['data']).data, raw);
  } else if (subcommand === 'validate') {
    frontmatter.cmdFrontmatterValidate(cwd, file, parseNamedArgs(args, ['schema']).schema, raw);
  } else {
    error('Unknown frontmatter subcommand. Available: get, set, merge, validate');
  }
}

module.exports = { dispatch };
