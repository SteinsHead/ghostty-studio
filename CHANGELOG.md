# Changelog

Ghostty Studio follows semantic versioning while the project is in preview.

## 0.2.0 — 2026-08-04

### Changed

- Open directly into the last valid configuration and settings context.
- Replace the dashboard-style home screen with a focused settings editor.
- Show the terminal preview only beside settings it can meaningfully simulate.
- Present opacity as a percentage and keep the preview stable across boundary values.
- Use a human-readable review sheet before exposing the raw configuration diff.
- Strengthen snapshot restore with revision-aware conflict handling and safer state refresh.
- Keep the existing declarative extension validator developer-only; there is no extension install
  or execution surface in the app.

### Added

- A draft dock with review, reset, and one-step undo after discarding changes.
- Explicit first-run, multiple-source, missing-config, and interrupted-session journeys.
- Safe creation of a missing default config after Ghostty validation and native confirmation.
- Runtime compatibility summaries for Ghostty schema changes.

### Safety

- Refreshing never changes the active write target implicitly.
- Drafts are not replayed into a different configuration source.
- Stale review responses and changed drafts invalidate the save token.
- Configuration writes preserve unknown content, validate with Ghostty, create a private snapshot,
  and use revision checks plus atomic replacement.
- The WebView keeps a narrow CSP and has no general filesystem, network, or shell capability.

## 0.1.0 — 2026-08-04

- Initial macOS preview.
