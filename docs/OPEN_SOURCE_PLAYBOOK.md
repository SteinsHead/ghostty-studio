# Open-source playbook

Ghostty Studio should earn trust as a focused desktop product before it grows as a platform. The
working thesis is simple: **edit the Ghostty config a user already has, show the exact write, let
Ghostty validate it, and make recovery obvious.**

## What strong projects teach us

These are patterns to adapt, not products to imitate.

| Project | Useful pattern | Ghostty Studio decision |
|---|---|---|
| [Ghostty](https://github.com/ghostty-org/ghostty) | A clear product boundary, native platform behavior, shared core, explicit hacking and packaging guides | Follow Ghostty's platform truth and document version-specific behavior; remain an independent community project. |
| [OpenAI Codex](https://github.com/openai/codex) | Short value proposition, immediate install path, public contributor and security guidance | Keep the first screen and README task-first; route depth into docs instead of adding more claims. |
| [browser-use](https://github.com/browser-use/browser-use) | Real outcome video, minimal quick start, examples, and visible community paths | Demonstrate one complete “change → review → validate → save” journey with real UI. |
| [Cline](https://github.com/cline/cline) | User approval, checkpoints, extensibility, and multiple feedback surfaces | Keep confirmation and recovery central; expose extensions only after their trust model is usable. |
| [OpenHands](https://github.com/OpenHands/OpenHands) | Clear component boundaries and prominent security limitations | Publish the trust boundary and fail closed when a source or version is uncertain. |
| [Dify](https://github.com/langgenius/dify) and [n8n](https://github.com/n8n-io/n8n) | Templates and integrations create repeatable discovery loops | Later, use reviewed presets and declarative packs; do not copy their cloud or marketplace breadth. |
| [Crush](https://github.com/charmbracelet/crush) and [Zed](https://github.com/zed-industries/zed) | Strong identity, platform-specific install paths, transparent contribution and extension systems | Keep the product visually distinct and make each supported platform claim testable. |
| [Continue](https://github.com/continuedev/continue) | Its archived repository is a reminder that broad, cross-surface scope has a maintenance cost | Prefer a small number of complete journeys over accumulating integrations. |

## Adopt

- One sentence that names the user, task, and difference.
- A real 20–40 second demo above architectural detail.
- One supported download path with compatibility and trust status beside it.
- Public architecture, security boundaries, recovery behavior, and known limitations.
- Version-gated compatibility: a changed setting becomes read-only instead of “probably working.”
- Structured bug, compatibility, and feature feedback using redacted examples.
- Small declarative extension contracts with ownership, version, and rollback rules.
- Release notes that show user outcomes, activation requirements, and upgrade risks.

## Do not adopt

- Accounts, cloud sync, telemetry, remote image loading, or executable plugins to create the appearance
  of a platform.
- A generic control for every Ghostty key before its type and write semantics are known.
- Intel, Linux, Windows, signing, notarization, or compatibility claims without a tested artifact.
- Paid stars, automated praise, cross-post spam, artificial urgency, or benchmark claims without a
  reproducible method.
- A template marketplace before import, permission, integrity, conflict, disable, and rollback flows
  are complete.

## Measures without product telemetry

No metric requires observing local configuration data or app behavior.

| Signal | Source | First 90-day target |
|---|---|---|
| Qualified discovery | GitHub traffic/referrers and release asset download totals | 100 stars and 50 release downloads |
| Useful feedback | Issues or discussions with a reproducible, redacted workflow | 10 reports across at least 3 configuration layouts |
| Reliability | Publicly reported data-loss regressions and release-blocking compatibility defects | 0 unresolved data-loss regressions; every blocker has an owner and status |
| Responsiveness | Time to first maintainer response on actionable issues | Median under 3 days |
| Community health | First-time contributors whose issue, docs change, test, or code change is accepted | 2 first-time contributors |

Stars measure discovery, not product quality. Review these signals monthly in a short public update;
do not add in-app analytics to improve the chart.

## Now · conversion and trust

- Ship a focused landing page, compatibility guide, troubleshooting path, contribution templates, and
  a real demo with captions and alt text.
- Make download architecture, ad-hoc signature, non-notarized status, checksum, and Ghostty 1.3.1
  contract visible before installation.
- Publish one release story across X and the Ghostty community, then answer every substantive question
  with evidence or a documented limit.
- Tag feedback by journey: discovery, source choice, edit, background, review/save, activation, and
  recovery.

## Next · prove repeatable value

- Fix the three most common journey failures before expanding the setting count.
- Add clean-machine installation and real-device compatibility checks for every published artifact.
- Turn recurring support answers into tests and concise troubleshooting entries.
- Invite narrowly scoped contributions: a fixture, a compatibility report, a translation correction,
  or one reviewed setting contract.
- Launch on broader developer channels only when the install path and first-save journey survive an
  independent test.

## Later · expand only behind gates

- Add notarized and architecture-specific macOS releases after signing and upgrade recovery are tested.
- Consider Linux only with native path, permission, packaging, and desktop behavior coverage.
- Add declarative presets and extension packs after integrity, permissions, conflicts, disable,
  rollback, and removal are visible to users.
- Consider network-backed assets only after an isolated threat model, explicit consent, size/type
  limits, redirect policy, private-address blocking, and credential handling are implemented.

## Release gate

Promotion begins only when the artifact installs on its stated platform, the demo matches the current
UI, checksums and limitations are published, test and security checks pass, and every image/video has
been reviewed for private data. If a claim cannot be demonstrated from the release, remove the claim.
