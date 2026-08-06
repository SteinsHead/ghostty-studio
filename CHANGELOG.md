# Changelog

Ghostty Studio follows semantic versioning while the project is in preview.

## Unreleased

## 0.4.0 — 2026-08-06

### Added

- Add a private local PNG/JPEG background library with multi-select import, content deduplication,
  manual or random switching, removal, and live preview.
- Add dedicated controls for image visibility, fit, nine-point position, and tiling.
- Add effective-source detection for Ghostty 1.3.1 roots and its mutable global include queue,
  including the reset cursor edge case and writable include destinations. Other versions fail closed
  until their source-order behavior is audited.
- Add separate current-source, prospective-write, and final-value states; overridden drafts can move
  to the winning source without being saved.
- Show when a library image is still used by another Ghostty configuration layer and provide a
  direct path to the relevant write-location details before removal is attempted.

### Changed

- Select the first successfully imported image as the active draft immediately, so both the canvas
  and terminal preview update even when the previous value came from an external path.
- Keep image cards and feedback stable while removal is pending or refused, with one removal request
  per asset at a time.
- Replace the original ghost-and-prompt mark with an independent open-shroud ghost symbol that stays
  clear at desktop, sidebar, installer, and favicon sizes.
- Tighten bilingual interface copy around the current state and next action, and move Ghostty's
  longer source descriptions behind an optional detail disclosure.

### Safety

- Normalize imported images with decode, size, pixel, EXIF orientation, and memory checks; strip
  metadata and keep original and managed paths out of WebView IPC, reviews, and diffs.
- Load bounded thumbnails in pages, rebuild missing previews on demand, repair managed artifacts on
  reimport, and fail closed if a future Ghostty release changes any background-image contract.
- Validate the complete default configuration and compare every written scalar against Ghostty's
  final `+show-config` output; rollback on mismatch or source changes.
- Treat “turn off background image” as Ghostty's explicit empty-value reset, rather than removing a
  layer and accidentally revealing an older image.
- Rebuild the live include graph before and after deleting a managed image, refusing deletion when
  usage cannot be proven absent.
- Resolve quoted, relative, canonical, and symlinked image paths against the configuration file that
  declared them, so every preview and removal check uses the same image identity.
- Leave staged reviews and managed assets untouched when removal is cancelled, rejected, or races
  with a configuration change.

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
