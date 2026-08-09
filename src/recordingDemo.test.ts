import { describe, expect, it } from "vitest";
import { recordingDemoRequested } from "./recordingDemo";

describe("recording demo gate", () => {
  it("only enables the synthetic write journey in development with an explicit query", () => {
    expect(recordingDemoRequested(true, "?recording=1")).toBe(true);
    expect(recordingDemoRequested(true, "?recording=0")).toBe(false);
    expect(recordingDemoRequested(true, "")).toBe(false);
    expect(recordingDemoRequested(false, "?recording=1")).toBe(false);
  });
});
