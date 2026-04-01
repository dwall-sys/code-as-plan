// @gsd-context CAP v2.0 doctor utility -- checks all external dependencies CAP needs at runtime.
// @gsd-decision Checks are split into required (Node.js, npm, git) and optional (ctx7, c8, vitest, fast-check).
// @gsd-decision Project-specific checks only run when projectRoot is provided and package.json exists.
// @gsd-constraint Zero external dependencies -- uses only Node.js built-ins (child_process, fs, path).

'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {Object} ToolCheck
 * @property {string} name - Tool name
 * @property {string} version - Detected version (or 'not found')
 * @property {boolean} ok - Whether the tool is available
 * @property {boolean} required - Whether CAP requires it
 * @property {string} purpose - What CAP uses it for
 * @property {string} installHint - How to install if missing
 */

/**
 * @typedef {Object} DoctorReport
 * @property {ToolCheck[]} tools - All checked tools
 * @property {number} requiredOk - Count of required tools that are OK
 * @property {number} requiredTotal - Total required tools
 * @property {number} optionalOk - Count of optional tools that are OK
 * @property {number} optionalTotal - Total optional tools
 * @property {boolean} healthy - True if all required tools are OK
 * @property {string[]} installCommands - Commands to install missing tools
 */

/**
 * Check if a CLI tool is available and get its version.
 * @param {string} command - Version check command (e.g., 'node --version')
 * @param {number} [timeout=10000] - Timeout in ms
 * @returns {{ ok: boolean, version: string }}
 */
function checkTool(command, timeout = 10000) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Extract version number (strip 'v' prefix if present)
    const version = output.replace(/^v/, '').split('\n')[0].trim();
    return { ok: true, version };
  } catch (_e) {
    return { ok: false, version: 'not found' };
  }
}

/**
 * Run full doctor check.
 * @param {string} [projectRoot] - Optional project root for project-specific checks
 * @returns {DoctorReport}
 */
function runDoctor(projectRoot) {
  const tools = [];

  // Required tools
  const node = checkTool('node --version');
  tools.push({
    name: 'Node.js',
    ...node,
    required: true,
    purpose: 'CAP runtime (>= 20.0.0 required)',
    installHint: 'https://nodejs.org/ or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts',
  });

  const npm = checkTool('npm --version');
  tools.push({
    name: 'npm',
    ...npm,
    required: true,
    purpose: 'Package management and npx tool execution',
    installHint: 'Comes with Node.js',
  });

  const git = checkTool('git --version');
  // git --version returns "git version 2.45.0"
  if (git.ok) git.version = git.version.replace('git version ', '');
  tools.push({
    name: 'git',
    ...git,
    required: true,
    purpose: 'Version control, commit history for /cap:report and /cap:review',
    installHint: 'https://git-scm.com/downloads or: brew install git',
  });

  // Optional tools -- CAP works without them but with reduced functionality
  const ctx7 = checkTool('npx ctx7@latest --version', 15000);
  tools.push({
    name: 'Context7 (ctx7)',
    ...ctx7,
    required: false,
    purpose: 'Library documentation fetching for /cap:init and /cap:refresh-docs',
    installHint: 'npm install -g ctx7   (or CAP uses npx ctx7@latest on demand)',
  });

  const c8 = checkTool('npx c8 --version');
  tools.push({
    name: 'c8',
    ...c8,
    required: false,
    purpose: 'Code coverage for /cap:test-audit',
    installHint: 'npm install -D c8',
  });

  // Project-specific checks (only if projectRoot provided)
  if (projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Check vitest if project uses it
        if (allDeps.vitest || fs.existsSync(path.join(projectRoot, 'vitest.config.ts')) || fs.existsSync(path.join(projectRoot, 'vitest.config.js'))) {
          const vitest = checkTool('npx vitest --version');
          tools.push({
            name: 'vitest',
            ...vitest,
            required: false,
            purpose: 'TypeScript/SDK test runner (detected in this project)',
            installHint: 'npm install -D vitest',
          });
        }

        // Check fast-check if property tests are desired
        if (allDeps['fast-check']) {
          tools.push({
            name: 'fast-check',
            ok: true,
            version: allDeps['fast-check'].replace('^', '').replace('~', ''),
            required: false,
            purpose: 'Property-based testing for business logic invariants',
            installHint: 'npm install -D fast-check',
          });
        } else {
          tools.push({
            name: 'fast-check',
            ok: false,
            version: 'not installed',
            required: false,
            purpose: 'Property-based testing for business logic invariants (recommended)',
            installHint: 'npm install -D fast-check',
          });
        }
      } catch (_e) { /* malformed package.json -- skip project-specific checks */ }
    }
  }

  // Compute summary
  const requiredTools = tools.filter(t => t.required);
  const optionalTools = tools.filter(t => !t.required);

  const report = {
    tools,
    requiredOk: requiredTools.filter(t => t.ok).length,
    requiredTotal: requiredTools.length,
    optionalOk: optionalTools.filter(t => t.ok).length,
    optionalTotal: optionalTools.length,
    healthy: requiredTools.every(t => t.ok),
    installCommands: [],
  };

  // Build install commands for missing tools
  const missingOptional = optionalTools.filter(t => !t.ok);
  const npmInstallDev = missingOptional
    .filter(t => t.installHint.startsWith('npm install -D'))
    .map(t => t.name.toLowerCase().replace('context7 (ctx7)', 'ctx7'));

  if (npmInstallDev.length > 0) {
    report.installCommands.push(`npm install -D ${npmInstallDev.join(' ')}`);
  }

  const globalInstall = missingOptional
    .filter(t => t.installHint.startsWith('npm install -g'));
  for (const t of globalInstall) {
    report.installCommands.push(t.installHint);
  }

  return report;
}

/**
 * Format the doctor report as readable terminal output.
 * @param {DoctorReport} report
 * @returns {string}
 */
function formatReport(report) {
  const lines = [];
  lines.push('cap:doctor\n');

  // Required tools
  lines.push('  Required:');
  for (const t of report.tools.filter(t => t.required)) {
    const icon = t.ok ? '  ✓' : '  ✗';
    const pad = ' '.repeat(Math.max(0, 18 - t.name.length));
    lines.push(`  ${icon} ${t.name}${pad}${t.version}${t.ok ? '' : '    ← ' + t.purpose}`);
  }

  lines.push('');
  lines.push('  Optional:');
  for (const t of report.tools.filter(t => !t.required)) {
    const icon = t.ok ? '  ✓' : '  -';
    const pad = ' '.repeat(Math.max(0, 18 - t.name.length));
    const hint = t.ok ? '' : `    ← ${t.purpose}`;
    lines.push(`  ${icon} ${t.name}${pad}${t.version}${hint}`);
  }

  lines.push('');
  lines.push(`  Required:  ${report.requiredOk}/${report.requiredTotal} OK`);
  lines.push(`  Optional:  ${report.optionalOk}/${report.optionalTotal} OK`);

  if (!report.healthy) {
    lines.push('');
    lines.push('  ✗ UNHEALTHY — required tools missing. CAP cannot function correctly.');
  }

  if (report.installCommands.length > 0) {
    lines.push('');
    lines.push('  To install missing tools:');
    for (const cmd of report.installCommands) {
      lines.push(`    ${cmd}`);
    }
  }

  if (report.healthy && report.optionalOk === report.optionalTotal) {
    lines.push('');
    lines.push('  All tools available. CAP is fully operational.');
  }

  return lines.join('\n');
}

module.exports = {
  checkTool,
  runDoctor,
  formatReport,
};
