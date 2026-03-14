#!/usr/bin/env bash

set -euo pipefail

INDEX_ROOT="/data/index"
REPOS_ROOT="/repos"
DEFAULT_INTERVAL_SECONDS=300

resolve_interval_seconds() {
  local configured_interval="${INDEX_INTERVAL_SECONDS:-${DEFAULT_INTERVAL_SECONDS}}"

  if [[ "${configured_interval}" =~ ^[0-9]+$ ]] && [[ "${configured_interval}" -gt 0 ]]; then
    echo "${configured_interval}"
    return
  fi

  echo "Invalid INDEX_INTERVAL_SECONDS='${configured_interval}', using ${DEFAULT_INTERVAL_SECONDS}." >&2
  echo "${DEFAULT_INTERVAL_SECONDS}"
}

run_index_pass() {
  local indexed_any=false

  echo "Starting Zoekt indexing pass..."

  shopt -s nullglob

  for repo_path in "${REPOS_ROOT}"/*; do
    local repo_name
    repo_name="$(basename "${repo_path}")"

    if [[ -L "${repo_path}" && ! -e "${repo_path}" ]]; then
      echo "Skipping ${repo_name}: broken symlink."
      continue
    fi

    if [[ ! -d "${repo_path}" ]]; then
      echo "Skipping ${repo_name}: not a directory."
      continue
    fi

    if ! git -C "${repo_path}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "Skipping ${repo_name}: not a Git repository."
      continue
    fi

    echo "Indexing ${repo_name}..."
    zoekt-git-index -index "${INDEX_ROOT}" "${repo_path}"
    indexed_any=true
  done

  if [[ "${indexed_any}" == "false" ]]; then
    echo "No Git repositories found directly under ${REPOS_ROOT}."
  fi

  echo "Zoekt indexing pass finished."
}

main() {
  local interval_seconds
  interval_seconds="$(resolve_interval_seconds)"

  while true; do
    run_index_pass

    if [[ "${INDEX_ONCE:-false}" == "true" ]]; then
      echo "INDEX_ONCE=true, exiting after a single indexing pass."
      exit 0
    fi

    echo "Sleeping for ${interval_seconds} seconds before the next indexing pass."
    sleep "${interval_seconds}"
  done
}

main "$@"
