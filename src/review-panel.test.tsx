// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESET_BACKGROUND_TOKEN } from "./backgroundImageModel";
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
  effect: {
    status: "effective",
    affectedKeys: [],
    suggestedCandidateId: null,
    suggestedLabel: null,
  },
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

  it("describes an explicit background reset as turning the image off", () => {
    const resetPreview: ChangePreview = {
      ...preview,
      changes: [{
        key: "background-image",
        before: [`managed-image:${"a".repeat(64)}`],
        after: [RESET_BACKGROUND_TOKEN],
      }],
    };

    act(() => root.render(
      <ReviewPanel
        changes={[]}
        preview={resetPreview}
        loading={false}
        readOnly={false}
        backgroundAssetNames={{ ["a".repeat(64)]: "night sky.png" }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    ));

    const row = container.querySelector<HTMLElement>(".review-change");
    expect(row?.textContent).toContain("night sky.png");
    expect(row?.textContent).toContain("关闭背景图片");
    expect(row?.textContent).not.toContain(RESET_BACKGROUND_TOKEN);
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

  it("blocks an overridden destination and lets the user move the draft to the effective source", () => {
    const onApply = vi.fn();
    const onUseSuggestedSource = vi.fn();
    const overriddenPreview: ChangePreview = {
      ...preview,
      changes: preview.changes.filter((change) => change.after.length > 0),
      effect: {
        status: "overridden",
        affectedKeys: ["background-image", "background-image-opacity"],
        suggestedCandidateId: "include-background",
        suggestedLabel: "background.conf",
      },
    };

    act(() => root.render(
      <ReviewPanel
        changes={overriddenPreview.changes}
        preview={overriddenPreview}
        loading={false}
        readOnly={false}
        onClose={() => undefined}
        onApply={onApply}
        onUseSuggestedSource={onUseSuggestedSource}
      />,
    ));

    expect(container.textContent).toContain("当前保存位置会被后续配置覆盖");
    expect(container.textContent).toContain("2 项修改不会进入 Ghostty 的最终配置");

    const footerButtons = [...container.querySelectorAll<HTMLButtonElement>(".review-footer button")];
    const moveButton = footerButtons.find((button) => button.textContent?.includes("改存到 background.conf"));
    const saveButton = footerButtons.find((button) => button.textContent?.trim() === "保存");

    expect(moveButton).toBeDefined();
    expect(saveButton?.disabled).toBe(true);
    act(() => moveButton!.click());
    expect(onUseSuggestedSource).toHaveBeenCalledOnce();
    expect(onUseSuggestedSource).toHaveBeenCalledWith("include-background");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not move a file-bound removal to another source", () => {
    const onUseSuggestedSource = vi.fn();
    const overriddenPreview: ChangePreview = {
      ...preview,
      changes: [{ key: "font-family", before: ["JetBrains Mono"], after: [] }],
      effect: {
        status: "overridden",
        affectedKeys: ["font-family"],
        suggestedCandidateId: "include-fonts",
        suggestedLabel: "fonts.conf",
      },
    };

    act(() => root.render(
      <ReviewPanel
        changes={overriddenPreview.changes}
        preview={overriddenPreview}
        loading={false}
        readOnly={false}
        onClose={() => undefined}
        onApply={() => undefined}
        onUseSuggestedSource={onUseSuggestedSource}
      />,
    ));

    expect(container.textContent).toContain("仅针对当前文件的删除操作");
    expect(container.textContent).toContain("打开 fonts.conf 后重新修改");
    expect(container.textContent).not.toContain("改存到 fonts.conf");
    expect(onUseSuggestedSource).not.toHaveBeenCalled();
  });

  it("still allows an explicit background reset to move to the effective source", () => {
    const onUseSuggestedSource = vi.fn();
    const overriddenPreview: ChangePreview = {
      ...preview,
      changes: [{
        key: "background-image",
        before: [`managed-image:${"a".repeat(64)}`],
        after: [RESET_BACKGROUND_TOKEN],
      }],
      effect: {
        status: "overridden",
        affectedKeys: ["background-image"],
        suggestedCandidateId: "include-background",
        suggestedLabel: "background.conf",
      },
    };

    act(() => root.render(
      <ReviewPanel
        changes={overriddenPreview.changes}
        preview={overriddenPreview}
        loading={false}
        readOnly={false}
        onClose={() => undefined}
        onApply={() => undefined}
        onUseSuggestedSource={onUseSuggestedSource}
      />,
    ));

    const moveButton = [...container.querySelectorAll<HTMLButtonElement>(".review-footer button")]
      .find((button) => button.textContent?.includes("改存到 background.conf"));
    expect(moveButton).toBeDefined();
    act(() => moveButton!.click());
    expect(onUseSuggestedSource).toHaveBeenCalledWith("include-background");
  });
});
