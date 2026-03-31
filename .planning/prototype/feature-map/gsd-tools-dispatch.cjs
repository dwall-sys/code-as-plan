/**
 * gsd-tools.cjs dispatch snippet for aggregate-features subcommand.
 *
 * @gsd-context(phase:12) This file is a REFERENCE SNIPPET, not a standalone module.
 * It shows the exact code to add inside the switch(command) block in gsd-tools.cjs,
 * placed before the `default:` case. The prototyper cannot modify gsd-tools.cjs directly.
 *
 * @gsd-ref(ref:FMAP-01) Wires feature-aggregator.cjs into the CLI dispatch layer.
 * @gsd-ref(ref:FMAP-04) The extract-tags case must also be modified to auto-chain.
 */

'use strict';

// ── SNIPPET 1: Add this case to gsd-tools.cjs switch(command) block ────────
// Place before the `default:` case, after `case 'detect-test-framework':`.

/*
    case 'aggregate-features': {
      const allArgs = args.slice(1);
      const named = parseNamedArgs(allArgs, ['output', 'inventory']);
      const featureAggregator = require('./lib/feature-aggregator.cjs');
      featureAggregator.cmdAggregateFeatures(cwd, {
        outputFile: named.output,
        inventoryFile: named.inventory,
      });
      break;
    }
*/

// @gsd-pattern Follows the exact dispatch pattern of extract-tags and detect-test-framework:
// parse named args, require lib module, call exported cmd function.

// ── SNIPPET 2: Modify extract-tags case to auto-chain aggregate-features ───
// After the existing arcScanner.cmdExtractTags() call, add feature aggregation.
// This implements AC-4: FEATURES.md is regenerated automatically when extract-tags runs.

/*
    case 'extract-tags': {
      // ... existing code unchanged ...
      arcScanner.cmdExtractTags(cwd, targetPath, {
        phaseFilter,
        typeFilter,
        format: format || 'json',
        outputFile,
      });

      // @gsd-todo(ref:AC-4) Auto-chain: regenerate FEATURES.md after extract-tags completes
      // Only run when outputFile is set (markdown mode) — skip for JSON stdout mode
      if (outputFile) {
        try {
          const featureAggregator = require('./lib/feature-aggregator.cjs');
          featureAggregator.cmdAggregateFeatures(cwd, {
            inventoryFile: outputFile,
          });
        } catch (e) {
          // Non-fatal: feature aggregation failure should not break extract-tags
          process.stderr.write(`feature-aggregator: auto-chain skipped — ${e.message}\n`);
        }
      }

      break;
    }
*/

// @gsd-decision Auto-chain is non-fatal: if feature aggregation fails, extract-tags still succeeds.
// This prevents a new module from breaking the established extract-tags pipeline.

// @gsd-decision Auto-chain only triggers when extract-tags writes to a file (outputFile is set).
// JSON-to-stdout mode (default) is used for programmatic consumption and should not trigger side effects.
