// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPanel } from "./components/ReviewPanel";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell">
      <aside className="sidebar"><button type="button" onClick={() => setOpen(true)}>打开检查</button></aside>
      <main className="workspace"><button type="button">背景操作</button></main>
      {open && (
        <ReviewPanel
          changes={[{ key: "font-size", before: ["13"], after: ["14"] }]}
          preview={null}
          loading={false}
          readOnly
          onClose={() => setOpen(false)}
          onApply={() => undefined}
        />
      )}
    </div>
  );
}

describe("modal focus contract", () => {
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

  it("makes the workspace inert, closes on Escape, and restores focus", () => {
    act(() => root.render(<DialogHarness />));
    const opener = container.querySelector<HTMLButtonElement>(".sidebar button")!;
    opener.focus();

    act(() => opener.click());
    const sidebar = container.querySelector<HTMLElement>(".sidebar")!;
    const workspace = container.querySelector<HTMLElement>(".workspace")!;
    expect(sidebar.inert).toBe(true);
    expect(workspace.inert).toBe(true);
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("[data-dialog-initial-focus]"));

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector(".review-panel")).toBeNull();
    expect(sidebar.inert).toBe(false);
    expect(workspace.inert).toBe(false);
    expect(sidebar.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
