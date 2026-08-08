import { useEffect, useRef, useState, type ReactNode } from "react";

export type PresenceState = "entering" | "open" | "exiting";

interface PresenceProps {
  show: boolean;
  children: ReactNode;
  exitDuration?: number;
  className?: string;
}

function reducedMotionPreferred(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Presence({
  show,
  children,
  exitDuration = 180,
  className = "",
}: PresenceProps) {
  const [mounted, setMounted] = useState(show);
  const [state, setState] = useState<PresenceState>(show ? "open" : "exiting");
  const lastVisibleChildren = useRef(children);

  if (show) lastVisibleChildren.current = children;

  useEffect(() => {
    if (show) {
      if (!mounted) {
        setMounted(true);
        setState("entering");
      } else if (state === "exiting") {
        setState("open");
      }
      return;
    }

    if (mounted && state !== "exiting") setState("exiting");
  }, [mounted, show, state]);

  useEffect(() => {
    if (!mounted) return;

    if (show && state === "entering") {
      const frame = window.requestAnimationFrame(() => setState("open"));
      return () => window.cancelAnimationFrame(frame);
    }

    if (!show && state === "exiting") {
      const timeout = window.setTimeout(
        () => setMounted(false),
        reducedMotionPreferred() ? 0 : exitDuration,
      );
      return () => window.clearTimeout(timeout);
    }
  }, [exitDuration, mounted, show, state]);

  if (!mounted) return null;

  return (
    <div className={`presence ${className}`.trim()} data-presence={state}>
      {show ? children : lastVisibleChildren.current}
    </div>
  );
}
