# Roadmap · 路线图

Ghostty Studio will deepen the most common configuration journeys before widening the setting count.
每个阶段都以“能理解、能验证、能恢复”为完成条件，不按功能数量判断进度。

Items outside **Now** are directions, not release promises. Compatibility is earned by tests against
real Ghostty versions and platforms.

## Now · make the current journey dependable

- Keep opening, source choice, search, draft, review, save, activation, and restore coherent in both
  Simplified Chinese and English.
- Preserve comments, ordering, unknown lines, BOM, CRLF, and trailing-newline style while editing the
  reviewed scalar set.
- Keep source-sensitive writes gated to a proven Ghostty contract; explain every read-only state next
  to the affected action.
- Finish the local PNG/JPEG background journey: import, select, fit, position, repeat, opacity, safe
  preview, exact diff, deletion protection, and recovery behavior.
- Maintain keyboard access, visible focus, live status, usable narrow layouts, reduced motion, and no
  flashing during continuous controls.
- Publish a truthful compatibility guide, troubleshooting path, real demo, checksums, and limitations.

## Next · survive upgrades and complex configs

- Model the complete versioned load graph, including default roots, include queue order, repeated
  values, reset behavior, and authoritative final-value sources.
- Add an upgrade summary for added, removed, and behaviorally changed settings; never guess a
  migration.
- Build one recovery center for outside edits, expired reviews, validation failures, uncertain writes,
  and snapshot restore.
- Add purpose-built editors for repeatable values, shortcuts, themes, paths, and other settings whose
  semantics cannot fit a generic control.
- Expand cross-version fixtures, concurrent-edit and fault-injection tests, parser property/fuzz
  coverage, and end-to-end save/restore tests.
- Provide a managed overlay only after the app can prove where it belongs in the effective load graph.

## Later · earn platform and ecosystem breadth

- Ship Developer ID signed, notarized, stapled macOS artifacts with a tested upgrade and rollback path;
  add Intel only with a published support matrix.
- Evaluate Linux after its config paths, permissions, packaging, desktop integration, and real-device
  journeys pass the same release gates. Windows is not currently promised.
- Add declarative presets and extension packs with visible source, integrity, capability, conflict,
  version pinning, disable, rollback, and removal behavior. Executable plugins remain out of scope by
  default.
- Consider HTTPS image download only after a separate network threat model covers redirects,
  private-address blocking, tracking, content limits, caching, credentials, consent, and cleanup.
- Add profiles and reversible migration guides once source and recovery semantics are complete.

## Release gates

Every milestone must satisfy all of these:

1. **No silent data loss:** unrelated bytes survive; stale revisions and rollback paths are tested.
2. **No hidden write:** real changes remain drafts until exact review, Ghostty validation, and explicit
   confirmation.
3. **No false certainty:** simulation, observed source, and verified effective value stay distinct.
4. **Recoverable failure:** the app says what happened to the file and offers a safe next action.
5. **Fail-closed upgrades:** unproven setting or source behavior becomes read-only.
6. **Accessible core journey:** keyboard, focus, status, contrast, target size, zoom, reduced motion,
   scroll, dialogs, and continuous-control stability are regressed.
7. **Explainable supply chain:** artifact origin, architecture, checksum, signature, notarization,
   dependencies, and future extension integrity are visible.

See [Compatibility](COMPATIBILITY.md), [Product experience](PRODUCT_EXPERIENCE.md),
[Architecture](ARCHITECTURE.md), and [Threat model](THREAT_MODEL.md) for the contracts behind these
gates.
