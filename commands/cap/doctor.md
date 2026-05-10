---
name: cap:doctor
description: "Check that all required and optional tools for CAP are installed and working."
argument-hint: "[--fix]"
allowed-tools:
  - Bash
  - Read
---

<!-- @cap-context CAP v2.0 doctor command -- checks all external dependencies CAP needs at runtime and reports health status. -->
<!-- @cap-decision Doctor is read-only by default -- it checks tool availability but never installs anything. The --fix flag (F-097) is the only write path and is strictly opt-in: it writes a timestamped backup of settings.json before adding missing CAP hook registrations. -->

<objective>
Check that all required and optional external tools for CAP are installed and working. Reports health status with version info and install hints for missing tools.

Required tools: Node.js (>= 20), npm, git
Optional tools: Context7 (ctx7), c8, vitest, fast-check (project-specific)
Hook registration (F-097): every cap-*.js installed under `~/.claude/hooks/` must be registered under its expected lifecycle in `~/.claude/settings.json`. The doctor reports drift in three buckets — registered+reachable, installed-but-not-registered, broken-pointer.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Run the doctor check

```bash
node -e "
const doctor = require('./cap/bin/lib/cap-doctor.cjs');
const report = doctor.runDoctor(process.cwd());
console.log(doctor.formatReport(report));
"
```

Store the output as `doctor_output`.

## Step 2: Display the report

Print `doctor_output` verbatim to the user.

## Step 3: Health assessment

If the report shows `UNHEALTHY`:
- Warn strongly that CAP cannot function correctly without required tools.
- List the specific missing required tools and their install instructions.

If the report shows `DEGRADED — CAP hooks not fully registered`:
- Show the user which CAP hooks are installed but not registered.
- Offer to run `cap doctor --fix` to add the missing registrations (writes a timestamped `settings.json.bak-pre-fix-<date>` first). Strictly opt-in — never auto-fix.

If the report shows missing optional tools:
- Note which CAP features will have reduced functionality.
- Show the install commands from the report.

If all tools are available:
- Confirm CAP is fully operational.

## Step 3b: --fix path (F-097)

If the user passed `--fix` in $ARGUMENTS:

```bash
node -e "
const doctor = require('./cap/bin/lib/cap-doctor.cjs');
const result = doctor.applyRegistrationFix({ apply: true });
if (result.patches.length === 0) {
  console.log('Nothing to fix — every CAP hook is already registered.');
} else {
  console.log('Backup written: ' + result.backupPath);
  console.log('Applied ' + result.patches.length + ' registration(s):');
  for (const p of result.patches) console.log('  ' + p.op + ' ' + p.path);
}
"
```

After running --fix, re-run the read-only doctor to confirm the hook section is now ✓.

## Step 4: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:doctor',
  lastCommandTimestamp: new Date().toISOString()
});
"
```

</process>
