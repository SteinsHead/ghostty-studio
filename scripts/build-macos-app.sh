#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build:app can only run on macOS" >&2
  exit 1
fi

build_user_home="${HOME:?HOME must be set for build path remapping}"
build_rustflags="${RUSTFLAGS:-}"
if [[ -n "$build_rustflags" ]]; then
  build_rustflags+=" "
fi
build_rustflags+="--remap-path-prefix=$build_user_home=/build/home"

RUSTFLAGS="$build_rustflags" pnpm tauri build --bundles app --no-sign --ci -- --locked

app_path="$project_root/src-tauri/target/release/bundle/macos/Ghostty Studio.app"
if [[ ! -d "$app_path" ]]; then
  echo "expected app bundle was not produced: $app_path" >&2
  exit 1
fi
if grep -R -a -l -F -- "$build_user_home/" "$app_path" >/dev/null 2>&1; then
  echo "application bundle contains the local build home path" >&2
  exit 1
fi
if grep -R -a -l -E -- '/Users/[^/[:space:]]+/' "$app_path" >/dev/null 2>&1; then
  echo "application bundle contains a macOS user path" >&2
  exit 1
fi
if grep -R -a -l -E -- \
  'BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|github_pat_|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}' \
  "$app_path" >/dev/null 2>&1; then
  echo "application bundle matches a high-confidence credential pattern" >&2
  exit 1
fi
