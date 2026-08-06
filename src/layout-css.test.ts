// @ts-expect-error Vitest executes this regression test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

// Resolve every desktop/base layer while excluding responsive and preference
// media states. This catches cascade regressions where an older component rule
// accidentally overrides the current design-system layer.
function withoutMediaBlocks(source: string): string {
  let cursor = 0;
  let result = "";
  while (cursor < source.length) {
    const mediaStart = source.indexOf("@media", cursor);
    if (mediaStart < 0) return result + source.slice(cursor);
    result += source.slice(cursor, mediaStart);
    const blockStart = source.indexOf("{", mediaStart);
    expect(blockStart, "unterminated media query").toBeGreaterThan(mediaStart);
    let depth = 1;
    let index = blockStart + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      index += 1;
    }
    expect(depth, "unterminated media-query block").toBe(0);
    cursor = index;
  }
  return result;
}

const desktopCss = withoutMediaBlocks(css);

function ruleBlocks(header: string): string[] {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleStart = new RegExp(`^${escapedHeader} \\{`, "gm");
  const blocks: string[] = [];
  for (const match of desktopCss.matchAll(ruleStart)) {
    const start = match.index;
    const end = desktopCss.indexOf("}", start);
    expect(end, `unterminated CSS rule: ${header}`).toBeGreaterThan(start);
    blocks.push(desktopCss.slice(start, end + 1));
  }

  expect(blocks.length, `missing CSS rule: ${header}`).toBeGreaterThan(0);
  return blocks;
}

function resolvedDeclaration(header: string, property: string): string | null {
  let resolved: string | null = null;

  for (const block of ruleBlocks(header)) {
    const body = block.slice(block.indexOf("{") + 1, -1);
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0 || declaration.slice(0, colon).trim() !== property) continue;
      resolved = declaration.slice(colon + 1).trim();
    }
  }

  return resolved;
}

function expectDeclaration(header: string, property: string, value: string) {
  expect(resolvedDeclaration(header, property), `${header} should resolve ${property}`).toBe(value);
}

describe("layout contract", () => {
  it("keeps the desktop grid inside the viewport", () => {
    expectDeclaration(".app-shell", "grid-template-columns", "224px minmax(0, 1fr)");
    expectDeclaration(".app-shell", "grid-template-rows", "minmax(0, 1fr)");
    expectDeclaration(".app-shell", "min-height", "0");
    expectDeclaration(".app-shell", "overflow", "hidden");

    for (const selector of [".sidebar", ".workspace", ".content-grid"]) {
      expectDeclaration(selector, "min-height", "0");
      expectDeclaration(selector, "overflow", "hidden");
    }
  });

  it("keeps scrolling on bounded inner panes", () => {
    const panes = ".settings-pane,\n.preview-pane";
    expectDeclaration(panes, "min-height", "0");
    expectDeclaration(panes, "overflow-x", "hidden");
    expectDeclaration(panes, "overflow-y", "auto");

    expectDeclaration(".review-body", "min-height", "0");
    expectDeclaration(".review-body", "overflow-y", "auto");
  });

  it("does not duplicate the native minimum window size on the document root", () => {
    const root = ruleBlocks("html,\nbody,\n#root").join("\n");
    expectDeclaration("html,\nbody,\n#root", "min-width", "0");
    expectDeclaration("html,\nbody,\n#root", "min-height", "0");
    expect(root).not.toContain("1040px");
    expect(root).not.toContain("680px");
  });

  it("keeps the live preview on a stable paint path", () => {
    expectDeclaration(".terminal-shell", "contain", "paint");
    expectDeclaration(".terminal-shell", "isolation", "isolate");
    expectDeclaration(".terminal-screen", "contain", "paint");
    expect(resolvedDeclaration(".terminal-screen", "background-color")).toBeNull();
    expectDeclaration(".inline-reset--placeholder", "visibility", "hidden");
    expectDeclaration(".inline-reset--placeholder", "pointer-events", "none");
  });

  it("reserves a balanced contextual-preview column without stretching the editor", () => {
    expectDeclaration(
      ".content-grid--with-preview",
      "grid-template-columns",
      "minmax(0, 1fr) clamp(320px, 28vw, 352px)",
    );
    expectDeclaration(".content-grid--with-preview", "justify-content", "stretch");
  });

  it("keeps the draft actions in a bounded workspace dock", () => {
    expectDeclaration(".draft-dock", "position", "absolute");
    expectDeclaration(".draft-dock", "z-index", "15");
    expectDeclaration(".draft-dock", "width", "min(720px, calc(100% - 48px))");
    expectDeclaration(".draft-dock", "margin", "0 auto");
  });

  it("lets first-run setup scroll while centering its single decision", () => {
    expectDeclaration(".setup-container", "min-height", "0");
    expectDeclaration(".setup-container", "overflow-y", "auto");
    expectDeclaration(".setup-page", "width", "min(560px, 100%)");
    expectDeclaration(".setup-page", "align-content", "center");
    expectDeclaration(".setup-page", "justify-items", "center");
  });

  it("prevents the sidebar search from consuming navigation space", () => {
    expectDeclaration(".sidebar-search.search-box", "flex", "0 0 auto");
    expectDeclaration(".sidebar-search.search-box", "width", "auto");
  });

  it("keeps compact primary controls at the target-size baseline", () => {
    expectDeclaration(".sidebar-search.search-box input", "min-height", "26px");
    expectDeclaration('.number-control input[type="range"]', "min-height", "var(--control-min-height)");
    expectDeclaration(".switch", "height", "var(--control-min-height)");
    expectDeclaration(".switch", "width", "44px");
  });

  it("anchors settings controls to the title and reserves a stable action column", () => {
    expectDeclaration(".setting-row", "align-items", "start");
    expectDeclaration(
      ".setting-row",
      "grid-template-columns",
      "minmax(0, 1fr) clamp(252px, 42%, 280px)",
    );
    expectDeclaration(".setting-input", "display", "grid");
    expectDeclaration(".setting-input", "grid-template-columns", "minmax(0, 1fr) 32px");
    expectDeclaration(".setting-inspector", "grid-column", "1 / -1");
  });

  it("removes empty feedback spacing and keeps the switch state visible", () => {
    expectDeclaration(".workspace-feedback:empty", "display", "none");
    expectDeclaration(".workspace-feedback:empty", "margin", "0");
    expectDeclaration('.switch[aria-checked="true"]::before', "background", "var(--accent-strong)");
  });
});
