<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="Ghostty Studio icon" />
  <h1>Ghostty Studio</h1>
  <p><strong>A visual Ghostty configurator that respects your config file.</strong></p>
  <p><a href="README.zh-CN.md">简体中文</a></p>

  [![CI](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/SteinsHead/ghostty-studio/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-a8ff60.svg)](LICENSE)
</div>

Ghostty is wonderfully configurable. Hunting through hundreds of options and hand-editing a file
for every small visual change is less wonderful. I built Ghostty Studio so you can open your usual
config, adjust a setting, see what changed, and save with confidence—without rewriting the rest of
the file.

## What it does

- Opens your last-used config straight into the editor when there is nothing to decide.
- Reads the settings catalog from the Ghostty version installed on your machine.
- Finds macOS and XDG config candidates, and asks you to choose only when more than one can be used.
- Creates a new config safely, after confirmation, when no default config exists.
- Lets you search and edit supported settings, with a contextual preview for visual changes.
- Follows your system language by default, with instant Simplified Chinese and English switching.
- Keeps the main journey focused on settings you can change, while the full Ghostty catalog remains
  available as a clear, searchable reference.
- Keeps every edit in a draft until you review the exact diff and choose to save.
- Preserves comments, ordering, unknown keys, blank lines, BOM, CRLF, and trailing-newline style.
- Validates with Ghostty and creates a local snapshot before every save.

Everything stays on your machine. There is no account, cloud service, telemetry, or general-purpose
shell and file access in the webview.

## Download

[Download Ghostty Studio v0.3.0](https://github.com/SteinsHead/ghostty-studio/releases/tag/v0.3.0)
for Apple Silicon Macs running macOS 11 or later.

This is an early preview. The app is ad-hoc signed but not Apple-notarized, so macOS may ask you to
confirm the first launch. The release page includes a SHA-256 checksum; you can also build directly
from source if you prefer.

## Project status

Ghostty Studio is an early preview. The source is ready to explore, but a few limits are intentional:

- The desktop app currently targets macOS and the writable contract is tested against Ghostty 1.3.1.
- Ghostty 1.3.1 on macOS currently has 29 reviewed settings you can change. The rest remain
  searchable and explain why they need a different editing experience.
- The terminal preview is a safe DOM simulation, and the source graph does not yet calculate every
  final effective value across includes, resets, and repeatable settings.
- The extension manifest format and validator are developer-facing contracts for now. There is no
  extension browser, installer, or execution surface in the app.
- The preview download is ad-hoc signed, not Developer ID signed or notarized.
- The interface is available in Simplified Chinese and English.

## Run locally

You will need macOS 11 or later, Ghostty, Xcode Command Line Tools, Node 22.11, pnpm 10, and Rust.
The repository pins the expected Node and Rust versions.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

To open the read-only browser preview instead:

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

If no default config exists, the app can create one fixed empty target. The backend re-discovers the
target before and after confirmation and uses no-follow directory descriptors plus exclusive `0600`
creation on Unix. If final validation becomes uncertain, it preserves the file and re-reads reality;
it never risks deleting a concurrently replaced user file as an automatic cleanup step.

The deeper design and security details live in the documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [Product experience and platform boundaries](docs/PRODUCT_EXPERIENCE.md)
- [Product design principles](docs/product-design.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Extension design](docs/EXTENSIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Contributing

Bug reports, focused pull requests, and feedback about real Ghostty workflows are welcome. Please
use redacted sample configs—never attach tokens, private paths, commands, or environment values.

## License

[MIT](LICENSE)

Ghostty Studio is an independent community project and is not affiliated with or endorsed by
Ghostty.
