import { describe, expect, it } from "vitest";
import { demoEnvironment, demoSchema } from "./demo";

describe("browser demo fixture", () => {
  it("has unique option keys and a value for every control", () => {
    const keys = demoSchema.options.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of demoSchema.options) {
      expect(option.currentValues[0] ?? option.defaultValues[0]).toBeDefined();
    }
  });

  it("cannot accidentally become a writable local-file backend", () => {
    expect(demoEnvironment.candidates.length).toBeGreaterThan(0);
    expect(demoEnvironment.candidates.every((candidate) => candidate.path.startsWith("~"))).toBe(true);
  });
});
