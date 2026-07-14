#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
args=()
for arg in "$@"; do
  if [[ "$arg" != "--" ]]; then
    args+=("$arg")
  fi
done
exec .venv/bin/python migrate_json_to_pg.py ${args[@]+"${args[@]}"}
