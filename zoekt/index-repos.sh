#!/usr/bin/env bash

set -euo pipefail

INDEX_ROOT="/data/index"
REPOS_ROOT="/repos"
COORDINATION_ROOT="/data/coordination"
SEARCH_STATE_FILE="${COORDINATION_ROOT}/zoekt-refresh-state.json"
SEARCH_STATE_TMP_FILE="${COORDINATION_ROOT}/zoekt-refresh-state.tmp.json"
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
  local refresh_started_at
  local repo_fingerprint_lines=""
  local snapshot_id

  refresh_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  snapshot_id="$(date -u +"%Y%m%dT%H%M%SZ")-$$"

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
    local repo_fingerprint
    repo_fingerprint="$(compute_repo_fingerprint "${repo_path}")"
    local repo_file_count
    repo_file_count="$(count_repo_files "${repo_path}")"
    repo_fingerprint_lines+=$(printf '%s\t%s\t%s\n' "${repo_name}" "${repo_fingerprint}" "${repo_file_count}")
    indexed_any=true
  done

  if [[ "${indexed_any}" == "false" ]]; then
    echo "No Git repositories found directly under ${REPOS_ROOT}."
  fi

  write_search_state_ready "${snapshot_id}" "${refresh_started_at}" "${repo_fingerprint_lines}"
  echo "Zoekt indexing pass finished."
}

count_repo_files() {
  local repo_path="$1"

  find "${repo_path}" \
    \( -path "*/.git" -o -path "*/node_modules" -o -path "*/dist" -o -path "*/build" -o -path "*/coverage" \) -prune -o \
    -type f -print0 | tr -cd '\0' | wc -c | tr -d '[:space:]'
}

compute_repo_fingerprint() {
  local repo_path="$1"
  local tmp_file
  tmp_file="$(mktemp)"

  find "${repo_path}" \
    \( -path "*/.git" -o -path "*/node_modules" -o -path "*/dist" -o -path "*/build" -o -path "*/coverage" \) -prune -o \
    -type f -print0 |
    sort -z |
    while IFS= read -r -d '' file_path; do
      local relative_path
      relative_path="${file_path#${repo_path}/}"
      printf '%s\t%s\n' "${relative_path}" "$(sha256sum "${file_path}" | awk '{print $1}')" >> "${tmp_file}"
    done

  if [[ ! -s "${tmp_file}" ]]; then
    rm -f "${tmp_file}"
    printf '%s' "empty"
    return
  fi

  local repo_fingerprint
  repo_fingerprint="$(sha256sum "${tmp_file}" | awk '{print $1}')"
  rm -f "${tmp_file}"
  printf '%s' "${repo_fingerprint}"
}

compute_aggregate_fingerprint() {
  local repo_fingerprint_lines="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  printf '%s' "${repo_fingerprint_lines}" > "${tmp_file}"

  if [[ ! -s "${tmp_file}" ]]; then
    rm -f "${tmp_file}"
    printf '%s' "empty"
    return
  fi

  local aggregate_fingerprint
  aggregate_fingerprint="$(sha256sum "${tmp_file}" | awk '{print $1}')"
  rm -f "${tmp_file}"
  printf '%s' "${aggregate_fingerprint}"
}

write_search_state_ready() {
  local snapshot_id="$1"
  local refreshed_at="$2"
  local repo_fingerprint_lines="$3"
  local aggregate_fingerprint

  mkdir -p "${COORDINATION_ROOT}"
  aggregate_fingerprint="$(compute_aggregate_fingerprint "${repo_fingerprint_lines}")"

  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "snapshotId": "%s",\n' "${snapshot_id}"
    printf '  "status": "ready",\n'
    printf '  "refreshedAt": "%s",\n' "${refreshed_at}"
    printf '  "aggregateFingerprint": "%s",\n' "${aggregate_fingerprint}"
    printf '  "repoFingerprints": [\n'
    if [[ -n "${repo_fingerprint_lines}" ]]; then
      local is_first=true
      while IFS=$'\t' read -r repo_id fingerprint file_count; do
        if [[ -z "${repo_id}" ]]; then
          continue
        fi
        if [[ "${is_first}" == "false" ]]; then
          printf ',\n'
        fi
        printf '    {"repoId":"%s","fingerprint":"%s","fileCount":%s}' "${repo_id}" "${fingerprint}" "${file_count}"
        is_first=false
      done <<< "${repo_fingerprint_lines}"
      printf '\n'
    fi
    printf '  ],\n'
    printf '  "details": "Zoekt indexing pass completed successfully."\n'
    printf '}\n'
  } > "${SEARCH_STATE_TMP_FILE}"

  mv "${SEARCH_STATE_TMP_FILE}" "${SEARCH_STATE_FILE}"
}

write_search_state_failed() {
  local error_message="$1"
  local failed_at

  failed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "${COORDINATION_ROOT}"

  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "snapshotId": "%s",\n' "${failed_at}-$$"
    printf '  "status": "failed",\n'
    printf '  "refreshedAt": "%s",\n' "${failed_at}"
    printf '  "repoFingerprints": [],\n'
    printf '  "error": "%s",\n' "${error_message//\"/\\\"}"
    printf '  "details": "Zoekt indexing pass failed before producing a refreshed snapshot."\n'
    printf '}\n'
  } > "${SEARCH_STATE_TMP_FILE}"

  mv "${SEARCH_STATE_TMP_FILE}" "${SEARCH_STATE_FILE}"
}

main() {
  local interval_seconds
  interval_seconds="$(resolve_interval_seconds)"

  while true; do
    if ! run_index_pass; then
      write_search_state_failed "Zoekt indexing pass exited with a non-zero status."
      exit 1
    fi

    if [[ "${INDEX_ONCE:-false}" == "true" ]]; then
      echo "INDEX_ONCE=true, exiting after a single indexing pass."
      exit 0
    fi

    echo "Sleeping for ${interval_seconds} seconds before the next indexing pass."
    sleep "${interval_seconds}"
  done
}

main "$@"
