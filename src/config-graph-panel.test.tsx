// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigGraphPanel } from "./components/ConfigGraphPanel";

describe("configuration graph feedback", () => {
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

  it("distinguishes a recoverable error from an active reload", () => {
    const onRetry = vi.fn();
    const renderPanel = (loading: boolean, error: string | null) => (
      <div className="app-shell">
        <aside className="sidebar" />
        <main className="workspace" />
        <ConfigGraphPanel
          graph={null}
          loading={loading}
          error={error}
          onClose={() => undefined}
          onRetry={onRetry}
        />
      </div>
    );

    act(() => root.render(renderPanel(false, "配置来源读取失败")));
    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("配置来源读取失败");
    act(() => container.querySelector<HTMLButtonElement>(".graph-error button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();

    act(() => root.render(renderPanel(true, "配置来源读取失败")));
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("[role='status']")?.textContent).toContain("正在重新读取配置来源");
  });
});
