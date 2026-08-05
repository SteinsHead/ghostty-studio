// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPanel } from "./components/ReviewPanel";
import type { ChangePreview } from "./types";

const preview: ChangePreview = {
  token: "preview-token",
  revision: "revision-2",
  valid: true,
  activation: "restart",
  diagnostics: [],
  unifiedDiff: "@@ -1,2 +1,2 @@\n-background-opacity = 0.9\n+background-opacity = 1",
  changes: [
    { key: "background-opacity", before: ["0.9"], after: ["1"] },
    { key: "font-size", before: ["13"], after: ["14"] },
    { key: "cursor-style-blink", before: ["false"], after: ["true"] },
    { key: "foreground", before: ["cdd6f4"], after: ["89b4fa"] },
    { key: "font-family", before: ["JetBrains Mono"], after: [] },
  ],
};

describe("save review copy", () => {
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

  it("uses the validated preview as the authoritative, human-readable change list", () => {
    act(() => root.render(
      <ReviewPanel
        changes={[{ key: "theme", before: ["Old theme"], after: ["Decoy theme"] }]}
        preview={preview}
        loading={false}
        readOnly={false}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    ));

    expect(container.querySelector(".review-header p")?.textContent).toContain("5 项修改");
    const rows = [...container.querySelectorAll<HTMLElement>(".review-change")]
      .map((row) => row.textContent ?? "");

    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("背景不透明度");
    expect(rows[0]).toContain("90%");
    expect(rows[0]).toContain("100%");
    expect(rows[1]).toContain("字号");
    expect(rows[1]).toContain("13 pt");
    expect(rows[1]).toContain("14 pt");
    expect(rows[2]).toContain("光标闪烁");
    expect(rows[2]).toContain("关闭");
    expect(rows[2]).toContain("开启");
    expect(rows[3]).toContain("文字颜色");
    expect(rows[3]).toContain("#CDD6F4");
    expect(rows[3]).toContain("#89B4FA");
    expect(rows[4]).toContain("字体");
    expect(rows[4]).toContain("JetBrains Mono");
    expect(rows[4]).toContain("从当前文件移除");
    expect(container.textContent).not.toContain("Decoy theme");
  });

  it("keeps the raw unified diff available but collapsed by default", () => {
    act(() => root.render(
      <ReviewPanel
        changes={[]}
        preview={preview}
        loading={false}
        readOnly={false}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    ));

    const rawDiff = container.querySelector<HTMLDetailsElement>("details.raw-diff");
    expect(rawDiff).not.toBeNull();
    expect(rawDiff?.open).toBe(false);
    expect(rawDiff?.querySelector("summary")?.textContent).toContain("查看配置文本变化");
    expect(rawDiff?.querySelector("pre")?.textContent).toBe(preview.unifiedDiff);
  });

  it("presents browser preview as a review, not a disabled save flow", () => {
    act(() => root.render(
      <ReviewPanel
        changes={preview.changes}
        preview={preview}
        loading={false}
        readOnly
        previewOnly
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    ));

    expect(container.querySelector("h2")?.textContent).toBe("查看这些更改");
    expect(container.textContent).toContain("更改已准备好");
    expect(container.textContent).toContain("返回编辑");
    expect(container.textContent).not.toContain("当前配置为只读");
    expect(container.querySelector<HTMLButtonElement>(".review-footer .button--primary")).toBeNull();
  });
});
