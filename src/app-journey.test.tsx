// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { backend } from "./backend";
import { demoEnvironment, demoSchema } from "./demo";
import { isBackgroundSetting } from "./backgroundImageModel";
import { I18nProvider } from "./i18n";
import type { ConfigCandidate, ConfigGraph, ConfigSession, EnvironmentReport } from "./types";

const emptyGraph: ConfigGraph = {
  graphRevision: "empty",
  complete: true,
  semanticsKnown: false,
  nodes: [],
  edges: [],
  provenance: [],
  diagnostics: [],
  totalBytes: 0,
};

function sessionFor(candidate: ConfigCandidate): ConfigSession {
  return {
    id: `session-${candidate.id}`,
    candidateId: candidate.id,
    path: candidate.path,
    revision: `revision-${candidate.id}`,
    readOnly: false,
    values: Object.fromEntries(
      demoSchema.options
        .filter((option) => option.editable)
        .map((option) => [option.key, [...option.currentValues]]),
    ),
    configuredSettings: demoSchema.options.filter((option) => !isBackgroundSetting(option.key)).map((option) => ({
      key: option.key,
      occurrenceCount: Math.max(1, option.currentValues.length),
      valueExposure: option.editable ? "available" as const : "protected" as const,
    })),
    unrecognizedSettingCount: 0,
    diagnostics: [],
    backgroundImage: { kind: "none", assetId: null },
    effectiveValuesKnown: true,
    effectiveValues: {},
    effectiveBackgroundImage: { kind: "none", assetId: null },
    settingEffects: {},
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("primary application journey", () => {
  let container: HTMLDivElement;
  let root: Root;
  let environment: EnvironmentReport;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    environment = structuredClone(demoEnvironment);
    vi.spyOn(backend, "probeEnvironment").mockImplementation(async () => structuredClone(environment));
    vi.spyOn(backend, "loadRuntimeSchema").mockImplementation(async () => structuredClone(demoSchema));
    vi.spyOn(backend, "loadConfigGraph").mockResolvedValue(emptyGraph);
    vi.spyOn(backend, "openConfig").mockImplementation(async (candidateId) => {
      const candidate = environment.candidates.find((item) => item.id === candidateId);
      if (!candidate) throw new Error("unknown candidate");
      return sessionFor(candidate);
    });
    vi.spyOn(backend, "stageChanges").mockImplementation(async (_id, revision, changes) => ({
      token: "stage",
      revision,
      changes,
      unifiedDiff: "diff",
      diagnostics: [],
      valid: true,
      activation: "reload",
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
    vi.restoreAllMocks();
  });

  it("asks for a write target when several configs exist, even after refresh", async () => {
    act(() => root.render(<App />));
    await settle();

    expect(container.querySelector(".setup-page")).not.toBeNull();
    expect(backend.openConfig).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".setup-page .button--secondary")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector(".setup-page")).not.toBeNull();
    expect(backend.openConfig).not.toHaveBeenCalled();
  });

  it("opens the only config directly and remembers a valid source choice", async () => {
    const preferred = environment.candidates[1];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);

    act(() => root.render(<App />));
    await settle();

    expect(backend.openConfig).toHaveBeenCalledTimes(1);
    expect(backend.openConfig).toHaveBeenCalledWith(preferred.id);
    expect(container.querySelector(".settings-pane")).not.toBeNull();
    expect(container.textContent).not.toContain("扩展实验室");
    expect(container.textContent).not.toContain("本地工作台");
  });

  it("keeps Command-S inside an open source dialog instead of stacking review", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    act(() => root.render(<App />));
    await settle();

    const percentage = container.querySelector<HTMLInputElement>(
      'input[aria-label="背景不透明度 百分比"]',
    )!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      valueSetter.call(percentage, "88");
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector(".draft-dock")).not.toBeNull();

    act(() => container.querySelector<HTMLButtonElement>(".source-context")!.click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("选择写入位置");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
    })));

    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("选择写入位置");
    expect(backend.stageChanges).not.toHaveBeenCalled();
  });

  it("keeps the editing journey free of disabled reference controls", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    act(() => root.render(<App />));
    await settle();

    const appearance = [...container.querySelectorAll<HTMLButtonElement>(".category-nav button")]
      .find((button) => button.textContent?.trim() === "外观")!;
    act(() => appearance.click());

    expect(container.querySelector(".settings-pane select:disabled")).toBeNull();
    expect(container.querySelector(".settings-pane input:disabled")).toBeNull();
    expect(container.querySelector(".reference-setting-row__key")?.textContent).not.toBe("theme");
    expect(container.textContent).toContain("查看全部设置");
  });

  it("explains background-image contract drift instead of exposing broken controls", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    const changedSchema = structuredClone(demoSchema);
    const opacity = changedSchema.options.find((option) => option.key === "background-image-opacity")!;
    opacity.capability.editMode = "none";
    opacity.capability.reason = "setting-changed";
    vi.mocked(backend.loadRuntimeSchema).mockResolvedValueOnce(changedSchema);

    act(() => root.render(<App />));
    await settle();
    const appearance = [...container.querySelectorAll<HTMLButtonElement>(".category-nav button")]
      .find((button) => button.textContent?.trim() === "外观")!;
    act(() => appearance.click());

    expect(container.querySelector(".background-editor")).toBeNull();
    expect(container.querySelector(".background-compatibility")).not.toBeNull();
    expect(container.textContent).toContain("背景图片暂不可编辑");
    expect(container.querySelector('.background-compatibility input, .background-compatibility button')).toBeNull();
  });

  it("shows protected configured keys without exposing their values", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    act(() => root.render(<App />));
    await settle();

    const configured = [...container.querySelectorAll<HTMLButtonElement>(".main-nav button")]
      .find((button) => button.textContent?.trim() === "已设置")!;
    act(() => configured.click());

    const themeRow = [...container.querySelectorAll<HTMLElement>(".reference-setting-row")]
      .find((row) => row.querySelector("code")?.textContent === "theme")!;
    expect(themeRow).toBeTruthy();
    expect(themeRow.textContent).toContain("这份文件已设置");
    expect(themeRow.textContent).toContain("原值已保留");
    expect(themeRow.textContent).not.toContain("Catppuccin");
    expect(themeRow.querySelector("input, select, button")).toBeNull();
  });

  it("returns unsupported search matches as reference content", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    act(() => root.render(<App />));
    await settle();

    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(search, "theme");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("全部设置");
    const row = container.querySelector<HTMLElement>(".reference-setting-row")!;
    expect(row.querySelector("code")?.textContent).toBe("theme");
    expect(row.querySelector("input, select, button")).toBeNull();
  });

  it("moves from the complete catalog to the real editor", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    act(() => root.render(<App />));
    await settle();

    const catalog = [...container.querySelectorAll<HTMLButtonElement>(".category-nav button")]
      .find((button) => button.textContent?.trim() === "全部设置")!;
    act(() => catalog.click());
    const opacityRow = [...container.querySelectorAll<HTMLElement>(".reference-setting-row")]
      .find((row) => row.querySelector("code")?.textContent === "background-opacity")!;
    const adjust = [...opacityRow.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "调整")!;
    act(() => adjust.click());

    expect(container.querySelector(".section-heading h1")?.textContent).toBe("外观");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("背景不透明度 滑块");
  });

  it("explains duplicate assignments before the user starts editing", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    vi.mocked(backend.openConfig).mockImplementation(async () => {
      const opened = sessionFor(preferred);
      return {
        ...opened,
        configuredSettings: opened.configuredSettings.map((item) => (
          item.key === "background" ? { ...item, occurrenceCount: 2 } : item
        )),
      };
    });
    act(() => root.render(<App />));
    await settle();

    const background = [...container.querySelectorAll<HTMLElement>(".reference-setting-row")]
      .find((row) => row.querySelector("code")?.textContent === "background")!;
    expect(background).toBeTruthy();
    expect(background.textContent).toContain("多处设置");
    expect(background.querySelector("input, select, button")).toBeNull();
    act(() => background.querySelector<HTMLDetailsElement>("details")!.setAttribute("open", ""));
    expect(background.textContent).toContain("这份文件中出现了 2 次");
    expect(background.textContent).toContain("请在配置文件中合并或编辑这些值");
  });

  it("keeps transient feedback in the selected interface language", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    window.localStorage.setItem("ghostty-studio.language.v1", "zh-CN");
    act(() => root.render(<I18nProvider><App /></I18nProvider>));
    await settle();

    const percentage = container.querySelector<HTMLInputElement>(
      'input[aria-label="背景不透明度 百分比"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      inputSetter.call(percentage, "88");
      percentage.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLButtonElement>(".draft-dock .button--secondary")!.click());

    expect(container.querySelector(".save-toast")?.textContent).toContain("已放弃 1 项修改");

    const language = container.querySelector<HTMLSelectElement>('select[aria-label="界面语言"]')!;
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      selectSetter.call(language, "en");
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.querySelector(".save-toast")?.textContent).toContain("Discarded 1 change");
    expect(container.querySelector(".save-toast__action")?.textContent).toBe("Undo");
  });

  it("builds the draft preview from effective values and ignores an overridden edit", async () => {
    const preferred = environment.candidates[0];
    window.localStorage.setItem("ghostty-studio:preferred-candidate", preferred.id);
    vi.mocked(backend.openConfig).mockImplementation(async () => {
      const opened = sessionFor(preferred);
      opened.values["font-size"] = ["12"];
      opened.effectiveValues = { "font-size": ["20"] };
      opened.settingEffects = {
        "font-size": {
          status: "overridden",
          sourceCandidateId: environment.candidates[1].id,
          sourceLabel: environment.candidates[1].label,
        },
      };
      return opened;
    });

    act(() => root.render(<App />));
    await settle();

    const screen = container.querySelector<HTMLElement>(".preview-pane .terminal-screen")!;
    expect(screen.style.fontSize).toBe("20px");

    const fontSize = container.querySelector<HTMLInputElement>('input[aria-label="字号 数值"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      valueSetter.call(fontSize, "18");
      fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(screen.style.fontSize).toBe("20px");
    expect(container.querySelector(".preview-note")?.textContent).toContain("会被其他配置覆盖");
  });

});
