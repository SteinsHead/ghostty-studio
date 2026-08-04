# Threat model

## Protected assets

- User-authored Ghostty config, includes, comments, and dotfiles history.
- Local paths, shell/environment values, clipboard policy, and commands stored
  in configuration.
- Integrity of the Ghostty executable invocation and application updates.
- The user's filesystem outside explicitly granted configuration targets.

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
| Compromised WebView exfiltrates config secrets | Only audited normal scalar values cross IPC; sensitive/repeatable/unknown values stay in Rust; known paths are redacted and raw Ghostty diagnostics are withheld |
| Compromised WebView silently applies a staged change | Backend-bound review token plus a Rust-triggered native system confirmation |
| Compromised WebView tricks snapshot restore | Integrity check and backend diff before confirmation; non-audited key changes are rejected; confirmation shows only trusted safe-key summary |
| Arbitrary command execution | Hardcoded Ghostty executable discovery and argument builders; no shell interpolation |
| Lost updates | Three revision checks, fully prepared temp before the final check, and immediate atomic persist; a tiny non-cooperating editor race remains documented |
| Partial/corrupt writes | Sibling temp file, flush/fsync, atomic rename, directory fsync |
| Parser data loss | Byte-preserving AST and round-trip fixtures; fuzz/property coverage remains a release gate |
| Symlink/hardlink surprises | Detect and refuse by default; explicit advanced flow only |
| Malicious include graph | Depth/node/byte limits, cycle detection, no writes outside granted roots |
| Incomplete graph presented as authoritative | Parse/permission/resource failures force `complete = false`; merge semantics remain explicitly unknown |
| Malicious theme | Theme installation/execution is disabled in the current slice; future import requires a separate review boundary |
| Executable plugin attack | No executable plugins in the default model |
| Extension spoofing | Strict manifest schema and namespace/capability rules; trust store and signatures remain a release gate |
| Update supply-chain attack | Updater is disabled; signed artifacts, TLS, pinned origin and rollback are required before enabling it |
| Secrets leaked to logs | Structured redaction; no config values in telemetry; telemetry off by default |
| Snapshot traversal or substitution | Canonical UUID, target/content hashes, bounded no-follow reads, private permissions and retention limit |
| Config graph path disclosure | Paths and deterministic path-derived ids are remapped to per-response opaque layer labels before IPC |
| Denial of service | File/output/time/depth/node/assignment limits and non-blocking special-file reads |

## Write transaction

1. Serialize the state transition, resolve the opaque session, and atomically consume the review token.
2. Reload and match the installed Ghostty version/schema contract; reject stale revisions/non-audited keys;
   for restore, verify the snapshot and compute a trusted backend diff.
3. Require a Rust-triggered native system confirmation containing only trusted key/revision/size metadata.
4. Reload the runtime contract again, revalidate the candidate, then re-read the bounded regular target
   with no-follow semantics and compare revision.
5. Acquire the private lock and repeat the revision check.
6. Render and validate the candidate with the installed Ghostty, then fully flush a sibling replacement temp.
7. Store and fsync a permission-restricted snapshot plus integrity metadata.
8. Repeat the revision check after all expensive I/O and immediately before commit.
9. Atomically persist the already-flushed sibling temp, fsync the parent, and verify the written hash.
10. Validate the complete default Ghostty graph; on failure perform revision-aware rollback without overwriting a newer edit.

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
- Logs contain option names and error classes, not raw values.
- Export/sharing is an explicit separate action with a secret-field review.
