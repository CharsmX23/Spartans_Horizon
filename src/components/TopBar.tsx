import { Person } from '../data';
import { ACCENTS } from '../theme';
import { useXp, XpState } from '../lib/xp';
import { useAuth } from '../lib/auth';
import Avatar from './Avatar';

interface Props {
  user: Person;
  onOpenSettings: () => void;
}

function SpartanLogo({ accent }: { accent: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
      {/* Shield body */}
      <path
        d="M17 2 L31 7.5 L31 19 C31 27 17 32 17 32 C17 32 3 27 3 19 L3 7.5 Z"
        fill={accent}
        style={{ opacity: 0.88 }}
      />
      {/* Shield rim highlight */}
      <path
        d="M17 2 L31 7.5 L31 19 C31 27 17 32 17 32 C17 32 3 27 3 19 L3 7.5 Z"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1"
      />
      {/* Lambda Λ — Spartan symbol */}
      <path
        d="M11.5 25.5 L17 13.5 L22.5 25.5"
        stroke="rgba(0,0,0,0.72)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Glow ring */}
      <path
        d="M17 2 L31 7.5 L31 19 C31 27 17 32 17 32 C17 32 3 27 3 19 L3 7.5 Z"
        fill="none"
        stroke={accent}
        strokeWidth="0.5"
        style={{ opacity: 0.5, filter: `drop-shadow(0 0 6px ${accent})` }}
      />
    </svg>
  );
}

/**
 * The XP meter that replaced the search bar.
 *
 * Level is computed from `sum(xp_events.amount)` on every read — there is no stored level
 * and no optimistic guess. Until the first read lands the bar renders empty rather than
 * showing a placeholder number, because a wrong level for 200ms is the exact class of
 * fiction this replaced ("Lv.24", hardcoded, for months).
 *
 * Every number here comes off the single XpState from useXp(), including the rail's
 * denominator — the curve rises (level n costs 50·n), so `levelSpan` is 50 at level 1 and
 * 150 at level 3. Nothing in this file knows the formula; hardcoding a 50 back into the
 * "x / y" readout is the one change that would silently desync the header from Settings.
 *
 * Three animations, all CSS so `prefers-reduced-motion` in index.css disables them
 * without any JS: the fill eases to its new width when a grant lands, a sheen travels
 * across the filled portion, and the whole rail breathes at the accent colour.
 */
function XpMeter({ accentHex, xp }: { accentHex: string; xp: XpState | null }) {
  const shown = xp;

  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* Level badge — one line, same pill language as the ALPHA chip in the wordmark. */}
      <div
        className="shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 h-7"
        style={{
          background: `linear-gradient(160deg, ${accentHex}2e, ${accentHex}0d)`,
          border: `1px solid ${accentHex}55`,
          boxShadow: `0 0 18px -6px ${accentHex}, inset 0 1px 0 rgba(255,255,255,0.12)`,
        }}
      >
        <span className="text-[9px] font-bold tracked-sm leading-none" style={{ color: `${accentHex}cc` }}>
          LEVEL
        </span>
        <span className="text-white font-extrabold leading-none text-[13px] tabular-nums">
          {shown ? shown.level : '—'}
        </span>
      </div>

      {/* Rail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1 gap-2">
          <span className="text-[9px] font-bold tracked-sm text-white/40">
            {shown ? `${shown.toNext} XP TO LEVEL ${shown.level + 1}` : 'SYNCING…'}
          </span>
          <span className="text-[9px] font-bold tabular-nums shrink-0" style={{ color: accentHex }}>
            {shown ? `${shown.intoLevel} / ${shown.levelSpan}` : ''}
          </span>
        </div>
        <div className="xp-rail" style={{ ['--xp-accent' as string]: accentHex }}>
          <div className="xp-fill" style={{ width: `${(shown?.fraction ?? 0) * 100}%` }}>
            <span className="xp-sheen" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TopBar({ user, onOpenSettings }: Props) {
  const accent = ACCENTS[user.accent];
  const { xp } = useXp();
  const { avatarUrl } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 px-4 md:px-6 h-16 bg-ink/70 backdrop-blur-xl border-b border-white/5">
      {/* Logo — Spartan Shield + wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <SpartanLogo accent={accent.hex} />
        <div className="hidden sm:flex flex-col leading-none">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-sm tracked">EVENT HORIZON</span>
            <span
              className="text-[9px] font-bold tracked-sm px-1.5 py-0.5 rounded"
              style={{ background: `${accent.hex}22`, color: accent.hex, border: `1px solid ${accent.hex}55` }}
            >
              ALPHA
            </span>
          </div>
          <span className="text-[10px] tracked-sm mt-0.5" style={{ color: accent.hex, opacity: 0.75 }}>
            SPARTAN
          </span>
        </div>
      </div>

      {/* XP / level — stands where the search bar used to. */}
      <div className="flex-1 max-w-sm mx-auto min-w-0">
        <XpMeter accentHex={accent.hex} xp={xp} />
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 md:gap-4 shrink-0 ml-auto">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full hover:bg-white/5 transition"
        >
          <Avatar url={avatarUrl} name={user.name} accentHex={accent.hex} size={32} />
          <div className="hidden sm:flex flex-col leading-tight text-left">
            <span className="text-white text-sm font-semibold">{user.name}</span>
            <span className="text-[10px] tabular-nums" style={{ color: accent.hex }}>
              {xp ? `${xp.total.toLocaleString()} XP` : '—'}
            </span>
          </div>
        </button>
      </div>
    </header>
  );
}
