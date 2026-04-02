---
name: cap:doctor
description: "Check that all required and optional tools for CAP are installed and working."
argument-hint: ""
allowed-tools:
  - Bash
  - Read
---

<!-- @cap-context CAP v2.0 doctor command -- checks all external dependencies CAP needs at runtime and reports health status. -->
<!-- @cap-decision Doctor is read-only -- it checks tool availability but never installs anything. Safe to run at any time. -->

<objective>
Check that all required and optional external tools for CAP are installed and working. Reports health status with version info and install hints for missing tools.

Required tools: Node.js (>= 20), npm, git
Optional tools: Context7 (ctx7), c8, vitest, fast-check (project-specific)
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

If the report shows missing optional tools:
- Note which CAP features will have reduced functionality.
- Show the install commands from the report.

If all tools are available:
- Confirm CAP is fully operational.

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
