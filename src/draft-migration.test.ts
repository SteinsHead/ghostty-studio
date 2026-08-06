import { describe, expect, it } from "vitest";
import { RESET_BACKGROUND_TOKEN } from "./backgroundImageModel";
import { DraftMutationGuard, hasSourceBoundRemoval } from "./draftMigration";

describe("cross-source draft migration", () => {
  it("rejects a stale async migration after the user edits again", async () => {
    const guard = new DraftMutationGuard();
    const captured = guard.capture();
    const migration = Promise.resolve().then(() => guard.isCurrent(captured));

    guard.invalidate();

    await expect(migration).resolves.toBe(false);
  });

  it("treats file removal as source-bound but keeps explicit reset portable", () => {
    expect(hasSourceBoundRemoval([
      { key: "font-family", before: ["Mono"], after: [] },
    ])).toBe(true);
    expect(hasSourceBoundRemoval([
      { key: "background-image", before: ["managed-image:id"], after: [RESET_BACKGROUND_TOKEN] },
    ])).toBe(false);
  });
});
