# Launch kit

Use this kit for a release or milestone. Replace bracketed fields, verify every statement against the
artifact, and leave the final post to a human review.

## Positioning

**One line:** Ghostty Studio is a local visual editor for the Ghostty configuration you already use.

**Proof:** It preserves the document, keeps changes in a draft, shows the exact diff, validates with
the installed Ghostty, and creates a local restore point before saving.

**Trust:** No account, cloud service, telemetry, remote scripts, or general-purpose file, network, and
shell access in the WebView.

**Current boundary:** Early preview for Apple Silicon Macs; the published package is ad-hoc signed and
not notarized, and the writable contract is audited against Ghostty 1.3.1.

## Canonical links

- Website: <https://steinshead.github.io/ghostty-studio/>
- Repository: <https://github.com/SteinsHead/ghostty-studio>
- Releases: <https://github.com/SteinsHead/ghostty-studio/releases>
- Demo: <https://github.com/SteinsHead/ghostty-studio/raw/main/docs/media/ghostty-studio-demo.mp4>
- Compatibility: <https://github.com/SteinsHead/ghostty-studio/blob/main/docs/COMPATIBILITY.md>

## X: single post

> Ghostty Studio is a local visual editor for the Ghostty config you already use. Preview visual
> changes, review the exact diff, validate with Ghostty, and recover from local snapshots—without an
> account or telemetry. Apple Silicon preview: https://steinshead.github.io/ghostty-studio/

Attach the current demo, not a static screenshot collage. Add alt text: “Ghostty Studio imports a
local background, adjusts its visibility, reviews the exact config diff, validates it with Ghostty,
and saves after confirmation.”

## X: four-post thread

1. **Problem:** “Ghostty is highly configurable, but editing a mature config is different from
   generating a new one. Comments, includes, unknown keys, and the actual write target matter.”
2. **Journey:** “Ghostty Studio keeps changes in a draft, previews visual options, shows the exact
   diff, asks Ghostty to validate, and creates a restore point before saving.”
3. **Trust:** “Everything stays local: no account, cloud service, telemetry, or remote image loading.
   When a setting or source is uncertain, it becomes read-only instead of being guessed.”
4. **Ask:** “The current preview targets Apple Silicon and Ghostty 1.3.1. If your config uses multiple
   roots or includes, I would value a redacted compatibility report: [release link].”

## Show HN

**Title:** `Show HN: Ghostty Studio – a local visual editor that preserves your Ghostty config`

**Body:**

> I built Ghostty Studio because most visual configurators start by generating a file, while I wanted
> to edit the Ghostty config I already use without flattening comments, ordering, includes, or unknown
> keys.
>
> Changes stay in a draft. Before saving, the app shows the exact diff, asks the installed Ghostty to
> validate it, creates a local restore point, and requires confirmation. The WebView has no general
> filesystem, network, or shell capability, and there is no account or telemetry.
>
> This is an early Apple Silicon preview, ad-hoc signed and not notarized. The writable behavior is
> currently audited against Ghostty 1.3.1; uncertain settings remain visible but read-only.
>
> Demo and source: https://steinshead.github.io/ghostty-studio/
>
> I am especially looking for redacted reports from real multi-root and include-based configs.

Post only when someone can answer technical and security questions for the next several hours.

## Ghostty and terminal communities

> I made a local visual editor for Ghostty and would appreciate workflow feedback. It opens the config
> you already use, preserves unrelated text, and makes review/validation/recovery part of saving.
>
> The current preview is Apple Silicon + Ghostty 1.3.1. It does not support remote images, executable
> plugins, or every setting yet; uncertain behavior stays read-only. Demo, limitations, and source:
> https://steinshead.github.io/ghostty-studio/

Read each community's rules, use the self-promotion thread when required, and do not repost the same
message across unrelated communities.

## GitHub release opening

> **[VERSION] makes [USER OUTCOME] easier.**
>
> This release adds [up to three observable changes]. Ghostty Studio still keeps all edits local and
> validates the reviewed candidate before saving.
>
> **Compatibility:** [platform, architecture, macOS, Ghostty contract].
> **Activation:** [reload, new terminal, or restart behavior].
> **Trust:** [signature/notarization status] and SHA-256 checksums are listed below.
> **Known limits:** [two material limits, with links].

Avoid “complete,” “production-ready,” “works everywhere,” and “secure” unless the release evidence
supports the exact claim.

## Media brief

- 20–40 seconds, 1440p or 1080p, readable at mobile width.
- Start with the result, then show one uninterrupted journey: select/import → adjust → review diff →
  validate/save → visible result.
- Use the current release build and synthetic config. Keep pointer motion deliberate; no fake terminal
  output, speed ramps that hide waiting, or effects that obscure the UI.
- Capture at 60fps with the pointer rendered in the same source frame as the app. Resolve targets from
  their live bounds, and verify the pointer hotspot is inside each control when it is activated.
- Provide burned-in captions, an English narration track, alt text, and a silent MP4/GIF fallback.
- Social card: 1200 × 630, one product view, one outcome sentence, no tiny feature list.

## Privacy and release checklist

Before recording or posting:

- [ ] Use a clean macOS account or synthetic config and image library.
- [ ] Remove usernames, home paths, hostnames, device names, recent files, and repository names.
- [ ] Remove tokens, API keys, SSH material, environment values, commands, history, and clipboard data.
- [ ] Close notifications, messaging apps, browser tabs, password managers, and unrelated windows.
- [ ] Use a synthetic Git repository and terminal prompt; check branch names and remotes.
- [ ] Strip image metadata and inspect the first and last frame plus every cut at full size.
- [ ] Listen to narration for spoken private data and inspect subtitle/source files.
- [ ] Search repository and built media sources for local absolute paths and secret patterns.
- [ ] Verify the download, checksum, architecture, minimum macOS, signature, and notarization wording.
- [ ] Confirm the demo reflects the release UI and every claim links to evidence.
- [ ] Add captions and alt text; verify the experience with reduced motion and without audio.

## Useful replies

**“Does it upload my config?”**  
No. There is no account, cloud service, or telemetry. The current app keeps config and managed images
on the Mac; its WebView has only narrow, allowlisted commands.

**“Why is this setting read-only?”**  
Studio has not proved the type, range, repeat behavior, source semantics, or version fingerprint for
that setting. It remains searchable, but the app will not guess a write.

**“Does it support Intel/Linux/Windows?”**  
Not as a supported release today. The current package targets Apple Silicon on macOS 11 or later.

**“Is this made by Ghostty?”**  
No. Ghostty Studio is an independent community project and is not affiliated with or endorsed by
Ghostty.

**“Why no remote image URL?”**  
Remote loading adds redirects, private-network access, tracking, credentials, cache, and content-type
risks. The current release supports normalized local PNG and JPEG files while that boundary remains
under design.

## After launch

Respond to reproducible issues before celebrating totals. After 72 hours, record the top three points
of confusion, update the product or docs once for each recurring question, and publish a short factual
follow-up. Track GitHub traffic, release downloads, actionable feedback, response time, and first-time
contributors; do not add in-app telemetry.
