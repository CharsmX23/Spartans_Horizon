import { useMemo } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';
import { AccentKey } from '../theme';

interface Props {
  accent: string;
  accentKey: AccentKey;
}

/**
 * How the star field behaves per theme. The accent already changes the colour; this
 * changes the *temperament*, so Ember crackles, Nebula breathes, and Ion blinks like
 * instrumentation. All of it is timing and amplitude — no extra elements, no JS loop.
 *
 * blink   — [min, max] seconds for one pulse cycle
 * drift   — px amplitude of the slow wander
 * float   — [min, max] seconds for one drift lap
 * flash   — fraction of halo stars that spike instead of twinkle
 * halo    — how many stars ring the bolt
 * size    — [min, max] px
 */
const TEMPER: Record<AccentKey, {
  blink: [number, number];
  drift: number;
  float: [number, number];
  flash: number;
  halo: number;
  size: [number, number];
}> = {
  ember:     { blink: [1.2, 3.0], drift: 7,  float: [9, 17],  flash: 0.30, halo: 30, size: [1.0, 2.9] },
  nebula:    { blink: [3.4, 8.0], drift: 18, float: [20, 36], flash: 0.14, halo: 34, size: [1.0, 3.4] },
  ion:       { blink: [0.9, 2.3], drift: 10, float: [8, 15],  flash: 0.38, halo: 32, size: [0.9, 2.4] },
  supernova: { blink: [1.7, 4.0], drift: 11, float: [12, 22], flash: 0.26, halo: 30, size: [1.2, 3.6] },
  aurora:    { blink: [3.0, 6.5], drift: 15, float: [16, 30], flash: 0.12, halo: 32, size: [1.0, 3.0] },
};

/** Where the bolt sits in the panel, in percent — the halo is laid out around this. */
const BOLT_CX = 52;
const BOLT_CY = 50;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lightning bolt path — normalized 0–100 viewBox
const BOLT_PATH = 'M 62 2 L 20 54 H 48 L 26 98 L 84 44 H 56 Z';

interface Star {
  left: number;
  top: number;
  size: number;
  delay: number;
  dur: number;
  peak: number;
  driftX: number;
  driftY: number;
  floatDur: number;
  floatDelay: number;
  flash: boolean;
  halo: boolean;
}

export default function ThunderBackground({ accent, accentKey }: Props) {
  const reduced = useReducedMotion();
  const temper = TEMPER[accentKey];

  /**
   * Seeded so the layout is stable across re-renders, but every star gets its own
   * period, phase and peak brightness — a shared duration reads as a blinking
   * machine, staggered ones read as a sky. The delay is applied negative so each
   * star is already mid-cycle on the first frame instead of all starting dark
   * together.
   *
   * Two populations. The halo is placed in polar coordinates around the bolt, in a
   * ring with a hole in the middle, so the bolt reads as the thing the stars are
   * gathered around rather than a shape dropped on a random field — the ring is
   * stretched wider than it is tall to match the panel's aspect. The ambient stars
   * fill the rest of the panel and stay white, which keeps the accent-coloured halo
   * legible as a separate layer instead of flattening into one wash of colour.
   */
  const stars = useMemo<Star[]>(() => {
    const rng = mulberry32(77);
    const [bMin, bMax] = temper.blink;
    const [fMin, fMax] = temper.float;
    const [sMin, sMax] = temper.size;

    const common = (halo: boolean) => ({
      delay: rng() * 9,
      dur: bMin + rng() * (bMax - bMin),
      peak: 0.42 + rng() * 0.5,
      driftX: (rng() * 2 - 1) * temper.drift,
      driftY: (rng() * 2 - 1) * temper.drift,
      floatDur: fMin + rng() * (fMax - fMin),
      floatDelay: rng() * 20,
      flash: halo && rng() < temper.flash,
      halo,
    });

    const halo: Star[] = Array.from({ length: temper.halo }).map(() => {
      const angle = rng() * Math.PI * 2;
      const t = rng();                        // 0 = inner edge of the ring, 1 = outer
      return {
        left: BOLT_CX + Math.cos(angle) * (20 + t * 28),
        top: BOLT_CY + Math.sin(angle) * (24 + t * 30),
        size: sMin + rng() * (sMax - sMin),
        ...common(true),
      };
    });

    const ambient: Star[] = Array.from({ length: 30 }).map(() => ({
      left: rng() * 100,
      top: rng() * 100,
      size: 0.9 + rng() * 2.0,
      ...common(false),
    }));

    return [...halo, ...ambient];
  }, [temper]);

  /** Embers drift up from the bottom edge and fade out, then loop. */
  const embers = useMemo(() => {
    const rng = mulberry32(1337);
    return Array.from({ length: 9 }).map(() => ({
      left: 6 + rng() * 88,
      size: 1.6 + rng() * 2.4,
      dur: 9 + rng() * 9,
      delay: rng() * 16,
      drift: (rng() * 2 - 1) * 26,
      rise: 150 + rng() * 130,
      peak: 0.3 + rng() * 0.35,
    }));
  }, []);

  return (
    /* clip-path not needed — the parent section clips us via border-radius + overflow */
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>

      {/* ── Subtle ambient glow behind the bolt ── */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: 500, height: 380,
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background: `radial-gradient(ellipse at center, ${accent}18 0%, ${accent}06 45%, transparent 72%)`,
        filter: 'blur(24px)',
      }} />

      {/* ── Main lightning bolt — low opacity ── */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          top: '50%', left: '52%',
          transform: 'translate(-50%, -50%) rotate(-8deg)',
          width: '58%',
          height: '82%',
          opacity: 0.16,
          overflow: 'visible',
        }}
      >
        {/* Glow layer — blurred copy */}
        <path
          d={BOLT_PATH}
          fill={accent}
          style={{ filter: 'blur(6px)', opacity: 0.7 }}
        />
        {/* Crisp fill */}
        <path d={BOLT_PATH} fill={accent} />
      </svg>

      {/* ── Faint secondary bolt (echoed, offset) ── */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          top: '42%', left: '66%',
          transform: 'translate(-50%, -50%) rotate(4deg) scale(0.42)',
          width: '58%',
          height: '82%',
          opacity: 0.04,
          overflow: 'visible',
        }}
      >
        <path d={BOLT_PATH} fill={accent} />
      </svg>

      {/* ── Star particles ──
        * Plain elements rather than <circle>, so the pulse can drive transform as well
        * as opacity — both compositor-friendly, no layout, no JS loop. The outer span
        * drifts and the inner one pulses; see the comment on @keyframes twinkle for why
        * that has to be two elements. Halo stars carry the accent and a matching glow,
        * ambient ones stay white. Under prefers-reduced-motion the global rule in
        * index.css drops both animations and each star falls back to its base opacity,
        * which is still a legible star field. */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {stars.map((s, i) => (
          <span
            key={i}
            className="star-orbit"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              animationDuration: `${s.floatDur}s`,
              animationDelay: `-${s.floatDelay}s`,
              ['--drift-x' as string]: `${s.driftX}px`,
              ['--drift-y' as string]: `${s.driftY}px`,
            } as React.CSSProperties}
          >
            <span
              className={s.flash ? 'star flash' : 'star'}
              style={{
                width: s.size,
                height: s.size,
                animationDuration: `${s.dur}s`,
                animationDelay: `-${s.delay}s`,
                background: s.halo ? accent : '#fff',
                boxShadow: s.halo ? `0 0 ${Math.round(s.size * 3)}px ${accent}` : undefined,
                ['--star-peak' as string]: s.peak,
              } as React.CSSProperties}
            />
          </span>
        ))}
      </div>

      {/* ── Embers ──
        * Not rendered at all under reduced motion: frozen mid-drift they would read as
        * stray dots rather than as the static version of anything. */}
      {!reduced && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          {embers.map((e, i) => (
            <span
              key={i}
              className="ember"
              style={{
                left: `${e.left}%`,
                width: e.size,
                height: e.size,
                background: accent,
                boxShadow: `0 0 6px ${accent}`,
                animationDuration: `${e.dur}s`,
                animationDelay: `-${e.delay}s`,
                ['--ember-drift' as string]: `${e.drift}px`,
                ['--ember-rise' as string]: `${e.rise}px`,
                ['--ember-peak' as string]: e.peak,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {/* ── Edge vignette ── */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 25%, rgba(5,5,7,0.38) 62%, rgba(5,5,7,0.80) 92%)',
      }} />
    </div>
  );
}
