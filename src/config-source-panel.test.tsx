// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigSourcePanel } from "./components/ConfigSourcePanel";
import { SetupPage } from "./components/SetupPage";
import { demoEnvironment } from "./demo";
import type { ConfigCandidate, EnvironmentReport } from "./types";

function missingCandidate(): ConfigCandidate {
  return {
    ...demoEnvironment.candidates[0],
    id: "missing-config",
    exists: false,
    writable: true,
    symlink: false,
    sizeBytes: null,
    creationEligible: true,
  };
}

function environmentWith(candidate: ConfigCandidate): EnvironmentReport {
  return {
    ...demoEnvironment,
    ghostty: { ...demoEnvironment.ghostty, available: true },
    candidates: [candidate],
  };
}

function Panel({
  environment,
  activeCandidate = null,
  switchingCandidateId = null,
}: {
  environment: EnvironmentReport;
  activeCandidate?: ConfigCandidate | null;
  switchingCandidateId?: string | null;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar" />
      <main className="workspace" />
      <ConfigSourcePanel
        environment={environment}
        activeCandidate={activeCandidate}
        pendingChanges={0}
        switchingCandidateId={switchingCandidateId}
        error={null}
        onClose={() => undefined}
        onOpenGraph={() => undefined}
        onSelect={vi.fn(async () => true)}
        onCreate={vi.fn(async () => true)}
      />
    </div>
  );
}

describe("configuration source state reconciliation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("clears a pending creation when fresh discovery says the file now exists", () => {
    const missing = missingCandidate();
    act(() => root.render(<Panel environment={environmentWith(missing)} />));

    act(() => container.querySelector<HTMLButtonElement>(".candidate-card__select")!.click());
    expect(container.querySelector(".candidate-confirm")).not.toBeNull();

    act(() => root.render(
      <Panel environment={environmentWith({ ...missing, exists: true, sizeBytes: 0 })} />,
    ));
    expect(container.querySelector(".candidate-confirm")).toBeNull();
  });

  it("does not offer duplicate creation for a candidate backed by an open session", () => {
    const missing = missingCandidate();
    const confirmedOpen = { ...missing, exists: true, sizeBytes: 0 };
    act(() => root.render(
      <Panel environment={environmentWith(missing)} activeCandidate={confirmedOpen} />,
    ));

    const select = container.querySelector<HTMLButtonElement>(".candidate-card__select")!;
    expect(select.disabled).toBe(true);
    expect(container.querySelector(".candidate-state")?.textContent).toContain("已打开 · 待刷新");
  });

  it("explains why a second configuration cannot be created", () => {
    const existing = { ...demoEnvironment.candidates[0], exists: true };
    const missing = { ...missingCandidate(), label: "Missing configuration" };
    const environment = {
      ...environmentWith(existing),
      candidates: [existing, missing],
    };
    act(() => root.render(<Panel environment={environment} />));

    const missingCard = Array.from(container.querySelectorAll<HTMLElement>(".candidate-card"))
      .find((card) => card.textContent?.includes(missing.label));
    expect(missingCard).toBeDefined();
    expect(missingCard!.querySelector<HTMLButtonElement>(".candidate-card__select")!.disabled).toBe(true);
    expect(missingCard!.querySelector(".candidate-state")?.textContent).toBe("已有其他配置");
    expect(missingCard!.querySelector(".candidate-state--ready")).toBeNull();
    expect(missingCard!.textContent).not.toContain("需手动创建");
  });

  it("distinguishes a disconnected Ghostty from an ineligible location", () => {
    const missing = missingCandidate();
    act(() => root.render(
      <Panel
        environment={{
          ...environmentWith(missing),
          ghostty: { ...demoEnvironment.ghostty, available: false },
        }}
      />,
    ));
    expect(container.querySelector(".candidate-state")?.textContent).toBe("连接 Ghostty 后可创建");

    act(() => root.render(
      <Panel environment={environmentWith({ ...missing, creationEligible: false })} />,
    ));
    expect(container.querySelector(".candidate-state")?.textContent).toBe("无法安全创建");
    expect(container.querySelector(".candidate-state--ready")).toBeNull();
  });

  it("announces an in-progress source operation without exposing the path", () => {
    const candidate = { ...demoEnvironment.candidates[0], exists: true };
    act(() => root.render(
      <Panel
        environment={environmentWith(candidate)}
        switchingCandidateId={candidate.id}
      />,
    ));

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const status = container.querySelector<HTMLElement>('.candidate-state[role="status"]')!;
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("正在打开…");
  });

  it("does not promise creation when setup has no eligible location", () => {
    const missing = { ...missingCandidate(), writable: false };
    act(() => root.render(
      <SetupPage
        environment={environmentWith(missing)}
        refreshing={false}
        pendingChanges={0}
        onChooseSource={() => undefined}
        onRefresh={() => undefined}
      />,
    ));

    expect(container.querySelector("#setup-title")?.textContent).toBe("检查 Ghostty 配置位置");
    expect(container.textContent).toContain("当前没有可安全创建的配置位置");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent))
      .toContain("查看配置位置");
    expect(container.textContent).not.toContain("创建你的 Ghostty 配置");
  });
});
