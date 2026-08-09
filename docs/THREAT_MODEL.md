# Threat model

## Protected assets

- User-authored Ghostty config, includes, comments, and dotfiles history.
- Local paths, shell/environment values, clipboard policy, and commands stored
  in configuration.
- Integrity of the Ghostty executable invocation and application updates.
- The user's filesystem outside explicitly granted configuration targets.
- Original images and Studio-managed background copies.

## Trust boundaries

- React/WebView is treated as potentially compromised.
- Rust code is trusted but validates every IPC input.
- Ghostty CLI output is untrusted input with size/time limits.
- Config and theme files are untrusted text.
- Extension packs are untrusted declarative data.
- Update metadata and binaries are untrusted until signature verification.

## Principal threats and controls

| Threat | Control |
|---|---|
| WebView path traversal or arbitrary write | Opaque session ids, canonical-path allowlist, no generic fs plugin |
| WebView creates or replaces an arbitrary config | Creation accepts only a freshly rediscovered backend-issued missing default candidate; dirfd/no-follow traversal and `O_EXCL` prevent overwrite |
| Compromised WebView exfiltrates config secrets | Only audited normal scalar values that pass their exact boolean/number/select/color contract cross IPC; malformed, sensitive, repeatable, unknown, and path-bearing values stay in Rust; known paths are redacted and raw Ghostty diagnostics are withheld |
| Environment discovery leaks local identity | Public Ghostty data omits executable path and raw version output; public candidates omit real paths; Rust calculates creation eligibility and the graph exposes only per-response layer labels |
| Renderer forges creation eligibility | Eligibility is display data calculated by Rust; creation resolves a backend-issued candidate id and repeats discovery and path checks |
| Compromised WebView silently applies a staged change | Backend-bound review token plus a Rust-triggered native system confirmation showing a bounded backend-generated before/after summary |
| Compromised WebView tricks snapshot restore | Integrity check and backend diff before confirmation; non-audited key changes are rejected; confirmation shows only trusted safe-key summary |
| Arbitrary command execution | Hardcoded Ghostty executable discovery and argument builders; no shell interpolation |
| Ghostty executable changes during review | Canonical executable identity binds device/inode/size/mtime and SHA-256 to Stage/Restore; every invocation verifies it before and after, and a post-write change triggers revision-aware rollback |
| Lost updates | Three revision checks, fully prepared temp before the final check, and immediate atomic persist; a tiny non-cooperating editor race remains documented |
| Partial/corrupt writes | Sibling temp file, flush/fsync, atomic rename, directory fsync |
| Parser data loss | Byte-preserving AST and round-trip fixtures; fuzz/property coverage remains a release gate |
| Upstream schema drift is normalized away | The real offline Ghostty 1.3.1 fixture is hashed byte-for-byte against an expected contract; upstream trailing spaces remain significant |
| Schema refresh changes a review in flight | Runtime-schema refresh, Stage, Apply and Restore share one mutation gate; Stage freezes the reviewed setting contracts and Apply reloads and compares them |
| Symlink/hardlink surprises | Detect and refuse by default; explicit advanced flow only |
| Malicious include graph | Depth/node/byte limits, cycle detection, no writes outside granted roots |
| Stale or shadowed save target | Version-gated root/include/reset ordering, dependency fingerprints around confirmation, blocked writes when the winner is unknown |
| Theme or merge behavior differs from the source graph | Post-write Ghostty `+show-config` comparison for every written scalar; revision-aware rollback on mismatch |
| Incomplete graph presented as authoritative | Parse/permission/resource failures force `complete = false`; merge semantics remain explicitly unknown |
| Malicious theme | Theme installation/execution is disabled in the current slice; future import requires a separate review boundary |
| Executable plugin attack | No executable plugins; the declarative validator has no renderer IPC or installation entry point |
| Extension spoofing | Strict internal manifest schema and namespace/capability rules; trust store and signatures remain a release gate before any future installation flow |
| Update supply-chain attack | Updater is disabled; CI checks frontend/Rust, dependency changes, and an ARM64 app build; signed artifacts, TLS, pinned origin and rollback are required before enabling updates |
| Candidate artifact is mistaken for a release | The manual candidate workflow uploads evidence only to Actions and states that the app is ad-hoc signed, not notarized; it cannot publish a GitHub Release |
| Secrets leaked to logs | Structured redaction; no config values in telemetry; telemetry off by default |
| Snapshot traversal or substitution | Canonical UUID, target/content hashes, bounded no-follow reads, private permissions and retention limit |
| Config graph path disclosure | Paths and deterministic path-derived ids are remapped to per-response opaque layer labels before IPC |
| Malicious or oversized local image | Native picker only; regular no-follow read, byte/pixel/decode limits, PNG/JPEG magic and full decode, metadata-stripping re-encode, content-addressed private storage |
| Image path disclosure or arbitrary WebView file read | The picker and path resolution stay in Rust; IPC exposes only content ids, bounded metadata and generated thumbnails |
| Image-library memory exhaustion | 64-item/512 MiB library cap, 480 px/2 MiB thumbnails, paged sequential requests, failed-request suppression |
| Managed image deleted after a new include references it | Rebuild and revision-check the complete live include graph both before and after native deletion confirmation; uncertainty blocks deletion |
| Denial of service | File/output/time/depth/node/assignment limits and non-blocking special-file reads |

## Write transaction

1. Serialize the state transition, resolve the opaque session, and atomically consume the review token.
2. Reload and exactly match Ghostty 1.3.1, stable channel, macOS, and the audited schema hash; reject
   every other runtime, stale revision, or non-audited key. For restore, verify the snapshot and
   compute a trusted backend diff.
3. Require a Rust-triggered native system confirmation containing the actual write target and a
   bounded, backend-generated safe before/after summary. Restore confirmations include the snapshot
   time, short id, and changed keys.
4. Reload the runtime contract again, revalidate the candidate, then re-read the bounded regular target
   with no-follow semantics and compare revision.
5. Acquire the private lock and repeat the revision check.
6. Render and validate the candidate with the installed Ghostty, then fully flush a sibling replacement temp.
7. Store and fsync a permission-restricted snapshot plus integrity metadata.
8. Repeat the revision check after all expensive I/O and immediately before commit.
9. Atomically persist the already-flushed sibling temp, fsync the parent, and verify the written hash.
10. Recheck the canonical Ghostty executable identity, validate the complete default Ghostty graph,
    compare final scalar values through Ghostty's own configuration oracle, and recheck dependency
    revisions before reporting success. If the executable changed after commit, use the same
    revision-aware rollback path.

Schema installation has one backend path. Stage stores the full audited option contract for each
reviewed key; Apply compares it before and after native confirmation. A runtime refresh cannot race
these transitions because they use the same mutation gate.

## Delivery boundary

- Ubuntu CI runs frontend checks and Rust format, lint, and tests.
- Pull requests run dependency review.
- `macos-15` builds an ARM64 app and verifies the native binary architecture.
- The manual release-candidate workflow produces only an Actions artifact with checksums and build
  evidence. It does not publish a release, sign with Developer ID, or notarize the app.

CI is the source of truth for test totals; this document does not pin a count.

## Missing-config creation transaction

1. Serialize mutation, resolve the opaque missing candidate, and require that no default layer exists.
2. Constrain the target to a losslessly representable path inside the user home; validate fixed empty
   content and the current default graph before showing native confirmation.
3. After confirmation, repeat candidate discovery, runtime-contract checks, empty validation, and path
   preflight.
4. On Unix, walk from the approved root using directory descriptors and no-follow flags, create only
   missing `0700` directories, and create the final `0600` file with exclusive no-follow open.
5. Compare device/inode identity, validate the complete default graph, and require fresh discovery to
   contain exactly one existing layer matching the issued candidate.
6. On every post-create failure, preserve all directory entries, refresh candidate/session state, and
   report uncertainty. There is deliberately no check-then-unlink cleanup because it cannot be made
   inode-atomic with portable POSIX APIs.

## Privacy defaults

- No analytics or crash upload by default.
- No network permission in the main editing window.
- Local image import never changes the original file; deleting an item removes only Studio's managed copy after native confirmation.
- Logs contain option names and error classes, not raw values.
- Export/sharing is an explicit separate action with a secret-field review.
