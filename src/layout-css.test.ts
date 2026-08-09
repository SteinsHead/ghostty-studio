// @ts-expect-error Vitest executes this regression test in Node; the app bundle intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

// Resolve every desktop/base layer while excluding responsive and preference
// states. This catches cascade regressions where an older component rule
// accidentally overrides the current design-system layer.
function withoutConditionalBlocks(source: string): string {
  let cursor = 0;
  let result = "";
  while (cursor < source.length) {
    const mediaStart = source.indexOf("@media", cursor);
    const containerStart = source.indexOf("@container", cursor);
    const starts = [mediaStart, containerStart].filter((index) => index >= 0);
    if (starts.length === 0) return result + source.slice(cursor);
    const conditionalStart = Math.min(...starts);
    result += source.slice(cursor, conditionalStart);
    const blockStart = source.indexOf("{", conditionalStart);
    expect(blockStart, "unterminated conditional rule").toBeGreaterThan(conditionalStart);
    let depth = 1;
    let index = blockStart + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      index += 1;
    }
    expect(depth, "unterminated conditional block").toBe(0);
    cursor = index;
  }
  return result;
}

const desktopCss = withoutConditionalBlocks(css);

function conditionalBlock(header: string): string {
  const start = css.indexOf(header);
  expect(start, `missing conditional rule: ${header}`).toBeGreaterThanOrEqual(0);
  const blockStart = css.indexOf("{", start);
  expect(blockStart, `unterminated conditional rule: ${header}`).toBeGreaterThan(start);
  let depth = 1;
  let index = blockStart + 1;
  while (index < css.length && depth > 0) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    index += 1;
  }
  expect(depth, `unterminated conditional block: ${header}`).toBe(0);
  return css.slice(start, index);
}

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

  it("adapts setting rows to their content pane instead of the outer window", () => {
    expectDeclaration(".settings-pane", "container-name", "settings-pane");
    expectDeclaration(".settings-pane", "container-type", "inline-size");
    const query = css.slice(css.indexOf("@container settings-pane (max-width: 640px)"));
    expect(query).toContain(".setting-row,");
    expect(query).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(query).toContain("grid-template-columns: minmax(0, 240px) 32px");
  });

  it("uses shared motion timing and keeps reduced-motion support", () => {
    expectDeclaration(":root", "--motion-standard", "180ms");
    expectDeclaration(":root", "--motion-dialog", "200ms");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.presence[data-presence="exiting"] .review-backdrop');
    expect(css.match(/^\.review-backdrop \{/gm)).toHaveLength(1);
    expect(css.match(/^\.review-panel \{/gm)).toHaveLength(1);
  });

  it("removes empty feedback spacing and keeps the switch state visible", () => {
    expectDeclaration(".workspace-feedback:empty", "display", "none");
    expectDeclaration(".workspace-feedback:empty", "margin", "0");
    expectDeclaration('.switch[aria-checked="true"]::before', "background", "var(--accent-strong)");
  });

  it("keeps the manually verified 1440, 1000, and 760 px layout modes distinct", () => {
    // These assertions preserve the DOM/CSS contract exercised during manual QA at each width.
    expectDeclaration(".inline-preview", "display", "none");

    const wide = conditionalBlock("@media (min-width: 1151px)");
    expect(wide).toContain(".draft-dock--settings-column");
    expect(wide).toContain("right: calc(var(--preview-column-width) + var(--space-6))");

    const compact = conditionalBlock("@media (max-width: 1150px)");
    expect(compact).toContain("grid-template-columns: 208px minmax(0, 1fr)");
    expect(compact).toMatch(/\.preview-pane\s*\{[^}]*display: none/s);
    expect(compact).toMatch(/\.inline-preview\s*\{[^}]*display: block/s);

    const narrow = conditionalBlock("@media (max-width: 760px)");
    expect(narrow).toMatch(/\.workspace\s*\{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/s);
    expect(narrow).toMatch(/\.studio-toolbar\s*\{[^}]*flex-wrap: wrap/s);
    expect(narrow).toContain("max-height: calc(100dvh - 24px)");
  });
});
