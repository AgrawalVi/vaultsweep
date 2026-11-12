#!/usr/bin/env bash
# Security invariant 6 (CLAUDE.md): never #[derive(Debug)] on a struct or enum
# that holds a plaintext password directly. Such types need a hand-written
# Debug that redacts the field. Fails if a type deriving Debug has a field
# named `password` or `*_password`.
#
# A deliberate exception (e.g. a test control that must leak) goes between
# the derive and the type as: // check-debug-derive: allow <reason>
#
# Usage: scripts/check-debug-derive.sh [dir ...]
#        (default: src-tauri/src src-tauri/tests)
set -euo pipefail

dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(src-tauri/src src-tauri/tests)

find "${dirs[@]}" -name '*.rs' -print0 | xargs -0 awk '
  FNR == 1 { pending = 0; inbody = 0 }

  # Outside a type body: a derive that includes Debug arms the check for the
  # next struct/enum. Attributes, comments and blank lines may sit between.
  !inbody {
    if ($0 ~ /#\[derive\(/ && $0 ~ /[(, ]Debug[,)]/) { pending = 1; allowed = 0; next }
    if (pending && $0 ~ /check-debug-derive: allow/) { allowed = 1; next }
    if (pending && $0 ~ /^[[:space:]]*(#\[|\/\/|$)/) next
    if (pending && $0 ~ /(^|[[:space:]])(struct|enum)[[:space:]]/) {
      name = $0
      sub(/.*(struct|enum)[[:space:]]+/, "", name)
      sub(/[^A-Za-z0-9_].*/, "", name)
      inbody = 1; depth = 0; opened = 0; pending = 0
    } else {
      pending = 0
      next
    }
  }

  # Inside the type (header line included).
  {
    if (!allowed && $0 ~ /(^|[{(,])[[:space:]]*(pub(\([^)]*\))?[[:space:]]+)?([a-z0-9_]*_)?password[[:space:]]*:/) {
      printf "%s:%d: %s derives Debug but has a plaintext password field (CLAUDE.md invariant 6)\n", FILENAME, FNR, name
      bad = 1
    }
    line = $0
    opens = gsub(/\{/, "", line)
    closes = gsub(/\}/, "", line)
    depth += opens - closes
    if (opens > 0) opened = 1
    # Braced body closed, or a unit/tuple type ended with `;` before any `{`.
    if ((opened && depth <= 0) || (!opened && $0 ~ /;[[:space:]]*$/)) inbody = 0
  }

  END { exit bad }
'
