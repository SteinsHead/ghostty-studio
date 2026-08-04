import type { DraftChange } from "./types";

/**
 * Invalidates asynchronous review work whenever the draft or workspace moves on.
 * The backend still verifies its own stage token; this guard prevents an older
 * response from being rendered beside a newer draft in the WebView.
 */
export class ReviewGuard {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export function changeSetsEqual(left: DraftChange[], right: DraftChange[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((change, index) => {
    const other = right[index];
    return other?.key === change.key
      && other.before.join("\u0000") === change.before.join("\u0000")
      && other.after.join("\u0000") === change.after.join("\u0000");
  });
}
