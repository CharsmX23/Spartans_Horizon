import { ArrowRight } from 'lucide-react';
import { BLUEPRINT_TRACKS } from '../data';
import { TabKey } from './Sidebar';

interface Props {
  onNavigate: (tab: TabKey) => void;
}

const totalCompleted = BLUEPRINT_TRACKS.reduce((s, t) => s + t.completed, 0);
const totalSkills    = BLUEPRINT_TRACKS.reduce((s, t) => s + t.total, 0);

export default function BlueprintCard({ onNavigate }: Props) {
  return (
    <div className="glass glass-hover p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracked-sm text-white/50">POWER UP</span>
        <button
          onClick={() => onNavigate('powerup')}
          className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1"
        >
          View <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold text-white">{totalCompleted}</span>
        <span className="text-white/40 text-sm">/ {totalSkills} skills</span>
      </div>
      <div className="flex flex-col gap-2">
        {BLUEPRINT_TRACKS.map((t) => (
          <div key={t.id}>
            <div className="flex items-center justify-between text-[10px] text-white/55 mb-1">
              <span>{t.category}</span>
              <span>{t.completed}/{t.total}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="h-full rounded-full" style={{ width: `${(t.completed / t.total) * 100}%`, background: t.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
