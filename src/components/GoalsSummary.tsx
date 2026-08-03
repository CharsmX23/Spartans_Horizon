import { useCallback, useEffect, useState } from 'react';
import { Target, ArrowRight, X } from 'lucide-react';
import { Goal, GOAL_TYPE_COLOR, GOAL_TYPE_LABEL, loadActiveGoals } from '../lib/goals';
import { deadlineLabel, deadlineColor } from '../lib/missions';

/* ── Goals summary ──────────────────────────────────────────────────────────
 * Read-only home-screen view of active goals, in the same card language as the
 * mission cards. Editing lives on the Goals page — this section deliberately has no
 * add form, so there is one place where a goal can be created or changed.
 *
 * The countdown reuses deadlineLabel/deadlineColor from lib/missions rather than
 * recomputing days, so "12 Days Left" means the same thing in both sections.
 */
export function GoalsSummary({ onViewAll, limit = 6 }: {
  onViewAll: () => void;
  limit?: number;
}) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadActiveGoals();
    if (loadError) { setError(loadError); setGoals([]); return; }
    setGoals(data ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = (goals ?? []).slice(0, limit);
  const hidden = (goals?.length ?? 0) - shown.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-white font-semibold text-sm">Goals</h2>
        <button
          onClick={onViewAll}
          className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1"
        >
          View All <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 mb-2.5"
          style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}
        >
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'inherit' }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {goals === null && <GoalSkeleton />}

      {goals?.length === 0 && !error && (
        <p className="text-[11px] text-white/35 px-0.5 py-1">
          No active goals yet —{' '}
          <button onClick={onViewAll} className="underline underline-offset-2 hover:text-white/70 transition">
            set one on the Goals page
          </button>
          .
        </p>
      )}

      {shown.length > 0 && (
        <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
          {shown.map((g) => <GoalSummaryCard key={g.id} goal={g} />)}
        </div>
      )}

      {hidden > 0 && (
        <button
          onClick={onViewAll}
          className="mt-2 text-[11px] text-white/35 hover:text-white/70 transition"
        >
          +{hidden} more active {hidden === 1 ? 'goal' : 'goals'}
        </button>
      )}
    </section>
  );
}

function GoalSummaryCard({ goal }: { goal: Goal }) {
  const typeColor = GOAL_TYPE_COLOR[goal.goal_type];
  const color = deadlineColor(goal.deadline);

  return (
    <div className="glass glass-hover p-3.5 flex items-center gap-2.5">
      <span
        className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Target className="w-3.5 h-3.5" style={{ color: typeColor }} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-white text-xs font-semibold leading-snug line-clamp-1">{goal.title}</h3>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {deadlineLabel(goal.deadline)}
        </span>
      </div>

      <span
        className="shrink-0 flex items-center gap-1.5 rounded-full"
        title={`${GOAL_TYPE_LABEL[goal.goal_type]} goal`}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
          padding: '2px 8px 2px 6px',
          color: typeColor,
          background: `${typeColor}18`,
          border: `1px solid ${typeColor}44`,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: typeColor, display: 'inline-block' }} />
        {GOAL_TYPE_LABEL[goal.goal_type].toUpperCase()}
      </span>
    </div>
  );
}

function GoalSkeleton() {
  return (
    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 animate-pulse">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="glass p-3.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 rounded bg-white/10" style={{ width: `${55 + i * 20}%` }} />
            <div className="h-2.5 w-16 rounded bg-white/[0.07]" />
          </div>
        </div>
      ))}
    </div>
  );
}
