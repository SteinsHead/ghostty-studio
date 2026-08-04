import { describe, expect, it } from "vitest";
import { demoEnvironment, demoSchema } from "./demo";
import {
  chooseStartupCandidate,
  chooseWorkspaceCandidate,
  isCommonSetting,
} from "./workspaceModel";

describe("workspace journey model", () => {
  it("opens a single existing configuration without adding a setup step", () => {
    const candidate = demoEnvironment.candidates[0];
    expect(chooseStartupCandidate([candidate], null)?.id).toBe(candidate.id);
  });

  it("asks once when several configuration files exist", () => {
    expect(chooseStartupCandidate(demoEnvironment.candidates, null)).toBeNull();
    expect(
      chooseStartupCandidate(demoEnvironment.candidates, demoEnvironment.candidates[1].id)?.id,
    ).toBe(demoEnvironment.candidates[1].id);
  });

  it("does not silently fall back when a remembered source disappears", () => {
    expect(chooseStartupCandidate(demoEnvironment.candidates, "stale-source")).toBeNull();
  });

  it("never moves a refreshed workspace to another write target", () => {
    const [active, fallback] = demoEnvironment.candidates;
    expect(
      chooseWorkspaceCandidate([fallback], active.id, fallback.id),
    ).toBeNull();
    expect(
      chooseWorkspaceCandidate(demoEnvironment.candidates, active.id, fallback.id)?.id,
    ).toBe(active.id);
  });

  it("keeps the common destination limited to settings with a finished editor", () => {
    const theme = demoSchema.options.find((option) => option.key === "theme")!;
    const opacity = demoSchema.options.find((option) => option.key === "background-opacity")!;
    expect(isCommonSetting(theme)).toBe(false);
    expect(isCommonSetting(opacity)).toBe(true);
  });
});
