#!/usr/bin/env node
// @cap-feature(feature:F-009) Hooks System — build script (syntax validation + dist copy)
// @cap-history(sessions:3, edits:4, since:2026-04-01, learned:2026-04-03) Frequently modified — 3 sessions, 4 edits
/**
 * Copy CAP hooks to dist for installation.
 * Validates JavaScript syntax before copying to prevent shipping broken hooks.
 * See #1107, #1109, #1125, #1161 — a duplicate const declaration shipped
 * in dist and caused PostToolUse hook errors for all users.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const DIST_DIR = path.join(HOOKS_DIR, 'dist');

// Hooks to copy (pure Node.js, no bundling needed)
const HOOKS_TO_COPY = [
  'cap-check-update.js',
  'cap-context-monitor.js',
  'cap-memory.js',
  'cap-prompt-guard.js',
  'cap-statusline.js',
  'cap-tag-observer.js',
  'cap-workflow-guard.js'
];

/**
 * Validate JavaScript syntax without executing the file.
 * Catches SyntaxError (duplicate const, missing brackets, etc.)
 * before the hook gets shipped to users.
 */
function validateSyntax(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    // Use vm.compileFunction to check syntax without executing
    new vm.Script(content, { filename: path.basename(filePath) });
    return null; // No error
  } catch (e) {
    if (e instanceof SyntaxError) {
      return e.message;
    }
    throw e;
  }
}

function build() {
  // Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  let hasErrors = false;

  // Copy hooks to dist with syntax validation
  for (const hook of HOOKS_TO_COPY) {
    const src = path.join(HOOKS_DIR, hook);
    const dest = path.join(DIST_DIR, hook);

    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${hook} not found, skipping`);
      continue;
    }

    // Validate syntax before copying
    const syntaxError = validateSyntax(src);
    if (syntaxError) {
      console.error(`\x1b[31m✗ ${hook}: SyntaxError — ${syntaxError}\x1b[0m`);
      hasErrors = true;
      continue;
    }

    console.log(`\x1b[32m✓\x1b[0m Copying ${hook}...`);
    fs.copyFileSync(src, dest);
  }

  if (hasErrors) {
    console.error('\n\x1b[31mBuild failed: fix syntax errors above before publishing.\x1b[0m');
    process.exit(1);
  }

  console.log('\nBuild complete.');
}

build();
