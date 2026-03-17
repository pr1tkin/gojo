#!/usr/bin/env bash

set -euo pipefail

INDEX_ROOT="${INDEX_ROOT:-/data/index}"
REPOS_ROOT="${REPOS_ROOT:-/repos}"
COORDINATION_ROOT="${COORDINATION_ROOT:-/data/coordination}"
SEARCH_STATE_FILE="${SEARCH_STATE_FILE:-${COORDINATION_ROOT}/zoekt-refresh-state.json}"
DEFAULT_INTERVAL_SECONDS="${DEFAULT_INTERVAL_SECONDS:-300}"
SEARCH_STATE_SCHEMA_VERSION="${SEARCH_STATE_SCHEMA_VERSION:-1}"

log_info() {
  echo "[zoekt-coordination] $*" >&2
}

log_error() {
  echo "[zoekt-coordination] $*" >&2
}

SEARCH_IGNORED_DIRECTORIES=(
  ".git"
  "node_modules"
  "dist"
  "build"
  "coverage"
  ".next"
  ".turbo"
  ".cache"
  "out"
  "storybook-static"
  "generated"
)

SEARCH_IGNORED_FILE_NAMES=(
  ".ds_store"
)

SEARCH_IGNORED_FILE_SUFFIXES=(
  ".d.ts"
  ".generated.ts"
  ".generated.tsx"
  ".tmp"
  ".temp"
  ".swp"
  ".swo"
  "~"
)

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  printf '%s' "${value}"
}

sync_path_if_possible() {
  local target_path="$1"

  if command -v sync >/dev/null 2>&1; then
    sync -f "${target_path}" >/dev/null 2>&1 || true
  fi
}

create_temp_file_in_directory() {
  local directory_path="$1"
  local prefix="$2"

  mkdir -p "${directory_path}"
  mktemp "${directory_path}/${prefix}.XXXXXX"
}

validate_search_state_payload() {
  local payload="$1"

  [[ "${payload}" == \{* ]] || return 1
  [[ "${payload}" == *\} ]] || return 1
  [[ "${payload}" == *'"schemaVersion":'* ]] || return 1
  [[ "${payload}" == *'"snapshotId":'* ]] || return 1
  [[ "${payload}" == *'"status":'* ]] || return 1
  [[ "${payload}" == *'"refreshedAt":'* ]] || return 1
  [[ "${payload}" == *'"repoFingerprints":'* ]] || return 1
  [[ "${payload}" == *'"details":'* ]] || return 1

  return 0
}

write_search_state_payload() {
  local payload="$1"
  local write_description="$2"
  local temp_file

  if ! validate_search_state_payload "${payload}"; then
    log_error "refusing to overwrite ${SEARCH_STATE_FILE}: ${write_description} payload failed validation"
    return 1
  fi

  temp_file="$(create_temp_file_in_directory "${COORDINATION_ROOT}" "zoekt-refresh-state.tmp")"

  {
    printf '%s\n' "${payload}"
  } > "${temp_file}"

  sync_path_if_possible "${temp_file}"

  if [[ "${REPORADAR_ZOEKT_FAIL_AFTER_TEMP_WRITE:-false}" == "true" ]]; then
    rm -f "${temp_file}"
    log_error "simulated failure after temporary write for ${write_description}; keeping previous marker"
    return 1
  fi

  mv "${temp_file}" "${SEARCH_STATE_FILE}"
  sync_path_if_possible "${COORDINATION_ROOT}"
  log_info "wrote ${SEARCH_STATE_FILE} (${write_description})"
}

resolve_interval_seconds() {
  local configured_interval="${INDEX_INTERVAL_SECONDS:-${DEFAULT_INTERVAL_SECONDS}}"

  if [[ "${configured_interval}" =~ ^[0-9]+$ ]] && [[ "${configured_interval}" -gt 0 ]]; then
    echo "${configured_interval}"
    return
  fi

  echo "Invalid INDEX_INTERVAL_SECONDS='${configured_interval}', using ${DEFAULT_INTERVAL_SECONDS}." >&2
  echo "${DEFAULT_INTERVAL_SECONDS}"
}

should_ignore_relative_path() {
  local relative_path="$1"
  local normalized_path="${relative_path#./}"
  local lower_path
  local file_name
  local segment
  lower_path="$(printf '%s' "${normalized_path}" | tr '[:upper:]' '[:lower:]')"
  file_name="${lower_path##*/}"
  IFS='/' read -r -a path_segments <<< "${normalized_path}"

  for segment in "${path_segments[@]}"; do
    local ignored_directory
    for ignored_directory in "${SEARCH_IGNORED_DIRECTORIES[@]}"; do
      if [[ "${segment}" == "${ignored_directory}" ]]; then
        return 0
      fi
    done
  done

  local ignored_name
  for ignored_name in "${SEARCH_IGNORED_FILE_NAMES[@]}"; do
    if [[ "${file_name}" == "${ignored_name}" ]]; then
      return 0
    fi
  done

  local ignored_suffix
  for ignored_suffix in "${SEARCH_IGNORED_FILE_SUFFIXES[@]}"; do
    if [[ "${file_name}" == *"${ignored_suffix}" ]]; then
      return 0
    fi
  done

  return 1
}

run_index_pass() {
  local indexed_any=false
  local refresh_started_at
  local repo_fingerprint_file
  local snapshot_id

  refresh_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  snapshot_id="$(date -u +"%Y%m%dT%H%M%SZ")-$$"
  repo_fingerprint_file="$(create_temp_file_in_directory "${COORDINATION_ROOT}" "zoekt-repo-fingerprints")"

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
    printf '%s\t%s\t%s\n' "${repo_name}" "${repo_fingerprint}" "${repo_file_count}" >> "${repo_fingerprint_file}"
    indexed_any=true
  done

  if [[ "${indexed_any}" == "false" ]]; then
    echo "No Git repositories found directly under ${REPOS_ROOT}."
  fi

  write_search_state_ready "${snapshot_id}" "${refresh_started_at}" "${repo_fingerprint_file}"
  rm -f "${repo_fingerprint_file}"
  echo "Zoekt indexing pass finished."
}

count_repo_files() {
  local repo_path="$1"
  local file_count=0
  local file_path
  local relative_path

  while IFS= read -r -d '' file_path; do
    relative_path="${file_path#${repo_path}/}"

    if should_ignore_relative_path "${relative_path}"; then
      continue
    fi

    file_count=$((file_count + 1))
  done < <(find "${repo_path}" -type f -print0)

  printf '%s' "${file_count}"
}

compute_repo_fingerprint() {
  local repo_path="$1"
  local tmp_file
  tmp_file="$(mktemp)"

  while IFS= read -r -d '' file_path; do
    local relative_path
    relative_path="${file_path#${repo_path}/}"

    if should_ignore_relative_path "${relative_path}"; then
      continue
    fi

    printf '%s\t%s\n' "${relative_path}" "$(sha256sum "${file_path}" | awk '{print $1}')" >> "${tmp_file}"
  done < <(find "${repo_path}" -type f -print0 | sort -z)

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
  local repo_fingerprint_file="$1"
  local normalized_file

  if [[ ! -s "${repo_fingerprint_file}" ]]; then
    printf '%s' "empty"
    return
  fi

  normalized_file="$(mktemp)"
  sort "${repo_fingerprint_file}" > "${normalized_file}"

  local aggregate_fingerprint
  aggregate_fingerprint="$(sha256sum "${normalized_file}" | awk '{print $1}')"
  rm -f "${normalized_file}"
  printf '%s' "${aggregate_fingerprint}"
}

build_search_state_ready_payload() {
  local snapshot_id="$1"
  local refreshed_at="$2"
  local repo_fingerprint_file="$3"
  local aggregate_fingerprint
  local payload_file
  local payload
  local sorted_repo_fingerprint_file
  local is_first=true

  aggregate_fingerprint="$(compute_aggregate_fingerprint "${repo_fingerprint_file}")"
  payload_file="$(create_temp_file_in_directory "${COORDINATION_ROOT}" "zoekt-refresh-payload")"
  sorted_repo_fingerprint_file="$(create_temp_file_in_directory "${COORDINATION_ROOT}" "zoekt-repo-fingerprints.sorted")"
  sort "${repo_fingerprint_file}" > "${sorted_repo_fingerprint_file}"

  {
    printf '{\n'
    printf '  "schemaVersion": %s,\n' "${SEARCH_STATE_SCHEMA_VERSION}"
    printf '  "snapshotId": "%s",\n' "$(json_escape "${snapshot_id}")"
    printf '  "status": "ready",\n'
    printf '  "refreshedAt": "%s",\n' "$(json_escape "${refreshed_at}")"
    printf '  "aggregateFingerprint": "%s",\n' "$(json_escape "${aggregate_fingerprint}")"
    printf '  "repoFingerprints": [\n'
    if [[ -s "${sorted_repo_fingerprint_file}" ]]; then
      while IFS=$'\t' read -r repo_id fingerprint file_count; do
        if [[ -z "${repo_id}" ]]; then
          continue
        fi
        if [[ "${is_first}" == "false" ]]; then
          printf ',\n'
        fi
        printf '    {"repoId":"%s","fingerprint":"%s","fileCount":%s}' \
          "$(json_escape "${repo_id}")" \
          "$(json_escape "${fingerprint}")" \
          "${file_count}"
        is_first=false
      done < "${sorted_repo_fingerprint_file}"
      printf '\n'
    fi
    printf '  ],\n'
    printf '  "details": "Zoekt indexing pass completed successfully."\n'
    printf '}\n'
  } > "${payload_file}"

  payload="$(cat "${payload_file}")"
  rm -f "${sorted_repo_fingerprint_file}"
  rm -f "${payload_file}"
  printf '%s' "${payload}"
}

write_search_state_ready() {
  local snapshot_id="$1"
  local refreshed_at="$2"
  local repo_fingerprint_file="$3"
  local payload

  payload="$(build_search_state_ready_payload "${snapshot_id}" "${refreshed_at}" "${repo_fingerprint_file}")" || {
    log_error "failed to build ready search state payload"
    return 1
  }

  write_search_state_payload "${payload}" "status=ready snapshotId=${snapshot_id}" || {
    log_error "keeping previous marker after failed ready-state write"
    return 1
  }
}

build_search_state_failed_payload() {
  local error_message="$1"
  local failed_at
  local payload_file
  local payload

  failed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  payload_file="$(create_temp_file_in_directory "${COORDINATION_ROOT}" "zoekt-refresh-payload")"

  {
    printf '{\n'
    printf '  "schemaVersion": %s,\n' "${SEARCH_STATE_SCHEMA_VERSION}"
    printf '  "snapshotId": "%s",\n' "$(json_escape "${failed_at}-$$")"
    printf '  "status": "failed",\n'
    printf '  "refreshedAt": "%s",\n' "$(json_escape "${failed_at}")"
    printf '  "repoFingerprints": [],\n'
    printf '  "error": "%s",\n' "$(json_escape "${error_message}")"
    printf '  "details": "Zoekt indexing pass failed before producing a refreshed snapshot."\n'
    printf '}\n'
  } > "${payload_file}"

  payload="$(cat "${payload_file}")"
  rm -f "${payload_file}"
  printf '%s' "${payload}"
}

write_search_state_failed() {
  local error_message="$1"
  local payload

  payload="$(build_search_state_failed_payload "${error_message}")" || {
    log_error "failed to build failed search state payload"
    return 1
  }

  write_search_state_payload "${payload}" "status=failed" || {
    log_error "keeping previous marker after failed failure-state write"
    return 1
  }
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

if [[ "${REPORADAR_ZOEKT_TEST_MODE:-false}" != "true" ]]; then
  main "$@"
fi
