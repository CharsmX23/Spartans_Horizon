/**
 * One pointer listener for the whole app, shared by every cursor-driven effect.
 *
 * Subscribers are called synchronously from the `pointermove` handler — no
 * requestAnimationFrame hop, no easing, no state. The browser already coalesces
 * moves to roughly one event per frame, and the callbacks only ever write
 * `transform`, so handling them inline is cheaper than scheduling a frame and
 * lands the effect on the exact pixel the OS cursor is on.
 *
 * Never read layout (offsetWidth, getBoundingClientRect) inside a subscriber:
 * that would force a synchronous reflow on every move and undo the whole point.
 */

/** `inside` is false when the pointer has left the window. */
export type PointerListener = (x: number, y: number, inside: boolean) => void;

const listeners = new Set<PointerListener>();

let x = 0;
let y = 0;
let seen = false;      // has the pointer ever reported a real position?
let attached = false;

function emit(inside: boolean) {
  for (const fn of listeners) fn(x, y, inside);
}

function onMove(e: PointerEvent) {
  x = e.clientX;
  y = e.clientY;
  seen = true;
  emit(true);
}

function onLeave() { emit(false); }
function onEnter() { if (seen) emit(true); }

function attach() {
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerenter', onEnter);
  attached = true;
}

function detach() {
  window.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerleave', onLeave);
  document.removeEventListener('pointerenter', onEnter);
  attached = false;
}

/** Subscribe to pointer moves. Returns an unsubscribe function. */
export function subscribePointer(fn: PointerListener): () => void {
  listeners.add(fn);
  if (!attached) attach();
  // Late subscribers (a tab switch, say) get the current position immediately
  // instead of staying invisible until the next move.
  if (seen) fn(x, y, true);

  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) detach();
  };
}

/** False on touch-only devices, where there is no hovering pointer to follow. */
export function hasHoverPointer(): boolean {
  return !window.matchMedia('(hover: none)').matches;
}
