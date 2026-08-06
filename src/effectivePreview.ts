import { RESET_BACKGROUND_TOKEN } from "./backgroundImageModel";
import type { SettingEffect } from "./types";

/** Build the edited preview on top of Ghostty's effective configuration. */
export function effectiveDraftPreview(
  effectiveBaseline: Record<string, string>,
  localBaseline: Record<string, string>,
  draft: Record<string, string>,
  effects: Record<string, SettingEffect>,
): Record<string, string> {
  const preview = { ...effectiveBaseline };

  for (const [key, value] of Object.entries(draft)) {
    if (value === localBaseline[key]) continue;

    const status = effects[key]?.status;
    if (status === "overridden" || status === "unverified") continue;

    // Removing an assignment does not reveal the value inherited from an
    // earlier source. Retain the known effective value instead of inventing a
    // default; Ghostty's final read is still authoritative after save.
    if (value === "") continue;

    preview[key] = value === RESET_BACKGROUND_TOKEN ? "" : value;
  }

  return preview;
}

export function ignoredDraftPreviewKeys(
  localBaseline: Record<string, string>,
  draft: Record<string, string>,
  effects: Record<string, SettingEffect>,
): string[] {
  return Object.entries(draft)
    .filter(([key, value]) => value !== localBaseline[key]
      && (value === ""
        || effects[key]?.status === "overridden"
        || effects[key]?.status === "unverified"))
    .map(([key]) => key);
}
