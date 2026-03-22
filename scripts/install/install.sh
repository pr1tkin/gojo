#!/usr/bin/env sh
set -eu

REPO="pr1tkin/gojo"
DEFAULT_INSTALL_DIR="${HOME}/.gojo/bin"
SYSTEM_INSTALL_DIR="/usr/local/lib/gojo"
SYSTEM_BIN_LINK="/usr/local/bin/gojo"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1. Install it and retry."
}

detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux) platform="linux" ;;
    Darwin) platform="darwin" ;;
    *) fail "Unsupported platform: $os. Gojo supports linux and macOS for this installer." ;;
  esac

  case "$arch" in
    x86_64|amd64) target_arch="x64" ;;
    arm64|aarch64) target_arch="arm64" ;;
    *) fail "Unsupported architecture: $arch. Gojo supports x64 and arm64." ;;
  esac
}

fetch_release_metadata() {
  if [ -n "${GOJO_VERSION:-}" ]; then
    release_api="https://api.github.com/repos/${REPO}/releases/tags/${GOJO_VERSION}"
  else
    release_api="https://api.github.com/repos/${REPO}/releases/latest"
  fi

  release_json="$(curl -fsSL "$release_api")" || fail "Failed to query GitHub release metadata."
  release_version="$(printf '%s\n' "$release_json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$release_version" ] || fail "Could not determine Gojo release version from GitHub."

  artifact_name="gojo-${release_version}-${platform}-${target_arch}.tar.gz"
  artifact_url="$(printf '%s\n' "$release_json" | sed -n "s#.*\"browser_download_url\":[[:space:]]*\"\\([^\"]*${artifact_name}\\)\".*#\\1#p" | head -n 1)"
  [ -n "$artifact_url" ] || fail "Release ${release_version} does not include ${artifact_name}."
}

resolve_install_layout() {
  if [ -n "${GOJO_INSTALL_DIR:-}" ]; then
    install_dir="$GOJO_INSTALL_DIR"
    bin_link=""
    return
  fi

  if [ "${1:-}" = "--system" ]; then
    [ -w "$(dirname "$SYSTEM_INSTALL_DIR")" ] || fail "System install requires write access to $(dirname "$SYSTEM_INSTALL_DIR")."
    [ -w "$(dirname "$SYSTEM_BIN_LINK")" ] || fail "System install requires write access to $(dirname "$SYSTEM_BIN_LINK")."
    install_dir="$SYSTEM_INSTALL_DIR"
    bin_link="$SYSTEM_BIN_LINK"
    return
  fi

  install_dir="$DEFAULT_INSTALL_DIR"
  bin_link=""
}

validate_extracted_layout() {
  [ -f "$1/gojo" ] || fail "Extracted artifact is missing gojo."
  [ -d "$1/helper" ] || fail "Extracted artifact is missing helper/."
  [ -f "$1/VERSION" ] || fail "Extracted artifact is missing VERSION."
  [ -d "$1/.runtime" ] || fail "Extracted artifact is missing .runtime/."
}

copy_payload() {
  mkdir -p "$install_dir"
  rm -rf \
    "$install_dir/gojo" \
    "$install_dir/helper" \
    "$install_dir/.runtime" \
    "$install_dir/VERSION" \
    "$install_dir/README.md" \
    "$install_dir/LICENSE"

  cp "$extract_dir/gojo" "$install_dir/gojo"
  cp -R "$extract_dir/helper" "$install_dir/helper"
  cp -R "$extract_dir/.runtime" "$install_dir/.runtime"
  cp "$extract_dir/VERSION" "$install_dir/VERSION"
  cp "$extract_dir/README.md" "$install_dir/README.md"
  cp "$extract_dir/LICENSE" "$install_dir/LICENSE"

  chmod +x "$install_dir/gojo"
  chmod +x "$install_dir/helper/zoekt-webserver" "$install_dir/helper/zoekt-git-index"

  if [ -n "$bin_link" ]; then
    ln -sfn "$install_dir/gojo" "$bin_link"
    install_exec="$bin_link"
  else
    install_exec="$install_dir/gojo"
  fi
}

print_path_guidance() {
  if [ "${GOJO_SKIP_PATH_HINT:-0}" = "1" ]; then
    return
  fi

  bin_dir="$(dirname "$install_exec")"
  case ":$PATH:" in
    *":$bin_dir:"*) return ;;
  esac

  log "→ Add to PATH: export PATH=\"$bin_dir:\$PATH\""
}

require_command curl
require_command tar
detect_target
resolve_install_layout "${1:-}"
fetch_release_metadata

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

archive_path="${tmp_dir}/${artifact_name}"
extract_dir="${tmp_dir}/extract"

log "→ Downloading Gojo ${release_version} (${platform}/${target_arch})"
curl -fsSL "$artifact_url" -o "$archive_path" || fail "Failed to download ${artifact_name}."
mkdir -p "$extract_dir"
tar -xzf "$archive_path" -C "$extract_dir" || fail "Failed to extract ${artifact_name}. The archive may be corrupt."

validate_extracted_layout "$extract_dir"
copy_payload

"$install_exec" version >/dev/null 2>&1 || fail "Installed Gojo failed validation. Run \"$install_exec version\" for details."

log "Installed Gojo ${release_version}"
log "→ Executable: ${install_exec}"
print_path_guidance
