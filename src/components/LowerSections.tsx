import {
  ArrowRight, Rocket, Binary, BookOpen, Users, Star,
  ArrowBigUp, MessageCircle, Eye, BarChart3, Mic, Flame,
} from 'lucide-react';
import { DEADLINES, STARTUP_IDEAS, Deadline, StartupIdea } from '../data';

const WARN = '#FF4D2E';

const PRIORITY_COLOR: Record<Deadline['priority'], string> = {
  Critical: '#FF4D2A',
  High: '#FF8A1E',
  Medium: '#F5C518',
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket, Binary, BookOpen, Users, BarChart3, Mic, Flame,
};

/* ── Next Missions ──────────────────────────────────────────────────────── */
export function NextMissions({ compact }: { compact?: boolean }) {
  return (
    <section>
      <Header title="Next Missions" />
      <div className={`grid gap-2.5 ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
        {DEADLINES.map((d) => {
          const Icon = ICONS[d.icon] || Rocket;
          return (
            <div key={d.id} className="glass glass-hover p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <Icon className="w-3.5 h-3.5 text-white/70" />
                  </span>
                  <div>
                    <h3 className="text-white text-xs font-semibold leading-snug line-clamp-1">{d.title}</h3>
                    <span className="text-[10px] font-semibold" style={{ color: WARN }}>{d.daysLeft} Days Left</span>
                  </div>
                </div>
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-2"
                  style={{
                    background: `${PRIORITY_COLOR[d.priority]}22`,
                    color: PRIORITY_COLOR[d.priority],
                    border: `1px solid ${PRIORITY_COLOR[d.priority]}55`,
                  }}
                >
                  {d.priority.toUpperCase()}
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[9px] text-white/40 mb-1">
                  <span>Progress</span><span>{d.progress}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${d.progress}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Startup Ideas (standalone, no Squad Activity) ──────────────────────── */
export function StartupIdeas() {
  return (
    <section>
      <Header title="Startup Ideas" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {STARTUP_IDEAS.map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
      </div>
    </section>
  );
}

function IdeaCard({ idea }: { idea: StartupIdea }) {
  const Icon = ICONS[idea.icon] || Rocket;
  return (
    <div className="glass glass-hover p-3.5 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Icon className="w-3.5 h-3.5 text-white/70" />
          </span>
          <h3 className="text-white font-semibold text-xs leading-snug">{idea.title}</h3>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className="w-2.5 h-2.5"
              style={{ color: i < idea.rating ? '#F5A524' : 'rgba(255,255,255,0.12)' }}
              fill={i < idea.rating ? '#F5A524' : 'transparent'}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-white/50 leading-snug">{idea.description}</p>
      <div className="flex flex-wrap gap-1">
        {idea.tags.map((t) => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/58">{t}</span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-white/40 pt-1 border-t border-white/5">
        <span className="flex items-center gap-0.5"><ArrowBigUp className="w-3 h-3" />{idea.upvotes}</span>
        <span className="flex items-center gap-0.5"><MessageCircle className="w-3 h-3" />{idea.comments}</span>
        <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{idea.views}</span>
      </div>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-white font-semibold text-sm">{title}</h2>
      <button className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1">
        View All <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
