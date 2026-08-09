// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearancePreview, type PreviewMode } from "./components/AppearancePreview";

function PreviewHarness() {
  const [mode, setMode] = useState<PreviewMode>("draft");
  return (
    <AppearancePreview
      mode={mode}
      effectiveKnown
      savedValues={{ "font-size": "12" }}
      draftValues={{ "font-size": "20" }}
      ignoredChangeCount={1}
      onModeChange={setMode}
    />
  );
}

describe("appearance preview mode", () => {
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

  it("exposes one selected radio and supports arrow-key comparison", () => {
    act(() => root.render(<PreviewHarness />));

    const group = container.querySelector<HTMLElement>("[role='radiogroup']")!;
    const [saved, draft] = [...group.querySelectorAll<HTMLButtonElement>("[role='radio']")];
    expect(group.getAttribute("aria-label")).toBe("预览版本");
    expect(saved.getAttribute("aria-checked")).toBe("false");
    expect(saved.tabIndex).toBe(-1);
    expect(draft.getAttribute("aria-checked")).toBe("true");
    expect(draft.tabIndex).toBe(0);
    expect(container.querySelector<HTMLElement>(".terminal-screen")!.style.fontSize).toBe("20px");
    expect(container.querySelector(".preview-note")?.textContent).toContain("会被其他配置覆盖");

    draft.focus();
    act(() => draft.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
    })));

    expect(saved.getAttribute("aria-checked")).toBe("true");
    expect(saved.tabIndex).toBe(0);
    expect(draft.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(saved);
    expect(container.querySelector<HTMLElement>(".terminal-screen")!.style.fontSize).toBe("12px");
  });
});
