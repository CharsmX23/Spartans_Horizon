import { useMemo } from 'react';
import { useReducedMotion } from '../lib/useReducedMotion';

interface Props {
  accent: string;
}

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

export default function ThunderBackground({ accent }: Props) {
  const reduced = useReducedMotion();

  /**
   * Seeded so the layout is stable across re-renders, but every star gets its own
   * period, phase and peak brightness — a shared duration reads as a blinking
   * machine, staggered ones read as a sky. The delay is applied negative so each
   * star is already mid-cycle on the first frame instead of all starting dark
   * together.
   */
  const stars = useMemo(() => {
    const rng = mulberry32(77);
    return Array.from({ length: 45 }).map(() => ({
      left: rng() * 100,
      top: rng() * 100,
      size: rng() * 2.0 + 0.9,
      delay: rng() * 9,
      dur: 2.6 + rng() * 5.4,
      peak: 0.42 + rng() * 0.45,
    }));
  }, []);

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
        * as opacity — both compositor-friendly, no layout, no JS loop. Under
        * prefers-reduced-motion the global rule in index.css drops the animation and
        * each star falls back to its static base opacity. */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {stars.map((s, i) => (
          <span
            key={i}
            className="star"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDuration: `${s.dur}s`,
              animationDelay: `-${s.delay}s`,
              ['--star-peak' as string]: s.peak,
            } as React.CSSProperties}
          />
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
