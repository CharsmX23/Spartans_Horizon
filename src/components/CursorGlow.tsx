import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

/**
 * A soft, theme-coloured glow that trails the pointer.
 *
 * The real system cursor is left visible underneath. The glow lags on purpose, so it
 * is not a reliable indicator of where a click will land — hiding the OS cursor would
 * cost precision on small targets and lose the I-beam/resize shapes that tell you what
 * a region does. The glow is ambience; the cursor still does the pointing.
 *
 * Position is tracked in refs and written straight to `style.transform` inside a
 * requestAnimationFrame loop. Nothing here touches React state — a setState per
 * mousemove would re-render the whole tree dozens of times a second — and transform
 * keeps the work on the compositor instead of forcing layout the way top/left would.
 */

/** Fraction of the remaining distance covered per frame. Higher = tighter follow. */
const SMOOTHING = 0.16;

export default function CursorGlow() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;

    const el = ref.current;
    if (!el) return;

    // A touch device has no hovering pointer to trail; skip the loop entirely.
    if (window.matchMedia('(hover: none)').matches) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const pos = { ...target };
    let seen = false;
    let frame = 0;

    function onMove(e: PointerEvent) {
      target.x = e.clientX;
      target.y = e.clientY;
      if (!seen) {
        // Land on the first real position rather than gliding in from the centre.
        seen = true;
        pos.x = e.clientX;
        pos.y = e.clientY;
        el!.style.opacity = '1';
      }
    }

    function onLeave() { el!.style.opacity = '0'; }
    function onEnter() { if (seen) el!.style.opacity = '1'; }

    function tick() {
      pos.x += (target.x - pos.x) * SMOOTHING;
      pos.y += (target.y - pos.y) * SMOOTHING;
      el!.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerenter', onEnter);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
    };
  }, [reduced]);

  if (reduced) return null;

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
