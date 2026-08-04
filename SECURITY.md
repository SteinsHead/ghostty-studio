# Security policy

## Supported versions

Ghostty Studio is still an early preview. Security fixes are made on the latest preview release;
older commits are not maintained as separate release lines.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/SteinsHead/ghostty-studio/security/advisories/new).
Do not open a public issue for a vulnerability that could expose configuration contents, paths,
commands, environment values, or other private data.

A useful report includes:

- the affected version or commit;
- clear reproduction steps;
- the expected and observed behavior;
- a minimal, fully redacted sample when one is needed.

Never attach a real Ghostty configuration or secret value.

## Security model at a glance

Ghostty Studio works locally and does not include telemetry or a cloud service. The webview does not
receive general-purpose filesystem, shell, or network capabilities. Saving requires an explicit diff
review and native confirmation; Ghostty validates the candidate and the app creates a snapshot before
replacing the configuration file.

Development builds use ad-hoc signing and are not notarized. They can detect changes made after the
bundle was signed, but they do not prove publisher identity. See the [threat model](docs/THREAT_MODEL.md)
for the complete trust boundaries and non-goals.
