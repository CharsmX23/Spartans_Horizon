import { useMemo } from 'react';

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
  const stars = useMemo(() => {
    const rng = mulberry32(77);
    return Array.from({ length: 45 }).map(() => ({
      cx: rng() * 100,
      cy: rng() * 100,
      r: rng() * 1.0 + 0.25,
      delay: rng() * 8,
      dur: 2.5 + rng() * 5,
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

      {/* ── Star particles ── */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        preserveAspectRatio="none"
      >
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={`${s.cx}%`}
            cy={`${s.cy}%`}
            r={s.r}
            fill="white"
            style={{
              opacity: 0.35,
              animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </svg>

      {/* ── Edge vignette ── */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 25%, rgba(5,5,7,0.38) 62%, rgba(5,5,7,0.80) 92%)',
      }} />
    </div>
  );
}
