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
  ├─ Lossless document engine (parse/edit/render/diff)
  ├─ Safe writer (revision/lock/snapshot/fsync/rename)
  └─ Extension registry (declarative manifests only)
```

The frontend never receives a general-purpose file or shell API. A file is
opened by the backend and represented by an opaque session identifier. Every
mutation is checked against that backend-issued fixed target identity and revision. Only
positively allowlisted normal scalar values cross into the WebView; sensitive,
repeatable, high-risk and unknown config values remain backend-only. Config-graph
paths and deterministic ids are replaced with per-response opaque layer labels.

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
8. New Ghostty keys are read-only until their generic editor behavior is audited.
9. A renderer-issued Apply cannot bypass the native confirmation dialog.

## IPC shape

Initial commands:

- `probe_environment() -> EnvironmentReport`
- `open_config(candidate_id) -> ConfigSession`
- `load_runtime_schema() -> RuntimeSchema`
- `load_config_graph() -> ConfigGraph`
- `inspect_extension_manifest(json) -> ExtensionInspection`
- `stage_changes(session_id, revision, changes) -> ChangePreview`
- `apply_changes(session_id, revision, change_token) -> ApplyResult`
- `list_snapshots(session_id) -> Vec<SnapshotInfo>`
- `restore_snapshot(session_id, revision, snapshot_id) -> ApplyResult`

`stage_changes` produces a backend token bound to the exact candidate bytes. The token is not
time-based yet, but is limited to one per session, at most eight globally, and consumed once when
Apply begins. `apply_changes` does not trust diff text supplied by the UI. Stage, Apply and Restore
reload the installed Ghostty version/schema contract; Apply and Restore repeat this after the native
confirmation and revalidate the candidate before any write.

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

## Managed overlay (planned design)

The planned recommended write mode creates a dedicated file and one optional include:

```text
config-file = ?ghostty-studio.conf
```

Ghostty loads includes after their declaring file, but nested includes in 1.3.x
are processed through a queue. Appending this line to a root is therefore not
proof that the managed layer wins. The app first builds the complete load graph,
then offers a reviewed insertion at the final safe leaf and verifies the final
effective configuration. The app owns only the managed file; handwritten roots
and dotfiles remain intact. Repeatable settings require schema-aware reset/merge
behavior and are never guessed.
