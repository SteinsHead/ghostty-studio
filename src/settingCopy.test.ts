import { describe, expect, it } from "vitest";
import { copyForSetting } from "./settingCopy";

describe("setting copy", () => {
  it("uses concise Chinese summaries for supported settings", () => {
    const copy = copyForSetting(
      "background-opacity",
      "The opacity level of the background. A value of 1 is fully opaque.",
    );

    expect(copy.summary).toBe("背景不透明度：0 为完全透明，1 为完全不透明。");
    expect(copy.detail).toContain("The opacity level");
  });

  it("does not repeat localized demo copy as Ghostty source text", () => {
    const copy = copyForSetting("background", "终端背景色。");

    expect(copy.summary).toBe("终端背景色。");
    expect(copy.detail).toBeNull();
  });

  it("keeps a short official description when no translation exists", () => {
    expect(copyForSetting("future-setting", "A short description.")).toEqual({
      summary: "A short description.",
      detail: null,
    });
  });

  it("collapses long official documentation behind its first sentence", () => {
    const copy = copyForSetting(
      "future-setting",
      "The first sentence explains the setting. The rest contains detailed edge cases and platform notes.",
    );

    expect(copy.summary).toBe("The first sentence explains the setting.");
    expect(copy.detail).toContain("platform notes");
  });

  it("does not invent copy for undocumented settings", () => {
    expect(copyForSetting("future-setting", "   ")).toEqual({
      summary: null,
      detail: null,
    });
  });
});
