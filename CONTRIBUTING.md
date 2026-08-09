# Contributing to Ghostty Studio

Thanks for helping make local Ghostty configuration safer and easier to use. Focused bug fixes,
tests, accessibility improvements, and feedback from real Ghostty workflows are welcome.

## Before you start

- Search existing issues before opening a new one.
- Use the matching issue form for bugs, feature ideas, or Ghostty compatibility findings.
- Discuss a substantial product, storage, IPC, or security change in an issue before implementing it.
- Report vulnerabilities through
  [GitHub private vulnerability reporting](https://github.com/SteinsHead/ghostty-studio/security/advisories/new),
  not a public issue.

## Protect local data

Ghostty configurations can contain commands, environment values, private paths, hostnames, and
tokens. Reports, fixtures, screenshots, recordings, and commits must use synthetic data.

Before sharing anything, remove:

- usernames, home-directory paths, hostnames, repository names, and shell history;
- tokens, credentials, API URLs with secrets, environment values, and private commands;
- real configuration files, unredacted logs, and image metadata;
- screenshots or recordings that expose terminal content or the filesystem.

When a configuration fragment is necessary, reduce it to the smallest example that still reproduces
the behavior. Do not attach a complete config.

## Set up the project

You need macOS 11 or later, Ghostty, Xcode Command Line Tools, Node 22.12.0, pnpm 10, and the pinned
Rust toolchain.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

The browser-only preview is available with `pnpm dev`. It does not read or write a real Ghostty
configuration.

## Make a change

- Keep pull requests small enough to review as one coherent change.
- Preserve the existing local-first trust boundary: the webview receives no general-purpose file,
  shell, or network capability.
- Treat the Rust backend and installed Ghostty as authoritative for discovery, validation, and writes.
- Keep all edits in a reviewable draft until the user explicitly applies them.
- Add or update English and Simplified Chinese copy together. Keep product text brief and natural.
- Add a regression test for a bug when practical. Use only synthetic fixtures.
- Update architecture, threat-model, or product documentation when a contract changes.
- Do not commit build output, local packages, `node_modules`, or Rust `target` directories.

The core boundaries and invariants are documented in
[Architecture](docs/ARCHITECTURE.md), [Product experience](docs/PRODUCT_EXPERIENCE.md), and the
[Threat model](docs/THREAT_MODEL.md).

## Verify the change

Run the full check before requesting review:

```bash
pnpm check
```

For a focused iteration, use `pnpm test`, `pnpm build`, or `pnpm check:rust`. UI changes should also
be checked at narrow and wide window sizes, with keyboard navigation and reduced motion enabled.

## Open a pull request

Describe the user problem and the resulting behavior, not only the implementation. Include the
commands you ran, relevant compatibility assumptions, and any risk to configuration fidelity,
privacy, accessibility, or upgrades. Use sanitized media only.

By contributing, you agree that your contribution is licensed under the repository's MIT license.
