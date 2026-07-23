import { Flame, Check, Circle, Camera, ArrowRight, Sparkles } from 'lucide-react';
import { Person, HABITS, TECH_TODAY, INDUSTRY_UPDATE, TechCard } from '../data';
import { ACCENTS } from '../theme';

interface Props {
  user: Person;
}

export default function RightSidebar({ user }: Props) {
  const accent = ACCENTS[user.accent];
  const ringPct = Math.min(user.streak / 60, 1);
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - ringPct);

  return (
    <div className="flex flex-col gap-4">
      {/* Current Streak */}
      <div className="glass p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4" style={{ color: accent.hex }} />
            <span className="text-[10px] tracked-sm text-white/50">CURRENT STREAK</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-extrabold text-white leading-none">{user.streak}<span className="text-base text-white/50 ml-1">Days</span></div>
            <p className="text-[11px] text-white/45 mt-1.5 leading-snug">Keep the chain alive.<br />One proof a day.</p>
          </div>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
            <circle
              cx="32" cy="32" r={r} fill="none"
              stroke={accent.hex} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 32 32)"
              className="ring-anim"
              style={{ ['--ring-circ' as any]: circ, ['--ring-offset' as any]: offset, filter: `drop-shadow(0 0 6px ${accent.hex}80)` }}
            />
          </svg>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-2">
          {HABITS.slice(0, 3).map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-xs">
              <span className="w-5 h-5 grid place-items-center rounded-md bg-white/5 text-white/60">
                <Flame className="w-3 h-3" />
              </span>
              <span className="flex-1 text-white/70">{h.label}</span>
              {h.done
                ? <Check className="w-3.5 h-3.5" style={{ color: '#34D399' }} />
                : <Circle className="w-3.5 h-3.5 text-white/20" />}
            </div>
          ))}
        </div>
        <button
          className="mt-3 w-full py-2.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition hover:brightness-110"
          style={{ background: `linear-gradient(135deg, ${accent.hex}, ${accent.hex}99)`, color: 'white', boxShadow: `0 8px 24px -8px ${accent.hex}80` }}
        >
          <Camera className="w-4 h-4" /> Upload Proof
        </button>
      </div>

      {/* Today's Tech */}
      <TechPanel title="Today's Tech" card={TECH_TODAY} />
      <TechPanel title="Industry Update" card={INDUSTRY_UPDATE} />

      {/* Insights */}
      <div className="glass p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" style={{ color: accent.hex }} />
          <span className="text-[10px] tracked-sm text-white/50">INSIGHTS</span>
        </div>
        <p className="text-sm text-white/75 leading-relaxed">
          Your streak trend is up <span style={{ color: '#34D399' }}>+18%</span> vs last week. You logged <span className="text-white font-semibold">14h 22m</span> of deep work — your strongest day was Tuesday.
        </p>
      </div>
    </div>
  );
}

function TechPanel({ title, card }: { title: string; card: TechCard }) {
  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] tracked-sm text-white/50">{title.toUpperCase()}</span>
        <button className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1">
          See All <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/70">{card.category}</span>
        <span className="text-[10px] text-white/40">{card.readMins} min read</span>
      </div>
      <h3 className="text-white font-semibold text-sm leading-snug">{card.headline}</h3>
      <p className="text-[12px] text-white/55 mt-1 leading-snug">{card.summary}</p>
      <button className="text-[12px] mt-2 flex items-center gap-1" style={{ color: 'var(--accent)' }}>
        Read <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
