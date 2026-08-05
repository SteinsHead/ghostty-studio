// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, textForLocale, useI18n } from "./i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const { locale, preference, setPreference, text } = useI18n();
  const [draft, setDraft] = useState("unchanged");
  return (
    <div>
      <output data-testid="locale">{locale}</output>
      <output data-testid="preference">{preference}</output>
      <output data-testid="copy">{text("设置", "Settings")}</output>
      <output data-testid="draft">{draft}</output>
      <button type="button" onClick={() => setDraft("edited")}>edit</button>
      <button type="button" onClick={() => setPreference("zh-CN")}>zh</button>
      <button type="button" onClick={() => setPreference("en")}>en</button>
      <button type="button" onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

describe("interface language", () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    host = document.createElement("div");
    document.body.append(host);
    root = null;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    window.localStorage.clear();
  });

  it("follows the system until the user chooses a language", () => {
    act(() => {
      root = createRoot(host);
      root.render(<I18nProvider><Harness /></I18nProvider>);
    });

    expect(host.querySelector('[data-testid="copy"]')?.textContent).toBe("Settings");
    expect(document.documentElement.lang).toBe("en");

    const buttons = host.querySelectorAll("button");
    act(() => buttons[0].click());
    act(() => buttons[1].click());

    expect(host.querySelector('[data-testid="copy"]')?.textContent).toBe("设置");
    expect(host.querySelector('[data-testid="draft"]')?.textContent).toBe("edited");
    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(window.localStorage.getItem("ghostty-studio.language.v1")).toBe("zh-CN");
  });

  it("restores an explicit preference instead of overriding it with the system", () => {
    window.localStorage.setItem("ghostty-studio.language.v1", "zh-CN");
    act(() => {
      root = createRoot(host);
      root.render(<I18nProvider><Harness /></I18nProvider>);
    });

    expect(host.querySelector('[data-testid="preference"]')?.textContent).toBe("zh-CN");
    expect(host.querySelector('[data-testid="copy"]')?.textContent).toBe("设置");
  });

  it("interpolates values without changing unknown placeholders", () => {
    expect(textForLocale("en", "{count} 项", "{count} results · {missing}", { count: 2 }))
      .toBe("2 results · {missing}");
  });
});
