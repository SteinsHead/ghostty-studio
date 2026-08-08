// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Disclosure } from "./components/Disclosure";
import { Presence } from "./components/Presence";

function PresenceHarness() {
  const [show, setShow] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setShow(true)}>open</button>
      <button type="button" onClick={() => setShow(false)}>close</button>
      <Presence show={show}><div data-testid="panel">panel</div></Presence>
    </div>
  );
}

describe("interaction motion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => (
      window.setTimeout(() => callback(performance.now()), 16)
    ));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
      window.clearTimeout(handle);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps exits mounted and reverses them when reopened", () => {
    act(() => root.render(<PresenceHarness />));
    const [open, close] = container.querySelectorAll<HTMLButtonElement>("button");

    act(() => open.click());
    expect(container.querySelector(".presence")?.getAttribute("data-presence")).toBe("entering");
    act(() => vi.advanceTimersByTime(16));
    expect(container.querySelector(".presence")?.getAttribute("data-presence")).toBe("open");

    act(() => close.click());
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull();
    expect(container.querySelector(".presence")?.getAttribute("data-presence")).toBe("exiting");

    act(() => open.click());
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".presence")?.getAttribute("data-presence")).toBe("open");

    act(() => close.click());
    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector('[data-testid="panel"]')).toBeNull();
  });

  it("does not delay removal when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    act(() => root.render(<PresenceHarness />));
    const [open, close] = container.querySelectorAll<HTMLButtonElement>("button");

    act(() => open.click());
    act(() => vi.advanceTimersByTime(16));
    act(() => close.click());
    act(() => vi.runOnlyPendingTimers());

    expect(container.querySelector('[data-testid="panel"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps disclosure state accessible during rapid reversals", () => {
    act(() => root.render(
      <Disclosure
        className="test-disclosure"
        summary="Details"
        summaryLabel="About this setting"
      >
        <button type="button">Nested action</button>
      </Disclosure>,
    ));

    const summary = container.querySelector<HTMLButtonElement>(".disclosure-summary")!;
    const viewport = container.querySelector<HTMLElement>(".disclosure-viewport")!;
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(viewport.getAttribute("aria-hidden")).toBe("true");

    act(() => summary.click());
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(viewport.getAttribute("aria-hidden")).toBe("false");

    act(() => summary.click());
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".test-disclosure")?.getAttribute("data-expanded")).toBe("false");
  });
});
