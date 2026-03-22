#!/usr/bin/env sh
set -eu

install_dir="${GOJO_INSTALL_DIR:-$HOME/.gojo/bin}"
bin_link="${GOJO_BIN_LINK:-}"

if [ ! -e "$install_dir/gojo" ] && [ ! -d "$install_dir/helper" ] && [ ! -d "$install_dir/.runtime" ]; then
  printf 'Gojo is not installed at %s\n' "$install_dir"
  exit 0
fi

rm -rf \
  "$install_dir/gojo" \
  "$install_dir/helper" \
  "$install_dir/.runtime" \
  "$install_dir/VERSION" \
  "$install_dir/README.md" \
  "$install_dir/LICENSE"

if [ -n "$bin_link" ] && [ -L "$bin_link" ]; then
  rm -f "$bin_link"
fi

printf 'Removed Gojo from %s\n' "$install_dir"
