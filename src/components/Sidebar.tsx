import { useState } from 'react';
import {
  Home, Settings, ChevronLeft, ChevronRight,
  Zap, Target,
} from 'lucide-react';

// 'streaks' and 'squad' remain routable — they are reachable without a nav link
// (Streaks via the Upload Proof button and the mobile tab bar; squad info lives in
// Settings). Removing them from TabKey would delete the routes, not just the links.
export type TabKey =
  | 'mission' | 'streaks' | 'powerup'
  | 'goals' | 'squad' | 'settings' | 'tech';

interface NavItem {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const NAV: NavItem[] = [
  { key: 'mission',  label: 'Mission Control', icon: Home },
  { key: 'powerup',  label: 'Power Up',         icon: Zap },
  { key: 'goals',    label: 'Goals',            icon: Target },
  { key: 'settings', label: 'Settings',         icon: Settings },
];

interface Props {
  active: TabKey;
  onChange: (t: TabKey) => void;
}

export default function Sidebar({ active, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
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

      {!collapsed && (
        <div className="mt-auto pt-4 text-center">
          <p className="text-[10px] italic text-white/28 leading-snug">"Discipline compounds."</p>
          <p className="text-[9px] tracked-sm text-white/18 mt-1">— EVENT HORIZON</p>
        </div>
      )}
    </aside>
  );
}
