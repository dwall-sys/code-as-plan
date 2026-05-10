'use strict';

/**
 * Template command router — dispatches `template <subcommand>` to lib/template.cjs.
 *
 * Extracted from cap/bin/cap-tools.cjs. Behavior is byte-identical.
 */

const template = require('../template.cjs');
const { error } = require('../core.cjs');
const { parseNamedArgs } = require('./arg-helpers.cjs');

function dispatch(args, cwd, raw) {
  const subcommand = args[1];
  if (subcommand === 'select') {
    template.cmdTemplateSelect(cwd, args[2], raw);
  } else if (subcommand === 'fill') {
    const templateType = args[2];
    const { phase, plan, name, type, wave, fields: fieldsRaw } = parseNamedArgs(args, ['phase', 'plan', 'name', 'type', 'wave', 'fields']);
    let fields = {};
    if (fieldsRaw) {
      const { safeJsonParse } = require('../security.cjs');
      const result = safeJsonParse(fieldsRaw, { label: '--fields' });
      if (!result.ok) error(result.error);
      fields = result.value;
    }
    template.cmdTemplateFill(cwd, templateType, {
      phase, plan, name, fields,
      type: type || 'execute',
      wave: wave || '1',
    }, raw);
  } else {
    error('Unknown template subcommand. Available: select, fill');
  }
}

module.exports = { dispatch };
