// @ts-expect-error Vitest executes this contract test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("runtime baseline contract", () => {
  it("keeps the resolved Tauri API and Rust core on the same major/minor release", () => {
    const apiManifest = JSON.parse(rootFile("node_modules/@tauri-apps/api/package.json")) as {
      version: string;
    };
    const cargoLock = rootFile("src-tauri/Cargo.lock");
    const rustVersions = [...cargoLock.matchAll(/^name = "tauri"\r?\nversion = "([^"]+)"$/gm)];

    // Core/API patches may differ; internal crates and plugins have separate release lines.
    expect(rustVersions).toHaveLength(1);
    const rustVersion = rustVersions[0]![1]!;
    expect(apiManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rustVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      apiManifest.version.split(".").slice(0, 2),
      `Update @tauri-apps/api and the locked tauri crate together (${apiManifest.version} / ${rustVersion})`,
    ).toEqual(rustVersion.split(".").slice(0, 2));
  });

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
