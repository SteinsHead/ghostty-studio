# Repository guide for coding agents

## Product contract

Ghostty Studio is a local-first visual editor for the Ghostty configuration the user already uses.
It preserves the document, stages changes for review, asks Ghostty to validate them, and writes only
after explicit confirmation. The project is independent from Ghostty.

Do not weaken these invariants:

- The React webview is an untrusted presentation layer. Never add general-purpose filesystem, shell,
  process, or network access to it.
- File paths and sensitive config values remain in Rust. The frontend works with opaque session,
  layer, and asset identifiers.
- Draft, review, and apply are separate states. A stale review token cannot write a newer draft.
- Preserve comments, ordering, unknown keys, line endings, BOM, blank lines, and trailing-newline
  style unless the reviewed change requires otherwise.
- New or changed Ghostty settings fail closed until their type, range, activation, and write semantics
  are audited against the installed version.
- The simulated terminal preview is helpful context, not proof of Ghostty's final rendering.

Read `docs/ARCHITECTURE.md`, `docs/PRODUCT_EXPERIENCE.md`, and `docs/THREAT_MODEL.md` before changing
IPC, persistence, configuration discovery, background assets, or the save journey.

## Repository map

- `src/App.tsx`: application journey and shared UI state.
- `src/components/`: focused React views and controls.
- `src/i18n.tsx` and `src/settingCopy.ts`: English and Simplified Chinese product copy.
- `src/backend.ts` and `src/types.ts`: typed frontend boundary.
- `src-tauri/src/lib.rs`: Tauri commands, orchestration, and command registration.
- `src-tauri/src/domain/`: config, Ghostty, asset, schema, extension, and safe-write services.
- `src-tauri/capabilities/` and `src-tauri/permissions/`: explicit Tauri IPC allowlist.
- `src-tauri/contracts/ghostty/`: versioned Ghostty behavior contracts.
- `docs/adr/`: architectural decisions.
- `site/`: static product website source; `dist-site/` is generated.

## Working rules

- Keep user-facing copy concise, natural, and paired in English and Simplified Chinese.
- Preserve keyboard access, visible focus, reduced-motion behavior, and WCAG 2.2 AA contrast.
- Prefer a small domain helper or component over adding another responsibility to an existing
  orchestration file.
- Keep IPC request and response types narrow. Register every new command in the handler, permission
  manifest, capability file, and contract tests.
- Use synthetic fixtures only. Never commit real configs, paths, logs, terminal content, credentials,
  image metadata, or local package artifacts.
- Do not edit unrelated user changes or generated dependency/build directories.
- Use `apply_patch` for hand-written file edits.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm check
```

Useful focused checks:

```bash
pnpm build
pnpm test
pnpm check:rust
pnpm site:build
```

Add regression coverage near the affected boundary. UI work should be checked at narrow and wide
window sizes, with keyboard navigation and reduced motion. Changes to saves, discovery, or assets
must include failure, stale-state, and external-change paths.

Do not claim a task is complete when required checks were skipped; state exactly what was and was not
verified.
