#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
args=()
for arg in "$@"; do
  if [[ "$arg" != "--" ]]; then
    args+=("$arg")
  fi
done
.venv/bin/python publish.py ${args[@]+"${args[@]}"}

# Post-publish guard: evict cross-domain contamination (multi-tech topic tools,
# shared-vendor dependency artifacts) from the freshly written JSONs. Mirrors
# the discovery-side qualification fixes; needed until the DB has been
# requalified with the fixed engine (github: qualify pass).
node ../scripts/scrub-cross-domain.mjs
