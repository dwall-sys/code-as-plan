# Phase Numbering

Parse, normalize, validate phase arguments and calculate decimal phase numbers for urgent insertions.

## Argument Parsing

From `$ARGUMENTS`:
- Extract phase number (first numeric argument)
- Extract flags (prefixed with `--`)
- Remaining text is description (for insert/add commands)

### Using gsd-tools

The `find-phase` command handles normalization and validation in one step:

```bash
PHASE_INFO=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" find-phase "${PHASE}")
```

Returns JSON with:
- `found`: true/false
- `directory`: Full path to phase directory
- `phase_number`: Normalized number (e.g., "06", "06.1")
- `phase_name`: Name portion (e.g., "foundation")
- `plans`: Array of PLAN.md files
- `summaries`: Array of SUMMARY.md files

### Manual Normalization (Legacy)

Zero-pad integer phases to 2 digits. Preserve decimal suffixes.

```bash
# Normalize phase number
if [[ "$PHASE" =~ ^[0-9]+$ ]]; then
  # Integer: 8 → 08
  PHASE=$(printf "%02d" "$PHASE")
elif [[ "$PHASE" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  # Decimal: 2.1 → 02.1
  PHASE=$(printf "%02d.%s" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}")
fi
```

### Validation

Use `roadmap get-phase` to validate phase exists:

```bash
PHASE_CHECK=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" roadmap get-phase "${PHASE}" --pick found)
if [ "$PHASE_CHECK" = "false" ]; then
  echo "ERROR: Phase ${PHASE} not found in roadmap"
  exit 1
fi
```

### Directory Lookup

Use `find-phase` for directory lookup:

```bash
PHASE_DIR=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" find-phase "${PHASE}" --raw)
```

## Decimal Phase Calculation

Calculate the next decimal phase number for urgent insertions between integer phases.

### Using gsd-tools

```bash
# Get next decimal phase after phase 6
node "$HOME/.claude/cap/bin/cap-tools.cjs" phase next-decimal 6
```

Output:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.1",
  "existing": []
}
```

With existing decimals:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.3",
  "existing": ["06.1", "06.2"]
}
```

### Extract Values

```bash
DECIMAL_PHASE=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" phase next-decimal "${AFTER_PHASE}" --pick next)
BASE_PHASE=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" phase next-decimal "${AFTER_PHASE}" --pick base_phase)
```

Or with --raw flag:
```bash
DECIMAL_PHASE=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" phase next-decimal "${AFTER_PHASE}" --raw)
# Returns just: 06.1
```

### Examples

| Existing Phases | Next Phase |
|-----------------|------------|
| 06 only | 06.1 |
| 06, 06.1 | 06.2 |
| 06, 06.1, 06.2 | 06.3 |
| 06, 06.1, 06.3 (gap) | 06.4 |

### Directory Naming

Decimal phase directories use the full decimal number:

```bash
SLUG=$(node "$HOME/.claude/cap/bin/cap-tools.cjs" generate-slug "$DESCRIPTION" --raw)
PHASE_DIR=".planning/phases/${DECIMAL_PHASE}-${SLUG}"
mkdir -p "$PHASE_DIR"
```

Example: `.planning/phases/06.1-fix-critical-auth-bug/`
