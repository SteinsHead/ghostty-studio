// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoEnvironment, demoSchema } from "./demo";
import { isBackgroundSetting } from "./backgroundImageModel";
import type {
  BackgroundAssetSummary,
  ConfigCandidate,
  ConfigGraph,
  ConfigSession,
} from "./types";

const backendMock = vi.hoisted(() => ({
  probeEnvironment: vi.fn(),
  loadRuntimeSchema: vi.fn(),
  loadConfigGraph: vi.fn(),
  inspectExtensionManifest: vi.fn(),
  openConfig: vi.fn(),
  createConfig: vi.fn(),
  stageChanges: vi.fn(),
  applyChanges: vi.fn(),
  listSnapshots: vi.fn(),
  restoreSnapshot: vi.fn(),
  listBackgroundAssets: vi.fn(),
  chooseBackgroundImages: vi.fn(),
  getBackgroundAssetPreview: vi.fn(),
  deleteBackgroundAsset: vi.fn(),
}));

vi.mock("./backend", () => ({ backend: backendMock, isDesktop: true }));

import App from "./App";

const graph: ConfigGraph = {
  graphRevision: "background-journey",
  complete: true,
  semanticsKnown: true,
  nodes: [],
  edges: [],
  provenance: [],
  diagnostics: [],
  totalBytes: 0,
};

const asset: BackgroundAssetSummary = {
  id: "a".repeat(64),
  displayName: "night sky.png",
  mediaType: "image/png",
  width: 1920,
  height: 1080,
  sizeBytes: 420_000,
  importedAtMs: 10,
  largeImageWarning: false,
  usage: { status: "available", references: [] },
};

function sessionFor(candidate: ConfigCandidate): ConfigSession {
  const values = Object.fromEntries(
    demoSchema.options
      .filter((option) => option.editable && !isBackgroundSetting(option.key))
      .map((option) => [option.key, [...option.currentValues]]),
  );
  const effects = Object.fromEntries([
    "background-image",
    "background-image-opacity",
    "background-image-fit",
    "background-image-position",
    "background-image-repeat",
  ].map((key) => [key, {
    status: "effective" as const,
    sourceCandidateId: candidate.id,
    sourceLabel: candidate.label,
  }]));
  return {
    id: `session-${candidate.id}`,
    candidateId: candidate.id,
    path: candidate.path,
    revision: `revision-${candidate.id}`,
    readOnly: false,
    values,
    configuredSettings: [],
    unrecognizedSettingCount: 0,
    diagnostics: [],
    backgroundImage: { kind: "external", assetId: null },
    effectiveValuesKnown: true,
    effectiveValues: structuredClone(values),
    effectiveBackgroundImage: { kind: "external", assetId: null },
    settingEffects: effects,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("background image journey", () => {
  let container: HTMLDivElement;
  let root: Root;
  const candidate = demoEnvironment.candidates[0];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem("ghostty-studio:preferred-candidate", candidate.id);
    window.localStorage.setItem("ghostty-studio:last-category", "appearance");
    backendMock.probeEnvironment.mockResolvedValue(structuredClone(demoEnvironment));
    backendMock.loadRuntimeSchema.mockResolvedValue(structuredClone(demoSchema));
    backendMock.loadConfigGraph.mockResolvedValue(graph);
    backendMock.openConfig.mockResolvedValue(sessionFor(candidate));
    backendMock.listSnapshots.mockResolvedValue([]);
    backendMock.listBackgroundAssets.mockResolvedValue([]);
    backendMock.getBackgroundAssetPreview.mockResolvedValue({
      assetId: asset.id,
      dataUrl: "data:image/png;base64,AAAA",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("selects the first imported image over an external background and previews it immediately", async () => {
    backendMock.chooseBackgroundImages.mockResolvedValue({
      canceled: false,
      assets: [asset],
      rejected: [],
    });

    act(() => root.render(<App />));
    await settle();
    expect(container.textContent).toContain("配置文件中的图片");

    await act(async () => {
      const add = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("添加图片"));
      add!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(backendMock.chooseBackgroundImages).toHaveBeenCalledOnce();
    expect(backendMock.getBackgroundAssetPreview).toHaveBeenCalledWith(asset.id);
    expect(container.querySelector<HTMLImageElement>(".background-editor__canvas img")?.src)
      .toContain("data:image/png;base64,AAAA");
    expect(container.querySelector<HTMLElement>(".preview-pane .terminal-background-image")?.style.backgroundImage)
      .toContain("data:image/png;base64,AAAA");
    expect(container.textContent).toContain("图片已选择");
    expect(container.textContent).toContain("1 项修改尚未保存");
  });

  it("keeps the card and thumbnail stable when deletion is rejected and ignores repeat clicks", async () => {
    const deletion = deferred<void>();
    backendMock.listBackgroundAssets.mockResolvedValue([asset]);
    backendMock.deleteBackgroundAsset.mockReturnValue(deletion.promise);

    act(() => root.render(<App />));
    await settle();
    await settle();
    const card = container.querySelector<HTMLElement>(".background-asset-shell")!;
    const thumbnail = card.querySelector<HTMLImageElement>("img")!;
    const remove = card.querySelector<HTMLButtonElement>(".background-asset__delete")!;

    act(() => {
      remove.click();
      remove.click();
    });
    expect(backendMock.deleteBackgroundAsset).toHaveBeenCalledOnce();
    expect(remove.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".background-asset-shell")).toBe(card);

    await act(async () => {
      deletion.reject({ code: "background_asset_in_use", message: "private path omitted" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector(".background-asset-shell")).toBe(card);
    expect(card.querySelector("img")).toBe(thumbnail);
    expect(container.textContent).toContain("写入位置");
    expect(backendMock.listBackgroundAssets).toHaveBeenCalledTimes(2);
  });

  it("removes an unreferenced card only after the confirmed backend deletion succeeds", async () => {
    const deletion = deferred<void>();
    backendMock.listBackgroundAssets.mockResolvedValue([asset]);
    backendMock.deleteBackgroundAsset.mockReturnValue(deletion.promise);

    act(() => root.render(<App />));
    await settle();
    await settle();
    const remove = container.querySelector<HTMLButtonElement>(".background-asset__delete")!;
    act(() => remove.click());
    expect(container.querySelector(".background-asset-shell")).not.toBeNull();

    await act(async () => {
      deletion.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".background-asset-shell")).toBeNull();
    expect(container.textContent).toContain("已从图库删除");
  });
});
