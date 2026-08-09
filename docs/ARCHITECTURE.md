# Architecture

## Component boundaries

```text
React UI (untrusted presentation layer)
        │ typed IPC, opaque session ids
        ▼
Tauri command boundary
        │ allowlisted commands only
        ▼
Rust application services
  ├─ Ghostty adapter (version/schema/themes/fonts/validation)
  ├─ Config graph (discovery/includes/provenance)
  ├─ Effective config resolver (versioned source order/final-value oracle)
  ├─ Lossless document engine (parse/edit/render/diff)
  ├─ Background asset service (decode/normalize/thumbnail/library)
  ├─ Safe writer (revision/lock/snapshot/fsync/rename)
  └─ Extension registry (declarative manifests only)
```

The frontend never receives a general-purpose file or shell API. A file is
opened by the backend and represented by an opaque session identifier. Every
mutation is checked against that backend-issued fixed target identity and revision. `PublicGhosttyInfo`
omits the executable path and raw version output. `PublicConfigCandidate` omits the real target path;
Rust calculates whether a missing candidate is eligible for creation. Configuration-graph paths and
deterministic ids are replaced with per-response opaque layer labels.

Only positively allowlisted normal scalar values that pass the audited boolean, number, select, or
six-digit color contract cross into the WebView. Malformed, sensitive, repeatable, high-risk, unknown,
and path-bearing values remain backend-only; a preserved hidden value is presented as a reference
entry rather than as an editable default.
Background images cross IPC only as content ids, bounded metadata, and generated thumbnail data;
original and managed filesystem paths stay in Rust. Asset summaries include only an availability
state and opaque labels for configuration layers that still reference the asset.

## Core invariants

1. `render(parse(bytes)) == bytes` for every accepted UTF-8 fixture.
2. Editing key `x` cannot alter an unrelated line.
3. Stale revisions are rejected at three points and the expensive I/O window is closed; a tiny
   final check-to-rename race with non-cooperating editors remains until managed overlay/file coordination.
4. Pre-commit validation failure cannot change the target; post-commit full-graph failure triggers
   revision-aware rollback and reports any uncertainty.
5. A successful write always has a restorable pre-write snapshot.
6. Unknown settings and invalid-but-preservable lines survive every operation.
7. The UI cannot choose an arbitrary executable or shell command.
8. Writing is enabled only for the exact audited Ghostty runtime contract; every mismatch is
   read-only from schema load.
9. A renderer-issued Apply cannot bypass the native confirmation dialog.
10. Creating a missing config accepts only a backend-issued default candidate, never overwrites, and
    never automatically deletes a path after creation because portable POSIX APIs cannot atomically
    compare an inode and unlink its directory entry.
11. A save is never reported as exact until Ghostty's final scalar value matches the reviewed value;
    layer removals are reported separately as inherited/resolved.
12. An image cannot be removed unless a fresh, complete configuration graph proves it is unused;
    failed, cancelled, or concurrent removal attempts do not invalidate an existing review.
13. Stage and Restore bind the canonical Ghostty executable path, device/inode, size, modification
    time, and SHA-256. Every Ghostty invocation verifies that identity before and after execution;
    a change after writing triggers revision-aware rollback.

## Runtime contract

The only writable runtime contract is `ghostty-1.3.1-stable-macos-v1`:

- Ghostty version `1.3.1`;
- release channel `stable`;
- platform `macos`;
- exact SHA-256
  `5e36480fe2ec3d510ffc32de84c617fbaca10e1330c097185301b51ab9c10e6c` of
  `ghostty +show-config --default --docs` output.

An exact match exposes 30 audited scalar controls and the dedicated `background-image` editor. Any
version, channel, platform, or schema-hash mismatch keeps any loaded catalog visible but removes every write
surface during schema construction. There is no per-setting fallback authorization.

All runtime-schema replacement goes through one installation path. Runtime-schema refresh, Stage,
Apply, and Restore share the backend mutation gate, so a refresh cannot replace the contract while a
review or write is in progress. The offline fixture and its expected contract live in
[`src-tauri/tests/fixtures/ghostty/1.3.1-macos`](../src-tauri/tests/fixtures/ghostty/1.3.1-macos/).
The fixture is the captured upstream byte stream: trailing spaces are significant input to the schema
hash and must not be normalized.

## IPC shape

Initial commands:

- `probe_environment() -> EnvironmentReport`
- `open_config(candidate_id) -> ConfigSession`
- `create_config(candidate_id) -> ConfigSession`
- `load_runtime_schema() -> RuntimeSchema`
- `load_config_graph() -> ConfigGraph`
- `list_background_assets() -> Vec<BackgroundAssetSummary>`
- `choose_background_images() -> BackgroundAssetImportResult`
- `get_background_asset_preview(asset_id) -> BackgroundAssetPreview`
- `delete_background_asset(asset_id, locale)`
- `stage_changes(session_id, revision, changes) -> ChangePreview`
- `apply_changes(session_id, revision, change_token) -> ApplyResult`
- `list_snapshots(session_id) -> Vec<SnapshotInfo>`
- `restore_snapshot(session_id, revision, snapshot_id) -> ApplyResult`

The declarative extension validator remains an internal developer contract. It has no renderer IPC,
installation flow, or user-facing entry point.

`stage_changes` produces a backend token bound to the exact candidate bytes, the verified Ghostty
executable identity, and a frozen copy of the audited setting contract for every reviewed key. The
token is not time-based yet, but is limited to one per session, at most eight globally, and consumed
once when Apply begins. Duplicate keys are rejected. `apply_changes` does not trust diff text supplied
by the UI: Rust projects only contract-valid values into a bounded before/after summary used by both
the WebView review and native confirmation. Stage, Apply and Restore reload the installed Ghostty
runtime contract; Apply and Restore repeat this after native confirmation and reject a changed
reviewed contract or executable identity before any write.

For the audited Ghostty 1.3.1 stable macOS contract, Stage separately records current provenance, the
prospective effect of writing to the selected file, and a fingerprint of every other root/include dependency.
Apply checks that fingerprint around native confirmation, shows the trusted target path, validates
the complete default configuration after the atomic write, compares every written scalar through
Ghostty's own `+show-config`, then checks dependencies once more. Any mismatch uses the existing
revision-aware rollback path.

`create_config` is a separate transaction, not a special case of opening or saving. It accepts only
an issued missing candidate, rejects any existing default layer, validates fixed empty content, asks
for native confirmation, and then repeats discovery and contract checks. Unix creation walks from a
trusted home dirfd with no-follow semantics, creates missing directories as `0700`, and opens the
final file with `O_EXCL` as `0600`. Post-creation discovery must find exactly one matching default
layer. Any uncertainty refreshes backend state and preserves all files for explicit recovery.

## UI state

The UI maintains a draft separate from persisted state:

```text
loaded ──edit──> dirty ──stage──> reviewed ──apply──> applying ──> loaded
  ▲                 │                 │                 └───────> failed
  └──── discard ────┴──── invalidate on external revision ─────────┘
```

There is no autosave to a real Ghostty file. Preview changes may be immediate,
but filesystem changes remain explicit.

## Preview strategy

The default preview is a deterministic DOM renderer driven by the same draft.
It covers palette, font, cursor, opacity, padding, selection, and representative
ANSI content. An optional libghostty/WASM preview can be added behind an adapter
without giving WASM access to the filesystem or IPC.

Background images use a separate fixed-size layer and reproduce Ghostty's fit, nine-position,
repeat, and relative-opacity semantics. The UI requests thumbnails in bounded pages. A local import
is decoded with memory and pixel limits, EXIF-oriented, normalized to PNG or JPEG, stripped of
metadata, and stored under a content-addressed private path so Ghostty notices content changes on
reload. The library and the Ghostty draft remain separate state domains. Imported images are selected
as drafts explicitly; external paths are not read into the WebView. Quoted, relative, canonical, and
symlinked configuration values are resolved in Rust against their declaring configuration file before
usage is compared. Preview requests use explicit idle/loading/ready/error states, and request versions
prevent late responses from restoring a removed asset.

## Managed overlay (planned design)

The planned recommended write mode creates a dedicated file and one optional include:

```text
config-file = ?ghostty-studio.conf
```

Ghostty loads includes after the default roots, but nested includes in 1.3.1
are processed through a queue. Appending this line to a root is therefore not
proof that the managed layer wins. The app first builds the complete load graph,
then offers a reviewed insertion at the final safe leaf and verifies the final
effective configuration. The app owns only the managed file; handwritten roots
and dotfiles remain intact. Repeatable settings require schema-aware reset/merge
behavior and are never guessed.

## Delivery evidence

CI runs frontend checks and Rust formatting, lint, and tests on Ubuntu; pull requests also run
dependency review. A `macos-15` ARM64 job builds the native app and checks the bundle binary's
architecture. Test totals are reported by CI rather than copied into documentation.

The manual release-candidate workflow reruns the release checks on `macos-15`, verifies the ARM64 app
and DMG, and uploads the package, checksums, and build manifest as a short-lived Actions artifact. It
does not create or update a GitHub Release. See [Release process](RELEASING.md).
