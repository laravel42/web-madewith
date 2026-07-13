#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
args=()
for arg in "$@"; do
  if [[ "$arg" != "--" ]]; then
    args+=("$arg")
  fi
done
exec .venv/bin/python publish.py "${args[@]}"
