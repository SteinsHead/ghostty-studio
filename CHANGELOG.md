# Changelog

Ghostty Studio follows semantic versioning while the project is in preview.

## 0.3.0 — 2026-08-05

### Added

- Add a system-aware Simplified Chinese and English interface without discarding the current draft.
- Add concise bilingual names and descriptions for the complete Ghostty 1.3.1 settings catalog.
- Add a strict, data-only capability contract for 29 reviewed macOS settings, including control
  type, valid range, write behavior, and activation requirements.

### Changed

- Refine spacing, typography, responsive behavior, keyboard focus, and long-content handling across
  the editor and supporting panels.
- Align setting controls to their titles, unify field and button geometry, and replace raw color,
  range, switch, and language controls with a coherent desktop control system.
- Separate the focused editing journey from the complete searchable settings reference.
- Explain protected, repeated, platform-specific, and not-yet-editable settings without presenting
  controls that cannot be used.
- Keep category identifiers independent from display language so saved navigation survives language
  changes and future copy updates.

### Safety

- Keep compatibility decisions scoped to each setting, so unrelated Ghostty updates do not lock the
  editor or invalidate an unaffected review.
- Apply the same type, range, and duplicate checks to snapshot restores as normal edits.
- Expose only recognized configuration names to the WebView; unknown names and values stay private.

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
