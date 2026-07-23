import { Home, Rocket, Flame, BookOpen, Target } from 'lucide-react';
import { TabKey } from './Sidebar';

const ITEMS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'mission',  label: 'Mission', icon: Home },
  { key: 'startup',  label: 'Ideas',   icon: Rocket },
  { key: 'streaks',  label: 'Streaks', icon: Flame },
  { key: 'journal',  label: 'Journal', icon: BookOpen },
  { key: 'goals',    label: 'Goals',   icon: Target },
];

export default function MobileTabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-ink/80 backdrop-blur-xl border-t border-white/10 flex">
      {ITEMS.map((it) => {
        const isActive = active === it.key;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={isActive ? { color: 'var(--accent)' } : { color: 'rgba(255,255,255,0.5)' }}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[9px]">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
