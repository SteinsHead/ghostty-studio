# Release candidates

The **Release candidate** workflow builds reviewable evidence. It never creates or updates a GitHub
Release.

## What the workflow proves

- The requested source ref resolves to a clean commit.
- `package.json`, `Cargo.toml`, and `tauri.conf.json` contain the requested version.
- Locked frontend and Rust checks pass before packaging.
- Every third-party workflow action is pinned to an immutable commit; Dependabot proposes reviewed
  updates instead of following a movable tag at run time.
- The job runs on GitHub's standard `macos-15` ARM64 runner and fails unless `uname -m` is `arm64`.
- The existing packaging script produces an ARM64-only app with the reviewed identifier, version, and
  minimum macOS value. The signature is verified as ad-hoc, and the DMG is verified, mounted read-only,
  and checked for the signed app, license, notices, and Applications link.
- The shared macOS app builder remaps the build user's home path and rejects user paths or
  high-confidence credential patterns before an app can become a candidate.
- The uploaded Actions artifact contains the DMG, `SHA256SUMS.txt`, and a build manifest with the
  source SHA, toolchain versions, architecture, signature status, and checksum.

GitHub documents `macos-15` as an ARM64 standard runner for public repositories in its
[hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The workflow still checks the architecture at runtime so a future label change fails closed.

## What it does not prove

The candidate is ad-hoc signed. It is not Developer ID signed, notarized, stapled, reproducible, or
authorized for public release. The workflow has read-only repository permission and retains its
artifact for 14 days; it cannot upload release assets.

## Create and review a candidate

1. Update the version in all three manifests and push the commit or tag to review.
2. Run **Actions → Release candidate → Run workflow** with the exact ref and version.
3. Download the artifact and verify `SHA256SUMS.txt` with `shasum -a 256 -c SHA256SUMS.txt`.
4. Compare `BUILD-MANIFEST.txt` with the requested ref, inspect the app on an Apple Silicon Mac, and
   repeat the privacy checklist in [Launch kit](LAUNCH_KIT.md).
5. Publish separately only after the artifact, release notes, compatibility statement, and known
   limits have been reviewed.

A future public-release workflow needs a protected environment, Developer ID credentials,
notarization, stapling, publisher verification, and an explicit approval step. Those capabilities must
not be added to this candidate workflow.
