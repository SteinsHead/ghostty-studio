import { isGenericallyEditable } from "./productModel";
import type { ConfigCandidate, RuntimeOption } from "./types";

export const COMMON_SETTING_KEYS = [
  "theme",
  "background",
  "foreground",
  "background-opacity",
  "background-blur-radius",
  "font-family",
  "font-size",
  "window-padding-x",
  "window-padding-y",
  "cursor-style",
  "cursor-color",
  "unfocused-split-opacity",
] as const;

export const PREVIEW_SETTING_KEYS = new Set([
  "background",
  "foreground",
  "background-opacity",
  "font-family",
  "font-size",
  "window-padding-x",
  "window-padding-y",
  "cursor-style",
  "cursor-color",
]);

export function chooseStartupCandidate(
  candidates: ConfigCandidate[],
  preferredId: string | null,
): ConfigCandidate | null {
  const existing = candidates.filter((candidate) => candidate.exists);
  if (existing.length === 1) return existing[0];
  if (existing.length === 0 || !preferredId) return null;
  return existing.find((candidate) => candidate.id === preferredId) ?? null;
}

/**
 * Refreshing an open workspace must never jump to a different write target.
 * If the active source disappeared, the user must make the next choice; when
 * no workspace has been opened yet, the same conservative startup rules apply.
 */
export function chooseWorkspaceCandidate(
  candidates: ConfigCandidate[],
  activeId: string | null,
  preferredId: string | null,
): ConfigCandidate | null {
  const existing = candidates.filter((candidate) => candidate.exists);
  if (activeId) return existing.find((candidate) => candidate.id === activeId) ?? null;
  return chooseStartupCandidate(existing, preferredId);
}

export function isCommonSetting(option: RuntimeOption): boolean {
  return COMMON_SETTING_KEYS.includes(option.key as typeof COMMON_SETTING_KEYS[number])
    && isGenericallyEditable(option);
}
