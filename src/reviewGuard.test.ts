import { describe, expect, it } from "vitest";
import { changeSetsEqual, ReviewGuard } from "./reviewGuard";

describe("review transaction guard", () => {
  it("rejects an older async review after the draft has moved on", () => {
    const guard = new ReviewGuard();
    const firstReview = guard.begin();
    guard.invalidate();
    const secondReview = guard.begin();

    expect(guard.isCurrent(firstReview)).toBe(false);
    expect(guard.isCurrent(secondReview)).toBe(true);
  });

  it("compares the exact before and after values shown to the user", () => {
    const reviewed = [{ key: "font-size", before: ["13"], after: ["14"] }];

    expect(changeSetsEqual(reviewed, structuredClone(reviewed))).toBe(true);
    expect(changeSetsEqual(reviewed, [
      { key: "font-size", before: ["13"], after: ["15"] },
    ])).toBe(false);
  });
});
