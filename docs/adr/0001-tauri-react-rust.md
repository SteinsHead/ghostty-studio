# ADR 0001: Tauri 2 with React and a Rust core

- Status: accepted
- Date: 2026-08-03

## Decision

Use Tauri 2 as the desktop shell, React/TypeScript as the presentation layer,
and Rust for all privileged and persistence behavior.

## Consequences

- macOS and Linux share the product and domain model.
- File writes, process execution, locks, and validation are memory-safe and
  independently testable.
- Tauri capabilities and a narrow IPC surface reduce frontend compromise impact.
- The project must maintain an explicit Rust/TypeScript contract and two build
  toolchains.
- The UI must not depend directly on Tauri so browser-based component tests and
  a future alternate client remain possible.
