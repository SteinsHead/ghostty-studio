// @ts-expect-error Vitest executes this contract test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("runtime baseline contract", () => {
  it("keeps the declared Node floor aligned with the pinned version", () => {
    const pinnedVersion = rootFile(".node-version").trim();
    const packageManifest = JSON.parse(rootFile("package.json")) as {
      engines: { node: string };
    };

    expect(packageManifest.engines.node).toBe(`>=${pinnedVersion} <23`);
  });

  it("makes every Node-based workflow consume the pinned version", () => {
    for (const workflow of ["ci.yml", "pages.yml", "release-candidate.yml"]) {
      const source = rootFile(`.github/workflows/${workflow}`);
      expect(source, workflow).toContain("node-version-file: .node-version");
    }
  });
});
