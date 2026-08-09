# Compatibility

Ghostty Studio fails closed: when it cannot prove an edit is valid for the installed Ghostty and the
active configuration graph, the setting stays visible but read-only.

## Current support

| Area | Status | What that means |
|---|---|---|
| macOS 11 or later, Apple Silicon | Early-preview release | The published app is built for Apple Silicon. It is ad-hoc signed, not Apple-notarized. |
| Intel Mac | Not released | No supported Intel package or tested upgrade path yet. |
| Linux and Windows | Not released | The architecture is portable, but there is no supported desktop build or platform compatibility claim. |
| Ghostty 1.3.1 on macOS | Audited | Source ordering, schema fingerprints, final scalar verification, and the reviewed editor set are tested against this exact version. |
| Ghostty 1.3.x with matching per-setting fingerprints | Partial | Unchanged reviewed scalar controls may remain available. Changed settings become read-only. Source-sensitive writes still require the exact audited source-order contract. |
| Other Ghostty versions | Reference only unless the app says otherwise | The runtime catalog may still be searchable, but editing is not assumed safe. |
| Browser demo | Read-only | It uses sample data and never reads or writes a local Ghostty configuration. |

The audited Ghostty 1.3.1 catalog currently exposes 30 ordinary scalar controls plus the dedicated
background-image editor. Unknown, sensitive, repeatable, or behaviorally complex settings remain
searchable reference entries until they have a purpose-built editor and write contract.

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

## Report a compatibility gap

Open a [GitHub issue](https://github.com/SteinsHead/ghostty-studio/issues) with:

- Ghostty Studio version, Ghostty version, macOS version, and Mac architecture;
- the setting name and the status or error code shown by the app;
- a minimal reproduction using placeholder values.

Never post a real config, full home path, username, hostname, token, command, environment value, or
unredacted screenshot. Compatibility evidence should describe structure, not disclose content.
