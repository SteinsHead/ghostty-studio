// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoEnvironment, demoSchema } from "./demo";
import { isBackgroundSetting } from "./backgroundImageModel";
import type { ConfigCandidate, ConfigGraph, ConfigSession } from "./types";

const backendMock = vi.hoisted(() => ({
  probeEnvironment: vi.fn(),
  loadRuntimeSchema: vi.fn(),
  loadConfigGraph: vi.fn(),
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
  graphRevision: "concurrency",
  complete: true,
  semanticsKnown: true,
  nodes: [],
  edges: [],
  provenance: [],
  diagnostics: [],
  totalBytes: 0,
};

function sessionFor(candidate: ConfigCandidate): ConfigSession {
  const values = Object.fromEntries(
    demoSchema.options
      .filter((option) => option.editable)
      .map((option) => [option.key, [...option.currentValues]]),
  );
  return {
    id: `session-${candidate.id}`,
    candidateId: candidate.id,
    revision: `revision-${candidate.id}`,
    readOnly: false,
    values,
    configuredSettings: demoSchema.options
      .filter((option) => !isBackgroundSetting(option.key))
      .map((option) => ({
        key: option.key,
        occurrenceCount: Math.max(1, option.currentValues.length),
        valueExposure: option.editable ? "available" as const : "protected" as const,
      })),
    unrecognizedSettingCount: 0,
    diagnostics: [],
    backgroundImage: { kind: "none", assetId: null },
    effectiveValuesKnown: true,
    effectiveValues: structuredClone(values),
    effectiveBackgroundImage: { kind: "none", assetId: null },
    settingEffects: {
      "background-image": {
        status: "overridden",
        sourceCandidateId: demoEnvironment.candidates[1].id,
        sourceLabel: demoEnvironment.candidates[1].label,
      },
    },
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("source migration concurrency", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveTarget: (session: ConfigSession) => void;
  let targetSession: Promise<ConfigSession>;
  const original = demoEnvironment.candidates[0];
  const target = demoEnvironment.candidates[1];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem("ghostty-studio:preferred-candidate", original.id);
    targetSession = new Promise((resolve) => {
      resolveTarget = resolve;
    });
    backendMock.probeEnvironment.mockResolvedValue(structuredClone(demoEnvironment));
    backendMock.loadRuntimeSchema.mockResolvedValue(structuredClone(demoSchema));
    backendMock.loadConfigGraph.mockResolvedValue(graph);
    backendMock.listBackgroundAssets.mockResolvedValue([]);
    backendMock.openConfig.mockImplementation((candidateId: string) => (
      candidateId === target.id ? targetSession : Promise.resolve(sessionFor(original))
    ));
    backendMock.stageChanges.mockImplementation(async (_id, revision, changes) => ({
      token: "stage-token",
      revision,
      changes,
      unifiedDiff: "diff",
      diagnostics: [],
      valid: true,
      activation: "restart",
      effect: {
        status: "effective",
        affectedKeys: [],
        suggestedCandidateId: null,
        suggestedLabel: null,
      },
    }));
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

  function changeOpacity(percent: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="背景不透明度 百分比"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, percent);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  function startPendingMigration() {
    const move = [...container.querySelectorAll<HTMLButtonElement>(".background-effect-callout button")]
      .find((button) => button.textContent?.includes(`改存到 ${target.label}`));
    expect(move).toBeDefined();
    act(() => move!.click());
  }

  it("blocks staging and keeps a delayed target session from replacing newer edits", async () => {
    act(() => root.render(<App />));
    await settle();
    const opacity = changeOpacity("88");

    startPendingMigration();
    await settle();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
    })));
    expect(backendMock.stageChanges).not.toHaveBeenCalled();

    changeOpacity("77");
    await act(async () => {
      resolveTarget(sessionFor(target));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(opacity.value).toBe("77");
    expect(container.querySelector(".source-context")?.textContent).toContain(original.label);
    expect(container.textContent).toContain("草稿或配置已发生变化，因此没有切换写入位置");
  });

  it("disables an already-reviewed save while source migration is pending", async () => {
    act(() => root.render(<App />));
    await settle();
    changeOpacity("88");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".draft-dock .button--primary")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const save = [...container.querySelectorAll<HTMLButtonElement>(".review-footer button")]
      .find((button) => button.textContent?.trim() === "保存")!;
    expect(save.disabled).toBe(false);

    startPendingMigration();
    await settle();
    expect(save.disabled).toBe(true);
    act(() => save.click());
    expect(backendMock.applyChanges).not.toHaveBeenCalled();

    await act(async () => {
      resolveTarget(sessionFor(target));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("registers refresh as a mutation and never overwrites an edit made while it is pending", async () => {
    act(() => root.render(<App />));
    await settle();

    let resolveProbe!: (value: typeof demoEnvironment) => void;
    backendMock.probeEnvironment.mockReturnValueOnce(new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const reloadButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="重新读取 Ghostty 配置"]',
    )!;
    act(() => reloadButton.click());

    expect(reloadButton.getAttribute("aria-busy")).toBe("true");
    expect(reloadButton.getAttribute("aria-label")).toBe("正在重新读取 Ghostty 配置…");

    const opacity = changeOpacity("77");
    startPendingMigration();
    expect(backendMock.openConfig).not.toHaveBeenCalledWith(target.id);

    await act(async () => {
      resolveProbe(structuredClone(demoEnvironment));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(opacity.value).toBe("77");
    expect(container.querySelector(".source-context")?.textContent).toContain(original.label);
    expect(container.textContent).toContain("读取期间草稿已变化，未应用旧结果");
  });

  it("rechecks the draft after refresh opens the selected config", async () => {
    act(() => root.render(<App />));
    await settle();

    let resolveRefreshOpen!: (value: ConfigSession) => void;
    backendMock.openConfig.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefreshOpen = resolve;
    }));
    act(() => container.querySelector<HTMLButtonElement>(
      'button[aria-label="重新读取 Ghostty 配置"]',
    )!.click());
    await settle();

    const opacity = changeOpacity("77");
    await act(async () => {
      resolveRefreshOpen(sessionFor(original));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(opacity.value).toBe("77");
    expect(container.querySelector(".source-context")?.textContent).toContain(original.label);
    expect(container.textContent).toContain("读取期间草稿已变化，未应用旧结果");
  });
});
