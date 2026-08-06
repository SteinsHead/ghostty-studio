import { describe, expect, it } from "vitest";
import { demoSchema } from "./demo";
import {
  isBackgroundSetting,
  supportsBackgroundImageEditor,
} from "./backgroundImageModel";
import type { RuntimeOption } from "./types";

function backgroundOptions(options: RuntimeOption[]) {
  return new Map(
    options
      .filter((option) => isBackgroundSetting(option.key))
      .map((option) => [option.key, option]),
  );
}

describe("background image editor compatibility", () => {
  it("accepts only the fully audited five-setting contract", () => {
    expect(supportsBackgroundImageEditor(backgroundOptions(demoSchema.options))).toBe(true);

    const changed = structuredClone(demoSchema.options);
    const position = changed.find((option) => option.key === "background-image-position")!;
    position.choices = position.choices.slice().reverse();
    expect(supportsBackgroundImageEditor(backgroundOptions(changed))).toBe(false);
  });

  it("fails closed when any child control becomes read-only", () => {
    const changed = structuredClone(demoSchema.options);
    const opacity = changed.find((option) => option.key === "background-image-opacity")!;
    opacity.capability.editMode = "none";
    opacity.capability.reason = "setting-changed";
    expect(supportsBackgroundImageEditor(backgroundOptions(changed))).toBe(false);
  });
});
