import { useEffect, useState } from 'react';

/**
 * A user's picture, or an initials monogram when there is none.
 *
 * The fallback is drawn rather than fetched. The header used to render
 * `https://i.pravatar.cc/100?img=12` from data.ts — a stock photo of a stranger, standing
 * in for a real person, which is the same category of fiction as the hardcoded "Lv.24".
 * A monogram in the user's own accent colour is honest about being a placeholder, costs
 * no request, and cannot fail to load.
 *
 * `onError` matters here specifically because the src is a *signed* URL against a private
 * bucket: it expires. A tab left open past the TTL would otherwise show a broken-image
 * glyph, so an expired link degrades to the monogram instead.
 */
export default function Avatar({ url, name, accentHex, size, className = '' }: {
  url: string | null;
  name: string;
  accentHex: string;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A new signed URL for the same object is a new string, so a fresh mint clears a
  // previous failure rather than staying stuck on the monogram until reload.
  useEffect(() => { setFailed(false); }, [url]);

  const initials = name.trim().slice(0, 2).toUpperCase() || '??';

  if (!url || failed) {
    return (
      <span
        className={`shrink-0 grid place-items-center rounded-full ring-1 ring-white/10 ${className}`}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(150deg, ${accentHex}44, ${accentHex}14)`,
          color: '#fff',
          fontSize: Math.round(size * 0.36),
          fontWeight: 800,
          letterSpacing: '0.02em',
        }}
        aria-label={name}
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full ring-1 ring-white/10 object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
