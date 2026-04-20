'use strict';

// @cap-feature(feature:F-050) Tiny zero-dependency debug logger gated on CAP_DEBUG env var.
// @cap-decision Implemented as a 1-file zero-dep helper rather than adopting a logging library — CAP's
// constraint forbids runtime dependencies. Output is gated on process.env.CAP_DEBUG so production runs are silent.
// @cap-decision Use console.warn (not console.log) so logger output goes to stderr and never pollutes
// stdout pipelines (e.g. /cap:status output consumed by other tools).

/**
 * @typedef {Object} DiagnosticPayload
 * @property {string} op - Operation name (e.g. 'loadClusterData', 'loadGraph')
 * @property {string} [file] - Affected file path (when applicable)
 * @property {string} errorType - err.code or err.constructor.name
 * @property {string} errorMessage - err.message (single line)
 * @property {string} recoveryAction - What the caller did to recover (e.g. 'returning empty array')
 */

/**
 * Emit a structured debug diagnostic when CAP_DEBUG is truthy. No-op otherwise.
 *
 * Output format is single-line JSON for grep-friendliness, prefixed with [cap:debug] for visibility.
 *
 * @param {DiagnosticPayload} payload - Structured diagnostic record
 * @returns {void}
 */
function debug(payload) {
  if (!process.env.CAP_DEBUG) return;
  try {
    // eslint-disable-next-line no-console
    console.warn(`[cap:debug] ${JSON.stringify(payload)}`);
  } catch (_e) {
    // Never let logging errors break the caller. Worst case: silent drop.
  }
}

/**
 * Build a structured payload from an Error and op metadata.
 *
 * @param {string} op - Operation name
 * @param {Error} err - The caught error
 * @param {Object} [extra] - Additional fields (file, recoveryAction, etc.)
 * @returns {DiagnosticPayload}
 */
function fromError(op, err, extra) {
  const e = err || {};
  return {
    op,
    errorType: e.code || (e.constructor && e.constructor.name) || 'Error',
    errorMessage: typeof e.message === 'string' ? e.message.split('\n')[0] : String(e),
    ...(extra || {}),
  };
}

module.exports = {
  debug,
  fromError,
};
