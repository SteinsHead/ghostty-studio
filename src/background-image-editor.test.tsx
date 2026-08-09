// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundImageEditor } from "./components/BackgroundImageEditor";
import { TerminalPreview } from "./components/TerminalPreview";
import type { BackgroundAssetSummary, RuntimeOption } from "./types";

function option(key: string, kind: RuntimeOption["kind"], choices: string[] = []): RuntimeOption {
  return {
    key,
    description: key,
    defaultValues: [key === "background-image-opacity" ? "1" : choices[0] ?? "false"],
    currentValues: [],
    category: "appearance",
    kind,
    choices,
    repeatable: false,
    platform: null,
    since: "1.2.0",
    risk: "normal",
    editable: true,
    capability: {
      editMode: "control",
      reason: null,
      activation: "reload",
      constraintBehavior: "reject",
      min: key === "background-image-opacity" ? 0 : null,
      max: null,
      step: key === "background-image-opacity" ? 0.01 : null,
      unit: key === "background-image-opacity" ? "percent" : null,
      platform: null,
    },
  };
}

const options = new Map([
  ["background-image-opacity", option("background-image-opacity", "number")],
  ["background-image-fit", option("background-image-fit", "select", ["contain", "cover", "stretch", "none"])],
  ["background-image-position", option("background-image-position", "select", ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"])],
  ["background-image-repeat", option("background-image-repeat", "boolean")],
]);

const assets: BackgroundAssetSummary[] = [
  {
    id: "a".repeat(64),
    displayName: "night sky.png",
    mediaType: "image/png",
    width: 2400,
    height: 1600,
    sizeBytes: 900_000,
    importedAtMs: 2,
    largeImageWarning: false,
    usage: { status: "available", references: [] },
  },
  {
    id: "b".repeat(64),
    displayName: "forest.jpg",
    mediaType: "image/jpeg",
    width: 3000,
    height: 2000,
    sizeBytes: 1_200_000,
    importedAtMs: 1,
    largeImageWarning: false,
    usage: { status: "available", references: [] },
  },
];

describe("background image editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps visibility above 100 percent and exposes every spatial choice", () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    act(() => root.render(
      <BackgroundImageEditor
        assets={assets}
        previewStates={{}}
        value={`managed-image:${assets[0].id}`}
        baselineValue=""
        effectiveValue=""
        values={{
          "background-image-opacity": "1.5",
          "background-image-fit": "cover",
          "background-image-position": "bottom-right",
          "background-image-repeat": "false",
        }}
        baselineValues={{
          "background-image-opacity": "1",
          "background-image-fit": "contain",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        effectiveValues={{
          "background-image-opacity": "1",
          "background-image-fit": "contain",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        options={options}
        disabled={false}
        desktop
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences={false}
        effectiveKnown
        effects={{
          "background-image": {
            status: "effective",
            sourceCandidateId: null,
            sourceLabel: null,
          },
        }}
        writableCandidateIds={[]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={onSelect}
        onDelete={() => undefined}
        onRemove={() => undefined}
        onInspectReferences={() => undefined}
        onChange={onChange}
      />,
    ));

    expect(container.querySelector<HTMLInputElement>('.background-control input[type="number"]')?.value).toBe("150");
    expect(container.querySelector<HTMLInputElement>('.background-control input[type="range"]')?.value).toBe("1.5");
    expect(container.querySelector<HTMLInputElement>('.background-control input[type="range"]')?.getAttribute("aria-valuetext")).toBe("150%");
    expect(container.querySelectorAll('.position-grid [role="radio"]')).toHaveLength(9);
    expect(container.querySelectorAll('.background-asset[role="radio"]')).toHaveLength(2);
    expect(container.textContent).not.toContain("/Users/");

    act(() => container.querySelectorAll<HTMLButtonElement>(".background-asset")[1].click());
    expect(onSelect).toHaveBeenCalledWith(assets[1].id);

    const libraryRadios = container.querySelectorAll<HTMLButtonElement>(".background-asset");
    act(() => libraryRadios[0].dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    })));
    expect(onSelect).toHaveBeenCalledWith(assets[1].id);

    const positionRadios = container.querySelectorAll<HTMLButtonElement>('.position-grid [role="radio"]');
    expect(positionRadios[8].tabIndex).toBe(0);
    act(() => positionRadios[8].dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
    })));
    expect(onChange).toHaveBeenCalledWith("background-image-position", "bottom-center");
  });

  it("shows a clean empty state without inert adjustment controls", () => {
    act(() => root.render(
      <BackgroundImageEditor
        assets={[]}
        previewStates={{}}
        value=""
        baselineValue=""
        effectiveValue=""
        values={{}}
        baselineValues={{}}
        effectiveValues={{}}
        options={options}
        disabled
        desktop={false}
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences={false}
        effectiveKnown
        effects={{}}
        writableCandidateIds={[]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onRemove={() => undefined}
        onInspectReferences={() => undefined}
        onChange={() => undefined}
      />,
    ));
    expect(container.textContent).toContain("尚未选择图片");
    expect(container.querySelector(".background-controls")).toBeNull();
  });

  it("keeps saved image preferences manageable while no image is active", () => {
    act(() => root.render(
      <BackgroundImageEditor
        assets={[]}
        previewStates={{}}
        value=""
        baselineValue=""
        effectiveValue=""
        values={{
          "background-image-opacity": "0.6",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        baselineValues={{
          "background-image-opacity": "0.6",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        effectiveValues={{
          "background-image-opacity": "0.6",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        options={options}
        disabled={false}
        desktop
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences
        effectiveKnown
        effects={{}}
        writableCandidateIds={[]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onRemove={() => undefined}
        onInspectReferences={() => undefined}
        onChange={() => undefined}
      />,
    ));
    expect(container.textContent).toContain("显示方式已保留");
    expect(container.querySelector(".background-controls")).not.toBeNull();
    expect(container.querySelector(".background-controls input:disabled")).toBeNull();
  });

  it("requests thumbnails in bounded pages instead of loading the whole library", async () => {
    const manyAssets = Array.from({ length: 13 }, (_, index): BackgroundAssetSummary => ({
      ...assets[0],
      id: index.toString(16).padStart(64, "0"),
      displayName: `image-${index}.png`,
      importedAtMs: 20 - index,
    }));
    const requestPreview = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <BackgroundImageEditor
          assets={manyAssets}
          previewStates={{}}
          value=""
          baselineValue=""
          effectiveValue=""
          values={{}}
          baselineValues={{}}
          effectiveValues={{}}
          options={options}
          disabled={false}
          desktop
          importing={false}
          deletingAssetId={null}
          feedback={null}
          showInactivePreferences={false}
          effectiveKnown
          effects={{}}
          writableCandidateIds={[]}
          onImport={() => undefined}
          onPreviewRequest={requestPreview}
          onSelect={() => undefined}
          onDelete={() => undefined}
          onRemove={() => undefined}
          onInspectReferences={() => undefined}
          onChange={() => undefined}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelectorAll(".background-asset")).toHaveLength(12);
    expect(requestPreview).toHaveBeenCalledTimes(12);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".background-library__more")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelectorAll(".background-asset")).toHaveLength(13);
    expect(requestPreview).toHaveBeenCalledTimes(13);
  });

  it("explains when the current file is overridden and moves the draft to its writable effective source", () => {
    const onUseEffectiveSource = vi.fn();
    const sourceId = "include-background";

    act(() => root.render(
      <BackgroundImageEditor
        assets={assets}
        previewStates={{}}
        value={`managed-image:${assets[0].id}`}
        baselineValue={`managed-image:${assets[0].id}`}
        effectiveValue={`managed-image:${assets[0].id}`}
        values={{
          "background-image-opacity": "1",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        baselineValues={{
          "background-image-opacity": "1",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        effectiveValues={{
          "background-image-opacity": "1",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        options={options}
        disabled={false}
        desktop
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences={false}
        effectiveKnown
        effects={{
          "background-image": {
            status: "overridden",
            sourceCandidateId: sourceId,
            sourceLabel: "background.conf",
          },
        }}
        writableCandidateIds={[sourceId]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onRemove={() => undefined}
        onInspectReferences={() => undefined}
        onChange={() => undefined}
        onUseEffectiveSource={onUseEffectiveSource}
      />,
    ));

    expect(container.textContent).toContain("当前文件不是最终来源");
    expect(container.textContent).toContain("最终配置");
    expect(container.textContent).not.toContain("正在使用");

    const moveButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("改存到 background.conf"));
    expect(moveButton).toBeDefined();
    act(() => moveButton!.click());
    expect(onUseEffectiveSource).toHaveBeenCalledOnce();
    expect(onUseEffectiveSource).toHaveBeenCalledWith(sourceId);
  });

  it("shows an inherited effective image and delegates turning it off to the caller", () => {
    const onRemove = vi.fn();
    const inheritedValue = `managed-image:${assets[1].id}`;

    act(() => root.render(
      <BackgroundImageEditor
        assets={assets}
        previewStates={{}}
        value=""
        baselineValue=""
        effectiveValue={inheritedValue}
        values={{}}
        baselineValues={{}}
        effectiveValues={{
          "background-image-opacity": "0.7",
          "background-image-fit": "cover",
          "background-image-position": "center",
          "background-image-repeat": "false",
        }}
        options={options}
        disabled={false}
        desktop
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences={false}
        effectiveKnown
        effects={{
          "background-image": {
            status: "inherited",
            sourceCandidateId: "xdg-root",
            sourceLabel: "XDG · config",
          },
        }}
        writableCandidateIds={[]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onRemove={onRemove}
        onInspectReferences={() => undefined}
        onChange={() => undefined}
      />,
    ));

    expect(container.textContent).toContain("forest.jpg");
    expect(container.textContent).toContain("当前效果继承自其他配置");
    expect(container.textContent).toContain("当前背景来自 XDG · config");
    expect(container.querySelectorAll<HTMLButtonElement>(".background-asset[aria-checked='true']")).toHaveLength(1);

    const turnOffButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("关闭背景图片"));
    expect(turnOffButton).toBeDefined();
    act(() => turnOffButton!.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("shows cross-config usage before deletion and opens write locations instead of failing", () => {
    const onDelete = vi.fn();
    const onInspectReferences = vi.fn();
    const referencedAsset: BackgroundAssetSummary = {
      ...assets[0],
      usage: {
        status: "referenced",
        references: [{
          candidateId: "macos-root",
          sourceLabel: "macOS · config",
          writable: true,
        }],
      },
    };

    act(() => root.render(
      <BackgroundImageEditor
        assets={[referencedAsset]}
        previewStates={{
          [referencedAsset.id]: { status: "ready", dataUrl: "data:image/png;base64,AAAA" },
        }}
        value="external-image"
        baselineValue="external-image"
        effectiveValue="external-image"
        values={{}}
        baselineValues={{}}
        effectiveValues={{}}
        options={options}
        disabled={false}
        desktop
        importing={false}
        deletingAssetId={null}
        feedback={null}
        showInactivePreferences={false}
        effectiveKnown
        effects={{}}
        writableCandidateIds={["macos-root"]}
        onImport={() => undefined}
        onPreviewRequest={async () => undefined}
        onSelect={() => undefined}
        onDelete={onDelete}
        onRemove={() => undefined}
        onInspectReferences={onInspectReferences}
        onChange={() => undefined}
      />,
    ));

    expect(container.textContent).toContain("被 macOS · config 使用");
    const remove = container.querySelector<HTMLButtonElement>(".background-asset__delete")!;
    expect(remove.disabled).toBe(true);
    act(() => remove.click());
    expect(onDelete).not.toHaveBeenCalled();
    const inspect = container.querySelector<HTMLButtonElement>(".background-asset__references")!;
    act(() => inspect.click());
    expect(onInspectReferences).toHaveBeenCalledOnce();
  });

  it("multiplies image visibility by the overall background opacity", () => {
    act(() => root.render(
      <TerminalPreview
        values={{
          background: "1e1e2e",
          foreground: "cdd6f4",
          "background-opacity": "0.5",
          "background-image-opacity": "1.5",
          "background-image-fit": "cover",
          "background-image-position": "bottom-right",
          "background-image-repeat": "true",
        }}
        backgroundImage={{ dataUrl: "data:image/png;base64,AAAA" }}
      />,
    ));
    const layer = container.querySelector<HTMLElement>(".terminal-background-image");
    expect(layer?.style.opacity).toBe("0.75");
    expect(layer?.style.backgroundSize).toBe("cover");
    expect(layer?.style.backgroundPosition).toBe("right bottom");
    expect(layer?.style.backgroundRepeat).toBe("repeat");
  });
});
