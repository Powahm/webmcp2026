import { useCallback, useEffect, useRef } from "react";
import { clamp, useLayoutStore, type Bounds, type LayoutSizes } from "../state/layoutStore";

/**
 * A drag handle between two panes.
 *
 * role="separator" with aria-valuenow, and arrow keys that move it, because a
 * resizer that only responds to a mouse is a control a keyboard user cannot
 * reach at all. Pointer capture rather than window listeners: the drag then
 * survives the cursor leaving the handle, which is the normal case once you are
 * moving quickly.
 */

export default function Resizer({
  edge,
  which,
  bounds,
  label,
  current,
}: {
  /** Which side of the handle the pane being sized is on. */
  edge: "left" | "right" | "bottom";
  which: keyof LayoutSizes;
  bounds: Bounds;
  label: string;
  /** Live px size, so the handle can report and step from the real value. */
  current: number;
}) {
  const setSize = useLayoutStore((s) => s.set);
  const dragging = useRef(false);
  const vertical = edge !== "bottom";

  const sizeFrom = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (edge === "left") return e.clientX;
      if (edge === "right") return window.innerWidth - e.clientX;
      return window.innerHeight - e.clientY;
    },
    [edge]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(vertical ? "resizing-x" : "resizing-y");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setSize(which, sizeFrom(e));
  };

  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.classList.remove("resizing-x", "resizing-y");
  };

  useEffect(
    () => () => document.body.classList.remove("resizing-x", "resizing-y"),
    []
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 12;
    const grow = vertical ? "ArrowRight" : "ArrowUp";
    const shrink = vertical ? "ArrowLeft" : "ArrowDown";
    // On the right-hand rail, dragging right makes the pane smaller.
    const sign = edge === "right" ? -1 : 1;
    if (e.key === grow) {
      e.preventDefault();
      setSize(which, current + step * sign);
    } else if (e.key === shrink) {
      e.preventDefault();
      setSize(which, current - step * sign);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSize(which, bounds.min);
    } else if (e.key === "End") {
      e.preventDefault();
      setSize(which, bounds.max);
    }
  };

  return (
    <div
      className={`resizer resizer-${edge}`}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={clamp(current, bounds)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      title={`${label}. Drag, or use the arrow keys.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => useLayoutStore.getState().reset()}
    />
  );
}
