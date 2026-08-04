// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigSourcePanel } from "./components/ConfigSourcePanel";
import { demoEnvironment } from "./demo";
import type { ConfigCandidate, EnvironmentReport } from "./types";

function missingCandidate(): ConfigCandidate {
  return {
    ...demoEnvironment.candidates[0],
    id: "missing-config",
    path: "~/.config/ghostty/config",
    exists: false,
    writable: true,
    symlink: false,
    sizeBytes: null,
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
}: {
  environment: EnvironmentReport;
  activeCandidate?: ConfigCandidate | null;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar" />
      <main className="workspace" />
      <ConfigSourcePanel
        environment={environment}
        activeCandidate={activeCandidate}
        pendingChanges={0}
        switchingCandidateId={null}
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
});
