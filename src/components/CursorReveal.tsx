import { ComponentType, useEffect, useMemo, useRef } from 'react';
import {
  Shield, ShieldHalf, Swords, Sword, Crown, Axe, Anchor, Flame,
  Code2, Binary,
  Rocket, Orbit, Radar, Satellite, Zap, Sun, Leaf, Waves,
} from 'lucide-react';
import { SpartanHelmet, LaurelWreath, GreekColumn } from './SpartanGlyphs';
import { useReducedMotion } from '../lib/useReducedMotion';
import { hasHoverPointer, subscribePointer } from '../lib/pointer';
import { AccentKey } from '../theme';

/**
 * A hidden field of Spartan + tech glyphs that only exists where the cursor light
 * falls. The icons are always mounted and always in the same place; what moves is a
 * circular window that clips them.
 *
 * ── Why two layers instead of one moving mask ──────────────────────────────────
 * The obvious build is one full-screen layer masked by a radial gradient whose
 * position tracks the cursor. That repaints the whole viewport every frame, because
 * the mask changes. Instead:
 *
 *   .cursor-reveal        a REVEAL_SIZE box with a *static* mask, translated to the cursor
 *   .cursor-reveal-field  the full-viewport icon field, translated by the exact opposite
 *
 * The field's counter-translate cancels the window's translate, so the icons appear
 * pinned to the viewport while the hole slides over them. Both layers only ever change
 * `transform`, so every frame is a composite — no repaint, no layout, no easing. That
 * is what keeps it in lockstep with the cursor.
 *
 * Rendered behind the page content (z-index -1 inside the shell's isolated stacking
 * context), so glass cards blur it into the background rather than covering it.
 */

/** Diameter of the reveal window. The visible light is smaller — the mask fades out well before the edge. */
const REVEAL_SIZE = 460;
const HALF = REVEAL_SIZE / 2;

type Glyph = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

/**
 * Always present, whatever the accent — a deliberately short list. A wide pool made
 * every sweep of the light turn up something different and the field read as clip art;
 * a handful of repeating shapes reads as a motif.
 *
 * The Spartan set is longer than the tech set, so the light finds roughly three war
 * glyphs for every one piece of code — this is Spartans Horizon, not a server rack.
 */
const SPARTAN: Glyph[] = [
  SpartanHelmet, Shield, Swords, Axe, LaurelWreath, Sword,
  Anchor, GreekColumn, Crown, ShieldHalf, SpartanHelmet, Shield,
];
const TECH: Glyph[] = [Code2, Binary, Code2, Binary];

/**
 * Each accent gets its own flavour on top of the shared set, so switching themes
 * changes what the light finds and not just what colour it is.
 */
const THEME_GLYPHS: Record<AccentKey, Glyph[]> = {
  ember:     [Flame, Axe],
  nebula:    [Rocket, Orbit],
  ion:       [Radar, Satellite],
  supernova: [Zap, Sun],
  aurora:    [Leaf, Waves],
};

/** Deterministic PRNG, so the field is identical on every render and every reload. */
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = 7;
const ROWS = 5;

interface Placed {
  Icon: Glyph;
  left: string;
  top: string;
  size: number;
  rotate: number;
  opacity: number;
  strokeWidth: number;
}

/**
 * A jittered grid rather than pure random placement: pure random clumps and leaves
 * bald patches, and a bald patch reads as a broken effect when the light lands there.
 */
function buildField(accent: AccentKey): Placed[] {
  const rand = mulberry32(0x5a17);          // fixed seed: icons keep their spots across themes
  const pool = [...SPARTAN, ...TECH, ...THEME_GLYPHS[accent]];
  const out: Placed[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cellW = 100 / COLS;
      const cellH = 100 / ROWS;
      out.push({
        Icon: pool[Math.floor(rand() * pool.length)],
        left: `${(col + 0.15 + rand() * 0.7) * cellW}%`,
        top: `${(row + 0.15 + rand() * 0.7) * cellH}%`,
        size: 20 + Math.round(rand() * 26),
        rotate: Math.round((rand() - 0.5) * 44),
        opacity: 0.3 + rand() * 0.55,
        strokeWidth: rand() > 0.65 ? 1.6 : 1.15,
      });
    }
  }

  return out;
}

export default function CursorReveal({ accent }: { accent: AccentKey }) {
  const reduced = useReducedMotion();
  const windowRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => buildField(accent), [accent]);

  useEffect(() => {
    if (reduced) return;

    const win = windowRef.current;
    const field = fieldRef.current;
    if (!win || !field || !hasHoverPointer()) return;

    return subscribePointer((x, y, inside) => {
      win.style.transform = `translate3d(${x - HALF}px, ${y - HALF}px, 0)`;
      // Exact inverse, so the icons stay put in viewport space while the hole moves.
      field.style.transform = `translate3d(${HALF - x}px, ${HALF - y}px, 0)`;
      win.style.opacity = inside ? '1' : '0';
    });
  }, [reduced]);

  if (reduced) return null;

  return (
    <div
      ref={windowRef}
      className="cursor-reveal"
      aria-hidden="true"
      style={{ width: REVEAL_SIZE, height: REVEAL_SIZE }}
    >
      <div ref={fieldRef} className="cursor-reveal-field">
        {items.map(({ Icon, left, top, size, rotate, opacity, strokeWidth }, i) => (
          <span
            key={i}
            className="reveal-icon"
            style={{ left, top, opacity, transform: `translate(-50%, -50%) rotate(${rotate}deg)` }}
          >
            <Icon size={size} strokeWidth={strokeWidth} />
          </span>
        ))}
      </div>
    </div>
  );
}
