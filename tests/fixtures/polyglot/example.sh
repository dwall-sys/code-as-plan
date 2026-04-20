#!/usr/bin/env bash
# @cap-feature(feature:F-046) Shell script polyglot fixture.
# @cap-todo(ac:F-046/AC-1) Shell `#` line comments are recognized.
# @cap-risk Shell here-docs (<<EOF) are NOT classified as comments — the scanner will warn if a tag appears in one.
# @cap-decision No block-comment syntax exists in shell, so block list is empty.

set -euo pipefail

authenticate() {
  # @cap-todo(ac:F-046/AC-1) Inline comment inside a function body.
  local user="$1"
  [[ -n "$user" ]] || return 1
}

authenticate "alice"
