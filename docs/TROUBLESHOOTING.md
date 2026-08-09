# Troubleshooting

Start with **Reload configuration** in Ghostty Studio. Reloading preserves compatible draft values,
re-reads the active files, and invalidates an outdated review.

## A saved change does not appear in Ghostty

1. Read the completion message. Some settings reload immediately, some affect only a new terminal,
   and some require Ghostty to quit completely and reopen.
2. Confirm **Current write location** is the file you intended to edit.
3. Reload Studio. If another layer or include wins, choose the effective source offered by the app,
   then review and save again.
4. If Studio says the candidate was restored, the change did not remain on disk. Resolve the reported
   source or validation problem before retrying.
5. Run `ghostty +validate-config` in a terminal if you want an independent check from the installed
   Ghostty binary. Do not paste its unredacted output into a public issue.

Studio never treats its simulated preview as proof that Ghostty applied a value.

## A setting is read-only

The status next to the setting is the reason, not a disabled-control error. Common causes are:

- the browser demo is open instead of the desktop app;
- Ghostty is missing, unsupported, or its definition for that setting changed;
- the setting is platform-specific, repeatable, sensitive, unknown, or needs a dedicated editor;
- the configuration graph is incomplete or the effective source cannot be proved;
- the current file or session became stale after an outside edit.

Install or update Ghostty if it is missing, reopen the desktop app, then reload. Do not force a write
by copying a guessed value into another control. A safe manual edit remains possible in a text editor
when the Ghostty documentation defines the behavior, but Studio cannot review or recover that edit.

## A background image does not preview

- A library image must be selected into the draft; importing it alone does not change the config.
- Increase **Image visibility** and check fit, position, and repeat.
- Existing external paths are intentionally not previewed. Import the image into Studio's local
  library if you want a safe preview and managed copy.
- Only PNG and JPEG are accepted. Re-export an unsupported file instead of changing its extension.
- After saving, follow the reported activation step: reload, open a new terminal, or restart Ghostty.

If a preview request fails, select the image again after reloading. A late or failed preview response
cannot replace the current selection.

## A background image cannot be deleted

Studio blocks deletion while any loaded configuration source still references the managed image.
Select another image or remove the background from the draft, save it, reload the configuration, and
try again. If restore points still reference the image, the confirmation explains that those restores
will no longer bring the image back.

If deletion was cancelled or interrupted, retry after reload. The operation is designed to be
idempotent and never deletes an external file.

## The configuration changed in another app

Studio keeps the newer disk content, reloads it, and preserves any still-compatible draft values. The
old review is no longer valid: inspect the draft and exact diff again before saving. Do not overwrite
the file to silence the conflict.

## Ghostty validation fails

The original file remains unchanged when validation fails before a write. If the final loaded config
cannot be verified after a write, Studio attempts a revision-aware rollback and reports whether the
result is certain.

- Reload and fix the setting or source named by the app.
- If editing is paused because recovery could not be confirmed, close Studio, inspect the real config
  with a trusted text editor, validate with Ghostty, then reopen Studio.
- Do not delete temporary, config, or snapshot files based on a guessed path.

## Restore a previous configuration

Open **More → Restore points**, choose a snapshot, inspect the diff, and confirm the native dialog.
Restore uses the same revision checks and Ghostty validation as a normal save, and creates another
snapshot first. A snapshot containing settings that the current version cannot edit safely may require
manual recovery; Studio will not partially restore it.

## macOS blocks the first launch

The preview build is ad-hoc signed and not notarized. Confirm that it came from the official
[release page](https://github.com/SteinsHead/ghostty-studio/releases) and verify its published
SHA-256 checksum. Use macOS's normal security review flow; do not disable Gatekeeper or run an
unverified bypass command.

## Ask for help safely

Before opening an [issue](https://github.com/SteinsHead/ghostty-studio/issues), include the app,
Ghostty, macOS, and Mac architecture versions plus the shortest reproducible sequence. Redact:

- usernames, home paths, hostnames, file names, and repository names;
- tokens, keys, environment values, commands, shell history, and clipboard content;
- unrelated windows, notifications, browser tabs, and image metadata.

Prefer a synthetic config with placeholder values. Security reports belong in the private process
described by [SECURITY.md](../SECURITY.md), not a public issue.
