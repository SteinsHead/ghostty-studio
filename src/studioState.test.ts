import { describe, expect, it } from "vitest";
import { MutationCoordinator } from "./studioState";

describe("mutation coordinator", () => {
  it("keeps one transaction active and ignores stale completion", () => {
    const coordinator = new MutationCoordinator();
    const first = coordinator.begin("refresh")!;
    expect(coordinator.busy).toBe(true);
    expect(coordinator.begin("source")).toBeNull();

    coordinator.finish(first);
    const second = coordinator.begin("apply")!;
    coordinator.finish(first);
    expect(coordinator.busy).toBe(true);
    expect(coordinator.isCurrent(second)).toBe(true);

    coordinator.finish(second);
    expect(coordinator.busy).toBe(false);
  });
});
