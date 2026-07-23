import { useState } from 'react';
import {
  Home, Rocket, Flame, BookOpen,
  Users, Settings, ChevronLeft, ChevronRight,
  Zap, Target,
} from 'lucide-react';
import { PEOPLE } from '../data';
import { ACCENTS } from '../theme';

export type TabKey =
  | 'mission' | 'startup' | 'streaks'
  | 'journal' | 'powerup' | 'goals'
  | 'squad' | 'settings';

interface NavItem {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const NAV: NavItem[] = [
  { key: 'mission',  label: 'Mission Control', icon: Home },
  { key: 'startup',  label: 'Startup Ideas',   icon: Rocket, badge: 3 },
  { key: 'streaks',  label: 'Streaks',          icon: Flame },
  { key: 'journal',  label: 'Journal',          icon: BookOpen },
  { key: 'powerup',  label: 'Power Up',         icon: Zap },
  { key: 'goals',    label: 'Goals',            icon: Target },
  { key: 'squad',    label: 'Squad',            icon: Users },
  { key: 'settings', label: 'Settings',         icon: Settings },
];

interface Props {
  active: TabKey;
  onChange: (t: TabKey) => void;
}

export default function Sidebar({ active, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const online = PEOPLE.filter((p) => p.online);
  const width = collapsed ? 'w-[60px]' : 'w-52';

  return (
    <aside className={`hidden md:flex flex-col ${width} shrink-0 px-2 py-4 border-r border-white/5 bg-ink/40 sticky top-16 h-[calc(100vh-4rem)] transition-[width] duration-200 overflow-hidden`}>

      {/* Collapse toggle */}
      <div className={`flex items-center mb-3 ${collapsed ? 'justify-center' : 'justify-between px-1'}`}>
        {!collapsed && <span className="text-[9px] tracked-sm text-white/30 font-bold">NAVIGATION</span>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="w-6 h-6 grid place-items-center rounded-md hover:bg-white/10 transition text-white/45 hover:text-white"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const isActive = active === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              title={collapsed ? item.label : undefined}
              className="group relative flex items-center gap-3 px-2 py-[7px] rounded-xl text-sm transition"
              style={isActive
                ? { background: 'var(--accent-soft)', color: '#fff' }
                : { color: 'rgba(255,255,255,0.58)' }}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
              <span
                className="w-[18px] h-[18px] grid place-items-center shrink-0"
                style={isActive ? { color: 'var(--accent)' } : undefined}
              >
                <Icon className="w-[18px] h-[18px]" />
              </span>
              {!collapsed && (
                <>
                  <span className={`flex-1 text-left text-[13px] ${isActive ? 'font-semibold' : ''}`}>
                    {item.label}
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.38)' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Squad online */}
      {!collapsed && (
        <div className="mt-4 glass p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] tracked-sm text-white/45">SQUAD ONLINE</span>
            <span className="text-[9px] text-white/35">{online.length}/{PEOPLE.length}</span>
          </div>
          <div className="flex -space-x-2">
            {online.slice(0, 5).map((p) => (
              <div key={p.id} className="relative">
                <img src={p.avatar} alt={p.name} className="w-6 h-6 rounded-full ring-2 ring-ink" />
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-ink"
                  style={{ background: ACCENTS[p.accent].hex }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="mt-auto pt-4 text-center">
          <p className="text-[10px] italic text-white/28 leading-snug">"Discipline compounds."</p>
          <p className="text-[9px] tracked-sm text-white/18 mt-1">— EVENT HORIZON</p>
        </div>
      )}
    </aside>
  );
}
