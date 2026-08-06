import type { DraftChange } from "./types";

/**
 * An empty `after` means "remove this assignment from this file". It is tied
 * to that source and must not be replayed in a different file. Explicit reset
 * tokens are values, so they remain portable.
 */
export function hasSourceBoundRemoval(changes: DraftChange[]): boolean {
  return changes.some((change) => change.after.length === 0);
}

export class DraftMutationGuard {
  private version = 0;

  invalidate(): void {
    this.version += 1;
  }

  capture(): number {
    return this.version;
  }

  isCurrent(capturedVersion: number): boolean {
    return capturedVersion === this.version;
  }
}
