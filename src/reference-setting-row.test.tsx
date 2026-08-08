// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReferenceSettingRow } from "./components/ReferenceSettingRow";
import { demoSchema } from "./demo";

const background = demoSchema.options.find((option) => option.key === "background")!;

describe("reference setting states", () => {
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

  it("turns duplicate assignments into an explained reference row", () => {
    act(() => root.render(
      <ReferenceSettingRow
        option={background}
        configured={{ key: background.key, occurrenceCount: 2, valueExposure: "available" }}
        onAdjust={() => undefined}
      />,
    ));

    expect(container.textContent).toContain("多处设置");
    expect(container.textContent).toContain("这份文件中出现了 2 次");
    expect(container.textContent).toContain("请在配置文件中合并或编辑这些值");
    expect(container.querySelector(".reference-setting-row__state button")).toBeNull();
  });

  it("does not offer an adjustment action for a read-only workspace", () => {
    act(() => root.render(
      <ReferenceSettingRow
        option={background}
        configured={{ key: background.key, occurrenceCount: 1, valueExposure: "available" }}
        readOnly
        onAdjust={() => undefined}
      />,
    ));

    expect(container.textContent).toContain("配置只读");
    expect(container.textContent).toContain("选择可写配置后即可调整");
    expect(container.querySelector(".reference-setting-row__state button")).toBeNull();
  });
});
