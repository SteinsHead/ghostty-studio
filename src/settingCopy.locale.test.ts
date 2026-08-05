import { describe, expect, it } from "vitest";
import {
  localizedSettingKeys,
  copyForSetting,
  resolveSettingCopyLocale,
  SETTING_COPY_LOCALES,
} from "./settingCopy";

describe("localized setting copy", () => {
  it("provides a stable locale contract", () => {
    expect(SETTING_COPY_LOCALES).toEqual(["zh-CN", "en"]);
    expect(resolveSettingCopyLocale("zh-CN")).toBe("zh-CN");
    expect(resolveSettingCopyLocale("en-US")).toBe("en");
    expect(resolveSettingCopyLocale("en-GB")).toBe("en");
    expect(resolveSettingCopyLocale("fr")).toBe("zh-CN");
  });

  it("supports locale-first calls without breaking the original key-first API", () => {
    const official = "Font size in points. It can be fractional.";
    expect(copyForSetting("font-size", official).label).toBe("字号");
    expect(copyForSetting("en", "font-size", official)).toMatchObject({
      label: "Font size",
      summary: "Set the terminal font size in points, including fractional sizes.",
    });
    expect(copyForSetting("font-size", official, "en").label).toBe("Font size");
  });

  it("covers the complete Ghostty 1.3.1 catalog plus one compatibility key", () => {
    expect(localizedSettingKeys).toHaveLength(201);
    expect(new Set(localizedSettingKeys).size).toBe(localizedSettingKeys.length);
    expect(localizedSettingKeys).toEqual(expect.arrayContaining([
      "background-opacity",
      "font-size",
      "cursor-style",
      "font-family",
      "keybind",
      "command",
      "macos-titlebar-style",
      "gtk-titlebar-style",
      "linux-cgroup",
      "x11-instance-name",
      "background-blur-radius",
    ]));
  });

  it("keeps every catalog label and summary concise in both locales", () => {
    for (const key of localizedSettingKeys) {
      for (const locale of SETTING_COPY_LOCALES) {
        const copy = copyForSetting(locale, key, "Official source text.");
        expect(copy.label.trim(), `${locale}:${key}:label`).not.toBe("");
        expect(copy.summary?.trim(), `${locale}:${key}:summary`).not.toBe("");
        expect(copy.summary!.length, `${locale}:${key}:summary length`).toBeLessThanOrEqual(180);
      }
    }
  });

  it("keeps only a bounded official excerpt as supporting detail", () => {
    const longOfficial = `${"A detailed official sentence with factual context. ".repeat(20)}End.`;
    const copy = copyForSetting("en", "background", longOfficial);

    expect(copy.detail).not.toBeNull();
    expect(copy.detail!.length).toBeLessThanOrEqual(360);
    expect(copy.detail).toContain("official sentence");
  });
});
