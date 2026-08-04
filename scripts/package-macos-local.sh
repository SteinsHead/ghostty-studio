#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "package:macos-local can only run on macOS" >&2
  exit 1
fi

for required_tool in pnpm node cargo codesign hdiutil ditto lipo shasum awk grep; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    echo "missing required tool: $required_tool" >&2
    exit 1
  fi
done

build_user_home="${HOME:?HOME must be set for release path remapping}"
release_rustflags="${RUSTFLAGS:-}"
if [[ -n "$release_rustflags" ]]; then
  release_rustflags+=" "
fi
release_rustflags+="--remap-path-prefix=$build_user_home=/build/home"

tauri_version="$(
  node --input-type=commonjs -p \
    "JSON.parse(require('node:fs').readFileSync('src-tauri/tauri.conf.json', 'utf8')).version"
)"
package_version="$(
  node --input-type=commonjs -p \
    "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version"
)"
cargo_version="$(awk -F '"' '/^version = "/ { print $2; exit }' src-tauri/Cargo.toml)"
if [[ -z "$tauri_version" || "$tauri_version" != "$package_version" ||
  "$tauri_version" != "$cargo_version" ]]; then
  echo "version mismatch: tauri=$tauri_version package=$package_version cargo=$cargo_version" >&2
  exit 1
fi

RUSTFLAGS="$release_rustflags" pnpm tauri build --bundles app --no-sign --ci -- --locked

app_path="$project_root/src-tauri/target/release/bundle/macos/Ghostty Studio.app"
if [[ ! -d "$app_path" ]]; then
  echo "expected app bundle was not produced: $app_path" >&2
  exit 1
fi

if grep -R -a -l -F -- "$build_user_home/" "$app_path" >/dev/null 2>&1; then
  echo "release bundle contains the local build home path" >&2
  exit 1
fi

# A local ad-hoc signature seals Info.plist and bundle resources. It is not a
# substitute for Developer ID signing and notarization for public distribution.
codesign --force --deep --sign - --timestamp=none --options runtime "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"

staging_root="$(mktemp -d "${TMPDIR:-/tmp}/ghostty-studio-dmg.XXXXXX")"
dmg_staging_root=""
cleanup() {
  if [[ -n "${staging_root:-}" && -d "$staging_root" ]] &&
    [[ "$(basename -- "$staging_root")" == ghostty-studio-dmg.* ]]; then
    rm -rf -- "$staging_root"
  fi
  if [[ -n "${dmg_staging_root:-}" && -d "$dmg_staging_root" ]] &&
    [[ "$(basename -- "$dmg_staging_root")" == .ghostty-studio-package.* ]]; then
    rm -rf -- "$dmg_staging_root"
  fi
}
trap cleanup EXIT

ditto "$app_path" "$staging_root/Ghostty Studio.app"
codesign --verify --deep --strict --verbose=2 "$staging_root/Ghostty Studio.app"
ln -s /Applications "$staging_root/Applications"

binary_path="$app_path/Contents/MacOS/ghostty-studio"
case "$(lipo -archs "$binary_path")" in
  arm64) bundle_arch="aarch64" ;;
  x86_64) bundle_arch="x64" ;;
  "arm64 x86_64" | "x86_64 arm64") bundle_arch="universal" ;;
  *)
    echo "unsupported application architecture: $(lipo -archs "$binary_path")" >&2
    exit 1
    ;;
esac

dmg_directory="$project_root/src-tauri/target/release/bundle/dmg"
dmg_path="$dmg_directory/Ghostty Studio_${tauri_version}_${bundle_arch}.dmg"
mkdir -p "$dmg_directory"
dmg_staging_root="$(mktemp -d "$dmg_directory/.ghostty-studio-package.XXXXXX")"
temporary_dmg="$dmg_staging_root/$(basename -- "$dmg_path")"
hdiutil create \
  -volname "Ghostty Studio" \
  -srcfolder "$staging_root" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$temporary_dmg"
hdiutil verify "$temporary_dmg"
mv -f -- "$temporary_dmg" "$dmg_path"
hdiutil verify "$dmg_path"

checksum="$(shasum -a 256 "$dmg_path" | awk '{print $1}')"
printf 'Created %s\nSHA-256 %s\n' "$dmg_path" "$checksum"
