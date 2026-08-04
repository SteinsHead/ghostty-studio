// @ts-expect-error Vitest executes this regression test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function rule(header: string): string {
  const start = css.indexOf(`${header} {`);
  expect(start, `missing CSS rule: ${header}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  expect(end, `unterminated CSS rule: ${header}`).toBeGreaterThan(start);
  return css.slice(start, end + 1);
}

function expectDeclaration(block: string, property: string, value: string) {
  expect(block).toMatch(new RegExp(`${property}\\s*:\\s*${value.replace(/[()]/g, "\\$&")}\\s*;`));
}

describe("layout scroll contract", () => {
  it("keeps the desktop grid inside the viewport", () => {
    const shell = rule(".app-shell");
    expectDeclaration(shell, "grid-template-rows", "minmax(0, 1fr)");
    expectDeclaration(shell, "min-height", "0");
    expectDeclaration(shell, "overflow", "hidden");

    for (const selector of [".sidebar", ".workspace", ".content-grid"]) {
      const block = rule(selector);
      expectDeclaration(block, "min-height", "0");
      expectDeclaration(block, "overflow", "hidden");
    }
  });

  it("keeps scrolling on bounded inner panes", () => {
    const panes = rule(".settings-pane,\n.preview-pane");
    expectDeclaration(panes, "min-height", "0");
    expectDeclaration(panes, "overflow-x", "hidden");
    expectDeclaration(panes, "overflow-y", "auto");

    const reviewBody = rule(".review-body");
    expectDeclaration(reviewBody, "min-height", "0");
    expectDeclaration(reviewBody, "overflow-y", "auto");
  });

  it("does not duplicate the native minimum window size on the document root", () => {
    const root = rule("html,\nbody,\n#root");
    expectDeclaration(root, "min-width", "0");
    expectDeclaration(root, "min-height", "0");
    expect(root).not.toContain("1040px");
    expect(root).not.toContain("680px");
  });

  it("keeps the live preview on a stable paint path", () => {
    const shell = rule(".terminal-shell");
    expectDeclaration(shell, "contain", "paint");
    expectDeclaration(shell, "isolation", "isolate");

    const screen = rule(".terminal-screen");
    expectDeclaration(screen, "contain", "paint");
    expect(screen).not.toContain("background-color");

    const resetPlaceholder = rule(".inline-reset--placeholder");
    expectDeclaration(resetPlaceholder, "visibility", "hidden");
    expectDeclaration(resetPlaceholder, "pointer-events", "none");
  });
});
