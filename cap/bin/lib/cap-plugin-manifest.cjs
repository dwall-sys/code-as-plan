// @cap-feature(feature:F-058) Claude-Code Plugin Manifest — shared constants + helpers for plugin / marketplace / npx name handling.
// @cap-decision Triple-name split: `code-as-plan` (npm package + marketplace slug) vs `cap` (plugin slash + directory). Centralising the names in this module so cap-doctor, installer, and tests reference the same source of truth.
// @cap-constraint Zero external deps — node: built-ins only.

'use strict';

/** Plugin name as used by the Claude plugin registry and slash commands (/cap:…). */
const PLUGIN_NAME = 'cap';

/** Marketplace slug — the value `/plugin install <x>` resolves against. */
const MARKETPLACE_NAME = 'code-as-plan';

/** npm package name (matches MARKETPLACE_NAME deliberately — one distribution, two channels). */
const NPM_PACKAGE_NAME = 'code-as-plan';

/**
 * Names reserved by Anthropic / Claude Code — MUST NOT be used as the marketplace `name` field
 * per the Claude Code plugin specification. Kept as an array so consumers can `.includes()`
 * or enumerate for error messages.
 * @cap-decision Reserved list is hard-coded rather than fetched — the upstream list changes
 * rarely and a network fetch here would couple doctor health checks to registry availability.
 */
const RESERVED_MARKETPLACE_NAMES = Object.freeze([
  'claude-code-marketplace',
  'claude-code-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
  'anthropic-plugins',
  'agent-skills',
  'knowledge-work-plugins',
  'life-sciences',
]);

const RESERVED_SET = new Set(RESERVED_MARKETPLACE_NAMES);

/**
 * @param {string} name
 * @returns {boolean} true if `name` is on the reserved marketplace name list
 */
function isReservedMarketplaceName(name) {
  return typeof name === 'string' && RESERVED_SET.has(name);
}

/**
 * A `.claude-plugin/plugin.json` is a CAP footprint only if its `name` matches PLUGIN_NAME.
 * A differently-named manifest in the same directory belongs to another plugin and must
 * not be counted as a CAP install.
 * @param {unknown} parsedManifest
 * @returns {boolean}
 */
function isCapPluginManifest(parsedManifest) {
  return !!(parsedManifest && typeof parsedManifest === 'object' && parsedManifest.name === PLUGIN_NAME);
}

module.exports = {
  PLUGIN_NAME,
  MARKETPLACE_NAME,
  NPM_PACKAGE_NAME,
  RESERVED_MARKETPLACE_NAMES,
  isReservedMarketplaceName,
  isCapPluginManifest,
};
