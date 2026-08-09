import type { BackgroundAssetSummary } from "./types";

export const RECORDING_DEMO_ASSET_ID = "8f1d8f5f93f0b05f0b91e2bb5ad6fc21c9d54cb4bd428fbbd488f0629e2ff165";

export function recordingDemoRequested(dev: boolean, search: string): boolean {
  return dev && new URLSearchParams(search).get("recording") === "1";
}

export const recordingDemoEnabled = recordingDemoRequested(
  import.meta.env.DEV,
  typeof window === "undefined" ? "" : window.location.search,
);

export async function holdRecordingTransition(): Promise<void> {
  if (!recordingDemoEnabled) return;
  await new Promise((resolve) => window.setTimeout(resolve, 900));
}

export const recordingDemoAsset: BackgroundAssetSummary = {
  id: RECORDING_DEMO_ASSET_ID,
  displayName: "midnight-landscape.png",
  mediaType: "image/png",
  width: 2560,
  height: 1440,
  sizeBytes: 1_494_712,
  importedAtMs: Date.UTC(2026, 7, 9, 12, 0),
  largeImageWarning: false,
  usage: {
    status: "available",
    references: [],
  },
};

export const recordingDemoPreviewUrl = "/docs/media/source/terminal-landscape.png";
