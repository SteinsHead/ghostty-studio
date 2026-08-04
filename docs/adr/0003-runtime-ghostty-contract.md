# ADR 0003: The installed Ghostty binary is the compatibility authority

- Status: accepted
- Date: 2026-08-03

## Decision

Do not serialize `+show-config` output back to disk or infer writable control types from default
values. Discover the installed binary, use its output as a read-only key/default/docs catalog,
require an exact version + schema-hash match for a versioned behavior overlay, and validate with
that exact binary.

For Ghostty 1.3.1 the observed default-file order is legacy XDG `config`, XDG
`config.ghostty`, legacy macOS Application Support `config`, then its
`config.ghostty`. Includes are processed afterwards and nested includes follow
the implementation's queue order. Later versions may differ.

## Consequences

- `+show-config --default --docs` supplies runtime keys, defaults, and docs but
  is never used for round-trip serialization.
- CLI success is determined by exit status; non-empty stderr alone is not a
  failure because non-fatal diagnostics such as Sentry initialization errors
  may appear.
- New keys and any unmatched version/schema hash degrade to lossless read-only display until
  curated metadata catches up; raw editing remains a future isolated expert flow.
- Current mismatches generate a fail-closed compatibility diagnostic. A full upgrade-diff report
  remains planned and is required before automatic migration.
- libghostty is not linked until its public configuration API is versioned and
  supported for third-party embedding.
