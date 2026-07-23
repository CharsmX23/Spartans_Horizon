import { Bell, Users, Search, Command } from 'lucide-react';
import { Person } from '../data';
import { ACCENTS } from '../theme';

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

export default function TopBar({ user, onOpenSettings }: Props) {
  const accent = ACCENTS[user.accent];
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

      {/* Search */}
      <div className="flex-1 max-w-xl mx-auto hidden md:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            placeholder="Search missions, ideas, tech, members…"
            className="w-full bg-white/5 border border-white/10 rounded-full pl-10 pr-16 py-2 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-white/25 transition"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/35 border border-white/10 rounded px-1.5 py-0.5 flex items-center gap-1">
            <Command className="w-3 h-3" />K
          </span>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 md:gap-4 shrink-0 ml-auto">
        <button className="relative w-5 h-5 grid place-items-center text-white/70 hover:text-white transition">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: accent.hex, boxShadow: `0 0 6px ${accent.hex}` }} />
        </button>
        <button className="w-5 h-5 grid place-items-center text-white/70 hover:text-white transition">
          <Users className="w-5 h-5" />
        </button>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full hover:bg-white/5 transition"
        >
          <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-white/10" />
          <div className="hidden sm:flex flex-col leading-tight text-left">
            <span className="text-white text-sm font-semibold">{user.name}</span>
            <span className="text-[10px]" style={{ color: accent.hex }}>Lv.{user.level}</span>
          </div>
        </button>
      </div>
    </header>
  );
}
