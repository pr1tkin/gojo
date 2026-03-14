#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required." >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/repos" ]]; then
  echo "Error: repos directory not found at ${ROOT_DIR}/repos." >&2
  exit 1
fi

echo "Building the Zoekt indexer image..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" build zoekt-indexer
echo "Running a single indexing pass..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" run --rm --no-deps \
  -e INDEX_ONCE=true zoekt-indexer
