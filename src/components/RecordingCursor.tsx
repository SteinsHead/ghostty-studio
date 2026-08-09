import { useEffect, useRef, useState } from "react";
import { recordingDemoEnabled } from "../recordingDemo";

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  pulse: { id: number; x: number; y: number } | null;
}

export function RecordingCursor() {
  const [cursor, setCursor] = useState<CursorState>({
    x: 32,
    y: 32,
    visible: false,
    pressed: false,
    pulse: null,
  });
  const frameRef = useRef<number | null>(null);
  const pointRef = useRef({ x: 32, y: 32 });

  useEffect(() => {
    if (!recordingDemoEnabled) return undefined;

    document.documentElement.classList.add("recording-demo");

    const renderPoint = () => {
      frameRef.current = null;
      setCursor((current) => ({
        ...current,
        ...pointRef.current,
        visible: true,
      }));
    };
    const move = (event: PointerEvent) => {
      pointRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current == null) frameRef.current = window.requestAnimationFrame(renderPoint);
    };
    const press = () => setCursor((current) => ({ ...current, pressed: true }));
    const release = () => setCursor((current) => ({
      ...current,
      pressed: false,
      pulse: {
        id: (current.pulse?.id ?? 0) + 1,
        ...pointRef.current,
      },
    }));

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    return () => {
      document.documentElement.classList.remove("recording-demo");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  if (!recordingDemoEnabled || !cursor.visible) return null;

  return (
    <>
      <div
        className={`recording-cursor ${cursor.pressed ? "is-pressed" : ""}`}
        style={{ left: cursor.x, top: cursor.y }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 28 34" focusable="false">
          <path d="M1.5 1.5 2 27l7-6.4 5.3 11.7 5-2.3-5.2-11.3 10.3-.8z" />
        </svg>
      </div>
      {cursor.pulse && (
        <i
          key={cursor.pulse.id}
          className="recording-click-pulse"
          style={{ left: cursor.pulse.x, top: cursor.pulse.y }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
