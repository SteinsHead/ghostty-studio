// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingControl } from "./components/SettingControl";
import { SettingRow } from "./components/SettingRow";
import { TerminalPreview } from "./components/TerminalPreview";
import { compositePreviewBackground } from "./previewColor";
import type { RuntimeOption } from "./types";

const opacityOption: RuntimeOption = {
  key: "background-opacity",
  description: "Terminal background opacity",
  defaultValues: ["1"],
  currentValues: [],
  category: "高级",
  kind: "number",
  choices: [],
  repeatable: false,
  platform: null,
  since: null,
  risk: "normal",
  editable: true,
  capability: {
    editMode: "control",
    reason: null,
    activation: "restart",
    constraintBehavior: "clamp",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "percent",
    platform: null,
  },
};

function optionWithKey(key: string): RuntimeOption {
  if (key === "font-size") {
    return {
      ...opacityOption,
      key,
      capability: {
        ...opacityOption.capability,
        activation: "reload",
        constraintBehavior: "reject",
        min: 1,
        max: 255,
        step: 0.5,
        unit: "pt",
      },
    };
  }
  return {
    ...opacityOption,
    key,
    capability: {
      ...opacityOption.capability,
      min: key === "unfocused-split-opacity" ? 0.15 : 0,
    },
  };
}

function SliderHarness({ onInput }: { onInput(value: string): void }) {
  const [value, setValue] = useState("1");
  return (
    <>
      <SettingRow
        option={opacityOption}
        value={value}
        baselineValue="1"
        configuredInEditingLayer={false}
        sourceLabel="测试配置层"
        onValueChange={(_key, nextValue) => {
          onInput(nextValue);
          setValue(nextValue);
        }}
        onReset={(_key, nextValue) => setValue(nextValue)}
      />
      <TerminalPreview
        values={{
          background: "1e1e2e",
          foreground: "cdd6f4",
          "background-opacity": value,
        }}
      />
    </>
  );
}

describe("opacity preview stability", () => {
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

  it("pre-composites every boundary value into an opaque RGB color", () => {
    expect(compositePreviewBackground("#1e1e2e", 0)).toBe("rgb(17, 19, 24)");
    expect(compositePreviewBackground("#1e1e2e", 0.9)).toBe("rgb(29, 29, 44)");
    expect(compositePreviewBackground("#1e1e2e", 1)).toBe("rgb(30, 30, 46)");
    expect(compositePreviewBackground("#ff000080", 0.5, "#000000")).toBe("rgb(64, 0, 0)");

    for (const opacity of [-1, 0, 0.9, 0.99, 1, 2, Number.NaN]) {
      const result = compositePreviewBackground("#1e1e2e", opacity);
      expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(result).not.toContain("rgba");
      expect(result).not.toContain("transparent");
    }
  });

  it("keeps slider geometry nodes mounted while crossing the baseline", () => {
    const onInput = vi.fn();
    act(() => root.render(<SliderHarness onInput={onInput} />));

    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    const settingInput = container.querySelector<HTMLElement>(".setting-input");
    const reset = container.querySelector<HTMLButtonElement>(".inline-reset");
    const screen = container.querySelector<HTMLElement>(".terminal-screen");
    const firstLine = screen?.firstElementChild;
    expect(range && number && settingInput && reset && screen && firstLine).toBeTruthy();

    const rangeNode = range!;
    const resetNode = reset!;
    const screenNode = screen!;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(nativeValueSetter).toBeTypeOf("function");
    expect(settingInput!.children).toHaveLength(2);
    expect(resetNode.classList.contains("inline-reset--placeholder")).toBe(true);

    const values = ["0.9", "0.91", "0.92", "0.93", "0.94", "0.95", "0.96", "0.97", "0.98", "0.99", "1"];
    for (const value of values) {
      act(() => {
        nativeValueSetter!.call(rangeNode, value);
        rangeNode.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(rangeNode.value).toBe(value);
      expect(Number.parseFloat(rangeNode.style.getPropertyValue("--range-progress")))
        .toBeCloseTo(Number(value) * 100);
      expect(number!.value).toBe(String(Math.round(Number(value) * 100)));
      expect(container.querySelector(".terminal-screen")).toBe(screenNode);
      expect(screenNode.firstElementChild).toBe(firstLine);
      expect(screenNode.style.backgroundColor).toMatch(/^rgb\(/);
      expect(screenNode.style.backgroundColor).not.toContain("rgba");
      expect(settingInput!.children).toHaveLength(2);
      expect(container.querySelector(".inline-reset")).toBe(resetNode);
      expect(resetNode.classList.contains("inline-reset--placeholder")).toBe(value === "1");
    }

    expect(onInput).toHaveBeenCalledTimes(values.length);
  });

  it.each([
    ["background-opacity", "0", "0"],
    ["cursor-opacity", "0", "0"],
    ["unfocused-split-opacity", "0.15", "15"],
  ])("keeps %s controls on its audited scale", (key, rangeMin, numberMin) => {
    act(() => root.render(
      <SettingControl option={optionWithKey(key)} value="0.9" onChange={() => undefined} />,
    ));

    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(range?.min).toBe(rangeMin);
    expect(range?.max).toBe("1");
    expect(range?.step).toBe("0.01");
    expect(number?.min).toBe(numberMin);
    expect(number?.max).toBe("100");
    expect(number?.step).toBe("1");
  });

  it("shows a human percentage while keeping Ghostty's 0-1 value contract", () => {
    const onChange = vi.fn();
    act(() => root.render(
      <SettingControl option={opacityOption} value="0.9" onChange={onChange} />,
    ));

    const number = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(number.value).toBe("90");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(number, "88");
      number.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("0.88");
  });

  it("does not add a range to ordinary numeric controls", () => {
    act(() => root.render(
      <SettingControl option={optionWithKey("font-size")} value="14" onChange={() => undefined} />,
    ));

    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.querySelector(".number-control--compact")).not.toBeNull();
    expect(container.querySelector(".number-value-field")?.textContent).toContain("pt");
  });

  it("marks an assignment for removal instead of writing an empty value", () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <SettingRow
        option={opacityOption}
        value="0.9"
        baselineValue="0.9"
        configuredInEditingLayer
        sourceLabel="测试配置层"
        onValueChange={onValueChange}
        onReset={() => undefined}
      />,
    ));

    act(() => container.querySelector<HTMLButtonElement>(".setting-unset")!.click());
    expect(onValueChange).toHaveBeenCalledWith("background-opacity", "");
  });
});
