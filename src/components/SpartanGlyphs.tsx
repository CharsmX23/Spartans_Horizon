/**
 * Three Spartan glyphs lucide does not ship: a helmet, a laurel wreath and a column.
 *
 * Drawn to lucide's conventions on purpose — 24×24 box, `currentColor` stroke, round
 * caps and joins, no fill — so they sit in the same icon pool as the real ones without
 * reading as a different set. Per `.bolt/prompt` no icon package may be added; these
 * are a handful of paths, not a dependency.
 *
 * Background decoration only: they render small and blurred behind glass, so the
 * shapes are silhouettes rather than detailed drawings.
 */

interface GlyphProps {
  size?: number | string;
  strokeWidth?: number | string;
}

function svgProps({ size = 24, strokeWidth = 1.5 }: GlyphProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

/** Corinthian helmet: dome, cheek guards, eye slit, and the transverse crest. */
export function SpartanHelmet(props: GlyphProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 13a7 7 0 0 1 14 0v1.6a5 5 0 0 1-2.4 4.3V21h-9v-2.1A5 5 0 0 1 5 14.6z" />
      <path d="M7.2 7.5C8.8 4.2 15.2 4.2 16.8 7.5" />
      <path d="M9 12.5h6" />
      <path d="M12 12.5V19" />
    </svg>
  );
}

/** Laurel wreath: two facing branches with a gap at the crown. */
export function LaurelWreath(props: GlyphProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.5 4.2C5.5 7 4.6 15 8.8 20" />
      <path d="M14.5 4.2C18.5 7 19.4 15 15.2 20" />
      <path d="M8 8.6c1.6-.4 2.6.2 3 1.6" />
      <path d="M7.2 12.4c1.7-.2 2.6.6 2.8 2" />
      <path d="M16 8.6c-1.6-.4-2.6.2-3 1.6" />
      <path d="M16.8 12.4c-1.7-.2-2.6.6-2.8 2" />
    </svg>
  );
}

/** Doric column: entablature, fluted shaft, stepped base. */
export function GreekColumn(props: GlyphProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.5 4h17" />
      <path d="M5.5 7h13" />
      <path d="M8 7v10" />
      <path d="M12 7v10" />
      <path d="M16 7v10" />
      <path d="M5.5 17h13" />
      <path d="M3.5 20h17" />
    </svg>
  );
}
