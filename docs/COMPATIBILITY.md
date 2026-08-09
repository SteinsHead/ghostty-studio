# Compatibility

Ghostty Studio fails closed: when it cannot prove an edit is valid for the installed Ghostty and the
active configuration graph, the setting stays visible but read-only.

## Current support

| Area | Status | What that means |
|---|---|---|
| macOS 11 or later, Apple Silicon | Early-preview release | The published app is built for Apple Silicon. It is ad-hoc signed, not Apple-notarized. |
| Intel Mac | Not released | No supported Intel package or tested upgrade path yet. |
| Linux and Windows | Not released | The architecture is portable, but there is no supported desktop build or platform compatibility claim. |
| Ghostty 1.3.1, stable channel, macOS, exact schema hash | Audited | The exact runtime contract enables the reviewed editor set and write pipeline. |
| Any other version, channel, platform, or schema hash | Read-only | The runtime catalog may remain searchable, but every write surface is disabled from schema load. There is no per-setting fallback authorization. |
| Browser demo | Read-only | It uses sample data and never reads or writes a local Ghostty configuration. |

The audited contract is `ghostty-1.3.1-stable-macos-v1`. Its schema hash is
`5e36480fe2ec3d510ffc32de84c617fbaca10e1330c097185301b51ab9c10e6c`, calculated from the complete
raw `ghostty +show-config --default --docs` output. It exposes 30 ordinary scalar controls plus the
dedicated `background-image` editor. Unknown, sensitive, repeatable, or behaviorally complex settings
remain searchable reference entries.

Runtime-schema refresh, Stage, Apply, and Restore are serialized. Stage freezes the audited option
contract for the reviewed keys; Apply reloads and compares it before and after native confirmation.
An upgrade cannot silently reuse an earlier review.

## Offline compatibility evidence

The repository includes a real offline Ghostty 1.3.1 macOS output fixture and an expected contract in
[`src-tauri/tests/fixtures/ghostty/1.3.1-macos`](../src-tauri/tests/fixtures/ghostty/1.3.1-macos/).
The fixture is compared byte-for-byte. Upstream trailing spaces are part of the schema hash; editors,
formatters, and cleanup scripts must not remove them.

CI is the source of truth for current test totals. The compatibility contract is accepted only when
the schema hash, option count, writable-key/editor set, and contract id all match.

## Configuration layouts

Ghostty Studio discovers the standard macOS and XDG roots and follows supported `config-file`
includes. It preserves comments, ordering, unknown keys, BOM, CRLF, blank lines, and trailing-newline
style.

Editing may be limited when:

- an include is outside the granted configuration roots;
- a source cannot be read, parsed, or represented safely;
- the graph contains an unresolved cycle, duplicate source, or reset behavior;
- the selected file is not the source that determines the final value;
- a symlink, hard link, permission boundary, or external edit makes the target identity uncertain.

In those cases the app keeps the real files untouched and asks the user to reload, choose a known
source, or continue in read-only mode.

## Background images

- Local import accepts PNG and JPEG. Images are decoded with size limits, oriented, stripped of
  metadata, and copied into a private, content-addressed library.
- Fit, position, repeat, and relative image opacity are available for the selected draft image.
- Existing external image paths remain usable by Ghostty, but their path and bytes are not exposed to
  the WebView. Studio therefore does not preview them.
- Remote URLs, image APIs, authenticated downloads, GIF, WebP, SVG, and video backgrounds are not
  supported.
- An image cannot be deleted while a fresh configuration graph still references it. The app also
  warns when restore points reference the image.

The terminal preview is a deterministic simulation, not Ghostty's renderer. The saved candidate is
validated by the installed Ghostty binary; the app also reports whether a change needs a reload, a
new terminal, or a full Ghostty restart.

## Release trust

Preview releases publish a checksum, but the current app does not yet establish an Apple Developer ID
publisher identity and is not notarized. Download only from the project's
[GitHub Releases](https://github.com/SteinsHead/ghostty-studio/releases), verify the checksum, and do
not use repackaged downloads.

CI runs frontend and Rust checks on Ubuntu, dependency review on pull requests, and an ARM64 app build
smoke test on `macos-15`. Workflow actions are pinned to immutable commits. Both the smoke build and
the manual [Release candidate workflow](RELEASING.md) use the same path-remapped, credential-scanned
app builder. The candidate workflow produces an ARM64 Actions artifact and build evidence for review;
it does not publish a release or change the ad-hoc signing and notarization status.

## Report a compatibility gap

Open a [GitHub issue](https://github.com/SteinsHead/ghostty-studio/issues) with:

- Ghostty Studio version, Ghostty version, macOS version, and Mac architecture;
- the setting name and the status or error code shown by the app;
- a minimal reproduction using placeholder values.

Never post a real config, full home path, username, hostname, token, command, environment value, or
unredacted screenshot. Compatibility evidence should describe structure, not disclose content.
