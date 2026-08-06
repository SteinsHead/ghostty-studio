import { describe, expect, it } from "vitest";
import { RESET_BACKGROUND_TOKEN } from "./backgroundImageModel";
import { effectiveDraftPreview, ignoredDraftPreviewKeys } from "./effectivePreview";

describe("effective draft preview", () => {
  it("uses the effective configuration when the selected file has no edits", () => {
    expect(effectiveDraftPreview(
      { "font-size": "20", background: "112233" },
      { "font-size": "12", background: "445566" },
      { "font-size": "12", background: "445566" },
      {},
    )).toEqual({ "font-size": "20", background: "112233" });
  });

  it("overlays real edits but excludes drafts known to be overridden", () => {
    const preview = effectiveDraftPreview(
      { "font-size": "20", background: "112233", foreground: "eeeeee" },
      { "font-size": "12", background: "445566", foreground: "cccccc" },
      { "font-size": "18", background: "abcdef", foreground: "ffffff" },
      {
        "font-size": { status: "overridden", sourceCandidateId: "later", sourceLabel: "later.conf" },
        background: { status: "inherited", sourceCandidateId: "earlier", sourceLabel: "earlier.conf" },
        foreground: { status: "unverified", sourceCandidateId: null, sourceLabel: null },
      },
    );

    expect(preview).toEqual({
      "font-size": "20",
      background: "abcdef",
      foreground: "eeeeee",
    });
  });

  it("previews an explicit image reset without treating it as a source-bound removal", () => {
    expect(effectiveDraftPreview(
      { "background-image": "managed-image:saved" },
      { "background-image": "managed-image:local" },
      { "background-image": RESET_BACKGROUND_TOKEN },
      { "background-image": { status: "effective", sourceCandidateId: "target", sourceLabel: "config" } },
    )["background-image"]).toBe("");
  });

  it("reports removals and shadowed drafts that cannot be represented as final", () => {
    expect(ignoredDraftPreviewKeys(
      { "font-family": "Mono", "font-size": "12" },
      { "font-family": "", "font-size": "18" },
      { "font-size": { status: "overridden", sourceCandidateId: "later", sourceLabel: "later.conf" } },
    )).toEqual(["font-family", "font-size"]);
  });
});
