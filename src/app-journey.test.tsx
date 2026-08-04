// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { backend } from "./backend";
import { demoEnvironment, demoSchema } from "./demo";
import type { ConfigCandidate, ConfigGraph, ConfigSession, EnvironmentReport } from "./types";

const emptyGraph: ConfigGraph = {
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
      demoSchema.options.map((option) => [option.key, [...option.currentValues]]),
    ),
    diagnostics: [],
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
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("选择配置");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
    })));

    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("选择配置");
    expect(backend.stageChanges).not.toHaveBeenCalled();
  });
});
