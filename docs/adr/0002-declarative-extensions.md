# ADR 0002: Declarative extensions by default

- Status: accepted
- Date: 2026-08-03

## Decision

Third-party extensions are data-only manifests. They may contribute metadata,
validation constraints, presets, migrations, and preview descriptions, but may
not execute JavaScript, Rust, shell commands, or access files/network.

## Rationale

A configuration editor handles command strings, environment variables, and
filesystem paths. In-process executable plugins would turn a convenience tool
into a high-value arbitrary-code execution surface. Most useful extension
needs are schema and presentation data and do not justify that risk.

## Future escape hatch

If a concrete use case requires code, evaluate an opt-in out-of-process or
WASI host with explicit capabilities, quotas, signatures, and a versioned
protocol. It must not weaken the default application boundary.
