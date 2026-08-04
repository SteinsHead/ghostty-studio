<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="Ghostty Studio icon" />
  <h1>Ghostty Studio</h1>
  <p><strong>A visual Ghostty configurator that respects your config file.</strong></p>
  <p><a href="README.zh-CN.md">简体中文</a></p>

  [![CI](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-a8ff60.svg)](LICENSE)
</div>

Ghostty is wonderfully configurable. Hunting through hundreds of options, editing a file, and
restarting the terminal for every small visual tweak is less wonderful. I built Ghostty Studio to
make settings easier to discover, preview, and change—without rewriting the rest of your config.

## What it does

- Reads the settings catalog from the Ghostty version installed on your machine.
- Finds macOS and XDG config files and shows where settings come from.
- Lets you search, browse, and preview supported visual settings.
- Shows the exact diff before saving.
- Preserves comments, ordering, unknown keys, blank lines, BOM, CRLF, and trailing-newline style.
- Validates with Ghostty and creates a local snapshot before every save.

Everything stays on your machine. There is no account, cloud service, telemetry, or general-purpose
shell and file access in the webview.

## Download

[Download Ghostty Studio v0.1.0](https://github.com/SteinsHead/ghostty-studio/releases/tag/v0.1.0)
for Apple Silicon Macs running macOS 11 or later.

This is an early preview. The app is ad-hoc signed but not Apple-notarized, so macOS may ask you to
confirm the first launch. The release page includes a SHA-256 checksum; you can also build directly
from source if you prefer.

## Project status

Ghostty Studio is an early preview. The source is ready to explore, but a few limits are intentional:

- The desktop app currently targets macOS and the writable contract is tested against Ghostty 1.3.1.
- A small, reviewed set of visual settings is editable; the rest of the catalog remains discoverable
  and read-only until it has a purpose-built editor.
- The preview download is ad-hoc signed, not Developer ID signed or notarized.
- The interface is currently available in Simplified Chinese; an English interface is planned.

## Run locally

You will need macOS 11 or later, Ghostty, Xcode Command Line Tools, Node 22.11, pnpm 10, and Rust.
The repository pins the expected Node and Rust versions.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

To open the read-only browser demo instead:

```bash
pnpm dev
```

Run the full frontend and Rust checks:

```bash
pnpm check
```

Build an ad-hoc signed app and a local DMG:

```bash
pnpm package:macos-local
```

The local package is for development and personal installation; it is not notarized and does not
establish publisher identity.

## How saving works

Ghostty Studio edits the existing document instead of regenerating it. A save only touches the
settings you reviewed. Before replacing the file, the app checks for outside changes, asks Ghostty
to validate the candidate, and stores a restorable snapshot.

The deeper design and security details live in the documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Extension design](docs/EXTENSIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## Contributing

Bug reports, focused pull requests, and feedback about real Ghostty workflows are welcome. Please
use redacted sample configs—never attach tokens, private paths, commands, or environment values.

## License

[MIT](LICENSE)

Ghostty Studio is an independent community project and is not affiliated with or endorsed by
Ghostty.
