import { X, Check, LogOut } from 'lucide-react';
import { Person } from '../data';
import { ACCENT_LIST, AccentKey } from '../theme';
import { useAuth } from '../lib/auth';

interface Props {
  user: Person;
  open: boolean;
  onClose: () => void;
  onPick: (k: AccentKey) => void;
}

export default function SettingsPanel({ user, open, onClose, onPick }: Props) {
  const { signOut, squad } = useAuth();
  if (!open) return null;

  async function handleSignOut() {
    await signOut();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Settings</h2>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 transition">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        <div className="mb-2 text-[11px] tracked-sm text-white/50">PROFILE</div>
        <div className="flex items-center gap-3 mb-5">
          <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-full ring-1 ring-white/10" />
          <div className="min-w-0">
            <div className="text-white font-semibold">{user.name}</div>
            <div className="text-xs text-white/45 truncate">Lv.{user.level} · {user.handle}</div>
          </div>
        </div>

        {squad && (
          <>
            <div className="mb-2 text-[11px] tracked-sm text-white/50">SQUAD</div>
            <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-semibold truncate">{squad.name}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Share this code to invite squadmates</div>
              </div>
              <span className="font-mono text-sm tracking-[0.2em] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/80">
                {squad.join_code}
              </span>
            </div>
          </>
        )}

        <div className="mb-2 text-[11px] tracked-sm text-white/50">ACCENT THEME</div>
        <p className="text-[12px] text-white/45 mb-3">Pick a cosmic preset. Everything re-themes instantly.</p>
        <div className="grid grid-cols-1 gap-2">
          {ACCENT_LIST.map((a) => {
            const selected = user.accent === a.key;
            return (
              <button
                key={a.key}
                onClick={() => onPick(a.key)}
                className="flex items-center gap-3 p-3 rounded-xl border transition"
                style={{
                  background: selected ? `${a.hex}1a` : 'rgba(255,255,255,0.03)',
                  borderColor: selected ? a.hex : 'rgba(255,255,255,0.08)',
                }}
              >
                <span
                  className="w-7 h-7 rounded-full shrink-0"
                  style={{ background: a.hex, boxShadow: `0 0 16px -2px ${a.hex}80` }}
                />
                <span className="text-white text-sm font-semibold flex-1 text-left">{a.name}</span>
                <span className="text-[10px] text-white/40 font-mono">{a.hex}</span>
                {selected && (
                  <span className="w-5 h-5 grid place-items-center rounded-full" style={{ background: a.hex }}>
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-white/5 text-[11px] text-white/35 leading-relaxed">
          Default presets match by name: "Charsm" → Ember, "Madhi" → Nebula. Anyone can switch any time.
        </div>

        <button
          onClick={handleSignOut}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 transition"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}
