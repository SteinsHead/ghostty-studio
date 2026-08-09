// @ts-expect-error Vitest executes this contract test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/release-candidate.yml", import.meta.url),
  "utf8",
);

function indentedBlock(source: string, header: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === header);
  expect(start, `missing workflow block: ${header.trim()}`).toBeGreaterThanOrEqual(0);

  const indentation = header.length - header.trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && line.length - line.trimStart().length <= indentation) break;
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

describe("release candidate workflow contract", () => {
  it("accepts only a version input and never sends an input ref to checkout", () => {
    const dispatch = indentedBlock(workflow, "  workflow_dispatch:");
    const inputs = indentedBlock(dispatch, "    inputs:");
    const inputNames = [...inputs.matchAll(/^ {6}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/gm)].map(
      ([, name]) => name,
    );

    expect(inputNames).toEqual(["version"]);
    expect(workflow).not.toContain("inputs.ref");

    const checkoutSteps = workflow.match(/^ {6}- uses: actions\/checkout@.*$/gm) ?? [];
    expect(checkoutSteps).toHaveLength(1);
    const checkout = indentedBlock(workflow, checkoutSteps[0]);
    expect(checkout).toContain("persist-credentials: false");
    expect(checkout).not.toMatch(/^\s+ref:/m);
  });

  it("fails closed unless the dispatch ref is protected main", () => {
    const protectedSource = indentedBlock(workflow, "  protected-source:");

    expect(protectedSource).toContain("SOURCE_REF: ${{ github.ref }}");
    expect(protectedSource).toContain('if [[ "$SOURCE_REF" != "refs/heads/main" ]]; then');
    expect(protectedSource).toMatch(/if \[\[ "\$SOURCE_REF" != "refs\/heads\/main" \]\]; then[\s\S]*?\n\s+exit 1/);
  });

  it("keeps packaging behind the protected-source gate with read-only access", () => {
    const permissions = indentedBlock(workflow, "permissions:");
    const macosJob = indentedBlock(workflow, "  macos-arm64:");

    expect(permissions.trim()).toBe("permissions:\n  contents: read");
    expect(macosJob).toMatch(/^ {4}needs: protected-source$/m);
    expect(macosJob).toContain('if [[ "$checked_out_sha" != "$GITHUB_SHA" ]]; then');
  });
});
