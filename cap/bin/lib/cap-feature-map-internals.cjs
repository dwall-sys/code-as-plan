// @cap-feature(feature:F-083) Shared internals for cap-feature-map.cjs and cap-feature-map-monorepo.cjs.
//   Hosts constants and primitives that BOTH main modules need without forcing one to lazy-require
//   the other just to read a string literal.
// @cap-decision(F-083/followup) F-083-FIX-A: shared constants moved to cap-feature-map-internals.cjs.
//   Both cap-feature-map.cjs and cap-feature-map-monorepo.cjs previously declared a string-equal
//   `FEATURE_MAP_FILE = 'FEATURE-MAP.md'`. The duplicates are value-equal today, but if either site
//   changed the value (e.g. to support `.feature-map.json`) the modules would silently disagree.
//   Move to a single source of truth so future drift is impossible by construction.
// @cap-constraint Zero external dependencies — Node.js built-ins only (none required here).

'use strict';

// @cap-feature(feature:F-083) Canonical Feature Map filename — single source of truth.
//   Both cap-feature-map.cjs and cap-feature-map-monorepo.cjs require this constant from here.
const FEATURE_MAP_FILE = 'FEATURE-MAP.md';

module.exports = {
  FEATURE_MAP_FILE,
};
