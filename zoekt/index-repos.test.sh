#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPORADAR_ZOEKT_TEST_MODE=true
# shellcheck source=./index-repos.sh
source "${SCRIPT_DIR}/index-repos.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"

  if [[ "${expected}" != "${actual}" ]]; then
    echo "ASSERTION FAILED: ${message}" >&2
    echo "  expected: ${expected}" >&2
    echo "  actual:   ${actual}" >&2
    exit 1
  fi
}

assert_file_contains() {
  local file_path="$1"
  local pattern="$2"
  local message="$3"

  if ! grep -Fq "${pattern}" "${file_path}"; then
    echo "ASSERTION FAILED: ${message}" >&2
    echo "  missing pattern: ${pattern}" >&2
    exit 1
  fi
}

assert_json_valid() {
  local file_path="$1"

  node -e "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));" "${file_path}"
}

create_test_environment() {
  local name="$1"
  local env_root="${TEST_ROOT}/${name}"

  mkdir -p "${env_root}/coordination"
  COORDINATION_ROOT="${env_root}/coordination"
  SEARCH_STATE_FILE="${COORDINATION_ROOT}/zoekt-refresh-state.json"
}

create_repo_fingerprint_file() {
  local file_path="$1"
  cat > "${file_path}" <<'EOF'
repo-a	aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	4
repo-b	bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb	7
EOF
}

test_valid_write() {
  local repo_fingerprints_file
  create_test_environment "valid-write"
  repo_fingerprints_file="$(mktemp "${COORDINATION_ROOT}/repo-fingerprints.XXXXXX")"
  create_repo_fingerprint_file "${repo_fingerprints_file}"

  write_search_state_ready "snapshot-ready" "2026-03-17T11:00:00Z" "${repo_fingerprints_file}"
  assert_json_valid "${SEARCH_STATE_FILE}"
  assert_file_contains "${SEARCH_STATE_FILE}" '"status": "ready"' "ready marker should be written"
  assert_file_contains "${SEARCH_STATE_FILE}" '"repoId":"repo-a"' "repo-a fingerprint should be present"
}

test_atomicity_preserves_previous_marker_on_failure() {
  local repo_fingerprints_file
  local before_contents

  create_test_environment "atomicity"
  repo_fingerprints_file="$(mktemp "${COORDINATION_ROOT}/repo-fingerprints.XXXXXX")"
  create_repo_fingerprint_file "${repo_fingerprints_file}"

  write_search_state_ready "snapshot-old" "2026-03-17T11:00:00Z" "${repo_fingerprints_file}"
  before_contents="$(cat "${SEARCH_STATE_FILE}")"

  REPORADAR_ZOEKT_FAIL_AFTER_TEMP_WRITE=true
  if write_search_state_ready "snapshot-new" "2026-03-17T11:05:00Z" "${repo_fingerprints_file}"; then
    echo "ASSERTION FAILED: simulated temp-write failure should not succeed" >&2
    exit 1
  fi
  unset REPORADAR_ZOEKT_FAIL_AFTER_TEMP_WRITE

  assert_eq "${before_contents}" "$(cat "${SEARCH_STATE_FILE}")" "failed write must leave the previous marker intact"
  assert_json_valid "${SEARCH_STATE_FILE}"
}

test_concurrent_writes_remain_valid() {
  local repo_fingerprints_file

  create_test_environment "concurrent"
  repo_fingerprints_file="$(mktemp "${COORDINATION_ROOT}/repo-fingerprints.XXXXXX")"
  create_repo_fingerprint_file "${repo_fingerprints_file}"

  local jobs=()
  local snapshot_id
  for snapshot_id in one two three four five; do
    (
      export COORDINATION_ROOT SEARCH_STATE_FILE REPORADAR_ZOEKT_TEST_MODE=true
      source "${SCRIPT_DIR}/index-repos.sh"
      write_search_state_ready "snapshot-${snapshot_id}" "2026-03-17T11:0${#snapshot_id}:00Z" "${repo_fingerprints_file}"
    ) &
    jobs+=("$!")
  done

  local job
  for job in "${jobs[@]}"; do
    wait "${job}"
  done

  assert_json_valid "${SEARCH_STATE_FILE}"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (data.status !== 'ready') process.exit(1); if (!['snapshot-one','snapshot-two','snapshot-three','snapshot-four','snapshot-five'].includes(data.snapshotId)) process.exit(2);" "${SEARCH_STATE_FILE}"
}

test_serialization_failure_does_not_overwrite_marker() {
  local repo_fingerprints_file
  local before_contents

  create_test_environment "serialization-failure"
  repo_fingerprints_file="$(mktemp "${COORDINATION_ROOT}/repo-fingerprints.XXXXXX")"
  create_repo_fingerprint_file "${repo_fingerprints_file}"

  write_search_state_ready "snapshot-old" "2026-03-17T11:00:00Z" "${repo_fingerprints_file}"
  before_contents="$(cat "${SEARCH_STATE_FILE}")"

  if write_search_state_payload '{"status":"ready"}' "invalid-payload"; then
    echo "ASSERTION FAILED: invalid payload should be rejected" >&2
    exit 1
  fi

  assert_eq "${before_contents}" "$(cat "${SEARCH_STATE_FILE}")" "invalid payload must not overwrite the existing marker"
  assert_json_valid "${SEARCH_STATE_FILE}"
}

test_schema_integrity() {
  local repo_fingerprints_file

  create_test_environment "schema-integrity"
  repo_fingerprints_file="$(mktemp "${COORDINATION_ROOT}/repo-fingerprints.XXXXXX")"
  create_repo_fingerprint_file "${repo_fingerprints_file}"

  write_search_state_ready "snapshot-schema" "2026-03-17T11:00:00Z" "${repo_fingerprints_file}"

  node - "${SEARCH_STATE_FILE}" <<'EOF'
const fs = require('fs');
const filePath = process.argv[2];
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

if (typeof data.schemaVersion !== 'number') throw new Error('schemaVersion must be a number');
if (typeof data.snapshotId !== 'string' || data.snapshotId.length === 0) throw new Error('snapshotId must be a string');
if (!['ready', 'failed', 'pending'].includes(data.status)) throw new Error('status must be valid');
if (typeof data.refreshedAt !== 'string' || data.refreshedAt.length === 0) throw new Error('refreshedAt must be a string');
if (typeof data.aggregateFingerprint !== 'string' || data.aggregateFingerprint.length === 0) throw new Error('aggregateFingerprint must be a string');
if (!Array.isArray(data.repoFingerprints) || data.repoFingerprints.length !== 2) throw new Error('repoFingerprints must be present');
for (const entry of data.repoFingerprints) {
  if (typeof entry.repoId !== 'string') throw new Error('repoId must be a string');
  if (typeof entry.fingerprint !== 'string') throw new Error('fingerprint must be a string');
  if (typeof entry.fileCount !== 'number') throw new Error('fileCount must be a number');
}
EOF
}

test_valid_write
test_atomicity_preserves_previous_marker_on_failure
test_concurrent_writes_remain_valid
test_serialization_failure_does_not_overwrite_marker
test_schema_integrity

echo "zoekt/index-repos.test.sh: PASS"
