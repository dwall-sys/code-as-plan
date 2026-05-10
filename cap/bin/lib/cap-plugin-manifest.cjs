// @cap-feature(feature:F-058) Claude-Code Plugin Manifest — shared constants + helpers for plugin / marketplace / npx name handling.
// @cap-decision CAP Pro 1.0 rebrand: plugin/marketplace/npm names all unified to `cap-pro`. The
// /cap:* slash-command namespace is preserved at the file-layout level (commands/cap/*.md), not
// via the plugin name itself. Centralising the names in this module so cap-doctor, installer, and
// tests reference the same source of truth.
// @cap-constraint Zero external deps — node: built-ins only.

'use strict';

/**
 * Plugin name in `.claude-plugin/plugin.json` and the value Claude's plugin
 * cache prefixes its directory entries with (`cap-pro@<source>/`).
 * The /cap:* slash-command namespace is preserved by the file layout
 * (commands/cap/*.md), not by this name.
 */
const PLUGIN_NAME = 'cap-pro';

/** Marketplace slug — the value `/plugin install <x>` resolves against. */
const MARKETPLACE_NAME = 'cap-pro';

/** npm package name (matches MARKETPLACE_NAME deliberately — one distribution, two channels). */
const NPM_PACKAGE_NAME = 'cap-pro';

/** Legacy npm/plugin/marketplace name kept for cleanup/migration logic. Frozen at code-as-plan@7.x. */
const LEGACY_NPM_PACKAGE_NAME = 'code-as-plan';
const LEGACY_PLUGIN_NAME = 'cap';

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
 * A `.claude-plugin/plugin.json` is a CAP footprint if its `name` matches PLUGIN_NAME
 * (current — `cap-pro`) or LEGACY_PLUGIN_NAME (pre-1.0 — `cap`). Backward-compat is
 * deliberate: a user who installed `code-as-plan@7.x` still has `cap` plugin manifests
 * in `~/.claude/plugins/cache/`, and the doctor should detect them so the cleanup pass
 * can offer to remove them. A differently-named manifest belongs to another plugin and
 * must not be counted as a CAP install.
 * @param {unknown} parsedManifest
 * @returns {boolean}
 */
function isCapPluginManifest(parsedManifest) {
  if (!parsedManifest || typeof parsedManifest !== 'object') return false;
  return parsedManifest.name === PLUGIN_NAME || parsedManifest.name === LEGACY_PLUGIN_NAME;
}

module.exports = {
  PLUGIN_NAME,
  MARKETPLACE_NAME,
  NPM_PACKAGE_NAME,
  LEGACY_PLUGIN_NAME,
  LEGACY_NPM_PACKAGE_NAME,
  RESERVED_MARKETPLACE_NAMES,
  isReservedMarketplaceName,
  isCapPluginManifest,
};
