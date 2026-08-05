import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';
import { hasHoverPointer, subscribePointer } from '../lib/pointer';

/**
 * A theme-coloured glow locked to the pointer.
 *
 * It sits exactly on the cursor — no easing, no trailing. The position is written
 * straight to `style.transform` from the pointer event (see lib/pointer.ts), so the
 * glow moves in the same frame the cursor does. Nothing here touches React state; a
 * setState per mousemove would re-render the tree dozens of times a second.
 *
 * The real system cursor stays visible underneath: hiding it would cost precision on
 * small targets and lose the I-beam/resize shapes that tell you what a region does.
 *
 * The glow also lights up CursorReveal's icon field, which reads the same pointer
 * stream, so the two always agree on where the light is.
 */
export default function CursorGlow() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;

    const el = ref.current;
    if (!el || !hasHoverPointer()) return;

    return subscribePointer((x, y, inside) => {
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      el.style.opacity = inside ? '1' : '0';
    });
  }, [reduced]);

  if (reduced) return null;

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
