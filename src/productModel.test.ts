import { describe, expect, it } from "vitest";
import { demoEnvironment, demoSchema } from "./demo";
import {
  COMPATIBILITY_STORAGE_KEY,
  compareCompatibility,
  createCompatibilitySnapshot,
  deriveWorkspaceSummary,
  loadCompatibilitySnapshot,
  saveCompatibilitySnapshot,
} from "./productModel";
import type { CompatibilitySnapshot } from "./productModel";
import type { ConfigSession } from "./types";

const session: ConfigSession = {
  id: "session",
  candidateId: demoEnvironment.candidates[0].id,
  path: demoEnvironment.candidates[0].path,
  revision: "revision",
  readOnly: false,
  values: {},
  configuredSettings: [],
  unrecognizedSettingCount: 0,
  diagnostics: [],
};

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => key === COMPATIBILITY_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === COMPATIBILITY_STORAGE_KEY) value = next;
    },
    value: () => value,
  };
}

describe("workspace product model", () => {
  it("turns the browser fixture into an explicit demo journey", () => {
    const summary = deriveWorkspaceSummary(
      demoEnvironment,
      demoSchema,
      { ...session, readOnly: true },
      null,
      false,
    );

    expect(summary.state).toBe("demo");
    expect(summary.editableOptionCount).toBeGreaterThan(0);
    expect(summary.protectedOptionCount).toBeGreaterThan(0);
  });

  it("reports a ready desktop workspace only when Ghostty and a writable session exist", () => {
    const summary = deriveWorkspaceSummary(
      { ...demoEnvironment, warnings: [] },
      { ...demoSchema, diagnostics: [] },
      session,
      {
        complete: true,
        semanticsKnown: true,
        nodes: [],
        edges: [],
        provenance: [],
        diagnostics: [],
        totalBytes: 0,
      },
      true,
    );

    expect(summary.state).toBe("ready");
    expect(summary.title).toBe("工作区准备就绪");
  });

  it("fails closed when Ghostty is unavailable", () => {
    const summary = deriveWorkspaceSummary(
      { ...demoEnvironment, ghostty: { ...demoEnvironment.ghostty, available: false } },
      demoSchema,
      session,
      null,
      true,
    );

    expect(summary.state).toBe("blocked");
  });
});

describe("compatibility snapshots", () => {
  it("reports added and removed keys across a schema change", () => {
    const current = createCompatibilitySnapshot(demoSchema);
    const previous: CompatibilitySnapshot = {
      version: 1,
      ghosttyVersion: "1.2.0",
      schemaHash: "older",
      optionKeys: [current.optionKeys[0], "removed-setting"],
      optionFingerprints: {
        [current.optionKeys[0]]: current.optionFingerprints[current.optionKeys[0]],
        "removed-setting": "00000000",
      },
    };

    const change = compareCompatibility(previous, current);
    expect(change?.removedKeys).toEqual(["removed-setting"]);
    expect(change?.addedKeys.length).toBe(current.optionKeys.length - 1);
    expect(change?.changedKeys).toEqual([]);
    expect(change?.previousVersion).toBe("1.2.0");
  });

  it("detects an editor contract change even when a setting key remains", () => {
    const current = createCompatibilitySnapshot(demoSchema);
    const previous: CompatibilitySnapshot = structuredClone(current);
    previous.schemaHash = "older";
    previous.optionFingerprints["font-size"] = "00000000";

    expect(compareCompatibility(previous, current)?.changedKeys).toContain("font-size");
  });

  it("round-trips only bounded, validated metadata", () => {
    const storage = memoryStorage();
    const snapshot = createCompatibilitySnapshot(demoSchema);
    expect(saveCompatibilitySnapshot(storage, snapshot)).toBe(true);
    expect(loadCompatibilitySnapshot(storage)).toEqual(snapshot);

    const corruptStorage = memoryStorage('{"version":1,"schemaHash":"x","optionKeys":"nope"}');
    expect(loadCompatibilitySnapshot(corruptStorage)).toBeNull();
  });
});
